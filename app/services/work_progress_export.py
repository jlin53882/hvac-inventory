# -*- coding: utf-8 -*-
"""每日工作進度回報 Excel 匯出（範本填值法）。

- 範本：app/assets/工程進度回報範本.xlsx（單一工作表，A/C 兩欄內容、B 為間隔）
- 兩種版面：完整版（日期/項目/客戶/時間/地址/行事曆備註/工作進度/照片，用於整天與單筆匯出）、
  精簡版（日期/項目/工作進度/行事曆備註/照片，用於歷史搜尋條件匯出）；標題不含日期
- 完整版每筆一個工作表；精簡版同客戶合併成一個工作表（標題只放客戶、日期區塊往下接、A4 依高度自動分頁不切開區塊）。照片依張數往下排（每排 5 張、置中裁成相同正方形）
- 全部字型標楷體；使用者輸入的換行在儲存格內換行，不拆成多列
"""
from __future__ import annotations

import datetime
import io
import math
import re
from copy import copy
from pathlib import Path
from typing import Callable, Sequence

from PIL import Image as PILImage, ImageOps
from openpyxl import load_workbook
from openpyxl.drawing.image import Image as XlImage
from openpyxl.drawing.spreadsheet_drawing import AnchorMarker, OneCellAnchor
from openpyxl.drawing.xdr import XDRPositiveSize2D
from openpyxl.styles import Alignment, Side
from openpyxl.worksheet.pagebreak import Break

from app.services.safety import excel_safe

TEMPLATE_PATH = Path(__file__).resolve().parent.parent / "assets" / "工程進度回報範本.xlsx"
FONT_NAME = "標楷體"

PX_COL_A = 360          # 欄 A / C 約 50.8 字元寬
PX_COL_B = 45           # 欄 B 間隔
PX_FULL = PX_COL_A * 2 + PX_COL_B
BODY_PT = 16            # 範本內文字級
LINE_PT = 22            # 16 號字單行列高（pt）
PHOTOS_PER_ROW = 5      # 每排 5 張，全寬平均分配
PHOTO_SLOT_PX = PX_FULL // PHOTOS_PER_ROW   # 每格 153 px（正方形）
PHOTO_SLOT_PT = PHOTO_SLOT_PX * 72 / 96
PHOTO_PAD_PX = 6
PHOTO_RENDER_SCALE = 2  # 裁切後以 2 倍解析度嵌入，列印較清晰
FIRST_PHOTO_ROW = 12    # 完整版「施工照片」標題在第 11 列
COMPACT_FIRST_PHOTO_ROW = 8  # 精簡版「施工照片」標題在第 7 列
PAGE_BUDGET_PT = 740    # A4 縮放後每頁可用列高（約）
EMU_PER_PX = 9525

_BAD_SHEET_CHARS = re.compile(r"[\\/*?:\[\]]")
_BAD_FILE_CHARS = re.compile(r'[\\/:*?"<>|\x00-\x1f]')
EXPORT_FILE_PREFIX = "工程進度回報"


def _norm_text(text: str) -> str:
    """換行統一成 \\n，去掉頭尾空白行。"""
    return (text or "").replace("\r\n", "\n").replace("\r", "\n").strip("\n")


def _text_px(ch: str, pt: float) -> float:
    """單一字元估算寬度（px）：全形約等於字級，半形約一半。"""
    em = pt * 96 / 72
    return em if ord(ch) > 0x2E80 else em * 0.55


def estimate_lines(text: str, width_px: float, pt: float = BODY_PT) -> int:
    """估算文字在指定寬度內自動換行後的行數（每個段落至少 1 行）。"""
    usable = max(width_px - 12, 20)
    total = 0
    for para in _norm_text(text).split("\n"):
        w = sum(_text_px(c, pt) for c in para)
        total += max(1, math.ceil(w / usable))
    return total


def _height_pt(text: str, width_px: float) -> float:
    return max(30.0, estimate_lines(text, width_px) * LINE_PT + 8)


def sheet_title(name: str, used: set[str]) -> str:
    """工作表名稱：換掉 Excel 不允許字元（改成半形 -；全形 ／ 會被 Excel 視為非法而要求修復）、截 31 字、重名加 (n)。"""
    base = _BAD_SHEET_CHARS.sub("-", name or "").strip().strip("'") or "工作進度"
    base = base[:31]
    title, n = base, 1
    while title.lower() in used:
        n += 1
        suffix = f"({n})"
        title = base[: 31 - len(suffix)] + suffix
    used.add(title.lower())
    return title


def export_filename(*parts: str) -> str:
    """匯出檔名：工程進度回報 + 以 _ 串接的非空段落；Windows 不允許的字元換成 _，總長限 120 字。"""
    body = "_".join(p.strip() for p in parts if p and p.strip())
    body = _BAD_FILE_CHARS.sub("_", body)
    return (EXPORT_FILE_PREFIX + body)[:115] + ".xlsx"


def report_title(rpt: dict) -> str:
    """工作表標題（不含日期）：「服務．客戶」，無服務時只有客戶。"""
    service = rpt.get("service_name") or ""
    return (f"{service}．" if service else "") + (rpt.get("client_name") or "")


def _set_font(ws, max_row: int) -> None:
    for row in ws.iter_rows(min_row=1, max_row=max_row, min_col=1, max_col=3):
        for c in row:
            f = copy(c.font)
            f.name = FONT_NAME
            c.font = f


def _wrap(cell, *, horizontal=None, vertical="center") -> None:
    a = cell.alignment
    cell.alignment = Alignment(
        horizontal=horizontal if horizontal is not None else a.horizontal,
        vertical=vertical, wrap_text=True)


def _fill_header(ws, rpt: dict, title: str | None = None) -> float:
    """填範本表頭，回傳第 1~11 列總高度（pt）。"""
    d = datetime.date.fromisoformat(rpt["report_date"])
    service = rpt.get("service_name") or ""
    client = rpt.get("client_name") or ""
    title = report_title(rpt) if title is None else title
    start = rpt.get("start_time") or "未指定時間"
    appt_note = _norm_text(rpt.get("appointment_note"))
    note = _norm_text(rpt.get("note"))
    ws["A1"] = excel_safe(title)
    ws["A3"] = d
    ws["A3"].number_format = "yyyy/m/d"
    ws["C3"] = excel_safe(service)
    ws["A5"] = excel_safe(client)
    ws["C5"] = excel_safe(start)
    ws["A7"] = excel_safe(rpt.get("address") or "")
    # 版面：左欄「工作進度回報」(A8 標題、A9:A10 內容)；右欄「行事曆備註」(C6 標題、C7:C8 內容)
    ws["A8"] = "工作進度回報"
    ws["A9"] = excel_safe(note) or None
    ws["A10"] = None
    ws["C6"]._style = copy(ws["C8"]._style)
    ws["C6"] = "行事曆備註"
    ws["C7"]._style = copy(ws["C9"]._style)
    ws["C7"] = excel_safe(appt_note) or None
    ws["C8"] = None
    ws["C9"] = None
    ws["C10"] = None
    ws.merge_cells("A9:A10")
    ws.merge_cells("C7:C8")

    for ref in ("A1", "A5", "A7", "C3", "C5"):
        _wrap(ws[ref])
    _wrap(ws["A9"], horizontal="left", vertical="top")
    _wrap(ws["C7"], horizontal="left", vertical="top")

    heights = {
        1: _height_pt(title, PX_FULL),
        5: max(_height_pt(client, PX_COL_A), _height_pt(start, PX_COL_A)),
        7: _height_pt(rpt.get("address") or "", PX_COL_A),
    }
    body_pt = max(60.0, _height_pt(note, PX_COL_A))
    heights[9] = heights[10] = body_pt / 2
    # 右欄備註佔 7、8 兩列：不足時加高第 7 列
    appt_pt = _height_pt(appt_note, PX_COL_A)
    heights[8] = 30.0
    heights[7] = max(heights[7], 30.0, appt_pt - heights[8])
    for r in range(1, 12):
        ws.row_dimensions[r].height = heights.get(r, 30.0)
    return sum(ws.row_dimensions[r].height for r in range(1, 12))


def _fill_compact_header(ws, rpt: dict) -> float:
    """精簡版表頭：沿用完整版範本樣式重排成 1~7 列（左工作進度回報、右行事曆備註），回傳第 1~7 列總高度（pt）。"""
    d = datetime.date.fromisoformat(rpt["report_date"])
    service = rpt.get("service_name") or ""
    title = report_title(rpt)
    appt_note = _norm_text(rpt.get("appointment_note"))
    note = _norm_text(rpt.get("note"))
    label_style = copy(ws["A8"]._style)        # 「工作進度回報」標題樣式
    body_style = copy(ws["A9"]._style)         # 內容樣式（靠左靠上）
    blank_style = copy(ws["A10"]._style)
    photo_label_style = copy(ws["A11"]._style)
    empty_style = copy(ws["A12"]._style)
    for r in range(4, 12):
        for c in ("A", "B", "C"):
            ws[f"{c}{r}"] = None
            ws[f"{c}{r}"]._style = copy(empty_style)
    ws["A1"] = excel_safe(title)
    ws["A3"] = d
    ws["A3"].number_format = "yyyy/m/d"
    ws["C3"] = excel_safe(service)
    for ref, text in (("A4", "工作進度回報"), ("C4", "行事曆備註")):
        ws[ref]._style = copy(label_style)
        ws[ref] = text
    for ref, text in (("A5", note), ("C5", appt_note)):
        ws[ref]._style = copy(body_style)
        ws[ref] = excel_safe(text) or None
    for ref in ("A6", "C6"):
        ws[ref]._style = copy(blank_style)
    ws["A7"]._style = photo_label_style
    ws["A7"] = "施工照片"
    ws.merge_cells("A5:A6")
    ws.merge_cells("C5:C6")
    _wrap(ws["A1"])
    _wrap(ws["C3"])
    _wrap(ws["A5"], horizontal="left", vertical="top")
    _wrap(ws["C5"], horizontal="left", vertical="top")
    body_pt = max(60.0, _height_pt(note, PX_COL_A), _height_pt(appt_note, PX_COL_A))
    heights = {1: _height_pt(title, PX_FULL), 5: body_pt / 2, 6: body_pt / 2}
    for r in range(1, 8):
        ws.row_dimensions[r].height = heights.get(r, 30.0)
    return sum(ws.row_dimensions[r].height for r in range(1, 8))


def _square_crop(path: Path, side_px: int) -> io.BytesIO:
    """置中裁成正方形（同前端縮圖 cover 行為），回傳 JPEG bytes。"""
    with PILImage.open(path) as im:
        im = ImageOps.exif_transpose(im).convert("RGB")
        im = ImageOps.fit(im, (side_px, side_px), method=PILImage.LANCZOS)
        out = io.BytesIO()
        im.save(out, "JPEG", quality=85)
    out.seek(0)
    return out


def _anchor_at(x_px: int, row0: int, y_px: int, size_px: int) -> OneCellAnchor:
    """以工作表水平像素位置換算成 (欄, 欄內位移) 的單格錨點。"""
    widths = (PX_COL_A, PX_COL_B, PX_COL_A)
    col, left = 0, x_px
    while col < 2 and left >= widths[col]:
        left -= widths[col]
        col += 1
    return OneCellAnchor(
        _from=AnchorMarker(col=col, colOff=left * EMU_PER_PX, row=row0, rowOff=y_px * EMU_PER_PX),
        ext=XDRPositiveSize2D(size_px * EMU_PER_PX, size_px * EMU_PER_PX),
    )


def _add_photos(ws, photo_paths: Sequence[Path], header_pt: float, first_row: int = FIRST_PHOTO_ROW,
                on_photo: Callable[[], None] | None = None) -> int:
    """照片每排 5 張、置中裁成相同正方形，回傳最後一列列號（無照片時為「施工照片」標題列）。
    on_photo：每嵌入一張照片後呼叫（背景匯出回報進度、檢查取消用）。"""
    for r in range(first_row, 40):
        ws.row_dimensions[r].height = None
    slot_rows = math.ceil(len(photo_paths) / PHOTOS_PER_ROW)
    last_row = first_row - 1 + slot_rows
    for i in range(slot_rows):
        ws.row_dimensions[first_row + i].height = PHOTO_SLOT_PT
    side = PHOTO_SLOT_PX - 2 * PHOTO_PAD_PX
    for idx, path in enumerate(photo_paths):
        row0 = first_row - 1 + idx // PHOTOS_PER_ROW
        x = (idx % PHOTOS_PER_ROW) * PHOTO_SLOT_PX + PHOTO_PAD_PX
        img = XlImage(_square_crop(path, side * PHOTO_RENDER_SCALE))
        img.anchor = _anchor_at(x, row0, PHOTO_PAD_PX, side)
        ws.add_image(img)
        if on_photo:
            on_photo()
    # 分頁：第一頁扣掉表頭後能放幾排；之後每頁整頁的排數
    first_rows = max(1, int((PAGE_BUDGET_PT - header_pt) // PHOTO_SLOT_PT))
    page_rows = max(1, int(PAGE_BUDGET_PT // PHOTO_SLOT_PT))
    brk = first_row - 1 + first_rows
    while brk < last_row:
        ws.row_breaks.append(Break(id=brk))
        brk += page_rows
    return last_row


def _setup_sheet(ws, tpl, last_row: int) -> None:
    """字型、列印範圍與頁首頁尾（單一工作表共用）。"""
    _set_font(ws, last_row)
    ws.print_area = f"A1:C{last_row}"
    ws.page_setup.orientation = "portrait"
    ws.page_setup.paperSize = 9
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr = copy(tpl.sheet_properties.pageSetUpPr)
    ws.page_margins = copy(tpl.page_margins)
    ws.print_options.horizontalCentered = True
    ws.oddHeader.center.text = "工程進度回報"
    ws.oddHeader.center.font = f"{FONT_NAME},標準"
    ws.oddHeader.center.size = 16
    ws.oddFooter.center.text = "&P"
    ws.oddFooter.center.font = f"{FONT_NAME},標準"


def _rows_height(ws, first: int, last: int) -> float:
    """第 first~last 列的列高總和（pt；未設定者以 15 計）。"""
    return sum(ws.row_dimensions[r].height or 15.0 for r in range(first, last + 1))


def _append_block(dst, src, last_row: int, dst_last: int, break_before: bool) -> int:
    """把暫存工作表 src 第 2~last_row 列（不含標題列）接在 dst 第 dst_last 列之後，回傳新的最後一列。
    break_before=True 時在接上之前插入分頁（此區塊放不進目前這頁，換到下一頁）。"""
    offset = dst_last - 1
    for r in range(2, last_row + 1):
        h = src.row_dimensions[r].height
        if h:
            dst.row_dimensions[r + offset].height = h
        for c in "ABC":
            cell, target = src[f"{c}{r}"], dst[f"{c}{r + offset}"]
            target.value = cell.value
            target._style = copy(cell._style)
    for rng in src.merged_cells.ranges:
        if rng.min_row >= 2:
            dst.merge_cells(start_row=rng.min_row + offset, end_row=rng.max_row + offset,
                            start_column=rng.min_col, end_column=rng.max_col)
    for img in src._images:
        img.anchor._from.row += offset
        dst.add_image(img)
    if break_before:
        dst.row_breaks.append(Break(id=dst_last))
    else:  # 同一頁已有前一個區塊：在「工作日期」列上方加分隔線
        for c in "ABC":
            cell = dst[f"{c}{2 + offset}"]
            border = copy(cell.border)
            border.top = Side(style="medium", color="FF808080")
            cell.border = border
    for brk in src.row_breaks.brk:
        dst.row_breaks.append(Break(id=brk.id + offset))
    return last_row + offset


def _hide_empty_photo_title(ws, photo_paths: Sequence[Path], first_row: int) -> None:
    """沒有照片時不顯示「施工照片」標題（該列縮成小間距，區塊之間仍留一點空白）。"""
    if not photo_paths:
        ws[f"A{first_row - 1}"].value = None
        ws.row_dimensions[first_row - 1].height = 12


def _group_by_client(reports: Sequence[dict]) -> list[list[dict]]:
    """依客戶分組（依首次出現順序），組內依日期由舊到新。"""
    groups: dict[str, list[dict]] = {}
    for rpt in reports:
        groups.setdefault(rpt.get("client_name") or "", []).append(rpt)
    return [sorted(g, key=lambda r: r["report_date"]) for g in groups.values()]


def _build_compact_sheet(wb, tpl, group: list[dict], name: str,
                         on_report, on_photo) -> None:
    """精簡版：同一客戶一個工作表；標題只放客戶，第一個日期區塊用完整版（含客戶／時間／地址），
    之後的日期區塊用精簡版往下接；A4 一頁盡量放滿多個日期區塊，放不下的整塊移到下一頁（不切開區塊）。"""
    client = group[0].get("client_name") or "工作進度"
    ws = wb.copy_worksheet(tpl)
    ws.title = name
    header_pt = _fill_header(ws, group[0], title=client)
    last_row = _add_photos(ws, group[0].get("photo_paths") or [], header_pt, FIRST_PHOTO_ROW, on_photo)
    _hide_empty_photo_title(ws, group[0].get("photo_paths") or [], FIRST_PHOTO_ROW)
    page_used = min(_rows_height(ws, 1, last_row), PAGE_BUDGET_PT)  # 超過一頁（照片多）者，之後換新頁
    if on_report:
        on_report()
    for rpt in group[1:]:
        tmp = wb.copy_worksheet(tpl)
        header_pt = _fill_compact_header(tmp, rpt)
        tmp_last = _add_photos(tmp, rpt.get("photo_paths") or [], header_pt, COMPACT_FIRST_PHOTO_ROW, on_photo)
        _hide_empty_photo_title(tmp, rpt.get("photo_paths") or [], COMPACT_FIRST_PHOTO_ROW)
        block_pt = _rows_height(tmp, 2, tmp_last)
        break_before = page_used + block_pt > PAGE_BUDGET_PT  # 放不進這頁就整塊移到下一頁，不把區塊切開
        last_row = _append_block(ws, tmp, tmp_last, last_row, break_before)
        page_used = min(block_pt, PAGE_BUDGET_PT) if break_before else page_used + block_pt
        wb.remove(tmp)
        if on_report:
            on_report()
    _setup_sheet(ws, tpl, last_row)


def build_work_progress_workbook(reports: Sequence[dict], *, compact: bool = False, keyword: str = "",
                                 on_report: Callable[[], None] | None = None,
                                 on_photo: Callable[[], None] | None = None) -> io.BytesIO:
    """reports：每筆含 report_date/service_name/client_name/start_time/address/
    appointment_note/note 與 photo_paths（照片檔路徑清單）。
    完整版一筆一個工作表；compact=True（精簡版）同客戶合併成一個工作表，工作表名稱用匯出關鍵字
    （同時有多位客戶時為「關鍵字-客戶」；沒有關鍵字則用客戶名稱）。
    on_report/on_photo 每完成一筆／一張照片呼叫一次（可丟例外中止）。"""
    wb = load_workbook(TEMPLATE_PATH)
    tpl = wb.active
    tpl._images = []
    used: set[str] = set()
    if compact:
        groups = _group_by_client(reports)
        keyword = (keyword or "").strip()
        for group in groups:
            client = group[0].get("client_name") or ""
            if not keyword:
                name = client
            elif len(groups) == 1:
                name = keyword
            else:
                name = f"{keyword}-{client}"
            _build_compact_sheet(wb, tpl, group, sheet_title(name, used), on_report, on_photo)
        reports = []
    for rpt in reports:
        ws = wb.copy_worksheet(tpl)
        ws.title = sheet_title(rpt.get("client_name") or "", used)
        header_pt = _fill_header(ws, rpt)
        last_row = _add_photos(ws, rpt.get("photo_paths") or [], header_pt, FIRST_PHOTO_ROW, on_photo)
        _hide_empty_photo_title(ws, rpt.get("photo_paths") or [], FIRST_PHOTO_ROW)
        _setup_sheet(ws, tpl, last_row)
        if on_report:
            on_report()
    wb.remove(tpl)
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf
