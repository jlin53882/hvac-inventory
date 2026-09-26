"""Item-level inventory invariant guard (projected-state validation).

Single shared contract for every mutation that reduces ``total_qty``::

    projected_total = current_total + stock_delta
    projected_prepared = current_prepared + prepared_delta

    projected_total >= projected_prepared >= 0

Callers validate the FINAL committed state, never an intermediate one.
E.g. ``prepared-out`` passes ``stock_delta=-qty, prepared_delta=-qty`` so
``stock=5, prepared=5, out=2`` correctly lands on ``3 >= 3`` instead of
being falsely rejected against the pre-decrement ``prepared=5``.

Transaction ownership: routes own ``BEGIN IMMEDIATE`` / commit / rollback.
These helpers only use the passed ``conn``, re-read authoritative state
(must be called AFTER the route issued ``BEGIN IMMEDIATE``), and raise --
never commit.
"""
from fastapi import HTTPException

from app.services.quantity import canonical_qty


def current_state(conn, item_id):
    """Return ``(total_qty, prepared_qty)`` freshly read from ``conn``."""
    total = canonical_qty(conn.execute(
        "SELECT COALESCE(SUM(qty), 0) FROM item_stocks WHERE item_id=?",
        (item_id,)).fetchone()[0])
    row = conn.execute(
        "SELECT prepared_qty FROM items WHERE id=?", (item_id,)).fetchone()
    prepared = canonical_qty(row["prepared_qty"] or 0) if row else 0.0
    return total, prepared


def assert_projected_inventory(conn, item_id, stock_delta=0, prepared_delta=0):
    """Reject the mutation if its projected final state breaks the invariant.

    Raises ``HTTPException(400)``; otherwise returns
    ``(projected_total, projected_prepared)`` for movement bookkeeping.
    """
    total, prepared = current_state(conn, item_id)
    projected_total = canonical_qty(total + stock_delta)
    projected_prepared = canonical_qty(prepared + prepared_delta)
    if projected_prepared < 0:
        raise HTTPException(400, "待領出數量不可為負數")
    if projected_total < projected_prepared:
        raise HTTPException(
            400,
            f"庫存不足以保留待領出數量！目前庫存 {total}、待領出 {prepared}，"
            f"此操作後庫存 {projected_total} 將低於待領出 {projected_prepared}",
        )
    return projected_total, projected_prepared


_IN_CHUNK = 500


def chunked_ids(ids, size: int = _IN_CHUNK):
    """去重後依 SQLite 參數上限切塊，供 IN (...) 批次查詢。"""
    unique = list(dict.fromkeys(int(i) for i in ids))
    for start in range(0, len(unique), size):
        yield unique[start:start + size]


def total_qty_map(conn, item_ids) -> dict:
    """批次計算多個品項的位置庫存總量 {item_id: qty}（無 stock 的品項為 0）。"""
    totals = {}
    for chunk in chunked_ids(item_ids):
        placeholders = ",".join("?" * len(chunk))
        for row in conn.execute(
            f"SELECT item_id, COALESCE(SUM(qty),0) AS q FROM item_stocks WHERE item_id IN ({placeholders}) GROUP BY item_id",
            chunk,
        ):
            totals[row["item_id"]] = row["q"]
        for item_id in chunk:
            totals[item_id] = canonical_qty(totals.get(item_id, 0))
    return totals
