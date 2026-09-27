# -*- coding: utf-8 -*-
"""
櫃子設定路由（Settings → 📦 櫃子）
====================================
2026-09-27 多位置管理：單一庫存與整組庫存共用的全球櫃子設定。
"""
from typing import List

from fastapi import APIRouter, Depends, HTTPException
import sqlite3

from app.database import get_db
from app.models import CabinetCreate, CabinetUpdate
from app.services.auth import require_perm
from app.services.app_log import get_logger

logger = get_logger(__name__)

router = APIRouter()


@router.get("/api/cabinets", dependencies=[Depends(require_perm("settings-read"))])
def get_cabinets():
    """取得全部櫃子清單"""
    try:
        conn = get_db()
        try:
            cur = conn.execute("SELECT id, name, note, created_at FROM cabinets ORDER BY id ASC")
            rows = cur.fetchall()
            cabinets = [dict(r) for r in rows]
            return cabinets
        finally:
            conn.close()
    except Exception as e:
        logger.error(f"get_cabinets 失敗: {e}")
        raise HTTPException(500, "查詢失敗")


@router.post("/api/cabinets", status_code=201, dependencies=[Depends(require_perm("settings-write"))])
def create_cabinet(data: CabinetCreate):
    """新增櫃子"""
    try:
        conn = get_db()
        try:
            cur = conn.execute(
                "INSERT INTO cabinets (name, note) VALUES (?, ?)",
                (data.name, data.note)
            )
            conn.commit()
            cabinet_id = cur.lastrowid
            cabinet = conn.execute(
                "SELECT id, name, note, created_at FROM cabinets WHERE id = ?",
                (cabinet_id,)
            ).fetchone()
            return dict(cabinet)
        except sqlite3.IntegrityError as e:
            conn.rollback()
            if "UNIQUE" in str(e):
                raise HTTPException(409, f"櫃子名稱「{data.name}」已存在")
            raise
        finally:
            conn.close()
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"create_cabinet 失敗: {e}")
        raise HTTPException(500, "新增失敗")


@router.put("/api/cabinets/{cabinet_id}", dependencies=[Depends(require_perm("settings-write"))])
def update_cabinet(cabinet_id: int, data: CabinetUpdate):
    """編輯櫃子"""
    try:
        conn = get_db()
        try:
            conn.execute(
                "UPDATE cabinets SET name = ?, note = ? WHERE id = ?",
                (data.name, data.note, cabinet_id)
            )
            conn.commit()
            cabinet = conn.execute(
                "SELECT id, name, note, created_at FROM cabinets WHERE id = ?",
                (cabinet_id,)
            ).fetchone()
            if not cabinet:
                raise HTTPException(404, "櫃子不存在")
            return dict(cabinet)
        except sqlite3.IntegrityError as e:
            conn.rollback()
            if "UNIQUE" in str(e):
                raise HTTPException(409, f"櫃子名稱「{data.name}」已存在")
            raise
        finally:
            conn.close()
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"update_cabinet 失敗: {e}")
        raise HTTPException(500, "編輯失敗")


@router.delete("/api/cabinets/{cabinet_id}", dependencies=[Depends(require_perm("settings-write"))])
def delete_cabinet(cabinet_id: int):
    """刪除櫃子"""
    try:
        conn = get_db()
        try:
            conn.execute("DELETE FROM cabinets WHERE id = ?", (cabinet_id,))
            conn.commit()
            return {"deleted": True}
        finally:
            conn.close()
    except Exception as e:
        logger.error(f"delete_cabinet 失敗: {e}")
        raise HTTPException(500, "刪除失敗")
