# -*- coding: utf-8 -*-
"""報價單列表 API 分頁契約測試。

（2026-09-15：歷史報價單全展開依賴 /api/quotations 的 page/page_size/total
契約——前端以 page_size=100 逐頁抓到 total 為止。若後端拿掉 total 或改掉
預設 page_size，全展開會靜默失效，故以後端單元測試鎖住契約。）
"""

import app.database as app_db
import main as app_main
import pytest
from app.services.auth import SESSION_COOKIE, create_session, init_admin_if_missing
from fastapi.testclient import TestClient


@pytest.fixture()
def quote_env(tmp_path, monkeypatch):
    """隔離 DB，回傳已登入 admin client（絕不碰正式庫）。"""
    monkeypatch.setattr(app_db, "DB_PATH", str(tmp_path / "quotations.db"))
    app_db.init_db()
    conn = app_db.get_db()
    try:
        init_admin_if_missing(conn)
        user_id = conn.execute(
            "SELECT id FROM users WHERE username='admin'"
        ).fetchone()["id"]
        token = create_session(conn, user_id)
    finally:
        conn.close()
    client = TestClient(app_main.app)
    client.cookies.set(SESSION_COOKIE, token)
    return client


def _create(client, idx, customer=None):
    return client.post("/api/quotations", json={
        "quote_date": "2026-09-15",
        "customer_name": customer or f"客戶{idx:03d}",
        "items": [{"item_name": "分離式冷氣安裝", "qty": 1, "unit_price": 1000}],
    })


def test_api_requires_login():
    """列表 API 需登入，不能因全域 router 掛載遺漏而公開。"""
    client = TestClient(app_main.app)
    assert client.get("/api/quotations").status_code == 401


def test_list_pagination_contract(quote_env):
    """25 筆：預設回前 20＋total=25；page=2 回剩 5；page_size=100 一次全回。"""
    for i in range(25):
        r = _create(quote_env, i)
        assert r.status_code == 201, r.text
    first = quote_env.get("/api/quotations")
    assert first.status_code == 200
    body = first.json()
    assert body["total"] == 25
    assert body["page"] == 1
    assert body["page_size"] == 20
    assert len(body["items"]) == 20
    second = quote_env.get("/api/quotations", params={"page": 2}).json()
    assert second["page"] == 2
    assert len(second["items"]) == 5
    full = quote_env.get("/api/quotations", params={"page_size": 100}).json()
    assert full["total"] == 25
    assert len(full["items"]) == 25


def test_page_size_cap(quote_env):
    """page_size 上限 100（前端全展開用滿 100，超過後端擋 422）。"""
    r = quote_env.get("/api/quotations", params={"page_size": 101})
    assert r.status_code == 422


def test_search_filters_with_correct_total(quote_env):
    """關鍵字搜尋回傳子集且 total 對應（搜尋框＋全展開併用契約）。"""
    for i in range(3):
        assert _create(quote_env, i, customer="振佳空調工程行").status_code == 201
    for i in range(2):
        assert _create(quote_env, i, customer="其他客戶").status_code == 201
    body = quote_env.get("/api/quotations", params={"q": "振佳"}).json()
    assert body["total"] == 3
    assert len(body["items"]) == 3
    assert all("振佳" in item["customer_name"] for item in body["items"])
