# -*- coding: utf-8 -*-
"""Inventory Data Integrity P0/P1 regression tests.

Scope: DELETE stock/item guards, projected-state invariant
(total >= prepared) on every stock-reducing path, stocktake
item-total semantics + missing-location batch reject, prepared-out
rollback contract, update_item/add_stock audit, items list contract.
"""
import os
import sys
import threading

import pytest
from fastapi.testclient import TestClient

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE_DIR)

import app.config as app_config  # noqa: E402
import app.database as app_db  # noqa: E402
import main as app_main  # noqa: E402


@pytest.fixture()
def client(tmp_path, monkeypatch):
    test_db = tmp_path / "test_inventory.db"
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


def _get_item(client, item_id):
    for i in client.get("/api/items").json():
        if i["id"] == item_id:
            return i
    raise AssertionError(f"找不到 item id={item_id}")


def _db_sum(item_id):
    conn = app_db.get_db()
    try:
        return conn.execute("SELECT COALESCE(SUM(qty),0) FROM item_stocks WHERE item_id=?",
                            (item_id,)).fetchone()[0]
    finally:
        conn.close()


def _movements(client, item_id, reason=None):
    movs = client.get("/api/movements").json()
    return [m for m in movs if m["item_id"] == item_id and (reason is None or m["reason"] == reason)]


# ========== P0-A：DELETE stock ==========

class TestDeleteStock:
    def test_nonzero_stock_delete_rejected(self, client):
        item = _add_item(client, name="冷媒", qty=5)
        sid = item["stocks"][0]["id"]
        r = client.delete(f"/api/stocks/{sid}")
        assert r.status_code == 400, r.text
        assert "調整為 0" in r.json()["detail"]
        assert _get_item(client, item["id"])["total_qty"] == 5  # 庫存未動
        assert _db_sum(item["id"]) == 5

    def test_zero_stock_delete_ok(self, client):
        item = _add_item(client, name="冷媒", qty=5)
        sid = item["stocks"][0]["id"]
        assert client.patch(f"/api/stocks/{sid}", json={"qty": 0}).status_code == 200
        r = client.delete(f"/api/stocks/{sid}")
        assert r.status_code == 200, r.text
        assert _get_item(client, item["id"])["stocks"] == []

    def test_missing_stock_404(self, client):
        r = client.delete("/api/stocks/99999")
        assert r.status_code == 404


# ========== P0-B：DELETE item 真清零 ==========

class TestDeleteItem:
    def test_delete_item_zeroes_persisted_stocks(self, client):
        item = _add_item(client, name="冷媒",
                         stocks=[{"location": "A倉", "qty": 5, "note": ""},
                                 {"location": "B倉", "qty": 3, "note": ""}])
        r = client.delete(f"/api/items/{item['id']}")
        assert r.status_code == 200, r.text
        conn = app_db.get_db()
        try:
            row = conn.execute("SELECT is_deleted FROM items WHERE id=?", (item["id"],)).fetchone()
            assert row["is_deleted"] == 1  # soft-delete 保留
            assert _db_sum(item["id"]) == 0  # persisted 真歸零（P0-B 核心）
        finally:
            conn.close()
        clears = _movements(client, item["id"], "品項刪除清零")
        assert sum(m["delta"] for m in clears) == -8
        for m in clears:
            assert round(m["before_qty"] + m["delta"], 3) == round(m["after_qty"], 3) == 0

    def test_delete_item_with_prepared_rejected(self, client):
        item = _add_item(client, name="冷媒", qty=10)
        assert client.post(f"/api/items/{item['id']}/prepare", json={"qty": 3}).status_code == 200
        r = client.delete(f"/api/items/{item['id']}")
        assert r.status_code == 400, r.text
        assert _db_sum(item["id"]) == 10  # 沒被刪也沒被清零

    def test_delete_kit_zeroes_persisted_stock(self, client):
        a = _add_item(client, name="銅管", qty=10)
        kit = client.post("/api/kits", json={
            "name": "銅管組", "items": [{"item_id": a["id"], "qty": 1}]}).json()
        kit_item_id = kit["item_id"]
        assert client.post(f"/api/kits/{kit['id']}/assemble", json={"qty": 2}).status_code == 200
        r = client.delete(f"/api/kits/{kit['id']}")
        assert r.status_code == 200, r.text
        assert _db_sum(kit_item_id) == 0
        clears = _movements(client, kit_item_id, "品項刪除清零")
        assert sum(m["delta"] for m in clears) == -2


# ========== P0-C：projected invariant matrix ==========

class TestProjectedInvariant:
    def test_adjust_negative_below_prepared_rejected(self, client):
        item = _add_item(client, name="銅管", qty=10)
        client.post(f"/api/items/{item['id']}/prepare", json={"qty": 8})
        r = client.post(f"/api/items/{item['id']}/adjust",
                        json={"delta": -5, "reason": "手動調整"})
        assert r.status_code == 400, r.text
        assert _get_item(client, item["id"])["total_qty"] == 10

    def test_update_stock_decrease_below_prepared_rejected(self, client):
        item = _add_item(client, name="冷媒",
                         stocks=[{"location": "A倉", "qty": 6, "note": ""},
                                 {"location": "B倉", "qty": 4, "note": ""}])
        client.post(f"/api/items/{item['id']}/prepare", json={"qty": 8})
        sid = [s for s in item["stocks"] if s["location"] == "A倉"][0]["id"]
        r = client.patch(f"/api/stocks/{sid}", json={"qty": 1})  # new total 5 < 8
        assert r.status_code == 400, r.text
        assert _db_sum(item["id"]) == 10

    def test_direct_stockout_below_prepared_rejected(self, client):
        item = _add_item(client, name="冷媒", qty=10)
        client.post(f"/api/items/{item['id']}/prepare", json={"qty": 8})
        r = client.post("/api/stockout", json={"item_id": item["id"], "qty": 5,
                                               "destination": "案場"})
        assert r.status_code == 400, r.text
        assert _get_item(client, item["id"])["total_qty"] == 10

    def test_kit_assemble_must_not_eat_prepared(self, client):
        mat = _add_item(client, name="銅管", qty=10)
        client.post(f"/api/items/{mat['id']}/prepare", json={"qty": 8})  # 可用只剩 2
        kit = client.post("/api/kits", json={
            "name": "銅管組", "items": [{"item_id": mat["id"], "qty": 5}]}).json()
        r = client.post(f"/api/kits/{kit['id']}/assemble", json={"qty": 1})
        assert r.status_code == 400, r.text  # 10-5=5 < 8
        assert _db_sum(mat["id"]) == 10
        # 可用量內的組裝仍放行（同 kit 換小 BOM）
        kit2 = client.post("/api/kits", json={
            "name": "銅管小組", "items": [{"item_id": mat["id"], "qty": 2}]}).json()
        assert client.post(f"/api/kits/{kit2['id']}/assemble", json={"qty": 1}).status_code == 200

    def test_kit_disassemble_must_not_break_kit_prepared(self, client):
        a = _add_item(client, name="銅管", qty=10)
        kit = client.post("/api/kits", json={
            "name": "銅管組", "items": [{"item_id": a["id"], "qty": 1}]}).json()
        assert client.post(f"/api/kits/{kit['id']}/assemble", json={"qty": 5}).status_code == 200
        assert client.post(f"/api/items/{kit['item_id']}/prepare",
                           json={"qty": 3}).status_code == 200
        r = client.post(f"/api/kits/{kit['id']}/disassemble", json={"qty": 3})  # 5-3=2 < 3
        assert r.status_code == 400, r.text
        assert client.post(f"/api/kits/{kit['id']}/disassemble",
                           json={"qty": 2}).status_code == 200  # 5-2=3 >= 3 合法

    def test_consolidate_item_new_qty_below_prepared_rejected(self, client):
        unit_name = "__test箱__"
        r = client.post("/api/units", json={"name": unit_name})
        assert r.status_code in (200, 201), r.text
        item = _add_item(client, name="冷媒", qty=10)
        client.post(f"/api/items/{item['id']}/prepare", json={"qty": 8})
        r = client.post("/api/units/consolidate-item",
                        json={"item_id": item["id"], "to_unit": unit_name, "new_qty": 5})
        assert r.status_code == 400, r.text
        assert _db_sum(item["id"]) == 10

    def test_stockout_edit_increase_below_prepared_rejected(self, client):
        item = _add_item(client, name="冷媒", qty=10)
        client.post(f"/api/items/{item['id']}/prepare", json={"qty": 5})
        outs = client.get("/api/stockouts").json()
        # 先正常出庫 2（total 8 >= 5）
        assert client.post("/api/stockout", json={"item_id": item["id"], "qty": 2,
                                                  "destination": "案場"}).status_code == 200
        mid = [m for m in client.get("/api/stockouts").json()
               if m["item_id"] == item["id"] and m not in outs][0]
        # 編輯加量到 6（需再扣 4，total 4 < 5）→ 拒絕
        r = client.patch(f"/api/stockouts/{mid['id']}", json={"qty": 6})
        assert r.status_code == 400, r.text
        assert _get_item(client, item["id"])["total_qty"] == 8

    def test_return_edit_rededuct_below_prepared_rejected(self, client):
        item = _add_item(client, name="冷媒", qty=10)
        assert client.post("/api/stockout", json={"item_id": item["id"], "qty": 6,
                                                  "destination": "案場"}).status_code == 200
        outs = [m for m in client.get("/api/stockouts").json() if m["item_id"] == item["id"]]
        ret = client.post(f"/api/stockouts/{outs[0]['id']}/return",
                          json={"qty": 6, "destination": "公司"}).json()
        ret_id = ret["return_movement_id"]
        client.post(f"/api/items/{item['id']}/prepare", json={"qty": 8})  # total 10, prepared 8
        # 退回 6→2（扣回 4，total 6 < 8）→ 拒絕
        r = client.patch(f"/api/stockout-returns/{ret_id}", json={"qty": 2})
        assert r.status_code == 400, r.text
        assert _get_item(client, item["id"])["total_qty"] == 10

    def test_delete_active_return_rededuct_below_prepared_rejected(self, client):
        item = _add_item(client, name="冷媒", qty=10)
        assert client.post("/api/stockout", json={"item_id": item["id"], "qty": 6,
                                                  "destination": "案場"}).status_code == 200
        outs = [m for m in client.get("/api/stockouts").json() if m["item_id"] == item["id"]]
        ret = client.post(f"/api/stockouts/{outs[0]['id']}/return",
                          json={"qty": 6, "destination": "公司"}).json()
        client.post(f"/api/items/{item['id']}/prepare", json={"qty": 8})
        r = client.delete(f"/api/stockout-returns/{ret['return_movement_id']}")
        assert r.status_code == 400, r.text  # 扣回 6 → total 4 < 8
        assert _get_item(client, item["id"])["total_qty"] == 10

    def test_prepared_out_projected_state_allowed(self, client):
        """stock=5 prepared=5 prepared-out=2 → 3>=3 合法，共用 helper 不可誤擋。"""
        item = _add_item(client, name="冷媒", qty=5)
        client.post(f"/api/items/{item['id']}/prepare", json={"qty": 5})
        r = client.post(f"/api/items/{item['id']}/prepared-out",
                        json={"qty": 2, "note": "案場"})
        assert r.status_code == 200, r.text
        assert _get_item(client, item["id"])["total_qty"] == 3
        conn = app_db.get_db()
        try:
            prep = conn.execute("SELECT prepared_qty FROM items WHERE id=?",
                                (item["id"],)).fetchone()["prepared_qty"]
        finally:
            conn.close()
        assert prep == 3


# ========== 併發：第二個 writer 必須被拒絕 ==========

class TestConcurrentDeduction:
    def test_concurrent_direct_stockout_second_rejected(self, client):
        """20 庫存 / prepared 5，兩執行緒同時出庫 8：一個 200、一個 400，終態恆滿足 invariant。"""
        item = _add_item(client, name="冷媒", qty=20)
        client.post(f"/api/items/{item['id']}/prepare", json={"qty": 5})
        from app.services.auth import SESSION_COOKIE
        token = client.cookies.get(SESSION_COOKIE)
        barrier = threading.Barrier(2)
        results = {}

        def fire(idx):
            with TestClient(app_main.app) as c:
                c.cookies.set(SESSION_COOKIE, token)
                barrier.wait(timeout=10)
                r = c.post("/api/stockout", json={"item_id": item["id"], "qty": 8,
                                                 "destination": "案場"})
                results[idx] = r.status_code

        ts = [threading.Thread(target=fire, args=(i,)) for i in (0, 1)]
        for t in ts:
            t.start()
        for t in ts:
            t.join(timeout=60)
        assert sorted(results.values()) == [200, 400]
        final = _get_item(client, item["id"])["total_qty"]
        assert final == 12  # 20-8；第二個（12-8=4 < 5）在 boundary 被拒


# ========== prepared-out rollback contract ==========

class TestPreparedOutRollback:
    def test_prepared_out_legal_projected_state(self, client):
        """prepared-out 合法 projected state：stock=5 prepared=5 out=2 → 3>=3。"""
        item = _add_item(client, name="冷媒_R", qty=5)
        client.post(f"/api/items/{item['id']}/prepare", json={"qty": 5})
        r = client.post(f"/api/items/{item['id']}/prepared-out",
                        json={"qty": 2, "note": "案場"})
        assert r.status_code == 200, r.text
        assert _get_item(client, item["id"])["total_qty"] == 3
        conn = app_db.get_db()
        try:
            prep = conn.execute("SELECT prepared_qty FROM items WHERE id=?",
                                (item["id"],)).fetchone()["prepared_qty"]
        finally:
            conn.close()
        assert prep == 3  # prepared 也降了

    def test_prepared_out_rollback_on_write_failure(self, monkeypatch):
        """F4：stock deduction 已執行但後續 exception → rollback：stock/prepared/movement 全不變。"""
        from starlette.testclient import TestClient
        import app.routes.stockout as stockout_mod
        import main as app_main
        from app.services.auth import SESSION_COOKIE, create_session, init_admin_if_missing
        import app.database as _db
        # 獨立 fixture（不共用 client，因為要 raise_server_exceptions=False）
        import tempfile, pathlib
        tmp = pathlib.Path(tempfile.mkdtemp())
        test_db = tmp / "test.db"
        test_upload = tmp / "uploads"
        test_upload.mkdir()
        _db.DB_PATH = str(test_db)
        import app.config as _cfg; _cfg.UPLOAD_DIR = str(test_upload)
        _db.init_db()
        conn = _db.get_db()
        try:
            init_admin_if_missing(conn)
            aid = conn.execute("SELECT id FROM users WHERE username='admin'").fetchone()["id"]
            token = create_session(conn, aid)
        finally:
            conn.close()
        try:
            with TestClient(app_main.app, raise_server_exceptions=False) as c:
                c.cookies.set(SESSION_COOKIE, token)
                item = _add_item(c, name="冷媒_R2", qty=10)
                c.post(f"/api/items/{item['id']}/prepare", json={"qty": 5})
                n_mov = len(_movements(c, item["id"]))
                def boom(*a, **k):
                    raise RuntimeError("F4: injected failure after stock deduction")
                monkeypatch.setattr(stockout_mod, "_stock_payload", boom)
                r = c.post(f"/api/items/{item['id']}/prepared-out",
                           json={"qty": 2, "note": "案場"})
                assert r.status_code == 500
                assert _get_item(c, item["id"])["total_qty"] == 10
                conn2 = _db.get_db()
                try:
                    prep = conn2.execute("SELECT prepared_qty FROM items WHERE id=?",
                                         (item["id"],)).fetchone()["prepared_qty"]
                finally:
                    conn2.close()
                assert prep == 5
                assert len(_movements(c, item["id"])) == n_mov
        finally:
            try: test_db.unlink()
            except: pass


# ========== P0-E/F：stocktake ==========

class TestStocktake:
    def test_multilocation_prepared_uses_item_total(self, client):
        """A=2、B=8、prepared=5，盤 A=2（total 仍 10）必須成功。"""
        item = _add_item(client, name="冷媒",
                         stocks=[{"location": "A倉", "qty": 2, "note": ""},
                                 {"location": "B倉", "qty": 8, "note": ""}])
        client.post(f"/api/items/{item['id']}/prepare", json={"qty": 5})
        r = client.post("/api/stocktake", json={"items": [
            {"item_id": item["id"], "location": "A倉", "actual_qty": 2}]})
        assert r.status_code == 200, r.text
        assert _db_sum(item["id"]) == 10

    def test_stocktake_new_total_below_prepared_rejected(self, client):
        item = _add_item(client, name="冷媒",
                         stocks=[{"location": "A倉", "qty": 8, "note": ""},
                                 {"location": "B倉", "qty": 2, "note": ""}])
        client.post(f"/api/items/{item['id']}/prepare", json={"qty": 9})
        r = client.post("/api/stocktake", json={"items": [
            {"item_id": item["id"], "location": "B倉", "actual_qty": 0}]})  # new total 8 < 9
        assert r.status_code == 400, r.text
        assert _db_sum(item["id"]) == 10  # 全滾回

    def test_stocktake_missing_location_rejects_whole_batch(self, client):
        item = _add_item(client, name="冷媒",
                         stocks=[{"location": "A倉", "qty": 5, "note": ""}])
        r = client.post("/api/stocktake", json={"items": [
            {"item_id": item["id"], "location": "A倉", "actual_qty": 5},
            {"item_id": item["id"], "location": "幽靈倉", "actual_qty": 3}]})
        assert r.status_code == 409, r.text
        assert "重新載入" in r.json()["detail"]
        assert _db_sum(item["id"]) == 5  # 整批 rollback，A 也沒寫
        conn = app_db.get_db()
        try:
            n = conn.execute("SELECT COUNT(*) FROM stocktakes WHERE item_id=?",
                             (item["id"],)).fetchone()[0]
        finally:
            conn.close()
        assert n == 0


# ========== P1-A：update_item / add_stock audit ==========

class TestStockAuditBoundary:
    def test_new_location_positive_qty_writes_movement(self, client):
        item = _add_item(client, name="冷媒", qty=10)
        r = client.patch(f"/api/items/{item['id']}", json={"stocks": [
            {"location": "測試位置", "qty": 10, "note": ""},
            {"location": "B倉", "qty": 5, "note": ""}]})
        assert r.status_code == 200, r.text
        assert _get_item(client, item["id"])["total_qty"] == 15
        hits = [m for m in _movements(client, item["id"])
                if m["reason"] == "編輯品項調整" and m["delta"] == 5]
        assert len(hits) == 1
        assert hits[0]["before_qty"] == 0 and hits[0]["after_qty"] == 5

    def test_new_location_zero_qty_no_movement(self, client):
        item = _add_item(client, name="冷媒", qty=10)
        r = client.patch(f"/api/items/{item['id']}", json={"stocks": [
            {"location": "測試位置", "qty": 10, "note": ""},
            {"location": "B倉", "qty": 0, "note": ""}]})
        assert r.status_code == 200, r.text
        assert _get_item(client, item["id"])["total_qty"] == 10
        assert not [m for m in _movements(client, item["id"]) if m["delta"] == 0
                    and m["reason"] == "編輯品項調整"]

    def test_remove_nonzero_location_rejected(self, client):
        item = _add_item(client, name="冷媒",
                         stocks=[{"location": "A倉", "qty": 5, "note": ""},
                                 {"location": "B倉", "qty": 3, "note": ""}])
        r = client.patch(f"/api/items/{item['id']}", json={"stocks": [
            {"location": "A倉", "qty": 5, "note": ""}]})
        assert r.status_code == 400, r.text
        assert _db_sum(item["id"]) == 8  # B倉還在

    def test_remove_zero_location_ok(self, client):
        item = _add_item(client, name="冷媒",
                         stocks=[{"location": "A倉", "qty": 5, "note": ""},
                                 {"location": "B倉", "qty": 0, "note": ""}])
        r = client.patch(f"/api/items/{item['id']}", json={"stocks": [
            {"location": "A倉", "qty": 5, "note": ""}]})
        assert r.status_code == 200, r.text
        assert [s["location"] for s in _get_item(client, item["id"])["stocks"]] == ["A倉"]

    def test_stocks_sync_projected_total_checked_order_independent(self, client):
        """一次 payload 改多倉：先算 projected final total 再驗（順序無關）。"""
        for idx, payload in enumerate((
            [{"location": "A倉", "qty": 1, "note": ""}, {"location": "B倉", "qty": 4, "note": ""}],
            [{"location": "B倉", "qty": 4, "note": ""}, {"location": "A倉", "qty": 1, "note": ""}],
        )):
            item = _add_item(client, name=f"冷媒同步{idx}",
                             stocks=[{"location": "A倉", "qty": 6, "note": ""},
                                     {"location": "B倉", "qty": 4, "note": ""}])
            client.post(f"/api/items/{item['id']}/prepare", json={"qty": 8})
            r = client.patch(f"/api/items/{item['id']}", json={"stocks": payload})
            assert r.status_code == 400, r.text  # new total 5 < 8
            assert _db_sum(item["id"]) == 10

    def test_add_stock_positive_qty_writes_movement(self, client):
        item = _add_item(client, name="冷媒", qty=10)
        r = client.post(f"/api/items/{item['id']}/stocks",
                        json={"location": "B倉", "qty": 5})
        assert r.status_code == 201, r.text
        assert _get_item(client, item["id"])["total_qty"] == 15
        hits = [m for m in _movements(client, item["id"]) if m["delta"] == 5]
        assert len(hits) == 1
        assert hits[0]["before_qty"] == 0 and hits[0]["after_qty"] == 5


# ========== P1-B/C：items list contract ==========

class TestItemsListContract:
    def test_pagination_total_matches_page_stats(self, client):
        for i in range(3):
            _add_item(client, name=f"品{i}", qty=1)
        body = client.get("/api/items", params={"page": 1, "page_size": 2}).json()
        assert set(body) == {"items", "total", "page", "page_size", "stats"}
        assert body["total"] == body["stats"]["item_count"] == 3
        assert len(body["items"]) == 2
        for it in body["items"]:
            assert {"stocks", "qty", "total_qty", "in_kits", "has_photo"} <= set(it)

    def test_filters_and_search_shape(self, client):
        _add_item(client, name="冷媒R22", brand="大金", qty=5, site="office")
        _add_item(client, name="銅管", brand="日立", qty=5, site="warehouse")
        assert client.get("/api/items", params={"page": 1, "brand": "大金"}).json()["total"] == 1
        assert client.get("/api/items", params={"page": 1, "search": "銅管"}).json()["total"] == 1
        assert client.get("/api/items", params={"page": 1, "site": "warehouse"}).json()["total"] == 1
        loc_total = client.get("/api/items",
                               params={"page": 1, "location": "測試位置"}).json()["total"]
        assert loc_total == 2


# ========== F1：Duplicate BOM ==========

class TestDuplicateBOM:
    def test_duplicate_bom_cumulative_need_below_prepared_rejected(self, client):
        """F1：duplicate BOM cumulative need 突破 prepared invariant → 400。"""
        mat = _add_item(client, name="銅管", qty=10)
        client.post(f"/api/items/{mat['id']}/prepare", json={"qty": 5})
        # 手動建立 duplicate BOM（模擬 legacy data）
        kit = client.post("/api/kits", json={
            "name": "銅管組", "items": [{"item_id": mat["id"], "qty": 3}]}).json()
        # 手動插入 duplicate BOM row
        import app.database as _db
        conn = _db.get_db()
        try:
            conn.execute("INSERT INTO kit_items (kit_id, item_id, qty) VALUES (?,?,?)",
                         (kit["id"], mat["id"], 3))
            conn.commit()
        finally:
            conn.close()
        # assemble: cumulative need = 6, total=10, prepared=5, available=5 < 6
        r = client.post(f"/api/kits/{kit['id']}/assemble", json={"qty": 1})
        assert r.status_code == 400, r.text
        assert _get_item(client, mat["id"])["total_qty"] == 10

    def test_duplicate_bom_cumulative_legal(self, client):
        """F1：duplicate BOM cumulative need 在 available 範圍內 → success。"""
        mat = _add_item(client, name="銅管", qty=10)
        client.post(f"/api/items/{mat['id']}/prepare", json={"qty": 2})
        kit = client.post("/api/kits", json={
            "name": "銅管組", "items": [{"item_id": mat["id"], "qty": 3}]}).json()
        # 手動插入 duplicate BOM row
        import app.database as _db
        conn = _db.get_db()
        try:
            conn.execute("INSERT INTO kit_items (kit_id, item_id, qty) VALUES (?,?,?)",
                         (kit["id"], mat["id"], 3))
            conn.commit()
        finally:
            conn.close()
        # cumulative need = 6, available = 10-2 = 8 >= 6
        r = client.post(f"/api/kits/{kit['id']}/assemble", json={"qty": 1})
        assert r.status_code == 200, r.text
        assert _get_item(client, mat["id"])["total_qty"] == 4  # 10-6=4

    def test_create_kit_rejects_duplicate_item(self, client):
        """F1：create kit API 拒絕重複 item_id。"""
        mat = _add_item(client, name="銅管", qty=10)
        r = client.post("/api/kits", json={
            "name": "銅管組",
            "items": [{"item_id": mat["id"], "qty": 2}, {"item_id": mat["id"], "qty": 3}]})
        assert r.status_code == 400, r.text
        assert "重複" in r.json()["detail"]

    def test_update_kit_rejects_duplicate_item(self, client):
        """F1：update kit API 拒絕重複 item_id。"""
        mat = _add_item(client, name="銅管", qty=10)
        kit = client.post("/api/kits", json={
            "name": "銅管組", "items": [{"item_id": mat["id"], "qty": 1}]}).json()
        r = client.put(f"/api/kits/{kit['id']}", json={
            "name": "銅管組",
            "items": [{"item_id": mat["id"], "qty": 2}, {"item_id": mat["id"], "qty": 3}]})
        assert r.status_code == 400, r.text
        assert "重複" in r.json()["detail"]


# ========== F2/F3：Stock identity + optimistic lock ==========

class TestStockIdentity:
    def test_rename_nonzero_stock_location(self, client):
        """F3：rename location（same id）不被當成 delete+insert。"""
        item = _add_item(client, name="冷媒", qty=5, location="A倉")
        sid = item["stocks"][0]["id"]
        r = client.patch(f"/api/items/{item['id']}", json={"stocks": [
            {"id": sid, "location": "B倉", "qty": 5, "note": "", "stock_updated_at": item["stocks"][0]["updated_at"]}
        ]})
        assert r.status_code == 200, r.text
        updated = r.json()
        assert updated["total_qty"] == 5
        assert updated["stocks"][0]["id"] == sid  # 同一 stock id
        assert updated["stocks"][0]["location"] == "B倉"
        # 沒有假的 +5/-5 movement
        movs = _movements(client, item["id"])
        assert not any(m["reason"] == "編輯品項調整" and abs(m["delta"]) == 5 for m in movs)

    def test_remove_nonzero_stock_rejected(self, client):
        """F3：移除有貨 location → 400。"""
        item = _add_item(client, name="冷媒",
                         stocks=[{"location": "A倉", "qty": 5, "note": ""},
                                 {"location": "B倉", "qty": 0, "note": ""}])
        # payload 只含B倉 → 要移除A倉（有貨）→ 拒絕
        r = client.patch(f"/api/items/{item['id']}", json={"stocks": [
            {"id": item["stocks"][1]["id"], "location": "B倉", "qty": 0, "note": "",
             "stock_updated_at": item["stocks"][1]["updated_at"]}
        ]})
        assert r.status_code == 400, r.text
        assert _db_sum(item["id"]) == 5

    def test_remove_zero_stock_ok(self, client):
        """F3：移除零貨 location → success。"""
        item = _add_item(client, name="冷媒",
                         stocks=[{"location": "A倉", "qty": 5, "note": ""},
                                 {"location": "B倉", "qty": 0, "note": ""}])
        r = client.patch(f"/api/items/{item['id']}", json={"stocks": [
            {"id": item["stocks"][0]["id"], "location": "A倉", "qty": 5, "note": "",
             "stock_updated_at": item["stocks"][0]["updated_at"]}
        ]})
        assert r.status_code == 200, r.text
        assert len(r.json()["stocks"]) == 1

    def test_stale_stock_revision_rejected(self, client):
        """F2：stale stock_updated_at → 409，不覆蓋。"""
        item = _add_item(client, name="冷媒", qty=10)
        sid = item["stocks"][0]["id"]
        old_rev = item["stocks"][0]["updated_at"]
        # 模擬 concurrent stockout：直接改 DB qty
        import app.database as _db
        conn = _db.get_db()
        try:
            conn.execute("UPDATE item_stocks SET qty=5, updated_at=? WHERE id=?",
                         ("2099-01-01T00:00:00", sid))
            conn.commit()
        finally:
            conn.close()
        # 送舊 revision
        r = client.patch(f"/api/items/{item['id']}", json={"stocks": [
            {"id": sid, "location": "A倉", "qty": 10, "note": "",
             "stock_updated_at": old_rev}
        ]})
        assert r.status_code == 409, r.text
        assert "修改" in r.json()["detail"]
        # DB 仍為 5
        assert _db_sum(item["id"]) == 5

    def test_stale_revision_no_movement_written(self, client):
        """F2：stale revision 拒絕後不寫 movement。"""
        item = _add_item(client, name="冷媒", qty=10)
        sid = item["stocks"][0]["id"]
        old_rev = item["stocks"][0]["updated_at"]
        n_mov = len(_movements(client, item["id"]))
        import app.database as _db
        conn = _db.get_db()
        try:
            conn.execute("UPDATE item_stocks SET qty=5, updated_at=? WHERE id=?",
                         ("2099-01-01T00:00:00", sid))
            conn.commit()
        finally:
            conn.close()
        r = client.patch(f"/api/items/{item['id']}", json={"stocks": [
            {"id": sid, "location": "A倉", "qty": 10, "note": "",
             "stock_updated_at": old_rev}
        ]})
        assert r.status_code == 409
        assert len(_movements(client, item["id"])) == n_mov

    def test_name_edit_with_concurrent_stock_mutation_gets_409(self, client):
        """F2：只改名但帶 stale stocks → 409（不覆蓋 stock）。"""
        item = _add_item(client, name="冷媒", qty=10)
        sid = item["stocks"][0]["id"]
        old_rev = item["stocks"][0]["updated_at"]
        import app.database as _db
        conn = _db.get_db()
        try:
            conn.execute("UPDATE item_stocks SET qty=5, updated_at=? WHERE id=?",
                         ("2099-01-01T00:00:00", sid))
            conn.commit()
        finally:
            conn.close()
        # 只改名，但帶完整 stale stocks
        r = client.patch(f"/api/items/{item['id']}", json={
            "name": "冷媒R22",
            "stocks": [{"id": sid, "location": "A倉", "qty": 10, "note": "",
                        "stock_updated_at": old_rev}]
        })
        assert r.status_code == 409
        # 名稱也沒改
        assert _get_item(client, item["id"])["name"] == "冷媒"
