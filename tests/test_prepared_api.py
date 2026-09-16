# -*- coding: utf-8 -*-
"""待領出 API 單元測試（2026-09-16 新增）

覆蓋：
1. prepare_item 存 movements.destination（req.location or req.note）
2. list_prepared 回傳 destination 欄位
3. PATCH /api/prepared/{item_id} 原子更新數量、metadata 與 movements.destination
4. _item_payload kit items 回傳 components（JOIN kits）
"""
import os
import sys

import pytest
from fastapi.testclient import TestClient

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE_DIR)

import app.config as app_config
import app.database as app_db
import main as app_main


@pytest.fixture()
def client(tmp_path, monkeypatch):
    test_db = tmp_path / "test_prepared.db"
    test_upload = tmp_path / "uploads"
    test_upload.mkdir()
    monkeypatch.setattr(app_db, "DB_PATH", str(test_db))
    monkeypatch.setattr(app_config, "UPLOAD_DIR", str(test_upload))
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


def _add_item(client, **kw):
    stocks = kw.get("stocks")
    if stocks is None:
        stocks = [{"location": kw.get("location", "測試位置"),
                   "qty": kw.get("qty", 10), "note": kw.get("note", "")}]
    payload = {"brand": kw.get("brand", "測試牌"), "code": kw.get("code", ""),
               "name": kw.get("name", "測試品項"), "unit": kw.get("unit", "個"),
               "low_stock": kw.get("low_stock", 0), "site": kw.get("site", "office"),
               "stocks": stocks}
    r = client.post("/api/items", json=payload)
    assert r.status_code == 201, r.text
    return r.json()


def _create_kit(client, name, component_ids):
    """建立整組品項，回傳 kit item"""
    items = [{"item_id": cid, "qty": 1} for cid in component_ids]
    r = client.post("/api/kits", json={"name": name, "items": items})
    assert r.status_code in (200, 201), r.text
    return r.json()


# ========== prepare_item 存 destination ==========

class TestPrepareDestination:
    def test_prepare_stores_location_as_destination(self, client):
        """prepare_item 用 req.location 存 movements.destination"""
        item = _add_item(client, name="A品", qty=5)
        r = client.post(f"/api/items/{item['id']}/prepare",
                        json={"qty": 2, "location": "案場A"})
        assert r.status_code == 200
        # 確認 movements.destination = "案場A"
        import app.database as db
        conn = db.get_db()
        mv = conn.execute(
            "SELECT destination FROM movements WHERE item_id=? AND reason='領出準備' ORDER BY id DESC LIMIT 1",
            (item["id"],)
        ).fetchone()
        conn.close()
        assert mv["destination"] == "案場A"

    def test_prepare_fallback_to_note(self, client):
        """prepare_item 若 req.location 為空，fallback 到 req.note"""
        item = _add_item(client, name="B品", qty=5)
        r = client.post(f"/api/items/{item['id']}/prepare",
                        json={"qty": 1, "note": "備註內容"})
        assert r.status_code == 200
        import app.database as db
        conn = db.get_db()
        mv = conn.execute(
            "SELECT destination FROM movements WHERE item_id=? AND reason='領出準備' ORDER BY id DESC LIMIT 1",
            (item["id"],)
        ).fetchone()
        conn.close()
        assert mv["destination"] == "備註內容"

    def test_prepare_location_takes_priority_over_note(self, client):
        """req.location 和 req.note 都有時，location 優先"""
        item = _add_item(client, name="C品", qty=5)
        r = client.post(f"/api/items/{item['id']}/prepare",
                        json={"qty": 1, "location": "工地", "note": "備註"})
        assert r.status_code == 200
        import app.database as db
        conn = db.get_db()
        mv = conn.execute(
            "SELECT destination FROM movements WHERE item_id=? AND reason='領出準備' ORDER BY id DESC LIMIT 1",
            (item["id"],)
        ).fetchone()
        conn.close()
        assert mv["destination"] == "工地"


# ========== list_prepared 回傳 destination ==========

class TestListPreparedDestination:
    def test_list_prepared_includes_destination(self, client):
        """GET /api/prepared 回傳 destination 欄位"""
        item = _add_item(client, name="D品", qty=5)
        client.post(f"/api/items/{item['id']}/prepare",
                    json={"qty": 2, "location": "測試地點"})
        r = client.get("/api/prepared?site=")
        assert r.status_code == 200
        items = r.json()
        found = [i for i in items if i["id"] == item["id"]]
        assert len(found) == 1
        assert found[0]["destination"] == "測試地點"

    def test_list_prepared_destination_empty_when_no_note(self, client):
        """沒有備註時 destination 為空字串"""
        item = _add_item(client, name="E品", qty=5)
        client.post(f"/api/items/{item['id']}/prepare", json={"qty": 1})
        r = client.get("/api/prepared?site=")
        assert r.status_code == 200
        found = [i for i in r.json() if i["id"] == item["id"]]
        assert len(found) == 1
        assert found[0]["destination"] == ""


# ========== unified PATCH /api/prepared/{item_id} tests ==========

class TestPreparedEditContract:
    def test_active_prepared_edit_persists_qty_metadata_and_destination(self, client):
        item = _add_item(client, name="編輯品", qty=10)
        prepared = client.post(f"/api/items/{item['id']}/prepare", json={"qty": 2, "location": "舊案場"}).json()
        r = client.patch(f"/api/prepared/{item['id']}", json={
            "prepared_qty": 4, "destination": "新案場", "name": "編輯後品項",
            "brand": "新品牌", "code": "NEW-4", "unit": "個", "updated_at": prepared["updated_at"],
        })
        assert r.status_code == 200, r.text
        body = r.json()
        assert (body["prepared_qty"], body["name"], body["brand"], body["code"], body["destination"]) == (4, "編輯後品項", "新品牌", "NEW-4", "新案場")

    def test_prepared_qty_cannot_exceed_total_and_rolls_back(self, client):
        item = _add_item(client, name="數量上限", qty=5)
        prepared = client.post(f"/api/items/{item['id']}/prepare", json={"qty": 2, "location": "原地點"}).json()
        r = client.patch(f"/api/prepared/{item['id']}", json={"prepared_qty": 6, "destination": "不應保存", "updated_at": prepared["updated_at"]})
        assert r.status_code == 400
        found = next(x for x in client.get("/api/prepared?site=").json() if x["id"] == item["id"])
        assert (found["prepared_qty"], found["destination"]) == (2, "原地點")

    def test_destination_failure_rolls_back_prepared_qty(self, client):
        item = _add_item(client, name="原子性", qty=5)
        prepared = client.post(f"/api/items/{item['id']}/prepare", json={"qty": 2}).json()
        import app.database as db
        conn = db.get_db()
        conn.execute("DELETE FROM movements WHERE item_id=? AND reason='領出準備'", (item["id"],))
        conn.commit()
        conn.close()
        r = client.patch(f"/api/prepared/{item['id']}", json={"prepared_qty": 4, "destination": "沒有 movement", "updated_at": prepared["updated_at"]})
        assert r.status_code == 404
        conn = db.get_db()
        row = conn.execute("SELECT prepared_qty FROM items WHERE id=?", (item["id"],)).fetchone()
        conn.close()
        assert row["prepared_qty"] == 2

    def test_nonstock_prepared_edit_is_supported(self, client):
        created = client.post("/api/prepare/nonstock", json={"name": "臨時品", "code": "TMP-1", "unit": "個", "qty": 2, "destination": "A 工地"})
        assert created.status_code == 200, created.text
        item_id = created.json()["id"]
        prepared = next(x for x in client.get("/api/prepared?site=office").json() if x["id"] == item_id)
        r = client.patch(f"/api/prepared/{item_id}", json={"prepared_qty": 3, "destination": "B 工地", "name": "臨時品B", "code": "TMP-2", "unit": "組", "updated_at": prepared["updated_at"]})
        assert r.status_code == 200, r.text
        assert (r.json()["prepared_qty"], r.json()["name"], r.json()["destination"]) == (3, "臨時品B", "B 工地")

    def test_stale_prepared_edit_returns_409(self, client):
        item = _add_item(client, name="鎖定品", qty=5)
        prepared = client.post(f"/api/items/{item['id']}/prepare", json={"qty": 1}).json()
        first = client.patch(f"/api/prepared/{item['id']}", json={"prepared_qty": 2, "updated_at": prepared["updated_at"]})
        assert first.status_code == 200
        second = client.patch(f"/api/prepared/{item['id']}", json={"prepared_qty": 3, "updated_at": prepared["updated_at"]})
        assert second.status_code == 409

    def test_active_metadata_requires_item_management_but_qty_does_not(self, client):
        item = _add_item(client, name="權限品", qty=5)
        prepared = client.post(f"/api/items/{item['id']}/prepare", json={"qty": 1}).json()
        import app.database as db
        conn = db.get_db()
        conn.execute("INSERT INTO users (username, password_hash, display_name, role, is_active) VALUES ('admin2', 'x', 'admin2', 'admin', 1)")
        conn.execute("DELETE FROM role_permissions WHERE role_id=(SELECT id FROM roles WHERE name='admin') AND permission_id=(SELECT id FROM permissions WHERE key='item-mgmt')")
        conn.commit()
        conn.close()
        denied = client.patch(f"/api/prepared/{item['id']}", json={"name": "不應修改", "updated_at": prepared["updated_at"]})
        assert denied.status_code == 403
        allowed = client.patch(f"/api/prepared/{item['id']}", json={"prepared_qty": 2, "destination": "可修改", "updated_at": prepared["updated_at"]})
        assert allowed.status_code == 200, allowed.text

    def test_soft_deleted_without_prepared_qty_is_not_editable(self, client):
        import app.database as db
        conn = db.get_db()
        conn.execute("INSERT INTO items (name, unit, site, is_deleted, prepared_qty) VALUES ('刪除品','個','',1,0)")
        item_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        conn.commit()
        conn.close()
        assert client.patch(f"/api/prepared/{item_id}", json={"prepared_qty": 1}).status_code == 404


    def test_prepared_kit_metadata_is_rejected_without_splitting_names(self, client):
        component = _add_item(client, name="組件", qty=5)
        kit = client.post("/api/kits", json={
            "name": "舊整組", "brand": "大金", "code": "KIT-01",
            "items": [{"item_id": component["id"], "qty": 1}],
        }).json()
        kit_item_id = kit["item_id"]
        client.post(f"/api/items/{kit_item_id}/stocks", json={"location": "L1", "qty": 2})
        prepared = client.post(f"/api/items/{kit_item_id}/prepare", json={"qty": 1}).json()
        rejected = client.patch(f"/api/prepared/{kit_item_id}", json={
            "name": "偷偷改名", "brand": "其他品牌", "prepared_qty": 1,
            "updated_at": prepared["updated_at"],
        })
        assert rejected.status_code == 400
        import app.database as db
        conn = db.get_db()
        item = conn.execute("SELECT name, brand, code, prepared_qty FROM items WHERE id=?", (kit_item_id,)).fetchone()
        master = conn.execute("SELECT name FROM kits WHERE id=?", (kit["id"],)).fetchone()
        conn.close()
        assert tuple(item) == ("舊整組", "大金", "KIT-01", 1)
        assert master["name"] == "舊整組"

    def test_prepared_metadata_duplicate_returns_400_and_rolls_back(self, client):
        _add_item(client, brand="A", code="001", name="品項", unit="個", qty=5)
        second = _add_item(client, brand="B", code="002", name="其他品項", unit="個", qty=5)
        prepared = client.post(f"/api/items/{second['id']}/prepare", json={"qty": 1, "location": "原地點"}).json()
        rejected = client.patch(f"/api/prepared/{second['id']}", json={
            "name": "品項", "brand": "A", "code": "001", "unit": "個",
            "prepared_qty": 1, "updated_at": prepared["updated_at"],
        })
        assert rejected.status_code == 400, rejected.text
        import app.database as db
        conn = db.get_db()
        row = conn.execute("SELECT brand, code, name, unit, prepared_qty FROM items WHERE id=?", (second["id"],)).fetchone()
        conn.close()
        assert tuple(row) == ("B", "002", "其他品項", "個", 1)


# ========== _item_payload kit components ==========

class TestKitComponentsInPayload:
    def test_kit_item_returns_components(self, client):
        """整組品項的 _item_payload 回傳 components（JOIN kits）"""
        # 建立子品項
        c1 = _add_item(client, name="子品A", qty=5, location="L1")
        c2 = _add_item(client, name="子品B", qty=3, location="L1")
        # 建立整組
        kit = _create_kit(client, "測試整組", [c1["id"], c2["id"]])
        kit_item_id = kit["item_id"]
        # 查 prepared 不在這裡，但可以從 items API 確認
        r = client.get("/api/items")
        assert r.status_code == 200
        found = [i for i in r.json() if i["id"] == kit_item_id]
        assert len(found) == 1
        assert found[0].get("is_kit") == 1
        # kit 組合的 components 應在 kits list API 中
        r2 = client.get("/api/kits")
        assert r2.status_code == 200
        kit_list = [k for k in r2.json() if k["id"] == kit["id"]]
        assert len(kit_list) == 1
        assert len(kit_list[0]["components"]) == 2

    def test_prepared_kit_has_components_in_list(self, client):
        """待領出清單中整組品項有 components"""
        c1 = _add_item(client, name="子品X", qty=5, location="L1")
        c2 = _add_item(client, name="子品Y", qty=3, location="L1")
        kit = _create_kit(client, "整組測試", [c1["id"], c2["id"]])
        kit_item_id = kit["item_id"]
        # 整組需要有 stock 才能 prepare（先加庫存）
        client.post(f"/api/items/{kit_item_id}/stocks", json={"location": "L1", "qty": 5})
        # 準備整組
        client.post(f"/api/items/{kit_item_id}/prepare", json={"qty": 1})
        # 查 prepared
        r = client.get("/api/prepared?site=")
        assert r.status_code == 200
        found = [i for i in r.json() if i["id"] == kit_item_id]
        assert len(found) == 1
        assert "components" in found[0]
        assert len(found[0]["components"]) == 2
        # 子品項有正確欄位
        comp = found[0]["components"][0]
        assert "name" in comp
        assert "need_qty" in comp
        assert "stock" in comp
        assert "has_photo" in comp
