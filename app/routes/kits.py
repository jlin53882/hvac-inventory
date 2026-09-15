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

from fastapi import Depends, APIRouter, HTTPException

from app.database import get_db
from app.models import KitAssemble, KitCreate
from app.routes.photos import has_photo
from app.services.auth import require_perm
from app.services.inventory_stock import assert_projected_inventory, current_state
from app.services.quantity import canonical_qty

# 整組 API 路由
router = APIRouter()


def _total(conn, item_id) -> float:
    """計算單一品項的位置庫存總量，回傳 float"""
    return canonical_qty(conn.execute("SELECT COALESCE(SUM(qty),0) FROM item_stocks WHERE item_id=?",
                                     (item_id,)).fetchone()[0])


@router.get("/api/kits", dependencies=[Depends(require_perm("kit-view"))])
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


@router.post("/api/kits", status_code=201, dependencies=[Depends(require_perm("kit-mgmt"))])
def create_kit(kit: KitCreate):
    """新增套件定義：建立套件品項 + 組成材料"""
    if not kit.name or not kit.items:
        raise HTTPException(400, "套件名稱與材料都不能空白")
    conn = get_db()
    try:
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
        for i, comp in enumerate(kit.items, 1):
            _validate_kit_comp(conn, comp, i)  # 材料驗證：格式/數量>0/品項存在（2026-08-12 補）
            conn.execute(
                "INSERT INTO kit_items (kit_id, item_id, qty) VALUES (?,?,?)",
                (kit_id, comp["item_id"], canonical_qty(comp.get("qty", 1))),
            )
        conn.commit()
        return {"id": kit_id, "item_id": kit_item_id, "name": kit.name}
    except Exception:
        conn.rollback()   # 2026-08-14 鎖洩漏根治：確保釋放 RESERVED 鎖
        raise
    finally:
        conn.close()      # 2026-08-14 防止中途炸掉 close 被跳過（bare-conn 洩漏主因）


def _validate_kit_comp(conn, comp, i) -> None:
    """整組材料單筆驗證：物件格式 / 數量必須 >0（防負 qty 假流水）/ 品項必須存在且未刪除"""
    if not isinstance(comp, dict):
        raise HTTPException(400, f"第 {i} 筆材料格式錯誤（需為 JSON 物件）")
    qty = comp.get("qty", 1)
    try:
        canonical = canonical_qty(qty)
    except ValueError:
        raise HTTPException(400, f"第 {i} 筆材料數量格式錯誤")
    if canonical <= 0:
        raise HTTPException(400, f"第 {i} 筆材料數量正規化後必須大於 0")
    cid = comp.get("item_id")
    if not isinstance(cid, int) or isinstance(cid, bool):
        raise HTTPException(400, f"第 {i} 筆材料品項 id 格式錯誤")
    if conn.execute("SELECT id FROM items WHERE id=? AND is_deleted=0", (cid,)).fetchone() is None:
        raise HTTPException(400, f"第 {i} 筆材料品項 id={cid} 不存在或已刪除")


@router.put("/api/kits/{kit_id}", dependencies=[Depends(require_perm("kit-mgmt"))])
def update_kit(kit_id: int, kit: KitCreate):
    """更新整組定義（名稱/備註 + 全量替換材料；不影響已組裝的整組庫存）"""
    if not kit.name or not kit.items:
        raise HTTPException(400, "套件名稱與材料都不能空白")
    conn = get_db()
    try:
        row = conn.execute("SELECT * FROM kits WHERE id=?", (kit_id,)).fetchone()
        if not row:
            raise HTTPException(404, "整組不存在")
        # 2026-08-14 樂觀鎖：前端帶 updated_at 快照 → WHERE 守衛，被他人改過 → rowcount=0 → 409
        if kit.updated_at:
            cur = conn.execute(
                "UPDATE kits SET name=?, note=?, updated_at=datetime('now') WHERE id=? AND updated_at=?",
                (kit.name, kit.note, kit_id, kit.updated_at))
            if cur.rowcount == 0:
                raise HTTPException(409, "該整組已被他人修改，請重新整理後再編輯")
        else:
            conn.execute("UPDATE kits SET name=?, note=?, updated_at=datetime('now') WHERE id=?",
                         (kit.name, kit.note, kit_id))
        conn.execute("UPDATE items SET name=?, updated_at=? WHERE id=?",
                     (kit.name, datetime.datetime.now().isoformat(), row["item_id"]))
        conn.execute("DELETE FROM kit_items WHERE kit_id=?", (kit_id,))
        for i, comp in enumerate(kit.items, 1):
            _validate_kit_comp(conn, comp, i)  # 材料驗證（與 create 共用）
            conn.execute("INSERT INTO kit_items (kit_id, item_id, qty) VALUES (?,?,?)",
                         (kit_id, comp["item_id"], canonical_qty(comp.get("qty", 1))))
        conn.commit()
        return {"ok": True, "id": kit_id, "name": kit.name}
    except Exception:
        conn.rollback()   # 2026-08-14 鎖洩漏根治：確保釋放 RESERVED 鎖
        raise
    finally:
        conn.close()      # 2026-08-14 防止中途炸掉 close 被跳過（bare-conn 洩漏主因）


@router.delete("/api/kits/{kit_id}", dependencies=[Depends(require_perm("kit-mgmt"))])
def delete_kit(kit_id: int):
    """刪除整組定義：套件、材料關聯、套件品項（含流水/盤點/位置庫存/照片）"""
    conn = get_db()
    try:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute("SELECT * FROM kits WHERE id=?", (kit_id,)).fetchone()
        if not row:
            raise HTTPException(404, "整組不存在")
        item_id = row["item_id"]
        # 與 DELETE item 相同 contract：prepared 不得遺留、stock 不得隱藏殘留、movement 與 persisted 一致
        kit_item = conn.execute("SELECT prepared_qty FROM items WHERE id=? AND is_deleted=0", (item_id,)).fetchone()
        if kit_item and canonical_qty(kit_item["prepared_qty"] or 0) > 0:
            raise HTTPException(400, f"該整組有待領出數量 {kit_item['prepared_qty']}，請先處理待領出再刪除")
        kit_stocks = conn.execute(
            "SELECT location, qty FROM item_stocks WHERE item_id=? AND qty != 0",
            (item_id,)).fetchall()
        for s in kit_stocks:
            if s["qty"] > 0:
                conn.execute(
                    "INSERT INTO movements (item_id, delta, before_qty, after_qty, reason, destination) VALUES (?,?,?,?,?,?)",
                    (item_id, -s["qty"], s["qty"], 0, "品項刪除清零", s["location"] or ""))
        if kit_stocks:
            conn.execute("UPDATE item_stocks SET qty=0, updated_at=datetime('now') WHERE item_id=?", (item_id,))
        conn.execute("DELETE FROM kit_items WHERE kit_id=?", (kit_id,))
        conn.execute("DELETE FROM kits WHERE id=?", (kit_id,))
        # M6：套件品項 soft-delete（保留 movements/stocktakes 稽核軌跡）
        conn.execute("UPDATE items SET is_deleted=1, updated_at=? WHERE id=?",
                     (datetime.datetime.now().isoformat(), item_id))
        conn.commit()
    except Exception:
        conn.rollback()   # 2026-08-14 鎖洩漏根治：確保釋放 RESERVED 鎖
        raise
    finally:
        conn.close()      # 2026-08-14 防止中途炸掉 close 被跳過（bare-conn 洩漏主因）
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
    """從位置庫存由後往前扣 need，記錄 movements。不足則拋錯。
    （2026-09-14：need 與每次扣除均先 canonicalize 到 3dp，避免 binary float remainder。）"""
    stocks = conn.execute("SELECT * FROM item_stocks WHERE item_id=? ORDER BY id",
                          (item_id,)).fetchall()
    before = canonical_qty(sum(s["qty"] for s in stocks))
    need = canonical_qty(need)
    if need <= 0:
        raise HTTPException(400, "扣除數量正規化後必須大於 0")
    remaining = need
    for s in stocks:  # M10：統一從頭扣（與 stockout._deduct 一致）
        if remaining <= 0:
            break
        take = canonical_qty(min(s["qty"], remaining))
        cur = conn.execute("UPDATE item_stocks SET qty=ROUND(qty-?,3), updated_at=? WHERE id=? AND qty>=?",
                           (take, datetime.datetime.now().isoformat(), s["id"], take))
        if cur.rowcount == 0:  # H5：併發被扣走 → 保守拒絕，不超賣
            raise HTTPException(400, f"庫存不足！剩 {before}")
        remaining = canonical_qty(remaining - take)
    if remaining > 0:
        raise HTTPException(400, f"庫存不足！剩 {before}")
    # 2026-08-14 P4-1：寫後重讀真實總量（併發下流水鏈 before+delta=after 恆成立）
    after = canonical_qty(sum(s["qty"] for s in conn.execute(
        "SELECT qty FROM item_stocks WHERE item_id=?", (item_id,)).fetchall()))
    conn.execute(
        "INSERT INTO movements (item_id, delta, before_qty, after_qty, reason, destination) VALUES (?,?,?,?,?,?)",
        (item_id, -need, before, after, reason, ""),
    )


def _add_total(conn, item_id, add, reason):
    """加入第一筆位置庫存，記錄 movements。"""
    add = canonical_qty(add)
    if add <= 0:
        raise HTTPException(400, "增加數量正規化後必須大於 0")
    stocks = conn.execute("SELECT * FROM item_stocks WHERE item_id=? ORDER BY id",
                          (item_id,)).fetchall()
    target = stocks[0] if stocks else None
    before = canonical_qty(sum(s["qty"] for s in stocks))
    if target:
        conn.execute("UPDATE item_stocks SET qty=ROUND(qty+?,3), updated_at=? WHERE id=?",
                     (add, datetime.datetime.now().isoformat(), target["id"]))
    else:
        conn.execute("INSERT INTO item_stocks (item_id, location, qty, note) VALUES (?,?,?,?)",
                     (item_id, "", add, ""))
    # 2026-08-14 P4-1：寫後重讀真實總量（併發下流水鏈 before+delta=after 恆成立）
    after = canonical_qty(sum(s["qty"] for s in conn.execute(
        "SELECT qty FROM item_stocks WHERE item_id=?", (item_id,)).fetchall()))
    conn.execute(
        "INSERT INTO movements (item_id, delta, before_qty, after_qty, reason, destination) VALUES (?,?,?,?,?,?)",
        (item_id, add, before, after, reason, ""),
    )


@router.post("/api/kits/{kit_id}/assemble", dependencies=[Depends(require_perm("kit-mgmt"))])
def assemble_kit(kit_id: int, req: KitAssemble):
    """組裝：從材料庫存扣掉所需數量，整組庫存增加"""
    try:
        qty = canonical_qty(req.qty)
    except ValueError:
        raise HTTPException(400, "組裝數量格式錯誤")
    if qty <= 0:
        raise HTTPException(400, "組裝數量正規化後必須大於 0")
    conn = get_db()
    try:
        conn.execute("BEGIN IMMEDIATE")
        kit = conn.execute("SELECT * FROM kits WHERE id=?", (kit_id,)).fetchone()
        if not kit:
            raise HTTPException(404, "套件不存在")
        comps = conn.execute("SELECT * FROM kit_items WHERE kit_id=?", (kit_id,)).fetchall()

        # 檢查材料庫存（2026-09-12：容差 1e-9，浮點殘留如 0.3 vs 0.1+0.2 不得誤判不足）
        # P0-D：可用量 = total - prepared（reserved 待領出不可吃掉），同一 writer transaction 內驗證
        short = []
        for c in comps:
            mat = conn.execute("SELECT * FROM items WHERE id=? AND is_deleted=0", (c["item_id"],)).fetchone()
            if not mat:  # M6：材料已刪除 → 不可組裝
                raise HTTPException(400, f"材料 id={c['item_id']} 已刪除，無法組裝")
            need = canonical_qty(c["qty"] * qty)
            try:
                assert_projected_inventory(conn, c["item_id"], stock_delta=-need)
            except HTTPException:
                total, prepared = current_state(conn, c["item_id"])
                short.append(f"{mat['name']}（需要 {need}，可用 {canonical_qty(total - prepared)}）")
        if short:
            raise HTTPException(400, "材料不足：" + "、".join(short))

        # 扣材料
        for c in comps:
            need = canonical_qty(c["qty"] * qty)
            _deduct_total(conn, c["item_id"], need, f"組裝套件:{kit['name']}")
        # 加整組庫存
        _add_total(conn, kit["item_id"], qty, f"組裝完成:{kit['name']}")
        conn.commit()
        return {"ok": True, "kit": kit["name"], "qty": qty}
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


@router.post("/api/kits/{kit_id}/disassemble", dependencies=[Depends(require_perm("kit-mgmt"))])
def disassemble_kit(kit_id: int, req: KitAssemble):
    """拆解：整組扣掉，材料庫存加回"""
    try:
        qty = canonical_qty(req.qty)
    except ValueError:
        raise HTTPException(400, "拆解數量格式錯誤")
    if qty <= 0:
        raise HTTPException(400, "拆解數量正規化後必須大於 0")
    conn = get_db()
    try:
        conn.execute("BEGIN IMMEDIATE")
        kit = conn.execute("SELECT * FROM kits WHERE id=?", (kit_id,)).fetchone()
        if not kit:
            raise HTTPException(404, "套件不存在")
        kit_stock = _total(conn, kit["item_id"])
        if kit_stock < qty:
            raise HTTPException(400, f"整組庫存不足！只剩 {kit_stock} 組")
        # P0-D：拆解降低整組自身庫存，拆後 total 不得低於其 prepared（同一 writer transaction 內驗證）
        assert_projected_inventory(conn, kit["item_id"], stock_delta=-qty)

        # 扣整組
        _deduct_total(conn, kit["item_id"], qty, f"拆解:{kit['name']}")
        # 加回材料
        comps = conn.execute("SELECT * FROM kit_items WHERE kit_id=?", (kit_id,)).fetchall()
        for c in comps:
            add = canonical_qty(c["qty"] * qty)
            _add_total(conn, c["item_id"], add, f"拆解套件:{kit['name']}")
        conn.commit()
        return {"ok": True, "kit": kit["name"], "qty": qty}
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()