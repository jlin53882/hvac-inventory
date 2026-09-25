# -*- coding: utf-8 -*-
"""hvac-inventory 集中式 server logging。

日誌目錄：logs/MMDD/（跨日自動切換到新目錄；超過 LOG_RETENTION_DAYS 天的目錄自動刪除）
- server.log：hvac 應用程式 log（不含 access，避免重複）
- access.log：每一個 HTTP request（method/path/status/duration/request_id）
- error.log：ERROR 以上與未處理例外

GCal 同步仍保留自己的 gcal_sync.log；透過 logging propagation 同時匯入
server.log，既維持既有查詢方式，也讓專案 log 有單一總入口。
"""
import logging
import os
import shutil
import sys
import time
from contextvars import ContextVar
from datetime import datetime
from pathlib import Path
from typing import Callable

_PROJECT_ROOT = Path(__file__).resolve().parents[2]
_LOG_BASE = str(_PROJECT_ROOT / "logs")
_DEFAULT_LOG_BASE = _LOG_BASE
_REQUEST_ID: ContextVar[str] = ContextVar("hvac_request_id", default="-")
_FORMAT = "%(asctime)s [%(levelname)s] [%(name)s] [request_id=%(request_id)s] %(message)s"
LOG_RETENTION_DAYS = 30


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


class _ExcludeLoggerFilter(_LoggerNameFilter):
    """排除指定 logger（server.log 不重複寫 access 紀錄）。"""

    def filter(self, record: logging.LogRecord) -> bool:
        return not super().filter(record)


class DailyDirFileHandler(logging.FileHandler):
    """寫入 ``dir_func()/filename``；日期資料夾變更時自動切檔（2026-09）。

    原本 FileHandler 在啟動時就固定路徑，server 連續跑數週時所有 log 都寫進啟動當天的資料夾。
    切檔時呼叫 ``on_rollover(新資料夾)``（例如清理過期 log）。emit 由 logging 在 handler lock 內呼叫，
    因此切換 stream 不需要額外鎖。
    """

    def __init__(self, filename: str, dir_func: Callable[[], Path],
                 on_rollover: Callable[[Path], None] | None = None, encoding: str = "utf-8"):
        self._log_name = filename
        self._dir_func = dir_func
        self._on_rollover = on_rollover
        self._current_dir = Path(dir_func())
        self._current_dir.mkdir(parents=True, exist_ok=True)
        super().__init__(self._current_dir / filename, encoding=encoding)

    def emit(self, record: logging.LogRecord) -> None:
        try:
            new_dir = Path(self._dir_func())
            if new_dir != self._current_dir:
                new_dir.mkdir(parents=True, exist_ok=True)
                if self.stream is not None:
                    self.stream.close()
                    self.stream = None  # FileHandler.emit 會以新的 baseFilename 重新開檔
                self.baseFilename = os.path.abspath(new_dir / self._log_name)
                self._current_dir = new_dir
                if self._on_rollover is not None:
                    self._on_rollover(new_dir)
        except Exception:
            self.handleError(record)
            return
        super().emit(record)


def cleanup_old_logs(base: str | Path, keep_days: int = LOG_RETENTION_DAYS, now: float | None = None) -> list[str]:
    """刪除超過 keep_days 天未更新的 logs/MMDD 資料夾與 archive_*.tar.gz，回傳刪除的名稱。

    以資料夾內最新檔案的 mtime 判斷（MMDD 不含年份，不能用名稱推日期）。失敗一律忽略，不影響主程式。
    """
    cutoff = (time.time() if now is None else now) - keep_days * 86400
    removed = []
    try:
        entries = list(Path(base).iterdir())
    except OSError:
        return removed
    for entry in entries:
        try:
            if entry.is_dir() and entry.name.isdigit() and len(entry.name) == 4:
                mtimes = [f.stat().st_mtime for f in entry.iterdir() if f.is_file()] or [entry.stat().st_mtime]
                if max(mtimes) < cutoff:
                    shutil.rmtree(entry, ignore_errors=True)
                    removed.append(entry.name)
            elif entry.is_file() and entry.name.startswith("archive_") and entry.name.endswith(".tar.gz"):
                if entry.stat().st_mtime < cutoff:
                    entry.unlink()
                    removed.append(entry.name)
        except OSError:
            continue
    return removed


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


def _cleanup_rotated(new_dir: Path) -> None:
    cleanup_old_logs(new_dir.parent)


def setup_logging() -> Path:
    """初始化集中式 handlers；重複呼叫安全，回傳今日 log 目錄。"""
    today_dir = _today_dir()
    today_dir.mkdir(parents=True, exist_ok=True)
    cleanup_old_logs(today_dir.parent)
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
        # server.log 負責跨日清理（每次切日只需觸發一次）
        handler = DailyDirFileHandler(
            filename, _today_dir, on_rollover=_cleanup_rotated if filename == "server.log" else None,
        )
        handler.setLevel(level)
        handler.setFormatter(formatter)
        handler.addFilter(request_filter)
        handler._hvac_handler = True
        return handler

    server_handler = file_handler("server.log")
    server_handler.addFilter(_ExcludeLoggerFilter("hvac.access"))
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
