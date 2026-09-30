// 各 feature 的 data-action 對照表（*_ACTIONS）逐一「真的點擊」一次：
// - 只把該檔 import 進來的名稱換成會記錄呼叫的替身，其餘識別字一律不存在
//   → handler 內引用了「沒有 import 的函式」（打錯名字 / 漏 import）會在這裡丟 ReferenceError，而不是等使用者點下去才發現。
//   （ESM 的 import 是否存在由 esm_link.test.js 檢查；這裡檢查的是「handler 用到的名稱都有 import」。）
// - 每個 action 依表中宣告的事件類型各觸發一次，確認被處理（handle 回傳 true）、沒有丟例外，
//   且（純 DOM 操作的 action 除外）至少呼叫了一個被 import 的函式。
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { ROOT, moduleScript } = require('./support/frontend-runtime');

const EMBEDDED_TABLE_FILES = new Set(['features/account/change-password.js', 'features/account/password-expiry.js', 'features/notifications/center.js',
  'features/quotation/page.js', 'features/stocktake/page.js', 'core/units.js', 'components/status-list.js', 'features/inventory/photo.js']);
const FILES = [
  'core/ui-actions.js',
  'features/calendar/actions.js',
  'features/inventory/dispatch.js',
  'features/kits/actions.js',
  'features/permissions/actions.js',
  'features/petty-cash/actions.js',
  'features/prepared/actions.js',
  'features/settings/actions.js',
  'features/stockout/actions.js',
  'features/work-progress/actions.js',
  // 表格放在頁面模組裡的 delegate（該檔自己宣告的函式也換成替身：這裡只驗證 handler 呼叫到了它們）
  'features/account/change-password.js',
  'features/account/password-expiry.js',
  'features/notifications/center.js',
  'features/quotation/page.js',
  'features/stocktake/page.js',
  'core/units.js',
  'components/status-list.js',
  'features/inventory/photo.js',
];

// 只操作 DOM / 瀏覽器 API、不呼叫 import 函式的 action（或 'action:事件類型'）
const DOM_ONLY = new Set([
  'ui-goto', 'settings-unit-group-toggle', 'pc-noop', 'pc-type-overlay-close', 'pc-collapse-toggle', 'wpr-scroll-history',
  'wpr-pick-album', 'wpr-pick-camera',
  'photo-lightbox:error', 'photo-lightbox:load',   // 縮圖載入失敗 / 成功時的備援切換（只動 DOM）
  'cal-jump-date:keydown',   // Enter / 空白鍵只是轉成 el.click()（click 那條會呼叫 calJumpToDate）
]);

// 依 data-* 值分支的 action：每個分支各點一次
const REPORT_OPS = ['detail', 'export', 'edit-report', 'edit-engineering', 'delete'].map(op => ({ op }));
const VARIANTS = {
  'pc-report-op': REPORT_OPS,
  'pc-menu-op': REPORT_OPS,
  'pc-type-choose': [{ type: 'general' }, { type: 'engineering' }],
  'eng-name-select': [{ kind: 'category' }, { kind: 'group' }],
  'stockout-filter': [{ filter: 'search' }, { filter: 'from' }],   // input / keydown 只處理 search，change 只處理日期
  'settings-gcal-key-open': [{}, { id: '7' }],
  'photo-lightbox': [{ fallback: 'hide' }, { fallback: 'sibling' }],
};

/** 取出檔案 import 的所有具名成員（含跨行的 import { … }）。 */
function importedNames(source) {
  const names = [];
  for (const match of source.matchAll(/^import\s*\{([^}]*)\}\s*from\s*'[^']+';/gm)) {
    for (const part of match[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop();
      if (name) names.push(name);
    }
  }
  return names;
}

/** dataset：任何 data-* 都回傳 '1'，action 保持指定名稱（handler 會依 Number(...) / 字串使用）。 */
function fakeElement(action, overrides = {}) {
  const dataset = new Proxy({ action, ...overrides }, { get: (target, key) => (key in target ? target[key] : '1') });
  const classList = { toggle() {}, add() {}, remove() {} };
  const element = {
    dataset, disabled: false, value: '1', checked: true, files: [], classList, style: {},
    parentElement: { classList }, nextElementSibling: { hidden: false },
    click() {}, remove() {}, closest: () => null,
  };
  element.self = element;
  return element;
}

let total = 0;
for (const file of FILES) {
  const source = fs.readFileSync(path.join(ROOT, 'static/js', file), 'utf8');
  const calls = [];
  const context = {
    console,
    location: {},
    confirm: () => true,
    document: {
      getElementById: () => ({ click() {}, remove() {}, scrollIntoView() {}, value: '', hidden: false, classList: { toggle() {}, add() {}, remove() {} } }),
      addEventListener() {},
    },
  };
  for (const name of importedNames(source)) context[name] = (...args) => { calls.push(name); return undefined; };
  vm.createContext(context);
  vm.runInContext(moduleScript(file), context, { filename: file });
  if (EMBEDDED_TABLE_FILES.has(file)) {
    for (const match of source.matchAll(/^(?:export )?(?:async )?function (\w+)\(/gm)) context[match[1]] = (...args) => { calls.push(match[1]); return undefined; };
  }

  const handlerName = (source.match(/export (?:const|function) (handle\w*Event)\b/) || [])[1];
  assert(handlerName, `${file}: 需要 export handleXxxEvent（測試入口）`);
  const tableNames = [...source.matchAll(/^const (\w+_ACTIONS) = \{/gm)].map(match => match[1]);
  assert(tableNames.length, `${file}: 找不到 *_ACTIONS 對照表`);

  for (const tableName of tableNames) {
    const table = vm.runInContext(tableName, context);
    for (const [action, handlers] of Object.entries(table)) {
      for (const type of Object.keys(handlers)) {
        let called = 0;
        for (const variant of (VARIANTS[action] || [{}])) {
          calls.length = 0;
          const el = fakeElement(action, variant);
          const event = { type, key: type === 'keydown' ? 'Enter' : undefined, preventDefault() {}, stopPropagation() {}, target: { tagName: 'BUTTON', closest: () => el } };
          // 背景點擊類 action 要求 event.target === el；其他 action 不看
          if (/backdrop/.test(action)) { event.target = el; event.target.closest = () => el; }
          let handled;
          try {
            handled = context[handlerName](event);
          } catch (error) {
            throw new Error(`${file}: ${action} (${type}) 執行失敗：${error.message}`);
          }
          assert.strictEqual(handled, true, `${file}: ${action} (${type}) 沒有被處理`);
          called += calls.length;
          total += 1;
        }
        // 同一個 action 的各個 data-* 分支合計至少呼叫一次 import 的函式（純 DOM 操作的 action 除外）
        if (!DOM_ONLY.has(action) && !DOM_ONLY.has(`${action}:${type}`)) assert(called >= 1, `${file}: ${action} (${type}) 沒有呼叫任何 import 的函式`);
      }
    }
  }
}

console.log(`action tables runtime: PASS (${total} action/event handlers exercised)`);
