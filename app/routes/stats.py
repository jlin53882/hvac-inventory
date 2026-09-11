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
from app.services.auth import require_perm

router = APIRouter()


def _stats_for_site(conn, site: Optional[str] = None) -> dict:
    where = " WHERE is_deleted = 0"
    params = ()
    if site and site != "all":
        where += " AND site = ?"
        params = (site,)
    total = conn.execute(f"SELECT COUNT(*) FROM items{where}", params).fetchone()[0]
    total_qty = conn.execute(
        f"SELECT ROUND(COALESCE(SUM(s.qty),0),3) FROM item_stocks s JOIN items i ON i.id=s.item_id{where}",
        params,
    ).fetchone()[0]
    single_items = conn.execute(f"SELECT COUNT(*) FROM items{where} AND is_kit=0", params).fetchone()[0]
    kit_items = conn.execute(f"SELECT COUNT(*) FROM items{where} AND is_kit=1", params).fetchone()[0]
    brands = conn.execute(f"SELECT COUNT(DISTINCT brand) FROM items{where}", params).fetchone()[0]
    alert_where = " WHERE i.is_deleted=0 AND i.is_kit=0"
    alert_params = ()
    if site and site != "all":
        alert_where += " AND i.site=?"
        alert_params = (site,)
    alert_rows = conn.execute(
        "SELECT i.id, i.name, i.unit, i.low_stock, "
        "ROUND(COALESCE(SUM(s.qty),0),3) AS qty "
        "FROM items i LEFT JOIN item_stocks s ON s.item_id=i.id" + alert_where +
        " GROUP BY i.id "
        "HAVING qty <= 0 OR (i.low_stock > 0 AND qty <= i.low_stock) "
        "ORDER BY i.name COLLATE NOCASE, i.id",
        alert_params,
    ).fetchall()
    zero_items = [dict(row) for row in alert_rows if row["qty"] <= 0]
    low_items = [dict(row) for row in alert_rows if row["qty"] > 0]
    # KPI 與清單同源：alert_rows 為完整 dataset（無 LIMIT/分頁），計數直接取分類後集合長度；
    # 一般 low/out 互斥且排除整組（整組走 kit shortage/insufficient）。
    return {
        "total_items": total,
        "total_qty": total_qty,
        "low_stock": len(low_items),
        "zero_stock": len(zero_items),
        "brands": brands,
        "single_items": single_items,
        "kit_items": kit_items,
        "zero_items": zero_items,
        "low_items": low_items,
    }


@router.get("/api/stats/summary", dependencies=[Depends(require_perm("stats"))])
def stats_summary():
    """首頁統計一次回傳 all/office/warehouse，減少重複連線與 HTTP request。"""
    conn = get_db()
    try:
        return {
            "all": _stats_for_site(conn, "all"),
            "office": _stats_for_site(conn, "office"),
            "warehouse": _stats_for_site(conn, "warehouse"),
        }
    finally:
        conn.close()


@router.get("/api/stats", dependencies=[Depends(require_perm("stats"))])
def stats(site: Optional[str] = None):
    """統計總品項數/總庫存/低庫存/缺貨/品牌數（支援 site 分片篩選）。"""
    conn = get_db()
    try:
        return _stats_for_site(conn, site)
    finally:
        conn.close()
