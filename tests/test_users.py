# -*- coding: utf-8 -*-
"""v11 使用者管理 API 測試（僅 admin）"""
import pytest
from app.database import init_db, get_db, DB_PATH
from app.services.auth import IP_FAIL_MAX, hash_password
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
        "username": "sarah", "password": "Test1234",
        "display_name": "Sarah", "role": "user",
    })
    with TestClient(fastapi_app) as c:
        r = c.post("/api/auth/login", json={"username": "sarah", "password": "Test1234"})
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
        "username": "bob", "password": "Pass1234",
        "display_name": "Bob", "role": "user",
    })
    assert r.status_code == 201
    assert r.json()["username"] == "bob"

    users = admin_client.get("/api/users").json()["users"]
    assert {u["username"] for u in users} == {"admin", "bob"}
    assert "password_hash" not in users[0]  # 不可洩漏 hash


def test_duplicate_username_409(admin_client):
    admin_client.post("/api/users", json={
        "username": "bob", "password": "Pass1234", "display_name": "Bob", "role": "user",
    })
    r = admin_client.post("/api/users", json={
        "username": "bob", "password": "Other567", "display_name": "Bob2", "role": "user",
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
        "username": "jane", "password": "Pass1234", "display_name": "Jane", "role": "user",
    })
    uid = r.json()["id"]

    # 停用前可登入
    with TestClient(fastapi_app) as c:
        assert c.post("/api/auth/login", json={"username": "jane", "password": "Pass1234"}).status_code == 200

    # 停用
    assert admin_client.put(f"/api/users/{uid}", json={"is_active": 0}).status_code == 200

    # 停用後登入 → 403
    with TestClient(fastapi_app) as c:
        assert c.post("/api/auth/login", json={"username": "jane", "password": "Pass1234"}).status_code == 403


def test_cannot_delete_self(admin_client):
    me = admin_client.get("/api/auth/me").json()["user"]
    r = admin_client.delete(f"/api/users/{me['id']}")
    assert r.status_code == 400
    assert "不能刪除自己" in r.json()["detail"]


def test_reset_password(admin_client):
    r = admin_client.post("/api/users", json={
        "username": "kate", "password": "Pass1234", "display_name": "Kate", "role": "user",
    })
    uid = r.json()["id"]

    assert admin_client.put(f"/api/users/{uid}/password", json={"password": "Newpass99"}).status_code == 200

    # 舊密碼失效、新密碼可登入
    with TestClient(fastapi_app) as c:
        assert c.post("/api/auth/login", json={"username": "kate", "password": "Pass1234"}).status_code == 401
        assert c.post("/api/auth/login", json={"username": "kate", "password": "Newpass99"}).status_code == 200


def test_delete_user(admin_client):
    r = admin_client.post("/api/users", json={
        "username": "gone", "password": "Pass1234", "display_name": "G", "role": "user",
    })
    uid = r.json()["id"]
    assert admin_client.delete(f"/api/users/{uid}").status_code == 200

    # 刪除後登入 → 401
    with TestClient(fastapi_app) as c:
        assert c.post("/api/auth/login", json={"username": "gone", "password": "Pass1234"}).status_code == 401


# ---------- 批次新增（表格 UI 用） ----------

def test_batch_create_all_ok(admin_client):
    r = admin_client.post("/api/users/batch", json={"users": [
        {"username": "tracy", "password": "View1234", "display_name": "Tracy", "role": "viewer"},
        {"username": "bob", "password": "Pass1234", "display_name": "Bob", "role": "user"},
    ]})
    assert r.status_code == 201
    data = r.json()
    assert data["created"] == 2
    assert data["failed"] == 0
    assert all(x["status"] == "ok" for x in data["results"])

    users = admin_client.get("/api/users").json()["users"]
    names = {u["username"] for u in users}
    assert {"tracy", "bob"} <= names
    tracy = next(u for u in users if u["username"] == "tracy")
    assert tracy["role"] == "viewer"  # 批次建立可指定 viewer


def test_batch_partial_failure_keeps_ok_rows(admin_client):
    """中間夾一筆帳號重複 → 該筆回報失敗，其餘照常建立（不回滾）"""
    admin_client.post("/api/users", json={
        "username": "dup", "password": "Pass1234", "display_name": "D", "role": "user",
    })
    r = admin_client.post("/api/users/batch", json={"users": [
        {"username": "ok1", "password": "Pass1234", "display_name": "OK1", "role": "user"},
        {"username": "dup", "password": "Pass1234", "display_name": "Dup", "role": "user"},
        {"username": "ok2", "password": "Pass1234", "display_name": "OK2", "role": "viewer"},
    ]})
    assert r.status_code == 201
    data = r.json()
    assert data["created"] == 2
    assert data["failed"] == 1
    by_name = {x["username"]: x for x in data["results"]}
    assert by_name["ok1"]["status"] == "ok"
    assert by_name["ok2"]["status"] == "ok"
    assert by_name["dup"]["status"] == "error"
    assert "已存在" in by_name["dup"]["detail"]

    users = admin_client.get("/api/users").json()["users"]
    names = {u["username"] for u in users}
    assert {"ok1", "ok2"} <= names  # 成功的有留下


def test_batch_reports_each_error_reason(admin_client):
    """每筆失敗都帶具體原因（帳號空白 / 密碼太短 / 角色非法）"""
    r = admin_client.post("/api/users/batch", json={"users": [
        {"username": "  ", "password": "Pass1234", "display_name": "X", "role": "user"},
        {"username": "tiny", "password": "12", "display_name": "T", "role": "user"},
        {"username": "badrole", "password": "Pass1234", "display_name": "B", "role": "superuser"},
    ]})
    assert r.status_code == 201
    data = r.json()
    assert data["created"] == 0
    assert data["failed"] == 3
    details = [x["detail"] for x in data["results"]]
    assert any("空白" in d for d in details)
    assert any("至少" in d for d in details)
    assert any("角色" in d for d in details)


def test_batch_requires_admin(user_client):
    """一般 user 不能批次新增"""
    assert user_client.post("/api/users/batch", json={"users": []}).status_code == 403


def test_batch_empty_list(admin_client):
    r = admin_client.post("/api/users/batch", json={"users": []})
    assert r.status_code == 201
    assert r.json()["created"] == 0
    assert r.json()["failed"] == 0


# ---------- viewer 角色建立 ----------

def test_admin_can_create_viewer(admin_client):
    r = admin_client.post("/api/users", json={
        "username": "view1", "password": "View1234",
        "display_name": "檢視者一", "role": "viewer",
    })
    assert r.status_code == 201
    assert r.json()["role"] == "viewer"

    # viewer 帳號可正常登入
    with TestClient(fastapi_app) as c:
        resp = c.post("/api/auth/login", json={"username": "view1", "password": "View1234"})
        assert resp.status_code == 200
        assert resp.json()["user"]["role"] == "viewer"


def test_invalid_role_rejected(admin_client):
    r = admin_client.post("/api/users", json={
        "username": "bad", "password": "Pass1234", "display_name": "B", "role": "superuser",
    })
    assert r.status_code == 400
    assert "角色" in r.json()["detail"]
        assert c.post("/api/auth/login", json={"username": "gone", "password": "Pass1234"}).status_code == 401


# ========== B2：密碼 policy（至少 8 碼 + 大寫 + 小寫 + 數字） ==========

def test_password_policy_requires_uppercase(admin_client):
    """無大寫字母 → 400"""
    r = admin_client.post("/api/users", json={
        "username": "noup", "password": "lowercase123", "display_name": "N", "role": "user",
    })
    assert r.status_code == 400
    assert "大寫" in r.json()["detail"]


def test_password_policy_requires_lowercase(admin_client):
    """無小寫字母 → 400"""
    r = admin_client.post("/api/users", json={
        "username": "nolow", "password": "UPPERCASE123", "display_name": "N", "role": "user",
    })
    assert r.status_code == 400
    assert "小寫" in r.json()["detail"]


def test_password_policy_requires_digit(admin_client):
    """無數字 → 400"""
    r = admin_client.post("/api/users", json={
        "username": "nodig", "password": "NoDigitsHere", "display_name": "N", "role": "user",
    })
    assert r.status_code == 400
    assert "數字" in r.json()["detail"]


def test_password_policy_short_8(admin_client):
    """7 碼即使含大小寫數字 → 400"""
    r = admin_client.post("/api/users", json={
        "username": "short7", "password": "Abc1234", "display_name": "S", "role": "user",
    })
    assert r.status_code == 400
    assert "至少 8 碼" in r.json()["detail"]


def test_password_policy_ok(admin_client):
    """符合 policy（8碼+大寫+小寫+數字）→ 201"""
    r = admin_client.post("/api/users", json={
        "username": "good", "password": "GoodPass1", "display_name": "G", "role": "user",
    })
    assert r.status_code == 201


# ========== B3：改密碼 / 停用後舊 session 立即失效 ==========

def test_deactivate_clears_existing_sessions(admin_client):
    """停用帳號 → 該帳號已登入的 session 立即失效（再訪問 API → 401）"""
    r = admin_client.post("/api/users", json={
        "username": "sess1", "password": "Sess1234", "display_name": "S1", "role": "user",
    })
    uid = r.json()["id"]

    with TestClient(fastapi_app) as c:
        lr = c.post("/api/auth/login", json={"username": "sess1", "password": "Sess1234"})
        assert lr.status_code == 200
        assert c.get("/api/items").status_code == 200  # 停用前 session 有效
        # 停用 → 舊 session 立即失效
        assert admin_client.put(f"/api/users/{uid}", json={"is_active": 0}).status_code == 200
        assert c.get("/api/items").status_code == 401


def test_reset_password_clears_existing_sessions(admin_client):
    """重設密碼 → 該帳號舊 session 立即失效"""
    r = admin_client.post("/api/users", json={
        "username": "sess2", "password": "Sess1234", "display_name": "S2", "role": "user",
    })
    uid = r.json()["id"]

    with TestClient(fastapi_app) as c:
        assert c.post("/api/auth/login", json={"username": "sess2", "password": "Sess1234"}).status_code == 200
        assert c.get("/api/items").status_code == 200  # session 有效
        # admin 重設密碼 → 舊 session 清除
        assert admin_client.put(f"/api/users/{uid}/password", json={"password": "NewSess99"}).status_code == 200
        assert c.get("/api/items").status_code == 401  # 舊 session 失效


# ========== B4：per-IP 登入失敗 rate limit ==========

def test_login_rate_limit_after_many_failures():
    """同一 IP 短時間大量失敗登入 → 429（最後用成功登入清空記錄，避免污染其他測試）"""
    from app.services.auth import clear_ip_fail
    try:
        with TestClient(fastapi_app) as c:
            codes = []
            for _ in range(IP_FAIL_MAX + 2):
                r = c.post("/api/auth/login", json={"username": "admin", "password": "wrong!"})
                codes.append(r.status_code)
            assert 429 in codes, f"應該出現 429，實際: {codes}"
    finally:
        clear_ip_fail("testclient")
