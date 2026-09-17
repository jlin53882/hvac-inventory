# -*- coding: utf-8 -*-
"""
行事曆派工路由
==============
- GET  /api/appointments?year=&month=     月曆資料（該月全部行程）
- GET  /api/appointments?date=            當日明細
- POST /api/appointments                   新增（多指派人員 + 衝突檢查 409）
- PUT  /api/appointments/{id}              編輯（衝突檢查排除自己）
- DELETE /api/appointments/{id}            刪除
- GET  /api/appointments/export?date=      匯出工程日報表 xlsx（範本填值法）
- GET  /api/appointments/search?q=&date_from=&date_to=  搜尋行程

權限（RBAC 2026-08-13）：行事曆寫入掛 require_perm("cal-mgmt")（service-types 端點已移至 service_types.py）。衝突規則：同人同日時間重疊（start < 他end 且 end > 他start）。
"""
import datetime
import re
from typing import List

from fastapi import APIRouter, Depends, HTTPException

from app.database import get_db
from app.models import AppointmentIn
from app.services.auth import require_login, require_perm
from app.services.report import build_daily_report
from app.services.safety import xlsx_download
from app.services import gcal_sync

router = APIRouter()


def mark_sync_pending(appt_id: int, op: str, map_rows=()) -> None:
    """把行程標記待同步到所有目標 key。map_rows：刪除時帶 [(key_id, google_event_id)]。
    獨立短連線，失敗不影響主操作。
    A4：C/U op 每次都進 queue（hash-skip 已移除——queue 是暫態，不值得為省 row 引入 op_type 錯位風險）。"""
    # C/U 需要 active key 才有目標；D 則依賴保留下來的 map/event id，
    # 即使唯一 key 已停用也必須保留刪除任務，不能把本地刪除當成遠端成功。
    if op in ("C", "U") and not gcal_sync.is_enabled():
        return
    if op == "D" and not map_rows:
        return
    try:
        c = get_db()
        try:
            # Serialize the existence check and queue upsert with appointment writes.
            # A delayed C/U after DELETE must not resurrect the deleted appointment.
            c.execute("BEGIN IMMEDIATE")
            if op in ("C", "U"):
                if c.execute("SELECT 1 FROM appointments WHERE id=?", (appt_id,)).fetchone() is None:
                    c.rollback()
                    return
                keys = gcal_sync.resolve_effective_target_keys(c, appt_id)
            else:  # D
                keys = [r[0] for r in map_rows] if map_rows else []
            version = gcal_sync.sync_version_now()
            for key_id in keys:
                gid = next((g for (k, g) in map_rows if k == key_id), "") if map_rows else ""
                c.execute(
                    "INSERT INTO appointment_sync_queue(appointment_id, key_id, op_type,"
                    " google_event_id, last_modified_at, attempts, last_error) "
                    " VALUES(?,?,?,?,?,0,'') "
                    " ON CONFLICT(appointment_id, key_id) DO UPDATE SET "
                    " op_type=excluded.op_type, google_event_id=excluded.google_event_id,"
                    " last_modified_at=excluded.last_modified_at, attempts=0, last_error=''",
                    (appt_id, key_id, op, gid, version))
            c.commit()
        finally:
            c.close()
        # queue 已提交後只喚醒既有 worker；normal run 仍遵守 debounce。
        from app.services import sync_scheduler
        sync_scheduler.start()
        sync_scheduler.wake()
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning(
            "gcal 同步標記失敗 appointment=%s (%s): %s", appt_id, op, gcal_sync.safe_sync_error(e)
        )


_TIME_RE = re.compile(r"^\d{2}:\d{2}$")
_QUERY_CHUNK_SIZE = 500


def _id_chunks(ids):
    values = list(ids)
    for start in range(0, len(values), _QUERY_CHUNK_SIZE):
        yield values[start:start + _QUERY_CHUNK_SIZE]


def _validate_time(start_time: str, end_time: str) -> None:
    """起訖時間合理性：格式必須 HH:MM 且時間序正確（2026-08-12 補格式驗證——
    原本零驗證讓任意字串（含 XSS payload）直接入庫）。
    2026-08-14 Sarah：派工時間選填——兩欄皆空 = 未指定時間（不做格式/時間序檢查）；
    只填一欄 = 400（時間要嘛完整填寫要嘛留空）"""
    start_time = start_time or ""
    end_time = end_time or ""
    if not start_time and not end_time:
        return
    if bool(start_time) != bool(end_time):
        raise HTTPException(400, "派工時間請完整填寫（開始與結束）或留空")
    for label, t in (("開始", start_time), ("結束", end_time)):
        if not _TIME_RE.match(t):
            raise HTTPException(400, f"{label}時間格式需為 HH:MM（如 09:00）")
        h, m = int(t[:2]), int(t[3:])
        if not (0 <= h <= 23 and 0 <= m <= 59):
            raise HTTPException(400, f"{label}時間超出範圍（00:00~23:59）")
    if start_time > end_time:
        raise HTTPException(400, "結束時間必須大於開始時間")


def _validate_service_type(conn, svc_id) -> None:
    """service_type_id 必須存在（防 FK IntegrityError 500）"""
    if svc_id is None:
        return
    if conn.execute("SELECT id FROM service_types WHERE id=?", (svc_id,)).fetchone() is None:
        raise HTTPException(400, f"服務項目 id={svc_id} 不存在")


def _validate_users(conn, user_ids: List[int]) -> None:
    """人員必須存在且啟用中；**可空**（2026-08-12 家豪指定：可不指派負責人，
    派工明細以新增者 created_by_name 標示即可）"""
    for uid in user_ids:
        row = conn.execute("SELECT id FROM users WHERE id=? AND is_active=1", (uid,)).fetchone()
        if row is None:
            raise HTTPException(400, f"人員 id={uid} 不存在或已停用")


def _validate_users_for_update(conn, appt_id: int, user_ids: List[int]) -> None:
    """編輯時允許保留既有 inactive assignee，但禁止新加入 inactive user。"""
    for uid in user_ids:
        row = conn.execute("SELECT id, is_active FROM users WHERE id=?", (uid,)).fetchone()
        if row is None:
            raise HTTPException(400, f"人員 id={uid} 不存在")
        if row["is_active"]:
            continue
        assigned = conn.execute(
            "SELECT 1 FROM appointment_assignees WHERE appointment_id=? AND user_id=?",
            (appt_id, uid),
        ).fetchone()
        if assigned is None:
            raise HTTPException(400, f"人員 id={uid} 不存在或已停用")


def _find_conflict(conn, user_ids, date, start_time, end_time, exclude_id=0):
    """衝突檢查：任一被指派人員在同時段已有行程 → 回傳衝突訊息，否則 None。
    2026-08-14 Sarah：未指定時間（選填）無法判斷同時段 → 跳過衝突檢查"""
    if not start_time or not end_time:
        return None
    for uid in user_ids:
        row = conn.execute(
            """SELECT a.client_name, a.start_time, a.end_time, u.display_name
               FROM appointments a
               JOIN appointment_assignees aa ON aa.appointment_id = a.id
               JOIN users u ON u.id = aa.user_id
               WHERE a.date=? AND aa.user_id=? AND a.start_time < ? AND a.end_time > ? AND a.id != ?
               LIMIT 1""",
            (date, uid, end_time, start_time, exclude_id),
        ).fetchone()
        if row:
            return f"⚠️ 衝突！【{row['display_name']}】{row['start_time']} 已有行程（{row['client_name']}）"
    return None


def _sync_status(conn, appt_id: int) -> str:
    """回傳同步狀態，attempts 1~4 的錯誤屬於 retrying，不是永久 failed。"""
    mapped = conn.execute(
        "SELECT 1 FROM appointment_gcal_map WHERE appointment_id=?", (appt_id,)
    ).fetchone() is not None
    rows = conn.execute(
        "SELECT attempts, last_error FROM appointment_sync_queue WHERE appointment_id=?",
        (appt_id,),
    ).fetchall()
    return gcal_sync.appointment_sync_status(mapped, rows)

_TEAM_STATUS_BUCKET = {
    "synced": "synced",
    "pending": "pending",
    "not_targeted": "pending",
    "retrying": "retrying",
    "partial_retrying": "retrying",
    "failed": "failed",
    "partial_failed": "failed",
}

_RETRYABLE_SYNC_STATUSES = {"pending", "retrying", "partial_retrying", "failed", "partial_failed"}


def _team_status_bucket(status: str) -> str:
    """把個人／歷史 partial 狀態收斂成團隊統計 bucket。"""
    return _TEAM_STATUS_BUCKET.get(status, "pending")


def _single_sync_info(mapped: bool, entries) -> dict:
    """以單一 Key 計算狀態，並保留最高 attempts 的錯誤摘要。"""
    rows = list(entries or [])
    status = gcal_sync.appointment_sync_status(mapped, rows)
    failed_entry = max(
        (row for row in rows if row["last_error"]),
        key=lambda row: int(row["attempts"] or 0),
        default=None,
    )
    return {
        "status": status,
        "error": gcal_sync.safe_sync_error(failed_entry["last_error"]) if failed_entry else "",
        "key_name": (failed_entry["key_name"] or "") if failed_entry else "",
        "cal_id": (failed_entry["calendar_id"] or "") if failed_entry else "",
        "attempts": failed_entry["attempts"] if failed_entry else 0,
        "op_type": failed_entry["op_type"] if failed_entry else "",
    }


def _retryable_effective_queue_key_ids(conn, appt_id: int, effective_targets, mapped, queue) -> list[int]:
    """依 Retry All 的 effective targets、實際 queue 與 status 計算可重試 Key。"""
    queue_ids = gcal_sync.existing_queue_key_ids(conn, appt_id, effective_targets)
    return [
        key_id for key_id in queue_ids
        if _single_sync_info((appt_id, key_id) in mapped, queue.get((appt_id, key_id), []))["status"] in _RETRYABLE_SYNC_STATUSES
    ]


def _sync_statuses(conn, appt_ids, viewer_user=None):
    """批次回傳登入者個人狀態；Admin 另附指派團隊人員摘要。"""
    ids = list(appt_ids)
    if not ids:
        return {}
    if viewer_user is None:
        # 保留內部相容性；API 路由一律傳入登入者，避免一般請求暴露全體狀態。
        viewer_user_id = None
        can_view_team_sync = False
    else:
        viewer_user_id = viewer_user["id"]
        can_view_team_sync = bool(
            viewer_user and viewer_user.get("permissions", {}).get("gcal-sync-team-view")
        )

    map_rows = []
    queue_rows = []
    assignee_rows = []
    for chunk in _id_chunks(ids):
        placeholders = ",".join("?" * len(chunk))
        map_rows.extend(conn.execute(
            "SELECT appointment_id, key_id FROM appointment_gcal_map "
            "WHERE appointment_id IN (" + placeholders + ")", chunk,
        ).fetchall())
        queue_rows.extend(conn.execute(
            "SELECT q.appointment_id, q.last_error, q.attempts, q.op_type, q.key_id, "
            "k.name AS key_name, k.calendar_id "
            "FROM appointment_sync_queue q LEFT JOIN gcal_keys k ON k.id=q.key_id "
            "WHERE q.appointment_id IN (" + placeholders + ")", chunk,
        ).fetchall())
        assignee_rows.extend(conn.execute(
            "SELECT aa.appointment_id, u.id AS user_id, u.display_name, u.is_active AS user_active, "
            "u.gcal_key, k.id AS key_id, k.name AS key_name, k.calendar_id, "
            "k.pending_calendar_id, k.is_active AS key_active "
            "FROM appointment_assignees aa JOIN users u ON u.id=aa.user_id "
            "LEFT JOIN gcal_keys k ON k.name=u.gcal_key "
            "WHERE aa.appointment_id IN (" + placeholders + ") ORDER BY aa.id", chunk,
        ).fetchall())
    mapped = {(row["appointment_id"], row["key_id"]) for row in map_rows}
    queue = {}
    for row in queue_rows:
        queue.setdefault((row["appointment_id"], row["key_id"]), []).append(row)

    people = {}
    for row in assignee_rows:
        people.setdefault(row["appointment_id"], []).append(row)

    result = {}
    for appt_id in ids:
        assigned = people.get(appt_id, [])
        me = next((row for row in assigned if row["user_id"] == viewer_user_id), None) if viewer_user else None
        if viewer_user is None:
            info = _single_sync_info(
                any((appt_id, key_id) in mapped for key_id in {r["key_id"] for r in map_rows if r["appointment_id"] == appt_id}),
                [row for (aid, _), rows_for_key in queue.items() if aid == appt_id for row in rows_for_key],
            )
        elif me is None:
            info = {"status": "not_assigned", "error": "", "key_name": "", "cal_id": "", "attempts": 0, "op_type": "", "migration_pending": False, "can_retry": False}
        elif not me["gcal_key"]:
            info = {"status": "not_bound", "error": "", "key_name": "", "cal_id": "", "attempts": 0, "op_type": "", "migration_pending": False, "can_retry": False}
        elif not me["key_id"] or not me["key_active"]:
            info = {"status": "paused", "error": "", "key_name": me["gcal_key"], "cal_id": "", "attempts": 0, "op_type": "", "migration_pending": False, "can_retry": False}
        else:
            key_id = me["key_id"]
            entries = queue.get((appt_id, key_id), [])
            info = _single_sync_info((appt_id, key_id) in mapped, entries)
            if not entries and (appt_id, key_id) not in mapped:
                info["status"] = "not_targeted"
            info["key_name"] = me["key_name"] or ""
            info["cal_id"] = me["calendar_id"] or ""
            info["migration_pending"] = bool(me["pending_calendar_id"])
            info["can_retry"] = (
                not info["migration_pending"]
                and info["status"] in _RETRYABLE_SYNC_STATUSES
                and bool(entries)
            )

        team = None
        if can_view_team_sync:
            team_people = []
            excluded = {"not_bound": 0, "paused": 0, "inactive": 0}
            effective_targets = gcal_sync.resolve_effective_target_keys(conn, appt_id)
            has_bound_assignee_key = any(person["gcal_key"] for person in assigned)
            fallback_targets = effective_targets if not has_bound_assignee_key else []
            for person in assigned:
                if not person["user_active"]:
                    excluded["inactive"] += 1
                    continue
                if not person["gcal_key"]:
                    excluded["not_bound"] += 1
                    continue
                if not person["key_id"] or not person["key_active"]:
                    excluded["paused"] += 1
                    continue
                person_info = _single_sync_info(
                    (appt_id, person["key_id"]) in mapped,
                    queue.get((appt_id, person["key_id"]), []),
                )
                if not queue.get((appt_id, person["key_id"]), []) and (appt_id, person["key_id"]) not in mapped:
                    person_info["status"] = "not_targeted"
                person_info["migration_pending"] = bool(person["pending_calendar_id"])
                person_info["can_retry"] = (
                    not person_info["migration_pending"]
                    and person_info["status"] in _RETRYABLE_SYNC_STATUSES
                    and bool(queue.get((appt_id, person["key_id"]), []))
                )
                team_people.append({
                    "user_id": person["user_id"],
                    "display_name": person["display_name"] or "",
                    **person_info,
                })
            counts = {"synced": 0, "pending": 0, "retrying": 0, "failed": 0}
            unknown_people = 0
            for person in team_people:
                status = person["status"]
                bucket = _team_status_bucket(status)
                counts[bucket] += 1
                if status not in _TEAM_STATUS_BUCKET:
                    unknown_people += 1
            retryable_all_targets = _retryable_effective_queue_key_ids(
                conn, appt_id, effective_targets, mapped, queue,
            )
            retryable_all_target_set = set(retryable_all_targets)
            fallback_retryable_count = sum(
                1 for key_id in fallback_targets if key_id in retryable_all_target_set
            )
            team = {
                "eligible_people": len(team_people),
                "synced_people": counts["synced"],
                "pending_people": counts["pending"],
                "retrying_people": counts["retrying"],
                "failed_people": counts["failed"],
                "unknown_status_people": unknown_people,
                "unbound_people": excluded["not_bound"],
                "paused_people": excluded["paused"],
                "inactive_people": excluded["inactive"],
                "fallback_target_count": len(fallback_targets),
                "fallback_retryable_count": fallback_retryable_count,
                "can_retry_all": bool(retryable_all_targets),
                "details": team_people,
            }
        if viewer_user is None:
            info["error"] = info["error"] or None
        result[appt_id] = {**info, "team": team}
    return result


def _appt_rows(conn, appt_ids, viewer_user=None) -> list[dict]:
    """批次取得行程完整 response，避免 list/search 對每筆呼叫 _appt_row。"""
    ids = list(appt_ids)
    if not ids:
        return []
    rows = []
    assignee_rows = []
    for chunk in _id_chunks(ids):
        placeholders = ",".join("?" * len(chunk))
        rows.extend(conn.execute(
            """SELECT a.*, s.name AS service_name,
                      creator.display_name AS creator_display_name, creator.username AS creator_username,
                      updater.display_name AS updater_display_name, updater.username AS updater_username
               FROM appointments a
               LEFT JOIN service_types s ON s.id = a.service_type_id
               LEFT JOIN users creator ON creator.id = a.created_by
               LEFT JOIN users updater ON updater.id = a.updated_by
               WHERE a.id IN (""" + placeholders + ")",
            chunk,
        ).fetchall())
        assignee_rows.extend(conn.execute(
            "SELECT aa.appointment_id, aa.user_id, u.display_name, u.color "
            "FROM appointment_assignees aa JOIN users u ON u.id = aa.user_id "
            "WHERE aa.appointment_id IN (" + placeholders + ") ORDER BY aa.id",
            chunk,
        ).fetchall())
    if len(rows) != len(ids):
        raise HTTPException(404, "行程不存在")
    assignees = {}
    for row in assignee_rows:
        assignees.setdefault(row["appointment_id"], []).append(row)
    statuses = _sync_statuses(conn, ids, viewer_user)
    by_id = {row["id"]: row for row in rows}
    result = []
    for appt_id in ids:
        row = by_id[appt_id]
        people = assignees.get(appt_id, [])
        sync_info = statuses.get(appt_id, {"status": "none", "error": None, "key_name": "", "cal_id": "", "attempts": 0, "op_type": ""})
        result.append({
            "id": row["id"],
            "client_name": row["client_name"],
            "address": row["address"] or "",
            "service_type_id": row["service_type_id"],
            "service_name": row["service_name"],
            "date": row["date"],
            "start_time": row["start_time"],
            "end_time": row["end_time"],
            "note": row["note"] or "",
            "created_by": row["created_by"],
            "created_by_name": ((row["creator_display_name"] or row["creator_username"])
                                if row["created_by"] else None),
            "created_at": row["created_at"] or "",
            "updated_at": row["updated_at"] or "",
            "updated_by": row["updated_by"],
            "updated_by_name": ((row["updater_display_name"] or row["updater_username"])
                                if row["updated_by"] else None),
            "user_ids": [person["user_id"] for person in people],
            "assignees": [{"id": person["user_id"], "name": person["display_name"],
                           "color": person["color"] or "#1a73e8"} for person in people],
            "sync_status": sync_info["status"],  # 舊欄位相容，內容改為目前登入者視角
            "my_sync_status": {
                "status": sync_info["status"],
                "key_name": sync_info.get("key_name") or "",
                "cal_id": sync_info.get("cal_id") or "",
                "error": sync_info.get("error") or "",
                "attempts": sync_info.get("attempts", 0),
                "op_type": sync_info.get("op_type") or "",
                "migration_pending": bool(sync_info.get("migration_pending")),
                "can_retry": bool(sync_info.get("can_retry")),
            },
            "team_sync": sync_info.get("team"),
            "is_assigned_to_me": sync_info["status"] != "not_assigned",
            "sync_error": sync_info.get("error") or "",
            "sync_error_key": sync_info.get("key_name") or "" if sync_info.get("error") else "",
            "sync_error_cal": sync_info.get("cal_id") or "" if sync_info.get("error") else "",
            "sync_error_attempts": sync_info.get("attempts", 0) if sync_info.get("error") else 0,
            "sync_error_op": sync_info.get("op_type") or "" if sync_info.get("error") else "",
        })
    return result


def _appt_row(conn, appt_id: int, viewer_user=None) -> dict:
    """單筆相容 wrapper，共用批次 formatter。"""
    return _appt_rows(conn, [appt_id], viewer_user)[0]


@router.get("/api/appointments")
def list_appointments(year: int = 0, month: int = 0, date: str = "", user: dict = Depends(require_login)):
    """月曆（year+month）或當日（date）行程清單"""
    conn = get_db()
    try:
        if date:
            rows = conn.execute("SELECT id FROM appointments WHERE date=?", (date,)).fetchall()
        else:
            if not year or not month:
                raise HTTPException(400, "需要 year+month 或 date 參數")
            if not 1 <= month <= 12:
                raise HTTPException(400, "月份需在 1-12")
            if not 1 <= year <= 9999:  # 2026-08-12 補：year 越界 → datetime.date ValueError 500
                raise HTTPException(400, "年份需在 1-9999")
            start = f"{year}-{month:02d}-01"
            end = (datetime.date(year, month, 1).replace(day=28) + datetime.timedelta(days=4)).replace(day=1) \
                - datetime.timedelta(days=1)
            rows = conn.execute("SELECT id FROM appointments WHERE date BETWEEN ? AND ?",
                                (start, end.isoformat())).fetchall()
        return _appt_rows(conn, [r["id"] for r in rows], user)
    finally:
        conn.close()


@router.get("/api/appointments/search")
def search_appointments(date_from: str = "", date_to: str = "", q: str = "", user: dict = Depends(require_login)):
    """搜尋行程（日期範圍 + 關鍵字）"""
    conn = get_db()
    try:
        sql = "SELECT id FROM appointments WHERE 1=1"
        params = []
        if date_from:
            sql += " AND date >= ?"
            params.append(date_from)
        if date_to:
            sql += " AND date <= ?"
            params.append(date_to)
        if q.strip():
            kw = f"%{q.strip()}%"
            sql += " AND (client_name LIKE ? OR address LIKE ? OR note LIKE ?)"
            params.extend([kw, kw, kw])
            # 也搜服務項目名稱
            sql = sql.replace(
                "WHERE 1=1",
                "LEFT JOIN service_types st ON st.id = service_type_id WHERE 1=1 OR st.name LIKE ?"
            )
            # 簡化：先搜基本欄位，服務名稱用 LIKE 子查詢
            sql = "SELECT id FROM appointments WHERE 1=1"
            params = []
            if date_from:
                sql += " AND date >= ?"
                params.append(date_from)
            if date_to:
                sql += " AND date <= ?"
                params.append(date_to)
            if q.strip():
                kw = f"%{q.strip()}%"
                sql += " AND (client_name LIKE ? OR address LIKE ? OR note LIKE ? OR service_type_id IN (SELECT id FROM service_types WHERE name LIKE ?))"
                params.extend([kw, kw, kw, kw])
        sql += " ORDER BY date DESC, start_time ASC"
        rows = conn.execute(sql, params).fetchall()
        return _appt_rows(conn, [r["id"] for r in rows], user)
    finally:
        conn.close()


@router.post("/api/appointments")
def create_appointment(body: AppointmentIn, user: dict = Depends(require_perm("cal-mgmt"))):
    _validate_time(body.start_time, body.end_time)
    if not body.client_name.strip():
        raise HTTPException(400, "請填客戶 / 案場")
    conn = get_db()
    try:
        # 2026-08-14 併發修復：BEGIN IMMEDIATE 必須是第一個語句（SELECT 不觸發 auto-BEGIN）——
        # 衝突檢查+寫入持 RESERVED 鎖同一交易，防雙重派工（TO-1）。依賴 Task 0.1 busy_timeout。
        conn.execute("BEGIN IMMEDIATE")
        _validate_users(conn, body.user_ids)
        _validate_service_type(conn, body.service_type_id)  # 2026-08-12 補：防 FK 500
        conflict = _find_conflict(conn, body.user_ids, body.date, body.start_time, body.end_time)
        if conflict:
            raise HTTPException(409, conflict)
        cur = conn.execute(
            """INSERT INTO appointments
               (client_name, address, service_type_id, date, start_time, end_time, note, created_by)
               VALUES (?,?,?,?,?,?,?,?)""",
            (body.client_name.strip(), body.address.strip(), body.service_type_id,
             body.date, body.start_time or "", body.end_time or "", body.note.strip(), user["id"]),
        )
        appt_id = cur.lastrowid
        for uid in body.user_ids:
            conn.execute("INSERT INTO appointment_assignees (appointment_id, user_id) VALUES (?,?)",
                         (appt_id, uid))
        conn.commit()
        mark_sync_pending(appt_id, "C")
        return _appt_row(conn, appt_id, user)
    except:
        conn.rollback()
        raise
    finally:
        conn.close()


@router.put("/api/appointments/{appt_id}")
def update_appointment(appt_id: int, body: AppointmentIn, user: dict = Depends(require_perm("cal-mgmt"))):
    _validate_time(body.start_time, body.end_time)
    if not body.client_name.strip():
        raise HTTPException(400, "請填客戶 / 案場")
    conn = get_db()
    try:
        # 2026-08-14 併發修復：BEGIN IMMEDIATE 必須是第一個語句——衝突檢查+寫入同一交易（TO-1）
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute("SELECT id FROM appointments WHERE id=?", (appt_id,)).fetchone()
        if row is None:
            raise HTTPException(404, "行程不存在")
        _validate_users_for_update(conn, appt_id, body.user_ids)
        _validate_service_type(conn, body.service_type_id)  # 2026-08-12 補：防 FK 500
        conflict = _find_conflict(conn, body.user_ids, body.date, body.start_time, body.end_time,
                                  exclude_id=appt_id)
        if conflict:
            raise HTTPException(409, conflict)
        # 2026-08-14 樂觀鎖：前端帶 updated_at 快照 → WHERE 守衛，被他人改過 → rowcount=0 → 409
        if body.updated_at:
            cur = conn.execute(
                """UPDATE appointments SET client_name=?, address=?, service_type_id=?, date=?,
                   start_time=?, end_time=?, note=?, updated_at=datetime('now'), updated_by=? WHERE id=? AND updated_at=?""",
                (body.client_name.strip(), body.address.strip(), body.service_type_id,
                 body.date, body.start_time or "", body.end_time or "", body.note.strip(), user["id"], appt_id, body.updated_at),
            )
            if cur.rowcount == 0:
                raise HTTPException(409, "該行程已被他人修改，請重新整理後再編輯")
        else:
            conn.execute(
                """UPDATE appointments SET client_name=?, address=?, service_type_id=?, date=?,
                   start_time=?, end_time=?, note=?, updated_at=datetime('now'), updated_by=? WHERE id=?""",
                (body.client_name.strip(), body.address.strip(), body.service_type_id,
                 body.date, body.start_time or "", body.end_time or "", body.note.strip(), user["id"], appt_id),
            )
        conn.execute("DELETE FROM appointment_assignees WHERE appointment_id=?", (appt_id,))
        for uid in body.user_ids:
            conn.execute("INSERT INTO appointment_assignees (appointment_id, user_id) VALUES (?,?)",
                         (appt_id, uid))
        assignee_count = conn.execute(
            "SELECT COUNT(*) AS c FROM appointment_assignees WHERE appointment_id=?",
            (appt_id,),
        ).fetchone()["c"]
        assigned_key_ids = set(gcal_sync.resolve_assigned_key_ids(conn, appt_id)) if assignee_count else set()
        map_rows_all = conn.execute(
            "SELECT key_id, google_event_id FROM appointment_gcal_map WHERE appointment_id=?",
            (appt_id,),
        ).fetchall()
        # D only means the current relationship was explicitly removed.  An empty
        # assignee list is the intentional fallback-all domain, not an orphan set.
        orphan_d_rows = []
        if assignee_count > 0:
            orphan_d_rows = [
                (mr["key_id"], mr["google_event_id"])
                for mr in map_rows_all if mr["key_id"] not in assigned_key_ids
            ]
        conn.commit()
        mark_sync_pending(appt_id, "U")
        if orphan_d_rows:
            mark_sync_pending(appt_id, "D", map_rows=orphan_d_rows)
        return _appt_row(conn, appt_id, user)
    except:
        conn.rollback()
        raise
    finally:
        conn.close()


@router.delete("/api/appointments/{appt_id}")
def delete_appointment(appt_id: int, user: dict = Depends(require_perm("cal-mgmt"))):
    conn = get_db()
    try:
        row = conn.execute("SELECT id FROM appointments WHERE id=?", (appt_id,)).fetchone()
        if row is None:
            raise HTTPException(404, "行程不存在")
        # A1：刪 row 前撈出全部 (key_id, google_event_id)
        mrows = conn.execute(
            "SELECT key_id, google_event_id FROM appointment_gcal_map WHERE appointment_id=?",
            (appt_id,)).fetchall()
        map_rows = [(r[0], r[1]) for r in mrows]
        # 尚未送出的 C/U 任務已失去本地來源；D 任務仍須保留遠端 event id。
        conn.execute(
            "DELETE FROM appointment_sync_queue "
            "WHERE appointment_id=? AND op_type IN ('C', 'U')",
            (appt_id,),
        )
        conn.execute("DELETE FROM appointments WHERE id=?", (appt_id,))
        conn.commit()
        mark_sync_pending(appt_id, "D", map_rows=map_rows)
        return {"ok": True}
    except Exception:
        conn.rollback()   # 2026-08-14 鎖洩漏根治：確保釋放 RESERVED 鎖
        raise
    finally:
        conn.close()


@router.get("/api/appointments/export")
def export_daily_report(date: str):
    """匯出當天工程日報表 xlsx（範本填值法，§10）"""
    try:
        datetime.date.fromisoformat(date)
    except ValueError:
        raise HTTPException(400, "日期格式錯誤（需 YYYY-MM-DD）")
    conn = get_db()
    try:
        rows = conn.execute(
            """SELECT a.*, s.name AS service_name FROM appointments a
               LEFT JOIN service_types s ON s.id = a.service_type_id
               WHERE a.date=? ORDER BY a.start_time""", (date,)).fetchall()
        day_events = []
        for r in rows:
            day_events.append({
                "client_name": r["client_name"], "address": r["address"] or "",
                "service_type_id": r["service_type_id"], "service_name": r["service_name"],
                "start_time": r["start_time"], "end_time": r["end_time"], "note": r["note"] or "",
            })
        # 2026-08-13：engineers 計算已移除——A2 固定寫「藍政達 蘇昱豪」（D3 dead code 清理）
        buf, mmdd = build_daily_report(date, day_events)
        filename = f"工程日報表{mmdd}.xlsx"
        return xlsx_download(buf.getvalue(), filename)
    finally:
        conn.close()



@router.get("/api/assignable-users")
def list_assignable_users():
    """可指派人員：啟用中且非 viewer（行事曆勾選清單用）"""
    conn = get_db()
    try:
        rows = conn.execute(
            """SELECT id, username, display_name, color, role FROM users
               WHERE is_active=1 AND role != 'viewer' ORDER BY display_name, id""").fetchall()
        return [{"id": r["id"], "username": r["username"],
                 "display_name": r["display_name"] or r["username"],
                 "color": r["color"] or "#1a73e8",
                 "role": r["role"]} for r in rows]
    finally:
        conn.close()
