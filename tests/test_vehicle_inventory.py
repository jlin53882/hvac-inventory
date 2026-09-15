# -*- coding: utf-8 -*-
"""廂型車／貨車獨立庫存區：四 site 契約與整組同區測試。"""
import os

import pytest
from fastapi.testclient import TestClient

import app.config as app_config
import app.database as app_db
import main as app_main
from app.services.auth import SESSION_COOKIE, create_session, init_admin_if_missing


@pytest.fixture()
def client(tmp_path, monkeypatch):
    """每個測試使用獨立 SQLite，避免碰正式 inventory.db。"""
    test_db = tmp_path / "test_vehicle_inventory.db"
    upload_dir = tmp_path / "uploads"
    upload_dir.mkdir()
    monkeypatch.setattr(app_db, "DB_PATH", str(test_db))
    monkeypatch.setattr(app_config, "UPLOAD_DIR", str(upload_dir))
    app_db.init_db()
    conn = app_db.get_db()
    try:
        init_admin_if_missing(conn)
        admin_id = conn.execute("SELECT id FROM users WHERE username='admin'").fetchone()["id"]
        token = create_session(conn, admin_id)
    finally:
        conn.close()
    with TestClient(app_main.app) as test_client:
        test_client.cookies.set(SESSION_COOKIE, token)
        yield test_client
    try:
        if test_db.exists():
            test_db.unlink()
    except PermissionError:
        pass


def add_item(client, *, site="office", code="R410A", name="冷媒 R410A", qty=10,
             location="測試位置", low_stock=0):
    response = client.post("/api/items", json={
        "brand": "大金",
        "code": code,
        "name": name,
        "unit": "個",
        "low_stock": low_stock,
        "site": site,
        "stocks": [{"location": location, "qty": qty, "note": ""}],
    })
    assert response.status_code == 201, response.text
    return response.json()


def test_export_contains_four_inventory_site_sheets(client):
    for site in ("office", "warehouse", "van", "truck"):
        add_item(client, site=site, code=f"EXPORT-{site}", qty=1, location="車內" if site in ("van", "truck") else "櫃位")
    response = client.get("/api/export?days=30")
    assert response.status_code == 200
    from io import BytesIO
    from openpyxl import load_workbook
    workbook = load_workbook(BytesIO(response.content), read_only=True)
    assert {"辦公室", "倉庫", "廂型車", "貨車"} <= set(workbook.sheetnames)


def test_vehicle_sites_accept_duplicate_item_identity_per_site(client):
    """相同物料可在 van/truck 各有獨立 item row 與數量。"""
    van = add_item(client, site="van", qty=2, location="車內")
    truck = add_item(client, site="truck", qty=3, location="車內")

    assert van["site"] == "van"
    assert truck["site"] == "truck"
    assert van["id"] != truck["id"]
    assert client.get("/api/items", params={"site": "van"}).json()[0]["total_qty"] == 2
    assert client.get("/api/items", params={"site": "truck"}).json()[0]["total_qty"] == 3


def test_vehicle_site_rejects_unknown_value(client):
    response = client.post("/api/items", json={
        "brand": "大金", "code": "BAD-SITE", "name": "非法區域",
        "site": "factory", "stocks": [{"location": "A", "qty": 1}],
    })
    assert response.status_code == 422
    assert client.get("/api/items", params={"site": "factory"}).status_code == 422


def test_stats_summary_exposes_four_inventory_sites(client):
    add_item(client, site="office", code="OFFICE", qty=1)
    add_item(client, site="warehouse", code="WAREHOUSE", qty=10)
    add_item(client, site="van", code="VAN", qty=2, location="車內")
    add_item(client, site="truck", code="TRUCK", qty=3, location="車內")

    response = client.get("/api/stats/summary")
    assert response.status_code == 200
    body = response.json()
    assert set(("all", "office", "warehouse", "van", "truck")) <= body.keys()
    assert body["van"]["total_qty"] == 2
    assert body["truck"]["total_qty"] == 3
    assert body["all"]["total_qty"] == 16


def test_kit_uses_selected_site_and_rejects_cross_site_component(client):
    van_component = add_item(client, site="van", code="VAN-MAT", name="廂型車材料", qty=4, location="車內")
    warehouse_component = add_item(client, site="warehouse", code="WH-MAT", name="倉庫材料", qty=4, location="鐵架")

    created = client.post("/api/kits", json={
        "name": "廂型車工具組",
        "site": "van",
        "items": [{"item_id": van_component["id"], "qty": 1}],
    })
    assert created.status_code == 201, created.text
    kits = client.get("/api/kits", params={"site": "van"})
    assert kits.status_code == 200
    assert kits.json()[0]["site"] == "van"

    cross_site = client.post("/api/kits", json={
        "name": "錯誤跨區整組",
        "site": "van",
        "items": [{"item_id": warehouse_component["id"], "qty": 1}],
    })
    assert cross_site.status_code == 400


def test_stocktake_site_isolation(client):
    van = add_item(client, site="van", code="TAKE-VAN", qty=2, location="車內")
    truck = add_item(client, site="truck", code="TAKE-TRUCK", qty=4, location="車內")
    cross = client.post("/api/stocktake", json={
        "site": "van",
        "items": [{"item_id": truck["id"], "location": "車內", "actual_qty": 3}],
    })
    assert cross.status_code == 400
    ok = client.post("/api/stocktake", json={
        "site": "van",
        "items": [{"item_id": van["id"], "location": "車內", "actual_qty": 1}],
    })
    assert ok.status_code == 200
    rows = client.get("/api/stocktakes", params={"site": "van"}).json()
    assert len(rows) == 1
    assert rows[0]["item_id"] == van["id"]


def test_inventory_transfer_creates_target_site_item_and_moves_stock(client):
    source = add_item(client, site="office", code="TRANSFER", qty=5, location="辦公室櫃A")
    response = client.post("/api/inventory/transfers", json={
        "item_id": source["id"],
        "target_site": "van",
        "qty": 2,
        "source_location": "辦公室櫃A",
        "target_location": "車內工具櫃｜左側",
    })
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["source_item_id"] == source["id"]
    assert body["target_site"] == "van"
    assert body["qty"] == 2

    office = client.get("/api/items", params={"site": "office"}).json()
    van = client.get("/api/items", params={"site": "van"}).json()
    assert office[0]["total_qty"] == 3
    assert van[0]["total_qty"] == 2
    assert van[0]["stocks"][0]["location"] == "車內工具櫃｜左側"


def test_inventory_transfer_rejects_same_site_and_insufficient_stock(client):
    source = add_item(client, site="truck", code="TRANSFER-ERR", qty=1, location="車內")
    same_site = client.post("/api/inventory/transfers", json={
        "item_id": source["id"], "target_site": "truck", "qty": 1,
    })
    assert same_site.status_code == 400
    insufficient = client.post("/api/inventory/transfers", json={
        "item_id": source["id"], "target_site": "van", "qty": 2,
    })
    assert insufficient.status_code == 400


def test_movements_can_be_filtered_by_inventory_site(client):
    source = add_item(client, site="office", code="MOV-SITE", qty=2, location="辦公室")
    response = client.post("/api/inventory/transfers", json={
        "item_id": source["id"], "target_site": "van", "qty": 1,
    })
    assert response.status_code == 201
    van_movements = client.get("/api/movements", params={"site": "van"}).json()
    office_movements = client.get("/api/movements", params={"site": "office"}).json()
    assert len(van_movements) == 1
    assert van_movements[0]["site"] == "van"
    assert len(office_movements) == 1
    assert all(row["site"] == "office" for row in office_movements)


def test_assembled_kit_transfer_copies_definition_to_target_site(client):
    component = add_item(client, site="van", code="KIT-MAT", name="車用材料", qty=2, location="車內")
    created = client.post("/api/kits", json={
        "name": "車用工具組", "site": "van",
        "items": [{"item_id": component["id"], "qty": 1}],
    })
    assert created.status_code == 201, created.text
    kit = created.json()
    assembled = client.post(f"/api/kits/{kit['id']}/assemble", json={"qty": 1})
    assert assembled.status_code == 200, assembled.text

    transferred = client.post("/api/inventory/transfers", json={
        "item_id": kit["item_id"], "target_site": "truck", "qty": 1,
    })
    assert transferred.status_code == 201, transferred.text
    target_kits = client.get("/api/kits", params={"site": "truck"}).json()
    assert len(target_kits) == 1
    assert target_kits[0]["name"] == "車用工具組"
    assert target_kits[0]["stock_qty"] == 1
    assert target_kits[0]["components"][0]["name"] == "車用材料"
