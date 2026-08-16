<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **hvac-inventory** (1439 symbols, 3548 relationships, 124 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "master"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/hvac-inventory/context` | Codebase overview, check index freshness |
| `gitnexus://repo/hvac-inventory/clusters` | All functional areas |
| `gitnexus://repo/hvac-inventory/processes` | All execution flows |
| `gitnexus://repo/hvac-inventory/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

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
