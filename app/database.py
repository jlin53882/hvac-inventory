# -*- coding: utf-8 -*-
"""
資料庫層
========
- get_db()：開啟 SQLite 連線
- init_db()：建立資料表（items 主檔 + item_stocks 位置庫存）
"""
import sqlite3

from app.services.app_log import get_logger

logger = get_logger(__name__)

from app.config import DB_PATH


def get_db():
    """開啟 SQLite 連線（row_factory=Row + 啟用外鍵 + WAL 併發調校），回傳連線物件

    2026-08-14：併發修復——timeout=10 + WAL（讀寫不互擋）+ busy_timeout（鎖競爭等 5 秒不直接拋）
    + synchronous=NORMAL（WAL 下安全，寫入更快）
    """
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")      # 讀寫不互擋（持久設定，重複執行無害）
    conn.execute("PRAGMA busy_timeout = 10000")    # 等鎖 10 秒（與 connect timeout=10 對齊，不直接拋）
    conn.execute("PRAGMA synchronous = NORMAL")    # WAL 下 NORMAL 已安全，寫入更快
    return conn


def init_db():
    """建立所有資料表與索引，並執行舊資料庫（v10 前）的欄位遷移"""
    conn = get_db()
    try:
        _exec_init(conn)
    except Exception:
        conn.rollback()   # 2026-08-14 鎖洩漏根治：init_db 中途炸（雙開 server 搶 DB 等）確保釋放 RESERVED 鎖
        raise
    finally:
        conn.close()


def _exec_init(conn):
    """init_db 主體（conn 已開）：schema + migration + seed。
    薄殼化（2026-08-14）：init_db 只負責 conn 生命週期，主體抽出讓 try/finally 可包住
    ——雙開 server 搶 DB 時 init 中途炸也不會漏 conn
    """
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS items (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        brand       TEXT NOT NULL DEFAULT '',
        code        TEXT DEFAULT '',
        name        TEXT NOT NULL,
        prepared_qty REAL NOT NULL DEFAULT 0,
        unit        TEXT NOT NULL DEFAULT '個',
        low_stock   REAL DEFAULT 0,
        is_kit      INTEGER NOT NULL DEFAULT 0,
        site        TEXT NOT NULL DEFAULT 'office',
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS item_stocks (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id     INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        location    TEXT DEFAULT '',
        qty         REAL NOT NULL DEFAULT 0,
        note        TEXT DEFAULT '',
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(item_id, location)
    );
    CREATE TABLE IF NOT EXISTS movements (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id     INTEGER NOT NULL REFERENCES items(id),
        delta       REAL NOT NULL,
        before_qty  REAL NOT NULL DEFAULT 0,
        after_qty   REAL NOT NULL DEFAULT 0,
        reason      TEXT DEFAULT '',
        destination TEXT DEFAULT '',
        reverted_at TIMESTAMP,
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS stocktakes (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        take_date   TEXT NOT NULL,
        item_id     INTEGER NOT NULL REFERENCES items(id),
        location    TEXT DEFAULT '',
        system_qty  REAL NOT NULL DEFAULT 0,
        actual_qty  REAL NOT NULL DEFAULT 0,
        diff        REAL NOT NULL DEFAULT 0,
        note        TEXT DEFAULT '',
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS kits (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id     INTEGER NOT NULL REFERENCES items(id),
        name        TEXT NOT NULL,
        note        TEXT DEFAULT '',
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at  TIMESTAMP   -- 2026-08-14 樂觀鎖（併發編輯防覆蓋）
    );
    CREATE TABLE IF NOT EXISTS kit_items (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        kit_id      INTEGER NOT NULL REFERENCES kits(id),
        item_id     INTEGER NOT NULL REFERENCES items(id),
        qty         REAL NOT NULL DEFAULT 1,
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS users (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        username        TEXT NOT NULL UNIQUE,
        password_hash   TEXT NOT NULL,
        display_name    TEXT DEFAULT '',
        role            TEXT NOT NULL DEFAULT 'user',
        is_active       INTEGER NOT NULL DEFAULT 1,
        failed_attempts INTEGER NOT NULL DEFAULT 0,
        locked_until    TIMESTAMP,
        created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS sessions (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP NOT NULL
    );
    CREATE TABLE IF NOT EXISTS service_types (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT NOT NULL UNIQUE,
        sort_order  INTEGER NOT NULL DEFAULT 0,
        is_active   INTEGER NOT NULL DEFAULT 1,
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- 單位字典（2026-08-16 單位動態清單：全站 4 個 modal 共用，UI 可新增/停用/排序）
    CREATE TABLE IF NOT EXISTS units (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT NOT NULL UNIQUE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_active  INTEGER NOT NULL DEFAULT 1
    );
    -- Google 行事曆同步 key（2026-08-27 方案 C：家豪統建 SA）
    CREATE TABLE IF NOT EXISTS gcal_keys (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            name             TEXT NOT NULL UNIQUE,
            credentials_path TEXT NOT NULL,
            calendar_id      TEXT NOT NULL,
            is_active        INTEGER NOT NULL DEFAULT 1,
            reminders        TEXT DEFAULT '[{"method":"popup","minutes":30},{"method":"email","minutes":60}]',
            created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        -- Google 行事曆同步設定（2026-08-27 設定頁）
    CREATE TABLE IF NOT EXISTS gcal_sync_settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
    CREATE TABLE IF NOT EXISTS appointment_sync_queue (
        appointment_id   INTEGER NOT NULL,
        key_id           INTEGER NOT NULL REFERENCES gcal_keys(id) ON DELETE CASCADE,
        op_type          TEXT NOT NULL CHECK (op_type IN ('C','U','D')),
        google_event_id  TEXT DEFAULT '',
        last_modified_at TEXT NOT NULL,
        attempts         INTEGER NOT NULL DEFAULT 0,
        last_error       TEXT DEFAULT '',
        PRIMARY KEY (appointment_id, key_id)
    );

    -- Google 行事曆事件對映（複合主鍵）
    CREATE TABLE IF NOT EXISTS appointment_gcal_map (
        appointment_id   INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
        key_id           INTEGER NOT NULL REFERENCES gcal_keys(id) ON DELETE CASCADE,
        google_event_id  TEXT NOT NULL,
        data_hash        TEXT DEFAULT '',
        synced_at        TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (appointment_id, key_id)
    );
    CREATE TABLE IF NOT EXISTS appointments (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        client_name     TEXT NOT NULL,               -- 客戶姓名與戶號 / 案場
        address         TEXT DEFAULT '',             -- 地址（選填，匯出日報表進備註區）
        service_type_id INTEGER REFERENCES service_types(id),
        date            TEXT NOT NULL,               -- YYYY-MM-DD
        start_time      TEXT NOT NULL,               -- HH:MM（字串排序即時間序）
        end_time        TEXT NOT NULL,
        note            TEXT DEFAULT '',
        created_by      INTEGER REFERENCES users(id),
        created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_by      INTEGER REFERENCES users(id)   -- 2026-08-13：最後編輯者（Sarah：編輯非新增者要顯示）
    );
    CREATE TABLE IF NOT EXISTS appointment_assignees (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
        user_id        INTEGER NOT NULL REFERENCES users(id),
        UNIQUE(appointment_id, user_id)
    );
    -- RBAC（2026-08-13）：角色/權限/角色預設模板/個人覆蓋/稽核軌跡
    CREATE TABLE IF NOT EXISTS roles (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        name      TEXT NOT NULL UNIQUE,
        label     TEXT NOT NULL,
        is_system INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS permissions (
        id     INTEGER PRIMARY KEY AUTOINCREMENT,
        key    TEXT NOT NULL UNIQUE,
        label  TEXT NOT NULL,
        module TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS role_permissions (
        role_id       INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
        PRIMARY KEY (role_id, permission_id)
    );
    CREATE TABLE IF NOT EXISTS user_permissions (
        user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
        value         INTEGER NOT NULL CHECK (value IN (0, 1)),
        updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, permission_id)
    );
    -- 稽核軌跡：operator/target 用 SET NULL——刪帳號不滅證（稽核 A1）
    CREATE TABLE IF NOT EXISTS user_audit_log (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        operator_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        target_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
        action      TEXT NOT NULL,
        detail      TEXT NOT NULL DEFAULT '',
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_audit_target ON user_audit_log(target_id);
    CREATE INDEX IF NOT EXISTS idx_audit_time  ON user_audit_log(created_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_items_brand ON items(brand);
    CREATE INDEX IF NOT EXISTS idx_stocks_item ON item_stocks(item_id);
    CREATE INDEX IF NOT EXISTS idx_stocks_location ON item_stocks(location);
    CREATE INDEX IF NOT EXISTS idx_stocks_item_location ON item_stocks(item_id, location);
    CREATE INDEX IF NOT EXISTS idx_movements_item ON movements(item_id);
    CREATE INDEX IF NOT EXISTS idx_appt_date ON appointments(date);
    CREATE INDEX IF NOT EXISTS idx_appt_date_start ON appointments(date, start_time);
    CREATE INDEX IF NOT EXISTS idx_appt_svc ON appointments(service_type_id);
    CREATE INDEX IF NOT EXISTS idx_assignees_appt ON appointment_assignees(appointment_id);
    CREATE INDEX IF NOT EXISTS idx_assignees_user_appt ON appointment_assignees(user_id, appointment_id);
    -- 每日簽名報表（2026-09-06 簽名報表模組）
    CREATE TABLE IF NOT EXISTS daily_signed_reports (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        report_date       TEXT NOT NULL,
        uploader_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
        uploader_name     TEXT NOT NULL,
        upload_time       TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        file_name         TEXT NOT NULL,
        stored_path       TEXT NOT NULL,
        file_size         INTEGER NOT NULL DEFAULT 0,
        mime_type         TEXT DEFAULT '',
        note              TEXT DEFAULT '',
        created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_dsr_date ON daily_signed_reports(report_date);
    CREATE INDEX IF NOT EXISTS idx_dsr_upload_time ON daily_signed_reports(upload_time);
    CREATE INDEX IF NOT EXISTS idx_dsr_uploader ON daily_signed_reports(uploader_user_id);
    -- 報價單上傳（沿用每日簽名日報表邏輯，獨立儲存）
    CREATE TABLE IF NOT EXISTS quotation_uploads (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        report_date       TEXT NOT NULL,
        uploader_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
        uploader_name     TEXT NOT NULL,
        upload_time       TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        file_name         TEXT NOT NULL,
        stored_path       TEXT NOT NULL,
        file_size         INTEGER NOT NULL DEFAULT 0,
        mime_type         TEXT DEFAULT '',
        note              TEXT DEFAULT '',
        created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_qup_date ON quotation_uploads(report_date);
    CREATE INDEX IF NOT EXISTS idx_qup_upload_time ON quotation_uploads(upload_time);
    CREATE INDEX IF NOT EXISTS idx_qup_uploader ON quotation_uploads(uploader_user_id);
    -- 統一檔案/圖片 metadata（original + preview + thumbnail）
    CREATE TABLE IF NOT EXISTS file_assets (
        asset_id             TEXT PRIMARY KEY,
        category             TEXT NOT NULL,
        owner_type           TEXT NOT NULL,
        owner_id             TEXT NOT NULL,
        original_name        TEXT NOT NULL DEFAULT '',
        mime_type            TEXT NOT NULL DEFAULT '',
        original_path        TEXT NOT NULL,
        preview_path         TEXT,
        thumbnail_path       TEXT,
        original_size        INTEGER NOT NULL DEFAULT 0,
        preview_size         INTEGER,
        thumbnail_size       INTEGER,
        width                INTEGER,
        height               INTEGER,
        compression_method   TEXT NOT NULL DEFAULT 'none',
        compression_version  TEXT NOT NULL DEFAULT 'original-v1',
        sha256               TEXT NOT NULL,
        created_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_file_assets_owner ON file_assets(category, owner_type, owner_id);
    CREATE INDEX IF NOT EXISTS idx_file_assets_sha256 ON file_assets(sha256);
    -- 報價單（2026-09-09 報價單模組）
    CREATE TABLE IF NOT EXISTS quotations (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        quote_number   TEXT NOT NULL UNIQUE,
        quote_date     TEXT NOT NULL,
        customer_name  TEXT NOT NULL,
        contact        TEXT DEFAULT '',
        address        TEXT DEFAULT '',
        valid_days     INTEGER NOT NULL DEFAULT 30,
        tax_type       TEXT NOT NULL DEFAULT 'included',
        note           TEXT DEFAULT '',
        created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS quotation_items (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        quotation_id       INTEGER NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
        inventory_item_id  INTEGER REFERENCES items(id) ON DELETE SET NULL,
        item_name          TEXT NOT NULL,
        specification      TEXT DEFAULT '',
        qty                REAL NOT NULL,
        unit               TEXT NOT NULL DEFAULT '式',
        unit_price         REAL NOT NULL DEFAULT 0,
        sort_order         INTEGER NOT NULL DEFAULT 0,
        created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_quotations_date ON quotations(quote_date);
    CREATE INDEX IF NOT EXISTS idx_quotations_customer ON quotations(customer_name);
    CREATE INDEX IF NOT EXISTS idx_quotation_items_quote ON quotation_items(quotation_id);
    CREATE INDEX IF NOT EXISTS idx_quotation_uploads_date_id ON quotation_uploads(report_date, id DESC);
    CREATE INDEX IF NOT EXISTS idx_signed_reports_date_id ON daily_signed_reports(report_date, id DESC);
    """);

    # 舊資料庫遷移（v10 前）：items 若有 qty/location/note 欄位 → 需跑 scripts/migrate_v10.py
    item_cols = [r[1] for r in conn.execute("PRAGMA table_info(items)").fetchall()]
    if "qty" in item_cols:
        logger.info("[migrate] items 仍含舊欄位 qty — 請執行 scripts/migrate_v10.py 後再啟動！")
    if "prepared_qty" not in item_cols:
        conn.execute("ALTER TABLE items ADD COLUMN prepared_qty REAL NOT NULL DEFAULT 0")
        logger.info("[migrate] items.prepared_qty 欄位已新增")
    if "is_kit" not in item_cols:
        conn.execute("ALTER TABLE items ADD COLUMN is_kit INTEGER NOT NULL DEFAULT 0")
        logger.info("[migrate] items.is_kit 欄位已新增")
    if "site" not in item_cols:
        conn.execute("ALTER TABLE items ADD COLUMN site TEXT NOT NULL DEFAULT 'office'")
        logger.info("[migrate] items.site 欄位已新增")
    user_cols = [r[1] for r in conn.execute("PRAGMA table_info(users)").fetchall()]
    if "password_updated_at" not in user_cols:
        conn.execute("ALTER TABLE users ADD COLUMN password_updated_at TIMESTAMP")
        conn.execute("UPDATE users SET password_updated_at = COALESCE(password_updated_at, created_at, datetime('now'))")
        logger.info("[migrate] users.password_updated_at 欄位已新增（既有帳號以建立時間起算）")
    if "color" not in user_cols:
        conn.execute("ALTER TABLE users ADD COLUMN color TEXT DEFAULT '#1a73e8'")
        logger.info("[migrate] users.color 欄位已新增（行事曆人員顏色）")
    if "gcal_key" not in user_cols:
        conn.execute("ALTER TABLE users ADD COLUMN gcal_key TEXT DEFAULT ''")
        logger.info("[migrate] users.gcal_key 欄位已新增（Google 行事曆同步 key）")
    appt_cols = [r[1] for r in conn.execute("PRAGMA table_info(appointments)").fetchall()]
    if "updated_by" not in appt_cols:
        conn.execute("ALTER TABLE appointments ADD COLUMN updated_by INTEGER REFERENCES users(id)")
        logger.info("[migrate] appointments.updated_by 欄位已新增（最後編輯者）")
    item_cols = [r[1] for r in conn.execute("PRAGMA table_info(items)").fetchall()]
    if "is_deleted" not in item_cols:
        conn.execute("ALTER TABLE items ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0")
        logger.info("[migrate] items.is_deleted 欄位已新增（soft-delete）")
    if "category" not in item_cols:
        conn.execute("ALTER TABLE items ADD COLUMN category TEXT DEFAULT ''")
        logger.info("[migrate] items.category 欄位已新增（品項分類）")
        # 批量填入：從品項名稱自動推斷分類（一次性 migration）
        import re
        def _infer(name):
            n = (name or '').lower()
            if re.search(r'遙控|遙器|控制器|線控', n): return '遙控器'
            if re.search(r'基板|控制板|PCB|電路', n): return '電子零件'
            if re.search(r'線圈|接觸器|繼電器|開關|插座|斷路|跳脫', n): return '電氣配件'
            if re.search(r'管|銅|鐵氟龍|配管', n): return '管材'
            if re.search(r'劑|脂|膠|發泡|樹脂', n): return '化學品'
            if re.search(r'濾|網|棉|濾網', n): return '過濾耗材'
            if re.search(r'馬達|風扇|壓縮|軸流', n): return '動力設備'
            if re.search(r'面板|蓋板|外殼|支架|固定', n): return '外觀/結構'
            return ''
        rows = conn.execute("SELECT id, name FROM items WHERE is_deleted=0 AND (category IS NULL OR category='')").fetchall()
        for r in rows:
            cat = _infer(r["name"])
            if cat:
                conn.execute("UPDATE items SET category=? WHERE id=?", (cat, r["id"]))
        if rows:
            logger.info(f"[migrate] items.category 批量推斷填入完成（{len(rows)} 筆待填）")
    kit_cols = [r[1] for r in conn.execute("PRAGMA table_info(kits)").fetchall()]
    if "updated_at" not in kit_cols:
        conn.execute("ALTER TABLE kits ADD COLUMN updated_at TIMESTAMP")
        logger.info("[migrate] kits.updated_at 欄位已新增（樂觀鎖）")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_items_site_active ON items(site, is_deleted, brand)")
    # M5：items 唯一約束（併發重複防線）——有重複資料則跳過建索引並警告（不自動刪資料）
    dup_row = conn.execute(
        "SELECT COUNT(*) AS c FROM (SELECT 1 FROM items GROUP BY brand, COALESCE(code,''), name, unit, site HAVING COUNT(*) > 1)"
    ).fetchone()
    if dup_row and dup_row["c"] == 0:
        conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_items_unique ON items(brand, COALESCE(code,''), name, unit, site)")
    elif dup_row:
        logger.warning(f"[migrate] 警告：items 有 {dup_row['c']} 組重複品項，跳過唯一索引（請人工清理後重啟）")
    mov_cols = [r[1] for r in conn.execute("PRAGMA table_info(movements)").fetchall()]
    if "destination" not in mov_cols:
        conn.execute("ALTER TABLE movements ADD COLUMN destination TEXT DEFAULT ''")
        logger.info("[migrate] movements.destination 欄位已新增")
    if "reverted_at" not in mov_cols:
        conn.execute("ALTER TABLE movements ADD COLUMN reverted_at TIMESTAMP")
        logger.info("[migrate] movements.reverted_at 欄位已新增（退回已領出防重複）")
    if "source_movement_id" not in mov_cols:
        conn.execute("ALTER TABLE movements ADD COLUMN source_movement_id INTEGER REFERENCES movements(id)")
        logger.info("[migrate] movements.source_movement_id 欄位已新增（退回連結原始出庫）")
    for col, ddl in (
        ("source_stock_id", "INTEGER REFERENCES item_stocks(id)"),
        ("source_site", "TEXT DEFAULT ''"),
        ("source_location", "TEXT DEFAULT ''"),
        ("return_stock_id", "INTEGER REFERENCES item_stocks(id)"),
        ("return_site", "TEXT DEFAULT ''"),
        ("return_location", "TEXT DEFAULT ''"),
    ):
        if col not in mov_cols:
            conn.execute(f"ALTER TABLE movements ADD COLUMN {col} {ddl}")
            logger.info(f"[migrate] movements.{col} 欄位已新增（出庫/退回位置追蹤）")
    # M6：gcal_keys.reminders 欄位（2026-08-27 per-key 提醒）
    gcal_cols = [r[1] for r in conn.execute("PRAGMA table_info(gcal_keys)").fetchall()]
    if "reminders" not in gcal_cols:
        conn.execute("ALTER TABLE gcal_keys ADD COLUMN reminders TEXT DEFAULT '[{\"method\":\"popup\",\"minutes\":30},{\"method\":\"email\",\"minutes\":60}]'")
        logger.info("[migrate] gcal_keys.reminders 欄位已新增（per-key 提醒）")
    # M7：gcal_sync_settings 表（2026-08-27 同步設定頁）
    conn.execute("""CREATE TABLE IF NOT EXISTS gcal_sync_settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )""")
    # M8：appointment_gcal_map.data_hash（2026-08-28 同步 hash 比對用）
    map_cols = [r[1] for r in conn.execute("PRAGMA table_info(appointment_gcal_map)").fetchall()]
    if "data_hash" not in map_cols:
        conn.execute("ALTER TABLE appointment_gcal_map ADD COLUMN data_hash TEXT DEFAULT ''")
        logger.info("[migrate] appointment_gcal_map.data_hash 欄位已新增（同步 hash 比對）")
    # 行事曆：service_types 種子（2026-08-13 Sarah：工程項目 安裝/配管 → 施工/場勘）
    # id 1/2 = 保養/維修 active；3/4 = 安裝/配管 停用（歷史保留）；5/6 = 施工/場勘 active
    conn.executescript("""
    INSERT OR IGNORE INTO service_types (id, name, sort_order, is_active) VALUES
        (1, '保養', 1, 1),
        (2, '維修', 2, 1),
        (3, '安裝', 3, 0),
        (4, '配管', 4, 0),
        (5, '施工', 3, 1),
        (6, '場勘', 4, 1);
    """)
    # 單位種子（2026-08-16：既有 10 種 + 常見補 5 種；破碎歷史值不種子，由收編功能處理）
    conn.executescript("""
    INSERT OR IGNORE INTO units (name, sort_order, is_active) VALUES
        ('個', 1, 1), ('罐', 2, 1), ('瓶', 3, 1), ('包', 4, 1),
        ('組', 5, 1), ('米', 6, 1), ('條', 7, 1), ('捲', 8, 1),
        ('盤', 9, 1), ('套', 10, 1),
        ('箱', 11, 1), ('台', 12, 1), ('支', 13, 1), ('顆', 14, 1), ('桶', 15, 1);
    """)
    # ---------- RBAC seed（2026-08-13，與 docs/RBAC-帳號權限系統-設計文件 §5 矩陣一致）----------
    conn.executescript("""
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
        ('item-mgmt',            '品項 新增/編輯/刪除',  'stock'),
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
        ('gcal-keys-manage',     'Service Account Key 管理', 'calendar'),
        ('unit-mgmt',            '單位整理（停用/排序/收編）', 'stock'),
        ('user-mgmt',            '使用者管理',           'system'),
        ('change-own-password',  '自行改密碼',           'system'),
        ('signed-report-delete-all', '簽名報表 全域刪除', 'calendar');
    """)
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
        'gcal-keys-manage':   {'admin': 1, 'user': 0, 'tech': 0, 'viewer': 0},
        'unit-mgmt':          {'admin': 1, 'user': 0, 'tech': 0, 'viewer': 0},
        'user-mgmt':          {'admin': 1, 'user': 0, 'tech': 0, 'viewer': 0},
        'change-own-password':{'admin': 1, 'user': 0, 'tech': 0, 'viewer': 0},
        'signed-report-delete-all':{'admin': 1, 'user': 0, 'tech': 0, 'viewer': 0},
    }
    _role_ids = {r["name"]: r["id"] for r in conn.execute("SELECT id, name FROM roles").fetchall()}
    _perm_ids = {p["key"]: p["id"] for p in conn.execute("SELECT id, key FROM permissions").fetchall()}
    _rows = []
    for _key, _perms in _RBAC_DEFAULT.items():
        for _role, _on in _perms.items():
            if _on:
                _rows.append((_role_ids[_role], _perm_ids[_key]))
    conn.executemany("INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)", _rows)
    # ---------- GCal 同步設定預設值（2026-08-27）----------
    _GCAL_DEFAULTS = {
        "gcal_default_duration_min": "60",
        "gcal_use_location": "1",
        "gcal_transparency": "transparent",
        "gcal_sync_interval_min": "5",
    }
    for _k, _v in _GCAL_DEFAULTS.items():
        conn.execute("INSERT OR IGNORE INTO gcal_sync_settings(key, value) VALUES(?, ?)", (_k, _v))
    conn.commit()