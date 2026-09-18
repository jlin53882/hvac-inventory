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

from fastapi import Depends, APIRouter, HTTPException, Query

from app.database import get_db
from app.services import movement_time
from app.models import InventorySiteQuery, StocktakeSubmit
from app.services.auth import require_perm
from app.services.inventory_stock import assert_projected_inventory
from app.services.quantity import canonical_qty

# 盤點 API 路由
router = APIRouter()


@router.post("/api/stocktake", dependencies=[Depends(require_perm("stocktake"))])
def submit_stocktake(req: StocktakeSubmit):
    """盤點：逐項輸入實際數量，計算盤盈/盤虧並更新庫存

    2026-08-14 併發修復：寫回改樂觀鎖（WHERE qty=? 比對讀到的 system_qty）——
    併發被他人改過 → rowcount=0 → 整批 409 拒絕（不覆蓋同時進行的出庫/調整）。
    整函式 try/except/finally：既有 error 路徑不再洩漏連線。
    """
    conn = get_db()
    try:
        conn.execute("BEGIN IMMEDIATE")
        movement_ts = movement_time.now_sql()
        take_date = req.take_date or datetime.date.today().isoformat()
        results = []

        for it in req.items:
            if not isinstance(it, dict):  # 2026-08-12 補：非 dict → 400（af13870 只修了 import 同類）
                raise HTTPException(400, "盤點項目格式錯誤（需為 JSON 物件）")
            if "item_id" not in it or not isinstance(it["item_id"], int):
                raise HTTPException(400, "盤點項目缺少 item_id 或格式錯誤（需為整數）")
            # v10：item_id + location 定位到一筆 stock
            location = it.get("location", "")
            stock = conn.execute(
                "SELECT * FROM item_stocks WHERE item_id=? AND location=?",
                (it["item_id"], location),
            ).fetchone()
            if not stock:
                # P0-F：盤點屬高正確性操作，不可 silent skip——整批拒絕 + rollback
                raise HTTPException(409, f"品項 {it['item_id']} 在「{location}」的庫存位置已異動，請重新載入盤點資料")
            item = conn.execute("SELECT * FROM items WHERE id=? AND is_deleted=0", (it["item_id"],)).fetchone()
            if not item:  # M6：soft-delete 品項不可盤點
                raise HTTPException(400, f"品項 {it['item_id']} 已刪除，無法盤點")
            if req.site and item["site"] != req.site:
                raise HTTPException(400, f"品項 {item['name']} 不屬於目前盤點庫存區")
            system_qty = stock["qty"]
            raw_actual = it.get("actual_qty", system_qty)
            try:
                actual_qty = canonical_qty(raw_actual)
            except ValueError:  # M4/M7b：非數字 → 400（原本 500）
                raise HTTPException(400, "盤點數量格式錯誤")
            if actual_qty < 0:  # M4：負數拒絕
                raise HTTPException(400, "盤點數量不能為負數")
            # P0-E：prepared 是 item total 級——判定式必須是
            # other_locations_total + this_location_actual >= prepared
            diff = canonical_qty(actual_qty - system_qty)
            assert_projected_inventory(conn, it["item_id"], stock_delta=diff)
            note = it.get("note", "")

            # 2026-08-14：樂觀鎖——寫回條件是「qty 仍是讀到的 system_qty」，
            # 併發被他人改過 → rowcount=0 → 整批拒絕（盤點前需重新載入）
            cur = conn.execute(
                "UPDATE item_stocks SET qty=ROUND(qty+?,3), updated_at=? WHERE id=? AND qty=?",
                (diff, datetime.datetime.now().isoformat(), stock["id"], system_qty),
            )
            if cur.rowcount == 0:
                raise HTTPException(409, f"品項 {item['name']} 的庫存已被其他操作異動，請重新整理後再盤點")
            conn.execute(
                "INSERT INTO movements (item_id, delta, before_qty, after_qty, reason, destination, created_at) VALUES (?,?,?,?,?,?,?)",
                (it["item_id"], diff, system_qty, canonical_qty(system_qty + diff), "盤點調整", location, movement_ts),
            )
            conn.execute(
                "INSERT INTO stocktakes (take_date, item_id, location, system_qty, actual_qty, diff, note) VALUES (?,?,?,?,?,?,?)",
                (take_date, it["item_id"], location, system_qty, actual_qty, diff, note),
            )
            results.append({"item_id": it["item_id"], "name": item["name"], "location": location,
                            "system_qty": system_qty, "actual_qty": actual_qty, "diff": diff})

        conn.commit()
        return {"take_date": take_date, "count": len(results), "results": results}
    except:
        conn.rollback()
        raise
    finally:
        conn.close()


@router.get("/api/stocktakes")
def list_stocktakes(limit: int = Query(200, ge=1, le=500), site: InventorySiteQuery = "all"):
    """盤點紀錄（含差異，可按庫存區篩選）"""
    conn = get_db()
    where = ""
    params = []
    if site != "all":
        where = " WHERE i.site=?"
        params.append(site)
    params.append(limit)
    rows = conn.execute(f"""
        SELECT s.*, i.name as item_name, i.brand, i.unit
        FROM stocktakes s JOIN items i ON i.id = s.item_id
        {where}
        ORDER BY s.id DESC LIMIT ?
    """, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@router.get("/api/stocktake/dates")
def stocktake_dates(site: InventorySiteQuery = "all"):
    """盤點日期清單（含每批差異統計，可按庫存區篩選）"""
    conn = get_db()
    where = ""
    params = []
    if site != "all":
        where = " WHERE i.site=?"
        params.append(site)
    rows = conn.execute(f"""
        SELECT s.take_date, COUNT(*) as item_count,
               SUM(CASE WHEN s.diff != 0 THEN 1 ELSE 0 END) as diff_count,
               ROUND(SUM(s.diff), 3) as total_diff
        FROM stocktakes s JOIN items i ON i.id = s.item_id
        {where}
        GROUP BY s.take_date ORDER BY s.take_date DESC
    """, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]