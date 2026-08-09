# -*- coding: utf-8 -*-
"""
振佳空調庫存管理系統 - 後端入口
================================
技術：FastAPI + SQLite（單檔資料庫，免安裝）

拆分架構（v8 起）：
    main.py               → 入口：建立 app、掛載 router（本檔）
    app/config.py         → 路徑設定
    app/database.py       → 資料庫連線 + schema + migration
    app/models.py         → Pydantic 請求模型
    app/routes/*.py       → 各功能 API（items/stockout/kits/stocktake/stats/export）
    app/services/         → 預留業務邏輯層（權限/序號/保固等未來擴充）

啟動：.venv/Scripts/python.exe -m uvicorn main:app --host 0.0.0.0 --port 8000
"""
import datetime
import os

from fastapi import FastAPI
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from app.config import STATIC_DIR, UPLOAD_DIR
from app.database import get_db, init_db
from app.routes import export, items, kits, lookup, photos, stats, stockout, stocktake

app = FastAPI(title="振佳空調庫存管理系統", version="8.0.0")

init_db()


# ---------- 健康檢查 ----------
@app.get("/health")
def health():
    """健康檢查：回傳服務狀態與目前時間"""
    return {"status": "ok", "time": datetime.datetime.now().isoformat()}


# ---------- 掛載各功能路由 ----------
app.include_router(items.router)
app.include_router(stockout.router)
app.include_router(kits.router)
app.include_router(stocktake.router)
app.include_router(stats.router)
app.include_router(export.router)
app.include_router(photos.router)
app.include_router(lookup.router)


# ---------- 靜態檔案（前端） ----------
@app.get("/")
def index():
    """回傳前端 index.html；不存在時回傳提示 HTML"""
    idx = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(idx):
        return FileResponse(idx)
    return Response("<h1>庫存系統 API</h1><p>前端尚未建立，請先將 index.html 放到 static/</p>", media_type="text/html")


# 掛載靜態目錄（放在最後，避免吃掉 API 路由）
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
