# -*- coding: utf-8 -*-
"""
振佳空調庫存管理系統 - 單元測試（v10：items 主檔 + item_stocks 位置庫存）
============================
執行方式（必須清 PYTHONPATH 避免 hermes 污染）：
    cd C:\\Users\\admin\\workspace\\hvac-inventory
    env -u PYTHONPATH .venv\\Scripts\\python.exe -m pytest tests/ -v

重點：
  - 每個測試用 tmp_path 建立獨立測試 DB，不會污染 inventory.db 正式資料
  - fixture `client` 自動：切 DB 路徑 → init_db() → TestClient
  - v10 語義：數量存在 item_stocks（位置庫存），品項主檔只有名稱/廠牌等
"""
import os
import sys

import pytest
from fastapi.testclient import TestClient

# 讓測試能 import 到專案根目錄的 main.py
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE_DIR)

import app.database as app_db  # noqa: E402
import main as app_main  # noqa: E402


@pytest.fixture()
def client(tmp_path, monkeypatch):
    """每個測試獨立 DB：切 DB_PATH → 重建 schema → 回傳 TestClient"""
    test_db = tmp_path / "test_inventory.db"
    monkeypatch.setattr(app_db, "DB_PATH", str(test_db))
    app_db.init_db()

    with TestClient(app_main.app) as c:
        yield c

    # 測試後清掉測試 DB（Windows 上可能仍被連線鎖住，失敗不影響）
    try:
        if test_db.exists():
            test_db.unlink()
    except PermissionError:
        pass


def _get_item(client, item_id):
    """查單筆品項（含 total_qty/location 相容欄位）"""
    items = client.get("/api/items").json()
    for i in items:
        if i["id"] == item_id:
            return i
    raise AssertionError(f"找不到 item id={item_id}")


def _add_item(client, **kw):
    """Helper：新增品項（v10：stocks[] 陣列）並回傳 dict"""
    payload = {
        "brand": kw.get("brand", "測試牌"),
        "code": kw.get("code", ""),
        "name": kw.get("name", "測試品項"),
        "unit": kw.get("unit", "個"),
        "low_stock": kw.get("low_stock", 0),
        "site": kw.get("site", "office"),
        # v10：位置庫存清單（qty/location/note 參數轉成第一筆位置）
        "stocks": [{
            "location": kw.get("location", "測試位置"),
            "qty": kw.get("qty", 10),
            "note": kw.get("note", ""),
        }],
    }
    r = client.post("/api/items", json=payload)
    assert r.status_code == 201, r.text
    return r.json()


# ========== 基本 CRUD ==========

class TestHealth:
    def test_health_ok(self, client):
        """驗證 GET /health 回傳 200 且 status 為 ok"""
        r = client.get("/health")
        assert r.status_code == 200
        assert r.json()["status"] == "ok"


class TestItemsCRUD:
    def test_create_item(self, client):
        """驗證新增品項回傳完整欄位（相容欄位 qty/total_qty/location 與 stocks 陣列）"""
        item = _add_item(client, name="冷媒管", qty=5, location="A倉")
        assert item["name"] == "冷媒管"
        assert item["qty"] == 5          # 相容欄位：總量 = SUM(stocks)
        assert item["total_qty"] == 5
        assert item["location"] == "A倉"  # 相容欄位：第一筆位置
        assert item["prepared_qty"] == 0
        assert item["is_kit"] == 0
        assert len(item["stocks"]) == 1
        assert item["stocks"][0]["location"] == "A倉"
        assert item["stocks"][0]["qty"] == 5

    def test_create_item_multi_stocks(self, client):
        """v10 核心：一個品項可放多個位置"""
        r = client.post("/api/items", json={
            "brand": "大金",
            "code": "ARC-A",
            "name": "遙控器",
            "stocks": [
                {"location": "A櫃", "qty": 1},
                {"location": "B櫃", "qty": 2},
            ],
        })
        assert r.status_code == 201
        item = r.json()
        assert len(item["stocks"]) == 2
        assert item["total_qty"] == 3  # 總量自動加總
        assert item["qty"] == 3
        assert item["location"] == "A櫃"  # 第一筆為主要位置

    def test_list_items(self, client):
        """驗證 GET /api/items 列出全部品項"""
        _add_item(client, name="一", brand="三菱")
        _add_item(client, name="二", brand="大金")
        r = client.get("/api/items")
        assert r.status_code == 200
        assert len(r.json()) == 2

    def test_list_items_filter_brand(self, client):
        """驗證以 brand 參數篩選品項"""
        _add_item(client, name="一", brand="三菱")
        _add_item(client, name="二", brand="大金")
        r = client.get("/api/items", params={"brand": "三菱"})
        items = r.json()
        assert len(items) == 1
        assert items[0]["brand"] == "三菱"

    def test_list_items_search(self, client):
        """驗證以 search 參數依品名搜尋品項"""
        _add_item(client, name="變頻風扇馬達", code="B4025397")
        r = client.get("/api/items", params={"search": "風扇"})
        items = r.json()
        assert len(items) == 1
        assert "風扇" in items[0]["name"]

    def test_list_items_search_location(self, client):
        """搜尋涵蓋位置（v10：stocks 的 location/note）"""
        _add_item(client, name="冷媒", location="編號A")
        r = client.get("/api/items", params={"search": "編號A"})
        items = r.json()
        assert len(items) == 1

    def test_update_item(self, client):
        """v10：更新位置用 stocks 全量替換"""
        item = _add_item(client, name="舊名", qty=5, location="A倉")
        r = client.patch(f"/api/items/{item['id']}", json={
            "stocks": [
                {"location": "B倉", "qty": 3},
                {"location": "C倉", "qty": 2},
            ],
        })
        assert r.status_code == 200
        updated = r.json()
        assert updated["total_qty"] == 5
        assert updated["location"] == "B倉"
        assert len(updated["stocks"]) == 2
        assert updated["name"] == "舊名"  # 沒傳的欄位不變

    def test_update_item_not_found(self, client):
        """驗證更新不存在的品項回傳 404"""
        r = client.patch("/api/items/99999", json={"stocks": [{"location": "X", "qty": 1}]})
        assert r.status_code == 404

    def test_update_item_empty_fields(self, client):
        """驗證 PATCH 空 body（無任何欄位）回傳 400"""
        item = _add_item(client)
        r = client.patch(f"/api/items/{item['id']}", json={})
        assert r.status_code == 400


# ========== v10 新增：去重防護 ==========

class TestDedup:
    def test_duplicate_create_rejected(self, client):
        """相同 (brand, code, name, unit, site) 重複新增 → 400"""
        _add_item(client, brand="大金", code="K031224", name="控制基板")
        r = client.post("/api/items", json={
            "brand": "大金", "code": "K031224", "name": "控制基板",
            "unit": "個", "site": "office",
            "stocks": [{"location": "B倉", "qty": 1}],
        })
        assert r.status_code == 400
        assert "已存在" in r.json()["detail"]

    def test_same_name_different_code_allowed(self, client):
        """同品名不同型號 → 允許（不是重複）"""
        _add_item(client, brand="大金", code="K031", name="控制基板")
        r = client.post("/api/items", json={
            "brand": "大金", "code": "K999", "name": "控制基板",
            "unit": "個", "site": "office",
            "stocks": [{"location": "B倉", "qty": 1}],
        })
        assert r.status_code == 201

    def test_same_name_different_site_allowed(self, client):
        """不同分片（辦公/倉庫）同品同型號 → 允許（兩辦公室各放一份）"""
        _add_item(client, brand="大金", code="K031", name="面板", site="office")
        r = client.post("/api/items", json={
            "brand": "大金", "code": "K031", "name": "面板",
            "unit": "個", "site": "warehouse",
            "stocks": [{"location": "倉庫區", "qty": 2}],
        })
        assert r.status_code == 201

    def test_duplicate_stock_location_merged_on_edit(self, client):
        """編輯送重複位置 → 全量替換後不產生重複位置（最後一筆勝出）"""
        item = _add_item(client, name="冷媒", location="A倉", qty=5)
        r = client.patch(f"/api/items/{item['id']}", json={
            "stocks": [
                {"location": "A倉", "qty": 3},
                {"location": "A倉", "qty": 4},
            ],
        })
        assert r.status_code == 200
        updated = r.json()
        locs = [s["location"] for s in updated["stocks"]]
        assert locs.count("A倉") == 1  # 無重複位置
        assert updated["total_qty"] == 4


# ========== 位置庫存 CRUD ==========

class TestStocksCRUD:
    def test_add_stock(self, client):
        """驗證新增位置庫存後總量自動加總"""
        item = _add_item(client, name="冷媒", location="A倉", qty=5)
        r = client.post(f"/api/items/{item['id']}/stocks",
                        json={"location": "B倉", "qty": 3})
        assert r.status_code == 201
        updated = _get_item(client, item["id"])
        assert len(updated["stocks"]) == 2
        assert updated["total_qty"] == 8

    def test_add_stock_duplicate_location_rejected(self, client):
        """同品項同位置重複加 → 400（UNIQUE(item_id, location)）"""
        item = _add_item(client, name="冷媒", location="A倉", qty=5)
        r = client.post(f"/api/items/{item['id']}/stocks",
                        json={"location": "A倉", "qty": 3})
        assert r.status_code == 400

    def test_update_stock(self, client):
        """驗證更新位置庫存數量與備註"""
        item = _add_item(client, name="冷媒", location="A倉", qty=5)
        sid = item["stocks"][0]["id"]
        r = client.patch(f"/api/stocks/{sid}", json={"qty": 8, "note": "補貨"})
        assert r.status_code == 200
        updated = _get_item(client, item["id"])
        assert updated["total_qty"] == 8

    def test_delete_stock(self, client):
        """驗證刪除位置庫存後總量同步扣減"""
        item = _add_item(client, name="冷媒", location="A倉", qty=5)
        client.post(f"/api/items/{item['id']}/stocks",
                    json={"location": "B倉", "qty": 3})
        sid = _get_item(client, item["id"])["stocks"][1]["id"]
        r = client.delete(f"/api/stocks/{sid}")
        assert r.status_code == 200
        updated = _get_item(client, item["id"])
        assert len(updated["stocks"]) == 1
        assert updated["total_qty"] == 5

    def test_delete_item_cascades_stocks(self, client):
        """驗證刪除品項會一併刪除其位置庫存"""
        item = _add_item(client, name="冷媒", location="A倉", qty=5)
        client.post(f"/api/items/{item['id']}/stocks",
                    json={"location": "B倉", "qty": 3})
        r = client.delete(f"/api/items/{item['id']}")
        assert r.status_code == 200
        items = client.get("/api/items").json()
        assert len(items) == 0


# ========== 加減庫存 ==========

class TestAdjustQty:
    def test_adjust_plus(self, client):
        """驗證正向調整庫存（進貨）"""
        item = _add_item(client, name="冷媒", qty=10)
        r = client.post(f"/api/items/{item['id']}/adjust", json={"delta": 5, "reason": "進貨"})
        assert r.status_code == 200
        assert r.json()["after"] == 15
        assert _get_item(client, item["id"])["total_qty"] == 15

    def test_adjust_minus_with_destination(self, client):
        """驗證負向調整庫存（出貨）並記錄去向"""
        item = _add_item(client, name="冷媒", qty=10)
        r = client.post(f"/api/items/{item['id']}/adjust",
                        json={"delta": -3, "reason": "出貨", "destination": "台北案場"})
        assert r.status_code == 200
        assert r.json()["after"] == 7

        # 異動紀錄有去向
        mov = client.get("/api/movements").json()
        assert len(mov) == 1
        assert mov[0]["destination"] == "台北案場"
        assert mov[0]["before_qty"] == 10
        assert mov[0]["after_qty"] == 7

    def test_adjust_not_below_zero(self, client):
        """驗證庫存不足時調整回傳 400"""
        item = _add_item(client, name="冷媒", qty=2)
        r = client.post(f"/api/items/{item['id']}/adjust", json={"delta": -10})
        assert r.status_code == 400  # 庫存不足

    def test_adjust_item_not_found(self, client):
        """驗證調整不存在的品項回傳 404"""
        r = client.post("/api/items/99999/adjust", json={"delta": 1})
        assert r.status_code == 404


# ========== 兩階段出庫（待領出 → 已領出） ==========

class TestTwoStageStockOut:
    def test_prepared_list_has_qty_field(self, client):
        """防回歸：待領出清單必須帶 qty 總量欄位（undefined bug）"""
        item = _add_item(client, name="銅管", qty=10)
        client.post(f"/api/items/{item['id']}/prepare", json={"qty": 3})
        prepared = client.get("/api/prepared").json()
        assert len(prepared) == 1
        assert prepared[0]["prepared_qty"] == 3
        assert prepared[0]["qty"] == 10     # 不能是 undefined/缺欄位
        assert prepared[0]["total_qty"] == 10
        assert "location" in prepared[0]

    def test_prepare_does_not_deduct_qty(self, client):
        """待領出：prepared_qty 增加，但總量不變"""
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
        """驗證可領出數量不足時回傳 400"""
        item = _add_item(client, name="銅管", qty=2)
        r = client.post(f"/api/items/{item['id']}/prepare", json={"qty": 5})
        assert r.status_code == 400  # 可領出數量不足

    def test_prepare_zero_qty(self, client):
        """驗證待領出數量為 0 時回傳 400"""
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
        """驗證確認出庫數量超過待領出數量時回傳 400"""
        item = _add_item(client, name="銅管", qty=10)
        client.post(f"/api/items/{item['id']}/prepare", json={"qty": 2})
        r = client.post(f"/api/items/{item['id']}/prepared-out", json={"qty": 5})
        assert r.status_code == 400  # 準備中只有 2

    def test_prepare_then_return(self, client):
        """待領出 → 退回：清 prepared_qty，總量不變"""
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


# ========== 出庫（指定位置） ==========

class TestStockOutLocation:
    def test_stockout_specific_location(self, client):
        """v10：指定從哪個位置出"""
        item = _add_item(client, name="冷媒", location="A倉", qty=5)
        client.post(f"/api/items/{item['id']}/stocks",
                    json={"location": "B倉", "qty": 3})
        r = client.post("/api/stockout", json={
            "item_id": item["id"], "qty": 2, "destination": "中山路案場",
            "location": "A倉",
        })
        assert r.status_code == 200
        updated = _get_item(client, item["id"])
        a = [s for s in updated["stocks"] if s["location"] == "A倉"][0]
        b = [s for s in updated["stocks"] if s["location"] == "B倉"][0]
        assert a["qty"] == 3  # A倉 5-2=3
        assert b["qty"] == 3   # B倉 不動
        assert updated["total_qty"] == 6

    def test_stockout_no_location_deducts_all(self, client):
        """不指定位置：依序扣（先扣第一筆）"""
        item = _add_item(client, name="明細", location="A倉", qty=5)
        client.post(f"/api/items/{item['id']}/stocks",
                    json={"location": "B倉", "qty": 3})
        r = client.post("/api/stockout", json={
            "item_id": item["id"], "qty": 6, "destination": "板橋案場",
        })
        assert r.status_code == 200
        updated = _get_item(client, item["id"])
        a = [s for s in updated["stocks"] if s["location"] == "A倉"][0]
        b = [s for s in updated["stocks"] if s["location"] == "B倉"][0]
        assert a["qty"] == 0      # A倉扣完 5
        assert b["qty"] == 2      # 剩下 1 從 B 扣 3-1=2
        assert updated["total_qty"] == 2

    def test_stockout_insufficient(self, client):
        """驗證庫存不足時出庫回傳 400"""
        item = _add_item(client, name="冷媒", qty=2)
        r = client.post("/api/stockout", json={
            "item_id": item["id"], "qty": 5, "destination": "客戶家",
        })
        assert r.status_code == 400


# ========== 整組（套件） ==========

class TestKits:
    def test_create_kit(self, client):
        """驗證建立整組（套件）並自動建立 is_kit 品項"""
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
        """驗證整組沒有元件時回傳 400"""
        r = client.post("/api/kits", json={"name": "空套件", "items": []})
        assert r.status_code == 400

    def test_assemble_deducts_materials(self, client):
        """驗證組裝整組會扣減材料庫存並增加整組庫存"""
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
        assert ia["total_qty"] == 4
        assert ib["total_qty"] == 17

        # 整組庫存 +3
        kits = client.get("/api/kits").json()
        assert kits[0]["stock_qty"] == 3

    def test_assemble_insufficient_material(self, client):
        """驗證材料不足時組裝回傳 400"""
        a = _add_item(client, name="銅管", qty=1)
        b = _add_item(client, name="接頭", qty=20)
        kit = client.post("/api/kits", json={
            "name": "銅管接頭組",
            "items": [{"item_id": a["id"], "qty": 2}, {"item_id": b["id"], "qty": 1}],
        }).json()

        r = client.post(f"/api/kits/{kit['id']}/assemble", json={"qty": 1})
        assert r.status_code == 400  # 銅管要 2 但只剩 1

    def test_disassemble_returns_materials(self, client):
        """驗證拆解整組會將材料加回庫存並扣減整組庫存"""
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
        assert ia["total_qty"] == 8
        assert ib["total_qty"] == 19

        # 整組庫存 2-1=1
        kits = client.get("/api/kits").json()
        assert kits[0]["stock_qty"] == 1

    def test_disassemble_insufficient_kit(self, client):
        """驗證整組庫存不足時拆解回傳 400"""
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
        """驗證提交盤點後庫存更新為實際數量且 diff 正確"""
        item = _add_item(client, name="冷媒", qty=10)
        r = client.post("/api/stocktake", json={
            "items": [{"item_id": item["id"], "location": "測試位置",
                       "actual_qty": 12, "note": "多找到2罐"}],
        })
        assert r.status_code == 200
        res = r.json()
        assert res["count"] == 1
        assert res["results"][0]["diff"] == 2

        # 庫存更新為實際數量
        updated = _get_item(client, item["id"])
        assert updated["total_qty"] == 12

    def test_submit_stocktake_specific_location(self, client):
        """v10：盤點指定位置的實際數量"""
        item = _add_item(client, name="冷媒", location="A倉", qty=10)
        client.post(f"/api/items/{item['id']}/stocks",
                    json={"location": "B倉", "qty": 5})
        r = client.post("/api/stocktake", json={
            "items": [{"item_id": item["id"], "location": "B倉", "actual_qty": 7}],
        })
        assert r.status_code == 200
        res = r.json()
        assert res["results"][0]["diff"] == 2  # B倉 5→7
        updated = _get_item(client, item["id"])
        assert updated["total_qty"] == 17  # A10 + B7

    def test_submit_stocktake_negative_diff(self, client):
        """驗證盤點數量少於庫存時 diff 為負數"""
        item = _add_item(client, name="冷媒", qty=10)
        r = client.post("/api/stocktake", json={
            "items": [{"item_id": item["id"], "location": "測試位置", "actual_qty": 8}],
        })
        assert r.status_code == 200
        assert r.json()["results"][0]["diff"] == -2

    def test_stocktake_dates(self, client):
        """驗證盤點日期紀錄與總 diff"""
        item = _add_item(client, name="冷媒", qty=10)
        client.post("/api/stocktake", json={
            "take_date": "2026-08-25",
            "items": [{"item_id": item["id"], "location": "測試位置", "actual_qty": 11}],
        })
        dates = client.get("/api/stocktake/dates").json()
        assert len(dates) == 1
        assert dates[0]["take_date"] == "2026-08-25"
        assert dates[0]["total_diff"] == 1


# ========== 統計（缺貨只列單一 / 低量含整組） ==========

class TestStats:
    def test_stats_basic(self, client):
        """驗證統計 API 回傳總品項數、總數量與缺貨數"""
        _add_item(client, name="品一", qty=5)
        _add_item(client, name="品二", qty=0)  # 缺貨
        s = client.get("/api/stats").json()
        assert s["total_items"] == 2
        assert s["total_qty"] == 5
        assert s["zero_stock"] == 1  # 缺貨只算單一

    def test_stats_zero_stock_excludes_kit(self, client):
        """缺貨只列單一材料：整組 qty=0 不算缺貨"""
        _add_item(client, name="單一材料", qty=0)
        a = _add_item(client, name="材料A", qty=10)
        kit = client.post("/api/kits", json={
            "name": "整組套件",
            "items": [{"item_id": a["id"], "qty": 1}],
        }).json()
        _get_item(client, kit["item_id"])  # 確保 kit item 建立

        # 把整組的庫存全扣掉（缺貨狀態）＋ low_stock=1（低庫存狀態）
        import sqlite3
        conn = sqlite3.connect(app_db.DB_PATH)
        conn.execute("UPDATE item_stocks SET qty=0 WHERE item_id=?", (kit["item_id"],))
        conn.execute("UPDATE items SET low_stock=1 WHERE id=?", (kit["item_id"],))
        conn.commit()
        conn.close()

        s = client.get("/api/stats").json()
        assert s["zero_stock"] == 1    # 整組 qty=0 不列入缺貨（只有單一材料那 1 筆）
        assert s["low_stock"] == 1     # 低庫存：整組 low_stock=1 且 qty=0<=1（材料A low_stock=0 不計）

    def test_stats_low_stock_includes_kit_and_single(self, client):
        """低庫存列整組及單一"""
        _add_item(client, name="單一低", qty=1, low_stock=3)
        a = _add_item(client, name="材料A", qty=10)
        kit = client.post("/api/kits", json={
            "name": "整組套件",
            "items": [{"item_id": a["id"], "qty": 1}],
        }).json()

        import sqlite3
        conn = sqlite3.connect(app_db.DB_PATH)
        conn.execute("UPDATE item_stocks SET qty=2 WHERE item_id=?", (kit["item_id"],))
        conn.execute("UPDATE items SET low_stock=5 WHERE id=?", (kit["item_id"],))
        conn.commit()
        conn.close()

        s = client.get("/api/stats").json()
        assert s["low_stock"] == 2  # 單一 1 筆 + 整組 1 筆


# ========== 前端頁面 ==========

class TestFrontend:
    def test_index_served(self, client):
        """驗證前端首頁可存取且包含庫存內容"""
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
        _add_item(client, name="辦公室品項")
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
        _add_item(client, name="辦公室A", qty=5)
        _add_item(client, name="辦公室B", qty=3)
        _add_item(client, name="倉庫品", qty=10, site="warehouse")

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