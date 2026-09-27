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


@router.get("/api/cabinets")
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


@router.post("/api/cabinets", status_code=201, dependencies=[Depends(require_perm("user-mgmt"))])
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


@router.put("/api/cabinets/{cabinet_id}", dependencies=[Depends(require_perm("user-mgmt"))])
def update_cabinet(cabinet_id: int, data: CabinetUpdate):
    """編輯櫃子（2026-09-28 rename 時同步更新 persisted location 中的櫃子名）"""
    try:
        conn = get_db()
        try:
            conn.execute("BEGIN IMMEDIATE")
            # 先取舊名稱
            old_cabinet = conn.execute(
                "SELECT name FROM cabinets WHERE id = ?", (cabinet_id,)
            ).fetchone()
            if not old_cabinet:
                raise HTTPException(404, "櫃子不存在")
            
            old_name = old_cabinet["name"]
            new_name = data.name.strip()
            
            # 若名稱有改，同步 item_stocks.location 中的櫃子部分
            if old_name != new_name:
                # location 格式為 "櫃子名|位置" 或只有 "櫃子名"
                # REPLACE old_name| → new_name| 並處理純 old_name 的情況
                conn.execute(
                    "UPDATE item_stocks SET location = REPLACE(location, ?, ?) WHERE location LIKE ? OR location = ?",
                    (f"{old_name}|", f"{new_name}|", f"{old_name}|%", old_name)
                )
                # 若保留 kit_locations，同步其 cabinet 欄位
                conn.execute(
                    "UPDATE kit_locations SET cabinet = ? WHERE cabinet = ?",
                    (new_name, old_name)
                )
            
            # 更新 cabinets 表
            conn.execute(
                "UPDATE cabinets SET name = ?, note = ? WHERE id = ?",
                (new_name, data.note, cabinet_id)
            )
            conn.commit()
            
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
        logger.error(f"update_cabinet 失敗: {e}")
        raise HTTPException(500, "編輯失敗")


@router.delete("/api/cabinets/{cabinet_id}", dependencies=[Depends(require_perm("user-mgmt"))])
def delete_cabinet(cabinet_id: int):
    """刪除櫃子（2026-09-28 檢查是否有位置使用該櫃子，若有則拒絕）"""
    try:
        conn = get_db()
        try:
            conn.execute("BEGIN IMMEDIATE")
            # 先取櫃子名稱
            cabinet = conn.execute(
                "SELECT name FROM cabinets WHERE id = ?", (cabinet_id,)
            ).fetchone()
            if not cabinet:
                raise HTTPException(404, "櫃子不存在")
            
            cabinet_name = cabinet["name"]
            
            # 檢查 item_stocks 是否有使用該櫃子
            usage_count = conn.execute(
                "SELECT COUNT(*) as cnt FROM item_stocks WHERE location = ? OR location LIKE ?",
                (cabinet_name, f"{cabinet_name}|%")
            ).fetchone()["cnt"]
            
            if usage_count > 0:
                conn.rollback()
                raise HTTPException(409, f"櫃子「{cabinet_name}」仍有 {usage_count} 筆位置使用，無法刪除")
            
            # 若保留 kit_locations，也檢查該表
            kit_usage_count = conn.execute(
                "SELECT COUNT(*) as cnt FROM kit_locations WHERE cabinet = ?",
                (cabinet_name,)
            ).fetchone()["cnt"]
            
            if kit_usage_count > 0:
                conn.rollback()
                raise HTTPException(409, f"櫃子「{cabinet_name}」在整組中有 {kit_usage_count} 個位置，無法刪除")
            
            # 無使用則刪除
            conn.execute("DELETE FROM cabinets WHERE id = ?", (cabinet_id,))
            conn.commit()
            return {"deleted": True}
        except HTTPException:
            if conn:
                conn.rollback()
            raise
        finally:
            conn.close()
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"delete_cabinet 失敗: {e}")
        raise HTTPException(500, "刪除失敗")
