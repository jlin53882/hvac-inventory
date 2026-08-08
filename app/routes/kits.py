# -*- coding: utf-8 -*-
"""
整組（套件）路由：BOM 定義 + 組裝/拆解
=====================================
- GET   /api/kits                套件清單（含組成材料）
- POST  /api/kits                新增套件定義
- POST  /api/kits/{id}/assemble  組裝（扣材料 + 整組庫存增加）
- POST  /api/kits/{id}/disassemble  拆解（整組扣掉 + 材料加回）
"""
import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException

from app.database import get_db
from app.models import KitAssemble, KitCreate

router = APIRouter()


@router.get("/api/kits")
def list_kits(site: Optional[str] = None):
    """套件清單（含組成材料）"""
    conn = get_db()
    where = ""
    params = ()
    if site and site != "all":
        where = " WHERE i.site = ?"
        params = (site,)
    kits = conn.execute(f"SELECT k.*, i.qty as stock_qty, i.unit, i.brand FROM kits k JOIN items i ON i.id = k.item_id{where} ORDER BY k.name", params).fetchall()
    result = []
    for k in kits:
        items = conn.execute("""
            SELECT ki.item_id, ki.qty as need_qty, i.name, i.brand, i.code, i.unit, i.qty as stock
            FROM kit_items ki JOIN items i ON i.id = ki.item_id
            WHERE ki.kit_id = ?
        """, (k["id"],)).fetchall()
        d = dict(k)
        d["components"] = [dict(x) for x in items]
        result.append(d)
    conn.close()
    return result


@router.post("/api/kits", status_code=201)
def create_kit(kit: KitCreate):
    """新增套件定義：建立套件品項 + 組成材料"""
    if not kit.name or not kit.items:
        raise HTTPException(400, "套件名稱與材料都不能空白")
    conn = get_db()
    # 建立套件品項
    cur = conn.execute(
        "INSERT INTO items (brand, name, qty, unit, note, is_kit) VALUES (?,?,?,?,?,1)",
        ("", kit.name, 0, "組", kit.note),
    )
    kit_item_id = cur.lastrowid
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
        mat = conn.execute("SELECT * FROM items WHERE id=?", (c["item_id"],)).fetchone()
        need = c["qty"] * req.qty
        if mat["qty"] < need:
            short.append(f"{mat['name']}（需要 {need}，剩 {mat['qty']}）")
    if short:
        conn.close()
        raise HTTPException(400, "材料不足：" + "、".join(short))

    # 扣材料
    for c in comps:
        mat = conn.execute("SELECT * FROM items WHERE id=?", (c["item_id"],)).fetchone()
        need = c["qty"] * req.qty
        new_qty = mat["qty"] - need
        conn.execute("UPDATE items SET qty=?, updated_at=? WHERE id=?",
                     (new_qty, datetime.datetime.now().isoformat(), c["item_id"]))
        conn.execute(
            "INSERT INTO movements (item_id, delta, before_qty, after_qty, reason, destination) VALUES (?,?,?,?,?,?)",
            (c["item_id"], -need, mat["qty"], new_qty, f"組裝套件:{kit['name']}", ""),
        )
    # 加整組庫存
    kit_item = conn.execute("SELECT * FROM items WHERE id=?", (kit["item_id"],)).fetchone()
    new_kit_qty = kit_item["qty"] + req.qty
    conn.execute("UPDATE items SET qty=?, updated_at=? WHERE id=?",
                 (new_kit_qty, datetime.datetime.now().isoformat(), kit["item_id"]))
    conn.execute(
        "INSERT INTO movements (item_id, delta, before_qty, after_qty, reason, destination) VALUES (?,?,?,?,?,?)",
        (kit["item_id"], req.qty, kit_item["qty"], new_kit_qty, f"組裝完成:{kit['name']}", ""),
    )
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
    kit_item = conn.execute("SELECT * FROM items WHERE id=?", (kit["item_id"],)).fetchone()
    if kit_item["qty"] < req.qty:
        conn.close()
        raise HTTPException(400, f"整組庫存不足！只剩 {kit_item['qty']} 組")

    # 扣整組
    new_kit_qty = kit_item["qty"] - req.qty
    conn.execute("UPDATE items SET qty=?, updated_at=? WHERE id=?",
                 (new_kit_qty, datetime.datetime.now().isoformat(), kit["item_id"]))
    conn.execute(
        "INSERT INTO movements (item_id, delta, before_qty, after_qty, reason, destination) VALUES (?,?,?,?,?,?)",
        (kit["item_id"], -req.qty, kit_item["qty"], new_kit_qty, f"拆解:{kit['name']}", ""),
    )
    # 加回材料
    comps = conn.execute("SELECT * FROM kit_items WHERE kit_id=?", (kit_id,)).fetchall()
    for c in comps:
        mat = conn.execute("SELECT * FROM items WHERE id=?", (c["item_id"],)).fetchone()
        add = c["qty"] * req.qty
        new_qty = mat["qty"] + add
        conn.execute("UPDATE items SET qty=?, updated_at=? WHERE id=?",
                     (new_qty, datetime.datetime.now().isoformat(), c["item_id"]))
        conn.execute(
            "INSERT INTO movements (item_id, delta, before_qty, after_qty, reason, destination) VALUES (?,?,?,?,?,?)",
            (c["item_id"], add, mat["qty"], new_qty, f"拆解套件:{kit['name']}", ""),
        )
    conn.commit()
    conn.close()
    return {"ok": True, "kit": kit["name"], "qty": req.qty}
