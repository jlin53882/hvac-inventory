"""單位字典 API 測試（2026-08-16 單位動態清單）"""
import pytest
from fastapi.testclient import TestClient

import app.database as app_db
import main as app_main
from app.services.auth import SESSION_COOKIE, create_session, init_admin_if_missing


@pytest.fixture()
def client(tmp_path, monkeypatch):
    """每個測試獨立 DB：切 DB_PATH → 重建 schema → 建立 admin → 自動登入 → 回傳帶 session 的 TestClient"""
    test_db = tmp_path / "test_inventory.db"
    monkeypatch.setattr(app_db, "DB_PATH", str(test_db))
    app_db.init_db()

    from app.services.auth import SESSION_COOKIE, create_session, init_admin_if_missing
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


def _add_role_user(client, username, role):
    """Helper：建指定角色帳號並回傳帶 session 的 client"""
    r = client.post("/api/users", json={
        "username": username, "password": "Probe1234", "display_name": f"探針{role}", "role": role})
    assert r.status_code == 201, r.text
    _conn = app_db.get_db()
    try:
        _uid = _conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()["id"]
        _token = create_session(_conn, _uid)
    finally:
        _conn.close()
    c2 = TestClient(app_main.app)
    c2.cookies.set(SESSION_COOKIE, _token)
    return c2


def _add_item(client, **kw):
    payload = {
        "brand": kw.get("brand", "測試牌"),
        "code": kw.get("code", ""),
        "name": kw.get("name", "測試品"),
        "unit": kw.get("unit", "個"),
        "site": kw.get("site", "office"),
        "stocks": kw.get("stocks", [{"location": "測試位置", "qty": 1, "note": ""}]),
    }
    r = client.post("/api/items", json=payload)
    assert r.status_code == 201, r.text
    return r.json()


# ---------- 種子 ----------
def test_units_seeded(client):
    units = client.get("/api/units").json()
    names = [u["name"] for u in units]
    assert len(units) >= 15
    for n in ("個", "罐", "瓶", "包", "組", "米", "條", "捲", "盤", "套", "箱", "台", "支", "顆", "桶"):
        assert n in names, f"種子缺 {n}"
    assert all(u["is_active"] for u in units)  # 種子全啟用


# ---------- 新增（item-mgmt） ----------
def test_units_create(client):
    r = client.post("/api/units", json={"name": "粒"})
    assert r.status_code == 201, r.text
    assert r.json()["name"] == "粒" and r.json()["is_active"] is True
    assert r.json()["sort_order"] >= 16


def test_units_create_duplicate(client):
    r = client.post("/api/units", json={"name": "個"})
    assert r.status_code == 400 and "已存在" in r.json()["detail"]


def test_units_create_blank(client):
    assert client.post("/api/units", json={"name": "   "}).status_code == 400


def test_units_create_user_ok(client):
    c2 = _add_role_user(client, "probe_s", "user")  # user 有 item-mgmt
    r = c2.post("/api/units", json={"name": "袋"})
    assert r.status_code == 201, r.text


def test_units_create_tech_forbidden(client):
    c2 = _add_role_user(client, "probe_t", "tech")  # tech 無 item-mgmt
    assert c2.post("/api/units", json={"name": "支2"}).status_code == 403


# ---------- 更新 / 停用（unit-mgmt） ----------
def test_units_update_name(client):
    uid = [u["id"] for u in client.get("/api/units").json() if u["name"] == "顆"][0]
    r = client.put(f"/api/units/{uid}", json={"name": "顆粒"})
    assert r.status_code == 200 and r.json()["name"] == "顆粒"
    assert client.put(f"/api/units/{uid}", json={"name": "個"}).status_code == 400  # 重複


def test_units_update_sort(client):
    uid = [u["id"] for u in client.get("/api/units").json() if u["name"] == "顆"][0]
    r = client.put(f"/api/units/{uid}", json={"sort_order": 5})
    assert r.status_code == 200 and r.json()["sort_order"] == 5


def test_units_toggle_active(client):
    uid = [u["id"] for u in client.get("/api/units").json() if u["name"] == "顆"][0]
    r = client.put(f"/api/units/{uid}", json={"is_active": False})
    assert r.status_code == 200 and r.json()["is_active"] is False
    # 停用後 GET 仍回傳（含停用）
    units = client.get("/api/units").json()
    u = [x for x in units if x["id"] == uid][0]
    assert u["is_active"] is False


def test_units_delete_deactivates(client):
    uid = [u["id"] for u in client.get("/api/units").json() if u["name"] == "顆"][0]
    assert client.delete(f"/api/units/{uid}").status_code == 200
    u = [x for x in client.get("/api/units").json() if x["id"] == uid][0]
    assert u["is_active"] is False  # soft delete


def test_units_manage_requires_unit_mgmt(client):
    uid = [u["id"] for u in client.get("/api/units").json() if u["name"] == "顆"][0]
    c2 = _add_role_user(client, "probe_u", "user")  # user 無 unit-mgmt
    assert c2.put(f"/api/units/{uid}", json={"is_active": True}).status_code == 403
    assert c2.delete(f"/api/units/{uid}").status_code == 403
    assert c2.post("/api/units/consolidate", json={"from_unit": "個", "to_unit": "罐"}).status_code == 403


# ---------- usage / 收編 ----------
def test_units_usage(client):
    _add_item(client, name="甲", unit="個")
    _add_item(client, name="乙", unit="/4罐")
    usage = client.get("/api/units/usage").json()
    by_unit = {u["unit"]: u["count"] for u in usage}
    assert by_unit.get("/4罐") == 1 and by_unit.get("個") == 1


def test_units_consolidate(client):
    # 來源「箱」在種子表（收編後應停用）；目標「個」
    _add_item(client, name="乙", unit="箱")
    r = client.post("/api/units/consolidate", json={"from_unit": "箱", "to_unit": "個"})
    assert r.status_code == 200, r.text
    assert r.json()["affected"] == 1
    # 品項單位已改 + 來源停用（soft delete 保留在清單）
    items = client.get("/api/items?site=office").json()
    it = [i for i in items if i["name"] == "乙"][0]
    assert it["unit"] == "個"
    u = [x for x in client.get("/api/units").json() if x["name"] == "箱"][0]
    assert u["is_active"] is False


def test_units_consolidate_blank_from(client):
    """B3 審查修正：活庫有 unit='' 品項需可收編"""
    _add_item(client, name="空白單位", unit="")
    r = client.post("/api/units/consolidate", json={"from_unit": "", "to_unit": "個"})
    assert r.status_code == 200, r.text
    assert r.json()["affected"] == 1


def test_units_consolidate_same(client):
    assert client.post("/api/units/consolidate", json={"from_unit": "罐", "to_unit": "罐"}).status_code == 400


def test_units_consolidate_target_not_in_dict(client):
    assert client.post("/api/units/consolidate",
                       json={"from_unit": "個", "to_unit": "不存在單位"}).status_code == 400


def test_units_consolidate_conflict_409(client):
    """A3：收編撞 unique key（同 brand/code/name/site 已有目標單位品項）→ 409 非 500"""
    _add_item(client, name="衝突品", unit="罐")
    _add_item(client, name="衝突品", unit="/4罐")
    r = client.post("/api/units/consolidate", json={"from_unit": "/4罐", "to_unit": "罐"})
    assert r.status_code == 409, r.text
    assert "重複" in r.json()["detail"]
