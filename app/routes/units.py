"""單位字典 CRUD + 歷史收編（2026-08-16 單位動態清單）"""
import sqlite3
from fastapi import APIRouter, Depends, HTTPException
from app.database import get_db
from app.models import UnitIn, UnitUpdate, UnitConsolidate, UnitConsolidateItem, QTY_TYPES
from app.services.auth import require_perm
from app.services.inventory_stock import assert_projected_inventory
from app.services.quantity import canonical_qty

router = APIRouter()


def _row_to_dict(r):
    d = {"id": r["id"], "name": r["name"], "sort_order": r["sort_order"], "is_active": bool(r["is_active"])}
    try:
        d["qty_type"] = r["qty_type"] or "integer"
    except (KeyError, IndexError):
        d["qty_type"] = "integer"
    return d


def _check_qty_type(v):
    if v not in QTY_TYPES:
        raise HTTPException(400, f"數量類型僅接受 {','.join(QTY_TYPES)}")


@router.get("/api/units")
def list_units():
    """全角色（登入即可）：回傳全部（含停用），前端自行過濾 active。"""
    conn = get_db()
    try:
        rows = conn.execute("SELECT * FROM units ORDER BY sort_order, id").fetchall()
        return [_row_to_dict(r) for r in rows]
    finally:
        conn.close()


@router.post("/api/units", status_code=201, dependencies=[Depends(require_perm("item-mgmt"))])
def create_unit(u: UnitIn):
    """＋ 快速新增（item-mgmt：admin/user）。名稱重複（含停用）→ 400。"""
    name = u.name.strip()
    if not name:
        raise HTTPException(400, "單位名稱不可為空白")
    _check_qty_type((u.qty_type or "integer").strip())
    conn = get_db()
    try:
        if conn.execute("SELECT id FROM units WHERE name=?", (name,)).fetchone():
            raise HTTPException(400, f"單位「{name}」已存在")
        nxt = conn.execute("SELECT COALESCE(MAX(sort_order),0)+1 FROM units").fetchone()[0]
        cur = conn.execute("INSERT INTO units (name, sort_order, qty_type) VALUES (?, ?, ?)",
                           (name, nxt, (u.qty_type or "integer").strip()))
        conn.commit()
        return _row_to_dict(conn.execute("SELECT * FROM units WHERE id=?", (cur.lastrowid,)).fetchone())
    except sqlite3.IntegrityError:
        conn.rollback()
        raise HTTPException(400, f"單位「{name}」已存在")
    finally:
        conn.close()


@router.put("/api/units/{unit_id}", dependencies=[Depends(require_perm("unit-mgmt"))])
def update_unit(unit_id: int, u: UnitUpdate):
    """改名/排序/啟停（unit-mgmt：admin）。改名重複 → 400。"""
    conn = get_db()
    try:
        row = conn.execute("SELECT * FROM units WHERE id=?", (unit_id,)).fetchone()
        if not row:
            raise HTTPException(404, "單位不存在")
        if u.name is not None:
            name = u.name.strip()
            if not name:
                raise HTTPException(400, "單位名稱不可為空白")
            dup = conn.execute("SELECT id FROM units WHERE name=? AND id!=?", (name, unit_id)).fetchone()
            if dup:
                raise HTTPException(400, f"單位「{name}」已存在")
            conn.execute("UPDATE units SET name=? WHERE id=?", (name, unit_id))
        if u.sort_order is not None:
            conn.execute("UPDATE units SET sort_order=? WHERE id=?", (u.sort_order, unit_id))
        if u.is_active is not None:
            conn.execute("UPDATE units SET is_active=? WHERE id=?", (1 if u.is_active else 0, unit_id))
        if u.qty_type is not None:
            _check_qty_type(u.qty_type.strip())
            conn.execute("UPDATE units SET qty_type=? WHERE id=?", (u.qty_type.strip(), unit_id))
        conn.commit()
        return _row_to_dict(conn.execute("SELECT * FROM units WHERE id=?", (unit_id,)).fetchone())
    except sqlite3.IntegrityError:
        conn.rollback()
        raise HTTPException(400, "單位名稱已存在")
    finally:
        conn.close()


@router.delete("/api/units/{unit_id}", dependencies=[Depends(require_perm("unit-mgmt"))])
def deactivate_unit(unit_id: int):
    """停用（soft delete，歷史引用保留）→ is_active=0。"""
    conn = get_db()
    try:
        row = conn.execute("SELECT id FROM units WHERE id=?", (unit_id,)).fetchone()
        if not row:
            raise HTTPException(404, "單位不存在")
        conn.execute("UPDATE units SET is_active=0 WHERE id=?", (unit_id,))
        conn.commit()
        return {"ok": True}
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


@router.get("/api/units/usage")
def unit_usage():
    """items 實際使用分佈（全角色）：前端比對出「不在清單的歷史值」列收編建議。
    (B4 決策) 只統計 is_deleted=0（現行品項）；幽靈品項（is_deleted=1 非庫存）由
    consolidate 收編時一併處理，不列建議——docs 註明此為刻意決策。"""
    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT unit, COUNT(*) AS cnt FROM items WHERE is_deleted=0 GROUP BY unit ORDER BY cnt DESC"
        ).fetchall()
        return [{"unit": r["unit"], "count": r["cnt"]} for r in rows]
    finally:
        conn.close()


@router.get("/api/units/orphans")
def unit_orphans():
    """unit 不在啟用單位清單的品項明細（全角色）：
    (B 方案) 逐筆收編的資料源——含 is_deleted=1 幽靈品項與 total_qty。
    語意對齊前端舊判定：LEFT JOIN units ON unit=name AND is_active=1 → u.id IS NULL。"""
    conn = get_db()
    try:
        rows = conn.execute(
            """SELECT i.id AS item_id, i.name, i.code, i.site, i.unit, i.is_deleted,
                      COALESCE((SELECT SUM(s.qty) FROM item_stocks s WHERE s.item_id = i.id), 0) AS total_qty
               FROM items i
               LEFT JOIN units u ON i.unit = u.name AND u.is_active = 1
               WHERE u.id IS NULL
               ORDER BY i.unit, i.site, i.name"""
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


@router.post("/api/units/consolidate", dependencies=[Depends(require_perm("unit-mgmt"))])
def consolidate_units(req: UnitConsolidate):
    """收編：items.unit from→to（含 is_deleted=1 幽靈品項，B4）；來源單位若在 units 表 → 停用。
    (A3) items 唯一鍵 (brand,code,name,unit,site) 含 unit——收編前先偵測衝突：同 (brand,code,name,site)
    已有 to_unit 活品項 → 409 列出，避免 IntegrityError 500。(B5) UPDATE bump updated_at（樂觀鎖）。"""
    frm = (req.from_unit or "").strip()  # B3：from_unit 允許空字串（活庫 11 筆 unit='' 需可收編）
    to = req.to_unit.strip()
    if not to:
        raise HTTPException(400, "目標單位不可為空白")
    if frm == to:
        raise HTTPException(400, "來源與目標單位相同")
    conn = get_db()
    try:
        if conn.execute("SELECT id FROM units WHERE name=?", (to,)).fetchone() is None:
            raise HTTPException(400, f"目標單位「{to}」不在單位清單中，請先在清單新增")
        # A3 衝突偵測：同 (brand,code,name,site) 已存在 to_unit 的「活」品項，且該鍵也有 from_unit 品項
        conflicts = conn.execute(
            """SELECT t.brand, t.code, t.name, t.site, COUNT(*) AS n
                FROM items t
                JOIN items f ON f.brand IS t.brand
                             AND COALESCE(f.code, '') = COALESCE(t.code, '')
                             AND f.name IS t.name AND f.site IS t.site
                WHERE t.unit=? AND t.is_deleted=0 AND f.unit=? AND f.is_deleted=0
                GROUP BY t.brand, t.code, t.name, t.site LIMIT 10""",
            (to, frm)).fetchall()
        if conflicts:
            detail = "；".join(
                f"{r['brand']} {r['name']}（{r['site']}）已存在「{to}」{r['n']} 筆" for r in conflicts[:3])
            raise HTTPException(409, f"收編會與既有品項重複：{detail}。請先編輯合併再收編")
        cur = conn.execute(
            "UPDATE items SET unit=?, updated_at=CURRENT_TIMESTAMP WHERE unit=?",
            (to, frm))  # B4：不排除 is_deleted（非庫存幽靈品項的單位也收編）
        affected = cur.rowcount
        conn.execute("UPDATE units SET is_active=0 WHERE name=? AND is_active=1", (frm,))
        conn.commit()
        return {"affected": affected, "from_unit": frm, "to_unit": to}
    except sqlite3.IntegrityError:
        conn.rollback()
        raise HTTPException(409, "收編造成品項重複（唯一鍵衝突），請先合併品項再收編")
    finally:
        conn.close()


@router.post("/api/units/consolidate-item", dependencies=[Depends(require_perm("unit-mgmt"))])
def consolidate_item(req: UnitConsolidateItem):
    """單筆收編：items.unit → to_unit（含幽靈品項）。不處理來源停用——
    來源若非字典值即無從停用；若為停用字典單位則早已停用（收編前即 is_active=0）。
    new_qty（2026-09-12）：同時指定新總量（歷史分數轉換用）；僅單位置品項可轉，
    多位置 → 400（總量語意不明，防 silently 改變庫存）；數量變化寫 movement 留軌跡。"""
    to = req.to_unit.strip()
    if not to:
        raise HTTPException(400, "目標單位不可為空白")
    conn = get_db()
    try:
        conn.execute("BEGIN IMMEDIATE")
        item = conn.execute("SELECT * FROM items WHERE id=?", (req.item_id,)).fetchone()
        if not item:
            raise HTTPException(404, "品項不存在")
        if conn.execute("SELECT id FROM units WHERE name=?", (to,)).fetchone() is None:
            raise HTTPException(400, f"目標單位「{to}」不在單位清單中，請先在清單新增")
        if item["unit"] == to:
            raise HTTPException(400, "該品項已是此單位")
        # 單筆版 A3 衝突：同 (brand,code,name,site) 已有 to_unit 活品項（排除自己）
        conflict = conn.execute(
            """SELECT id FROM items
               WHERE brand IS ? AND COALESCE(code,'') = COALESCE(?,'')
                 AND name IS ? AND site IS ? AND unit = ? AND is_deleted = 0 AND id != ?
               LIMIT 1""",
            (item["brand"], item["code"], item["name"], item["site"], to, req.item_id)).fetchone()
        if conflict:
            raise HTTPException(409, f"已存在同品名「{item['name']}」單位為「{to}」的品項，請先編輯合併再改")
        conn.execute("UPDATE items SET unit=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
                     (to, req.item_id))
        new_qty = None
        if req.new_qty is not None:
            stocks = conn.execute("SELECT * FROM item_stocks WHERE item_id=?", (req.item_id,)).fetchall()
            if len(stocks) != 1:
                raise HTTPException(400, "多位置品項無法指定新總量（總量語意不明），請先合併位置或手動調整")
            before = canonical_qty(stocks[0]["qty"] or 0)
            try:
                new_qty = canonical_qty(req.new_qty)
            except ValueError:
                raise HTTPException(400, "新總量格式錯誤")
            # P0-C：new_qty 降低總量時，最終 total 不得低於 prepared（同一 writer transaction 內驗證）
            assert_projected_inventory(conn, req.item_id, stock_delta=canonical_qty(new_qty - before))
            conn.execute("UPDATE item_stocks SET qty=? WHERE id=?", (new_qty, stocks[0]["id"]))
            delta = canonical_qty(new_qty - before)
            if delta != 0:
                conn.execute(
                    "INSERT INTO movements (item_id, delta, before_qty, after_qty, reason) VALUES (?,?,?,?,?)",
                    (req.item_id, delta, before, new_qty, "歷史單位轉換"))
        conn.commit()
        resp = {"ok": True, "item_id": req.item_id, "to_unit": to}
        if new_qty is not None:
            resp["new_qty"] = new_qty
        return resp
    except sqlite3.IntegrityError:
        conn.rollback()
        raise HTTPException(409, "改單位造成品項重複（唯一鍵衝突），請先合併品項再改")
    finally:
        conn.close()
