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

from fastapi import Depends, APIRouter, HTTPException, UploadFile

import app.config as app_config
from app.database import db_session, get_db
from app.services.auth import require_perm
from app.services.file_storage import (
    cleanup_asset_paths,
    delete_asset_files,
    finalize_asset_paths,
    get_owner_asset,
    prepare_media,
    store_asset,
)
from app.services.photo_store import invalidate_photo_ids_cache, legacy_photo_path
from app.services.upload_policy import IMAGE_UPLOAD_EXTS, ITEM_PHOTO_MAX_BYTES

router = APIRouter()


def _photo_asset(conn, item_id: int):
    return get_owner_asset(conn, "item_photo", "item", item_id)


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
        if ext not in IMAGE_UPLOAD_EXTS:
            raise HTTPException(400, f"不支援的圖片格式：{ext}（限 jpg/png/webp）")
        data = file.file.read(ITEM_PHOTO_MAX_BYTES + 1)
        if len(data) > ITEM_PHOTO_MAX_BYTES:
            raise HTTPException(400, "圖片超過 10MB 上限")
        if not data:
            raise HTTPException(400, "空檔案")
        try:
            # 2026-09：縮圖在 BEGIN IMMEDIATE 之前完成，不佔 SQLite 寫鎖
            prepared = prepare_media(data, original_name)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc

        conn.execute("BEGIN IMMEDIATE")
        old = _photo_asset(conn, item_id)
        if old:
            # Partial unique index requires the old metadata row to leave the
            # transaction before the replacement row is inserted.
            conn.execute("DELETE FROM file_assets WHERE asset_id=?", (old["asset_id"],))
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
                prepared=prepared,
            )
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc

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
        invalidate_photo_ids_cache()


@router.delete("/api/items/{item_id}/photo", dependencies=[Depends(require_perm("photo"))])
def delete_photo(item_id: int):
    """刪除照片與所有變體（冪等）。"""
    rows = []
    with db_session() as conn:
        rows = conn.execute(
            "SELECT * FROM file_assets WHERE category=? AND owner_type=? AND owner_id=?",
            ("item_photo", "item", str(item_id)),
        ).fetchall()
        conn.execute(
            "DELETE FROM file_assets WHERE category=? AND owner_type=? AND owner_id=?",
            ("item_photo", "item", str(item_id)),
        )
        conn.commit()
    for row in rows:
        delete_asset_files(row, upload_dir=app_config.UPLOAD_DIR)
    # 舊版本沒有 metadata，仍清理 legacy preview。
    try:
        os.remove(legacy_photo_path(item_id))
    except FileNotFoundError:
        pass
    except OSError:
        raise HTTPException(500, "圖片刪除失敗")
    invalidate_photo_ids_cache()
    return {"ok": True, "deleted": item_id}


# ========== 整組照片（新增於 2026-09-27） ==========

@router.post("/api/kits/{kit_id}/photo", status_code=200, dependencies=[Depends(require_perm("photo"))])
def upload_kit_photo(kit_id: int, file: UploadFile):
    """上傳/覆蓋整組照片；同品項照片邏輯（asset + preview + thumbnail）。"""
    conn = get_db()
    asset = None
    try:
        # 確認整組品項（以整組的 item_id 作為照片所有者）
        row = conn.execute(
            "SELECT item_id FROM kits WHERE id=?", (kit_id,)
        ).fetchone()
        if not row:
            raise HTTPException(404, "整組不存在")
        
        item_id = row["item_id"]
        original_name = file.filename or "kit_photo.jpg"
        ext = os.path.splitext(original_name)[1].lower()
        if ext not in IMAGE_UPLOAD_EXTS:
            raise HTTPException(400, f"不支援的圖片格式：{ext}（限 jpg/png/webp）")
        data = file.file.read(ITEM_PHOTO_MAX_BYTES + 1)
        if len(data) > ITEM_PHOTO_MAX_BYTES:
            raise HTTPException(400, "圖片超過 10MB 上限")
        if not data:
            raise HTTPException(400, "空檔案")
        try:
            prepared = prepare_media(data, original_name)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc

        conn.execute("BEGIN IMMEDIATE")
        old = _photo_asset(conn, item_id)
        if old:
            conn.execute("DELETE FROM file_assets WHERE asset_id=?", (old["asset_id"],))
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
                prepared=prepared,
            )
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc

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
            "kit_id": kit_id,
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
        invalidate_photo_ids_cache()


@router.delete("/api/kits/{kit_id}/photo", dependencies=[Depends(require_perm("photo"))])
def delete_kit_photo(kit_id: int):
    """刪除整組照片。"""
    with db_session() as conn:
        try:
            row = conn.execute(
                "SELECT item_id FROM kits WHERE id=?", (kit_id,)
            ).fetchone()
            if not row:
                raise HTTPException(404, "整組不存在")
        
            item_id = row["item_id"]
            rows = conn.execute(
                "DELETE FROM file_assets WHERE category=? AND owner_type=? AND owner_id=? RETURNING asset_id, original_path, preview_path, thumbnail_path",
                ("item_photo", "item", str(item_id)),
            ).fetchall()
            conn.commit()
        except HTTPException:
            conn.rollback()
            raise
        except Exception:
            conn.rollback()
            raise
    for row in rows:
        delete_asset_files(row, upload_dir=app_config.UPLOAD_DIR)
    # 舊版本沒有 metadata，仍清理 legacy preview。
    try:
        os.remove(legacy_photo_path(item_id))
    except FileNotFoundError:
        pass
    except OSError:
        raise HTTPException(500, "圖片刪除失敗")
    invalidate_photo_ids_cache()
    return {"ok": True, "deleted": kit_id}
