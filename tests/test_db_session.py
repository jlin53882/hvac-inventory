# -*- coding: utf-8 -*-
"""db_session() 連線生命週期 + 「app/ 內只有 database.py 可直接呼叫 get_db()」守衛。"""
import ast
import sqlite3
from pathlib import Path

import pytest

import app.database as app_db

ROOT = Path(__file__).resolve().parent.parent

# 刻意不遷移（仍直接使用 get_db）的檔案白名單：目前為空。
# 新增例外前請先想能不能改用 db_session；確實不行才加入並註明原因，改完務必移除。
NOT_MIGRATED: set[str] = set()


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


# ---------- 守衛：連線只能經由 db_session() 取得 ----------

def _direct_get_db_calls(path: Path) -> list[int]:
    """找出檔案裡所有 `get_db()` / `xxx.get_db()` 呼叫的行號（含函式內、含各種寫法，不只 try/finally 樣板）。"""
    hits = []
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
        if isinstance(node, ast.Call):
            func = node.func
            if (isinstance(func, ast.Name) and func.id == "get_db") or (
                isinstance(func, ast.Attribute) and func.attr == "get_db"
            ):
                hits.append(node.lineno)
    return hits


def test_get_db_is_only_called_by_database_module():
    """app/ 內只有 database.py（db_session 本身）可以直接呼叫 get_db()；其餘一律 `with db_session() as conn:`。

    白名單 NOT_MIGRATED 目前為空。這個守衛掃的是「任何 get_db 呼叫」，不是特定的樣板寫法，
    所以像「conn = get_db(); asset = None; try: ...」這種變形也擋得住。
    """
    offenders = []
    stale = []
    for path in sorted((ROOT / "app").rglob("*.py")):
        rel = path.relative_to(ROOT).as_posix()
        if rel == "app/database.py":
            continue
        hits = _direct_get_db_calls(path)
        if rel in NOT_MIGRATED:
            if not hits:
                stale.append(rel)
        elif hits:
            offenders += [f"{rel}:{n}" for n in hits]
    assert not offenders, "請改用 `with db_session() as conn:`（app.database）：\n" + "\n".join(offenders)
    assert not stale, f"已遷移完成，請從 NOT_MIGRATED 移除：{stale}"
