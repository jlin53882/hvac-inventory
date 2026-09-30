# -*- coding: utf-8 -*-
"""
可管理的檔案上傳資源（共用實作）
================================
每日簽名報表（signed_reports）與報價單上傳（quotation_uploads）過去是兩份幾乎逐行相同的
~520 行 route（差異只有表名 / category / URL 前綴 / 權限 key / 訊息文字）。
改一處漏另一處會造成兩個模組行為不一致，因此把整套「上傳 / 列表 / KPI / 編輯 / 預覽 / 下載 /
刪除」實作集中在這裡，各資源只提供 :class:`UploadResource` 設定與自己的權限規則。

新增第三種上傳類型：建立一個 UploadResource 並呼叫 build_upload_router 即可。

儲存：static/uploads/<storage_dir>/YYYY-MM/{id}_{uuid8}_{safeName}
安全：大小上限 20MB、檔名不可控、路徑穿越防護、登入保護讀取（仿 /uploads/{id}.jpg）
"""
import datetime
import logging
import uuid
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType
from typing import Any, Callable

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse

from app.config import STATIC_DIR
from app.database import get_db
from app.services.auth import require_login
from app.services.file_storage import (
    asset_variant_path,
    cleanup_asset_paths,
    delete_asset_files,
    finalize_asset_paths,
    get_owner_asset,
    prepare_media,
    safe_upload_path,
    store_asset,
)
from app.services.safety import safe_download_name
from app.services.upload_policy import DOCUMENT_UPLOAD_EXTS

logger = logging.getLogger(__name__)

MAX_SIZE = 20 * 1024 * 1024  # 20MB

# 錯誤訊息顯示給使用者：表單欄位名稱轉成畫面上的中文標籤
_FIELD_LABELS = MappingProxyType({"report_date": "報表日期", "uploader_name": "上傳人姓名", "note": "備註"})


@dataclass(frozen=True)
class UploadResource:
    """一種上傳資源的差異設定；其餘行為全部共用。"""

    table: str                 # DB 資料表，如 daily_signed_reports
    asset_key: str             # file_assets 的 category 與 owner_type（兩者相同）
    url_prefix: str            # 如 /api/signed-reports
    storage_dir: str           # uploads 下的子目錄，如 signed_reports
    label: str                 # log 用中文名稱，如「簽名報表」
    capabilities: Callable[[Any, Any, dict], dict]   # (conn, row, user) → {"can_edit","can_delete"}
    upload_dependency: Callable[..., Any]            # 上傳端點的權限依賴（require_perm(...) 或 require_login）
    update_model: type         # PATCH JSON body 的 Pydantic model
    edit_denied_msg: str       # 403 訊息
    delete_denied_msg: str     # 403 訊息


def _upload_dir() -> Path:
    # 每次呼叫才取 STATIC_DIR（測試會 monkeypatch 此模組的 STATIC_DIR）
    return Path(STATIC_DIR) / "uploads"


def _form_text(form, field: str) -> str | None:
    """讀取表單文字欄位，拒絕以檔案物件冒充文字而造成 500。"""
    value = form.get(field)
    if value is None:
        return None
    if not isinstance(value, str):
        raise HTTPException(400, f"「{_FIELD_LABELS.get(field, field)}」欄位格式錯誤")
    return value


def _read_upload(file: UploadFile) -> tuple[bytes, str, str]:
    """讀取並驗證可替換的檔案，避免超過大小或副檔名白名單。"""
    data = file.file.read(MAX_SIZE + 1)
    if len(data) == 0:
        raise HTTPException(400, "空檔案不可上傳")
    if len(data) > MAX_SIZE:
        raise HTTPException(400, "單檔上限 20MB")
    safe = safe_download_name(file.filename or "file")
    ext = Path(safe).suffix.lower()
    if ext not in DOCUMENT_UPLOAD_EXTS:
        raise HTTPException(400, f"不支援的檔案格式 {ext}，僅允許 PDF/PNG/JPG/GIF/WebP")
    return data, safe, (file.content_type or "").strip()[:120]


def _read_and_prepare(file: UploadFile):
    """讀檔 + 驗證 + 產生預覽（交易外、threadpool 執行）。

    回傳 (data, safe, mime, prepared)；錯誤以 HTTPException 物件回傳而非拋出，
    讓呼叫端在 404/403 檢查之後才拋，維持原本的錯誤優先順序。
    """
    try:
        data, safe, mime = _read_upload(file)
        return data, safe, mime, prepare_media(data, safe)
    except HTTPException as exc:
        return exc
    except ValueError as exc:
        return HTTPException(400, str(exc))


def _row_to_out(row, capabilities: dict) -> dict:
    """將 DB row 與後端計算的 final capabilities 轉為 API 回傳格式。"""
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
        "can_edit": capabilities["can_edit"],
        "can_delete": capabilities["can_delete"],
    }


def _precheck_update(res: UploadResource, rid: int, user: dict) -> None:
    """編輯的便宜預先檢查（不開交易、不寫入）：不存在 404、無編輯範圍 403。

    僅為效能上的提早拒絕；_apply_update 在 BEGIN IMMEDIATE 內仍會重新檢查（權威結果）。
    """
    conn = get_db()
    try:
        row = conn.execute(f"SELECT * FROM {res.table} WHERE id=?", (rid,)).fetchone()
        if row is None:
            raise HTTPException(404, "報表不存在")
        if not res.capabilities(conn, row, user)["can_edit"]:
            raise HTTPException(403, res.edit_denied_msg)
    finally:
        conn.close()


def _apply_update(res: UploadResource, rid: int, user: dict, report_date, uploader_name, note, upload):
    """編輯的同步主體（threadpool 執行）；upload 為 _read_and_prepare 結果或 None。"""
    conn = get_db()
    new_asset = None
    old_asset = None
    old_fallback = None
    committed = False
    try:
        # 先鎖定寫入交易，避免兩個替換同時讀到同一個舊 asset 而留下孤兒檔。
        # asset 的 DB 對映在同一交易內切換；檔案本體則在 commit 後 finalize。
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute(f"SELECT * FROM {res.table} WHERE id=?", (rid,)).fetchone()
        if row is None:
            raise HTTPException(404, "報表不存在")
        capabilities = res.capabilities(conn, row, user)
        if not capabilities["can_edit"]:
            raise HTTPException(403, res.edit_denied_msg)
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

        old_asset = get_owner_asset(conn, res.asset_key, res.asset_key, rid)
        if not old_asset and row["stored_path"]:
            try:
                old_fallback = safe_upload_path(row["stored_path"], upload_dir=_upload_dir())
            except (FileNotFoundError, TypeError, ValueError):
                old_fallback = None

        update_fields = ["report_date=?", "uploader_name=?", "note=?"]
        update_values = [report_date, uploader_name, note]
        if upload is not None:
            if isinstance(upload, HTTPException):
                raise upload
            data, safe, mime, prepared = upload
            ym = report_date[:7]
            stored = f"{res.storage_dir}/{ym}/{rid}_{uuid.uuid4().hex[:8]}_{safe}"
            new_asset = store_asset(
                conn, category=res.asset_key, owner_type=res.asset_key, owner_id=rid,
                data=data, original_name=safe, mime_type=mime, year_month=ym,
                legacy_original_path=stored, upload_dir=_upload_dir(),
                prepared=prepared,
            )
            update_fields.extend(["file_name=?", "stored_path=?", "file_size=?", "mime_type=?"])
            update_values.extend([safe, new_asset.original_path, len(data), new_asset.mime_type])
        conn.execute(
            f"UPDATE {res.table} SET {', '.join(update_fields)} WHERE id=?",
            (*update_values, rid),
        )
        if old_asset and new_asset:
            conn.execute("DELETE FROM file_assets WHERE asset_id=?", (old_asset["asset_id"],))
        conn.commit()
        committed = True
        if new_asset:
            try:
                finalize_asset_paths(new_asset, upload_dir=_upload_dir())
                if old_asset:
                    delete_asset_files(old_asset, upload_dir=_upload_dir())
                elif old_fallback:
                    old_fallback.unlink(missing_ok=True)
            except OSError as exc:
                logger.warning("%s舊檔清理失敗 rid=%s: %s", res.label, rid, exc)
        updated = conn.execute(f"SELECT * FROM {res.table} WHERE id=?", (rid,)).fetchone()
        return _row_to_out(updated, res.capabilities(conn, updated, user))
    except HTTPException:
        if not committed:
            conn.rollback()
            if new_asset:
                cleanup_asset_paths(new_asset, upload_dir=_upload_dir())
        raise
    except ValueError as exc:
        if not committed:
            conn.rollback()
            if new_asset:
                cleanup_asset_paths(new_asset, upload_dir=_upload_dir())
        raise HTTPException(400, str(exc)) from exc
    except Exception:
        if not committed:
            conn.rollback()
            if new_asset:
                cleanup_asset_paths(new_asset, upload_dir=_upload_dir())
        raise
    finally:
        conn.close()


def build_upload_router(res: UploadResource) -> APIRouter:
    """依設定建立一組完整的上傳資源端點（路由註冊順序與原本一致）。"""
    router = APIRouter()
    prefix = res.url_prefix
    key = res.asset_key

    @router.post(prefix, name=f"upload_{key}")
    def upload(
        report_date: str = Form(...),
        uploader_name: str = Form(...),
        note: str = Form(""),
        file: UploadFile = File(...),
        user: dict = Depends(res.upload_dependency),
    ):
        """上傳（multipart），支援任意格式，單檔上限 20MB。"""
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
        data, safe, mime = _read_upload(file)
        try:
            # 2026-09：影像處理在 INSERT（隱式開交易）之前完成，不佔 SQLite 寫鎖
            prepared = prepare_media(data, safe)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc

        conn = get_db()
        asset = None
        try:
            cur = conn.execute(
                f"INSERT INTO {res.table}(report_date, uploader_user_id, uploader_name, file_name, stored_path, file_size, mime_type, note) VALUES(?,?,?,?,?,?,?,?)",
                (report_date, user["id"], uploader_name, safe, "", len(data), mime, note),
            )
            rid = cur.lastrowid
            ym = report_date[:7]
            stored = f"{res.storage_dir}/{ym}/{rid}_{uuid.uuid4().hex[:8]}_{safe}"
            asset = store_asset(
                conn,
                category=key,
                owner_type=key,
                owner_id=rid,
                data=data,
                original_name=safe,
                mime_type=mime,
                year_month=ym,
                legacy_original_path=stored,
                upload_dir=_upload_dir(),
                prepared=prepared,
            )
            conn.execute(
                f"UPDATE {res.table} SET stored_path=?, mime_type=? WHERE id=?",
                (asset.original_path, asset.mime_type, rid),
            )
            conn.commit()
            finalize_asset_paths(asset, upload_dir=_upload_dir())
            row = conn.execute(f"SELECT * FROM {res.table} WHERE id=?", (rid,)).fetchone()
            return _row_to_out(row, res.capabilities(conn, row, user))
        except HTTPException:
            conn.rollback()
            if asset:
                cleanup_asset_paths(asset, upload_dir=_upload_dir())
            raise
        except ValueError as exc:
            conn.rollback()
            if asset:
                cleanup_asset_paths(asset, upload_dir=_upload_dir())
            raise HTTPException(400, str(exc)) from exc
        except Exception:
            conn.rollback()
            if asset:
                cleanup_asset_paths(asset, upload_dir=_upload_dir())
            raise
        finally:
            conn.close()

    @router.get(f"{prefix}/kpi", name=f"{key}_kpi")
    def kpi(
        month: str = Query("", description="YYYY-MM，預設本月"),
        user: dict = Depends(require_login),
    ):
        """回傳月級 KPI：已歸檔日數、缺檔日、歸檔率。
        缺檔日 = 該月行事曆有派工但未上傳檔案的日期。
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
            # 已上傳的日期
            report_rows = conn.execute(
                f"SELECT DISTINCT report_date FROM {res.table} WHERE report_date LIKE ?",
                (month + "%",),
            ).fetchall()
            archived_dates = set(r["report_date"] for r in report_rows)
            archived = len(archived_dates)
            # 缺檔日 = 行事曆有派工但未上傳的日期
            missing_dates = appointment_dates - archived_dates
            missing = len(missing_dates)
            total = len(appointment_dates)
            rate = round(archived / total * 100) if total > 0 else 0
            return {"month": month, "archived": archived, "missing": missing, "rate": rate, "total": total}
        finally:
            conn.close()

    @router.get(prefix, name=f"list_{key}")
    def list_items(
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
            total = conn.execute(f"SELECT COUNT(*) FROM {res.table} {sql_where}", params).fetchone()[0]
            rows = conn.execute(
                f"SELECT * FROM {res.table} {sql_where} ORDER BY report_date DESC, id DESC LIMIT ? OFFSET ?",
                (*params, page_size, (page - 1) * page_size),
            ).fetchall()
            items = []
            for r in rows:
                items.append(_row_to_out(r, res.capabilities(conn, r, user)))
            return {"items": items, "total": total, "page": page, "page_size": page_size}
        finally:
            conn.close()

    @router.patch(f"{prefix}/{{rid}}", name=f"update_{key}")
    async def update(
        rid: int,
        request: Request,
        user: dict = Depends(require_login),
    ):
        """編輯日期、檔案、上傳人與備註（上傳者或具全域管理權限者）。

        ``uploader_name`` 只是可修正的顯示文字；``uploader_user_id`` 永不改寫，
        因此編輯上傳人不會轉移權限 owner。替換檔案採「先提交 DB、
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
                payload = res.update_model.model_validate(await request.json())
            except Exception as exc:
                raise HTTPException(422, "編輯資料格式錯誤") from exc
            report_date = payload.report_date
            uploader_name = payload.uploader_name
            note = payload.note
        # 2026-09：async handler 只做非同步讀取；讀檔/影像處理/SQLite 交易一律丟 threadpool，
        # 否則會卡住 event loop（處理期間全站所有請求停住）。
        # 先做便宜的存在/權限檢查，404/403 不先付出讀檔與影像處理成本；交易內仍會權威重驗。
        await run_in_threadpool(_precheck_update, res, rid, user)
        upload = await run_in_threadpool(_read_and_prepare, file) if file is not None else None
        return await run_in_threadpool(_apply_update, res, rid, user, report_date, uploader_name, note, upload)

    @router.get(f"{prefix}/{{rid}}/preview", name=f"preview_{key}")
    def preview(rid: int, user: dict = Depends(require_login)):
        """線上預覽：圖片走壓縮 preview，PDF 保持原始檔。"""
        if user is None:
            raise HTTPException(401, "未登入")
        conn = get_db()
        try:
            row = conn.execute(
                f"SELECT id, stored_path, file_name, mime_type FROM {res.table} WHERE id=?", (rid,)
            ).fetchone()
            if row is None:
                raise HTTPException(404, "報表不存在")
            upload_dir = _upload_dir()
            asset = get_owner_asset(conn, key, key, rid)
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

    @router.get(f"{prefix}/{{rid}}/download", name=f"download_{key}")
    def download(rid: int, user: dict = Depends(require_login)):
        """下載原檔（attachment）。"""
        if user is None:
            raise HTTPException(401, "未登入")
        conn = get_db()
        try:
            row = conn.execute(f"SELECT stored_path, file_name FROM {res.table} WHERE id=?", (rid,)).fetchone()
            if row is None:
                raise HTTPException(404, "報表不存在")
            try:
                path = safe_upload_path(row["stored_path"], upload_dir=_upload_dir())
            except (FileNotFoundError, TypeError, ValueError):
                raise HTTPException(404, "檔案不存在")
            if not path.exists():
                raise HTTPException(404, "檔案遺失")
            # FileResponse handles non-ASCII filenames with RFC 5987 encoding.
            return FileResponse(path, filename=row["file_name"], content_disposition_type="attachment")
        finally:
            conn.close()

    @router.delete(f"{prefix}/{{rid}}", name=f"delete_{key}")
    def delete(rid: int, user: dict = Depends(require_login)):
        """刪除資料列、original 與所有媒體變體。"""
        if user is None:
            raise HTTPException(401, "未登入")
        conn = get_db()
        try:
            row = conn.execute(
                f"SELECT uploader_user_id, stored_path FROM {res.table} WHERE id=?", (rid,)
            ).fetchone()
            if row is None:
                raise HTTPException(404, "報表不存在")
            capabilities = res.capabilities(conn, row, user)
            if not capabilities["can_delete"]:
                raise HTTPException(403, res.delete_denied_msg)
            asset = get_owner_asset(conn, key, key, rid)
            fallback = None
            if row["stored_path"]:
                try:
                    fallback = safe_upload_path(row["stored_path"], upload_dir=_upload_dir())
                except (FileNotFoundError, TypeError, ValueError):
                    fallback = None
            conn.execute(f"DELETE FROM {res.table} WHERE id=?", (rid,))
            if asset:
                conn.execute("DELETE FROM file_assets WHERE asset_id=?", (asset["asset_id"],))
            conn.commit()
            if asset:
                delete_asset_files(asset, upload_dir=_upload_dir())
            elif fallback:
                try:
                    fallback.unlink(missing_ok=True)
                except OSError:
                    pass
            return {"ok": True}
        finally:
            conn.close()

    return router
