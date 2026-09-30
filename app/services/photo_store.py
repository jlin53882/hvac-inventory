# -*- coding: utf-8 -*-
"""
品項照片 legacy preview 路徑與目錄快取
======================================
原本放在 routes/photos.py，導致 items / kits / stockout 三個 route 反過來 import 另一個 route
（甚至碰私有名稱 _photo_path）。抽到 services 層後，routes 一律只依賴 services。

新照片由 file_storage 統一保存；legacy URL /uploads/<item_id>.jpg 仍指向 800px preview。
"""
import os
import re

import app.config as app_config


def legacy_photo_path(item_id: int) -> str:
    """舊相容 URL 對應的 preview 路徑。"""
    return os.path.join(app_config.UPLOAD_DIR, f"{item_id}.jpg")


# legacy preview id 快取：key = (UPLOAD_DIR, 目錄 mtime_ns)。新增/刪除/改名檔案會改變目錄 mtime，
# 照片上傳/刪除 route 另外主動 invalidate，避免同一 mtime tick 內的變動漏更新。
# 整個 tuple 一次指派（不原地修改），讀端拿到的永遠是完整快照，不需要鎖。
_photo_ids_cache: tuple | None = None


def invalidate_photo_ids_cache() -> None:
    """照片新增/刪除後呼叫，強制下次 list_photo_ids 重掃目錄。"""
    global _photo_ids_cache
    _photo_ids_cache = None


def has_photo(item_id: int) -> bool:
    """檢查品項是否有照片；保留舊檔案相容性（走目錄快取，不逐筆 stat）。"""
    return int(item_id) in list_photo_ids()


def list_photo_ids() -> set:
    """回傳有 legacy preview 的品項 id；目錄未變動時直接用快取（2026-09 效能：原本每次請求 listdir）。"""
    global _photo_ids_cache
    upload_dir = app_config.UPLOAD_DIR
    try:
        mtime = os.stat(upload_dir).st_mtime_ns
    except OSError:
        return set()
    cached = _photo_ids_cache
    if cached is not None and cached[0] == upload_dir and cached[1] == mtime:
        return cached[2]
    try:
        ids = frozenset(
            int(f.split(".")[0])
            for f in os.listdir(upload_dir)
            if re.fullmatch(r"[0-9]+\.jpg", f)
        )
    except OSError:
        return set()
    _photo_ids_cache = (upload_dir, mtime, ids)
    return ids
