# -*- coding: utf-8 -*-
"""
庫存管理系統 - 後端入口
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
import re

from fastapi import Depends, FastAPI
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from app.config import STATIC_DIR, UPLOAD_DIR
from app.database import get_db, init_db
from app.routes import auth, export, items, kits, lookup, photos, stats, stockout, stocktake, users
from app.services.auth import init_admin_if_missing, require_login

app = FastAPI(title="庫存管理系統", version="8.0.0")
# ---------- 快取策略（避免瀏覽器快取舊版 HTML/JS） ----------
@app.middleware("http")
async def cache_control_middleware(request, call_next):
    """HTML 每次重新驗證（no-cache）；static 資源短快取（配合 ?v=N 版本參數）"""
    response = await call_next(request)
    path = request.url.path
    if path in ("/", "/login.html"):
        # HTML：每次都要重新驗證，確保拿到最新 ?v=N 引用
        response.headers["Cache-Control"] = "no-cache, must-revalidate"
    elif path.startswith("/static/"):
        # JS/CSS：快取 1 小時；內容更新靠版本參數（?v=12）換 URL
        response.headers["Cache-Control"] = "public, max-age=3600"
    return response



init_db()

# 首次啟動建立 admin（已存在則跳過）
_conn = get_db()
try:
    init_admin_if_missing(_conn)
finally:
    _conn.close()


# ---------- 健康檢查 ----------
@app.get("/health")
def health():
    """健康檢查：回傳服務狀態與目前時間"""
    return {"status": "ok", "time": datetime.datetime.now().isoformat()}


# ---------- 掛載各功能路由 ----------
# auth：不需全域鎖（login 公開；me/logout 內部自行驗證）
app.include_router(auth.router)

# 其餘全部上鎖：未登入一律 401
for _r in (items.router, stockout.router, kits.router, stocktake.router,
           stats.router, export.router, photos.router, lookup.router, users.router):
    app.include_router(_r, dependencies=[Depends(require_login)])


# ---------- 靜態檔案（前端） ----------
_STATIC_RE = re.compile(r'(/static/[^"\'? >]+?)(\?v=[^"\' >]*)?(?=["\' >])')

def _versioned_html(path: str) -> Response:
    """回傳 HTML，並把 static 資源的 ?v=N 版本參數動態換成「檔案 mtime」。

    方案 A（自動版本號）：開發者改 JS/CSS 存檔後，mtime 變 → 版本號自動變，
    瀏覽器看到新 URL 就會重新下載，不再需要手動改 ?v=13 → ?v=14。
    多 PR 並行也不衝突：每個資源獨立算自己的 mtime。
    """
    with open(path, encoding="utf-8") as fh:
        html = fh.read()

    def _swap(m):
        url = m.group(1)                      # /static/js/app.js
        fp = os.path.join(STATIC_DIR, url[len("/static/"):])
        if os.path.exists(fp):
            return f"{url}?v={int(os.path.getmtime(fp))}"
        return m.group(0)                     # 檔案不存在（不該發生）→ 原樣保留

    html = _STATIC_RE.sub(_swap, html)
    return Response(html, media_type="text/html")


@app.get("/")
def index():
    """回傳前端 index.html（static 資源版本號自動化）；不存在時回傳提示 HTML"""
    idx = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(idx):
        return _versioned_html(idx)
    return Response("<h1>庫存系統 API</h1><p>前端尚未建立，請先將 index.html 放到 static/</p>", media_type="text/html")


@app.get("/login.html")
def login_page():
    """登入頁（static 資源版本號自動化）"""
    idx = os.path.join(STATIC_DIR, "login.html")
    if os.path.exists(idx):
        return _versioned_html(idx)
    return Response("<h1>登入頁不存在</h1>", media_type="text/html")


# 掛載靜態目錄（放在最後，避免吃掉 API 路由）
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
