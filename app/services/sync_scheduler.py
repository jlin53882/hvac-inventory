# -*- coding: utf-8 -*-
"""背景 debounce 同步排程器（Multi-Key 複合主鍵隊列）

功能：
- 每 N 分鐘掃描 appointment_sync_queue（設定值 1~30，預設 5）
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
import threading
import urllib.request
from datetime import datetime, timedelta, timezone

import app.config as _cfg
from app.database import get_db
from app.services import gcal_sync
from app.services.gcal_log import get_logger

logger = get_logger(__name__)

# ---------- Discord Webhook 設定（從 .env 讀取）----------

_INTERVAL = 300   # 預設 5 分鐘（動態讀取 settings）
_WINDOW = 300     # debounce 窗口 5 分鐘
_stop = threading.Event()
_thread = None
_reset_event = threading.Event()  # 喚醒排程器
_force_event = threading.Event()  # force sync bypass debounce
_lifecycle_lock = threading.Lock()
_run_lock = threading.Lock()
_health_lock = threading.Lock()
_MAX_ATTEMPTS = gcal_sync.MAX_ATTEMPTS
_health = {
    "last_run_at": None,
    "last_success_at": None,
    "last_error": None,
}


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
        logger.warning("Discord 通知發送失敗: %s", gcal_sync.safe_sync_error(e))


def _set_health(**updates) -> None:
    with _health_lock:
        _health.update(updates)


def _health_error(error: Exception) -> str:
    """健康 API 只回傳錯誤類型，不暴露 credential path 或 secret。"""
    return f"{type(error).__name__}: scheduler round failed"


def _thread_alive() -> bool:
    thread = _thread
    return bool(thread is not None and thread.is_alive())


def start():
    """啟動背景同步 infrastructure；沒有 active key 時 worker 仍保持存活。"""
    global _thread
    with _lifecycle_lock:
        if _thread is not None and _thread.is_alive():
            if not _stop.is_set():
                return
            # stop() 可能因外部 Google request 尚未返回而只等到 timeout；
            # 不可在舊 worker 還活著時建立第二個 worker。
            _thread.join(timeout=5)
            if _thread.is_alive():
                return
        _stop.clear()
        _reset_event.clear()
        _force_event.clear()
        _thread = threading.Thread(target=_loop, daemon=True, name="gcal-sync")
        _thread.start()
    logger.info("gcal 同步排程器已啟動")


def stop():
    """停止背景同步執行緒（idempotent：重複呼叫不重複 log）。"""
    global _thread
    with _lifecycle_lock:
        thread = _thread
        if thread is None:
            return
        _stop.set()
        _reset_event.set()
        if thread.is_alive():
            thread.join(timeout=5)
        if thread.is_alive():
            logger.warning("gcal 同步排程器停止等待逾時，保留 worker reference 避免重複啟動")
            return
        _thread = None
    logger.info("gcal 同步排程器已停止")


def wake(force: bool = False):
    """喚醒 worker；force=True 額外 bypass debounce，但不重設 exhausted attempts。"""
    if force:
        _force_event.set()
    _reset_event.set()


def reset_now():
    """立即觸發 force sync（不自動重設 attempts >= MAX_ATTEMPTS）。"""
    start()
    wake(force=True)
    logger.info("gcal 同步排程器 force reset 信號已發送")


def get_health() -> dict:
    """回傳 scheduler + queue health，僅包含管理用摘要。"""
    with _health_lock:
        health = dict(_health)
    health.update({
        "running": _thread_alive(),
        "thread_alive": _thread_alive(),
        "max_attempts": _MAX_ATTEMPTS,
        "active_keys": 0,
        "pending_count": 0,
        "retrying_count": 0,
        "exhausted_count": 0,
        "paused_count": 0,
    })
    conn = None
    try:
        conn = get_db()
        health["active_keys"] = conn.execute(
            "SELECT COUNT(*) AS c FROM gcal_keys WHERE is_active=1"
        ).fetchone()["c"]
        health["pending_count"] = conn.execute(
            "SELECT COUNT(*) AS c FROM appointment_sync_queue "
            "WHERE attempts < ? AND COALESCE(last_error,'')=''", (_MAX_ATTEMPTS,)
        ).fetchone()["c"]
        health["retrying_count"] = conn.execute(
            "SELECT COUNT(*) AS c FROM appointment_sync_queue "
            "WHERE attempts < ? AND COALESCE(last_error,'')<>''", (_MAX_ATTEMPTS,)
        ).fetchone()["c"]
        health["exhausted_count"] = conn.execute(
            "SELECT COUNT(*) AS c FROM appointment_sync_queue WHERE attempts >= ?",
            (_MAX_ATTEMPTS,),
        ).fetchone()["c"]
        health["paused_count"] = conn.execute(
            "SELECT COUNT(*) AS c FROM appointment_sync_queue q "
            "LEFT JOIN gcal_keys k ON k.id=q.key_id WHERE COALESCE(k.is_active,0)=0"
        ).fetchone()["c"]
    except Exception as error:
        health["last_error"] = _health_error(error)
    finally:
        if conn is not None:
            conn.close()
    return health

def _get_sync_interval() -> int:
    """從 gcal_sync_settings 讀取同步間隔（分鐘），回傳秒數。"""
    try:
        conn = get_db()
        try:
            row = conn.execute("SELECT value FROM gcal_sync_settings WHERE key='gcal_sync_interval_min'").fetchone()
            minutes = int(row["value"]) if row else 5
            return max(1, min(30, minutes)) * 60  # 限制 1~30 分鐘
        finally:
            conn.close()
    except Exception:
        return _INTERVAL  # fallback 5 分鐘


def _loop():
    """主迴圈：每 N 秒執行一次；reset 可喚醒，force reset bypass debounce。"""
    while not _stop.is_set():
        interval = _get_sync_interval()
        if _reset_event.wait(timeout=interval):
            _reset_event.clear()
            if _stop.is_set():
                break
            logger.info("gcal 同步排程器收到 reset 信號，立即執行")
        force = _force_event.is_set()
        _force_event.clear()
        try:
            _run_once(force=force)
        except Exception as error:
            _set_health(last_error=_health_error(error))
            logger.error("gcal 同步單輪失敗: %s", gcal_sync.safe_sync_error(error))

def _due_ids(rows, now, window=_WINDOW):
    """目標 (appointment_id, key_id) 集合；窗口邊界在此純函式判定。"""
    def _ts(s):
        try:
            parsed = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
            if parsed.tzinfo is not None:
                parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
            return parsed
        except (TypeError, ValueError):
            return datetime.min
    out = set()
    for row in rows:
        if now - _ts(row["last_modified_at"]) >= timedelta(seconds=window):
            out.add((row["appointment_id"], row["key_id"]))
    return out


def _format_sync_error_line(key_id: int, info: dict) -> str:
    """將單一 Key 的同步錯誤摘要格式化成可定位的通知列。"""
    key_name = info.get("key_name") or f"key={key_id}"
    cal_id = info.get("cal_id") or "Calendar ID 未知"
    top_errs = sorted(info.get("errors", {}).items(), key=lambda x: -x[1])[:3]
    err_lines = " | ".join(f"{error} ×{count}" for error, count in top_errs)
    return f"❌ Key「{key_name}」／Calendar「{cal_id}」：{err_lines}"


def _run_once(force: bool = False):
    """單輪同步；同一 process 的 scheduler/force 入口不可重疊。"""
    with _run_lock:
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        health_now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        _set_health(last_run_at=health_now)
        if not gcal_sync.is_enabled():
            _set_health(last_success_at=health_now, last_error=None)
            return

        conn = get_db()
        try:
            rows = conn.execute(
                "SELECT q.appointment_id, q.key_id, q.op_type, q.google_event_id, "
                "q.last_modified_at, q.attempts "
                "FROM appointment_sync_queue q JOIN gcal_keys k ON k.id=q.key_id "
                "WHERE q.attempts < ? AND k.is_active=1", (_MAX_ATTEMPTS,)
            ).fetchall()
        finally:
            conn.close()

        # Python-side guard protects force semantics even when a caller/test supplies a stale row.
        eligible = []
        for row in rows:
            try:
                attempts = row["attempts"]
            except (KeyError, IndexError):
                attempts = 0
            if int(attempts or 0) < _MAX_ATTEMPTS:
                eligible.append(row)
        if force:
            due = [dict(row) for row in eligible]
        else:
            cap = _due_ids(eligible, now)
            due = [dict(row) for row in eligible if (row["appointment_id"], row["key_id"]) in cap]
        if not due:
            _set_health(last_success_at=health_now, last_error=None)
            return

        ok, fail, error_summary = gcal_sync.sync_pending(due)
        resolved_total = sum(
            sum(info.get("resolved", {}).values())
            for info in error_summary.values()
        )
        if fail:
            _set_health(last_error=f"{fail} sync item(s) failed")
        else:
            _set_health(last_success_at=datetime.now().strftime("%Y-%m-%d %H:%M:%S"), last_error=None)
        if fail or resolved_total:
            title = "⚠️ **hvac Google 同步有失敗**" if fail else "✅ **hvac Google 同步完成**"
            if fail:
                logger.warning("gcal 同步完成：成功 %d / 失敗 %d", ok, fail)
            else:
                logger.info("gcal 同步完成：成功 %d / 自動處理 %d", ok, resolved_total)
            lines = [
                title,
                f"成功 {ok} / 失敗 {fail} / 已自動處理 {resolved_total}",
                f"時間：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
                "",
            ]
            resolution_labels = {
                "remote_already_deleted": "Google 事件已不存在，刪除視為完成",
                "appointment_deleted": "本地行程已刪除，清除過期同步任務",
            }
            for key_id, info in sorted(error_summary.items()):
                errs = info.get("errors", {})
                if errs:
                    lines.append(_format_sync_error_line(key_id, info))
                    if len(errs) > 3:
                        lines.append(f"   +{len(errs) - 3} 種其他錯誤")
                for reason, count in info.get("resolved", {}).items():
                    label = resolution_labels.get(reason, reason)
                    key_name = info.get("key_name") or f"key={key_id}"
                    lines.append(f"ℹ️ Key「{key_name}」：{label} ×{count}")
            msg = chr(10).join(lines)
            if len(msg) > 1900:
                msg = msg[:1897] + "..."
            _notify_discord(msg)
        else:
            logger.info("gcal 同步完成：成功 %d", ok)
