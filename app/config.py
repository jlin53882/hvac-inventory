# -*- coding: utf-8 -*-
"""
路徑與環境設定
==============
集中管理所有路徑常數，避免各模組重複計算。
環境變數從 .env 檔案讀取（零套件依賴）。
"""
import os

# ---------- .env 讀取（零套件依賴）----------
def _load_env():
    """讀取 .env 檔案到 os.environ（已存在的環境變數不覆蓋）"""
    env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")
    if not os.path.exists(env_path):
        return
    with open(env_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip()
            if key and key not in os.environ:
                os.environ[key] = value

_load_env()

# ---------- 路徑設定 ----------
# 專案根目錄
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# SQLite 資料庫檔路徑
DB_PATH = os.path.join(BASE_DIR, "inventory.db")
# 前端靜態資源目錄
STATIC_DIR = os.path.join(BASE_DIR, "static")
UPLOAD_DIR = os.path.join(STATIC_DIR, "uploads")  # 品項照片（檔名 = <item_id>.jpg）

os.makedirs(STATIC_DIR, exist_ok=True)
os.makedirs(UPLOAD_DIR, exist_ok=True)

# ---------- Discord Webhook ----------
DISCORD_WEBHOOK_URL = os.environ.get("DISCORD_WEBHOOK_URL", "")
GCAL_SYNC_WEBHOOK_URL = os.environ.get("GCAL_SYNC_WEBHOOK_URL", "")
GCAL_SYNC_THREAD_ID = os.environ.get("GCAL_SYNC_THREAD_ID", "")
