"""Database initialization and migration safety regression tests.

These tests exercise the real ``app.database.init_db`` boundary with isolated
SQLite files. They deliberately inject a database failure instead of changing
production schema or seed data.
"""
from __future__ import annotations

import sqlite3
from collections.abc import Callable
from pathlib import Path

import pytest

import app.database as app_db


def _count_rows(database_path: Path, table: str) -> int:
    """Return the row count for a table in an isolated SQLite database."""
    conn = sqlite3.connect(database_path)
    try:
        return int(conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])
    finally:
        conn.close()


def _install_gcal_seed_failure(
    conn: sqlite3.Connection, fail_once: bool = False
) -> Callable[[], bool]:
    """Deny a gcal-settings seed write and report whether failure was consumed."""
    consumed = [False]

    def authorize(
        action: int,
        arg1: str | None,
        _arg2: str | None,
        _database: str | None,
        _source: str | None,
    ) -> int:
        """Reject the selected seed write while allowing other SQL statements."""
        if action == sqlite3.SQLITE_INSERT and arg1 == "gcal_sync_settings":
            if fail_once and consumed[0]:
                return sqlite3.SQLITE_OK
            consumed[0] = True
            return sqlite3.SQLITE_DENY
        return sqlite3.SQLITE_OK

    conn.set_authorizer(authorize)
    return lambda: consumed[0]


def _run_init_with_authorizer(
    installer: Callable[[sqlite3.Connection], Callable[[], bool]]
) -> Callable[[], bool]:
    """Run ``init_db`` through a connection carrying a failure authorizer."""
    original_get_db = app_db.get_db
    state: dict[str, Callable[[], bool]] = {}

    def get_db_with_authorizer() -> sqlite3.Connection:
        """Create the normal connection and install the test-only authorizer."""
        conn = original_get_db()
        state["consumed"] = installer(conn)
        return conn

    app_db.get_db = get_db_with_authorizer
    try:
        with pytest.raises(sqlite3.DatabaseError, match="not authorized"):
            app_db.init_db()
    finally:
        app_db.get_db = original_get_db
    return state["consumed"]


def test_execute_script_splits_compact_multiple_statements() -> None:
    """Compact SQL scripts must keep each statement inside the caller transaction."""
    conn = sqlite3.connect(":memory:")
    try:
        conn.execute("BEGIN")
        app_db._execute_script_in_transaction(
            conn,
            "CREATE TABLE first(value INTEGER); CREATE TABLE second(value INTEGER);",
        )
        conn.rollback()
        tables = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        ).fetchall()
    finally:
        conn.close()

    assert tables == []


def test_init_db_failure_rolls_back_schema_and_seed(tmp_path, monkeypatch) -> None:
    """A failed fresh initialization must not leave a partially committed DB."""
    database_path = tmp_path / "failed-init.db"
    monkeypatch.setattr(app_db, "DB_PATH", str(database_path))

    _run_init_with_authorizer(
        lambda conn: _install_gcal_seed_failure(conn),
    )

    conn = sqlite3.connect(database_path)
    try:
        tables = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        ).fetchall()
    finally:
        conn.close()

    assert tables == []


def test_init_db_recovers_after_injected_failure(tmp_path, monkeypatch) -> None:
    """A failed initialization must be retryable and idempotent on the next start."""
    database_path = tmp_path / "retry-init.db"
    monkeypatch.setattr(app_db, "DB_PATH", str(database_path))

    consumed = _run_init_with_authorizer(
        lambda conn: _install_gcal_seed_failure(conn, fail_once=True),
    )
    assert consumed()

    app_db.init_db()
    first_counts = {
        "service_types": _count_rows(database_path, "service_types"),
        "units": _count_rows(database_path, "units"),
        "roles": _count_rows(database_path, "roles"),
        "permissions": _count_rows(database_path, "permissions"),
        "gcal_sync_settings": _count_rows(database_path, "gcal_sync_settings"),
    }

    app_db.init_db()
    second_counts = {
        table: _count_rows(database_path, table) for table in first_counts
    }

    assert first_counts == {
        "service_types": 6,
        "units": 15,
        "roles": 4,
        "permissions": 41,
        "gcal_sync_settings": 4,
    }
    assert second_counts == first_counts


def test_failed_current_upgrade_preserves_rows_overrides_and_markers(
    tmp_path, monkeypatch
) -> None:
    """A failed current-database upgrade must preserve data and marker state."""
    database_path = tmp_path / "current-upgrade.db"
    monkeypatch.setattr(app_db, "DB_PATH", str(database_path))
    app_db.init_db()

    conn = app_db.get_db()
    try:
        conn.execute(
            "INSERT INTO items (brand, code, name, unit, site) VALUES (?, ?, ?, ?, ?)",
            ("Brand", "EX-1", "Existing item", "個", "office"),
        )
        conn.execute(
            "INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)",
            ("existing-user", "hash", "Existing User", "viewer"),
        )
        user_id = conn.execute(
            "SELECT id FROM users WHERE username=?", ("existing-user",)
        ).fetchone()["id"]
        permission_id = conn.execute(
            "SELECT id FROM permissions WHERE key=?", ("signed-report-delete-all",)
        ).fetchone()["id"]
        conn.execute(
            "INSERT INTO user_permissions (user_id, permission_id, value) VALUES (?, ?, 0)",
            (user_id, permission_id),
        )
        conn.execute(
            "DELETE FROM rbac_migrations WHERE key=?",
            ("signed_report_action_capabilities_v1",),
        )
        conn.commit()
    finally:
        conn.close()

    _run_init_with_authorizer(
        lambda connection: _install_gcal_seed_failure(connection),
    )

    conn = sqlite3.connect(database_path)
    try:
        assert conn.execute(
            "SELECT COUNT(*) FROM items WHERE code='EX-1'"
        ).fetchone()[0] == 1
        assert conn.execute(
            """SELECT up.value FROM user_permissions up
               JOIN users u ON u.id = up.user_id
               JOIN permissions p ON p.id = up.permission_id
               WHERE u.username=? AND p.key=?""",
            ("existing-user", "signed-report-delete-all"),
        ).fetchone()[0] == 0
        assert conn.execute(
            "SELECT COUNT(*) FROM rbac_migrations WHERE key=?",
            ("signed_report_action_capabilities_v1",),
        ).fetchone()[0] == 0
    finally:
        conn.close()


def _create_legacy_items_database(database_path: Path) -> None:
    """Create a minimal pre-migration items table with one legacy row."""
    conn = sqlite3.connect(database_path)
    try:
        conn.execute(
            """CREATE TABLE items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                brand TEXT NOT NULL DEFAULT '',
                code TEXT NOT NULL DEFAULT '',
                name TEXT NOT NULL,
                qty REAL NOT NULL DEFAULT 0,
                unit TEXT NOT NULL DEFAULT '個',
                location TEXT NOT NULL DEFAULT '',
                note TEXT NOT NULL DEFAULT ''
            )"""
        )
        conn.execute(
            "INSERT INTO items (brand, code, name, qty, unit, location, note) VALUES (?, ?, ?, ?, ?, ?, ?)",
            ("Legacy", "L-1", "Legacy item", 3, "個", "A-1", "keep me"),
        )
        conn.commit()
    finally:
        conn.close()


def test_failed_legacy_upgrade_rolls_back_alters_and_can_retry(
    tmp_path, monkeypatch
) -> None:
    """A failed legacy upgrade must roll back ALTERs and preserve the legacy row."""
    database_path = tmp_path / "legacy-upgrade.db"
    _create_legacy_items_database(database_path)
    monkeypatch.setattr(app_db, "DB_PATH", str(database_path))

    _run_init_with_authorizer(
        lambda connection: _install_gcal_seed_failure(connection),
    )

    conn = sqlite3.connect(database_path)
    try:
        tables = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        ).fetchall()
        columns = [row[1] for row in conn.execute("PRAGMA table_info(items)")]
        legacy_row = conn.execute(
            "SELECT name, qty, location, note FROM items WHERE code='L-1'"
        ).fetchone()
    finally:
        conn.close()

    assert tables == [("items",), ("sqlite_sequence",)]
    assert columns == ["id", "brand", "code", "name", "qty", "unit", "location", "note"]
    assert legacy_row == ("Legacy item", 3.0, "A-1", "keep me")

    app_db.init_db()
    conn = sqlite3.connect(database_path)
    try:
        upgraded_columns = [row[1] for row in conn.execute("PRAGMA table_info(items)")]
        upgraded_row = conn.execute(
            "SELECT name, qty, location, note, prepared_qty, site FROM items WHERE code='L-1'"
        ).fetchone()
    finally:
        conn.close()

    assert "prepared_qty" in upgraded_columns
    assert "category" in upgraded_columns
    assert upgraded_row == ("Legacy item", 3.0, "A-1", "keep me", 0.0, "office")
