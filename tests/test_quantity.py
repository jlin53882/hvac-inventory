# -*- coding: utf-8 -*-
"""數量/單位分數支援測試（2026-09-12 單位管理 + 數量系統重設計）

- 後端：units.qty_type CRUD、consolidate-item new_qty、kit 可組數精度
- 前端：tests/qty.test.js（node 純函式矩陣）由本檔包裝執行
"""
import os
import sqlite3
import subprocess

import pytest
from app.services.quantity import canonical_qty


@pytest.mark.parametrize("value, expected", [
    (0.0625, 0.063),
    (1.2345, 1.235),
    (2.3455, 2.346),
    (-0.0625, -0.063),
])
def test_canonical_qty_uses_decimal_half_up(value, expected):
    """Canonical quantity policy is deterministic for four-decimal ties."""
    assert canonical_qty(value) == expected
from fastapi.testclient import TestClient

import app.database as app_db
import main as app_main
from app.services.auth import SESSION_COOKIE, create_session, init_admin_if_missing

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
QTY_TEST_JS = os.path.join(BASE_DIR, "tests", "qty.test.js")


@pytest.fixture()
def client(tmp_path, monkeypatch):
    test_db = tmp_path / "test_inventory.db"
    monkeypatch.setattr(app_db, "DB_PATH", str(test_db))
    app_db.init_db()
    _conn = app_db.get_db()
    try:
        init_admin_if_missing(_conn)
        _admin_id = _conn.execute("SELECT id FROM users WHERE username='admin'").fetchone()["id"]
        _token = create_session(_conn, _admin_id)
    finally:
        _conn.close()
    with TestClient(app_main.app) as c:
        c.cookies.set(SESSION_COOKIE, _token)
        yield c
    try:
        if test_db.exists():
            test_db.unlink()
    except PermissionError:
        pass


def test_qty_js_suite():
    """前端 Qty 純函式矩陣（parser/arithmetic/formatter/kitSets）全綠。"""
    r = subprocess.run(["node", QTY_TEST_JS], capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, f"qty.test.js 失敗：\n{r.stdout}\n{r.stderr}"


def test_stockout_deduct_normalizes_fraction_precision():
    """出庫先將分數數量正規化到庫存 canonical 3 位精度。"""
    from app.routes.stockout import _deduct

    conn = sqlite3.connect(':memory:')
    conn.row_factory = sqlite3.Row
    conn.execute('CREATE TABLE item_stocks (id INTEGER PRIMARY KEY, item_id INTEGER, location TEXT, qty REAL, updated_at TEXT)')
    conn.execute("INSERT INTO item_stocks(item_id, location, qty) VALUES (1, 'A', 1.0)")
    before, after, source_id = _deduct(conn, 1, 1 / 3, 'A')
    assert before == pytest.approx(1.0)
    assert after == pytest.approx(0.667)
    assert source_id == 1
    conn.close()



def test_units_qty_type_crud(client):
    """單位數量類型：GET 可見、PUT 可改、非法值 400。"""
    units = client.get("/api/units").json()
    can = next(u for u in units if u["name"] == "罐")
    assert can["qty_type"] == "fraction"  # 種子預設：散裝可分→fraction
    for nm, qt in (("瓶", "fraction"), ("包", "fraction"), ("桶", "fraction"),
                   ("捲", "fraction"), ("米", "decimal"), ("個", "integer")):
        assert next(u for u in units if u["name"] == nm)["qty_type"] == qt, nm
    each = next(u for u in units if u["name"] == "個")
    r = client.put(f"/api/units/{each['id']}", json={"qty_type": "fraction"})
    assert r.status_code == 200, r.text
    assert r.json()["qty_type"] == "fraction"
    r = client.put(f"/api/units/{each['id']}", json={"qty_type": "亂填"})
    assert r.status_code == 400


def test_units_quick_add_defaults_integer(client):
    """快速新增單位預設 integer（不因新欄位破壞既有流程）。"""
    r = client.post("/api/units", json={"name": "測試分數單位"})
    assert r.status_code == 201, r.text
    assert r.json()["qty_type"] == "integer"


def test_consolidate_item_with_new_qty(client):
    """歷史轉換：改單位同時可指定新總量（單位置品項）。"""
    r = client.post("/api/items", json={
        "brand": "測試牌", "code": "HIST-Q", "name": "歷史分數品",
        "unit": "/4罐", "low_stock": 5, "site": "office",
        "stocks": [{"location": "鐵架", "qty": 3}]})
    assert r.status_code == 201, r.text
    item_id = r.json()["id"]
    can = next(u for u in client.get("/api/units").json() if u["name"] == "罐")
    client.put(f"/api/units/{can['id']}", json={"qty_type": "fraction"})
    r = client.post("/api/units/consolidate-item",
                    json={"item_id": item_id, "to_unit": "罐", "new_qty": 0.75})
    assert r.status_code == 200, r.text
    assert r.json()["new_qty"] == 0.75
    got_list = client.get("/api/items", params={"site": "office", "search": "HIST-Q"}).json()
    rows = got_list["items"] if isinstance(got_list, dict) else got_list
    got = next(r for r in rows if r.get("code") == "HIST-Q")
    assert got["unit"] == "罐"
    assert got["qty"] == 0.75


def test_consolidate_item_new_qty_multi_location_rejected(client):
    """多位置品項總量語意不明：new_qty 必須拒絕（防 silenc 改變庫存）。"""
    r = client.post("/api/items", json={
        "brand": "測試牌", "code": "HIST-M", "name": "多位置歷史品",
        "unit": "/4罐", "low_stock": 5, "site": "office",
        "stocks": [{"location": "A倉", "qty": 2}, {"location": "B倉", "qty": 1}]})
    item_id = r.json()["id"]
    r = client.post("/api/units/consolidate-item",
                    json={"item_id": item_id, "to_unit": "罐", "new_qty": 0.75})
    assert r.status_code == 400


def test_kit_sets_fractional_no_drift(client):
    """整組可組數：浮點殘留不得誤判材料不足（0.3 vs 0.1+0.2）。"""
    mat = client.post("/api/items", json={
        "brand": "測試牌", "code": "MAT-F", "name": "分數材料",
        "unit": "罐", "low_stock": 0, "site": "office",
        "stocks": [{"location": "鐵架", "qty": 0.3}]}).json()
    kit = client.post("/api/kits", json={
        "name": "分數整組",
        "note": "",
        "items": [{"item_id": mat["id"], "qty": 0.1 + 0.2}]}).json()
    assert "id" in kit, kit
    r = client.post(f"/api/kits/{kit['id']}/assemble", json={"qty": 1})
    assert r.status_code == 200, r.text


def _make(client, code, name, unit, qty, loc="鐵架"):
    r = client.post("/api/items", json={
        "brand": "測試牌", "code": code, "name": name,
        "unit": unit, "low_stock": 0, "site": "office",
        "stocks": [{"location": loc, "qty": qty}]})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _total(client, code):
    rows = client.get("/api/items", params={"site": "office", "search": code}).json()
    rows = rows["items"] if isinstance(rows, dict) else rows
    return next(r for r in rows if r.get("code") == code)["qty"]


def test_fraction_issue_return_flow(client):
    """領出/退回分數：1 - 1/4 = 3/4；退回後回到 1。"""
    iid = _make(client, "FR-IO", "分數領出品", "罐", 1)
    r = client.post("/api/stockout", json={"item_id": iid, "qty": 0.25, "destination": "測試案場"})
    assert r.status_code == 200, r.text
    assert _total(client, "FR-IO") == 0.75
    mv = client.get("/api/movements", params={"item_id": iid}).json()
    mid = mv["movements"][0]["id"] if isinstance(mv, dict) else mv[0]["id"]
    r = client.post(f"/api/stockouts/{mid}/return", json={"qty": 0.25, "location": "鐵架"})
    assert r.status_code == 200, r.text
    assert _total(client, "FR-IO") == 1


def test_stocktake_fraction_flow(client):
    """盤點分數：系統 3/4、實際 1/2 → 差異 -1/4 並更新庫存。"""
    iid = _make(client, "FR-ST", "分數盤點品", "罐", 0.75)
    r = client.post("/api/stocktake", json={
        "take_date": "2026-09-12",
        "items": [{"item_id": iid, "location": "鐵架", "actual_qty": 0.5}]})
    assert r.status_code == 200, r.text
    assert _total(client, "FR-ST") == 0.5
    recs = client.get("/api/stocktakes", params={"item_id": iid}).json()
    recs = recs["stocktakes"] if isinstance(recs, dict) else recs
    assert recs[0]["diff"] == -0.25


def test_integer_adjust_unchanged(client):
    """整數品項 ±1 不回歸：3 +1 +1 -1 = 4（後端 adjust 照舊）。"""
    iid = _make(client, "INT-ADJ", "整數品", "個", 3)
    for d in (1, 1, -1):
        r = client.post(f"/api/items/{iid}/adjust", json={"delta": d})
        assert r.status_code == 200, r.text
    assert _total(client, "INT-ADJ") == 4


def test_write_path_round3_no_dust(client):
    """寫入 ROUND 3：1/3 累加三次 = 0.999（不生 0.9999999 塵）；盤點 actual 存 0.333。"""
    iid = _make(client, "FR-R3", "分數累加品", "罐", 0)
    for _ in range(3):
        r = client.post(f"/api/items/{iid}/adjust", json={"delta": 1 / 3})
        assert r.status_code == 200, r.text
    assert _total(client, "FR-R3") == 0.999
    iid2 = _make(client, "FR-R3B", "分數盤點存", "罐", 1)
    r = client.post("/api/stocktake", json={
        "take_date": "2026-09-12",
        "items": [{"item_id": iid2, "location": "鐵架", "actual_qty": 1 / 3}]})
    assert r.status_code == 200, r.text
    assert _total(client, "FR-R3B") == 0.333


def test_write_paths_round3_structural():
    """結構防護：所有 item_stocks.qty 寫入必須 ROUND 3（塵不再入庫）。
    直接 SET 的兩處（編輯/收編）是 python 層已 round 的值，白名單。"""
    import re
    root = os.path.join(os.path.dirname(__file__), "..", "app", "routes")
    whitelist = {"app/routes/items.py:409", "app/routes/units.py:223"}
    bad = []
    for fn in os.listdir(root):
        if not fn.endswith(".py"):
            continue
        src = open(os.path.join(root, fn), encoding="utf-8").read()
        for i, line in enumerate(src.split("\n"), 1):
            if re.search(r"SET qty\s*=", line) and "ROUND(" not in line:
                key = f"app/routes/{fn}:{i}"
                # qty=0 與 qty=? 不需 ROUND（字面零/參數化寫入無 binary float 殘留風險）
                if key not in whitelist and "qty=?" not in line and "qty=0" not in line:
                    bad.append(key + ": " + line.strip()[:80])
    assert not bad, f"qty 寫入缺 ROUND(...,3)：{bad}"


@pytest.mark.parametrize("requested, expected", [(1 / 3, 0.333), (1 / 7, 0.143)])
def test_stockout_canonical_qty_keeps_movement_chain(client, requested, expected):
    """Regression: stock and movement must use the same canonical 3-decimal qty."""
    iid = _make(client, f"CAN-{expected}", "canonical 出庫品", "罐", 1)
    response = client.post("/api/stockout", json={
        "item_id": iid, "qty": requested, "destination": "測試案場",
    })
    assert response.status_code == 200, response.text
    assert _total(client, f"CAN-{expected}") == pytest.approx(1 - expected)
    rows = client.get("/api/movements", params={"limit": 500}).json()
    movement = next(row for row in rows if row["item_id"] == iid and row["reason"] == "出庫")
    assert movement["delta"] == pytest.approx(-expected)
    assert movement["before_qty"] == pytest.approx(1)
    assert movement["after_qty"] == pytest.approx(1 - expected)
    assert round(movement["before_qty"] + movement["delta"], 3) == pytest.approx(movement["after_qty"])


def test_stockout_sub_precision_qty_is_rejected_without_movement(client):
    """Regression: 0.0004 rounds to zero and must not create a phantom movement."""
    iid = _make(client, "CAN-DUST", "不可產生塵埃", "罐", 1)
    response = client.post("/api/stockout", json={
        "item_id": iid, "qty": 0.0004, "destination": "測試案場",
    })
    assert response.status_code == 400, response.text
    assert _total(client, "CAN-DUST") == pytest.approx(1)
    rows = client.get("/api/movements", params={"limit": 500}).json()
    assert not any(row["item_id"] == iid and row["reason"] == "出庫" for row in rows)


def test_prepared_out_uses_canonical_qty_for_all_state_and_movement(client):
    """Regression: prepared-out keeps prepared_qty, stock, and movement aligned."""
    iid = _make(client, "CAN-PREP", "待領出 canonical 品", "罐", 1)
    prepared = client.post(f"/api/items/{iid}/prepare", json={"qty": 1 / 3, "location": "鐵架"})
    assert prepared.status_code == 200, prepared.text
    assert prepared.json()["prepared_qty"] == pytest.approx(0.333)
    completed = client.post(f"/api/items/{iid}/prepared-out", json={"qty": 1 / 3, "note": "測試案場", "location": "鐵架"})
    assert completed.status_code == 200, completed.text
    assert completed.json()["prepared_qty"] == pytest.approx(0)
    assert _total(client, "CAN-PREP") == pytest.approx(0.667)
    rows = client.get("/api/movements", params={"limit": 500}).json()
    movement = next(row for row in rows if row["item_id"] == iid and row["reason"] == "出庫")
    assert movement["delta"] == pytest.approx(-0.333)
    assert movement["before_qty"] == pytest.approx(1)
    assert movement["after_qty"] == pytest.approx(0.667)
    assert round(movement["before_qty"] + movement["delta"], 3) == pytest.approx(movement["after_qty"])


def test_direct_stockout_allows_remaining_equal_prepared_qty(client):
    """Regression: 0.3 - 0.1 must not reject remaining prepared 0.2."""
    iid = _make(client, "CAN-GUARD", "直接出庫 guard 品", "罐", 0.3)
    prepared = client.post(f"/api/items/{iid}/prepare", json={"qty": 0.2, "location": "鐵架"})
    assert prepared.status_code == 200, prepared.text

    response = client.post("/api/stockout", json={
        "item_id": iid, "qty": 0.1, "destination": "測試案場",
    })
    assert response.status_code == 200, response.text
    assert response.json()["total_qty"] == pytest.approx(0.2)
    assert response.json()["prepared_qty"] == pytest.approx(0.2)

    rows = client.get("/api/movements", params={"limit": 500}).json()
    movement = next(row for row in rows if row["item_id"] == iid and row["reason"] == "出庫")
    assert movement["before_qty"] == pytest.approx(0.3)
    assert movement["delta"] == pytest.approx(-0.1)
    assert movement["after_qty"] == pytest.approx(0.2)
    assert movement["before_qty"] + movement["delta"] == pytest.approx(movement["after_qty"])
    assert round(movement["before_qty"] + movement["delta"], 3) == movement["after_qty"]


def test_legacy_return_repair_canonicalizes_return_total(client):
    """Regression: 0.1 + 0.2 must equal a 0.3 legacy return parent total."""
    iid = _make(client, "CAN-RETURN-SUM", "退回合計精度", "罐", 0.3)
    stockout = client.post("/api/stockout", json={
        "item_id": iid, "qty": 0.3, "destination": "測試案場",
    })
    assert stockout.status_code == 200, stockout.text
    rows = client.get("/api/movements", params={"limit": 500}).json()
    parent = next(row for row in rows if row["item_id"] == iid and row["reason"] == "出庫")
    conn = app_db.get_db()
    try:
        stock_id = conn.execute("SELECT id FROM item_stocks WHERE item_id=?", (iid,)).fetchone()["id"]
    finally:
        conn.close()

    conn = app_db.get_db()
    try:
        conn.execute(
            "INSERT INTO movements (item_id, delta, reason, source_movement_id) VALUES (?,?,?,?)",
            (iid, 0.1, "退回已領出", parent["id"]),
        )
        cur = conn.execute(
            "INSERT INTO movements (item_id, delta, reason) VALUES (?,?,?)",
            (iid, 0.2, "退回已領出"),
        )
        legacy_id = cur.lastrowid
        conn.commit()
    finally:
        conn.close()

    repaired = client.post(
        f"/api/stockout-returns/{legacy_id}/repair",
        json={"source_movement_id": parent["id"], "return_stock_id": stock_id},
    )
    assert repaired.status_code == 200, repaired.text
    parent_after = next(row for row in client.get("/api/movements", params={"limit": 500}).json() if row["id"] == parent["id"])
    assert parent_after["reverted_at"]


def test_prepare_accepts_canonical_boundary_after_existing_prepared_qty(client):
    """Regression: prepared 0.2 + 0.1 must fit stock 0.3 atomically."""
    iid = _make(client, "CAN-PREP-GUARD", "待領出 guard 品", "罐", 0.3)
    first = client.post(f"/api/items/{iid}/prepare", json={"qty": 0.2, "location": "鐵架"})
    assert first.status_code == 200, first.text
    second = client.post(f"/api/items/{iid}/prepare", json={"qty": 0.1, "location": "鐵架"})
    assert second.status_code == 200, second.text
    assert second.json()["prepared_qty"] == pytest.approx(0.3)
