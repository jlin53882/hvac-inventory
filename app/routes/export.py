# -*- coding: utf-8 -*-
"""
匯出路由：Excel 報表
====================
- GET /api/export  匯出完整庫存 Excel（3 個 Sheet：庫存明細 / 異動紀錄 / 廠牌統計）
"""
import datetime
import os

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app.config import EXPORT_DIR
from app.database import get_db

router = APIRouter()


@router.get("/api/export")
def export_excel():
    """匯出完整庫存 Excel"""
    try:
        import openpyxl
        from openpyxl.styles import Font, PatternFill, Alignment
    except ImportError:
        raise HTTPException(500, "缺少 openpyxl，請先安裝")

    conn = get_db()
    rows = conn.execute("SELECT * FROM items ORDER BY brand COLLATE NOCASE, name").fetchall()
    conn.close()

    wb = openpyxl.Workbook()

    # Sheet 1: 庫存明細
    ws = wb.active
    ws.title = "庫存明細"
    headers = ["編號", "廠牌", "品項名稱", "數量", "單位", "位置", "備註"]
    ws.append(headers)
    header_fill = PatternFill("solid", fgColor="2E5C8A")
    for cell in ws[1]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center")
    for r in rows:
        ws.append([r["id"], r["brand"], r["name"], r["qty"], r["unit"], r["location"], r["note"]])
    widths = [8, 14, 40, 10, 8, 30, 20]
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[openpyxl.utils.get_column_letter(i)].width = w

    # Sheet 2: 異動紀錄
    ws2 = wb.create_sheet("異動紀錄")
    ws2.append(["時間", "品項", "變動", "原本", "現在", "去向", "原因"])
    for cell in ws2[1]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = header_fill
    conn = get_db()
    movs = conn.execute("""
        SELECT m.created_at, i.name, m.delta, m.before_qty, m.after_qty, m.destination, m.reason
        FROM movements m JOIN items i ON i.id = m.item_id
        ORDER BY m.id DESC LIMIT 500
    """).fetchall()
    conn.close()
    for m in movs:
        ws2.append(list(m))

    # Sheet 3: 廠牌統計
    ws3 = wb.create_sheet("廠牌統計")
    ws3.append(["廠牌", "品項數", "總庫存"])
    for cell in ws3[1]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = header_fill
    conn = get_db()
    stats = conn.execute("SELECT brand, COUNT(*), SUM(qty) FROM items GROUP BY brand ORDER BY COUNT(*) DESC").fetchall()
    conn.close()
    for s in stats:
        ws3.append(list(s))

    ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    out_path = os.path.join(EXPORT_DIR, f"庫存報表_{ts}.xlsx")
    wb.save(out_path)

    return FileResponse(out_path, filename=f"庫存報表_{ts}.xlsx", media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
