# -*- coding: utf-8 -*-
"""hvac-inventory 集中式 server logging。

日誌目錄：logs/MMDD/
- server.log：所有 hvac 應用程式 log
- access.log：每一個 HTTP request（method/path/status/duration/request_id）
- error.log：ERROR 以上與未處理例外

GCal 同步仍保留自己的 gcal_sync.log；透過 logging propagation 同時匯入
server.log，既維持既有查詢方式，也讓專案 log 有單一總入口。
"""
import logging
import os
import sys
from contextvars import ContextVar
from datetime import datetime
from pathlib import Path

_PROJECT_ROOT = Path(__file__).resolve().parents[2]
_LOG_BASE = str(_PROJECT_ROOT / "logs")
_DEFAULT_LOG_BASE = _LOG_BASE
_REQUEST_ID: ContextVar[str] = ContextVar("hvac_request_id", default="-")
_FORMAT = "%(asctime)s [%(levelname)s] [%(name)s] [request_id=%(request_id)s] %(message)s"


class _RequestIdFilter(logging.Filter):
    """將 request id 補進所有 log record，避免第三方 logger 格式化失敗。"""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = _REQUEST_ID.get()
        return True


class _LoggerNameFilter(logging.Filter):
    """只讓指定 logger 類型進入專用檔案。"""

    def __init__(self, prefix: str):
        super().__init__()
        self.prefix = prefix

    def filter(self, record: logging.LogRecord) -> bool:
        return record.name == self.prefix or record.name.startswith(self.prefix + ".")


class _MaxLevelFilter(logging.Filter):
    def __init__(self, max_level: int):
        super().__init__()
        self.max_level = max_level

    def filter(self, record: logging.LogRecord) -> bool:
        return record.levelno <= self.max_level


def _today_dir() -> Path:
    base = Path(_LOG_BASE)
    # pytest 的 TestClient request 不得污染正式 server log。
    if os.environ.get("PYTEST_CURRENT_TEST") and os.path.abspath(_LOG_BASE) == os.path.abspath(_DEFAULT_LOG_BASE):
        base = base / "test"
    return base / datetime.now().strftime("%m%d")


def setup_logging() -> Path:
    """初始化集中式 handlers；重複呼叫安全，回傳今日 log 目錄。"""
    today_dir = _today_dir()
    today_dir.mkdir(parents=True, exist_ok=True)
    formatter = logging.Formatter(_FORMAT)
    request_filter = _RequestIdFilter()
    root = logging.getLogger()
    root.setLevel(logging.INFO)

    # lifespan 可能因測試/TestClient 或 reload 重複執行；先移除本模組建立的 handlers。
    for handler in list(root.handlers):
        if getattr(handler, "_hvac_handler", False):
            root.removeHandler(handler)
            handler.close()

    def file_handler(filename: str, level: int = logging.INFO) -> logging.Handler:
        handler = logging.FileHandler(today_dir / filename, encoding="utf-8")
        handler.setLevel(level)
        handler.setFormatter(formatter)
        handler.addFilter(request_filter)
        handler._hvac_handler = True
        return handler

    server_handler = file_handler("server.log")
    access_handler = file_handler("access.log")
    access_handler.addFilter(_LoggerNameFilter("hvac.access"))
    error_handler = file_handler("error.log", logging.ERROR)
    console_handler = logging.StreamHandler(sys.stderr)
    console_handler.setLevel(logging.INFO)
    console_handler.setFormatter(formatter)
    console_handler.addFilter(request_filter)
    console_handler._hvac_handler = True

    root.addHandler(server_handler)
    root.addHandler(access_handler)
    root.addHandler(error_handler)
    root.addHandler(console_handler)

    # Uvicorn 自帶 handler 只寫 console；讓其 error 訊息進入 server/error.log。
    for name in ("uvicorn.error", "uvicorn.access"):
        uvicorn_logger = logging.getLogger(name)
        uvicorn_logger.handlers.clear()
        uvicorn_logger.propagate = True

    logging.getLogger(__name__).info("集中式 logging 已啟動 log_dir=%s cwd=%s", today_dir, os.getcwd())
    return today_dir


def get_logger(name: str) -> logging.Logger:
    """取得標準 logger；集中 handlers 由 setup_logging() 統一管理。"""
    return logging.getLogger(name)


def set_request_id(request_id: str):
    """設定目前 request 的 request id，回傳 token 供 reset。"""
    return _REQUEST_ID.set(request_id)


def reset_request_id(token) -> None:
    """還原 request id context。"""
    _REQUEST_ID.reset(token)
