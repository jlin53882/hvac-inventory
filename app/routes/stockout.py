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

from fastapi import Depends, APIRouter, HTTPException, Query

from app.database import get_db
from app.models import NonStockOutRequest, PrepareRequest, StockOutRequest, StockoutUpdate
from app.routes.photos import has_photo
from app.services.auth import require_perm

# 出庫/待領出 API 路由
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
    d["has_photo"] = has_photo(d["id"])  # 待領出/回傳清單顯示品項照片縮圖（與已領出一致）
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
        cur = conn.execute("UPDATE item_stocks SET qty=qty-?, updated_at=? WHERE id=? AND qty>=?",
                           (qty, datetime.datetime.now().isoformat(), target[0]["id"], qty))
        if cur.rowcount == 0:  # H5：併發已被扣走 → 保守拒絕，不超賣
            raise HTTPException(400, f"「{location}」庫存不足！只剩 {target[0]['qty']}")
    else:
        remaining = qty
        for s in stocks:  # 依序（第一筆先扣）
            if remaining <= 0:
                break
            take = min(s["qty"], remaining)
            cur = conn.execute("UPDATE item_stocks SET qty=qty-?, updated_at=? WHERE id=? AND qty>=?",
                               (take, datetime.datetime.now().isoformat(), s["id"], take))
            if cur.rowcount == 0:  # H5：併發已被扣走 → 保守拒絕，不超賣
                raise HTTPException(400, f"庫存不足！只剩 {total_before}")
            remaining -= take
        if remaining > 0:
            raise HTTPException(400, f"庫存不足！只剩 {total_before}")
    # 2026-08-14 P4-1：寫後重讀真實總量（併發下流水鏈 before+delta=after 恆成立）
    total_after = sum(s["qty"] for s in conn.execute(
        "SELECT qty FROM item_stocks WHERE item_id=?", (item_id,)).fetchall())
    return total_after + qty, total_after


@router.post("/api/stockout", dependencies=[Depends(require_perm("stockout"))])
def stock_out(req: StockOutRequest):
    """出庫：扣庫存 + 記錄去向（客戶/案場/工地）"""
    if req.qty <= 0:
        raise HTTPException(400, "出庫數量必須大於 0")
    conn = get_db()
    try:
        row = conn.execute("SELECT * FROM items WHERE id=? AND is_deleted=0", (req.item_id,)).fetchone()
        if not row:
            raise HTTPException(404, "品項不存在")
        before = _total_qty(conn, req.item_id)
        if before < req.qty:
            raise HTTPException(400, f"庫存不足！目前只剩 {before} {row['unit']}")
        # M3：出庫後剩餘不得低於待領出數量（保留準備量給「確認出庫」；與 adjust_qty 守衛一致）
        prepared = row["prepared_qty"] or 0
        if before - req.qty < prepared:
            raise HTTPException(400, f"出庫後剩餘庫存不能低於待領出數量！目前庫存 {before}、待領出 {prepared}，請從「待領出」確認出庫")

        reason = "出庫"
        if req.note:
            reason = f"出庫 - {req.note}"
        # 2026-08-14 P4-1：before/after 用 _deduct 寫後重讀值（鏈一致）
        before, after = _deduct(conn, req.item_id, req.qty, req.location)
        conn.execute(
            "INSERT INTO movements (item_id, delta, before_qty, after_qty, reason, destination) VALUES (?,?,?,?,?,?)",
            (req.item_id, -req.qty, before, after, reason, req.destination),
        )
        conn.commit()
        updated = conn.execute("SELECT * FROM items WHERE id=?", (req.item_id,)).fetchone()
        return _item_payload(conn, updated)
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


@router.post("/api/stockout/nonstock", dependencies=[Depends(require_perm("stockout"))])
def stock_out_nonstock(req: NonStockOutRequest):
    """新增「非庫存品項」的已領出（2026-08-13 Sarah）：建臨時品項（is_deleted=1 不出現在庫存頁）+ 只記出庫流水、不扣庫存"""
    name = req.name.strip()
    dest = req.destination.strip()
    unit = req.unit.strip() or "個"
    code = req.code.strip()
    note = req.note.strip()
    if not name:
        raise HTTPException(400, "品項名稱不能為空")
    if req.qty <= 0:
        raise HTTPException(400, "出庫數量必須大於 0")
    if not dest:
        raise HTTPException(400, "去哪裡（客戶/案場/工地）不能為空")
    conn = get_db()
    try:
        cur = conn.execute(
            "INSERT INTO items (brand, code, name, prepared_qty, unit, low_stock, is_kit, site, is_deleted) "
            "VALUES ('',?,?,0,?,0,0,'',1)",
            (code, name, unit),
        )
        item_id = cur.lastrowid
        reason = "出庫" if not note else f"出庫 - {note}"
        conn.execute(
            "INSERT INTO movements (item_id, delta, before_qty, after_qty, reason, destination) VALUES (?,?,0,0,?,?)",
            (item_id, -req.qty, reason, dest),
        )
        conn.commit()
        return {"id": item_id, "name": name}
    except Exception:
        conn.rollback()   # 2026-08-14 鎖洩漏根治：確保釋放 RESERVED 鎖
        raise
    finally:
        conn.close()      # 2026-08-14 防止中途炸掉 close 被跳過（bare-conn 洩漏主因）


@router.get("/api/stockouts", dependencies=[Depends(require_perm("prepared"))])
def list_stock_outs(limit: int = Query(100, ge=1, le=500), search: str = "", site: Optional[str] = None):
    """出庫紀錄（含去向）"""
    conn = get_db()
    sql = """
        SELECT m.*, i.name as item_name, i.brand, i.code, i.unit, i.is_deleted as item_deleted
        FROM movements m JOIN items i ON i.id = m.item_id
        WHERE m.delta < 0 AND m.reason LIKE '出庫%'
    """
    params = []
    if site and site != "all":
        # 非庫存品項（is_deleted=1）不分 site 永遠顯示（2026-08-13：已領出隨 site 過濾，但非庫存品項不屬於任何 site）
        sql += " AND (i.site = ? OR i.is_deleted = 1)"
        params.append(site)
    if search:
        sql += " AND (m.destination LIKE ? OR i.name LIKE ? OR i.brand LIKE ?)"
        like = f"%{search}%"
        params += [like, like, like]
    sql += " ORDER BY m.id DESC LIMIT ?"
    params.append(limit)
    rows = conn.execute(sql, params).fetchall()
    conn.close()
    outs = []
    for r in rows:
        d = dict(r)
        d["has_photo"] = has_photo(d["item_id"])  # 已領出列表顯示品項照片縮圖
        outs.append(d)
    return outs


def _add_back_to_first_stock(conn, item_id, qty):
    """退回/補回：把數量加回第一筆位置庫存（與 adjust_qty 正數邏輯一致）"""
    stocks = conn.execute(
        "SELECT * FROM item_stocks WHERE item_id=? ORDER BY id", (item_id,)).fetchall()
    if not stocks:
        raise HTTPException(400, "品項無庫存位置，無法退回")
    conn.execute("UPDATE item_stocks SET qty=qty+?, updated_at=? WHERE id=?",
                 (qty, datetime.datetime.now().isoformat(), stocks[0]["id"]))


@router.post("/api/stockouts/{movement_id}/return", dependencies=[Depends(require_perm("stockout"))])
def return_stockout(movement_id: int):
    try:
        """退回已領出：把該筆出庫數量加回庫存 + 標記原記錄（reverted_at）+ 寫反向流水"""
        conn = get_db()
        m = conn.execute("SELECT * FROM movements WHERE id=?", (movement_id,)).fetchone()
        if not m:
            raise HTTPException(404, "出庫記錄不存在")
        if m["delta"] >= 0 or not str(m["reason"]).startswith("出庫"):
            raise HTTPException(400, "只有已領出（出庫）記錄可以退回")
        if m["reverted_at"]:
            raise HTTPException(400, "該記錄已退回過")

        qty = -m["delta"]
        current = _total_qty(conn, m["item_id"])  # M9：before_qty 用當前實際庫存（原用歷史值 m["after_qty"]）
        _add_back_to_first_stock(conn, m["item_id"], qty)
        now = datetime.datetime.now().isoformat()
        # 2026-08-12 補：守衛式 UPDATE（WHERE reverted_at IS NULL）+ rowcount——
        # 併發雙請求都通過上方讀取檢查時，只允許一個成功，另一個 rollback 撤銷已加庫存
        cur = conn.execute(
            "UPDATE movements SET reverted_at=? WHERE id=? AND reverted_at IS NULL", (now, movement_id))
        if cur.rowcount == 0:
            raise HTTPException(400, "該記錄已退回過")
        conn.execute(
            "INSERT INTO movements (item_id, delta, before_qty, after_qty, reason, destination) VALUES (?,?,?,?,?,?)",
            (m["item_id"], qty, current, current + qty, "退回已領出", m["destination"]),
        )
        conn.commit()
        return {"ok": True, "movement_id": movement_id, "returned_qty": qty}
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


@router.patch("/api/stockouts/{movement_id}", dependencies=[Depends(require_perm("stockout"))])
def update_stockout(movement_id: int, upd: StockoutUpdate):
    """編輯已領出記錄：去向 / 數量（差額補/扣庫存並記錄流水）/ 日期"""
    conn = get_db()
    try:
        # 2026-08-14 P4-4：BEGIN IMMEDIATE 防兩視窗同時編輯同一筆（流水 delta 絕對值覆寫）
        conn.execute("BEGIN IMMEDIATE")
        m = conn.execute("SELECT * FROM movements WHERE id=?", (movement_id,)).fetchone()
        if not m:
            raise HTTPException(404, "出庫記錄不存在")
        if m["delta"] >= 0 or not str(m["reason"]).startswith("出庫"):
            raise HTTPException(400, "只有已領出（出庫）記錄可以編輯")
        if m["reverted_at"]:
            raise HTTPException(400, "已退回的記錄不能編輯")

        old_qty = -m["delta"]
        if upd.qty is not None:
            if upd.qty <= 0:
                raise HTTPException(400, "數量必須大於 0")
            new_qty = upd.qty
            diff = new_qty - old_qty  # >0 需多扣庫存；<0 補回庫存
            if diff > 0:
                _deduct(conn, m["item_id"], diff, "")  # 庫存不足會 400
            elif diff < 0:
                _add_back_to_first_stock(conn, m["item_id"], -diff)
            new_after = m["before_qty"] - new_qty  # 原出庫記錄的 after（B0 - 新數量）
            conn.execute("UPDATE movements SET delta=?, after_qty=? WHERE id=?",
                         (-new_qty, new_after, movement_id))
            if abs(diff) > 1e-9:  # 浮點差額：奈米級誤差不寫流水
                # 2026-08-14 審查修（P4-1）：編輯調整流水的 before_qty 用「編輯前總量」= 原記錄 after_qty（B0-old_qty）
                # → 鏈：(B0-old_qty) + (old_qty-new_qty) = B0-new_qty 恆成立
                conn.execute(
                    "INSERT INTO movements (item_id, delta, before_qty, after_qty, reason, destination) VALUES (?,?,?,?,?,?)",
                    (m["item_id"], -diff, m["after_qty"], new_after, "已領出編輯調整", m["destination"]),
                )
        if upd.destination is not None:
            conn.execute("UPDATE movements SET destination=? WHERE id=?",
                         (upd.destination, movement_id))
        if upd.created_at is not None:
            conn.execute("UPDATE movements SET created_at=? WHERE id=?",
                         (upd.created_at, movement_id))
        conn.commit()
        row = conn.execute("SELECT * FROM movements WHERE id=?", (movement_id,)).fetchone()
        return dict(row)
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# ---------- 領出準備（兩階段出庫） ----------


@router.delete("/api/stockouts/{movement_id}", dependencies=[Depends(require_perm("stockout"))])
def delete_stockout(movement_id: int):
    """刪除已領出紀錄（僅刪紀錄，不回補庫存；需回復庫存請用退回）"""
    conn = get_db()
    try:
        row = conn.execute("SELECT delta, reason FROM movements WHERE id=?", (movement_id,)).fetchone()
        if not row:
            raise HTTPException(404, "紀錄不存在")
        # 2026-08-12 補：只允許刪「出庫」流水——手動調整/盤點/退回反向流水是稽核軌跡，不可刪
        if row["delta"] >= 0 or not str(row["reason"]).startswith("出庫"):
            raise HTTPException(400, "只有已領出（出庫）記錄可以刪除")
        conn.execute("DELETE FROM movements WHERE id=?", (movement_id,))
        conn.commit()
        return {"ok": True, "deleted": movement_id}
    except Exception:
        conn.rollback()   # 2026-08-14 鎖洩漏根治：確保釋放 RESERVED 鎖
        raise
    finally:
        conn.close()      # 2026-08-14 防止中途炸掉 close 被跳過（bare-conn 洩漏主因）


@router.post("/api/prepare/nonstock", dependencies=[Depends(require_perm("stockout"))])
def prepare_nonstock(req: NonStockOutRequest):
    """新增「非庫存品項」的待領出（2026-08-13 家豪，比照 /api/stockout/nonstock）：建臨時品項（is_deleted=1）+ 標記 prepared_qty，不扣庫存"""
    name = req.name.strip()
    unit = req.unit.strip() or "個"
    code = req.code.strip()
    note = req.note.strip()
    if not name:
        raise HTTPException(400, "品項名稱不能為空")
    if req.qty <= 0:
        raise HTTPException(400, "數量必須大於 0")
    conn = get_db()
    try:
        cur = conn.execute(
            "INSERT INTO items (brand, code, name, prepared_qty, unit, low_stock, is_kit, site, is_deleted) "
            "VALUES ('',?,?,?,?,0,0,'',1)",
            (code, name, req.qty, unit),
        )
        item_id = cur.lastrowid
        conn.execute(
            "INSERT INTO movements (item_id, delta, before_qty, after_qty, reason, destination) VALUES (?,?,0,?,?,?)",
            (item_id, 0, req.qty, "領出準備", note),
        )
        conn.commit()
        return {"id": item_id, "name": name}
    except Exception:
        conn.rollback()   # 2026-08-14 鎖洩漏根治：確保釋放 RESERVED 鎖
        raise
    finally:
        conn.close()      # 2026-08-14 防止中途炸掉 close 被跳過（bare-conn 洩漏主因）


@router.post("/api/items/{item_id}/prepare", dependencies=[Depends(require_perm("stockout"))])
def prepare_item(item_id: int, req: PrepareRequest):
    """領出準備：把東西拿出來準備（庫存不扣，只標記 prepared_qty）"""
    if req.qty <= 0:
        raise HTTPException(400, "數量必須大於 0")
    conn = get_db()
    try:
        row = conn.execute("SELECT * FROM items WHERE id=? AND is_deleted=0", (item_id,)).fetchone()
        if not row:
            raise HTTPException(404, "品項不存在")
        available = _total_qty(conn, item_id) - row["prepared_qty"]
        # H6：單一原子 UPDATE 累加（併發 prepare 不 lost update）；守衛確保不超過可領數量
        cur = conn.execute(
            "UPDATE items SET prepared_qty = prepared_qty + ?, updated_at = ? "
            "WHERE id = ? AND prepared_qty + ? <= (SELECT COALESCE(SUM(qty), 0) FROM item_stocks WHERE item_id = ?)",
            (req.qty, datetime.datetime.now().isoformat(), item_id, req.qty, item_id),
        )
        if cur.rowcount == 0:
            raise HTTPException(400, f"可領出數量不足！可用 {available} {row['unit']}")
        new_prepared = row["prepared_qty"] + req.qty
        conn.execute(
            "INSERT INTO movements (item_id, delta, before_qty, after_qty, reason, destination) VALUES (?,?,?,?,?,?)",
            (item_id, 0, row["prepared_qty"], new_prepared, "領出準備", req.location),
        )
        conn.commit()
        updated = conn.execute("SELECT * FROM items WHERE id=?", (item_id,)).fetchone()
        payload = _item_payload(conn, updated)
        return payload
    except Exception:
        conn.rollback()   # 2026-08-14 鎖洩漏根治：確保釋放 RESERVED 鎖
        raise
    finally:
        conn.close()      # 2026-08-14 防止中途炸掉 close 被跳過（bare-conn 洩漏主因）


@router.post("/api/items/{item_id}/prepared-out", dependencies=[Depends(require_perm("stockout"))])
def prepared_out(item_id: int, req: PrepareRequest):
    """確認出庫：從準備中的數量真正出庫（此時才扣庫存）+ 記錄去向"""
    if req.qty <= 0:
        raise HTTPException(400, "數量必須大於 0")
    conn = get_db()
    try:
        row = conn.execute("SELECT * FROM items WHERE id=? AND (is_deleted=0 OR site='')", (item_id,)).fetchone()
        if not row:
            raise HTTPException(404, "品項不存在")
        if req.qty > row["prepared_qty"]:
            raise HTTPException(400, f"準備中的數量只有 {row['prepared_qty']} {row['unit']}")

        dest = req.note  # note 欄位當去向用（相容前端）
        if row["is_deleted"]:
            # 非庫存品項：無庫存可扣，直接寫出庫流水（before/after=0）+ 清 prepared_qty
            new_prepared = row["prepared_qty"] - req.qty
            cur = conn.execute("UPDATE items SET prepared_qty = prepared_qty - ?, updated_at = ? WHERE id = ? AND prepared_qty >= ?",
                               (req.qty, datetime.datetime.now().isoformat(), item_id, req.qty))
            if cur.rowcount == 0:
                raise HTTPException(400, f"準備中的數量只有 {row['prepared_qty']} {row['unit']}")
            conn.execute(
                "INSERT INTO movements (item_id, delta, before_qty, after_qty, reason, destination) VALUES (?,?,0,0,'出庫',?)",
                (item_id, -req.qty, dest),
            )
            conn.commit()
            updated = conn.execute("SELECT * FROM items WHERE id=?", (item_id,)).fetchone()
            payload = _item_payload(conn, updated)
            return payload

        new_prepared = row["prepared_qty"] - req.qty

        # 2026-08-14 審查修（P4-1）：before/after 用 _deduct 寫後重讀值（鏈一致）
        before, after = _deduct(conn, item_id, req.qty, req.location)
        cur = conn.execute("UPDATE items SET prepared_qty = prepared_qty - ?, updated_at = ? WHERE id = ? AND prepared_qty >= ?",
                           (req.qty, datetime.datetime.now().isoformat(), item_id, req.qty))
        if cur.rowcount == 0:  # H6：併發已消耗準備量 → 保守拒絕
            raise HTTPException(400, f"準備中的數量只有 {row['prepared_qty']} {row['unit']}")
        conn.execute(
            "INSERT INTO movements (item_id, delta, before_qty, after_qty, reason, destination) VALUES (?,?,?,?,?,?)",
            (item_id, -req.qty, before, after, "出庫", dest),
        )
        conn.commit()
        updated = conn.execute("SELECT * FROM items WHERE id=?", (item_id,)).fetchone()
        payload = _item_payload(conn, updated)
        return payload



    except Exception:
        conn.rollback()   # 2026-08-14 鎖洩漏根治：確保釋放 RESERVED 鎖
        raise
    finally:
        conn.close()      # 2026-08-14 防止中途炸掉 close 被跳過（bare-conn 洩漏主因）
@router.post("/api/items/{item_id}/prepared-return", dependencies=[Depends(require_perm("stockout"))])
def prepared_return(item_id: int, req: PrepareRequest):
    """退回：把準備中的數量退回（取消領出）"""
    if req.qty <= 0:
        raise HTTPException(400, "數量必須大於 0")
    conn = get_db()
    try:
        row = conn.execute("SELECT * FROM items WHERE id=? AND (is_deleted=0 OR site='')", (item_id,)).fetchone()
        if not row:
            raise HTTPException(404, "品項不存在")
        if req.qty > row["prepared_qty"]:
            raise HTTPException(400, f"準備中的數量只有 {row['prepared_qty']} {row['unit']}")

        new_prepared = row["prepared_qty"] - req.qty
        cur = conn.execute("UPDATE items SET prepared_qty = prepared_qty - ?, updated_at = ? WHERE id = ? AND prepared_qty >= ?",
                           (req.qty, datetime.datetime.now().isoformat(), item_id, req.qty))
        if cur.rowcount == 0:  # H6：併發已消耗準備量 → 保守拒絕
            raise HTTPException(400, f"準備中的數量只有 {row['prepared_qty']} {row['unit']}")
        conn.execute(
            "INSERT INTO movements (item_id, delta, before_qty, after_qty, reason, destination) VALUES (?,?,?,?,?,?)",
            (item_id, 0, row["prepared_qty"], new_prepared, "退回準備", ""),
        )
        conn.commit()
        updated = conn.execute("SELECT * FROM items WHERE id=?", (item_id,)).fetchone()
        payload = _item_payload(conn, updated)
        return payload



    except Exception:
        conn.rollback()   # 2026-08-14 鎖洩漏根治：確保釋放 RESERVED 鎖
        raise
    finally:
        conn.close()      # 2026-08-14 防止中途炸掉 close 被跳過（bare-conn 洩漏主因）
@router.get("/api/prepared", dependencies=[Depends(require_perm("prepared"))])
def list_prepared(site: Optional[str] = None):
    """準備中清單（已領出尚未出庫）"""
    conn = get_db()
    where = ""
    params = ()
    if site and site != "all":
        where = " AND (site = ? OR is_deleted = 1)"  # 2026-08-16 修復：非庫存品項（is_deleted=1, site=''）不分 site 永遠顯示（比照 list_stock_outs）
        params = (site,)
    rows = conn.execute(f"""
        SELECT * FROM items WHERE prepared_qty > 0 AND (is_deleted = 0 OR site = ''){where} ORDER BY brand COLLATE NOCASE, name
    """, params).fetchall()
    payloads = [_item_payload(conn, r) for r in rows]  # 補 total_qty/location/stocks 相容欄位
    conn.close()
    return payloads