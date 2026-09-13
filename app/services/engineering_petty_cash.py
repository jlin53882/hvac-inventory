# -*- coding: utf-8 -*-
"""工程零用金：階層資料計算、檔名與範本匯出。"""
from copy import copy
from decimal import Decimal, InvalidOperation
from pathlib import Path
import re
import datetime
import io

from openpyxl import load_workbook

from app.services.safety import excel_safe

TEMPLATE_PATH = Path(__file__).resolve().parent.parent / "assets" / "工程零用金範本.xlsx"


def money(value) -> Decimal:
    try:
        return Decimal(str(value or 0)).quantize(Decimal("0.01"))
    except (InvalidOperation, TypeError, ValueError):
        return Decimal("0.00")


def calculate_engineering_totals(categories):
    total = Decimal("0.00")
    for category in categories:
        cat_total = Decimal("0.00")
        for group in category.get("groups", []):
            group_total = sum((money(r.get("amount")) for r in group.get("receipts", [])), Decimal("0.00"))
            group["subtotal"] = group_total
            cat_total += group_total
        category["subtotal"] = cat_total
        total += cat_total
    return {"categories": categories, "total_amount": total}


def engineering_summary_totals(conn, report_ids):
    """Return report totals in one aggregate query for mixed report lists."""
    ids = [int(report_id) for report_id in report_ids]
    if not ids:
        return {}
    placeholders = ",".join("?" for _ in ids)
    rows = conn.execute(
        f"""SELECT c.report_id, COALESCE(SUM(r.amount), 0) AS total_amount
            FROM engineering_expense_categories c
            JOIN engineering_expense_groups g ON g.category_id = c.id
            JOIN engineering_expense_receipts r ON r.group_id = g.id
            WHERE c.report_id IN ({placeholders})
            GROUP BY c.report_id""",
        ids,
    ).fetchall()
    return {row["report_id"]: money(row["total_amount"]) for row in rows}


def engineering_filename(start_date, end_date, owner, note=""):
    start = datetime.date.fromisoformat(start_date)
    end = datetime.date.fromisoformat(end_date)
    if start == end:
        period = start.strftime("%m%d")
    elif start.year == end.year:
        period = f"{start:%m%d}-{end:%m%d}"
    else:
        period = f"{start:%Y%m%d}-{end:%Y%m%d}"
    note = (note or "").strip()
    inside = f"{period} {note}" if note else period
    return excel_safe(f"({inside}){(owner or '').strip()} 工程零用金.xlsx")


def engineering_sheet_title(start_date, end_date):
    """工程零用金工作表名稱：與報表期間一致，並符合 Excel 31 字限制。"""
    start = datetime.date.fromisoformat(start_date)
    end = datetime.date.fromisoformat(end_date)
    if start == end:
        return start.strftime("%m%d")
    if start.year == end.year:
        return f"{start:%m%d}-{end:%m%d}"
    return f"{start:%Y%m%d}-{end:%Y%m%d}"

def engineering_safe_filename(name):
    """工程報表保留規格所需括號/空格，同時阻擋路徑與危險字元。"""
    name = (name or "file").strip().replace("/", "_").replace("\\", "_")
    name = re.sub(r"[^0-9A-Za-z\u4e00-\u9fa5._()\- ]", "_", name)
    if name[:1] in (".", "-", "=", "+", "@"):
        name = "_" + name[1:]
    return name[:120] or "file"


def _style_row(ws, src, dst):
    ws.row_dimensions[dst].height = ws.row_dimensions[src].height
    for col in range(1, 7):
        a, b = ws.cell(src, col), ws.cell(dst, col)
        b._style = copy(a._style)
        if a.has_style:
            b.font = copy(a.font); b.fill = copy(a.fill); b.border = copy(a.border)
            b.alignment = copy(a.alignment); b.number_format = a.number_format


def _merge(ws, first, last, col):
    if last > first:
        ws.merge_cells(start_row=first, start_column=col, end_row=last, end_column=col)


def _engineering_row(conn, report_id):
    row = conn.execute("SELECT * FROM petty_cash_reports WHERE id=? AND report_type='engineering'", (report_id,)).fetchone()
    if row is None:
        return None
    categories = []
    cat_rows = conn.execute("SELECT * FROM engineering_expense_categories WHERE report_id=? ORDER BY sort_order,id", (report_id,)).fetchall()
    for cat in cat_rows:
        groups = []
        for group in conn.execute("SELECT * FROM engineering_expense_groups WHERE category_id=? ORDER BY sort_order,id", (cat['id'],)).fetchall():
            receipts = []
            for receipt in conn.execute("SELECT * FROM engineering_expense_receipts WHERE group_id=? ORDER BY sort_order,id", (group['id'],)).fetchall():
                details = [r['description'] for r in conn.execute("SELECT description FROM engineering_expense_details WHERE receipt_id=? ORDER BY sort_order,id", (receipt['id'],)).fetchall()]
                receipts.append({"id": receipt['id'], "tax_id_mark": receipt['tax_id_mark'] or "", "receipt_number": receipt['receipt_number'] or "", "amount": money(receipt['amount']), "details": details or [""]})
            groups.append({"id": group['id'], "name": group['name'], "receipts": receipts})
        categories.append({"id": cat['id'], "name": cat['name'], "groups": groups})
    totals = calculate_engineering_totals(categories)
    return {"id": row['id'], "report_type": "engineering", "start_date": row['start_date'], "end_date": row['end_date'], "filename_text": row['filename_text'] or "", "upload_person": row['upload_person'], "prepared_by": row['prepared_by'], "status": row['status'], "created_at": row['created_at'], "updated_at": row['updated_at'], "categories": categories, "total_amount": totals['total_amount'], "filename": engineering_filename(row['start_date'], row['end_date'], row['upload_person'], row['filename_text'])}


def write_engineering(conn, body, user_id, report_id=None):
    start = datetime.date.fromisoformat(body.start_date); end = datetime.date.fromisoformat(body.end_date)
    if start > end: raise ValueError("開始日期不可晚於結束日期")
    if report_id is None:
        cur = conn.execute("INSERT INTO petty_cash_reports (report_type,start_date,end_date,filename_text,upload_person,uploader_user_id,prepared_by,status,created_by,updated_at) VALUES ('engineering',?,?,?,?,?,?,?, ?,datetime('now'))", (body.start_date, body.end_date, body.filename_text, body.upload_person, user_id, body.prepared_by, body.status, user_id))
        report_id = cur.lastrowid
    else:
        existing = conn.execute("SELECT id,report_type FROM petty_cash_reports WHERE id=?", (report_id,)).fetchone()
        if not existing: raise KeyError("零用金月報不存在")
        if existing['report_type'] != 'engineering': raise ValueError("報表類型不可變更")
        conn.execute("UPDATE petty_cash_reports SET start_date=?,end_date=?,filename_text=?,upload_person=?,prepared_by=?,status=?,updated_at=datetime('now') WHERE id=?", (body.start_date,body.end_date,body.filename_text,body.upload_person,body.prepared_by,body.status,report_id))
        conn.execute("DELETE FROM engineering_expense_categories WHERE report_id=?", (report_id,))
    for ci, cat in enumerate(body.categories):
        c = conn.execute("INSERT INTO engineering_expense_categories(report_id,name,sort_order) VALUES(?,?,?)", (report_id,cat.name,ci)).lastrowid
        for gi, group in enumerate(cat.groups):
            g = conn.execute("INSERT INTO engineering_expense_groups(category_id,name,sort_order) VALUES(?,?,?)", (c,group.name,gi)).lastrowid
            for ri, receipt in enumerate(group.receipts):
                r = conn.execute("INSERT INTO engineering_expense_receipts(group_id,tax_id_mark,receipt_number,amount,sort_order) VALUES(?,?,?,?,?)", (g,receipt.tax_id_mark,receipt.receipt_number,str(money(receipt.amount)),ri)).lastrowid
                for di, detail in enumerate(receipt.details):
                    conn.execute("INSERT INTO engineering_expense_details(receipt_id,description,sort_order) VALUES(?,?,?)", (r,detail,di))
    return report_id


def build_engineering_report(report):
    wb = load_workbook(TEMPLATE_PATH)
    ws = wb.active
    for merged in list(ws.merged_cells.ranges):
        ws.unmerge_cells(str(merged))
    source_rows = max(2, min(ws.max_row, 40))
    # Keep the source header, clear all data/summary values, then rebuild rows.
    for row in ws.iter_rows():
        for cell in row:
            cell.value = None
    headers = ["類別", "項目", "統編", "發票號碼", "細項", "金額"]
    for col, value in enumerate(headers, 1):
        ws.cell(1, col).value = value
    needed = max(
        1,
        sum(
            len(receipt.get("details") or [""])
            for cat in report.get("categories", [])
            for group in cat.get("groups", [])
            for receipt in group.get("receipts", [])
        ) + len(report.get("categories", [])),
    )
    first_data = 2
    template_data = 2
    if needed > source_rows - 1:
        ws.insert_rows(source_rows + 1, needed - (source_rows - 1))
    for r in range(first_data, first_data + needed):
        _style_row(ws, template_data, r)
    pos = first_data
    for cat in report.get("categories", []):
        cat_start = pos
        for group in cat.get("groups", []):
            group_start = pos
            for receipt in group.get("receipts", []):
                details = receipt.get("details") or [""]
                receipt_end = pos + len(details) - 1
                for detail_index, detail in enumerate(details):
                    r = pos + detail_index
                    ws.cell(r, 1).value = excel_safe(cat.get("name", ""))
                    ws.cell(r, 2).value = excel_safe(group.get("name", ""))
                    tax_cell = ws.cell(r, 3)
                    tax_cell.value = excel_safe(str(receipt.get("tax_id_mark", "") or ""))
                    tax_cell.number_format = "@"
                    tax_font = copy(tax_cell.font)
                    tax_font.name = "Calibri"
                    tax_cell.font = tax_font
                    ws.cell(r, 4).value = excel_safe(str(receipt.get("receipt_number", "") or ""))
                    ws.cell(r, 4).number_format = "@"
                    ws.cell(r, 5).value = excel_safe(detail)
                    if detail_index == 0:
                        ws.cell(r, 6).value = float(money(receipt.get("amount")))
                for col in (3, 4, 6): _merge(ws, pos, receipt_end, col)
                pos = receipt_end + 1
            _merge(ws, group_start, pos - 1, 2)
        cat_end = pos - 1
        _merge(ws, cat_start, cat_end, 1)
        ws.cell(pos, 1).value = "小計:"
        ws.cell(pos, 6).value = float(money(cat.get("subtotal", 0)))
        ws.merge_cells(start_row=pos, start_column=1, end_row=pos, end_column=5)
        pos += 1
    total_row = pos + 1
    _style_row(ws, template_data, total_row)
    ws.cell(total_row, 1).value = "總計:"
    ws.cell(total_row, 6).value = float(money(report.get("total_amount")))
    ws.merge_cells(start_row=total_row, start_column=1, end_row=total_row, end_column=5)
    ws.title = engineering_sheet_title(report["start_date"], report["end_date"])
    wb.calculation.fullCalcOnLoad = True
    buf = io.BytesIO(); wb.save(buf); buf.seek(0)
    return buf
