# -*- coding: utf-8 -*-
"""
Google Calendar 單向同步（Multi-Key Service Account）
=====================================================
- build_event(appt_row, assignees) -> dict      純函式：本地行程 → Google Event
- get_service_for_key(key_row) -> service       對單一 key 建 service
- resolve_target_keys(conn, appt_id) -> [key_id] 依指派人員綁定的 key 解析目標（Multi-Key）
- sync_pending(due) -> (ok, fail)               批次同步（每列對應一 key）
- is_enabled() -> bool                          gcal_keys 有啟用 key 才 True
"""
import hashlib
import json
import logging
import os
from typing import List, Tuple

from app.database import get_db

logger = logging.getLogger(__name__)

# 同步 log 輸出到檔案
_log_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "logs")
os.makedirs(_log_dir, exist_ok=True)
_fh = logging.FileHandler(os.path.join(_log_dir, "gcal_sync.log"), encoding="utf-8")
_fh.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
logger.addHandler(_fh)
logger.setLevel(logging.INFO)

TZ = "Asia/Taipei"
DEFAULT_DURATION_MIN = 60


def compute_event_hash(appt_row: dict, assignees: list) -> str:
    """計算行程資料的 hash（用於比對是否需要同步）。"""
    payload = {
        "client": appt_row.get("client_name", ""),
        "date": appt_row.get("date", ""),
        "start": appt_row.get("start_time", ""),
        "end": appt_row.get("end_time", ""),
        "note": appt_row.get("note", ""),
        "svc": appt_row.get("service_type_id"),
        "users": sorted([a.get("user_id", a.get("id", 0)) for a in assignees]),
    }
    return hashlib.md5(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


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
    # location 欄位（拆出 address，不塞 description）
    if use_location and appt_row.get("address"):
        pass  # location 獨立欄位，不塞 description
    elif appt_row.get("address"):
        lines.append(f"地址：{appt_row['address']}")
    owners = "、".join(a["name"] for a in assignees)
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
    """Multi-Key：行程指派人員綁定的 gcal_key 集合 → 目標 key_id 清單。
    找不到綁 key 的指派人時，fallback 到所有啟用 key（家豪：全部同步）。"""
    rows = conn.execute(
        "SELECT DISTINCT u.gcal_key FROM appointment_assignees aa "
        "JOIN users u ON u.id=aa.user_id "
        "WHERE aa.appointment_id=? AND u.gcal_key<>''", (appt_id,)).fetchall()
    keys = [r["gcal_key"] for r in rows]
    if keys:
        placeholders = ",".join("?" * len(keys))
        got = conn.execute(
            f"SELECT id FROM gcal_keys WHERE is_active=1 AND name IN ({placeholders})",
            keys).fetchall()
        return [r["id"] for r in got]
    # fallback：所有啟用 key 都同步
    all_keys = conn.execute("SELECT id FROM gcal_keys WHERE is_active=1").fetchall()
    return [r["id"] for r in all_keys]


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
        raise KeyError(appt_id)
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


def load_key_reminders(key_row) -> list:
    """從 key_row 讀取 per-key reminders JSON，回傳 list。"""
    raw = key_row.get("reminders") or "[]"
    try:
        return json.loads(raw)
    except Exception:
        return []


# 速率限制：動態分配（per-user 600/分鐘，專案級 10000/分鐘）
# 取 80% 安全邊際：per-user 480、專案級 8000
_RATE_PER_USER = 480       # 每個 SA 每分鐘上限
_RATE_PROJECT = 8000       # 專案級每分鐘上限（80%）
_RATE_WINDOW = 60          # 秒

def sync_pending(due: List[dict]) -> Tuple[int, int]:
    """對 due（[{appointment_id, key_id, op_type, google_event_id, last_modified_at}]
    每列對應一 key，逐列同步。回傳 (成功, 失敗)。

    家豪二輪：成功刪隊列帶 last_modified_at 版本條件，不吞同步途中新編輯。
    A3：網路呼叫在交易外，讀寫用獨立短連線，不持 SQLite 寫鎖跨網路。
    R1：速率限制，每分鐘最多 _RATE_LIMIT 次 API 呼叫。
    """
    ok = fail = 0
    # 快取 key_row（一次載入全部啟用 key，避免每列重讀）
    conn = get_db()
    try:
        key_rows = {r["id"]: dict(r) for r in
                    conn.execute("SELECT * FROM gcal_keys WHERE is_active=1").fetchall()}
    finally:
        conn.close()
    svc_cache = {}

    # 速率限制追蹤（per-key）
    rate_timestamps = {}  # key_id -> [timestamp, ...]

    import time as _time

    for item in due:
        appt_id = item["appointment_id"]
        key_id = item["key_id"]
        op = item["op_type"]
        gid = item.get("google_event_id") or ""
        la_orig = item.get("last_modified_at") or ""
        try:
            key_row = key_rows.get(key_id)
            if key_row is None:
                # key 已停用/刪除 → 該列直接清（不阻塞其他）
                w = get_db()
                try:
                    w.execute("DELETE FROM appointment_sync_queue "
                              "WHERE appointment_id=? AND key_id=?", (appt_id, key_id))
                    w.commit()
                finally:
                    w.close()
                continue
            svc = svc_cache.get(key_id)
            if svc is None:
                svc = get_service_for_key(key_row)
                svc_cache[key_id] = svc
            cal_id = key_row["calendar_id"]

            # R1：動態速率限制（per-user + 專案級雙重檢查）
            # 每個 key 的上限 = min(per-user限制, 專案級/活躍key數)
            num_keys = len(key_rows)
            per_key_limit = min(_RATE_PER_USER, _RATE_PROJECT // max(num_keys, 1))
            now_ts = _time.time()
            timestamps = rate_timestamps.get(key_id, [])
            # 清除超過 1 分鐘的紀錄
            timestamps = [t for t in timestamps if now_ts - t < _RATE_WINDOW]
            if len(timestamps) >= per_key_limit:
                wait = _RATE_WINDOW - (now_ts - timestamps[0])
                if wait > 0:
                    logger.info("速率限制：key=%s（%d/%d）等待 %.0f 秒",
                                key_id, len(timestamps), per_key_limit, wait)
                    _time.sleep(wait)
                timestamps = [t for t in timestamps if _time.time() - t < _RATE_WINDOW]

            if op in ("C", "U"):
                pc = get_db()
                try:
                    appt_row, assignees = _load_appointment_for_sync(pc, appt_id)
                    # 載入全域設定 + per-key reminders
                    global_settings = load_sync_settings(pc)
                    key_reminders = load_key_reminders(key_row)
                    # per-key reminders 覆蓋全域（如有）
                    if key_reminders:
                        global_settings["reminders"] = key_reminders
                finally:
                    pc.close()
                event = build_event(appt_row, assignees, global_settings)
                # A2 冪等：C op 前也先查 map（insert 成功但 map 寫入失敗時重試不重複）
                if not gid:
                    mx = get_db()
                    try:
                        r = mx.execute("SELECT google_event_id FROM appointment_gcal_map "
                                       "WHERE appointment_id=? AND key_id=?", (appt_id, key_id)).fetchone()
                        gid = r["google_event_id"] if r else ""
                    finally:
                        mx.close()
                if gid:
                    svc.events().patch(calendarId=cal_id, eventId=gid, body=event).execute()
                    timestamps.append(_time.time())
                    rate_timestamps[key_id] = timestamps
                else:
                    created = svc.events().insert(calendarId=cal_id, body=event).execute()
                    gid = created["id"]
                    timestamps.append(_time.time())
                    rate_timestamps[key_id] = timestamps
            elif op == "D":
                if gid:
                    svc.events().delete(calendarId=cal_id, eventId=gid).execute()
                    timestamps.append(_time.time())
                    rate_timestamps[key_id] = timestamps
            else:
                continue

            # 寫回 map + 刪隊列（帶版本條件）
            wc = get_db()
            try:
                if op in ("C", "U"):
                    # 計算並存入 data_hash（用於下次比對）
                    hc = get_db()
                    try:
                        _ar = hc.execute(
                            "SELECT client_name, date, start_time, end_time, note, service_type_id "
                            "FROM appointments WHERE id=?", (appt_id,)).fetchone()
                        _aa = [{"user_id": a[0]} for a in hc.execute(
                            "SELECT user_id FROM appointment_assignees WHERE appointment_id=? ORDER BY user_id",
                            (appt_id,)).fetchall()]
                        cur_hash = compute_event_hash(
                            {"client_name": _ar[0], "date": _ar[1], "start_time": _ar[2],
                             "end_time": _ar[3], "note": _ar[4], "service_type_id": _ar[5]},
                            _aa)
                    finally:
                        hc.close()
                    wc.execute(
                        "INSERT INTO appointment_gcal_map(appointment_id, key_id, google_event_id, data_hash) "
                        "VALUES(?,?,?,?) ON CONFLICT(appointment_id, key_id) DO UPDATE SET "
                        "google_event_id=excluded.google_event_id, data_hash=excluded.data_hash, synced_at=datetime('now')",
                        (appt_id, key_id, gid, cur_hash))
                wc.execute(
                    "DELETE FROM appointment_sync_queue "
                    "WHERE appointment_id=? AND key_id=? AND last_modified_at=?",
                    (appt_id, key_id, la_orig))
                wc.commit()
            finally:
                wc.close()
            ok += 1
        except Exception as e:
            logger.warning("gcal 同步失敗 appointment=%s key=%s (%s): %s", appt_id, key_id, op, e)
            wc = get_db()
            try:
                wc.execute("UPDATE appointment_sync_queue SET attempts=attempts+1, last_error=? "
                           "WHERE appointment_id=? AND key_id=?", (str(e)[:300], appt_id, key_id))
                wc.commit()
            finally:
                wc.close()
            fail += 1
    return ok, fail
