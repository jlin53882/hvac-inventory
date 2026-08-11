# -*- coding: utf-8 -*-
"""
品項路由（v10 正規化）
=======================
- GET/POST    /api/items                    查詢/新增品項主檔（含位置庫存）
- POST        /api/items/{id}/stocks        新增位置
- PATCH       /api/stocks/{sid}             修改位置數量/備註
- DELETE      /api/stocks/{sid}             刪除位置
- POST        /api/items/{id}/adjust        加減庫存
- POST        /api/import                   從 JSON 匯入
- GET         /api/movements                異動紀錄

去重規則（v10 核心）：
  主檔以 (brand, code, name, unit, site) 為唯一鍵；
  新增時若已存在 → 400 提示，需改用「新增位置」加到既有品項。
"""
import datetime
import os
from typing import Optional

from fastapi import APIRouter, HTTPException

from app.database import get_db
from app.models import AdjustRequest, ItemCreate, ItemUpdate, StockUpdate
from app.routes.photos import has_photo

# 品項 API 路由
router = APIRouter()


def _item_full(conn, row) -> dict:
    """主檔 + 位置庫存 + 總量 組合成前端完整物件"""
    d = dict(row)
    d["stocks"] = [dict(s) for s in conn.execute(
        "SELECT * FROM item_stocks WHERE item_id=? ORDER BY id", (d["id"],)).fetchall()]
    # 舊欄位相容（前端/匯出仍可用）
    d["qty"] = sum(s["qty"] for s in d["stocks"])
    d["total_qty"] = d["qty"]
    d["location"] = d["stocks"][0]["location"] if d["stocks"] else ""
    d["note"] = d["stocks"][0]["note"] if d["stocks"] else ""
    d["has_photo"] = has_photo(d["id"])  # 前端顯示照片縮圖（無圖→📦）
    return d


@router.get("/api/items")
def list_items(
    brand: Optional[str] = None,
    search: Optional[str] = None,
    location: Optional[str] = None,
    sort: str = "brand",
    site: Optional[str] = None,
):
    """查詢品項清單（支援 brand/search/location/sort/site 篩選），回傳完整品項物件列表"""
    conn = get_db()
    sql = """SELECT i.*, COALESCE(SUM(s.qty),0) AS total_qty,
                    COUNT(s.id) AS stock_count
             FROM items i LEFT JOIN item_stocks s ON s.item_id = i.id
             WHERE 1=1"""
    params = []
    if site and site != "all":
        sql += " AND i.site = ?"
        params.append(site)
    if brand and brand != "全部":
        sql += " AND i.brand = ?"
        params.append(brand)
    if location:
        sql += " AND EXISTS (SELECT 1 FROM item_stocks s2 WHERE s2.item_id=i.id AND s2.location = ?)"
        params.append(location)
    if search:
        like = f"%{search}%"
        sql += """ AND (i.name LIKE ? OR i.code LIKE ? OR i.brand LIKE ?
                       OR EXISTS (SELECT 1 FROM item_stocks s3 WHERE s3.item_id=i.id
                                  AND (s3.location LIKE ? OR s3.note LIKE ?)))"""
        params += [like, like, like, like, like]
    sql += " GROUP BY i.id"
    sort_map = {
        "brand": "i.brand COLLATE NOCASE, i.name",
        "location": "location, i.name",
        "qty": "total_qty DESC",
        "created": "i.id DESC",
    }
    sql += f" ORDER BY {sort_map.get(sort, 'i.brand COLLATE NOCASE, i.name')}"
    rows = conn.execute(sql, params).fetchall()
    result = [_item_full(conn, r) for r in rows]
    conn.close()
    return result


@router.post("/api/items", status_code=201)
def create_item(item: ItemCreate):
    """新增品項主檔 + 位置庫存（v10 去重：同鍵已存在則 400 拒絕）"""
    conn = get_db()
    # ===== v10 去重規則 =====
    exists = conn.execute(
        "SELECT id FROM items WHERE brand=? AND code=? AND name=? AND unit=? AND site=?",
        (item.brand, item.code, item.name, item.unit, item.site),
    ).fetchone()
    if exists:
        conn.close()
        raise HTTPException(400, f"該品項已存在（id={exists['id']}）！要放新位置請用「編輯」→「新增位置」")

    cur = conn.execute(
        "INSERT INTO items (brand, code, name, unit, low_stock, site) VALUES (?,?,?,?,?,?)",
        (item.brand, item.code, item.name, item.unit, item.low_stock, item.site),
    )
    new_id = cur.lastrowid
    # 位置庫存
    if item.stocks:
        for s in item.stocks:
            conn.execute(
                "INSERT INTO item_stocks (item_id, location, qty, note) VALUES (?,?,?,?)",
                (new_id, s.location, s.qty, s.note),
            )
    else:
        # 至少一筆空位置庫存，維持「總量」語意（stocks 沒給時補 0）
        conn.execute("INSERT INTO item_stocks (item_id, location, qty, note) VALUES (?,?,?,?)",
                     (new_id, "", 0, ""))
    conn.commit()
    row = conn.execute("SELECT * FROM items WHERE id=?", (new_id,)).fetchone()
    full = _item_full(conn, row)
    conn.close()
    return full


@router.patch("/api/items/{item_id}")
def update_item(item_id: int, upd: ItemUpdate):
    """更新品項主檔欄位；stocks 有給則全量替換位置庫存（同位置去重）"""
    conn = get_db()
    row0 = conn.execute("SELECT id FROM items WHERE id=?", (item_id,)).fetchone()
    if not row0:
        conn.close()
        raise HTTPException(404, "品項不存在")
    data = upd.model_dump()
    # 主檔欄位（排除 qty/location/note/stocks —— 這些由位置庫存管理）
    fields = {k: v for k, v in data.items()
              if k not in ("qty", "location", "note", "stocks") and v is not None}
    if not fields and data.get("stocks") is None:
        conn.close()
        raise HTTPException(400, "沒有要更新的欄位")
    if fields:
        fields["updated_at"] = datetime.datetime.now().isoformat()
        sets = ", ".join(f"{k}=?" for k in fields)
        conn.execute(f"UPDATE items SET {sets} WHERE id=?", (*fields.values(), item_id))
    # stocks 全量替換（前端編輯直接送完整位置清單；同位置重複 → 最後一筆勝出）
    if data.get("stocks") is not None:
        # 依 location 去重（保留最後一筆）
        dedup = {}
        for s in data["stocks"]:
            dedup[s.get("location") or ""] = s
        conn.execute("DELETE FROM item_stocks WHERE item_id=?", (item_id,))
        for loc, s in dedup.items():
            conn.execute(
                "INSERT INTO item_stocks (item_id, location, qty, note) VALUES (?,?,?,?)",
                (item_id, loc, float(s.get("qty") or 0), s.get("note") or ""),
            )
    conn.commit()
    row = conn.execute("SELECT * FROM items WHERE id=?", (item_id,)).fetchone()
    full = _item_full(conn, row)
    conn.close()
    return full


@router.delete("/api/items/{item_id}")
def delete_item(item_id: int):
    """刪除品項（v10：手動 CASCADE——movements/stocktakes/kits/kit_items 的 FK 無
    ON DELETE CASCADE，foreign_keys=ON 下不先刪子表會 FOREIGN KEY 失敗）"""
    conn = get_db()
    row = conn.execute("SELECT * FROM items WHERE id=?", (item_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "品項不存在")
    # 依序刪子表（子→父），避免 FK 約束擋刪除
    conn.execute("DELETE FROM movements WHERE item_id=?", (item_id,))       # 異動流水
    conn.execute("DELETE FROM stocktakes WHERE item_id=?", (item_id,))      # 盤點紀錄
    conn.execute("DELETE FROM kit_items WHERE item_id=?", (item_id,))        # 當材料被引用
    kit = conn.execute("SELECT id FROM kits WHERE item_id=?", (item_id,)).fetchone()  # 本身是整組
    if kit:
        conn.execute("DELETE FROM kit_items WHERE kit_id=?", (kit["id"],))
        conn.execute("DELETE FROM kits WHERE id=?", (kit["id"],))
    conn.execute("DELETE FROM item_stocks WHERE item_id=?", (item_id,))     # 位置庫存
    conn.execute("DELETE FROM items WHERE id=?", (item_id,))
    conn.commit()
    conn.close()
    # 順帶刪照片檔（uploads/<id>.jpg）——不留孤兒檔
    from app.routes.photos import _photo_path
    try:
        p = _photo_path(item_id)
        if os.path.exists(p):
            os.remove(p)
    except OSError:
        pass
    return {"ok": True, "deleted": item_id}


# ============ 位置庫存 CRUD ============
@router.post("/api/items/{item_id}/stocks", status_code=201)
def add_stock(item_id: int, st: StockUpdate):
    """新增位置庫存（同位置重複 → 400 拒絕），回傳該品項全部位置清單"""
    conn = get_db()
    item = conn.execute("SELECT id FROM items WHERE id=?", (item_id,)).fetchone()
    if not item:
        conn.close()
        raise HTTPException(404, "品項不存在")
    location = st.location if st.location is not None else ""
    # UNIQUE(item_id, location)：同位置重複 → 拒絕
    dup = conn.execute(
        "SELECT id FROM item_stocks WHERE item_id=? AND location=?",
        (item_id, location),
    ).fetchone()
    if dup:
        conn.close()
        raise HTTPException(400, f"該品項在「{location}」已有庫存，請用編輯修改數量")
    qty = st.qty if st.qty is not None else 0
    conn.execute(
        "INSERT INTO item_stocks (item_id, location, qty, note) VALUES (?,?,?,?)",
        (item_id, location, qty, st.note or ""),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM item_stocks WHERE item_id=? ORDER BY id", (item_id,)).fetchall()
    conn.close()
    return [dict(r) for r in row]


@router.patch("/api/stocks/{stock_id}")
def update_stock(stock_id: int, st: StockUpdate):
    """修改位置庫存（數量/位置/備註）；改位置時檢查同品項內重複"""
    conn = get_db()
    fields = {k: v for k, v in st.model_dump().items() if v is not None}
    row = conn.execute("SELECT * FROM item_stocks WHERE id=?", (stock_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "位置庫存不存在")
    if "location" in fields and fields["location"] != row["location"]:
        dup = conn.execute(
            "SELECT id FROM item_stocks WHERE item_id=? AND location=? AND id!=?",
            (row["item_id"], fields["location"], stock_id),
        ).fetchone()
        if dup:
            conn.close()
            raise HTTPException(400, f"該位置「{fields['location']}」已存在")
    if fields:
        fields["updated_at"] = datetime.datetime.now().isoformat()
        sets = ", ".join(f"{k}=?" for k in fields)
        conn.execute(f"UPDATE item_stocks SET {sets} WHERE id=?", (*fields.values(), stock_id))
        conn.commit()
    conn.close()
    return {"ok": True}


@router.delete("/api/stocks/{stock_id}")
def delete_stock(stock_id: int):
    """刪除指定位置庫存"""
    conn = get_db()
    conn.execute("DELETE FROM item_stocks WHERE id=?", (stock_id,))
    conn.commit()
    conn.close()
    return {"ok": True}


@router.post("/api/items/{item_id}/adjust")
def adjust_qty(item_id: int, req: AdjustRequest):
    """加減庫存：正數=盤點補入、負數=扣減"""
    conn = get_db()
    item_row = conn.execute("SELECT * FROM items WHERE id=?", (item_id,)).fetchone()
    if not item_row:
        conn.close()
        raise HTTPException(404, "品項不存在")
    row = conn.execute("SELECT * FROM item_stocks WHERE item_id=? ORDER BY id", (item_id,)).fetchall()
    if not row:
        conn.close()
        raise HTTPException(404, "品項無庫存位置")
    total_before = sum(r["qty"] for r in row)
    # 負數調整：減少後庫存不得低於待領出數量（避免「可領數量」變負）
    if req.delta < 0:
        prepared = item_row["prepared_qty"] or 0
        if total_before + req.delta < prepared:
            conn.close()
            raise HTTPException(
                400,
                f"減少後庫存不能低於待領出數量！目前庫存 {total_before}、待領出 {prepared}，請先退回待領出",
            )
    # 第一筆位置作為調整標的（正數加入第一筆；負數從最後一筆往前扣）
    if req.delta >= 0:
        target = row[0]
        new_qty = target["qty"] + req.delta
        conn.execute("UPDATE item_stocks SET qty=?, updated_at=? WHERE id=?",
                     (new_qty, datetime.datetime.now().isoformat(), target["id"]))
        total_after = total_before + req.delta
    else:
        remaining = -req.delta
        total_after = total_before + req.delta
        for r in reversed(row):
            if remaining <= 0:
                break
            take = min(r["qty"], remaining)
            new_qty = r["qty"] - take
            conn.execute("UPDATE item_stocks SET qty=?, updated_at=? WHERE id=?",
                         (new_qty, datetime.datetime.now().isoformat(), r["id"]))
            remaining -= take
        if remaining > 0:
            conn.close()
            raise HTTPException(400, f"庫存不足！剩 {total_before}")
    conn.execute(
        "INSERT INTO movements (item_id, delta, before_qty, after_qty, reason, destination) VALUES (?,?,?,?,?,?)",
        (item_id, req.delta, total_before, total_after, req.reason, req.destination),
    )
    conn.commit()
    conn.close()
    return {"ok": True, "before": total_before, "after": total_after}


@router.post("/api/import")
def import_items(items: list):
    """批量匯入（v10：自動去重，重複則合併到既有主檔的庫存）"""
    conn = get_db()
    inserted = 0
    merged = 0
    for it in items:
        brand = it.get("brand", "")
        code = it.get("code", "")
        name = it.get("name", "")
        unit = it.get("unit", "個")
        site = it.get("site", "office")
        qty = it.get("qty", 0)
        location = it.get("location", "")
        note = it.get("note", "")
        exists = conn.execute(
            "SELECT id FROM items WHERE brand=? AND code=? AND name=? AND unit=? AND site=?",
            (brand, code, name, unit, site),
        ).fetchone()
        if exists:
            # 既有品項：同位置合併，不同位置新增一筆
            stock = conn.execute(
                "SELECT id FROM item_stocks WHERE item_id=? AND location=?",
                (exists["id"], location),
            ).fetchone()
            if stock:
                conn.execute("UPDATE item_stocks SET qty = qty + ?, note=? WHERE id=?",
                             (qty, note or it.get("note", ""), stock["id"]))
            else:
                conn.execute("INSERT INTO item_stocks (item_id, location, qty, note) VALUES (?,?,?,?)",
                             (exists["id"], location, qty, note))
            merged += 1
        else:
            cur = conn.execute(
                "INSERT INTO items (brand, code, name, unit, low_stock, site) VALUES (?,?,?,?,?,?)",
                (brand, code, name, unit, it.get("low_stock", 0), site),
            )
            conn.execute("INSERT INTO item_stocks (item_id, location, qty, note) VALUES (?,?,?,?)",
                         (cur.lastrowid, location, qty, note))
            inserted += 1
    conn.commit()
    conn.close()
    return {"ok": True, "inserted": inserted, "merged": merged}


@router.get("/api/movements")
def list_movements(limit: int = 50):
    """異動紀錄（含品項名稱/品牌），依 id 倒序回傳最近 limit 筆"""
    conn = get_db()
    rows = conn.execute(
        """SELECT m.*, i.name, i.brand FROM movements m
           JOIN items i ON i.id = m.item_id
           ORDER BY m.id DESC LIMIT ?""",
        (limit,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]