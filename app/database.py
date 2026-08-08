# -*- coding: utf-8 -*-
"""
資料庫層
========
- get_db()：開啟 SQLite 連線
- init_db()：建立資料表 + 舊庫欄位遷移（ALTER TABLE）
"""
import sqlite3

from app.config import DB_PATH


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    conn = get_db()
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS items (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        brand       TEXT NOT NULL DEFAULT '',
        code        TEXT DEFAULT '',
        name        TEXT NOT NULL,
        qty         REAL NOT NULL DEFAULT 0,
        prepared_qty REAL NOT NULL DEFAULT 0,
        unit        TEXT NOT NULL DEFAULT '個',
        location    TEXT DEFAULT '',
        note        TEXT DEFAULT '',
        low_stock   REAL DEFAULT 0,
        is_kit      INTEGER NOT NULL DEFAULT 0,
        site        TEXT NOT NULL DEFAULT 'office',
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS movements (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id     INTEGER NOT NULL REFERENCES items(id),
        delta       REAL NOT NULL,
        before_qty  REAL NOT NULL DEFAULT 0,
        after_qty   REAL NOT NULL DEFAULT 0,
        reason      TEXT DEFAULT '',
        destination TEXT DEFAULT '',
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS stocktakes (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        take_date   TEXT NOT NULL,
        item_id     INTEGER NOT NULL REFERENCES items(id),
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
    CREATE INDEX IF NOT EXISTS idx_items_brand ON items(brand);
    CREATE INDEX IF NOT EXISTS idx_items_location ON items(location);
    CREATE INDEX IF NOT EXISTS idx_movements_item ON movements(item_id);
    """)

    # 舊資料庫遷移：補上新增欄位
    item_cols = [r[1] for r in conn.execute("PRAGMA table_info(items)").fetchall()]
    if "prepared_qty" not in item_cols:
        conn.execute("ALTER TABLE items ADD COLUMN prepared_qty REAL NOT NULL DEFAULT 0")
        print("[migrate] items.prepared_qty 欄位已新增")
    if "is_kit" not in item_cols:
        conn.execute("ALTER TABLE items ADD COLUMN is_kit INTEGER NOT NULL DEFAULT 0")
        print("[migrate] items.is_kit 欄位已新增")
    if "site" not in item_cols:
        conn.execute("ALTER TABLE items ADD COLUMN site TEXT NOT NULL DEFAULT 'office'")
        print("[migrate] items.site 欄位已新增")
    mov_cols = [r[1] for r in conn.execute("PRAGMA table_info(movements)").fetchall()]
    if "destination" not in mov_cols:
        conn.execute("ALTER TABLE movements ADD COLUMN destination TEXT DEFAULT ''")
        print("[migrate] movements.destination 欄位已新增")
    conn.commit()
    conn.close()
