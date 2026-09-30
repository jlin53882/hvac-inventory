// core/state.js 與各 feature state：state 所有權（單一 feature 專用的值不放 appState）、parseCalendarMonth（網址 ?month=）、共用常數不可變
const assert = require('assert');
const vm = require('vm');
const { loadModules } = require('./support/frontend-runtime');

const context = { URLSearchParams, location: { search: '' } };
vm.createContext(context);
loadModules(context, 'core/state.js', 'features/calendar/state.js', 'features/inventory/state.js', 'features/work-progress/state.js');
const { parseCalendarMonth } = context;
const NOW = new Date(2026, 8, 30);   // 2026-09-30

// 合法：回傳該月 1 號
let d = parseCalendarMonth('?month=2026-03', NOW);
assert.deepStrictEqual([d.getFullYear(), d.getMonth(), d.getDate()], [2026, 2, 1]);
d = parseCalendarMonth('?x=1&month=2025-12', NOW);
assert.deepStrictEqual([d.getFullYear(), d.getMonth(), d.getDate()], [2025, 11, 1]);

// 不合法（缺少 / 格式錯 / 月份超出 1–12）一律回到「現在」
for (const search of ['', '?month=', '?month=2026-3', '?month=2026-13', '?month=2026-00', '?month=abcd-ef', '?month=2026-03-01']) {
  assert.strictEqual(parseCalendarMonth(search, NOW), NOW, `invalid ${search} must fall back to now`);
}

// 模組載入時 calMonth（calendar 擁有）由 location.search 決定
const ctx2 = { URLSearchParams, location: { search: '?month=2024-02' } };
vm.createContext(ctx2);
loadModules(ctx2, 'features/calendar/state.js');
assert.deepStrictEqual([ctx2.calendarState.calMonth.getFullYear(), ctx2.calendarState.calMonth.getMonth()], [2024, 1]);

// state 所有權：只有單一 feature 使用的值住在該 feature（或該模組私有），不在跨 feature 共用的 appState
for (const moved of ['calMonth', 'batchMode', 'toastTimer', 'STATUS_LIST_CONTEXT']) {
  assert.ok(!(moved in context.appState), `${moved} 不應留在 appState`);
}
assert.strictEqual(context.inventoryState.batchMode, false);
assert.strictEqual(context.wprHistoryPageSize, 20);

// 共用常數是凍結的（importer 不能意外改動）
for (const name of ['CAL_PALETTE', 'CAL_WEEK', 'INVENTORY_SITES']) {
  assert.ok(Object.isFrozen(context[name]), `${name} must be frozen`);
}
assert.strictEqual(context.CAL_WEEK.length, 7);
console.log('state runtime: PASS');
