# -*- coding: utf-8 -*-
"""跨庫存區調撥 API。"""
import datetime

from fastapi import APIRouter, Depends, HTTPException

from app.database import get_db
from app.models import TransferRequest
from app.services.auth import require_perm
from app.services.quantity import canonical_qty

router = APIRouter()


def _total(conn, item_id: int) -> float:
    return canonical_qty(conn.execute(
        "SELECT COALESCE(SUM(qty), 0) FROM item_stocks WHERE item_id=?", (item_id,)
    ).fetchone()[0])


def _create_target_item(conn, source, target_site: str) -> int:
    """依來源主檔在目標 site 建立品項；若已存在則重用。"""
    target = conn.execute(
        """SELECT * FROM items WHERE brand=? AND code=? AND name=? AND unit=?
           AND site=? AND is_deleted=0""",
        (source["brand"], source["code"], source["name"], source["unit"], target_site),
    ).fetchone()
    if target:
        return target["id"]
    cur = conn.execute(
        """INSERT INTO items (brand, code, name, unit, low_stock, is_kit, site, category)
           VALUES (?,?,?,?,?,?,?,?)""",
        (source["brand"], source["code"], source["name"], source["unit"],
         source["low_stock"], source["is_kit"], target_site, source["category"]),
    )
    item_id = cur.lastrowid
    # 目標位置由調撥本身建立，避免先產生無意義的空白位置列。
    # 整組定義跟著已組裝整組複製；材料主檔只建立零庫存目標副本。
    if source["is_kit"]:
        source_kit = conn.execute("SELECT * FROM kits WHERE item_id=?", (source["id"],)).fetchone()
        if source_kit:
            kit_cur = conn.execute(
                "INSERT INTO kits (item_id, name, note) VALUES (?,?,?)",
                (item_id, source_kit["name"], source_kit["note"]),
            )
            components = conn.execute(
                "SELECT ki.qty, i.* FROM kit_items ki JOIN items i ON i.id=ki.item_id WHERE ki.kit_id=?",
                (source_kit["id"],),
            ).fetchall()
            for component in components:
                if component["is_kit"]:
                    raise HTTPException(400, "含有巢狀整組的材料，請先拆解後再調撥")
                component_id = _create_target_item(conn, component, target_site)
                conn.execute(
                    "INSERT INTO kit_items (kit_id, item_id, qty) VALUES (?,?,?)",
                    (kit_cur.lastrowid, component_id, component["qty"]),
                )
    return item_id


def _deduct_source(conn, source_item_id: int, qty: float, source_location: str | None) -> None:
    """在 transaction 內依位置扣除來源庫存，並寫入負向流水。"""
    if source_location is None:
        stocks = conn.execute(
            "SELECT * FROM item_stocks WHERE item_id=? ORDER BY id", (source_item_id,)
        ).fetchall()
    else:
        stocks = conn.execute(
            "SELECT * FROM item_stocks WHERE item_id=? AND location=? ORDER BY id",
            (source_item_id, source_location),
        ).fetchall()
    available = canonical_qty(sum(row["qty"] for row in stocks))
    if available < qty:
        raise HTTPException(400, f"來源位置庫存不足（可調撥 {available}，要求 {qty}）")
    before = _total(conn, source_item_id)
    remaining = qty
    for stock in stocks:
        if remaining <= 0:
            break
        take = canonical_qty(min(stock["qty"], remaining))
        updated = conn.execute(
            "UPDATE item_stocks SET qty=ROUND(qty-?,3), updated_at=? WHERE id=? AND qty>=?",
            (take, datetime.datetime.now().isoformat(), stock["id"], take),
        )
        if updated.rowcount != 1:
            raise HTTPException(400, "來源庫存已變動，請重新整理後再調撥")
        remaining = canonical_qty(remaining - take)
    after = _total(conn, source_item_id)
    conn.execute(
        """INSERT INTO movements
           (item_id, delta, before_qty, after_qty, reason, destination)
           VALUES (?,?,?,?,?,?)""",
        (source_item_id, -qty, before, after, "庫存調撥", "跨庫存區"),
    )


def _add_target(conn, target_item_id: int, qty: float, location: str, source_site: str) -> None:
    before = _total(conn, target_item_id)
    stock = conn.execute(
        "SELECT id FROM item_stocks WHERE item_id=? AND location=? ORDER BY id LIMIT 1",
        (target_item_id, location),
    ).fetchone()
    now = datetime.datetime.now().isoformat()
    if stock:
        conn.execute(
            "UPDATE item_stocks SET qty=ROUND(qty+?,3), updated_at=? WHERE id=?",
            (qty, now, stock["id"]),
        )
    else:
        conn.execute(
            "INSERT INTO item_stocks (item_id, location, qty, note) VALUES (?,?,?,?)",
            (target_item_id, location, qty, "庫存調撥"),
        )
    after = _total(conn, target_item_id)
    conn.execute(
        """INSERT INTO movements
           (item_id, delta, before_qty, after_qty, reason, destination)
           VALUES (?,?,?,?,?,?)""",
        (target_item_id, qty, before, after, "庫存調撥", f"來源:{source_site}"),
    )


@router.post("/api/inventory/transfers", status_code=201,
             dependencies=[Depends(require_perm("stock-mgmt"))])
def transfer_inventory(req: TransferRequest):
    """將一個品項的庫存由來源 site 調撥至目標 site。"""
    qty = canonical_qty(req.qty)
    conn = get_db()
    try:
        source = conn.execute(
            "SELECT * FROM items WHERE id=? AND is_deleted=0", (req.item_id,)
        ).fetchone()
        if source is None:
            raise HTTPException(404, "來源品項不存在或已刪除")
        if source["site"] == req.target_site:
            raise HTTPException(400, "來源與目標必須是不同庫存區")
        target_location = req.target_location or (
            "車內" if req.target_site in ("van", "truck") else ""
        )
        _deduct_source(conn, source["id"], qty, req.source_location)
        target_id = _create_target_item(conn, source, req.target_site)
        _add_target(conn, target_id, qty, target_location, source["site"])
        conn.commit()
        return {
            "ok": True,
            "source_item_id": source["id"],
            "target_item_id": target_id,
            "source_site": source["site"],
            "target_site": req.target_site,
            "qty": qty,
            "target_location": target_location,
        }
    except HTTPException:
        conn.rollback()
        raise
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
