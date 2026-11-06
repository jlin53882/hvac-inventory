# -*- coding: utf-8 -*-
"""每日工作進度回報 Excel 匯出（範本填值法）。

- 範本：app/assets/工程進度回報範本.xlsx（單一工作表，A/C 兩欄內容、B 為間隔）
- 同一天的每個行程各輸出一個工作表，照片依張數往下排（每排 5 張、置中裁成相同正方形）
- 全部字型標楷體；使用者輸入的換行在儲存格內換行，不拆成多列
"""
from __future__ import annotations

import datetime
import io
import math
import re
from copy import copy
from pathlib import Path
from typing import Sequence

from PIL import Image as PILImage, ImageOps
from openpyxl import load_workbook
from openpyxl.drawing.image import Image as XlImage
from openpyxl.drawing.spreadsheet_drawing import AnchorMarker, OneCellAnchor
from openpyxl.drawing.xdr import XDRPositiveSize2D
from openpyxl.styles import Alignment
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
FIRST_PHOTO_ROW = 12    # 範本「施工照片」標題在第 11 列
PAGE_BUDGET_PT = 740    # A4 縮放後每頁可用列高（約）
EMU_PER_PX = 9525

_BAD_SHEET_CHARS = re.compile(r"[\\/*?:\[\]]")


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


def _fill_header(ws, rpt: dict) -> float:
    """填範本表頭，回傳第 1~11 列總高度（pt）。"""
    d = datetime.date.fromisoformat(rpt["report_date"])
    service = rpt.get("service_name") or ""
    client = rpt.get("client_name") or ""
    title = f"{d.year}/{d.month}/{d.day} " + (f"{service}．" if service else "") + client
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
    ws["A9"] = excel_safe(appt_note) or None
    ws["C9"] = excel_safe(note) or None
    ws["A10"] = None
    ws["C10"] = None
    ws.merge_cells("A9:A10")
    ws.merge_cells("C9:C10")

    for ref in ("A1", "A5", "A7", "C3", "C5"):
        _wrap(ws[ref])
    _wrap(ws["A9"], horizontal="left", vertical="top")
    _wrap(ws["C9"], horizontal="left", vertical="top")

    heights = {
        1: _height_pt(title, PX_FULL),
        5: max(_height_pt(client, PX_COL_A), _height_pt(start, PX_COL_A)),
        7: _height_pt(rpt.get("address") or "", PX_COL_A),
    }
    body_pt = max(60.0, _height_pt(appt_note, PX_COL_A), _height_pt(note, PX_COL_A))
    heights[9] = heights[10] = body_pt / 2
    for r in range(1, 12):
        ws.row_dimensions[r].height = heights.get(r, 30.0)
    return sum(ws.row_dimensions[r].height for r in range(1, 12))


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


def _add_photos(ws, photo_paths: Sequence[Path], header_pt: float) -> int:
    """照片每排 5 張、置中裁成相同正方形，回傳最後一列列號（無照片時為第 11 列）。"""
    for r in range(FIRST_PHOTO_ROW, 40):
        ws.row_dimensions[r].height = None
    slot_rows = math.ceil(len(photo_paths) / PHOTOS_PER_ROW)
    last_row = FIRST_PHOTO_ROW - 1 + slot_rows
    for i in range(slot_rows):
        ws.row_dimensions[FIRST_PHOTO_ROW + i].height = PHOTO_SLOT_PT
    side = PHOTO_SLOT_PX - 2 * PHOTO_PAD_PX
    for idx, path in enumerate(photo_paths):
        row0 = FIRST_PHOTO_ROW - 1 + idx // PHOTOS_PER_ROW
        x = (idx % PHOTOS_PER_ROW) * PHOTO_SLOT_PX + PHOTO_PAD_PX
        img = XlImage(_square_crop(path, side * PHOTO_RENDER_SCALE))
        img.anchor = _anchor_at(x, row0, PHOTO_PAD_PX, side)
        ws.add_image(img)
    # 分頁：第一頁扣掉表頭後能放幾排；之後每頁整頁的排數
    first_rows = max(1, int((PAGE_BUDGET_PT - header_pt) // PHOTO_SLOT_PT))
    page_rows = max(1, int(PAGE_BUDGET_PT // PHOTO_SLOT_PT))
    brk = FIRST_PHOTO_ROW - 1 + first_rows
    while brk < last_row:
        ws.row_breaks.append(Break(id=brk))
        brk += page_rows
    return last_row


def build_work_progress_workbook(reports: Sequence[dict]) -> io.BytesIO:
    """reports：每筆含 report_date/service_name/client_name/start_time/address/
    appointment_note/note 與 photo_paths（照片檔路徑清單）。一筆一個工作表。"""
    wb = load_workbook(TEMPLATE_PATH)
    tpl = wb.active
    tpl._images = []
    used: set[str] = set()
    for rpt in reports:
        ws = wb.copy_worksheet(tpl)
        ws.title = sheet_title(rpt.get("client_name") or "", used)
        header_pt = _fill_header(ws, rpt)
        last_row = _add_photos(ws, rpt.get("photo_paths") or [], header_pt)
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
    wb.remove(tpl)
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf
