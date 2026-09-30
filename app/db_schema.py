# -*- coding: utf-8 -*-
"""
資料庫 schema（DDL）
====================
全部使用 CREATE TABLE / INDEX IF NOT EXISTS，可對既有資料庫重複執行。
欄位補齊（ALTER TABLE）與資料回填在 app/db_migrations.py，種子資料在 app/db_seeds.py；
執行順序由 app/database.py 的 _exec_init 決定：schema → migrations → seeds。
"""
import sqlite3


def execute_script_in_transaction(conn: sqlite3.Connection, script: str) -> None:
    """Execute a SQL script statement-by-statement without committing implicitly.

    ``sqlite3.Connection.executescript`` commits an active transaction before
    running a script. Initialization must keep schema, migrations, and seeds
    under one rollback boundary, so statements are split with SQLite's parser
    and executed through the existing connection instead.

    Args:
        conn: Active SQLite connection that owns the initialization transaction.
        script: SQL script containing one or more complete statements.

    Raises:
        sqlite3.ProgrammingError: If the script contains an incomplete statement.
    """
    pending: list[str] = []
    for char in script:
        pending.append(char)
        if char == ";":
            statement = "".join(pending)
            if sqlite3.complete_statement(statement):
                if statement.strip():
                    conn.execute(statement)
                pending.clear()

    trailing = "".join(pending).strip()
    if trailing:
        if not sqlite3.complete_statement(trailing + ";"):
            raise sqlite3.ProgrammingError("incomplete SQL initialization statement")
        conn.execute(trailing)


SCHEMA_SQL = """
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
        -- Legacy fallback; production movement writers explicitly set Taipei business time.
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
    CREATE TABLE IF NOT EXISTS kit_locations (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        kit_id      INTEGER NOT NULL REFERENCES kits(id) ON DELETE CASCADE,
        cabinet     TEXT NOT NULL DEFAULT '',
        position    TEXT NOT NULL DEFAULT '',
        note        TEXT DEFAULT '',
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS cabinets (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT NOT NULL UNIQUE,
        note        TEXT DEFAULT '',
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
    -- qty_type（2026-09-12 數量系統：integer 整數 / decimal 小數 / fraction 分數小數）
    CREATE TABLE IF NOT EXISTS units (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT NOT NULL UNIQUE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_active  INTEGER NOT NULL DEFAULT 1,
        qty_type   TEXT NOT NULL DEFAULT 'integer'
    );
    -- Google 行事曆同步 key（2026-08-27 方案 C：家豪統建 SA）
    CREATE TABLE IF NOT EXISTS gcal_keys (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            name             TEXT NOT NULL UNIQUE,
            credentials_path TEXT NOT NULL,
            calendar_id      TEXT NOT NULL,
            pending_calendar_id TEXT,
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
    CREATE TABLE IF NOT EXISTS rbac_migrations (
        key         TEXT PRIMARY KEY,
        applied_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
    -- 2026-09 效能：匯出日期區間、待領出最新說明、套件 BOM、盤點紀錄
    CREATE INDEX IF NOT EXISTS idx_movements_created ON movements(created_at);
    CREATE INDEX IF NOT EXISTS idx_movements_item_reason ON movements(item_id, reason, id);
    CREATE INDEX IF NOT EXISTS idx_kit_items_kit ON kit_items(kit_id);
    CREATE INDEX IF NOT EXISTS idx_kit_items_item ON kit_items(item_id);
    CREATE INDEX IF NOT EXISTS idx_kits_item ON kits(item_id);
    CREATE INDEX IF NOT EXISTS idx_stocktakes_date ON stocktakes(take_date);
    CREATE INDEX IF NOT EXISTS idx_stocktakes_item ON stocktakes(item_id);
    CREATE INDEX IF NOT EXISTS idx_appt_date ON appointments(date);
    CREATE INDEX IF NOT EXISTS idx_appt_date_start ON appointments(date, start_time);
    CREATE INDEX IF NOT EXISTS idx_appt_svc ON appointments(service_type_id);
    CREATE INDEX IF NOT EXISTS idx_assignees_appt ON appointment_assignees(appointment_id);

    -- Page visibility (2026-09-17)
    CREATE TABLE IF NOT EXISTS user_page_visibility (
        user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        page_key TEXT NOT NULL,
        visible  INTEGER NOT NULL DEFAULT 1 CHECK (visible IN (0, 1)),
        PRIMARY KEY (user_id, page_key)
    );
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
    -- 每日工作進度回報（獨立歷史紀錄；appointment 刪除時保留 snapshot）
    CREATE TABLE IF NOT EXISTS daily_work_progress_reports (
        id                        INTEGER PRIMARY KEY AUTOINCREMENT,
        appointment_id            INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
        report_date               TEXT NOT NULL,
        uploader_user_id          INTEGER REFERENCES users(id) ON DELETE SET NULL,
        uploader_name             TEXT NOT NULL DEFAULT '',
        note                      TEXT NOT NULL DEFAULT '',
        client_name_snapshot      TEXT NOT NULL DEFAULT '',
        address_snapshot          TEXT NOT NULL DEFAULT '',
        service_name_snapshot     TEXT NOT NULL DEFAULT '',
        start_time_snapshot       TEXT NOT NULL DEFAULT '',
        end_time_snapshot         TEXT NOT NULL DEFAULT '',
        appointment_note_snapshot TEXT NOT NULL DEFAULT '',
        created_at                TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        updated_at                TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_work_progress_appointment_unique
        ON daily_work_progress_reports(appointment_id)
        WHERE appointment_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_work_progress_date
        ON daily_work_progress_reports(report_date, id DESC);
    CREATE INDEX IF NOT EXISTS idx_work_progress_uploader
        ON daily_work_progress_reports(uploader_user_id);
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
    CREATE UNIQUE INDEX IF NOT EXISTS idx_file_assets_one_item_photo ON file_assets(category, owner_type, owner_id) WHERE category='item_photo' AND owner_type='item';
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
    -- 零用金月報（2026-09-12：report / entry / entry_item 三層獨立，與簽名報表不共用資料）
    CREATE TABLE IF NOT EXISTS petty_cash_reports (
        id                      INTEGER PRIMARY KEY AUTOINCREMENT,
        report_type             TEXT NOT NULL DEFAULT 'general',
        start_date              TEXT NOT NULL,
        end_date                TEXT NOT NULL,
        filename_text           TEXT NOT NULL DEFAULT '',
        upload_person           TEXT NOT NULL,
        uploader_user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
        prepared_by             TEXT NOT NULL DEFAULT '',
        opening_balance         REAL NOT NULL DEFAULT 0,
        opening_balance_source  TEXT NOT NULL DEFAULT 'manual',
        status                  TEXT NOT NULL DEFAULT 'draft',
        last_exported_at        TEXT DEFAULT '',
        created_by              INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS petty_cash_entries (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        report_id       INTEGER NOT NULL REFERENCES petty_cash_reports(id) ON DELETE CASCADE,
        entry_date      TEXT NOT NULL,
        entry_type      TEXT NOT NULL DEFAULT 'expense',
        description     TEXT NOT NULL DEFAULT '',
        amount          REAL NOT NULL DEFAULT 0,
        category        TEXT DEFAULT '',
        sort_order      INTEGER NOT NULL DEFAULT 0,
        created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS petty_cash_entry_items (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        entry_id    INTEGER NOT NULL REFERENCES petty_cash_entries(id) ON DELETE CASCADE,
        item_name   TEXT NOT NULL,
        qty         REAL NOT NULL DEFAULT 1,
        unit        TEXT DEFAULT '',
        amount      REAL NOT NULL DEFAULT 0,
        sort_order  INTEGER NOT NULL DEFAULT 0,
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS petty_cash_master_options (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        report_type TEXT NOT NULL CHECK(report_type IN ('general','engineering')),
        option_type TEXT NOT NULL CHECK(option_type IN ('category','group')),
        name TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(report_type, option_type, name)
    );
    CREATE INDEX IF NOT EXISTS idx_petty_cash_options_lookup
        ON petty_cash_master_options(report_type, option_type, is_active, sort_order);
    CREATE INDEX IF NOT EXISTS idx_petty_cash_reports_person ON petty_cash_reports(upload_person);
    CREATE INDEX IF NOT EXISTS idx_petty_cash_reports_dates ON petty_cash_reports(start_date, end_date);
    CREATE INDEX IF NOT EXISTS idx_petty_cash_reports_status ON petty_cash_reports(status);
    CREATE INDEX IF NOT EXISTS idx_petty_cash_entries_report ON petty_cash_entries(report_id);
    CREATE INDEX IF NOT EXISTS idx_petty_cash_entries_date ON petty_cash_entries(entry_date);
    CREATE INDEX IF NOT EXISTS idx_petty_cash_items_entry ON petty_cash_entry_items(entry_id);
    CREATE TABLE IF NOT EXISTS engineering_expense_categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT, report_id INTEGER NOT NULL REFERENCES petty_cash_reports(id) ON DELETE CASCADE,
        name TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS engineering_expense_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT, category_id INTEGER NOT NULL REFERENCES engineering_expense_categories(id) ON DELETE CASCADE,
        name TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS engineering_expense_receipts (
        id INTEGER PRIMARY KEY AUTOINCREMENT, group_id INTEGER NOT NULL REFERENCES engineering_expense_groups(id) ON DELETE CASCADE,
        tax_id_mark TEXT NOT NULL DEFAULT '', receipt_number TEXT NOT NULL DEFAULT '', amount NUMERIC NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS engineering_expense_details (
        id INTEGER PRIMARY KEY AUTOINCREMENT, receipt_id INTEGER NOT NULL REFERENCES engineering_expense_receipts(id) ON DELETE CASCADE,
        description TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_engineering_categories_report ON engineering_expense_categories(report_id);
    CREATE INDEX IF NOT EXISTS idx_engineering_groups_category ON engineering_expense_groups(category_id);
    CREATE INDEX IF NOT EXISTS idx_engineering_receipts_group ON engineering_expense_receipts(group_id);
    CREATE INDEX IF NOT EXISTS idx_engineering_details_receipt ON engineering_expense_details(receipt_id);
"""
