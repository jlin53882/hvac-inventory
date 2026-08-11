# -*- coding: utf-8 -*-
"""
一次性遷移腳本：舊 items（品項+位置+數量綁死）→ 新 items 主檔 + item_stocks
=======================================================================
用法：env -u PYTHONPATH .venv/Scripts/python.exe scripts/migrate_v10.py
流程：
  1. 備份 inventory.db → inventory.db.bak-v10-pre-migration
  2. 建新表 items_v10（主檔，去 qty/location/note）+ item_stocks
  3. 主檔去重鍵 (brand, code, name, unit, low_stock, is_kit, site) GROUP BY 合併
  4. 每筆舊資料 → 一筆 stock（location + qty + note）
  5. 驗證：主檔無重複；SUM(stocks.qty) = 舊 SUM(qty)
  6. 換表名，完成
"""
import os
import shutil
import sqlite3

# 專案根目錄
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# SQLite 資料庫檔路徑
DB = os.path.join(BASE, "inventory.db")

def main():
    """執行 v10 資料庫遷移：備份 DB、建立 items_v10 與 item_stocks 新表、搬移舊資料、驗證總量後換表。"""
    shutil.copy(DB, DB + ".bak-v10-pre-migration")
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")

    # 舊資料總量（對帳基準）
    old_total = conn.execute("SELECT COALESCE(SUM(qty),0) FROM items").fetchone()[0]
    old_count = conn.execute("SELECT COUNT(*) FROM items").fetchone()[0]
    print(f"舊庫：{old_count} 筆，總量 {old_total}")

    # 1) 建新表
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS items_v10 (
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
        item_id     INTEGER NOT NULL REFERENCES items_v10(id) ON DELETE CASCADE,
        location    TEXT DEFAULT '',
        qty         REAL NOT NULL DEFAULT 0,
        note        TEXT DEFAULT '',
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(item_id, location)
    );
    """)

    # 2) 主檔：去重鍵合併
    conn.execute("""
    INSERT INTO items_v10 (brand, code, name, prepared_qty, unit, low_stock, is_kit, site, created_at, updated_at)
    SELECT brand, code, name,
           MAX(prepared_qty),
           unit, low_stock, MAX(is_kit), site,
           MIN(created_at), MAX(updated_at)
    FROM items
    GROUP BY brand, code, name, unit, low_stock, site
    """)

    # 3) 每筆舊資料 → 一筆 stock（同 item+location 數量直接加總）
    conn.execute("""
    INSERT INTO item_stocks (item_id, location, qty, note, created_at, updated_at)
    SELECT n.id, o.location, SUM(o.qty), MAX(o.note), MIN(o.created_at), MAX(o.updated_at)
    FROM items o
    JOIN items_v10 n
      ON n.brand = o.brand AND n.code = o.code AND n.name = o.name
     AND n.unit = o.unit AND n.low_stock = o.low_stock AND n.site = o.site
    GROUP BY n.id, o.location
    """)

    conn.commit()

    # 4) 驗證
    new_item_count = conn.execute("SELECT COUNT(*) FROM items_v10").fetchone()[0]
    dup = conn.execute("""
        SELECT COUNT(*) FROM (SELECT brand, code, name FROM items_v10 GROUP BY brand, code, name, unit, site HAVING COUNT(*) > 1)
    """).fetchone()[0]
    stock_total = conn.execute("SELECT COALESCE(SUM(qty),0) FROM item_stocks").fetchone()[0]
    stock_count = conn.execute("SELECT COUNT(*) FROM item_stocks").fetchone()[0]

    print(f"新主檔：{new_item_count} 筆（舊 {old_count} 筆 → 合併後 {new_item_count} 筆）")
    print(f"位置庫存：{stock_count} 筆")
    print(f"總量對帳：舊 {old_total} vs 新 {stock_total} → {'✅ 一致' if abs(old_total - stock_total) < 0.001 else '❌ 不一致！'}")
    print(f"主檔重複：{dup} 筆 → {'✅ 無重複' if dup == 0 else '❌ 有重複！'}")

    if abs(old_total - stock_total) >= 0.001 or dup != 0:
        print("❌ 遷移驗證失敗，請檢查！DB 未替換。")
        conn.close()
        return

    # 5) 換表：舊 items → items_old，新 items_v10 → items
    conn.execute("ALTER TABLE items RENAME TO items_old")
    conn.execute("ALTER TABLE items_v10 RENAME TO items")
    conn.commit()
    print("✅ 換表完成：items 已是新結構（items_old 為備份）")
    conn.close()

if __name__ == "__main__":
    main()