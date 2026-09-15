# -*- coding: utf-8 -*-
"""
Google 行事曆同步 Key — 單元測試
================================
覆蓋：
- gcal_keys CRUD（GET/POST/PUT/DELETE）
- 權限：viewer 403 / admin 正常
- 防呆：重複名稱 400 / 空名稱 400 / 刪不存在 404
- 使用者綁 gcal_key（PUT /api/users/{id}）

執行：
    cd C:\\Users\\admin\\workspace\\hvac-inventory
    .venv\\Scripts\\python.exe -m pytest tests/test_gcal_keys.py -v
"""
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
    test_db = tmp_path / "test_gcal.db"
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


@pytest.fixture()
def viewer_client(tmp_path, monkeypatch):
    """獨立測試 DB + viewer 登入（權限測試用）"""
    test_db = tmp_path / "test_gcal_viewer.db"
    monkeypatch.setattr(app_db, "DB_PATH", str(test_db))
    app_db.init_db()
    from app.services.auth import SESSION_COOKIE, create_session, init_admin_if_missing
    _conn = app_db.get_db()
    try:
        init_admin_if_missing(_conn)
        # 建 viewer 帳號
        _conn.execute(
            "INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)",
            ("viewer1", "x", "Viewer", "viewer"),
        )
        _conn.commit()
        _vid = _conn.execute("SELECT id FROM users WHERE username='viewer1'").fetchone()["id"]
        _token = create_session(_conn, _vid)
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


# ---------- gcal_keys CRUD ----------


def test_list_keys_empty(client):
    """初始無 key"""
    r = client.get("/api/gcal-keys")
    assert r.status_code == 200
    assert r.json() == []


def test_create_key(client):
    """新增 key 成功"""
    r = client.post("/api/gcal-keys", json={
        "name": "廠商A",
        "credentials_path": "secrets/a.json",
        "calendar_id": "abc@group.calendar.google.com",
    })
    assert r.status_code == 201
    d = r.json()
    assert d["name"] == "廠商A"
    assert d["calendar_id"] == "abc@group.calendar.google.com"
    assert d["is_active"] is True
    assert "id" in d


def test_create_key_duplicate_name(client):
    """重複名稱 400"""
    client.post("/api/gcal-keys", json={
        "name": "廠商A", "credentials_path": "a.json", "calendar_id": "a@cal",
    })
    r = client.post("/api/gcal-keys", json={
        "name": "廠商A", "credentials_path": "b.json", "calendar_id": "b@cal",
    })
    assert r.status_code == 400
    assert "已存在" in r.json()["detail"]


def test_create_key_empty_name(client):
    """空名稱 400 或 422 (Pydantic validation)"""
    r = client.post("/api/gcal-keys", json={
        "name": "", "credentials_path": "a.json", "calendar_id": "a@cal",
    })
    assert r.status_code in (400, 422)


def test_list_keys_after_create(client):
    """新增後列表有 1 筆"""
    client.post("/api/gcal-keys", json={
        "name": "廠商B", "credentials_path": "b.json", "calendar_id": "b@cal",
    })
    r = client.get("/api/gcal-keys")
    assert r.status_code == 200
    assert len(r.json()) == 1
    assert r.json()[0]["name"] == "廠商B"


def test_update_key(client):
    """編輯 key"""
    cr = client.post("/api/gcal-keys", json={
        "name": "廠商C", "credentials_path": "c.json", "calendar_id": "c@cal",
    })
    kid = cr.json()["id"]
    r = client.put(f"/api/gcal-keys/{kid}", json={
        "name": "廠商C-改名",
        "calendar_id": "new@cal",
    })
    assert r.status_code == 200
    assert r.json()["name"] == "廠商C-改名"
    assert r.json()["calendar_id"] == "new@cal"


def test_update_uploaded_credentials_cleans_old_file(client):
    """編輯 Key 換路徑後，舊的系統上傳 JSON 應被清理。"""
    from app.routes import gcal_keys as gk

    cr = client.post("/api/gcal-keys", json={
        "name": "替換憑證", "credentials_path": "old.json", "calendar_id": "old@cal",
    })
    kid = cr.json()["id"]
    old_path = gk.UPLOADED_CREDENTIALS_DIR / ("a" * 32 + ".json")
    old_path.parent.mkdir(parents=True, exist_ok=True)
    old_path.write_text("{}", encoding="utf-8")
    conn = gk.get_db()
    try:
        conn.execute("UPDATE gcal_keys SET credentials_path=? WHERE id=?", (str(old_path), kid))
        conn.commit()
    finally:
        conn.close()

    response = client.put(f"/api/gcal-keys/{kid}", json={"credentials_path": "manual.json"})

    assert response.status_code == 200
    assert not old_path.exists()


def test_toggle_key_active(client):
    """切換 key 啟停"""
    cr = client.post("/api/gcal-keys", json={
        "name": "廠商D", "credentials_path": "d.json", "calendar_id": "d@cal",
    })
    kid = cr.json()["id"]
    r = client.put(f"/api/gcal-keys/{kid}", json={"is_active": False})
    assert r.status_code == 200
    assert r.json()["is_active"] is False
    # 再開
    r2 = client.put(f"/api/gcal-keys/{kid}", json={"is_active": True})
    assert r2.json()["is_active"] is True


def test_delete_key(client):
    """刪除 key"""
    cr = client.post("/api/gcal-keys", json={
        "name": "廠商E", "credentials_path": "e.json", "calendar_id": "e@cal",
    })
    kid = cr.json()["id"]
    r = client.delete(f"/api/gcal-keys/{kid}")
    assert r.status_code == 200
    assert r.json()["ok"] is True
    # 確認已刪
    r2 = client.get("/api/gcal-keys")
    assert len(r2.json()) == 0


def test_delete_key_not_found(client):
    """刪不存在的 key 404"""
    r = client.delete("/api/gcal-keys/99999")
    assert r.status_code == 404


def test_key_options(client):
    """下拉選單 API：只回傳啟用中的 key"""
    cr1 = client.post("/api/gcal-keys", json={
        "name": "停用Key", "credentials_path": "x.json", "calendar_id": "x@cal",
    })
    client.post("/api/gcal-keys", json={
        "name": "啟用Key", "credentials_path": "y.json", "calendar_id": "y@cal",
    })
    # 停用第一把（停用Key → is_active=False）
    client.put(f"/api/gcal-keys/{cr1.json()['id']}", json={"is_active": False})
    # options 只回傳啟用的
    r = client.get("/api/gcal-keys/options")
    assert r.status_code == 200
    names = [k["name"] for k in r.json()]
    assert "啟用Key" in names
    assert "停用Key" not in names


# ---------- 權限：viewer 403 ----------


def test_viewer_cannot_create_key(viewer_client):
    """viewer 不能新增 key"""
    r = viewer_client.post("/api/gcal-keys", json={
        "name": "X", "credentials_path": "x.json", "calendar_id": "x@cal",
    })
    assert r.status_code in (401, 403)



def test_viewer_cannot_read_keys(viewer_client):
    """viewer 讀 key 列表被 403（credentials_path 敏感）"""
    r = viewer_client.get("/api/gcal-keys")
    assert r.status_code == 403


# ---------- 使用者綁 gcal_key ----------


def test_bind_user_gcal_key(client):
    """綁定使用者 gcal_key（強制斷言 gcal_key 欄位存在且回傳正確）"""
    r = client.get("/api/users")
    admin_id = r.json()["users"][0]["id"]
    r2 = client.put(f"/api/users/{admin_id}", json={"gcal_key": "廠商A"})
    assert r2.status_code == 200
    data = r2.json()
    assert "gcal_key" in data, "PUT /api/users 回傳缺 gcal_key 欄位"
    assert data["gcal_key"] == "廠商A"


def test_unbind_user_gcal_key(client):
    """解除綁定"""
    r = client.get("/api/users")
    admin_id = r.json()["users"][0]["id"]
    client.put(f"/api/users/{admin_id}", json={"gcal_key": "廠商A"})
    r2 = client.put(f"/api/users/{admin_id}", json={"gcal_key": ""})
    assert r2.status_code == 200


def test_rename_key_does_not_break_user_binding(client):
    """B3 防回歸：key 改名後，使用者綁定同步更新為新 name。"""
    # 建 key
    cr = client.post("/api/gcal-keys", json={
        "name": "廠商X", "credentials_path": "x.json", "calendar_id": "x@cal",
    })
    kid = cr.json()["id"]
    # 綁定使用者
    r = client.get("/api/users")
    uid = r.json()["users"][0]["id"]
    client.put(f"/api/users/{uid}", json={"gcal_key": "廠商X"})
    # 改名
    client.put(f"/api/gcal-keys/{kid}", json={"name": "廠商Y"})
    # 使用者的 gcal_key 必須同步更新，避免綁定懸空
    r2 = client.get("/api/users")
    user = [u for u in r2.json()["users"] if u["id"] == uid][0]
    assert user["gcal_key"] == "廠商Y"  # rename 必須同步修正使用者綁定


# ========== 同步設定 API 測試（2026-08-27）==========

def test_get_gcal_sync_settings(client):
    """GET /api/gcal-sync-settings 回傳設定 dict"""
    r = client.get("/api/gcal-sync-settings")
    assert r.status_code == 200
    data = r.json()
    assert "gcal_default_duration_min" in data
    assert "gcal_use_location" in data
    assert "gcal_transparency" in data
    assert "gcal_sync_interval_min" in data


def test_update_gcal_sync_settings(client):
    """PUT /api/gcal-sync-settings 更新設定"""
    r = client.put("/api/gcal-sync-settings", json={
        "gcal_default_duration_min": "90",
        "gcal_transparency": "opaque",
    })
    assert r.status_code == 200
    assert r.json()["ok"] is True
    # 驗證更新
    r2 = client.get("/api/gcal-sync-settings")
    assert r2.json()["gcal_default_duration_min"] == "90"
    assert r2.json()["gcal_transparency"] == "opaque"


def test_update_gcal_sync_settings_validation(client):
    """PUT /api/gcal-sync-settings 值驗證"""
    # 非數字
    r = client.put("/api/gcal-sync-settings", json={"gcal_default_duration_min": "abc"})
    assert r.status_code == 400
    # 超出範圍
    r2 = client.put("/api/gcal-sync-settings", json={"gcal_sync_interval_min": "100"})
    assert r2.status_code == 400
    # 非法 transparency
    r3 = client.put("/api/gcal-sync-settings", json={"gcal_transparency": "invalid"})
    assert r3.status_code == 400


def test_update_gcal_sync_settings_viewer_forbidden(client):
    """viewer 無法更新同步設定"""
    # 建 viewer 帳號並登入
    client.post("/api/users", json={"username": "viewer1", "password": "Pass1234", "role": "viewer"})
    r = client.post("/api/auth/login", json={"username": "viewer1", "password": "Pass1234"})
    assert r.status_code == 200
    # viewer 嘗試更新設定
    r2 = client.put("/api/gcal-sync-settings", json={"gcal_default_duration_min": "30"})
    assert r2.status_code == 403


# ========== Per-Key 提醒 API 測試 ==========

def test_update_key_reminders(client):
    """PUT /api/gcal-keys/{id}/reminders 更新 per-key 提醒"""
    # 建 key
    cr = client.post("/api/gcal-keys", json={
        "name": "提醒測試", "credentials_path": "test.json", "calendar_id": "test@cal",
    })
    kid = cr.json()["id"]
    # 更新提醒
    reminders = [
        {"method": "popup", "minutes": 15},
        {"method": "popup", "minutes": 120},
        {"method": "popup", "minutes": 1440},
        {"method": "popup", "minutes": 10080},
        {"method": "popup", "minutes": 40320},
    ]
    r = client.put(f"/api/gcal-keys/{kid}/reminders", json={"reminders": reminders})
    assert r.status_code == 200
    assert r.json()["reminders"] == reminders
    # 驗證讀取
    r2 = client.get("/api/gcal-keys")
    key = [k for k in r2.json() if k["id"] == kid][0]
    assert key["reminders"] == reminders


def test_update_key_reminders_validation(client):
    """PUT /api/gcal-keys/{id}/reminders 值驗證"""
    cr = client.post("/api/gcal-keys", json={
        "name": "驗證測試", "credentials_path": "test.json", "calendar_id": "test@cal",
    })
    kid = cr.json()["id"]
    # 非法 method
    r = client.put(f"/api/gcal-keys/{kid}/reminders", json={"reminders": [{"method": "sms", "minutes": 10}]})
    assert r.status_code == 400
    # minutes 超限
    r2 = client.put(f"/api/gcal-keys/{kid}/reminders", json={"reminders": [{"method": "popup", "minutes": 99999}]})
    assert r2.status_code == 400
    # 非陣列
    r3 = client.put(f"/api/gcal-keys/{kid}/reminders", json={"reminders": "not_array"})
    assert r3.status_code == 400
    # Email 已移除
    r4 = client.put(f"/api/gcal-keys/{kid}/reminders", json={
        "reminders": [{"method": "email", "minutes": 10}],
    })
    assert r4.status_code == 400
    # 最多五筆
    r5 = client.put(f"/api/gcal-keys/{kid}/reminders", json={
        "reminders": [{"method": "popup", "minutes": i} for i in range(6)],
    })
    assert r5.status_code == 400
    # 空陣列與非整數
    r6 = client.put(f"/api/gcal-keys/{kid}/reminders", json={"reminders": []})
    assert r6.status_code == 400
    r7 = client.put(f"/api/gcal-keys/{kid}/reminders", json={
        "reminders": [{"method": "popup", "minutes": 1.5}],
    })
    assert r7.status_code == 400
    r8 = client.put(f"/api/gcal-keys/{kid}/reminders", json={
        "reminders": [{"method": "popup", "minutes": True}],
    })
    assert r8.status_code == 400


# ========== 強制同步 API 測試 ==========

def test_force_sync_now(client, monkeypatch):
    """POST /api/gcal-sync-now 立即同步"""
    from app.services import sync_scheduler

    calls = []
    monkeypatch.setattr(sync_scheduler, "reset_now", lambda: calls.append(True))
    r = client.post("/api/gcal-sync-now")
    assert r.status_code == 200
    assert r.json()["ok"] is True
    assert calls == [True]


def test_force_sync_now_viewer_forbidden(client):
    """viewer 無法觸發強制同步"""
    client.post("/api/users", json={"username": "viewer2", "password": "Pass1234", "role": "viewer"})
    r = client.post("/api/auth/login", json={"username": "viewer2", "password": "Pass1234"})
    assert r.status_code == 200
    r2 = client.post("/api/gcal-sync-now")
    assert r2.status_code == 403


def test_backfill_all_appointments_returns_count(client):
    """C1 防回歸：新增 key 自動 backfill 舊行程，回傳正確筆數（不再靜默）。

    修正前 _backfill_all_appointments 吞掉例外不回傳 → 建立 key 後舊行程
    是否加入 sync_queue 完全無從得知。
    """
    from app.routes import gcal_keys as gk
    import app.database as app_db

    # 建 2 個 appointment
    # 2 個不同時段的 appointment（避免同 user 同時間衝突 409）
    appts = [("客戶A", "09:00", "10:00"), ("客戶B", "11:00", "12:00")]
    for name, st, en in appts:
        r = client.post("/api/appointments", json={
            "client_name": name, "address": "台北市", "date": "2026-08-28",
            "start_time": st, "end_time": en, "note": "", "user_ids": [1],
        })
        assert r.status_code == 200, r.text

    conn = app_db.get_db()
    try:
        cur = conn.execute(
            "INSERT INTO gcal_keys(name, credentials_path, calendar_id) VALUES('bk1','a.json','c1')")
        key_id = cur.lastrowid
        conn.commit()
    finally:
        conn.close()

    # 直接呼叫 _backfill_all_appointments，驗證回傳筆數
    count = gk._backfill_all_appointments(key_id)
    assert count == 2  # 2 個 appointment 都回填

    conn = app_db.get_db()
    try:
        rows = conn.execute(
            "SELECT DISTINCT appointment_id FROM appointment_sync_queue WHERE key_id=?", (key_id,)).fetchall()
        assert len(rows) == 2, f"sync_queue 應有 2 筆回填，實際 {len(rows)}"
    finally:
        conn.close()


# ========== A6：同步隊列管理 API 測試 ==========

class TestSyncQueueAPI:
    """A6：GET /api/gcal-sync-queue + PUT /api/gcal-sync-queue/reset"""

    def test_list_sync_queue(self, client):
        """GET /api/gcal-sync-queue 回傳隊列列表"""
        from app.database import get_db

        # 手動塞一列 sync_queue
        conn = get_db()
        try:
            conn.execute("INSERT INTO gcal_keys(name, credentials_path, calendar_id, is_active) "
                         "VALUES('qKey','q.json','q@cal',1)")
            conn.execute("INSERT INTO appointments(client_name, date, start_time, end_time) "
                         "VALUES('Q測試','2026-08-28','09:00','11:00')")
            appt_id = conn.execute("SELECT id FROM appointments").fetchone()["id"]
            key_id = conn.execute("SELECT id FROM gcal_keys WHERE name='qKey'").fetchone()["id"]
            conn.execute(
                "INSERT INTO appointment_sync_queue"
                "(appointment_id, key_id, op_type, google_event_id, last_modified_at, attempts, last_error) "
                "VALUES(?,?,'U','',datetime('now'),3,'timeout')", (appt_id, key_id))
            conn.commit()
        finally:
            conn.close()

        r = client.get("/api/gcal-sync-queue")
        assert r.status_code == 200
        data = r.json()
        assert "items" in data
        assert len(data["items"]) >= 1
        item = data["items"][0]
        assert item["op_type"] == "U"
        assert item["attempts"] == 3
        assert item["last_error"] == "timeout"
        assert item["key_name"] == "qKey"

    def test_reset_sync_queue(self, client):
        """PUT /api/gcal-sync-queue/reset 重置 attempts 歸零"""
        from app.database import get_db

        conn = get_db()
        try:
            conn.execute("INSERT INTO gcal_keys(name, credentials_path, calendar_id, is_active) "
                         "VALUES('rKey','r.json','r@cal',1)")
            conn.execute("INSERT INTO appointments(client_name, date, start_time, end_time) "
                         "VALUES('R測試','2026-08-28','09:00','11:00')")
            appt_id = conn.execute("SELECT id FROM appointments").fetchone()["id"]
            key_id = conn.execute("SELECT id FROM gcal_keys WHERE name='rKey'").fetchone()["id"]
            conn.execute(
                "INSERT INTO appointment_sync_queue"
                "(appointment_id, key_id, op_type, google_event_id, last_modified_at, attempts, last_error) "
                "VALUES(?,?,'C','',datetime('now'),5,'perm error')", (appt_id, key_id))
            conn.commit()
        finally:
            conn.close()

        r = client.put(f"/api/gcal-sync-queue/reset?appt_id={appt_id}&key_id={key_id}")
        assert r.status_code == 200
        assert r.json()["ok"] is True

        # 確認 attempts 歸零
        conn = get_db()
        try:
            row = conn.execute(
                "SELECT attempts, last_error FROM appointment_sync_queue "
                "WHERE appointment_id=? AND key_id=?", (appt_id, key_id)).fetchone()
            assert row["attempts"] == 0
            assert row["last_error"] == ""
        finally:
            conn.close()

    def test_reset_nonexistent_returns_404(self, client):
        """PUT reset 不存在的列 → 404"""
        r = client.put("/api/gcal-sync-queue/reset?appt_id=99999&key_id=99999")
        assert r.status_code == 404


# ========== 刪除 key 時清 Google 事件 ==========

class TestDeleteKeyCleansGoogleEvents:
    """刪除 key 前，先打 Google API 刪掉已同步的事件"""

    def test_delete_key_removes_google_events(self, client, monkeypatch):
        """刪除有同步事件的 key → Google 事件被刪除，本地 map 清空"""
        from app.database import get_db
        from app.services import gcal_sync
        from unittest.mock import MagicMock

        # 建 key
        conn = get_db()
        try:
            cur = conn.execute(
                "INSERT INTO gcal_keys(name, credentials_path, calendar_id, is_active) "
                "VALUES('delTest', 'fake.json', 'del@cal', 1)")
            key_id = cur.lastrowid
            conn.execute("UPDATE users SET gcal_key='delTest' WHERE username='admin'")
            # 建行程 + map（模擬已同步 2 筆）
            conn.execute("INSERT INTO appointments(client_name, date, start_time, end_time) "
                         "VALUES('dk1','2026-08-28','09:00','11:00')")
            a1 = conn.execute("SELECT id FROM appointments WHERE client_name='dk1'").fetchone()["id"]
            conn.execute("INSERT INTO appointments(client_name, date, start_time, end_time) "
                         "VALUES('dk2','2026-08-28','13:00','15:00')")
            a2 = conn.execute("SELECT id FROM appointments WHERE client_name='dk2'").fetchone()["id"]
            conn.execute("INSERT INTO appointment_gcal_map(appointment_id, key_id, google_event_id, data_hash) "
                         "VALUES(?,?, 'ev1', 'h1'),(?,? , 'ev2', 'h2')", (a1, key_id, a2, key_id))
            conn.commit()
        finally:
            conn.close()

        # Mock Google service
        mock_svc = MagicMock()
        monkeypatch.setattr(gcal_sync, "get_service_for_key", lambda kr: mock_svc)

        # 刪 key
        r = client.delete(f"/api/gcal-keys/{key_id}")
        assert r.status_code == 200
        data = r.json()
        assert data["ok"] is True
        assert data["google_deleted"] == 2
        assert data["google_failed"] == 0

        # Google delete 應被呼叫 2 次
        assert mock_svc.events().delete.call_count == 2

        # 本地 map 應被 CASCADE 清空
        conn = get_db()
        try:
            remaining = conn.execute(
                "SELECT COUNT(*) FROM appointment_gcal_map WHERE key_id=?", (key_id,)).fetchone()[0]
            assert remaining == 0
        finally:
            conn.close()

    def test_delete_key_retains_retry_state_if_google_fails(self, client, monkeypatch):
        """Google API 失敗時保留 key/map，交由 D queue 之後 retry。"""
        from app.database import get_db
        from app.services import gcal_sync
        from unittest.mock import MagicMock

        conn = get_db()
        try:
            cur = conn.execute(
                "INSERT INTO gcal_keys(name, credentials_path, calendar_id, is_active) "
                "VALUES('failKey', 'fake.json', 'fail@cal', 1)")
            key_id = cur.lastrowid
            conn.execute("INSERT INTO appointments(client_name, date, start_time, end_time) "
                         "VALUES('fk1','2026-08-28','09:00','11:00')")
            a1 = conn.execute("SELECT id FROM appointments WHERE client_name='fk1'").fetchone()["id"]
            conn.execute("INSERT INTO appointment_gcal_map(appointment_id, key_id, google_event_id, data_hash) "
                         "VALUES(?,?, 'fail-ev', 'h')", (a1, key_id))
            conn.commit()
        finally:
            conn.close()

        # Mock Google service 拋例外
        mock_svc = MagicMock()
        mock_svc.events().delete().execute.side_effect = Exception("Google API 403")
        monkeypatch.setattr(gcal_sync, "get_service_for_key", lambda kr: mock_svc)

        r = client.delete(f"/api/gcal-keys/{key_id}")
        assert r.status_code == 409
        data = r.json()
        assert data["detail"]["google_failed"] == 1  # 事件刪除失敗

        # 失敗時保留 key/map，並留下可人工 retry 的 D queue。
        conn = get_db()
        try:
            assert conn.execute("SELECT id FROM gcal_keys WHERE id=?", (key_id,)).fetchone() is not None
            mapping = conn.execute(
                "SELECT google_event_id FROM appointment_gcal_map WHERE appointment_id=? AND key_id=?",
                (a1, key_id),
            ).fetchone()
            assert mapping["google_event_id"] == "fail-ev"
            queued = conn.execute(
                "SELECT op_type, google_event_id, attempts, last_error FROM appointment_sync_queue "
                "WHERE appointment_id=? AND key_id=?", (a1, key_id),
            ).fetchone()
            assert queued["op_type"] == "D"
            assert queued["google_event_id"] == "fail-ev"
            assert queued["attempts"] == 1
            assert "Google API 403" in queued["last_error"]
        finally:
            conn.close()

def test_scheduler_thread_survives_first_key_added_after_startup(client, monkeypatch):
    """server 啟動時無 key 也要保有 worker；第一把 key 後不需重啟即可 backfill。"""
    from app.database import get_db
    from app.services import gcal_sync, sync_scheduler
    from unittest.mock import MagicMock

    assert sync_scheduler._thread is not None and sync_scheduler._thread.is_alive()
    appointment = client.post("/api/appointments", json={
        "client_name": "startup-no-key", "date": "2026-08-28",
        "start_time": "09:00", "end_time": "10:00", "user_ids": [1],
    }).json()
    created = client.post("/api/gcal-keys", json={
        "name": "first-after-start", "credentials_path": "fake.json", "calendar_id": "first@cal",
    })
    assert created.status_code == 201
    conn = get_db()
    try:
        key_id = conn.execute("SELECT id FROM gcal_keys WHERE name='first-after-start'").fetchone()["id"]
        row = conn.execute("SELECT op_type FROM appointment_sync_queue WHERE appointment_id=? AND key_id=?",
                           (appointment["id"], key_id)).fetchone()
        assert row["op_type"] == "C"
    finally:
        conn.close()

    service = MagicMock()
    service.events().insert.return_value.execute.return_value = {"id": "startup-event"}
    monkeypatch.setattr(gcal_sync, "get_service_for_key", lambda row: service)
    sync_scheduler._run_once(force=True)
    service.events().insert.assert_called_once()
    conn = get_db()
    try:
        assert conn.execute(
            "SELECT google_event_id FROM appointment_gcal_map WHERE appointment_id=? AND key_id=?",
            (appointment["id"], key_id),
        ).fetchone()["google_event_id"] == "startup-event"
    finally:
        conn.close()

def test_reminder_change_invalidates_only_mapped_key(client):
    """per-key reminder 變更只應讓該 key 的既有 mapping 進 U queue。"""
    from app.database import get_db

    key_a = client.post("/api/gcal-keys", json={
        "name": "reminder-A", "credentials_path": "a.json", "calendar_id": "a@cal",
    }).json()["id"]
    key_b = client.post("/api/gcal-keys", json={
        "name": "reminder-B", "credentials_path": "b.json", "calendar_id": "b@cal",
    }).json()["id"]
    conn = get_db()
    try:
        cur = conn.execute("INSERT INTO appointments(client_name,date,start_time,end_time) VALUES(?,?,?,?)",
                           ("提醒既有行程", "2026-08-28", "09:00", "10:00"))
        appt_id = cur.lastrowid
        conn.execute("INSERT INTO appointment_gcal_map(appointment_id,key_id,google_event_id,data_hash) VALUES(?,?,?,?)",
                     (appt_id, key_a, "event-a", "old-a"))
        conn.execute("INSERT INTO appointment_gcal_map(appointment_id,key_id,google_event_id,data_hash) VALUES(?,?,?,?)",
                     (appt_id, key_b, "event-b", "old-b"))
        conn.commit()
    finally:
        conn.close()
    response = client.put(f"/api/gcal-keys/{key_a}/reminders", json={
        "reminders": [{"method": "popup", "minutes": 1440}, {"method": "popup", "minutes": 120},
                      {"method": "popup", "minutes": 15}],
    })
    assert response.status_code == 200
    conn = get_db()
    try:
        rows = conn.execute("SELECT key_id,op_type,google_event_id FROM appointment_sync_queue WHERE appointment_id=?",
                            (appt_id,)).fetchall()
        assert [(row["key_id"], row["op_type"], row["google_event_id"]) for row in rows] == [(key_a, "U", "event-a")]
    finally:
        conn.close()


def test_global_setting_change_invalidates_all_active_mappings(client):
    """全域 payload 設定變更應 enqueue 所有 active key mapping，而非只改 DB。"""
    from app.database import get_db

    key_ids = [client.post("/api/gcal-keys", json={
        "name": f"global-{suffix}", "credentials_path": f"{suffix}.json", "calendar_id": f"{suffix}@cal",
    }).json()["id"] for suffix in ("A", "B")]
    conn = get_db()
    try:
        appt_id = conn.execute(
            "INSERT INTO appointments(client_name,date,start_time,end_time) VALUES(?,?,?,?)",
            ("全域設定行程", "2026-08-28", "09:00", "10:00"),
        ).lastrowid
        for key_id, event_id in zip(key_ids, ("event-global-a", "event-global-b")):
            conn.execute("INSERT INTO appointment_gcal_map(appointment_id,key_id,google_event_id,data_hash) VALUES(?,?,?,?)",
                         (appt_id, key_id, event_id, "old"))
        conn.commit()
    finally:
        conn.close()
    response = client.put("/api/gcal-sync-settings", json={"gcal_transparency": "opaque"})
    assert response.status_code == 200
    conn = get_db()
    try:
        rows = conn.execute("SELECT key_id,op_type FROM appointment_sync_queue WHERE appointment_id=? ORDER BY key_id",
                            (appt_id,)).fetchall()
        assert [(row["key_id"], row["op_type"]) for row in rows] == [(key_ids[0], "U"), (key_ids[1], "U")]
    finally:
        conn.close()


def test_reenable_key_uses_hash_mismatch_to_enqueue_update(client):
    """停用期間行程變更後，重啟 key 不能只因 map 存在就跳過。"""
    from app.database import get_db

    key_id = client.post("/api/gcal-keys", json={
        "name": "reenable-stale", "credentials_path": "a.json", "calendar_id": "a@cal",
    }).json()["id"]
    assert client.put(f"/api/gcal-keys/{key_id}", json={"is_active": False}).status_code == 200
    appt_id = client.post("/api/appointments", json={
        "client_name": "停用期間修改", "date": "2026-08-28",
        "start_time": "09:00", "end_time": "10:00", "user_ids": [1],
    }).json()["id"]
    conn = get_db()
    try:
        conn.execute("INSERT INTO appointment_gcal_map(appointment_id,key_id,google_event_id,data_hash) VALUES(?,?,?,?)",
                     (appt_id, key_id, "existing-event", "stale-hash"))
        conn.commit()
    finally:
        conn.close()
    assert client.put(f"/api/gcal-keys/{key_id}", json={"is_active": True}).status_code == 200
    conn = get_db()
    try:
        row = conn.execute("SELECT op_type,google_event_id FROM appointment_sync_queue WHERE appointment_id=? AND key_id=?",
                           (appt_id, key_id)).fetchone()
        assert row["op_type"] == "U"
        assert row["google_event_id"] == "existing-event"
    finally:
        conn.close()


def test_reenable_key_skips_mapping_with_same_canonical_hash(client):
    """重啟 key 時 final payload hash 相同，不應建立無效 queue。"""
    from app.database import get_db
    from app.services.gcal_sync import load_event_payload

    key_id = client.post("/api/gcal-keys", json={
        "name": "reenable-same", "credentials_path": "a.json", "calendar_id": "a@cal",
    }).json()["id"]
    assert client.put(f"/api/gcal-keys/{key_id}", json={"is_active": False}).status_code == 200
    appt_id = client.post("/api/appointments", json={
        "client_name": "內容未變", "date": "2026-08-28",
        "start_time": "09:00", "end_time": "10:00", "user_ids": [1],
    }).json()["id"]
    conn = get_db()
    try:
        key_row = conn.execute("SELECT * FROM gcal_keys WHERE id=?", (key_id,)).fetchone()
        _, payload_hash = load_event_payload(conn, appt_id, dict(key_row))
        conn.execute("INSERT INTO appointment_gcal_map(appointment_id,key_id,google_event_id,data_hash) VALUES(?,?,?,?)",
                     (appt_id, key_id, "same-event", payload_hash))
        conn.commit()
    finally:
        conn.close()
    assert client.put(f"/api/gcal-keys/{key_id}", json={"is_active": True}).status_code == 200
    conn = get_db()
    try:
        assert conn.execute("SELECT 1 FROM appointment_sync_queue WHERE appointment_id=? AND key_id=?",
                            (appt_id, key_id)).fetchone() is None
    finally:
        conn.close()


def test_sync_status_reports_retrying_and_exhausted_counts(client):
    """健康 API 將 attempts 1~4 與 >=5 分成 retrying/exhausted。"""
    from app.database import get_db

    conn = get_db()
    try:
        key_id = conn.execute("INSERT INTO gcal_keys(name,credentials_path,calendar_id) VALUES('health-key','x.json','h@cal')").lastrowid
        paused_key = conn.execute("INSERT INTO gcal_keys(name,credentials_path,calendar_id,is_active) VALUES('paused-health-key','x.json','ph@cal',0)").lastrowid
        for appt_id, attempts, error in ((901, 0, ""), (902, 2, "timeout"), (903, 5, "403")):
            conn.execute("INSERT INTO appointment_sync_queue(appointment_id,key_id,op_type,google_event_id,last_modified_at,attempts,last_error) VALUES(?,?,?, ?,datetime('now'),?,?)",
                         (appt_id, key_id, "D", f"event-{appt_id}", attempts, error))
        conn.execute("INSERT INTO appointment_sync_queue(appointment_id,key_id,op_type,google_event_id,last_modified_at,attempts,last_error) VALUES(?,?, 'D', ?,datetime('now'),0,'')",
                     (904, paused_key, "paused-event"))
        conn.commit()
    finally:
        conn.close()
    response = client.get("/api/gcal-sync-status")
    assert response.status_code == 200
    data = response.json()
    assert data["pending_count"] >= 1
    assert data["retrying_count"] >= 1
    assert data["exhausted_count"] >= 1
    assert data["paused_count"] == 1


def test_deleted_exhausted_queue_is_listed_for_settings_retry(client):
    """本地已刪除的 D exhausted row 仍可在管理 API 看見。"""
    from app.database import get_db

    conn = get_db()
    try:
        key_id = conn.execute("INSERT INTO gcal_keys(name,credentials_path,calendar_id) VALUES('deleted-key','x.json','d@cal')").lastrowid
        conn.execute("INSERT INTO appointment_sync_queue(appointment_id,key_id,op_type,google_event_id,last_modified_at,attempts,last_error) VALUES(?,?, 'D', ?,datetime('now'),5,?)",
                     (152, key_id, "deleted-event", "403 permission denied"))
        conn.commit()
    finally:
        conn.close()
    response = client.get("/api/gcal-sync-queue")
    assert response.status_code == 200
    item = response.json()["items"][0]
    assert item["appointment_id"] == 152
    assert item["client_name"] is None
    assert item["status"] == "exhausted"
    assert item["is_deleted"] is True


def test_retry_resets_only_selected_queue_row(client):
    """管理頁 retry 只能 reset 指定 appointment + key。"""
    from app.database import get_db

    conn = get_db()
    try:
        key_a = conn.execute("INSERT INTO gcal_keys(name,credentials_path,calendar_id) VALUES('retry-A','a.json','a@cal')").lastrowid
        key_b = conn.execute("INSERT INTO gcal_keys(name,credentials_path,calendar_id) VALUES('retry-B','b.json','b@cal')").lastrowid
        for key_id, appt_id in ((key_a, 201), (key_b, 202)):
            conn.execute("INSERT INTO appointment_sync_queue(appointment_id,key_id,op_type,last_modified_at,attempts,last_error) VALUES(?,?, 'D',datetime('now'),5,'failed')",
                         (appt_id, key_id))
        conn.commit()
    finally:
        conn.close()
    response = client.put(f"/api/gcal-sync-queue/reset?appt_id=201&key_id={key_a}")
    assert response.status_code == 200
    conn = get_db()
    try:
        first = conn.execute("SELECT attempts,last_error FROM appointment_sync_queue WHERE appointment_id=201").fetchone()
        second = conn.execute("SELECT attempts,last_error FROM appointment_sync_queue WHERE appointment_id=202").fetchone()
        assert (first["attempts"], first["last_error"]) == (0, "")
        assert (second["attempts"], second["last_error"]) == (5, "failed")
    finally:
        conn.close()


def test_service_rename_invalidates_existing_mapping(client):
    """Regression: changing service name with the same service_type_id must enqueue its mapped event."""
    from app.database import get_db

    key_id = client.post("/api/gcal-keys", json={
        "name": "service-rename-key", "credentials_path": "service.json", "calendar_id": "service@cal",
    }).json()["id"]
    conn = get_db()
    try:
        appt_id = conn.execute(
            "INSERT INTO appointments(client_name,service_type_id,date,start_time,end_time) VALUES(?,?,?,?,?)",
            ("服務改名行程", 1, "2026-08-28", "09:00", "10:00"),
        ).lastrowid
        conn.execute(
            "INSERT INTO appointment_gcal_map(appointment_id,key_id,google_event_id,data_hash) VALUES(?,?,?,?)",
            (appt_id, key_id, "service-event", "old-hash"),
        )
        conn.commit()
    finally:
        conn.close()

    response = client.put("/api/service-types/1", json={
        "name": "保養改名", "sort_order": 1, "is_active": True,
    })
    assert response.status_code == 200
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT op_type, google_event_id FROM appointment_sync_queue WHERE appointment_id=? AND key_id=?",
            (appt_id, key_id),
        ).fetchone()
        assert row["op_type"] == "U"
        assert row["google_event_id"] == "service-event"
    finally:
        conn.close()


def test_assignee_display_name_change_invalidates_existing_mapping(client):
    """Regression: changing display_name without changing user_id must enqueue the mapped event."""
    from app.database import get_db

    key_id = client.post("/api/gcal-keys", json={
        "name": "assignee-rename-key", "credentials_path": "assignee.json", "calendar_id": "assignee@cal",
    }).json()["id"]
    conn = get_db()
    try:
        appt_id = conn.execute(
            "INSERT INTO appointments(client_name,date,start_time,end_time) VALUES(?,?,?,?)",
            ("人員改名行程", "2026-08-28", "09:00", "10:00"),
        ).lastrowid
        conn.execute(
            "INSERT INTO appointment_assignees(appointment_id,user_id) VALUES(?,1)", (appt_id,)
        )
        conn.execute(
            "INSERT INTO appointment_gcal_map(appointment_id,key_id,google_event_id,data_hash) VALUES(?,?,?,?)",
            (appt_id, key_id, "assignee-event", "old-hash"),
        )
        conn.commit()
    finally:
        conn.close()

    response = client.put("/api/users/1", json={"display_name": "改名後人員"})
    assert response.status_code == 200
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT op_type, google_event_id FROM appointment_sync_queue WHERE appointment_id=? AND key_id=?",
            (appt_id, key_id),
        ).fetchone()
        assert row["op_type"] == "U"
        assert row["google_event_id"] == "assignee-event"
    finally:
        conn.close()


def test_user_key_change_reconciles_existing_mappings(client):
    """Regression: changing an assignee's gcal_key must add the new event and delete the old one."""
    from app.database import get_db

    key_a = client.post("/api/gcal-keys", json={
        "name": "binding-A", "credentials_path": "binding-a.json", "calendar_id": "binding-a@cal",
    }).json()["id"]
    key_b = client.post("/api/gcal-keys", json={
        "name": "binding-B", "credentials_path": "binding-b.json", "calendar_id": "binding-b@cal",
    }).json()["id"]
    conn = get_db()
    try:
        conn.execute("UPDATE users SET gcal_key='binding-A' WHERE id=1")
        appt_id = conn.execute(
            "INSERT INTO appointments(client_name,date,start_time,end_time) VALUES(?,?,?,?)",
            ("換 Key 行程", "2026-08-28", "09:00", "10:00"),
        ).lastrowid
        conn.execute("INSERT INTO appointment_assignees(appointment_id,user_id) VALUES(?,1)", (appt_id,))
        conn.execute(
            "INSERT INTO appointment_gcal_map(appointment_id,key_id,google_event_id,data_hash) VALUES(?,?,?,?)",
            (appt_id, key_a, "old-binding-event", "old-hash"),
        )
        conn.commit()
    finally:
        conn.close()

    response = client.put("/api/users/1", json={"gcal_key": "binding-B"})
    assert response.status_code == 200
    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT key_id, op_type, google_event_id FROM appointment_sync_queue "
            "WHERE appointment_id=? ORDER BY key_id", (appt_id,)
        ).fetchall()
        assert [(row["key_id"], row["op_type"], row["google_event_id"]) for row in rows] == [
            (key_a, "D", "old-binding-event"), (key_b, "U", ""),
        ]
    finally:
        conn.close()



def test_new_key_backfill_respects_assignee_key(client):
    """Regression: a new key must not create events for appointments assigned to another key."""
    from app.database import get_db

    key_a = client.post("/api/gcal-keys", json={
        "name": "backfill-target-A", "credentials_path": "target-a.json", "calendar_id": "target-a@cal",
    }).json()["id"]
    conn = get_db()
    try:
        conn.execute("UPDATE users SET gcal_key='backfill-target-A' WHERE id=1")
        appt_id = conn.execute(
            "INSERT INTO appointments(client_name,date,start_time,end_time) VALUES(?,?,?,?)",
            ("只屬於 A 的行程", "2026-08-28", "09:00", "10:00"),
        ).lastrowid
        conn.execute("INSERT INTO appointment_assignees(appointment_id,user_id) VALUES(?,1)", (appt_id,))
        conn.commit()
    finally:
        conn.close()
    created = client.post("/api/gcal-keys", json={
        "name": "backfill-target-B", "credentials_path": "target-b.json", "calendar_id": "target-b@cal",
    })
    assert created.status_code == 201
    conn = get_db()
    try:
        key_b = conn.execute("SELECT id FROM gcal_keys WHERE name='backfill-target-B'").fetchone()["id"]
        assert key_a != key_b
        assert conn.execute(
            "SELECT 1 FROM appointment_sync_queue WHERE appointment_id=? AND key_id=?", (appt_id, key_b)
        ).fetchone() is None
    finally:
        conn.close()


def test_sync_settings_rejects_unknown_fields(client):
    """非法同步設定不可靜默 200。"""
    response = client.put("/api/gcal-sync-settings", json={"not_a_setting": "x"})
    assert response.status_code == 400


def test_sync_queue_reset_rejects_negative_ids(client):
    """queue reset 的識別碼必須非負，非法輸入不可變成 404/500。"""
    response = client.put("/api/gcal-sync-queue/reset?appt_id=-1&key_id=1")
    assert response.status_code == 400



def test_remote_reminder_probe_endpoint(client, monkeypatch):
    """debug path 應讀回 Google remote reminders，且不回傳 credentials。"""
    from app.services import gcal_sync
    from unittest.mock import MagicMock

    key_id = client.post("/api/gcal-keys", json={
        "name": "probe-key", "credentials_path": "probe.json", "calendar_id": "probe@cal",
    }).json()["id"]
    service = MagicMock()
    service.events().get.return_value.execute.return_value = {
        "reminders": {"useDefault": False, "overrides": [{"method": "popup", "minutes": 1440}]}
    }
    monkeypatch.setattr(gcal_sync, "get_service_for_key", lambda row: service)
    response = client.get(f"/api/gcal-keys/{key_id}/events/remote-event/reminders")
    assert response.status_code == 200
    data = response.json()
    assert data["reminders"]["overrides"][0]["minutes"] == 1440
    assert "credentials_path" not in data
    service.events().get.assert_called_once_with(calendarId="probe@cal", eventId="remote-event")



def test_delete_key_uses_event_lock_for_remote_and_local_cleanup(client, monkeypatch):
    """key deletion 的 remote delete 與 local cascade 必須在同一 event lock 內。"""
    from contextlib import contextmanager
    from unittest.mock import MagicMock

    from app.database import get_db
    from app.routes import gcal_keys
    from app.services import gcal_sync

    monkeypatch.setattr(gcal_keys, "_backfill_all_appointments", lambda key_id: 0)
    monkeypatch.setattr(gcal_keys, "_wake_scheduler", lambda: None)
    key_id = client.post("/api/gcal-keys", json={
        "name": "locked-delete-key", "credentials_path": "delete.json", "calendar_id": "delete@cal",
    }).json()["id"]
    conn = get_db()
    try:
        appt_id = conn.execute(
            "INSERT INTO appointments(client_name,date,start_time,end_time) VALUES(?,?,?,?)",
            ("locked-delete-appt", "2026-08-28", "09:00", "10:00"),
        ).lastrowid
        conn.execute(
            "INSERT INTO appointment_gcal_map(appointment_id,key_id,google_event_id,data_hash) VALUES(?,?,?,?)",
            (appt_id, key_id, "locked-delete-event", "hash"),
        )
        conn.commit()
    finally:
        conn.close()

    state = {"depth": 0, "remote_seen": False}

    @contextmanager
    def observed_lock(locked_appt_id, locked_key_id):
        assert (locked_appt_id, locked_key_id) == (appt_id, key_id)
        state["depth"] += 1
        try:
            yield
            check = get_db()
            try:
                # lock must remain held through the key/map local cleanup.
                assert check.execute("SELECT 1 FROM gcal_keys WHERE id=?", (key_id,)).fetchone() is None
            finally:
                check.close()
        finally:
            state["depth"] -= 1

    service = MagicMock()

    def remote_delete():
        assert state["depth"] == 1
        state["remote_seen"] = True

    service.events().delete.return_value.execute.side_effect = remote_delete
    monkeypatch.setattr(gcal_sync, "_event_process_lock", observed_lock)
    monkeypatch.setattr(gcal_sync, "get_service_for_key", lambda row: service)

    response = client.delete(f"/api/gcal-keys/{key_id}")

    assert response.status_code == 200
    assert state == {"depth": 0, "remote_seen": True}


def test_sync_queue_redacts_credential_path(client, monkeypatch):
    """queue API 必須遮罩歷史資料中的 credential path。"""
    from app.database import get_db
    from app.routes import gcal_keys

    monkeypatch.setattr(gcal_keys, "_wake_scheduler", lambda: None)
    key_id = client.post("/api/gcal-keys", json={
        "name": "queue-redaction-key", "credentials_path": "queue.json", "calendar_id": "queue@cal",
    }).json()["id"]
    conn = get_db()
    try:
        appt_id = conn.execute(
            "INSERT INTO appointments(client_name,date,start_time,end_time) VALUES(?,?,?,?)",
            ("queue-redaction-appt", "2026-08-28", "09:00", "10:00"),
        ).lastrowid
        conn.execute(
            "INSERT INTO appointment_sync_queue"
            "(appointment_id,key_id,op_type,google_event_id,last_modified_at,attempts,last_error) "
            "VALUES(?,?, 'U', '',datetime('now'),1,?)",
            (appt_id, key_id, "FileNotFoundError: [Errno 2] No such file or directory: 'C:/private/service-account.json'"),
        )
        conn.commit()
    finally:
        conn.close()

    response = client.get("/api/gcal-sync-queue")

    assert response.status_code == 200
    item = next(item for item in response.json()["items"] if item["appointment_id"] == appt_id)
    assert item["last_error"] == "Credential file unavailable"
    assert "service-account.json" not in item["last_error"]



def test_delete_key_acquires_key_lock_before_mapping_snapshot(client, monkeypatch):
    """unmapped C queue 也必須在 key lock 保護下被 cascade 清理。"""
    from contextlib import contextmanager

    import app.database as app_db
    from app.routes import gcal_keys
    from app.services import gcal_sync

    monkeypatch.setattr(gcal_keys, "_backfill_all_appointments", lambda key_id: 0)
    monkeypatch.setattr(gcal_keys, "_wake_scheduler", lambda: None)
    key_id = client.post("/api/gcal-keys", json={
        "name": "key-lock-before-snapshot", "credentials_path": "key-lock.json", "calendar_id": "key-lock@cal",
    }).json()["id"]
    conn = app_db.get_db()
    try:
        appt_id = conn.execute(
            "INSERT INTO appointments(client_name,date,start_time,end_time) VALUES(?,?,?,?)",
            ("unmapped-create", "2026-08-28", "09:00", "10:00"),
        ).lastrowid
        conn.execute(
            "INSERT INTO appointment_sync_queue"
            "(appointment_id,key_id,op_type,google_event_id,last_modified_at,attempts,last_error) "
            "VALUES(?,?, 'C', '', '2026-08-28 00:00:00', 0, '')",
            (appt_id, key_id),
        )
        conn.commit()
    finally:
        conn.close()

    state = {"locked": False, "entered": 0, "map_query_before_lock": False}

    @contextmanager
    def observed_key_lock(locked_key_id):
        assert locked_key_id == key_id
        assert not state["locked"]
        state["locked"] = True
        state["entered"] += 1
        try:
            yield
        finally:
            state["locked"] = False

    real_get_db = gcal_keys.get_db

    class TracedConnection:
        def __init__(self, wrapped):
            self._wrapped = wrapped

        def execute(self, sql, *params):
            if "appointment_gcal_map" in sql and "SELECT" in sql and not state["locked"]:
                state["map_query_before_lock"] = True
            return self._wrapped.execute(sql, *params)

        def __getattr__(self, name):
            return getattr(self._wrapped, name)

    def traced_get_db():
        return TracedConnection(real_get_db())

    monkeypatch.setattr(gcal_sync, "_key_process_lock", observed_key_lock)
    monkeypatch.setattr(gcal_keys, "get_db", traced_get_db)

    response = client.delete(f"/api/gcal-keys/{key_id}")

    assert response.status_code == 200
    assert state == {"locked": False, "entered": 1, "map_query_before_lock": False}



def test_calendar_change_reconciles_existing_remote_event(client, monkeypatch):
    """calendar_id 變更時，舊 calendar event 必須清除並以新 calendar 建立 C queue。"""
    from unittest.mock import MagicMock

    from app.database import get_db
    from app.routes import gcal_keys
    from app.services import gcal_sync

    monkeypatch.setattr(gcal_keys, "_wake_scheduler", lambda: None)
    key_id = client.post("/api/gcal-keys", json={
        "name": "calendar-change-key", "credentials_path": "calendar.json", "calendar_id": "old@cal",
    }).json()["id"]
    conn = get_db()
    try:
        appt_id = conn.execute(
            "INSERT INTO appointments(client_name,date,start_time,end_time) VALUES(?,?,?,?)",
            ("calendar-change-appt", "2026-08-28", "09:00", "10:00"),
        ).lastrowid
        conn.execute(
            "INSERT INTO appointment_gcal_map(appointment_id,key_id,google_event_id,data_hash) VALUES(?,?,?,?)",
            (appt_id, key_id, "old-calendar-event", "old-hash"),
        )
        conn.commit()
    finally:
        conn.close()

    service = MagicMock()
    service.events().delete.return_value.execute.return_value = {}
    monkeypatch.setattr(gcal_sync, "get_service_for_key", lambda row: service)

    response = client.put(f"/api/gcal-keys/{key_id}", json={"calendar_id": "new@cal"})

    assert response.status_code == 200
    service.events().delete.assert_called_once_with(
        calendarId="old@cal", eventId="old-calendar-event"
    )
    conn = get_db()
    try:
        key = conn.execute("SELECT calendar_id FROM gcal_keys WHERE id=?", (key_id,)).fetchone()
        assert key["calendar_id"] == "new@cal"
        assert conn.execute(
            "SELECT 1 FROM appointment_gcal_map WHERE appointment_id=? AND key_id=?",
            (appt_id, key_id),
        ).fetchone() is None
        queue = conn.execute(
            "SELECT op_type, google_event_id FROM appointment_sync_queue WHERE appointment_id=? AND key_id=?",
            (appt_id, key_id),
        ).fetchone()
        assert (queue["op_type"], queue["google_event_id"]) == ("C", "")
    finally:
        conn.close()


def test_update_key_uses_key_lock_for_active_state_change(client, monkeypatch):
    """啟停 key 必須與同步 remote I/O 共用 key-level lock。"""
    from contextlib import contextmanager

    from app.routes import gcal_keys
    from app.services import gcal_sync

    monkeypatch.setattr(gcal_keys, "_wake_scheduler", lambda: None)
    key_id = client.post("/api/gcal-keys", json={
        "name": "active-lock-key", "credentials_path": "active.json", "calendar_id": "active@cal",
    }).json()["id"]
    state = {"entered": 0}

    @contextmanager
    def observed_key_lock(locked_key_id):
        assert locked_key_id == key_id
        state["entered"] += 1
        yield

    monkeypatch.setattr(gcal_sync, "_key_process_lock", observed_key_lock)

    response = client.put(f"/api/gcal-keys/{key_id}", json={"is_active": False})

    assert response.status_code == 200
    assert state["entered"] == 1


def test_update_uploaded_file_is_cleaned_when_later_validation_fails(client, monkeypatch, tmp_path):
    """multipart 上傳後若 duplicate/DB validation 失敗，不得留下 orphan credential file。"""
    from app.routes import gcal_keys

    storage = tmp_path / "secrets" / "gcal"
    monkeypatch.setattr(gcal_keys, "BASE_DIR", tmp_path)
    monkeypatch.setattr(gcal_keys, "UPLOADED_CREDENTIALS_DIR", storage.resolve())
    monkeypatch.setattr(gcal_keys, "_wake_scheduler", lambda: None)
    created = client.post("/api/gcal-keys", json={
        "name": "existing-upload-key", "credentials_path": "existing.json", "calendar_id": "existing@cal",
    })
    key_id = created.json()["id"]
    duplicate = client.post("/api/gcal-keys", json={
        "name": "duplicate-upload-key", "credentials_path": "duplicate.json", "calendar_id": "duplicate@cal",
    })
    assert duplicate.status_code == 201

    response = client.put(
        f"/api/gcal-keys/{key_id}",
        data={"name": "duplicate-upload-key", "calendar_id": "existing@cal", "is_active": "true"},
        files={
            "credentials_file": (
                "replacement.json",
                b'{"type":"service_account","client_email":"upload@test.com","private_key":"fake"}',
                "application/json",
            ),
        },
    )

    assert response.status_code == 400
    assert not list(storage.glob("*.json"))



def test_key_api_does_not_expose_credentials_path(client):
    """Key list/create response 不得把 server-side credential path 傳給瀏覽器。"""
    response = client.post("/api/gcal-keys", json={
        "name": "path-redaction-key",
        "credentials_path": "C:/private/service-account.json",
        "calendar_id": "path@cal",
    })
    assert response.status_code == 201
    data = response.json()
    assert data["credentials_path"] == ""
    assert "service-account.json" not in str(data)
    listed = client.get("/api/gcal-keys")
    assert listed.status_code == 200
    assert listed.json()[0]["credentials_path"] == ""


def test_create_uploaded_file_is_cleaned_when_db_acquisition_fails(client, monkeypatch, tmp_path):
    """create 上傳後若連 DB 都失敗，不得留下 orphan credential file。"""
    from app.routes import gcal_keys

    storage = tmp_path / "secrets" / "gcal"
    monkeypatch.setattr(gcal_keys, "UPLOADED_CREDENTIALS_DIR", storage.resolve())

    def fail_get_db():
        raise RuntimeError("database unavailable")

    monkeypatch.setattr(gcal_keys, "get_db", fail_get_db)
    with pytest.raises(RuntimeError, match="database unavailable"):
        client.post(
            "/api/gcal-keys",
            data={"name": "db-failure-upload", "calendar_id": "db@cal"},
            files={
                "credentials_file": (
                    "service.json",
                    b'{"type":"service_account","client_email":"db@test.com","private_key":"fake"}',
                    "application/json",
                ),
            },
        )
    assert not list(storage.glob("*.json"))



def test_calendar_change_partial_delete_does_not_backfill_old_calendar(client, monkeypatch):
    """Calendar migration 部分 DELETE 失敗時，不得把成功刪除項目回填回舊 Calendar。"""
    from unittest.mock import MagicMock

    from app.database import get_db
    from app.routes import gcal_keys
    from app.services import gcal_sync

    monkeypatch.setattr(gcal_keys, "_wake_scheduler", lambda: None)
    key_id = client.post("/api/gcal-keys", json={
        "name": "partial-calendar-key", "credentials_path": "calendar.json", "calendar_id": "old@cal",
    }).json()["id"]
    conn = get_db()
    try:
        appt_ids = []
        for name in ("partial-A", "partial-B", "partial-C"):
            appt_ids.append(conn.execute(
                "INSERT INTO appointments(client_name,date,start_time,end_time) VALUES(?,?,?,?)",
                (name, "2026-08-28", "09:00", "10:00"),
            ).lastrowid)
        for appt_id, event_id in zip(appt_ids, ("event-a", "event-b", "event-c")):
            conn.execute(
                "INSERT INTO appointment_gcal_map(appointment_id,key_id,google_event_id,data_hash) "
                "VALUES(?,?,?,?)", (appt_id, key_id, event_id, "hash"),
            )
        conn.commit()
    finally:
        conn.close()

    service = MagicMock()

    def delete(calendarId, eventId):
        assert calendarId == "old@cal"
        if eventId == "event-c":
            error = RuntimeError("Google API 403")
            error.resp = type("Response", (), {"status": 403})()
            raise error
        return MagicMock()

    service.events().delete.side_effect = delete
    monkeypatch.setattr(gcal_sync, "get_service_for_key", lambda row: service)

    response = client.put(f"/api/gcal-keys/{key_id}", json={"calendar_id": "new@cal"})

    assert response.status_code == 409
    conn = get_db()
    try:
        key = conn.execute("SELECT calendar_id FROM gcal_keys WHERE id=?", (key_id,)).fetchone()
        assert key["calendar_id"] == "old@cal"
        for appt_id in appt_ids[:2]:
            assert conn.execute(
                "SELECT 1 FROM appointment_gcal_map WHERE appointment_id=? AND key_id=?",
                (appt_id, key_id),
            ).fetchone() is None
            assert conn.execute(
                "SELECT 1 FROM appointment_sync_queue WHERE appointment_id=? AND key_id=?",
                (appt_id, key_id),
            ).fetchone() is None
        remaining = conn.execute(
            "SELECT google_event_id FROM appointment_gcal_map WHERE appointment_id=? AND key_id=?",
            (appt_ids[2], key_id),
        ).fetchone()
        assert remaining["google_event_id"] == "event-c"
        retry = conn.execute(
            "SELECT op_type, google_event_id, attempts, last_error FROM appointment_sync_queue "
            "WHERE appointment_id=? AND key_id=?", (appt_ids[2], key_id),
        ).fetchone()
        assert (retry["op_type"], retry["google_event_id"], retry["attempts"]) == ("D", "event-c", 1)
        assert retry["last_error"] == "Google API 403"
    finally:
        conn.close()


def test_sync_interval_change_does_not_invalidate_existing_mapping(client, monkeypatch):
    """同步掃描間隔只影響 scheduler，不得把既有 mapping 建成 U queue。"""
    from app.database import get_db
    from app.routes import gcal_keys

    monkeypatch.setattr(gcal_keys, "_wake_scheduler", lambda: None)
    key_id = client.post("/api/gcal-keys", json={
        "name": "interval-only-key", "credentials_path": "interval.json", "calendar_id": "interval@cal",
    }).json()["id"]
    conn = get_db()
    try:
        appt_id = conn.execute(
            "INSERT INTO appointments(client_name,date,start_time,end_time) VALUES(?,?,?,?)",
            ("interval-appt", "2026-08-28", "09:00", "10:00"),
        ).lastrowid
        conn.execute(
            "INSERT INTO appointment_gcal_map(appointment_id,key_id,google_event_id,data_hash) "
            "VALUES(?,?,?,?)", (appt_id, key_id, "interval-event", "current-hash"),
        )
        conn.commit()
    finally:
        conn.close()

    response = client.put("/api/gcal-sync-settings", json={"gcal_sync_interval_min": "1"})

    assert response.status_code == 200
    assert response.json()["affected"] == 0
    conn = get_db()
    try:
        assert conn.execute(
            "SELECT COUNT(*) AS c FROM appointment_sync_queue WHERE appointment_id=? AND key_id=?",
            (appt_id, key_id),
        ).fetchone()["c"] == 0
        assert conn.execute(
            "SELECT value FROM gcal_sync_settings WHERE key='gcal_sync_interval_min'"
        ).fetchone()["value"] == "1"
    finally:
        conn.close()



def _seed_partial_calendar_migration(client):
    from app.database import get_db

    key_id = client.post("/api/gcal-keys", json={
        "name": "lifecycle-calendar-key", "credentials_path": "calendar.json", "calendar_id": "old@cal",
    }).json()["id"]
    conn = get_db()
    try:
        appt_ids = []
        for name in ("lifecycle-A", "lifecycle-B", "lifecycle-C"):
            appt_ids.append(conn.execute(
                "INSERT INTO appointments(client_name,date,start_time,end_time) VALUES(?,?,?,?)",
                (name, "2026-08-28", "09:00", "10:00"),
            ).lastrowid)
        for appt_id, event_id in zip(appt_ids, ("event-a", "event-b", "event-c")):
            conn.execute(
                "INSERT INTO appointment_gcal_map(appointment_id,key_id,google_event_id,data_hash) "
                "VALUES(?,?,?,?)", (appt_id, key_id, event_id, "hash"),
            )
        conn.commit()
    finally:
        conn.close()
    return key_id, appt_ids


def _partial_delete_service():
    from unittest.mock import MagicMock

    service = MagicMock()

    def delete(calendarId, eventId):
        assert calendarId == "old@cal"
        if eventId == "event-c":
            error = RuntimeError("Google API 403")
            error.resp = type("Response", (), {"status": 403})()
            raise error
        return MagicMock()

    service.events().delete.side_effect = delete
    return service


def test_calendar_migration_pending_blocks_appointment_edit(client, monkeypatch):
    """partial cleanup 後編輯 A 不得再把 C/U 寫回 old Calendar。"""
    from app.database import get_db
    from app.routes import gcal_keys
    from app.services import gcal_sync

    monkeypatch.setattr(gcal_keys, "_wake_scheduler", lambda: None)
    key_id, appt_ids = _seed_partial_calendar_migration(client)
    monkeypatch.setattr(gcal_sync, "get_service_for_key", lambda row: _partial_delete_service())
    response = client.put(f"/api/gcal-keys/{key_id}", json={"calendar_id": "new@cal"})
    assert response.status_code == 409

    edited = client.put(f"/api/appointments/{appt_ids[0]}", json={
        "client_name": "lifecycle-A-edited", "date": "2026-08-28",
        "start_time": "09:00", "end_time": "10:00", "user_ids": [],
    })
    assert edited.status_code == 200
    conn = get_db()
    try:
        assert conn.execute(
            "SELECT pending_calendar_id FROM gcal_keys WHERE id=?", (key_id,)
        ).fetchone()["pending_calendar_id"] == "new@cal"
        assert conn.execute(
            "SELECT 1 FROM appointment_sync_queue WHERE appointment_id=? AND key_id=?",
            (appt_ids[0], key_id),
        ).fetchone() is None
    finally:
        conn.close()


def test_calendar_migration_pending_survives_disable_enable(client, monkeypatch):
    """停用再啟用 pending Key 不得把成功刪除的 A/B backfill 成 old C。"""
    from app.database import get_db
    from app.routes import gcal_keys
    from app.services import gcal_sync

    monkeypatch.setattr(gcal_keys, "_wake_scheduler", lambda: None)
    key_id, appt_ids = _seed_partial_calendar_migration(client)
    monkeypatch.setattr(gcal_sync, "get_service_for_key", lambda row: _partial_delete_service())
    assert client.put(f"/api/gcal-keys/{key_id}", json={"calendar_id": "new@cal"}).status_code == 409
    assert client.put(f"/api/gcal-keys/{key_id}", json={"is_active": False}).status_code == 200
    assert client.put(f"/api/gcal-keys/{key_id}", json={"is_active": True}).status_code == 200

    conn = get_db()
    try:
        key = conn.execute(
            "SELECT calendar_id, pending_calendar_id FROM gcal_keys WHERE id=?", (key_id,)
        ).fetchone()
        assert (key["calendar_id"], key["pending_calendar_id"]) == ("old@cal", "new@cal")
        for appt_id in appt_ids[:2]:
            assert conn.execute(
                "SELECT 1 FROM appointment_sync_queue WHERE appointment_id=? AND key_id=?",
                (appt_id, key_id),
            ).fetchone() is None
    finally:
        conn.close()


def test_calendar_migration_d_retry_finalizes_and_backfills_new_calendar(client, monkeypatch):
    """最後 D 成功後切換 new Calendar，backfill 才建立 C queue。"""
    from unittest.mock import MagicMock

    from app.database import get_db
    from app.routes import gcal_keys
    from app.services import gcal_sync

    monkeypatch.setattr(gcal_keys, "_wake_scheduler", lambda: None)
    key_id, appt_ids = _seed_partial_calendar_migration(client)
    old_service = _partial_delete_service()
    monkeypatch.setattr(gcal_sync, "get_service_for_key", lambda row: old_service)
    assert client.put(f"/api/gcal-keys/{key_id}", json={"calendar_id": "new@cal"}).status_code == 409

    old_service.events().delete.side_effect = lambda calendarId, eventId: MagicMock()
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT * FROM appointment_sync_queue WHERE appointment_id=? AND key_id=? AND op_type='D'",
            (appt_ids[2], key_id),
        ).fetchone()
    finally:
        conn.close()
    ok, failed, _ = gcal_sync.sync_pending([dict(row)])
    assert (ok, failed) == (1, 0)
    old_service.events().delete.assert_any_call(calendarId="old@cal", eventId="event-c")

    conn = get_db()
    try:
        key = conn.execute(
            "SELECT calendar_id, pending_calendar_id FROM gcal_keys WHERE id=?", (key_id,)
        ).fetchone()
        assert (key["calendar_id"], key["pending_calendar_id"]) == ("new@cal", None)
        queued = conn.execute(
            "SELECT appointment_id, op_type, google_event_id FROM appointment_sync_queue WHERE key_id=?",
            (key_id,),
        ).fetchall()
        assert {r["appointment_id"] for r in queued} == set(appt_ids)
        assert all(r["op_type"] == "C" and r["google_event_id"] == "" for r in queued)
    finally:
        conn.close()


def test_calendar_migration_pending_persists_across_db_reopen(client):
    """pending_calendar_id 存在 DB 後，重新開啟連線仍可恢復 migration state。"""
    from app.database import get_db

    key_id = client.post("/api/gcal-keys", json={
        "name": "restart-migration-key", "credentials_path": "restart.json", "calendar_id": "old@cal",
    }).json()["id"]
    conn = get_db()
    try:
        conn.execute(
            "UPDATE gcal_keys SET pending_calendar_id=? WHERE id=?", ("new@cal", key_id)
        )
        conn.commit()
    finally:
        conn.close()
    reopened = get_db()
    try:
        row = reopened.execute(
            "SELECT calendar_id, pending_calendar_id FROM gcal_keys WHERE id=?", (key_id,)
        ).fetchone()
        assert (row["calendar_id"], row["pending_calendar_id"]) == ("old@cal", "new@cal")
    finally:
        reopened.close()


def test_same_reminders_are_noop_but_changed_reminders_enqueue(client, monkeypatch):
    """相同 effective reminders 不建 queue；改值才 invalidation。"""
    from app.database import get_db
    from app.routes import gcal_keys

    monkeypatch.setattr(gcal_keys, "_wake_scheduler", lambda: None)
    key_id = client.post("/api/gcal-keys", json={
        "name": "reminder-noop-key", "credentials_path": "reminder.json", "calendar_id": "reminder@cal",
    }).json()["id"]
    conn = get_db()
    try:
        appt_id = conn.execute(
            "INSERT INTO appointments(client_name,date,start_time,end_time) VALUES(?,?,?,?)",
            ("reminder-noop-appt", "2026-08-28", "09:00", "10:00"),
        ).lastrowid
        conn.execute(
            "INSERT INTO appointment_gcal_map(appointment_id,key_id,google_event_id,data_hash) "
            "VALUES(?,?,?,?)", (appt_id, key_id, "reminder-event", "hash"),
        )
        conn.commit()
    finally:
        conn.close()
    reminders = [
        {"method": "popup", "minutes": 1440},
        {"method": "popup", "minutes": 120},
        {"method": "popup", "minutes": 15},
    ]
    first = client.put(f"/api/gcal-keys/{key_id}/reminders", json={"reminders": reminders})
    assert first.status_code == 200 and first.json()["affected"] == 1
    conn = get_db()
    try:
        conn.execute("DELETE FROM appointment_sync_queue WHERE appointment_id=? AND key_id=?", (appt_id, key_id))
        conn.commit()
    finally:
        conn.close()
    same = client.put(f"/api/gcal-keys/{key_id}/reminders", json={"reminders": reminders})
    assert same.status_code == 200 and same.json()["affected"] == 0
    conn = get_db()
    try:
        assert conn.execute(
            "SELECT 1 FROM appointment_sync_queue WHERE appointment_id=? AND key_id=?", (appt_id, key_id)
        ).fetchone() is None
    finally:
        conn.close()
    changed = client.put(f"/api/gcal-keys/{key_id}/reminders", json={"reminders": reminders[:-1] + [{"method": "popup", "minutes": 30}]})
    assert changed.status_code == 200 and changed.json()["affected"] == 1



def test_calendar_change_existing_d_queue_blocks_finalize(client, monkeypatch):
    """舊 Calendar 尚有既有 D retry 時，migration 不得提前切換到 new Calendar。"""
    from unittest.mock import MagicMock

    from app.database import get_db
    from app.routes import gcal_keys
    from app.services import gcal_sync

    monkeypatch.setattr(gcal_keys, "_wake_scheduler", lambda: None)
    key_id = client.post("/api/gcal-keys", json={
        "name": "existing-d-migration-key", "credentials_path": "calendar.json", "calendar_id": "old@cal",
    }).json()["id"]
    conn = get_db()
    try:
        appt_ids = []
        for name, event_id in (("existing-D-A", "event-a"), ("existing-D-B", "event-b")):
            appt_id = conn.execute(
                "INSERT INTO appointments(client_name,date,start_time,end_time) VALUES(?,?,?,?)",
                (name, "2026-08-28", "09:00", "10:00"),
            ).lastrowid
            appt_ids.append(appt_id)
            conn.execute(
                "INSERT INTO appointment_gcal_map(appointment_id,key_id,google_event_id,data_hash) "
                "VALUES(?,?,?,?)", (appt_id, key_id, event_id, "hash"),
            )
        conn.execute(
            "INSERT INTO appointment_sync_queue"
            "(appointment_id,key_id,op_type,google_event_id,last_modified_at,attempts,last_error) "
            "VALUES(?,?, 'D', ?, ?, 3, ?)",
            (999991, key_id, "old-deleted-event", "2026-08-28 09:00:00", "Google API 403"),
        )
        conn.commit()
    finally:
        conn.close()

    service = MagicMock()
    service.events().delete.return_value.execute.return_value = {}
    monkeypatch.setattr(gcal_sync, "get_service_for_key", lambda row: service)

    response = client.put(f"/api/gcal-keys/{key_id}", json={"calendar_id": "new@cal"})

    assert response.status_code == 200
    conn = get_db()
    try:
        key = conn.execute(
            "SELECT calendar_id, pending_calendar_id FROM gcal_keys WHERE id=?", (key_id,)
        ).fetchone()
        assert (key["calendar_id"], key["pending_calendar_id"]) == ("old@cal", "new@cal")
        retry = conn.execute(
            "SELECT op_type, google_event_id FROM appointment_sync_queue "
            "WHERE appointment_id=? AND key_id=?", (999991, key_id),
        ).fetchone()
        assert (retry["op_type"], retry["google_event_id"]) == ("D", "old-deleted-event")
    finally:
        conn.close()



def test_calendar_migration_discards_stale_cu_and_backfills_latest_state(client, monkeypatch):
    """migration 丟棄舊 C/U，finalize 後只依最新 target 建立 queue。"""
    from unittest.mock import MagicMock

    from app.database import get_db
    from app.routes import gcal_keys
    from app.services import gcal_sync

    monkeypatch.setattr(gcal_keys, "_wake_scheduler", lambda: None)
    key_id = client.post("/api/gcal-keys", json={
        "name": "stale-cu-migration-key", "credentials_path": "calendar.json", "calendar_id": "old@cal",
    }).json()["id"]
    conn = get_db()
    try:
        appt_a = conn.execute(
            "INSERT INTO appointments(client_name,date,start_time,end_time) VALUES(?,?,?,?)",
            ("stale-CU-A", "2026-08-28", "09:00", "10:00"),
        ).lastrowid
        appt_b = conn.execute(
            "INSERT INTO appointments(client_name,date,start_time,end_time) VALUES(?,?,?,?)",
            ("stale-CU-B", "2026-08-28", "11:00", "12:00"),
        ).lastrowid
        for appt_id, event_id in ((appt_a, "event-a"), (appt_b, "event-b")):
            conn.execute(
                "INSERT INTO appointment_gcal_map(appointment_id,key_id,google_event_id,data_hash) "
                "VALUES(?,?,?,?)", (appt_id, key_id, event_id, "hash"),
            )
        conn.execute(
            "INSERT INTO appointment_sync_queue"
            "(appointment_id,key_id,op_type,google_event_id,last_modified_at,attempts,last_error) "
            "VALUES(?,?, 'U', ?, ?, 0, '')",
            (appt_a, key_id, "event-a", "2026-08-28 09:00:00"),
        )
        conn.execute(
            "INSERT INTO appointment_sync_queue"
            "(appointment_id,key_id,op_type,google_event_id,last_modified_at,attempts,last_error) "
            "VALUES(?,?, 'C', ?, ?, 0, '')",
            (appt_b, key_id, "", "2026-08-28 09:00:00"),
        )
        conn.commit()
    finally:
        conn.close()

    service = MagicMock()
    service.events().delete.return_value.execute.return_value = {}
    monkeypatch.setattr(gcal_sync, "get_service_for_key", lambda row: service)
    monkeypatch.setattr(
        gcal_sync, "resolve_target_keys",
        lambda conn, appt_id: [key_id] if appt_id == appt_a else [],
    )

    response = client.put(f"/api/gcal-keys/{key_id}", json={"calendar_id": "new@cal"})

    assert response.status_code == 200
    conn = get_db()
    try:
        key = conn.execute(
            "SELECT calendar_id, pending_calendar_id FROM gcal_keys WHERE id=?", (key_id,)
        ).fetchone()
        assert (key["calendar_id"], key["pending_calendar_id"]) == ("new@cal", None)
        rows = conn.execute(
            "SELECT appointment_id, op_type FROM appointment_sync_queue WHERE key_id=?", (key_id,)
        ).fetchall()
        assert [(row["appointment_id"], row["op_type"]) for row in rows] == [(appt_a, "C")]
    finally:
        conn.close()
