// core/actions.js 的 createActionDelegate：前綴隔離、巢狀子元素（closest）、disabled、事件類型、動態插入的 HTML。
const assert = require('assert');
const vm = require('vm');
const { loadModules } = require('./support/frontend-runtime');

const context = vm.createContext({ document: { addEventListener: (type, fn) => { context.listeners.push([type, fn]); } }, listeners: [] });
loadModules(context, 'core/actions.js');

const calls = [];
const delegate = context.createActionDelegate('demo-', {
  'demo-save': { click: el => calls.push(['save', el.dataset.id]) },
  'demo-field': {
    change: el => calls.push(['change', el.value]),
    input: el => calls.push(['input', el.value]),
    keydown: (el, event) => calls.push(['keydown', event.key]),
    focusin: () => calls.push(['focusin']),
  },
});

/** 模擬 DOM：closest 只回傳符合前綴選擇器的祖先（沒有就回 null）。 */
function event(type, el, extra = {}) {
  return { type, ...extra, target: { closest: selector => { assert.strictEqual(selector, '[data-action^="demo-"]'); return el; } } };
}
const button = (action, extra = {}) => ({ dataset: { action, id: '5' }, disabled: false, ...extra });

// action 分派：巢狀子元素點擊由 closest 找到最近的 action
assert.strictEqual(delegate.handle(event('click', button('demo-save'))), true);
assert.deepStrictEqual(calls.pop(), ['save', '5']);

// disabled 不觸發
assert.strictEqual(delegate.handle(event('click', button('demo-save', { disabled: true }))), false);
assert.deepStrictEqual(calls, []);

// 事件類型不符 / 未登記的 action / 沒有 action 目標 / target 不支援 closest 都不處理
assert.strictEqual(delegate.handle(event('change', button('demo-save'))), false);
assert.strictEqual(delegate.handle(event('click', button('demo-unknown'))), false);
assert.strictEqual(delegate.handle(event('click', null)), false);
assert.strictEqual(delegate.handle({ type: 'click', target: {} }), false);
assert.deepStrictEqual(calls, []);

// 同一個 action 依事件類型分派不同 handler
const field = { dataset: { action: 'demo-field' }, disabled: false, value: 'v' };
for (const type of ['change', 'input', 'focusin']) delegate.handle(event(type, field));
delegate.handle(event('keydown', field, { key: 'Enter' }));
assert.deepStrictEqual(calls, [['change', 'v'], ['input', 'v'], ['focusin'], ['keydown', 'Enter']]);

// init 在 document 註冊 click / change / input / keydown / focusin（委派：之後動態插入的 HTML 不必重新綁定）
delegate.init();
assert.deepStrictEqual(context.listeners.map(([type]) => type).sort(), ['change', 'click', 'focusin', 'input', 'keydown']);
assert(context.listeners.every(([, fn]) => fn === delegate.handle));

console.log('action delegate runtime: PASS');
