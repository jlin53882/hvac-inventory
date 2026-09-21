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


def _table_columns(conn: sqlite3.Connection, table: str) -> list[str]:
    """Return a table's columns in SQLite declaration order."""
    return [row[1] for row in conn.execute(f"PRAGMA table_info({table})")]


def _index_sql(conn: sqlite3.Connection, index_name: str) -> str | None:
    """Return an index definition, or ``None`` when the index is absent."""
    row = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type='index' AND name=?",
        (index_name,),
    ).fetchone()
    return row[0] if row else None


def _snapshot_representative_legacy_state(database_path: Path) -> dict[str, object]:
    """Capture protected rows and schema state for legacy rollback assertions."""
    conn = sqlite3.connect(database_path)
    try:
        return {
            "catalog": tuple(
                conn.execute(
                    "SELECT type, name, tbl_name, sql FROM sqlite_master "
                    "ORDER BY type, name"
                ).fetchall()
            ),
            "tables": tuple(
                row[0]
                for row in conn.execute(
                    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
                )
            ),
            "item": conn.execute(
                "SELECT brand, code, name, qty, unit, location, note FROM items WHERE id=1"
            ).fetchone(),
            "stock": conn.execute(
                "SELECT item_id, location, qty, note FROM item_stocks WHERE id=1"
            ).fetchone(),
            "movement": conn.execute(
                "SELECT item_id, delta, before_qty, after_qty, reason, created_at "
                "FROM movements WHERE id=1"
            ).fetchone(),
            "kit": conn.execute(
                "SELECT item_id, name, note FROM kits WHERE id=1"
            ).fetchone(),
            "kit_item": conn.execute(
                "SELECT kit_id, item_id, qty FROM kit_items WHERE id=1"
            ).fetchone(),
            "user": conn.execute(
                "SELECT username, password_hash, display_name, role FROM users WHERE id=1"
            ).fetchone(),
            "role": conn.execute(
                "SELECT name, label, is_system FROM roles WHERE name='viewer'"
            ).fetchone(),
            "permission": conn.execute(
                "SELECT key, label FROM permissions "
                "WHERE key='signed-report-delete-all'"
            ).fetchone(),
            "role_permission": conn.execute(
                """SELECT COUNT(*)
                   FROM role_permissions rp
                   JOIN roles r ON r.id = rp.role_id
                   JOIN permissions p ON p.id = rp.permission_id
                   WHERE r.name='viewer' AND p.key='view'"""
            ).fetchone(),
            "permission_override": conn.execute(
                """SELECT up.value
                   FROM user_permissions up
                   JOIN users u ON u.id = up.user_id
                   JOIN permissions p ON p.id = up.permission_id
                   WHERE u.id=1 AND p.key='signed-report-delete-all'"""
            ).fetchone(),
            "quotation_override": conn.execute(
                """SELECT up.value
                   FROM user_permissions up
                   JOIN users u ON u.id = up.user_id
                   JOIN permissions p ON p.id = up.permission_id
                   WHERE u.id=1 AND p.key='quotation-upload-manage-all'"""
            ).fetchone(),
            "visibility_override": conn.execute(
                "SELECT visible FROM user_page_visibility "
                "WHERE user_id=1 AND page_key='inventory'"
            ).fetchone(),
            "unit": conn.execute(
                "SELECT name, sort_order, is_active FROM units WHERE id=1"
            ).fetchone(),
            "gcal_key": conn.execute(
                "SELECT name, credentials_path, calendar_id, is_active "
                "FROM gcal_keys WHERE id=1"
            ).fetchone(),
            "appointment_map": conn.execute(
                "SELECT appointment_id, key_id, google_event_id, synced_at "
                "FROM appointment_gcal_map WHERE appointment_id=1 AND key_id=1"
            ).fetchone(),
            "existing_marker": conn.execute(
                "SELECT key FROM rbac_migrations "
                "WHERE key='signed_report_action_capabilities_v1'"
            ).fetchone(),
            "missing_marker": conn.execute(
                "SELECT key FROM rbac_migrations "
                "WHERE key='quotation_upload_permission_decoupling_v1'"
            ).fetchone(),
            "items_unique_index": _index_sql(conn, "idx_items_unique"),
            "service_seed": conn.execute(
                "SELECT name FROM service_types WHERE name='施工'"
            ).fetchone(),
            "gcal_defaults": conn.execute(
                "SELECT COUNT(*) FROM gcal_sync_settings"
            ).fetchone(),
            "service_types_rows": tuple(
                conn.execute(
                    "SELECT id, name, sort_order, is_active FROM service_types ORDER BY id"
                ).fetchall()
            ),
            "units_rows": tuple(
                conn.execute(
                    "SELECT id, name, sort_order, is_active FROM units ORDER BY id"
                ).fetchall()
            ),
            "roles_rows": tuple(
                conn.execute(
                    "SELECT id, name, label, is_system FROM roles ORDER BY id"
                ).fetchall()
            ),
            "permissions_rows": tuple(
                conn.execute(
                    "SELECT id, key, label, module FROM permissions ORDER BY id"
                ).fetchall()
            ),
            "role_permissions_rows": tuple(
                conn.execute(
                    "SELECT role_id, permission_id FROM role_permissions "
                    "ORDER BY role_id, permission_id"
                ).fetchall()
            ),
            "user_permissions_rows": tuple(
                conn.execute(
                    "SELECT user_id, permission_id, value FROM user_permissions "
                    "ORDER BY user_id, permission_id"
                ).fetchall()
            ),
            "markers_rows": tuple(
                conn.execute(
                    "SELECT key, applied_at FROM rbac_migrations ORDER BY key"
                ).fetchall()
            ),
            "gcal_settings_rows": tuple(
                conn.execute(
                    "SELECT key, value FROM gcal_sync_settings ORDER BY key"
                ).fetchall()
            ),
            "visibility_rows": tuple(
                conn.execute(
                    "SELECT user_id, page_key, visible FROM user_page_visibility "
                    "ORDER BY user_id, page_key"
                ).fetchall()
            ),
        }
    finally:
        conn.close()


def _create_representative_legacy_database(database_path: Path) -> None:
    """Create a synthetic multi-table database from before current migrations."""
    conn = sqlite3.connect(database_path)
    try:
        conn.execute("PRAGMA foreign_keys = ON")
        conn.executescript(
            """
            CREATE TABLE items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                brand TEXT NOT NULL DEFAULT '',
                code TEXT NOT NULL DEFAULT '',
                name TEXT NOT NULL,
                qty REAL NOT NULL DEFAULT 0,
                unit TEXT NOT NULL DEFAULT '個',
                location TEXT NOT NULL DEFAULT '',
                note TEXT NOT NULL DEFAULT '',
                low_stock REAL DEFAULT 0,
                is_kit INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE item_stocks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
                location TEXT DEFAULT '',
                qty REAL NOT NULL DEFAULT 0,
                note TEXT DEFAULT '',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(item_id, location)
            );
            CREATE TABLE movements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                item_id INTEGER NOT NULL REFERENCES items(id),
                delta REAL NOT NULL,
                before_qty REAL NOT NULL DEFAULT 0,
                after_qty REAL NOT NULL DEFAULT 0,
                reason TEXT DEFAULT '',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE kits (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                item_id INTEGER NOT NULL REFERENCES items(id),
                name TEXT NOT NULL,
                note TEXT DEFAULT '',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE kit_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                kit_id INTEGER NOT NULL REFERENCES kits(id),
                item_id INTEGER NOT NULL REFERENCES items(id),
                qty REAL NOT NULL DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                display_name TEXT DEFAULT '',
                role TEXT NOT NULL DEFAULT 'user',
                is_active INTEGER NOT NULL DEFAULT 1,
                failed_attempts INTEGER NOT NULL DEFAULT 0,
                locked_until TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE roles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                label TEXT NOT NULL,
                is_system INTEGER NOT NULL DEFAULT 1
            );
            CREATE TABLE permissions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                key TEXT NOT NULL UNIQUE,
                label TEXT NOT NULL,
                module TEXT NOT NULL DEFAULT ''
            );
            CREATE TABLE role_permissions (
                role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
                permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
                PRIMARY KEY(role_id, permission_id)
            );
            CREATE TABLE user_permissions (
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
                value INTEGER NOT NULL CHECK(value IN (0, 1)),
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY(user_id, permission_id)
            );
            CREATE TABLE rbac_migrations (
                key TEXT PRIMARY KEY,
                applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE units (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                sort_order INTEGER NOT NULL DEFAULT 0,
                is_active INTEGER NOT NULL DEFAULT 1
            );
            CREATE TABLE gcal_keys (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                credentials_path TEXT NOT NULL,
                calendar_id TEXT NOT NULL,
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE gcal_sync_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE service_types (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                sort_order INTEGER NOT NULL DEFAULT 0,
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE appointments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                client_name TEXT NOT NULL,
                address TEXT DEFAULT '',
                service_type_id INTEGER REFERENCES service_types(id),
                date TEXT NOT NULL,
                start_time TEXT NOT NULL,
                end_time TEXT NOT NULL,
                note TEXT DEFAULT '',
                created_by INTEGER REFERENCES users(id),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE appointment_gcal_map (
                appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
                key_id INTEGER NOT NULL REFERENCES gcal_keys(id) ON DELETE CASCADE,
                google_event_id TEXT NOT NULL,
                synced_at TEXT NOT NULL,
                PRIMARY KEY(appointment_id, key_id)
            );
            CREATE TABLE user_page_visibility (
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                page_key TEXT NOT NULL,
                visible INTEGER NOT NULL DEFAULT 1 CHECK(visible IN (0, 1)),
                PRIMARY KEY(user_id, page_key)
            );
            CREATE UNIQUE INDEX idx_items_unique ON items(brand, code, name, unit);
            """
        )

        permission_keys = (
            "view", "stats", "kit-view", "prepared", "export", "item-mgmt",
            "stock-mgmt", "batch-loc-mgmt", "import", "stockout", "stocktake",
            "kit-mgmt", "photo", "cal-mgmt", "svc-type-mgmt", "gcal-sync-manage",
            "gcal-sync-force", "gcal-sync-team-view", "gcal-keys-manage", "unit-mgmt",
            "user-mgmt", "change-own-password", "signed-report-upload",
            "signed-report-edit", "signed-report-delete", "signed-report-delete-all",
            "quotation-upload-manage", "quotation-upload-manage-all",
            "petty-cash-delete-all", "petty-cash-view", "petty-cash-create",
            "petty-cash-edit", "petty-cash-delete", "petty-cash-config",
            "page-visibility-manage", "work-progress-view", "work-progress-create",
            "work-progress-edit", "work-progress-edit-all", "work-progress-delete",
            "work-progress-delete-all",
        )
        conn.executemany(
            "INSERT INTO roles(name, label) VALUES (?, ?)",
            [(role, role.title()) for role in ("admin", "user", "tech", "viewer")],
        )
        conn.executemany(
            "INSERT INTO permissions(key, label) VALUES (?, ?)",
            [(key, key) for key in permission_keys],
        )
        conn.execute(
            "INSERT INTO items(id, brand, code, name, qty, unit, location, note, low_stock, is_kit) "
            "VALUES (1, 'LegacyBrand', 'LEG-1', 'Legacy compressor', 3, '個', 'A-1', 'preserve me', 1, 0)"
        )
        conn.execute(
            "INSERT INTO items(id, brand, code, name, qty, unit, location, note, low_stock, is_kit) "
            "VALUES (2, 'LegacyBrand', 'KIT-1', 'Legacy HVAC kit', 1, '組', 'K-1', 'kit item', 0, 1)"
        )
        conn.execute(
            "INSERT INTO item_stocks(id, item_id, location, qty, note) VALUES (1, 1, 'A-1', 3, 'legacy stock')"
        )
        conn.execute(
            "INSERT INTO item_stocks(id, item_id, location, qty, note) VALUES (2, 2, 'K-1', 1, 'legacy kit stock')"
        )
        conn.execute(
            "INSERT INTO movements(id, item_id, delta, before_qty, after_qty, reason, created_at) "
            "VALUES (1, 1, -1, 3, 2, 'legacy issue', '2026-01-02 03:04:05')"
        )
        conn.execute(
            "INSERT INTO kits(id, item_id, name, note) VALUES (1, 2, 'Legacy HVAC kit', 'keep relation')"
        )
        conn.execute("INSERT INTO kit_items(id, kit_id, item_id, qty) VALUES (1, 1, 1, 2)")
        conn.execute(
            "INSERT INTO users(id, username, password_hash, display_name, role) "
            "VALUES (1, 'legacy-user', 'synthetic-hash', 'Legacy User', 'viewer')"
        )
        conn.execute("INSERT INTO units(id, name, sort_order, is_active) VALUES (1, '冷媒包', 99, 0)")
        conn.execute(
            "INSERT INTO gcal_keys(id, name, credentials_path, calendar_id) "
            "VALUES (1, 'legacy-key', 'synthetic.json', 'legacy-calendar')"
        )
        conn.execute("INSERT INTO service_types(id, name, sort_order, is_active) VALUES (1, '保養', 1, 1)")
        conn.execute(
            "INSERT INTO appointments(id, client_name, date, start_time, end_time, created_by) "
            "VALUES (1, 'Legacy Client', '2026-01-03', '09:00', '10:00', 1)"
        )
        conn.execute(
            "INSERT INTO appointment_gcal_map(appointment_id, key_id, google_event_id, synced_at) "
            "VALUES (1, 1, 'legacy-event', '2026-01-03T01:00:00Z')"
        )
        permission_id = conn.execute(
            "SELECT id FROM permissions WHERE key='signed-report-delete-all'"
        ).fetchone()[0]
        conn.execute(
            "INSERT INTO user_permissions(user_id, permission_id, value) VALUES (1, ?, 0)",
            (permission_id,),
        )
        conn.execute(
            "INSERT INTO role_permissions(role_id, permission_id) "
            "SELECT r.id, p.id FROM roles r, permissions p "
            "WHERE r.name='viewer' AND p.key='view'"
        )
        conn.execute(
            "INSERT INTO rbac_migrations(key) VALUES ('signed_report_action_capabilities_v1')"
        )
        conn.execute(
            "INSERT INTO user_page_visibility(user_id, page_key, visible) VALUES (1, 'inventory', 0)"
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


def test_representative_legacy_upgrade_rolls_back_and_retries_atomically(
    tmp_path, monkeypatch
) -> None:
    """A multi-table legacy upgrade must roll back, retry, and remain idempotent."""
    database_path = tmp_path / "representative-legacy-upgrade.db"
    _create_representative_legacy_database(database_path)
    before = _snapshot_representative_legacy_state(database_path)
    monkeypatch.setattr(app_db, "DB_PATH", str(database_path))

    _run_init_with_authorizer(
        lambda connection: _install_gcal_seed_failure(connection),
    )

    conn = sqlite3.connect(database_path)
    try:
        assert _table_columns(conn, "items") == [
            "id", "brand", "code", "name", "qty", "unit", "location", "note",
            "low_stock", "is_kit", "created_at", "updated_at",
        ]
        assert "updated_at" not in _table_columns(conn, "kits")
        assert "qty_type" not in _table_columns(conn, "units")
        assert "destination" not in _table_columns(conn, "movements")
        assert "pending_calendar_id" not in _table_columns(conn, "gcal_keys")
        assert "data_hash" not in _table_columns(conn, "appointment_gcal_map")
        assert "password_updated_at" not in _table_columns(conn, "users")
        assert "updated_by" not in _table_columns(conn, "appointments")
        assert _index_sql(conn, "idx_items_unique") == before["items_unique_index"]
        assert conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' "
            "AND name='daily_signed_reports'"
        ).fetchone() is None
    finally:
        conn.close()

    after_failure = _snapshot_representative_legacy_state(database_path)
    assert after_failure == before
    assert after_failure["service_seed"] is None
    assert after_failure["gcal_defaults"] == (0,)

    app_db.init_db()
    after_success = _snapshot_representative_legacy_state(database_path)
    for protected_key in (
        "item", "stock", "movement", "kit", "kit_item", "user", "role",
        "permission", "role_permission", "permission_override", "visibility_override",
        "unit", "gcal_key", "appointment_map", "existing_marker",
    ):
        assert after_success[protected_key] == before[protected_key]
    assert after_success["quotation_override"] == (0,)
    conn = sqlite3.connect(database_path)
    try:
        assert "prepared_qty" in _table_columns(conn, "items")
        assert "category" in _table_columns(conn, "items")
        assert "is_deleted" in _table_columns(conn, "items")
        assert "site" in _table_columns(conn, "items")
        assert "updated_at" in _table_columns(conn, "kits")
        assert "qty_type" in _table_columns(conn, "units")
        assert all(
            column in _table_columns(conn, "movements")
            for column in (
                "destination", "reverted_at", "source_movement_id",
                "source_stock_id", "source_site", "source_location",
                "return_stock_id", "return_site", "return_location",
            )
        )
        assert "reminders" in _table_columns(conn, "gcal_keys")
        assert "pending_calendar_id" in _table_columns(conn, "gcal_keys")
        assert "data_hash" in _table_columns(conn, "appointment_gcal_map")
        assert "password_updated_at" in _table_columns(conn, "users")
        assert "color" in _table_columns(conn, "users")
        assert "gcal_key" in _table_columns(conn, "users")
        assert "updated_by" in _table_columns(conn, "appointments")
        assert "WHERE is_deleted = 0" in _index_sql(conn, "idx_items_unique")

        assert conn.execute(
            "SELECT name, qty, location, note, prepared_qty, category, is_deleted, site "
            "FROM items WHERE id=1"
        ).fetchone() == (
            "Legacy compressor", 3.0, "A-1", "preserve me", 0.0, "", 0, "office"
        )
        assert conn.execute(
            "SELECT name, qty_type FROM units WHERE id=1"
        ).fetchone() == ("冷媒包", "integer")
        assert conn.execute(
            "SELECT value FROM user_permissions up "
            "JOIN permissions p ON p.id=up.permission_id "
            "WHERE up.user_id=1 AND p.key='signed-report-delete-all'"
        ).fetchone() == (0,)
        assert conn.execute(
            "SELECT visible FROM user_page_visibility "
            "WHERE user_id=1 AND page_key='inventory'"
        ).fetchone() == (0,)
        assert conn.execute(
            "SELECT key FROM rbac_migrations "
            "WHERE key='signed_report_action_capabilities_v1'"
        ).fetchone() == ("signed_report_action_capabilities_v1",)
        assert conn.execute(
            "SELECT key FROM rbac_migrations "
            "WHERE key='quotation_upload_permission_decoupling_v1'"
        ).fetchone() == ("quotation_upload_permission_decoupling_v1",)
        assert conn.execute("SELECT COUNT(*) FROM service_types").fetchone() == (6,)
        assert conn.execute("SELECT COUNT(*) FROM gcal_sync_settings").fetchone() == (4,)
    finally:
        conn.close()

    app_db.init_db()
    assert _snapshot_representative_legacy_state(database_path) == after_success
    assert _count_rows(database_path, "service_types") == 6
    assert _count_rows(database_path, "gcal_sync_settings") == 4
