# -*- coding: utf-8 -*-
"""庫存 Excel 匯出改版回歸測試。"""
import os
import sys
from datetime import datetime

import pytest
from fastapi.testclient import TestClient
from openpyxl import load_workbook

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE_DIR)

import app.database as app_db  # noqa: E402
import main as app_main  # noqa: E402


@pytest.fixture()
def client(tmp_path, monkeypatch):
    test_db = tmp_path / "export.db"
    monkeypatch.setattr(app_db, "DB_PATH", str(test_db))
    app_db.init_db()
    from app.services.auth import SESSION_COOKIE, create_session, init_admin_if_missing
    conn = app_db.get_db()
    try:
        init_admin_if_missing(conn)
        admin_id = conn.execute("SELECT id FROM users WHERE username='admin'").fetchone()["id"]
        token = create_session(conn, admin_id)
    finally:
        conn.close()
    with TestClient(app_main.app) as c:
        c.cookies.set(SESSION_COOKIE, token)
        yield c


def add_item(client, *, name="測試品", brand="測試牌", code="T-1", site="office", category="電子零件", unit="個", qty=10, low_stock=2):
    response = client.post("/api/items", json={
        "name": name, "brand": brand, "code": code, "site": site,
        "category": category, "unit": unit, "low_stock": low_stock,
        "stocks": [{"location": "A櫃", "qty": qty, "note": "位置備註"}],
    })
    assert response.status_code == 201, response.text
    return response.json()


def insert_movement(item_id, created_at, *, delta=1, reason="庫存調整"):
    conn = app_db.get_db()
    try:
        conn.execute(
            "INSERT INTO movements(item_id, delta, before_qty, after_qty, reason, destination, created_at) VALUES(?,?,?,?,?,?,?)",
            (item_id, delta, 0, delta, reason, "測試去向", created_at),
        )
        conn.commit()
    finally:
        conn.close()


def export_book(client, **params):
    response = client.get("/api/export", params=params)
    assert response.status_code == 200, response.text
    return load_workbook(filename=__import__("io").BytesIO(response.content), data_only=False)


def test_export_has_expected_sheets_in_order(client):
    book = export_book(client)
    assert book.sheetnames == ["01 總覽", "02 庫存總表", "03 位置明細", "04 庫存警示", "05 異動紀錄", "06 統計"]


def test_export_month_filters_movements_and_past_month_excludes_next_month(client):
    item = add_item(client)
    insert_movement(item["id"], "2026-09-05 10:00:00")
    insert_movement(item["id"], "2026-10-01 00:00:00", delta=2)
    book = export_book(client, month="2026-09")
    rows = list(book["05 異動紀錄"].iter_rows(min_row=6, values_only=True))
    assert len([r for r in rows if r[0]]) == 1
    assert rows[0][0] == "2026-09-05 10:00:00"


def test_export_invalid_date_range_returns_400(client):
    response = client.get("/api/export", params={"start_date": "2026-09-20", "end_date": "2026-09-01"})
    assert response.status_code == 400
    response = client.get("/api/export", params={"month": "2026/09"})
    assert response.status_code == 400


def test_export_formula_contract_and_tables(client):
    item = add_item(client)
    insert_movement(item["id"], "2026-09-05 10:00:00")
    book = export_book(client, month="2026-09")
    inventory = book["02 庫存總表"]
    assert set(inventory.tables) == {"tblInventory"}
    assert set(book["03 位置明細"].tables) == {"tblPosition"}
    assert set(book["05 異動紀錄"].tables) == {"tblMovement"}
    headers = [c.value for c in inventory[5]]
    cells = {name: inventory.cell(6, headers.index(name) + 1).value for name in headers}
    assert cells["總庫存"].startswith("=SUMIFS(tblPosition[")
    assert cells["可用庫存"] == "=[@總庫存]-[@待領出]"
    assert cells["位置數"].startswith("=COUNTIFS(tblPosition[")
    assert cells["庫存狀態"].startswith("=IF([@可用庫存]<0")
    overview = book["01 總覽"]
    assert any(isinstance(cell.value, str) and "tblInventory" in cell.value for row in overview.iter_rows() for cell in row)


def test_export_multi_location_has_one_inventory_row_and_two_position_rows(client):
    item = add_item(client, name="多位置", code="MULTI", qty=1)
    response = client.post(f"/api/items/{item['id']}/stocks", json={"location": "B櫃", "qty": 2})
    assert response.status_code == 201, response.text
    book = export_book(client)
    inventory_rows = [r for r in book["02 庫存總表"].iter_rows(min_row=6, values_only=True) if r[0]]
    position_rows = [r for r in book["03 位置明細"].iter_rows(min_row=6, values_only=True) if r[0]]
    assert len(inventory_rows) == 1
    assert len(position_rows) == 2
    assert inventory_rows[0][9].startswith("=")
    assert all(len(r) == 10 for r in position_rows)


def test_export_prepared_soft_delete_and_raw_text_safety(client):
    active = add_item(client, name="=危險名稱", brand="+危險牌", code="@CODE", qty=10)
    deleted = add_item(client, name="刪除品", code="DEL", qty=4)
    conn = app_db.get_db()
    try:
        conn.execute("UPDATE items SET prepared_qty=7 WHERE id=?", (active["id"],))
        conn.execute("UPDATE items SET is_deleted=1 WHERE id=?", (deleted["id"],))
        conn.commit()
    finally:
        conn.close()
    book = export_book(client)
    rows = [r for r in book["02 庫存總表"].iter_rows(min_row=6, values_only=True) if r[0]]
    assert len(rows) == 1
    assert rows[0][3].startswith("'")
    assert rows[0][4].startswith("'")
    assert rows[0][8] == 7
    assert isinstance(rows[0][9], str) and rows[0][9].startswith("=")


def test_export_decimal_qty_stays_numeric_and_uses_unit_format(client):
    add_item(client, name="小數品", code="DEC", unit="米", qty=0.333, low_stock=0)
    book = export_book(client)
    position = book["03 位置明細"]
    qty_cell = position.cell(6, 9)
    assert isinstance(qty_cell.value, (int, float))
    assert qty_cell.value == pytest.approx(0.333)
    assert qty_cell.number_format == "#,##0.###"


def test_export_custom_date_range_and_filename(client):
    item = add_item(client)
    insert_movement(item["id"], "2026-09-17 12:00:00")
    insert_movement(item["id"], "2026-09-18 00:00:00")
    response = client.get("/api/export", params={"start_date": "2026-09-17", "end_date": "2026-09-17"})
    assert response.status_code == 200
    assert "20260917-20260917_" in response.headers["content-disposition"]
    book = load_workbook(filename=__import__("io").BytesIO(response.content), data_only=False)
    rows = [r for r in book["05 異動紀錄"].iter_rows(min_row=6, values_only=True) if r[0]]
    assert len(rows) == 1


def test_export_stats_have_no_24_row_ceiling_for_brands_and_categories(client):
    for index in range(30):
        add_item(client, name=f"統計品項{index}", brand=f"品牌{index:02d}", code=f"STAT-{index}", category=f"分類{index:02d}", qty=index + 1)
    book = export_book(client)
    stats = book["06 統計"]
    brand_rows = [stats.cell(row, 15).value for row in range(6, 36)]
    category_rows = [stats.cell(row, 10).value for row in range(6, 36)]
    assert len([value for value in brand_rows if value]) == 30
    assert len([value for value in category_rows if value]) == 30
    for row in range(30, 36):
        assert stats.cell(row, 16).value.startswith("=COUNTIF(tblInventory[廠牌]")
        assert stats.cell(row, 17).value.startswith("=SUMIF(tblInventory[廠牌]")
        assert stats.cell(row, 18).value.startswith("=SUMIF(tblInventory[廠牌]")
        assert stats.cell(row, 11).value.startswith("=COUNTIF(tblInventory[分類]")
        assert stats.cell(row, 12).value.startswith("=SUMIF(tblInventory[分類]")
        assert stats.cell(row, 13).value.startswith("=SUMIF(tblInventory[分類]")


def test_export_display_period_does_not_show_exclusive_end_as_inclusive(client):
    past = export_book(client, month="2026-08")
    assert "2026/08/01 ～ 2026/08/31" in past["01 總覽"]["A3"].value
    single = export_book(client, start_date="2026-09-17", end_date="2026-09-17")
    assert "2026/09/17 ～ 2026/09/17" in single["01 總覽"]["A3"].value
    assert "2026/09/18" not in single["01 總覽"]["A3"].value
