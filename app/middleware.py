# -*- coding: utf-8 -*-
"""HTTP middleware（2026-08-16 從 main.py 抽出）。

註冊順序（main.py）：cache_control → csrf_origin → security_headers。
Starlette build_middleware_stack 用 reversed()——後註冊者最內層、最先處理 request，
故保持定義順序註冊即執行序不變。
"""
import logging
import re
import time
import uuid

from fastapi.responses import Response
from starlette.datastructures import Headers
from starlette.middleware.gzip import GZipMiddleware, GZipResponder, IdentityResponder

from app.services.app_log import reset_request_id, set_request_id

_access_logger = logging.getLogger("hvac.access")
_error_logger = logging.getLogger("hvac.error")
_BINARY_MIME_PREFIXES = ("image/", "audio/", "video/")
_BINARY_MIME_TYPES = {"application/pdf", "application/zip", "application/gzip", "application/octet-stream"}


class _BinarySafeGZipResponder(GZipResponder):
    """Do not gzip already-compressed or non-text response bodies."""

    async def send_with_compression(self, message):
        is_binary = False
        if message["type"] == "http.response.start":
            content_type = Headers(raw=message["headers"]).get("content-type", "")
            content_type = content_type.split(";", 1)[0].strip().lower()
            is_binary = content_type.startswith(_BINARY_MIME_PREFIXES) or content_type in _BINARY_MIME_TYPES
        result = await super().send_with_compression(message)
        if message["type"] == "http.response.start" and is_binary:
            # The parent stores the start message and recalculates its own
            # event-stream flag; set this after it returns so body events pass through.
            self.content_type_is_excluded = True
        return result


class BinarySafeGZipMiddleware(GZipMiddleware):
    """GZip text/JSON responses while leaving binary media untouched."""

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = Headers(scope=scope)
        if "gzip" in headers.get("Accept-Encoding", ""):
            responder = _BinarySafeGZipResponder(self.app, self.minimum_size, compresslevel=self.compresslevel)
        else:
            responder = IdentityResponder(self.app, self.minimum_size)
        await responder(scope, receive, send)


async def request_logging_middleware(request, call_next):
    """記錄每個 HTTP request，並在 response 帶回 request id 方便追查。"""
    request_id = uuid.uuid4().hex[:16]
    token = set_request_id(request_id)
    started = time.perf_counter()
    client = request.client.host if request.client else "-"
    try:
        response = await call_next(request)
    except Exception:
        duration_ms = (time.perf_counter() - started) * 1000
        _access_logger.info(
            "%s %s status=500 client=%s duration_ms=%.1f",
            request.method, request.url.path, client, duration_ms,
        )
        _error_logger.exception(
            "Unhandled request exception method=%s path=%s client=%s duration_ms=%.1f",
            request.method, request.url.path, client, duration_ms,
        )
        raise
    else:
        duration_ms = (time.perf_counter() - started) * 1000
        _access_logger.info(
            "%s %s status=%s client=%s duration_ms=%.1f",
            request.method, request.url.path, response.status_code, client, duration_ms,
        )
        response.headers["X-Request-ID"] = request_id
        if response.status_code >= 500:
            _error_logger.error(
                "HTTP error method=%s path=%s status=%s client=%s duration_ms=%.1f",
                request.method, request.url.path, response.status_code, client, duration_ms,
            )
        return response
    finally:
        reset_request_id(token)


async def cache_control_middleware(request, call_next):
    """HTML 每次重新驗證（no-cache）；static 資源短快取（配合 ?v=N 版本參數）"""
    response = await call_next(request)
    path = request.url.path
    if path in ("/", "/login.html", "/permissions.html", "/settings.html"):
        # HTML：每次都要重新驗證，確保拿到最新 ?v=N 引用
        response.headers["Cache-Control"] = "no-cache, must-revalidate"
    elif path.startswith("/static/"):
        # 版本化 URL（由 main._versioned_html 注入 ?v=mtime）可長效快取。
        if "v" in request.query_params:
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        else:
            response.headers["Cache-Control"] = "public, max-age=3600"
    elif path.startswith("/media/") or path.startswith("/uploads/"):
        # 媒體路徑含 asset id 或 legacy item id；內容替換時由新 asset/path 失效。
        response.headers["Cache-Control"] = "private, max-age=86400"
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
    # PDF/image preview is intentionally embedded by the signed-report modal.
    # Keep the strict site-wide policy for every other response.
    is_signed_report_preview = bool(re.fullmatch(r"/api/(?:signed-reports|quotation-uploads)/\d+/preview", request.url.path))
    response.headers["X-Frame-Options"] = "SAMEORIGIN" if is_signed_report_preview else "DENY"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    if is_signed_report_preview:
        # Chrome 內建 PDF 閱讀器在 iframe 內以 chrome-extension:// 載入，
        # 會被 default-src 'self' 的 fallback 擋掉（手機顯示「這項內容已遭到封鎖」）。
        # preview 只對白名單 PDF/圖片回 inline（SVG/HTML 強制 attachment + octet-stream），
        # 因此僅保留 framing 保護即可，不放行 active content。
        response.headers["Content-Security-Policy"] = "frame-ancestors 'self'"
        # preview 不快取：擋掉 headers 修復前的壞回應殘留，也避免換檔後看到舊檔。
        response.headers["Cache-Control"] = "no-store"
    else:
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
