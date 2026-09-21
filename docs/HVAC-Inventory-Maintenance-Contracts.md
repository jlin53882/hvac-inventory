# HVAC Inventory Maintenance Contracts

本文件記錄 HVAC Inventory 系統目前需要長期維護的 domain、authorization、frontend lifecycle、runtime 與 verification contracts。

本文件是 production maintenance contract，不是變更紀錄、hardening checklist、audit log 或 test execution report。

> **Source of truth**：若本文件與目前已驗證的 production behavior 或 executable tests 發生衝突，必須先重新驗證實際 contract，再決定是否更新文件或修改程式。不得只依 stale documentation 改變 production behavior。

## 1. 文件更新規則

只有下列事項改變時才更新本文件：

- maintenance contract
- ownership boundary
- protected intent
- required verification
- canonical data、authorization 或 lifecycle behavior

下列事件本身不構成更新理由：

- test count 改變
- execution result 改變
- version-control identifier 改變
- merge state 改變
- implementation refactor，但 contract 未改變
- formatting-only code change

文件內容應描述「現在如何安全維護系統」，不應記錄某次執行結果、歷史 finding 或短期工作進度。

## 2. Contract Ownership Map

| Area | Canonical owner | Consumers | Protection |
|---|---|---|---|
| Inventory semantics | backend/domain/API；庫存數量由 `items` 與 `item_stocks` 定義 | inventory UI、stats、export、stockout、stocktake、kits | `docs/庫存操作維護文件.md`、inventory/API regression |
| Page membership | `app/models.py` 的 `PAGE_KEYS` 與 role default sets | visibility storage、auth API、navigation、permissions UI | RBAC/page-visibility tests |
| Page visibility | persisted `user_page_visibility` 與 backend visibility service/API | frontend `isPageVisible()`、sidebar、deep-link fallback | visibility API、seed/reset、runtime tests |
| Capability | backend permission guards 與 route-level scope/owner checks | frontend UX guards、API callers | positive/negative API and security tests |
| Frontend lifecycle | `static/js/globals.js`、`static/js/api.js`、`static/js/app.js` | page renderers and refresh paths | lifecycle runtime test |
| Calendar | `app/routes/appointments.py`、calendar services、`static/js/render/calendar.js`、`static/js/modals/calendar.js` | Calendar UI、Work Progress snapshots、Google sync queue | API tests、Calendar runtime test、snapshot/atomicity tests |
| Work Progress | `app/routes/work_progress.py`、`app/services/work_progress.py`、scoped file storage | Work Progress UI、appointment snapshot sync | owner/RBAC, media atomicity, snapshot regression |
| File assets | `app/services/file_storage.py` and `file_assets` records | photos, Work Progress, signed reports, quotations | path/scope/rollback/media tests |

Ownership is a current responsibility map. It is not permission to create a second registry or central helper merely because several consumers exist.

## 3. Inventory Domain Contracts

### 3.1 Data ownership

- `items` is the item master record.
- `item_stocks` stores quantity by item and location; location quantity is aggregated for item-level views.
- `total_qty` is a compatibility/output aggregate, not a replacement for location stock rows.
- `kits` defines assembled kits; its `item_id` points to an item with `is_kit=1`.
- Soft-deleted items remain available to the audit/history rules and must not be treated as ordinary active items.
- Multi-location operations must preserve stock identity and site boundaries; a stock row is identified by `item_stocks.id`, not only by its location label.
- Persisted quantities use the repository quantity contract: supported values are normalized to three decimal places at write boundaries.

### 3.2 Prepared quantity invariant

`items.prepared_qty` means quantity already taken from the shelf and placed into the pending issue workflow, but not yet deducted from formal inventory.

The invariant is:

```text
total_qty >= prepared_qty >= 0
```

Every operation that reduces stock, prepares quantity, returns prepared quantity, assembles/disassembles kits, transfers stock, or finalizes a stocktake must preserve this invariant within its transaction. The canonical backend check is `app/services/inventory_stock.py::assert_projected_inventory()`.

Do not infer prepared quantity semantics from the field name alone, and do not change it into an already-deducted quantity without updating every writer, reader, export, and boundary regression together.

### 3.3 Inventory status classification

After the repository's three-decimal normalization:

| Status | Contract |
|---|---|
| Zero stock | Non-kit item with `qty <= 0` |
| Low stock | Non-kit item with `qty > 0`, `low_stock > 0`, and `qty <= low_stock` |
| Normal | Neither zero-stock nor low-stock condition |
| Kit status | Determined by BOM shortage/insufficient semantics, not ordinary material KPI classification |

Zero-stock and low-stock are mutually exclusive. Kits (`is_kit=1`) are excluded from ordinary material zero/low KPIs and lists; kit availability is evaluated through BOM and shortage/insufficient logic.

Server and frontend status consumers must use the same normalization boundary. Do not derive paginated KPI values from the current page length when the API provides complete filtered aggregate stats.

### 3.4 Mutation boundaries

- Quantity adjustments are delta operations and must retain reason, transaction, quantity normalization, and prepared invariant checks.
- Stock identity, optimistic-lock fields, and location-rename two-phase handling are part of the write contract.
- BOM rows must be aggregated by item before kit shortage calculation and deduction; duplicate item IDs in kit input are invalid.
- Soft-delete, multi-location, decimal normalization, prepared quantity, movement records, and exports are one connected contract surface. A change to one must inspect all relevant writers and consumers.

### 3.5 Inventory writer and transaction ownership

Inventory mutation ownership is distributed across these current route-level writers:

| Mutation area | Current owner | Transaction characteristic | Protected state and side effects |
|---|---|---|---|
| Item create / quantity adjustment | `app/routes/items.py` | Create uses the connection's deferred SQLite write transaction; adjustment uses explicit `BEGIN IMMEDIATE`. | `item_stocks`; adjustment also writes `movements`. |
| Kit inventory mutation | `app/routes/kits.py` | Assembly and disassembly use explicit `BEGIN IMMEDIATE`; helper-emitted stock writes remain inside the route-owned transaction. | Material and kit `item_stocks`; assembly/disassembly `movements`. |
| Prepared quantity / direct stockout | `app/routes/stockout.py` | Preparation begins on its first guarded write; direct stockout uses explicit `BEGIN IMMEDIATE`. | `items.prepared_qty`, `item_stocks`, and `movements`, according to the operation. |
| Stocktake | `app/routes/stocktake.py` | Explicit `BEGIN IMMEDIATE`; batch writes commit or roll back together. | Location `item_stocks` and adjustment `movements`. |
| Cross-site transfer | `app/routes/transfers.py` | Explicit `BEGIN IMMEDIATE`; source deduction, target creation/update, and both movements share the route transaction. | Source/target `item_stocks` and source/target `movements`. |
| Unit inventory conversion | `app/routes/units.py` | `consolidate_item` uses explicit `BEGIN IMMEDIATE` when changing the item unit; `new_qty` additionally changes stock and writes a conversion movement. | `items.unit`; with quantity conversion, `item_stocks` and `movements`. |

These are route-owned transaction boundaries. Lower-level helpers that receive a connection must preserve the caller's boundary and must not commit independently. Transaction style is contract-specific; do not normalize every writer to `BEGIN IMMEDIATE` merely for stylistic consistency.

### 3.6 Inventory mutation verification and refactor gate

The protected inventory states are `item_stocks`, `items.prepared_qty`, and `movements`. Any affected mutation path must preserve the prepared quantity invariant, location/site identity, movement side effects, and all-or-nothing persistence when its operation fails. The evidence must match the side effects: database state and rollback checks for multi-table writes, plus concurrency checks where correctness reads determine whether stock may be reduced. Direct stockout currently protects those reads with `BEGIN IMMEDIATE`; this does not require every writer to use the same transaction-start syntax.

Before centralizing inventory mutations or introducing a generic inventory mutation service:

1. identify a concrete, verified defect or maintenance risk;
2. provide a RED regression that reproduces it;
3. identify every affected writer module and consumer;
4. preserve prepared quantity, movement, location, kit, and transfer contracts;
5. verify transaction, failure, and rollback boundaries; and
6. re-run representative runtime writer attribution after the change.

Multiple writers, duplicate SQL, large route files, or a preference for a cleaner abstraction are not sufficient reasons by themselves. A representative runtime test set documents current ownership; it is not exhaustive proof that every endpoint is correct or atomic.

The static architecture-fitness tool is `scripts/scan_inventory_writers.py`. It scans SQL-like literals for the three protected states and can compare writer topology before and after a change. It does not prove executable reachability, transaction correctness, atomicity, rollback correctness, or concurrency correctness. Dynamic/helper-generated SQL may be missed, and comments, docstrings, templates, or other static SQL-like text may be counted. Runtime attribution remains owned by `tests/test_inventory_writer_transactions.py`.

When inventory writer topology changes, the minimum verification is:

1. run the static scanner and inspect added/removed writer candidates;
2. trace a representative real API path;
3. verify the transaction boundary and movement side effects;
4. run relevant rollback, atomicity, and concurrency regressions; and
5. update this contract only when ownership or the protected contract changes.

### 3.7 Database initialization and migration safety

`app/database.py::init_db()` owns SQLite schema creation, additive migrations, and required seed/backfill writes performed during application startup. The initialization boundary is one explicit `BEGIN IMMEDIATE` transaction and one final commit after every schema, migration, seed, and backfill statement succeeds.

The initialization contract is:

- a failure during fresh initialization or an upgrade rolls back the complete initialization attempt; no partially committed schema, migration marker, seed set, or backfill is an acceptable terminal state;
- the next startup may retry initialization against the same database file and must be able to complete without manual cleanup;
- repeated successful initialization is idempotent and must preserve existing records, explicit user/role overrides, migration markers, and other protected state;
- migration statements must be additive or explicitly data-preserving, guarded for already-upgraded databases, and executed through the owning transaction rather than an implicit-commit script boundary;
- migration code must not silently discard legacy rows or replace explicit overrides with defaults; and
- a migration change must be rehearsed against a fresh database, a current database, and a representative legacy or partially initialized copy.

The failure boundary is part of the contract, not merely an implementation detail. A test that observes only the final happy-path schema cannot establish rollback or retry safety.

## 4. Page Membership, Visibility, Capability, and Scope

These are separate concepts and must remain separate in code, tests, and documentation.

### 4.1 Page membership

`app/models.py::PAGE_KEYS` is the backend canonical page membership list. It is consumed by:

- role default visibility sets;
- user creation and missing-row backfill;
- visibility API validation;
- frontend page-key adapters and navigation metadata;
- permissions management UI.

Adding or removing a page requires checking all consumers. Do not create a second canonical page list without evidence of verified drift and a migration/compatibility plan.

### 4.2 Page visibility

Persisted page visibility determines whether a page is shown or can be entered. It does not grant an API capability.

Current frontend access is the intersection of visibility and capability:

```text
canAccessPage(page, mode) = isPageVisible(page) AND hasPageCapability(page, mode)
```

Page visibility overrides and role defaults are different states. Explicit user/role overrides must survive ordinary reload, reseeding, and role flows unless the explicit reset contract is invoked. `INSERT OR IGNORE` backfill behavior must preserve existing custom rows.

### 4.3 Capability and ownership/scope

Backend authorization is the security authority. Frontend authorization is a UX guard.

Backend enforcement may include:

- `require_perm()`;
- `require_db_perm()`;
- route-level owner/global checks;
- site, record, and resource-scope checks;
- explicit deny/grant state.

Frontend `canAccessPage()`, render guards, hidden actions, and submit guards must never be used as proof that an API operation is secure. Negative authorization tests should assert capability denial, explicit deny, ownership, and scope—not only a role-name label.

The permission taxonomy contract is:

- `permissions.key` is the canonical capability key; `module` is grouping metadata and must not become an authorization authority.
- `role_permissions` supplies role defaults; an explicit `user_permissions.value` of either `0` or `1` overrides the role default for that user, except for documented safety locks such as the last active administrator.
- Owner scope and global scope are separate decisions. An `*-all` key may widen record scope only when the backend also confirms the action capability.
- Page membership and persisted page visibility are separate from capability keys. A visible page does not grant an API capability, and a capability does not force a page visible.
- Permission migration or rename must preserve role mappings and explicit overrides through an idempotent, rollback-safe marker migration; delete-and-reinsert is not an acceptable rename strategy.

Static permission-consumer scans are architecture-fitness evidence only. They must be supplemented by API/runtime tests for resolver precedence, owner/global boundaries, and sensitive mutations.

## 5. Authorization Boundaries

- Page visibility cannot re-enable a page whose backend capability is absent.
- A capability cannot be inferred solely from page visibility.
- Backend route guards remain authoritative even when the frontend hides a button.
- Owner and non-owner paths must be tested separately where permissions distinguish them.
- Global capabilities must be tested against non-owner records.
- Explicit user overrides must be tested for immediate effect and persistence.
- Permission dependency normalization must prevent invalid states such as a disabled Work Progress view permission with enabled dependent mutation permissions.
- New write routes must be included in the permission matrix and must return a controlled authorization response rather than relying on frontend behavior.

## 6. Frontend Lifecycle Contracts

`ITEMLESS_TABS` and `DATA_REFRESH_PRESERVE_MOUNT_TABS` are different semantic sets and must not be merged because their names or members overlap.

| Set | Meaning |
|---|---|
| `ITEMLESS_TABS` | The page does not need inventory `ALL_ITEMS` loading during the normal data refresh path. |
| `DATA_REFRESH_PRESERVE_MOUNT_TABS` | A background data refresh must not remount the stateful page. |

Current classification in `static/js/globals.js`:

| Page | Itemless | Preserve mount |
|---|---:|---:|
| Calendar | Yes | No |
| Work Progress | Yes | Yes |
| Signed Reports | Yes | Yes |
| Quotation | Yes | Yes |
| Petty Cash | Yes | Yes |

`static/js/api.js` owns refresh orchestration and the distinction between skipping inventory data and remounting a page. `static/js/app.js::mountPreservedTabAfterBootstrap()` owns the bootstrap-time initial mount for preserved stateful tabs.

Required behavior:

- itemless pages skip unnecessary inventory `ALL_ITEMS` loading;
- the Calendar page still mounts through `renderCalendar()`;
- preserved stateful pages mount once after bootstrap;
- later background refresh does not duplicate their mount or destroy stateful UI state;
- changing one set must not silently change the meaning of the other set.

For any async renderer or loader that writes shared DOM or shared state after an `await`, validate freshness before each write boundary. Use a request generation for out-of-order responses, the active tab and site snapshot when applicable, and a mount generation when a tab can be remounted without changing its tab key.

## 7. Calendar Contracts

### 7.1 Page and data entry

The page entry point is `renderCalendar()` in `static/js/render/calendar.js`. It builds the Calendar shell, mounts search dependencies, sets loading state, invokes `calLoadData()`, and then reaches either the ready render path or the error path.

`calLoadData()` loads the current Calendar data through:

- `GET /api/appointments?year=...&month=...`;
- `GET /api/service-types`;
- `GET /api/assignable-users`;
- the current-day appointment request when the selected month is not the current month.

The production load path must retain request-token protection so superseded requests do not overwrite current state.

### 7.2 Appointment operations

| Concern | Canonical behavior |
|---|---|
| Open modal | `calOpenAppt()` reads the selected appointment and current service/assignee data into the modal. |
| Create | `calSubmitAppt()` sends `POST /api/appointments`; an empty `user_ids` list is valid. |
| Edit | `calSubmitAppt()` sends `PUT /api/appointments/{id}` and includes the `updated_at` snapshot when available. |
| Delete | `calDeleteAppt()` confirms, sends `DELETE /api/appointments/{id}`, then reloads Calendar data. |
| Assignment validation | New assignees must exist and be active; update may retain an already assigned inactive user but may not add a new inactive user. |
| Assignment replacement | Appointment update replaces the assignee rows atomically. The current frontend preserves existing IDs when editing and sends an empty list for a new appointment. |
| Conflict check | A user conflict is checked only when both start and end times are present; overlapping assignments return a conflict response. |
| Service type | `service_type_id` is optional but, when present, must refer to an existing service type. |

### 7.3 Time and optimistic locking

Time is optional. The API accepts both time fields empty, or both in `HH:MM` format with a valid range and ordering. A single populated time field is invalid.

The current Calendar form sends both fields empty when either hour or minute is unspecified. When a time is specified, the form sends `end_time = start_time`; the API stores and validates the resulting pair.

`updated_at` is the optimistic-lock payload contract for edits. A stale snapshot must produce a controlled conflict response and must not overwrite a newer appointment.

### 7.4 Work Progress snapshot boundary

Appointments are the source for Calendar-owned fields in an existing Work Progress report. Appointment update and snapshot synchronization occur in the same transaction. The synchronization may update:

- report date;
- client and address snapshots;
- service name snapshot;
- start and end time snapshots;
- appointment note snapshot.

It must not overwrite Work Progress-owned fields such as progress note, uploader identity/name, timestamps, or photo assets. Deleting an appointment freezes the existing report through the foreign-key nulling behavior; it does not erase the report snapshot or photos.

### 7.5 Google sync boundary

Local appointment writes complete their transaction first, then enqueue synchronization work. Personal sync and team sync are separate views of synchronization state. Sync error details must expose retry-relevant information without exposing credentials or unsafe secret paths.

Retryability belongs to the sync status/queue contract. A retry action must reset only the intended scope (personal, team member, or permitted global scope) and then reload the Calendar state. UI wording can change without changing this boundary.

## 8. Work Progress Contracts

Work Progress is a separate domain from inventory mutation. The Work Progress route and service must not be treated as writers of:

- `item_stocks`;
- `items.prepared_qty`;
- `movements`;

unless current SQL/runtime evidence proves a new behavior and the inventory boundary is deliberately redesigned.

Current Work Progress contracts include:

- page access requires both page visibility and `work-progress-view` capability;
- owner and non-owner edit/delete behavior is determined by backend flags;
- global edit/delete capabilities apply to non-owner records only when explicitly granted;
- explicit deny/grant overrides take precedence over role assumptions;
- frontend flags such as `can_edit` and `can_delete` are consumed from backend responses and are not recomputed as a security decision;
- Calendar-owned snapshot fields are read-only in the Work Progress edit flow;
- Work Progress-owned fields include uploader identity/name, progress note, and photos;
- photo append, replacement, deletion, and batch failure must preserve DB/file atomicity;
- media access is scoped by category, owner type, and owner ID;
- appointment deletion preserves report attribution, snapshot, and photos.

The Work Progress stylesheet and JavaScript use scoped namespaces. New global selectors or a second media ownership path require explicit evidence and regression coverage.

## 9. Protected Intent

The following are deliberate contracts, not accidental duplication:

1. Do not merge `ITEMLESS_TABS` and `DATA_REFRESH_PRESERVE_MOUNT_TABS` solely because they contain overlapping page names.
2. Do not treat frontend visibility as backend authorization.
3. Do not centralize duplicated semantic logic solely because duplication exists. A new abstraction must remove a verified drift, reproducible bug, ownership ambiguity causing defects, transaction inconsistency, security mismatch, or concrete maintenance risk.
4. Do not include Work Progress in inventory mutation boundaries without evidence from current SQL/runtime behavior.
5. Do not change prepared, low-stock, zero-stock, kit, or quantity-normalization semantics without corresponding boundary regressions across the affected consumers.
6. Do not replace explicit user/role overrides with reseeded defaults or inferred role behavior.
7. Do not replace item/location stock identity with a display label or silently collapse multi-location rows.
8. Do not remove Calendar snapshot fields, sync queue state, or photo assets merely because the source record was edited or deleted; ownership and freeze behavior are intentional.

## 10. Evidence and Verification Model

Evidence levels are distinct:

| Level | Proves | Does not prove |
|---|---|---|
| STATIC | Source structure, registration, escaping, dependency, or ownership marker | Runtime ordering or browser behavior |
| NODE/VM RUNTIME | Production JavaScript executes through a controlled runtime harness | Real browser layout, CSS, or browser-only behavior |
| API | Backend request/response, authorization, validation, and transaction boundary | Frontend orchestration or DOM state |
| DATABASE | Persisted rows, relationships, rollback, and invariants | Browser rendering or external provider behavior |
| CONCURRENCY | Locking, conflict detection, single-flight, and race outcomes | All ordinary single-request behavior |
| MIGRATION REHEARSAL | Upgrade/backfill behavior on a copied database | Production deployment success |
| BROWSER SMOKE | Real browser DOM, layout, event, navigation, and browser-specific behavior | Backend transaction correctness unless the test reaches it |

The following distinctions are mandatory:

- STATIC is not RUNTIME.
- NODE/VM RUNTIME is not BROWSER SMOKE.
- API evidence is not frontend runtime evidence.
- `collect-only` is not test execution.
- A source function-name assertion is not proof that the function is reached through the production entry path.
- A passing happy path is not proof of conflict, retry, rollback, or concurrency behavior.

Use the narrowest evidence level that proves the requested contract, and label untested levels explicitly instead of calling them all covered.

## 11. Change Risk Matrix

| Change type | Minimum evidence |
|---|---|
| Documentation only | Current source and executable-test content review |
| CSS | Relevant UI regression and visual inspection |
| Frontend handler | NODE/VM production runtime; browser smoke when browser-specific |
| Page lifecycle | Bootstrap and refresh runtime contract |
| Authorization | Positive and negative API matrix, including ownership/scope where applicable |
| Inventory semantics | Domain boundary tests plus API/cross-consumer regression |
| Inventory mutation | Database state, rollback, side effects, and relevant concurrency evidence |
| Transaction | Failure injection and concurrency evidence |
| Migration | Copied-database rehearsal and post-migration contract checks |
| Calendar flow | Calendar NODE/VM runtime plus relevant appointment API/snapshot tests |
| Browser-specific behavior | Browser smoke |
| External sync | Local transaction/queue evidence plus provider integration evidence when the provider path changes |

Do not impose every evidence level on every change. Select the minimum level that addresses the actual risk, then add stronger evidence when the change crosses a boundary.

## 12. Refactor and Abstraction Rule

Before introducing a new abstraction, registry, helper, central writer, lifecycle layer, or canonical semantic adapter:

1. Identify the verified risk it removes.
2. Show the current source path and affected consumers.
3. Show a reproducible drift, bug, ownership ambiguity, transaction inconsistency, security mismatch, or concrete maintenance failure.
4. Define the regression that would fail if the old problem returned.
5. Preserve existing data, permission, lifecycle, and transaction contracts unless the behavior change is explicitly intended and fully covered.

“Duplicate code”, “looks cleaner”, or “more centralized” alone is not sufficient production-refactor evidence.

## 13. Contract-to-Test Map

The map names executable owners, not historical run results:

| Contract | Regression evidence |
|---|---|
| Frontend itemless/preserve-mount lifecycle | `tests/tab_lifecycle_runtime.test.js`, `tests/test_frontend_assets.py` |
| Calendar page entry, data load, modal, create/edit/delete, sync error | `tests/calendar_runtime.test.js`, `tests/test_appointments.py` |
| Work Progress page visibility | `tests/work_progress_page_visibility_runtime.test.js`, `tests/test_rbac_perms.py`, `tests/test_work_progress.py` |
| Work Progress owner/global authorization and snapshot behavior | `tests/test_work_progress.py`, `tests/test_rbac_perms.py` |
| Stockout/prepared quantity | `tests/test_prepared_api.py`, `tests/test_quantity.py`, `tests/test_inventory_integrity.py` |
| Inventory writer ownership and transaction boundaries | `tests/test_inventory_writer_transactions.py` |
| Static inventory writer topology | `scripts/scan_inventory_writers.py`, `tests/test_inventory_writer_scanner.py` |
| Inventory mutation rollback and transfer side effects | `tests/test_inventory_integrity.py`, `tests/test_vehicle_inventory.py` |
| Inventory invariants and multi-location identity | `tests/test_inventory_integrity.py`, `tests/test_vehicle_inventory.py`, `tests/test_main.py` |
| Database initialization rollback, retry, and idempotent seeds | `tests/test_database_migrations.py`, `tests/test_rbac.py`, `tests/test_rbac_perms.py` |
| Quantity parsing and three-decimal write boundary | `tests/test_quantity.py`, `tests/qty.test.js` |
| Kit shortage and KPI exclusion | `tests/test_main.py`, `tests/test_media_storage.py`, `tests/test_inventory_integrity.py` |
| Page membership and visibility defaults/overrides | `tests/test_rbac.py`, `tests/test_rbac_perms.py`, `tests/test_frontend_assets.py` |
| Backend authorization and negative capability matrix | `tests/test_rbac_perms.py`, `tests/test_viewer.py`, `tests/test_security_regression.py` |
| Calendar snapshot atomicity | `tests/test_appointments.py`, `tests/test_work_progress.py` |
| Google sync queue/status/retry boundary | `tests/test_gcal_sync.py`, `tests/test_gcal_keys.py`, `tests/test_appointments.py` |
| File/photo scope and rollback | `tests/test_media_storage.py`, `tests/test_work_progress.py`, `tests/test_file_asset_scripts.py` |
| Export, prepared/soft-delete/multi-location/decimal contracts | `tests/test_export.py`, `tests/test_security_regression.py` |

When a test is renamed, split, or removed, update this map only if the protected contract or its executable owner changes. Do not add a test result, count, duration, or run identifier to this document.

## 14. Maintenance Checklist by Boundary

### Inventory or quantity change

- Verify prepared invariant and three-decimal normalization.
- Verify zero/low mutual exclusion and kit KPI exclusion.
- Verify multi-location identity, site scope, movements, rollback, and export consumers.
- Run the relevant domain/API/database/concurrency evidence.

### Database initialization or migration change

- Verify the fresh-database schema, current-database no-op path, and representative legacy/partially initialized copy.
- Keep schema changes, migration markers, seed rows, and user backfills inside the single initialization transaction.
- Inject a failure after an earlier schema/seed step and assert complete rollback.
- Retry initialization after failure and assert the expected schema, seed set, preserved rows, and explicit overrides.
- Run the migration-specific regression batch before the broader affected test groups.

### Page or permission change

- Check `PAGE_KEYS`, role defaults, persistence, backfill/reset behavior, frontend adapters, navigation, and deep links.
- Check both page visibility and backend capability.
- Test explicit deny/grant, owner/non-owner, global capability, and unauthenticated paths.

### Frontend lifecycle change

- Identify whether the change concerns item loading, page mounting, or both.
- Preserve the distinction between the two lifecycle sets.
- Exercise bootstrap and background refresh paths; assert mount count and state preservation.

### Calendar change

- Trace `renderCalendar()` → `calLoadData()` → API requests → ready/error state.
- Preserve `updated_at`, optional time behavior, assignment validation, conflict checks, and atomic snapshot synchronization.
- Check personal/team sync status, retry scope, and secret-path redaction when sync behavior changes.

### Work Progress or media change

- Preserve owner/global permission semantics and backend response flags.
- Preserve Calendar-owned versus Work Progress-owned fields.
- Verify file rows, generated paths, scope checks, rollback, and appointment deletion freeze behavior.

## 15. Source Locations

The primary implementation owners for the contracts in this document are:

- `app/models.py`
- `app/database.py`
- `app/routes/appointments.py`
- `app/routes/work_progress.py`
- `app/services/inventory_stock.py`
- `app/routes/items.py`
- `app/routes/kits.py`
- `app/routes/stockout.py`
- `app/routes/stocktake.py`
- `app/routes/transfers.py`
- `app/routes/units.py`
- `app/services/work_progress.py`
- `app/services/file_storage.py`
- `static/js/globals.js`
- `static/js/api.js`
- `static/js/app.js`
- `static/js/auth.js`
- `static/js/render/calendar.js`
- `static/js/modals/calendar.js`
- `docs/庫存操作維護文件.md`
- `docs/行事曆維護文件.md`
- `docs/工作進度回報維護文件.md`

These paths are current ownership references, not a history of how the contracts were introduced.
