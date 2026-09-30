# -*- coding: utf-8 -*-
"""db_session() 連線生命週期 + 「不得手寫 get_db/try/finally 樣板」守衛。"""
import ast
import sqlite3
from pathlib import Path

import pytest

import app.database as app_db

ROOT = Path(__file__).resolve().parent.parent

# 刻意不遷移的檔案：這些模組的測試需要 patch「該模組自己的 get_db」來注入假連線 / 追蹤 / 失敗
#（例如 sync_scheduler 用 _FakeConn 驗證排程流程、gcal_keys 驗證 DB 失敗時不留孤兒憑證檔）。
# 換成 db_session 後 patch 會失效，需連同測試一起改；改完請從這裡移除。
NOT_MIGRATED = {
    "app/services/gcal_sync.py",
}


@pytest.fixture()
def tracked_conn(isolated_db, monkeypatch):
    """讓 get_db 回傳可觀察 close / rollback 的連線。"""
    events = []
    real_get_db = app_db.get_db

    class Spy:
        def __init__(self, conn):
            self._conn = conn

        def rollback(self):
            events.append("rollback")
            return self._conn.rollback()

        def close(self):
            events.append("close")
            return self._conn.close()

        def __getattr__(self, name):
            return getattr(self._conn, name)

    monkeypatch.setattr(app_db, "get_db", lambda: Spy(real_get_db()))
    return events


def test_db_session_closes_on_success_without_rollback(tracked_conn):
    with app_db.db_session() as conn:
        conn.execute("SELECT 1")
    assert tracked_conn == ["close"]


def test_db_session_rolls_back_then_closes_and_reraises(tracked_conn):
    with pytest.raises(ValueError, match="boom"):
        with app_db.db_session() as conn:
            conn.execute("CREATE TABLE t(x)")
            raise ValueError("boom")
    assert tracked_conn == ["rollback", "close"]


def test_db_session_does_not_autocommit(isolated_db):
    with app_db.db_session() as conn:
        conn.execute("CREATE TABLE t(x)")
        conn.commit()
    with app_db.db_session() as conn:
        conn.execute("INSERT INTO t VALUES (1)")          # 未 commit
    with app_db.db_session() as conn:
        assert conn.execute("SELECT COUNT(*) FROM t").fetchone()[0] == 0


def test_db_session_releases_write_lock_after_error(isolated_db):
    """鎖洩漏回歸：BEGIN IMMEDIATE 後拋例外，別的連線必須能立刻取得寫鎖。"""
    with app_db.db_session() as conn:
        conn.execute("CREATE TABLE t(x)")
        conn.commit()
    with pytest.raises(RuntimeError):
        with app_db.db_session() as conn:
            conn.execute("BEGIN IMMEDIATE")
            raise RuntimeError("fail while holding lock")
    other = sqlite3.connect(app_db.DB_PATH, timeout=0.5)
    try:
        other.execute("BEGIN IMMEDIATE")
        other.rollback()
    finally:
        other.close()


# ---------- 守衛：不得再手寫連線樣板 ----------

def _is_close(stmt):
    return isinstance(stmt, ast.Expr) and ast.unparse(stmt.value) == "conn.close()"


def _hand_written_sessions(path: Path):
    """找出 `conn = get_db()` 緊接 try，且 finally 只做 conn.close() 的樣板（可帶 rollback-raise handler）。"""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    hits = []
    for node in ast.walk(tree):
        body = getattr(node, "body", None)
        if not isinstance(body, list):
            continue
        for i, stmt in enumerate(body[:-1]):
            nxt = body[i + 1]
            if (
                isinstance(stmt, ast.Assign)
                and ast.unparse(stmt.value) == "get_db()"
                and [ast.unparse(t) for t in stmt.targets] == ["conn"]
                and isinstance(nxt, ast.Try)
                and len(nxt.finalbody) == 1
                and _is_close(nxt.finalbody[0])
            ):
                hits.append(stmt.lineno)
    return hits


def test_no_new_hand_written_connection_boilerplate():
    offenders = []
    stale = []
    for path in sorted((ROOT / "app").rglob("*.py")):
        rel = path.relative_to(ROOT).as_posix()
        hits = _hand_written_sessions(path)
        if rel in NOT_MIGRATED:
            if not hits:
                stale.append(rel)
        elif rel != "app/database.py" and hits:
            offenders += [f"{rel}:{n}" for n in hits]
    assert not offenders, "請改用 `with db_session() as conn:`（app.database）：\n" + "\n".join(offenders)
    assert not stale, f"已遷移完成，請從 NOT_MIGRATED 移除：{stale}"
