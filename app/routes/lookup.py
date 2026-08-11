# -*- coding: utf-8 -*-
"""
查詢路由（Todo 5 / v10.1）：相似品項提示 + 位置補全
====================================================
- GET /api/items/similar?name=&code=&site=&exclude_id=   相似品項查詢（新增時防重複建筆）
- GET /api/locations?site=                              既有位置名稱清單（新增/編輯時自動補全）

相似度規則（避免誤判）：
  1. code（型號）完全相等 → 一定回報（最強訊號：型號一模一樣幾乎就是同東西）
  2. 名稱去除符號後：完全相等、一方完整包含另一方、或相似度 ≥ 0.75 → 回報
  3. 短名稱（正規化後 < 3 字）不啟用名稱模糊 → 避免「銅管」誤配「銅管接頭組」
  回傳每筆含：id/name/brand/code/site/stocks（位置+數量）→ 前端可顯示「去編輯」
"""
import difflib
import re

from fastapi import APIRouter, HTTPException

from app.database import get_db

# 查詢 API 路由
router = APIRouter()


def _norm(s: str) -> str:
    """名稱正規化：去空白/括號/連字號、統一大小寫（比對用）"""
    return re.sub(r"[\s\(\)（）\[\]【】\-_]", "", (s or "")).lower()


def _name_similar(a: str, b: str) -> bool:
    """名稱相似判斷：正規化後相同、一方包含另一方、或相似度 ≥ 0.75"""
    na, nb = _norm(a), _norm(b)
    if not na or not nb:
        return False
    if na == nb:
        return True
    if len(na) < 3 or len(nb) < 3:
        return False  # 太短不啟用模糊，避免「銅管」誤配任何含銅管的品項
    if na in nb or nb in na:
        return True
    return difflib.SequenceMatcher(None, na, nb).ratio() >= 0.75


def _item_summary(conn, row) -> dict:
    """組出前端要的品項摘要（含全部位置與數量）"""
    stocks = conn.execute(
        "SELECT location, qty, note FROM item_stocks WHERE item_id=? ORDER BY id",
        (row["id"],)).fetchall()
    return {
        "id": row["id"],
        "brand": row["brand"],
        "code": row["code"],
        "name": row["name"],
        "unit": row["unit"],
        "site": row["site"],
        "total_qty": sum(s["qty"] for s in stocks),
        "stocks": [dict(s) for s in stocks],
    }


@router.get("/api/items/similar")
def find_similar(name: str = "", code: str = "", site: str = "all", exclude_id: int = 0):
    """找與輸入相近的既有品項（新增防呆用）。回傳 [] 表示無疑似重複"""
    if not name.strip() and not code.strip():
        raise HTTPException(400, "至少提供 name 或 code 其一")

    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM items WHERE is_kit=0 AND is_deleted=0 ORDER BY brand, name").fetchall()
    conn.close()

    hits = []
    for r in rows:
        if exclude_id and r["id"] == exclude_id:
            continue
        if site and site != "all" and r["site"] != site:
            continue
        code_hit = bool(code.strip()) and (r["code"] or "").strip() == code.strip()
        name_hit = bool(name.strip()) and _name_similar(name, r["name"])
        if code_hit or name_hit:
            hits.append(r)

    # 排序：code 相同者優先（最可能是同品項）
    hits.sort(key=lambda r: (
        0 if code.strip() and (r["code"] or "").strip() == code.strip() else 1,
    ))

    conn = get_db()
    try:
        return [_item_summary(conn, r) for r in hits[:5]]
    finally:
        conn.close()


@router.get("/api/locations")
def list_locations(site: str = "all"):
    """回傳既有位置名稱清單（新增品項時位置欄自動補全用）"""
    conn = get_db()
    sql = ("SELECT DISTINCT s.location FROM item_stocks s"
           " JOIN items i ON i.id = s.item_id")
    params = []
    if site and site != "all":
        sql += " WHERE i.site = ?"
        params.append(site)
    sql += " ORDER BY s.location COLLATE NOCASE"
    rows = conn.execute(sql, params).fetchall()
    conn.close()
    return [r["location"] for r in rows]