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

去重規則（v10 核心）：
  主檔以 (brand, code, name, unit, site) 為唯一鍵；
  新增時若已存在 → 400 提示，需改用「新增位置」加到既有品項。
"""
import datetime
import os
from typing import Optional

from fastapi import Depends, APIRouter, Body, HTTPException

from app.database import get_db
from app.models import AdjustRequest, BatchLocationRequest, ItemCreate, ItemUpdate, StockUpdate
from app.routes.photos import has_photo, list_photo_ids
from app.services.auth import require_perm

# 品項 API 路由
router = APIRouter()


def _item_full(conn, row, kit_map: Optional[dict] = None,
               stocks_map: Optional[dict] = None,
               photo_ids: Optional[set] = None) -> dict:
    """主檔 + 位置庫存 + 總量 組合成前端完整物件

    kit_map：{item_id: [整組名稱]} 預先查好的對應（list_items 一次查全部避免 N+1）；
    為 None 時單筆查詢（create/update 單筆呼叫用）。
    stocks_map：{item_id: [位置庫存 rows]} 預先查好的對應（list_items 批量查避免 N+1）；
    為 None 時單筆查詢（create/update 單筆呼叫用）。
    photo_ids：有照片的 item_id 集合（list_items 一次 listdir 快取，避免每筆 os.path.exists）；
    為 None 時逐筆 has_photo()（create/update 單筆呼叫用）。
    """
    d = dict(row)
    if stocks_map is not None:
        stocks = stocks_map.get(d["id"], [])
    else:
        stocks = conn.execute(
            "SELECT * FROM item_stocks WHERE item_id=? ORDER BY id", (d["id"],)).fetchall()
    d["stocks"] = [dict(s) for s in stocks]
    # 舊欄位相容（前端/匯出仍可用）
    d["qty"] = sum(s["qty"] for s in d["stocks"])
    d["total_qty"] = d["qty"]
    d["location"] = d["stocks"][0]["location"] if d["stocks"] else ""
    d["note"] = d["stocks"][0]["note"] if d["stocks"] else ""
    d["has_photo"] = d["id"] in photo_ids if photo_ids is not None else has_photo(d["id"])
    # 該品項屬於哪些整組（缺貨/低庫存清單標註用，2026-08-13 Sarah 需求）
    if kit_map is not None:
        d["in_kits"] = kit_map.get(d["id"], [])
    else:
        d["in_kits"] = [r["name"] for r in conn.execute(
            "SELECT DISTINCT k.name FROM kit_items ki JOIN kits k ON k.id = ki.kit_id "
            "WHERE ki.item_id = ? ORDER BY k.name", (d["id"],)).fetchall()]
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
             WHERE 1=1 AND i.is_deleted = 0"""
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
    # 一次查全部「品項 → 所屬整組名稱」對應（in_kits 欄位用，避免每筆 N+1）
    kit_map: dict = {}
    for r in conn.execute(
        "SELECT ki.item_id, k.name FROM kit_items ki JOIN kits k ON k.id = ki.kit_id "
        "JOIN items i ON i.id = k.item_id AND i.is_deleted = 0 ORDER BY k.name"
    ):
        kit_map.setdefault(r["item_id"], []).append(r["name"])
    # 2026-08-15 B1：一次查全部位置庫存 + 一次 listdir 照片，消除 per-item N+1/stat
    stocks_map: dict = {}
    if rows:
        ids = [r["id"] for r in rows]
        # v4 pro 審查 B2：SQLITE_MAX_VARIABLE_NUMBER 自 3.32 起為 32766（非 999），
        # 分批 500/組防「too many SQL variables」（item 數超過上限時 500）
        CHUNK = 500
        for i in range(0, len(ids), CHUNK):
            chunk = ids[i:i + CHUNK]
            placeholders = ",".join("?" * len(chunk))
            for s in conn.execute(
                f"SELECT * FROM item_stocks WHERE item_id IN ({placeholders}) ORDER BY item_id, id",
                chunk):
                stocks_map.setdefault(s["item_id"], []).append(s)
    photo_ids = list_photo_ids()  # 一次 listdir（OSError → 空集合，與 has_photo=False 語意一致）
    result = [_item_full(conn, r, kit_map, stocks_map, photo_ids) for r in rows]
    conn.close()
    return result


@router.post("/api/items", status_code=201, dependencies=[Depends(require_perm("item-mgmt"))])
def create_item(item: ItemCreate):
    """新增品項主檔 + 位置庫存（v10 去重：同鍵已存在則 400 拒絕）"""
    conn = get_db()
    try:
        # ===== v10 去重規則 =====
        exists = conn.execute(
            "SELECT id FROM items WHERE brand=? AND code=? AND name=? AND unit=? AND site=? AND is_deleted=0",
            (item.brand, item.code, item.name, item.unit, item.site),
        ).fetchone()
        if exists:
            raise HTTPException(400, f"該品項已存在（id={exists['id']}）！要放新位置請用「編輯」→「新增位置」")

        cur = conn.execute(
            "INSERT INTO items (brand, code, name, unit, low_stock, site, category) VALUES (?,?,?,?,?,?,?)",
            (item.brand, item.code, item.name, item.unit, item.low_stock, item.site, item.category),
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
        return full
    except Exception:
        conn.rollback()   # 2026-08-14 鎖洩漏根治：確保釋放 RESERVED 鎖
        raise
    finally:
        conn.close()      # 2026-08-14 防止中途炸掉 close 被跳過（bare-conn 洩漏主因）


@router.patch("/api/items/{item_id}", dependencies=[Depends(require_perm("item-mgmt"))])
def update_item(item_id: int, upd: ItemUpdate):
    try:
        """更新品項主檔欄位；stocks 有給則全量替換位置庫存（同位置去重）"""
        conn = get_db()
        row0 = conn.execute("SELECT id, updated_at FROM items WHERE id=? AND is_deleted=0", (item_id,)).fetchone()
        if not row0:
            raise HTTPException(404, "品項不存在")
        data = upd.model_dump()
        # 主檔欄位（排除 qty/location/note/stocks/updated_at —— qty/location/note 由位置庫存管理，
        # updated_at 是樂觀鎖快照值不可當 SET 欄位覆寫）
        fields = {k: v for k, v in data.items()
                  if k not in ("qty", "location", "note", "stocks", "updated_at") and v is not None}
        if not fields and data.get("stocks") is None:
            raise HTTPException(400, "沒有要更新的欄位")
        if fields:
            fields["updated_at"] = datetime.datetime.now().isoformat()
            sets = ", ".join(f"{k}=?" for k in fields)
            # 2026-08-14 樂觀鎖：前端帶 updated_at 快照 → 守衛 WHERE updated_at=？
            # 已被他人修改（快照過期）→ rowcount=0 → 409（不靜默覆蓋）
            if upd.updated_at:
                cur = conn.execute(f"UPDATE items SET {sets} WHERE id=? AND updated_at=?",
                                   (*fields.values(), item_id, upd.updated_at))
                if cur.rowcount == 0:
                    raise HTTPException(409, "該品項已被他人修改，請重新整理後再編輯")
            else:
                conn.execute(f"UPDATE items SET {sets} WHERE id=?", (*fields.values(), item_id))
        # stocks 全量同步（M1：同位置 UPDATE 保留 stock id；新增 INSERT、消失 DELETE；qty 變化寫流水）
        if data.get("stocks") is not None:
            dedup = {}
            for s in data["stocks"]:
                dedup[s.get("location") or ""] = s
            existing = {r["location"]: r for r in conn.execute(
                "SELECT * FROM item_stocks WHERE item_id=?", (item_id,)).fetchall()}
            for loc, s in dedup.items():
                new_qty = float(s.get("qty") or 0)
                if new_qty < 0:
                    raise HTTPException(400, f"位置「{loc}」的庫存數量不能為負數")
                if loc in existing:
                    old = existing[loc]
                    conn.execute("UPDATE item_stocks SET qty=?, note=?, updated_at=? WHERE id=?",
                                 (new_qty, s.get("note") or "", datetime.datetime.now().isoformat(), old["id"]))
                    if abs(new_qty - old["qty"]) > 1e-9:  # qty 變化才寫流水（浮點誤差不算）
                        conn.execute(
                            "INSERT INTO movements (item_id, delta, before_qty, after_qty, reason, destination) VALUES (?,?,?,?,?,?)",
                            (item_id, round(new_qty - old["qty"], 3), old["qty"], new_qty, "編輯品項調整", loc),
                        )
                else:
                    conn.execute("INSERT INTO item_stocks (item_id, location, qty, note) VALUES (?,?,?,?)",
                                 (item_id, loc, new_qty, s.get("note") or ""))
            for loc, old in existing.items():
                if loc not in dedup:
                    conn.execute("DELETE FROM item_stocks WHERE id=?", (old["id"],))
        conn.commit()
        row = conn.execute("SELECT * FROM items WHERE id=?", (item_id,)).fetchone()
        full = _item_full(conn, row)
        return full
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


@router.delete("/api/items/{item_id}", dependencies=[Depends(require_perm("item-mgmt"))])
def delete_item(item_id: int):
    """刪除品項（M6 soft-delete：保留 movements/stocktakes 稽核軌跡與 kit 引用，只標 is_deleted=1）"""
    conn = get_db()
    try:
        row = conn.execute("SELECT * FROM items WHERE id=? AND is_deleted=0", (item_id,)).fetchone()
        if not row:
            raise HTTPException(404, "品項不存在")
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
    try:
        p = _photo_path(item_id)
        if os.path.exists(p):
            os.remove(p)
    except OSError:
        pass
    return {"ok": True, "deleted": item_id}


# ============ 位置庫存 CRUD ============
@router.post("/api/items/{item_id}/stocks", status_code=201, dependencies=[Depends(require_perm("stock-mgmt"))])
def add_stock(item_id: int, st: StockUpdate):
    """新增位置庫存（同位置重複 → 400 拒絕），回傳該品項全部位置清單"""
    conn = get_db()
    try:
        item = conn.execute("SELECT id FROM items WHERE id=? AND is_deleted=0", (item_id,)).fetchone()
        if not item:
            raise HTTPException(404, "品項不存在")
        location = st.location if st.location is not None else ""
        # UNIQUE(item_id, location)：同位置重複 → 拒絕
        dup = conn.execute(
            "SELECT id FROM item_stocks WHERE item_id=? AND location=?",
            (item_id, location),
        ).fetchone()
        if dup:
            raise HTTPException(400, f"該品項在「{location}」已有庫存，請用編輯修改數量")
        qty = st.qty if st.qty is not None else 0
        conn.execute(
            "INSERT INTO item_stocks (item_id, location, qty, note) VALUES (?,?,?,?)",
            (item_id, location, qty, st.note or ""),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM item_stocks WHERE item_id=? ORDER BY id", (item_id,)).fetchall()
        return [dict(r) for r in row]
    except Exception:
        conn.rollback()   # 2026-08-14 鎖洩漏根治：確保釋放 RESERVED 鎖
        raise
    finally:
        conn.close()      # 2026-08-14 防止中途炸掉 close 被跳過（bare-conn 洩漏主因）


@router.patch("/api/stocks/{stock_id}", dependencies=[Depends(require_perm("stock-mgmt"))])
def update_stock(stock_id: int, st: StockUpdate):
    """修改位置庫存（數量/位置/備註）；改位置時檢查同品項內重複

    2026-08-14 併發修復：qty 改「相對差額」寫回（併發不互相覆蓋）+ 補 movements 流水
    （原本絕對值寫回且零流水）；負數調整以品項「總量」比對待領出（與 adjust_qty 語意一致）。
    """
    conn = get_db()
    try:
        fields = {k: v for k, v in st.model_dump().items() if v is not None}
        row = conn.execute("SELECT * FROM item_stocks WHERE id=?", (stock_id,)).fetchone()
        if not row:
            raise HTTPException(404, "位置庫存不存在")
        if "location" in fields and fields["location"] != row["location"]:
            dup = conn.execute(
                "SELECT id FROM item_stocks WHERE item_id=? AND location=? AND id!=?",
                (row["item_id"], fields["location"], stock_id),
            ).fetchone()
            if dup:
                raise HTTPException(400, f"該位置「{fields['location']}」已存在")
        # qty 差額處理（2026-08-14：併發 lost update 防護 + 補流水）
        if "qty" in fields:
            diff = round(fields["qty"] - row["qty"], 3)
            fields.pop("qty")  # qty 已抽離，避免下方動態 UPDATE 覆寫
            if abs(diff) > 1e-9:
                item_row = conn.execute("SELECT * FROM items WHERE id=?", (row["item_id"],)).fetchone()
                prepared = item_row["prepared_qty"] or 0
                if diff < 0:
                    # 總量語意：品項所有位置合計不得低於待領出（與 adjust_qty 一致）
                    total_before = conn.execute(
                        "SELECT COALESCE(SUM(qty),0) FROM item_stocks WHERE item_id=?",
                        (row["item_id"],)).fetchone()[0]
                    if total_before + diff < prepared:
                        raise HTTPException(400, f"減少後庫存不能低於待領出數量 {prepared}")
                now = datetime.datetime.now().isoformat()
                conn.execute(
                    "UPDATE item_stocks SET qty=qty+?, updated_at=? WHERE id=?",
                    (diff, now, stock_id),
                )
                conn.execute(
                    "INSERT INTO movements (item_id, delta, before_qty, after_qty, reason, destination) VALUES (?,?,?,?,?,?)",
                    (row["item_id"], diff, row["qty"], round(row["qty"] + diff, 3), "編輯位置調整", ""),
                )
        if fields:
            fields["updated_at"] = datetime.datetime.now().isoformat()
            sets = ", ".join(f"{k}=?" for k in fields)
            conn.execute(f"UPDATE item_stocks SET {sets} WHERE id=?", (*fields.values(), stock_id))
        conn.commit()
        return {"ok": True}
    except:
        conn.rollback()
        raise
    finally:
        conn.close()


@router.delete("/api/stocks/{stock_id}", dependencies=[Depends(require_perm("stock-mgmt"))])
def delete_stock(stock_id: int):
    """刪除指定位置庫存"""
    conn = get_db()
    try:
        cur = conn.execute("DELETE FROM item_stocks WHERE id=?", (stock_id,))
        conn.commit()
        if cur.rowcount == 0:
            raise HTTPException(404, "找不到該庫存位置")
        return {"ok": True}
    except Exception:
        conn.rollback()   # 2026-08-14 鎖洩漏根治：確保釋放 RESERVED 鎖
        raise
    finally:
        conn.close()      # 2026-08-14 防止中途炸掉 close 被跳過（bare-conn 洩漏主因）


@router.post("/api/items/{item_id}/adjust", dependencies=[Depends(require_perm("stock-mgmt"))])
def adjust_qty(item_id: int, req: AdjustRequest):
    """加減庫存：正數=盤點補入、負數=扣減"""
    conn = get_db()
    try:
        item_row = conn.execute("SELECT * FROM items WHERE id=? AND is_deleted=0", (item_id,)).fetchone()
        if not item_row:
            raise HTTPException(404, "品項不存在")
        row = conn.execute("SELECT * FROM item_stocks WHERE item_id=? ORDER BY id", (item_id,)).fetchall()
        if not row:
            raise HTTPException(404, "品項無庫存位置")
        total_before = sum(r["qty"] for r in row)
        # 負數調整：減少後庫存不得低於待領出數量（避免「可領數量」變負）
        if req.delta < 0:
            prepared = item_row["prepared_qty"] or 0
            if total_before + req.delta < prepared:
                raise HTTPException(
                    400,
                    f"減少後庫存不能低於待領出數量！目前庫存 {total_before}、待領出 {prepared}，請先退回待領出",
                )
        # 第一筆位置作為調整標的（正數加入第一筆；負數從最後一筆往前扣）
        if req.delta >= 0:
            target = row[0]
            conn.execute("UPDATE item_stocks SET qty=qty+?, updated_at=? WHERE id=?",
                         (req.delta, datetime.datetime.now().isoformat(), target["id"]))
        else:
            remaining = -req.delta
            for r in row:  # M10：統一從頭扣（與 stockout._deduct 一致）
                if remaining <= 0:
                    break
                take = min(r["qty"], remaining)
                cur = conn.execute("UPDATE item_stocks SET qty=qty-?, updated_at=? WHERE id=? AND qty>=?",
                                   (take, datetime.datetime.now().isoformat(), r["id"], take))
                if cur.rowcount == 0:  # H5：併發被扣走 → 保守拒絕
                    raise HTTPException(400, f"庫存不足！剩 {total_before}")
                remaining -= take
            if remaining > 0:
                raise HTTPException(400, f"庫存不足！剩 {total_before}")
        # 2026-08-14 P4-1：寫後重讀真實總量（併發下流水鏈 before+delta=after 恆成立）
        total_after = sum(r2["qty"] for r2 in conn.execute(
            "SELECT qty FROM item_stocks WHERE item_id=?", (item_id,)).fetchall())
        conn.execute(
            "INSERT INTO movements (item_id, delta, before_qty, after_qty, reason, destination) VALUES (?,?,?,?,?,?)",
            (item_id, req.delta, total_after - req.delta, total_after, req.reason, req.destination),
        )
        conn.commit()
        return {"ok": True, "before": total_after - req.delta, "after": total_after}
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


@router.post("/api/import", dependencies=[Depends(require_perm("import"))])
def import_items(items: list = Body(..., embed=True)):
    """批量匯入（v10：自動去重，重複則合併到既有主檔的庫存）"""
    conn = get_db()
    try:
        # M8：筆數上限（防一次塞爆）
        if len(items) > 500:
            raise HTTPException(400, "一次最多匯入 500 筆")
        # M8：逐筆驗證（型別/必填），任一筆錯誤 → 400 且整批不寫入（避免部分成功）
        for i, it in enumerate(items, 1):
            if not isinstance(it, dict):  # M8：非 dict（字串/數字）→ 400，不 500
                raise HTTPException(400, f"第 {i} 筆格式錯誤（需為 JSON 物件）")
            if not str(it.get("name", "")).strip():
                raise HTTPException(400, f"第 {i} 筆缺少品項名稱")
            try:
                qty_v = float(it.get("qty", 0))
                if qty_v < 0:  # 2026-08-12 補：負數入庫會造成負庫存（其他路徑都有 ge=0，import 獨漏）
                    raise HTTPException(400, f"第 {i} 筆數量不能為負數")
            except (TypeError, ValueError):
                raise HTTPException(400, f"第 {i} 筆數量「{it.get('qty')}」格式錯誤")
            try:
                low_v = float(it.get("low_stock", 0))
                if low_v < 0:
                    raise HTTPException(400, f"第 {i} 筆低庫存警示不能為負數")
            except (TypeError, ValueError):
                raise HTTPException(400, f"第 {i} 筆低庫存警示「{it.get('low_stock')}」格式錯誤")
        inserted = 0
        merged = 0
        for it in items:
            brand = it.get("brand", "")
            code = it.get("code", "")
            name = it.get("name", "")
            unit = it.get("unit", "個")
            site = it.get("site", "office")
            qty = float(it.get("qty", 0))
            location = it.get("location", "")
            note = it.get("note", "")
            exists = conn.execute(
                "SELECT id FROM items WHERE brand=? AND code=? AND name=? AND unit=? AND site=? AND is_deleted=0",
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
                    (brand, code, name, unit, float(it.get("low_stock", 0)), site),
                )
                conn.execute("INSERT INTO item_stocks (item_id, location, qty, note) VALUES (?,?,?,?)",
                             (cur.lastrowid, location, qty, note))
                inserted += 1
        conn.commit()
        return {"ok": True, "inserted": inserted, "merged": merged}
    except Exception:
        conn.rollback()   # 2026-08-14 鎖洩漏根治：確保釋放 RESERVED 鎖
        raise
    finally:
        conn.close()      # 2026-08-14 防止中途炸掉 close 被跳過（bare-conn 洩漏主因）


@router.post("/api/stocks/batch-location", dependencies=[Depends(require_perm("batch-loc-mgmt"))])
def batch_update_location(body: BatchLocationRequest):
    """批量更新多筆 stock 記錄的位置。"""
    conn = get_db()
    try:
        # 驗證所有 stock_ids 存在
        placeholders = ",".join("?" * len(body.stock_ids))
        rows = conn.execute(
            f"SELECT id, item_id, location FROM item_stocks WHERE id IN ({placeholders})",
            body.stock_ids
        ).fetchall()
        if len(rows) != len(body.stock_ids):
            found_ids = {r["id"] for r in rows}
            missing = [i for i in body.stock_ids if i not in found_ids]
            raise HTTPException(400, f"找不到 stock IDs: {missing}")

        # 檢查目標位置衝突（同一品項不能有兩筆相同位置）
        for row in rows:
            conflict = conn.execute(
                "SELECT id FROM item_stocks WHERE item_id=? AND location=? AND id!=?",
                (row["item_id"], body.new_location, row["id"])
            ).fetchone()
            if conflict:
                item = conn.execute("SELECT name FROM items WHERE id=?", (row["item_id"],)).fetchone()
                raise HTTPException(400, f"「{item['name']}」在「{body.new_location}」已有庫存記錄")

        # 批次更新
        conn.execute(
            f"UPDATE item_stocks SET location=?, updated_at=datetime('now') WHERE id IN ({placeholders})",
            [body.new_location] + body.stock_ids
        )
        conn.commit()
        return {"ok": True, "updated": len(body.stock_ids)}
    except HTTPException:
        raise
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
