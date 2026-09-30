# -*- coding: utf-8 -*-
"""
資料庫種子資料與一次性資料遷移
==============================
全部使用 INSERT OR IGNORE 或「只在 fresh DB / 尚未記錄時」的守衛，可重複執行且不覆蓋使用者已改的值。
SEEDS 的順序就是執行順序（與拆分前 _exec_init 相同：RBAC 一次性相容遷移必須在 RBAC 預設之後）。
"""
from app.db_schema import execute_script_in_transaction as _execute_script_in_transaction
from app.models import PAGE_KEYS, initial_visible_page_keys
from app.services.app_log import get_logger

logger = get_logger(__name__)


def _seed_service_types(conn):
    """行事曆 service_types 種子"""
    # 行事曆：service_types 種子（2026-08-13 Sarah：工程項目 安裝/配管 → 施工/場勘）
    # id 1/2 = 保養/維修 active；3/4 = 安裝/配管 停用（歷史保留）；5/6 = 施工/場勘 active
    _execute_script_in_transaction(conn, """
    INSERT OR IGNORE INTO service_types (id, name, sort_order, is_active) VALUES
        (1, '保養', 1, 1),
        (2, '維修', 2, 1),
        (3, '安裝', 3, 0),
        (4, '配管', 4, 0),
        (5, '施工', 3, 1),
        (6, '場勘', 4, 1);
    """)


def _seed_units(conn):
    """單位種子"""
    # 單位種子（2026-08-16：既有 10 種 + 常見補 5 種；破碎歷史值不種子，由收編功能處理）
    # qty_type（2026-09-12 §8）：散裝可分 罐/瓶/包/桶/捲→fraction；米→decimal；其餘 integer
    _execute_script_in_transaction(conn, """
    INSERT OR IGNORE INTO units (name, sort_order, is_active, qty_type) VALUES
        ('個', 1, 1, 'integer'), ('罐', 2, 1, 'fraction'), ('瓶', 3, 1, 'fraction'), ('包', 4, 1, 'fraction'),
        ('組', 5, 1, 'integer'), ('米', 6, 1, 'decimal'), ('條', 7, 1, 'integer'), ('捲', 8, 1, 'fraction'),
        ('盤', 9, 1, 'integer'), ('套', 10, 1, 'integer'),
        ('箱', 11, 1, 'integer'), ('台', 12, 1, 'integer'), ('支', 13, 1, 'integer'), ('顆', 14, 1, 'integer'), ('桶', 15, 1, 'fraction');
    """)


def _seed_rbac_defaults(conn):
    """RBAC 角色 / 權限 / 角色預設矩陣種子"""
    # ---------- RBAC seed（2026-08-13，與 docs/RBAC-帳號權限系統-設計文件 §5 矩陣一致）----------
    _execute_script_in_transaction(conn, """
    INSERT OR IGNORE INTO roles (name, label, is_system) VALUES
        ('admin',  '🛡️ 管理員', 1),
        ('user',   '👤 使用者', 1),
        ('tech',   '🔧 工程師', 1),
        ('viewer', '👀 檢視者', 1);
    INSERT OR IGNORE INTO permissions (key, label, module) VALUES
        ('view',                 '庫存瀏覽/搜尋/看照片', 'view'),
        ('stats',                '統計數字',             'view'),
        ('kit-view',             '整組清單瀏覽',         'view'),
        ('prepared',             '待領出/已領出瀏覽',    'view'),
        ('export',               '匯出 Excel',           'view'),
        ('item-mgmt',            '品項／報價單 CRUD + 單位快速新增',  'stock'),
        ('stock-mgmt',           '庫存位置/數量調整',    'stock'),
        ('batch-loc-mgmt',       '批量修改位置',         'stock'),
        ('import',               '匯入 JSON',            'stock'),
        ('stockout',             '出庫作業',             'stock'),
        ('stocktake',            '盤點作業',             'stock'),
        ('kit-mgmt',             '整組 建立/組裝/拆解',  'stock'),
        ('photo',                '照片 上傳/刪除',       'stock'),
        ('cal-mgmt',             '行事曆派工（新增/編輯/刪除）', 'calendar'),
        ('svc-type-mgmt',        '服務項目管理',         'calendar'),
        ('gcal-sync-manage',     '行事曆同步設定',       'calendar'),
        ('gcal-sync-force',      '強制立即同步',         'calendar'),
        ('gcal-sync-team-view',  '行事曆團隊同步狀態',   'calendar'),
        ('gcal-keys-manage',     'Service Account Key 管理', 'calendar'),
        ('unit-mgmt',            '單位整理（停用/排序/收編）', 'stock'),
        ('user-mgmt',            '使用者管理',           'system'),
        ('change-own-password',  '自行改密碼',           'system'),
        ('signed-report-upload', '每日簽名日報表 上傳', 'reports'),
        ('signed-report-edit', '簽名報表 編輯本人', 'reports'),
        ('signed-report-delete', '簽名報表 刪除本人', 'reports'),
        ('signed-report-delete-all', '簽名報表 全域管理範圍', 'reports'),
        ('quotation-upload-manage', '報價單上傳 管理本人', 'reports'),
        ('quotation-upload-manage-all', '報價單上傳 全域管理範圍', 'reports'),
        ('petty-cash-delete-all', '零用金月報 全域刪除', 'reports'),
        ('petty-cash-view', '零用金月報 檢視', 'reports'),
        ('petty-cash-create', '零用金月報 新增', 'reports'),
        ('petty-cash-edit', '零用金月報 編輯', 'reports'),
        ('petty-cash-delete', '零用金月報 刪除本人', 'reports'),
        ('petty-cash-config', '零用金下拉選單管理', 'reports'),
        ('page-visibility-manage', '頁面可見性管理', 'system'),
        ('work-progress-view', '工作進度回報 檢視', 'calendar'),
        ('work-progress-create', '工作進度回報 新增', 'calendar'),
        ('work-progress-edit', '工作進度回報 編輯本人', 'calendar'),
        ('work-progress-edit-all', '工作進度回報 全域編輯', 'calendar'),
        ('work-progress-delete', '工作進度回報 刪除本人', 'calendar'),
        ('work-progress-delete-all', '工作進度回報 全域刪除', 'calendar');
    """)
    # Metadata taxonomy normalization is idempotent and preserves permission overrides.
    conn.execute(
        "UPDATE permissions SET module='reports' WHERE key IN ("
        "'signed-report-upload', 'signed-report-edit', 'signed-report-delete', "
        "'signed-report-delete-all', 'quotation-upload-manage', "
        "'quotation-upload-manage-all', 'petty-cash-delete-all', 'petty-cash-view', "
        "'petty-cash-create', 'petty-cash-edit', 'petty-cash-delete', 'petty-cash-config'"
        ")"
    )
    # 角色預設矩陣（與設計文件 §5 1:1）：key → 各角色可否
    _RBAC_DEFAULT = {
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
        'gcal-sync-force':    {'admin': 1, 'user': 0, 'tech': 0, 'viewer': 0},
        'gcal-sync-team-view':{'admin': 1, 'user': 0, 'tech': 0, 'viewer': 0},
        'gcal-keys-manage':   {'admin': 1, 'user': 0, 'tech': 0, 'viewer': 0},
        'unit-mgmt':          {'admin': 1, 'user': 0, 'tech': 0, 'viewer': 0},
        'user-mgmt':          {'admin': 1, 'user': 0, 'tech': 0, 'viewer': 0},
        'change-own-password':{'admin': 1, 'user': 1, 'tech': 1, 'viewer': 1},
        'signed-report-upload': {'admin': 1, 'user': 1, 'tech': 1, 'viewer': 0},
        # Preserve the former owner edit/delete behavior for upload-capable roles.
        'signed-report-edit': {'admin': 1, 'user': 1, 'tech': 1, 'viewer': 0},
        'signed-report-delete': {'admin': 1, 'user': 1, 'tech': 1, 'viewer': 0},
        'signed-report-delete-all':{'admin': 1, 'user': 0, 'tech': 0, 'viewer': 0},
        # Quotation upload remains login-gated for upload; these keys cover owner/global mutations.
        'quotation-upload-manage': {'admin': 1, 'user': 1, 'tech': 1, 'viewer': 1},
        'quotation-upload-manage-all': {'admin': 1, 'user': 0, 'tech': 0, 'viewer': 0},
        'petty-cash-delete-all':{'admin': 1, 'user': 0, 'tech': 0, 'viewer': 0},
        'petty-cash-view': {'admin': 1, 'user': 1, 'tech': 1, 'viewer': 1},
        'petty-cash-create': {'admin': 1, 'user': 1, 'tech': 0, 'viewer': 0},
        'petty-cash-edit': {'admin': 1, 'user': 1, 'tech': 0, 'viewer': 0},
        'petty-cash-delete': {'admin': 1, 'user': 1, 'tech': 0, 'viewer': 0},
        'petty-cash-config': {'admin': 1, 'user': 0, 'tech': 0, 'viewer': 0},
        'page-visibility-manage': {'admin': 1, 'user': 0, 'tech': 0, 'viewer': 0},
        'work-progress-view': {'admin': 1, 'user': 1, 'tech': 1, 'viewer': 1},
        'work-progress-create': {'admin': 1, 'user': 1, 'tech': 1, 'viewer': 0},
        'work-progress-edit': {'admin': 1, 'user': 1, 'tech': 1, 'viewer': 0},
        'work-progress-edit-all': {'admin': 1, 'user': 0, 'tech': 0, 'viewer': 0},
        'work-progress-delete': {'admin': 1, 'user': 1, 'tech': 1, 'viewer': 0},
        'work-progress-delete-all': {'admin': 1, 'user': 0, 'tech': 0, 'viewer': 0},
    }
    _role_ids = {r["name"]: r["id"] for r in conn.execute("SELECT id, name FROM roles").fetchall()}
    _perm_ids = {p["key"]: p["id"] for p in conn.execute("SELECT id, key FROM permissions").fetchall()}
    _rows = []
    for _key, _perms in _RBAC_DEFAULT.items():
        for _role, _on in _perms.items():
            if _on:
                _rows.append((_role_ids[_role], _perm_ids[_key]))
    conn.executemany("INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)", _rows)


def _seed_rbac_one_time_compat(conn):
    """RBAC 一次性相容遷移（以 rbac_migrations 表記錄，只跑一次）"""
    _perm_ids = {p["key"]: p["id"] for p in conn.execute("SELECT id, key FROM permissions").fetchall()}
    # One-time compatibility migration for accounts that existed before the split.
    # New accounts created after this marker rely only on the role defaults above.
    _migration_key = "signed_report_action_capabilities_v1"
    _already_migrated = conn.execute(
        "SELECT 1 FROM rbac_migrations WHERE key=?", (_migration_key,)
    ).fetchone()
    if _already_migrated is None:
        _action_ids = {
            _key: _perm_ids[_key]
            for _key in ("signed-report-edit", "signed-report-delete")
        }
        for _user in conn.execute("SELECT id FROM users").fetchall():
            # INSERT OR IGNORE preserves an already explicit new override (0 or 1).
            conn.executemany(
                "INSERT OR IGNORE INTO user_permissions (user_id, permission_id, value) VALUES (?, ?, 1)",
                [(_user["id"], _permission_id) for _permission_id in _action_ids.values()],
            )
        conn.execute(
            "INSERT INTO rbac_migrations (key) VALUES (?)", (_migration_key,)
        )

    # One-time Quotation Upload decoupling: copy only explicit legacy global overrides.
    _quotation_migration_key = "quotation_upload_permission_decoupling_v1"
    _quotation_migrated = conn.execute(
        "SELECT 1 FROM rbac_migrations WHERE key=?", (_quotation_migration_key,)
    ).fetchone()
    if _quotation_migrated is None:
        _legacy_global_id = _perm_ids["signed-report-delete-all"]
        _quotation_global_id = _perm_ids["quotation-upload-manage-all"]
        for _user in conn.execute("SELECT id FROM users").fetchall():
            _legacy_override = conn.execute(
                "SELECT value FROM user_permissions WHERE user_id=? AND permission_id=?",
                (_user["id"], _legacy_global_id),
            ).fetchone()
            if _legacy_override is not None:
                # Preserve explicit legacy 0/1, but never overwrite a new override.
                conn.execute(
                    "INSERT OR IGNORE INTO user_permissions (user_id, permission_id, value) VALUES (?, ?, ?)",
                    (_user["id"], _quotation_global_id, _legacy_override["value"]),
                )
        conn.execute(
            "INSERT INTO rbac_migrations (key) VALUES (?)", (_quotation_migration_key,)
        )


def _seed_gcal_settings_and_page_visibility(conn):
    """GCal 同步設定預設值 + 使用者頁面顯示預設"""
    # ---------- GCal 同步設定預設值（2026-08-27）----------
    _GCAL_DEFAULTS = {
        "gcal_default_duration_min": "60",
        "gcal_use_location": "1",
        "gcal_transparency": "transparent",
        "gcal_sync_interval_min": "5",
    }
    for _k, _v in _GCAL_DEFAULTS.items():
        conn.execute("INSERT OR IGNORE INTO gcal_sync_settings(key, value) VALUES(?, ?)", (_k, _v))
    # Seed only missing rows: page controls are per-user and survive later role changes.
    for _user in conn.execute("SELECT id, role FROM users").fetchall():
        _visible = initial_visible_page_keys(_user["role"])
        conn.executemany(
            "INSERT OR IGNORE INTO user_page_visibility (user_id, page_key, visible) VALUES (?, ?, ?)",
            [(_user["id"], _key, 1 if _key in _visible else 0) for _key in PAGE_KEYS],
        )


def _seed_cabinets(conn):
    """櫃子預設值（僅 fresh DB）"""
    # ---------- 櫃子預設值（2026-09-28 僅 fresh DB 時插入，不復活已刪除的櫃子）----------
    cabinet_count = conn.execute("SELECT COUNT(*) as cnt FROM cabinets").fetchone()["cnt"]
    if cabinet_count == 0:  # Fresh DB，才插入預設值
        _DEFAULT_CABINETS = [
            ("編號A", ""),
            ("編號B", ""),
            ("編號C", ""),
            ("編號D", ""),
            ("編號E", ""),
            ("編號F", ""),
            ("鐵架", ""),
            ("二樓", ""),
        ]
        for _name, _note in _DEFAULT_CABINETS:
            conn.execute("INSERT INTO cabinets (name, note) VALUES (?, ?)", (_name, _note))


SEEDS = (
    _seed_service_types,
    _seed_units,
    _seed_rbac_defaults,
    _seed_rbac_one_time_compat,
    _seed_gcal_settings_and_page_visibility,
    _seed_cabinets,
)


def run_seeds(conn) -> None:
    """依序寫入全部種子資料（呼叫端負責交易邊界）。"""
    for seed in SEEDS:
        seed(conn)
