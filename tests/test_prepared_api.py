# -*- coding: utf-8 -*-
"""待領出 API 單元測試（2026-09-16 新增）

覆蓋：
1. prepare_item 存 movements.destination（req.location or req.note）
2. list_prepared 回傳 destination 欄位
3. PUT /api/prepared/{item_id}/destination 更新 movements.destination
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


# ========== PUT /api/prepared/{item_id}/destination ==========

class TestUpdatePreparedDestination:
    def test_update_destination(self, client):
        """PUT /api/prepared/{id}/destination 更新 movements.destination"""
        item = _add_item(client, name="F品", qty=5)
        client.post(f"/api/items/{item['id']}/prepare",
                    json={"qty": 1, "location": "舊地點"})
        r = client.put(f"/api/prepared/{item['id']}/destination",
                       json={"destination": "新地點"})
        assert r.status_code == 200
        assert r.json()["destination"] == "新地點"
        # 確認 DB 更新
        import app.database as db
        conn = db.get_db()
        mv = conn.execute(
            "SELECT destination FROM movements WHERE item_id=? AND reason='領出準備' ORDER BY id DESC LIMIT 1",
            (item["id"],)
        ).fetchone()
        conn.close()
        assert mv["destination"] == "新地點"

    def test_update_destination_clear(self, client):
        """PUT 清空 destination"""
        item = _add_item(client, name="G品", qty=5)
        client.post(f"/api/items/{item['id']}/prepare",
                    json={"qty": 1, "location": "有備註"})
        r = client.put(f"/api/prepared/{item['id']}/destination",
                       json={"destination": ""})
        assert r.status_code == 200
        assert r.json()["destination"] == ""

    def test_update_destination_no_movement_404(self, client):
        """沒有 prepare 紀錄的品項回傳 404"""
        item = _add_item(client, name="H品", qty=5)
        r = client.put(f"/api/prepared/{item['id']}/destination",
                       json={"destination": "test"})
        assert r.status_code == 404

    def test_update_destination_truncates_long(self, client):
        """超長 destination 截斷到 200 字元"""
        item = _add_item(client, name="I品", qty=5)
        client.post(f"/api/items/{item['id']}/prepare", json={"qty": 1})
        long_text = "A" * 300
        r = client.put(f"/api/prepared/{item['id']}/destination",
                       json={"destination": long_text})
        assert r.status_code == 200
        assert len(r.json()["destination"]) == 200


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
