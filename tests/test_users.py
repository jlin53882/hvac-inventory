# -*- coding: utf-8 -*-
"""v11 使用者管理 API 測試（僅 admin）"""
import pytest
from app.database import init_db, get_db, DB_PATH
from app.services.auth import hash_password
from main import app as fastapi_app
from fastapi.testclient import TestClient


@pytest.fixture()
def admin_client(tmp_path, monkeypatch):
    """獨立 DB + admin 登入"""
    test_db = tmp_path / "test_users.db"
    monkeypatch.setattr("app.database.DB_PATH", str(test_db))
    init_db()
    from app.services.auth import init_admin_if_missing
    conn = get_db()
    init_admin_if_missing(conn)
    conn.close()
    with TestClient(fastapi_app) as c:
        r = c.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
        assert r.status_code == 200
        yield c


@pytest.fixture()
def user_client(admin_client):
    """admin 新增一個 user 帳號 → 用該帳號登入"""
    admin_client.post("/api/users", json={
        "username": "sarah", "password": "test1234",
        "display_name": "Sarah", "role": "user",
    })
    with TestClient(fastapi_app) as c:
        r = c.post("/api/auth/login", json={"username": "sarah", "password": "test1234"})
        assert r.status_code == 200
        yield c


def test_users_requires_login():
    """未登入 → 401"""
    with TestClient(fastapi_app) as c:
        assert c.get("/api/users").status_code == 401


def test_users_requires_admin(user_client):
    """一般 user → 403"""
    assert user_client.get("/api/users").status_code == 403
    assert user_client.delete("/api/users/1").status_code == 403


def test_admin_can_create_and_list(admin_client):
    r = admin_client.post("/api/users", json={
        "username": "bob", "password": "pass1234",
        "display_name": "Bob", "role": "user",
    })
    assert r.status_code == 201
    assert r.json()["username"] == "bob"

    users = admin_client.get("/api/users").json()["users"]
    assert {u["username"] for u in users} == {"admin", "bob"}
    assert "password_hash" not in users[0]  # 不可洩漏 hash


def test_duplicate_username_409(admin_client):
    admin_client.post("/api/users", json={
        "username": "bob", "password": "pass1234", "display_name": "Bob", "role": "user",
    })
    r = admin_client.post("/api/users", json={
        "username": "bob", "password": "other567", "display_name": "Bob2", "role": "user",
    })
    assert r.status_code == 409
    assert "已存在" in r.json()["detail"]


def test_short_password_400(admin_client):
    r = admin_client.post("/api/users", json={
        "username": "tiny", "password": "12", "display_name": "T", "role": "user",
    })
    assert r.status_code == 400
    assert "至少" in r.json()["detail"]


def test_deactivate_user_blocks_login(admin_client):
    r = admin_client.post("/api/users", json={
        "username": "jane", "password": "pass1234", "display_name": "Jane", "role": "user",
    })
    uid = r.json()["id"]

    # 停用前可登入
    with TestClient(fastapi_app) as c:
        assert c.post("/api/auth/login", json={"username": "jane", "password": "pass1234"}).status_code == 200

    # 停用
    assert admin_client.put(f"/api/users/{uid}", json={"is_active": 0}).status_code == 200

    # 停用後登入 → 403
    with TestClient(fastapi_app) as c:
        assert c.post("/api/auth/login", json={"username": "jane", "password": "pass1234"}).status_code == 403


def test_cannot_delete_self(admin_client):
    me = admin_client.get("/api/auth/me").json()["user"]
    r = admin_client.delete(f"/api/users/{me['id']}")
    assert r.status_code == 400
    assert "不能刪除自己" in r.json()["detail"]


def test_reset_password(admin_client):
    r = admin_client.post("/api/users", json={
        "username": "kate", "password": "pass1234", "display_name": "Kate", "role": "user",
    })
    uid = r.json()["id"]

    assert admin_client.put(f"/api/users/{uid}/password", json={"password": "newpass99"}).status_code == 200

    # 舊密碼失效、新密碼可登入
    with TestClient(fastapi_app) as c:
        assert c.post("/api/auth/login", json={"username": "kate", "password": "pass1234"}).status_code == 401
        assert c.post("/api/auth/login", json={"username": "kate", "password": "newpass99"}).status_code == 200


def test_delete_user(admin_client):
    r = admin_client.post("/api/users", json={
        "username": "gone", "password": "pass1234", "display_name": "G", "role": "user",
    })
    uid = r.json()["id"]
    assert admin_client.delete(f"/api/users/{uid}").status_code == 200

    # 刪除後登入 → 401
    with TestClient(fastapi_app) as c:
        assert c.post("/api/auth/login", json={"username": "gone", "password": "pass1234"}).status_code == 401
