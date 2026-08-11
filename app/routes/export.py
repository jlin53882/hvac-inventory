# -*- coding: utf-8 -*-
"""
匯出路由：Excel 報表（記憶體回傳版）
================================
- GET /api/export?days=30  匯出 3 個 Sheet（庫存明細 / 異動紀錄 / 廠牌統計）
- 改版重點：BytesIO 記憶體回傳，不寫磁碟 → exports/ 零檔案累積、無撞名
- 安全：公式注入防護（= + - @ 開頭的字串加撇號）
"""
import datetime
import io
from urllib.parse import quote

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from app.database import get_db

router = APIRouter()
HEADER_FILL = "2E5C8A"
MAX_DAYS = 366


def _safe(value):
    """公式注入防護：= + - @ 開頭的字串加撇號，避免被 Excel 當公式執行"""
    if isinstance(value, str) and value.startswith(("=", "+", "-", "@")):
        return "'" + value
    return value


def _style_header(ws):
    from openpyxl.styles import Alignment, Font, PatternFill

    for cell in ws[1]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor=HEADER_FILL)
        cell.alignment = Alignment(horizontal="center")
    ws.freeze_panes = "A2"


def _set_widths(ws, widths):
    import openpyxl.utils

    for i, w in enumerate(widths, 1):
        ws.column_dimensions[openpyxl.utils.get_column_letter(i)].width = w


@router.get("/api/export")
def export_excel(days: int = 30):
    """匯出完整庫存 Excel（記憶體回傳，伺服器不留檔案）"""
    try:
        import openpyxl
    except ImportError:
        raise HTTPException(500, "缺少 openpyxl，請先安裝")

    # clamp 防呆：負數 / 過大會讓 SQLite datetime() 解析異常（空 sheet 甚至 500）
    days = max(0, min(days, MAX_DAYS))

    wb = openpyxl.Workbook()
    conn = get_db()
    try:
        # Sheet 1: 庫存明細（單一 JOIN 消除 N+1；每列 = 主檔 × 每位置一行）
        ws = wb.active
        ws.title = "庫存明細"
        ws.append(["編號", "廠牌", "品項名稱", "型號", "單位", "位置", "位置數量", "位置備註", "總數量"])
        _style_header(ws)
        rows = conn.execute("""
            SELECT i.id, i.brand, i.name, i.code, i.unit,
                   s.location, s.qty, s.note,
                   COALESCE(SUM(s.qty) OVER (PARTITION BY i.id), 0) AS total
            FROM items i
            LEFT JOIN item_stocks s ON s.item_id = i.id
            ORDER BY i.brand COLLATE NOCASE, i.name, s.id
        """).fetchall()
        for r in rows:
            ws.append([r["id"], _safe(r["brand"]), _safe(r["name"]), _safe(r["code"]),
                       r["unit"], _safe(r["location"]), r["qty"], _safe(r["note"]), r["total"]])
        _set_widths(ws, [8, 14, 40, 16, 8, 30, 10, 24, 10])

        # Sheet 2: 異動紀錄（days 控制範圍，取代寫死的 LIMIT 500）
        ws2 = wb.create_sheet("異動紀錄")
        ws2.append(["時間", "品項", "變動", "原本", "現在", "去向", "原因"])
        _style_header(ws2)
        movs = conn.execute("""
            SELECT m.created_at, i.name, m.delta, m.before_qty, m.after_qty,
                   m.destination, m.reason
            FROM movements m JOIN items i ON i.id = m.item_id
            WHERE m.created_at >= datetime('now', ?)
            ORDER BY m.id DESC
        """, (f"-{days} days",)).fetchall()
        for m in movs:
            ws2.append([_safe(x) for x in m])
        _set_widths(ws2, [20, 30, 10, 10, 10, 16, 30])

        # Sheet 3: 廠牌統計
        ws3 = wb.create_sheet("廠牌統計")
        ws3.append(["廠牌", "品項數", "總庫存"])
        _style_header(ws3)
        stats = conn.execute("""
            SELECT i.brand, COUNT(DISTINCT i.id), COALESCE(SUM(s.qty), 0)
            FROM items i LEFT JOIN item_stocks s ON s.item_id = i.id
            GROUP BY i.brand ORDER BY COUNT(DISTINCT i.id) DESC
        """).fetchall()
        for s in stats:
            ws3.append(list(s))
        _set_widths(ws3, [14, 10, 10])
    finally:
        conn.close()

    # 記憶體回傳：不寫磁碟、伺服器不留檔案（Content-Disposition 需 RFC 5987 編碼，
    # 直接塞中文檔名會 UnicodeEncodeError 500 —— 見 2026-08-11 實測）
    ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"庫存報表_{ts}.xlsx"
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return Response(
        buf.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"},
    )