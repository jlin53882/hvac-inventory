<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **hvac-inventory** (2218 symbols, 5489 relationships, 193 execution flows).

> Index stale? Run `node .gitnexus/run.cjs analyze --index-only` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? Bootstrap with `npx`, `bunx`, or `pnpm dlx` — e.g. `bunx gitnexus@latest analyze` (npm 11 npx crash; #1939).

## Always Do

- **MUST run impact before editing.** Use `impact({target: "symbolName", direction: "upstream"})` or `node .gitnexus/run.cjs impact "symbolName" --direction upstream --repo .`; report callers, processes, and risk. Never substitute grep for graph analysis.
- **MUST analyze graph changes before committing.** Use `detect_changes({scope: "all"})` (MCP) or `node .gitnexus/run.cjs detect-changes --scope all --repo .` (CLI fallback). `partial: true` or `truncated: true` is not a clean check — a zero means unseen, not unaffected; re-run it. For regression review: `detect_changes({scope: "compare", base_ref: "master"})` or `node .gitnexus/run.cjs detect-changes --scope compare --base-ref "master" --repo .`.
- MUST warn on HIGH/CRITICAL `risk` pre-edit; never use `riskSharedAxes` to waive a HIGH/CRITICAL `risk` warning. Compare File/symbol: MCP File omits axes; Graph-RAG expands File.
- **MUST treat `risk: UNKNOWN` as unresolved, not as low.** An empty caller set is not evidence the symbol is unused — it can also mean the callers are not resolvable by the index (plain-object property access, dynamic dispatch, cross-language calls). `impact` pairs `UNKNOWN` with a `riskNote` saying so. Confirm with a text search before treating the symbol as safe to change or delete; do not proceed on the strength of a zero.
- **MUST use `query({search_query: "concept"})` for concepts/flows, `context({name: "symbolName"})` for a named symbol, or `impact` for blast radius, on read-only callers, dependencies, imports, or execution flow.** Graph first; text search only for empty/`UNKNOWN`/literals.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method before MCP/CLI impact analysis.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis, and never read `UNKNOWN` as an all-clear — it means the walk could not answer, which is the one verdict that requires confirming by other means.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit before MCP/CLI graph change analysis.

## Resources

| Resource | Use for |
| --- | --- |
| `gitnexus://repo/hvac-inventory/context` | Codebase overview, check index freshness |
| `gitnexus://repo/hvac-inventory/clusters` | All functional areas |
| `gitnexus://repo/hvac-inventory/processes` | All execution flows |
| `gitnexus://repo/hvac-inventory/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
| --- | --- |
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->

## 家豪規則：Dead Code 預防（2026-08-12 定案，任何 code 修改適用）

> 此區塊為家豪/agent 維護內容，GitNexus analyze 重跑時**勿覆寫 gitnexus:end 之後的內容**。

**commit 前必跑 4 步自查**（防止重蹈 dead code 報告 11 項覆轍——4 個模式：寫了沒用忘了清 / 同功能兩版被取代 / 整段搬移帶殘骸 / 預期功能沒落地）：

1. **新定義自查**：本次新增的函式/常數/class 若零引用 → 刪掉；若是預留 → 註解標「預留」並接到 UI/呼叫點，否則**不入 commit**。
2. **取代即刪**：寫了新 helper/新版取代舊的 → **同一個 commit 內刪掉舊版**（getRolePermSummary、photoImgClick 模式）。
3. **搬移/拆分後清理**：整段搬移或「拆分前備份」後跑一次 dead code pass（SUBHEADER_FONT/Protection/XLImage 模式）。
4. **算好就要顯示**：計算出來沒顯示的數字 → 接上 UI 或刪掉（totalQty 模式），「預留統計」不入 commit。

**附帶規則**：
- 前端行為改動 → 同步補 `tests/test_frontend_assets.py` 斷言（計算邏輯抽純函式後測，totalQtyStr 模式）。
- 純視覺改動（樣式/對齊）→ 收尾紀錄標記「不需測試」，不得默默 0 測試 commit。
- commit 前 `node --check` 全量已由 `test_js_syntax` 自動覆蓋（22 檔），不需手動。

## 安全開發守則（2026-08-12 定案：新增功能必讀）

> 背景：Phase 0-6 修復後，新功能（手機 UI f3c8880 / 整組編輯 36306ea / 行事曆）仍各帶進 stored XSS、負 qty 假流水、公式注入——**測試只守功能不守安全模式**。以下 5 條為新增功能的強制守則，違反會被 `tests/test_security_regression.py` 擋下。

1. **新 JS / 新 render**：HTML 模板內的使用者可控資料內插**一律 `esc()` / `jsStr()`**（utils.js；`"`→`&quot;`、`'`→`&#39;`）。寫完跑 `pytest tests/test_security_regression.py::test_js_html_templates_interpolations_escaped`——若掃描器列你的內插為「未審核」，安全的話加入 `REVIEWED_SAFE_BODIES` 白名單（含註解），否則補 esc()。
2. **新 write 端點**：Pydantic/迴圈驗證數量 ≥0（qty）、字串長度、日期/時間格式（HH:MM regex）；非 dict 元素 → 400 不 500；`item_id`/FK 存在性檢查。權限自動由 main.py 全域 `require_login` 擋 viewer——**不要繞過**（自我身份操作才用 `authenticate`）。
3. **新匯出（xlsx）**：每個字串欄位過 `_safe()`（`= + - @` 開頭加撇號）——含時間欄、廠牌統計等所有 sheet 所有欄位。
4. **新上傳**：副檔名白名單 + 檔案大小/像素上限（load 前檢查）+ 檔名固定不可控；照片只能放 `static/uploads/`（公開路徑自動 404，登入走 `/uploads/<int>.jpg`）。
5. **commit 前**：跑 `./scripts/run-tests.sh` 對應改動組別（core/frontend/auth/rbac/regression）全綠（含 `test_security_regression.py`）+ gitnexus detect_changes；**只有大量修改才跑全量 `all`**（2026-08-14 家豪定案）。

## 新增內容與修改規範（2026-08-16 定案：一次寫好，避免日後重構）

> 結構重整 6 phase（models 收攏 / movements / service_types / middleware / calendar.js 拆 3 檔 / style.css 拆 2 檔）完成後，**新增/修改任何 code 前必讀 `docs/新增內容與修改規範.md`**——包含：
> - **結構地圖**：新 API 放哪個 routes 檔、新 model 放 models.py（勿內嵌 route）、新 middleware 放 middleware.py、新樣式放 core/calendar.css、新 JS 共享狀態用 globals.js var
> - **10 步檢查清單**：放對位置 → 同步掛載（main.py import+tuple 兩處！）→ 權限 → 安全 5 條 → dead code 4 步 → 測試同步（bug 版必紅驗證）→ 行尾對齊 → docs 同步 → 測試組別 → commit
> - **重構徵兆**：函式 >400 行 / model 寫 route 檔 / CSS 撞名 / 「先這樣放之後再整理」→ 當下就整理
>
> 核心原則：**找不到合適位置 = 開新檔（main.py 兩處同步），不是硬塞進最近的檔**——movements/service_types 寄生他檔、calendar.js/style.css 單檔爆炸，都是「硬塞/附加」造成的 6.5h 重構。
