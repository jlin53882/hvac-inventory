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
import logging
from typing import List, Tuple

from app.database import get_db

logger = logging.getLogger(__name__)

TZ = "Asia/Taipei"
DEFAULT_DURATION_MIN = 60


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


def build_event(appt_row: dict, assignees: List[dict]) -> dict:
    """純函式：本地行程 → Google Event。assignees 用既有 [{id,name,color}] 形狀。"""
    client = appt_row["client_name"] or ""
    svc = appt_row.get("service_name") or ""
    summary = f"{client}｜{svc}" if svc else client
    lines = []
    if appt_row.get("address"):
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
    if start_time and end_time:
        end = end_time if end_time > start_time else _add_minutes(start_time, DEFAULT_DURATION_MIN)
        return {"summary": summary, "description": description,
                "start": {"dateTime": f"{date}T{start_time}:00", "timeZone": TZ},
                "end": {"dateTime": f"{date}T{end}:00", "timeZone": TZ}}
    return {"summary": summary, "description": description,
            "start": {"date": date}, "end": {"date": date}}


def resolve_target_keys(conn, appt_id: int) -> List[int]:
    """Multi-Key：行程指派人員綁定的 gcal_key 集合 → 目標 key_id 清單。"""
    rows = conn.execute(
        "SELECT DISTINCT u.gcal_key FROM appointment_assignees aa "
        "JOIN users u ON u.id=aa.user_id "
        "WHERE aa.appointment_id=? AND u.gcal_key<>''", (appt_id,)).fetchall()
    keys = [r["gcal_key"] for r in rows]
    if not keys:
        return []
    placeholders = ",".join("?" * len(keys))
    got = conn.execute(
        f"SELECT id FROM gcal_keys WHERE is_active=1 AND name IN ({placeholders})",
        keys).fetchall()
    return [r["id"] for r in got]


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


def sync_pending(due: List[dict]) -> Tuple[int, int]:
    """對 due（[{appointment_id, key_id, op_type, google_event_id, last_modified_at}]）
    每列對應一 key，逐列同步。回傳 (成功, 失敗)。

    家豪二輪：成功刪隊列帶 last_modified_at 版本條件，不吞同步途中新編輯。
    A3：網路呼叫在交易外，讀寫用獨立短連線，不持 SQLite 寫鎖跨網路。
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

            if op in ("C", "U"):
                pc = get_db()
                try:
                    appt_row, assignees = _load_appointment_for_sync(pc, appt_id)
                finally:
                    pc.close()
                event = build_event(appt_row, assignees)
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
                else:
                    created = svc.events().insert(calendarId=cal_id, body=event).execute()
                    gid = created["id"]
            elif op == "D":
                if gid:
                    svc.events().delete(calendarId=cal_id, eventId=gid).execute()
            else:
                continue

            # 寫回 map + 刪隊列（帶版本條件）
            wc = get_db()
            try:
                if op in ("C", "U"):
                    wc.execute(
                        "INSERT INTO appointment_gcal_map(appointment_id, key_id, google_event_id) "
                        "VALUES(?,?,?) ON CONFLICT(appointment_id, key_id) DO UPDATE SET "
                        "google_event_id=excluded.google_event_id, synced_at=datetime('now')",
                        (appt_id, key_id, gid))
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
