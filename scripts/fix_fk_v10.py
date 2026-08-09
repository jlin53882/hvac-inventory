# -*- coding: utf-8 -*-
"""
修復 v10 遷移後的 FK 指向（items_old → items）
================================================
原因：migrate_v10 將舊 items 改名 items_old，但 SQLite 中
movements/stocktakes/kits/kit_items 的 FOREIGN KEY 仍指向 items_old，
導致任何新資料寫入時 FOREIGN KEY constraint failed。

修法：重建這 4 張表（FK 指回 items），資料完整搬移。
用法：env -u PYTHONPATH .venv/Scripts/python.exe scripts/fix_fk_v10.py
"""
import sqlite3
import datetime
import shutil

DB = "inventory.db"

# 前置檢查：items_old 存在才需要修
conn = sqlite3.connect(DB)
tables = [t[0] for t in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
conn.close()
if "items_old" not in tables:
    print("[OK] 無 items_old，FK 已正確（不需修復）")
    raise SystemExit(0)

# 備份
bak = f"inventory.db.bak-fkfix-{datetime.datetime.now():%Y%m%d%H%M%S}"
shutil.copy2(DB, bak)
print(f"[bak] {bak}")

conn = sqlite3.connect(DB)
conn.execute("PRAGMA foreign_keys = OFF")
conn.execute("BEGIN")

def rebuild(mapping):
    """mapping: {old_table: (create_sql_without_final_semi, select_columns)}"""
    for old, (create_sql, cols) in mapping.items():
        new = old + "_new"
        conn.execute(f"DROP TABLE IF EXISTS {new}")
        conn.execute(create_sql)
        conn.execute(f"INSERT INTO {new} ({cols}) SELECT {cols} FROM {old}")
        conn.execute(f"DROP TABLE {old}")
        conn.execute(f"ALTER TABLE {new} RENAME TO {old}")
        print(f"[重建] {old} ✅")

# movements：FK → items
rebuild({
    "movements": (
        """CREATE TABLE movements_new (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id     INTEGER NOT NULL REFERENCES items(id),
        delta       REAL NOT NULL,
        before_qty  REAL NOT NULL DEFAULT 0,
        after_qty   REAL NOT NULL DEFAULT 0,
        reason      TEXT DEFAULT '',
        destination TEXT DEFAULT '',
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )""",
        "id, item_id, delta, before_qty, after_qty, reason, destination, created_at",
    ),
})

# stocktakes：FK → items + 新增 location 欄位
conn.execute("DROP TABLE IF EXISTS stocktakes_new")
conn.execute("""CREATE TABLE stocktakes_new (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    take_date   TEXT NOT NULL,
    item_id     INTEGER NOT NULL REFERENCES items(id),
    location    TEXT DEFAULT '',
    system_qty  REAL NOT NULL DEFAULT 0,
    actual_qty  REAL NOT NULL DEFAULT 0,
    diff        REAL NOT NULL DEFAULT 0,
    note        TEXT DEFAULT '',
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)""")
conn.execute("INSERT INTO stocktakes_new (id, take_date, item_id, system_qty, actual_qty, diff, note, created_at) SELECT id, take_date, item_id, system_qty, actual_qty, diff, note, created_at FROM stocktakes")
conn.execute("DROP TABLE stocktakes")
conn.execute("ALTER TABLE stocktakes_new RENAME TO stocktakes")
print("[重建] stocktakes（+location 欄位）")

# kits：FK → items
rebuild({
    "kits": (
        """CREATE TABLE kits_new (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id     INTEGER NOT NULL REFERENCES items(id),
        name        TEXT NOT NULL,
        note        TEXT DEFAULT '',
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )""",
        "id, item_id, name, note, created_at",
    ),
    "kit_items": (
        """CREATE TABLE kit_items_new (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        kit_id      INTEGER NOT NULL REFERENCES kits(id),
        item_id     INTEGER NOT NULL REFERENCES items(id),
        qty         REAL NOT NULL DEFAULT 1,
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )""",
        "id, kit_id, item_id, qty, created_at",
    ),
})

# drop 舊表 items_old（已無用）
conn.execute("DROP TABLE IF EXISTS items_old")
print("[刪除] items_old")

conn.commit()
conn.close()

# 驗證
conn = sqlite3.connect(DB)
conn.execute("PRAGMA foreign_keys = ON")
print("\n=== 驗證 ===")
for t in ("movements", "stocktakes", "kits", "kit_items"):
    fks = conn.execute(f"PRAGMA foreign_key_list({t})").fetchall()
    targets = [f[2] for f in fks]
    print(f"{t}: FK→ {targets} 資料 {conn.execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0]}")
print("items:", conn.execute("SELECT COUNT(*) FROM items").fetchone()[0])
print("item_stocks:", conn.execute("SELECT COUNT(*) FROM item_stocks").fetchone()[0])
print("總量:", conn.execute("SELECT COALESCE(SUM(qty),0) FROM item_stocks").fetchone()[0])
conn.close()
print("✅ 修復完成")