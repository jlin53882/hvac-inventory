// 已領出頁 data-action 事件委派的 runtime 測試：action 分派、巢狀子元素、disabled、動態 HTML、不依賴 window.Stockout。
const assert = require('assert');
const vm = require('vm');
const { installApiClient, loadModules } = require('./support/frontend-runtime');

/** 建立載入 stockout 模組並記錄呼叫的 vm context（modals/page/sheet 的函式先以替身覆蓋）。 */
function makeContext() {
  const calls = [];
  const context = vm.createContext({ console, hasPerm: () => true, document: { getElementById: () => null } });
  installApiClient(context);
  loadModules(context, 'core/qty.js', 'features/stockout/state.js', 'features/stockout/modals.js',
    'features/stockout/page.js', 'features/stockout/sheet.js', 'features/stockout/export-dialog.js', 'features/stockout/actions.js');
  for (const name of ['openEditStockoutModal', 'returnStockout', 'deleteStockoutRecord', 'openEditStockoutReturnModal',
    'deleteStockoutReturn', 'openStockoutSheet', 'renderStockOuts', 'clearStockoutFilters', 'openNonStockOutModal',
    'openStockoutExportDialog', 'setStockoutFilter']) {
    context[name] = (...args) => { calls.push([name, ...args]); };
  }
  return { context, calls };
}

/** 模擬瀏覽器事件：target 是巢狀子元素，closest 沿用「最近的 [data-action^=stockout-]」語意。 */
function eventFor(type, action, dataset = {}, extra = {}) {
  const el = { dataset: { action, ...dataset }, disabled: !!extra.disabled, value: extra.value };
  return { type, key: extra.key, target: { closest: selector => { assert.strictEqual(selector, '[data-action^="stockout-"]'); return action ? el : null; } } };
}

const { context, calls } = makeContext();
const dispatch = (...args) => context.handleStockoutEvent(eventFor(...args));

// 每個 click action 都導向對應函式，id 轉成數字
const clickCases = [
  ['stockout-edit', 'openEditStockoutModal', [7]], ['stockout-return', 'returnStockout', [7]],
  ['stockout-delete', 'deleteStockoutRecord', [7]], ['stockout-edit-return', 'openEditStockoutReturnModal', [7]],
  ['stockout-delete-return', 'deleteStockoutReturn', [7]], ['stockout-sheet', 'openStockoutSheet', [7]],
  ['stockout-search', 'renderStockOuts', []], ['stockout-clear-filters', 'clearStockoutFilters', []],
  ['stockout-new-nonstock', 'openNonStockOutModal', []], ['stockout-export', 'openStockoutExportDialog', []],
];
for (const [action, fn, args] of clickCases) {
  calls.length = 0;
  assert.strictEqual(dispatch('click', action, { id: '7' }), true, action);
  assert.deepStrictEqual(calls, [[fn, ...args]], action);
}

// 篩選：日期走 change、關鍵字走 input 並只記錄；Enter 才查詢；其他事件/按鍵不誤觸
calls.length = 0;
dispatch('change', 'stockout-filter', { filter: 'from' }, { value: '2026-09-01' });
dispatch('change', 'stockout-filter', { filter: 'to' }, { value: '2026-09-30' });
dispatch('input', 'stockout-filter', { filter: 'search' }, { value: 'abc' });
dispatch('keydown', 'stockout-filter', { filter: 'search' }, { key: 'Enter' });
assert.deepStrictEqual(calls, [
  ['setStockoutFilter', 'from', '2026-09-01'], ['setStockoutFilter', 'to', '2026-09-30'],
  ['setStockoutFilter', 'search', 'abc'], ['renderStockOuts'],
]);
calls.length = 0;
dispatch('keydown', 'stockout-filter', { filter: 'search' }, { key: 'a' });
dispatch('input', 'stockout-filter', { filter: 'from' }, { value: 'x' });
dispatch('change', 'stockout-filter', { filter: 'search' }, { value: 'x' });
assert.strictEqual(dispatch('click', 'stockout-filter', { filter: 'from' }), false, 'filter 不回應 click');
assert.deepStrictEqual(calls, [], '非對應事件 / 非 Enter 不得觸發');

// disabled、非 stockout action、沒有 action 的目標都不處理
assert.strictEqual(dispatch('click', 'stockout-edit', { id: '7' }, { disabled: true }), false);
assert.strictEqual(dispatch('click', 'stockout-unknown', { id: '7' }), false);
assert.strictEqual(dispatch('click', null), false);
assert.strictEqual(context.handleStockoutEvent({ type: 'click', target: {} }), false);
assert.deepStrictEqual(calls, []);

// page.js 產生的標記不含 inline handler（除了尚未遷移的照片 lightbox），且 action 都有對應 handler
const row = context.renderStockoutActions({ id: 7, reason: '', reverted_at: null }, false);
assert(!/\son(click|change|input|keydown)=/.test(row));
for (const action of row.match(/data-action="([^"]+)"/g).map(text => text.slice(13, -1))) {
  assert(clickCases.some(([name]) => name === action), `${action} 缺少 handler`);
}
assert.strictEqual(context.renderStockoutActions({ id: 7 }, true), '', 'viewer 不顯示異動按鈕');

console.log('stockout actions runtime: PASS');
