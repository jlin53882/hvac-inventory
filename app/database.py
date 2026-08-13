# -*- coding: utf-8 -*-
"""
資料庫層
========
- get_db()：開啟 SQLite 連線
- init_db()：建立資料表（items 主檔 + item_stocks 位置庫存）
"""
import sqlite3

from app.config import DB_PATH


def get_db():
    """開啟 SQLite 連線（row_factory=Row + 啟用外鍵），回傳連線物件"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    """建立所有資料表與索引，並執行舊資料庫（v10 前）的欄位遷移"""
    conn = get_db()
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
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
        updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS appointment_assignees (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
        user_id        INTEGER NOT NULL REFERENCES users(id),
        UNIQUE(appointment_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_items_brand ON items(brand);
    CREATE INDEX IF NOT EXISTS idx_stocks_item ON item_stocks(item_id);
    CREATE INDEX IF NOT EXISTS idx_stocks_location ON item_stocks(location);
    CREATE INDEX IF NOT EXISTS idx_movements_item ON movements(item_id);
    CREATE INDEX IF NOT EXISTS idx_appt_date ON appointments(date);
    CREATE INDEX IF NOT EXISTS idx_appt_svc ON appointments(service_type_id);
    CREATE INDEX IF NOT EXISTS idx_assignees_appt ON appointment_assignees(appointment_id);
    """);

    # 舊資料庫遷移（v10 前）：items 若有 qty/location/note 欄位 → 需跑 scripts/migrate_v10.py
    item_cols = [r[1] for r in conn.execute("PRAGMA table_info(items)").fetchall()]
    if "qty" in item_cols:
        print("[migrate] items 仍含舊欄位 qty — 請執行 scripts/migrate_v10.py 後再啟動！")
    if "prepared_qty" not in item_cols:
        conn.execute("ALTER TABLE items ADD COLUMN prepared_qty REAL NOT NULL DEFAULT 0")
        print("[migrate] items.prepared_qty 欄位已新增")
    if "is_kit" not in item_cols:
        conn.execute("ALTER TABLE items ADD COLUMN is_kit INTEGER NOT NULL DEFAULT 0")
        print("[migrate] items.is_kit 欄位已新增")
    if "site" not in item_cols:
        conn.execute("ALTER TABLE items ADD COLUMN site TEXT NOT NULL DEFAULT 'office'")
        print("[migrate] items.site 欄位已新增")
    user_cols = [r[1] for r in conn.execute("PRAGMA table_info(users)").fetchall()]
    if "password_updated_at" not in user_cols:
        conn.execute("ALTER TABLE users ADD COLUMN password_updated_at TIMESTAMP")
        conn.execute("UPDATE users SET password_updated_at = COALESCE(password_updated_at, created_at, datetime('now'))")
        print("[migrate] users.password_updated_at 欄位已新增（既有帳號以建立時間起算）")
    if "color" not in user_cols:
        conn.execute("ALTER TABLE users ADD COLUMN color TEXT DEFAULT '#1a73e8'")
        print("[migrate] users.color 欄位已新增（行事曆人員顏色）")
    item_cols = [r[1] for r in conn.execute("PRAGMA table_info(items)").fetchall()]
    if "is_deleted" not in item_cols:
        conn.execute("ALTER TABLE items ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0")
        print("[migrate] items.is_deleted 欄位已新增（soft-delete）")
    # M5：items 唯一約束（併發重複防線）——有重複資料則跳過建索引並警告（不自動刪資料）
    dup_row = conn.execute(
        "SELECT COUNT(*) AS c FROM (SELECT 1 FROM items GROUP BY brand, COALESCE(code,''), name, unit, site HAVING COUNT(*) > 1)"
    ).fetchone()
    if dup_row and dup_row["c"] == 0:
        conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_items_unique ON items(brand, COALESCE(code,''), name, unit, site)")
    elif dup_row:
        print(f"[migrate] 警告：items 有 {dup_row['c']} 組重複品項，跳過唯一索引（請人工清理後重啟）")
    mov_cols = [r[1] for r in conn.execute("PRAGMA table_info(movements)").fetchall()]
    if "destination" not in mov_cols:
        conn.execute("ALTER TABLE movements ADD COLUMN destination TEXT DEFAULT ''")
        print("[migrate] movements.destination 欄位已新增")
    if "reverted_at" not in mov_cols:
        conn.execute("ALTER TABLE movements ADD COLUMN reverted_at TIMESTAMP")
        print("[migrate] movements.reverted_at 欄位已新增（退回已領出防重複）")
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
    conn.commit()
    conn.close()