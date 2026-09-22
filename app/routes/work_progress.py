"""每日工作進度回報 API。

工作來源是 appointments；本模組只保存歷史 snapshot 與施工照片，
不修改行事曆資料，也不共用每日簽名報表資料表。
"""
from __future__ import annotations

import datetime
import re
import sqlite3
from pathlib import Path
from typing import Iterable

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse

from app.config import STATIC_DIR
from app.database import get_db
from app.models import WorkProgressNoteUpdate
from app.services.auth import get_user_permissions, require_db_perm
from app.services.file_storage import (
    asset_media_type,
    asset_variant_path,
    cleanup_asset_paths,
    delete_asset_files,
    finalize_asset_paths,
    store_asset,
)
from app.services.safety import safe_download_name

router = APIRouter(prefix="/api/work-progress", tags=["work-progress"])

CATEGORY = "work_progress"
OWNER_TYPE = "work_progress_report"
ALLOWED_EXTS = {".jpg", ".jpeg", ".png", ".webp"}
MAX_NOTE_LENGTH = 1000
MAX_FILES = 20
MAX_FILE_BYTES = 20 * 1024 * 1024
MAX_BATCH_BYTES = 100 * 1024 * 1024
ASSET_ID_RE = re.compile(r"^[0-9a-f]{32}$")
MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


def _upload_dir() -> Path:
    """Return the server-controlled root used for Work Progress media files."""
    return Path(STATIC_DIR) / "uploads"


def _validate_date(value: str, label: str) -> str:
    """Validate an ISO calendar date and return its canonical representation."""
    try:
        return datetime.date.fromisoformat(value).isoformat()
    except (TypeError, ValueError) as exc:
        raise HTTPException(400, f"{label}格式需 YYYY-MM-DD") from exc


def _validate_month(value: str) -> str:
    """Validate a ``YYYY-MM`` month and return the original canonical value."""
    if not MONTH_RE.fullmatch(value or ""):
        raise HTTPException(400, "月份格式需 YYYY-MM")
    try:
        datetime.date.fromisoformat(value + "-01")
    except ValueError as exc:
        raise HTTPException(400, "月份格式需 YYYY-MM") from exc
    return value


def _validate_note(note: str) -> str:
    """Normalize and validate the user-entered progress note length."""
    if not isinstance(note, str):
        raise HTTPException(400, "工作進度備註格式錯誤")
    note = note.strip()
    if len(note) > MAX_NOTE_LENGTH:
        raise HTTPException(400, "工作進度備註最多 1000 字")
    return note


def _validate_uploader_name(uploader_name: str) -> str:
    """Normalize and validate the display-name snapshot length."""
    if not isinstance(uploader_name, str):
        raise HTTPException(400, "回報人格式錯誤")
    uploader_name = uploader_name.strip()
    if not 1 <= len(uploader_name) <= 50:
        raise HTTPException(400, "回報人需 1-50 字")
    return uploader_name


def _read_image_uploads(files: Iterable[UploadFile] | None) -> list[tuple[bytes, str, str]]:
    """Read and validate one atomic batch of image uploads before persistence."""
    uploads = list(files or [])
    if not uploads:
        raise HTTPException(400, "至少需要 1 張照片")
    if len(uploads) > MAX_FILES:
        raise HTTPException(400, "單次最多上傳 20 張照片")
    result = []
    total = 0
    for file in uploads:
        safe_name = safe_download_name(file.filename or "photo.jpg")
        ext = Path(safe_name).suffix.lower()
        if ext not in ALLOWED_EXTS:
            raise HTTPException(400, "僅允許 JPG、JPEG、PNG、WebP 圖片")
        data = file.file.read(MAX_FILE_BYTES + 1)
        if not data:
            raise HTTPException(400, "空圖片不可上傳")
        if len(data) > MAX_FILE_BYTES:
            raise HTTPException(400, "單張圖片上限 20MB")
        total += len(data)
        if total > MAX_BATCH_BYTES:
            raise HTTPException(400, "單次圖片總量上限 100MB")
        result.append((data, safe_name, (file.content_type or "").strip()[:120]))
    return result


def _permissions(conn, user: dict) -> dict:
    """每次操作從 DB 重算權限，不能信前端 flags 或舊 session dict。"""
    return get_user_permissions(conn, user["id"])


def _flags(conn, row, user: dict) -> tuple[bool, bool]:
    """Calculate edit and delete capabilities from current permissions and immutable ownership."""
    perms = _permissions(conn, user)
    owner = row["uploader_user_id"] is not None and row["uploader_user_id"] == user["id"]
    can_edit = bool(perms.get("work-progress-edit-all")) or (
        bool(perms.get("work-progress-edit")) and owner
    )
    can_delete = bool(perms.get("work-progress-delete-all")) or (
        bool(perms.get("work-progress-delete")) and owner
    )
    return can_edit, can_delete


def _report_out(conn, row, user: dict, *, include_photos: bool = False) -> dict:
    """Serialize a report snapshot and, optionally, its scoped photo metadata for the API."""
    can_edit, can_delete = _flags(conn, row, user)
    result = {
        "id": row["id"],
        "appointment_id": row["appointment_id"],
        "report_date": row["report_date"],
        "client_name": row["client_name_snapshot"],
        "address": row["address_snapshot"],
        "service_name": row["service_name_snapshot"],
        "start_time": row["start_time_snapshot"],
        "end_time": row["end_time_snapshot"],
        "appointment_note": row["appointment_note_snapshot"],
        "note": row["note"],
        "uploader_user_id": row["uploader_user_id"],
        "uploader_name": row["uploader_name"],
        "created_by_username": row["created_by_username"] if "created_by_username" in row.keys() else None,
        "created_by_display_name": row["created_by_display_name"] if "created_by_display_name" in row.keys() else None,
        "photo_count": row["photo_count"] if "photo_count" in row.keys() else 0,
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "appointment_deleted": row["appointment_id"] is None,
        "can_edit": can_edit,
        "can_delete": can_delete,
    }
    if include_photos:
        assets = conn.execute(
            """SELECT asset_id, original_name, original_path, preview_path, thumbnail_path,
                      original_size, width, height, created_at
               FROM file_assets
               WHERE category=? AND owner_type=? AND owner_id=?
               ORDER BY created_at, asset_id""",
            (CATEGORY, OWNER_TYPE, str(row["id"])),
        ).fetchall()
        result["photos"] = [
            {
                "asset_id": asset["asset_id"],
                "original_name": asset["original_name"],
                "original_size": asset["original_size"],
                "width": asset["width"],
                "height": asset["height"],
                "created_at": asset["created_at"],
                "thumbnail_url": f"/api/work-progress/{row['id']}/photos/{asset['asset_id']}/thumbnail",
                "preview_url": f"/api/work-progress/{row['id']}/photos/{asset['asset_id']}/preview",
                "download_url": f"/api/work-progress/{row['id']}/photos/{asset['asset_id']}/download",
            }
            for asset in assets
        ]
        result["photo_count"] = len(result["photos"])
    return result


def _get_report(conn, report_id: int):
    """Load one report with creator metadata or raise a not-found API error."""
    row = conn.execute(
        """SELECT r.*, u.username AS created_by_username,
                  u.display_name AS created_by_display_name
           FROM daily_work_progress_reports r
           LEFT JOIN users u ON u.id=r.uploader_user_id
           WHERE r.id=?""",
        (report_id,),
    ).fetchone()
    if row is None:
        raise HTTPException(404, "工作進度不存在")
    return row


def _cleanup_assets(assets: Iterable) -> None:
    """Remove staged asset files and now-empty server-owned directories after rollback."""
    root = _upload_dir().resolve()
    for asset in reversed(list(assets)):
        cleanup_asset_paths(asset, upload_dir=root)
        for relative in (asset.original_path, asset.preview_path, asset.thumbnail_path):
            if not relative:
                continue
            parent = (root / relative).resolve().parent
            while parent != root and root in parent.parents and parent.exists():
                try:
                    parent.rmdir()
                except OSError:
                    break
                parent = parent.parent


def _store_batch(conn, report_id: int, report_date: str, uploads) -> list:
    """Stage every upload in a report batch and clean partial output on failure."""
    assets = []
    base_dir = f"work_progress/{report_date[:7]}/{report_id}"
    try:
        for data, original_name, mime_type in uploads:
            assets.append(store_asset(
                conn,
                category=CATEGORY,
                owner_type=OWNER_TYPE,
                owner_id=report_id,
                data=data,
                original_name=original_name,
                mime_type=mime_type,
                year_month=report_date[:7],
                base_relative_dir=base_dir,
                upload_dir=_upload_dir(),
            ))
        return assets
    except Exception:
        _cleanup_assets(assets)
        raise


def _finalize(assets: Iterable) -> None:
    """Finalize staged asset files after the database transaction commits."""
    for asset in assets:
        finalize_asset_paths(asset, upload_dir=_upload_dir())


@router.get("")
def list_work_progress(
    from_date: str = Query(""),
    to_date: str = Query(""),
    q: str = Query("", max_length=200),
    page: int = Query(1, ge=1, le=10000),
    page_size: int = Query(20, ge=1, le=100),
    user: dict = Depends(require_db_perm("work-progress-view")),
):
    """List historical Work Progress reports with date, keyword, and pagination filters."""
    if from_date:
        from_date = _validate_date(from_date, "起始日期")
    if to_date:
        to_date = _validate_date(to_date, "迄止日期")
    if from_date and to_date and from_date > to_date:
        raise HTTPException(400, "起始日期不可晚於迄止日期")
    q = (q or "").strip()
    where = []
    params: list = []
    if from_date:
        where.append("r.report_date >= ?")
        params.append(from_date)
    if to_date:
        where.append("r.report_date <= ?")
        params.append(to_date)
    if q:
        like = f"%{q}%"
        where.append("(r.client_name_snapshot LIKE ? OR r.service_name_snapshot LIKE ? OR "
                     "r.address_snapshot LIKE ? OR r.note LIKE ? OR r.uploader_name LIKE ? OR "
                     "r.report_date LIKE ?)")
        params.extend([like] * 6)
    clause = " WHERE " + " AND ".join(where) if where else ""
    conn = get_db()
    try:
        count = conn.execute(
            f"SELECT COUNT(*) FROM daily_work_progress_reports r{clause}", params
        ).fetchone()[0]
        rows = conn.execute(
            f"""SELECT r.*, u.username AS created_by_username,
                       u.display_name AS created_by_display_name,
                       COUNT(f.asset_id) AS photo_count
                FROM daily_work_progress_reports r
                LEFT JOIN users u ON u.id=r.uploader_user_id
                LEFT JOIN file_assets f ON f.category=? AND f.owner_type=? AND f.owner_id=CAST(r.id AS TEXT)
                {clause}
                GROUP BY r.id
                ORDER BY r.report_date DESC, r.id DESC
                LIMIT ? OFFSET ?""",
            [CATEGORY, OWNER_TYPE, *params, page_size, (page - 1) * page_size],
        ).fetchall()
        return {
            "items": [_report_out(conn, row, user) for row in rows],
            "total": count,
            "page": page,
            "page_size": page_size,
        }
    finally:
        conn.close()


@router.get("/kpi")
def work_progress_kpi(
    month: str = Query(""),
    user: dict = Depends(require_db_perm("work-progress-view")),
):
    """Return monthly appointment-based Work Progress completion statistics."""
    if not month:
        now = datetime.date.today()
        month = f"{now.year:04d}-{now.month:02d}"
    month = _validate_month(month)
    conn = get_db()
    try:
        total = conn.execute(
            "SELECT COUNT(*) FROM appointments WHERE date LIKE ?", (month + "%",)
        ).fetchone()[0]
        reported = conn.execute(
            """SELECT COUNT(*) FROM daily_work_progress_reports r
               JOIN appointments a ON a.id=r.appointment_id
               WHERE a.date LIKE ?""",
            (month + "%",),
        ).fetchone()[0]
        photos = conn.execute(
            """SELECT COUNT(*) FROM file_assets f
               JOIN daily_work_progress_reports r ON r.id=CAST(f.owner_id AS INTEGER)
               WHERE f.category=? AND f.owner_type=? AND r.report_date LIKE ?""",
            (CATEGORY, OWNER_TYPE, month + "%"),
        ).fetchone()[0]
        return {
            "month": month,
            "total": total,
            "reported": reported,
            "missing": total - reported,
            "rate": round(reported / total * 100) if total else None,
            "photo_count": photos,
        }
    finally:
        conn.close()


@router.get("/{report_id}")
def get_work_progress(report_id: int, user: dict = Depends(require_db_perm("work-progress-view"))):
    """Return one complete Work Progress report with its scoped photos."""
    conn = get_db()
    try:
        row = _get_report(conn, report_id)
        return _report_out(conn, row, user, include_photos=True)
    finally:
        conn.close()


@router.post("", status_code=201)
def create_work_progress(
    appointment_id: int = Form(...),
    uploader_name: str | None = Form(None),
    note: str = Form(""),
    files: list[UploadFile] | None = File(None),
    user: dict = Depends(require_db_perm("work-progress-create")),
):
    """Create one appointment-bound report and atomically stage its required photos."""
    uploader_name = _validate_uploader_name(
        user.get("display_name") or user.get("username") or ""
        if uploader_name is None
        else uploader_name
    )
    note = _validate_note(note)
    uploads = _read_image_uploads(files)
    conn = get_db()
    assets = []
    committed = False
    try:
        conn.execute("BEGIN IMMEDIATE")
        appointment = conn.execute(
            """SELECT a.*, s.name AS service_name
               FROM appointments a LEFT JOIN service_types s ON s.id=a.service_type_id
               WHERE a.id=?""",
            (appointment_id,),
        ).fetchone()
        if appointment is None:
            raise HTTPException(404, "行事曆工作不存在")
        report_date = _validate_date(appointment["date"], "工作日期")
        try:
            cur = conn.execute(
                """INSERT INTO daily_work_progress_reports
                   (appointment_id, report_date, uploader_user_id, uploader_name, note,
                    client_name_snapshot, address_snapshot, service_name_snapshot,
                    start_time_snapshot, end_time_snapshot, appointment_note_snapshot)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    appointment_id, report_date, user["id"], uploader_name,
                    note, appointment["client_name"], appointment["address"] or "",
                    appointment["service_name"] or "", appointment["start_time"] or "",
                    appointment["end_time"] or "", appointment["note"] or "",
                ),
            )
        except sqlite3.IntegrityError as exc:
            if "daily_work_progress_reports.appointment_id" in str(exc) or "UNIQUE constraint" in str(exc):
                raise HTTPException(409, "此工作已有工作進度回報") from exc
            raise
        report_id = cur.lastrowid
        assets = _store_batch(conn, report_id, report_date, uploads)
        conn.commit()
        committed = True
        _finalize(assets)
        row = _get_report(conn, report_id)
        return _report_out(conn, row, user, include_photos=True)
    except HTTPException:
        if not committed:
            conn.rollback()
            _cleanup_assets(assets)
        raise
    except ValueError as exc:
        if not committed:
            conn.rollback()
            _cleanup_assets(assets)
        raise HTTPException(400, str(exc)) from exc
    except Exception:
        if not committed:
            conn.rollback()
            _cleanup_assets(assets)
        raise
    finally:
        conn.close()


@router.patch("/{report_id}")
async def update_work_progress(
    report_id: int,
    request: Request,
    user: dict = Depends(require_db_perm("work-progress-view")),
):
    """Update only report-owned display name and progress note fields."""
    try:
        body = WorkProgressNoteUpdate.model_validate(await request.json())
    except Exception as exc:
        raise HTTPException(400, "工作進度編輯資料格式錯誤") from exc
    if body.note is None and body.uploader_name is None:
        raise HTTPException(400, "至少提供回報人或工作進度備註")
    conn = get_db()
    try:
        conn.execute("BEGIN IMMEDIATE")
        row = _get_report(conn, report_id)
        can_edit, _ = _flags(conn, row, user)
        if not can_edit:
            raise HTTPException(403, "沒有編輯此工作進度的權限")
        uploader_name = row["uploader_name"] if body.uploader_name is None else _validate_uploader_name(body.uploader_name)
        note = row["note"] if body.note is None else _validate_note(body.note)
        conn.execute(
            "UPDATE daily_work_progress_reports SET uploader_name=?, note=?, updated_at=datetime('now','localtime') WHERE id=?",
            (uploader_name, note, report_id),
        )
        conn.commit()
        return _report_out(conn, _get_report(conn, report_id), user, include_photos=True)
    except HTTPException:
        conn.rollback()
        raise
    finally:
        conn.close()


@router.post("/{report_id}/photos")
def add_work_progress_photos(
    report_id: int,
    files: list[UploadFile] | None = File(None),
    user: dict = Depends(require_db_perm("work-progress-view")),
):
    """Append a validated photo batch to an existing report atomically."""
    uploads = _read_image_uploads(files)
    conn = get_db()
    assets = []
    committed = False
    try:
        conn.execute("BEGIN IMMEDIATE")
        row = _get_report(conn, report_id)
        can_edit, _ = _flags(conn, row, user)
        if not can_edit:
            raise HTTPException(403, "沒有新增照片的權限")
        existing_count = conn.execute(
            """SELECT COUNT(*) FROM file_assets
               WHERE category=? AND owner_type=? AND owner_id=?""",
            (CATEGORY, OWNER_TYPE, str(report_id)),
        ).fetchone()[0]
        if existing_count + len(uploads) > MAX_FILES:
            raise HTTPException(400, "每份工作進度最多保留 20 張照片")
        assets = _store_batch(conn, report_id, row["report_date"], uploads)
        conn.execute(
            "UPDATE daily_work_progress_reports SET updated_at=datetime('now','localtime') WHERE id=?",
            (report_id,),
        )
        conn.commit()
        committed = True
        _finalize(assets)
        return _report_out(conn, _get_report(conn, report_id), user, include_photos=True)
    except HTTPException:
        if not committed:
            conn.rollback()
            _cleanup_assets(assets)
        raise
    except ValueError as exc:
        if not committed:
            conn.rollback()
            _cleanup_assets(assets)
        raise HTTPException(400, str(exc)) from exc
    except Exception:
        if not committed:
            conn.rollback()
            _cleanup_assets(assets)
        raise
    finally:
        conn.close()


@router.delete("/{report_id}/photos/{asset_id}")
def delete_work_progress_photo(
    report_id: int,
    asset_id: str,
    user: dict = Depends(require_db_perm("work-progress-view")),
):
    """Delete one photo only after verifying report scope and edit permission."""
    if not ASSET_ID_RE.fullmatch(asset_id):
        raise HTTPException(404, "照片不存在")
    conn = get_db()
    try:
        conn.execute("BEGIN IMMEDIATE")
        row = _get_report(conn, report_id)
        can_edit, _ = _flags(conn, row, user)
        if not can_edit:
            raise HTTPException(403, "沒有刪除照片的權限")
        asset = conn.execute(
            """SELECT * FROM file_assets
               WHERE asset_id=? AND category=? AND owner_type=? AND owner_id=?""",
            (asset_id, CATEGORY, OWNER_TYPE, str(report_id)),
        ).fetchone()
        if asset is None:
            raise HTTPException(404, "照片不存在")
        conn.execute("DELETE FROM file_assets WHERE asset_id=?", (asset_id,))
        conn.execute(
            "UPDATE daily_work_progress_reports SET updated_at=datetime('now','localtime') WHERE id=?",
            (report_id,),
        )
        conn.commit()
    except HTTPException:
        conn.rollback()
        raise
    finally:
        conn.close()
    delete_asset_files(asset, upload_dir=_upload_dir())
    return {"ok": True, "asset_id": asset_id}


@router.delete("/{report_id}")
def delete_work_progress(
    report_id: int,
    user: dict = Depends(require_db_perm("work-progress-view")),
):
    """Delete a report and all of its scoped media files."""
    conn = get_db()
    assets = []
    try:
        conn.execute("BEGIN IMMEDIATE")
        row = _get_report(conn, report_id)
        _, can_delete = _flags(conn, row, user)
        if not can_delete:
            raise HTTPException(403, "沒有刪除此工作進度的權限")
        assets = conn.execute(
            """SELECT * FROM file_assets
               WHERE category=? AND owner_type=? AND owner_id=?""",
            (CATEGORY, OWNER_TYPE, str(report_id)),
        ).fetchall()
        conn.execute("DELETE FROM file_assets WHERE category=? AND owner_type=? AND owner_id=?",
                     (CATEGORY, OWNER_TYPE, str(report_id)))
        conn.execute("DELETE FROM daily_work_progress_reports WHERE id=?", (report_id,))
        conn.commit()
    except HTTPException:
        conn.rollback()
        raise
    finally:
        conn.close()
    for asset in assets:
        delete_asset_files(asset, upload_dir=_upload_dir())
    return {"ok": True, "id": report_id}


@router.get("/{report_id}/photos/{asset_id}/{variant}")
def read_work_progress_photo(
    report_id: int,
    asset_id: str,
    variant: str,
    user: dict = Depends(require_db_perm("work-progress-view")),
):
    """Serve one authenticated thumbnail, preview, or original download."""
    if not ASSET_ID_RE.fullmatch(asset_id) or variant not in {"thumbnail", "preview", "download"}:
        raise HTTPException(404, "照片不存在")
    actual_variant = "original" if variant == "download" else variant
    conn = get_db()
    try:
        report = conn.execute(
            "SELECT id FROM daily_work_progress_reports WHERE id=?", (report_id,)
        ).fetchone()
        if report is None:
            raise HTTPException(404, "工作進度不存在")
        asset = conn.execute(
            """SELECT * FROM file_assets
               WHERE asset_id=? AND category=? AND owner_type=? AND owner_id=?""",
            (asset_id, CATEGORY, OWNER_TYPE, str(report_id)),
        ).fetchone()
        if asset is None:
            raise HTTPException(404, "照片不存在")
        try:
            path = asset_variant_path(asset, actual_variant, upload_dir=_upload_dir())
        except (FileNotFoundError, ValueError) as exc:
            raise HTTPException(404, "照片變體不存在") from exc
        if not path.exists():
            raise HTTPException(404, "照片檔案遺失")
        kwargs = {
            "media_type": asset_media_type(asset, actual_variant),
            "headers": {"Cache-Control": "private, max-age=86400"},
        }
        if variant == "download":
            kwargs.update(filename=asset["original_name"] or "photo", content_disposition_type="attachment")
        return FileResponse(path, **kwargs)
    finally:
        conn.close()
