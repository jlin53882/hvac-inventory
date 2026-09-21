"""Permission taxonomy characterization and architecture-fitness tests.

These tests derive the permission catalog from the initialized production
schema.  They intentionally do not create a second full permission registry;
their job is to verify persistence, resolution, consumer references, and the
separation between page visibility and capability metadata.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

import app.database as app_db
import pytest
from app.models import PAGE_KEYS
from app.services.auth import ensure_user_page_visibility, get_user_permissions


PROJECT_ROOT = Path(__file__).resolve().parents[1]
BACKEND_HELPERS = {"require_perm", "require_db_perm", "has_perm", "_require_pc_perm"}
FORCED_PERMISSION_RULES = {
    "view": lambda role: True,
    "user-mgmt": lambda role: role == "admin",
    "page-visibility-manage": lambda role: role == "admin",
    "svc-type-mgmt": lambda role: role == "admin",
    "unit-mgmt": lambda role: role == "admin",
}


@pytest.fixture()
def taxonomy_db(tmp_path, monkeypatch):
    """Initialize an isolated production schema for taxonomy checks."""
    monkeypatch.setattr(app_db, "DB_PATH", str(tmp_path / "permission-taxonomy.db"))
    app_db.init_db()
    yield tmp_path / "permission-taxonomy.db"


def _permission_keys(conn) -> set[str]:
    """Return the initialized permission keys used as the canonical catalog."""
    return {row["key"] for row in conn.execute("SELECT key FROM permissions")}


def _insert_user(conn, username: str, role: str) -> int:
    """Insert a minimal active user for resolver characterization."""
    cursor = conn.execute(
        "INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)",
        (username, "test-hash", username, role),
    )
    conn.commit()
    return cursor.lastrowid


def _function_name(node: ast.Call) -> str | None:
    """Return a called function's short name for the consumer scanner."""
    if isinstance(node.func, ast.Name):
        return node.func.id
    if isinstance(node.func, ast.Attribute):
        return node.func.attr
    return None


def _backend_permission_literals() -> set[str]:
    """Scan backend auth helpers and permission maps.

    This is an architecture-fitness scanner, not proof of runtime authorization
    correctness.  Dynamic keys remain covered by the domain runtime tests.
    """
    references: set[str] = set()
    for path in sorted((PROJECT_ROOT / "app" / "routes").rglob("*.py")) + sorted(
        (PROJECT_ROOT / "app" / "services").rglob("*.py")
    ):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and _function_name(node) in BACKEND_HELPERS:
                for argument in node.args:
                    if isinstance(argument, ast.Constant) and isinstance(argument.value, str):
                        references.add(argument.value)
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
                if node.func.attr != "get" or not node.args:
                    continue
                receiver = ast.unparse(node.func.value)
                if "perm" not in receiver.lower():
                    continue
                argument = node.args[0]
                if isinstance(argument, ast.Constant) and isinstance(argument.value, str):
                    references.add(argument.value)
            if isinstance(node, ast.Subscript):
                receiver = ast.unparse(node.value)
                if "perm" not in receiver.lower():
                    continue
                index = node.slice
                if isinstance(index, ast.Constant) and isinstance(index.value, str):
                    references.add(index.value)
    return references


def _frontend_permission_literals() -> set[str]:
    """Collect literal frontend capability references for catalog validation."""
    references: set[str] = set()
    patterns = (
        re.compile(r"\bhasPerm\(\s*['\"]([^'\"]+)['\"]"),
        re.compile(r"\b(?:perms|permissions)\[['\"]([^'\"]+)['\"]\]"),
    )
    for path in sorted((PROJECT_ROOT / "static" / "js").rglob("*.js")):
        text = path.read_text(encoding="utf-8")
        for pattern in patterns:
            references.update(pattern.findall(text))
    return references


def test_seeded_permission_catalog_is_unique_and_taxonomized(taxonomy_db):
    """The initialized catalog has unique keys and non-empty known modules."""
    conn = app_db.get_db()
    try:
        rows = conn.execute("SELECT key, module FROM permissions ORDER BY key").fetchall()
        keys = [row["key"] for row in rows]
        assert keys
        assert len(keys) == len(set(keys))
        assert all(row["module"].strip() for row in rows)
        assert {row["module"] for row in rows} == {
            "view", "stock", "calendar", "reports", "system",
        }
        assert conn.execute(
            """SELECT COUNT(*) FROM role_permissions rp
               LEFT JOIN roles r ON r.id = rp.role_id
               LEFT JOIN permissions p ON p.id = rp.permission_id
               WHERE r.id IS NULL OR p.id IS NULL"""
        ).fetchone()[0] == 0
    finally:
        conn.close()


def test_role_defaults_round_trip_through_resolver(taxonomy_db):
    """Resolved role permissions match DB defaults except documented forced rules."""
    conn = app_db.get_db()
    try:
        user_ids = {
            role: _insert_user(conn, f"taxonomy-{role}", role)
            for role in ("admin", "user", "tech", "viewer")
        }
        # A second active admin prevents the single-admin safety rule from
        # masking the actual role_permissions resolution under test.
        _insert_user(conn, "taxonomy-admin-second", "admin")
        role_rows = conn.execute(
            """SELECT r.name, p.key FROM role_permissions rp
               JOIN roles r ON r.id = rp.role_id
               JOIN permissions p ON p.id = rp.permission_id"""
        ).fetchall()
        role_defaults = {(row["name"], row["key"]) for row in role_rows}
        keys = _permission_keys(conn)
        for role, user_id in user_ids.items():
            resolved = get_user_permissions(conn, user_id)
            assert set(resolved) == keys
            for key in keys:
                expected = (role, key) in role_defaults if key not in FORCED_PERMISSION_RULES else FORCED_PERMISSION_RULES[key](role)
                assert resolved[key] is expected, f"{role}/{key} resolver drift"
    finally:
        conn.close()


def test_explicit_override_precedes_role_default_for_allow_and_deny(taxonomy_db):
    """Explicit 0 denies an allowed key and explicit 1 grants a denied key."""
    conn = app_db.get_db()
    try:
        user_id = _insert_user(conn, "taxonomy-override", "user")
        role_id = conn.execute("SELECT id FROM roles WHERE name='user'").fetchone()["id"]
        allowed = conn.execute(
            """SELECT p.key FROM role_permissions rp
               JOIN permissions p ON p.id = rp.permission_id
               WHERE rp.role_id = ? AND p.key NOT IN ('view')
               ORDER BY p.key LIMIT 1""",
            (role_id,),
        ).fetchone()["key"]
        denied = conn.execute(
            """SELECT p.key FROM permissions p
               WHERE p.key <> 'view'
                 AND NOT EXISTS (
                     SELECT 1 FROM role_permissions rp
                     WHERE rp.role_id = ? AND rp.permission_id = p.id
                 )
               ORDER BY p.key LIMIT 1""",
            (role_id,),
        ).fetchone()["key"]
        permission_ids = {
            row["key"]: row["id"]
            for row in conn.execute(
                "SELECT id, key FROM permissions WHERE key IN (?, ?)", (allowed, denied)
            )
        }
        conn.executemany(
            "INSERT INTO user_permissions (user_id, permission_id, value) VALUES (?, ?, ?)",
            [(user_id, permission_ids[allowed], 0), (user_id, permission_ids[denied], 1)],
        )
        conn.commit()
        resolved = get_user_permissions(conn, user_id)
        assert resolved[allowed] is False
        assert resolved[denied] is True
    finally:
        conn.close()


def test_backend_permission_literals_resolve_to_seeded_keys(taxonomy_db):
    """Literal backend auth references are seeded; dynamic refs need runtime tests."""
    conn = app_db.get_db()
    try:
        keys = _permission_keys(conn)
    finally:
        conn.close()
    references = _backend_permission_literals()
    assert references <= keys
    assert {"signed-report-edit", "signed-report-delete-all", "quotation-upload-manage-all"} <= references


def test_frontend_permission_literals_resolve_to_seeded_keys(taxonomy_db):
    """Literal frontend capability references are catalog keys, not page keys."""
    conn = app_db.get_db()
    try:
        keys = _permission_keys(conn)
    finally:
        conn.close()
    references = _frontend_permission_literals()
    assert references <= keys
    assert {"gcal-sync-team-view", "petty-cash-view", "work-progress-view"} <= references


def test_page_visibility_catalog_is_separate_from_permissions(taxonomy_db):
    """Page visibility rows use the model page registry, never permission keys."""
    conn = app_db.get_db()
    try:
        user_id = _insert_user(conn, "taxonomy-pages", "viewer")
        ensure_user_page_visibility(conn, user_id, "viewer")
        page_rows = conn.execute(
            "SELECT page_key FROM user_page_visibility WHERE user_id=?", (user_id,)
        ).fetchall()
        page_keys = {row["page_key"] for row in page_rows}
        permission_keys = _permission_keys(conn)
        assert page_keys == set(PAGE_KEYS)
        assert "page-visibility-manage" in permission_keys
        assert "page-visibility-manage" not in page_keys
    finally:
        conn.close()
