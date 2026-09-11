# -*- coding: utf-8 -*-
"""
零用金月報 Excel 生成器（範本填值法）
=====================================
- 以 app/assets/零用金月報範本.xlsx（由真實主管報表清理而來）為範本：
  openpyxl 載入 → 填月報資料 → 另存 xlsx（BytesIO 回傳，不寫磁碟）
- 版面（框線/合併格/欄寬/字型/列印設定）100% 來自範本，程式不重刻格式
- 資料庫不用 merged-cell 思維：多項目支出在匯出時才展開成多列，
  屬於同一 Entry 的日期/收入/支出/科目欄做跨列合併並垂直置中
"""
import copy
import datetime
import io
from pathlib import Path

from openpyxl import load_workbook

ASSETS_DIR = Path(__file__).resolve().parent.parent / "assets"
TEMPLATE_PATH = ASSETS_DIR / "零用金月報範本.xlsx"

TITLE_CELL = "A1"
YEAR_CELL = "B2"
OPENING_LABEL_CELL = "D2"
OPENING_CELL = "E2"
DATA_FIRST_ROW = 4
DATA_LAST_ROW = 18
TITLE_MERGE = "A1:F1"


def _safe(value):
    """公式注入防護：= + - @ 開頭的字串加撇號，避免被 Excel 當公式執行（沿用 report.py）"""
    if isinstance(value, str) and value.startswith(("=", "+", "-", "@")):
        return "'" + value
    return value


def _num_g(value) -> str:
    """明細文字用數字格式：24.0 → '24'、1.5 → '1.5'（對齊原模板『24瓶 $200』寫法）。"""
    try:
        return "%g" % float(value)
    except (TypeError, ValueError):
        return str(value or "")


def _item_text(item: dict) -> str:
    name = (item.get("item_name") or "").strip()
    qty = _num_g(item.get("qty"))
    unit = (item.get("unit") or "").strip()
    amount = _num_g(item.get("amount"))
    return _safe(f"{name} {qty}{unit} ${amount}")


def _copy_row_style(ws, src_row: int, dst_row: int) -> None:
    """把範本列的儲存格樣式（字型/填滿/邊框/對齊/數字格式）複製到目標列。"""
    for col in range(1, 7):
        src = ws.cell(row=src_row, column=col)
        dst = ws.cell(row=dst_row, column=col)
        if src.has_style:
            dst.font = copy.copy(src.font)
            dst.fill = copy.copy(src.fill)
            dst.border = copy.copy(src.border)
            dst.alignment = copy.copy(src.alignment)
            dst.number_format = src.number_format
            dst.protection = copy.copy(src.protection)


def _md(date_str: str) -> str:
    d = datetime.date.fromisoformat(date_str)
    return f"{d.month:02d}/{d.day:02d}"


def _mmdd(date_str: str) -> str:
    d = datetime.date.fromisoformat(date_str)
    return d.strftime("%m%d")


def build_petty_cash_report(report: dict) -> io.BytesIO:
    """填值零用金範本 → 回傳 BytesIO（呼叫端負責組成下載回應）。

    report: start_date / end_date / opening_balance / prepared_by /
            entries[{entry_date, entry_type, description, amount, category,
                     sort_order, id, items[{item_name, qty, unit, amount, sort_order}]}]
    明細預設 date ASC + sort_order ASC（呼叫端應先排序）。
    """
    start = report["start_date"]
    end = report["end_date"]
    opening = round(float(report.get("opening_balance") or 0), 2)

    wb = load_workbook(TEMPLATE_PATH)
    ws = wb.active

    # 1. 清掉範本殘留合併（保留標題列），避免與本次分組合併衝突
    for merged in list(ws.merged_cells.ranges):
        if str(merged) != TITLE_MERGE:
            ws.unmerge_cells(str(merged))
    ws.merge_cells(TITLE_MERGE)

    # 2. 標題 / 年度（民國年） / 上期餘額
    ws[TITLE_CELL] = f"{_md(start)}~{_md(end)}零用金收支明細表"
    roc_year = datetime.date.fromisoformat(start).year - 1911
    ws[YEAR_CELL] = f"{roc_year}年"
    ws[OPENING_LABEL_CELL] = "上期餘額"
    ws[OPENING_CELL] = opening

    # 3. 清空資料區（含 E19 以外；E19 由下方寫入計算值）
    for row in range(DATA_FIRST_ROW, DATA_LAST_ROW + 1):
        for col in range(1, 7):
            ws.cell(row=row, column=col).value = None

    # 4. 展開物理列：一筆多項目支出佔多列
    entries = sorted(
        report.get("entries") or [],
        key=lambda e: (e.get("entry_date") or "", e.get("sort_order") or 0, e.get("id") or 0),
    )
    capacity = DATA_LAST_ROW - DATA_FIRST_ROW + 1
    total_rows = 0
    for entry in entries:
        items = entry.get("items") or []
        n = len(items) if (entry.get("entry_type") == "expense" and items) else 1
        total_rows += n
    extra = 0
    if total_rows > capacity:
        extra = total_rows - capacity
        ws.insert_rows(DATA_LAST_ROW + 1, extra)
        for r in range(DATA_LAST_ROW + 1, DATA_LAST_ROW + 1 + extra):
            _copy_row_style(ws, DATA_LAST_ROW, r)
            ws.row_dimensions[r].height = 19.5
        closing_row = DATA_LAST_ROW + 1 + extra
    else:
        closing_row = DATA_LAST_ROW + 1

    row_idx = DATA_FIRST_ROW
    seq = 0
    for entry in entries:
        entry_date = datetime.date.fromisoformat(entry["entry_date"])
        is_income = entry.get("entry_type") == "income"
        items = entry.get("items") or []
        multi = (not is_income) and len(items) > 0
        if multi:
            rows = list(range(row_idx, row_idx + len(items)))
            for item, r in zip(
                sorted(items, key=lambda i: (i.get("sort_order") or 0, i.get("id") or 0)), rows
            ):
                seq += 1
                ws.cell(row=r, column=1).value = seq
                ws.cell(row=r, column=3).value = _item_text(item)
            # 同一 Entry 的日期/收入/支出/科目跨列合併並垂直置中
            ws.cell(row=rows[0], column=2).value = entry_date
            ws.cell(row=rows[0], column=5).value = round(float(entry["amount"]), 2)
            ws.cell(row=rows[0], column=6).value = _safe((entry.get("category") or "").strip())
            for col in (2, 4, 5, 6):
                if len(rows) > 1:
                    ws.merge_cells(
                        start_row=rows[0], start_column=col,
                        end_row=rows[-1], end_column=col,
                    )
            row_idx = rows[-1] + 1
        else:
            seq += 1
            ws.cell(row=row_idx, column=1).value = seq
            ws.cell(row=row_idx, column=2).value = entry_date
            ws.cell(row=row_idx, column=3).value = _safe((entry.get("description") or "").strip())
            if is_income:
                ws.cell(row=row_idx, column=4).value = round(float(entry["amount"]), 2)
            else:
                ws.cell(row=row_idx, column=5).value = round(float(entry["amount"]), 2)
            ws.cell(row=row_idx, column=6).value = _safe((entry.get("category") or "").strip())
            row_idx += 1

    # 5. 本期餘額（系統計算值直接寫入，避免公式範圍因插列錯掉）
    income = round(sum(float(e["amount"]) for e in entries if e.get("entry_type") == "income"), 2)
    expense = round(
        sum(float(e["amount"]) for e in entries if e.get("entry_type") != "income"), 2
    )
    closing = round(opening + income - expense, 2)
    ws.cell(row=closing_row, column=4).value = "本期餘額"
    ws.cell(row=closing_row, column=5).value = closing

    # 6. 製表人（上傳人不輸出到 Excel）；主管欄留白手簽（列位隨插列下移）
    ws.cell(row=21 + extra, column=5).value = _safe((report.get("prepared_by") or "").strip())

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf


def download_filename(filename_text: str, start_date: str, end_date: str) -> str:
    """下載檔名（安全格式，無 '/'）：零用金-資材0826-0925.xlsx。"""
    return f"零用金-{filename_text}{_mmdd(start_date)}-{_mmdd(end_date)}.xlsx"
