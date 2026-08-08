# -*- coding: utf-8 -*-
"""
品項路由：CRUD + 庫存調整 + 匯入 + 異動紀錄
===========================================
- GET/POST    /api/items          查詢/新增品項（brand/search/location/site 篩選）
- PATCH       /api/items/{id}     修改品項
- POST        /api/items/{id}/adjust  加減庫存
- POST        /api/import         從 JSON 匯入
- GET         /api/movements      異動紀錄
"""
import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException

from app.database import get_db
from app.models import AdjustRequest, ItemCreate, ItemUpdate

router = APIRouter()


@router.get("/api/items")
def list_items(
    brand: Optional[str] = None,
    search: Optional[str] = None,
    location: Optional[str] = None,
    sort: str = "brand",
    site: Optional[str] = None,
):
    conn = get_db()
    sql = "SELECT * FROM items WHERE 1=1"
    params = []
    if site and site != "all":
        sql += " AND site = ?"
        params.append(site)
    if brand and brand != "全部":
        sql += " AND brand = ?"
        params.append(brand)
    if location:
        sql += " AND location = ?"
        params.append(location)
    if search:
        sql += " AND (name LIKE ? OR code LIKE ? OR brand LIKE ? OR note LIKE ?)"
        like = f"%{search}%"
        params += [like, like, like, like]

    sort_map = {
        "brand": "brand COLLATE NOCASE, name",
        "location": "location, name",
        "qty": "qty DESC",
        "created": "id DESC",
    }
    sql += f" ORDER BY {sort_map.get(sort, 'brand COLLATE NOCASE, name')}"
    rows = conn.execute(sql, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@router.post("/api/items", status_code=201)
def create_item(item: ItemCreate):
    conn = get_db()
    cur = conn.execute(
        "INSERT INTO items (brand, code, name, qty, unit, location, note, low_stock, site) VALUES (?,?,?,?,?,?,?,?,?)",
        (item.brand, item.code, item.name, item.qty, item.unit, item.location, item.note, item.low_stock, item.site),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM items WHERE id=?", (cur.lastrowid,)).fetchone()
    conn.close()
    return dict(row)


@router.patch("/api/items/{item_id}")
def update_item(item_id: int, upd: ItemUpdate):
    conn = get_db()
    fields = {k: v for k, v in upd.model_dump().items() if v is not None}
    if not fields:
        raise HTTPException(400, "沒有要更新的欄位")
    fields["updated_at"] = datetime.datetime.now().isoformat()
    sets = ", ".join(f"{k}=?" for k in fields)
    conn.execute(f"UPDATE items SET {sets} WHERE id=?", (*fields.values(), item_id))
    conn.commit()
    row = conn.execute("SELECT * FROM items WHERE id=?", (item_id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "品項不存在")
    return dict(row)


@router.post("/api/items/{item_id}/adjust")
def adjust_qty(item_id: int, req: AdjustRequest):
    conn = get_db()
    row = conn.execute("SELECT * FROM items WHERE id=?", (item_id,)).fetchone()
    if not row:
        raise HTTPException(404, "品項不存在")

    before = row["qty"]
    after = max(0, before + req.delta)

    conn.execute("UPDATE items SET qty=?, updated_at=? WHERE id=?",
                 (after, datetime.datetime.now().isoformat(), item_id))
    conn.execute(
        "INSERT INTO movements (item_id, delta, before_qty, after_qty, reason, destination) VALUES (?,?,?,?,?,?)",
        (item_id, req.delta, before, after, req.reason, req.destination),
    )
    conn.commit()
    updated = conn.execute("SELECT * FROM items WHERE id=?", (item_id,)).fetchone()
    conn.close()
    return dict(updated)


@router.post("/api/import")
def import_items(data: dict):
    """data: {"items": [...], "mode": "replace"|"append"}"""
    items = data.get("items", [])
    mode = data.get("mode", "replace")
    conn = get_db()

    if mode == "replace":
        conn.execute("DELETE FROM movements")
        conn.execute("DELETE FROM items")

    count = 0
    for it in items:
        cur = conn.execute(
            "INSERT INTO items (brand, code, name, qty, unit, location, note, low_stock) VALUES (?,?,?,?,?,?,?,?)",
            (
                it.get("brand", ""),
                it.get("code", ""),
                it.get("name", ""),
                it.get("qty", 0),
                it.get("unit", "個"),
                it.get("location", ""),
                it.get("note", ""),
                it.get("low_stock", 0),
            ),
        )
        # 同步建立異動紀錄（初始庫存）
        conn.execute(
            "INSERT INTO movements (item_id, delta, before_qty, after_qty, reason, destination) VALUES (?,?,?,?,?,?)",
            (cur.lastrowid, it.get("qty", 0), 0, it.get("qty", 0), "初始匯入", ""),
        )
        count += 1

    conn.commit()
    total = conn.execute("SELECT COUNT(*) FROM items").fetchone()[0]
    conn.close()
    return {"imported": count, "total_items": total}


@router.get("/api/movements")
def list_movements(limit: int = 100):
    conn = get_db()
    rows = conn.execute("""
        SELECT m.*, i.name as item_name, i.brand
        FROM movements m JOIN items i ON i.id = m.item_id
        ORDER BY m.id DESC LIMIT ?
    """, (limit,)).fetchall()
    conn.close()
    return [dict(r) for r in rows]
