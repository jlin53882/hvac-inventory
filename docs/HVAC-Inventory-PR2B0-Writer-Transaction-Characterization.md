# HVAC Inventory PR2B-0 Writer and Transaction Characterization

## 1. Purpose and boundary

This document records evidence for the writer/transaction/concurrency characterization phase. It is an evidence artifact, not a production refactor proposal and not a replacement for the long-term maintenance-contract document.

The phase is deliberately limited to:

- inventory writer inventory using the reproducible static scanner;
- runtime SQL tracing with route/module/function attribution;
- transaction-owner characterization;
- atomicity and concurrency regression evidence;
- a written GO/NO-GO recommendation for any future mutation-boundary refactor.

No production Python, JavaScript, CSS, API, database schema, migration, permission key, or inventory behavior is changed by this phase.

Source-of-truth rule: this document describes observed behavior. If it conflicts with verified production behavior or executable tests, re-run the evidence before changing production code.

## 2. Baseline

| Evidence | Result |
|---|---|
| Workspace | `C:/Users/admin/workspace/hvac-inventory-PR2B0` |
| Branch | `feature/pr2b0-writer-transaction-characterization` |
| Base | current `origin/master` at `09a0187e9ffb303cae6cf615fd4ccc43818ec905` |
| Production changes | None |
| Scanner | `scripts/scan_inventory_writers.py`, byte-compared unchanged against `C:/Users/admin/workspace/hvac-inventory-maintainability-hardening-plan/scripts/scan_inventory_writers.py` before staging |

## 3. Static writer inventory

Command:

```text
python scripts/scan_inventory_writers.py --root .
```

Observed summaries (the first PR2B-0 run was taken before adding the scanner's own regression fixtures; the final worktree run includes those intentionally scannable fixture literals):

| Protected state | Phase 0 baseline | First PR2B-0 run | Final PR2B-0 worktree | Production/source | Final test fixtures |
|---|---:|---:|---:|---:|---:|
| `item_stocks` | 58 | 58 | 59 | 32 | 27 |
| `items.prepared_qty` | 9 | 9 | 10 | 6 | 4 |
| `movements` | 46 | 46 | 47 | 33 | 14 |

The scanner's `production/source` label means that a SQL-like literal was found under a non-test source path; it does not prove that the text is executable or reachable. Quoted SQL-like text in comments/docstrings, HTML templates, and other non-executable text can be counted. Runtime trace and route attribution are the evidence for reachable representative writers. The same scanner is used for before/after comparison. Its output is not treated as runtime reachability or transaction proof. Dynamic/helper-generated SQL can be missed or cannot always be attributed to its eventual table writer. `tests/test_inventory_writer_scanner.py` covers the required multiline/upsert forms and keeps this static-literal limitation explicit.

Source-path locations containing inventory-write SQL-like literals reported by the scanner are concentrated in:

- `app/routes/items.py`
- `app/routes/kits.py`
- `app/routes/stockout.py`
- `app/routes/stocktake.py`
- `app/routes/transfers.py`
- `app/routes/units.py`

## 4. Runtime trace method

`tests/test_pr2b0_writer_transactions.py` patches the shared SQLite connector only inside the test process. Each connection receives `sqlite3.Connection.set_trace_callback`; the callback records:

- expanded SQL text;
- the first `app/routes/` or `app/services/` stack frame;
- the full application-frame stack used for attribution.

The test drives real authenticated API routes against an isolated temporary database. The representative runtime set now includes one operation for each static-discovered production writer module:

1. create an item and initial stock, then exercise item adjustment, preparation, stockout, and stocktake;
2. assemble a kit through `POST /api/kits/{id}/assemble`;
3. transfer stock through `POST /api/inventory/transfers`, including source and target stock/movement writes;
4. consolidate one item's unit with a quantity conversion through `POST /api/units/consolidate-item`.

The trace records route ownership separately from the immediate SQL-writing helper. For example, kit writes are emitted by `kits.py:_deduct_total` / `kits.py:_add_total` while the full stack retains `kits.py:assemble_kit` as the route owner.

Command:

```text
uv run pytest -q tests/test_pr2b0_writer_transactions.py -s
```

Observed local output from the isolated workspace:

```text
PR2B0 runtime writer summary: {'item_stocks': 4, 'items.prepared_qty': 1, 'movements': 4}
PR2B0 runtime writer callers: ... app/routes/items.py:create_item ... app/routes/items.py:adjust_qty ... app/routes/stockout.py:prepare_item ... app/routes/stockout.py:stock_out ... app/routes/stocktake.py:submit_stocktake ...
7 passed, 8 warnings
```

The exact pass total and warning count above are recorded from that command, not inferred from repository history. The runtime assertions verify that all three protected states are reached in the original representative flow; `kits.py`, `transfers.py`, and `units.py` each have a separate real API mutation with protected-state writes; each new operation observes `BEGIN IMMEDIATE` and `COMMIT` with every protected write enclosed between those boundaries and no intermediate `COMMIT`/`ROLLBACK`; every protected-state write remains attributable to its route module and its route owner remains present in the full stack; and no trace-callback errors were swallowed. The harness is diagnostic: it does not alter production connection behavior.

## 5. Transaction ownership characterization

The current system has route-owned connections and mixed transaction-start behavior:

| Representative operation | Current owner | Observed/source boundary | Characterization |
|---|---|---|---|
| Create item + initial stock | `app/routes/items.py:create_item` | `items.py:314-351` | Connection lifecycle and commit/rollback are owned by the route; the route does not explicitly issue `BEGIN IMMEDIATE`, so SQLite begins the write transaction when the first write executes. |
| Adjust quantity + movement | `app/routes/items.py:adjust_qty` | `items.py:677-726` | Explicit `BEGIN IMMEDIATE`; stock and movement are committed or rolled back together. |
| Prepare quantity + zero-delta movement | `app/routes/stockout.py:prepare_item` | `stockout.py:647-678` | Route owns commit/rollback, but does not explicitly issue `BEGIN IMMEDIATE`; the guarded `UPDATE items.prepared_qty` starts SQLite's write transaction. |
| Direct stockout + movement | `app/routes/stockout.py:stock_out` | `stockout.py:172-207` | Explicit `BEGIN IMMEDIATE`; projected-inventory guard, stock deduction, and movement write share the route transaction. |
| Stocktake + movement + stocktake row | `app/routes/stocktake.py:27-100` | `stocktake.py:35-100` | Explicit `BEGIN IMMEDIATE`; batch validation and all rows are committed or rolled back together. |
| Kit assembly | `app/routes/kits.py:assemble_kit` | `kits.py:307-359` | Explicit `BEGIN IMMEDIATE`; material deductions, assembled-kit stock increase, and their movements share the route transaction. SQL writes are emitted by `_deduct_total` and `_add_total`, with `assemble_kit` retained in the trace stack as route owner. |
| Cross-site transfer | `app/routes/transfers.py:transfer_inventory` | `transfers.py:166-211` | Explicit `BEGIN IMMEDIATE`; source deduction, target creation/update, and both movements share one transaction. |
| Unit consolidation with quantity conversion | `app/routes/units.py:consolidate_item` | `units.py:191-248` | Explicit `BEGIN IMMEDIATE`; unit update, single-stock quantity update, and the conversion movement share one transaction. The representative path writes protected stock/movement state only when `new_qty` is supplied. |

This is a verified description of current ownership, not authorization to centralize it. The evidence shows heterogeneous transaction-start policy, but heterogeneity alone is not a correctness failure.

## 6. Writer-class coverage matrix

`Static writer` means the scanner found at least one SQL-like protected-state literal under the module's source path. `Runtime representative` means the named test executed a real authenticated API route and observed protected-state SQL with the listed route/module attribution. Neither column means all writer paths are covered.

| Writer module | Static writer | Runtime representative | Transaction style | Protected state observed |
|---|---|---|---|---|
| `items.py` | Yes | Yes: adjustment, preparation, stockout, stocktake | Mixed: deferred create/prepare; explicit `BEGIN IMMEDIATE` for adjustment, stockout, stocktake | `item_stocks`, `items.prepared_qty`, `movements` |
| `kits.py` | Yes | Yes: `assemble_kit` | Explicit `BEGIN IMMEDIATE`; route-owned, helper-emitted writes | `item_stocks`, `movements` |
| `stockout.py` | Yes | Yes: preparation and stockout | Mixed: deferred preparation; explicit `BEGIN IMMEDIATE` for stockout | `item_stocks`, `items.prepared_qty`, `movements` |
| `stocktake.py` | Yes | Yes: `submit_stocktake` | Explicit `BEGIN IMMEDIATE` | `item_stocks`, `movements` |
| `transfers.py` | Yes | Yes: `transfer_inventory` | Explicit `BEGIN IMMEDIATE` | source/target `item_stocks`, source/target `movements` |
| `units.py` | Yes | Yes: `consolidate_item` with `new_qty` | Explicit `BEGIN IMMEDIATE` | `item_stocks`, `movements` |

The three added representatives are intentionally narrow: kit assembly does not characterize disassembly, transfer does not characterize every target/BOM branch, and units consolidation does not characterize every unit CRUD path. They close module-level runtime attribution evidence without claiming exhaustive endpoint coverage.

## 7. Atomicity evidence

The existing regression tests were executed without changing their implementation:

```text
uv run pytest -q \
  tests/test_inventory_integrity.py::TestPreparedOutRollback::test_prepared_out_rollback_on_write_failure \
  tests/test_inventory_integrity.py::TestConcurrentDeduction::test_concurrent_direct_stockout_second_rejected \
  tests/test_inventory_integrity.py::TestStocktake::test_stocktake_missing_location_rejects_whole_batch \
  tests/test_vehicle_inventory.py::test_transfer_rejects_existing_kit_with_different_bom
```

Observed result:

```text
4 passed, 5 warnings
```

Protected behaviors demonstrated by these tests:

- an injected failure after prepared-out stock deduction leaves stock, `prepared_qty`, and movements unchanged;
- a stocktake batch containing a missing location rolls back earlier rows and leaves no partial stocktake;
- an incompatible existing target kit rejects a transfer without committing the source deduction or a new movement;
- the existing multi-table mutation boundaries do not commit a partial state on these failure paths.

## 8. Concurrency evidence

`TestConcurrentDeduction.test_concurrent_direct_stockout_second_rejected` starts two real `TestClient` requests concurrently against the same item:

- starting stock: `20`;
- prepared quantity: `5`;
- each request attempts to stock out `8`;
- observed result: one `200`, one `400`;
- observed final stock: `12`;
- the second request is rejected because the projected final stock would violate the prepared-quantity invariant.

The route uses `BEGIN IMMEDIATE` before its correctness reads. This evidence protects the current no-oversell/invariant behavior; it does not prove that every writer has identical transaction-start semantics.

## 9. Findings

### Verified observations

1. Inventory state has multiple source-path locations containing inventory-write SQL-like literals, as shown by the static scan; the representative runtime set now reaches each of the six static-discovered production writer modules.
2. Runtime writes can be attributed to concrete route modules for the representative item, kit, stockout, stocktake, transfer, and unit-consolidation paths; helper-emitted writes retain the route owner in the full stack.
3. Transaction ownership is currently route-local and transaction-start policy is mixed: some paths explicitly use `BEGIN IMMEDIATE`, while representative create/prepare paths rely on SQLite's deferred transaction start at the first write.
4. The exercised atomicity and concurrency regressions pass; no reproducible correctness failure or verified contract violation was found across the characterized production writer modules and the exercised regressions.

### Not established by this phase

- A centralized mutation service is not proven necessary.
- A transaction-boundary refactor is not proven safe.
- The existence of many writers or a large route module is not, by itself, a GO condition.
- Work Progress is not included as an inventory writer because this trace does not show writes to `item_stocks`, `items.prepared_qty`, or `movements` from that domain.

## 10. Recommendation and decision gate

**Recommendation: NO-GO for the full mutation-boundary refactor at this time.**

Reason: the phase produced concrete writer and transaction evidence, but the focused atomicity and concurrency regressions pass and no reproducible correctness failure or verified contract violation was found. The mixed explicit/deferred transaction-start policy should remain documented and protected rather than being silently normalized by a refactor.

The human DEC-2B decision remains required. On NO-GO:

- preserve the current route-owned transaction boundary;
- do not centralize writers in this phase;
- defer only the full mutation-boundary refactor;
- keep the underlying writer-distribution finding open for future evidence.

If a later phase identifies a concrete defect, it must first add a fresh RED regression, apply the minimum GREEN fix, and re-run the scanner and characterization evidence before any refactor decision.

## 11. Verification status

| Gate | Status |
|---|---|
| Static scanner reused | PASS |
| Runtime SQL trace and caller attribution | PASS |
| Six-module representative writer coverage | PASS |
| Transfer rollback regression | PASS |
| Transaction ownership documented | PASS |
| Atomicity regressions | PASS |
| `BEGIN IMMEDIATE` concurrency regression | PASS |
| Full pytest suite | PASS: 1726 passed, 930 warnings |
| Production behavior changed | NO |
| Full refactor GO decision | NOT AUTHORIZED; human DEC-2B required |
