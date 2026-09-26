# -*- coding: utf-8 -*-
"""
品項路由（v10 正規化）
=======================
- GET/POST    /api/items                    查詢/新增品項主檔（含位置庫存）
- POST        /api/items/{id}/stocks        新增位置
- PATCH       /api/stocks/{sid}             修改位置數量/備註
- DELETE      /api/stocks/{sid}             刪除位置
- POST        /api/stocks/{sid}/adjust      指定位置加減庫存
- POST        /api/items/{id}/adjust        加減庫存
- POST        /api/import                   從 JSON 匯入

去重規則（v10 核心）：
  主檔以 (brand, code, name, unit, site) 為唯一鍵；
  新增時若已存在 → 400 提示，需改用「新增位置」加到既有品項。
"""
import datetime
import math
import os
from typing import Optional

from fastapi import Depends, APIRouter, Body, HTTPException
from fastapi.responses import JSONResponse

from app.database import get_db
from app.models import (
    AdjustRequest,
    BatchLocationRequest,
    InventorySiteQuery,
    ItemCreate,
    ItemUpdate,
    INVENTORY_SITES,
    StockAdjustRequest,
    StockUpdate,
)
from app.routes.photos import has_photo, list_photo_ids
from app.services import movement_time
from app.services.auth import require_perm
from app.services.file_storage import delete_asset_files
from app.services.inventory_stock import assert_projected_inventory
from app.services.quantity import canonical_qty

# 品項 API 路由
router = APIRouter()
MAX_FILTER_VALUES = 400
MAX_PAGE = 1_000_000


def _item_full(conn, row, kit_map: Optional[dict] = None,
               stocks_map: Optional[dict] = None,
               photo_ids: Optional[set] = None,
               photo_map: Optional[dict] = None) -> dict:
    """主檔 + 位置庫存 + 總量組合成前端物件；列表查詢使用批次 map 避免 N+1。"""
    d = dict(row)
    if stocks_map is not None:
        stocks = stocks_map.get(d["id"], [])
    else:
        stocks = conn.execute(
            "SELECT * FROM item_stocks WHERE item_id=? ORDER BY id", (d["id"],)).fetchall()
    d["stocks"] = [dict(s) for s in stocks]
    d["qty"] = canonical_qty(sum(s["qty"] for s in d["stocks"]))
    d["total_qty"] = d["qty"]
    d["location"] = d["stocks"][0]["location"] if d["stocks"] else ""
    d["note"] = d["stocks"][0]["note"] if d["stocks"] else ""
    photo = photo_map.get(str(d["id"])) if photo_map is not None else None
    if photo_ids is not None or photo_map is not None:
        d["has_photo"] = (d["id"] in (photo_ids or set())) or photo is not None
    else:
        d["has_photo"] = has_photo(d["id"])
    if photo_map is not None:
        d["photo_asset_id"] = photo["asset_id"] if photo else None
        d["thumbnail_url"] = f"/media/{photo['asset_id']}/thumbnail" if photo and photo["thumbnail_path"] else None
        d["preview_url"] = f"/media/{photo['asset_id']}/preview" if photo and photo["preview_path"] else None
    if kit_map is not None:
        d["in_kits"] = kit_map.get(d["id"], [])
    else:
        d["in_kits"] = [r["name"] for r in conn.execute(
            "SELECT DISTINCT k.name FROM kit_items ki JOIN kits k ON k.id = ki.kit_id "
            "WHERE ki.item_id = ? ORDER BY k.name", (d["id"],)).fetchall()]
    return d


def _item_detail_maps(conn, ids: list[int]):
    """批次載入列表品項的庫存、組合關聯與媒體 metadata。"""
    unique_ids = list(dict.fromkeys(int(item_id) for item_id in ids))
    stocks_map: dict = {}
    photo_map: dict = {}
    kit_map: dict = {}
    if not unique_ids:
        return kit_map, stocks_map, set(), photo_map

    for start in range(0, len(unique_ids), 500):
        chunk = unique_ids[start:start + 500]
        placeholders = ",".join("?" * len(chunk))
        for stock in conn.execute(
            f"SELECT * FROM item_stocks WHERE item_id IN ({placeholders}) ORDER BY item_id, id",
            chunk,
        ):
            stocks_map.setdefault(stock["item_id"], []).append(stock)
        for relation in conn.execute(
            "SELECT ki.item_id, k.name FROM kit_items ki JOIN kits k ON k.id = ki.kit_id "
            "JOIN items i ON i.id = k.item_id AND i.is_deleted = 0 "
            f"WHERE ki.item_id IN ({placeholders}) ORDER BY k.name",
            chunk,
        ):
            kit_map.setdefault(relation["item_id"], []).append(relation["name"])
        for photo in conn.execute(
            "SELECT asset_id, owner_id, preview_path, thumbnail_path FROM file_assets "
            "WHERE category='item_photo' AND owner_type='item' AND owner_id IN (" + placeholders + ")",
            [str(item_id) for item_id in chunk],
        ):
            photo_map[photo["owner_id"]] = photo
    return kit_map, stocks_map, list_photo_ids(), photo_map


def _enrich_alert_items(conn, alert_rows) -> list[dict]:
    """將警示摘要補成可供共用清單與編輯 modal 使用的完整品項物件。"""
    ids = [row["id"] for row in alert_rows]
    if not ids:
        return []
    placeholders = ",".join("?" * len(ids))
    item_rows = conn.execute(
        f"SELECT * FROM items WHERE is_deleted=0 AND id IN ({placeholders})", ids
    ).fetchall()
    kit_map, stocks_map, photo_ids, photo_map = _item_detail_maps(conn, ids)
    full_by_id = {
        row["id"]: _item_full(conn, row, kit_map, stocks_map, photo_ids, photo_map)
        for row in item_rows
    }
    result = []
    for alert in alert_rows:
        item = full_by_id.get(alert["id"])
        if not item:
            continue
        item["qty"] = alert["qty"]
        item["total_qty"] = alert["qty"]
        item["location"] = alert["location"] or ""
        result.append(item)
    return result


def _inventory_page_stats(
    conn, from_sql: str, where_sql: str, params: list, include_alert_items: bool = False
) -> dict:
    """計算分頁列表對應的完整篩選統計，避免 KPI 只看到當頁資料。"""
    grouped_sql = (
        "SELECT i.id, i.name, i.brand, i.code, i.unit, i.low_stock, "
        "ROUND(COALESCE(SUM(s.qty), 0), 3) AS qty, GROUP_CONCAT(s.location, '、') AS location"
        + from_sql
        + where_sql
        + " GROUP BY i.id"
    )
    aggregate = conn.execute(
        "SELECT COUNT(*) AS item_count, "
        "COALESCE(SUM(qty), 0) AS total_qty, "
        "COALESCE(SUM(CASE WHEN qty <= 0 THEN 1 ELSE 0 END), 0) AS zero_stock, "
        "COALESCE(SUM(CASE WHEN qty > 0 AND low_stock > 0 AND qty <= low_stock "
        "THEN 1 ELSE 0 END), 0) AS low_stock "
        f"FROM ({grouped_sql}) AS filtered",
        params,
    ).fetchone()
    stats = {
        "item_count": aggregate["item_count"],
        "total_qty": aggregate["total_qty"],
        "low_stock": aggregate["low_stock"],
        "zero_stock": aggregate["zero_stock"],
    }
    if not include_alert_items:
        return stats

    alert_rows = conn.execute(
        "SELECT id, name, brand, code, unit, low_stock, qty, location "
        f"FROM ({grouped_sql}) AS filtered "
        "WHERE qty <= 0 OR (qty > 0 AND low_stock > 0 AND qty <= low_stock) "
        "ORDER BY name COLLATE NOCASE, id",
        params,
    ).fetchall()
    alert_items = _enrich_alert_items(conn, alert_rows)
    stats["zero_items"] = [item for item in alert_items if item["qty"] <= 0]
    stats["low_items"] = [item for item in alert_items if item["qty"] > 0]
    return stats


@router.get("/api/items")
def list_items(
    brand: Optional[str] = None,
    search: Optional[str] = None,
    location: Optional[str] = None,
    sort: str = "brand",
    site: Optional[InventorySiteQuery] = None,
    category: Optional[str] = None,
    categories: Optional[str] = None,
    brands: Optional[str] = None,
    page: Optional[int] = None,
    page_size: int = 50,
    include_alert_items: bool = False,
):
    """查詢品項；帶 page 時使用 server-side 分頁，未帶時維持舊 list shape。"""
    if page is not None and page < 1:
        raise HTTPException(400, "page 必須大於 0")
    if page is not None and page > MAX_PAGE:
        raise HTTPException(400, f"page 不可超過 {MAX_PAGE}")
    if page_size < 1 or page_size > 100:
        raise HTTPException(400, "page_size 必須在 1-100")
    conn = get_db()
    try:
        from_sql = " FROM items i LEFT JOIN item_stocks s ON s.item_id = i.id"
        where = ["i.is_deleted = 0"]
        params = []
        if page is not None:
            where.append("i.is_kit = 0")
        if site and site != "all":
            where.append("i.site = ?")
            params.append(site)
        selected_brands = [b.strip() for b in (brands or "").split(",") if b.strip()]
        if len(selected_brands) > MAX_FILTER_VALUES:
            raise HTTPException(400, f"brands 最多 {MAX_FILTER_VALUES} 個值")
        if selected_brands:
            brand_parts = []
            for selected in selected_brands:
                if selected == "無廠牌":
                    brand_parts.append("(i.brand IS NULL OR i.brand = '')")
                else:
                    brand_parts.append("i.brand = ?")
                    params.append(selected)
            where.append("(" + " OR ".join(brand_parts) + ")")
        elif brand and brand != "全部":
            where.append("i.brand = ?")
            params.append(brand)
        selected_categories = [c.strip() for c in (categories or "").split(",") if c.strip()]
        if len(selected_categories) > MAX_FILTER_VALUES:
            raise HTTPException(400, f"categories 最多 {MAX_FILTER_VALUES} 個值")
        if len(selected_brands) + len(selected_categories) > MAX_FILTER_VALUES:
            raise HTTPException(400, f"brands/categories 合計最多 {MAX_FILTER_VALUES} 個值")
        if selected_categories:
            placeholders = ",".join("?" * len(selected_categories))
            where.append("i.category IN (" + placeholders + ")")
            params.extend(selected_categories)
        elif category:
            where.append("i.category = ?")
            params.append(category)
        if location:
            where.append("EXISTS (SELECT 1 FROM item_stocks s2 WHERE s2.item_id=i.id AND s2.location = ?)")
            params.append(location)
        if search:
            like = f"%{search}%"
            where.append("""(i.name LIKE ? OR i.code LIKE ? OR i.brand LIKE ?
                           OR EXISTS (SELECT 1 FROM item_stocks s3 WHERE s3.item_id=i.id
                                      AND (s3.location LIKE ? OR s3.note LIKE ?)))""")
            params += [like, like, like, like, like]
        where_sql = " WHERE " + " AND ".join(where)
        sort_map = {
            "brand": "i.brand COLLATE NOCASE, i.name",
            "location": "MIN(s.location), i.name",
            "qty": "total_qty DESC",
            "created": "i.id DESC",
        }
        order_sql = sort_map.get(sort, sort_map["brand"])
        # P1-B：paged total 直接取 page_stats.item_count（省一次 COUNT）；
        # unpaged response 不用 total，完全不執行 COUNT
        page_stats = (_inventory_page_stats(conn, from_sql, where_sql, params, include_alert_items)
                      if page is not None else None)
        if page is not None:
            total = page_stats["item_count"]
        sql = "SELECT i.*, ROUND(COALESCE(SUM(s.qty),0),3) AS total_qty, COUNT(s.id) AS stock_count" + from_sql + where_sql
        sql += " GROUP BY i.id ORDER BY " + order_sql
        query_params = list(params)
        if page is not None:
            sql += " LIMIT ? OFFSET ?"
            query_params.extend([page_size, (page - 1) * page_size])
        rows = conn.execute(sql, query_params).fetchall()

        # P1-C：沿用既有 batch helper（只載本頁 ids，不掃全量 kit relation）
        ids = [r["id"] for r in rows]
        kit_map, stocks_map, photo_ids, photo_map = _item_detail_maps(conn, ids)
        result = [_item_full(conn, r, kit_map, stocks_map, photo_ids, photo_map) for r in rows]
        # 2026-09 效能：內容全是 SQLite 原生型別（str/int/float/None），直接 JSONResponse
        # 跳過 FastAPI jsonable_encoder（全量 3000 筆時 encoder 佔 ~130ms；輸出位元組相同）。
        if page is not None:
            return JSONResponse({"items": result, "total": total, "page": page, "page_size": page_size, "stats": page_stats})
        return JSONResponse(result)
    finally:
        conn.close()


@router.get("/api/items/facets")
def item_facets(site: Optional[InventorySiteQuery] = None):
    """回傳庫存篩選 facets，不需把完整品項清單送到瀏覽器。"""
    conn = get_db()
    try:
        where = " WHERE i.is_deleted=0 AND i.is_kit=0"
        params = []
        if site and site != "all":
            where += " AND i.site=?"
            params.append(site)
        brands = conn.execute(
            "SELECT COALESCE(NULLIF(i.brand,''),'無廠牌') AS name, COUNT(*) AS count "
            "FROM items i" + where + " GROUP BY COALESCE(NULLIF(i.brand,''),'無廠牌') ORDER BY name",
            params,
        ).fetchall()
        categories = conn.execute(
            "SELECT i.category AS name, COUNT(*) AS count FROM items i" + where +
            " AND COALESCE(i.category,'')<>'' GROUP BY i.category ORDER BY name",
            params,
        ).fetchall()
        locations = conn.execute(
            "SELECT DISTINCT s.location FROM item_stocks s JOIN items i ON i.id=s.item_id" +
            where.replace("i.is_deleted", "i.is_deleted") + " AND COALESCE(s.location,'')<>'' ORDER BY s.location",
            params,
        ).fetchall()
        return {
            "brands": {r["name"]: r["count"] for r in brands},
            "categories": {r["name"]: r["count"] for r in categories},
            "locations": [r["location"] for r in locations],
        }
    finally:
        conn.close()


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
                    (new_id, s.location, canonical_qty(s.qty), s.note),
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
        conn.execute("BEGIN IMMEDIATE")
        row0 = conn.execute("SELECT id, site, updated_at FROM items WHERE id=? AND is_deleted=0", (item_id,)).fetchone()
        if not row0:
            raise HTTPException(404, "品項不存在")
        data = upd.model_dump()
        # 主檔欄位（排除 qty/location/note/stocks/updated_at —— qty/location/note 由位置庫存管理，
        # updated_at 是樂觀鎖快照值不可當 SET 欄位覆寫）
        fields = {k: v for k, v in data.items()
                  if k not in ("qty", "location", "note", "stocks", "updated_at") and v is not None}
        if fields.get("site") is not None and fields["site"] != row0["site"]:
            raise HTTPException(400, "品項不能直接變更庫存區，請使用庫存調撥")
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
        # F2/F3：stocks 全量同步——使用 stock id 作為 identity（不再是 location）
        # payload stock 有 id → existing stock（id + stock_updated_at 樂觀鎖）
        # payload stock 無 id → new location
        # DB stock 不在 payload → 刪除（qty=0 才允許）
        # M1/M2/M3：stocks 全量同步——stock id = identity（無 location fallback）
        if data.get("stocks") is not None:
            movement_ts = movement_time.now_sql()
            existing = {
                row["id"]: row
                for row in conn.execute(
                    "SELECT * FROM item_stocks WHERE item_id=?",
                    (item_id,),
                ).fetchall()
            }

            payload_existing = {}
            payload_new = []

            for stock in data["stocks"]:
                stock_id = stock.get("id")

                # new stock
                if stock_id is None:
                    payload_new.append(stock)
                    continue

                # existing stock id must belong to this item
                if stock_id not in existing:
                    raise HTTPException(409, "庫存位置已異動，請重新整理後再編輯")

                revision = stock.get("stock_updated_at")
                if not revision:
                    raise HTTPException(409, "庫存資料版本已過期，請重新整理後再編輯")

                current = existing[stock_id]
                if not current["updated_at"] or revision != current["updated_at"]:
                    raise HTTPException(
                        409, f"位置「{current['location']}」已被其他操作修改，請重新整理後再編輯")

                payload_existing[stock_id] = stock

            # M2：final location uniqueness
            def _payload_location(s):
                return s.get("location") or ""

            final_locations = [_payload_location(s) for s in payload_existing.values()]
            final_locations.extend(_payload_location(s) for s in payload_new)
            if len(final_locations) != len(set(final_locations)):
                raise HTTPException(400, "同一品項不可有重複庫存位置")

            # projected total >= prepared
            projected_total = canonical_qty(
                sum(canonical_qty(s.get("qty") or 0) for s in payload_existing.values()) +
                sum(canonical_qty(s.get("qty") or 0) for s in payload_new))
            prepared_now = canonical_qty(conn.execute(
                "SELECT prepared_qty FROM items WHERE id=?", (item_id,)).fetchone()["prepared_qty"] or 0)
            if projected_total < prepared_now:
                raise HTTPException(
                    400, f"更新後總庫存 {projected_total} 將低於待領出數量 {prepared_now}")

            now = datetime.datetime.now().isoformat()

            # Phase A — 暫時搬離有 location 變動的 existing stock（避免逐筆 UPDATE 撞 UNIQUE）
            import uuid
            tmp_locs = {}  # stock_id -> temporary location
            for stock_id, stock in payload_existing.items():
                old = existing[stock_id]
                new_loc = stock.get("location") or ""
                if new_loc != (old["location"] or ""):
                    tmp = f"__tmp_stock_edit__{stock_id}_{uuid.uuid4().hex}"
                    tmp_locs[stock_id] = tmp
                    conn.execute(
                        "UPDATE item_stocks SET location=?, updated_at=? WHERE id=? AND item_id=?",
                        (tmp, now, stock_id, item_id))

            # remove omitted stocks
            payload_ids = set(payload_existing)
            for stock_id, old in existing.items():
                if stock_id in payload_ids:
                    continue
                if canonical_qty(old["qty"]) != 0:
                    raise HTTPException(
                        400, f"位置「{old['location']}」仍有庫存 {old['qty']}，請先將數量調整為 0 再移除")
                conn.execute("DELETE FROM item_stocks WHERE id=? AND item_id=?", (stock_id, item_id))

            # Phase B — 正式寫入 final location + qty + note
            for stock_id, stock in payload_existing.items():
                old = existing[stock_id]
                new_qty = canonical_qty(stock.get("qty") or 0)
                new_location = stock.get("location") or ""
                new_note = stock.get("note") if stock.get("note") is not None else old["note"]
                conn.execute(
                    "UPDATE item_stocks SET qty=?, location=?, note=?, updated_at=? WHERE id=? AND item_id=?",
                    (new_qty, new_location, new_note, now, stock_id, item_id))
                delta = canonical_qty(new_qty - old["qty"])
                if delta != 0:
                    conn.execute(
                        "INSERT INTO movements (item_id, delta, before_qty, after_qty, reason, destination, created_at) VALUES (?,?,?,?,?,?,?)",
                        (item_id, delta, old["qty"], new_qty, "編輯品項調整", new_location, movement_ts))

            # insert new
            for stock in payload_new:
                new_qty = canonical_qty(stock.get("qty") or 0)
                new_location = stock.get("location") or ""
                new_note = stock.get("note") or ""
                conn.execute(
                    "INSERT INTO item_stocks (item_id, location, qty, note, updated_at) VALUES (?,?,?,?,?)",
                    (item_id, new_location, new_qty, new_note, now))
                if new_qty > 0:
                    conn.execute(
                        "INSERT INTO movements (item_id, delta, before_qty, after_qty, reason, destination, created_at) VALUES (?,?,?,?,?,?,?)",
                        (item_id, new_qty, 0, new_qty, "編輯品項調整", new_location, movement_ts))
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
    photo_assets = []
    try:
        conn.execute("BEGIN IMMEDIATE")
        movement_ts = movement_time.now_sql()
        row = conn.execute("SELECT * FROM items WHERE id=? AND is_deleted=0", (item_id,)).fetchone()
        if not row:
            raise HTTPException(404, "品項不存在")
        # 安全檢查：有待領出數量時不可刪除
        prepared = canonical_qty(row["prepared_qty"] or 0)
        if prepared > 0:
            raise HTTPException(400, f"該品項有待領出數量 {prepared}，請先處理待領出再刪除")
        # 檢查是否還有庫存，有庫存則記錄稽核流水後清零
        stocks = conn.execute(
            "SELECT id, location, qty FROM item_stocks WHERE item_id=? AND qty != 0",
            (item_id,)).fetchall()
        for s in stocks:
            if s["qty"] > 0:
                # 寫入「品項刪除清零」流水，保留稽核軌跡
                conn.execute(
                    "INSERT INTO movements (item_id, delta, before_qty, after_qty, reason, destination, created_at) VALUES (?,?,?,?,?,?,?)",
                    (item_id, -s["qty"], s["qty"], 0, "品項刪除清零", s["location"] or "", movement_ts))
        if stocks:
            # P0-B：movement 說 qty → 0，persisted stock 必須真歸零（同一 transaction）
            conn.execute("UPDATE item_stocks SET qty=0, updated_at=? WHERE item_id=?",
                         (datetime.datetime.now().isoformat(), item_id))
        conn.execute("UPDATE items SET is_deleted=1, updated_at=? WHERE id=?",
                     (datetime.datetime.now().isoformat(), item_id))
        photo_assets = conn.execute(
            "SELECT * FROM file_assets WHERE category=? AND owner_type=? AND owner_id=?",
            ("item_photo", "item", str(item_id)),
        ).fetchall()
        conn.execute(
            "DELETE FROM file_assets WHERE category=? AND owner_type=? AND owner_id=?",
            ("item_photo", "item", str(item_id)),
        )
        conn.commit()
    except Exception:
        conn.rollback()   # 2026-08-14 鎖洩漏根治：確保釋放 RESERVED 鎖
        raise
    finally:
        conn.close()      # 2026-08-14 防止中途炸掉 close 被跳過（bare-conn 洩漏主因）
    # commit 成功後再刪除 original/preview/thumbnail，避免 rollback 留下 metadata 與檔案不一致。
    for asset in photo_assets:
        delete_asset_files(asset)
    # 舊版本沒有 metadata，仍清理 legacy preview。
    from app.routes.photos import _photo_path, invalidate_photo_ids_cache
    try:
        p = _photo_path(item_id)
        if os.path.exists(p):
            os.remove(p)
    except OSError:
        pass
    invalidate_photo_ids_cache()
    return {"ok": True, "deleted": item_id}


# ============ 位置庫存 CRUD ============
@router.post("/api/items/{item_id}/stocks", status_code=201, dependencies=[Depends(require_perm("stock-mgmt"))])
def add_stock(item_id: int, st: StockUpdate):
    """新增位置庫存（同位置重複 → 400 拒絕），回傳該品項全部位置清單"""
    conn = get_db()
    try:
        conn.execute("BEGIN IMMEDIATE")
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
        qty = canonical_qty(st.qty if st.qty is not None else 0)
        conn.execute(
            "INSERT INTO item_stocks (item_id, location, qty, note) VALUES (?,?,?,?)",
            (item_id, location, qty, st.note or ""),
        )
        if qty > 0:
            # P1-A：新位置 qty > 0 不可憑空出現，補 audit 流水
            conn.execute(
                "INSERT INTO movements (item_id, delta, before_qty, after_qty, reason, destination, created_at) VALUES (?,?,?,?,?,?,?)",
                (item_id, qty, 0, qty, "編輯品項調整", location, movement_time.now_sql()),
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
        conn.execute("BEGIN IMMEDIATE")
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
            target_qty = canonical_qty(fields["qty"])
            diff = canonical_qty(target_qty - canonical_qty(row["qty"]))
            fields.pop("qty")  # qty 已抽離，避免下方動態 UPDATE 覆寫
            if diff != 0:
                # P0-C：整個 item 的 new total 不得低於 prepared（同一 writer transaction 內驗證）
                assert_projected_inventory(conn, row["item_id"], stock_delta=diff)
                now = datetime.datetime.now().isoformat()
                conn.execute(
                    "UPDATE item_stocks SET qty=ROUND(qty+?,3), updated_at=? WHERE id=?",
                    (diff, now, stock_id),
                )
                conn.execute(
                    "INSERT INTO movements (item_id, delta, before_qty, after_qty, reason, destination, created_at) VALUES (?,?,?,?,?,?,?)",
                    (row["item_id"], diff, row["qty"], canonical_qty(row["qty"] + diff), "編輯位置調整", "", movement_time.now_sql()),
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
    """刪除指定位置庫存（P0-A：非 0 數量拒絕，避免總庫存無流水消失）"""
    conn = get_db()
    try:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute("SELECT * FROM item_stocks WHERE id=?", (stock_id,)).fetchone()
        if not row:
            raise HTTPException(404, "找不到該庫存位置")
        if canonical_qty(row["qty"]) != 0:
            raise HTTPException(400, f"此位置仍有庫存 {row['qty']}，請先將數量調整為 0 再刪除位置")
        conn.execute("DELETE FROM item_stocks WHERE id=?", (stock_id,))
        conn.commit()
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
        conn.execute("BEGIN IMMEDIATE")
        item_row = conn.execute("SELECT * FROM items WHERE id=? AND is_deleted=0", (item_id,)).fetchone()
        if not item_row:
            raise HTTPException(404, "品項不存在")
        row = conn.execute("SELECT * FROM item_stocks WHERE item_id=? ORDER BY id", (item_id,)).fetchall()
        if not row:
            raise HTTPException(404, "品項無庫存位置")
        delta = canonical_qty(req.delta)
        if delta == 0:
            raise HTTPException(400, "調整數量正規化後不可為 0")
        total_before = canonical_qty(sum(r["qty"] for r in row))
        # P0-C：最終 committed state 必須滿足 total >= prepared（同一 writer transaction 內驗證）
        assert_projected_inventory(conn, item_id, stock_delta=delta)
        # 第一筆位置作為調整標的（正數加入第一筆；負數從第一筆往後扣）
        if delta > 0:
            target = row[0]
            conn.execute("UPDATE item_stocks SET qty=ROUND(qty+?,3), updated_at=? WHERE id=?",
                         (delta, datetime.datetime.now().isoformat(), target["id"]))
        else:
            remaining = canonical_qty(-delta)
            for r in row:  # M10：統一從頭扣（與 stockout._deduct 一致）
                if remaining <= 0:
                    break
                take = canonical_qty(min(r["qty"], remaining))
                cur = conn.execute("UPDATE item_stocks SET qty=ROUND(qty-?,3), updated_at=? WHERE id=? AND qty>=?",
                                   (take, datetime.datetime.now().isoformat(), r["id"], take))
                if cur.rowcount == 0:  # H5：併發被扣走 → 保守拒絕
                    raise HTTPException(400, f"庫存不足！剩 {total_before}")
                remaining = canonical_qty(remaining - take)
            if remaining > 0:
                raise HTTPException(400, f"庫存不足！剩 {total_before}")
        # 寫後重讀真實總量；movement 使用 canonical request 與真正 write 前後狀態。
        total_after = canonical_qty(sum(r2["qty"] for r2 in conn.execute(
            "SELECT qty FROM item_stocks WHERE item_id=?", (item_id,)).fetchall()))
        conn.execute(
            "INSERT INTO movements (item_id, delta, before_qty, after_qty, reason, destination, created_at) VALUES (?,?,?,?,?,?,?)",
            (item_id, delta, total_before, total_after, req.reason, req.destination, movement_time.now_sql()),
        )
        conn.commit()
        return {"ok": True, "before": total_before, "after": total_after}
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


@router.post("/api/stocks/{stock_id}/adjust", dependencies=[Depends(require_perm("stock-mgmt"))])
def adjust_stock_qty(stock_id: int, req: StockAdjustRequest) -> dict:
    """Adjust one location inside a writer transaction and record its destination.

    Args:
        stock_id: Persisted stock-location identifier selected by the user.
        req: Signed quantity delta and movement reason.

    Returns:
        The selected stock's updated quantity and aggregate before/after totals.

    Raises:
        HTTPException: If the location is missing, the delta is invalid, or stock invariants fail.
    """
    conn = get_db()
    try:
        conn.execute("BEGIN IMMEDIATE")
        stock = conn.execute(
            "SELECT s.id, s.item_id, s.location, s.qty FROM item_stocks s "
            "JOIN items i ON i.id=s.item_id WHERE s.id=? AND i.is_deleted=0",
            (stock_id,),
        ).fetchone()
        if not stock:
            raise HTTPException(404, "找不到該庫存位置")
        if not math.isfinite(req.delta):
            raise HTTPException(400, "調整數量必須是有限數值")
        delta = canonical_qty(req.delta)
        if delta == 0:
            raise HTTPException(400, "調整數量正規化後不可為 0")
        stock_before = canonical_qty(stock["qty"])
        if canonical_qty(stock_before + delta) < 0:
            raise HTTPException(400, f"此位置庫存不足！剩 {stock_before}")

        item_id = stock["item_id"]
        before = canonical_qty(sum(row["qty"] for row in conn.execute(
            "SELECT qty FROM item_stocks WHERE item_id=?", (item_id,)).fetchall()))
        assert_projected_inventory(conn, item_id, stock_delta=delta)
        updated_at = datetime.datetime.now().isoformat()
        if delta < 0:
            cursor = conn.execute(
                "UPDATE item_stocks SET qty=ROUND(qty+?,3), updated_at=? WHERE id=? AND qty>=?",
                (delta, updated_at, stock_id, canonical_qty(-delta)),
            )
        else:
            cursor = conn.execute(
                "UPDATE item_stocks SET qty=ROUND(qty+?,3), updated_at=? WHERE id=?",
                (delta, updated_at, stock_id),
            )
        if cursor.rowcount != 1:
            raise HTTPException(400, "此位置庫存已變更，請重新載入後再試")

        after = canonical_qty(sum(row["qty"] for row in conn.execute(
            "SELECT qty FROM item_stocks WHERE item_id=?", (item_id,)).fetchall()))
        conn.execute(
            "INSERT INTO movements (item_id, delta, before_qty, after_qty, reason, destination, created_at) "
            "VALUES (?,?,?,?,?,?,?)",
            (item_id, delta, before, after, req.reason, stock["location"], movement_time.now_sql()),
        )
        conn.commit()
        return {
            "ok": True,
            "stock_id": stock_id,
            "stock_qty": canonical_qty(stock_before + delta),
            "before": before,
            "after": after,
        }
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
            site = it.get("site", "office")
            if site not in INVENTORY_SITES:
                raise HTTPException(400, f"第 {i} 筆庫存區無效：{site}")
            try:
                qty_v = canonical_qty(it.get("qty", 0))
                if qty_v < 0:  # 2026-08-12 補：負數入庫會造成負庫存（其他路徑都有 ge=0，import 獨漏）
                    raise HTTPException(400, f"第 {i} 筆數量不能為負數")
            except HTTPException:
                raise
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
            qty = canonical_qty(it.get("qty", 0))
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
                    conn.execute("UPDATE item_stocks SET qty = ROUND(qty + ?,3), note=?, updated_at=? WHERE id=?",
                                 (qty, note or it.get("note", ""), datetime.datetime.now().isoformat(), stock["id"]))
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

        # new_site 僅保留向後相容驗證；跨 site 必須使用正式 transfer API。
        if body.new_site:
            item_ids = list({row["item_id"] for row in rows})
            item_placeholders = ",".join("?" * len(item_ids))
            item_sites = {
                item["site"] for item in conn.execute(
                    "SELECT DISTINCT site FROM items WHERE id IN (" + item_placeholders + ") AND is_deleted=0",
                    item_ids,
                ).fetchall()
            }
            if any(site != body.new_site for site in item_sites):
                raise HTTPException(400, "品項不能直接變更庫存區，請使用庫存調撥")

        # 批次更新位置；此 API 永遠不修改 items.site。
        now = datetime.datetime.now().isoformat()
        conn.execute(
            f"UPDATE item_stocks SET location=?, updated_at=? WHERE id IN ({placeholders})",
            [body.new_location, now] + body.stock_ids
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
