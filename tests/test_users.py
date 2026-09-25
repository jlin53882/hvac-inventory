# -*- coding: utf-8 -*-
"""v11 使用者管理 API 測試（僅 admin）"""
import pytest
import os
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
    # A②（2026-08-14）：session 注入取代 POST login（登入/暴力破解測試保留真實登入）
    from app.services.auth import SESSION_COOKIE, create_session, init_admin_if_missing
    conn = get_db()
    init_admin_if_missing(conn)
    _admin_id = conn.execute("SELECT id FROM users WHERE username='admin'").fetchone()["id"]
    _token = create_session(conn, _admin_id)
    conn.close()
    with TestClient(fastapi_app) as c:
        c.cookies.set(SESSION_COOKIE, _token)
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


@pytest.fixture()
def tech_client(admin_client):
    """tech 角色（2026-08-13 Sarah：藍政達「行事曆可寫、其他唯讀」）"""
    admin_client.post("/api/users", json={
        "username": "techuser", "password": "Test1234",
        "display_name": "工程師", "role": "tech",
    })
    with TestClient(fastapi_app) as c:
        r = c.post("/api/auth/login", json={"username": "techuser", "password": "Test1234"})
        assert r.status_code == 200
        yield c


def test_tech_calendar_writable_other_readonly(tech_client):
    """tech：行事曆可寫（新增/編輯/刪除派工）、庫存等寫入 403、GET 可看"""
    # 行事曆可寫：新增派工 200
    r = tech_client.post("/api/appointments", json={
        "client_name": "tech測試", "address": "", "service_type_id": 1,
        "date": "2026-08-14", "start_time": "10:00", "end_time": "10:00",
        "note": "", "user_ids": [1],
    })
    assert r.status_code == 200, r.text
    appt_id = r.json()["id"]
    # 編輯派工 200
    r = tech_client.put(f"/api/appointments/{appt_id}", json={
        "client_name": "tech測試改", "address": "", "service_type_id": 1,
        "date": "2026-08-14", "start_time": "11:00", "end_time": "11:00",
        "note": "", "user_ids": [1],
    })
    assert r.status_code == 200, r.text
    # 刪除派工 200
    assert tech_client.delete(f"/api/appointments/{appt_id}").status_code == 200
    # 庫存寫入 403（品項新增）
    assert tech_client.post("/api/items", json={"brand": "X", "name": "Y", "unit": "個", "qty": 1}).status_code == 403
    # 其他寫入 403（出庫/盤點/整組）
    assert tech_client.post("/api/stockout", json={}).status_code == 403
    assert tech_client.post("/api/stocktake", json={}).status_code == 403
    assert tech_client.post("/api/kits", json={}).status_code == 403
    # GET 可看
    assert tech_client.get("/api/items?site=office").status_code == 200
    assert tech_client.get("/api/appointments?year=2026&month=8").status_code == 200


def test_users_requires_login(tmp_path, monkeypatch):
    """未登入 → 401（tmp DB 隔離，不碰正式 inventory.db）"""
    test_db = tmp_path / "test_users_noauth.db"
    monkeypatch.setattr("app.database.DB_PATH", str(test_db))
    with TestClient(fastapi_app) as c:
        assert c.get("/api/users").status_code == 401

def test_users_requires_login_does_not_touch_real_db(tmp_path, monkeypatch):
    """v4 pro 審查補測 #3：防回歸——本測試不碰正式 inventory.db
    （monkeypatch DB_PATH 後 lifespan 打在 tmp DB，正式 DB 檔案不變）"""
    import app.config as cfg
    real_db = cfg.DB_PATH
    stat_before = (os.path.getsize(real_db), os.path.getmtime(real_db)) if os.path.exists(real_db) else None
    test_db = tmp_path / "test_users_noauth.db"
    monkeypatch.setattr("app.database.DB_PATH", str(test_db))
    with TestClient(fastapi_app) as c:
        assert c.get("/api/users").status_code == 401
    # 正式 DB 檔案未被修改（lifespan 的 init_db 打在 tmp DB）
    stat_after = (os.path.getsize(real_db), os.path.getmtime(real_db)) if os.path.exists(real_db) else None
    assert stat_before == stat_after, "測試碰觸了正式 inventory.db！"
    # tmp DB 被 lifespan 初始化（證明隔離有效）
    import sqlite3
    conn = sqlite3.connect(str(test_db))
    try:
        n = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    finally:
        conn.close()
    assert n >= 1


def test_users_requires_admin(user_client):
    """一般 user → 403"""
    assert user_client.get("/api/users").status_code == 403
    assert user_client.delete("/api/users/1").status_code == 403


def test_admin_can_create_and_list(admin_client):
    """驗證 admin 可建立並列出使用者"""
    r = admin_client.post("/api/users", json={
        "username": "bob", "password": "Pass1234",
        "display_name": "Bob", "role": "user",
    })
    assert r.status_code == 201
    assert r.json()["username"] == "bob"

    users = admin_client.get("/api/users").json()["users"]
    assert {u["username"] for u in users} == {"admin", "bob"}
    assert "password_hash" not in users[0]  # 不可洩漏 hash


def test_admin_can_edit_display_name_and_role_and_read_back(admin_client):
    """Account role/display name edits must persist and be readable back."""
    created = admin_client.post("/api/users", json={
        "username": "editable", "password": "Pass1234",
        "display_name": "Original", "role": "user",
    })
    uid = created.json()["id"]

    updated = admin_client.put(f"/api/users/{uid}", json={
        "display_name": "Renamed", "role": "tech",
    })
    assert updated.status_code == 200
    assert updated.json()["display_name"] == "Renamed"
    assert updated.json()["role"] == "tech"

    listed = admin_client.get("/api/users").json()["users"]
    edited = next(user for user in listed if user["id"] == uid)
    assert edited["display_name"] == "Renamed"
    assert edited["role"] == "tech"

    audit = admin_client.get(f"/api/users/audit?target_id={uid}").json()
    assert any(row["action"] == "role_change" for row in audit["logs"])

def test_edit_user_rejects_invalid_role_and_preserves_existing_values(admin_client):
    """An invalid role must not partially write the display name."""
    created = admin_client.post("/api/users", json={
        "username": "invalid-edit", "password": "Pass1234",
        "display_name": "Keep Me", "role": "user",
    })
    uid = created.json()["id"]

    response = admin_client.put(f"/api/users/{uid}", json={
        "display_name": "Must Not Write", "role": "superuser",
    })
    assert response.status_code == 400

    listed = admin_client.get("/api/users").json()["users"]
    current = next(user for user in listed if user["id"] == uid)
    assert current["display_name"] == "Keep Me"
    assert current["role"] == "user"

def test_edit_user_rejects_overlong_display_name(admin_client):
    """Display name length is bounded before the update transaction runs."""
    created = admin_client.post("/api/users", json={
        "username": "long-edit", "password": "Pass1234",
        "display_name": "Valid", "role": "user",
    })
    uid = created.json()["id"]
    response = admin_client.put(f"/api/users/{uid}", json={
        "display_name": "x" * 101, "role": "tech",
    })
    assert response.status_code == 422

def test_duplicate_username_409(admin_client):
    """驗證重複帳號建立回傳 409"""
    admin_client.post("/api/users", json={
        "username": "bob", "password": "Pass1234", "display_name": "Bob", "role": "user",
    })
    r = admin_client.post("/api/users", json={
        "username": "bob", "password": "Other567", "display_name": "Bob2", "role": "user",
    })
    assert r.status_code == 409
    assert "已存在" in r.json()["detail"]


def test_short_password_400(admin_client):
    """驗證密碼過短回傳 400"""
    r = admin_client.post("/api/users", json={
        "username": "tiny", "password": "12", "display_name": "T", "role": "user",
    })
    assert r.status_code == 400
    assert "至少" in r.json()["detail"]


def test_deactivate_user_blocks_login(admin_client):
    """驗證停用帳號無法登入"""
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
    """驗證不能刪除自己"""
    me = admin_client.get("/api/auth/me").json()["user"]
    r = admin_client.delete(f"/api/users/{me['id']}")
    assert r.status_code == 400
    assert "不能刪除自己" in r.json()["detail"]


def test_reset_password(admin_client):
    """驗證重設密碼流程"""
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
    """驗證刪除使用者"""
    r = admin_client.post("/api/users", json={
        "username": "gone", "password": "Pass1234", "display_name": "G", "role": "user",
    })
    uid = r.json()["id"]
    assert admin_client.delete(f"/api/users/{uid}").status_code == 200

    # 刪除後登入 → 401
    with TestClient(fastapi_app) as c:
        assert c.post("/api/auth/login", json={"username": "gone", "password": "Pass1234"}).status_code == 401


def test_delete_user_with_appointments_blocked(admin_client):
    """A1（2026-08-13）：刪除「當過派工新增者/被指派者」的帳號 → 400 提示，不 500"""
    r = admin_client.post("/api/users", json={
        "username": "techdel", "password": "Pass1234", "display_name": "TD", "role": "tech",
    })
    uid = r.json()["id"]
    # 指派該帳號到一筆派工
    r = admin_client.post("/api/appointments", json={
        "client_name": "A1測試", "address": "", "service_type_id": 1,
        "date": "2026-08-20", "start_time": "10:00", "end_time": "10:00",
        "note": "", "user_ids": [uid],
    })
    assert r.status_code == 200, r.text
    # 刪除 → 400（有派工紀錄）
    r = admin_client.delete(f"/api/users/{uid}")
    assert r.status_code == 400
    assert "派工紀錄" in r.text
    # 該帳號仍存在（未被刪除）
    lst = admin_client.get("/api/users").json()
    users = lst if isinstance(lst, list) else lst.get("users", [])
    assert any(u["id"] == uid for u in users)


def test_ack_password_expiry_admin_only(admin_client):
    """B4（2026-08-13）：只有 admin 可 ack 密碼過期；user/viewer/tech → 403"""
    # 建一個 user 帳號登入試 ack
    admin_client.post("/api/users", json={
        "username": "ackuser", "password": "Test1234", "display_name": "AU", "role": "user"})
    with TestClient(fastapi_app) as c:
        assert c.post("/api/auth/login", json={"username": "ackuser", "password": "Test1234"}).status_code == 200
        assert c.post("/api/auth/password-ack").status_code == 200
    # admin 可 ack
    assert admin_client.post("/api/auth/password-ack").status_code == 200


# ---------- 批次新增（表格 UI 用） ----------

def test_batch_create_all_ok(admin_client):
    """驗證批次建立使用者全部成功"""
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
    """驗證批次空清單的處理行為"""
    r = admin_client.post("/api/users/batch", json={"users": []})
    assert r.status_code == 201
    assert r.json()["created"] == 0
    assert r.json()["failed"] == 0


# ---------- viewer 角色建立 ----------

def test_admin_can_create_viewer(admin_client):
    """驗證 admin 可建立 viewer 角色帳號"""
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
    """驗證非法角色被拒絕"""
    r = admin_client.post("/api/users", json={
        "username": "bad", "password": "Pass1234", "display_name": "B", "role": "superuser",
    })
    assert r.status_code == 400
    assert "角色" in r.json()["detail"]


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

def test_login_rate_limit_after_many_failures(admin_client):
    """同一 IP 短時間大量失敗登入 → 429（2026-08-11 改用 tmp DB fixture——原版直連正式 DB，會把正式 admin 鎖 15 分鐘）"""
    from app.services.auth import clear_ip_fail
    try:
        codes = []
        for _ in range(IP_FAIL_MAX + 2):
            r = admin_client.post("/api/auth/login", json={"username": "admin", "password": "wrong!"})
            codes.append(r.status_code)
        assert 429 in codes, f"應該出現 429，實際: {codes}"
    finally:
        clear_ip_fail("testclient")

# ========== H3a / H3b（2026-08-11 Phase 2a）：dummy PBKDF2 + XFF rate limit ==========

def test_login_unknown_user_runs_dummy_hash(admin_client, monkeypatch):
    """H3a：帳號不存在也跑 PBKDF2（防 timing 列舉）——verify_password 應被呼叫"""
    import app.services.auth as svc
    calls = []
    orig = svc.verify_password

    def spy(pw, stored):
        calls.append(pw)
        return orig(pw, stored)

    monkeypatch.setattr(svc, "verify_password", spy)
    r = admin_client.post("/api/auth/login",
                          json={"username": "no_such_user_xyz", "password": "Pass1234"})
    assert r.status_code == 401
    assert len(calls) == 1  # dummy hash 有跑 verify（與真實帳號路徑同成本）


def test_login_unknown_user_counts_rate_limit(admin_client):
    """H3a/H3b：不存在帳號也計 rate limit；非信任來源的 XFF 不採信（2026-08-11 信任邊界修正）"""
    from app.services.auth import clear_ip_fail
    try:
        codes = []
        # 換不同假 XFF 也繞不過：一律以直連 IP（testclient）計數
        for i in range(IP_FAIL_MAX + 2):
            r = admin_client.post("/api/auth/login",
                                  json={"username": "no_such_user_xyz", "password": "Pass1234"},
                                  headers={"X-Forwarded-For": f"203.0.113.{i + 10}"})
            codes.append(r.status_code)
        assert 429 in codes, f"應該出現 429（直連 IP 計數），實際: {codes}"
    finally:
        clear_ip_fail("testclient")


def test_login_rate_limit_xff_spoof_cannot_bypass(admin_client):
    """2026-08-11 信任邊界修正：非信任來源偽造不同 XFF 無法分開計數（防繞過 per-IP rate limit）"""
    from app.services.auth import clear_ip_fail
    ips = ("203.0.113.1", "203.0.113.2")
    try:
        codes = []
        for i in range(IP_FAIL_MAX + 2):  # 12 次失敗，輪流換假 XFF 也繞不過（共享直連 IP 計數）
            r = admin_client.post("/api/auth/login",
                                  json={"username": "no_such_user_xyz", "password": "Pass1234"},
                                  headers={"X-Forwarded-For": ips[i % 2]})
            codes.append(r.status_code)
        assert 429 in codes, f"偽造 XFF 應無法繞過（共享直連 IP 計數），實際: {codes}"
    finally:
        clear_ip_fail("testclient")


def test_client_ip_trust_boundary():
    """2026-08-11：_client_ip 信任邊界——非白名單來源忽略 XFF；127.0.0.1（cloudflared）才採信"""
    from starlette.requests import Request
    from app.routes.auth import _client_ip

    def _req(client_host: str, xff: str | None = None) -> Request:
        headers = []
        if xff:
            headers.append((b"x-forwarded-for", xff.encode()))
        return Request({
            "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
            "method": "POST", "scheme": "http", "path": "/api/auth/login",
            "raw_path": b"/api/auth/login", "query_string": b"",
            "root_path": "", "headers": headers,
            "client": (client_host, 1234), "server": ("test", 80),
        })

    # 非信任來源（LAN 直連）帶假 XFF → 採直連 IP，XFF 被忽略
    assert _client_ip(_req("10.0.0.5", "203.0.113.9")) == "10.0.0.5"
    # 信任來源（本機 cloudflared）帶 XFF → 採信第一段
    assert _client_ip(_req("127.0.0.1", "203.0.113.9, 10.0.0.1")) == "203.0.113.9"
    # 無 XFF → 直連 IP
    assert _client_ip(_req("127.0.0.1")) == "127.0.0.1"

# ========== Phase 2b（2026-08-11）：個人改密碼 + 6 個月過期提示 ==========
# 2026-08-13 Sarah：user 角色不可自行改密碼（403）——流程邏輯改用 admin 驗證（admin 仍可改）

def test_user_can_change_own_password(user_client):
    """user 角色現在有 change-own-password → 可改自己密碼"""
    r = user_client.put("/api/auth/password",
                        json={"old_password": "Test1234", "new_password": "NewPass123"})
    assert r.status_code == 200


def test_change_password_kills_other_sessions_keeps_current(admin_client):
    """改密碼後：其他 session 失效、當前 session 保留（admin 流程）"""
    with TestClient(fastapi_app) as c2:
        assert c2.post("/api/auth/login", json={"username": "admin", "password": "admin123"}).status_code == 200
        r = admin_client.put("/api/auth/password",
                             json={"old_password": "admin123", "new_password": "NewPass123"})
        assert r.status_code == 200
        assert c2.get("/api/auth/me").status_code == 401   # 其他 session 失效
        assert admin_client.get("/api/auth/me").status_code == 200  # 當前保留


def test_change_password_wrong_old_400(admin_client):
    """舊密碼錯誤 → 400（admin 流程）"""
    r = admin_client.put("/api/auth/password",
                         json={"old_password": "WrongOld1", "new_password": "NewPass123"})
    assert r.status_code == 400
    assert "原密碼錯誤" in r.json()["detail"]


def test_change_password_policy_400(admin_client):
    """新密碼不合 policy（太短）→ 400（admin 流程）"""
    r = admin_client.put("/api/auth/password",
                         json={"old_password": "WrongOld1", "new_password": "short"})
    assert r.status_code == 400


def test_change_password_same_400(admin_client):
    """新密碼與原密碼相同 → 400（admin 流程）"""
    r = admin_client.put("/api/auth/password",
                         json={"old_password": "admin123", "new_password": "admin123"})
    assert r.status_code == 400
    assert "不能與原密碼相同" in r.json()["detail"]


def test_change_own_password_success(admin_client):
    """改密碼成功 → 舊密碼登入失敗、新密碼登入成功（admin 流程）"""
    r = admin_client.put("/api/auth/password",
                         json={"old_password": "admin123", "new_password": "FinalPass456"})
    assert r.status_code == 200
    with TestClient(fastapi_app) as c:
        assert c.post("/api/auth/login", json={"username": "admin", "password": "admin123"}).status_code == 401
        assert c.post("/api/auth/login", json={"username": "admin", "password": "FinalPass456"}).status_code == 200


def test_viewer_can_change_own_password(admin_client):
    """viewer 角色現在有 change-own-password → 可改自己密碼"""
    admin_client.post("/api/users", json={
        "username": "viewer_pw2", "password": "View1234", "display_name": "檢視者", "role": "viewer"})
    with TestClient(fastapi_app) as c:
        assert c.post("/api/auth/login", json={"username": "viewer_pw2", "password": "View1234"}).status_code == 200
        r = c.put("/api/auth/password", json={"old_password": "View1234", "new_password": "NewView123"})
        assert r.status_code == 200


def test_me_password_expired_flag(admin_client):
    """password_updated_at 超過 180 天 → me 回傳 password_expired=true"""
    conn = get_db()
    try:
        conn.execute("UPDATE users SET password_updated_at = datetime('now', '-190 days') WHERE username = 'admin'")
        conn.commit()
    finally:
        conn.close()
    r = admin_client.get("/api/auth/me")
    assert r.status_code == 200
    assert r.json()["user"]["password_expired"] is True


def test_password_ack_resets_180(admin_client):
    """按「繼續使用原密碼」→ ack → password_expired 歸 false（重置 180 天）"""
    conn = get_db()
    try:
        conn.execute("UPDATE users SET password_updated_at = datetime('now', '-190 days') WHERE username = 'admin'")
        conn.commit()
    finally:
        conn.close()
    assert admin_client.get("/api/auth/me").json()["user"]["password_expired"] is True
    r = admin_client.post("/api/auth/password-ack")
    assert r.status_code == 200
    assert r.json()["password_expired"] is False
    assert admin_client.get("/api/auth/me").json()["user"]["password_expired"] is False




def test_f9_reenable_user_backfills_only_missing_assigned_appointment(admin_client, monkeypatch):
    from app.database import get_db
    from app.services import sync_scheduler
    sync_scheduler.stop(); monkeypatch.setattr(sync_scheduler,'start',lambda:None); monkeypatch.setattr(sync_scheduler,'wake',lambda:None)
    user = admin_client.post('/api/users',json={'username':'f9-reenable','password':'Pass1234','display_name':'F9','role':'user'}).json()
    conn=get_db()
    try:
        key_id=conn.execute("INSERT INTO gcal_keys(name,credentials_path,calendar_id) VALUES('f9-reenable-key','x.json','f9-reenable@cal')").lastrowid
        conn.execute("UPDATE users SET gcal_key=?,is_active=0 WHERE id=?",('f9-reenable-key',user['id']))
        conn.commit()
    finally: conn.close()
    appt=admin_client.post('/api/appointments',json={'client_name':'f9 reenable','date':'2026-09-06','start_time':'09:00','end_time':'10:00','user_ids':[]}).json()['id']
    conn=get_db()
    try:
        conn.execute('INSERT INTO appointment_assignees(appointment_id,user_id) VALUES(?,?)',(appt,user['id']))
        conn.execute('DELETE FROM appointment_sync_queue')
        conn.commit()
    finally: conn.close()
    assert admin_client.put(f'/api/users/{user["id"]}',json={'is_active':1}).status_code==200
    conn=get_db()
    try: assert conn.execute('SELECT op_type FROM appointment_sync_queue WHERE appointment_id=? AND key_id=?',(appt,key_id)).fetchone()['op_type']=='C'
    finally: conn.close()


def test_f9_reenable_user_skips_pending_migration(admin_client, monkeypatch):
    from app.database import get_db
    from app.services import sync_scheduler
    sync_scheduler.stop(); monkeypatch.setattr(sync_scheduler,'start',lambda:None); monkeypatch.setattr(sync_scheduler,'wake',lambda:None)
    user=admin_client.post('/api/users',json={'username':'f9-pending','password':'Pass1234','display_name':'F9 pending','role':'user'}).json()
    conn=get_db()
    try:
        key_id=conn.execute("INSERT INTO gcal_keys(name,credentials_path,calendar_id,pending_calendar_id) VALUES('f9-pending-key','x.json','old@cal','new@cal')").lastrowid
        conn.execute("UPDATE users SET gcal_key=?,is_active=0 WHERE id=?",('f9-pending-key',user['id']))
        conn.commit()
    finally: conn.close()
    appt=admin_client.post('/api/appointments',json={'client_name':'f9 pending','date':'2026-09-06','start_time':'11:00','end_time':'12:00','user_ids':[]}).json()['id']
    conn=get_db()
    try:
        conn.execute('INSERT INTO appointment_assignees(appointment_id,user_id) VALUES(?,?)',(appt,user['id']))
        conn.execute('DELETE FROM appointment_sync_queue'); conn.commit()
    finally: conn.close()
    assert admin_client.put(f'/api/users/{user["id"]}',json={'is_active':1}).status_code==200
    conn=get_db()
    try: assert conn.execute('SELECT 1 FROM appointment_sync_queue WHERE key_id=?',(key_id,)).fetchone() is None
    finally: conn.close()


def test_f11_reenable_and_key_change_runs_combined_transition(admin_client, monkeypatch):
    from app.database import get_db
    from app.services import sync_scheduler
    sync_scheduler.stop()
    monkeypatch.setattr(sync_scheduler, "start", lambda: None)
    monkeypatch.setattr(sync_scheduler, "wake", lambda: None)
    user = admin_client.post("/api/users", json={"username":"f11-combined","password":"Test1234","display_name":"F11","role":"user"}).json()
    conn = get_db()
    try:
        old_key = conn.execute("INSERT INTO gcal_keys(name,credentials_path,calendar_id) VALUES('f11-old','x.json','old@cal')").lastrowid
        new_key = conn.execute("INSERT INTO gcal_keys(name,credentials_path,calendar_id) VALUES('f11-new','x.json','new@cal')").lastrowid
        conn.execute("UPDATE users SET is_active=0,gcal_key='f11-old' WHERE id=?", (user["id"],))
        appt = conn.execute("INSERT INTO appointments(client_name,date,start_time,end_time) VALUES('F11','2026-09-22','09:00','10:00')").lastrowid
        conn.execute("INSERT INTO appointment_assignees(appointment_id,user_id) VALUES(?,?)", (appt,user["id"]))
        conn.execute("INSERT INTO appointment_gcal_map(appointment_id,key_id,google_event_id,data_hash) VALUES(?,?,?,?)", (appt,old_key,"old-event","old-hash"))
        conn.commit()
    finally:
        conn.close()
    response = admin_client.put(f"/api/users/{user['id']}", json={"is_active":True,"gcal_key":"f11-new"})
    assert response.status_code == 200, response.text
    conn = get_db()
    try:
        rows = conn.execute("SELECT key_id,op_type,google_event_id FROM appointment_sync_queue WHERE appointment_id=? ORDER BY key_id", (appt,)).fetchall()
        assert {(row["key_id"],row["op_type"]) for row in rows} == {(old_key,"D"),(new_key,"U")}
        assert next(row["google_event_id"] for row in rows if row["key_id"]==old_key) == "old-event"
    finally:
        conn.close()


def test_f11_key_change_keeps_shared_old_key_relationship(admin_client, monkeypatch):
    from app.database import get_db
    from app.services import sync_scheduler
    sync_scheduler.stop()
    monkeypatch.setattr(sync_scheduler, "start", lambda: None)
    monkeypatch.setattr(sync_scheduler, "wake", lambda: None)
    user_b = admin_client.post("/api/users", json={"username":"f11-shared-b","password":"Test1234","display_name":"B","role":"user"}).json()
    user_a = admin_client.post("/api/users", json={"username":"f11-shared-a","password":"Test1234","display_name":"A","role":"user"}).json()
    conn = get_db()
    try:
        old_key = conn.execute("INSERT INTO gcal_keys(name,credentials_path,calendar_id) VALUES('f11-shared-old','x.json','old@cal')").lastrowid
        conn.execute("INSERT INTO gcal_keys(name,credentials_path,calendar_id) VALUES('f11-shared-new','x.json','new@cal')")
        conn.execute("UPDATE users SET gcal_key='f11-shared-old' WHERE id IN (?,?)", (user_a["id"],user_b["id"]))
        appt = conn.execute("INSERT INTO appointments(client_name,date,start_time,end_time) VALUES('F11 shared','2026-09-23','09:00','10:00')").lastrowid
        for uid in (user_a["id"],user_b["id"]): conn.execute("INSERT INTO appointment_assignees(appointment_id,user_id) VALUES(?,?)", (appt,uid))
        conn.execute("INSERT INTO appointment_gcal_map(appointment_id,key_id,google_event_id,data_hash) VALUES(?,?,?,?)", (appt,old_key,"shared-event","hash"))
        conn.commit()
    finally:
        conn.close()
    assert admin_client.put(f"/api/users/{user_b['id']}", json={"gcal_key":"f11-shared-new"}).status_code == 200
    conn = get_db()
    try:
        row = conn.execute("SELECT op_type FROM appointment_sync_queue WHERE appointment_id=? AND key_id=?", (appt,old_key)).fetchone()
        assert row is None or row["op_type"] != "D"
    finally:
        conn.close()


# ========== 2026-09 時區修正：帳號鎖定/session 到期一律以 UTC 比較 ==========

class _TaipeiClockDatetime:
    """模擬台灣主機：naive now() 回傳 UTC+8 本地時間；帶 tz 時照常。"""
    import datetime as _dt

    @classmethod
    def now(cls, tz=None):
        real = cls._dt.datetime.now(cls._dt.timezone.utc)
        if tz is None:
            return (real + cls._dt.timedelta(hours=8)).replace(tzinfo=None)
        return real.astimezone(tz)


def test_account_lock_effective_on_taipei_clock(admin_client, monkeypatch):
    """連錯 MAX_FAILED 次後，即使主機時鐘為 UTC+8，正確密碼也應回 429（鎖定生效）。"""
    import app.services.auth as svc
    from app.services.auth import MAX_FAILED, clear_ip_fail
    monkeypatch.setattr(svc, "datetime", type("TaipeiDatetime", (_TaipeiClockDatetime,), {}))
    admin_client.post("/api/users", json={
        "username": "lockme", "password": "Lock1234", "display_name": "L", "role": "user",
    })
    try:
        with TestClient(fastapi_app) as c:
            for _ in range(MAX_FAILED):
                clear_ip_fail("testclient")
                assert c.post("/api/auth/login", json={"username": "lockme", "password": "Wrong999"}).status_code == 401
            clear_ip_fail("testclient")
            r = c.post("/api/auth/login", json={"username": "lockme", "password": "Lock1234"})
            assert r.status_code == 429, r.text
    finally:
        clear_ip_fail("testclient")


def test_session_expiry_stored_in_utc(admin_client, monkeypatch):
    """sessions.expires_at 以 UTC 寫入，與 datetime('now') 比較時有效期恰為 SESSION_DAYS。"""
    import app.services.auth as svc
    from app.services.auth import SESSION_DAYS, create_session
    monkeypatch.setattr(svc, "datetime", type("TaipeiDatetime", (_TaipeiClockDatetime,), {}))
    conn = get_db()
    try:
        uid = conn.execute("SELECT id FROM users WHERE username='admin'").fetchone()["id"]
        token = create_session(conn, uid)
        from app.services.auth import hash_token
        drift = conn.execute(
            "SELECT ABS(strftime('%s', expires_at) - strftime('%s', datetime('now', ?))) AS d "
            "FROM sessions WHERE token_hash=?",
            (f"+{SESSION_DAYS} days", hash_token(token)),
        ).fetchone()["d"]
        assert drift < 120
    finally:
        conn.close()
