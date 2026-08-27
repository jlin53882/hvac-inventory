# -*- coding: utf-8 -*-
"""背景 debounce 同步排程器（Multi-Key 複合主鍵隊列）

功能：
- 每 5 分鐘掃描 appointment_sync_queue
- debounce：last_modified_at 距今 ≥5 分鐘才算 due
- 失敗重試：最多 5 次
- 失敗通知：同步失敗時發送 Discord webhook 通知

Log 行為：
- 啟動/停止：INFO
- 同步成功：INFO（僅總數）
- 同步失敗：WARNING + Discord 通知
- 無 due 項目：靜默（不寫 log）
"""
import json
import logging
import os
import threading
import urllib.request
from datetime import datetime, timedelta

from app.database import get_db
from app.services import gcal_sync

logger = logging.getLogger(__name__)

# 加 file handler 方便查看同步 log
_log_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "logs")
os.makedirs(_log_dir, exist_ok=True)
_log_path = os.path.join(_log_dir, "gcal_sync.log")
_fh = logging.FileHandler(_log_path, encoding="utf-8")
_fh.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
logger.addHandler(_fh)
logger.setLevel(logging.INFO)

# ---------- Discord Webhook 設定（從 .env 讀取）----------
import app.config as _cfg

_INTERVAL = 300   # 5 分鐘
_WINDOW = 300     # debounce 窗口 5 分鐘
_MAX_ATTEMPTS = 5
_stop = threading.Event()
_thread = None


def _notify_discord(message: str) -> None:
    """發送 Discord webhook 通知（失敗時呼叫，fire-and-forget）。"""
    webhook_url = _cfg.GCAL_SYNC_WEBHOOK_URL
    thread_id = _cfg.GCAL_SYNC_THREAD_ID
    if not webhook_url:
        return  # 未設定 webhook → 靜默
    try:
        url = f"{webhook_url}?thread_id={thread_id}" if thread_id else webhook_url
        data = json.dumps({"content": message}).encode("utf-8")
        req = urllib.request.Request(
            url, data=data,
            headers={"Content-Type": "application/json", "User-Agent": "hvac-sync/1.0"},
        )
        urllib.request.urlopen(req, timeout=10)
    except Exception as e:
        logger.warning("Discord 通知發送失敗: %s", e)


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
        # Discord 失敗通知
        _notify_discord(
            f"⚠️ **hvac Google 同步失敗**\n"
            f"成功 {ok} / 失敗 {fail}\n"
            f"時間：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"
        )
    else:
        logger.info("gcal 同步完成：成功 %d", ok)
