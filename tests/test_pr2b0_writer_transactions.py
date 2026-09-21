"""PR 2B-0 runtime evidence for inventory writers and transactions.

These tests characterize the current boundary without changing production code.
They trace representative API mutations, attribute SQL to application callers,
and keep the existing atomicity/concurrency regressions as the executable gate.
"""
from __future__ import annotations

import inspect
import re
import sqlite3
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

import pytest
from fastapi.testclient import TestClient
from httpx import Response

BASE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BASE_DIR))

import app.config as app_config  # noqa: E402
import app.database as app_db  # noqa: E402
import main as app_main  # noqa: E402


_WRITE_TARGETS = {
    "item_stocks": re.compile(r"\b(?:UPDATE|INSERT(?:\s+OR\s+REPLACE)?\s+INTO|DELETE\s+FROM)\s+item_stocks\b", re.I),
    "items.prepared_qty": re.compile(
        r"\b(?:UPDATE\s+items\s+SET[\s\S]*\bprepared_qty\b|"
        r"INSERT(?:\s+OR\s+REPLACE)?\s+INTO\s+items\s*\([^)]*\bprepared_qty\b)",
        re.I,
    ),
    "movements": re.compile(r"\b(?:UPDATE|INSERT(?:\s+OR\s+REPLACE)?\s+INTO|DELETE\s+FROM)\s+movements\b", re.I),
}


@dataclass(frozen=True)
class SqlEvent:
    """One traced SQLite statement with its application caller."""

    sql: str
    caller: str
    stack: tuple[str, ...]


class SqlTrace:
    """Capture expanded SQL and the first application frame for each statement."""

    def __init__(self) -> None:
        self.events: list[SqlEvent] = []
        self.callback_errors: list[str] = []

    def install(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Patch the shared SQLite connector used by ``app.database.get_db``."""
        original_connect = app_db.sqlite3.connect

        def traced_connect(*args: object, **kwargs: object) -> sqlite3.Connection:
            connection = original_connect(*args, **kwargs)
            connection.set_trace_callback(self._record)
            return connection

        monkeypatch.setattr(app_db.sqlite3, "connect", traced_connect)

    def _record(self, sql: str) -> None:
        """Record a statement without allowing tracing to affect application behavior."""
        try:
            frames: list[str] = []
            caller = "unattributed"
            for frame_info in inspect.stack(context=0)[1:]:
                filename = Path(frame_info.filename).resolve()
                try:
                    relative = filename.relative_to(BASE_DIR).as_posix()
                except ValueError:
                    continue
                label = f"{relative}:{frame_info.function}"
                frames.append(label)
                if caller == "unattributed" and (
                    relative.startswith("app/routes/")
                    or relative.startswith("app/services/")
                ):
                    caller = label
            self.events.append(
                SqlEvent(
                    sql=sql,
                    caller=caller,
                    stack=tuple(frames),
                )
            )
        except Exception as exc:
            # Trace callbacks must remain observational; a diagnostic failure must
            # never turn a valid production request into a test-only application error.
            self.callback_errors.append(f"{type(exc).__name__}: {exc}")

    def writes_for(self, target: str) -> list[SqlEvent]:
        """Return traced write statements matching one protected inventory state."""
        pattern = _WRITE_TARGETS[target]
        return [event for event in self.events if pattern.search(event.sql)]

    def summary(self) -> dict[str, int]:
        """Return the number of traced writes for each protected inventory state."""
        return {target: len(self.writes_for(target)) for target in _WRITE_TARGETS}


@pytest.fixture()
def client(tmp_path, monkeypatch) -> Iterator[TestClient]:
    """Create an isolated authenticated client for runtime writer tracing."""
    test_db = tmp_path / "pr2b0_inventory.db"
    test_upload = tmp_path / "uploads"
    test_upload.mkdir()
    monkeypatch.setattr(app_db, "DB_PATH", str(test_db))
    monkeypatch.setattr(app_config, "UPLOAD_DIR", str(test_upload))
    app_db.init_db()

    from app.services.auth import SESSION_COOKIE, create_session, init_admin_if_missing

    connection = app_db.get_db()
    try:
        init_admin_if_missing(connection)
        admin_id = connection.execute(
            "SELECT id FROM users WHERE username='admin'"
        ).fetchone()["id"]
        token = create_session(connection, admin_id)
    finally:
        connection.close()

    with TestClient(app_main.app) as test_client:
        test_client.cookies.set(SESSION_COOKIE, token)
        yield test_client


def _create_item(client: TestClient) -> dict:
    """Create one stock item used by the representative mutation flow."""
    response = client.post(
        "/api/items",
        json={
            "brand": "PR2B0",
            "code": "TRACE-1",
            "name": "writer trace item",
            "unit": "個",
            "low_stock": 0,
            "site": "office",
            "stocks": [{"location": "A倉", "qty": 10, "note": ""}],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _assert_ok(response: Response) -> None:
    """Fail with response details when a representative mutation is rejected."""
    assert response.status_code < 300, response.text


def test_runtime_trace_attributes_representative_inventory_writers(client, monkeypatch) -> None:
    """Trace item, stock, prepared, and movement writers through real API routes."""
    trace = SqlTrace()
    trace.install(monkeypatch)

    item = _create_item(client)
    item_id = item["id"]
    _assert_ok(
        client.post(
            f"/api/items/{item_id}/adjust",
            json={"delta": 2, "reason": "PR2B0 trace"},
        )
    )
    _assert_ok(client.post(f"/api/items/{item_id}/prepare", json={"qty": 1}))
    _assert_ok(
        client.post(
            "/api/stockout",
            json={"item_id": item_id, "qty": 1, "destination": "PR2B0"},
        )
    )
    _assert_ok(
        client.post(
            "/api/stocktake",
            json={"items": [{"item_id": item_id, "location": "A倉", "actual_qty": 11}]},
        )
    )

    summary = trace.summary()
    print(f"PR2B0 runtime writer summary: {summary}")
    print(f"PR2B0 runtime writer callers: {sorted({event.caller for event in trace.events})}")
    assert not trace.callback_errors, trace.callback_errors
    assert all(summary.values()), summary
    assert any(event.sql.upper().startswith("BEGIN IMMEDIATE") for event in trace.events)
    assert any(event.sql.upper() == "COMMIT" for event in trace.events)

    expected_callers = {
        "app/routes/items.py:create_item",
        "app/routes/items.py:adjust_qty",
        "app/routes/stockout.py:prepare_item",
        "app/routes/stockout.py:stock_out",
        "app/routes/stocktake.py:submit_stocktake",
    }
    observed_callers = {event.caller for event in trace.events}
    assert expected_callers <= observed_callers, sorted(observed_callers)

    inventory_writes = [
        event
        for target in _WRITE_TARGETS
        for event in trace.writes_for(target)
    ]
    assert inventory_writes
    assert all(event.caller.startswith("app/routes/") for event in inventory_writes)
    assert all(event.stack for event in inventory_writes)


@pytest.mark.parametrize(
    ("target", "route_module"),
    [
        ("item_stocks", "app/routes/items.py"),
        ("items.prepared_qty", "app/routes/stockout.py"),
        ("movements", "app/routes/items.py"),
    ],
)
def test_runtime_trace_has_route_attribution_for_each_state(
    client, monkeypatch, target, route_module
) -> None:
    """Require each protected state to retain a concrete route-level caller."""
    trace = SqlTrace()
    trace.install(monkeypatch)
    item = _create_item(client)
    _assert_ok(client.post(f"/api/items/{item['id']}/adjust", json={"delta": 1, "reason": "trace"}))
    _assert_ok(client.post(f"/api/items/{item['id']}/prepare", json={"qty": 1}))

    events = trace.writes_for(target)
    assert events, target
    assert any(event.caller.startswith(route_module) for event in events), [
        event.caller for event in events
    ]
