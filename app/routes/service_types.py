# -*- coding: utf-8 -*-
"""服務項目字典路由（svc-type-mgmt 權限；2026-08-16 從 appointments.py 抽出）"""
import sqlite3

from fastapi import APIRouter, Depends, HTTPException

from app.database import db_session
from app.models import ServiceTypeIn
from app.services.auth import require_perm
from app.services import gcal_sync, sync_scheduler
from app.services.work_progress import sync_work_progress_snapshot_for_appointment

router = APIRouter()


@router.get("/api/service-types")
def list_service_types():
    """全部服務項目（含停用；前端新增下拉只顯示 is_active=1）"""
    with db_session() as conn:
        rows = conn.execute("SELECT * FROM service_types ORDER BY sort_order, id").fetchall()
        return [dict(r) for r in rows]


@router.post("/api/service-types", dependencies=[Depends(require_perm("svc-type-mgmt"))])
def create_service_type(body: ServiceTypeIn):
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "名稱不可空白")
    with db_session() as conn:
        try:
            cur = conn.execute("INSERT INTO service_types (name, sort_order, is_active) VALUES (?,?,?)",
                               (name, body.sort_order, body.is_active))
            conn.commit()
        except sqlite3.IntegrityError:   # 2026-08-14 精準捕捉（B1）：只有 UNIQUE 衝突才是同名，鎖衝突不誤報
            conn.rollback()   # 2026-08-14 鎖洩漏根治：同名衝突轉 400 前先釋放鎖
            raise HTTPException(400, "同名服務項目已存在")
        return dict(conn.execute("SELECT * FROM service_types WHERE id=?", (cur.lastrowid,)).fetchone())


@router.put("/api/service-types/{svc_id}", dependencies=[Depends(require_perm("svc-type-mgmt"))])
def update_service_type(svc_id: int, body: ServiceTypeIn):
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "名稱不可空白")
    affected_ids = []
    with db_session() as conn:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute("SELECT id, name FROM service_types WHERE id=?", (svc_id,)).fetchone()
        if row is None:
            raise HTTPException(404, "服務項目不存在")
        old_name = row["name"]
        try:
            conn.execute("UPDATE service_types SET name=?, sort_order=?, is_active=? WHERE id=?",
                         (name, body.sort_order, body.is_active, svc_id))
        except sqlite3.IntegrityError:   # 2026-08-14 精準捕捉（B1）：只有 UNIQUE 衝突才是同名，鎖衝突不誤報
            conn.rollback()   # 2026-08-14 鎖洩漏根治：同名衝突轉 400 前先釋放鎖
            raise HTTPException(400, "同名服務項目已存在")
        if old_name != name:
            affected_ids = [r["id"] for r in conn.execute(
                "SELECT id FROM appointments WHERE service_type_id=?", (svc_id,)
            ).fetchall()]
            for appointment_id in affected_ids:
                sync_work_progress_snapshot_for_appointment(conn, appointment_id)
        conn.commit()
        result = dict(conn.execute("SELECT * FROM service_types WHERE id=?", (svc_id,)).fetchone())

    # Commit DB consistency before touching scheduler/GCal state.
    if old_name != name:
        if gcal_sync.enqueue_existing_mappings(appointment_ids=affected_ids):
            sync_scheduler.start_and_wake()
    return result


@router.delete("/api/service-types/{svc_id}", dependencies=[Depends(require_perm("svc-type-mgmt"))])
def deactivate_service_type(svc_id: int):
    """停用（is_active=0，不真刪：舊行程的類別仍顯示）"""
    with db_session() as conn:
        row = conn.execute("SELECT id FROM service_types WHERE id=?", (svc_id,)).fetchone()
        if row is None:
            raise HTTPException(404, "服務項目不存在")
        conn.execute("UPDATE service_types SET is_active=0 WHERE id=?", (svc_id,))
        conn.commit()
        return {"ok": True}
