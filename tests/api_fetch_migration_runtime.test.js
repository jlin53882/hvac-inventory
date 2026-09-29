// issue #39 第 1 項：settings.js / units.js / modals/gcal-key.js / perms.js 改用 apiFetch 後，
// 以正式函式驗證：請求（路徑 / method / body）不變、成功流程照舊、錯誤訊息經 apiErrorMessage 且保留各自的 fallback。
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const { installApiClient, extractFunction } = require('./support/frontend-runtime');


const read = path => fs.readFileSync(path, 'utf8');
const settings = read('static/js/settings.js');
const units = read('static/js/units.js');
const gcalKey = read('static/js/modals/gcal-key.js');

const jsonResponse = (payload, status = 200) => new Response(JSON.stringify(payload), {
  status, headers: { 'Content-Type': 'application/json' },
});
const htmlError = () => new Response('<html>502 Bad Gateway</html>', { status: 502, headers: { 'Content-Type': 'text/html' } });
const structured = [{ loc: ['body', 'name'], type: 'string_too_long', ctx: { max_length: 20 } }];

function makeContext() {
  const inputs = {};
  const calls = { fetch: [], toast: [], render: 0 };
  const context = {
    console: { error() {}, warn() {}, log() {} },
    calls,
    inputs,
    confirm: () => true,
    setTimeout: () => 0,
    document: {
      getElementById: id => (inputs[id] = inputs[id] || { value: '', files: [] }),
      querySelector: () => ({ textContent: '' }),
      querySelectorAll: () => [],
    },
    toast: (message, type) => calls.toast.push([message, type]),
    renderUnitsPanel: () => { calls.render += 1; },
    renderGcalPanel: () => {},
    renderCabinetTable: () => {},
    refreshGcalSyncData: async () => {},
    loadGcalKeys: async () => {},
    closeGcalKeyModal: () => {},
    closeModalForce: () => {},
    unitList: [], unitListActive: [], orphanItems: [], gcalKeys: [], gcalUsers: [], gcalSettings: {},
    cabinetList: [], selectedKeyId: null, currentEditCabinetId: 3, _gcalEditingId: null,
    next: null,
  };
  context.fetch = async (url, init = {}) => {
    calls.fetch.push({ url, method: init.method || 'GET', body: init.body });
    const next = context.next;
    return typeof next === 'function' ? next(url, init) : next;
  };
  vm.createContext(context);
  installApiClient(context);
  for (const name of ['loadUnits']) vm.runInContext(extractFunction(units, name), context);
  for (const name of ['submitGcalKey']) vm.runInContext(extractFunction(gcalKey, name), context);
  for (const name of [
    'loadPettyOptions', 'loadOrphans', 'addUnitFromSettings', 'setUnitQtyType', 'toggleUnit', 'moveUnit',
    'consolidateGroup', 'loadGcalQueue', 'saveGcalSetting', 'retrySyncQueue', 'toggleGcalKey', 'deleteGcalKey',
    'bindGcalUser', 'loadCabinets', 'addCabinet', 'deleteCabinet', 'submitCabinetEdit',
  ]) vm.runInContext(extractFunction(settings, name), context);
  // 被測函式互相呼叫的載入器保持正式實作；以下只換掉會觸發其他請求的重新載入
  vm.runInContext('pettyOptionCache = { general: { category: [], group: [] }, engineering: { category: [], group: [] } };', context);
  return context;
}

const lastToast = context => context.calls.toast[context.calls.toast.length - 1];
// vm 內的值轉成本 realm 的普通值再比較
const value = (context, code) => JSON.parse(vm.runInContext(`JSON.stringify(${code})`, context));

// 每個寫入動作：請求契約 + 成功訊息 + 三種失敗（結構化 422 / 非 JSON 錯誤頁 / 網路錯誤）
const WRITE_CASES = [
  {
    name: 'addUnitFromSettings', call: 'addUnitFromSettings()', fallback: '新增失敗',
    setup: c => { c.inputs['u-new-name'] = { value: '顆' }; c.inputs['u-new-type'] = { value: 'integer' }; },
    request: { url: '/api/units', method: 'POST', body: { name: '顆', qty_type: 'integer' } },
    ok: { id: 9, name: '顆', is_active: true }, success: '✅ 單位「顆」已新增',
  },
  {
    name: 'setUnitQtyType', call: "setUnitQtyType(4, 'decimal')", fallback: '操作失敗', rerenderOnError: true,
    request: { url: '/api/units/4', method: 'PUT', body: { qty_type: 'decimal' } },
    ok: { ok: true }, success: '✅ 數量類型已更新',
  },
  {
    name: 'toggleUnit', call: 'toggleUnit(4, true)', fallback: '操作失敗', rerenderOnError: true,
    request: { url: '/api/units/4', method: 'PUT', body: { is_active: true } },
    ok: { ok: true }, success: '✅ 已啟用',
  },
  {
    name: 'consolidateGroup', call: 'consolidateGroup(__btn)', fallback: '收編失敗',
    setup: c => {
      c.__btn = { dataset: { from: '罐裝' }, closest: () => ({ querySelector: () => ({ value: '罐' }) }) };
      vm.runInContext('loadUnits = async () => {}; loadOrphans = async () => {};', c);
    },
    request: { url: '/api/units/consolidate', method: 'POST', body: { from_unit: '罐裝', to_unit: '罐' } },
    ok: { affected: 3 }, success: '✅ 已收編 3 筆為「罐」',
  },
  {
    name: 'saveGcalSetting', call: "saveGcalSetting('sync_days', 30)", fallback: '儲存失敗',
    request: { url: '/api/gcal-sync-settings', method: 'PUT', body: { sync_days: 30 } },
    ok: { ok: true }, success: '✅ 已儲存，受影響事件已重新評估',
  },
  {
    name: 'retrySyncQueue', call: 'retrySyncQueue(5, 2)', fallback: '重新嘗試失敗',
    request: { url: '/api/gcal-sync-queue/reset?appt_id=5&key_id=2', method: 'PUT' },
    ok: { ok: true }, success: '✅ 已重設指定同步項目',
  },
  {
    name: 'toggleGcalKey', call: 'toggleGcalKey(2, false)', fallback: '操作失敗',
    request: { url: '/api/gcal-keys/2', method: 'PUT', body: { is_active: false } },
    ok: { ok: true }, success: '已停用',
  },
  {
    name: 'bindGcalUser', call: "bindGcalUser(8, '公司主帳號')", fallback: '綁定失敗',
    request: { url: '/api/users/8', method: 'PUT', body: { gcal_key: '公司主帳號' } },
    ok: { ok: true }, success: '✅ 已綁定',
  },
  {
    name: 'addCabinet', call: 'addCabinet()', fallback: '新增失敗', prefix: '⚠️ ',
    setup: c => { c.inputs['cabinet-name'] = { value: 'A櫃' }; c.inputs['cabinet-note'] = { value: '' }; },
    request: { url: '/api/cabinets', method: 'POST', body: { name: 'A櫃', note: '' } },
    ok: { id: 1, name: 'A櫃' }, success: '✅ 已新增櫃子「A櫃」',
  },
  {
    name: 'deleteCabinet', call: 'deleteCabinet(1)', fallback: '刪除失敗', prefix: '⚠️ ',
    setup: c => { vm.runInContext("cabinetList = [{ id: 1, name: 'A櫃' }];", c); },
    request: { url: '/api/cabinets/1', method: 'DELETE' },
    ok: null, success: '✅ 已刪除櫃子',
  },
  {
    name: 'submitCabinetEdit', call: 'submitCabinetEdit()', fallback: '編輯失敗', prefix: '⚠️ ',
    setup: c => { c.inputs['edit-cabinet-name'] = { value: 'B櫃' }; c.inputs['edit-cabinet-note'] = { value: '後排' }; },
    request: { url: '/api/cabinets/3', method: 'PUT', body: { name: 'B櫃', note: '後排' } },
    ok: { id: 3, name: 'B櫃' }, success: '✅ 已編輯櫃子「B櫃」',
  },
  {
    name: 'submitGcalKey', call: 'submitGcalKey()', fallback: '儲存失敗',
    setup: c => {
      c.inputs['gk-name'] = { value: '新 Key' }; c.inputs['gk-cred'] = { value: '/keys/a.json' };
      c.inputs['gk-cal'] = { value: 'cal@group' }; c.inputs['gk-file'] = { files: [] };
      c.FormData = class { constructor() { this.entries = []; } append(k, v) { this.entries.push([k, v]); } };
    },
    request: { url: '/api/gcal-keys', method: 'POST' },
    ok: { id: 5 }, success: '✅ 已新增',
  },
];

async function run(context, call) {
  await vm.runInContext(call, context);
}

(async () => {
  for (const spec of WRITE_CASES) {
    const scenarios = [
      ['success', () => (spec.ok === null ? new Response(null, { status: 204 }) : jsonResponse(spec.ok)), spec.success],
      ['422', () => jsonResponse({ detail: structured }, 422), '「名稱」不可超過 20 個字'],
      ['502 html', htmlError, spec.fallback],
      ['network', () => Promise.reject(new TypeError('Failed to fetch')), spec.fallback],
    ];
    for (const [label, next, expected] of scenarios) {
      const context = makeContext();
      if (spec.setup) spec.setup(context);
      context.next = next;
      await run(context, spec.call);
      const request = context.calls.fetch[0];
      assert.ok(request, `${spec.name} ${label}: no request sent`);
      assert.strictEqual(request.url, spec.request.url, `${spec.name} url`);
      assert.strictEqual(request.method, spec.request.method, `${spec.name} method`);
      if (spec.request.body) assert.deepStrictEqual(JSON.parse(request.body), spec.request.body, `${spec.name} body`);
      const message = (label === 'success' ? '' : spec.prefix || '') + expected;
      assert.strictEqual(lastToast(context)[0], message, `${spec.name} ${label} toast`);
      assert.strictEqual(typeof lastToast(context)[0], 'string');
      if (label !== 'success') assert.strictEqual(lastToast(context)[1], 'error', `${spec.name} ${label} toast type`);
      if (label !== 'success' && spec.rerenderOnError) {
        assert.ok(context.calls.render >= 1, `${spec.name} ${label} must re-render to restore the control`);
      }
    }
  }

  // 刪除 Google 行事曆 Key：字串 detail 原文、409 物件 detail 顯示專屬說明、網路錯誤加「刪除失敗」前綴
  const gcalDelete = async next => {
    const context = makeContext();
    vm.runInContext("gcalKeys = [{ id: 2, name: '公司主帳號' }];", context);
    context.next = next;
    await run(context, 'deleteGcalKey(2)');
    assert.deepStrictEqual(context.calls.fetch.map(r => [r.url, r.method]), [['/api/gcal-keys/2', 'DELETE']]);
    return context;
  };
  let ctx = await gcalDelete(() => jsonResponse({ ok: true, google_deleted: 2, google_failed: 0 }));
  assert.deepStrictEqual(lastToast(ctx), ['✅ Key「公司主帳號」已刪除（Google 事件 2 筆已清除）', 'success']);
  assert.strictEqual(vm.runInContext('gcalKeys.length', ctx), 0);
  ctx = await gcalDelete(() => jsonResponse({ detail: 'Google 行事曆同步正在處理這個 Key，請稍後再試' }, 503));
  assert.deepStrictEqual(lastToast(ctx), ['Google 行事曆同步正在處理這個 Key，請稍後再試', 'error']);
  ctx = await gcalDelete(() => jsonResponse({ detail: { ok: false, key_deleted: false, google_deleted: 1, google_failed: 2 } }, 409));
  assert.deepStrictEqual(lastToast(ctx), ['Google 事件刪除未完成，Key 與同步問題已保留，請先處理同步清單', 'error']);
  assert.strictEqual(vm.runInContext('gcalKeys.length', ctx), 1, 'failed delete must keep the key');
  ctx = await gcalDelete(htmlError);
  assert.deepStrictEqual(lastToast(ctx), ['Google 事件刪除未完成，Key 與同步問題已保留，請先處理同步清單', 'error']);
  ctx = await gcalDelete(() => Promise.reject(new TypeError('Failed to fetch')));
  assert.deepStrictEqual(lastToast(ctx), ['❌ 刪除失敗：網路連線失敗，請稍後再試', 'error']);

  // 載入器：成功寫入狀態；失敗保留原值（或標記載入失敗），不跳 toast
  ctx = makeContext();
  ctx.next = () => jsonResponse([{ id: 1, name: '個', is_active: true }, { id: 2, name: '舊', is_active: false }]);
  await run(ctx, 'loadUnits()');
  assert.deepStrictEqual(value(ctx, 'unitListActive.map(u => u.name)'), ['個']);
  ctx.next = htmlError;
  await run(ctx, 'loadUnits()');
  assert.strictEqual(vm.runInContext('unitList.length', ctx), 2, 'failed reload keeps the previous unit list');

  ctx = makeContext();
  ctx.next = () => jsonResponse([{ item_id: 1, unit: '罐裝' }]);
  await run(ctx, 'loadOrphans()');
  assert.strictEqual(vm.runInContext('orphanItems.length', ctx), 1);
  ctx.next = htmlError;
  vm.runInContext('orphanLoadFailed = false;', ctx);
  await run(ctx, 'loadOrphans()');
  assert.strictEqual(vm.runInContext('orphanLoadFailed', ctx), true);

  ctx = makeContext();
  ctx.next = url => jsonResponse({ items: [{ id: 1, name: url.includes('engineering') ? '工程' : '一般' }] });
  await run(ctx, 'loadPettyOptions()');
  assert.deepStrictEqual(ctx.calls.fetch.map(r => r.url), [
    '/api/petty-cash-options?report_type=general&option_type=category',
    '/api/petty-cash-options?report_type=general&option_type=group',
    '/api/petty-cash-options?report_type=engineering&option_type=category',
    '/api/petty-cash-options?report_type=engineering&option_type=group',
  ]);
  assert.strictEqual(vm.runInContext('pettyOptionCache.engineering.group[0].name', ctx), '工程');
  ctx.next = htmlError;
  await run(ctx, 'loadPettyOptions()');
  assert.strictEqual(vm.runInContext('pettyOptionCache.general.category[0].name', ctx), '一般', 'failed reload keeps the cache');

  ctx = makeContext();
  ctx.next = () => jsonResponse({ items: [{ appointment_id: 1 }] });
  await run(ctx, 'loadGcalQueue()');
  assert.strictEqual(vm.runInContext('gcalQueueItems.length', ctx), 1);

  // 刪除櫃子：仍被位置使用時後端回 409，需顯示原因
  ctx = makeContext();
  vm.runInContext("cabinetList = [{ id: 1, name: 'A櫃' }];", ctx);
  ctx.next = () => jsonResponse({ detail: '櫃子「A櫃」仍有 2 筆庫存位置使用，無法刪除' }, 409);
  await run(ctx, 'deleteCabinet(1)');
  assert.deepStrictEqual(lastToast(ctx), ['⚠️ 櫃子「A櫃」仍有 2 筆庫存位置使用，無法刪除', 'error']);
  assert.strictEqual(value(ctx, 'cabinetList.length'), 1, 'failed delete keeps the cabinet');

  ctx = makeContext();
  ctx.next = htmlError;
  await run(ctx, 'loadCabinets()');
  assert.deepStrictEqual(lastToast(ctx), ['⚠️ 查詢櫃子清單失敗', 'error']);

  // 排序：成功後重新載入單位；失敗顯示訊息
  ctx = makeContext();
  vm.runInContext("unitList = [{ id: 4, sort_order: 2 }];", ctx);
  ctx.next = url => (url === '/api/units' ? jsonResponse([{ id: 4, sort_order: 1 }]) : jsonResponse({ ok: true }));
  await run(ctx, 'moveUnit(4, -1)');
  assert.deepStrictEqual(ctx.calls.fetch.map(r => [r.url, r.method]), [['/api/units/4', 'PUT'], ['/api/units', 'GET']]);
  assert.deepStrictEqual(JSON.parse(ctx.calls.fetch[0].body), { sort_order: 1 });
  ctx = makeContext();
  vm.runInContext("unitList = [{ id: 4, sort_order: 2 }];", ctx);
  ctx.next = () => Promise.reject(new TypeError('Failed to fetch'));
  await run(ctx, 'moveUnit(4, 1)');
  assert.deepStrictEqual(lastToast(ctx), ['排序失敗', 'error']);

  console.log('apiFetch migration runtime: PASS');
})().catch(error => { console.error(error); process.exit(1); });
