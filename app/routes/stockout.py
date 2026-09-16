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
from app.models import NonStockOutRequest, PrepareRequest, StockOutRequest, StockoutReturnRepair, StockoutReturnRequest, StockoutReturnUpdate, StockoutUpdate
from app.routes.photos import has_photo
from app.services.auth import require_perm
from app.services.inventory_stock import assert_projected_inventory
from app.services.quantity import canonical_qty

# 出庫/待領出 API 路由
router = APIRouter()

import re as _re
_ISO_DATETIME_RE = _re.compile(r"^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$")

def _validate_date(s: str, field: str = "日期"):
    """驗證 ISO 日期/時間格式，不合法則 400"""
    if s and not _ISO_DATETIME_RE.match(s.strip()):
        raise HTTPException(400, f"{field}格式需為 YYYY-MM-DD 或 YYYY-MM-DD HH:MM:SS")


def _canonical_qty(value):
    """Canonicalize through the shared inventory quantity policy."""
    try:
        return canonical_qty(value)
    except ValueError:
        raise HTTPException(400, "數量格式錯誤")


def _positive_qty(value, label="數量"):
    """Canonicalize a quantity and reject values that round to zero."""
    qty = _canonical_qty(value)
    if qty <= 0:
        raise HTTPException(400, f"{label}正規化後必須大於 0")
    return qty


def _total_qty(conn, item_id) -> float:
    """計算單一品項的位置庫存總量，回傳 float"""
    return _canonical_qty(conn.execute("SELECT COALESCE(SUM(qty),0) FROM item_stocks WHERE item_id=?",
                                      (item_id,)).fetchone()[0])


def _item_payload(conn, row) -> dict:
    """回傳品項完整 payload（補 total_qty/stocks/location/note 相容欄位）"""
    d = dict(row)
    stocks = conn.execute("SELECT * FROM item_stocks WHERE item_id=? ORDER BY id",
                          (row["id"],)).fetchall()
    d["stocks"] = [dict(s) for s in stocks]
    d["total_qty"] = _canonical_qty(sum(s["qty"] for s in stocks))
    d["qty"] = d["total_qty"]
    d["location"] = stocks[0]["location"] if stocks else ""
    d["note"] = stocks[0]["note"] if stocks else ""
    d["has_photo"] = has_photo(d["id"])  # 待領出/回傳清單顯示品項照片縮圖（與已領出一致）
    # 整組品項：回傳 BOM 子品項（待領出頁展開用）
    if d.get("is_kit"):
        comps = conn.execute(
            """SELECT ki.qty AS need_qty, i.id AS item_id, i.brand, i.name, i.code, i.unit,
                      (SELECT COALESCE(SUM(qty),0) FROM item_stocks WHERE item_id=i.id) AS stock,
                      EXISTS(SELECT 1 FROM photos WHERE item_id=i.id) AS has_photo
               FROM kit_items ki JOIN items i ON i.id=ki.item_id WHERE ki.kit_id=?""",
            (d["id"],)
        ).fetchall()
        d["components"] = [dict(c) for c in comps]
    return d


def _deduct(conn, item_id, qty, location=""):
    """從位置庫存扣數量，回傳 (total_before, total_after, source_stock_id)。
    單一位置出庫會保存來源 stock id；跨多位置的舊式自動扣除保留為 legacy，
    退回時必須由使用者明確選擇回補位置。
    """
    qty = _positive_qty(qty, "出庫數量")
    stocks = conn.execute(
        "SELECT * FROM item_stocks WHERE item_id=? ORDER BY id", (item_id,)).fetchall()
    total_before = _canonical_qty(sum(s["qty"] for s in stocks))
    source_stock_id = None
    if location:
        target = [s for s in stocks if s["location"] == location]
        if not target:
            raise HTTPException(400, f"該品項在「{location}」沒有庫存")
        if target[0]["qty"] < qty:
            raise HTTPException(400, f"「{location}」庫存不足！只剩 {target[0]['qty']}")
        cur = conn.execute("UPDATE item_stocks SET qty=ROUND(qty-?,3), updated_at=? WHERE id=? AND qty>=?",
                           (qty, datetime.datetime.now().isoformat(), target[0]["id"], qty))
        if cur.rowcount == 0:  # H5：併發已被扣走 → 保守拒絕，不超賣
            raise HTTPException(400, f"「{location}」庫存不足！只剩 {target[0]['qty']}")
        source_stock_id = target[0]["id"]
    else:
        remaining = qty
        for s in stocks:  # 依序（第一筆先扣）
            if remaining <= 0:
                break
            take = _canonical_qty(min(s["qty"], remaining))
            cur = conn.execute("UPDATE item_stocks SET qty=ROUND(qty-?,3), updated_at=? WHERE id=? AND qty>=?",
                               (take, datetime.datetime.now().isoformat(), s["id"], take))
            if cur.rowcount == 0:  # H5：併發已被扣走 → 保守拒絕，不超賣
                raise HTTPException(400, f"庫存不足！只剩 {total_before}")
            remaining = _canonical_qty(remaining - take)
            if take > 0 and source_stock_id is None and qty == take:
                source_stock_id = s["id"]
        if remaining > 0:
            raise HTTPException(400, f"庫存不足！只剩 {total_before}")
    # 2026-08-14 P4-1：寫後重讀真實總量（併發下流水鏈 before+delta=after 恆成立）
    total_after = _canonical_qty(sum(s["qty"] for s in conn.execute(
        "SELECT qty FROM item_stocks WHERE item_id=?", (item_id,)).fetchall()))
    return total_before, total_after, source_stock_id


def _stock_payload(conn, stock_id, item_id):
    if not stock_id:
        return None
    row = conn.execute(
        "SELECT s.id, s.item_id, s.location, i.site FROM item_stocks s JOIN items i ON i.id=s.item_id WHERE s.id=? AND s.item_id=?",
        (stock_id, item_id),
    ).fetchone()
    return dict(row) if row else None


def _add_back_to_stock(conn, item_id, qty, stock_id):
    qty = _positive_qty(qty, "退回數量")
    row = _stock_payload(conn, stock_id, item_id)
    if not row:
        raise HTTPException(400, "退回位置不存在，請重新選擇有效的庫存位置")
    conn.execute("UPDATE item_stocks SET qty=ROUND(qty+?,3), updated_at=? WHERE id=?",
                 (qty, datetime.datetime.now().isoformat(), stock_id))
    return row


def _deduct_from_stock(conn, item_id, qty, stock_id):
    qty = _positive_qty(qty, "數量")
    row = _stock_payload(conn, stock_id, item_id)
    if not row:
        raise HTTPException(400, "來源庫存位置不存在，無法調整數量")
    cur = conn.execute(
        "UPDATE item_stocks SET qty=ROUND(qty-?,3), updated_at=? WHERE id=? AND qty>=?",
        (qty, datetime.datetime.now().isoformat(), stock_id, qty),
    )
    if cur.rowcount == 0:
        raise HTTPException(400, "指定庫存位置數量不足")
    return row


@router.post("/api/stockout", dependencies=[Depends(require_perm("stockout"))])
def stock_out(req: StockOutRequest):
    """出庫：扣庫存 + 記錄去向（客戶/案場/工地）"""
    qty = _positive_qty(req.qty, "出庫數量")
    conn = get_db()
    try:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute("SELECT * FROM items WHERE id=? AND is_deleted=0", (req.item_id,)).fetchone()
        if not row:
            raise HTTPException(404, "品項不存在")
        before = _total_qty(conn, req.item_id)
        if before < qty:
            raise HTTPException(400, f"庫存不足！目前只剩 {before} {row['unit']}")
        # P0-C：最終 committed state 必須滿足 total >= prepared（同一 writer transaction 內驗證）
        assert_projected_inventory(conn, req.item_id, stock_delta=-qty)

        reason = "出庫"
        if req.note:
            reason = f"出庫 - {req.note}"
        # 2026-08-14 P4-1：before/after 用 _deduct 寫後重讀值（鏈一致）
        before, after, source_stock_id = _deduct(conn, req.item_id, qty, req.location)
        source = _stock_payload(conn, source_stock_id, req.item_id)
        conn.execute(
            "INSERT INTO movements (item_id, delta, before_qty, after_qty, reason, destination, source_stock_id, source_site, source_location) VALUES (?,?,?,?,?,?,?,?,?)",
            (req.item_id, -qty, before, after, reason, req.destination, source_stock_id,
             source["site"] if source else row["site"], source["location"] if source else req.location),
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
    qty = _positive_qty(req.qty, "出庫數量")
    name = req.name.strip()
    dest = req.destination.strip()
    unit = req.unit.strip() or "個"
    code = req.code.strip()
    note = req.note.strip()
    if not name:
        raise HTTPException(400, "品項名稱不能為空")
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
            (item_id, -qty, reason, dest),
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
    """出庫紀錄（含去向）+ 退回紀錄（2026-09-07 Sarah：退回要顯示在已領出頁）"""
    conn = get_db()
    sql = """
        SELECT m.*, i.name as item_name, i.brand, i.code, i.unit, i.is_deleted as item_deleted
        FROM movements m JOIN items i ON i.id = m.item_id
        WHERE ((m.delta < 0 AND m.reason LIKE '出庫%')
           OR (m.reason = '退回已領出'))
    """
    params = []
    if site and site != "all":
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
        d["has_photo"] = has_photo(d["item_id"])
        outs.append(d)
    return outs


def _add_back_to_first_stock(conn, item_id, qty):
    """退回/補回：把數量加回第一筆位置庫存（與 adjust_qty 正數邏輯一致）"""
    qty = _positive_qty(qty, "退回數量")
    stocks = conn.execute(
        "SELECT * FROM item_stocks WHERE item_id=? ORDER BY id", (item_id,)).fetchall()
    if not stocks:
        raise HTTPException(400, "品項無庫存位置，無法退回")
    conn.execute("UPDATE item_stocks SET qty=ROUND(qty+?,3), updated_at=? WHERE id=?",
                 (qty, datetime.datetime.now().isoformat(), stocks[0]["id"]))


@router.post("/api/stockouts/{movement_id}/return", dependencies=[Depends(require_perm("stockout"))])
def return_stockout(movement_id: int, req: StockoutReturnRequest = None):
    """退回已領出：預設回原始來源位置，也允許使用者選擇其他有效位置。"""
    conn = get_db()
    try:
        conn.execute("BEGIN IMMEDIATE")
        m = conn.execute("SELECT * FROM movements WHERE id=?", (movement_id,)).fetchone()
        if not m:
            raise HTTPException(404, "出庫記錄不存在")
        if m["delta"] >= 0 or not str(m["reason"]).startswith("出庫"):
            raise HTTPException(400, "只有已領出（出庫）記錄可以退回")
        if m["reverted_at"]:
            raise HTTPException(400, "該記錄已全數退回過")

        original_qty = _canonical_qty(-m["delta"])
        already = conn.execute(
            "SELECT COALESCE(SUM(delta),0) AS total FROM movements "
            "WHERE source_movement_id=? AND reason='退回已領出' AND reverted_at IS NULL",
            (movement_id,),
        ).fetchone()["total"]
        already = _canonical_qty(already)
        remaining = _canonical_qty(original_qty - already)
        return_qty = _positive_qty(remaining if not req or req.qty is None else req.qty, "退回數量")
        if return_qty > remaining:
            raise HTTPException(400, f"退回數量不可超過剩餘可退量 {remaining}")

        return_stock_id = req.return_stock_id if req and req.return_stock_id else m["source_stock_id"]
        if not return_stock_id:
            legacy_stocks = conn.execute("SELECT id FROM item_stocks WHERE item_id=? ORDER BY id", (m["item_id"],)).fetchall()
            if len(legacy_stocks) == 1:
                return_stock_id = legacy_stocks[0]["id"]
            else:
                raise HTTPException(400, "原始來源位置未記錄，請選擇退回庫存位置")
        return_stock = _stock_payload(conn, return_stock_id, m["item_id"])
        if not return_stock:
            raise HTTPException(400, "退回位置不存在，請重新選擇有效的庫存位置")

        dest = ((req.destination.strip() if req and req.destination else None) or "公司")
        if len(dest) > 200:
            raise HTTPException(400, "退回去向不可超過 200 字")
        now = (req.created_at if req and req.created_at else None) or datetime.datetime.now().isoformat()
        if req and req.created_at:
            _validate_date(req.created_at, "退回日期")

        current = _canonical_qty(_total_qty(conn, m["item_id"]))
        _add_back_to_stock(conn, m["item_id"], return_qty, return_stock_id)
        is_full_return = _canonical_qty(already + return_qty) >= original_qty
        if is_full_return:
            cur = conn.execute(
                "UPDATE movements SET reverted_at=? WHERE id=? AND reverted_at IS NULL",
                (now, movement_id),
            )
            if cur.rowcount == 0:
                raise HTTPException(400, "該記錄已全數退回過")

        cur = conn.execute(
            "INSERT INTO movements (item_id, delta, before_qty, after_qty, reason, destination, created_at, source_movement_id, return_stock_id, return_site, return_location, source_stock_id, source_site, source_location) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (m["item_id"], return_qty, current, _canonical_qty(current + return_qty), "退回已領出", dest, now,
             movement_id, return_stock_id, return_stock["site"], return_stock["location"],
             m["source_stock_id"], m["source_site"], m["source_location"]),
        )
        return_movement_id = cur.lastrowid
        conn.commit()
        return {"ok": True, "movement_id": movement_id, "return_movement_id": return_movement_id, "returned_qty": return_qty,
                "fully_returned": is_full_return, "return_stock_id": return_stock_id}
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

        old_qty = _positive_qty(-m["delta"], "數量")
        if upd.qty is not None:
            new_qty = _positive_qty(upd.qty, "數量")
            diff = _canonical_qty(new_qty - old_qty)  # >0 需多扣庫存；<0 補回庫存
            if diff > 0:
                # P0-C：加量重扣不得把 total 壓到 prepared 之下（BEGIN IMMEDIATE 已持有）
                assert_projected_inventory(conn, m["item_id"], stock_delta=-diff)
                if m["source_stock_id"]:
                    _deduct_from_stock(conn, m["item_id"], diff, m["source_stock_id"])
                else:
                    _deduct(conn, m["item_id"], diff, "")  # legacy 出庫無來源位置
            elif diff < 0:
                if m["source_stock_id"]:
                    _add_back_to_stock(conn, m["item_id"], -diff, m["source_stock_id"])
                else:
                    _add_back_to_first_stock(conn, m["item_id"], -diff)
            new_after = _canonical_qty(m["before_qty"] - new_qty)  # 原出庫記錄的 after（B0 - 新數量）
            conn.execute("UPDATE movements SET delta=?, after_qty=? WHERE id=?",
                         (-new_qty, new_after, movement_id))
            if diff != 0:  # canonical 差額為零時不寫 phantom 流水
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
            _validate_date(upd.created_at, "出庫日期")
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


@router.patch("/api/stockout-returns/{movement_id}", dependencies=[Depends(require_perm("stockout"))])
def update_stockout_return(movement_id: int, upd: StockoutReturnUpdate):
    """編輯退回紀錄；數量/位置變更會同步調整兩筆庫存位置。"""
    conn = get_db()
    try:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute("SELECT * FROM movements WHERE id=?", (movement_id,)).fetchone()
        if not row or row["reason"] != "退回已領出":
            raise HTTPException(404, "退回紀錄不存在")
        if row["reverted_at"]:
            raise HTTPException(400, "已撤銷的退回紀錄不能編輯")
        parent = conn.execute("SELECT * FROM movements WHERE id=?", (row["source_movement_id"],)).fetchone()
        if not parent:
            raise HTTPException(400, "原始出庫紀錄不存在，無法編輯退回")

        old_qty = _positive_qty(row["delta"], "退回數量")
        new_qty = _positive_qty(upd.qty if upd.qty is not None else old_qty, "退回數量")
        other_returned = _canonical_qty(conn.execute(
            "SELECT COALESCE(SUM(delta),0) FROM movements WHERE source_movement_id=? AND reason='退回已領出' AND reverted_at IS NULL AND id!=?",
            (parent["id"], movement_id),
        ).fetchone()[0])
        max_qty = _canonical_qty(-parent["delta"] - other_returned)
        if new_qty > max_qty:
            raise HTTPException(400, f"退回數量必須介於 0 與 {max_qty} 之間")

        old_stock_id = row["return_stock_id"]
        new_stock_id = upd.return_stock_id if upd.return_stock_id is not None else old_stock_id
        if not new_stock_id:
            raise HTTPException(400, "退回位置不存在，請重新選擇")
        new_stock = _stock_payload(conn, new_stock_id, row["item_id"])
        if not new_stock:
            raise HTTPException(400, "退回位置不存在，請重新選擇有效的庫存位置")
        old_stock = _stock_payload(conn, old_stock_id, row["item_id"])
        if not old_stock:
            raise HTTPException(400, "原退回位置不存在，無法調整")
        # P0-C：位置/數量變更的最終 total 不得低於 prepared（BEGIN IMMEDIATE 已持有）
        assert_projected_inventory(conn, row["item_id"], stock_delta=_canonical_qty(new_qty - old_qty))

        before_total = _canonical_qty(_total_qty(conn, row["item_id"]))
        movement_before = _canonical_qty(before_total - old_qty)
        if old_stock_id == new_stock_id:
            if new_qty > old_qty:
                _add_back_to_stock(conn, row["item_id"], new_qty - old_qty, new_stock_id)
            elif new_qty < old_qty:
                _deduct_from_stock(conn, row["item_id"], old_qty - new_qty, old_stock_id)
        else:
            _deduct_from_stock(conn, row["item_id"], old_qty, old_stock_id)
            _add_back_to_stock(conn, row["item_id"], new_qty, new_stock_id)

        destination = upd.destination.strip() if upd.destination is not None else row["destination"]
        if len(destination or "") > 200:
            raise HTTPException(400, "退回去向不可超過 200 字")
        created_at = upd.created_at if upd.created_at is not None else row["created_at"]
        if upd.created_at is not None:
            _validate_date(upd.created_at, "退回日期")
        after_total = _canonical_qty(_total_qty(conn, row["item_id"]))
        conn.execute(
            "UPDATE movements SET delta=?, before_qty=?, after_qty=?, destination=?, created_at=?, return_stock_id=?, return_site=?, return_location=? WHERE id=?",
            (new_qty, movement_before, _canonical_qty(movement_before + new_qty), destination, created_at, new_stock_id,
             new_stock["site"], new_stock["location"], movement_id),
        )
        conn.commit()
        return dict(conn.execute("SELECT * FROM movements WHERE id=?", (movement_id,)).fetchone())
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


@router.post("/api/stockout-returns/{movement_id}/repair", dependencies=[Depends(require_perm("stockout"))])
def repair_stockout_return(movement_id: int, repair: StockoutReturnRepair):
    """補齊舊退回流水的關聯，讓既有編輯/撤銷流程可安全使用。"""
    conn = get_db()
    try:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute("SELECT * FROM movements WHERE id=?", (movement_id,)).fetchone()
        if not row or row["reason"] != "退回已領出":
            raise HTTPException(404, "退回紀錄不存在")
        if row["reverted_at"]:
            raise HTTPException(400, "已撤銷的退回紀錄不能修復")
        if row["delta"] <= 0:
            raise HTTPException(400, "退回數量必須大於 0")
        if row["source_movement_id"] and row["return_stock_id"]:
            raise HTTPException(400, "此退回紀錄已有完整關聯，不需要修復")

        parent_id = row["source_movement_id"] or repair.source_movement_id
        return_stock_id = row["return_stock_id"] or repair.return_stock_id
        parent = conn.execute(
            "SELECT * FROM movements WHERE id=? AND item_id=? AND delta<0 AND reason LIKE '出庫%'",
            (parent_id, row["item_id"]),
        ).fetchone()
        if not parent:
            raise HTTPException(400, "原始出庫紀錄不存在或品項不一致")
        active_returns = conn.execute(
            "SELECT COALESCE(SUM(delta),0) FROM movements "
            "WHERE source_movement_id=? AND reason='退回已領出' AND reverted_at IS NULL AND id!=?",
            (parent["id"], movement_id),
        ).fetchone()[0]
        total_returned = _canonical_qty(active_returns + row["delta"])
        parent_qty = _canonical_qty(-parent["delta"])
        if total_returned > parent_qty:
            raise HTTPException(400, "退回總量不可超過原始出庫數量")

        stock = _stock_payload(conn, return_stock_id, row["item_id"])
        if not stock:
            raise HTTPException(400, "退回位置不存在，請重新選擇有效的庫存位置")

        parent_reverted_at = parent["reverted_at"]
        if total_returned >= parent_qty:
            parent_reverted_at = parent_reverted_at or row["created_at"] or datetime.datetime.now().isoformat()
        else:
            parent_reverted_at = None
        conn.execute(
            "UPDATE movements SET source_movement_id=?, return_stock_id=?, return_site=?, return_location=?, source_stock_id=?, source_site=?, source_location=? WHERE id=?",
            (parent["id"], stock["id"], stock["site"], stock["location"],
             parent["source_stock_id"], parent["source_site"], parent["source_location"], movement_id),
        )
        conn.execute("UPDATE movements SET reverted_at=? WHERE id=?", (parent_reverted_at, parent["id"]))
        conn.commit()
        return dict(conn.execute("SELECT * FROM movements WHERE id=?", (movement_id,)).fetchone())
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


@router.delete("/api/stockout-returns/{movement_id}", dependencies=[Depends(require_perm("stockout"))])
def delete_stockout_return(movement_id: int):
    """刪除退回流水；活動退回先扣回庫存，已撤銷退回只移除流水。"""
    conn = get_db()
    try:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute("SELECT * FROM movements WHERE id=?", (movement_id,)).fetchone()
        if not row or row["reason"] != "退回已領出":
            raise HTTPException(404, "退回紀錄不存在")

        parent_id = row["source_movement_id"]
        restored_qty = 0
        if not row["reverted_at"] and row["return_stock_id"]:
            # P0-C：刪除活動退回 = 庫存減少，最終 total 不得低於 prepared
            assert_projected_inventory(conn, row["item_id"], stock_delta=-_canonical_qty(row["delta"]))
            _deduct_from_stock(conn, row["item_id"], row["delta"], row["return_stock_id"])
            restored_qty = row["delta"]

        conn.execute("DELETE FROM movements WHERE id=?", (movement_id,))
        parent = conn.execute("SELECT * FROM movements WHERE id=?", (parent_id,)).fetchone()
        if parent:
            remaining = _canonical_qty(conn.execute(
                "SELECT COALESCE(SUM(delta),0) FROM movements "
                "WHERE source_movement_id=? AND reason='退回已領出' AND reverted_at IS NULL",
                (parent["id"],),
            ).fetchone()[0])
            parent_qty = _canonical_qty(-parent["delta"])
            if remaining < parent_qty:
                conn.execute("UPDATE movements SET reverted_at=NULL WHERE id=?", (parent["id"],))
        conn.commit()
        return {
            "ok": True,
            "movement_id": movement_id,
            "deleted": movement_id,
            "restored_qty": restored_qty,
        }
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
    qty = _positive_qty(req.qty, "數量")
    name = req.name.strip()
    unit = req.unit.strip() or "個"
    code = req.code.strip()
    note = req.note.strip()
    if not name:
        raise HTTPException(400, "品項名稱不能為空")
    conn = get_db()
    try:
        cur = conn.execute(
            "INSERT INTO items (brand, code, name, prepared_qty, unit, low_stock, is_kit, site, is_deleted) "
            "VALUES ('',?,?,?,?,0,0,'',1)",
            (code, name, qty, unit),
        )
        item_id = cur.lastrowid
        conn.execute(
            "INSERT INTO movements (item_id, delta, before_qty, after_qty, reason, destination) VALUES (?,?,0,?,?,?)",
            (item_id, 0, qty, "領出準備", note),
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
    qty = _positive_qty(req.qty, "數量")
    conn = get_db()
    try:
        row = conn.execute("SELECT * FROM items WHERE id=? AND is_deleted=0", (item_id,)).fetchone()
        if not row:
            raise HTTPException(404, "品項不存在")
        available = _canonical_qty(_total_qty(conn, item_id) - row["prepared_qty"])
        # H6：單一原子 UPDATE 累加（併發 prepare 不 lost update）；守衛確保不超過可領數量
        cur = conn.execute(
            "UPDATE items SET prepared_qty = ROUND(prepared_qty + ?, 3), updated_at = ? "
            "WHERE id = ? AND ROUND(prepared_qty + ?, 3) <= ROUND((SELECT COALESCE(SUM(qty), 0) FROM item_stocks WHERE item_id = ?), 3)",
            (qty, datetime.datetime.now().isoformat(), item_id, qty, item_id),
        )
        if cur.rowcount == 0:
            raise HTTPException(400, f"可領出數量不足！可用 {available} {row['unit']}")
        new_prepared = _canonical_qty(row["prepared_qty"] + qty)
        conn.execute(
            "INSERT INTO movements (item_id, delta, before_qty, after_qty, reason, destination) VALUES (?,?,?,?,?,?)",
            (item_id, 0, _canonical_qty(row["prepared_qty"]), new_prepared, "領出準備", req.location),
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
    qty = _positive_qty(req.qty, "數量")
    conn = get_db()
    try:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute("SELECT * FROM items WHERE id=? AND (is_deleted=0 OR site='')", (item_id,)).fetchone()
        if not row:
            raise HTTPException(404, "品項不存在")
        if qty > row["prepared_qty"]:
            raise HTTPException(400, f"準備中的數量只有 {row['prepared_qty']} {row['unit']}")

        dest = req.note  # note 欄位當去向用（相容前端）
        if row["is_deleted"]:
            # 非庫存品項：無庫存可扣，直接寫出庫流水（before/after=0）+ 清 prepared_qty
            new_prepared = _canonical_qty(row["prepared_qty"] - qty)
            cur = conn.execute("UPDATE items SET prepared_qty = ROUND(prepared_qty - ?, 3), updated_at = ? WHERE id = ? AND prepared_qty >= ?",
                               (qty, datetime.datetime.now().isoformat(), item_id, qty))
            if cur.rowcount == 0:
                raise HTTPException(400, f"準備中的數量只有 {row['prepared_qty']} {row['unit']}")
            conn.execute(
                "INSERT INTO movements (item_id, delta, before_qty, after_qty, reason, destination) VALUES (?,?,0,0,'出庫',?)",
                (item_id, -qty, dest),
            )
            conn.commit()
            updated = conn.execute("SELECT * FROM items WHERE id=?", (item_id,)).fetchone()
            payload = _item_payload(conn, updated)
            return payload

        new_prepared = _canonical_qty(row["prepared_qty"] - qty)

        # P0-C：projected final state 驗證（stock -qty 且 prepared -qty 同步降，3>=3 合法不過擋）
        assert_projected_inventory(conn, item_id, stock_delta=-qty, prepared_delta=-qty)

        # 2026-08-14 審查修（P4-1）：before/after 用 _deduct 寫後重讀值（鏈一致）
        before, after, source_stock_id = _deduct(conn, item_id, qty, req.location)
        cur = conn.execute("UPDATE items SET prepared_qty = ROUND(prepared_qty - ?, 3), updated_at = ? WHERE id = ? AND prepared_qty >= ?",
                           (qty, datetime.datetime.now().isoformat(), item_id, qty))
        if cur.rowcount == 0:  # H6：併發已消耗準備量 → 保守拒絕
            raise HTTPException(400, f"準備中的數量只有 {row['prepared_qty']} {row['unit']}")
        source = _stock_payload(conn, source_stock_id, item_id)
        conn.execute(
            "INSERT INTO movements (item_id, delta, before_qty, after_qty, reason, destination, source_stock_id, source_site, source_location) VALUES (?,?,?,?,?,?,?,?,?)",
            (item_id, -qty, before, after, "出庫", dest, source_stock_id,
             source["site"] if source else row["site"], source["location"] if source else req.location),
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
    qty = _positive_qty(req.qty, "數量")
    conn = get_db()
    try:
        row = conn.execute("SELECT * FROM items WHERE id=? AND (is_deleted=0 OR site='')", (item_id,)).fetchone()
        if not row:
            raise HTTPException(404, "品項不存在")
        if qty > row["prepared_qty"]:
            raise HTTPException(400, f"準備中的數量只有 {row['prepared_qty']} {row['unit']}")

        new_prepared = _canonical_qty(row["prepared_qty"] - qty)
        cur = conn.execute("UPDATE items SET prepared_qty = ROUND(prepared_qty - ?, 3), updated_at = ? WHERE id = ? AND prepared_qty >= ?",
                           (qty, datetime.datetime.now().isoformat(), item_id, qty))
        if cur.rowcount == 0:  # H6：併發已消耗準備量 → 保守拒絕
            raise HTTPException(400, f"準備中的數量只有 {row['prepared_qty']} {row['unit']}")
        conn.execute(
            "INSERT INTO movements (item_id, delta, before_qty, after_qty, reason, destination) VALUES (?,?,?,?,?,?)",
            (item_id, 0, _canonical_qty(row["prepared_qty"]), new_prepared, "退回準備", ""),
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
    # 補 destination（準備說明）：取該品項最新一筆「領出準備」movements 的 destination
    for p in payloads:
        mv = conn.execute(
            "SELECT destination FROM movements WHERE item_id=? AND reason='領出準備' ORDER BY id DESC LIMIT 1",
            (p["id"],)
        ).fetchone()
        p["destination"] = mv["destination"] if mv and mv["destination"] else ""
    conn.close()
    return payloads