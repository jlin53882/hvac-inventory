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
    app/routes/*.py       → 各功能 API（items/stockout/kits/stocktake/stats/export/quotations）
    app/services/         → 預留業務邏輯層（權限/序號/保固等未來擴充）

啟動：.venv/Scripts/python.exe -m uvicorn main:app --host 0.0.0.0 --port 8000
"""
import datetime
import os
import re
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
import app.config as app_config
from app.config import STATIC_DIR
from app.middleware import BinarySafeGZipMiddleware, cache_control_middleware, csrf_origin_middleware, request_logging_middleware, security_headers_middleware
from app.database import get_db, init_db
from app.routes import appointments, auth, export, items, gcal_keys, kits, lookup, movements, petty_cash, photos, quotations, quotation_uploads, service_types, signed_reports, stats, stockout, stocktake, transfers, users, units, work_progress
from app.services.auth import cleanup_expired, init_admin_if_missing, require_login
from app.services.file_storage import asset_media_type, asset_variant_path, get_asset
from app.services import sync_scheduler
from app.services.app_log import get_logger, setup_logging

logger = get_logger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI):
    """啟動時初始化 DB schema + 首次 admin + 清理過期 session；shutdown 無需清理。
    2026-08-14 移入 lifespan：`import main` 不再觸發 DB 寫入（測試側 database is locked 根治）
    2026-08-15：cleanup_expired 落地（docstring 原聲稱「啟動時與登入時呼叫」但啟動時漏呼叫）"""
    setup_logging()
    logger.info("server startup cwd=%s", os.getcwd())
    init_db()
    _conn = get_db()
    try:
        cleanup_expired(_conn)      # 2026-08-15：啟動時清理過期 session（避免 sessions 表無限增長）
        init_admin_if_missing(_conn)
        sync_scheduler.start()   # worker 一律啟動；無啟用 key 時單輪 no-op
    finally:
        _conn.close()
    yield
    sync_scheduler.stop()
    logger.info("server shutdown")

# FastAPI 主應用實例（掛載全部路由 + 統一登入保護）
app = FastAPI(title="庫存管理系統", version="11.0.0", lifespan=lifespan)
app.add_middleware(BinarySafeGZipMiddleware, minimum_size=1024)

# ---------- HTTP middleware（定義在 app/middleware.py；註冊順序 = cache→csrf→security） ----------
app.middleware("http")(cache_control_middleware)
app.middleware("http")(csrf_origin_middleware)
app.middleware("http")(security_headers_middleware)
app.middleware("http")(request_logging_middleware)






# ---------- 健康檢查 ----------
@app.get("/health")
def health():
    """健康檢查：回傳服務狀態與目前時間"""
    return {"status": "ok", "time": datetime.datetime.now().isoformat()}

# ---------- 掛載各功能路由 ----------
# auth：不需全域鎖（login 公開；me/logout 內部自行驗證）
app.include_router(auth.router)

# 其餘全部上鎖：未登入一律 401
for _r in (items.router, movements.router, transfers.router, stockout.router, kits.router, stocktake.router,
           stats.router, export.router, photos.router, lookup.router, service_types.router,
           users.router, appointments.router, units.router, gcal_keys.router, signed_reports.router,
                      quotation_uploads.router, quotations.router, petty_cash.router, work_progress.router):
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
            return f"{url}?v={os.stat(fp).st_mtime_ns}"
        return m.group(0)                     # 檔案不存在（不該發生）→ 原樣保留

    html = _STATIC_RE.sub(_swap, html)
    return Response(html, media_type="text/html", headers={"Cache-Control": "no-cache, no-store, must-revalidate"})

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

@app.get("/settings.html")
def settings_page():
    """設定中心頁（2026-08-16 單位管理/修改密碼；static 資源版本號自動化）"""
    idx = os.path.join(STATIC_DIR, "settings.html")
    if os.path.exists(idx):
        return _versioned_html(idx)
    return Response("<h1>設定頁不存在</h1>", media_type="text/html")

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

@app.get("/media/{asset_id}/{variant}")
def read_media(asset_id: str, variant: str, user: dict = Depends(require_login)):
    """回傳登入者可讀的 original/preview/thumbnail 媒體變體。"""
    if not re.fullmatch(r"[0-9a-f]{32}", asset_id) or variant not in ("original", "preview", "thumbnail"):
        raise HTTPException(status_code=404, detail="找不到媒體")
    conn = get_db()
    try:
        row = get_asset(conn, asset_id)
        if row is None:
            raise HTTPException(status_code=404, detail="找不到媒體")
        if row["category"] == "work_progress":
            # Work-progress photos must use the report-scoped endpoint, which validates owner_type/owner_id.
            raise HTTPException(status_code=404, detail="找不到媒體")
        try:
            path = asset_variant_path(row, variant)
        except (ValueError, FileNotFoundError):
            raise HTTPException(status_code=404, detail="媒體變體不存在")
        if not path.exists():
            raise HTTPException(status_code=404, detail="媒體檔案遺失")
        response_kwargs = {
            "media_type": asset_media_type(row, variant),
            "headers": {"Cache-Control": "private, max-age=86400"},
        }
        if variant == "original":
            response_kwargs.update(
                filename=row["original_name"] or "download",
                content_disposition_type="attachment",
            )
        return FileResponse(path, **response_kwargs)
    finally:
        conn.close()

if __name__ == "__main__":
    # 直接執行 main.py 也必須走 single-instance launcher；不要再建立裸 uvicorn。
    import subprocess
    import sys
    from pathlib import Path

    launcher = Path(__file__).resolve().parent / "scripts" / "start-server.ps1"
    raise SystemExit(subprocess.call([
        "powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass",
        "-File", str(launcher), *sys.argv[1:],
    ]))


