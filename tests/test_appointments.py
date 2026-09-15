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
    # A②（2026-08-14）：session 注入取代 POST login（省 PBKDF2 600k 迭代）
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
    rows = r.json()
    # 2026-08-13 Sarah：工程項目 安裝/配管 → 施工/場勘（停用的歷史項目仍在清單）
    names = [s["name"] for s in rows]
    assert names == ["保養", "維修", "安裝", "施工", "配管", "場勘"]
    assert [s["id"] for s in rows] == [1, 2, 3, 5, 4, 6]
    # active 4 項 = 保養/維修/施工/場勘（前端下拉只顯示 active）
    active = [s["name"] for s in rows if s["is_active"] == 1]
    assert active == ["保養", "維修", "施工", "場勘"]


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
    assert [s["id"] for s in row if s["is_active"] == 1] == [1, 2, 5, 6]


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


def test_appointment_time_optional(client):
    """2026-08-14 Sarah：派工時間選填——兩欄皆空可建立、空時間不觸發衝突、只填一欄 400"""
    # 兩欄皆空 → 200（存空字串）
    r = client.post("/api/appointments", json=_appt_body(start_time="", end_time=""))
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["start_time"] == ""
    assert d["end_time"] == ""
    # 同人同天兩筆空時間派工 → 不衝突（未指定時間無法判斷同時段）
    r = client.post("/api/appointments", json=_appt_body(
        client_name="張小姐 (A棟 12F)", start_time="", end_time=""))
    assert r.status_code == 200, r.text
    # 只填開始不填結束 → 400（時間要嘛完整填寫要嘛留空）
    r = client.post("/api/appointments", json=_appt_body(start_time="09:00", end_time=""))
    assert r.status_code == 400
    assert "派工時間請完整填寫" in r.json()["detail"]
    # 編輯成空時間 → 200
    r = client.put(f"/api/appointments/{d['id']}", json=_appt_body(start_time="", end_time=""))
    assert r.status_code == 200, r.text


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


def test_appointment_concurrent_double_booking_rejected(client):
    """2026-08-14 併發修復：同人同時段併發新增 → 只有一個成功（BEGIN IMMEDIATE 防雙重派工 TO-1）"""
    import threading
    from app.services.auth import SESSION_COOKIE

    token = client.cookies.get(SESSION_COOKIE)
    barrier = threading.Barrier(2)
    results = {}

    def worker(n):
        c = TestClient(app_main.app)
        c.cookies.set(SESSION_COOKIE, token)
        barrier.wait()  # 兩 thread 同時送出
        r = c.post("/api/appointments", json=_appt_body(client_name=f"併發測試{n}"))
        results[n] = r.status_code
        c.close()

    t1 = threading.Thread(target=worker, args=(1,))
    t2 = threading.Thread(target=worker, args=(2,))
    t1.start()
    t2.start()
    t1.join()
    t2.join()

    codes = sorted(results.values())
    assert codes == [200, 409], f"併發雙重派工未被擋住: {results}"
    # 資料庫只有一筆該時段行程（_appt_body 預設 date=2026-08-12、09:00-11:00）
    appts = client.get("/api/appointments?date=2026-08-12").json()
    same_slot = [a for a in appts if a["start_time"] == "09:00" and a["end_time"] == "11:00"
                 and a["client_name"].startswith("併發測試")]
    assert len(same_slot) == 1, f"預期 1 筆併發行程，實際 {len(same_slot)}"


def test_update_appointment_optimistic_lock_409(client):
    """2026-08-14 Phase 2：PUT 派工帶過期 updated_at 快照 → 409（_appt_row 有回傳 updated_at）"""
    r = client.post("/api/appointments", json=_appt_body())
    assert r.status_code == 200
    appt = r.json()
    assert "updated_at" in appt, "API 必須回傳 updated_at（前端樂觀鎖快照用）"
    # 他人先改過
    client.put(f"/api/appointments/{appt['id']}", json=_appt_body(client_name="他人改的"))
    # 用舊快照儲存 → 409
    r = client.put(f"/api/appointments/{appt['id']}",
                   json=_appt_body(client_name="我的修改", updated_at="1999-01-01 00:00:00"))
    assert r.status_code == 409
    assert "已被他人修改" in r.json()["detail"]
    # 沒被覆蓋
    appts = client.get("/api/appointments?date=2026-08-12").json()
    target = [a for a in appts if a["id"] == appt["id"]][0]
    assert target["client_name"] == "他人改的"


def test_edit_keeps_creator(client):
    """編輯行程不改變新增者（created_by 保留原值）＋記錄最後編輯者（2026-08-13 Sarah：編輯非新增者要顯示）"""
    r = client.post("/api/appointments", json=_appt_body())
    appt_id = r.json()["id"]
    assert r.json()["created_by_name"] == "管理員"
    assert r.json()["updated_by_name"] is None  # 剛新增無編輯者
    r = client.put(f"/api/appointments/{appt_id}", json=_appt_body(
        client_name="改名客戶", start_time="14:00", end_time="16:00"))
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["client_name"] == "改名客戶"
    assert d["created_by"] == 1
    assert d["created_by_name"] == "管理員"
    assert d["updated_by"] == 1  # 同為 admin 編輯
    assert d["updated_by_name"] == "管理員"


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
    """service_type_id 可省略（API 相容；2026-08-17 Sarah 定案：服務項目改非必填，前端一併放行）"""
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
    assert client.get("/api/appointments?date=2026-08-12").json() == []


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
    assert ws["A2"].value == "工程師：藍政達 蘇昱豪"  # 固定兩位工程師（2026-08-13 Sarah 指定）
    assert "星期三" in ws["D2"].value               # 日期含星期
    assert ws["A4"].value == 1                     # 項次
    assert ws["B4"].value == "09:00"            # 時間（2026-08-13 Sarah：只寫開始時間，不再 09:00~11:00）
    assert ws["C4"].value == "陳先生 (B棟 3F)"
    assert ws["G4"].value == "✓"                    # 維修 ✓ 在 G 欄（右側空格）
    assert ws["F4"].value == "維修"                 # 欄位名保留
    # 2026-08-13 Sarah：工程項目 安裝/配管 → 施工/場勘（欄位名 D/F/H/J，5 個區塊全改——第一輪只改 row4 被抓包）
    for r in (4, 11, 18, 25, 32):
        assert ws[f"D{r}"].value == "保養", f"row{r} D 欄應為 保養"
        assert ws[f"F{r}"].value == "維修", f"row{r} F 欄應為 維修"
        assert ws[f"H{r}"].value == "施工", f"row{r} H 欄應為 施工"
        assert ws[f"J{r}"].value == "場勘", f"row{r} J 欄應為 場勘"
    assert ws["B5"].value == "地址：新北市板橋區中山路一段 100 號"  # 地址 + 前綴
    assert ws["B6"].value == "閃紅燈維護"            # 備註無前綴
    assert ws["B12"].value is None                 # 未使用區塊備註清空
    assert ws["B18"].value is None
    assert ws.column_dimensions["B"].width == 20   # B 欄寬固定 20
    assert len(ws.merged_cells.ranges) >= 42       # 範本合併格保留


def test_export_daily_report_construction_site_check_cols(client):
    """2026-08-13 Sarah：施工(id5)→I 欄 ✓、場勘(id6)→K 欄 ✓（SVC_CHECK_COL 新對應）"""
    import openpyxl
    client.post("/api/appointments", json=_appt_body(service_type_id=5, date="2026-08-13", start_time="09:00", end_time="10:00", client_name="施工客戶"))
    client.post("/api/appointments", json=_appt_body(service_type_id=6, date="2026-08-13", start_time="11:00", end_time="12:00", client_name="場勘客戶"))
    r = client.get("/api/appointments/export?date=2026-08-13")
    assert r.status_code == 200
    ws = openpyxl.load_workbook(io.BytesIO(r.content)).active
    # 兩筆派工依序填 BLOCKS[0]（第4列）/ BLOCKS[1]（第11列）
    assert ws["I4"].value == "✓"    # 施工(第1筆) → I4
    assert ws["K11"].value == "✓"   # 場勘(第2筆) → K11
    assert ws["G4"].value is None   # 第1列維修欄沒被誤勾
    assert ws["G11"].value is None  # 第2列維修欄沒被誤勾


def test_export_empty_day_and_bad_date(client):
    # 無行程：A2 工程師留空（無後綴）
    import openpyxl
    r = client.get("/api/appointments/export?date=2026-08-01")
    assert r.status_code == 200
    ws = openpyxl.load_workbook(io.BytesIO(r.content)).active
    assert ws["A2"].value == "工程師：藍政達 蘇昱豪"  # 固定兩位工程師（2026-08-13 Sarah 指定，空日也填）
    # 壞日期 400
    assert client.get("/api/appointments/export?date=2026-13-99").status_code == 400


def test_export_daily_report_without_service_type(client):
    """2026-08-17 Sarah：服務項目改非必填——未指定服務項目的派工匯出日報表不壞
    （SVC_CHECK_COL.get(None) → 不勾✓、service_name 為 None → 不附註，客戶名/時間正常填）"""
    import openpyxl
    client.post("/api/appointments", json=_appt_body(service_type_id=None, client_name="無服務客戶"))
    r = client.get("/api/appointments/export?date=2026-08-12")
    assert r.status_code == 200
    ws = openpyxl.load_workbook(io.BytesIO(r.content)).active
    assert ws["C4"].value == "無服務客戶"          # 客戶名正常填
    assert ws["B4"].value == "09:00"              # 時間正常填
    for col in ("E", "G", "I", "K"):
        assert ws[f"{col}4"].value is None        # 所有 ✓ 欄都不勾（無服務項目）

def test_delete_appointment_clears_unsent_create_queue(client):
    """刪除尚未同步的行程時，C/U queue 必須清除，不得留下 orphan 任務。"""
    conn = app_db.get_db()
    try:
        conn.execute("INSERT INTO gcal_keys(name, credentials_path, calendar_id, is_active) "
                     "VALUES('delete-queue-key','fake.json','delete-queue@cal',1)")
        conn.execute("UPDATE users SET gcal_key='delete-queue-key' WHERE username='admin'")
        conn.commit()
    finally:
        conn.close()

    r = client.post("/api/appointments", json=_appt_body(client_name="未同步刪除"))
    assert r.status_code == 200, r.text
    appt_id = r.json()["id"]

    conn = app_db.get_db()
    try:
        assert conn.execute("SELECT 1 FROM appointment_sync_queue WHERE appointment_id=?",
                            (appt_id,)).fetchone() is not None
    finally:
        conn.close()

    r = client.delete(f"/api/appointments/{appt_id}")
    assert r.status_code == 200, r.text

    conn = app_db.get_db()
    try:
        assert conn.execute("SELECT 1 FROM appointment_sync_queue WHERE appointment_id=?",
                            (appt_id,)).fetchone() is None
    finally:
        conn.close()


# ===== 2026-08-28 B1：_sync_status 多 key 誤報修正 =====
class TestSyncStatus:
    """_sync_status 多 key 情境：map 有任一列 ≠ 一定 synced。

    修正前：map 有列就回 "synced"，會掩蓋其他 key 的失敗/等待。
    用獨立 tmp DB（不接 client fixture 的 POST，避免自動 sync_queue/map 干擾）。
    """

    @pytest.fixture(autouse=True)
    def _conn(self, tmp_path, monkeypatch):
        import app.database as app_db
        monkeypatch.setattr(app_db, "DB_PATH", str(tmp_path / "b1.db"))
        app_db.init_db()
        c = app_db.get_db()
        try:
            c.execute("INSERT INTO gcal_keys(name, credentials_path, calendar_id, is_active) "
                      "VALUES('k1','a.json','c1',1), ('k2','b.json','c2',1)")
            c.execute("INSERT INTO appointments(client_name, address, date, start_time, end_time) "
                      "VALUES('測試客戶','台北市','2026-08-28','09:00','11:00')")
            c.commit()
            _appt_id = c.execute("SELECT id FROM appointments").fetchone()["id"]
            yield c, _appt_id
        finally:
            c.close()

    def test_synced_when_map_all_success(self, _conn):
        """map 有列、queue 無失敗 → synced"""
        from app.routes import appointments as apt
        conn, appt_id = _conn
        conn.execute("INSERT INTO appointment_gcal_map(appointment_id,key_id,google_event_id,data_hash) "
                     "VALUES(?,1,'ev1','h1'),(?,2,'ev2','h2')", (appt_id, appt_id))
        conn.commit()
        assert apt._sync_status(conn, appt_id) == "synced"

    def test_partial_failed_when_map_plus_exhausted_queue_error(self, _conn):
        """map 有列 + queue 達上限 → partial_failed（不掩蓋永久失敗）"""
        from app.routes import appointments as apt
        conn, appt_id = _conn
        conn.execute("INSERT INTO appointment_gcal_map(appointment_id,key_id,google_event_id,data_hash) "
                     "VALUES(?,1,'ev1','h1')", (appt_id,))
        conn.execute("INSERT INTO appointment_sync_queue"
                     "(appointment_id,key_id,op_type,google_event_id,last_modified_at,attempts,last_error) "
                     "VALUES(?,2,'U','',datetime('now'),5,'Google 404')", (appt_id,))
        conn.commit()
        assert apt._sync_status(conn, appt_id) == "partial_failed"

    def test_partial_retrying_when_map_plus_retrying_queue(self, _conn):
        """map 有列 + queue attempts 1~4 且有錯誤 → partial_retrying。"""
        from app.routes import appointments as apt
        conn, appt_id = _conn
        conn.execute("INSERT INTO appointment_gcal_map(appointment_id,key_id,google_event_id,data_hash) "
                     "VALUES(?,1,'ev1','h1')", (appt_id,))
        conn.execute("INSERT INTO appointment_sync_queue"
                     "(appointment_id,key_id,op_type,google_event_id,last_modified_at,attempts,last_error) "
                     "VALUES(?,2,'U','',datetime('now'),3,'Google 404')", (appt_id,))
        conn.commit()
        assert apt._sync_status(conn, appt_id) == "partial_retrying"

    def test_pending_when_map_plus_queue_waiting(self, _conn):
        """map 有列 + queue 等待中（無 error）→ pending（未全部完成）"""
        from app.routes import appointments as apt
        conn, appt_id = _conn
        conn.execute("INSERT INTO appointment_gcal_map(appointment_id,key_id,google_event_id,data_hash) "
                     "VALUES(?,1,'ev1','h1')", (appt_id,))
        conn.execute("INSERT INTO appointment_sync_queue"
                     "(appointment_id,key_id,op_type,google_event_id,last_modified_at,attempts,last_error) "
                     "VALUES(?,2,'U','',datetime('now'),0,'')", (appt_id,))
        conn.commit()
        assert apt._sync_status(conn, appt_id) == "pending"

    def test_failed_no_map(self, _conn):
        """無 map + queue 失敗 → failed"""
        from app.routes import appointments as apt
        conn, appt_id = _conn
        conn.execute("INSERT INTO appointment_sync_queue"
                     "(appointment_id,key_id,op_type,google_event_id,last_modified_at,attempts,last_error) "
                     "VALUES(?,1,'C','',datetime('now'),5,'network error')", (appt_id,))
        conn.commit()
        assert apt._sync_status(conn, appt_id) == "failed"

    def test_none_no_map_no_queue(self, _conn):
        """無 map 無 queue → none"""
        from app.routes import appointments as apt
        conn, appt_id = _conn
        assert apt._sync_status(conn, appt_id) == "none"


class TestB2OrphanBoundKeys:
    """B2：orphan 判斷只看「已綁定 key」，不看 fallback 到全部 key 的情境。

    修正前：fallback 觸發時 new_target_ids = 所有 key → 沒 orphan → 舊事件不刪。
    修正後：orphan 判斷只看有使用者綁定的 key 集合。
    """

    @pytest.fixture(autouse=True)
    def _setup(self, tmp_path, monkeypatch):
        import app.database as app_db
        monkeypatch.setattr(app_db, "DB_PATH", str(tmp_path / "b2.db"))
        app_db.init_db()
        conn = app_db.get_db()
        try:
            # 建 2 個 key
            conn.execute("INSERT INTO gcal_keys(name, credentials_path, calendar_id, is_active) "
                         "VALUES('keyOld','old.json','old@cal',1),('keyNew','new.json','new@cal',1)")
            # 建 2 個使用者：admin 綁 keyOld，user2 綁 keyNew
            conn.execute("UPDATE users SET gcal_key='keyOld' WHERE username='admin'")
            conn.execute("INSERT INTO users(username, password_hash, display_name, role, gcal_key) "
                         "VALUES('u2','pw','User2','editor','keyNew')")
            conn.commit()
            self.conn = conn
            self.key_old_id = conn.execute("SELECT id FROM gcal_keys WHERE name='keyOld'").fetchone()["id"]
            self.key_new_id = conn.execute("SELECT id FROM gcal_keys WHERE name='keyNew'").fetchone()["id"]
            self.uid2 = conn.execute("SELECT id FROM users WHERE username='u2'").fetchone()["id"]
            yield
        finally:
            conn.close()

    def test_orphan_delete_when_reassign_to_different_key(self):
        """換人指派（keyOld→keyNew）→ keyOld 應 orphan 刪除"""

        conn = self.conn
        # 建行程（指派 admin = keyOld）
        conn.execute("INSERT INTO appointments(client_name, date, start_time, end_time) "
                     "VALUES('B2測試','2026-08-28','09:00','11:00')")
        appt_id = conn.execute("SELECT id FROM appointments").fetchone()["id"]
        conn.execute("INSERT INTO appointment_assignees(appointment_id, user_id) VALUES(?,1)", (appt_id,))
        # 模擬已同步到 keyOld
        conn.execute("INSERT INTO appointment_gcal_map(appointment_id, key_id, google_event_id, data_hash) "
                     "VALUES(?,?,'old-event','hash')", (appt_id, self.key_old_id))
        conn.commit()

        # 清 queue
        conn.execute("DELETE FROM appointment_sync_queue")
        conn.commit()

        # 模擬 update：改指派 admin→user2（keyOld→keyNew）
        conn.execute("DELETE FROM appointment_assignees WHERE appointment_id=?", (appt_id,))
        conn.execute("INSERT INTO appointment_assignees(appointment_id, user_id) VALUES(?,?)",
                     (appt_id, self.uid2))
        conn.commit()

        # B2：用「已綁定 key」算 orphan（直接模擬 update_appointment 的邏輯）
        bound_rows = conn.execute(
            "SELECT DISTINCT u.gcal_key FROM appointment_assignees aa "
            "JOIN users u ON u.id=aa.user_id "
            "WHERE aa.appointment_id=? AND u.gcal_key<>''", (appt_id,)).fetchall()
        bound_key_names = [r["gcal_key"] for r in bound_rows]
        placeholders = ",".join("?" * len(bound_key_names))
        bound_key_ids = set(r["id"] for r in conn.execute(
            f"SELECT id FROM gcal_keys WHERE is_active=1 AND name IN ({placeholders})",
            bound_key_names).fetchall())

        map_rows = conn.execute(
            "SELECT key_id, google_event_id FROM appointment_gcal_map WHERE appointment_id=?",
            (appt_id,)).fetchall()
        orphan = [(r["key_id"], r["google_event_id"]) for r in map_rows
                  if r["key_id"] not in bound_key_ids]

        # keyOld 不在 bound_key_ids（新指派只有 user2=keyNew）→ 應 orphan
        assert self.key_old_id not in bound_key_ids
        assert len(orphan) == 1
        assert orphan[0][0] == self.key_old_id

    def test_no_orphan_when_all_unbound_uses_fallback(self, client, monkeypatch):
        """B2 防回歸：全沒綁 key（fallback）→ 不刪 orphan（guard 命中）"""
        from app.database import get_db

        # 建 key + 使用者（admin 不綁 key）
        conn = get_db()
        try:
            conn.execute("INSERT INTO gcal_keys(name, credentials_path, calendar_id, is_active) "
                         "VALUES('keyOld','old.json','old@cal',1)")
            conn.execute("UPDATE users SET gcal_key='' WHERE username='admin'")
            conn.commit()
            key_id = conn.execute("SELECT id FROM gcal_keys WHERE name='keyOld'").fetchone()["id"]
        finally:
            conn.close()

        # 建行程 + map（模擬已同步）
        r = client.post("/api/appointments", json={
            "client_name": "B2_fb", "date": "2026-08-28",
            "start_time": "09:00", "end_time": "11:00",
            "user_ids": [1], "note": ""
        })
        appt_id = r.json()["id"]
        conn = get_db()
        try:
            conn.execute("INSERT INTO appointment_gcal_map(appointment_id, key_id, google_event_id, data_hash) "
                         "VALUES(?,?,'fb-event','hash')", (appt_id, key_id))
            conn.execute("DELETE FROM appointment_sync_queue")
            conn.commit()
        finally:
            conn.close()

        # 編輯行程（admin 仍沒綁 key → fallback）
        client.put(f"/api/appointments/{appt_id}", json={
            "client_name": "B2_fb", "date": "2026-08-28",
            "start_time": "09:00", "end_time": "11:00",
            "user_ids": [1], "note": "edited"
        })

        # B2：fallback 時不刪 orphan → queue 中不應有 D op
        conn = get_db()
        try:
            d_ops = conn.execute(
                "SELECT COUNT(*) FROM appointment_sync_queue "
                "WHERE appointment_id=? AND op_type='D'", (appt_id,)).fetchone()[0]
        finally:
            conn.close()
        assert d_ops == 0, f"B2：fallback 時不應有 D orphan，但有 {d_ops} 列"

# ========== 行事曆搜尋 API ==========
def test_search_appointments_by_keyword(client):
    """搜尋行程：關鍵字匹配 client_name"""
    client.post("/api/appointments", json=_appt_body(client_name="振佳空調"))
    client.post("/api/appointments", json=_appt_body(client_name="其他公司"))
    r = client.get("/api/appointments/search?q=振佳")
    assert r.status_code == 200
    data = r.json()
    assert len(data) >= 1
    assert any("振佳" in a["client_name"] for a in data)

def test_search_appointments_by_date_range(client):
    """搜尋行程：日期範圍過濾"""
    client.post("/api/appointments", json=_appt_body(client_name="A", date="2026-09-01"))
    client.post("/api/appointments", json=_appt_body(client_name="B", date="2026-09-15"))
    client.post("/api/appointments", json=_appt_body(client_name="C", date="2026-10-01"))
    r = client.get("/api/appointments/search?date_from=2026-09-01&date_to=2026-09-30")
    assert r.status_code == 200
    data = r.json()
    dates = [a["date"] for a in data]
    assert "2026-09-01" in dates
    assert "2026-09-15" in dates
    assert "2026-10-01" not in dates

def test_search_appointments_combined(client):
    """搜尋行程：日期範圍 + 關鍵字組合"""
    client.post("/api/appointments", json=_appt_body(client_name="振佳", date="2026-09-01"))
    client.post("/api/appointments", json=_appt_body(client_name="振佳", date="2026-10-01"))
    client.post("/api/appointments", json=_appt_body(client_name="其他", date="2026-09-01"))
    r = client.get("/api/appointments/search?q=振佳&date_from=2026-09-01&date_to=2026-09-30")
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 1
    assert data[0]["client_name"] == "振佳"
    assert data[0]["date"] == "2026-09-01"

def test_search_appointments_empty(client):
    """搜尋行程：無結果回傳空陣列"""
    r = client.get("/api/appointments/search?q=不存在的客戶")
    assert r.status_code == 200
    assert r.json() == []

def test_search_appointments_no_params(client):
    """搜尋行程：無參數回傳全部"""
    client.post("/api/appointments", json=_appt_body(client_name="X"))
    r = client.get("/api/appointments/search")
    assert r.status_code == 200
    assert len(r.json()) >= 1


# ===== 2026-09-15：sync_error + key 資訊回傳 =====
class TestSyncStatusesErrorInfo:
    """_sync_statuses 回傳 error key_name / cal_id，讓前端顯示「哪個 Key 出錯」。"""

    @pytest.fixture(autouse=True)
    def _conn(self, tmp_path, monkeypatch):
        import app.database as app_db
        monkeypatch.setattr(app_db, "DB_PATH", str(tmp_path / "sync_err.db"))
        app_db.init_db()
        c = app_db.get_db()
        try:
            c.execute("INSERT INTO gcal_keys(name, credentials_path, calendar_id, is_active) "
                      "VALUES('公司帳號','a.json','sarah@test.com',1)")
            c.execute("INSERT INTO appointments(client_name, address, date, start_time, end_time) "
                      "VALUES('測試客戶','地址','2026-09-15','09:00','11:00')")
            c.commit()
            _appt_id = c.execute("SELECT id FROM appointments").fetchone()["id"]
            yield c, _appt_id
        finally:
            c.close()

    def test_sync_statuses_returns_key_info(self, _conn):
        """_sync_statuses 回傳 key_name 和 cal_id"""
        from app.routes import appointments as apt
        conn, appt_id = _conn
        conn.execute("INSERT INTO appointment_sync_queue"
                     "(appointment_id,key_id,op_type,google_event_id,last_modified_at,attempts,last_error) "
                     "VALUES(?,1,'U','',datetime('now'),5,'invalid_grant')", (appt_id,))
        conn.commit()
        result = apt._sync_statuses(conn, [appt_id])
        info = result[appt_id]
        assert info["status"] == "failed"
        assert info["error"] == "invalid_grant"
        assert info["key_name"] == "公司帳號"
        assert info["cal_id"] == "sarah@test.com"

    def test_sync_statuses_no_error_no_key(self, _conn):
        """synced 的行程不回傳 key 資訊"""
        from app.routes import appointments as apt
        conn, appt_id = _conn
        conn.execute("INSERT INTO appointment_gcal_map(appointment_id,key_id,google_event_id,data_hash) "
                     "VALUES(?,1,'ev1','h1')", (appt_id,))
        conn.commit()
        result = apt._sync_statuses(conn, [appt_id])
        info = result[appt_id]
        assert info["status"] == "synced"
        assert info["error"] is None
        assert info["key_name"] == ""
        assert info["cal_id"] == ""


    def test_sync_statuses_redacts_credential_path(self, _conn):
        """appointment API 不得把歷史 queue 的 credential path 直接回傳。"""
        from app.routes import appointments as apt

        conn, appt_id = _conn
        conn.execute(
            "INSERT INTO appointment_sync_queue"
            "(appointment_id,key_id,op_type,google_event_id,last_modified_at,attempts,last_error) "
            "VALUES(?,1,'U','',datetime('now'),5,?)",
            (appt_id, "FileNotFoundError: No such file or directory: C:/private/service-account.json"),
        )
        conn.commit()

        result = apt._sync_statuses(conn, [appt_id])

        assert result[appt_id]["error"] == "Credential file unavailable"
        assert "service-account.json" not in result[appt_id]["error"]


class TestAppointmentApiSyncFields:
    """API 回傳 sync_error / sync_error_key / sync_error_cal 欄位。"""

    def test_api_includes_sync_error_fields(self, client):
        """list_appointments 回傳 sync_error 相關欄位"""
        r = client.post("/api/appointments", json=_appt_body(
            client_name="SyncTest", date="2026-09-15", start_time="10:00", end_time="11:00"))
        assert r.status_code == 200
        appt_id = r.json()["id"]

        # 沒有 sync 錯誤時，欄位存在但為空
        r2 = client.get("/api/appointments?year=2026&month=9")
        assert r2.status_code == 200
        data = r2.json()
        target = next((a for a in data if a["id"] == appt_id), None)
        assert target is not None
        assert "sync_error" in target
        assert "sync_error_key" in target
        assert "sync_error_cal" in target
        assert target["sync_error"] == ""


# ===== 2026-09-15：gcal_keys PUT 金鑰更新重設 queue =====
class TestGcalKeyUpdateResetsQueue:
    """更新 gcal_key 的 credentials_path 時，自動重設 sync_queue。"""

    @pytest.fixture(autouse=True)
    def _setup(self, tmp_path, monkeypatch):
        import app.database as app_db
        monkeypatch.setattr(app_db, "DB_PATH", str(tmp_path / "key_reset.db"))
        from app.routes import gcal_keys as gcal_keys_route
        monkeypatch.setattr(gcal_keys_route, "_wake_scheduler", lambda: None)
        app_db.init_db()
        # 寫一個假的 JSON 檔
        secrets_dir = tmp_path / "secrets" / "gcal"
        secrets_dir.mkdir(parents=True)
        fake_json = secrets_dir / "old_key.json"
        fake_json.write_text('{"client_email":"old@test.com","project_id":"p","type":"service_account","private_key":"k"}')
        fake_json2 = secrets_dir / "new_key.json"
        fake_json2.write_text('{"client_email":"new@test.com","project_id":"p","type":"service_account","private_key":"k"}')

        c = app_db.get_db()
        try:
            c.execute("INSERT INTO gcal_keys(name, credentials_path, calendar_id, is_active) "
                      "VALUES('test_key',?,'cal@test.com',1)", (str(fake_json),))
            key_id = c.execute("SELECT id FROM gcal_keys WHERE name='test_key'").fetchone()["id"]
            c.execute("INSERT INTO appointments(client_name, address, date, start_time, end_time) "
                      "VALUES('客戶','地址','2026-09-15','09:00','11:00')")
            appt_id = c.execute("SELECT id FROM appointments").fetchone()["id"]
            # 建立一個 exhausted queue entry
            c.execute("INSERT INTO appointment_sync_queue"
                      "(appointment_id,key_id,op_type,google_event_id,last_modified_at,attempts,last_error) "
                      "VALUES(?,?,'U','',datetime('now'),5,'old error')", (appt_id, key_id))
            c.commit()
        finally:
            c.close()
        # 建立用同一個 DB 的 test client + 登入（session injection）
        from fastapi.testclient import TestClient
        from main import app as fastapi_app
        from app.services.auth import SESSION_COOKIE, create_session, init_admin_if_missing
        self._key_id = key_id
        self._appt_id = appt_id
        self._new_json = str(fake_json2)
        tc = TestClient(fastapi_app)
        # 直接注入 admin session
        _conn2 = app_db.get_db()
        try:
            init_admin_if_missing(_conn2)
            _admin_id = _conn2.execute("SELECT id FROM users WHERE username='admin'").fetchone()["id"]
            _token = create_session(_conn2, _admin_id)
        finally:
            _conn2.close()
        tc.cookies.set(SESSION_COOKIE, _token)
        self._client = tc
        yield

    def test_update_credentials_resets_queue(self, _setup):
        """PUT gcal-key 更新 credentials_path 後，queue attempts 歸零"""
        r = self._client.put(f"/api/gcal-keys/{self._key_id}", json={
            "credentials_path": self._new_json,
        })
        assert r.status_code == 200

        # 驗證 queue 已重設
        import app.database as app_db
        c = app_db.get_db()
        try:
            row = c.execute(
                "SELECT attempts, last_error FROM appointment_sync_queue "
                "WHERE appointment_id=? AND key_id=?",
                (self._appt_id, self._key_id),
            ).fetchone()
            assert row is not None
            assert row["attempts"] == 0
            assert row["last_error"] == ""
        finally:
            c.close()

    def test_update_name_only_does_not_reset_queue(self, _setup):
        """PUT gcal-key 只改名稱（不改 credentials_path），queue 不變"""
        r = self._client.put(f"/api/gcal-keys/{self._key_id}", json={
            "name": "renamed_key",
        })
        assert r.status_code == 200

        import app.database as app_db
        c = app_db.get_db()
        try:
            row = c.execute(
                "SELECT attempts, last_error FROM appointment_sync_queue "
                "WHERE appointment_id=? AND key_id=?",
                (self._appt_id, self._key_id),
            ).fetchone()
            assert row is not None
            assert row["attempts"] == 5  # 未重設
            assert row["last_error"] == "old error"
        finally:
            c.close()

def test_appointment_api_reports_retrying_status(client):
    """attempts 1~4 + error 應是 retrying，不是永久 failed。"""
    from app.database import get_db

    appt_id = client.post("/api/appointments", json={
        "client_name": "retrying-status", "date": "2026-08-28",
        "start_time": "09:00", "end_time": "10:00", "user_ids": [1],
    }).json()["id"]
    conn = get_db()
    try:
        key_id = conn.execute("INSERT INTO gcal_keys(name,credentials_path,calendar_id) VALUES('status-key','x.json','s@cal')").lastrowid
        conn.execute("INSERT INTO appointment_sync_queue(appointment_id,key_id,op_type,last_modified_at,attempts,last_error) VALUES(?,?, 'U',datetime('now'),2,'timeout')",
                     (appt_id, key_id))
        conn.commit()
    finally:
        conn.close()
    item = client.get("/api/appointments?date=2026-08-28").json()[0]
    assert item["sync_status"] == "retrying"


def test_appointment_api_reports_exhausted_as_failed(client):
    """attempts >= MAX_ATTEMPTS 應是 failed/exhausted，不是 retrying。"""
    from app.database import get_db

    appt_id = client.post("/api/appointments", json={
        "client_name": "exhausted-status", "date": "2026-08-28",
        "start_time": "11:00", "end_time": "12:00", "user_ids": [1],
    }).json()["id"]
    conn = get_db()
    try:
        key_id = conn.execute("INSERT INTO gcal_keys(name,credentials_path,calendar_id) VALUES('exhausted-key','x.json','e@cal')").lastrowid
        conn.execute("INSERT INTO appointment_sync_queue(appointment_id,key_id,op_type,last_modified_at,attempts,last_error) VALUES(?,?, 'U',datetime('now'),5,?)", (appt_id, key_id, "403"))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()



    item = next(x for x in client.get("/api/appointments?date=2026-08-28").json() if x["id"] == appt_id)
    assert item["sync_status"] == "failed"
    assert item["sync_error_attempts"] == 5


def test_partial_retrying_status_is_distinct(client):
    """已有一個 map、另一個 key retrying 時回傳 partial_retrying。"""
    from app.database import get_db

    appt_id = client.post("/api/appointments", json={
        "client_name": "partial-retrying", "date": "2026-08-28",
        "start_time": "13:00", "end_time": "14:00", "user_ids": [1],
    }).json()["id"]
    conn = get_db()
    try:
        key_a = conn.execute("INSERT INTO gcal_keys(name,credentials_path,calendar_id) VALUES('partial-A','a.json','pa@cal')").lastrowid
        key_b = conn.execute("INSERT INTO gcal_keys(name,credentials_path,calendar_id) VALUES('partial-B','b.json','pb@cal')").lastrowid
        conn.execute("INSERT INTO appointment_gcal_map(appointment_id,key_id,google_event_id,data_hash) VALUES(?,?,?,?)",
                     (appt_id, key_a, "event-a", "hash-a"))
        conn.execute("INSERT INTO appointment_sync_queue(appointment_id,key_id,op_type,last_modified_at,attempts,last_error) VALUES(?,?, 'U',datetime('now'),1,'timeout')",
                     (appt_id, key_b))
        conn.commit()
    finally:
        conn.close()
    item = client.get("/api/appointments?date=2026-08-28").json()[0]
    assert item["sync_status"] == "partial_retrying"

# ===== GCal delete queue must survive inactive keys =====
def test_delete_with_only_inactive_mapped_key_enqueues_delete(client):
    """Regression: D must retain the remote event id even when every key is inactive."""
    from app.database import get_db

    key_id = client.post("/api/gcal-keys", json={
        "name": "inactive-delete-key", "credentials_path": "inactive.json", "calendar_id": "inactive@cal",
    }).json()["id"]
    assert client.put(f"/api/gcal-keys/{key_id}", json={"is_active": False}).status_code == 200
    appointment = client.post("/api/appointments", json={
        "client_name": "停用 Key 刪除測試", "date": "2026-08-28",
        "start_time": "09:00", "end_time": "10:00", "user_ids": [],
    }).json()
    appt_id = appointment["id"]
    conn = get_db()
    try:
        conn.execute(
            "INSERT INTO appointment_gcal_map(appointment_id,key_id,google_event_id,data_hash) "
            "VALUES(?,?,?,?)", (appt_id, key_id, "inactive-remote-event", "hash"),
        )
        conn.commit()
    finally:
        conn.close()

    assert client.delete(f"/api/appointments/{appt_id}").status_code == 200
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT op_type, google_event_id FROM appointment_sync_queue "
            "WHERE appointment_id=? AND key_id=?", (appt_id, key_id),
        ).fetchone()
        assert row["op_type"] == "D"
        assert row["google_event_id"] == "inactive-remote-event"
    finally:
        conn.close()


def test_mark_sync_pending_wakes_scheduler_after_commit(client, monkeypatch):
    """Queue producer should wake the normal debounce worker after committing."""
    from app.database import get_db
    from app.routes.appointments import mark_sync_pending
    from app.services import sync_scheduler

    conn=get_db()
    try:
        conn.execute("INSERT INTO gcal_keys(name,credentials_path,calendar_id) VALUES('wake-key','x.json','wake@cal')")
        conn.execute("UPDATE users SET gcal_key='wake-key' WHERE id=1")
        appt_id=conn.execute(
            "INSERT INTO appointments(client_name,date,start_time,end_time) VALUES(?,?,?,?)",
            ("wake", "2026-08-28", "09:00", "10:00"),
        ).lastrowid
        conn.execute("INSERT INTO appointment_assignees(appointment_id,user_id) VALUES(?,1)", (appt_id,))
        conn.commit()
    finally:
        conn.close()

    calls=[]
    monkeypatch.setattr(sync_scheduler, "start", lambda: calls.append("start"))
    monkeypatch.setattr(sync_scheduler, "wake", lambda: calls.append("wake"))
    mark_sync_pending(appt_id, "C")
    assert calls == ["start", "wake"]



def test_stale_update_queue_cannot_resurrect_after_delete(client, monkeypatch):
    """delete 先提交後，延遲的 update queue write 不得把 D 改回 U。"""
    from app.database import get_db
    from app.routes import appointments as appointments_route

    key_id = client.post("/api/gcal-keys", json={
        "name": "stale-queue-key", "credentials_path": "stale.json", "calendar_id": "stale@cal",
    }).json()["id"]
    appt_id = client.post("/api/appointments", json={
        "client_name": "stale queue race", "date": "2026-08-28",
        "start_time": "09:00", "end_time": "10:00", "user_ids": [],
    }).json()["id"]
    conn = get_db()
    try:
        conn.execute(
            "INSERT INTO appointment_gcal_map(appointment_id,key_id,google_event_id,data_hash) VALUES(?,?,?,?)",
            (appt_id, key_id, "stale-remote-event", "hash"),
        )
        conn.commit()
    finally:
        conn.close()

    original = appointments_route.mark_sync_pending
    delayed = []

    def delay_update(appt, op, map_rows=()):
        if op == "U" and not delayed:
            delayed.append((appt, op, map_rows))
            return
        original(appt, op, map_rows)

    monkeypatch.setattr(appointments_route, "mark_sync_pending", delay_update)
    updated = client.put(f"/api/appointments/{appt_id}", json={
        "client_name": "stale queue race updated", "date": "2026-08-28",
        "start_time": "09:00", "end_time": "10:00", "user_ids": [],
    })
    assert updated.status_code == 200
    assert delayed

    deleted = client.delete(f"/api/appointments/{appt_id}")
    assert deleted.status_code == 200
    original(*delayed[0])

    conn = get_db()
    try:
        queue = conn.execute(
            "SELECT op_type, google_event_id FROM appointment_sync_queue "
            "WHERE appointment_id=? AND key_id=?", (appt_id, key_id)
        ).fetchone()
        assert (queue["op_type"], queue["google_event_id"]) == ("D", "stale-remote-event")
    finally:
        conn.close()
