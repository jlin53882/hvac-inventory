"""Runtime evidence for inventory writers and transaction boundaries.

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
from typing import Callable, Iterator

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
    test_db = tmp_path / "inventory_writer_trace.db"
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


def _create_item(
    client: TestClient,
    *,
    code: str = "TRACE-1",
    name: str = "writer trace item",
    unit: str = "個",
    site: str = "office",
    qty: float = 10,
    location: str = "A倉",
) -> dict:
    """Create one stock item used by the representative mutation flows."""
    response = client.post(
        "/api/items",
        json={
            "brand": "inventory writer trace",
            "code": code,
            "name": name,
            "unit": unit,
            "low_stock": 0,
            "site": site,
            "stocks": [{"location": location, "qty": qty, "note": ""}],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _assert_ok(response: Response) -> None:
    """Fail with response details when a representative mutation is rejected."""
    assert response.status_code < 300, response.text


def _trace_request(
    monkeypatch: pytest.MonkeyPatch,
    request: Callable[[], Response],
) -> tuple[SqlTrace, Response]:
    """Run one API request with an isolated SQL trace for boundary assertions."""
    trace = SqlTrace()
    trace.install(monkeypatch)
    response = request()
    _assert_ok(response)
    return trace, response


def _assert_successful_route_transaction(
    trace: SqlTrace,
    *,
    route_module: str,
    route_owner: str,
    targets: tuple[str, ...],
    minimum_writes: dict[str, int] | None = None,
    begin_prefixes: tuple[str, ...] = ("BEGIN IMMEDIATE",),
    extra_events: tuple[SqlEvent, ...] = (),
) -> None:
    """Assert route ownership, writer attribution, and transaction statements."""
    assert not trace.callback_errors, trace.callback_errors
    assert any(
        event.sql.upper().startswith(prefix) for event in trace.events for prefix in begin_prefixes
    )
    assert any(event.sql.upper() == "COMMIT" for event in trace.events)
    minimum_writes = minimum_writes or {target: 1 for target in targets}
    protected_events: list[SqlEvent] = []
    for target in targets:
        events = trace.writes_for(target)
        assert len(events) >= minimum_writes[target], [event.sql for event in events]
        assert all(event.caller.startswith(route_module) for event in events), [
            event.caller for event in events
        ]
        assert all(any(frame.startswith(route_owner) for frame in event.stack) for event in events), [
            event.stack for event in events
        ]
        protected_events.extend(events)

    for event in extra_events:
        assert event.caller.startswith(route_module), event.caller
        assert any(frame.startswith(route_owner) for frame in event.stack), event.stack
    protected_events.extend(extra_events)

    protected_ids = {id(event) for event in protected_events}
    write_indices = [
        index for index, event in enumerate(trace.events) if id(event) in protected_ids
    ]
    assert write_indices
    first_write = min(write_indices)
    last_write = max(write_indices)
    begin_indices = [
        index
        for index, event in enumerate(trace.events[:first_write])
        if any(event.sql.upper().startswith(prefix) for prefix in begin_prefixes)
    ]
    commit_indices = [
        index
        for index, event in enumerate(trace.events[last_write + 1 :], last_write + 1)
        if event.sql.upper() == "COMMIT"
    ]
    assert begin_indices, [event.sql for event in trace.events[:first_write]]
    assert commit_indices, [event.sql for event in trace.events[last_write + 1 :]]
    begin_index = max(begin_indices)
    commit_index = min(commit_indices)
    assert begin_index < first_write <= last_write < commit_index
    assert all(begin_index < index < commit_index for index in write_indices)
    assert not any(
        event.sql.upper() in {"COMMIT", "ROLLBACK"}
        for event in trace.events[begin_index + 1 : commit_index]
    )


def test_runtime_trace_attributes_representative_inventory_writers(client, monkeypatch) -> None:
    """Trace representative inventory writers with one boundary per API request."""
    create_trace, create_response = _trace_request(
        monkeypatch,
        lambda: client.post(
            "/api/items",
            json={
                "brand": "inventory writer trace",
                "code": "TRACE-1",
                "name": "writer trace item",
                "unit": "個",
                "low_stock": 0,
                "site": "office",
                "stocks": [{"location": "A倉", "qty": 10, "note": ""}],
            },
        ),
    )
    item = create_response.json()
    item_id = item["id"]
    _assert_successful_route_transaction(
        create_trace,
        route_module="app/routes/items.py",
        route_owner="app/routes/items.py:create_item",
        targets=("item_stocks",),
        begin_prefixes=("BEGIN",),
    )

    adjust_trace, _ = _trace_request(
        monkeypatch,
        lambda: client.post(
            f"/api/items/{item_id}/adjust",
            json={"delta": 2, "reason": "inventory writer trace"},
        ),
    )
    _assert_successful_route_transaction(
        adjust_trace,
        route_module="app/routes/items.py",
        route_owner="app/routes/items.py:adjust_qty",
        targets=("item_stocks", "movements"),
    )

    prepare_trace, _ = _trace_request(
        monkeypatch,
        lambda: client.post(f"/api/items/{item_id}/prepare", json={"qty": 1}),
    )
    _assert_successful_route_transaction(
        prepare_trace,
        route_module="app/routes/stockout.py",
        route_owner="app/routes/stockout.py:prepare_item",
        targets=("items.prepared_qty", "movements"),
        begin_prefixes=("BEGIN",),
    )

    stockout_trace, _ = _trace_request(
        monkeypatch,
        lambda: client.post(
            "/api/stockout",
            json={"item_id": item_id, "qty": 1, "destination": "inventory writer trace"},
        ),
    )
    _assert_successful_route_transaction(
        stockout_trace,
        route_module="app/routes/stockout.py",
        route_owner="app/routes/stockout.py:stock_out",
        targets=("item_stocks", "movements"),
    )

    stocktake_trace, _ = _trace_request(
        monkeypatch,
        lambda: client.post(
            "/api/stocktake",
            json={"items": [{"item_id": item_id, "location": "A倉", "actual_qty": 11}]},
        ),
    )
    _assert_successful_route_transaction(
        stocktake_trace,
        route_module="app/routes/stocktake.py",
        route_owner="app/routes/stocktake.py:submit_stocktake",
        targets=("item_stocks", "movements"),
    )

    trace = SqlTrace()
    for operation_trace in (
        create_trace,
        adjust_trace,
        prepare_trace,
        stockout_trace,
        stocktake_trace,
    ):
        trace.events.extend(operation_trace.events)
        trace.callback_errors.extend(operation_trace.callback_errors)
    summary = trace.summary()
    print(f"inventory writer runtime summary: {summary}")
    print(f"inventory writer runtime callers: {sorted({event.caller for event in trace.events})}")
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


def test_runtime_trace_attributes_kit_assembly_writer(client, monkeypatch) -> None:
    """Trace a real kit assembly through kits.py and its protected-state writes."""
    material = _create_item(
        client,
        code="TRACE-KIT-MAT",
        name="kit trace material",
        qty=5,
        location="組裝架",
    )
    response = client.post(
        "/api/kits",
        json={
            "name": "kit trace bundle",
            "site": "office",
            "items": [{"item_id": material["id"], "qty": 1}],
        },
    )
    assert response.status_code == 201, response.text
    kit = response.json()

    trace = SqlTrace()
    trace.install(monkeypatch)
    _assert_ok(client.post(f"/api/kits/{kit['id']}/assemble", json={"qty": 1}))

    _assert_successful_route_transaction(
        trace,
        route_module="app/routes/kits.py",
        route_owner="app/routes/kits.py:assemble_kit",
        targets=("item_stocks", "movements"),
        minimum_writes={"item_stocks": 2, "movements": 2},
    )


def test_runtime_trace_attributes_cross_site_transfer_writers(client, monkeypatch) -> None:
    """Trace source and target stock/movement writes through transfers.py."""
    source = _create_item(
        client,
        code="TRACE-TRANSFER",
        name="transfer trace item",
        site="office",
        qty=5,
        location="來源架",
    )
    source_stock = app_db.get_db()
    try:
        source_stock_id = source_stock.execute(
            "SELECT id FROM item_stocks WHERE item_id=? AND location=?",
            (source["id"], "來源架"),
        ).fetchone()["id"]
    finally:
        source_stock.close()

    trace = SqlTrace()
    trace.install(monkeypatch)
    response = client.post(
        "/api/inventory/transfers",
        json={
            "item_id": source["id"],
            "target_site": "van",
            "qty": 2,
            "source_location": "來源架",
            "target_location": "車內架",
        },
    )
    _assert_ok(response)
    transfer = response.json()
    target_id = transfer["target_item_id"]

    _assert_successful_route_transaction(
        trace,
        route_module="app/routes/transfers.py",
        route_owner="app/routes/transfers.py:transfer_inventory",
        targets=("item_stocks", "movements"),
        minimum_writes={"item_stocks": 2, "movements": 2},
    )

    stock_write_sql = [event.sql for event in trace.writes_for("item_stocks")]
    assert any(
        re.search(rf"UPDATE\s+item_stocks.*WHERE\s+id=\s*{source_stock_id}\b", sql, re.I | re.S)
        for sql in stock_write_sql
    ), stock_write_sql
    assert any(
        re.search(rf"INSERT\s+INTO\s+item_stocks.*VALUES\s*\(\s*{target_id}\s*,", sql, re.I | re.S)
        for sql in stock_write_sql
    ), stock_write_sql
    movement_write_sql = [event.sql for event in trace.writes_for("movements")]
    assert any(
        re.search(rf"VALUES\s*\(\s*{source['id']}\s*,\s*-2(?:\.0+)?\s*,", sql, re.I | re.S)
        for sql in movement_write_sql
    ), movement_write_sql
    assert any(
        re.search(rf"VALUES\s*\(\s*{target_id}\s*,\s*2(?:\.0+)?\s*,", sql, re.I | re.S)
        for sql in movement_write_sql
    ), movement_write_sql

    connection = app_db.get_db()
    try:
        movements = connection.execute(
            "SELECT item_id, delta FROM movements WHERE item_id IN (?, ?) "
            "AND reason='庫存調撥' ORDER BY item_id",
            (source["id"], target_id),
        ).fetchall()
        stocks = connection.execute(
            "SELECT item_id, COALESCE(SUM(qty), 0) AS total_qty FROM item_stocks "
            "WHERE item_id IN (?, ?) GROUP BY item_id ORDER BY item_id",
            (source["id"], target_id),
        ).fetchall()
    finally:
        connection.close()
    assert [(row["item_id"], row["delta"]) for row in movements] == [
        (source["id"], -2),
        (target_id, 2),
    ]
    assert [(row["item_id"], row["total_qty"]) for row in stocks] == [
        (source["id"], 3),
        (target_id, 2),
    ]


def test_runtime_trace_attributes_unit_inventory_writer(client, monkeypatch) -> None:
    """Trace unit consolidation with quantity conversion through units.py."""
    item = _create_item(
        client,
        code="TRACE-UNIT",
        name="unit trace item",
        unit="/4罐",
        qty=3,
        location="單位架",
    )

    trace = SqlTrace()
    trace.install(monkeypatch)
    response = client.post(
        "/api/units/consolidate-item",
        json={"item_id": item["id"], "to_unit": "罐", "new_qty": 2.5},
    )
    _assert_ok(response)

    unit_write_events = tuple(
        event
        for event in trace.events
        if re.search(r"UPDATE\s+items\s+SET\s+unit\s*=", event.sql, re.I)
    )
    assert len(unit_write_events) == 1, [event.sql for event in unit_write_events]
    _assert_successful_route_transaction(
        trace,
        route_module="app/routes/units.py",
        route_owner="app/routes/units.py:consolidate_item",
        targets=("item_stocks", "movements"),
        extra_events=unit_write_events,
    )
    connection = app_db.get_db()
    try:
        stock = connection.execute(
            "SELECT qty FROM item_stocks WHERE item_id=?", (item["id"],)
        ).fetchone()
        movement = connection.execute(
            "SELECT delta, before_qty, after_qty, reason FROM movements "
            "WHERE item_id=? ORDER BY id DESC LIMIT 1",
            (item["id"],),
        ).fetchone()
        saved_item = connection.execute(
            "SELECT unit FROM items WHERE id=?", (item["id"],)
        ).fetchone()
    finally:
        connection.close()
    assert stock["qty"] == 2.5
    assert dict(movement) == {
        "delta": -0.5,
        "before_qty": 3,
        "after_qty": 2.5,
        "reason": "歷史單位轉換",
    }
    assert saved_item["unit"] == "罐"


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
