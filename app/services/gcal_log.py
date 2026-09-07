# -*- coding: utf-8 -*-
"""
gcal_sync 共用 logging 設定
============================
- 每日分目錄：logs/MMDD/gcal_sync.log（如 logs/0908/gcal_sync.log）
- 跨月壓縮：進入新月時，上個月的 MMDD 目錄打包為 logs/archive_YYYYMM.tar.gz
- 舊檔歸檔：首次啟動時，logs/gcal_sync.log（舊格式）移到 logs/archive_legacy_gcal_sync.log
- 錯誤隔離：所有檔案操作都包 try/except，不癱瘓主程式

用法：
    from app.services.gcal_log import get_logger
    logger = get_logger(__name__)
"""
import logging
import os
import shutil
import tarfile
from datetime import datetime

# 專案根目錄（logs/ 的上層）
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
_LOG_BASE = os.path.join(_PROJECT_ROOT, "logs")

# 格式器（共用）
_FORMATTER = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s")


def _today_dir() -> str:
    """回傳今天的日誌目錄：logs/MMDD/"""
    now = datetime.now()
    return os.path.join(_LOG_BASE, now.strftime("%m%d"))


def _legacy_log_path() -> str:
    """舊格式 log 路徑：logs/gcal_sync.log"""
    return os.path.join(_LOG_BASE, "gcal_sync.log")


def _archive_legacy_log():
    """首次啟動時，將舊格式 logs/gcal_sync.log 歸檔。"""
    legacy = _legacy_log_path()
    if not os.path.isfile(legacy):
        return
    target = os.path.join(_LOG_BASE, "archive_legacy_gcal_sync.log")
    try:
        os.replace(legacy, target)
    except Exception:
        pass  # 靜默失敗，不癱瘓主程式


def _archive_previous_month():
    """跨月壓縮：將上個月的 MMDD 目錄打包為 archive_YYYYMM.tar.gz。"""
    now = datetime.now()
    current_month = now.strftime("%Y%m")

    try:
        for entry in os.listdir(_LOG_BASE):
            # MMDD 目錄 = 4 位數字
            if not entry.isdigit() or len(entry) != 4:
                continue
            dir_path = os.path.join(_LOG_BASE, entry)
            if not os.path.isdir(dir_path):
                continue
            # 從目錄名推斷月份：用目錄內 log 檔的修改時間
            log_file = os.path.join(dir_path, "gcal_sync.log")
            if not os.path.isfile(log_file):
                continue
            mtime = datetime.fromtimestamp(os.path.getmtime(log_file))
            dir_month = mtime.strftime("%Y%m")
            # 不是當月 → 歸檔
            if dir_month == current_month:
                continue
            archive_name = f"archive_{dir_month}"
            archive_path = os.path.join(_LOG_BASE, archive_name)
            # 避免重複打包
            if os.path.isfile(archive_path + ".tar.gz"):
                shutil.rmtree(dir_path, ignore_errors=True)
                continue
            # 打包
            try:
                with tarfile.open(archive_path + ".tar.gz", "w:gz") as tar:
                    tar.add(dir_path, arcname=entry)
                # 打包成功才刪除原始目錄
                shutil.rmtree(dir_path, ignore_errors=True)
            except Exception:
                pass  # 打包失敗不刪除，保留原始目錄
    except Exception:
        pass  # 整個歸檔流程失敗不癱瘓主程式


def setup_gcal_logging():
    """設定共用 gcal_sync logging。"""
    # 1. 歸檔舊 log
    _archive_legacy_log()

    # 2. 跨月壓縮
    _archive_previous_month()

    # 3. 建立今天的目錄
    today_dir = _today_dir()
    try:
        os.makedirs(today_dir, exist_ok=True)
    except Exception:
        # 目錄建立失敗 → fallback 到 logs/ 根目錄
        today_dir = _LOG_BASE

    # 4. 建立 FileHandler
    log_path = os.path.join(today_dir, "gcal_sync.log")
    try:
        fh = logging.FileHandler(log_path, encoding="utf-8")
        fh.setFormatter(_FORMATTER)
    except Exception:
        # FileHandler 建立失敗 → 用 NullHandler（不寫檔但不崩）
        fh = logging.NullHandler()

    return fh


# 模組級別：確保只初始化一次
_handler = None


def get_logger(name: str) -> logging.Logger:
    """取得共用 gcal_sync logger（帶 FileHandler）。

    各模組呼叫方式：
        from app.services.gcal_log import get_logger
        logger = get_logger(__name__)
    """
    global _handler
    logger = logging.getLogger(name)

    # 避免重複加 handler（模組重載時）
    if _handler is None:
        _handler = setup_gcal_logging()

    # 檢查是否已有 handler（避免重複加）
    has_file_handler = any(
        isinstance(h, logging.FileHandler) and not isinstance(h, logging.NullHandler)
        for h in logger.handlers
    )
    if not has_file_handler:
        logger.addHandler(_handler)
    logger.setLevel(logging.INFO)

    return logger
