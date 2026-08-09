# -*- coding: utf-8 -*-
"""
出庫路由（v10 正規化）：一般出庫 + 兩階段出庫（待領出 → 已領出）
============================================================
- POST  /api/stockout                      直接出庫（扣庫存 + 去向）
- GET   /api/stockouts                     出庫紀錄（site 篩選）
- POST  /api/items/{id}/prepare            待領出（不扣庫存）
- POST  /api/items/{id}/prepared-out       確認已領出（扣庫存）
- POST  /api/items/{id}/prepared-return    退回（清 prepared_qty）
- GET   /api/prepared                      待領出清單

v10 數量語意：
  總庫存 = SUM(item_stocks.qty)
  出庫可指定 location（空白 = 依庫存順序從後往前扣）
  prepared_qty 保留在主檔（總量維度）
"""
import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException

from app.database import get_db
from app.models import PrepareRequest, StockOutRequest

router = APIRouter()


def _total_qty(conn, item_id) -> float:
    """計算單一品項的位置庫存總量，回傳 float"""
    return conn.execute("SELECT COALESCE(SUM(qty),0) FROM item_stocks WHERE item_id=?",
                        (item_id,)).fetchone()[0]


def _item_payload(conn, row) -> dict:
    """回傳品項完整 payload（補 total_qty/stocks/location/note 相容欄位）"""
    d = dict(row)
    stocks = conn.execute("SELECT * FROM item_stocks WHERE item_id=? ORDER BY id",
                          (row["id"],)).fetchall()
    d["stocks"] = [dict(s) for s in stocks]
    d["total_qty"] = sum(s["qty"] for s in stocks)
    d["qty"] = d["total_qty"]
    d["location"] = stocks[0]["location"] if stocks else ""
    d["note"] = stocks[0]["note"] if stocks else ""
    return d


def _deduct(conn, item_id, qty, location=""):
    """從位置庫存扣數量。location 指定 → 只扣該位置；空白 → 依序從第一筆往後扣。
    回傳 (total_before, total_after)"""
    stocks = conn.execute(
        "SELECT * FROM item_stocks WHERE item_id=? ORDER BY id", (item_id,)).fetchall()
    total_before = sum(s["qty"] for s in stocks)
    if location:
        target = [s for s in stocks if s["location"] == location]
        if not target:
            raise HTTPException(400, f"該品項在「{location}」沒有庫存")
        if target[0]["qty"] < qty:
            raise HTTPException(400, f"「{location}」庫存不足！只剩 {target[0]['qty']}")
        conn.execute("UPDATE item_stocks SET qty=qty-?, updated_at=? WHERE id=?",
                     (qty, datetime.datetime.now().isoformat(), target[0]["id"]))
    else:
        remaining = qty
        for s in stocks:  # 依序（第一筆先扣）
            if remaining <= 0:
                break
            take = min(s["qty"], remaining)
            conn.execute("UPDATE item_stocks SET qty=qty-?, updated_at=? WHERE id=?",
                         (take, datetime.datetime.now().isoformat(), s["id"]))
            remaining -= take
        if remaining > 0:
            raise HTTPException(400, f"庫存不足！只剩 {total_before}")
    return total_before, total_before - qty


@router.post("/api/stockout")
def stock_out(req: StockOutRequest):
    """出庫：扣庫存 + 記錄去向（客戶/案場/工地）"""
    if req.qty <= 0:
        raise HTTPException(400, "出庫數量必須大於 0")
    conn = get_db()
    row = conn.execute("SELECT * FROM items WHERE id=?", (req.item_id,)).fetchone()
    if not row:
        raise HTTPException(404, "品項不存在")
    before = _total_qty(conn, req.item_id)
    if before < req.qty:
        raise HTTPException(400, f"庫存不足！目前只剩 {before} {row['unit']}")

    reason = "出庫"
    if req.note:
        reason = f"出庫 - {req.note}"
    _, after = _deduct(conn, req.item_id, req.qty, req.location)
    conn.execute(
        "INSERT INTO movements (item_id, delta, before_qty, after_qty, reason, destination) VALUES (?,?,?,?,?,?)",
        (req.item_id, -req.qty, before, after, reason, req.destination),
    )
    conn.commit()
    updated = conn.execute("SELECT * FROM items WHERE id=?", (req.item_id,)).fetchone()
    payload = _item_payload(conn, updated)
    conn.close()
    return payload


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
    available = _total_qty(conn, item_id) - row["prepared_qty"]
    if req.qty > available:
        raise HTTPException(400, f"可領出數量不足！可用 {available} {row['unit']}")

    new_prepared = row["prepared_qty"] + req.qty
    conn.execute("UPDATE items SET prepared_qty=?, updated_at=? WHERE id=?",
                 (new_prepared, datetime.datetime.now().isoformat(), item_id))
    conn.execute(
        "INSERT INTO movements (item_id, delta, before_qty, after_qty, reason, destination) VALUES (?,?,?,?,?,?)",
        (item_id, 0, row["prepared_qty"], new_prepared, "領出準備", req.location),
    )
    conn.commit()
    updated = conn.execute("SELECT * FROM items WHERE id=?", (item_id,)).fetchone()
    payload = _item_payload(conn, updated)
    conn.close()
    return payload


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

    before = _total_qty(conn, item_id)
    after = before - req.qty
    new_prepared = row["prepared_qty"] - req.qty
    dest = req.note  # note 欄位當去向用（相容前端）

    _deduct(conn, item_id, req.qty, req.location)
    conn.execute("UPDATE items SET prepared_qty=?, updated_at=? WHERE id=?",
                 (new_prepared, datetime.datetime.now().isoformat(), item_id))
    conn.execute(
        "INSERT INTO movements (item_id, delta, before_qty, after_qty, reason, destination) VALUES (?,?,?,?,?,?)",
        (item_id, -req.qty, before, after, "出庫", dest),
    )
    conn.commit()
    updated = conn.execute("SELECT * FROM items WHERE id=?", (item_id,)).fetchone()
    payload = _item_payload(conn, updated)
    conn.close()
    return payload


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
        (item_id, 0, row["prepared_qty"], new_prepared, "退回準備", ""),
    )
    conn.commit()
    updated = conn.execute("SELECT * FROM items WHERE id=?", (item_id,)).fetchone()
    payload = _item_payload(conn, updated)
    conn.close()
    return payload


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
    payloads = [_item_payload(conn, r) for r in rows]  # 補 total_qty/location/stocks 相容欄位
    conn.close()
    return payloads