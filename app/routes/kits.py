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
import sqlite3
from typing import Optional

from fastapi import Depends, APIRouter, HTTPException

from app.database import get_db
from app.models import InventorySite, InventorySiteQuery, KitAssemble, KitCreate
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
def list_kits(site: Optional[InventorySiteQuery] = None):
    """套件清單（含組成材料）"""
    conn = get_db()
    where = ""
    params = ()
    if site and site != "all":
        where = " WHERE i.site = ?"
        params = (site,)
    kits = conn.execute(
        f"SELECT k.*, i.unit, i.brand, i.code, i.site FROM kits k JOIN items i ON i.id = k.item_id{where} AND i.is_deleted = 0 ORDER BY k.name",
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
        site: InventorySite = kit.site or "office"
        # 先驗證材料存在且與整組同一分片，避免留下跨區 BOM
        for i, comp in enumerate(kit.items, 1):
            _validate_kit_comp(conn, comp, i, site)
        # 建立套件品項（v10：主檔 + 一筆空位置 stock）
        cur = conn.execute(
            "INSERT INTO items (brand, code, name, unit, is_kit, site) VALUES (?,?,?,?,1,?)",
            (kit.brand.strip(), kit.code.strip(), kit.name, "組", site),
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
        seen_items: set = set()
        for i, comp in enumerate(kit.items, 1):
            _validate_kit_comp(conn, comp, i)
            cid = comp["item_id"]
            if cid in seen_items:
                raise HTTPException(400, "同一材料不可重複加入整組，請合併數量")
            seen_items.add(cid)
            conn.execute(
                "INSERT INTO kit_items (kit_id, item_id, qty) VALUES (?,?,?)",
                (kit_id, cid, canonical_qty(comp.get("qty", 1))),
            )
        conn.commit()
        return {"id": kit_id, "item_id": kit_item_id, "name": kit.name,
                "brand": kit.brand.strip(), "code": kit.code.strip()}
    except sqlite3.IntegrityError as exc:
        conn.rollback()
        if "idx_items_unique" in str(exc):
            raise HTTPException(400, "相同的整組已存在，請調整品牌、型號或名稱") from exc
        raise
    except Exception:
        conn.rollback()   # 2026-08-14 鎖洩漏根治：確保釋放 RESERVED 鎖
        raise
    finally:
        conn.close()      # 2026-08-14 防止中途炸掉 close 被跳過（bare-conn 洩漏主因）


def _validate_kit_comp(conn, comp, i, site: Optional[InventorySite] = None) -> None:
    """整組材料單筆驗證：格式、正數、存在，且可選擇要求同一 site。"""
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
    component = conn.execute(
        "SELECT id, site FROM items WHERE id=? AND is_deleted=0", (cid,)
    ).fetchone()
    if component is None:
        raise HTTPException(400, f"第 {i} 筆材料品項 id={cid} 不存在或已刪除")
    if site and component["site"] != site:
        raise HTTPException(400, f"第 {i} 筆材料必須位於「{site}」庫存區")


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
        kit_item = conn.execute("SELECT site FROM items WHERE id=? AND is_deleted=0", (row["item_id"],)).fetchone()
        if kit_item is None:
            raise HTTPException(404, "整組品項不存在或已刪除")
        site = kit_item["site"]
        if kit.site and kit.site != site:
            raise HTTPException(400, "整組不能直接變更庫存區，請使用庫存調撥")
        for i, comp in enumerate(kit.items, 1):
            _validate_kit_comp(conn, comp, i, site)
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
        try:
            conn.execute("UPDATE items SET name=?, brand=?, code=?, updated_at=? WHERE id=?",
                         (kit.name, kit.brand.strip(), kit.code.strip(), datetime.datetime.now().isoformat(), row["item_id"]))
        except sqlite3.IntegrityError as exc:
            if "idx_items_unique" in str(exc) or "UNIQUE constraint failed" in str(exc):
                raise HTTPException(400, "相同的整組已存在，請調整品牌、型號或名稱") from exc
            raise
        conn.execute("DELETE FROM kit_items WHERE kit_id=?", (kit_id,))
        seen_items: set = set()
        for i, comp in enumerate(kit.items, 1):
            _validate_kit_comp(conn, comp, i, site)
            cid = comp["item_id"]
            if cid in seen_items:
                raise HTTPException(400, "同一材料不可重複加入整組，請合併數量")
            seen_items.add(cid)
            conn.execute("INSERT INTO kit_items (kit_id, item_id, qty) VALUES (?,?,?)",
                         (kit_id, cid, canonical_qty(comp.get("qty", 1))))
        conn.commit()
        saved = conn.execute("""
            SELECT k.id, i.name, i.brand, i.code
            FROM kits k JOIN items i ON i.id = k.item_id
            WHERE k.id = ?
        """, (kit_id,)).fetchone()
        return {"ok": True, "id": saved["id"], "name": saved["name"],
                "brand": saved["brand"] or "", "code": saved["code"] or ""}
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

        # F1：aggregate BOM by item_id（防止 duplicate BOM cumulative deduction 突破 prepared invariant）
        required_by_item: dict = {}
        mat_names: dict = {}
        for c in comps:
            cid = c["item_id"]
            mat = conn.execute("SELECT * FROM items WHERE id=? AND is_deleted=0", (cid,)).fetchone()
            if not mat:
                raise HTTPException(400, f"材料 id={cid} 已刪除，無法組裝")
            mat_names[cid] = mat["name"]
            cumulative_need = canonical_qty(c["qty"] * qty)
            required_by_item[cid] = canonical_qty(required_by_item.get(cid, 0) + cumulative_need)

        # 檢查材料庫存（P0-D：可用量 = total - prepared，同一 writer transaction 內驗證）
        short = []
        for cid, need in required_by_item.items():
            try:
                assert_projected_inventory(conn, cid, stock_delta=-need)
            except HTTPException:
                total, prepared = current_state(conn, cid)
                short.append(f"{mat_names[cid]}（需要 {need}，可用 {canonical_qty(total - prepared)}）")
        if short:
            raise HTTPException(400, "材料不足：" + "、".join(short))

        # 扣材料（使用 aggregate cumulative need）
        for cid, need in required_by_item.items():
            _deduct_total(conn, cid, need, f"組裝套件:{kit['name']}")
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