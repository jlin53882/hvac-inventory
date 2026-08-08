# -*- coding: utf-8 -*-
"""
冷凍空調庫存系統 - 單元測試
============================
執行方式（必須清 PYTHONPATH 避免 hermes 污染）：
    cd C:\\Users\\admin\\workspace\\hvac-inventory
    env -u PYTHONPATH .venv\\Scripts\\python.exe -m pytest tests/ -v

重點：
  - 每個測試用 tmp_path 建立獨立測試 DB，不會污染 inventory.db 正式資料
  - fixture `client` 自動：切 DB 路徑 → init_db() → TestClient
"""
import os
import sys

import pytest
from fastapi.testclient import TestClient

# 讓測試能 import 到專案根目錄的 main.py
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE_DIR)

import main as app_main  # noqa: E402


@pytest.fixture()
def client(tmp_path, monkeypatch):
    """每個測試獨立 DB：切 DB_PATH → 重建 schema → 回傳 TestClient"""
    test_db = tmp_path / "test_inventory.db"
    monkeypatch.setattr(app_main, "DB_PATH", str(test_db))
    app_main.init_db()

    with TestClient(app_main.app) as c:
        yield c

    # 測試後清掉測試 DB（Windows 上可能仍被連線鎖住，失敗不影響）
    try:
        if test_db.exists():
            test_db.unlink()
    except PermissionError:
        pass


def _get_item(client, item_id):
    """Helper：查單筆品項（後端無 GET /api/items/{id}，用 list 過濾）"""
    items = client.get("/api/items").json()
    for i in items:
        if i["id"] == item_id:
            return i
    raise AssertionError(f"找不到 item id={item_id}")


def _add_item(client, **kw):
    """Helper：新增品項並回傳 dict"""
    payload = {
        "brand": kw.get("brand", "測試牌"),
        "code": kw.get("code", ""),
        "name": kw.get("name", "測試品項"),
        "qty": kw.get("qty", 10),
        "unit": kw.get("unit", "個"),
        "location": kw.get("location", "測試位置"),
        "note": kw.get("note", ""),
        "low_stock": kw.get("low_stock", 0),
        "site": kw.get("site", "office"),
    }
    r = client.post("/api/items", json=payload)
    assert r.status_code == 201, r.text
    return r.json()


# ========== 基本 CRUD ==========

class TestHealth:
    def test_health_ok(self, client):
        r = client.get("/health")
        assert r.status_code == 200
        assert r.json()["status"] == "ok"


class TestItemsCRUD:
    def test_create_item(self, client):
        item = _add_item(client, name="冷媒管", qty=5, location="A倉")
        assert item["name"] == "冷媒管"
        assert item["qty"] == 5
        assert item["location"] == "A倉"
        assert item["prepared_qty"] == 0
        assert item["is_kit"] == 0

    def test_list_items(self, client):
        _add_item(client, name="品項一", brand="三菱")
        _add_item(client, name="品項二", brand="大金")
        r = client.get("/api/items")
        assert r.status_code == 200
        assert len(r.json()) == 2

    def test_list_items_filter_brand(self, client):
        _add_item(client, name="品項一", brand="三菱")
        _add_item(client, name="品項二", brand="大金")
        r = client.get("/api/items", params={"brand": "三菱"})
        items = r.json()
        assert len(items) == 1
        assert items[0]["brand"] == "三菱"

    def test_list_items_search(self, client):
        _add_item(client, name="變頻風扇馬達", code="B4025397")
        r = client.get("/api/items", params={"search": "風扇"})
        items = r.json()
        assert len(items) == 1
        assert "風扇" in items[0]["name"]

    def test_update_item(self, client):
        item = _add_item(client, name="舊名", location="A倉")
        r = client.patch(f"/api/items/{item['id']}", json={"location": "B倉", "note": "新備註"})
        assert r.status_code == 200
        updated = r.json()
        assert updated["location"] == "B倉"
        assert updated["note"] == "新備註"
        assert updated["name"] == "舊名"  # 沒傳的欄位不變

    def test_update_item_not_found(self, client):
        r = client.patch("/api/items/99999", json={"location": "X"})
        assert r.status_code == 404

    def test_update_item_empty_fields(self, client):
        item = _add_item(client)
        r = client.patch(f"/api/items/{item['id']}", json={})
        assert r.status_code == 400


class TestAdjustQty:
    def test_adjust_plus(self, client):
        item = _add_item(client, name="冷媒", qty=10)
        r = client.post(f"/api/items/{item['id']}/adjust", json={"delta": 5, "reason": "進貨"})
        assert r.status_code == 200
        assert r.json()["qty"] == 15

    def test_adjust_minus_with_destination(self, client):
        item = _add_item(client, name="冷媒", qty=10)
        r = client.post(f"/api/items/{item['id']}/adjust",
                        json={"delta": -3, "reason": "出貨", "destination": "台北案場"})
        assert r.status_code == 200
        assert r.json()["qty"] == 7

        # 異動紀錄有去向
        mov = client.get("/api/movements").json()
        assert len(mov) == 1
        assert mov[0]["destination"] == "台北案場"
        assert mov[0]["before_qty"] == 10
        assert mov[0]["after_qty"] == 7

    def test_adjust_not_below_zero(self, client):
        item = _add_item(client, name="冷媒", qty=2)
        r = client.post(f"/api/items/{item['id']}/adjust", json={"delta": -10})
        assert r.status_code == 200
        assert r.json()["qty"] == 0  # 下限 0，不會變負

    def test_adjust_item_not_found(self, client):
        r = client.post("/api/items/99999/adjust", json={"delta": 1})
        assert r.status_code == 404


# ========== 兩階段出庫（待領出 → 已領出） ==========

class TestTwoStageStockOut:
    def test_prepare_does_not_deduct_qty(self, client):
        """待領出：prepared_qty 增加，但 qty 不變"""
        item = _add_item(client, name="銅管", qty=10)
        r = client.post(f"/api/items/{item['id']}/prepare", json={"qty": 3})
        assert r.status_code == 200
        p = r.json()
        assert p["prepared_qty"] == 3
        assert p["qty"] == 10  # 庫存沒扣

        # 出現在待領出清單
        prepared = client.get("/api/prepared").json()
        assert len(prepared) == 1
        assert prepared[0]["id"] == item["id"]

    def test_prepare_insufficient(self, client):
        item = _add_item(client, name="銅管", qty=2)
        r = client.post(f"/api/items/{item['id']}/prepare", json={"qty": 5})
        assert r.status_code == 400  # 可領出數量不足

    def test_prepare_zero_qty(self, client):
        item = _add_item(client, name="銅管", qty=10)
        r = client.post(f"/api/items/{item['id']}/prepare", json={"qty": 0})
        assert r.status_code == 400

    def test_prepare_then_confirm_out(self, client):
        """待領出 → 確認已領出：扣庫存 + 記去向"""
        item = _add_item(client, name="銅管", qty=10)
        client.post(f"/api/items/{item['id']}/prepare", json={"qty": 4})

        r = client.post(f"/api/items/{item['id']}/prepared-out",
                        json={"qty": 4, "note": "中和工地"})
        assert r.status_code == 200
        p = r.json()
        assert p["qty"] == 6          # 庫存被扣
        assert p["prepared_qty"] == 0  # 待領出清空

        # 異動紀錄：去向 = 中和工地
        mov = client.get("/api/movements").json()
        outs = [m for m in mov if m["reason"] == "出庫"]
        assert len(outs) == 1
        assert outs[0]["destination"] == "中和工地"
        assert outs[0]["before_qty"] == 10
        assert outs[0]["after_qty"] == 6

    def test_confirm_out_exceeds_prepared(self, client):
        item = _add_item(client, name="銅管", qty=10)
        client.post(f"/api/items/{item['id']}/prepare", json={"qty": 2})
        r = client.post(f"/api/items/{item['id']}/prepared-out", json={"qty": 5})
        assert r.status_code == 400  # 準備中只有 2

    def test_prepare_then_return(self, client):
        """待領出 → 退回：清 prepared_qty，庫存不變"""
        item = _add_item(client, name="銅管", qty=10)
        client.post(f"/api/items/{item['id']}/prepare", json={"qty": 3})
        r = client.post(f"/api/items/{item['id']}/prepared-return", json={"qty": 3})
        assert r.status_code == 200
        p = r.json()
        assert p["prepared_qty"] == 0
        assert p["qty"] == 10

        # 待領出清單空了
        prepared = client.get("/api/prepared").json()
        assert len(prepared) == 0


# ========== 整組（套件） ==========

class TestKits:
    def test_create_kit(self, client):
        a = _add_item(client, name="銅管", qty=10)
        b = _add_item(client, name="接頭", qty=20)
        r = client.post("/api/kits", json={
            "name": "銅管接頭組",
            "items": [{"item_id": a["id"], "qty": 2}, {"item_id": b["id"], "qty": 1}],
            "note": "標準套件",
        })
        assert r.status_code == 201
        assert r.json()["name"] == "銅管接頭組"

        # 自動建立 is_kit=1 的品項
        kits = client.get("/api/kits").json()
        assert len(kits) == 1
        assert kits[0]["name"] == "銅管接頭組"
        assert len(kits[0]["components"]) == 2

    def test_create_kit_requires_items(self, client):
        r = client.post("/api/kits", json={"name": "空套件", "items": []})
        assert r.status_code == 400

    def test_assemble_deducts_materials(self, client):
        a = _add_item(client, name="銅管", qty=10)
        b = _add_item(client, name="接頭", qty=20)
        kit = client.post("/api/kits", json={
            "name": "銅管接頭組",
            "items": [{"item_id": a["id"], "qty": 2}, {"item_id": b["id"], "qty": 1}],
        }).json()

        r = client.post(f"/api/kits/{kit['id']}/assemble", json={"qty": 3})
        assert r.status_code == 200

        # 材料被扣：銅管 10-6=4、接頭 20-3=17
        ia = _get_item(client, a["id"])
        ib = _get_item(client, b["id"])
        assert ia["qty"] == 4
        assert ib["qty"] == 17

        # 整組庫存 +3
        kits = client.get("/api/kits").json()
        assert kits[0]["stock_qty"] == 3

    def test_assemble_insufficient_material(self, client):
        a = _add_item(client, name="銅管", qty=1)
        b = _add_item(client, name="接頭", qty=20)
        kit = client.post("/api/kits", json={
            "name": "銅管接頭組",
            "items": [{"item_id": a["id"], "qty": 2}, {"item_id": b["id"], "qty": 1}],
        }).json()

        r = client.post(f"/api/kits/{kit['id']}/assemble", json={"qty": 1})
        assert r.status_code == 400  # 銅管要 2 但只剩 1

    def test_disassemble_returns_materials(self, client):
        a = _add_item(client, name="銅管", qty=10)
        b = _add_item(client, name="接頭", qty=20)
        kit = client.post("/api/kits", json={
            "name": "銅管接頭組",
            "items": [{"item_id": a["id"], "qty": 2}, {"item_id": b["id"], "qty": 1}],
        }).json()
        client.post(f"/api/kits/{kit['id']}/assemble", json={"qty": 2})

        r = client.post(f"/api/kits/{kit['id']}/disassemble", json={"qty": 1})
        assert r.status_code == 200

        # 材料加回：銅管 6+2=8、接頭 18+1=19
        ia = _get_item(client, a["id"])
        ib = _get_item(client, b["id"])
        assert ia["qty"] == 8
        assert ib["qty"] == 19

        # 整組庫存 2-1=1
        kits = client.get("/api/kits").json()
        assert kits[0]["stock_qty"] == 1

    def test_disassemble_insufficient_kit(self, client):
        a = _add_item(client, name="銅管", qty=10)
        b = _add_item(client, name="接頭", qty=20)
        kit = client.post("/api/kits", json={
            "name": "銅管接頭組",
            "items": [{"item_id": a["id"], "qty": 2}, {"item_id": b["id"], "qty": 1}],
        }).json()

        r = client.post(f"/api/kits/{kit['id']}/disassemble", json={"qty": 5})
        assert r.status_code == 400  # 整組庫存只有 0


# ========== 盤點 ==========

class TestStocktake:
    def test_submit_stocktake(self, client):
        item = _add_item(client, name="冷媒", qty=10)
        r = client.post("/api/stocktake", json={
            "items": [{"item_id": item["id"], "actual_qty": 12, "note": "多找到2罐"}],
        })
        assert r.status_code == 200
        res = r.json()
        assert res["count"] == 1
        assert res["results"][0]["diff"] == 2

        # 庫存更新為實際數量
        updated = _get_item(client, item["id"])
        assert updated["qty"] == 12

    def test_submit_stocktake_negative_diff(self, client):
        item = _add_item(client, name="冷媒", qty=10)
        r = client.post("/api/stocktake", json={
            "items": [{"item_id": item["id"], "actual_qty": 8}],
        })
        assert r.status_code == 200
        assert r.json()["results"][0]["diff"] == -2

    def test_stocktake_dates(self, client):
        item = _add_item(client, name="冷媒", qty=10)
        client.post("/api/stocktake", json={
            "take_date": "2026-08-25",
            "items": [{"item_id": item["id"], "actual_qty": 11}],
        })
        dates = client.get("/api/stocktake/dates").json()
        assert len(dates) == 1
        assert dates[0]["take_date"] == "2026-08-25"
        assert dates[0]["total_diff"] == 1


# ========== 統計（缺貨只列單一 / 低庫存含整組） ==========

class TestStats:
    def test_stats_basic(self, client):
        _add_item(client, name="品項一", qty=5)
        _add_item(client, name="品項二", qty=0)  # 缺貨
        s = client.get("/api/stats").json()
        assert s["total_items"] == 2
        assert s["total_qty"] == 5
        assert s["zero_stock"] == 1  # 缺貨只算單一

    def test_stats_zero_stock_excludes_kit(self, client):
        """缺貨只列單一材料：整組 qty=0 不算缺貨"""
        _add_item(client, name="單一材料", qty=0)  # 單一缺貨
        a = _add_item(client, name="材料A", qty=10)
        kit = client.post("/api/kits", json={
            "name": "整組套件",
            "items": [{"item_id": a["id"], "qty": 1}],
        }).json()

        # 把整組庫存設成 0（缺貨狀態）＋ low_stock=1（低庫存狀態）
        import sqlite3
        conn = sqlite3.connect(app_main.DB_PATH)
        conn.execute("UPDATE items SET qty=0, low_stock=1 WHERE id=?", (kit["item_id"],))
        conn.commit()
        conn.close()

        s = client.get("/api/stats").json()
        assert s["zero_stock"] == 1    # 整組 qty=0 不列入缺貨（只有單一材料那 1 筆）
        assert s["low_stock"] == 1     # 低庫存整組也算（整組 low_stock=1 且 qty<=1）

    def test_stats_low_stock_includes_kit_and_single(self, client):
        """低庫存列整組及單一"""
        _add_item(client, name="單一低庫存", qty=1, low_stock=3)
        a = _add_item(client, name="材料A", qty=10)
        kit = client.post("/api/kits", json={
            "name": "整組套件",
            "items": [{"item_id": a["id"], "qty": 1}],
        }).json()

        import sqlite3
        conn = sqlite3.connect(app_main.DB_PATH)
        conn.execute("UPDATE items SET qty=2, low_stock=5 WHERE id=?", (kit["item_id"],))
        conn.commit()
        conn.close()

        s = client.get("/api/stats").json()
        assert s["low_stock"] == 2  # 單一 1 筆 + 整組 1 筆


# ========== 前端頁面 ==========

class TestFrontend:
    def test_index_served(self, client):
        r = client.get("/")
        assert r.status_code == 200
        assert "庫存" in r.text  # 前端頁面有內容


# ========== 分片（辦公室 / 倉庫） ==========

class TestSiteSharding:
    def test_create_item_default_office(self, client):
        """新增品項預設是辦公室（site=office）"""
        item = _add_item(client, name="辦公室品項")
        assert item["site"] == "office"

    def test_create_item_warehouse(self, client):
        """新增品項指定倉庫"""
        item = _add_item(client, name="倉庫品項", site="warehouse")
        assert item["site"] == "warehouse"

    def test_list_items_site_filter(self, client):
        """site 篩選：只回該分片品項"""
        _add_item(client, name="辦公室品項")  # site=office（預設）
        _add_item(client, name="倉庫品項", site="warehouse")

        office = client.get("/api/items", params={"site": "office"}).json()
        warehouse = client.get("/api/items", params={"site": "warehouse"}).json()
        assert len(office) == 1
        assert len(warehouse) == 1
        assert office[0]["name"] == "辦公室品項"
        assert warehouse[0]["name"] == "倉庫品項"

    def test_list_items_site_all(self, client):
        """site=all 或無參數：回全部品項"""
        _add_item(client, name="辦公室品項")
        _add_item(client, name="倉庫品項", site="warehouse")
        all_items = client.get("/api/items", params={"site": "all"}).json()
        assert len(all_items) == 2

    def test_stats_site_separated(self, client):
        """統計分片分開：辦公室/倉庫各自統計"""
        _add_item(client, name="辦公室品項A", qty=5)
        _add_item(client, name="辦公室品項B", qty=3)
        _add_item(client, name="倉庫品項", qty=10, site="warehouse")

        office = client.get("/api/stats", params={"site": "office"}).json()
        warehouse = client.get("/api/stats", params={"site": "warehouse"}).json()
        assert office["total_items"] == 2
        assert office["total_qty"] == 8
        assert warehouse["total_items"] == 1
        assert warehouse["total_qty"] == 10

    def test_prepared_site_filter(self, client):
        """待領出清單分片分開"""
        office_item = _add_item(client, name="辦公室品項", qty=10)
        wh_item = _add_item(client, name="倉庫品項", qty=10, site="warehouse")
        client.post(f"/api/items/{office_item['id']}/prepare", json={"qty": 2})
        client.post(f"/api/items/{wh_item['id']}/prepare", json={"qty": 3})

        office_prepared = client.get("/api/prepared", params={"site": "office"}).json()
        wh_prepared = client.get("/api/prepared", params={"site": "warehouse"}).json()
        assert len(office_prepared) == 1
        assert office_prepared[0]["prepared_qty"] == 2
        assert len(wh_prepared) == 1
        assert wh_prepared[0]["prepared_qty"] == 3

    def test_stockouts_site_filter(self, client):
        """已領出紀錄分片分開"""
        office_item = _add_item(client, name="辦公室品項", qty=10)
        wh_item = _add_item(client, name="倉庫品項", qty=10, site="warehouse")
        client.post(f"/api/items/{office_item['id']}/adjust",
                    json={"delta": -2, "reason": "出庫", "destination": "辦公室去向"})
        client.post(f"/api/items/{wh_item['id']}/adjust",
                    json={"delta": -3, "reason": "出庫", "destination": "倉庫去向"})

        office_outs = client.get("/api/stockouts", params={"site": "office"}).json()
        wh_outs = client.get("/api/stockouts", params={"site": "warehouse"}).json()
        assert len(office_outs) == 1
        assert office_outs[0]["destination"] == "辦公室去向"
        assert len(wh_outs) == 1
        assert wh_outs[0]["destination"] == "倉庫去向"

    def test_update_item_site(self, client):
        """編輯品項可以搬移分片"""
        item = _add_item(client, name="品項", site="office")
        r = client.patch(f"/api/items/{item['id']}", json={"site": "warehouse"})
        assert r.status_code == 200
        assert r.json()["site"] == "warehouse"
