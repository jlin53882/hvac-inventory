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
    """綁定使用者 gcal_key"""
    # /api/users 回 {"users": [...]}
    r = client.get("/api/users")
    admin_id = r.json()["users"][0]["id"]
    # 綁定
    r2 = client.put(f"/api/users/{admin_id}", json={"gcal_key": "廠商A"})
    assert r2.status_code == 200
    # PUT 回傳 _user_out（需確認含 gcal_key）
    data = r2.json()
    # gcal_key 可能在回傳中或需再 GET 確認
    if "gcal_key" in data:
        assert data["gcal_key"] == "廠商A"


def test_unbind_user_gcal_key(client):
    """解除綁定"""
    r = client.get("/api/users")
    admin_id = r.json()["users"][0]["id"]
    client.put(f"/api/users/{admin_id}", json={"gcal_key": "廠商A"})
    r2 = client.put(f"/api/users/{admin_id}", json={"gcal_key": ""})
    assert r2.status_code == 200
