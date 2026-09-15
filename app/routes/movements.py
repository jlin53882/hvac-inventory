# -*- coding: utf-8 -*-
"""異動紀錄路由（跨領域流水：出庫/退回/盤點/調整皆寫入 movements）。"""
from fastapi import APIRouter, Query

from app.database import get_db
from app.models import InventorySiteQuery

router = APIRouter()


@router.get("/api/movements")
def list_movements(limit: int = Query(50, ge=1, le=500), site: InventorySiteQuery = "all"):
    """異動紀錄（含名稱/品牌/site），依 id 倒序並可按庫存區過濾。"""
    conn = get_db()
    where = ""
    params = []
    if site != "all":
        where = " WHERE i.site=?"
        params.append(site)
    params.append(limit)
    rows = conn.execute(
        f"""SELECT m.*, i.name, i.brand, i.site FROM movements m
           JOIN items i ON i.id = m.item_id
           {where}
           ORDER BY m.id DESC LIMIT ?""",
        params,
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]
