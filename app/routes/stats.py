# -*- coding: utf-8 -*-
"""
統計路由
========
- GET /api/stats  統計（支援 site 分片篩選）
  - 缺貨（zero_stock）：只算單一材料（is_kit=0）
  - 低庫存（low_stock）：整組與單一都算
"""
from typing import Optional

from fastapi import APIRouter

from app.database import get_db

router = APIRouter()


@router.get("/api/stats")
def stats(site: Optional[str] = None):
    conn = get_db()
    where = ""
    params = ()
    if site and site != "all":
        where = " WHERE site = ?"
        params = (site,)
    total = conn.execute(f"SELECT COUNT(*) FROM items{where}", params).fetchone()[0]
    total_qty = conn.execute(f"SELECT COALESCE(SUM(qty),0) FROM items{where}", params).fetchone()[0]
    # 缺貨只統計單一材料；低庫存整組與單一都算
    zero_where = where + (" AND " if where else " WHERE ") + "is_kit = 0 AND qty <= 0"
    low_where = where + (" AND " if where else " WHERE ") + "qty <= low_stock AND low_stock > 0"
    low = conn.execute(f"SELECT COUNT(*) FROM items{low_where}", params).fetchone()[0]
    zero = conn.execute(f"SELECT COUNT(*) FROM items{zero_where}", params).fetchone()[0]
    brands = conn.execute(f"SELECT COUNT(DISTINCT brand) FROM items{where}", params).fetchone()[0]
    conn.close()
    return {"total_items": total, "total_qty": total_qty, "low_stock": low, "zero_stock": zero, "brands": brands}
