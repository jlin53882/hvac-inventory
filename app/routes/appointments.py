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
- GET  /api/service-types                  服務項目字典（含停用，前端自行過濾）
- POST /api/service-types                  新增（僅 admin）
- PUT  /api/service-types/{id}             更新名稱/排序/啟用（僅 admin）
- DELETE /api/service-types/{id}           停用 is_active=0（僅 admin，不真刪）

權限：寫入端點由 main.py 全域 require_login 擋 viewer（403）；service-types
管理額外加 require_admin。衝突規則：同人同日時間重疊（start < 他end 且 end > 他start）。
"""
import datetime
import re
from typing import List, Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

from app.database import get_db
from app.services.auth import require_admin, require_login
from app.services.report import build_daily_report

router = APIRouter()


class AppointmentIn(BaseModel):
    client_name: str
    address: str = ""
    service_type_id: Optional[int] = None
    date: str
    start_time: str
    end_time: str
    note: str = ""
    user_ids: List[int] = []


class ServiceTypeIn(BaseModel):
    name: str
    sort_order: int = 0
    is_active: int = 1


_TIME_RE = re.compile(r"^\d{2}:\d{2}$")


def _validate_time(start_time: str, end_time: str) -> None:
    """起訖時間合理性：格式必須 HH:MM 且時間序正確（2026-08-12 補格式驗證——
    原本零驗證讓任意字串（含 XSS payload）直接入庫）"""
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
    """衝突檢查：任一被指派人員在同時段已有行程 → 回傳衝突訊息，否則 None"""
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
        "user_ids": [a["user_id"] for a in assignees],
        "assignees": [{"id": a["user_id"], "name": a["display_name"],
                       "color": a["color"] or "#1a73e8"} for a in assignees],
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
def create_appointment(body: AppointmentIn, user: dict = Depends(require_login)):
    _validate_time(body.start_time, body.end_time)
    if not body.client_name.strip():
        raise HTTPException(400, "請填客戶 / 案場")
    conn = get_db()
    try:
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
             body.date, body.start_time, body.end_time, body.note.strip(), user["id"]),
        )
        appt_id = cur.lastrowid
        for uid in body.user_ids:
            conn.execute("INSERT INTO appointment_assignees (appointment_id, user_id) VALUES (?,?)",
                         (appt_id, uid))
        conn.commit()
        return _appt_row(conn, appt_id)
    finally:
        conn.close()


@router.put("/api/appointments/{appt_id}")
def update_appointment(appt_id: int, body: AppointmentIn, user: dict = Depends(require_login)):
    _validate_time(body.start_time, body.end_time)
    if not body.client_name.strip():
        raise HTTPException(400, "請填客戶 / 案場")
    conn = get_db()
    try:
        row = conn.execute("SELECT id FROM appointments WHERE id=?", (appt_id,)).fetchone()
        if row is None:
            raise HTTPException(404, "行程不存在")
        _validate_users(conn, body.user_ids)
        _validate_service_type(conn, body.service_type_id)  # 2026-08-12 補：防 FK 500
        conflict = _find_conflict(conn, body.user_ids, body.date, body.start_time, body.end_time,
                                  exclude_id=appt_id)
        if conflict:
            raise HTTPException(409, conflict)
        conn.execute(
            """UPDATE appointments SET client_name=?, address=?, service_type_id=?, date=?,
               start_time=?, end_time=?, note=?, updated_at=datetime('now') WHERE id=?""",
            (body.client_name.strip(), body.address.strip(), body.service_type_id,
             body.date, body.start_time, body.end_time, body.note.strip(), appt_id),
        )
        conn.execute("DELETE FROM appointment_assignees WHERE appointment_id=?", (appt_id,))
        for uid in body.user_ids:
            conn.execute("INSERT INTO appointment_assignees (appointment_id, user_id) VALUES (?,?)",
                         (appt_id, uid))
        conn.commit()
        return _appt_row(conn, appt_id)
    finally:
        conn.close()


@router.delete("/api/appointments/{appt_id}")
def delete_appointment(appt_id: int, user: dict = Depends(require_login)):
    conn = get_db()
    try:
        row = conn.execute("SELECT id FROM appointments WHERE id=?", (appt_id,)).fetchone()
        if row is None:
            raise HTTPException(404, "行程不存在")
        conn.execute("DELETE FROM appointments WHERE id=?", (appt_id,))
        conn.commit()
        return {"ok": True}
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
        day_events, engineers = [], []
        for r in rows:
            assigns = conn.execute(
                """SELECT u.display_name FROM appointment_assignees aa
                   JOIN users u ON u.id = aa.user_id WHERE aa.appointment_id=?""", (r["id"],)).fetchall()
            for a in assigns:
                if a["display_name"] and a["display_name"] not in engineers:
                    engineers.append(a["display_name"])
            day_events.append({
                "client_name": r["client_name"], "address": r["address"] or "",
                "service_type_id": r["service_type_id"], "service_name": r["service_name"],
                "start_time": r["start_time"], "end_time": r["end_time"], "note": r["note"] or "",
            })
        buf, mmdd = build_daily_report(date, day_events, engineers)
        filename = f"工程日報表{mmdd}.xlsx"
        return Response(
            buf.getvalue(),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"},
        )
    finally:
        conn.close()


# ---------- 服務項目字典（僅 admin 可管理） ----------


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


@router.get("/api/service-types")
def list_service_types():
    """全部服務項目（含停用；前端新增下拉只顯示 is_active=1）"""
    conn = get_db()
    try:
        rows = conn.execute("SELECT * FROM service_types ORDER BY sort_order, id").fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


@router.post("/api/service-types", dependencies=[Depends(require_admin)])
def create_service_type(body: ServiceTypeIn):
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "名稱不可空白")
    conn = get_db()
    try:
        try:
            cur = conn.execute("INSERT INTO service_types (name, sort_order, is_active) VALUES (?,?,?)",
                               (name, body.sort_order, body.is_active))
            conn.commit()
        except Exception:
            raise HTTPException(400, "同名服務項目已存在")
        return dict(conn.execute("SELECT * FROM service_types WHERE id=?", (cur.lastrowid,)).fetchone())
    finally:
        conn.close()


@router.put("/api/service-types/{svc_id}", dependencies=[Depends(require_admin)])
def update_service_type(svc_id: int, body: ServiceTypeIn):
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "名稱不可空白")
    conn = get_db()
    try:
        row = conn.execute("SELECT id FROM service_types WHERE id=?", (svc_id,)).fetchone()
        if row is None:
            raise HTTPException(404, "服務項目不存在")
        try:
            conn.execute("UPDATE service_types SET name=?, sort_order=?, is_active=? WHERE id=?",
                         (name, body.sort_order, body.is_active, svc_id))
            conn.commit()
        except Exception:
            raise HTTPException(400, "同名服務項目已存在")
        return dict(conn.execute("SELECT * FROM service_types WHERE id=?", (svc_id,)).fetchone())
    finally:
        conn.close()


@router.delete("/api/service-types/{svc_id}", dependencies=[Depends(require_admin)])
def deactivate_service_type(svc_id: int):
    """停用（is_active=0，不真刪：舊行程的類別仍顯示）"""
    conn = get_db()
    try:
        row = conn.execute("SELECT id FROM service_types WHERE id=?", (svc_id,)).fetchone()
        if row is None:
            raise HTTPException(404, "服務項目不存在")
        conn.execute("UPDATE service_types SET is_active=0 WHERE id=?", (svc_id,))
        conn.commit()
        return {"ok": True}
    finally:
        conn.close()
