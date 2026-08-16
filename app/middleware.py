# -*- coding: utf-8 -*-
"""HTTP middleware（2026-08-16 從 main.py 抽出）。

註冊順序（main.py）：cache_control → csrf_origin → security_headers。
Starlette build_middleware_stack 用 reversed()——後註冊者最內層、最先處理 request，
故保持定義順序註冊即執行序不變。
"""
from fastapi.responses import Response


async def cache_control_middleware(request, call_next):
    """HTML 每次重新驗證（no-cache）；static 資源短快取（配合 ?v=N 版本參數）"""
    response = await call_next(request)
    path = request.url.path
    if path in ("/", "/login.html", "/permissions.html", "/settings.html"):
        # HTML：每次都要重新驗證，確保拿到最新 ?v=N 引用
        response.headers["Cache-Control"] = "no-cache, must-revalidate"
    elif path.startswith("/static/"):
        # JS/CSS：快取 1 小時；內容更新靠版本參數（?v=12）換 URL
        response.headers["Cache-Control"] = "public, max-age=3600"
    return response


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
