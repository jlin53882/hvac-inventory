# -*- coding: utf-8 -*-
"""
整組（套件）路由（v10 正規化）：BOM 定義 + 組裝/拆解
=================================================
- GET   /api/kits                套件清單（含組成材料）
- POST  /api/kits                新增套件定義
- POST  /api/kits/{id}/assemble  組裝（扣材料 + 整組庫存增加）
- POST  /api/kits/{id}/disassemble  拆解（整組扣掉 + 材料加回）

v10 數量語意：材料庫存 = SUM(item_stocks.qty)
套件品項本身也配一筆空位置 stock（維持總量語意）
"""
import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException

from app.database import get_db
from app.models import KitAssemble, KitCreate
from app.routes.photos import has_photo

# 整組 API 路由
router = APIRouter()


def _total(conn, item_id) -> float:
    """計算單一品項的位置庫存總量，回傳 float"""
    return conn.execute("SELECT COALESCE(SUM(qty),0) FROM item_stocks WHERE item_id=?",
                        (item_id,)).fetchone()[0]


@router.get("/api/kits")
def list_kits(site: Optional[str] = None):
    """套件清單（含組成材料）"""
    conn = get_db()
    where = ""
    params = ()
    if site and site != "all":
        where = " WHERE i.site = ?"
        params = (site,)
    kits = conn.execute(
        f"SELECT k.*, i.unit, i.brand, i.site FROM kits k JOIN items i ON i.id = k.item_id{where} AND i.is_deleted = 0 ORDER BY k.name",
        params).fetchall()
    result = []
    for k in kits:
        items = conn.execute("""
            SELECT ki.item_id, ki.qty as need_qty, i.name, i.brand, i.code, i.unit
            FROM kit_items ki JOIN items i ON i.id = ki.item_id
            WHERE ki.kit_id = ?
        """, (k["id"],)).fetchall()
        d = dict(k)
        d["stock_qty"] = _total(conn, k["item_id"])
        comps = []
        for x in items:
            cx = dict(x)
            cx["stock"] = _total(conn, x["item_id"])
            # 每個材料（單一庫存品項）自己的照片縮圖（2026-08-12 Sarah 需求）
            cx["has_photo"] = has_photo(x["item_id"])
            comps.append(cx)
        d["components"] = comps
        result.append(d)
    conn.close()
    return result


@router.post("/api/kits", status_code=201)
def create_kit(kit: KitCreate):
    """新增套件定義：建立套件品項 + 組成材料"""
    if not kit.name or not kit.items:
        raise HTTPException(400, "套件名稱與材料都不能空白")
    conn = get_db()
    # 建立套件品項（v10：主檔 + 一筆空位置 stock）
    cur = conn.execute(
        "INSERT INTO items (brand, name, unit, is_kit, site) VALUES (?,?,?,1,?)",
        ("", kit.name, "組", "office"),
    )
    kit_item_id = cur.lastrowid
    conn.execute("INSERT INTO item_stocks (item_id, location, qty, note) VALUES (?,?,?,?)",
                 (kit_item_id, "", 0, kit.note))
    # 建立套件定義
    cur2 = conn.execute(
        "INSERT INTO kits (item_id, name, note) VALUES (?,?,?)",
        (kit_item_id, kit.name, kit.note),
    )
    kit_id = cur2.lastrowid
    for comp in kit.items:
        conn.execute(
            "INSERT INTO kit_items (kit_id, item_id, qty) VALUES (?,?,?)",
            (kit_id, comp["item_id"], comp.get("qty", 1)),
        )
    conn.commit()
    conn.close()
    return {"id": kit_id, "item_id": kit_item_id, "name": kit.name}


@router.put("/api/kits/{kit_id}")
def update_kit(kit_id: int, kit: KitCreate):
    """更新整組定義（名稱/備註 + 全量替換材料；不影響已組裝的整組庫存）"""
    if not kit.name or not kit.items:
        raise HTTPException(400, "套件名稱與材料都不能空白")
    conn = get_db()
    row = conn.execute("SELECT * FROM kits WHERE id=?", (kit_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "整組不存在")
    conn.execute("UPDATE kits SET name=?, note=? WHERE id=?", (kit.name, kit.note, kit_id))
    conn.execute("UPDATE items SET name=?, updated_at=? WHERE id=?",
                 (kit.name, datetime.datetime.now().isoformat(), row["item_id"]))
    conn.execute("DELETE FROM kit_items WHERE kit_id=?", (kit_id,))
    for comp in kit.items:
        conn.execute("INSERT INTO kit_items (kit_id, item_id, qty) VALUES (?,?,?)",
                     (kit_id, comp["item_id"], comp.get("qty", 1)))
    conn.commit()
    conn.close()
    return {"ok": True, "id": kit_id, "name": kit.name}


@router.delete("/api/kits/{kit_id}")
def delete_kit(kit_id: int):
    """刪除整組定義：套件、材料關聯、套件品項（含流水/盤點/位置庫存/照片）"""
    conn = get_db()
    row = conn.execute("SELECT * FROM kits WHERE id=?", (kit_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "整組不存在")
    item_id = row["item_id"]
    conn.execute("DELETE FROM kit_items WHERE kit_id=?", (kit_id,))
    conn.execute("DELETE FROM kits WHERE id=?", (kit_id,))
    # M6：套件品項 soft-delete（保留 movements/stocktakes 稽核軌跡）
    conn.execute("UPDATE items SET is_deleted=1, updated_at=? WHERE id=?",
                 (datetime.datetime.now().isoformat(), item_id))
    conn.commit()
    conn.close()
    # 順帶刪照片檔（uploads/<id>.jpg）——不留孤兒檔
    from app.routes.photos import _photo_path
    import os
    try:
        p = _photo_path(item_id)
        if os.path.exists(p):
            os.remove(p)
    except OSError:
        pass
    return {"ok": True, "deleted": kit_id}


def _deduct_total(conn, item_id, need, reason):
    """從位置庫存由後往前扣 need，記錄 movements。不足則拋錯。"""
    stocks = conn.execute("SELECT * FROM item_stocks WHERE item_id=? ORDER BY id",
                          (item_id,)).fetchall()
    before = sum(s["qty"] for s in stocks)
    remaining = need
    for s in stocks:  # M10：統一從頭扣（與 stockout._deduct 一致）
        if remaining <= 0:
            break
        take = min(s["qty"], remaining)
        cur = conn.execute("UPDATE item_stocks SET qty=qty-?, updated_at=? WHERE id=? AND qty>=?",
                           (take, datetime.datetime.now().isoformat(), s["id"], take))
        if cur.rowcount == 0:  # H5：併發被扣走 → 保守拒絕，不超賣
            raise HTTPException(400, f"庫存不足！剩 {before}")
        remaining -= take
    if remaining > 0:
        raise HTTPException(400, f"庫存不足！剩 {before}")
    conn.execute(
        "INSERT INTO movements (item_id, delta, before_qty, after_qty, reason, destination) VALUES (?,?,?,?,?,?)",
        (item_id, -need, before, before - need, reason, ""),
    )


def _add_total(conn, item_id, add, reason):
    """加入第一筆位置庫存，記錄 movements。"""
    stocks = conn.execute("SELECT * FROM item_stocks WHERE item_id=? ORDER BY id",
                          (item_id,)).fetchall()
    before = sum(s["qty"] for s in stocks)
    target = stocks[0] if stocks else None
    if target:
        conn.execute("UPDATE item_stocks SET qty=qty+?, updated_at=? WHERE id=?",
                     (add, datetime.datetime.now().isoformat(), target["id"]))
    else:
        conn.execute("INSERT INTO item_stocks (item_id, location, qty, note) VALUES (?,?,?,?)",
                     (item_id, "", add, ""))
    conn.execute(
        "INSERT INTO movements (item_id, delta, before_qty, after_qty, reason, destination) VALUES (?,?,?,?,?,?)",
        (item_id, add, before, before + add, reason, ""),
    )


@router.post("/api/kits/{kit_id}/assemble")
def assemble_kit(kit_id: int, req: KitAssemble):
    """組裝：從材料庫存扣掉所需數量，整組庫存增加"""
    if req.qty <= 0:
        raise HTTPException(400, "組裝數量必須大於 0")
    conn = get_db()
    kit = conn.execute("SELECT * FROM kits WHERE id=?", (kit_id,)).fetchone()
    if not kit:
        raise HTTPException(404, "套件不存在")
    comps = conn.execute("SELECT * FROM kit_items WHERE kit_id=?", (kit_id,)).fetchall()

    # 檢查材料庫存
    short = []
    for c in comps:
        mat = conn.execute("SELECT * FROM items WHERE id=? AND is_deleted=0", (c["item_id"],)).fetchone()
        if not mat:  # M6：材料已刪除 → 不可組裝
            raise HTTPException(400, f"材料 id={c['item_id']} 已刪除，無法組裝")
        need = c["qty"] * req.qty
        stock = _total(conn, c["item_id"])
        if stock < need:
            short.append(f"{mat['name']}（需要 {need}，剩 {stock}）")
    if short:
        conn.close()
        raise HTTPException(400, "材料不足：" + "、".join(short))

    # 扣材料
    for c in comps:
        need = c["qty"] * req.qty
        _deduct_total(conn, c["item_id"], need, f"組裝套件:{kit['name']}")
    # 加整組庫存
    _add_total(conn, kit["item_id"], req.qty, f"組裝完成:{kit['name']}")
    conn.commit()
    conn.close()
    return {"ok": True, "kit": kit["name"], "qty": req.qty}


@router.post("/api/kits/{kit_id}/disassemble")
def disassemble_kit(kit_id: int, req: KitAssemble):
    """拆解：整組扣掉，材料庫存加回"""
    if req.qty <= 0:
        raise HTTPException(400, "拆解數量必須大於 0")
    conn = get_db()
    kit = conn.execute("SELECT * FROM kits WHERE id=?", (kit_id,)).fetchone()
    if not kit:
        raise HTTPException(404, "套件不存在")
    kit_stock = _total(conn, kit["item_id"])
    if kit_stock < req.qty:
        conn.close()
        raise HTTPException(400, f"整組庫存不足！只剩 {kit_stock} 組")

    # 扣整組
    _deduct_total(conn, kit["item_id"], req.qty, f"拆解:{kit['name']}")
    # 加回材料
    comps = conn.execute("SELECT * FROM kit_items WHERE kit_id=?", (kit_id,)).fetchall()
    for c in comps:
        add = c["qty"] * req.qty
        _add_total(conn, c["item_id"], add, f"拆解套件:{kit['name']}")
    conn.commit()
    conn.close()
    return {"ok": True, "kit": kit["name"], "qty": req.qty}