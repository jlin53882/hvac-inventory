# GitHub Actions CI 維護文件

> 本文件是 hvac-inventory 的 CI 長期維護契約，描述 GitHub Actions orchestration、event contract、Merge Gate、concurrency 與修改 SOP。
> 測試檔案分組請看 `docs/CI測試群組對照.md`；pytest、fixture、資料庫隔離與測試撰寫規則請看 `docs/單元測試維護文件.md`。

## 1. 文件責任邊界

| 文件 | 唯一責任 |
|---|---|
| `docs/CI維護文件.md` | GitHub Actions event、job、Gate、concurrency、uv CI contract 與 CI 修改 SOP |
| `docs/CI測試群組對照.md` | `tests/test_*.py` → local group → CI signal / `full-only` |
| `docs/單元測試維護文件.md` | pytest 執行方式、fixture、DB isolation、測試分組與新增測試 SOP |
| `scripts/run-tests.sh` | 本機與 CI 共用的測試分組實作 |
| `.github/workflows/ci.yml` | CI workflow 的可執行定義 |

README 與 `專案架構.md` 僅保留摘要；當摘要與 workflow 不一致時，以 workflow 與本文件為準，並同步修正摘要。

## 2. CI 基本不變量

- CI 使用 Windows runner。
- PR primary runtime 為 Python 3.12。
- Python 3.11 是 compatibility runtime；`pyproject.toml` 的 contract 為 `requires-python = ">=3.11"`。
- `CI / Gate` 是穩定彙總檢查；內部 job 可以重構，不應以內部 job 名稱取代 Gate 作為長期 merge check。
- Full Regression 永遠執行 `tests/` 全量，不得以 changed-tests-only 或大量 `-k` 篩選取代。
- 保留 pytest-xdist 與 `-n auto`；serial deep regression 是另外的 ordering / global-state coverage。
- Domain jobs 是 diagnostic / observability gates，不取代 full regression；與 full suite 的 deliberate overlap 是目前設計。
- CI 不 deploy、不連 production DB、不需要 production secrets。

## 3. Event contract

### Pull Request → `master`

執行並要求成功：

- `CI / Quality`
- `CI / Frontend + Security`
- `CI / Inventory + Database`
- `CI / RBAC`
- `CI / Reports`
- `CI / Full Regression (Python 3.12)`
- `CI / Gate`

Expected skipped：

- `CI / Compatibility (Python 3.11)`
- `CI / Deep Regression (serial)`

### `master` push

執行並要求成功：

- `CI / Quality`
- `CI / Frontend + Security`
- `CI / Inventory + Database`
- `CI / RBAC`
- `CI / Reports`
- `CI / Full Regression (Python 3.12)`
- `CI / Compatibility (Python 3.11)`
- `CI / Gate`

`CI / Deep Regression (serial)` 為 expected skipped。

### Weekly schedule

目前排程為每週日 00:00（Asia/Taipei）：

```yaml
schedule:
  - cron: "0 16 * * 6"
```

換算為：

```text
UTC Saturday 16:00 = Asia/Taipei Sunday 00:00
```

scheduled run：

- `CI / Deep Regression (serial)` 必須成功
- `CI / Gate` 必須成功
- 其他 jobs 為 expected skipped

Deep Regression 使用 Python 3.11、serial pytest，不使用 xdist。用途是捕捉 test ordering、global state leak、serial-only race，以及可能被 xdist masking 的問題。

### `workflow_dispatch`

`profile` 是 boolean input，預設為 `false`。

`profile=false` 是完整 manual verification，要求 Quality、四個 domain jobs、Python 3.12 full、Python 3.11 compatibility 與 Gate 成功；Deep Regression expected skipped。

`profile=true` 是 profiling 模式，仍執行 Quality、四個 domain jobs 與 Python 3.12 full，但 primary full command 額外傳入：

```bash
--durations=50
```

此模式 expected skipped：

- `CI / Compatibility (Python 3.11)`
- `CI / Deep Regression (serial)`

`profile=true` 不得因 compatibility skipped 而使 Gate fail。

## 4. `CI / Gate` contract

Gate 使用 `if: always()`，依 event 檢查不同 required jobs，不把所有 job 永遠要求為 success。

- required `success` → pass
- required `failure` → fail
- required `cancelled` → fail
- required unexpected `skipped` → fail
- 明確標記的 expected `skipped` → allowed

Gate 必須檢查 expected skipped 的實際結果，而不是只忽略該 job。如此可避免 job 因條件錯誤而 skipped 時被靜默放行。

## 5. Concurrency contract

- PR concurrency key 以 PR number 識別；同一 PR 的新 commit 可以 cancel 舊 run。
- `master` push 以 landed SHA 作為 key，且不可因後續 master commit cancel 前一個 run。
- schedule 與 manual run 使用獨立 key，`cancel-in-progress` 不應讓不同 event 互相取消。

不可把 master concurrency 改回 branch ref 加 `cancel-in-progress: true`，否則後續 commit 會取消仍在驗證前一個 landed SHA 的 run。

## 6. Full regression 與 domain jobs

PR primary full regression 使用：

```bash
bash scripts/run-tests.sh all
```

`all` 由 runner 使用 pytest-xdist `-n auto` 執行 `tests/`。`JUNITXML` 環境變數由 workflow 傳入時，runner 必須保留 JUnit XML 輸出。

Domain jobs 目前呼叫：

```bash
bash scripts/run-tests.sh frontend
bash scripts/run-tests.sh inventory
bash scripts/run-tests.sh rbac
bash scripts/run-tests.sh reports
```

它們的目的為：

- 更快定位 frontend/security、inventory/database、RBAC、reports failure
- 提供較清楚的 domain signal
- 不宣稱降低 total runner compute
- 不取代 full regression

測試檔案的完整 mapping、重疊與 `full-only` 狀態只維護在 `docs/CI測試群組對照.md`，不要在本文件複製 filename 清單。

## 7. uv 與 dependency contract

### CI

CI 使用官方 `astral-sh/setup-uv` action 與 uv dependency cache，並嚴格執行：

```bash
uv lock --check
uv sync --locked --group dev
```

`uv.lock` 是 CI dependency source of truth。CI 不得自動重寫、commit 或推送 `uv.lock`。

### Local development

本機日常流程維持：

```bash
uv sync
```

不可把 `uv sync --locked --group dev` 變成本機唯一工作方式；CI 的 locked contract 與本機可更新 lock 的 workflow 是有意識的差異。

## 8. Quality、artifact 與權限 contract

Quality 至少涵蓋：

```bash
uv lock --check
python -m compileall -q app tests main.py
git diff --check
```

若 workflow 已採用 actionlint 或其他等價工具，修改 workflow 時也必須執行；新增 quality check 後要同步更新本文件。修改 workflow 後仍要人工 review GitHub expression 與 `needs` graph，即使 YAML parser 通過也不能省略。

Full Regression、Python 3.11 Compatibility 與 serial Deep Regression 各自產生 JUnit XML artifact，retention 為 7 days。Domain diagnostics 不必為了形式重複上傳同樣 artifact。

Workflow permissions 維持最小權限：

```yaml
permissions:
  contents: read
```

若未來需要新增權限，必須在文件與 review 中說明用途，不能順手擴權。

## 9. Branch protection guidance

建議對 `master` 啟用：

- Require pull request
- Require status checks
- Required check：`CI / Gate`

不要把所有 inner jobs 都設為 branch protection required。內部 jobs 可因 CI 架構演進而調整，`CI / Gate` 才是穩定的 merge contract。

本文件不代表已替 repository 修改 branch protection；設定變更必須另有明確授權。

## 10. 修改 CI 的 SOP

### 修改 workflow 前

1. 讀本文件。
2. 讀 `docs/CI測試群組對照.md`。
3. 讀 `docs/單元測試維護文件.md`。
4. 讀 `scripts/run-tests.sh` 與目前 workflow。
5. 確認 event matrix、job `if`、`needs` graph 與 Gate semantics。
6. 確認 concurrency invariant、permissions、uv lock contract 與 artifact contract。
7. 使用 GitNexus `query` / `context` / `impact`；YAML 或 shell 回 `UNKNOWN` 時，另以 repo search、workflow references 與 script references 交叉確認，不得當作 low risk。

### 修改 workflow 後最低驗證

- YAML parse
- GitHub expression review
- job `needs` graph review
- event condition review
- Gate matrix review
- concurrency review
- `uv lock --check`
- `uv sync --locked --group dev`
- `python -m compileall -q app tests main.py`
- `git diff --check`
- GitNexus `detect_changes`

### 修改 `scripts/run-tests.sh`

同步確認：

- `docs/單元測試維護文件.md`
- `docs/CI測試群組對照.md`
- `.github/workflows/ci.yml`

至少執行受影響 group；runner 或 grouping 行為改動時執行：

```bash
bash scripts/run-tests.sh all
```

新增 `tests/test_xxx.py` 時，必須在 `docs/CI測試群組對照.md` 指定 local group 與 CI domain 或 `full-only`，不可產生 silent orphan。

## 11. Profiling SOP

從 GitHub Actions 的 **Run workflow** 以 `profile=true` 手動執行。

用途是取得 Python 3.12 primary full regression 的 `pytest --durations=50`，用來調查 slow tests、slow fixtures 與 CI bottleneck。不要把某次 runner 的 timing、test count 或 profiling 結果硬寫進長期維護文件；結果應留在當次收尾紀錄或 issue。

## 12. Future Phase 2 boundary

只有在以下條件都成立後，才可評估用 parallel domain matrix 取代 PR full regression：

- 所有 `tests/test_*.py` 都已分類
- domain union 可機器驗證完整覆蓋 `tests/`
- 沒有 orphan 或未解釋的 `full-only` tests
- full regression 的 invariant 已被等價或更強的 coverage contract 取代

在此之前，domain jobs 與 full regression 的重疊是刻意保留的安全邊界。

## 13. Guardrails

CI 維護不得因為速度壓力而：

- 降低 PBKDF2 iteration 或弱化 security contract
- mock 掉重要 SQLite transaction 行為
- 跳過 integration、inventory invariant、RBAC、security、Excel 或 frontend lifecycle regression
- 直接用 changed-tests-only 取代 full suite
- 隨意加入 `paths-ignore`
- 未審核就把 GitNexus 變成 required CI
- 隨意導入 Docker / Linux matrix
- 在 CI 自動 deploy production
