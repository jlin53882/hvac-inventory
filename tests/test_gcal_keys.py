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
    """B3 防回歸：key 改名後，使用者綁定的舊 name 懸空（不崩潰）"""
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
    # 使用者的 gcal_key 仍是舊名（懸空但不崩潰）
    r2 = client.get("/api/users")
    user = [u for u in r2.json()["users"] if u["id"] == uid][0]
    assert user["gcal_key"] == "廠商X"  # 舊名仍保留（Phase 1 同步時需處理）


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


# ========== 強制同步 API 測試 ==========

def test_force_sync_now(client):
    """POST /api/gcal-sync-now 立即同步"""
    r = client.post("/api/gcal-sync-now")
    assert r.status_code == 200
    assert r.json()["ok"] is True


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

    def test_delete_key_still_works_if_google_fails(self, client, monkeypatch):
        """Google API 失敗時，key 仍被刪除（不阻斷）"""
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
        assert r.status_code == 200
        data = r.json()
        assert data["ok"] is True
        assert data["google_failed"] == 1  # 事件刪除失敗

        # Key 仍被刪除
        conn = get_db()
        try:
            assert conn.execute("SELECT id FROM gcal_keys WHERE id=?", (key_id,)).fetchone() is None
        finally:
            conn.close()
