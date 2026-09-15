# -*- coding: utf-8 -*-
"""
匯出路由：Excel 報表（記憶體回傳版）
================================
- GET /api/export?days=30  匯出 6 個 Sheet（四庫存區明細 / 異動紀錄 / 廠牌統計）
- 改版重點：BytesIO 記憶體回傳，不寫磁碟 → exports/ 零檔案累積、無撞名
- 安全：公式注入防護（= + - @ 開頭的字串加撇號）
"""
import datetime
import io

from fastapi import Depends, APIRouter, HTTPException

from app.database import get_db
from app.services.auth import require_perm
from app.services.safety import excel_safe, xlsx_download

# 匯出 API 路由
router = APIRouter()
# Excel 表頭底色（品牌藍）
HEADER_FILL = "2E5C8A"
# 匯出天數上限
MAX_DAYS = 366


def _style_header(ws):
    """設定工作表表頭樣式：粗體白字 + 品牌色底 + 置中 + 凍結首列"""
    from openpyxl.styles import Alignment, Font, PatternFill

    for cell in ws[1]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor=HEADER_FILL)
        cell.alignment = Alignment(horizontal="center")
    ws.freeze_panes = "A2"


def _set_widths(ws, widths):
    """依 widths 清單依序設定各欄寬度（A、B、C…）"""
    import openpyxl.utils

    for i, w in enumerate(widths, 1):
        ws.column_dimensions[openpyxl.utils.get_column_letter(i)].width = w


@router.get("/api/export", dependencies=[Depends(require_perm("export"))])
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
    def _fill_stock_sheet(ws, site):
        """庫存明細頁（每列 = 主檔 × 每位置一行；2026-08-13 家豪：辦公室/倉庫分頁）"""
        ws.append(["編號", "廠牌", "品項名稱", "型號", "單位", "位置", "位置數量", "位置備註", "總數量"])
        _style_header(ws)
        rows = conn.execute("""
            SELECT i.id, i.brand, i.name, i.code, i.unit,
                   s.location, s.qty, s.note,
                   COALESCE(SUM(s.qty) OVER (PARTITION BY i.id), 0) AS total
            FROM items i
            LEFT JOIN item_stocks s ON s.item_id = i.id
            WHERE i.is_deleted = 0 AND i.site = ?
            ORDER BY i.brand COLLATE NOCASE, i.name, s.id
        """, (site,)).fetchall()
        for r in rows:
            ws.append([r["id"], excel_safe(r["brand"]), excel_safe(r["name"]), excel_safe(r["code"]),
                       excel_safe(r["unit"]), excel_safe(r["location"]), r["qty"], excel_safe(r["note"]), r["total"]])
        _set_widths(ws, [8, 14, 40, 16, 8, 30, 10, 24, 10])

    try:
        # Sheet 1-4：四個獨立庫存區明細（單一 JOIN 消除 N+1）
        ws = wb.active
        for sheet, site in (("辦公室", "office"), ("倉庫", "warehouse"),
                            ("廂型車", "van"), ("貨車", "truck")):
            if ws.title != "Sheet":
                ws = wb.create_sheet(sheet)
            else:
                ws.title = sheet
            _fill_stock_sheet(ws, site)

        # Sheet 3: 異動紀錄（days 控制範圍，取代寫死的 LIMIT 500）
        ws3 = wb.create_sheet("異動紀錄")
        ws3.append(["時間", "品項", "變動", "原本", "現在", "去向", "原因"])
        _style_header(ws3)
        movs = conn.execute("""
            SELECT m.created_at, i.name, m.delta, m.before_qty, m.after_qty,
                   m.destination, m.reason
            FROM movements m JOIN items i ON i.id = m.item_id
            WHERE m.created_at >= datetime('now', ?)
            ORDER BY m.id DESC
        """, (f"-{days} days",)).fetchall()
        for m in movs:
            ws3.append([excel_safe(x) for x in m])
        _set_widths(ws3, [20, 30, 10, 10, 10, 16, 30])

        # Sheet 4: 廠牌統計
        ws4 = wb.create_sheet("廠牌統計")
        ws4.append(["廠牌", "品項數", "總庫存"])
        _style_header(ws4)
        stats = conn.execute("""
            SELECT i.brand, COUNT(DISTINCT i.id), COALESCE(SUM(s.qty), 0)
            FROM items i LEFT JOIN item_stocks s ON s.item_id = i.id
            GROUP BY i.brand ORDER BY COUNT(DISTINCT i.id) DESC
        """).fetchall()
        for s in stats:
            ws4.append([excel_safe(x) for x in s])
        _set_widths(ws4, [14, 10, 10])
    finally:
        conn.close()

    # 記憶體回傳：不寫磁碟、伺服器不留檔案（中文檔名走 RFC 5987，見 safety.xlsx_download）
    ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"庫存報表_{ts}.xlsx"
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return xlsx_download(buf.getvalue(), filename)