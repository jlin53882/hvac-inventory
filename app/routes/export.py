# -*- coding: utf-8 -*-
"""庫存 Excel 匯出：固定六張可篩選、可追公式的報表。"""
from __future__ import annotations

import datetime as dt
import io
import re
from typing import Iterable

from fastapi import APIRouter, Depends, HTTPException
from openpyxl import Workbook
from openpyxl.formatting.rule import FormulaRule
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.worksheet.table import Table, TableStyleInfo
from openpyxl.utils import get_column_letter

from app.database import get_db
from app.services import movement_time
from app.services.auth import require_perm
from app.services.safety import excel_safe, xlsx_download

router = APIRouter()
SITES = {"office": "辦公室", "warehouse": "倉庫", "van": "廂型車", "truck": "貨車"}
SITE_ORDER = tuple(SITES)
MAX_RANGE_DAYS = 366
HEADER_FILL = "2E5C8A"
TITLE_FILL = "163B63"
STATUS_FILLS = {"資料異常": "FCA5A5", "缺貨": "FECACA", "低庫存": "FED7AA"}


def _parse_export_range(month: str | None, start_date: str | None, end_date: str | None, now: dt.datetime | None = None) -> tuple[dt.datetime, dt.datetime, str, str]:
    """解析月份或自訂日期範圍，回傳 SQL 邊界與 Excel 顯示期間。"""
    now = now or dt.datetime.strptime(movement_time.now_sql(), movement_time.SQL_DATETIME_FORMAT)
    if start_date is not None or end_date is not None:
        if not start_date or not end_date:
            raise HTTPException(400, "start_date 與 end_date 必須同時提供")
        try:
            start_day = dt.date.fromisoformat(start_date)
            end_day = dt.date.fromisoformat(end_date)
        except ValueError:
            raise HTTPException(400, "日期格式必須為 YYYY-MM-DD")
        inclusive_days = (end_day - start_day).days + 1
        if start_day > end_day or inclusive_days > MAX_RANGE_DAYS:
            raise HTTPException(400, "日期範圍無效或超過 366 天")
        start = dt.datetime.combine(start_day, dt.time.min)
        end = dt.datetime.combine(end_day + dt.timedelta(days=1), dt.time.min)
        label = f"{start_day.isoformat()} ～ {end_day.isoformat()}"
        return start, end, label, f"{start_day.strftime('%Y/%m/%d')} ～ {end_day.strftime('%Y/%m/%d')}"
    if month is not None:
        if not re.fullmatch(r"\d{4}-\d{2}", month):
            raise HTTPException(400, "month 格式必須為 YYYY-MM")
        try:
            year, mon = map(int, month.split("-"))
            start_day = dt.date(year, mon, 1)
        except ValueError:
            raise HTTPException(400, "month 不是合法月份")
        next_month = dt.date(year + (mon == 12), 1 if mon == 12 else mon + 1, 1)
        start = dt.datetime.combine(start_day, dt.time.min)
        end = dt.datetime.combine(next_month, dt.time.min)
        if start_day.year == now.year and start_day.month == now.month:
            end = now + dt.timedelta(seconds=1)
        display_end = now.strftime("%Y/%m/%d %H:%M") if start_day.year == now.year and start_day.month == now.month else (next_month - dt.timedelta(days=1)).strftime("%Y/%m/%d")
        return start, end, f"{year} 年 {mon:02d} 月", f"{start_day.strftime('%Y/%m/%d')} ～ {display_end}"
    return _parse_export_range(now.strftime("%Y-%m"), None, None, now)


def _safe(value):
    """將資料庫文字交給既有 Excel 公式注入防護 helper。"""
    return excel_safe("" if value is None else value)


def _site_label(site: str) -> str:
    """將內部庫存區代碼轉成報表顯示名稱。"""
    return SITES.get(site, site)


def _period_text(label: str, display_period: str) -> str:
    """組合報表期間與異動統計期間的標題文字。"""
    return f"報表期間：{label}　異動統計：{display_period}"


def _style_title(ws, title: str, period: str):
    """套用工作表標題、快照時間與期間資訊。"""
    ws["A1"] = title
    ws["A1"].font = Font(bold=True, size=18, color="FFFFFF")
    ws["A1"].fill = PatternFill("solid", fgColor=TITLE_FILL)
    ws["A1"].alignment = Alignment(vertical="center")
    ws.row_dimensions[1].height = 30
    ws["A2"] = "庫存快照：" + movement_time.now_sql().replace("-", "/")
    ws["A3"] = period
    for row in (2, 3):
        ws.cell(row, 1).font = Font(color="475569", italic=True, size=10)


def _style_header(ws, row: int):
    """套用資料表表頭樣式並設定凍結窗格。"""
    for cell in ws[row]:
        if cell.value is not None:
            cell.font = Font(bold=True, color="FFFFFF")
            cell.fill = PatternFill("solid", fgColor=HEADER_FILL)
            cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    ws.freeze_panes = f"A{row + 1}"


def _style_data(ws, header_row: int, qty_columns: Iterable[int] = (), note_columns: Iterable[int] = ()):
    """套用資料列對齊、備註換行與基礎數量格式。"""
    for row in ws.iter_rows(min_row=header_row + 1):
        for cell in row:
            cell.alignment = Alignment(horizontal="right" if cell.column in qty_columns else "left", vertical="top", wrap_text=cell.column in note_columns)
        for col in qty_columns:
            row[col - 1].number_format = "#,##0.###"


def _set_widths(ws, widths):
    """依序設定工作表各欄寬。"""
    for i, width in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = width


def _add_table(ws, name: str, header_row: int, style: str = "TableStyleMedium2"):
    """在資料列存在時建立原生 Excel Table，並回傳是否建立成功。"""
    if ws.max_row <= header_row:
        return False
    table = Table(displayName=name, ref=f"A{header_row}:{get_column_letter(ws.max_column)}{ws.max_row}")
    table.tableStyleInfo = TableStyleInfo(name=style, showFirstColumn=False, showLastColumn=False, showRowStripes=True, showColumnStripes=False)
    ws.add_table(table)
    return True


def _qty_format(qty_type: str) -> str:
    """依單位數量類型回傳 Excel number format。"""
    return {"integer": "#,##0", "fraction": "# ??/??", "decimal": "#,##0.###"}.get(qty_type, "#,##0.###")


def _write_empty(ws, row: int, text: str = "目前沒有資料"):
    """在空資料工作表寫入使用者可理解的空狀態訊息。"""
    ws.cell(row, 1).value = text
    ws.cell(row, 1).font = Font(color="64748B", italic=True)


def _write_headers(ws, headers, row: int = 5):
    """將欄位標題寫入指定表頭列。"""
    for column, value in enumerate(headers, 1):
        ws.cell(row, column).value = value


def _build_inventory_sheet(ws, items, position_table_available: bool, qty_types):
    """建立一品項一列的庫存總表與 Excel 衍生公式。"""
    headers = ["品項編號", "庫存區", "分類", "廠牌", "品項名稱", "型號", "單位", "低庫存門檻", "待領出", "總庫存", "可用庫存", "位置數", "庫存狀態", "警示序號"]
    _write_headers(ws, headers)
    _style_header(ws, 5)
    for item in items:
        row_idx = ws.max_row + 1
        total_formula = f"=SUMIFS(tblPosition[位置數量],tblPosition[品項編號],A{row_idx})" if position_table_available else "=SUM(0)"
        available_formula = f"=J{row_idx}-I{row_idx}"
        position_count_formula = f"=COUNTIFS(tblPosition[品項編號],A{row_idx})" if position_table_available else "=0"
        status_formula = f'=IF(K{row_idx}<0,"資料異常",IF(K{row_idx}=0,"缺貨",IF(AND(H{row_idx}>0,K{row_idx}<=H{row_idx}),"低庫存","正常")))'
        warning_index_formula = f'=IF(M{row_idx}<>"正常",COUNTIF($M$6:M{row_idx},"<>正常"),"")'
        ws.append([item["id"], _site_label(item["site"]), _safe(item["category"] or "未分類"), _safe(item["brand"] or "未設定廠牌"), _safe(item["name"]), _safe(item["code"]), _safe(item["unit"]), item["low_stock"] or 0, item["prepared_qty"] or 0, total_formula, available_formula, position_count_formula, status_formula, warning_index_formula])
    if not items:
        _write_empty(ws, 6)
    else:
        _add_table(ws, "tblInventory", 5)
        _style_data(ws, 5, qty_columns=(8, 9, 10, 11, 12))
        for row in range(6, ws.max_row + 1):
            ws.cell(row, 1).alignment = Alignment(horizontal="center")
            fmt = _qty_format(qty_types.get(str(ws.cell(row, 7).value).lstrip("'"), "decimal"))
            for col in (8, 9, 10, 11):
                ws.cell(row, col).number_format = fmt
        ws.column_dimensions["N"].hidden = True
        status_range = f"M6:M{ws.max_row}"
        for status, color in STATUS_FILLS.items():
            ws.conditional_formatting.add(status_range, FormulaRule(formula=[f'$M6="{status}"'], fill=PatternFill("solid", fgColor=color)))
    _set_widths(ws, [10, 12, 16, 16, 30, 18, 10, 14, 12, 12, 12, 10, 14])


def _build_position_sheet(ws, positions, qty_types):
    """建立一位置一列的位置明細表。"""
    headers = ["品項編號", "庫存區", "分類", "廠牌", "品項名稱", "型號", "單位", "位置", "位置數量", "位置備註"]
    _write_headers(ws, headers)
    _style_header(ws, 5)
    for row in positions:
        ws.append([row["id"], _site_label(row["site"]), _safe(row["category"] or "未分類"), _safe(row["brand"] or "未設定廠牌"), _safe(row["name"]), _safe(row["code"]), _safe(row["unit"]), _safe(row["location"]), row["qty"], _safe(row["note"])])
    if positions:
        _add_table(ws, "tblPosition", 5)
        _style_data(ws, 5, qty_columns=(9,), note_columns=(10,))
        for row in range(6, ws.max_row + 1):
            ws.cell(row, 9).number_format = _qty_format(qty_types.get(str(ws.cell(row, 7).value).lstrip("'"), "decimal"))
    else:
        _write_empty(ws, 6)
    _set_widths(ws, [10, 12, 16, 16, 30, 18, 10, 24, 14, 30])


def _build_movement_sheet(ws, movements):
    """建立期間異動紀錄，保留原始數量並依值套用顯示格式。"""
    headers = ["時間", "異動類型", "品項編號", "廠牌", "品項名稱", "型號", "庫存區", "變動量", "異動前", "異動後", "去向", "原因"]
    _write_headers(ws, headers)
    _style_header(ws, 5)
    for row in movements:
        reason = row["reason"] or ""
        movement_type = _movement_type(reason, row["delta"])
        ws.append([_safe(row["created_at"]), movement_type, row["item_id"], _safe(row["brand"] or "未設定廠牌"), _safe(row["name"]), _safe(row["code"]), _site_label(row["site"]), row["delta"], row["before_qty"], row["after_qty"], _safe(row["destination"]), _safe(reason)])
    if movements:
        _add_table(ws, "tblMovement", 5)
        _style_data(ws, 5, qty_columns=(8, 9, 10), note_columns=(11, 12))
        for row in range(6, ws.max_row + 1):
            for col in (8, 9, 10):
                value = ws.cell(row, col).value
                if isinstance(value, (int, float)) and float(value).is_integer():
                    ws.cell(row, col).number_format = "#,##0"
    else:
        _write_empty(ws, 6, "選定期間沒有異動紀錄")
    _set_widths(ws, [21, 14, 10, 16, 28, 18, 12, 12, 12, 12, 20, 30])


def _movement_type(reason: str, delta: float) -> str:
    """依 production movement reason contract 分類異動類型。

    先處理明確 reason，再以 delta 作為最後 fallback；避免「組裝套件」等
    負向整組異動被誤標成一般出庫。
    """
    reason = reason or ""
    if reason == "領出準備":
        return "待領出"
    if reason.startswith("解除"):
        return "解除待領出"
    if reason.startswith("出庫"):
        return "出庫"
    if reason == "退回已領出":
        return "退回"
    if reason == "庫存調撥":
        return "調撥"
    if reason.startswith("盤點"):
        return "盤點"
    if reason.startswith("組裝"):
        return "整組組裝"
    if reason.startswith("拆解"):
        return "整組拆解"
    if reason == "品項刪除清零":
        return "刪除清零"
    if "調整" in reason:
        return "庫存調整"
    if delta < 0:
        return "出庫"
    return "其他"


def _build_overview(ws, has_inventory, period):
    """建立快照資訊、KPI 公式與庫存區摘要。"""
    _style_title(ws, "庫存管理報表", period)
    ws["A5"] = "指標"; ws["B5"] = "數值"
    _style_header(ws, 5)
    kpis = [("品項數", '=ROWS(tblInventory[品項編號])' if has_inventory else "=0"), ("總庫存", '=SUM(tblInventory[總庫存])' if has_inventory else "=SUM(0)"), ("待領出", '=SUM(tblInventory[待領出])' if has_inventory else "=SUM(0)"), ("可用庫存", '=SUM(tblInventory[可用庫存])' if has_inventory else "=SUM(0)"), ("低庫存", '=COUNTIF(tblInventory[庫存狀態],"低庫存")' if has_inventory else "=0"), ("缺貨", '=COUNTIF(tblInventory[庫存狀態],"缺貨")' if has_inventory else "=0")]
    for name, formula in kpis:
        ws.append([name, formula])
    ws["A14"] = "各庫存區摘要"; ws["A14"].font = Font(bold=True, size=13, color=TITLE_FILL)
    headers = ["庫存區", "品項數", "總庫存", "待領出", "可用", "低庫存", "缺貨"]
    for col, value in enumerate(headers, 1): ws.cell(15, col).value = value
    _style_header(ws, 15)
    for site in SITE_ORDER:
        ws.append([SITES[site], f'=COUNTIF(tblInventory[庫存區],A{ws.max_row + 1})' if has_inventory else "=0", f'=SUMIF(tblInventory[庫存區],A{ws.max_row + 1},tblInventory[總庫存])' if has_inventory else "=SUM(0)", f'=SUMIF(tblInventory[庫存區],A{ws.max_row + 1},tblInventory[待領出])' if has_inventory else "=SUM(0)", f'=SUMIF(tblInventory[庫存區],A{ws.max_row + 1},tblInventory[可用庫存])' if has_inventory else "=SUM(0)", f'=COUNTIFS(tblInventory[庫存區],A{ws.max_row + 1},tblInventory[庫存狀態],"低庫存")' if has_inventory else "=0", f'=COUNTIFS(tblInventory[庫存區],A{ws.max_row + 1},tblInventory[庫存狀態],"缺貨")' if has_inventory else "=0"])
    _set_widths(ws, [18, 14, 14, 14, 14, 14, 14])


def _build_alert_sheet(ws, item_count):
    """建立以 tblInventory 為單一來源的傳統公式警示列。"""
    headers = ["庫存狀態", "品項編號", "庫存區", "分類", "廠牌", "品項名稱", "型號", "單位", "總庫存", "待領出", "可用庫存", "低庫存門檻"]
    _write_headers(ws, headers); _style_header(ws, 5)
    if item_count:
        inventory_headers = ["庫存狀態", "品項編號", "庫存區", "分類", "廠牌", "品項名稱", "型號", "單位", "總庫存", "待領出", "可用庫存", "低庫存門檻"]
        for row in range(6, item_count + 6):
            match_formula = f'MATCH(ROW()-5,tblInventory[警示序號],0)'
            for column, header in enumerate(inventory_headers, 1):
                ws.cell(row, column).value = f'=IFERROR(INDEX(tblInventory[{header}],{match_formula}),"")'
    else:
        _write_empty(ws, 6)
    _set_widths(ws, [14, 12, 12, 16, 16, 30, 18, 10, 12, 12, 12, 14])


def _build_stats_sheet(ws, items):
    """建立庫存區、分類與廠牌的公式統計區塊。"""
    has_inventory = bool(items)
    _style_title(ws, "庫存統計", "數字欄位皆由 Excel 公式依 tblInventory 推導")
    ws["A4"] = "庫存區統計"; ws["J4"] = "分類統計"; ws["O4"] = "廠牌統計"
    for cell in (ws["A4"], ws["J4"], ws["O4"]): cell.font = Font(bold=True, size=13, color=TITLE_FILL)
    site_headers = ["庫存區", "品項數", "總庫存", "待領出", "可用庫存", "低庫存", "缺貨"]
    cat_headers = ["分類", "品項數", "總庫存", "可用庫存"]
    brand_headers = ["廠牌", "品項數", "總庫存", "可用庫存"]
    for col, val in enumerate(site_headers, 1): ws.cell(5, col).value = val
    for col, val in enumerate(cat_headers, 10): ws.cell(5, col).value = val
    for col, val in enumerate(brand_headers, 15): ws.cell(5, col).value = val
    _style_header(ws, 5)
    for site in SITE_ORDER:
        r = ws.max_row + 1; ws.cell(r, 1).value = SITES[site]
        if has_inventory:
            ws.cell(r, 2).value = f'=COUNTIF(tblInventory[庫存區],A{r})'; ws.cell(r, 3).value = f'=SUMIF(tblInventory[庫存區],A{r},tblInventory[總庫存])'; ws.cell(r, 4).value = f'=SUMIF(tblInventory[庫存區],A{r},tblInventory[待領出])'; ws.cell(r, 5).value = f'=SUMIF(tblInventory[庫存區],A{r},tblInventory[可用庫存])'; ws.cell(r, 6).value = f'=COUNTIFS(tblInventory[庫存區],A{r},tblInventory[庫存狀態],"低庫存")'; ws.cell(r, 7).value = f'=COUNTIFS(tblInventory[庫存區],A{r},tblInventory[庫存狀態],"缺貨")'
    categories = sorted({item["category"] or "未分類" for item in items})
    brands = sorted({item["brand"] or "未設定廠牌" for item in items})
    if not has_inventory:
        ws["J6"] = "目前無資料"; ws["O6"] = "目前無資料"
    for r, category in enumerate(categories, 6):
        ws.cell(r, 10).value = _safe(category)
        ws.cell(r, 11).value = f'=COUNTIF(tblInventory[分類],J{r})'
        ws.cell(r, 12).value = f'=SUMIF(tblInventory[分類],J{r},tblInventory[總庫存])'
        ws.cell(r, 13).value = f'=SUMIF(tblInventory[分類],J{r},tblInventory[可用庫存])'
    for r, brand in enumerate(brands, 6):
        ws.cell(r, 15).value = _safe(brand)
        ws.cell(r, 16).value = f'=COUNTIF(tblInventory[廠牌],O{r})'
        ws.cell(r, 17).value = f'=SUMIF(tblInventory[廠牌],O{r},tblInventory[總庫存])'
        ws.cell(r, 18).value = f'=SUMIF(tblInventory[廠牌],O{r},tblInventory[可用庫存])'
    _set_widths(ws, [14, 12, 14, 14, 14, 12, 12, 3, 3, 18, 12, 14, 14, 3, 18, 12, 14, 14])


@router.get("/api/export", dependencies=[Depends(require_perm("export"))])
def export_excel(month: str | None = None, start_date: str | None = None, end_date: str | None = None, days: int | None = None, sites: str | None = None, sections: str | None = None):
    """驗證匯出參數、查詢資料並產生固定六張 Sheet 的 XLSX 回應。"""
    del sections  # 六張工作表固定輸出；保留參數以相容既有/未來前端。
    if days is not None and month is None and start_date is None and end_date is None:
        if days < 0 or days > MAX_RANGE_DAYS:
            raise HTTPException(400, "days 必須介於 0 到 366")
        now = dt.datetime.strptime(movement_time.now_sql(), movement_time.SQL_DATETIME_FORMAT); start = now - dt.timedelta(days=days); end = now; period = f"{start.strftime('%Y/%m/%d')} ～ {end.strftime('%Y/%m/%d')}"; display_period = period
    else:
        start, end, period, display_period = _parse_export_range(month, start_date, end_date)
    selected_sites = list(SITE_ORDER) if not sites else [s for s in sites.split(",") if s]
    if not selected_sites or any(s not in SITES for s in selected_sites):
        raise HTTPException(400, "sites 含有不合法的庫存區")
    conn = get_db()
    try:
        items = conn.execute("SELECT id, site, category, brand, name, code, unit, low_stock, prepared_qty FROM items WHERE is_deleted=0 AND site IN (%s) ORDER BY brand COLLATE NOCASE, name, id" % ",".join("?" * len(selected_sites)), selected_sites).fetchall()
        positions = conn.execute("SELECT i.id, i.site, i.category, i.brand, i.name, i.code, i.unit, s.location, s.qty, s.note FROM items i JOIN item_stocks s ON s.item_id=i.id WHERE i.is_deleted=0 AND i.site IN (%s) ORDER BY i.id, s.id" % ",".join("?" * len(selected_sites)), selected_sites).fetchall()
        movement_site = "COALESCE(NULLIF(m.return_site,''), NULLIF(m.source_site,''), NULLIF(i.site,''), '')"
        site_placeholders = ",".join("?" * len(selected_sites))
        movement_sql = (
            "SELECT m.created_at, m.item_id, m.delta, m.before_qty, m.after_qty, "
            "m.destination, m.reason, " + movement_site + " AS site, "
            "i.brand, i.name, i.code "
            "FROM movements m JOIN items i ON i.id=m.item_id "
            "WHERE (" + movement_site + f" IN ({site_placeholders}) OR "
            + movement_site + " = '') AND m.created_at >= ? AND m.created_at < ? "
            "ORDER BY m.created_at DESC, m.id DESC"
        )
        movements = conn.execute(
            movement_sql,
            [*selected_sites, movement_time.datetime_to_sql(start), movement_time.datetime_to_sql(end)],
        ).fetchall()
        qty_types = {row["name"]: row["qty_type"] for row in conn.execute("SELECT name, qty_type FROM units")}
    finally:
        conn.close()
    wb = Workbook(); wb.remove(wb.active); wb.calculation.fullCalcOnLoad = True; wb.calculation.forceFullCalc = True; wb.calculation.calcMode = "auto"
    period_text = _period_text(period, display_period)
    overview = wb.create_sheet("01 總覽"); _build_overview(overview, bool(items), period_text)
    inventory = wb.create_sheet("02 庫存總表"); _style_title(inventory, "庫存總表（匯出當下快照）", period_text); _build_inventory_sheet(inventory, items, bool(positions), qty_types)
    position = wb.create_sheet("03 位置明細"); _style_title(position, "位置明細（每位置一列）", period_text); _build_position_sheet(position, positions, qty_types)
    alerts = wb.create_sheet("04 庫存警示"); _style_title(alerts, "庫存警示", period_text); _build_alert_sheet(alerts, len(items))
    movement = wb.create_sheet("05 異動紀錄"); _style_title(movement, "異動紀錄", period_text); _build_movement_sheet(movement, movements)
    stats = wb.create_sheet("06 統計"); _build_stats_sheet(stats, items)
    buf = io.BytesIO(); wb.save(buf); buf.seek(0)
    stamp = movement_time.now_sql().replace("-", "").replace(":", "").replace(" ", "_")
    if month and not start_date and not end_date:
        filename = f"庫存報表_{month[:4]}年{month[5:]}月_{stamp}.xlsx"
    elif start_date and end_date:
        filename = f"庫存報表_{start_date.replace('-', '')}-{end_date.replace('-', '')}_{stamp}.xlsx"
    else:
        filename = f"庫存報表_{stamp}.xlsx"
    return xlsx_download(buf.getvalue(), filename)
