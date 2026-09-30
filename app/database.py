# -*- coding: utf-8 -*-
"""
資料庫層
========
- get_db()：開啟 SQLite 連線
- db_session()：連線 context manager（離開必 close、例外先 rollback）
- init_db()：初始化 schema → 欄位遷移 → 種子資料，同一個交易、失敗整體 rollback

拆分（2026-09）：原本 776 行的 _exec_init 拆成
    app/db_schema.py      DDL（CREATE TABLE/INDEX IF NOT EXISTS）+ execute_script_in_transaction
    app/db_migrations.py  欄位遷移（冪等，MIGRATIONS 順序 = 執行順序）+ SCHEMA_VERSION
    app/db_seeds.py       種子資料與一次性資料遷移（SEEDS 順序 = 執行順序）
"""
import sqlite3
from contextlib import contextmanager

from app.services.app_log import get_logger

logger = get_logger(__name__)

from app.config import DB_PATH
from app.db_migrations import SCHEMA_VERSION, run_migrations
from app.db_schema import SCHEMA_SQL, execute_script_in_transaction as _execute_script_in_transaction
from app.db_seeds import run_seeds


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


@contextmanager
def db_session():
    """連線生命週期 context manager：離開時一定 close，發生例外時先 rollback 再往外拋。

    取代各 route 手寫的 ``conn = get_db(); try: ... except: conn.rollback(); raise; finally: conn.close()``
    （2026-08-14 鎖洩漏根治靠「每處都記得寫」維持，漏一處就復發；集中後不可能漏）。

    不會自動 commit：呼叫端仍須在適當時機明確 ``conn.commit()``，讓交易邊界維持可讀。
    需要 ``BEGIN IMMEDIATE`` 的寫入流程照舊在 with 區塊內自行下。
    """
    conn = get_db()
    try:
        yield conn
    except BaseException:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    """Initialize the schema, migrations, and required seed data atomically.

    The explicit transaction keeps schema changes, migration markers, and
    backfills on one rollback boundary so a failed startup can be retried.

    Raises:
        RuntimeError: If the database was created by a newer version of the code.
        sqlite3.Error: If schema creation, migration, or seed initialization fails.
    """
    # 中途炸（雙開 server 搶 DB 等）由 db_session 負責 rollback 釋放 RESERVED 鎖並 close
    with db_session() as conn:
        conn.execute("BEGIN IMMEDIATE")
        current_version = conn.execute("PRAGMA user_version").fetchone()[0]
        if current_version > SCHEMA_VERSION:
            raise RuntimeError(
                f"資料庫版本 {current_version} 比程式碼支援的版本 {SCHEMA_VERSION} 新；"
                "請部署對應（或更新）版本的程式碼，勿用舊程式開新資料庫。"
            )
        _exec_init(conn)
        conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
        conn.commit()


def _exec_init(conn):
    """init_db 主體（conn 已開，交易由呼叫端管理）：schema → 欄位遷移 → 種子資料。
    順序不可調換：遷移會補欄位/建索引，種子依賴 schema 與遷移後的欄位。
    """
    _execute_script_in_transaction(conn, SCHEMA_SQL)
    run_migrations(conn)
    run_seeds(conn)
