# HVAC Inventory PR 2A Contract Characterization

> 狀態：PR 2A 第一階段（只做契約盤點與 runtime/static evidence；不改 production behavior）
>
> 本文件不是完成報告，也不代替 DEC-A001 或任何人工作出的行為決策。

## 1. Scope and stop condition

本階段對應 `HVAC-Inventory-Maintainability-Hardening-Plan.md` 的 **PR 2A — contracts, page definition, authorization, runtime**，盤點：

- A-001：庫存語意與邊界的現行定義。
- C-001：page key、page visibility、navigation、capability 的分散表示。
- D-001：高風險邊界的 WHY 文件與可執行保護。
- E-001：static/runtime evidence 的覆蓋矩陣。
- E-002：Calendar flow 的現有證據與未覆蓋缺口。

本輪沒有修改 production Python/JavaScript/CSS、API、database schema 或 migration；新增一個 test-only Calendar runtime harness 與其 pytest wiring，以及本 characterization 文件。任何 A-001 語意整併、Page Registry 新 abstraction 或 lifecycle abstraction 都必須先有 verified drift/bug 與對應 human decision。

## 2. Baseline evidence

| 項目 | 實測結果 |
|---|---|
| Workspace | `C:/Users/admin/workspace/hvac-inventory-PR2A` |
| Branch / base | freshly cloned `master` from GitHub |
| HEAD / merged base | `b4bee6257f773f79ac7278d31a33665abe61d101`（PR #20 merge commit） |
| Full collection | `1715 tests collected` |
| Full pytest | `1715 passed, 923 warnings, 0 failed` in `419.85s` |
| PR 2A focused pytest | `805 passed, 151 warnings, 0 failed` in `86.27s` |
| Runtime harnesses in this pass | 8 PASS：tab lifecycle、Calendar load/create/edit/delete/sync error、Work Progress page visibility、permissions pagination、signed report capability、quotation upload capability、quotation permission、petty cash capability |
| Worktree before this document | clean |

The focused pytest command was:

```text
uv run --isolated pytest -q tests/test_frontend_assets.py tests/test_rbac.py tests/test_rbac_perms.py tests/test_viewer.py tests/test_work_progress.py tests/test_security_regression.py
```

The runtime command executed these production-backed harnesses:

```text
node tests/tab_lifecycle_runtime.test.js
node tests/calendar_runtime.test.js
node tests/work_progress_page_visibility_runtime.test.js
node tests/permissions_pagination_runtime.test.js
node tests/signed_report_capability_runtime.test.js
node tests/quotation_upload_capability_runtime.test.js
node tests/quotation_permission_runtime.test.js
node tests/petty_cash_capability_runtime.test.js
```

這些結果只證明列出的 flows；沒有把未執行的 browser flow 宣稱為已覆蓋。

## 3. A-001 — current inventory semantics

### 3.1 Current definition matrix

| 語意 | 現行 canonical / consumer | 現行 contract | 狀態 |
|---|---|---|---|
| 品項主檔與位置庫存 | `app/models.py`、`item_stocks`、`app/routes/items.py` | `items` 是品項主檔；位置數量由 stocks 聚合，保留 `total_qty` 相容欄位 | 已有文件與測試保護 |
| 待領出 | `items.prepared_qty`、`app/routes/stockout.py`、prepared frontend | 待領出不先扣總庫存；必須維持 `total_qty >= prepared_qty >= 0` | 已有 `test_prepared_api.py` / `test_inventory_integrity.py` 等保護 |
| 缺貨 | `docs/庫存操作維護文件.md`、server stats、`getInventoryStatus()` consumers | 非整組、3 位小數正規化後 `qty <= 0` | 已有 boundary tests |
| 低庫存 | 同上 | 非整組、正規化後 `qty > 0`、`low_stock > 0` 且 `qty <= low_stock`；與缺貨互斥 | 已有 boundary tests |
| 整組可用性 | kits route/service 與 kit renderer | 整組不進一般 low/zero KPI；由 BOM shortage/insufficient 語意判定 | 已有 inventory integrity / frontend tests |
| 匯出與異動 | `app/routes/export.py`、`movements` writers、`tests/test_export.py` | 匯出保留 prepared/soft-delete/multi-location/decimal 與 movement type contracts | 已有 export regression coverage |
| Work Progress | `app/routes/work_progress.py`、`tests/test_work_progress.py` | 本階段不納入 inventory mutation；除非 runtime SQL evidence 證明寫入 `item_stocks`、`items.prepared_qty` 或 `movements` | Protected intent |

### 3.2 Boundary evidence

現行維護文件已明確記錄：

- `items.prepared_qty` 代表「已從架上拿出、尚未扣庫存」的待領出量。
- inventory KPI 的 server/client status classification 使用相同的 3 位小數規則。
- 低庫存與缺貨不把整組混入一般材料 KPI。
- inventory mutation 必須維持 `total_qty >= prepared_qty >= 0`。

因此目前沒有足夠證據宣稱「重複表示本身就是 bug」。目前較安全的分類是：**多個 consumer 共享既有定義，canonical contract 已由維護文件與測試部分固定，但 ownership/adapter boundary 仍可更明確。**

### 3.3 DEC-A001 gate

在沒有 domain owner + maintainer 設定 canonical inventory semantics、命名與邊界之前：

1. 不合併新的 inventory semantic helper 取代既有 consumers。
2. 不把 Work Progress 納入 inventory mutation boundary。
3. 不以「有多個 writer/consumer」直接推導需要重構。
4. 預設保留目前 production behavior；若後續只補文件或 regression fixture，必須維持現有結果。

## 4. C-001 — page definition and authorization matrix

### 4.1 Page representations

| Layer | Location | Role | Classification |
|---|---|---|---|
| Backend page registry | `app/models.py:17-21` `PAGE_KEYS` | `all_pages`、seed/backfill、API validation 的 canonical page membership | canonical backend definition |
| Backend role defaults | `app/models.py:22-39`、`initial_visible_page_keys()` | 新 user seed 與 reset defaults | canonical default definition |
| Persisted visibility | `app/database.py:257-263` `user_page_visibility` | 個人 page visibility override storage | persistence, not capability |
| Backend read/write | `app/services/auth.py:252-288`、`app/routes/users.py:577-630` | 讀取、驗證 unknown key/0-1、reset current-role default | API contract |
| Frontend access | `static/js/auth.js` `PAGE_VISIBILITY_TABS` / `canAccessPage()` | page visibility + capability UX gate | frontend adapter/guard |
| Navigation | `static/index.html` `data-page-key`、`static/js/app.js` `_TABS`/labels/icons | sidebar、tab/deep-link navigation metadata | navigation adapters |
| Permissions UI | `static/js/perms.js:288-425` | admin page visibility editor，沿用 API contract | management consumer |

目前實測與 focused tests 沒有顯示 page key 遺漏或 page-visibility API regression，因此**不以建立第二個 frontend registry 作為預設修法**。下一步若要 formalize Page Registry，必須先提供：

- backend `PAGE_KEYS` 與每個 frontend adapter 的 machine-readable diff；
- 至少一個可重現的 drift、deep-link、visibility/capability mismatch 或 runtime bug；
- 明確說明新 registry 移除的 verified risk；
- 保留 persisted page overrides、role defaults、reset semantics 與 `canAccessPage('stocktake', mode)` 現行行為。

### 4.2 Authorization rule

現行規則是 **page visibility AND capability**，不是「viewer 角色就代表某個 negative authorization」。

- Backend endpoint authority：`require_perm()` / `require_db_perm()` 與 route-level owner/global/scope checks。
- Frontend authority：`canAccessPage()`、render/action guards；只負責 UX，不取代 backend authorization。
- Page visibility：只能決定頁面是否顯示/可進入，不能授予 API capability。
- Explicit user/role overrides：必須保留，不能由重新 seed、role change 或 reset 以外的流程覆寫。
- Work Progress：保留 owner、non-owner、global capability、default、explicit deny/grant、dependency normalization 與 unauthenticated matrix。

本階段的 negative tests 已以 capability/explicit deny 為核心；viewer 只作為 role-default fixture，不作為唯一 authorization contract。

## 5. Frontend lifecycle contract

現行 lifecycle ownership 已分層而非單一集合：

- `static/js/globals.js`：`ITEMLESS_TABS` 表示該頁跳過 inventory `ALL_ITEMS` loading；`DATA_REFRESH_PRESERVE_MOUNT_TABS` 表示背景 refresh 不 remount stateful page。
- `static/js/api.js`：refresh orchestration 與 preserve-mount 判定的 consumer。
- `static/js/app.js`：`mountPreservedTabAfterBootstrap()` 負責 bootstrap 後單次 initial mount。
- Calendar 是 itemless，但與 preserve-mount set 的語意不同，不可因名稱相近而合併兩集合。

`tests/tab_lifecycle_runtime.test.js` 已 PASS，證明目前 production path 的 itemless、preserve-mount、single initial mount 與 refresh 不重複 mount 行為。現階段沒有 verified lifecycle drift，因此不新增 generic lifecycle abstraction；後續改動必須先以 runtime RED 或 static contract gap 證明必要性。

## 6. D-001 / E-001 / E-002 coverage matrix

| Boundary / flow | Static evidence | Runtime evidence in this pass | Remaining gap |
|---|---|---|---|
| Page visibility API/role defaults/overrides | `test_rbac_perms.py`, `test_frontend_assets.py` | Work Progress page visibility harness PASS | 無已知 regression；仍需保留 explicit override matrix |
| Capability-negative authorization | RBAC/viewer/security focused suites | signed report、quotation、petty cash harnesses PASS | 不能把 frontend gate 當 backend proof |
| Permission management pagination | frontend contract tests | permissions pagination harness PASS | 未新增 behavior |
| Itemless/preserve-mount lifecycle | frontend assets + globals/app contract | tab lifecycle harness PASS | Calendar-specific full flow 未執行 |
| Inventory quantity/status | inventory docs、`test_main.py`、`test_inventory_integrity.py`、`test_media_storage.py` | 本 pass 未新增 inventory browser harness | 若改 semantic consumer，需補 boundary fixture + cross-consumer regression |
| Calendar open/create/edit/delete/service-type/sync | existing source/tests + `tests/calendar_runtime.test.js` | **Calendar runtime harness PASS**：load、open/edit PUT、create POST、delete DELETE、service type/time payload、sync error modal | Full browser smoke、conflict/error/retry branches remain separate evidence if required |
| Work Progress owner/global/photo/page flow | route/tests/frontend contracts | page visibility harness PASS | browser-level upload/sync smoke remains separate evidence |

E-002 目前已有 dedicated Calendar runtime evidence，涵蓋本文件列出的 production paths；本文件不把它延伸宣稱為完整 browser smoke 或所有 conflict/retry branches。

## 7. Decision and next-gate register

| Gate | Current result | Required before behavior change |
|---|---|---|
| DEC-A001 | Decision required — human | confirm canonical inventory semantics/boundaries; late default is preserve current behavior |
| Page Registry | Evidence gate not met in this pass | verified drift/bug + registry ownership design + override/deep-link regression matrix |
| Lifecycle abstraction | Evidence gate not met in this pass | verified duplicated ownership or lifecycle bug; otherwise preserve current sets/flow |
| E-002 | Dedicated runtime harness PASS for listed Calendar production paths | browser smoke/conflict/retry evidence only if future scope requires it; do not overclaim coverage |
| D-001 | Partially satisfied | add narrowly scoped WHY documentation only at non-obvious boundaries; do not annotate line-by-line code |

## 8. Explicit non-actions

- No production code, schema, migration, permission key, route, or frontend registry was changed.
- One test-only runtime harness (`tests/calendar_runtime.test.js`) was added and wired into `tests/test_frontend_assets.py` to close the Calendar evidence gap; it does not alter production behavior.
- No inventory writer centralization or transaction refactor was attempted; those belong to PR 2B-0 evidence and GO/NO-GO.
- No permission rename was attempted; taxonomy/legacy mapping belongs to PR 3B.
- No claim is made that the Calendar harness is a complete browser smoke suite; the listed production paths are covered by `tests/calendar_runtime.test.js`.
- No main workspace synchronization was performed; all PR 2A work is isolated in `hvac-inventory-PR2A`.
