const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

function load(files, context) {
  for (const file of files) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), context, { filename: file });
  }
}

function testDesktopReturnActionUsesDeleteHandler() {
  const context = vm.createContext({ console });
  load(['static/js/render/stockout.js'], context);

  const html = context.renderStockoutActions({
    id: 7,
    reason: '退回已領出',
    reverted_at: null,
  }, false);

  assert(html.includes('deleteStockoutReturn(7)'));
  assert(!html.includes('revokeStockoutReturn'));
}

async function testReturnActionUsesDeleteEndpointAndRefreshes() {
  const calls = [];
  let refreshed = 0;
  let sheetActions = null;
  const context = vm.createContext({
    console,
    confirm: () => true,
    hasPerm: () => true,
    toast: () => {},
    renderStockOuts: () => { refreshed += 1; },
    openSheet: (_title, actions) => { sheetActions = actions; },
    fetch: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, json: async () => ({}) };
    },
    stockoutRecords: [{ id: 7, brand: 'B', item_name: 'Returned', reason: '退回已領出', reverted_at: null }],
  });
  load(['static/js/modals/stockout.js', 'static/js/render/stockout.js'], context);
  context.renderStockOuts = () => { refreshed += 1; };

  context.openStockoutSheet(7);
  const revoke = sheetActions.find(action => action.label === '撤銷退回');
  assert(revoke, 'return record should expose 撤銷退回 action');
  await revoke.fn();

  assert.strictEqual(JSON.stringify(calls), JSON.stringify([{
    url: '/api/stockout-returns/7',
    options: { method: 'DELETE' },
  }]));
  assert.strictEqual(refreshed, 1, 'successful return deletion should refresh stockout records');
}

async function testPreparedOnlyItemCanSubmitPreparedOut() {
  const calls = [];
  let refreshed = 0;
  const elements = {
    'po-item-name': { value: '' },
    'po-item-prepared': { value: '' },
    'po-qty': { value: '2' },
    'po-dest': { value: 'Customer' },
  };
  const context = vm.createContext({
    console,
    ALL_ITEMS: [],
    preparedItems: [{ id: 42, name: 'Prepared only', brand: 'PB', prepared_qty: 5, unit: '箱' }],
    document: { getElementById: id => elements[id] },
    qtyInputOrToast: () => 2,
    closeModalForce: () => {},
    openModal: () => {},
    toast: () => {},
    loadData: async () => { refreshed += 1; },
    fetch: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, json: async () => ({}) };
    },
  });
  load(['static/js/modals/stockout.js'], context);

  context.openPreparedOutModal(42);
  assert.strictEqual(elements['po-item-name'].value, 'Prepared only (PB)');
  elements['po-qty'].value = '2';
  elements['po-dest'].value = 'Customer';
  await (context.submitPreparedOut());

  assert.strictEqual(calls.length, 1, `prepared-only submit should issue one request; calls=${JSON.stringify(calls)}; fields=${JSON.stringify(elements)}`);
  assert.strictEqual(calls[0].url, '/api/items/42/prepared-out');
  assert.strictEqual(JSON.stringify(JSON.parse(calls[0].options.body)), JSON.stringify({ qty: 2, note: 'Customer' }));
  assert.strictEqual(refreshed, 1, 'successful prepared-only submit should refresh data');
}

(async () => {
  const selected = process.argv[2] || 'all';
  if (selected === 'c003' || selected === 'all') {
    testDesktopReturnActionUsesDeleteHandler();
    await testReturnActionUsesDeleteEndpointAndRefreshes();
  }
  if (selected === 'c004' || selected === 'all') await testPreparedOnlyItemCanSubmitPreparedOut();
  console.log('PR1 defect runtime regressions: PASS');
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
