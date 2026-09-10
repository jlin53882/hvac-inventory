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
        f"SELECT COALESCE(SUM(s.qty),0) FROM item_stocks s JOIN items i ON i.id=s.item_id{where}",
        params,
    ).fetchone()[0]
    single_items = conn.execute(f"SELECT COUNT(*) FROM items{where} AND is_kit=0", params).fetchone()[0]
    kit_items = conn.execute(f"SELECT COUNT(*) FROM items{where} AND is_kit=1", params).fetchone()[0]
    zero_where = where + " AND COALESCE((SELECT SUM(qty) FROM item_stocks WHERE item_id=items.id),0) <= 0 AND is_kit=0"
    low_where = where + " AND COALESCE((SELECT SUM(qty) FROM item_stocks WHERE item_id=items.id),0) <= low_stock AND low_stock > 0"
    low = conn.execute(f"SELECT COUNT(*) FROM items{low_where}", params).fetchone()[0]
    zero = conn.execute(f"SELECT COUNT(*) FROM items{zero_where}", params).fetchone()[0]
    brands = conn.execute(f"SELECT COUNT(DISTINCT brand) FROM items{where}", params).fetchone()[0]
    return {
        "total_items": total,
        "total_qty": total_qty,
        "low_stock": low,
        "zero_stock": zero,
        "brands": brands,
        "single_items": single_items,
        "kit_items": kit_items,
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
