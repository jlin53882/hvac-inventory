# -*- coding: utf-8 -*-
"""
統計路由（v10 正規化）
======================
- GET /api/stats          單一分片統計
- GET /api/stats/summary  一次取得 all/office/warehouse，供首頁啟動使用
"""
from typing import Optional

from fastapi import Depends, APIRouter

from app.database import get_db
from app.models import InventorySiteQuery
from app.services.auth import require_perm

router = APIRouter()


SUMMARY_SITES = ("all", "office", "warehouse", "van", "truck")


def _empty_stats() -> dict:
    return {"total_items": 0, "total_qty": 0, "low_stock": 0, "zero_stock": 0, "brands": 0,
            "single_items": 0, "kit_items": 0, "zero_items": [], "low_items": []}


def _stats_for_sites(conn, sites) -> dict:
    """一次計算多個分片統計（2026-09 效能：原本每分片 6 次查詢，改為固定 3 次 GROUP BY）。

    "all" 代表不篩 site；其餘為 items.site 精確比對。只查詢請求到的分片，
    回傳 {site: stats}，欄位與排序與舊版逐分片查詢完全一致。
    """
    result = {site: _empty_stats() for site in sites}
    need_all = "all" in result
    specific = [site for site in result if site != "all"]
    site_in = ",".join("?" * len(specific))

    def _union(all_sql: str, site_sql: str):
        """'all'（不分組）與指定 site（GROUP BY site）兩段查詢，依需要 UNION ALL。"""
        parts, params = [], []
        if need_all:
            parts.append(all_sql)
        if specific:
            parts.append(site_sql)
            params.extend(specific)
        return conn.execute(" UNION ALL ".join(parts), params).fetchall()

    counts = ("COUNT(*) AS total, COALESCE(SUM(is_kit=0),0) AS single, "
              "COALESCE(SUM(is_kit=1),0) AS kit, COUNT(DISTINCT brand) AS brands FROM items WHERE is_deleted = 0")
    for row in _union(
        f"SELECT 'all' AS k, {counts}",
        f"SELECT site AS k, {counts} AND site IN ({site_in}) GROUP BY site",
    ):
        result[row["k"]].update(total_items=row["total"], single_items=row["single"],
                                kit_items=row["kit"], brands=row["brands"])
    qty = ("ROUND(COALESCE(SUM(s.qty),0),3) AS q FROM item_stocks s "
           "JOIN items i ON i.id=s.item_id WHERE i.is_deleted = 0")
    for row in _union(
        f"SELECT 'all' AS k, {qty}",
        f"SELECT i.site AS k, {qty} AND i.site IN ({site_in}) GROUP BY i.site",
    ):
        result[row["k"]]["total_qty"] = row["q"]
    alert_filter = "" if need_all else f" AND i.site IN ({site_in})"
    alert_rows = conn.execute(
        "SELECT i.id, i.name, i.unit, i.low_stock, i.site, "
        "ROUND(COALESCE(SUM(s.qty),0),3) AS qty "
        "FROM items i LEFT JOIN item_stocks s ON s.item_id=i.id "
        "WHERE i.is_deleted=0 AND i.is_kit=0" + alert_filter +
        " GROUP BY i.id "
        "HAVING qty <= 0 OR (i.low_stock > 0 AND qty <= i.low_stock) "
        "ORDER BY i.name COLLATE NOCASE, i.id",
        () if need_all else specific,
    ).fetchall()
    for row in alert_rows:
        item = {"id": row["id"], "name": row["name"], "unit": row["unit"],
                "low_stock": row["low_stock"], "qty": row["qty"]}
        bucket = "zero_items" if row["qty"] <= 0 else "low_items"
        for site in ("all", row["site"]):
            if site in result:
                result[site][bucket].append(dict(item))
    # KPI 與清單同源：alert_rows 為完整 dataset（無 LIMIT/分頁），計數直接取分類後集合長度；
    # 一般 low/out 互斥且排除整組（整組走 kit shortage/insufficient）。
    for stats in result.values():
        stats["low_stock"] = len(stats["low_items"])
        stats["zero_stock"] = len(stats["zero_items"])
    return result


def _stats_for_site(conn, site: Optional[str] = None) -> dict:
    """單一分片統計（"all"/None = 全部）。"""
    key = site if site and site != "all" else "all"
    return _stats_for_sites(conn, (key,))[key]


@router.get("/api/stats/summary", dependencies=[Depends(require_perm("stats"))])
def stats_summary():
    """首頁統計一次回傳五個分片，減少重複連線與 HTTP request。"""
    conn = get_db()
    try:
        return _stats_for_sites(conn, SUMMARY_SITES)
    finally:
        conn.close()


@router.get("/api/stats", dependencies=[Depends(require_perm("stats"))])
def stats(site: Optional[InventorySiteQuery] = None):
    """統計總品項數/總庫存/低庫存/缺貨/品牌數（支援 site 分片篩選）。"""
    conn = get_db()
    try:
        return _stats_for_site(conn, site)
    finally:
        conn.close()
