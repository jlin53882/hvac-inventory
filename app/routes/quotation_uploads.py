# -*- coding: utf-8 -*-
"""
報價單上傳路由
================
- POST   /api/quotation-uploads              上傳（multipart，任意格式）
- GET    /api/quotation-uploads              列表（日期區間 + 關鍵字 + 分頁）
- GET    /api/quotation-uploads/{id}/preview 線上預覽（登入保護，inline）
- GET    /api/quotation-uploads/{id}/download 下載原檔
- PATCH  /api/quotation-uploads/{id}         編輯日期/檔案/上傳人/備註（上傳者/全域權限）
- DELETE /api/quotation-uploads/{id}         刪除（有 signed-report-delete-all 可刪全部，否則僅刪自己的）

儲存：static/uploads/quotation_uploads/YYYY-MM/{id}_{uuid8}_{safeName}
安全：大小上限 20MB、檔名不可控、路徑穿越防護、登入保護讀取（仿 /uploads/{id}.jpg）
"""
import datetime
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File, Form, Query
from fastapi.responses import FileResponse

from app.config import STATIC_DIR
from app.database import get_db
from app.services.auth import require_login
from app.services.safety import has_perm, safe_download_name
from app.services.file_storage import asset_variant_path, cleanup_asset_paths, delete_asset_files, finalize_asset_paths, get_owner_asset, safe_upload_path, store_asset
from app.models import SignedReportUpdate

router = APIRouter()
logger = logging.getLogger(__name__)

MAX_SIZE = 20 * 1024 * 1024  # 20MB
ALLOWED_EXTS = {".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp"}  # 副檔名白名單防 XSS

def _row_to_out(row, can_delete: bool) -> dict:
    """將 DB row 轉為 API 回傳的 dict 格式。"""
    return {
        "id": row["id"],
        "report_date": row["report_date"],
        "uploader_user_id": row["uploader_user_id"],
        "uploader_name": row["uploader_name"],
        "upload_time": row["upload_time"],
        "file_name": row["file_name"],
        "file_size": row["file_size"],
        "mime_type": row["mime_type"] or "",
        "note": row["note"] or "",
        "can_delete": can_delete,
    }

@router.post("/api/quotation-uploads")
def upload_quotation_upload(
    report_date: str = Form(...),
    uploader_name: str = Form(...),
    note: str = Form(""),
    file: UploadFile = File(...),
    user: dict = Depends(require_login),  # 實際由 main.py require_login 注入，此處僅取 user
):
    """上傳報價單上傳（multipart），支援任意格式，單檔上限 20MB。"""
    if user is None:
        raise HTTPException(401, "未登入")
    # 驗證欄位
    uploader_name = (uploader_name or "").strip()
    note = (note or "").strip()
    if not (1 <= len(uploader_name) <= 50):
        raise HTTPException(400, "上傳人需 1-50 字")
    if len(note) > 500:
        raise HTTPException(400, "備註最多 500 字")
    try:
        datetime.date.fromisoformat(report_date)
    except Exception:
        raise HTTPException(400, "報表日期格式需 YYYY-MM-DD")
    data = file.file.read(MAX_SIZE + 1)
    if len(data) == 0:
        raise HTTPException(400, "空檔案不可上傳")
    if len(data) > MAX_SIZE:
        raise HTTPException(400, "單檔上限 20MB")
    data = data[:MAX_SIZE]  # truncate to exact limit after size check
    safe = safe_download_name(file.filename or "file")
    # 副檔名白名單：防止上傳 SVG/HTML 等含腳本的檔案類型
    ext = Path(safe).suffix.lower()
    if ext not in ALLOWED_EXTS:
        raise HTTPException(400, f"不支援的檔案格式 {ext}，僅允許 PDF/PNG/JPG/GIF/WebP")
    mime = (file.content_type or "").strip()[:120]

    conn = get_db()
    asset = None
    try:
        cur = conn.execute(
            "INSERT INTO quotation_uploads(report_date, uploader_user_id, uploader_name, file_name, stored_path, file_size, mime_type, note) VALUES(?,?,?,?,?,?,?,?)",
            (report_date, user["id"], uploader_name, safe, "", len(data), mime, note),
        )
        rid = cur.lastrowid
        ym = report_date[:7]
        stored = f"quotation_uploads/{ym}/{rid}_{uuid.uuid4().hex[:8]}_{safe}"
        asset = store_asset(
            conn,
            category="quotation_upload",
            owner_type="quotation_upload",
            owner_id=rid,
            data=data,
            original_name=safe,
            mime_type=mime,
            year_month=ym,
            legacy_original_path=stored,
            upload_dir=Path(STATIC_DIR) / "uploads",
        )
        conn.execute(
            "UPDATE quotation_uploads SET stored_path=?, mime_type=? WHERE id=?",
            (asset.original_path, asset.mime_type, rid),
        )
        conn.commit()
        finalize_asset_paths(asset, upload_dir=Path(STATIC_DIR) / "uploads")
        row = conn.execute("SELECT * FROM quotation_uploads WHERE id=?", (rid,)).fetchone()
        can_del = has_perm(conn, user, "signed-report-delete-all") or (row["uploader_user_id"] == user["id"])
        return _row_to_out(row, can_del)
    except HTTPException:
        conn.rollback()
        if asset:
            cleanup_asset_paths(asset, upload_dir=Path(STATIC_DIR) / "uploads")
        raise
    except ValueError as exc:
        conn.rollback()
        if asset:
            cleanup_asset_paths(asset, upload_dir=Path(STATIC_DIR) / "uploads")
        raise HTTPException(400, str(exc)) from exc
    except Exception:
        conn.rollback()
        if asset:
            cleanup_asset_paths(asset, upload_dir=Path(STATIC_DIR) / "uploads")
        raise
    finally:
        conn.close()

@router.get("/api/quotation-uploads/kpi")
def quotation_uploads_kpi(
    month: str = Query("", description="YYYY-MM，預設本月"),
    user: dict = Depends(require_login),
):
    """回傳月級 KPI：已歸檔日數、缺檔日、歸檔率。
    缺檔日 = 該月行事曆有派工但未上傳簽名報表的日期。
    """
    if user is None:
        raise HTTPException(401, "未登入")
    now = datetime.datetime.now()
    if not month:
        month = f"{now.year}-{now.month:02d}"
    try:
        datetime.date.fromisoformat(month + "-01")
    except Exception:
        raise HTTPException(400, "月份格式需 YYYY-MM")
    conn = get_db()
    try:
        # 行事曆有派工的日期
        appt_rows = conn.execute(
            "SELECT DISTINCT date FROM appointments WHERE date LIKE ?",
            (month + "%",),
        ).fetchall()
        appointment_dates = set(r["date"] for r in appt_rows)
        # 已上傳簽名報表的日期
        report_rows = conn.execute(
            "SELECT DISTINCT report_date FROM quotation_uploads WHERE report_date LIKE ?",
            (month + "%",),
        ).fetchall()
        archived_dates = set(r["report_date"] for r in report_rows)
        archived = len(archived_dates)
        # 缺檔日 = 行事曆有派工但未上傳簽名報表的日期
        missing_dates = appointment_dates - archived_dates
        missing = len(missing_dates)
        total = len(appointment_dates)
        rate = round(archived / total * 100) if total > 0 else 0
        return {"month": month, "archived": archived, "missing": missing, "rate": rate, "total": total}
    finally:
        conn.close()


@router.get("/api/quotation-uploads")
def list_quotation_uploads(
    from_date: str = Query("", description="起始 YYYY-MM-DD"),
    to_date: str = Query("", description="迄止 YYYY-MM-DD"),
    q: str = Query("", description="關鍵字：上傳人/備註/檔名"),
    page: int = Query(1, ge=1, le=1000),
    page_size: int = Query(20, ge=1, le=50),
    user: dict = Depends(require_login),
):
    if user is None:
        raise HTTPException(401, "未登入")
    # 日期格式若有填需合法
    for d in (from_date, to_date):
        if d:
            try:
                datetime.date.fromisoformat(d)
            except Exception:
                raise HTTPException(400, f"日期格式需 YYYY-MM-DD：{d}")
    q = (q or "").strip()
    where, params = [], []
    if from_date:
        where.append("report_date >= ?")
        params.append(from_date)
    if to_date:
        where.append("report_date <= ?")
        params.append(to_date)
    if q:
        where.append("(uploader_name LIKE ? OR note LIKE ? OR file_name LIKE ? OR report_date LIKE ?)")
        like = f"%{q}%"
        params.extend([like, like, like, like])
    sql_where = ("WHERE " + " AND ".join(where)) if where else ""
    conn = get_db()
    try:
        total = conn.execute(f"SELECT COUNT(*) FROM quotation_uploads {sql_where}", params).fetchone()[0]
        rows = conn.execute(
            f"SELECT * FROM quotation_uploads {sql_where} ORDER BY report_date DESC, id DESC LIMIT ? OFFSET ?",
            (*params, page_size, (page - 1) * page_size),
        ).fetchall()
        can_all = has_perm(conn, user, "signed-report-delete-all")
        items = []
        for r in rows:
            can_del = can_all or (r["uploader_user_id"] == user["id"])
            items.append(_row_to_out(r, can_del))
        return {"items": items, "total": total, "page": page, "page_size": page_size}
    finally:
        conn.close()

@router.patch("/api/quotation-uploads/{rid}")
async def update_quotation_upload(
    rid: int,
    request: Request,
    user: dict = Depends(require_login),
):
    """編輯日期、檔案、上傳人與備註（上傳者或具全域刪除權限者）。

    ``uploader_name`` 只是可修正的顯示文字；``uploader_user_id`` 永不改寫，
    因此編輯上傳人不會轉移報表的權限 owner。替換檔案採「先提交 DB、
    後搬移/清理檔案」：提交前失敗刪新檔，提交後清理失敗只記錄警告，
    不回滾已可讀取的新資料。
    """
    if user is None:
        raise HTTPException(401, "未登入")
    file = None
    content_type = request.headers.get("content-type", "")
    if content_type.startswith(("multipart/form-data", "application/x-www-form-urlencoded")):
        form = await request.form()
        report_date = _form_text(form, "report_date")
        uploader_name = _form_text(form, "uploader_name")
        note = _form_text(form, "note")
        candidate = form.get("file")
        if candidate is not None and getattr(candidate, "filename", None) is not None:
            file = candidate
    else:
        try:
            payload = SignedReportUpdate.model_validate(await request.json())
        except Exception as exc:
            raise HTTPException(422, "編輯資料格式錯誤") from exc
        report_date = payload.report_date
        uploader_name = payload.uploader_name
        note = payload.note
    conn = get_db()
    new_asset = None
    old_asset = None
    old_fallback = None
    committed = False
    try:
        # 先鎖定寫入交易，避免兩個替換同時讀到同一個舊 asset 而留下孤兒檔。
        # asset 的 DB 對映在同一交易內切換；檔案本體則在 commit 後 finalize。
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute("SELECT * FROM quotation_uploads WHERE id=?", (rid,)).fetchone()
        if row is None:
            raise HTTPException(404, "報表不存在")
        can_all = has_perm(conn, user, "signed-report-delete-all")
        if not (can_all or row["uploader_user_id"] == user["id"]):
            raise HTTPException(403, "僅上傳者或具全域刪除權限者可編輯")
        report_date = row["report_date"] if report_date is None else report_date.strip()
        uploader_name = row["uploader_name"] if uploader_name is None else uploader_name.strip()
        note = row["note"] or "" if note is None else note.strip()
        if not (1 <= len(uploader_name) <= 50):
            raise HTTPException(400, "上傳人需 1-50 字")
        if len(note) > 500:
            raise HTTPException(400, "備註最多 500 字")
        try:
            datetime.date.fromisoformat(report_date)
        except Exception:
            raise HTTPException(400, "報表日期格式需 YYYY-MM-DD")

        old_asset = get_owner_asset(conn, "quotation_upload", "quotation_upload", rid)
        if not old_asset and row["stored_path"]:
            try:
                old_fallback = safe_upload_path(row["stored_path"], upload_dir=Path(STATIC_DIR) / "uploads")
            except (FileNotFoundError, TypeError, ValueError):
                old_fallback = None

        update_fields = ["report_date=?", "uploader_name=?", "note=?"]
        update_values = [report_date, uploader_name, note]
        if file is not None:
            data, safe, mime = _read_upload(file)
            ym = report_date[:7]
            stored = f"quotation_uploads/{ym}/{rid}_{uuid.uuid4().hex[:8]}_{safe}"
            new_asset = store_asset(
                conn, category="quotation_upload", owner_type="quotation_upload", owner_id=rid,
                data=data, original_name=safe, mime_type=mime, year_month=ym,
                legacy_original_path=stored, upload_dir=Path(STATIC_DIR) / "uploads",
            )
            update_fields.extend(["file_name=?", "stored_path=?", "file_size=?", "mime_type=?"])
            update_values.extend([safe, new_asset.original_path, len(data), new_asset.mime_type])
        conn.execute(
            f"UPDATE quotation_uploads SET {', '.join(update_fields)} WHERE id=?",
            (*update_values, rid),
        )
        if old_asset and new_asset:
            conn.execute("DELETE FROM file_assets WHERE asset_id=?", (old_asset["asset_id"],))
        conn.commit()
        committed = True
        if new_asset:
            try:
                finalize_asset_paths(new_asset, upload_dir=Path(STATIC_DIR) / "uploads")
                if old_asset:
                    delete_asset_files(old_asset, upload_dir=Path(STATIC_DIR) / "uploads")
                elif old_fallback:
                    old_fallback.unlink(missing_ok=True)
            except OSError as exc:
                logger.warning("報價單上傳舊檔清理失敗 rid=%s: %s", rid, exc)
        updated = conn.execute("SELECT * FROM quotation_uploads WHERE id=?", (rid,)).fetchone()
        can_delete = can_all or updated["uploader_user_id"] == user["id"]
        return _row_to_out(updated, can_delete)
    except HTTPException:
        if not committed:
            conn.rollback()
            if new_asset:
                cleanup_asset_paths(new_asset, upload_dir=Path(STATIC_DIR) / "uploads")
        raise
    except ValueError as exc:
        if not committed:
            conn.rollback()
            if new_asset:
                cleanup_asset_paths(new_asset, upload_dir=Path(STATIC_DIR) / "uploads")
        raise HTTPException(400, str(exc)) from exc
    except Exception:
        if not committed:
            conn.rollback()
            if new_asset:
                cleanup_asset_paths(new_asset, upload_dir=Path(STATIC_DIR) / "uploads")
        raise
    finally:
        conn.close()


@router.get("/api/quotation-uploads/{rid}/preview")
def preview_quotation_upload(rid: int, user: dict = Depends(require_login)):
    """線上預覽：圖片走壓縮 preview，PDF 保持原始檔。"""
    if user is None:
        raise HTTPException(401, "未登入")
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT id, stored_path, file_name, mime_type FROM quotation_uploads WHERE id=?", (rid,)
        ).fetchone()
        if row is None:
            raise HTTPException(404, "報表不存在")
        upload_dir = Path(STATIC_DIR) / "uploads"
        asset = get_owner_asset(conn, "quotation_upload", "quotation_upload", rid)
        mime = (asset["mime_type"] if asset else row["mime_type"] or "").lower()
        use_preview = bool(asset and asset["preview_path"] and mime.startswith("image/"))
        try:
            path = (
                asset_variant_path(asset, "preview", upload_dir=upload_dir)
                if use_preview
                else safe_upload_path(row["stored_path"], upload_dir=upload_dir)
            )
        except (FileNotFoundError, TypeError, ValueError):
            raise HTTPException(404, "檔案不存在")
        if not path.exists():
            raise HTTPException(404, "檔案遺失")
        fname = (row["file_name"] or "").lower()
        is_svg = mime == "image/svg+xml" or fname.endswith(".svg")
        is_html = mime in ("text/html", "application/xhtml+xml") or fname.endswith((".html", ".htm"))
        safe_inline = (mime in ("application/pdf",) or mime.startswith("image/")) and not is_svg and not is_html
        disp = "inline" if safe_inline else "attachment"
        response_mime = "image/jpeg" if use_preview else (
            mime if mime == "application/pdf" or (mime.startswith("image/") and not is_svg and not is_html)
            else "application/octet-stream"
        )
        return FileResponse(
            path,
            media_type=response_mime,
            filename=row["file_name"],
            content_disposition_type=disp,
        )
    finally:
        conn.close()

@router.get("/api/quotation-uploads/{rid}/download")
def download_quotation_upload(rid: int, user: dict = Depends(require_login)):
    """下載簽名報表原檔（attachment）。"""
    if user is None:
        raise HTTPException(401, "未登入")
    conn = get_db()
    try:
        row = conn.execute("SELECT stored_path, file_name FROM quotation_uploads WHERE id=?", (rid,)).fetchone()
        if row is None:
            raise HTTPException(404, "報表不存在")
        try:
            path = safe_upload_path(
                row["stored_path"], upload_dir=Path(STATIC_DIR) / "uploads"
            )
        except (FileNotFoundError, TypeError, ValueError):
            raise HTTPException(404, "檔案不存在")
        if not path.exists():
            raise HTTPException(404, "檔案遺失")
        # FileResponse handles non-ASCII filenames with RFC 5987 encoding.
        return FileResponse(path, filename=row["file_name"], content_disposition_type="attachment")
    finally:
        conn.close()

@router.delete("/api/quotation-uploads/{rid}")
def delete_quotation_upload(rid: int, user: dict = Depends(require_login)):
    """刪除資料列、original 與所有媒體變體。"""
    if user is None:
        raise HTTPException(401, "未登入")
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT uploader_user_id, stored_path FROM quotation_uploads WHERE id=?", (rid,)
        ).fetchone()
        if row is None:
            raise HTTPException(404, "報表不存在")
        can_all = has_perm(conn, user, "signed-report-delete-all")
        if not (can_all or row["uploader_user_id"] == user["id"]):
            raise HTTPException(403, "僅上傳者或具全域刪除權限者可刪除")
        asset = get_owner_asset(conn, "quotation_upload", "quotation_upload", rid)
        fallback = None
        if row["stored_path"]:
            try:
                fallback = safe_upload_path(
                    row["stored_path"], upload_dir=Path(STATIC_DIR) / "uploads"
                )
            except (FileNotFoundError, TypeError, ValueError):
                fallback = None
        conn.execute("DELETE FROM quotation_uploads WHERE id=?", (rid,))
        if asset:
            conn.execute("DELETE FROM file_assets WHERE asset_id=?", (asset["asset_id"],))
        conn.commit()
        if asset:
            delete_asset_files(asset, upload_dir=Path(STATIC_DIR) / "uploads")
        elif fallback:
            try:
                fallback.unlink(missing_ok=True)
            except OSError:
                pass
        return {"ok": True}
    finally:
        conn.close()
