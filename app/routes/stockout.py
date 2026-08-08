# -*- coding: utf-8 -*-
"""
出庫路由：一般出庫 + 兩階段出庫（待領出 → 已領出）
===================================================
- POST  /api/stockout                      直接出庫（扣庫存 + 去向）
- GET   /api/stockouts                     出庫紀錄（site 篩選）
- POST  /api/items/{id}/prepare            待領出（不扣庫存）
- POST  /api/items/{id}/prepared-out       確認已領出（扣庫存）
- POST  /api/items/{id}/prepared-return    退回（清 prepared_qty）
- GET   /api/prepared                      待領出清單
"""
import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException

from app.database import get_db
from app.models import PrepareRequest, StockOutRequest

router = APIRouter()


@router.post("/api/stockout")
def stock_out(req: StockOutRequest):
    """出庫：扣庫存 + 記錄去向（客戶/案場/工地）"""
    if req.qty <= 0:
        raise HTTPException(400, "出庫數量必須大於 0")
    conn = get_db()
    row = conn.execute("SELECT * FROM items WHERE id=?", (req.item_id,)).fetchone()
    if not row:
        raise HTTPException(404, "品項不存在")
    if row["qty"] < req.qty:
        raise HTTPException(400, f"庫存不足！目前只剩 {row['qty']} {row['unit']}")

    before = row["qty"]
    after = before - req.qty
    reason = "出庫"
    if req.note:
        reason = f"出庫 - {req.note}"

    conn.execute("UPDATE items SET qty=?, updated_at=? WHERE id=?",
                 (after, datetime.datetime.now().isoformat(), req.item_id))
    conn.execute(
        "INSERT INTO movements (item_id, delta, before_qty, after_qty, reason, destination) VALUES (?,?,?,?,?,?)",
        (req.item_id, -req.qty, before, after, reason, req.destination),
    )
    conn.commit()
    updated = conn.execute("SELECT * FROM items WHERE id=?", (req.item_id,)).fetchone()
    conn.close()
    return dict(updated)


@router.get("/api/stockouts")
def list_stock_outs(limit: int = 100, search: str = "", site: Optional[str] = None):
    """出庫紀錄（含去向）"""
    conn = get_db()
    sql = """
        SELECT m.*, i.name as item_name, i.brand, i.code, i.unit
        FROM movements m JOIN items i ON i.id = m.item_id
        WHERE m.delta < 0
    """
    params = []
    if site and site != "all":
        sql += " AND i.site = ?"
        params.append(site)
    if search:
        sql += " AND (m.destination LIKE ? OR i.name LIKE ? OR i.brand LIKE ?)"
        like = f"%{search}%"
        params += [like, like, like]
    sql += " ORDER BY m.id DESC LIMIT ?"
    params.append(limit)
    rows = conn.execute(sql, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ---------- 領出準備（兩階段出庫） ----------

@router.post("/api/items/{item_id}/prepare")
def prepare_item(item_id: int, req: PrepareRequest):
    """領出準備：把東西拿出來準備（庫存不扣，只標記 prepared_qty）"""
    if req.qty <= 0:
        raise HTTPException(400, "數量必須大於 0")
    conn = get_db()
    row = conn.execute("SELECT * FROM items WHERE id=?", (item_id,)).fetchone()
    if not row:
        raise HTTPException(404, "品項不存在")
    available = row["qty"] - row["prepared_qty"]
    if req.qty > available:
        raise HTTPException(400, f"可領出數量不足！可用 {available} {row['unit']}")

    new_prepared = row["prepared_qty"] + req.qty
    conn.execute("UPDATE items SET prepared_qty=?, updated_at=? WHERE id=?",
                 (new_prepared, datetime.datetime.now().isoformat(), item_id))
    conn.execute(
        "INSERT INTO movements (item_id, delta, before_qty, after_qty, reason, destination) VALUES (?,?,?,?,?,?)",
        (item_id, 0, row["qty"], row["qty"], "領出準備", ""),
    )
    conn.commit()
    updated = conn.execute("SELECT * FROM items WHERE id=?", (item_id,)).fetchone()
    conn.close()
    return dict(updated)


@router.post("/api/items/{item_id}/prepared-out")
def prepared_out(item_id: int, req: PrepareRequest):
    """確認出庫：從準備中的數量真正出庫（此時才扣庫存）+ 記錄去向"""
    if req.qty <= 0:
        raise HTTPException(400, "數量必須大於 0")
    conn = get_db()
    row = conn.execute("SELECT * FROM items WHERE id=?", (item_id,)).fetchone()
    if not row:
        raise HTTPException(404, "品項不存在")
    if req.qty > row["prepared_qty"]:
        raise HTTPException(400, f"準備中的數量只有 {row['prepared_qty']} {row['unit']}")

    before = row["qty"]
    after = before - req.qty
    new_prepared = row["prepared_qty"] - req.qty
    dest = req.note  # note 欄位當去向用（相容前端）

    conn.execute("UPDATE items SET qty=?, prepared_qty=?, updated_at=? WHERE id=?",
                 (after, new_prepared, datetime.datetime.now().isoformat(), item_id))
    conn.execute(
        "INSERT INTO movements (item_id, delta, before_qty, after_qty, reason, destination) VALUES (?,?,?,?,?,?)",
        (item_id, -req.qty, before, after, "出庫", dest),
    )
    conn.commit()
    updated = conn.execute("SELECT * FROM items WHERE id=?", (item_id,)).fetchone()
    conn.close()
    return dict(updated)


@router.post("/api/items/{item_id}/prepared-return")
def prepared_return(item_id: int, req: PrepareRequest):
    """退回：把準備中的數量退回（取消領出）"""
    if req.qty <= 0:
        raise HTTPException(400, "數量必須大於 0")
    conn = get_db()
    row = conn.execute("SELECT * FROM items WHERE id=?", (item_id,)).fetchone()
    if not row:
        raise HTTPException(404, "品項不存在")
    if req.qty > row["prepared_qty"]:
        raise HTTPException(400, f"準備中的數量只有 {row['prepared_qty']} {row['unit']}")

    new_prepared = row["prepared_qty"] - req.qty
    conn.execute("UPDATE items SET prepared_qty=?, updated_at=? WHERE id=?",
                 (new_prepared, datetime.datetime.now().isoformat(), item_id))
    conn.execute(
        "INSERT INTO movements (item_id, delta, before_qty, after_qty, reason, destination) VALUES (?,?,?,?,?,?)",
        (item_id, 0, row["qty"], row["qty"], "退回準備", ""),
    )
    conn.commit()
    updated = conn.execute("SELECT * FROM items WHERE id=?", (item_id,)).fetchone()
    conn.close()
    return dict(updated)


@router.get("/api/prepared")
def list_prepared(site: Optional[str] = None):
    """準備中清單（已領出尚未出庫）"""
    conn = get_db()
    where = ""
    params = ()
    if site and site != "all":
        where = " AND site = ?"
        params = (site,)
    rows = conn.execute(f"""
        SELECT * FROM items WHERE prepared_qty > 0{where} ORDER BY brand COLLATE NOCASE, name
    """, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]
