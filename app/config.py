# -*- coding: utf-8 -*-
"""
路徑與環境設定
==============
集中管理所有路徑常數，避免各模組重複計算。
"""
import os

# 專案根目錄
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# SQLite 資料庫檔路徑
DB_PATH = os.path.join(BASE_DIR, "inventory.db")
# 前端靜態資源目錄
STATIC_DIR = os.path.join(BASE_DIR, "static")
UPLOAD_DIR = os.path.join(STATIC_DIR, "uploads")  # 品項照片（檔名 = <item_id>.jpg）— 維持原位置，僅 /static/uploads 對外封鎖

os.makedirs(STATIC_DIR, exist_ok=True)
os.makedirs(UPLOAD_DIR, exist_ok=True)
