# -*- coding: utf-8 -*-
"""背景 debounce 同步排程器（Multi-Key 複合主鍵隊列）"""
import logging
import threading
from datetime import datetime, timedelta

from app.database import get_db
from app.services import gcal_sync

logger = logging.getLogger(__name__)
_INTERVAL = 300   # 5 分鐘
_WINDOW = 300     # debounce 窗口 5 分鐘
_MAX_ATTEMPTS = 5
_stop = threading.Event()
_thread = None


def start():
    """啟動背景同步執行緒（無啟用 key → no-op）"""
    global _thread
    if not gcal_sync.is_enabled() or _thread is not None:
        return
    _stop.clear()
    _thread = threading.Thread(target=_loop, daemon=True, name="gcal-sync")
    _thread.start()
    logger.info("gcal 同步排程器已啟動")


def stop():
    """停止背景同步執行緒"""
    global _thread
    _stop.set()
    if _thread is not None:
        _thread.join(timeout=5)
    _thread = None
    logger.info("gcal 同步排程器已停止")


def _loop():
    """主迴圈：每 _INTERVAL 秒執行一次"""
    while not _stop.wait(_INTERVAL):
        try:
            _run_once()
        except Exception:
            logger.exception("gcal 同步單輪失敗")


def _due_ids(rows, now, window=_WINDOW):
    """目標 (appointment_id, key_id) 集合；窗口邊界在此純函式判定。"""
    def _ts(s):
        try:
            return datetime.strptime(s, "%Y-%m-%d %H:%M:%S")
        except (TypeError, ValueError):
            return datetime.min
    out = set()
    for row in rows:
        if now - _ts(row["last_modified_at"]) >= timedelta(seconds=window):
            out.add((row["appointment_id"], row["key_id"]))
    return out


def _run_once():
    """A3 三段式：網路 I/O 絕不包 SQLite 寫鎖交易。"""
    if not gcal_sync.is_enabled():
        return
    # 短交易只讀 due 清單 → 立刻 close
    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT appointment_id, key_id, op_type, google_event_id, last_modified_at "
            "FROM appointment_sync_queue WHERE attempts < ?", (_MAX_ATTEMPTS,)).fetchall()
    finally:
        conn.close()
    now = datetime.utcnow()
    cap = _due_ids(rows, now)
    due = [dict(r) for r in rows if (r["appointment_id"], r["key_id"]) in cap]
    if not due:
        return
    # 純網路呼叫（無鎖）
    ok, fail = gcal_sync.sync_pending(due)
    if fail:
        logger.warning("gcal 同步完成：成功 %d / 失敗 %d", ok, fail)
    else:
        logger.info("gcal 同步完成：成功 %d", ok)
