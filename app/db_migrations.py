# -*- coding: utf-8 -*-
"""
資料庫欄位遷移（ALTER TABLE 補欄位 + 必要的資料回填）
=====================================================
MIGRATIONS 目前每次 init_db() 都會依序「重新執行」，因此所有遷移必須永遠是冪等的：
- ALTER TABLE 前先用 PRAGMA table_info / sqlite_master 檢查欄位或物件是否存在
- CREATE INDEX 用 IF NOT EXISTS 或等價檢查
- 資料回填不得覆蓋使用者已修改的值
- 一次性資料轉換要有持久的標記（durable marker）或 WHERE 條件保護
MIGRATIONS 的順序就是執行順序（與拆分前 _exec_init 的順序完全一致，不要任意調換）。

SCHEMA_VERSION（PRAGMA user_version）只是：
1. 資料庫 / 程式碼相容性標記
2. 降版保護（資料庫比程式新就拒絕啟動）
它「不」控制 MIGRATIONS 執行幾次，也不是「已跑到第幾個遷移」的游標；
只把 SCHEMA_VERSION +1 無法讓不冪等的遷移變安全。

新增遷移：加一個冪等函式、補進 MIGRATIONS 尾端。若 schema 的變化使舊程式不能安全讀寫，
再把 SCHEMA_VERSION +1（讓回滾部署的舊程式拒絕啟動）。
若未來真的需要不冪等的遷移，必須先另外實作 current_version -> target_version 的版本化 runner，
不可直接放進目前的 MIGRATIONS。
"""
from app.services.app_log import get_logger

logger = get_logger(__name__)

# 目前程式碼對應的資料庫版本（寫入 PRAGMA user_version）。
# 啟動時若資料庫版本比程式碼新，代表用舊程式開新資料庫（例如回滾部署），會拒絕啟動以免資料被舊邏輯破壞。
SCHEMA_VERSION = 1


def _petty_cash_report_type(conn):
    """petty_cash_reports.report_type"""
    petty_cols = [r[1] for r in conn.execute("PRAGMA table_info(petty_cash_reports)").fetchall()]
    if "report_type" not in petty_cols:
        conn.execute("ALTER TABLE petty_cash_reports ADD COLUMN report_type TEXT NOT NULL DEFAULT 'general'")
        logger.info("[migrate] petty_cash_reports.report_type 已新增，既有資料設為 general")


def _items_base_columns(conn):
    """items 舊欄位提示 + prepared_qty / is_kit / site；users 與 appointments 欄位補齊"""
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


def _items_soft_delete_and_category(conn):
    """items.is_deleted / items.category（含一次性分類推斷）"""
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


def _kits_updated_at(conn):
    """kits.updated_at（樂觀鎖）"""
    kit_cols = [r[1] for r in conn.execute("PRAGMA table_info(kits)").fetchall()]
    if "updated_at" not in kit_cols:
        conn.execute("ALTER TABLE kits ADD COLUMN updated_at TIMESTAMP")
        logger.info("[migrate] kits.updated_at 欄位已新增（樂觀鎖）")


def _units_qty_type(conn):
    """units.qty_type 與系統單位的 qty_type 校正"""
    unit_cols = [r[1] for r in conn.execute("PRAGMA table_info(units)").fetchall()]
    if "qty_type" not in unit_cols:
        conn.execute("ALTER TABLE units ADD COLUMN qty_type TEXT NOT NULL DEFAULT 'integer'")
        conn.execute("UPDATE units SET qty_type='fraction' WHERE name='罐'")
        logger.info("[migrate] units.qty_type 欄位已新增（既有「罐」預設 fraction，其餘 integer）")
    # 2026-09-12 §8：散裝可分（瓶/桶/捲）→fraction、米→decimal；
    # 只動仍為 integer 的系統名單（使用者手動改過的值一律保留）
    conn.execute("UPDATE units SET qty_type='fraction' WHERE name IN ('瓶','桶','捲') AND qty_type='integer'")
    conn.execute("UPDATE units SET qty_type='decimal' WHERE name='米' AND qty_type='integer'")


def _items_indexes(conn):
    """items 索引（site_active、只限現存品項的唯一索引）"""
    conn.execute("CREATE INDEX IF NOT EXISTS idx_items_site_active ON items(site, is_deleted, brand)")
    # M5：items 唯一約束只限制現存品項；soft-delete 舊資料不可阻塞重新建立。
    unique_idx = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_items_unique'"
    ).fetchone()
    if unique_idx and "WHERE is_deleted = 0" not in (unique_idx["sql"] or ""):
        conn.execute("DROP INDEX idx_items_unique")
        unique_idx = None
    dup_row = conn.execute(
        "SELECT COUNT(*) AS c FROM (SELECT 1 FROM items WHERE is_deleted=0 GROUP BY brand, COALESCE(code,''), name, unit, site HAVING COUNT(*) > 1)"
    ).fetchone()
    if not unique_idx and dup_row and dup_row["c"] == 0:
        conn.execute("CREATE UNIQUE INDEX idx_items_unique ON items(brand, COALESCE(code,''), name, unit, site) WHERE is_deleted = 0")
    elif dup_row and dup_row["c"] > 0:
        logger.warning(f"[migrate] 警告：現存 items 有 {dup_row['c']} 組重複品項，跳過唯一索引（請人工清理後重啟）")


def _movements_columns(conn):
    """movements 出庫/退回追蹤欄位"""
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


def _gcal_keys_columns_and_settings_table(conn):
    """gcal_keys.reminders / pending_calendar_id 與 gcal_sync_settings 表"""
    # M6：gcal_keys.reminders 欄位（2026-08-27 per-key 提醒）
    gcal_cols = [r[1] for r in conn.execute("PRAGMA table_info(gcal_keys)").fetchall()]
    if "reminders" not in gcal_cols:
        conn.execute("ALTER TABLE gcal_keys ADD COLUMN reminders TEXT DEFAULT '[{\"method\":\"popup\",\"minutes\":30},{\"method\":\"email\",\"minutes\":60}]'")
        logger.info("[migrate] gcal_keys.reminders 欄位已新增（per-key 提醒）")
    if "pending_calendar_id" not in gcal_cols:
        conn.execute("ALTER TABLE gcal_keys ADD COLUMN pending_calendar_id TEXT")
        logger.info("[migrate] gcal_keys.pending_calendar_id 欄位已新增（Calendar migration pending）")
    # M7：gcal_sync_settings 表（2026-08-27 同步設定頁）
    conn.execute("""CREATE TABLE IF NOT EXISTS gcal_sync_settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )""")


def _appointment_gcal_map_data_hash(conn):
    """appointment_gcal_map.data_hash"""
    # M8：appointment_gcal_map.data_hash（2026-08-28 同步 hash 比對用）
    map_cols = [r[1] for r in conn.execute("PRAGMA table_info(appointment_gcal_map)").fetchall()]
    if "data_hash" not in map_cols:
        conn.execute("ALTER TABLE appointment_gcal_map ADD COLUMN data_hash TEXT DEFAULT ''")
        logger.info("[migrate] appointment_gcal_map.data_hash 欄位已新增（同步 hash 比對）")


MIGRATIONS = (
    _petty_cash_report_type,
    _items_base_columns,
    _items_soft_delete_and_category,
    _kits_updated_at,
    _units_qty_type,
    _items_indexes,
    _movements_columns,
    _gcal_keys_columns_and_settings_table,
    _appointment_gcal_map_data_hash,
)


def run_migrations(conn) -> None:
    """依序執行全部欄位遷移（呼叫端負責交易邊界）。每次啟動都會全部重跑，所以每個遷移都必須冪等。"""
    for migration in MIGRATIONS:
        migration(conn)
