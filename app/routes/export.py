# -*- coding: utf-8 -*-
"""產生可選工作表的單一庫存 Excel 報表，並安全處理公式。"""
from __future__ import annotations

import datetime as dt
import io
import re
from copy import copy
from types import MappingProxyType
from typing import Iterable, NamedTuple

from fastapi import APIRouter, Depends, HTTPException
from openpyxl import Workbook
from openpyxl.formatting.rule import FormulaRule
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.worksheet.table import Table, TableStyleInfo
from openpyxl.worksheet.worksheet import Worksheet
from openpyxl.utils import get_column_letter

from app.database import db_session
from app.services import movement_time
from app.services.auth import require_perm
from app.services.excel_layout import auto_fit_columns
from app.services.safety import excel_safe, xlsx_download

router = APIRouter()
SITES = MappingProxyType({"office": "公司", "warehouse": "倉庫", "van": "廂型車", "truck": "貨車"})
SITE_ORDER = tuple(SITES)
MAX_RANGE_DAYS = 366
DEFAULT_EXPORT_SECTIONS = ("inventory", "positions", "movements")
DEFAULT_STOCKOUT_SECTIONS = ("movements",)

# Endpoint-specific section allowlists
SINGLE_EXPORT_SECTIONS = ("overview", "inventory", "positions", "alerts", "movements", "stats")
KIT_EXPORT_SECTIONS = ("overview", "inventory", "positions", "components", "alerts", "movements")
STOCKOUT_EXPORT_SECTIONS = ("overview", "movements")
HEADER_FILL = "2E5C8A"
TITLE_FILL = "163B63"
STATUS_FILLS = MappingProxyType({"資料異常": "FCA5A5", "缺貨": "FECACA", "低庫存": "FED7AA"})


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


def _resolve_export_period(month, start_date, end_date, days):
    """匯出期間：只給 days（近幾日）時以現在往回推；否則解析 month / 自訂區間。
    回傳 (start, end, period, display_period)。"""
    if days is not None and month is None and start_date is None and end_date is None:
        if days < 0 or days > MAX_RANGE_DAYS:
            raise HTTPException(400, "days 必須介於 0 到 366")
        now = dt.datetime.strptime(movement_time.now_sql(), movement_time.SQL_DATETIME_FORMAT)
        start = now - dt.timedelta(days=days)
        end = now
        period = f"{start.strftime('%Y/%m/%d')} ～ {end.strftime('%Y/%m/%d')}"
        return start, end, period, period
    return _parse_export_range(month, start_date, end_date)


def _new_workbook() -> Workbook:
    """空活頁簿（移除預設 sheet，開檔時強制重算公式）。"""
    wb = Workbook()
    wb.remove(wb.active)
    wb.calculation.fullCalcOnLoad = True
    wb.calculation.forceFullCalc = True
    wb.calculation.calcMode = "auto"
    return wb


def _finalize_workbook(wb: Workbook) -> bytes:
    """套用全活頁簿字型與格式，依每欄標題與資料自動分配欄寬。"""
    for sheet in wb.worksheets:
        _apply_workbook_styles(sheet)
        auto_fit_columns(sheet)
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf.getvalue()


def _report_filename(prefix: str, month, start_date, end_date) -> str:
    """報表檔名：月份 / 自訂區間 / 無條件三種格式，皆附時間戳。"""
    stamp = movement_time.now_sql().replace("-", "").replace(":", "").replace(" ", "_")
    if month and not start_date and not end_date:
        return f"{prefix}_{month[:4]}年{month[5:]}月_{stamp}.xlsx"
    if start_date and end_date:
        return f"{prefix}_{start_date.replace('-', '')}-{end_date.replace('-', '')}_{stamp}.xlsx"
    return f"{prefix}_{stamp}.xlsx"


def _safe(value):
    """將資料庫文字交給既有 Excel 公式注入防護 helper。"""
    return excel_safe("" if value is None else value)


def _site_label(site: str) -> str:
    """將內部庫存區代碼轉成報表顯示名稱。"""
    return SITES.get(site, site)


def _period_text(label: str, display_period: str) -> str:
    """組合報表期間與異動統計期間的標題文字。"""
    return f"報表期間：{label}　異動統計：{display_period}"


def _style_title(ws, title: str, period: str, header_count: int = 4):
    """寫入活頁簿標題與報表期間，合併欄位跟隨標題列寬度，自動調整欄寬。
    
    Args:
        ws: 工作表
        title: 標題文本
        period: 期間文本
        header_count: 標題要合併到的欄數（預設 4 = A:D）
    """
    # 動態計算合併範圍
    end_col = get_column_letter(header_count)
    ws.merge_cells(f"A1:{end_col}1")
    
    # A1 標題
    cell_a1 = ws["A1"]
    cell_a1.value = title
    cell_a1.font = Font(name="Microsoft JhengHei", bold=True, size=18, color="FFFFFF")
    cell_a1.fill = PatternFill("solid", fgColor=TITLE_FILL)
    cell_a1.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    ws.row_dimensions[1].height = 30
    
    # A2 期間
    cell_a2 = ws["A2"]
    cell_a2.value = period
    cell_a2.font = Font(name="Microsoft JhengHei", color="475569", italic=True, size=10)
    cell_a2.alignment = Alignment(horizontal="left", vertical="center")
    
def _style_header(ws, row: int):
    """設定表頭凍結窗格（樣式已在 _write_headers 套用）。"""
    ws.freeze_panes = f"A{row + 1}"


def _style_data(ws, header_row: int, qty_columns: Iterable[int] = (), note_columns: Iterable[int] = ()):
    """套用資料列對齊、備註換行與基礎數量格式。"""
    for row in ws.iter_rows(min_row=header_row + 1):
        for cell in row:
            cell.alignment = Alignment(horizontal="right" if cell.column in qty_columns else "left", vertical="top", wrap_text=cell.column in note_columns)
        for col in qty_columns:
            row[col - 1].number_format = "#,##0.###"


def _apply_workbook_styles(ws: Worksheet) -> None:
    """套用報表字型、文字格式與資料列置中對齊。

    第 1–2 列保留標題與期間樣式。各工作表建構函式設定的數量格式
    維持數值格式，讓 Excel 仍可進行計算。
    """
    for row in ws.iter_rows():
        for cell in row:
            if cell.value is None:
                continue
            # 確保字型物件存在（避免 None 導致字型遺失）
            if cell.font is None:
                cell.font = Font()
            font = copy(cell.font)
            font.name = "Microsoft JhengHei"
            cell.font = font
            if cell.row >= 3:
                cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=cell.alignment.wrap_text)
                if cell.number_format == "General":
                    cell.number_format = "@"
    
def _parse_export_sections(sections: str | None, default_sections: tuple = DEFAULT_EXPORT_SECTIONS, allowed_sections: tuple = SINGLE_EXPORT_SECTIONS) -> set[str]:
    """驗證要求匯出的工作表；未指定時採用指定的預設工作表。"""
    if sections is None:
        return set(default_sections)
    requested = [part.strip() for part in sections.split(",") if part.strip()]
    if not requested:
        raise HTTPException(400, "sections 不可為空")
    # 檢查所有請求的 section 都在 allowlist 內
    for section in requested:
        if section not in allowed_sections:
            raise HTTPException(400, f"section '{section}' 不支援此端點")
    return set(requested)


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
    """將欄位標題寫入指定表頭列，並立即套用樣式避免 inlineStr 格式。"""
    for column, value in enumerate(headers, 1):
        cell = ws.cell(row, column)
        cell.value = value
        # 立即套用樣式，避免後續被 inlineStr 覆蓋
        cell.font = Font(name="Microsoft JhengHei", bold=True, size=11, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor=HEADER_FILL)
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)


def _build_inventory_sheet(ws, items, positions, position_table_available: bool, qty_types):
    """建立庫存總表；僅在來源位置表存在時使用公式。

    Args:
        ws: 要填入資料的庫存工作表。
        items: 從資料庫選出的品項資料列。
        positions: 用於計算數值及結構化表格公式的位置資料列。
        position_table_available: 匯出的位置表是否可供公式參照。
        qty_types: 單位名稱至數量格式的對應表。
    """
    headers = ["品項編號(系統編號)", "庫存區", "廠牌", "品項名稱", "型號", "單位", "低庫存門檻", "待領出", "總庫存", "可用庫存", "位置數", "庫存狀態", "警示序號"]
    _write_headers(ws, headers)
    _style_header(ws, 5)
    quantity_by_item = {}
    count_by_item = {}
    for position in positions:
        item_id = position["id"]
        quantity_by_item[item_id] = quantity_by_item.get(item_id, 0) + (position["qty"] or 0)
        count_by_item[item_id] = count_by_item.get(item_id, 0) + 1
    for item in items:
        row_idx = ws.max_row + 1
        if position_table_available:
            total_formula = f"=SUMIFS(tblPosition[位置數量],tblPosition[品項編號(系統編號)],A{row_idx})"
            position_count_formula = f"=COUNTIFS(tblPosition[品項編號(系統編號)],A{row_idx})"
        else:
            total_formula = quantity_by_item.get(item["id"], 0)
            position_count_formula = count_by_item.get(item["id"], 0)
        available_formula = f"=I{row_idx}-H{row_idx}"
        status_formula = f'=IF(J{row_idx}<0,"資料異常",IF(J{row_idx}=0,"缺貨",IF(AND(G{row_idx}>0,J{row_idx}<=G{row_idx}),"低庫存","正常")))'
        warning_index_formula = f'=IF(L{row_idx}<>"正常",COUNTIF($L$6:L{row_idx},"<>正常"),"")'
        ws.append([item["id"], _site_label(item["site"]), _safe(item["brand"] or "未設定廠牌"), _safe(item["name"]), _safe(item["code"]), _safe(item["unit"]), item["low_stock"] or 0, item["prepared_qty"] or 0, total_formula, available_formula, position_count_formula, status_formula, warning_index_formula])
    if not items:
        _write_empty(ws, 6)
    else:
        _add_table(ws, "tblInventory", 5)
        _style_data(ws, 5, qty_columns=(7, 8, 9, 10, 11))
        for row in range(6, ws.max_row + 1):
            ws.cell(row, 1).alignment = Alignment(horizontal="center")
            fmt = _qty_format(qty_types.get(str(ws.cell(row, 6).value).lstrip("'"), "decimal"))
            for col in (7, 8, 9, 10):
                ws.cell(row, col).number_format = fmt
            ws.cell(row, 11).number_format = "#,##0"
        ws.column_dimensions["M"].hidden = True
        status_range = f"L6:L{ws.max_row}"
        for status, color in STATUS_FILLS.items():
            ws.conditional_formatting.add(status_range, FormulaRule(formula=[f'$L6="{status}"'], fill=PatternFill("solid", fgColor=color)))


def _load_cabinet_notes(conn) -> dict:
    """設定頁「櫃子」的位置說明（櫃子名稱 → 說明），供位置明細對照。"""
    return {row["name"]: row["note"] or "" for row in conn.execute("SELECT name, note FROM cabinets")}


def _cabinet_note(location: str, cabinet_notes: dict) -> str:
    """依「櫃子 | 位置」格式取出櫃子名稱並查位置說明；非櫃子位置回傳空字串。"""
    cabinet = (location or "").split(" | ", 1)[0].strip()
    return cabinet_notes.get(cabinet, "") if cabinet else ""


def _build_position_sheet(ws, positions, qty_types, cabinet_notes):
    """每個庫存位置各輸出一列，並省略分類資料；櫃子說明取自設定頁櫃子清單。"""
    headers = ["品項編號(系統編號)", "庫存區", "廠牌", "品項名稱", "型號", "單位", "位置", "位置數量", "位置備註", "櫃子說明"]
    _write_headers(ws, headers)
    _style_header(ws, 5)
    for row in positions:
        ws.append([row["id"], _site_label(row["site"]), _safe(row["brand"] or "未設定廠牌"), _safe(row["name"]), _safe(row["code"]), _safe(row["unit"]), _safe(row["location"]), row["qty"], _safe(row["note"]),
                   _safe(_cabinet_note(row["location"], cabinet_notes))])
    if positions:
        _add_table(ws, "tblPosition", 5)
        _style_data(ws, 5, qty_columns=(8,), note_columns=(9, 10))
        for row in range(6, ws.max_row + 1):
            ws.cell(row, 8).number_format = _qty_format(qty_types.get(str(ws.cell(row, 6).value).lstrip("'"), "decimal"))
    else:
        _write_empty(ws, 6)




# ========== 整組庫存專用匯出 Builders ==========

KIT_POSITION_STOCK = "庫存位置"
KIT_POSITION_SUGGESTED = "建議存放位置"


def _kit_location_text(cabinet: str, position: str) -> str:
    """建議存放位置沿用單一庫存的「櫃子 | 位置」格式。"""
    cabinet = (cabinet or "").strip()
    position = (position or "").strip()
    if cabinet and position:
        return f"{cabinet} | {position}"
    return cabinet or position


def _kit_totals(kit_positions) -> dict:
    """整組總量只加總 item_stocks 實際庫存列（建議存放位置不計數量）。"""
    qty_by_id: dict = {}
    for position in kit_positions:
        qty_by_id[position["id"]] = qty_by_id.get(position["id"], 0) + (position["qty"] or 0)
    return qty_by_id


def _kit_component_state(stock: float, need: float) -> str:
    """與整組頁材料狀態一致：缺料 / 庫存不足 / 正常（1e-9 容差）。"""
    if need > 0 and stock <= 0:
        return "缺料"
    if stock < need - 1e-9:
        return "庫存不足"
    return "正常"


def _kit_material_status(components) -> str:
    """整組材料狀態：任一缺料 → 缺料；否則任一不足 → 庫存不足；否則正常。"""
    states = [_kit_component_state(c["stock"] or 0, c["need_qty"] or 0) for c in components]
    if "缺料" in states:
        return "缺料"
    if "庫存不足" in states:
        return "庫存不足"
    return "正常"


def _kit_stock_status(available: float, low_stock: float) -> str:
    """整組庫存狀態，規則與單一庫存警示相同（以可用庫存判定）。"""
    if available < 0:
        return "資料異常"
    if available == 0:
        return "缺貨"
    if low_stock and available <= low_stock:
        return "低庫存"
    return "正常"


def _build_kit_inventory_sheet(ws, kit_items, kit_positions, suggested_by_kit, components_by_kit, qty_types):
    """整組庫存總表；總庫存以 item_stocks 列加總，建議存放位置另列文字欄。"""
    headers = ["整組編號(系統編號)", "庫存區", "廠牌", "整組名稱", "型號", "單位", "低庫存門檻", "待領出", "總庫存",
               "可用庫存", "庫存狀態", "組成材料數", "材料狀態", "建議存放位置", "備註"]
    _write_headers(ws, headers)
    _style_header(ws, 5)
    qty_by_id = _kit_totals(kit_positions)

    for item in kit_items:
        qty = qty_by_id.get(item["id"], 0)
        prepared = item["prepared_qty"] or 0
        available = qty - prepared
        low_stock = item["low_stock"] or 0
        components = components_by_kit.get(item["kit_id"], [])
        suggested = "、".join(
            text for text in (_kit_location_text(loc["cabinet"], loc["position"]) for loc in suggested_by_kit.get(item["kit_id"], []))
            if text
        )
        ws.append([item["id"], _site_label(item["site"]), _safe(item["brand"] or "未設定廠牌"), _safe(item["name"]), _safe(item["code"]),
                   _safe(item["unit"]), low_stock, prepared, qty, available, _kit_stock_status(available, low_stock),
                   len(components), _kit_material_status(components) if components else "未設定材料", _safe(suggested), _safe(item["note"] or "")])

    if kit_items:
        _add_table(ws, "tblKitInventory", 5)
        _style_data(ws, 5, qty_columns=(7, 8, 9, 10), note_columns=(14, 15))
        for row in range(6, ws.max_row + 1):
            ws.cell(row, 1).alignment = Alignment(horizontal="center")
            fmt = _qty_format(qty_types.get(str(ws.cell(row, 6).value).lstrip("'"), "decimal"))
            for col in (8, 9, 10):
                ws.cell(row, col).number_format = fmt
        status_range = f"K6:K{ws.max_row}"
        for status, color in STATUS_FILLS.items():
            ws.conditional_formatting.add(status_range, FormulaRule(formula=[f'$K6="{status}"'], fill=PatternFill("solid", fgColor=color)))
    else:
        _write_empty(ws, 6)


def _build_kit_position_sheet(ws, kit_items, kit_positions, suggested_by_kit, qty_types, cabinet_notes):
    """整組位置明細：先列 item_stocks 實際庫存位置（含數量），再列編輯整組時填的建議存放位置（不計數量）。"""
    headers = ["整組編號(系統編號)", "庫存區", "廠牌", "整組名稱", "型號", "單位", "位置", "位置數量", "位置備註", "位置類型", "櫃子說明"]
    _write_headers(ws, headers)
    _style_header(ws, 5)
    items_by_id = {item["id"]: item for item in kit_items}

    for item in kit_positions:
        kit = items_by_id.get(item["id"])
        site = _site_label(kit["site"]) if kit else ""
        ws.append([item["id"], site, _safe(item["brand"] or "未設定廠牌"), _safe(item["name"]), _safe(item["code"]), _safe(item["unit"]),
                   _safe(item["location"] or ""), item["qty"] or 0, _safe(item["note"] or ""), KIT_POSITION_STOCK,
                   _safe(_cabinet_note(item["location"], cabinet_notes))])
    for kit in kit_items:
        for loc in suggested_by_kit.get(kit["kit_id"], []):
            ws.append([kit["id"], _site_label(kit["site"]), _safe(kit["brand"] or "未設定廠牌"), _safe(kit["name"]), _safe(kit["code"]),
                       _safe(kit["unit"]), _safe(_kit_location_text(loc["cabinet"], loc["position"])), None, _safe(loc["note"] or ""),
                       KIT_POSITION_SUGGESTED, _safe(cabinet_notes.get((loc["cabinet"] or "").strip(), ""))])

    if ws.max_row > 5:
        _add_table(ws, "tblKitPosition", 5)
        _style_data(ws, 5, qty_columns=(8,), note_columns=(9, 11))
        for row in range(6, ws.max_row + 1):
            ws.cell(row, 8).number_format = _qty_format(qty_types.get(str(ws.cell(row, 6).value).lstrip("'"), "decimal"))
    else:
        _write_empty(ws, 6)


def _build_kit_component_sheet(ws, kit_items, components_by_kit, qty_types):
    """整組組成材料（BOM）：每個整組的每項材料一列，含需求量、目前庫存與缺料狀態。"""
    headers = ["整組編號(系統編號)", "整組名稱", "材料編號(系統編號)", "廠牌", "材料名稱", "型號", "單位", "每組需求", "目前庫存",
               "可組數", "材料狀態"]
    _write_headers(ws, headers)
    _style_header(ws, 5)

    for kit in kit_items:
        for comp in components_by_kit.get(kit["kit_id"], []):
            need = comp["need_qty"] or 0
            stock = comp["stock"] or 0
            buildable = int(stock // need) if need > 0 and stock > 0 else 0
            ws.append([kit["id"], _safe(kit["name"]), comp["item_id"], _safe(comp["brand"] or "未設定廠牌"), _safe(comp["name"]),
                       _safe(comp["code"]), _safe(comp["unit"]), need, stock, buildable, _kit_component_state(stock, need)])

    if ws.max_row > 5:
        _add_table(ws, "tblKitComponent", 5)
        _style_data(ws, 5, qty_columns=(8, 9, 10))
        for row in range(6, ws.max_row + 1):
            fmt = _qty_format(qty_types.get(str(ws.cell(row, 7).value).lstrip("'"), "decimal"))
            for col in (8, 9):
                ws.cell(row, col).number_format = fmt
        status_range = f"K6:K{ws.max_row}"
        for status, color in (("缺料", "FECACA"), ("庫存不足", "FED7AA")):
            ws.conditional_formatting.add(status_range, FormulaRule(formula=[f'$K6="{status}"'], fill=PatternFill("solid", fgColor=color)))
    else:
        _write_empty(ws, 6, "目前沒有整組組成材料")


def _build_kit_alert_sheet(ws, kit_items, kit_positions, components_by_kit):
    """整組庫存警示：可用庫存缺貨/低庫存，或組成材料缺料/不足的整組。"""
    headers = ["整組編號(系統編號)", "庫存區", "廠牌", "整組名稱", "型號", "低庫存門檻", "待領出", "目前庫存", "可用庫存", "庫存狀態", "材料狀態"]
    _write_headers(ws, headers)
    _style_header(ws, 5)
    qty_by_id = _kit_totals(kit_positions)
    alerts = []

    for item in kit_items:
        qty = qty_by_id.get(item["id"], 0)
        prepared = item["prepared_qty"] or 0
        available = qty - prepared
        low_stock = item["low_stock"] or 0
        stock_status = _kit_stock_status(available, low_stock)
        components = components_by_kit.get(item["kit_id"], [])
        material_status = _kit_material_status(components) if components else "未設定材料"
        if stock_status != "正常" or material_status != "正常":
            alerts.append([item["id"], _site_label(item["site"]), _safe(item["brand"] or "未設定廠牌"), _safe(item["name"]), _safe(item["code"]),
                           low_stock, prepared, qty, available, stock_status, material_status])

    if alerts:
        for row in alerts:
            ws.append(row)
        _add_table(ws, "tblKitAlert", 5)
        _style_data(ws, 5, qty_columns=(7, 8, 9))
    else:
        _write_empty(ws, 6, "目前沒有低庫存、缺貨或缺料的整組")


def _build_movement_sheet(ws, movements):
    """建立期間異動紀錄，保留原始數量並依值套用顯示格式。"""
    headers = ["時間", "異動類型", "品項編號(系統編號)", "廠牌", "品項名稱", "型號", "庫存區", "變動量", "異動前", "異動後", "去向", "原因"]
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


def _build_overview(ws: Worksheet, inventory_available: bool, period: str) -> None:
    """使用庫存總表建立可選的 KPI 與庫存區摘要。

    Args:
        ws: 要填入資料的總覽工作表。
        inventory_available: 是否有匯出含資料的庫存總表。
        period: 與其他報表工作表共用的顯示期間。
    """
    _style_title(ws, "單一庫存－總覽", period, header_count=2)
    _write_headers(ws, ["指標", "數值"])
    _style_header(ws, 5)
    kpis = [
        ("品項數", '=ROWS(tblInventory[品項編號(系統編號)])' if inventory_available else "=0"),
        ("總庫存", '=SUM(tblInventory[總庫存])' if inventory_available else "=SUM(0)"),
        ("待領出", '=SUM(tblInventory[待領出])' if inventory_available else "=SUM(0)"),
        ("可用庫存", '=SUM(tblInventory[可用庫存])' if inventory_available else "=SUM(0)"),
        ("低庫存", '=COUNTIF(tblInventory[庫存狀態],"低庫存")' if inventory_available else "=0"),
        ("缺貨", '=COUNTIF(tblInventory[庫存狀態],"缺貨")' if inventory_available else "=0"),
    ]
    for label, formula in kpis:
        ws.append([label, formula])
    ws["A14"] = "各庫存區摘要"
    ws["A14"].font = Font(bold=True, size=13, color=TITLE_FILL)
    _write_headers(ws, ["庫存區", "品項數", "總庫存", "待領出", "可用", "低庫存", "缺貨"], row=15)
    _style_header(ws, 15)
    for site in SITE_ORDER:
        row = ws.max_row + 1
        if inventory_available:
            values = [
                f'=COUNTIF(tblInventory[庫存區],A{row})',
                f'=SUMIF(tblInventory[庫存區],A{row},tblInventory[總庫存])',
                f'=SUMIF(tblInventory[庫存區],A{row},tblInventory[待領出])',
                f'=SUMIF(tblInventory[庫存區],A{row},tblInventory[可用庫存])',
                f'=COUNTIFS(tblInventory[庫存區],A{row},tblInventory[庫存狀態],"低庫存")',
                f'=COUNTIFS(tblInventory[庫存區],A{row},tblInventory[庫存狀態],"缺貨")',
            ]
        else:
            values = ["=0", "=SUM(0)", "=SUM(0)", "=SUM(0)", "=0", "=0"]
        ws.append([SITES[site], *values])


def _build_stats_sheet(ws: Worksheet, items: Iterable, positions: Iterable, inventory_available: bool, period: str) -> None:
    """建立可選的庫存區、分類與廠牌摘要。

    庫存總表與位置明細未包含分類欄位，因此分類總量
    依匯出快照計算。

    Args:
        ws: 要填入資料的統計工作表。
        items: 包含分類欄位、供彙總使用的品項資料列。
        positions: 用於計算現有庫存總量的位置資料列。
        inventory_available: 是否可使用公式彙總庫存總表。
        period: 與其他報表工作表共用的顯示期間。
    """
    _style_title(ws, "單一庫存－統計", period, header_count=7)
    _write_stats_headers(ws)
    quantity_by_item = _quantity_by_item(positions)
    for site in SITE_ORDER:
        row = ws.max_row + 1
        ws.append([SITES[site], *_site_measures(site, row, items, quantity_by_item, inventory_available)])
    category_totals, brand_totals = _aggregate_category_brand_totals(items, quantity_by_item)
    _write_category_brand_rows(ws, category_totals, brand_totals, inventory_available)
    if not items:
        ws["J6"] = "目前無資料"
        ws["O6"] = "目前無資料"


def _write_stats_headers(ws: Worksheet) -> None:
    """寫入庫存統計工作表三張摘要表的標題與表頭。"""
    ws["A4"] = "庫存區統計"
    ws["J4"] = "分類統計"
    ws["O4"] = "廠牌統計"
    for cell in (ws["A4"], ws["J4"], ws["O4"]):
        cell.font = Font(bold=True, size=13, color=TITLE_FILL)
    # 左側庫存區表頭由 _write_headers() 套用；分類/廠牌表頭套用相同樣式
    _write_headers(ws, ["庫存區", "品項數", "總庫存", "待領出", "可用庫存", "低庫存", "缺貨"], row=5)
    for start_column, first_header in ((10, "分類"), (15, "廠牌")):
        for column, header in enumerate([first_header, "品項數", "總庫存", "可用庫存"], start_column):
            cell = ws.cell(5, column)
            cell.value = header
            cell.font = Font(name="Microsoft JhengHei", bold=True, size=11, color="FFFFFF")
            cell.fill = PatternFill("solid", fgColor=HEADER_FILL)
            cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)


def _quantity_by_item(positions: Iterable) -> dict:
    """依位置資料列彙總每個品項的現有庫存總量。"""
    quantity_by_item: dict = {}
    for position in positions:
        item_id = position["id"]
        quantity_by_item[item_id] = quantity_by_item.get(item_id, 0) + (position["qty"] or 0)
    return quantity_by_item


def _site_measures(site: str, row: int, items: Iterable, quantity_by_item: dict, inventory_available: bool) -> list:
    """單一庫存區的六項統計：有庫存總表時用公式，否則由快照計算。"""
    if inventory_available:
        return [
            f'=COUNTIF(tblInventory[庫存區],A{row})',
            f'=SUMIF(tblInventory[庫存區],A{row},tblInventory[總庫存])',
            f'=SUMIF(tblInventory[庫存區],A{row},tblInventory[待領出])',
            f'=SUMIF(tblInventory[庫存區],A{row},tblInventory[可用庫存])',
            f'=COUNTIFS(tblInventory[庫存區],A{row},tblInventory[庫存狀態],"低庫存")',
            f'=COUNTIFS(tblInventory[庫存區],A{row},tblInventory[庫存狀態],"缺貨")',
        ]
    site_items = [item for item in items if item["site"] == site]
    return [
        len(site_items),
        sum(quantity_by_item.get(item["id"], 0) for item in site_items),
        sum(item["prepared_qty"] or 0 for item in site_items),
        sum(quantity_by_item.get(item["id"], 0) - (item["prepared_qty"] or 0) for item in site_items),
        sum(1 for item in site_items if 0 < quantity_by_item.get(item["id"], 0) - (item["prepared_qty"] or 0) <= (item["low_stock"] or 0) and (item["low_stock"] or 0) > 0),
        sum(1 for item in site_items if quantity_by_item.get(item["id"], 0) - (item["prepared_qty"] or 0) == 0),
    ]


def _aggregate_category_brand_totals(items: Iterable, quantity_by_item: dict) -> tuple[dict, dict]:
    """回傳 (分類彙總, 廠牌彙總)，值為 [品項數, 總庫存, 可用庫存]。"""
    category_totals: dict = {}
    brand_totals: dict = {}
    for item in items:
        total = quantity_by_item.get(item["id"], 0)
        available = total - (item["prepared_qty"] or 0)
        category = item["category"] or "未分類"
        brand = item["brand"] or "未設定廠牌"
        for table, label in ((category_totals, category), (brand_totals, brand)):
            values = table.setdefault(label, [0, 0, 0])
            values[0] += 1
            values[1] += total
            values[2] += available
    return category_totals, brand_totals


def _write_category_brand_rows(ws: Worksheet, category_totals: dict, brand_totals: dict, inventory_available: bool) -> None:
    for row, (category, values) in enumerate(sorted(category_totals.items()), 6):
        ws.cell(row, 10).value = _safe(category)
        ws.cell(row, 11).value = values[0]
        ws.cell(row, 12).value = values[1]
        ws.cell(row, 13).value = values[2]
    for row, (brand, values) in enumerate(sorted(brand_totals.items()), 6):
        ws.cell(row, 15).value = _safe(brand)
        if inventory_available:
            ws.cell(row, 16).value = f'=COUNTIF(tblInventory[廠牌],O{row})'
            ws.cell(row, 17).value = f'=SUMIF(tblInventory[廠牌],O{row},tblInventory[總庫存])'
            ws.cell(row, 18).value = f'=SUMIF(tblInventory[廠牌],O{row},tblInventory[可用庫存])'
        else:
            ws.cell(row, 16).value, ws.cell(row, 17).value, ws.cell(row, 18).value = values


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
    if reason == "領出結帳":
        return "領出結帳"
    if reason.startswith("出庫"):
        return "出庫"
    if reason == "退回已領出":
        return "退回"
    if reason == "退回準備":
        return "退回準備"
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


def _build_alert_sheet(ws, items, positions, inventory_available: bool):
    """依庫存總表或獨立快照值建立警示資料列。"""
    headers = ["庫存狀態", "品項編號(系統編號)", "庫存區", "廠牌", "品項名稱", "型號", "單位", "總庫存", "待領出", "可用庫存", "低庫存門檻"]
    _write_headers(ws, headers)
    _style_header(ws, 5)
    if inventory_available and items:
        for row in range(6, len(items) + 6):
            match_formula = "MATCH(ROW()-5,tblInventory[警示序號],0)"
            for column, header in enumerate(headers, 1):
                ws.cell(row, column).value = f'=IFERROR(INDEX(tblInventory[{header}],{match_formula}),"")'
    else:
        totals = {}
        for position in positions:
            totals[position["id"]] = totals.get(position["id"], 0) + (position["qty"] or 0)
        for item in items:
            total = totals.get(item["id"], 0)
            prepared = item["prepared_qty"] or 0
            available = total - prepared
            threshold = item["low_stock"] or 0
            status = "資料異常" if available < 0 else "缺貨" if available == 0 else "低庫存" if threshold > 0 and available <= threshold else "正常"
            if status != "正常":
                ws.append([status, item["id"], _site_label(item["site"]), _safe(item["brand"] or "未設定廠牌"), _safe(item["name"]), _safe(item["code"]), _safe(item["unit"]), total, prepared, available, threshold])
        if ws.max_row == 5:
            _write_empty(ws, 6)


def _filter_inventory_movements(movements):
    """單一庫存匯出的異動過濾：排除整組自身異動、領出準備流程、盤點與非庫存品項（這些只在整組 / 已領出匯出出現）。
    「退回已領出」是例外，同時出現在單一庫存與已領出匯出。"""
    # 過濾規則：
    # 1. 整組異動（組裝完成、組裝套件、拆解、拆解套件）— 只在整組匯出中顯示
    # 2. 待領出流程前段（領出準備、領出結帳、退回準備）— 只在已領出匯出中顯示
    # 3. 盤點異動（盤點調整等）
    # 4. Nonstock 異動（is_deleted=1）— 只在已領出匯出中顯示
    # P0 決策：退回已領出 同時顯示在單一庫存及已領出匯出（例外）
    filtered_movements = []
    # 整組自身 movement（is_kit=1）排除：組裝完成、拆解 等
    # 但保留子材料 movement（is_kit=0）：組裝套件、拆解套件 等
    kit_movement_prefixes = ("組裝完成", "拆解")

    for row in movements:
        reason = row["reason"] if "reason" in row.keys() else ""
        is_deleted = row["is_deleted"] if "is_deleted" in row.keys() else 0
        is_kit = row["is_kit"] if "is_kit" in row.keys() else 0

        # 判定是否排除
        is_kit_movement = is_kit and any(reason.startswith(p) for p in kit_movement_prefixes)
        is_checkpoint = reason.startswith("盤點")
        is_nonstock = is_deleted == 1
        is_leadout_prep = reason in ("領出準備", "領出結帳", "退回準備")

        # 排除：整組 movement、盤點、nonstock、領出準備流程
        if not (is_kit_movement or is_checkpoint or is_nonstock or is_leadout_prep):
            filtered_movements.append(row)
    return filtered_movements


class _InventoryExportData(NamedTuple):
    """單一庫存匯出所需資料：查詢與建表之間的傳遞單位。"""
    items: list
    positions: list
    movements: list
    qty_types: dict
    cabinet_notes: dict


class _KitExportData(NamedTuple):
    """整組匯出所需資料：查詢與建表之間的傳遞單位。"""
    kit_items: list
    kit_positions: list
    suggested_by_kit: dict
    components_by_kit: dict
    movements: list
    qty_types: dict
    cabinet_notes: dict


def _query_inventory_export(selected_sites, start, end) -> _InventoryExportData:
    """單一庫存匯出所需資料。"""
    with db_session() as conn:
        items = conn.execute("SELECT id, site, category, brand, name, code, unit, low_stock, prepared_qty FROM items WHERE is_deleted=0 AND site IN (%s) ORDER BY brand COLLATE NOCASE, name, id" % ",".join("?" * len(selected_sites)), selected_sites).fetchall()
        positions = conn.execute("SELECT i.id, i.site, i.brand, i.name, i.code, i.unit, s.location, s.qty, s.note FROM items i JOIN item_stocks s ON s.item_id=i.id WHERE i.is_deleted=0 AND i.site IN (%s) ORDER BY i.id, s.id" % ",".join("?" * len(selected_sites)), selected_sites).fetchall()
        movement_site = "COALESCE(NULLIF(m.return_site,''), NULLIF(m.source_site,''), NULLIF(i.site,''), '')"
        site_placeholders = ",".join("?" * len(selected_sites))
        movement_sql = (
            "SELECT m.created_at, m.item_id, m.delta, m.before_qty, m.after_qty, "
            "m.destination, m.reason, " + movement_site + " AS site, "
            "i.brand, i.name, i.code, i.is_kit, i.is_deleted "
            "FROM movements m JOIN items i ON i.id=m.item_id "
            "WHERE (((" + movement_site + f" IN ({site_placeholders}) OR "
            + movement_site + " = '') AND m.created_at >= ? AND m.created_at < ?)) "
            "ORDER BY m.created_at DESC, m.id DESC"
        )
        movements = conn.execute(
            movement_sql,
            [*selected_sites, movement_time.datetime_to_sql(start), movement_time.datetime_to_sql(end)],
        ).fetchall()
        movements = _filter_inventory_movements(movements)
        qty_types = {row["name"]: row["qty_type"] for row in conn.execute("SELECT name, qty_type FROM units")}
        cabinet_notes = _load_cabinet_notes(conn)
    return _InventoryExportData(items, positions, movements, qty_types, cabinet_notes)


def _build_inventory_workbook(selected_sections, period_text, data: _InventoryExportData):
    """依所選工作表建立單一庫存活頁簿（尚未套用全域樣式）。"""
    items, positions, movements, qty_types, cabinet_notes = data
    wb = _new_workbook()
    if "overview" in selected_sections:
        overview = wb.create_sheet("01 單一庫存－總覽")
        _build_overview(overview, "inventory" in selected_sections and bool(items), period_text)
    if "inventory" in selected_sections:
        inventory = wb.create_sheet("單一庫存－庫存總表")
        _style_title(inventory, "單一庫存－庫存總表", period_text, header_count=13)
        _build_inventory_sheet(inventory, items, positions, "positions" in selected_sections and bool(positions), qty_types)
    if "positions" in selected_sections:
        position = wb.create_sheet("單一庫存－位置明細")
        _style_title(position, "單一庫存－位置明細", period_text, header_count=10)
        _build_position_sheet(position, positions, qty_types, cabinet_notes)
    if "alerts" in selected_sections:
        alerts = wb.create_sheet("單一庫存－庫存警示")
        _style_title(alerts, "單一庫存－庫存警示", period_text, header_count=11)
        _build_alert_sheet(alerts, items, positions, "inventory" in selected_sections and bool(items))
    if "movements" in selected_sections:
        movement = wb.create_sheet("單一庫存－異動紀錄")
        _style_title(movement, "單一庫存－異動紀錄", period_text, header_count=12)
        _build_movement_sheet(movement, movements)
    if "stats" in selected_sections:
        stats = wb.create_sheet("06 單一庫存－統計")
        _build_stats_sheet(stats, items, positions, "inventory" in selected_sections and bool(items), period_text)
    return wb


@router.get("/api/export", dependencies=[Depends(require_perm("export"))])
def export_excel(month: str | None = None, start_date: str | None = None, end_date: str | None = None, days: int | None = None, sites: str | None = None, sections: str | None = None):
    """驗證請求參數，並回傳所選的庫存報表工作表。

    Args:
        month: 可選的 YYYY-MM 期間。
        start_date: YYYY-MM-DD 格式的自訂區間起日（含）。
        end_date: YYYY-MM-DD 格式的自訂區間迄日（含）。
        days: 可選的近幾日區間。
        sites: 以逗號分隔的內部庫存區識別碼。
        sections: 以逗號分隔的匯出工作表識別碼。

    Returns:
        包含所選工作表的 XLSX 下載回應。

    Raises:
        HTTPException: 日期範圍、庫存區或工作表識別值不合法時引發。
    """
    selected_sections = _parse_export_sections(sections, DEFAULT_EXPORT_SECTIONS, SINGLE_EXPORT_SECTIONS)
    start, end, period, display_period = _resolve_export_period(month, start_date, end_date, days)
    selected_sites = list(SITE_ORDER) if not sites else [s for s in sites.split(",") if s]
    if not selected_sites or any(s not in SITES for s in selected_sites):
        raise HTTPException(400, "sites 含有不合法的庫存區")
    data = _query_inventory_export(selected_sites, start, end)
    wb = _build_inventory_workbook(selected_sections, _period_text(period, display_period), data)
    content = _finalize_workbook(wb)
    return xlsx_download(content, _report_filename("庫存報表", month, start_date, end_date))


def _query_kit_export(start, end) -> _KitExportData:
    """整組匯出所需資料。"""
    with db_session() as conn:
        # 查詢整組品項（is_kit=1）；kits 定義提供 kit_id / 備註，庫存區與品牌型號以 items 為準
        kit_items = conn.execute(
            "SELECT i.id, i.site, i.brand, i.name, i.code, i.unit, i.low_stock, i.prepared_qty, "
            "k.id AS kit_id, k.note "
            "FROM items i LEFT JOIN kits k ON k.item_id=i.id "
            "WHERE i.is_kit=1 AND i.is_deleted=0 "
            "ORDER BY i.brand COLLATE NOCASE, i.name, i.id"
        ).fetchall()

        # item_stocks 是整組實際位置與數量的唯一來源
        kit_positions = conn.execute(
            "SELECT i.id, i.brand, i.name, i.code, i.unit, s.location, s.qty, s.note "
            "FROM items i JOIN item_stocks s ON s.item_id=i.id "
            "WHERE i.is_kit=1 AND i.is_deleted=0 "
            "ORDER BY i.id, s.id"
        ).fetchall()

        # 編輯整組填寫的建議存放位置（櫃子/位置/備註）；只輸出文字，不計入數量
        suggested_by_kit: dict = {}
        for row in conn.execute(
            "SELECT kl.kit_id, kl.cabinet, kl.position, kl.note FROM kit_locations kl "
            "JOIN kits k ON k.id=kl.kit_id JOIN items i ON i.id=k.item_id "
            "WHERE i.is_kit=1 AND i.is_deleted=0 ORDER BY kl.kit_id, kl.id"
        ):
            suggested_by_kit.setdefault(row["kit_id"], []).append(row)

        # 組成材料（BOM）與材料目前總庫存
        components_by_kit: dict = {}
        for row in conn.execute(
            "SELECT ki.kit_id, ki.item_id, ki.qty AS need_qty, m.brand, m.name, m.code, m.unit, "
            "COALESCE((SELECT SUM(s.qty) FROM item_stocks s WHERE s.item_id=ki.item_id), 0) AS stock "
            "FROM kit_items ki JOIN items m ON m.id=ki.item_id "
            "JOIN kits k ON k.id=ki.kit_id JOIN items i ON i.id=k.item_id "
            "WHERE i.is_kit=1 AND i.is_deleted=0 ORDER BY ki.kit_id, ki.id"
        ):
            components_by_kit.setdefault(row["kit_id"], []).append(row)

        # 查詢整組異動（只含組裝/拆解）
        movement_sql = (
            "SELECT m.created_at, m.item_id, m.delta, m.before_qty, m.after_qty, "
            "m.destination, m.reason, i.site, i.brand, i.name, i.code "
            "FROM movements m JOIN items i ON i.id=m.item_id "
            "WHERE i.is_kit=1 AND (m.reason LIKE '組裝%' OR m.reason LIKE '拆解%') "
            "AND m.created_at >= ? AND m.created_at < ? "
            "ORDER BY m.created_at DESC, m.id DESC"
        )
        movements = conn.execute(movement_sql, [movement_time.datetime_to_sql(start), movement_time.datetime_to_sql(end)]).fetchall()
        
        qty_types = {row["name"]: row["qty_type"] for row in conn.execute("SELECT name, qty_type FROM units")}
        cabinet_notes = _load_cabinet_notes(conn)
    
    return _KitExportData(kit_items, kit_positions, suggested_by_kit, components_by_kit, movements, qty_types, cabinet_notes)


def _build_kit_workbook(selected_sections, period_text, data: _KitExportData):
    """依所選工作表建立整組活頁簿（尚未套用全域樣式）。"""
    (kit_items, kit_positions, suggested_by_kit, components_by_kit,
     movements, qty_types, cabinet_notes) = data
    wb = _new_workbook()
    
    
    if "overview" in selected_sections:
        overview = wb.create_sheet("01 整組－總覽")
        _style_title(overview, "整組－總覽", period_text, header_count=2)
        # 簡化的整組 KPI（無庫存區概念）
        _write_headers(overview, ["指標", "數值"])
        _style_header(overview, 5)
        kpis = [
            ("整組數", len(kit_items)),
            ("總庫存", sum((item["qty"] or 0) for item in kit_positions)),
            ("待領出", sum((item["prepared_qty"] or 0) for item in kit_items)),
            ("缺料整組數", sum(1 for item in kit_items if _kit_material_status(components_by_kit.get(item["kit_id"], [])) == "缺料")),
        ]
        for label, value in kpis:
            overview.append([label, value])
    
    if "inventory" in selected_sections:
        inventory = wb.create_sheet("整組－庫存總表")
        _style_title(inventory, "整組－庫存總表", period_text, header_count=15)
        _build_kit_inventory_sheet(inventory, kit_items, kit_positions, suggested_by_kit, components_by_kit, qty_types)
    
    if "positions" in selected_sections:
        position = wb.create_sheet("整組－位置明細")
        _style_title(position, "整組－位置明細", period_text, header_count=11)
        _build_kit_position_sheet(position, kit_items, kit_positions, suggested_by_kit, qty_types, cabinet_notes)

    if "components" in selected_sections:
        component = wb.create_sheet("整組－組成材料")
        _style_title(component, "整組－組成材料", period_text, header_count=11)
        _build_kit_component_sheet(component, kit_items, components_by_kit, qty_types)
    
    if "alerts" in selected_sections:
        alerts = wb.create_sheet("整組－庫存警示")
        _style_title(alerts, "整組－庫存警示", period_text, header_count=11)
        # 顯示低庫存/缺貨/缺料的整組
        _build_kit_alert_sheet(alerts, kit_items, kit_positions, components_by_kit)
    
    if "movements" in selected_sections:
        movement = wb.create_sheet("整組－異動紀錄")
        _style_title(movement, "整組－異動紀錄", period_text, header_count=12)
        _build_movement_sheet(movement, movements)
    
    return wb


@router.get("/api/kit-export", dependencies=[Depends(require_perm("export"))])
def export_kit_excel(month: str | None = None, start_date: str | None = None, end_date: str | None = None, days: int | None = None, sections: str | None = None):
    """
    整組庫存專用匯出端點 (2026-09-27)
    
    類似單一庫存匯出，但只含整組品項、位置、組成材料與異動紀錄。
    整組庫存區以 items.site 輸出為欄位（不提供庫存區篩選）。
    
    Args:
        month: 可選的 YYYY-MM 期間。
        start_date: YYYY-MM-DD 格式的自訂區間起日。
        end_date: YYYY-MM-DD 格式的自訂區間迄日。
        days: 可選的近幾日區間。
        sections: 以逗號分隔的工作表識別碼。
    
    Returns:
        包含所選工作表的 XLSX 下載回應。
    """
    selected_sections = _parse_export_sections(sections, DEFAULT_EXPORT_SECTIONS, KIT_EXPORT_SECTIONS)
    start, end, period, display_period = _resolve_export_period(month, start_date, end_date, days)
    
    data = _query_kit_export(start, end)
    wb = _build_kit_workbook(selected_sections, _period_text(period, display_period), data)
    content = _finalize_workbook(wb)
    return xlsx_download(content, _report_filename("整組報表", month, start_date, end_date))


def _query_stockout_movements(start, end):
    """已領出匯出的異動：直接出庫（出庫%）+ 退回已領出。"""
    with db_session() as conn:
        # 查詢已領出的異動：直接出庫（出庫%）+ 退回已領出
        # 對齊 /api/stockouts contract: m.delta < 0 AND m.reason LIKE '出庫%'
        movement_sql = (
            "SELECT m.created_at, m.item_id, m.delta, m.before_qty, m.after_qty, "
            "m.destination, m.reason, i.site, i.brand, i.name, i.code, i.is_kit, i.is_deleted "
            "FROM movements m JOIN items i ON i.id=m.item_id "
            "WHERE ((m.delta < 0 AND m.reason LIKE '出庫%') OR m.reason = '退回已領出') "
            "AND m.created_at >= ? AND m.created_at < ? "
            "ORDER BY m.created_at DESC, m.id DESC"
        )
        movements = conn.execute(movement_sql, [movement_time.datetime_to_sql(start), movement_time.datetime_to_sql(end)]).fetchall()
    
    return movements


def _build_stockout_overview(overview, movements, period_text):
    """已領出總覽：領出紀錄數與累計領出數量。"""
    _style_title(overview, "已領出－總覽", period_text, header_count=2)
    # 已領出 KPI
    _write_headers(overview, ["指標", "數值"])
    _style_header(overview, 5)

    # 統計已領出的異動
    movement_count = len(movements)
    total_delta = sum(abs(m["delta"]) for m in movements)

    kpis = [
        ("領出紀錄數", movement_count),
        ("累計領出數量", total_delta),
    ]
    for i, (label, value) in enumerate(kpis, 6):
        overview[f"A{i}"] = label
        overview[f"B{i}"] = value
        overview[f"B{i}"].number_format = "@" if isinstance(value, str) else "0"



def _build_stockout_movement_sheet(movement, movements, period_text):
    """已領出異動紀錄工作表（含格式與凍結窗格）。"""
    _style_title(movement, "已領出－異動紀錄", period_text, header_count=12)
    headers = ["時間", "異動類型", "品項編號(系統編號)", "廠牌", "品項名稱", "型號", "庫存區", "變動量", "異動前", "異動後", "去向", "原因"]
    _write_headers(movement, headers)
    _style_header(movement, 5)

    row = 6
    for m in movements:
        movement[f"A{row}"] = _safe(m["created_at"])
        movement[f"B{row}"] = _safe(_movement_type(m["reason"] or "", m["delta"]))
        movement[f"C{row}"] = m["item_id"]
        movement[f"D{row}"] = _safe(m["brand"])
        movement[f"E{row}"] = _safe(m["name"])
        movement[f"F{row}"] = _safe(m["code"])
        movement[f"G{row}"] = _safe(SITES.get(m["site"], m["site"]))
        movement[f"H{row}"] = m["delta"]
        movement[f"I{row}"] = m["before_qty"]
        movement[f"J{row}"] = m["after_qty"]
        movement[f"K{row}"] = _safe(m["destination"])
        movement[f"L{row}"] = _safe(m["reason"])

        # 格式化
        for col in "ABCDEFGHIJKL":
            cell = movement[f"{col}{row}"]
            cell.font = Font(name="微軟正黑體")
            cell.alignment = Alignment(horizontal="center", vertical="center")
            if col in "CHIJ":
                cell.number_format = "0"
            else:
                cell.number_format = "@"

        row += 1

    # 凍結窗格
    id_column = {'已領出－異動紀錄': 3}.get(movement.title)
    if id_column:
        movement.freeze_panes = f"{chr(64 + id_column + 1)}6"


def _build_stockout_workbook(selected_sections, period_text, movements):
    """依所選工作表建立已領出活頁簿（尚未套用全域樣式）。"""
    wb = _new_workbook()
    if "overview" in selected_sections:
        _build_stockout_overview(wb.create_sheet("01 已領出－總覽"), movements, period_text)
    if "movements" in selected_sections:
        _build_stockout_movement_sheet(wb.create_sheet("已領出－異動紀錄"), movements, period_text)
    return wb


@router.get("/api/stockout-export", dependencies=[Depends(require_perm("export"))])
def export_stockout_excel(month: str | None = None, start_date: str | None = None, end_date: str | None = None, days: int | None = None, sections: str | None = None):
    """
    已領出專用匯出端點 (2026-09-27)
    
    已領出品項的匯出報表，包含異動紀錄與簡化的總覽。
    
    Args:
        month: 可選的 YYYY-MM 期間。
        start_date: YYYY-MM-DD 格式的自訂區間起日。
        end_date: YYYY-MM-DD 格式的自訂區間迄日。
        days: 可選的近幾日區間。
        sections: 以逗號分隔的工作表識別碼。
    
    Returns:
        包含所選工作表的 XLSX 下載回應。
    """
    selected_sections = _parse_export_sections(sections, DEFAULT_STOCKOUT_SECTIONS, STOCKOUT_EXPORT_SECTIONS)
    start, end, period, display_period = _resolve_export_period(month, start_date, end_date, days)
    
    movements = _query_stockout_movements(start, end)
    wb = _build_stockout_workbook(selected_sections, _period_text(period, display_period), movements)
    content = _finalize_workbook(wb)
    return xlsx_download(content, _report_filename("已領出報表", month, start_date, end_date))
