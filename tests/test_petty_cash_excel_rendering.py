# -*- coding: utf-8 -*-
"""Dynamic petty-cash Excel rendering regression tests."""
from pathlib import Path

from openpyxl import load_workbook

from app.services.engineering_petty_cash import build_engineering_report
from app.services.petty_cash_report import build_petty_cash_report


ROOT = Path(__file__).parents[1]


def _load_bytes(builder, report, tmp_path, name):
    path = tmp_path / name
    path.write_bytes(builder(report).getvalue())
    return load_workbook(path, data_only=False).active


def _engineering_report(categories, start="2026-09-01", end="2026-09-04"):
    total = sum(
        receipt["amount"]
        for category in categories
        for group in category.get("groups", [])
        for receipt in group.get("receipts", [])
    )
    return {
        "start_date": start,
        "end_date": end,
        "categories": categories,
        "total_amount": total,
    }


def test_engineering_excel_has_period_title_and_dynamic_body(tmp_path):
    """工程報表期間標題與 body 列數不應受原始範本固定列數影響。"""
    categories = [
        {
            "name": "交通費",
            "groups": [
                {
                    "name": "油資",
                    "receipts": [
                        {"tax_id_mark": "V", "receipt_number": "DH-1", "amount": 100, "details": ["九二無鉛"]},
                        {"tax_id_mark": "12345678", "receipt_number": "DH-2", "amount": 725, "details": ["九二無鉛"]},
                    ],
                }
            ],
        },
        {
            "name": "工程材料費",
            "groups": [
                {
                    "name": "五金/工具",
                    "receipts": [
                        {"tax_id_mark": "V", "receipt_number": "CB 20011829", "amount": 1004, "details": [f"材料 {i}" for i in range(6)]},
                    ],
                }
            ],
        },
    ]
    ws = _load_bytes(build_engineering_report, _engineering_report(categories), tmp_path, "engineering.xlsx")

    assert ws.title == "0901-0904"
    assert ws["A1"].value == "09/01~09/04工程零用金明細表"
    assert [ws.cell(2, col).value for col in range(1, 7)] == ["類別", "項目", "統編", "發票號碼", "細項", "金額"]
    assert ws["A3"].value == "交通費"
    assert ws["B3"].value == "油資"
    assert ws["C3"].value == "V"
    assert ws["D3"].value == "DH-1"
    assert ws["F3"].value == 100
    assert ws["C4"].value == "12345678"
    assert ws["D4"].value == "DH-2"
    assert ws["F4"].value == 725
    assert ws["F5"].value == 825
    assert ws["A6"].value == "工程材料費"
    assert ws["B6"].value == "五金/工具"
    assert ws["C6"].value == "V"
    assert ws["D6"].value == "CB 20011829"
    assert ws["E6"].value == "材料 0"
    assert ws["F6"].value == 1004
    assert [ws.cell(row, 5).value for row in range(7, 12)] == [f"材料 {i}" for i in range(1, 6)]
    assert ws["F12"].value == 1004
    assert ws["F14"].value == 1829
    assert "C6:C11" in [str(value) for value in ws.merged_cells.ranges]
    assert "D6:D11" in [str(value) for value in ws.merged_cells.ranges]
    assert "F6:F11" in [str(value) for value in ws.merged_cells.ranges]
    assert ws.calculate_dimension() == "A1:F16"
    assert str(ws.print_area).endswith("$A$1:$F$16")
    assert all(ws.cell(row, col).value is None for row in range(17, ws.max_row + 1) for col in range(1, 7))


def test_engineering_excel_single_day_period_is_not_repeated(tmp_path):
    """單日工程報表只顯示一次日期，sheet tab 也使用單日 token。"""
    categories = [{
        "name": "交通費",
        "groups": [{"name": "油資", "receipts": [{"amount": 100, "details": ["九二無鉛"]}]}],
    }]
    ws = _load_bytes(
        build_engineering_report,
        _engineering_report(categories, "2026-09-04", "2026-09-04"),
        tmp_path,
        "engineering-single.xlsx",
    )
    assert ws.title == "0904"
    assert ws["A1"].value == "09/04工程零用金明細表"
    assert "09/04~09/04" not in ws["A1"].value


def test_general_excel_rebuilds_body_after_more_than_template_capacity(tmp_path):
    """一般零用金超過原本 15 列時仍只保留實際 body/footer。"""
    entries = [
        {
            "entry_date": f"2026-09-{day:02d}",
            "entry_type": "expense",
            "description": f"支出 {day}",
            "amount": day,
            "category": "測試",
            "items": [],
        }
        for day in range(1, 21)
    ]
    report = {
        "start_date": "2026-09-01",
        "end_date": "2026-09-20",
        "opening_balance": 1000,
        "prepared_by": "王小明",
        "entries": entries,
    }
    ws = _load_bytes(build_petty_cash_report, report, tmp_path, "general.xlsx")

    assert ws.title == "0901-0920"
    assert ws["A1"].value == "09/01~09/20零用金收支明細表"
    assert ws["D24"].value == "本期餘額"
    assert ws["E24"].value == 790
    assert ws["E27"].value == "王小明"
    assert ws.calculate_dimension() == "A1:F27"
    assert str(ws.print_area).endswith("$A$1:$F$27")


def test_engineering_excel_three_categories_keep_subtotal_gaps(tmp_path):
    """三分類 row plan 不得讓後續資料覆蓋前一分類 subtotal。"""
    categories = [
        {"name": "分類A", "groups": [{"name": "項目A", "receipts": [{"amount": 10, "details": ["A1"]}]}]},
        {"name": "分類B", "groups": [{"name": "項目B", "receipts": [{"amount": 20, "details": ["B1", "B2", "B3"]}]}]},
        {"name": "分類C", "groups": [{"name": "項目C", "receipts": [
            {"amount": 30, "details": ["C1"]},
            {"amount": 40, "details": ["C2"]},
        ]}]},
    ]
    ws = _load_bytes(build_engineering_report, _engineering_report(categories), tmp_path, "engineering-three.xlsx")
    assert ws["A3"].value == "分類A"
    assert ws["F4"].value == 10
    assert ws["A5"].value == "分類B"
    assert ws["E7"].value == "B3"
    assert ws["F8"].value == 20
    assert ws["A9"].value == "分類C"
    assert ws["A11"].value == "小計:"
    assert ws["F11"].value == 70
    assert ws["F13"].value == 100
    assert ws.calculate_dimension() == "A1:F15"
    assert "C5:C7" in [str(value) for value in ws.merged_cells.ranges]
    assert "C9:C10" not in [str(value) for value in ws.merged_cells.ranges]


def test_engineering_excel_empty_hierarchy_has_explicit_total(tmp_path):
    """空階層也要輸出明確總計，不產生固定範本殘留列。"""
    empty = _load_bytes(
        build_engineering_report, _engineering_report([]), tmp_path, "engineering-empty.xlsx"
    )
    assert empty["A1"].value == "09/01~09/04工程零用金明細表"
    assert empty["F4"].value == 0
    assert empty.calculate_dimension() == "A1:F6"
    assert str(empty.print_area).endswith("$A$1:$F$6")

    empty_category = _load_bytes(
        build_engineering_report,
        _engineering_report([{"name": "空分類", "groups": []}]),
        tmp_path,
        "engineering-empty-category.xlsx",
    )
    assert empty_category["A3"].value == "空分類"
    assert empty_category["F4"].value == 0
    assert empty_category["F6"].value == 0
