# -*- coding: utf-8 -*-
"""
品項照片路由
============
- POST   /api/items/{item_id}/photo   上傳/覆蓋品項照片
- DELETE /api/items/{item_id}/photo   刪除品項照片
- GET    /uploads/<item_id>.jpg        舊 URL 相容，回傳 preview

新照片由 file_storage 統一保存：原始檔保留在 asset 目錄，legacy URL
仍指向 800px JPEG preview，並另外建立 320px thumbnail 供列表使用。
"""
import os
import re

from fastapi import Depends, APIRouter, HTTPException, UploadFile

import app.config as app_config
from app.database import get_db
from app.services.auth import require_perm
from app.services.file_storage import (
    cleanup_asset_paths,
    delete_asset_files,
    finalize_asset_paths,
    get_owner_asset,
    store_asset,
)

router = APIRouter()

ALLOWED_EXT = {".jpg", ".jpeg", ".png", ".webp"}
MAX_UPLOAD_BYTES = 10 * 1024 * 1024


def _photo_path(item_id: int) -> str:
    """舊相容 URL 對應的 preview 路徑。"""
    return os.path.join(app_config.UPLOAD_DIR, f"{item_id}.jpg")


def _photo_asset(conn, item_id: int):
    return get_owner_asset(conn, "item_photo", "item", item_id)


def has_photo(item_id: int) -> bool:
    """檢查品項是否有照片；保留舊檔案相容性。"""
    return os.path.exists(_photo_path(item_id))


def list_photo_ids() -> set:
    """一次掃描 legacy preview，避免 list_items 對每筆品項 stat。"""
    try:
        return {
            int(f.split(".")[0])
            for f in os.listdir(app_config.UPLOAD_DIR)
            if re.fullmatch(r"[0-9]+\.jpg", f)
        }
    except OSError:
        return set()


@router.post("/api/items/{item_id}/photo", status_code=200, dependencies=[Depends(require_perm("photo"))])
def upload_photo(item_id: int, file: UploadFile):
    """上傳/覆蓋品項照片；原始檔、preview、thumbnail 一起建立。"""
    conn = get_db()
    asset = None
    try:
        row = conn.execute(
            "SELECT id FROM items WHERE id=? AND is_deleted=0", (item_id,)
        ).fetchone()
        if not row:
            raise HTTPException(404, "品項不存在")

        original_name = file.filename or "photo.jpg"
        ext = os.path.splitext(original_name)[1].lower()
        if ext not in ALLOWED_EXT:
            raise HTTPException(400, f"不支援的圖片格式：{ext}（限 jpg/png/webp）")
        data = file.file.read(MAX_UPLOAD_BYTES + 1)
        if len(data) > MAX_UPLOAD_BYTES:
            raise HTTPException(400, "圖片超過 10MB 上限")
        if not data:
            raise HTTPException(400, "空檔案")

        old = _photo_asset(conn, item_id)
        try:
            asset = store_asset(
                conn,
                category="item_photo",
                owner_type="item",
                owner_id=item_id,
                data=data,
                original_name=original_name,
                mime_type=file.content_type or "",
                legacy_preview_path=f"{item_id}.jpg",
            )
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc

        if old and old["asset_id"] != asset.asset_id:
            conn.execute("DELETE FROM file_assets WHERE asset_id=?", (old["asset_id"],))
        conn.commit()
        finalize_asset_paths(asset, upload_dir=app_config.UPLOAD_DIR)
        if old and old["asset_id"] != asset.asset_id:
            delete_asset_files(
                old,
                exclude_paths={asset.preview_path} if asset.preview_path else set(),
                upload_dir=app_config.UPLOAD_DIR,
            )
        return {
            "ok": True,
            "item_id": item_id,
            "asset_id": asset.asset_id,
            "photo": f"/uploads/{item_id}.jpg",
            "preview_url": f"/media/{asset.asset_id}/preview",
            "thumbnail_url": f"/media/{asset.asset_id}/thumbnail",
        }
    except HTTPException:
        conn.rollback()
        if asset:
            cleanup_asset_paths(asset, upload_dir=app_config.UPLOAD_DIR)
        raise
    except Exception as exc:
        conn.rollback()
        if asset:
            cleanup_asset_paths(asset, upload_dir=app_config.UPLOAD_DIR)
        raise HTTPException(500, "圖片儲存失敗") from exc
    finally:
        conn.close()


@router.delete("/api/items/{item_id}/photo", dependencies=[Depends(require_perm("photo"))])
def delete_photo(item_id: int):
    """刪除照片與所有變體（冪等）。"""
    conn = get_db()
    rows = []
    try:
        rows = conn.execute(
            "SELECT * FROM file_assets WHERE category=? AND owner_type=? AND owner_id=?",
            ("item_photo", "item", str(item_id)),
        ).fetchall()
        conn.execute(
            "DELETE FROM file_assets WHERE category=? AND owner_type=? AND owner_id=?",
            ("item_photo", "item", str(item_id)),
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    for row in rows:
        delete_asset_files(row, upload_dir=app_config.UPLOAD_DIR)
    # 舊版本沒有 metadata，仍清理 legacy preview。
    try:
        os.remove(_photo_path(item_id))
    except FileNotFoundError:
        pass
    except OSError:
        raise HTTPException(500, "圖片刪除失敗")
    return {"ok": True, "deleted": item_id}
