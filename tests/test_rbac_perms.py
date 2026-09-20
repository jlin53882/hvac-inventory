# -*- coding: utf-8 -*-
"""RBAC 權限系統 Phase 2 測試（2026-08-13）：合成權限 / 覆蓋 / 保護規則 / 稽核 / 端點矩陣

自 test_rbac.py 拆分（Phase 1 seed 測試留在 test_rbac.py，兩檔獨立可綠——
讓 Phase 1 / Phase 2 commit 各自通過，符合「測試隨功能走」）。
"""
import json as _json

import pytest
from fastapi.testclient import TestClient

from app.database import get_db, init_db
from app.services.auth import init_admin_if_missing
from main import app as fastapi_app

# 與 test_rbac.py 同源常數（設計 §5；稽核 C4：測試手抄可接受）
EXPECTED_ROLES = ('admin', 'user', 'tech', 'viewer')
EXPECTED_KEYS = ('view', 'stats', 'kit-view', 'prepared', 'export', 'item-mgmt', 'stock-mgmt', 'batch-loc-mgmt',
                 'import', 'stockout', 'stocktake', 'kit-mgmt', 'photo', 'cal-mgmt',
                 'svc-type-mgmt', 'gcal-sync-manage', 'gcal-sync-force', 'gcal-sync-team-view', 'gcal-keys-manage',
                 'unit-mgmt', 'user-mgmt', 'change-own-password', 'signed-report-upload', 'signed-report-delete-all',
                 'petty-cash-delete-all', 'petty-cash-view', 'petty-cash-create', 'petty-cash-edit',
                 'petty-cash-delete', 'petty-cash-config', 'page-visibility-manage')


@pytest.fixture()
def rbac_db(tmp_path, monkeypatch):
    """獨立 DB + init_db（含 RBAC seed）"""
    test_db = tmp_path / "test_rbac_perms.db"
    monkeypatch.setattr("app.database.DB_PATH", str(test_db))
    init_db()
    yield test_db


# ================= Phase 2：合成權限 / 覆蓋 / 保護規則 / 稽核 / 端點矩陣 =================


@pytest.fixture()
def admin_client(rbac_db):
    """獨立 DB + admin 登入（依賴 rbac_db 的 monkeypatch DB_PATH）"""
    conn = get_db()
    init_admin_if_missing(conn)
    conn.close()
    with TestClient(fastapi_app) as c:
        r = c.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
        assert r.status_code == 200
        yield c


def _make_user(admin_client, username, role):
    r = admin_client.post("/api/users", json={
        "username": username, "password": "Test1234", "display_name": username, "role": role,
    })
    assert r.status_code == 201
    return r.json()["id"]


@pytest.fixture()
def user_client(admin_client):
    _make_user(admin_client, "sarah", "user")
    with TestClient(fastapi_app) as c:
        r = c.post("/api/auth/login", json={"username": "sarah", "password": "Test1234"})
        assert r.status_code == 200
        yield c


@pytest.fixture()
def viewer_client(admin_client):
    _make_user(admin_client, "viewer1", "viewer")
    with TestClient(fastapi_app) as c:
        r = c.post("/api/auth/login", json={"username": "viewer1", "password": "Test1234"})
        assert r.status_code == 200
        yield c


@pytest.fixture()
def tech_client(admin_client):
    _make_user(admin_client, "tech1", "tech")
    with TestClient(fastapi_app) as c:
        r = c.post("/api/auth/login", json={"username": "tech1", "password": "Test1234"})
        assert r.status_code == 200
        yield c


# ---------- module-scope fixtures（80 個端點矩陣 case 共用，省 PBKDF2 重複登入） ----------
@pytest.fixture(scope="module")
def matrix_db(tmp_path_factory):
    """module-scope 獨立 DB（唯讀矩陣測試共用；手動 MonkeyPatch，不依賴 function-scope monkeypatch）"""
    test_db = tmp_path_factory.mktemp("rbac_matrix") / "test.db"
    mp = pytest.MonkeyPatch()
    mp.setattr("app.database.DB_PATH", str(test_db))
    init_db()
    yield test_db
    mp.undo()


@pytest.fixture(scope="module")
def matrix_admin(matrix_db):
    """module-scope admin client（整個 module 登入一次）"""
    conn = get_db()
    init_admin_if_missing(conn)
    conn.close()
    with TestClient(fastapi_app) as c:
        r = c.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
        assert r.status_code == 200
        yield c


@pytest.fixture(scope="module")
def matrix_viewer(matrix_admin):
    """module-scope viewer client（端點矩陣唯讀 403 檢查用）"""
    _make_user(matrix_admin, "matrix_viewer", "viewer")
    with TestClient(fastapi_app) as c:
        r = c.post("/api/auth/login", json={"username": "matrix_viewer", "password": "Test1234"})
        assert r.status_code == 200
        yield c


@pytest.fixture(scope="module")
def matrix_tech(matrix_admin):
    """module-scope tech client（端點矩陣行事曆白名單檢查用）"""
    _make_user(matrix_admin, "matrix_tech", "tech")
    with TestClient(fastapi_app) as c:
        r = c.post("/api/auth/login", json={"username": "matrix_tech", "password": "Test1234"})
        assert r.status_code == 200
        yield c


# ---------- me 回傳 permissions ----------
def test_me_returns_permissions_dict(admin_client):
    """GET /api/auth/me 回傳 permissions dict（22 key，admin 全 true）"""
    r = admin_client.get("/api/auth/me")
    assert r.status_code == 200
    perms = r.json()["user"]["permissions"]
    assert set(perms.keys()) == set(EXPECTED_KEYS)
    assert all(perms.values()), "admin 應全部權限 true"
    assert r.json()["user"]["is_admin_role"] is True


def test_me_permissions_match_role_defaults(user_client):
    """user 角色 me permissions = §5 user 列（無覆蓋時）"""
    r = user_client.get("/api/auth/me")
    perms = r.json()["user"]["permissions"]
    assert perms["view"] and perms["item-mgmt"] and perms["cal-mgmt"]
    assert not perms["user-mgmt"] and perms["change-own-password"] and not perms["svc-type-mgmt"]
    assert user_client.get("/api/auth/me").json()["user"]["is_admin_role"] is False


def test_me_permissions_tech_cal_writable(tech_client):
    """tech 合成權限：瀏覽+cal-mgmt 開、庫存寫入關（與現況白名單一致）"""
    perms = tech_client.get("/api/auth/me").json()["user"]["permissions"]
    assert perms["view"] and perms["cal-mgmt"] and perms["export"]
    assert not perms["item-mgmt"] and not perms["stockout"] and not perms["user-mgmt"]


# ---------- 覆蓋 / reset_all ----------
def test_override_export_off_immediate(user_client, admin_client):
    """個人覆蓋 export=0 → 下一請求立即生效（不需重登）"""
    uid = _make_user(admin_client, "u1", "user")
    r = admin_client.put(f"/api/users/{uid}/permissions", json={"permissions": {"export": 0}})
    assert r.status_code == 200
    assert r.json()["permissions"]["export"] is False
    # 用 user 帳號登入驗證
    with TestClient(fastapi_app) as c:
        c.post("/api/auth/login", json={"username": "u1", "password": "Test1234"})
        me = c.get("/api/auth/me").json()["user"]["permissions"]
        assert me["export"] is False
        assert me["view"] is True  # 其餘仍跟隨角色


def test_override_open_import_for_viewer(viewer_client, admin_client):
    """viewer 覆蓋開 item-mgmt=1 → 合成權限含 item-mgmt（開關自由使用）"""
    r = admin_client.put(f"/api/users/{viewer_client}", json={})  # 只是佔位不會執行
    # 直接查 viewer1 的 user_id
    users = admin_client.get("/api/users").json()["users"]
    vid = next(u["id"] for u in users if u["username"] == "viewer1")
    r = admin_client.put(f"/api/users/{vid}/permissions", json={"permissions": {"item-mgmt": 1}})
    assert r.status_code == 200
    assert r.json()["permissions"]["item-mgmt"] is True


def test_reset_all_returns_to_role_defaults(admin_client):
    """reset_all 清空覆蓋 → 回到角色預設"""
    uid = _make_user(admin_client, "u2", "user")
    admin_client.put(f"/api/users/{uid}/permissions", json={"permissions": {"export": 0, "import": 1}})
    r = admin_client.put(f"/api/users/{uid}/permissions", json={"reset_all": True})
    assert r.status_code == 200
    perms = r.json()["permissions"]
    assert perms["export"] is True   # user 角色預設 export=true
    assert perms["import"] is True   # user 角色預設 import=true


def test_get_permissions_detail_sources(admin_client):
    """GET /api/users/{id}/permissions 詳細陣列含 source 標記"""
    uid = _make_user(admin_client, "u3", "user")
    admin_client.put(f"/api/users/{uid}/permissions", json={"permissions": {"export": 0}})
    r = admin_client.get(f"/api/users/{uid}/permissions")
    assert r.status_code == 200
    by_key = {p["key"]: p for p in r.json()["permissions"]}
    assert by_key["export"]["source"] == "override" and by_key["export"]["allowed"] is False
    assert by_key["view"]["source"] == "locked" and by_key["view"]["allowed"] is True
    assert by_key["item-mgmt"]["source"] == "role"
    assert by_key["user-mgmt"]["source"] == "locked" and by_key["user-mgmt"]["allowed"] is False


def test_list_permissions_endpoint(admin_client):
    """GET /api/users/permissions 回傳 23 權限點 + 四角色預設"""
    r = admin_client.get("/api/users/permissions")
    assert r.status_code == 200
    data = r.json()
    assert len(data["permissions"]) == 31
    assert set(data["role_defaults"].keys()) == set(EXPECTED_ROLES)
    assert "cal-mgmt" in data["role_defaults"]["tech"]


# ---------- 保護規則（§7） ----------
def test_cannot_change_own_permissions(admin_client):
    """不能修改自己的權限（§7.1）"""
    me = admin_client.get("/api/auth/me").json()["user"]
    r = admin_client.put(f"/api/users/{me['id']}/permissions", json={"permissions": {"export": 0}})
    assert r.status_code == 400


def test_view_cannot_be_closed(admin_client):
    """view 基底不可關（§7.5）"""
    uid = _make_user(admin_client, "u4", "user")
    r = admin_client.put(f"/api/users/{uid}/permissions", json={"permissions": {"view": 0}})
    assert r.status_code == 400
    assert "基底權限" in r.json()["detail"]


def test_user_mgmt_admin_only(admin_client):
    """user-mgmt 僅 admin 可持有（§7.4/§7.7）——非 admin 開 1 → 400；admin 關 0 → 400"""
    uid = _make_user(admin_client, "u5", "user")
    r = admin_client.put(f"/api/users/{uid}/permissions", json={"permissions": {"user-mgmt": 1}})
    assert r.status_code == 400
    # 雙 admin：admin2 的 user-mgmt 不可被關
    admin2_id = _make_user(admin_client, "admin2", "admin")
    r = admin_client.put(f"/api/users/{admin2_id}/permissions", json={"permissions": {"user-mgmt": 0}})
    assert r.status_code == 400


def test_change_own_password_admin_locked(admin_client):
    """change-own-password 對 admin 恆 true（§7.6）"""
    admin2_id = _make_user(admin_client, "admin3", "admin")
    r = admin_client.put(f"/api/users/{admin2_id}/permissions", json={"permissions": {"change-own-password": 0}})
    assert r.status_code == 400
    # 非 admin 允許開（P5 開關）
    uid = _make_user(admin_client, "u6", "user")
    r = admin_client.put(f"/api/users/{uid}/permissions", json={"permissions": {"change-own-password": 1}})
    assert r.status_code == 200


def test_svc_type_non_admin_cannot_open(admin_client):
    """svc-type-mgmt 非 admin 不可開（§7.8）"""
    uid = _make_user(admin_client, "u7", "user")
    r = admin_client.put(f"/api/users/{uid}/permissions", json={"permissions": {"svc-type-mgmt": 1}})
    assert r.status_code == 400


def test_invalid_perm_key_rejected(admin_client):
    """未知權限 key / 非 0/1 值 → 400"""
    uid = _make_user(admin_client, "u8", "user")
    r = admin_client.put(f"/api/users/{uid}/permissions", json={"permissions": {"hack": 1}})
    assert r.status_code == 400
    r = admin_client.put(f"/api/users/{uid}/permissions", json={"permissions": {"export": 2}})
    assert r.status_code == 400


# ---------- 稽核紀錄（§9） ----------
def test_audit_create_and_permission_update(admin_client):
    """新增帳號 + 改權限 → user_audit_log 有 create / permission_update"""
    uid = _make_user(admin_client, "u9", "user")
    admin_client.put(f"/api/users/{uid}/permissions", json={"permissions": {"export": 0}})
    r = admin_client.get("/api/users/audit?target_id=%d" % uid)
    assert r.status_code == 200
    actions = [log["action"] for log in r.json()["logs"]]
    assert "create" in actions
    assert "permission_update" in actions
    upd = next(log for log in r.json()["logs"] if log["action"] == "permission_update")
    assert "export" in _json.loads(upd["detail"])


def test_audit_reset_password_and_delete(admin_client):
    """重設密碼 + 刪除 → audit 有 reset_password / delete（刪除後 target 變 NULL，稽核 A1）"""
    uid = _make_user(admin_client, "u10", "user")
    admin_client.put(f"/api/users/{uid}/password", json={"password": "NewPass123"})
    # 刪除前：target_id 過濾查得到 reset_password
    r = admin_client.get("/api/users/audit?target_id=%d" % uid)
    assert "reset_password" in [log["action"] for log in r.json()["logs"]]
    # 刪除 → 稽核軌跡保留、target 全變 NULL（不滅證）
    admin_client.delete(f"/api/users/{uid}")
    r = admin_client.get("/api/users/audit")
    all_logs = r.json()["logs"]
    actions = [log["action"] for log in all_logs]
    assert "reset_password" in actions and "delete" in actions and "create" in actions
    assert all(log["target_id"] is None for log in all_logs), "刪除後 target 應全為 NULL"


def test_audit_requires_admin(user_client):
    """非 admin 不可讀稽核（require_perm user-mgmt）"""
    assert user_client.get("/api/users/audit").status_code == 403


# ---------- 38 寫入端點封鎖矩陣（稽核 A3：全量，含 ★5 盲區 + nonstock） ----------
# (method, path_pattern, key)——path 中 {id} 用 1（403 在權限層先擋，不需真實資源）
WRITE_ENDPOINTS = [
    ("POST", "/api/items", "item-mgmt"),
    ("PATCH", "/api/items/1", "item-mgmt"),
    ("DELETE", "/api/items/1", "item-mgmt"),
    ("POST", "/api/items/1/stocks", "stock-mgmt"),
    ("PATCH", "/api/stocks/1", "stock-mgmt"),
    ("DELETE", "/api/stocks/1", "stock-mgmt"),
    ("POST", "/api/quotations", "item-mgmt"),
    ("PUT", "/api/quotations/1", "item-mgmt"),
    ("DELETE", "/api/quotations/1", "item-mgmt"),
    ("POST", "/api/stocks/batch-location", "batch-loc-mgmt"),
    ("POST", "/api/items/1/adjust", "stock-mgmt"),
    ("POST", "/api/import", "import"),
    ("POST", "/api/stockout", "stockout"),
    ("POST", "/api/stockout/nonstock", "stockout"),
    ("POST", "/api/stockouts/1/return", "stockout"),
    ("POST", "/api/stockout-returns/1/repair", "stockout"),
    ("DELETE", "/api/stockout-returns/1", "stockout"),
    ("PATCH", "/api/stockouts/1", "stockout"),
    ("DELETE", "/api/stockouts/1", "stockout"),
    ("POST", "/api/prepare/nonstock", "stockout"),
    ("POST", "/api/items/1/prepare", "stockout"),
    ("POST", "/api/items/1/prepared-out", "stockout"),
    ("POST", "/api/items/1/prepared-return", "stockout"),
    ("POST", "/api/stocktake", "stocktake"),
    ("POST", "/api/kits", "kit-mgmt"),
    ("PUT", "/api/kits/1", "kit-mgmt"),
    ("DELETE", "/api/kits/1", "kit-mgmt"),
    ("POST", "/api/kits/1/assemble", "kit-mgmt"),
    ("POST", "/api/kits/1/disassemble", "kit-mgmt"),
    ("POST", "/api/items/1/photo", "photo"),
    ("DELETE", "/api/items/1/photo", "photo"),
    ("POST", "/api/appointments", "cal-mgmt"),
    ("PUT", "/api/appointments/1", "cal-mgmt"),
    ("DELETE", "/api/appointments/1", "cal-mgmt"),
    ("POST", "/api/service-types", "svc-type-mgmt"),
    ("PUT", "/api/service-types/1", "svc-type-mgmt"),
    ("DELETE", "/api/service-types/1", "svc-type-mgmt"),
    ("GET", "/api/users", "user-mgmt"),
    ("POST", "/api/users", "user-mgmt"),
    ("POST", "/api/users/batch", "user-mgmt"),
    ("PUT", "/api/users/1", "user-mgmt"),
    ("PUT", "/api/users/1/password", "user-mgmt"),
    ("DELETE", "/api/users/1", "user-mgmt"),
    ("PUT", "/api/users/1/permissions", "user-mgmt"),
    ("PUT", "/api/auth/password", "change-own-password"),
    ("POST", "/api/auth/password-ack", "change-own-password"),
]


def _call(client, method, url):
    """TestClient 呼叫（僅 POST/PUT/PATCH 支援 json body，GET/DELETE 不支援）"""
    fn = getattr(client, method.lower())
    if method in ("POST", "PUT", "PATCH"):
        return fn(url, json={})
    return fn(url)


@pytest.mark.parametrize("method,url,key", WRITE_ENDPOINTS, ids=[f"{m}{u}" for m, u, k in WRITE_ENDPOINTS])
def test_viewer_write_endpoints_all_403(matrix_viewer, method, url, key):
    """viewer 對寫入端點全數 403，除了自己有權限的端點"""
    if key == "change-own-password":
        resp = _call(matrix_viewer, method, url)
        assert resp.status_code != 403, f"viewer {method} {url} 應非 403（已有權限），實際 {resp.status_code}"
        return
    resp = _call(matrix_viewer, method, url)
    assert resp.status_code == 403, f"viewer {method} {url} 應 403，實際 {resp.status_code}"
    assert "無此權限" in resp.json()["detail"]


@pytest.mark.parametrize("method,url,key", WRITE_ENDPOINTS, ids=[f"{m}{u}" for m, u, k in WRITE_ENDPOINTS])
def test_tech_write_endpoints_only_calendar(matrix_tech, method, url, key):
    """tech 僅 cal-mgmt 與 change-own-password 端點非 403，其餘全 403"""
    resp = _call(matrix_tech, method, url)
    if key in ("cal-mgmt", "change-own-password"):
        assert resp.status_code != 403, f"tech {method} {url} 應可達業務層，實際 403"
    else:
        assert resp.status_code == 403, f"tech {method} {url} 應 403，實際 {resp.status_code}"


# ---------- 可關閉瀏覽 GET 端點（附錄 B，稽核 B-3 全 4 項 + A-1 stockouts） ----------
@pytest.mark.parametrize("perm,urls", [
    ("stats", ["/api/stats"]),
    ("kit-view", ["/api/kits"]),
    ("prepared", ["/api/prepared", "/api/stockouts"]),
    ("export", ["/api/export", "/api/quotations/1/export.xlsx", "/api/quotations/1/export.pdf"]),
], ids=["stats", "kit-view", "prepared", "export"])
def test_browsable_get_perm_closed(admin_client, perm, urls):
    """關閉可關閉瀏覽權限 → 對應 GET 403；view 基底維持放行"""
    uid = _make_user(admin_client, f"u-{perm}", "user")
    admin_client.put(f"/api/users/{uid}/permissions", json={"permissions": {perm: 0}})
    with TestClient(fastapi_app) as c:
        c.post("/api/auth/login", json={"username": f"u-{perm}", "password": "Test1234"})
        for u in urls:
            assert c.get(u).status_code == 403, f"{perm}=0 時 {u} 應 403"
        assert c.get("/api/items").status_code == 200  # view 基底


def test_permissions_immediate_no_relogin(user_client, admin_client):
    """改權限後已登入 session 下一請求即生效（不需重登）"""
    uid = _make_user(admin_client, "u12", "user")
    with TestClient(fastapi_app) as c:
        c.post("/api/auth/login", json={"username": "u12", "password": "Test1234"})
        assert c.get("/api/export").status_code == 200
        admin_client.put(f"/api/users/{uid}/permissions", json={"permissions": {"export": 0}})
        assert c.get("/api/export").status_code == 403  # 同一 session 立即生效


# ---------- 稽核 B-1/B-2 補測（2026-08-13 Phase 2 審查發現） ----------
def test_single_admin_all_perms_true_override_ignored(admin_client):
    """§7.2：唯一 admin 即使 DB 有覆蓋也強制全權限 true（防互覆蓋鎖死）"""
    me = admin_client.get("/api/auth/me").json()["user"]
    # 直接 DB 插入覆蓋（模擬繞過 API / 歷史資料）
    conn = get_db()
    try:
        pid = conn.execute("SELECT id FROM permissions WHERE key='export'").fetchone()["id"]
        conn.execute(
            "INSERT OR REPLACE INTO user_permissions (user_id, permission_id, value, updated_at) VALUES (?, ?, 0, datetime('now'))",
            (me["id"], pid))
        conn.commit()
    finally:
        conn.close()
    perms = admin_client.get("/api/auth/me").json()["user"]["permissions"]
    assert perms["export"] is True  # 唯一 admin 強制全權限


def test_single_admin_put_permissions_rejected(admin_client):
    """§7.2：唯一 admin 的 PUT 覆蓋被拒（自改被 §7.1 擋 + 唯一 admin 固定）"""
    me = admin_client.get("/api/auth/me").json()["user"]
    r = admin_client.put(f"/api/users/{me['id']}/permissions", json={"permissions": {"export": 0}})
    assert r.status_code == 400


def test_last_admin_protection(admin_client):
    """§7.3：雙 admin 可停用/降級其一；唯一 admin 自我操作全 400（§7.1/§7.2）"""
    admin2_id = _make_user(admin_client, "admin4", "admin")
    # 雙 admin：可停用 admin4（非最後）
    assert admin_client.put(f"/api/users/{admin2_id}", json={"is_active": 0}).status_code == 200
    # 重新啟用、降級（仍非最後 → 允許）
    assert admin_client.put(f"/api/users/{admin2_id}", json={"is_active": 1}).status_code == 200
    assert admin_client.put(f"/api/users/{admin2_id}", json={"role": "user"}).status_code == 200
    # admin4 降級後系統唯一 admin = admin：自停用/自降級/自刪全 400（§7.1 不能動自己）
    me = admin_client.get("/api/auth/me").json()["user"]
    assert admin_client.put(f"/api/users/{me['id']}", json={"is_active": 0}).status_code == 400
    assert admin_client.put(f"/api/users/{me['id']}", json={"role": "viewer"}).status_code == 400
    assert admin_client.delete(f"/api/users/{me['id']}").status_code == 400
    # 唯一 admin 合成權限全 true（§7.2）
    assert all(admin_client.get("/api/auth/me").json()["user"]["permissions"].values())

PAGE_KEYS = (
    "calendar", "signed-reports", "quotation", "petty-cash",
    "inventory", "prepared", "stockout", "stocktake", "kit",
    "perms", "settings", "change-password",
)
VIEWER_PAGE_KEYS = {"calendar", "signed-reports", "inventory", "kit"}
USER_PAGE_KEYS = {
    "calendar", "signed-reports", "quotation", "petty-cash",
    "inventory", "prepared", "stockout", "stocktake", "kit",
    "change-password",
}
TECH_PAGE_KEYS = {
    "calendar", "signed-reports", "petty-cash",
    "inventory", "prepared", "stockout",
    "kit", "change-password",
}


def test_page_visibility_defaults_are_independent_of_role_changes(admin_client):
    viewer_id = _make_user(admin_client, "page_viewer", "viewer")
    user_id = _make_user(admin_client, "page_user", "user")

    viewer = admin_client.get(f"/api/users/{viewer_id}/page-visibility")
    assert viewer.status_code == 200
    assert set(viewer.json()["visible_pages"]) == VIEWER_PAGE_KEYS

    user = admin_client.get(f"/api/users/{user_id}/page-visibility")
    assert user.status_code == 200
    assert set(user.json()["visible_pages"]) == USER_PAGE_KEYS

    changed = admin_client.put(
        f"/api/users/{viewer_id}/page-visibility",
        json={"pages": {"inventory": 0, "settings": 1}},
    )
    assert changed.status_code == 200
    assert set(changed.json()["visible_pages"]) == VIEWER_PAGE_KEYS - {"inventory"} | {"settings"}

    role_change = admin_client.put(f"/api/users/{viewer_id}", json={"role": "user"})
    assert role_change.status_code == 200
    after_role_change = admin_client.get(f"/api/users/{viewer_id}/page-visibility")
    assert set(after_role_change.json()["visible_pages"]) == VIEWER_PAGE_KEYS - {"inventory"} | {"settings"}


def test_page_visibility_rejects_unknown_page_and_invalid_value(admin_client):
    viewer_id = _make_user(admin_client, "page_validation", "viewer")

    unknown = admin_client.put(
        f"/api/users/{viewer_id}/page-visibility",
        json={"pages": {"not-a-page": 1}},
    )
    assert unknown.status_code == 400

    invalid = admin_client.put(
        f"/api/users/{viewer_id}/page-visibility",
        json={"pages": {"calendar": 2}},
    )
    assert invalid.status_code == 400


def test_auth_me_returns_visible_pages(admin_client):
    admin_me = admin_client.get("/api/auth/me")
    assert admin_me.status_code == 200
    assert set(admin_me.json()["user"]["visible_pages"]) == set(PAGE_KEYS)

    viewer_id = _make_user(admin_client, "page_me_viewer", "viewer")
    assert viewer_id
    with TestClient(fastapi_app) as viewer_client:
        login = viewer_client.post("/api/auth/login", json={"username": "page_me_viewer", "password": "Test1234"})
        assert login.status_code == 200
        me = viewer_client.get("/api/auth/me")
        assert set(me.json()["user"]["visible_pages"]) == VIEWER_PAGE_KEYS

def test_page_visibility_management_is_admin_only(admin_client, viewer_client):
    target_id = _make_user(admin_client, "page_admin_only_target", "viewer")
    assert viewer_client.get(f"/api/users/{target_id}/page-visibility").status_code == 403
    assert viewer_client.get("/api/auth/me").json()["user"]["permissions"].get("page-visibility-manage") is False
    grant = admin_client.put(
        f"/api/users/{target_id}/permissions",
        json={"permissions": {"page-visibility-manage": 1}},
    )
    assert grant.status_code == 400

def test_other_admin_can_change_page_visibility(admin_client):
    other_admin_id = _make_user(admin_client, "page_other_admin", "admin")
    updated = admin_client.put(
        f"/api/users/{other_admin_id}/page-visibility",
        json={"pages": {"perms": 0}},
    )
    assert updated.status_code == 200
    assert "perms" not in updated.json()["visible_pages"]

def test_page_visibility_seed_repairs_missing_rows(admin_client, rbac_db):
    viewer_id = _make_user(admin_client, "page_partial_seed", "viewer")
    conn = get_db()
    conn.execute(
        "DELETE FROM user_page_visibility WHERE user_id = ? AND page_key = ?",
        (viewer_id, "settings"),
    )
    conn.commit()
    conn.close()
    init_db()
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT visible FROM user_page_visibility WHERE user_id = ? AND page_key = ?",
            (viewer_id, "settings"),
        ).fetchone()
        assert row is not None
        assert row["visible"] == 0
    finally:
        conn.close()


def test_page_visibility_role_defaults_admin_is_all(admin_client):
    admin_me = admin_client.get("/api/auth/me").json()["user"]
    assert set(admin_me["visible_pages"]) == set(PAGE_KEYS)


def test_page_visibility_role_defaults_user(admin_client):
    user_id = _make_user(admin_client, "pv_default_user", "user")
    r = admin_client.get(f"/api/users/{user_id}/page-visibility")
    assert r.status_code == 200
    assert set(r.json()["visible_pages"]) == USER_PAGE_KEYS


def test_page_visibility_role_defaults_tech(admin_client):
    tech_id = _make_user(admin_client, "pv_default_tech", "tech")
    r = admin_client.get(f"/api/users/{tech_id}/page-visibility")
    assert r.status_code == 200
    assert set(r.json()["visible_pages"]) == TECH_PAGE_KEYS


def test_page_visibility_role_defaults_viewer(admin_client):
    viewer_id = _make_user(admin_client, "pv_default_viewer", "viewer")
    r = admin_client.get(f"/api/users/{viewer_id}/page-visibility")
    assert r.status_code == 200
    assert set(r.json()["visible_pages"]) == VIEWER_PAGE_KEYS


def test_page_visibility_change_does_not_reset(admin_client):
    viewer_id = _make_user(admin_client, "pv_no_reset", "viewer")
    # Manual edit
    admin_client.put(f"/api/users/{viewer_id}/page-visibility", json={"pages": {"inventory": 0, "quotation": 1}})
    # Role change
    admin_client.put(f"/api/users/{viewer_id}", json={"role": "user"})
    r = admin_client.get(f"/api/users/{viewer_id}/page-visibility")
    # inventory should still be OFF, quotation ON
    assert "inventory" not in r.json()["visible_pages"]
    assert "quotation" in r.json()["visible_pages"]


def test_page_visibility_reset_viewer(admin_client):
    viewer_id = _make_user(admin_client, "pv_reset_viewer", "viewer")
    # Manually open many pages
    admin_client.put(f"/api/users/{viewer_id}/page-visibility", json={"pages": {
        "quotation": 1, "petty-cash": 1, "prepared": 1, "stockout": 1, "stocktake": 1, "settings": 1
    }})
    # Reset via page-visibility API
    r = admin_client.put(f"/api/users/{viewer_id}/page-visibility", json={"reset_all": True})
    assert r.status_code == 200
    assert set(r.json()["visible_pages"]) == VIEWER_PAGE_KEYS


def test_page_visibility_reset_user(admin_client):
    user_id = _make_user(admin_client, "pv_reset_user", "user")
    admin_client.put(f"/api/users/{user_id}/page-visibility", json={"pages": {"perms": 1, "settings": 1}})
    r = admin_client.put(f"/api/users/{user_id}/page-visibility", json={"reset_all": True})
    assert r.status_code == 200
    assert set(r.json()["visible_pages"]) == USER_PAGE_KEYS


def test_page_visibility_reset_tech(admin_client):
    tech_id = _make_user(admin_client, "pv_reset_tech", "tech")
    admin_client.put(f"/api/users/{tech_id}/page-visibility", json={"pages": {"quotation": 1, "stocktake": 1, "perms": 1}})
    r = admin_client.put(f"/api/users/{tech_id}/page-visibility", json={"reset_all": True})
    assert r.status_code == 200
    assert set(r.json()["visible_pages"]) == TECH_PAGE_KEYS


def test_page_visibility_reset_admin(admin_client):
    # Admin uses the same reset endpoint
    other_admin_id = _make_user(admin_client, "pv_reset_admin2", "admin")
    admin_client.put(f"/api/users/{other_admin_id}/page-visibility", json={"pages": {"perms": 0}})
    r = admin_client.put(f"/api/users/{other_admin_id}/page-visibility", json={"reset_all": True})
    assert r.status_code == 200
    assert set(r.json()["visible_pages"]) == set(PAGE_KEYS)


def test_page_visibility_reset_uses_current_role(admin_client):
    # Viewer -> User -> reset should use User defaults
    vid = _make_user(admin_client, "pv_role_reset", "viewer")
    admin_client.put(f"/api/users/{vid}/page-visibility", json={"pages": {"quotation": 1}})
    admin_client.put(f"/api/users/{vid}", json={"role": "user"})
    r = admin_client.put(f"/api/users/{vid}/page-visibility", json={"reset_all": True})
    assert r.status_code == 200
    assert set(r.json()["visible_pages"]) == USER_PAGE_KEYS


def test_page_visibility_existing_rows_not_overwritten_on_startup(admin_client, rbac_db):
    viewer_id = _make_user(admin_client, "pv_seed_no_overwrite", "viewer")
    admin_client.put(f"/api/users/{viewer_id}/page-visibility", json={"pages": {"quotation": 1}})
    # Re-init (seed)
    init_db()
    r = admin_client.get(f"/api/users/{viewer_id}/page-visibility")
    # quotation should still be ON (seed uses INSERT OR IGNORE)
    assert "quotation" in r.json()["visible_pages"]


def test_change_own_password_role_defaults():
    """change-own-password must be ON for all 4 roles (seed check)."""
    from app.database import get_db, init_db
    import tempfile, os, sqlite3
    # Quick isolated DB check
    test_db = os.path.join(tempfile.mkdtemp(), 'test_cop.db')
    import app.database as dbmod
    old = dbmod.DB_PATH
    dbmod.DB_PATH = test_db
    try:
        init_db()
        conn = get_db()
        try:
            rows = {r['key']: r['id'] for r in conn.execute('SELECT key, id FROM permissions').fetchall()}
            cop_id = rows['change-own-password']
            roles = {r['name']: r['id'] for r in conn.execute('SELECT name, id FROM roles').fetchall()}
            for role_name in ('admin', 'user', 'tech', 'viewer'):
                cnt = conn.execute(
                    'SELECT COUNT(*) FROM role_permissions WHERE role_id = ? AND permission_id = ?',
                    (roles[role_name], cop_id)
                ).fetchone()[0]
                assert cnt == 1, f'{role_name} should have change-own-password=ON'
        finally:
            conn.close()
    finally:
        dbmod.DB_PATH = old


def test_change_password_access_user(admin_client):
    """User has change-own-password capability, so canAccessPage('change-password') should be true."""
    user_id = _make_user(admin_client, 'cop_user', 'user')
    with TestClient(fastapi_app) as c:
        c.post('/api/auth/login', json={'username': 'cop_user', 'password': 'Test1234'})
        me = c.get('/api/auth/me').json()['user']
        assert me['permissions']['change-own-password'] is True


def test_change_password_access_tech(admin_client):
    """Tech has change-own-password capability."""
    tech_id = _make_user(admin_client, 'cop_tech', 'tech')
    with TestClient(fastapi_app) as c:
        c.post('/api/auth/login', json={'username': 'cop_tech', 'password': 'Test1234'})
        me = c.get('/api/auth/me').json()['user']
        assert me['permissions']['change-own-password'] is True


def test_change_password_access_viewer(admin_client):
    """Viewer has change-own-password RBAC capability, but default page visibility is OFF."""
    viewer_id = _make_user(admin_client, 'cop_viewer', 'viewer')
    with TestClient(fastapi_app) as c:
        c.post('/api/auth/login', json={'username': 'cop_viewer', 'password': 'Test1234'})
        me = c.get('/api/auth/me').json()['user']
        # RBAC capability is ON
        assert me['permissions']['change-own-password'] is True
        # But page visibility is OFF (viewer defaults don't include change-password)
        assert 'change-password' not in me['visible_pages']


def test_viewer_page_visibility_still_only_four_pages(admin_client):
    """Viewer default visible_pages must remain exactly 4 pages after change-own-password RBAC change."""
    viewer_id = _make_user(admin_client, 'cop_viewer_check', 'viewer')
    r = admin_client.get(f'/api/users/{viewer_id}/page-visibility')
    assert r.status_code == 200
    assert set(r.json()['visible_pages']) == {'calendar', 'signed-reports', 'inventory', 'kit'}
