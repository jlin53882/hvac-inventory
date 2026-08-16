# -*- coding: utf-8 -*-
"""異動紀錄路由（跨領域流水：出庫/退回/盤點/調整皆寫入 movements）。"""
from fastapi import APIRouter, Query

from app.database import get_db

router = APIRouter()


@router.get("/api/movements")
def list_movements(limit: int = Query(50, ge=1, le=500)):
    """異動紀錄（含品項名稱/品牌），依 id 倒序回傳最近 limit 筆"""
    conn = get_db()
    rows = conn.execute(
        """SELECT m.*, i.name, i.brand FROM movements m
           JOIN items i ON i.id = m.item_id
           ORDER BY m.id DESC LIMIT ?""",
        (limit,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]
