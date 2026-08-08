# -*- coding: utf-8 -*-
"""
路徑與環境設定
==============
集中管理所有路徑常數，避免各模組重複計算。
"""
import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(BASE_DIR, "inventory.db")
STATIC_DIR = os.path.join(BASE_DIR, "static")
EXPORT_DIR = os.path.join(BASE_DIR, "exports")

os.makedirs(STATIC_DIR, exist_ok=True)
os.makedirs(EXPORT_DIR, exist_ok=True)
