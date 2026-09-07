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
