# -*- coding: utf-8 -*-
"""
行事曆派工 - 單元測試
============================
覆蓋：
- service_types 種子與管理（admin / 非 admin 403）
- appointments CRUD + 衝突 409 + 雙人指派 + 防呆 400
- viewer 寫入 403（require_login 單點封鎖）
- 匯出工程日報表 xlsx（openpyxl 讀回驗證內容與格式）
- assignable-users 可指派人員清單

執行：
    env -u PYTHONPATH .venv\\Scripts\\python.exe -m pytest tests/test_appointments.py -v
"""
import io
import os
import sys

import pytest
from fastapi.testclient import TestClient

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE_DIR)

import app.database as app_db  # noqa: E402
import main as app_main  # noqa: E402


@pytest.fixture()
def client(tmp_path, monkeypatch):
    """獨立測試 DB + admin 登入"""
    test_db = tmp_path / "test_inventory.db"
    monkeypatch.setattr(app_db, "DB_PATH", str(test_db))
    app_db.init_db()
    from app.services.auth import init_admin_if_missing
    _conn = app_db.get_db()
    try:
        init_admin_if_missing(_conn)
    finally:
        _conn.close()
    with TestClient(app_main.app) as c:
        r = c.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
        assert r.status_code == 200
        yield c
    try:
        if test_db.exists():
            test_db.unlink()
    except PermissionError:
        pass


def _login(client_factory_conn, username, password):
    """另開 TestClient 登入指定帳號（viewer/user 測試用）"""
    c = TestClient(app_main.app)
    r = c.post("/api/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return c


def _create_user(admin_client, username, role):
    r = admin_client.post("/api/users", json={
        "username": username, "password": "Passw0rd!", "display_name": username, "role": role,
    })
    assert r.status_code == 201, r.text
    return r.json()


# ---------- service_types 種子 ----------


def test_service_types_seeded(client):
    r = client.get("/api/service-types")
    assert r.status_code == 200
    names = [s["name"] for s in r.json()]
    assert names == ["保養", "維修", "安裝", "配管"]
    assert [s["id"] for s in r.json()] == [1, 2, 3, 4]


def test_service_types_crud_admin(client):
    # 新增
    r = client.post("/api/service-types", json={"name": "報價勘查", "sort_order": 5})
    assert r.status_code == 200
    svc_id = r.json()["id"]
    # 重名 400
    r = client.post("/api/service-types", json={"name": "報價勘查"})
    assert r.status_code == 400
    # 更新
    r = client.put(f"/api/service-types/{svc_id}", json={"name": "報價勘查2", "sort_order": 6, "is_active": 1})
    assert r.status_code == 200 and r.json()["name"] == "報價勘查2"
    # 停用（DELETE → is_active=0 不真刪）
    r = client.delete(f"/api/service-types/{svc_id}")
    assert r.status_code == 200
    row = client.get("/api/service-types").json()
    assert [s["id"] for s in row if s["is_active"] == 1] == [1, 2, 3, 4]


def test_service_types_requires_admin(client):
    _create_user(client, "user1", "user")
    c = _login(None, "user1", "Passw0rd!")
    try:
        assert c.post("/api/service-types", json={"name": "X"}).status_code == 403
        assert c.put("/api/service-types/1", json={"name": "X", "sort_order": 1, "is_active": 1}).status_code == 403
        assert c.delete("/api/service-types/1").status_code == 403
    finally:
        c.close()


# ---------- appointments CRUD ----------


def _appt_body(**over):
    body = {
        "client_name": "陳先生 (B棟 3F)",
        "address": "新北市板橋區中山路一段 100 號",
        "service_type_id": 2,  # 維修
        "date": "2026-08-12",
        "start_time": "09:00",
        "end_time": "11:00",
        "note": "閃紅燈維護",
        "user_ids": [1],
    }
    body.update(over)
    return body


def test_create_appointment(client):
    r = client.post("/api/appointments", json=_appt_body())
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["client_name"] == "陳先生 (B棟 3F)"
    assert d["address"] == "新北市板橋區中山路一段 100 號"
    assert d["service_name"] == "維修"
    assert d["user_ids"] == [1]
    assert d["assignees"][0]["name"] == "管理員"
    # 新增者（UI 顯示用，Excel 不匯出）
    assert d["created_by"] == 1
    assert d["created_by_name"] == "管理員"
    assert d["created_at"]


def test_appointment_validation(client):
    # 時間倒置 400
    assert client.post("/api/appointments", json=_appt_body(start_time="11:00", end_time="09:00")).status_code == 400
    # 沒填客戶 400
    assert client.post("/api/appointments", json=_appt_body(client_name="  ")).status_code == 400
    # 沒指派人員 → 200（2026-08-12 家豪指定：負責人員可空，明細以新增者標示）
    r = client.post("/api/appointments", json=_appt_body(user_ids=[]))
    assert r.status_code == 200, r.text
    assert r.json()["assignees"] == []
    # 不存在人員 400
    assert client.post("/api/appointments", json=_appt_body(user_ids=[999])).status_code == 400


def test_appointment_conflict_409(client):
    assert client.post("/api/appointments", json=_appt_body()).status_code == 200
    # 同人同時段重疊 → 409
    r = client.post("/api/appointments", json=_appt_body(
        client_name="張小姐 (A棟 12F)", start_time="10:00", end_time="12:00"))
    assert r.status_code == 409
    assert "衝突" in r.json()["detail"]
    # 同人相接不重疊（11:00 結束、11:00 開始）→ 200
    r = client.post("/api/appointments", json=_appt_body(
        client_name="張小姐 (A棟 12F)", start_time="11:00", end_time="13:00"))
    assert r.status_code == 200
    # 不同人同時段 → 200（需第二個帳號）
    _create_user(client, "user1", "user")
    r = client.post("/api/appointments", json=_appt_body(
        client_name="王先生", start_time="10:00", end_time="12:00", user_ids=[2]))
    assert r.status_code == 200


def test_edit_keeps_creator(client):
    """編輯行程不改變新增者（created_by 保留原值）"""
    r = client.post("/api/appointments", json=_appt_body())
    appt_id = r.json()["id"]
    assert r.json()["created_by_name"] == "管理員"
    r = client.put(f"/api/appointments/{appt_id}", json=_appt_body(
        client_name="改名客戶", start_time="14:00", end_time="16:00"))
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["client_name"] == "改名客戶"
    assert d["created_by"] == 1
    assert d["created_by_name"] == "管理員"


def test_list_includes_creator(client):
    """月/日查詢回傳 created_by_name（前端明細卡顯示用）"""
    client.post("/api/appointments", json=_appt_body())
    r = client.get("/api/appointments?date=2026-08-12")
    assert r.status_code == 200
    d = r.json()[0]
    assert d["created_by_name"] == "管理員"
    assert d["created_at"]
    r = client.get("/api/appointments?year=2026&month=8")
    assert r.json()[0]["created_by_name"] == "管理員"


def test_create_without_service_type(client):
    """service_type_id 可省略（API 相容，供公開填報場景；前端 UI 已加「請選擇服務項目」檢查）"""
    r = client.post("/api/appointments", json=_appt_body(service_type_id=None))
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["service_name"] is None
    assert d["service_type_id"] is None


def test_appointment_edit_excludes_self(client):
    r = client.post("/api/appointments", json=_appt_body())
    appt_id = r.json()["id"]
    # 編輯自己但不重疊 → 200（排除自己，不會誤判撞自己）
    r = client.put(f"/api/appointments/{appt_id}", json=_appt_body(
        start_time="10:00", end_time="12:00"))
    assert r.status_code == 200, r.text
    # 衝突檢查仍有效：同一人（管理員 id=1）此時段再排 → 409
    r = client.post("/api/appointments", json=_appt_body(
        client_name="李四", start_time="10:30", end_time="11:30", user_ids=[1]))
    assert r.status_code == 409


def test_double_assignee_and_delete(client):
    _create_user(client, "user1", "user")
    r = client.post("/api/appointments", json=_appt_body(user_ids=[1, 2]))
    assert r.status_code == 200
    d = r.json()
    assert sorted(d["user_ids"]) == [1, 2]
    assert len(d["assignees"]) == 2
    # 刪除
    r = client.delete(f"/api/appointments/{d['id']}")
    assert r.status_code == 200
    assert client.get(f"/api/appointments?date=2026-08-12").json() == []


def test_viewer_write_403(client):
    _create_user(client, "viewer1", "viewer")
    c = _login(None, "viewer1", "Passw0rd!")
    try:
        # viewer 可讀
        assert c.get("/api/appointments?date=2026-08-12").status_code == 200
        assert c.get("/api/service-types").status_code == 200
        assert c.get("/api/assignable-users").status_code == 200
        # viewer 寫入 403
        assert c.post("/api/appointments", json=_appt_body()).status_code == 403
        assert c.put("/api/appointments/1", json=_appt_body()).status_code == 403
        assert c.delete("/api/appointments/1").status_code == 403
    finally:
        c.close()


def test_assignable_users(client):
    _create_user(client, "user1", "user")
    _create_user(client, "viewer1", "viewer")
    r = client.get("/api/assignable-users")
    names = [u["username"] for u in r.json()]
    assert "admin" in names and "user1" in names
    assert "viewer1" not in names  # viewer 不可被指派


def test_list_appointments_by_month(client):
    client.post("/api/appointments", json=_appt_body())
    client.post("/api/appointments", json=_appt_body(date="2026-08-13"))
    r = client.get("/api/appointments?year=2026&month=8")
    assert r.status_code == 200 and len(r.json()) == 2
    # 跨月不混入
    client.post("/api/appointments", json=_appt_body(date="2026-07-01"))
    assert len(client.get("/api/appointments?year=2026&month=8").json()) == 2
    # 非法參數
    assert client.get("/api/appointments?year=2026").status_code == 400
    assert client.get("/api/appointments?year=2026&month=13").status_code == 400


# ---------- 匯出工程日報表 ----------


def test_export_daily_report(client):
    """匯出 xlsx：openpyxl 讀回驗證內容與格式（§10 範本填值法）"""
    import openpyxl
    client.post("/api/appointments", json=_appt_body())
    r = client.get("/api/appointments/export?date=2026-08-12")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    assert "0812.xlsx" in r.headers["content-disposition"]  # filename 為 URL 編碼

    ws = openpyxl.load_workbook(io.BytesIO(r.content)).active
    assert ws.title == "0812"                      # sheet 名 = mmdd
    assert ws["A1"].value == "振佳空調  工程日誌"
    assert ws["A2"].value == "工程師："              # 不帶名稱（2026-08-12 家豪指定）
    assert "星期三" in ws["D2"].value               # 日期含星期
    assert ws["A4"].value == 1                     # 項次
    assert ws["B4"].value == "09:00~11:00"          # 時間
    assert ws["C4"].value == "陳先生 (B棟 3F)"
    assert ws["G4"].value == "✓"                    # 維修 ✓ 在 G 欄（右側空格）
    assert ws["F4"].value == "維修"                 # 欄位名保留
    assert ws["B5"].value == "地址：新北市板橋區中山路一段 100 號"  # 地址 + 前綴
    assert ws["B6"].value == "閃紅燈維護"            # 備註無前綴
    assert ws["B12"].value is None                 # 未使用區塊備註清空
    assert ws["B18"].value is None
    assert ws.column_dimensions["B"].width == 20   # B 欄寬固定 20
    assert len(ws.merged_cells.ranges) >= 42       # 範本合併格保留


def test_export_empty_day_and_bad_date(client):
    # 無行程：A2 工程師留空（無後綴）
    import openpyxl
    r = client.get("/api/appointments/export?date=2026-08-01")
    assert r.status_code == 200
    ws = openpyxl.load_workbook(io.BytesIO(r.content)).active
    assert ws["A2"].value == "工程師："
    # 壞日期 400
    assert client.get("/api/appointments/export?date=2026-13-99").status_code == 400
