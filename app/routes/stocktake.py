# -*- coding: utf-8 -*-
"""
盤點路由（v10 正規化：以位置庫存為單位對帳）
============================================
- POST /api/stocktake          提交盤點（逐項實際數量 → 更新庫存 + 記差異）
- GET  /api/stocktakes         盤點紀錄
- GET  /api/stocktake/dates    盤點日期清單（含差異統計）

v10 語意：盤點對象 = item_stocks（某品項在某位置），
system_qty = 該位置數量，更新也寫回該位置。
"""
import datetime

from fastapi import APIRouter

from app.database import get_db
from app.models import StocktakeSubmit

router = APIRouter()


@router.post("/api/stocktake")
def submit_stocktake(req: StocktakeSubmit):
    """盤點：逐項輸入實際數量，計算盤盈/盤虧並更新庫存"""
    conn = get_db()
    take_date = req.take_date or datetime.date.today().isoformat()
    results = []

    for it in req.items:
        # v10：item_id + location 定位到一筆 stock
        location = it.get("location", "")
        stock = conn.execute(
            "SELECT * FROM item_stocks WHERE item_id=? AND location=?",
            (it["item_id"], location),
        ).fetchone()
        if not stock:
            continue
        item = conn.execute("SELECT * FROM items WHERE id=?", (it["item_id"],)).fetchone()
        system_qty = stock["qty"]
        actual_qty = float(it.get("actual_qty", system_qty))
        diff = round(actual_qty - system_qty, 3)
        note = it.get("note", "")

        conn.execute("UPDATE item_stocks SET qty=?, updated_at=? WHERE id=?",
                     (actual_qty, datetime.datetime.now().isoformat(), stock["id"]))
        conn.execute(
            "INSERT INTO movements (item_id, delta, before_qty, after_qty, reason, destination) VALUES (?,?,?,?,?,?)",
            (it["item_id"], diff, system_qty, actual_qty, "盤點調整", location),
        )
        conn.execute(
            "INSERT INTO stocktakes (take_date, item_id, location, system_qty, actual_qty, diff, note) VALUES (?,?,?,?,?,?,?)",
            (take_date, it["item_id"], location, system_qty, actual_qty, diff, note),
        )
        results.append({"item_id": it["item_id"], "name": item["name"], "location": location,
                        "system_qty": system_qty, "actual_qty": actual_qty, "diff": diff})

    conn.commit()
    conn.close()
    return {"take_date": take_date, "count": len(results), "results": results}


@router.get("/api/stocktakes")
def list_stocktakes(limit: int = 200):
    """盤點紀錄（含差異）"""
    conn = get_db()
    rows = conn.execute("""
        SELECT s.*, i.name as item_name, i.brand, i.unit
        FROM stocktakes s JOIN items i ON i.id = s.item_id
        ORDER BY s.id DESC LIMIT ?
    """, (limit,)).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@router.get("/api/stocktake/dates")
def stocktake_dates():
    """盤點日期清單（含每批差異統計）"""
    conn = get_db()
    rows = conn.execute("""
        SELECT take_date, COUNT(*) as item_count,
               SUM(CASE WHEN diff != 0 THEN 1 ELSE 0 END) as diff_count,
               ROUND(SUM(diff), 3) as total_diff
        FROM stocktakes GROUP BY take_date ORDER BY take_date DESC
    """).fetchall()
    conn.close()
    return [dict(r) for r in rows]