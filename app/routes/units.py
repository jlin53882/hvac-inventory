"""單位字典 CRUD + 歷史收編（2026-08-16 單位動態清單）"""
import sqlite3
from fastapi import APIRouter, Depends, HTTPException
from app.database import get_db
from app.models import UnitIn, UnitUpdate, UnitConsolidate
from app.services.auth import require_perm

router = APIRouter()


def _row_to_dict(r):
    return {"id": r["id"], "name": r["name"], "sort_order": r["sort_order"], "is_active": bool(r["is_active"])}


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
    conn = get_db()
    try:
        if conn.execute("SELECT id FROM units WHERE name=?", (name,)).fetchone():
            raise HTTPException(400, f"單位「{name}」已存在")
        nxt = conn.execute("SELECT COALESCE(MAX(sort_order),0)+1 FROM units").fetchone()[0]
        cur = conn.execute("INSERT INTO units (name, sort_order) VALUES (?, ?)", (name, nxt))
        conn.commit()
        return _row_to_dict(conn.execute("SELECT * FROM units WHERE id=?", (cur.lastrowid,)).fetchone())
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
        conn.commit()
        return _row_to_dict(conn.execute("SELECT * FROM units WHERE id=?", (unit_id,)).fetchone())
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


@router.post("/api/units/consolidate", dependencies=[Depends(require_perm("unit-mgmt"))])
def consolidate_units(req: UnitConsolidate):
    """收編：items.unit from→to（含 is_deleted=1 幽靈品項，B4）；來源單位若在 units 表 → 停用。
    (A3) items 唯一鍵 (brand,code,name,unit,site) 含 unit——收編前先偵測衝突：同 (brand,code,name,site)
    已有 to_unit 活品項 → 409 列出，避免 IntegrityError 500。(B5) UPDATE bump updated_at（樂觀鎖）。"""
    frm, to = req.from_unit.strip(), req.to_unit.strip()
    if not frm or not to:
        raise HTTPException(400, "來源與目標單位不可為空白")
    if frm == to:
        raise HTTPException(400, "來源與目標單位相同")
    conn = get_db()
    try:
        # A3 衝突偵測：同 (brand,code,name,site) 已存在 to_unit 的「活」品項，且該鍵也有 from_unit 品項
        conflicts = conn.execute(
            """SELECT t.brand, t.code, t.name, t.site, COUNT(*) AS n
                FROM items t
                JOIN items f ON f.brand IS t.brand AND f.code IS t.code
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
