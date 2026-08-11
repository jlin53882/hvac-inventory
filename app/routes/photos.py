# -*- coding: utf-8 -*-
"""
品項照片路由（Todo 5 / v10.1）
================================
- POST   /api/items/{item_id}/photo   上傳/覆蓋品項照片（自動壓縮到 300px 寬）
- DELETE /api/items/{item_id}/photo   刪除品項照片
- GET    /uploads/<item_id>.jpg        靜態讀取（由 main.py 掛載 StaticFiles）

儲存設計：static/uploads/<item_id>.jpg（檔名 = 品項 id）
  → DB schema 零變更、遷移零成本；搬主機時複製 uploads/ 目錄即可。
  → 壓縮在「上傳當下」做一次（300px 寬 JPEG q=80），前端讀取永遠是輕檔案。

效能（家豪要求避免圖片過多卡頓）：
  - 上傳時壓縮（Pillow）→ 檔案小，靜態讀取快
  - 前端用 IntersectionObserver 懶加載 + 瀏覽器快取（static 不變名，304 快取）
  - 並發：FastAPI sync endpoint 跑在執行緒池，多圖片上傳不會互相阻塞
"""
import io
import os
import uuid

from fastapi import APIRouter, HTTPException, UploadFile
from PIL import Image

import app.config as app_config  # 動態取值：測試可 monkeypatch
from app.database import get_db

# 照片 API 路由
router = APIRouter()

# 允許的圖片副檔名
ALLOWED_EXT = {".jpg", ".jpeg", ".png", ".webp"}
MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 原始檔上限 10MB（壓縮後約 30-80KB）
THUMB_WIDTH = 800  # 壓縮寬度 px（卡片顯示 52px 縮圖，點開 lightbox 看 800px 大圖）


def _photo_path(item_id: int) -> str:
    """產生照片檔路徑：uploads/<item_id>.jpg（一律 jpg 統一格式）"""
    return os.path.join(app_config.UPLOAD_DIR, f"{item_id}.jpg")


def has_photo(item_id: int) -> bool:
    """檢查品項是否有照片（供 _item_full 補 has_photo 欄位）"""
    return os.path.exists(_photo_path(item_id))


def _compress_and_save(img: Image.Image, dest: str) -> None:
    """壓縮圖片（300px 寬、JPEG q=80）並存檔；EXIF 翻正後儲存"""
    img = img.convert("RGB")
    w, h = img.size
    if w > THUMB_WIDTH:
        img = img.resize((THUMB_WIDTH, int(h * THUMB_WIDTH / w)), Image.LANCZOS)
    img.save(dest, "JPEG", quality=80, optimize=True)


@router.post("/api/items/{item_id}/photo", status_code=200)
def upload_photo(item_id: int, file: UploadFile):
    """上傳/覆蓋品項照片。壓縮後存 uploads/<item_id>.jpg（無庫存也能建照片？不——物品須存在）"""
    conn = get_db()
    row = conn.execute("SELECT id FROM items WHERE id=?", (item_id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "品項不存在")

    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext and ext not in ALLOWED_EXT:
        raise HTTPException(400, f"不支援的圖片格式：{ext}（限 jpg/png/webp）")

    data = file.file.read(MAX_UPLOAD_BYTES + 1)  # 多讀 1 byte 偵測超限
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(400, "圖片超過 10MB 上限")
    if not data:
        raise HTTPException(400, "空檔案")

    try:
        img = Image.open(io.BytesIO(data))
        img.load()  # 觸發解碼，壞檔會在這裡炸
    except Exception:
        raise HTTPException(400, "無法解析圖片（可能是損毀或非圖片檔）")

    dest = _photo_path(item_id)
    tmp = dest + f".tmp-{uuid.uuid4().hex[:6]}"
    try:
        _compress_and_save(img, tmp)
        os.replace(tmp, dest)  # 原子覆蓋：即使並發上傳也只會有一份
    except Exception:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise HTTPException(500, "圖片儲存失敗")
    return {"ok": True, "item_id": item_id, "photo": f"/uploads/{item_id}.jpg"}


@router.delete("/api/items/{item_id}/photo")
def delete_photo(item_id: int):
    """刪除品項照片（檔案不存在也算成功——冪等）"""
    dest = _photo_path(item_id)
    if os.path.exists(dest):
        os.remove(dest)
    return {"ok": True, "deleted": item_id}