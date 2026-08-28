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

權限（RBAC 2026-08-13）：行事曆寫入掛 require_perm("cal-mgmt")（service-types 端點已移至 service_types.py）。衝突規則：同人同日時間重疊（start < 他end 且 end > 他start）。
"""
import datetime
import re
from typing import List
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response

from app.database import get_db
from app.models import AppointmentIn
from app.services.auth import require_perm
from app.services.report import build_daily_report
from app.services import gcal_sync

router = APIRouter()


def mark_sync_pending(appt_id: int, op: str, map_rows=()) -> None:
    """把行程標記待同步到所有目標 key。map_rows：刪除時帶 [(key_id, google_event_id)]。
    獨立短連線，失敗不影響主操作。
    A4：C/U op 每次都進 queue（hash-skip 已移除——queue 是暫態，不值得為省 row 引入 op_type 錯位風險）。"""
    if not gcal_sync.is_enabled():
        return
    try:
        c = get_db()
        try:
            if op in ("C", "U"):
                keys = gcal_sync.resolve_target_keys(c, appt_id)
            else:  # D
                keys = [r[0] for r in map_rows] if map_rows else []
            for key_id in keys:
                gid = next((g for (k, g) in map_rows if k == key_id), "") if map_rows else ""
                c.execute(
                    "INSERT INTO appointment_sync_queue(appointment_id, key_id, op_type,"
                    " google_event_id, last_modified_at, attempts, last_error) "
                    " VALUES(?,?,?,?,datetime('now'),0,'') "
                    " ON CONFLICT(appointment_id, key_id) DO UPDATE SET "
                    " op_type=excluded.op_type, google_event_id=excluded.google_event_id,"
                    " last_modified_at=excluded.last_modified_at, attempts=0, last_error=''",
                    (appt_id, key_id, op, gid))
            c.commit()
        finally:
            c.close()
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning("gcal 同步標記失敗 appointment=%s (%s): %s", appt_id, op, e)


_TIME_RE = re.compile(r"^\d{2}:\d{2}$")


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
    """回傳同步狀態：synced / partial_failed / pending / failed / none

    多 key 情境：appointment_gcal_map 有任一列 = 至少一個 key 已同步，
    但若 sync_queue 仍有失敗/等待列（其他 key 未完成）→ 不可回 synced。
    """
    # 有 gcal_map → 至少一個 key 已同步
    m = conn.execute("SELECT 1 FROM appointment_gcal_map WHERE appointment_id=?", (appt_id,)).fetchone()
    # 有 sync_queue → 還有 key 待處理或失敗
    q = conn.execute(
        "SELECT last_error, attempts FROM appointment_sync_queue WHERE appointment_id=?",
        (appt_id,),
    ).fetchall()
    has_failed = any(r["last_error"] for r in q)
    has_pending = bool(q) and not has_failed
    if m:
        if has_failed:
            return "partial_failed"   # 部分 key 成功 + 部分失敗
        if has_pending:
            return "pending"          # 部分 key 成功 + 部分等待中
        return "synced"
    # 無 map：全看 queue
    if q:
        return "failed" if has_failed else "pending"
    return "none"


def _appt_row(conn, appt_id: int) -> dict:
    """行程 + 指派人員 + 服務名稱 完整 dict"""
    row = conn.execute("SELECT * FROM appointments WHERE id=?", (appt_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "行程不存在")
    assignees = conn.execute(
        """SELECT aa.user_id, u.display_name, u.color
           FROM appointment_assignees aa JOIN users u ON u.id = aa.user_id
           WHERE aa.appointment_id=?""", (appt_id,)).fetchall()
    svc = (conn.execute("SELECT name FROM service_types WHERE id=?", (row["service_type_id"],)).fetchone()
           if row["service_type_id"] else None)
    creator = None
    if row["created_by"]:
        creator = conn.execute("SELECT display_name, username FROM users WHERE id=?", (row["created_by"],)).fetchone()
    updater = None
    if row["updated_by"]:
        updater = conn.execute("SELECT display_name, username FROM users WHERE id=?", (row["updated_by"],)).fetchone()
    return {
        "id": row["id"],
        "client_name": row["client_name"],
        "address": row["address"] or "",
        "service_type_id": row["service_type_id"],
        "service_name": svc["name"] if svc else None,
        "date": row["date"],
        "start_time": row["start_time"],
        "end_time": row["end_time"],
        "note": row["note"] or "",
        "created_by": row["created_by"],
        "created_by_name": (creator["display_name"] or creator["username"]) if creator else None,
        "created_at": row["created_at"] or "",
        "updated_at": row["updated_at"] or "",  # 2026-08-14 樂觀鎖：前端編輯時的快照值
        "updated_by": row["updated_by"],
        "updated_by_name": (updater["display_name"] or updater["username"]) if updater else None,
        "user_ids": [a["user_id"] for a in assignees],
        "assignees": [{"id": a["user_id"], "name": a["display_name"],
                       "color": a["color"] or "#1a73e8"} for a in assignees],
        "sync_status": _sync_status(conn, appt_id),
    }


@router.get("/api/appointments")
def list_appointments(year: int = 0, month: int = 0, date: str = ""):
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
        return [_appt_row(conn, r["id"]) for r in rows]
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
        return _appt_row(conn, appt_id)
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
        _validate_users(conn, body.user_ids)
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
        # B2：orphan 判斷只看「已綁定 key」（不含 fallback 到全部 key 的情境）
        # 避免沒綁 key 的指派人觸發 fallback → 所有 key 都在 target → 沒 orphan → 舊事件不刪
        bound_rows = conn.execute(
            "SELECT DISTINCT u.gcal_key FROM appointment_assignees aa "
            "JOIN users u ON u.id=aa.user_id "
            "WHERE aa.appointment_id=? AND u.gcal_key<>''", (appt_id,)).fetchall()
        bound_key_names = [r["gcal_key"] for r in bound_rows]
        if bound_key_names:
            placeholders = ",".join("?" * len(bound_key_names))
            bound_key_ids = set(r["id"] for r in conn.execute(
                f"SELECT id FROM gcal_keys WHERE is_active=1 AND name IN ({placeholders})",
                bound_key_names).fetchall())
        else:
            bound_key_ids = set()  # 全沒綁 key = 不刪 orphan（fallback 同步全部 key）
        # 讀 map 裡所有「曾同步過」的 key
        map_rows_all = conn.execute(
            "SELECT key_id, google_event_id FROM appointment_gcal_map "
            "WHERE appointment_id=?", (appt_id,)).fetchall()
        # 流失 key = map 裡有但新指派「已綁定 key」沒有的
        # B2 guard：全沒綁 key（fallback 情境）= 不刪 orphan
        orphan_d_rows = []
        if bound_key_ids:  # 有至少一個綁定 key 才判斷 orphan
            for mr in map_rows_all:
                if mr["key_id"] not in bound_key_ids:
                    orphan_d_rows.append((mr["key_id"], mr["google_event_id"]))
        conn.commit()
        mark_sync_pending(appt_id, "U")
        if orphan_d_rows:
            mark_sync_pending(appt_id, "D", map_rows=orphan_d_rows)
        return _appt_row(conn, appt_id)
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
        return Response(
            buf.getvalue(),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"},
        )
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
