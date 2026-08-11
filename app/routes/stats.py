# -*- coding: utf-8 -*-
"""
統計路由（v10 正規化）
======================
- GET /api/stats  統計（支援 site 分片篩選）
  - 缺貨（zero_stock）：只算單一材料（is_kit=0）
  - 低庫存（low_stock）：整組與單一都算
v10 語意：總庫存 = SUM(item_stocks.qty)
"""
from typing import Optional

from fastapi import APIRouter

from app.database import get_db

# 統計 API 路由
router = APIRouter()


@router.get("/api/stats")
def stats(site: Optional[str] = None):
    """統計總品項數/總庫存/低庫存/缺貨/品牌數（支援 site 分片篩選），回傳統計 dict"""
    conn = get_db()
    where = " WHERE is_deleted = 0"
    params = ()
    if site and site != "all":
        where += " AND site = ?"
        params = (site,)
    total = conn.execute(f"SELECT COUNT(*) FROM items{where}", params).fetchone()[0]
    total_qty = conn.execute(
        f"SELECT COALESCE(SUM(s.qty),0) FROM item_stocks s JOIN items i ON i.id=s.item_id{where}",
        params).fetchone()[0]
    # 缺貨只統計單一材料；低庫存整組與單一都算（以總量判斷）
    zero_cond = " AND " + "COALESCE((SELECT SUM(qty) FROM item_stocks WHERE item_id=items.id),0) <= 0 AND is_kit = 0"
    low_cond = " AND " + "COALESCE((SELECT SUM(qty) FROM item_stocks WHERE item_id=items.id),0) <= low_stock AND low_stock > 0"
    low_where = (where + low_cond) if where else (" WHERE 1=1" + low_cond)
    zero_where = (where + zero_cond) if where else (" WHERE 1=1" + zero_cond)
    low = conn.execute(f"SELECT COUNT(*) FROM items{low_where}", params).fetchone()[0]
    zero = conn.execute(f"SELECT COUNT(*) FROM items{zero_where}", params).fetchone()[0]
    brands = conn.execute(f"SELECT COUNT(DISTINCT brand) FROM items{where}", params).fetchone()[0]
    conn.close()
    return {"total_items": total, "total_qty": total_qty, "low_stock": low, "zero_stock": zero, "brands": brands}