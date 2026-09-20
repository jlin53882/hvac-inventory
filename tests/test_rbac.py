# -*- coding: utf-8 -*-
"""RBAC 權限系統測試（2026-08-13）

Phase 1：seed 正確性（角色/權限/角色預設矩陣 = 設計文件 §5）
Phase 2 起：合成權限 / 覆蓋 / 保護規則 / 端點封鎖矩陣（隨後續 phase 擴充）
"""
import pytest
from app.database import init_db, get_db


@pytest.fixture()
def rbac_db(tmp_path, monkeypatch):
    """獨立 DB + init_db（含 RBAC seed）"""
    test_db = tmp_path / "test_rbac.db"
    monkeypatch.setattr("app.database.DB_PATH", str(test_db))
    init_db()
    yield test_db


# 設計文件 §5 角色預設矩陣（權威預期值，獨立於 database.py 的 seed 常數）
EXPECTED_MATRIX = {
    'view':    {'admin': 1, 'user': 1, 'tech': 1, 'viewer': 1},
    'stats':   {'admin': 1, 'user': 1, 'tech': 1, 'viewer': 1},
    'kit-view':{'admin': 1, 'user': 1, 'tech': 1, 'viewer': 1},
    'prepared':{'admin': 1, 'user': 1, 'tech': 1, 'viewer': 1},
    'export':  {'admin': 1, 'user': 1, 'tech': 1, 'viewer': 1},
    'item-mgmt':   {'admin': 1, 'user': 1, 'tech': 0, 'viewer': 0},
    'stock-mgmt':  {'admin': 1, 'user': 1, 'tech': 0, 'viewer': 0},
    'batch-loc-mgmt': {'admin': 1, 'user': 0, 'tech': 0, 'viewer': 0},
    'import':      {'admin': 1, 'user': 1, 'tech': 0, 'viewer': 0},
    'stockout':    {'admin': 1, 'user': 1, 'tech': 0, 'viewer': 0},
    'stocktake':   {'admin': 1, 'user': 1, 'tech': 0, 'viewer': 0},
    'kit-mgmt':    {'admin': 1, 'user': 1, 'tech': 0, 'viewer': 0},
    'photo':       {'admin': 1, 'user': 1, 'tech': 0, 'viewer': 0},
    'cal-mgmt':    {'admin': 1, 'user': 1, 'tech': 1, 'viewer': 0},
    'svc-type-mgmt':      {'admin': 1, 'user': 0, 'tech': 0, 'viewer': 0},
    'gcal-sync-manage':   {'admin': 1, 'user': 0, 'tech': 0, 'viewer': 0},
    'gcal-sync-force':      {'admin': 1, 'user': 0, 'tech': 0, 'viewer': 0},
    'gcal-sync-team-view':  {'admin': 1, 'user': 0, 'tech': 0, 'viewer': 0},
    'gcal-keys-manage':   {'admin': 1, 'user': 0, 'tech': 0, 'viewer': 0},
    'unit-mgmt':          {'admin': 1, 'user': 0, 'tech': 0, 'viewer': 0},
    'user-mgmt':          {'admin': 1, 'user': 0, 'tech': 0, 'viewer': 0},
    'change-own-password':{'admin': 1, 'user': 1, 'tech': 1, 'viewer': 1},
    'signed-report-upload': {'admin': 1, 'user': 1, 'tech': 1, 'viewer': 0},
    'signed-report-edit': {'admin': 1, 'user': 1, 'tech': 1, 'viewer': 0},
    'signed-report-delete': {'admin': 1, 'user': 1, 'tech': 1, 'viewer': 0},
    'signed-report-delete-all': {'admin': 1, 'user': 0, 'tech': 0, 'viewer': 0},
    'petty-cash-delete-all': {'admin': 1, 'user': 0, 'tech': 0, 'viewer': 0},
    'petty-cash-view': {'admin': 1, 'user': 1, 'tech': 1, 'viewer': 1},
    'petty-cash-create': {'admin': 1, 'user': 1, 'tech': 0, 'viewer': 0},
    'petty-cash-edit': {'admin': 1, 'user': 1, 'tech': 0, 'viewer': 0},
    'petty-cash-delete': {'admin': 1, 'user': 1, 'tech': 0, 'viewer': 0},
    'petty-cash-config': {'admin': 1, 'user': 0, 'tech': 0, 'viewer': 0},
    'page-visibility-manage': {'admin': 1, 'user': 0, 'tech': 0, 'viewer': 0},
}
EXPECTED_ROLES = ('admin', 'user', 'tech', 'viewer')
EXPECTED_KEYS = tuple(EXPECTED_MATRIX.keys())


def test_seed_roles_permissions(rbac_db):
    """角色 4 個、權限 30 個、權限點清單與設計一致"""
    conn = get_db()
    try:
        roles = [r["name"] for r in conn.execute("SELECT name FROM roles ORDER BY id").fetchall()]
        perms = [p["key"] for p in conn.execute("SELECT key FROM permissions ORDER BY id").fetchall()]
        assert roles == list(EXPECTED_ROLES)
        assert sorted(perms) == sorted(EXPECTED_KEYS)
        assert len(perms) == 33
    finally:
        conn.close()


@pytest.mark.parametrize("perm_key", EXPECTED_KEYS)
@pytest.mark.parametrize("role_name", EXPECTED_ROLES)
def test_seed_role_permission_matrix(rbac_db, perm_key, role_name):
    """role_permissions 內容 = 設計 §5 矩陣（參數化 4×30 全比對）"""
    conn = get_db()
    try:
        on = conn.execute(
            """SELECT COUNT(*) AS c FROM role_permissions rp
               JOIN roles r ON r.id = rp.role_id
               JOIN permissions p ON p.id = rp.permission_id
               WHERE r.name = ? AND p.key = ?""",
            (role_name, perm_key),
        ).fetchone()["c"]
        assert bool(on) == bool(EXPECTED_MATRIX[perm_key][role_name]), \
            f"{role_name}.{perm_key}: seed={bool(on)} 預期={bool(EXPECTED_MATRIX[perm_key][role_name])}"
    finally:
        conn.close()


def test_seed_preserves_existing_signed_report_override(rbac_db):
    """Adding split action permissions must not overwrite an existing user override."""
    conn = get_db()
    try:
        conn.execute(
            "INSERT INTO users (username, password_hash, display_name, role) VALUES (?, 'x', ?, 'user')",
            ("override-user", "Override User"),
        )
        user_id = conn.execute(
            "SELECT id FROM users WHERE username='override-user'"
        ).fetchone()["id"]
        permission_id = conn.execute(
            "SELECT id FROM permissions WHERE key='signed-report-delete-all'"
        ).fetchone()["id"]
        conn.execute(
            "INSERT INTO user_permissions (user_id, permission_id, value) VALUES (?, ?, 0)",
            (user_id, permission_id),
        )
        conn.commit()
    finally:
        conn.close()

    init_db()
    conn = get_db()
    try:
        override = conn.execute(
            """SELECT up.value FROM user_permissions up
               JOIN users u ON u.id = up.user_id
               JOIN permissions p ON p.id = up.permission_id
               WHERE u.username='override-user' AND p.key='signed-report-delete-all'"""
        ).fetchone()
        assert override["value"] == 0
        assert conn.execute(
            "SELECT 1 FROM permissions WHERE key='signed-report-edit'"
        ).fetchone() is not None
        assert conn.execute(
            "SELECT 1 FROM permissions WHERE key='signed-report-delete'"
        ).fetchone() is not None
    finally:
        conn.close()


def test_seed_labels_and_modules(rbac_db):
    """權限 label/module 與設計 §5 精確一致（稽核 B1：弱斷言強化）"""
    EXPECTED_LABELS_MODULES = {
        'view': ('庫存瀏覽/搜尋/看照片', 'view'),
        'stats': ('統計數字', 'view'),
        'kit-view': ('整組清單瀏覽', 'view'),
        'prepared': ('待領出/已領出瀏覽', 'view'),
        'export': ('匯出 Excel', 'view'),
        'item-mgmt': ('品項 新增/編輯/刪除', 'stock'),
        'stock-mgmt': ('庫存位置/數量調整', 'stock'),
        'batch-loc-mgmt': ('批量修改位置', 'stock'),
        'import': ('匯入 JSON', 'stock'),
        'stockout': ('出庫作業', 'stock'),
        'stocktake': ('盤點作業', 'stock'),
        'kit-mgmt': ('整組 建立/組裝/拆解', 'stock'),
        'photo': ('照片 上傳/刪除', 'stock'),
        'cal-mgmt': ('行事曆派工（新增/編輯/刪除）', 'calendar'),
        'svc-type-mgmt': ('服務項目管理', 'calendar'),
        'gcal-sync-manage': ('行事曆同步設定', 'calendar'),
        'gcal-sync-force': ('強制立即同步', 'calendar'),
        'gcal-sync-team-view': ('行事曆團隊同步狀態', 'calendar'),
        'gcal-keys-manage': ('Service Account Key 管理', 'calendar'),
        'unit-mgmt': ('單位整理（停用/排序/收編）', 'stock'),
        'user-mgmt': ('使用者管理', 'system'),
        'change-own-password': ('自行改密碼', 'system'),
        'signed-report-upload': ('每日簽名日報表 上傳', 'calendar'),
        'signed-report-edit': ('簽名報表 編輯本人', 'calendar'),
        'signed-report-delete': ('簽名報表 刪除本人', 'calendar'),
        'signed-report-delete-all': ('簽名報表 全域管理範圍', 'calendar'),
        'petty-cash-delete-all': ('零用金月報 全域刪除', 'calendar'),
        'petty-cash-view': ('零用金月報 檢視', 'calendar'),
        'petty-cash-create': ('零用金月報 新增', 'calendar'),
        'petty-cash-edit': ('零用金月報 編輯', 'calendar'),
        'petty-cash-delete': ('零用金月報 刪除本人', 'calendar'),
        'petty-cash-config': ('零用金下拉選單管理', 'calendar'),
        'page-visibility-manage': ('頁面可見性管理', 'system'),
    }
    conn = get_db()
    try:
        rows = {r["key"]: (r["label"], r["module"]) for r in conn.execute("SELECT key, label, module FROM permissions").fetchall()}
        assert rows == EXPECTED_LABELS_MODULES
        role_labels = {r["name"]: r["label"] for r in conn.execute("SELECT name, label FROM roles").fetchall()}
        assert role_labels == {
            'admin': '🛡️ 管理員', 'user': '👤 使用者',
            'tech': '🔧 工程師', 'viewer': '👀 檢視者',
        }
    finally:
        conn.close()


def test_audit_log_set_null_on_user_delete(rbac_db):
    """稽核 A1：刪除使用者後，user_audit_log 的 operator/target 變 NULL（不滅證）"""
    conn = get_db()
    try:
        # 建兩名使用者（password_hash 用假值即可）
        conn.execute(
            "INSERT INTO users (username, password_hash, display_name, role) VALUES ('alice', 'x', 'Alice', 'user')")
        conn.execute(
            "INSERT INTO users (username, password_hash, display_name, role) VALUES ('bob', 'x', 'Bob', 'user')")
        conn.commit()
        alice_id = conn.execute("SELECT id FROM users WHERE username='alice'").fetchone()["id"]
        bob_id = conn.execute("SELECT id FROM users WHERE username='bob'").fetchone()["id"]
        conn.execute(
            "INSERT INTO user_audit_log (operator_id, target_id, action, detail) VALUES (?, ?, 'permission_update', '{}')",
            (alice_id, bob_id))
        conn.commit()
        # 刪除 alice（operator）與 bob（target）——FK SET NULL 生效
        conn.execute("DELETE FROM users WHERE id=?", (alice_id,))
        conn.execute("DELETE FROM users WHERE id=?", (bob_id,))
        conn.commit()
        row = conn.execute("SELECT operator_id, target_id, action FROM user_audit_log").fetchone()
        assert row is not None, "稽核紀錄應保留"
        assert row["operator_id"] is None and row["target_id"] is None
        assert row["action"] == 'permission_update'
    finally:
        conn.close()


def test_seed_is_idempotent(rbac_db):
    """重跑 init_db 不重複 seed（INSERT OR IGNORE 冪等）"""
    init_db()
    conn = get_db()
    try:
        assert conn.execute("SELECT COUNT(*) AS c FROM roles").fetchone()["c"] == 4
        assert conn.execute("SELECT COUNT(*) AS c FROM permissions").fetchone()["c"] == 33
        assert conn.execute("SELECT COUNT(*) AS c FROM role_permissions").fetchone()["c"] == \
            sum(sum(1 for v in roles.values() if v) for roles in EXPECTED_MATRIX.values())
    finally:
        conn.close()
