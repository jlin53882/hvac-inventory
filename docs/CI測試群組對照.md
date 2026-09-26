# CI 測試群組對照

> 本文件是 Phase 1 的 machine-readable-friendly 對照表：每個 `tests/test_*.py` 都必須有 local group；Phase 1 CI domain gate 若未涵蓋，明確標示為 `full-only`，不把 domain gate 誤當完整 regression。

## 分類規則

- `Full Regression` 永遠執行 `tests/` 全量測試。
- `CI domain` 是 Phase 1 可獨立觀察的 failure signal，不取代 full regression。
- 同一測試可同時屬於 local group 與 CI domain。
- `full-only` 代表目前沒有獨立 Phase 1 CI job，仍由 Full Regression 保護；不是被跳過。

## 對照表

| Test file | Local group | Phase 1 CI signal | 說明 |
|---|---|---|---|
| `test_app_logging.py` | `core` | `full-only` | logging contract，目前不另拆 job |
| `test_appointments.py` | `regression` | `full-only` | calendar / sync regression |
| `test_backup_db.py` | `core` | `full-only` | 每日資料庫備份腳本 / monitor 整合 |
| `test_config.py` | `core` | `full-only` | config contract |
| `test_database_migrations.py` | `database`, `inventory` | `CI / Inventory + Database` | migration / seed rollback |
| `test_deadvar_verify.py` | `regression` | `full-only` | dead variable regression |
| `test_engineering_petty_cash.py` | `petty_cash`, `reports` | `CI / Reports` | engineering petty cash / Excel |
| `test_export.py` | `reports` | `CI / Reports` | inventory Excel export |
| `test_file_asset_scripts.py` | `storage` | `full-only` | file asset maintenance scripts |
| `test_frontend_assets.py` | `frontend` | `CI / Frontend + Security` | frontend structure / JS contracts |
| `test_gcal_keys.py` | `regression` | `full-only` | Google Calendar key lifecycle |
| `test_gcal_process_lock.py` | `regression` | `full-only` | GCal 跨 process 鎖：依 DB 區分、非阻塞等待、逾時 503 |
| `test_gcal_sync.py` | `regression` | `full-only` | Google Calendar sync engine |
| `test_inventory_integrity.py` | `inventory` | `CI / Inventory + Database` | inventory invariants |
| `test_inventory_writer_scanner.py` | `inventory` | `CI / Inventory + Database` | writer topology scanner |
| `test_inventory_writer_transactions.py` | `inventory` | `CI / Inventory + Database` | transaction / rollback evidence |
| `test_main.py` | `core` | `full-only` | broad API regression，保留在 full suite |
| `test_media_storage.py` | `storage` | `full-only` | media storage and isolation |
| `test_notifications.py` | `core` | `full-only` | notification contract |
| `test_petty_cash.py` | `petty_cash`, `reports` | `CI / Reports` | general petty cash |
| `test_petty_cash_excel_rendering.py` | `petty_cash`, `reports` | `CI / Reports` | Excel rendering regression |
| `test_petty_cash_frontend_races.py` | `petty_cash`, `reports` | `CI / Reports` | frontend async race harness wrapper |
| `test_permission_taxonomy.py` | `rbac` | `CI / RBAC` | permission taxonomy |
| `test_performance_regressions.py` | `inventory` | `CI / Inventory + Database` | 2026-09 效能/穩定性：索引、統計批次、照片快取、上傳鎖、時區 |
| `test_performance_frontend.py` | `frontend` | `CI / Frontend + Security` | frontend performance contracts |
| `test_prepared_api.py` | `inventory` | `CI / Inventory + Database` | prepared quantity API |
| `test_quantity.py` | `inventory` | `CI / Inventory + Database` | canonical quantity contracts |
| `test_quotation_uploads.py` | `storage` | `full-only` | quotation file upload |
| `test_quotations.py` | `storage` | `full-only` | quotation API |
| `test_rbac.py` | `rbac` | `CI / RBAC` | seed / role matrix |
| `test_rbac_perms.py` | `rbac` | `CI / RBAC` | endpoint permission matrix |
| `test_safety_helpers.py` | `core` | `full-only` | shared safety helpers |
| `test_security_regression.py` | `frontend` | `CI / Frontend + Security` | XSS / formula / security contracts |
| `test_server_lifecycle.py` | `core` | `full-only` | guarded launcher / lifecycle |
| `test_signed_reports.py` | `storage` | `full-only` | signed report file lifecycle |
| `test_structure.py` | `frontend` | `CI / Frontend + Security` | source structure regression |
| `test_units.py` | `inventory` | `CI / Inventory + Database` | unit dictionary / consolidation |
| `test_users.py` | `auth` | `full-only` | account / login / rate limit |
| `test_v101.py` | `regression` | `full-only` | v1.0.1 regression |
| `test_vehicle_inventory.py` | `inventory` | `CI / Inventory + Database` | site isolation / transfers |
| `test_viewer.py` | `auth` | `full-only` | viewer read-only behavior |
| `test_work_progress.py` | `work_progress` | `full-only` | work progress API / media / RBAC |
| `test_work_progress_ui_regressions.py` | `frontend`, `work_progress` | `CI / Frontend + Security` | frontend lifecycle regression |

## Auxiliary JavaScript harnesses

以下不是 `test_*.py`，但由 Python tests 或 dedicated checks 使用，不能從 inventory 中刪除：

- `tests/petty_cash_frontend_races.js`：由 `test_petty_cash_frontend_races.py` 執行
- `tests/qty.test.js`：由 `test_quantity.py` 的 quantity contract 執行
- `tests/tab_lifecycle_runtime.test.js`
- `tests/tab_async_lifecycle.test.js`
- `tests/work_progress_detail_target_lifecycle.test.js`
- `tests/work_progress_upload_progress.test.js`：由 `test_work_progress_ui_regressions.py` 執行（上傳進度條）

## Phase 2 boundary

Phase 1 允許 domain gate 與 full regression 重複執行。只有在所有 `full-only` 測試完成分類、且可機器驗證 domain union 覆蓋完整 `tests/` 後，才可評估把 PR full regression 移到 master-only。