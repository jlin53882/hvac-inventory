# -*- coding: utf-8 -*-
"""
Google Calendar 單向同步（Multi-Key Service Account）
=====================================================
- build_event(appt_row, assignees) -> dict      純函式：本地行程 → Google Event
- get_service_for_key(key_row) -> service       對單一 key 建 service
- resolve_target_keys(conn, appt_id) -> [key_id] 依指派人員綁定的 key 解析目標（Multi-Key）
- sync_pending(due) -> (ok, fail, error_summary)   批次同步（每列對應一 key）
- is_enabled() -> bool                          gcal_keys 有啟用 key 才 True
"""
import hashlib
import json
import os
import re
import tempfile
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Tuple

from app.database import get_db
from app.services.gcal_log import get_logger

logger = get_logger(__name__)


class AppointmentNotFoundForSync(LookupError):
    """同步佇列指向已刪除的本地行程。"""



def _http_status(error) -> int | None:
    """讀取 Google HttpError status；非 HTTP 錯誤回傳 None。"""
    return getattr(getattr(error, "resp", None), "status", None)


def classify_sync_exception(op: str, error: Exception) -> str:
    """將同步例外分類為 failed 或可自動處理的結果。"""
    if isinstance(error, AppointmentNotFoundForSync):
        return "appointment_deleted"
    if op == "D" and _http_status(error) == 410:
        return "remote_already_deleted"
    return "failed"


def _record_resolution(summary: dict, key_id: int, cal_id: str, reason: str, key_name: str = "") -> None:
    """累計不需人工處理的同步結果，供通知層顯示。"""
    entry = summary.setdefault(key_id, {"key_name": key_name, "cal_id": cal_id, "errors": {}, "resolved": {}})
    entry["key_name"] = key_name or entry.get("key_name", "")
    entry["cal_id"] = cal_id
    entry.setdefault("resolved", {})[reason] = (
        entry.setdefault("resolved", {}).get(reason, 0) + 1
    )


TZ = "Asia/Taipei"
DEFAULT_DURATION_MIN = 60
MAX_ATTEMPTS = 5


def sync_version_now() -> str:
    """產生具微秒精度的 queue 版本；避免同秒修改吞掉 version guard。"""
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S.%f")


def queue_item_status(attempts: int, last_error: str | None) -> str:
    """管理 queue 單列狀態：pending / retrying / exhausted。"""
    if int(attempts or 0) >= MAX_ATTEMPTS:
        return "exhausted"
    if last_error:
        return "retrying"
    return "pending"


def appointment_sync_status(mapped: bool, queue_rows) -> str:
    """Calendar 對外狀態：區分自動重試中與達上限失敗。"""
    rows = list(queue_rows or [])
    if not rows:
        return "synced" if mapped else "none"
    statuses = [queue_item_status(row["attempts"], row["last_error"]) for row in rows]
    if "exhausted" in statuses:
        return "partial_failed" if mapped else "failed"
    if "retrying" in statuses:
        return "partial_retrying" if mapped else "retrying"
    return "pending"


def canonical_event_hash(event: dict) -> str:
    """對 Google 最終 Event payload 做穩定 canonical JSON + SHA-256。"""
    canonical = json.dumps(
        event,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def compute_event_hash(appt_row: dict, assignees: list, settings: dict = None) -> str:
    """計算 build_event 最終 payload 的 hash；hash 與實際送出的 payload 只有一個來源。"""
    return canonical_event_hash(build_event(appt_row, assignees, settings))


def safe_sync_error(error: Exception | str | None) -> str:
    """回傳可供 queue/API/log 使用的錯誤摘要，不暴露憑證路徑或原始 secrets。"""
    if error is None or error == "":
        return ""
    text = str(error).strip()
    lowered = text.lower()
    status = _http_status(error) if isinstance(error, BaseException) else None
    if status is not None:
        return f"Google API {status}"
    api_match = re.search(r"google api(?: error)?\s+(\d{3})", lowered)
    if api_match:
        return f"Google API {api_match.group(1)}"
    http_match = re.search(r"httperror\s+(\d{3})", lowered)
    if http_match:
        return f"HttpError {http_match.group(1)}"
    if lowered == "timeout":
        return "timeout"
    if lowered == "invalid_grant":
        return "invalid_grant"
    if any(token in lowered for token in (
        "no such file", "credential", "service account", "private_key", "private key",
    )):
        return "Credential file unavailable"
    if "network down" in lowered:
        return "network down"
    if any(token in lowered for token in (
        "network", "timed out", "timeout", "connection reset", "connection refused",
    )):
        return "Network error"
    if isinstance(error, BaseException):
        return f"{type(error).__name__}: sync operation failed"
    return "Sync operation failed"


def stable_event_id(appt_id: int, key_id: int) -> str:
    """為 appointment+key 產生合法且跨 process 穩定的 Google event id。"""
    return hashlib.sha256(f"hvac:{appt_id}:{key_id}".encode("ascii")).hexdigest()


@contextmanager
def _named_process_lock(lock_name: str):
    """跨 process 使用具名 lock file 序列化 remote I/O。"""
    lock_dir = Path(tempfile.gettempdir()) / "hvac-gcal-sync-locks"
    lock_dir.mkdir(parents=True, exist_ok=True)
    handle = (lock_dir / f"{lock_name}.lock").open("a+b")
    acquired = False
    try:
        handle.seek(0, os.SEEK_END)
        if handle.tell() == 0:
            handle.write(b"0")
            handle.flush()
        handle.seek(0)
        if os.name == "nt":
            import msvcrt
            msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, 1)
        else:
            import fcntl
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        acquired = True
        yield
    finally:
        if acquired:
            handle.seek(0)
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        handle.close()


@contextmanager
def _key_process_lock(key_id: int):
    """跨 process 序列化同一 Key 的 remote I/O 與刪除。"""
    with _named_process_lock(f"key-{key_id}"):
        yield


@contextmanager
def _event_process_lock(appt_id: int, key_id: int):
    """跨 process 序列化同一 Event 的 remote I/O，不持有 SQLite transaction。"""
    with _named_process_lock(stable_event_id(appt_id, key_id)):
        yield


def is_enabled() -> bool:
    """gcal_keys 是否有任一啟用 key（call-time 查，測試可 monkeypatch）"""
    conn = get_db()
    try:
        row = conn.execute("SELECT COUNT(*) AS c FROM gcal_keys WHERE is_active=1").fetchone()
        return row["c"] > 0
    finally:
        conn.close()


def _add_minutes(hhmm: str, minutes: int) -> str:
    """時間字串加 N 分鐘（迴圈 24h）"""
    h, m = int(hhmm[:2]), int(hhmm[3:])
    total = (h * 60 + m + minutes) % (24 * 60)
    return f"{total // 60:02d}:{total % 60:02d}"


def build_event(appt_row: dict, assignees: List[dict], settings: dict = None) -> dict:
    """純函式：本地行程 → Google Event。assignees 用既有 [{id,name,color}] 形狀。
    settings: {duration_min, reminders, use_location, transparency}
    """
    # 設定值（fallback 到預設）
    duration = (settings or {}).get("duration_min", DEFAULT_DURATION_MIN)
    reminders = (settings or {}).get("reminders", [])
    use_location = (settings or {}).get("use_location", True)
    transparency = (settings or {}).get("transparency", "transparent")

    client = appt_row["client_name"] or ""
    svc = appt_row.get("service_name") or ""
    summary = f"{client}｜{svc}" if svc else client
    lines = []
    # address 只有在 use_location=False 時才放入 description；否則由下方
    # event["location"] 專欄承載，避免 Google Calendar 同時出現兩份地址。
    if not use_location and appt_row.get("address"):
        lines.append(f"地址：{appt_row['address']}")
    owners = "、".join(
        name for name in ((a.get("name") or a.get("display_name") or "") for a in assignees) if name
    )
    if owners:
        lines.append(f"人員：{owners}")
    if appt_row.get("note"):
        lines.append(f"備註：{appt_row['note']}")
    description = "\n".join(lines)
    start_time = (appt_row.get("start_time") or "").strip()
    end_time = (appt_row.get("end_time") or "").strip()
    date = appt_row["date"]
    # 預設起始/截止時間（未填時用 08:00 + duration_min）
    DEFAULT_START = "08:00"
    if not start_time:
        start_time = DEFAULT_START
    if not end_time:
        end_time = _add_minutes(start_time, duration)
    # 確保 end > start
    if end_time <= start_time:
        end_time = _add_minutes(start_time, duration)
    event = {
        "summary": summary,
        "description": description,
        "start": {"dateTime": f"{date}T{start_time}:00", "timeZone": TZ},
        "end": {"dateTime": f"{date}T{end_time}:00", "timeZone": TZ},
        "transparency": transparency,
    }
    # location 欄位
    if use_location and appt_row.get("address"):
        event["location"] = appt_row["address"]
    # reminders
    if reminders:
        event["reminders"] = {"useDefault": False, "overrides": reminders}
    return event


def resolve_target_keys(conn, appt_id: int) -> List[int]:
    """依指派人員解析同步 targets；只有完全無指派才 fallback 全部 active keys。"""
    assignees = conn.execute(
        "SELECT u.is_active, u.gcal_key FROM appointment_assignees aa "
        "JOIN users u ON u.id=aa.user_id WHERE aa.appointment_id=?",
        (appt_id,),
    ).fetchall()
    if not assignees:
        all_keys = conn.execute(
            "SELECT id FROM gcal_keys WHERE is_active=1 "
            "AND COALESCE(pending_calendar_id,'')=''"
        ).fetchall()
        return [r["id"] for r in all_keys]
    keys = sorted({
        row["gcal_key"] for row in assignees
        if row["is_active"] and row["gcal_key"]
    })
    if not keys:
        return []
    placeholders = ",".join("?" * len(keys))
    got = conn.execute(
        f"SELECT id FROM gcal_keys WHERE is_active=1 AND name IN ({placeholders})",
        keys,
    ).fetchall()
    return [r["id"] for r in got]


def resolve_assigned_key_ids(conn, appt_id: int) -> List[int]:
    """回傳目前 assignee 綁定的 Key 關係；不套 active/migration target gate。"""
    rows = conn.execute(
        "SELECT DISTINCT k.id FROM appointment_assignees aa "
        "JOIN users u ON u.id=aa.user_id JOIN gcal_keys k ON k.name=u.gcal_key "
        "WHERE aa.appointment_id=? AND u.gcal_key<>''",
        (appt_id,),
    ).fetchall()
    return [row["id"] for row in rows]


def resolve_effective_target_keys(conn, appt_id: int) -> List[int]:
    """同步與一般 retry 共用的有效 target：active 且未進行 Calendar migration。"""
    target_ids = resolve_target_keys(conn, appt_id)
    if not target_ids:
        return []
    placeholders = ",".join("?" * len(target_ids))
    rows = conn.execute(
        "SELECT id FROM gcal_keys WHERE is_active=1 "
        "AND COALESCE(pending_calendar_id,'')='' "
        f"AND id IN ({placeholders})",
        target_ids,
    ).fetchall()
    return [row["id"] for row in rows]


def existing_queue_key_ids(conn, appt_id: int, candidate_key_ids) -> list[int]:
    """回傳 appointment 上實際存在的 queue key，供 status 與 reset 共用。"""
    ids = sorted({int(key_id) for key_id in candidate_key_ids})
    if not ids:
        return []
    placeholders = ",".join("?" * len(ids))
    rows = conn.execute(
        "SELECT DISTINCT key_id FROM appointment_sync_queue "
        "WHERE appointment_id=? AND key_id IN (" + placeholders + ")",
        [appt_id, *ids],
    ).fetchall()
    return sorted({row["key_id"] for row in rows})


def get_service_for_key(key_row):
    """對單一 key 建 google service。key_row 含 credentials_path / calendar_id。"""
    from google.oauth2 import service_account
    from googleapiclient.discovery import build
    creds = service_account.Credentials.from_service_account_file(
        key_row["credentials_path"], scopes=["https://www.googleapis.com/auth/calendar"])
    return build("calendar", "v3", credentials=creds)


def _load_appointment_for_sync(conn, appt_id):
    """載入行程 + 指派人，回傳 (appt_dict, assignees_list)"""
    row = conn.execute("SELECT * FROM appointments WHERE id=?", (appt_id,)).fetchone()
    if row is None:
        raise AppointmentNotFoundForSync(appt_id)
    svc = None
    if row["service_type_id"]:
        svc = conn.execute("SELECT name FROM service_types WHERE id=?",
                           (row["service_type_id"],)).fetchone()
    assignees = conn.execute(
        "SELECT u.id, u.display_name AS name, u.color FROM appointment_assignees aa "
        "JOIN users u ON u.id=aa.user_id WHERE aa.appointment_id=?", (appt_id,)).fetchall()
    return ({"client_name": row["client_name"], "service_name": svc["name"] if svc else None,
             "address": row["address"] or "", "date": row["date"],
             "start_time": row["start_time"], "end_time": row["end_time"],
             "note": row["note"] or ""},
            [dict(a) for a in assignees])


def load_sync_settings(conn) -> dict:
    """從 gcal_sync_settings 讀取全域設定，回傳 dict。"""
    rows = conn.execute("SELECT key, value FROM gcal_sync_settings").fetchall()
    s = {}
    for r in rows:
        v = r["value"]
        if r["key"] == "gcal_use_location":
            s["use_location"] = v == "1"
        elif r["key"] == "gcal_default_duration_min":
            s["duration_min"] = int(v)
        elif r["key"] == "gcal_transparency":
            s["transparency"] = v
        elif r["key"] == "gcal_sync_interval_min":
            s["sync_interval_min"] = int(v)
    return s


def parse_popup_reminders(raw_or_list) -> list:
    """解析並限制每把 Key 的 Popup reminders，統一 API 與同步端契約。"""
    if isinstance(raw_or_list, str):
        try:
            raw_or_list = json.loads(raw_or_list or "[]")
        except (TypeError, json.JSONDecodeError):
            return []
    if not isinstance(raw_or_list, list):
        return []
    return [
        item for item in raw_or_list
        if isinstance(item, dict)
        and item.get("method") == "popup"
        and isinstance(item.get("minutes"), int)
        and not isinstance(item.get("minutes"), bool)
        and 0 <= item["minutes"] <= 40320
    ][:5]


def load_key_reminders(key_row) -> list:
    """從 key_row 讀取 per-key reminders JSON，回傳 Popup list。"""
    if hasattr(key_row, "keys"):
        raw = key_row["reminders"] if "reminders" in key_row.keys() else "[]"
    else:
        raw = key_row.get("reminders") or "[]"
    return parse_popup_reminders(raw or "[]")


def load_event_payload(conn, appt_id: int, key_row) -> tuple[dict, str]:
    """載入行程、全域設定與 per-key reminders，回傳 (final_event, payload_hash)。"""
    appt_row, assignees = _load_appointment_for_sync(conn, appt_id)
    settings = load_sync_settings(conn)
    key_reminders = load_key_reminders(key_row)
    if key_reminders:
        settings["reminders"] = key_reminders
    event = build_event(appt_row, assignees, settings)
    return event, canonical_event_hash(event)


def enqueue_existing_mappings(
    key_id: int | None = None,
    appointment_ids=None,
) -> int:
    """將 active key 的既有 mapping 安全標成 U。

    ``appointment_ids`` 讓外鍵/字典等會影響 Event payload 的變更只失效
    受影響的 mappings；D queue 代表已失去目標指派，不能被復活成 U。
    hash 由同步時決定是否真的 PATCH。
    """
    if appointment_ids is not None:
        appointment_ids = list(appointment_ids)
        if not appointment_ids:
            return 0
    conn = get_db()
    count = 0
    try:
        batches = [None]
        if appointment_ids is not None:
            batches = [appointment_ids[i:i + 400] for i in range(0, len(appointment_ids), 400)]
        version = sync_version_now()
        for batch in batches:
            where = ["k.is_active=1", "COALESCE(k.pending_calendar_id,'')=''"]
            params = []
            if key_id is not None:
                where.append("m.key_id=?")
                params.append(key_id)
            if batch is not None:
                placeholders = ",".join("?" * len(batch))
                where.append(f"m.appointment_id IN ({placeholders})")
                params.extend(batch)
            rows = conn.execute(
                "SELECT m.appointment_id, m.key_id, m.google_event_id "
                "FROM appointment_gcal_map m JOIN gcal_keys k ON k.id=m.key_id "
                "WHERE " + " AND ".join(where),
                params,
            ).fetchall()
            for row in rows:
                existing = conn.execute(
                    "SELECT op_type FROM appointment_sync_queue WHERE appointment_id=? AND key_id=?",
                    (row["appointment_id"], row["key_id"]),
                ).fetchone()
                if existing and existing["op_type"] == "D":
                    continue
                conn.execute(
                    "INSERT INTO appointment_sync_queue "
                    "(appointment_id,key_id,op_type,google_event_id,last_modified_at,attempts,last_error) "
                    "VALUES(?,?, 'U', ?, ?, 0, '') "
                    "ON CONFLICT(appointment_id,key_id) DO UPDATE SET "
                    "op_type='U', google_event_id=excluded.google_event_id, "
                    "last_modified_at=excluded.last_modified_at, attempts=0, last_error=''",
                    (row["appointment_id"], row["key_id"], row["google_event_id"] or "", version),
                )
                count += 1
        conn.commit()
        return count
    finally:
        conn.close()

def recover_pending_calendar_migrations() -> int:
    """為 pending migration 補回 map 對應的 old Calendar D queue。"""
    conn = get_db()
    recovered = 0
    try:
        keys = conn.execute(
            "SELECT id FROM gcal_keys WHERE pending_calendar_id IS NOT NULL"
        ).fetchall()
        version = sync_version_now()
        for key in keys:
            mappings = conn.execute(
                "SELECT appointment_id, google_event_id FROM appointment_gcal_map "
                "WHERE key_id=? AND COALESCE(google_event_id,'')<>''",
                (key["id"],),
            ).fetchall()
            for mapping in mappings:
                existing = conn.execute(
                    "SELECT op_type, google_event_id FROM appointment_sync_queue "
                    "WHERE appointment_id=? AND key_id=?",
                    (mapping["appointment_id"], key["id"]),
                ).fetchone()
                if existing and existing["op_type"] == "D":
                    if not existing["google_event_id"]:
                        conn.execute(
                            "UPDATE appointment_sync_queue SET google_event_id=? "
                            "WHERE appointment_id=? AND key_id=?",
                            (mapping["google_event_id"], mapping["appointment_id"], key["id"]),
                        )
                    continue
                if existing:
                    conn.execute(
                        "UPDATE appointment_sync_queue SET op_type='D', google_event_id=? "
                        "WHERE appointment_id=? AND key_id=?",
                        (mapping["google_event_id"], mapping["appointment_id"], key["id"]),
                    )
                else:
                    conn.execute(
                        "INSERT INTO appointment_sync_queue "
                        "(appointment_id,key_id,op_type,google_event_id,last_modified_at,attempts,last_error) "
                        "VALUES(?,?, 'D', ?, ?, 0, '')",
                        (mapping["appointment_id"], key["id"], mapping["google_event_id"], version),
                    )
                recovered += 1
        conn.commit()
        return recovered
    finally:
        conn.close()


def calendar_migration_pending(key_row) -> bool:
    """pending_calendar_id 存在時，Key 仍在舊 Calendar cleanup migration。"""
    if hasattr(key_row, "keys"):
        return bool(key_row["pending_calendar_id"]) if "pending_calendar_id" in key_row.keys() else False
    return bool((key_row or {}).get("pending_calendar_id"))


def maybe_finalize_calendar_migration(key_id: int) -> bool:
    """D queue 全部完成後切換 Calendar，並只在新 Calendar 上 backfill。"""
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT id, is_active, calendar_id, pending_calendar_id FROM gcal_keys WHERE id=?",
            (key_id,),
        ).fetchone()
        if row is None or not row["pending_calendar_id"]:
            return False
        if conn.execute(
            "SELECT 1 FROM appointment_gcal_map WHERE key_id=? LIMIT 1", (key_id,)
        ).fetchone() is not None:
            return False
        if conn.execute(
            "SELECT 1 FROM appointment_sync_queue WHERE key_id=? AND op_type='D' LIMIT 1",
            (key_id,),
        ).fetchone() is not None:
            return False
        target = row["pending_calendar_id"]
        conn.execute(
            "UPDATE gcal_keys SET calendar_id=?, pending_calendar_id=NULL WHERE id=?",
            (target, key_id),
        )
        # Backfill 使用同一 transaction；任何 queue 寫入失敗都 rollback Calendar 切換。
        from app.routes import gcal_keys
        gcal_keys._backfill_all_appointments_with_conn(conn, key_id)
        conn.commit()
    except Exception:
        conn.rollback()
        return False
    finally:
        conn.close()

    # Import lazily to avoid the existing routes -> service import cycle.
    from app.routes import gcal_keys
    gcal_keys._wake_scheduler()
    return True


def _queue_delete_for_missing_appointment(appt_id: int, key_id: int, google_event_id: str) -> bool:
    """若本地行程在 remote C/U 後消失，建立/補全 D queue 避免遠端 orphan。"""
    if not google_event_id:
        return False
    conn = get_db()
    try:
        if conn.execute("SELECT 1 FROM appointments WHERE id=?", (appt_id,)).fetchone() is not None:
            return False
        version = sync_version_now()
        existing = conn.execute(
            "SELECT op_type FROM appointment_sync_queue WHERE appointment_id=? AND key_id=?",
            (appt_id, key_id),
        ).fetchone()
        if existing and existing["op_type"] == "D":
            conn.execute(
                "UPDATE appointment_sync_queue SET google_event_id=CASE "
                "WHEN COALESCE(google_event_id,'')='' THEN ? ELSE google_event_id END "
                "WHERE appointment_id=? AND key_id=?",
                (google_event_id, appt_id, key_id),
            )
        elif existing:
            conn.execute(
                "UPDATE appointment_sync_queue SET op_type='D', google_event_id=?, "
                "last_modified_at=?, attempts=0, last_error='' "
                "WHERE appointment_id=? AND key_id=?",
                (google_event_id, version, appt_id, key_id),
            )
        else:
            conn.execute(
                "INSERT INTO appointment_sync_queue "
                "(appointment_id,key_id,op_type,google_event_id,last_modified_at,attempts,last_error) "
                "VALUES(?,?, 'D', ?, ?, 0, '')",
                (appt_id, key_id, google_event_id, version),
            )
        conn.commit()
        return True
    finally:
        conn.close()


def verify_remote_event_reminders(service, calendar_id: str, event_id: str) -> dict:
    """診斷用：讀回 Google remote Event 的 reminders，不更換認證架構。"""
    remote = service.events().get(calendarId=calendar_id, eventId=event_id).execute()
    reminders = remote.get("reminders") if isinstance(remote, dict) else None
    return reminders if isinstance(reminders, dict) else {}


# 速率限制：動態分配（per-user 600/分鐘，專案級 10000/分鐘）
# 取 80% 安全邊際：per-user 480、專案級 8000
_RATE_PER_USER = 480       # 每個 SA 每分鐘上限
_RATE_PROJECT = 8000       # 專案級每分鐘上限（80%）
_RATE_WINDOW = 60          # 秒
_SYNC_LOCK = threading.RLock()


def sync_pending(due: List[dict]) -> Tuple[int, int, dict]:
    """以 process-level lock 序列化所有同步 caller，避免 duplicate insert/patch。"""
    with _SYNC_LOCK:
        return _sync_pending_unlocked(due)


def _sync_pending_unlocked(due: List[dict]) -> Tuple[int, int, dict]:
    """對 due（每列對應一個 appointment + key）逐列同步。

    網路呼叫永遠在 SQLite 連線關閉後執行；C/U 先以 canonical payload hash
    比對既有 map，hash 相同時只收斂 queue，不重複 PATCH/INSERT。
    """
    if not due:
        return 0, 0, {}

    ok = fail = 0
    error_summary = {}
    conn = get_db()
    try:
        key_rows = {
            r["id"]: dict(r)
            for r in conn.execute("SELECT * FROM gcal_keys WHERE is_active=1").fetchall()
        }
    finally:
        conn.close()
    svc_cache = {}
    rate_timestamps = {}

    import time as _time

    for item in due:
        appt_id = item["appointment_id"]
        key_id = item["key_id"]
        op = item["op_type"]
        gid = item.get("google_event_id") or ""
        la_orig = item.get("last_modified_at") or ""
        cal_id = ""
        with _key_process_lock(key_id):
            fresh_conn = get_db()
            try:
                fresh_key_row = fresh_conn.execute(
                    "SELECT * FROM gcal_keys WHERE id=? AND is_active=1", (key_id,)
                ).fetchone()
            finally:
                fresh_conn.close()
            if fresh_key_row is None:
                continue
            key_row = dict(fresh_key_row)
            if calendar_migration_pending(key_row) and op != "D":
                # Migration cleanup owns the old Calendar; C/U must wait for finalize.
                continue
            with _event_process_lock(appt_id, key_id):
                try:
                    cal_id = key_row["calendar_id"]
                    svc = svc_cache.get(key_id)
                    if svc is None:
                        svc = get_service_for_key(key_row)
                        svc_cache[key_id] = svc

                    num_keys = len(key_rows)
                    per_key_limit = min(_RATE_PER_USER, _RATE_PROJECT // max(num_keys, 1))
                    now_ts = _time.time()
                    timestamps = rate_timestamps.get(key_id, [])
                    timestamps = [t for t in timestamps if now_ts - t < _RATE_WINDOW]
                    if len(timestamps) >= per_key_limit:
                        wait = _RATE_WINDOW - (now_ts - timestamps[0])
                        if wait > 0:
                            logger.info("速率限制：key=%s（%d/%d）等待 %.0f 秒",
                                        key_id, len(timestamps), per_key_limit, wait)
                            _time.sleep(wait)
                        timestamps = [t for t in timestamps if _time.time() - t < _RATE_WINDOW]

                    event = None
                    current_hash = None
                    map_row = None
                    created_new = False
                    if op in ("C", "U"):
                        pc = get_db()
                        try:
                            event, current_hash = load_event_payload(pc, appt_id, key_row)
                            map_row = pc.execute(
                                "SELECT google_event_id, data_hash FROM appointment_gcal_map "
                                "WHERE appointment_id=? AND key_id=?", (appt_id, key_id)
                            ).fetchone()
                            if not gid and map_row:
                                gid = map_row["google_event_id"] or ""
                        finally:
                            pc.close()

                        if map_row and map_row["google_event_id"] and map_row["data_hash"] == current_hash:
                            # payload 已是 Google 端最後一次成功同步的內容；只收斂目前 queue。
                            wc = get_db()
                            try:
                                wc.execute(
                                    "DELETE FROM appointment_sync_queue "
                                    "WHERE appointment_id=? AND key_id=? AND last_modified_at=? AND op_type=?",
                                    (appt_id, key_id, la_orig, op),
                                )
                                wc.commit()
                            finally:
                                wc.close()
                            ok += 1
                            continue

                        if gid:
                            svc.events().patch(calendarId=cal_id, eventId=gid, body=event).execute()
                        else:
                            stable_id = stable_event_id(appt_id, key_id)
                            # 2026-09-16 fix：events().insert() 的 Python client 不接受
                            # eventId keyword argument（會抛 TypeError）。
                            # 正確做法是把 stable_id 放入 Event body 的 id 欄位，
                            # REST API 會以該 id 建立 event（官方文件明確支援）。
                            # 多 process 同時 C 時，先成功者已建立相同 ID → 409 → 改 patch 收斂。
                            event_with_id = dict(event)
                            event_with_id["id"] = stable_id
                            try:
                                created = svc.events().insert(
                                    calendarId=cal_id, body=event_with_id
                                ).execute()
                            except Exception as insert_error:
                                if _http_status(insert_error) != 409:
                                    raise
                                svc.events().patch(
                                    calendarId=cal_id, eventId=stable_id, body=event
                                ).execute()
                                gid = stable_id
                            else:
                                gid = (created.get("id") if isinstance(created, dict) else None) or stable_id
                                created_new = True
                        timestamps.append(_time.time())
                        rate_timestamps[key_id] = timestamps
                    elif op == "D":
                        if gid:
                            svc.events().delete(calendarId=cal_id, eventId=gid).execute()
                            timestamps.append(_time.time())
                            rate_timestamps[key_id] = timestamps
                    else:
                        continue

                    # C insert 先把 remote id 寫回 queue；若接著 map upsert 失敗，
                    # 下一輪可由 queue 的 id 改用 patch，避免再次 insert duplicate event。
                    if created_new:
                        checkpoint = get_db()
                        try:
                            checkpoint.execute(
                                "UPDATE appointment_sync_queue SET google_event_id=? "
                                "WHERE appointment_id=? AND key_id=? AND last_modified_at=? "
                                "AND op_type='C' AND COALESCE(google_event_id,'')=''",
                                (gid, appt_id, key_id, la_orig),
                            )
                            checkpoint.commit()
                        finally:
                            checkpoint.close()

                    if op in ("C", "U") and _queue_delete_for_missing_appointment(appt_id, key_id, gid):
                        ok += 1
                        continue

                    wc = get_db()
                    try:
                        # 只在 queue 仍是本次 snapshot 的同一版本時寫 map/刪 queue。
                        # BEGIN IMMEDIATE 只包本地短 DB 操作，不跨 Google network call。
                        wc.execute("BEGIN IMMEDIATE")
                        current_queue = wc.execute(
                            "SELECT op_type, last_modified_at, google_event_id "
                            "FROM appointment_sync_queue WHERE appointment_id=? AND key_id=?",
                            (appt_id, key_id),
                        ).fetchone()
                        is_current = bool(
                            current_queue
                            and current_queue["last_modified_at"] == la_orig
                            and current_queue["op_type"] == op
                        )
                        if is_current and op in ("C", "U"):
                            wc.execute(
                                "INSERT INTO appointment_gcal_map(appointment_id, key_id, google_event_id, data_hash) "
                                "VALUES(?,?,?,?) ON CONFLICT(appointment_id, key_id) DO UPDATE SET "
                                "google_event_id=excluded.google_event_id, data_hash=excluded.data_hash, synced_at=datetime('now')",
                                (appt_id, key_id, gid, current_hash),
                            )
                        elif is_current and op == "D":
                            wc.execute(
                                "DELETE FROM appointment_gcal_map WHERE appointment_id=? AND key_id=?",
                                (appt_id, key_id),
                            )
                        elif (
                            op == "D"
                            and current_queue
                            and current_queue["op_type"] in ("C", "U")
                            and current_queue["google_event_id"] in ("", gid)
                        ):
                            # 舊 D 已刪掉 remote event，但較新的 C/U 還要重建；
                            # 清掉它持有的 remote id，避免下一輪對已刪 Event 做 patch。
                            wc.execute(
                                "UPDATE appointment_sync_queue SET google_event_id='' "
                                "WHERE appointment_id=? AND key_id=? AND last_modified_at=? "
                                "AND op_type IN ('C','U') AND google_event_id=?",
                                (appt_id, key_id, current_queue["last_modified_at"], gid),
                            )
                            wc.execute(
                                "DELETE FROM appointment_gcal_map WHERE appointment_id=? AND key_id=?",
                                (appt_id, key_id),
                            )
                        # 版本不符時這個 DELETE 不會吞掉 newer queue；C/U 也不覆蓋 newer map。
                        wc.execute(
                            "DELETE FROM appointment_sync_queue "
                            "WHERE appointment_id=? AND key_id=? AND last_modified_at=? AND op_type=?",
                            (appt_id, key_id, la_orig, op),
                        )
                        wc.commit()
                    finally:
                        wc.close()
                    ok += 1
                    if op == "D":
                        maybe_finalize_calendar_migration(key_id)
                except Exception as e:
                    # map upsert 與本地 delete 之間仍可能有極窄 race；若 remote side effect
                    # 已完成，先補 D queue，再進一般錯誤分類，避免把 orphan 當成 resolved。
                    if op in ("C", "U") and gid:
                        try:
                            if _queue_delete_for_missing_appointment(appt_id, key_id, gid):
                                ok += 1
                                continue
                        except Exception as cleanup_error:
                            logger.error(
                                "gcal remote event cleanup queue 建立失敗 appointment=%s key=%s: %s",
                                appt_id, key_id, safe_sync_error(cleanup_error),
                            )
                    outcome = classify_sync_exception(op, e)
                    if outcome != "failed":
                        resolved = get_db()
                        try:
                            resolved.execute("BEGIN IMMEDIATE")
                            current_queue = resolved.execute(
                                "SELECT op_type, last_modified_at, google_event_id "
                                "FROM appointment_sync_queue WHERE appointment_id=? AND key_id=?",
                                (appt_id, key_id),
                            ).fetchone()
                            is_current = bool(
                                current_queue
                                and current_queue["last_modified_at"] == la_orig
                                and current_queue["op_type"] == op
                            )
                            if outcome == "remote_already_deleted":
                                if is_current and op == "D":
                                    resolved.execute(
                                        "DELETE FROM appointment_gcal_map WHERE appointment_id=? AND key_id=?",
                                        (appt_id, key_id),
                                    )
                                elif (
                                    current_queue
                                    and current_queue["op_type"] in ("C", "U")
                                    and current_queue["google_event_id"] in ("", gid)
                                ):
                                    # 舊 D 已確認 remote id 不存在；新的 C/U 必須重新 insert。
                                    resolved.execute(
                                        "UPDATE appointment_sync_queue SET google_event_id='' "
                                        "WHERE appointment_id=? AND key_id=? AND last_modified_at=? "
                                        "AND op_type IN ('C','U') AND google_event_id IN ('', ?)",
                                        (appt_id, key_id, current_queue["last_modified_at"], gid),
                                    )
                                    resolved.execute(
                                        "DELETE FROM appointment_gcal_map WHERE appointment_id=? AND key_id=?",
                                        (appt_id, key_id),
                                    )
                            resolved.execute(
                                "DELETE FROM appointment_sync_queue "
                                "WHERE appointment_id=? AND key_id=? AND last_modified_at=? AND op_type=?",
                                (appt_id, key_id, la_orig, op),
                            )
                            resolved.commit()
                        finally:
                            resolved.close()
                        _record_resolution(error_summary, key_id, cal_id, outcome,
                                           key_row.get("name", "") if key_row else "")
                        if outcome == "remote_already_deleted":
                            ok += 1
                            if op == "D":
                                maybe_finalize_calendar_migration(key_id)
                        continue

                    logger.warning("gcal 同步失敗 appointment=%s key=%s (%s) cal=%s: %s", appt_id, key_id, op, cal_id, safe_sync_error(e))
                    err_type = safe_sync_error(e)
                    if key_id not in error_summary:
                        error_summary[key_id] = {
                            "key_name": key_row.get("name", "") if key_row else "",
                            "cal_id": cal_id,
                            "errors": {},
                            "resolved": {},
                        }
                    error_summary[key_id]["errors"][err_type] = (
                        error_summary[key_id]["errors"].get(err_type, 0) + 1
                    )
                    wc = get_db()
                    try:
                        wc.execute(
                            "UPDATE appointment_sync_queue SET attempts=attempts+1, last_error=? "
                            "WHERE appointment_id=? AND key_id=? AND last_modified_at=?",
                            (safe_sync_error(e), appt_id, key_id, la_orig),
                        )
                        wc.commit()
                    finally:
                        wc.close()
                    fail += 1
    return ok, fail, error_summary
