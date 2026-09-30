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
| `test_css_architecture.py` | `frontend` | `CI / Frontend + Security` | CSS 分層目錄 / 每檔包在所屬 @layer / HTML 無內嵌 <style> / 頁面範圍 / 無 !important / 斷點白名單 / is-* 狀態 / 按鈕外觀只在 button.css・chip.css / 每個 <button> 套標準 class / 色碼・字級・字重・圓角・z-index 只能用 token / JS 不得寫死色碼、inline style 只能放執行期狀態 |
| `test_database_migrations.py` | `database`, `inventory` | `CI / Inventory + Database` | migration / seed rollback |
| `test_deadvar_verify.py` | `regression` | `full-only` | dead variable regression |
| `test_engineering_petty_cash.py` | `petty_cash`, `reports` | `CI / Reports` | engineering petty cash / Excel |
| `test_export.py` | `reports` | `CI / Reports` | inventory Excel export |
| `test_file_asset_scripts.py` | `storage` | `full-only` | file asset maintenance scripts |
| `test_frontend_assets.py` | `frontend` | `CI / Frontend + Security` | frontend structure / JS contracts |
| `test_gcal_keys.py` | `regression` | `full-only` | Google Calendar key lifecycle |
| `test_gcal_process_lock.py` | `regression` | `full-only` | GCal 跨 process 鎖：canonical DB namespace、subprocess 互斥/獨立、非阻塞等待、逾時 503、Windows >10 秒實機 |
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
| `test_frontend_module_boundaries.py` | `frontend` | `CI / Frontend + Security` | ES module 依賴方向：各層不 import 上層、只有 pages import shell 組裝層、整個 import 圖沒有循環 |
| `test_frontend_state_ownership.py` | `frontend` | `CI / Frontend + Security` | `appState`（只剩 currentTab / currentSite）與 read-model（getter 讀、`ALLOWED_SETTERS` 管誰能寫）的所有權守衛（state ratchet） |
| `test_units.py` | `inventory` | `CI / Inventory + Database` | unit dictionary / consolidation |
| `test_users.py` | `auth` | `full-only` | account / login / rate limit |
| `test_v101.py` | `regression` | `full-only` | v1.0.1 regression |
| `test_vehicle_inventory.py` | `inventory` | `CI / Inventory + Database` | site isolation / transfers |
| `test_viewer.py` | `auth` | `full-only` | viewer read-only behavior |
| `test_work_progress.py` | `work_progress` | `full-only` | work progress API / media / RBAC |
| `test_work_progress_ui_regressions.py` | `frontend`, `work_progress` | `CI / Frontend + Security` | frontend lifecycle regression |
| `visual/test_css_isolation.py` | `visual` | `CI / Visual (browser)` | Playwright：CSS 跨頁外洩清單（`visual/known_css_leaks.json`）+ computed-style 版面契約；未安裝 visual 群組時自動略過（ubuntu runner） |
| `visual/test_button_contract.py` | `visual` | `CI / Visual (browser)` | 所有截圖情境中可見的 `.btn` / `.chip`，computed style 必須符合設計系統規格（變體顏色、框線、圓角、字級、字重、高度）；可見的一般 `<button>` 必須是 `.btn` / `.chip` 或已登記的專用控制項；探針自我檢查 |
| `visual/test_state_interactions.py` | `visual` | `CI / Visual (browser)` | 狀態 class 互動契約（只檢查可見 / 選取外觀，不依賴 class 名稱）：modal、選單、頁籤、chip、收合、toast、overlay、bottom sheet |
| `visual/test_source_modules.py` | `visual` | `CI / Visual (browser)` | `HVAC_FRONTEND_SOURCE=1` 另起伺服器，Chromium 直接執行原始 ES modules：四頁（主頁逐一切換 10 個頁籤）無 pageerror / console.error / 模組載入失敗，命名空間存在且畫面已掛載 |
| `visual/test_delegated_clicks.py` | `visual` | `CI / Visual (browser)` | data-action 事件委派的真實點擊契約：側欄頁籤 / 庫存區、modal 開關、頭像 / 通知、整組與已領出頁控制項、設定頁與權限頁（並確認頁面上沒有 inline handler） |

## Auxiliary JavaScript harnesses

以下不是 `test_*.py`，但由 Python tests 或 dedicated checks 使用，不能從 inventory 中刪除：

- `tests/petty_cash_frontend_races.js`：由 `test_petty_cash_frontend_races.py` 執行
- `tests/qty.test.js`：由 `test_quantity.py` 的 quantity contract 執行
- `tests/tab_lifecycle_runtime.test.js`
- `tests/action_delegate_runtime.test.js`、`tests/action_tables_runtime.test.js`、`tests/stockout_actions_runtime.test.js`：由 `test_frontend_assets.py` 的 data-action 守衛執行（事件委派機制、每個 `*_ACTIONS` 表逐一觸發）
- `tests/inventory_read_model_runtime.test.js`、`tests/shared_read_model_runtime.test.js`：由 `test_frontend_state_ownership.py` 執行（read-model 的 getter / setter）
- `tests/tab_async_lifecycle.test.js`
- `tests/work_progress_detail_target_lifecycle.test.js`
- `tests/work_progress_upload_progress.test.js`：由 `test_work_progress_ui_regressions.py` 執行（上傳進度條）
- `tests/visual/button_probe.js`：由 `visual/test_button_contract.py` 使用
- `tests/button_contract.json`：專用按鈕 class 清單，`test_css_architecture.py` 與 `visual/test_button_contract.py` 共用
- `tests/visual/leak_probe.js`、`harness.py`、`serve.py`：由 `visual/test_css_isolation.py` 使用；`snapshot.py` 是 CSS 重構用截圖比對 / 外洩清單更新 CLI

## Phase 2 boundary

Phase 1 允許 domain gate 與 full regression 重複執行。只有在所有 `full-only` 測試完成分類、且可機器驗證 domain union 覆蓋完整 `tests/` 後，才可評估把 PR full regression 移到 master-only。