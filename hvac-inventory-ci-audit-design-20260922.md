# hvac-inventory GitHub Actions CI
## Audit 與第一版設計提案

- Repository：`jlin53882/hvac-inventory`
- Branch：`master`
- Audit HEAD：`4b1fde9d2a07fa55270585ffc4f78584150e5474`
- Audit 日期：2026-09-22
- Scope：GitHub Actions CI、test runner、CI 文件
- 狀態：Phase 1 implementation complete；PR #28 / branch `ci/restructure-actions`

---

## 1. Executive Summary

目前 CI 能正常執行完整回歸、locked dependency、JUnit artifact 與 quality checks，但每個 PR 會在 Python 3.11 與 3.12 各執行一次完整 suite，造成主要重複成本。

建議第一版改為：

- PR：Python 3.12 完整 regression + 平行 domain gates
- master push：Python 3.12 primary full regression + Python 3.11 compatibility full regression
- scheduled：Python 3.11 compatibility full regression
- 以穩定的 `CI / Gate` 作為唯一 Merge Gate
- 改用固定版本的 `astral-sh/setup-uv` 與 uv cache
- 保留 `uv.lock` strict contract、pytest-xdist、JUnit artifact 與 Windows runner
- 不修改 production business logic、不降低 regression coverage、不改變本機 `uv sync`

---

## 2. Current CI Audit

### 2.1 Current workflow

檔案：`.github/workflows/ci.yml`

Audit 前的 trigger：

- `pull_request` → `master`
- `push` → `master`
- `workflow_dispatch`
- （Phase 1 implementation 新增）每週日 schedule

Audit 前 jobs：

- `test`：`windows-latest`，Python 3.11 / 3.12 matrix，全量執行 `bash scripts/run-tests.sh all`
- `quality`：locked dependency check、compileall、`git diff --check`
- `ci-status`：彙總 `test` 與 `quality`

Phase 1 implementation jobs：`CI / Quality`、`CI / Frontend + Security`、`CI / Inventory + Database`、`CI / RBAC`、`CI / Reports`、`CI / Full Regression (Python 3.12)`、master-only `CI / Compatibility (Python 3.11)`、weekly `CI / Deep Regression (serial)` 與 `CI / Gate`。

Audit 前已具備：

- `permissions: contents: read`
- concurrency 與 `cancel-in-progress: true`
- `uv lock --check`
- `uv sync --locked --group dev`
- pytest-xdist，`all` 使用 `-n auto`
- JUnit XML artifact
- artifact retention 7 days
- Windows runner
- master push 驗證

Audit 前缺少、已由 Phase 1 補上：

- scheduled / deep regression run
- uv 官方 GitHub Action
- uv dependency cache
- domain-level CI jobs
- 穩定命名的 `CI / Gate`
- quality 對 `main.py` 的 compile check

### 2.2 Real GitHub Actions baseline

資料來源：GitHub Actions recent successful runs。

最近一次成功 workflow：

- Workflow total：**455 秒**
- Python 3.11 job：**329 秒**
  - pytest：**307 秒**
  - locked dependency install：**3 秒**
- Python 3.12 job：**444 秒**
  - pytest：**374 秒**
  - locked dependency install：**21 秒**
- Quality job：**35 秒**
- Artifact upload：約 **1–2 秒**

兩個 Python full suite 是平行執行，但最新成功 run 的 runner 差異使 Python 3.12 job 成為 critical path（444 秒）。這證明 runner timing 有波動，不能用舊的 406 秒當固定基準。

### 2.3 Local baseline

於 audit clone 實際執行：

```text
1746 passed
969 warnings
56.61s
```

本機為 CPython 3.13.3，僅作 repository baseline，不代表 GitHub Windows runner timing。

### 2.4 After baseline：PR #28

成功 run：`35638123984`，SHA：`969cbcfde9097b941a4c7e7997ac620446911caa`。

| Job / step | Wall time |
|---|---:|
| Workflow total（18:23:59–18:30:08 UTC） | 369s |
| `CI / Full Regression (Python 3.12)` job | 357s |
| Full regression pytest step | 330s |
| `CI / Frontend + Security` | 45s |
| `CI / Inventory + Database` | 128s |
| `CI / RBAC` | 128s |
| `CI / Reports` | 73s |
| `CI / Quality` | 20s |
| Full regression locked install | 1s |

Runner diagnostics：Windows Server 2025、AMD64、`os.cpu_count() = 4`、CPython 3.12.10、pytest 9.1.1、pytest-xdist 3.8.0。完整 suite：`1746 passed, 935 warnings in 328.70s`。

相對最近成功 master baseline 的 455s，PR run 是 369s（-86s，約 -18.9%）；primary full job 由 444s 降至 357s，pytest step 由 369.75s 降至 330s。這是單次 run evidence，不宣稱固定比例；hosted runner / image timing 仍有波動。PR full regression 仍完整執行，沒有用刪測試換速度。

---

## 3. GitNexus / Repository Impact

GitNexus 已確認 master index 與 audit HEAD 對齊：

- Repository：`hvac-inventory`
- Indexed HEAD：`ceba39ec47738ae756733640b89bafe09d19abcc`
- 約 192 files、5958 nodes、18201 edges

已執行 concept query：

```text
test runner pytest xdist CI workflow test groups
```

GitNexus 對 Python/JS test symbols 的解析正常，但對 workflow YAML 與 shell grouping 的圖分析有限。因此 YAML/shell audit 另外以 workflow、script、docs references、collect-only 與 GitHub run data 交叉確認。

沒有把 YAML/shell 的圖分析空結果視為 low risk。

### Production runtime evidence

目前 repository evidence 顯示：

- 正式部署為 Windows local runtime
- 使用 `.venv\Scripts\python.exe`
- `pyproject.toml` 為 `requires-python = ">=3.11"`
- 沒有文件或啟動 script 明確指定正式環境一定是 Python 3.11
- Audit 當下沒有可讀取的 running uvicorn/python production process

因此不能把 Python 3.11 宣稱為 production runtime。設計上採保守分工：Python 3.12 作 PR primary runtime，Python 3.11 作 master/scheduled compatibility。

---

## 4. Test Group Drift

### 4.1 Repository test inventory

實際 collect-only：

```text
1746 tests
40 個 test_*.py 檔案
```

現有 script 分組 collect 結果：

| Group | Files | Collected tests |
|---|---:|---:|
| core | 2 | 239 |
| frontend | 5 | 468 |
| storage | 5 | 80 |
| auth | 2 | 55 |
| database | 1 | 7 |
| rbac | 3 | 324 |
| regression | 5 | 252 |
| petty_cash | 3 | 53 |
| work_progress | 2 | 39 |

### 4.2 Confirmed drift

文件 `docs/單元測試維護文件.md` 宣稱 `petty_cash` 包含：

```text
tests/test_petty_cash.py
tests/test_engineering_petty_cash.py
tests/test_petty_cash_excel_rendering.py
tests/test_petty_cash_frontend_races.py
```

但目前 `scripts/run-tests.sh` 漏掉：

```text
tests/test_petty_cash_excel_rendering.py
```

這是明確的 script/docs drift，應在修改階段修正。

### 4.3 Tests without a clear domain group

以下 test files 會被 `all` 執行，但目前沒有清楚的本機 domain group：

```text
tests/test_app_logging.py
tests/test_config.py
tests/test_export.py
tests/test_inventory_integrity.py
tests/test_inventory_writer_scanner.py
tests/test_inventory_writer_transactions.py
tests/test_notifications.py
tests/test_petty_cash_excel_rendering.py
tests/test_prepared_api.py
tests/test_quantity.py
tests/test_server_lifecycle.py
tests/test_units.py
tests/test_vehicle_inventory.py
```

---

## 5. Proposed Final Design

### 5.1 PR jobs

```text
CI / Quality
CI / Frontend + Security
CI / Inventory + Database
CI / RBAC
CI / Reports
CI / Full Regression (Python 3.12)
CI / Gate
```

共 7 個主要 jobs，domain gates 與 full regression 平行執行。

不採用十幾個超小 jobs，避免每個 job 重複 Windows runner、checkout、Python setup 與 dependency installation。

Phase 1 的 domain jobs 是 diagnostic / observability gates，不是 total compute reduction，也不取代 Full Regression。Frontend、Inventory、RBAC、Reports 會先跑一次以提供較快的 failure signal，而 Full Regression 仍會再次執行完整 `tests/`。

因此 Phase 1 接受 domain/full 的有意識重複；真正移除 PR Full Regression 必須等 Phase 2 完成完整 test inventory、沒有 orphan tests，且 domain union 可機器驗證覆蓋全部 `tests/`。

### 5.2 Domain groups

新增本機可用的 `inventory` group：

```text
tests/test_inventory_integrity.py
tests/test_inventory_writer_transactions.py
tests/test_inventory_writer_scanner.py
tests/test_prepared_api.py
tests/test_quantity.py
tests/test_vehicle_inventory.py
tests/test_database_migrations.py
tests/test_units.py
```

新增本機可用的 `reports` group：

```text
tests/test_export.py
tests/test_petty_cash.py
tests/test_engineering_petty_cash.py
tests/test_petty_cash_excel_rendering.py
tests/test_petty_cash_frontend_races.py
```

`petty_cash` 原有 group 同步補上：

```text
tests/test_petty_cash_excel_rendering.py
```

CI 不直接硬編碼大量 pytest filenames，優先呼叫：

```bash
bash scripts/run-tests.sh frontend
bash scripts/run-tests.sh inventory
bash scripts/run-tests.sh rbac
bash scripts/run-tests.sh reports
bash scripts/run-tests.sh all
```

### 5.3 Full regression strategy

保留：

```bash
bash scripts/run-tests.sh all
```

並保留 pytest-xdist 與 `-n auto`。

不做以下變更：

- 不改 PBKDF2 iterations
- 不 mock 掉 SQLite transaction behavior
- 不移除 integration tests
- 不改成 changed-tests-only
- 不加入 coverage percentage gate

### 5.4 master push

master push 執行：

```text
Python 3.12 full regression
Python 3.11 compatibility full regression
```

確保實際 landed commit 同時驗證 primary runtime 與 compatibility runtime。

### 5.5 Scheduled deep regression

master push 已經執行 Python 3.11 compatibility full regression，因此不再每天重複相同的 `3.11 -n auto` suite。改採每週一次 serial deep regression，尋找 xdist 可能遮蔽的 ordering / global-state 問題：

```yaml
schedule:
  - cron: "0 16 * * 0"
```

UTC 對應：

```text
每週日 00:00 Asia/Taipei
```

scheduled job 使用 Python 3.11，執行：

```bash
pytest tests/ -q
```

不使用 xdist，且不是 PR required job。

---

## 6. uv Design

### CI

改用固定 major/version 的官方 action：

```text
astral-sh/setup-uv@v6
```

並啟用 uv cache。

CI 繼續使用：

```bash
uv lock --check
uv sync --locked --group dev
```

不使用：

```text
@latest
@main
@master
```

### Local development

本機維持原本流程：

```bash
uv sync
```

不要求開發者改用：

```bash
uv sync --locked --group dev
```

CI-only cache 與 environment 不會綁進 production config，也不會改變本機 lock 更新行為。

---

## 7. Quality Gate Design

Quality 保留：

```bash
uv lock --check
git diff --check
```

Compile check 修正為涵蓋：

```bash
python -m compileall -q app tests main.py
```

目前 workflow 只 compile `app tests`，漏掉正式 entry point `main.py`。

---

## 8. Final Gate Design

將目前 `CI status` 改為穩定命名：

```text
CI / Gate
```

Gate 使用 `if: always()`，檢查：

- Quality
- Frontend/Security
- Inventory/Database
- RBAC
- Reports
- PR Full Regression
- master/scheduled compatibility job（依 event 要求）

判定規則：

- required job `failure` → Gate fail
- required job `cancelled` → Gate fail
- required job unexpected `skipped` → Gate fail
- PR 中明確 optional 的 compatibility skipped 不造成永久 waiting
- 所有 required contracts success 才 pass

建議未來 Branch Protection 只要求：

```text
CI / Gate
```

本次不直接修改 repository branch rules。

目前 branch protection 查詢結果為：

```text
Branch not protected
```

---

## 9. Concurrency Design

Concurrency 修正為：

- PR：`ci-pr-<pull_request.number>`，`cancel-in-progress: true`
- master push：`ci-push-<github.sha>`，`cancel-in-progress: false`
- schedule / manual：獨立 run key，`cancel-in-progress: false`

核心 invariant：同一個 PR 新 commit 可以取消舊 run；每一個真正進 master 的 SHA 不會被後續 master push cancel。

---

## 10. Phase 2 Profiling Plan

目前最新成功 GitHub run 顯示 pytest（307–374 秒）遠大於 dependency install（3–21 秒），因此 uv cache 是正確改善，但不是主要 bottleneck。

Phase 1 primary full job 會輸出：

- Python version / executable
- OS / architecture
- `os.cpu_count()`
- pytest version
- pytest-xdist version

可由 `workflow_dispatch` 的 `profile=true` 觸發：

```bash
bash scripts/run-tests.sh all --durations=50
```

用來取得 GitHub runner 上 top 50 slowest tests。Phase 2 再比較 local 56.61 秒（CPython 3.13.3）與 GitHub runner 307–374 秒的差距，確認 CPU、xdist worker、PBKDF2、Windows filesystem、SQLite I/O、fixture setup 或 process spawn 假說；在取得資料前不宣稱 root cause。

---

## 11. Scope Boundaries

本次不做：

- `app/**` 修改
- `static/**` 修改
- `main.py` business logic 修改
- Docker
- Linux runner matrix
- dynamic test impact analysis
- changed-file dependency graph
- coverage percentage gate
- paths-ignore/path filters
- deploy automation
- branch protection API 修改
- CI-only fake tests

預計修改範圍：

```text
.github/workflows/ci.yml
scripts/run-tests.sh
docs/單元測試維護文件.md
README.md
專案架構.md
```

---

## 11. Verification Plan After Approval

修改後會執行：

1. YAML syntax parse
2. job needs graph / gate condition review
3. `uv lock --check`
4. `uv sync --locked --group dev`
5. `bash scripts/run-tests.sh inventory`
6. `bash scripts/run-tests.sh frontend`
7. `bash scripts/run-tests.sh rbac`
8. `bash scripts/run-tests.sh reports`
9. `bash scripts/run-tests.sh all`
10. `python -m compileall -q app tests main.py`
11. `git diff --check`
12. GitNexus post-change `detect_changes`
13. dead code / temporary artifact / unrelated diff check
14. push 後重新取得 GitHub Actions 真實 timing

Before/After performance 回報只使用實際 GitHub Actions run 數字；若尚未取得 remote run，不捏造 After timing。

---

## 13. Current Decision Status

目前已完成最新 master re-audit，並在獨立 PR workspace 開始 Phase 1 implementation：

- latest master：`4b1fde9d2a07fa55270585ffc4f78584150e5474`
- PR workspace：`C:\\Users\\admin\\workspace\\hvac-inventory-ci-restructure`
- branch：`ci/restructure-actions`
- production code：未修改
- tests：未修改
- branch protection：未修改
- workflow / scripts / docs：Phase 1 changes complete
- local `.venv`：ignored，僅供 CI-equivalent verification

Phase 1 的 domain gates 保留 full regression；After timing 已由 PR #28 run `35638123984` 取得。此前第一版因 diagnostic 使用 system Python 而失敗，修正為 `.venv/Scripts/python.exe`；`969cbcf` run 的所有 required PR jobs 成功，`CI / Gate` 亦成功。
