# -*- coding: utf-8 -*-
"""
檢視者（viewer）唯讀角色測試
============================
驗證：
  1. viewer 對全部 18 個寫入端點 → 403（require_login method 封鎖）
  2. viewer 對 GET 端點（含匯出、待領出/已領出）→ 200
  3. 使用者管理端點仍鎖定（require_admin）
  4. admin 可建立 role=viewer 帳號

沿用 test_users.py 模式：tmp_path 獨立 DB + admin 登入 fixture。
"""
import os
import sys

import pytest
from fastapi.testclient import TestClient

# 專案根目錄
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE_DIR)

import app.database as app_db  # noqa: E402
import main as app_main  # noqa: E402


@pytest.fixture()
def admin_client(tmp_path, monkeypatch):
    """獨立 DB + admin 登入"""
    test_db = tmp_path / "test_viewer.db"
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


@pytest.fixture()
def viewer_client(admin_client):
    """admin 建立 viewer 帳號 → viewer 登入（跨 fixture 共享 session？不行，需獨立 TestClient）"""
    r = admin_client.post("/api/users", json={
        "username": "tracy", "password": "View1234",
        "display_name": "Tracy", "role": "viewer",
    })
    assert r.status_code == 201
    with TestClient(app_main.app) as c:
        resp = c.post("/api/auth/login", json={"username": "tracy", "password": "View1234"})
        assert resp.status_code == 200
        yield c


@pytest.fixture()
def item(admin_client):
    """admin 建立一筆測試品項，回傳 item dict（含 id）"""
    r = admin_client.post("/api/items", json={
        "brand": "測試牌", "code": "TEST-1", "name": "測試品項",
        "unit": "個", "low_stock": 0, "site": "office",
        "stocks": [{"location": "測試位置", "qty": 10, "note": ""}],
    })
    assert r.status_code == 201
    return r.json()


# ---------- 1. 寫入端點 → 全數 403 ----------

def test_viewer_write_endpoints_all_403(viewer_client, item):
    """viewer 對全部寫入端點一律 403（單點封鎖驗證）"""
    iid = item["id"]
    cases = [
        ("POST", "/api/items", {"brand": "B", "name": "N", "stocks": []}),
        ("PATCH", f"/api/items/{iid}", {"name": "改名"}),
        ("DELETE", f"/api/items/{iid}", None),
        ("POST", f"/api/items/{iid}/stocks", {"location": "新位置", "qty": 1}),
        ("PATCH", f"/api/stocks/1", {"qty": 5}),
        ("DELETE", "/api/stocks/1", None),
        ("POST", f"/api/items/{iid}/adjust", {"delta": 1, "reason": "測試"}),
        ("POST", "/api/import", {"items": []}),
        ("POST", "/api/kits", {"name": "套組", "items": [{"item_id": iid, "qty": 1}]}),
        ("POST", f"/api/kits/1/assemble", {"qty": 1}),
        ("POST", f"/api/kits/1/disassemble", {"qty": 1}),
        ("POST", "/api/stockout", {"item_id": iid, "qty": 1, "destination": "工地"}),
        ("POST", f"/api/items/{iid}/prepare", {"qty": 1}),
        ("POST", f"/api/items/{iid}/prepared-out", {"qty": 1}),
        ("POST", f"/api/items/{iid}/prepared-return", {"qty": 1}),
        ("POST", "/api/stocktake", {"take_date": "", "items": []}),
        ("POST", f"/api/items/{iid}/photo", None),  # 403 在 require_login 層就擋，不會到檔案處理
        ("DELETE", f"/api/items/{iid}/photo", None),
    ]
    for method, url, body in cases:
        resp = getattr(viewer_client, method.lower())(url, json=body) if body is not None else getattr(viewer_client, method.lower())(url)
        assert resp.status_code == 403, f"{method} {url} 應 403，實際 {resp.status_code}"
        assert "無此權限" in resp.json()["detail"]


def test_viewer_cannot_create_user(viewer_client):
    """viewer 不能建立/管理使用者（require_admin 層）"""
    r = viewer_client.post("/api/users", json={
        "username": "evil", "password": "Pass1234", "display_name": "E", "role": "admin",
    })
    assert r.status_code == 403
    assert viewer_client.get("/api/users").status_code == 403
    assert viewer_client.delete("/api/users/1").status_code == 403


# ---------- 2. 讀取端點 → 200 ----------

def test_viewer_read_endpoints_all_200(viewer_client, item):
    """viewer 對 GET 端點（含匯出、待領出/已領出）全部 200"""
    assert viewer_client.get("/api/items").status_code == 200
    assert viewer_client.get("/api/kits").status_code == 200
    assert viewer_client.get("/api/stats").status_code == 200
    assert viewer_client.get("/api/movements").status_code == 200
    assert viewer_client.get("/api/locations").status_code == 200
    assert viewer_client.get("/api/prepared").status_code == 200
    assert viewer_client.get("/api/stockouts").status_code == 200
    assert viewer_client.get("/api/stocktakes").status_code == 200
    assert viewer_client.get("/api/stocktake/dates").status_code == 200
    assert viewer_client.get("/api/export").status_code == 200


def test_viewer_me_returns_role(viewer_client):
    """viewer 登入後 /api/auth/me 回傳 role=viewer"""
    r = viewer_client.get("/api/auth/me")
    assert r.status_code == 200
    assert r.json()["user"]["role"] == "viewer"


# ---------- 3. 登出不受影響 ----------

def test_viewer_can_logout(viewer_client):
    """viewer 登出是 auth router，不受 method 封鎖影響"""
    assert viewer_client.post("/api/auth/logout").status_code == 200


# ---------- 4. admin/user 回歸 ----------

def test_admin_write_still_works(admin_client, item):
    """admin 寫入不受影響（回歸）"""
    iid = item["id"]
    assert admin_client.patch(f"/api/items/{iid}", json={"name": "改名後"}).status_code == 200
    assert admin_client.post(f"/api/items/{iid}/adjust", json={"delta": 5, "reason": "進貨"}).status_code == 200


def test_user_role_write_still_works(admin_client):
    """一般 user 寫入不受影響（回歸）"""
    admin_client.post("/api/users", json={
        "username": "sarah", "password": "Test1234", "display_name": "Sarah", "role": "user",
    })
    with TestClient(app_main.app) as c:
        assert c.post("/api/auth/login", json={"username": "sarah", "password": "Test1234"}).status_code == 200
        r = c.post("/api/items", json={
            "brand": "B", "name": "User 建的", "unit": "個",
            "stocks": [{"location": "L", "qty": 3}],
        })
        assert r.status_code == 201
