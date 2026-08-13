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

from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

import app.config as app_config
from app.config import STATIC_DIR
from app.database import get_db, init_db
from app.routes import appointments, auth, export, items, kits, lookup, photos, stats, stockout, stocktake, users
from app.services.auth import init_admin_if_missing, require_login

# FastAPI 主應用實例（掛載全部路由 + 統一登入保護）
app = FastAPI(title="庫存管理系統", version="11.0.0")
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


# M21：CSRF 防護——跨站寫入請求（帶 Origin/Referer 且與 Host 不符）→ 403
@app.middleware("http")
async def csrf_origin_middleware(request, call_next):
    """瀏覽器跨站寫入請求必帶 Origin（或 Referer）；與 Host 不符 → 403。
    同源 / 無來源（curl、同源表單）放行。"""
    if request.method in ("POST", "PUT", "PATCH", "DELETE"):
        from urllib.parse import urlparse
        host = request.headers.get("host", "")
        origin = request.headers.get("origin", "")
        referer = request.headers.get("referer", "")
        for src in (origin, referer):
            if src:
                netloc = urlparse(src).netloc
                if netloc and netloc != host:
                    return Response("Forbidden: cross-origin request", status_code=403)
    return await call_next(request)


# B6：安全 headers（防 clickjacking / MIME sniffing / XSS 外傳資料）
@app.middleware("http")
async def security_headers_middleware(request, call_next):
    """回傳附加安全 headers；CSP 保留 'unsafe-inline' 相容既有 inline handler 架構，
    但限制資源來源為同源（擋外部 script 注入與 XSS 外傳連線）"""
    response = await call_next(request)
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline'; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data:; "
        "connect-src 'self'; "
        "frame-ancestors 'none'; "
        "base-uri 'self'; "
        "form-action 'self'"
    )
    return response



init_db()

# 首次啟動建立 admin（已存在則跳過）
# 模組層共用的 DB connection
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
           stats.router, export.router, photos.router, lookup.router, users.router,
           appointments.router):
    app.include_router(_r, dependencies=[Depends(require_login)])


# ---------- 靜態檔案（前端） ----------
# static 資源 URL regex（_versioned_html 版本化用）
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
        """re.sub 替換 callback：static 資源 URL 換成帶 ?v=mtime 版本參數；檔案不存在則原樣保留"""
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


@app.get("/permissions.html")
def permissions_page():
    """帳號與權限頁（RBAC 2026-08-13；static 資源版本號自動化）"""
    idx = os.path.join(STATIC_DIR, "permissions.html")
    if os.path.exists(idx):
        return _versioned_html(idx)
    return Response("<h1>權限頁不存在</h1>", media_type="text/html")


# 掛載靜態目錄（放在最後，避免吃掉 API 路由）
# B1：照片維持在 static/uploads（原本位置），但 /static/uploads/* 一律 404 封鎖公開讀取；
#     登入者改走 /uploads/<id>.jpg（見下方 read_photo）
def _is_upload_path(path: str) -> bool:
    """判定是否為照片路徑（一律封鎖公開讀取）。
    StaticFiles.get_path 回傳的是檔案系統相對路徑（Windows 為反斜線），
    且 Mount 前綴資訊在 root_path —— 統一轉正斜線後比對兩種開頭。"""
    p = path.replace("\\", "/").lstrip("/").lower()  # 2026-08-12 補 lower：Windows 檔名不分大小寫，防 /static/UPLOADS/ 繞過
    return p.startswith("uploads/") or p.startswith("static/uploads/")


class _StaticWithoutUploads(StaticFiles):
    """static/uploads/ 下的照片不對外提供（改由需登入的 /uploads/ endpoint 讀取）"""
    async def get_response(self, path, scope):
        """覆寫 StaticFiles.get_response：uploads 照片路徑一律 404（公開讀取封鎖），其餘正常回傳"""
        if _is_upload_path(path):
            raise HTTPException(status_code=404, detail="找不到照片")
        return await super().get_response(path, scope)


app.mount("/static", _StaticWithoutUploads(directory=STATIC_DIR), name="static")


# B1：品項照片改為需登入才可讀（不再掛公開 StaticFiles）
# 只允許 <item_id>.jpg（檔名白名單 regex 防路徑穿越 / 防任意檔案讀取）
@app.get("/uploads/{filename}")
def read_photo(filename: str, user: dict = Depends(require_login)):
    """回傳品項照片（僅登入者可讀）；僅接受 <數字>.jpg 格式"""
    if not re.fullmatch(r"\d+\.jpg", filename):
        raise HTTPException(status_code=404, detail="找不到照片")
    path = os.path.join(app_config.UPLOAD_DIR, filename)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="找不到照片")
    return FileResponse(path, media_type="image/jpeg")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
