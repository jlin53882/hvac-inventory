const assert = require('assert');
const vm = require('vm');
const { installApiClient, installNamespaces, loadModules, mockResponse, seedReadModels } = require('./support/frontend-runtime');

function load(files, context) {
  installApiClient(context);
  installNamespaces(context, 'Stockout');
  context.unitList = [];
  loadModules(context, 'core/qty.js', 'features/stockout/state.js', ...files);
}

/**
 * Build the delegated click event the browser would dispatch for the generated delete-return button.
 * @param {string} html Rendered desktop action markup.
 * @returns {object} Event-like object accepted by handleStockoutEvent.
 */
function extractDeleteReturnEvent(html) {
  const match = html.match(/data-action="(stockout-delete-return)" data-id="(7)"/);
  assert(match, 'desktop markup should contain a generated delete-return action');
  return { type: 'click', target: { closest: () => ({ dataset: { action: match[1], id: match[2] }, disabled: false }) } };
}

/**
 * Prove the desktop delegated action executes the production delete handler.
 * @returns {Promise<void>} Resolves after the generated handler completes.
 */
async function testDesktopDelegatedReturnDeleteExecutesHandler() {
  const calls = [];
  let refreshed = 0;
  let destinationsRefreshed = 0;
  const context = vm.createContext({
    console,
    confirm: () => true,
    hasPerm: () => true,
    toast: () => {},
    refreshDestinationsAfterMutation: async () => { destinationsRefreshed += 1; },
    renderStockOuts: () => { refreshed += 1; },
    fetch: async (url, options) => {
      calls.push({ url, options });
      return mockResponse(({}));
    },
  });
  load(['features/stockout/modals.js', 'features/stockout/page.js', 'features/stockout/sheet.js', 'features/stockout/actions.js'], context);
  context.renderStockOuts = () => { refreshed += 1; };

  const html = context.renderStockoutActions({
    id: 7,
    reason: '退回已領出',
    reverted_at: null,
  }, false);
  assert(!html.includes('revokeStockoutReturn'));
  assert(!html.includes('onclick='), 'desktop actions must not use inline handlers');

  assert.strictEqual(context.handleStockoutEvent(extractDeleteReturnEvent(html)), true);
  for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 0));

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].url, '/api/stockout-returns/7');
  assert.strictEqual(calls[0].options.method, 'DELETE');
  assert.strictEqual(refreshed, 1, 'desktop delegated delete should refresh exactly once');
  assert.strictEqual(destinationsRefreshed, 1, 'desktop delegated delete should refresh destination suggestions');
}

/**
 * Prove the production mobile sheet action reaches the same delete handler.
 * @returns {Promise<void>} Resolves after the generated sheet action completes.
 */
async function testMobileReturnDeleteExecutesHandler() {
  const calls = [];
  let refreshed = 0;
  let destinationsRefreshed = 0;
  let sheetActions = null;
  const context = vm.createContext({
    console,
    confirm: () => true,
    hasPerm: () => true,
    toast: () => {},
    refreshDestinationsAfterMutation: async () => { destinationsRefreshed += 1; },
    renderStockOuts: () => { refreshed += 1; },
    openSheet: (_title, actions) => { sheetActions = actions; },
    fetch: async (url, options) => {
      calls.push({ url, options });
      return mockResponse(({}));
    },
  });
  load(['features/stockout/modals.js', 'features/stockout/page.js', 'features/stockout/sheet.js'], context);
  context.stockoutState.stockoutRecords = [{ id: 7, brand: 'B', item_name: 'Returned', reason: '退回已領出', reverted_at: null }];
  context.renderStockOuts = () => { refreshed += 1; };

  context.openStockoutSheet(7);
  const deleteAction = sheetActions.find(action => action.label === '撤銷退回');
  assert(deleteAction, 'return record should expose 撤銷退回 action');
  await deleteAction.fn();

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].url, '/api/stockout-returns/7');
  assert.strictEqual(calls[0].options.method, 'DELETE');
  assert.strictEqual(refreshed, 1, 'mobile return deletion should refresh exactly once');
  assert.strictEqual(destinationsRefreshed, 1, 'mobile return deletion should refresh destination suggestions');
}

/**
 * Prove a failed production delete emits an error without refreshing.
 * @returns {Promise<void>} Resolves after the production error path completes.
 */
async function testReturnDeleteFailureDoesNotRefresh() {
  const calls = [];
  const toasts = [];
  let refreshed = 0;
  const context = vm.createContext({
    console,
    confirm: () => true,
    toast: (message, type) => { toasts.push({ message, type }); },
    apiErrorMessage: value => value,
    renderStockOuts: () => { refreshed += 1; },
    fetch: async (url, options) => {
      calls.push({ url, options });
      return mockResponse(({ detail: '刪除失敗測試' }), 400);
    },
  });
  load(['features/stockout/modals.js'], context);
  context.renderStockOuts = () => { refreshed += 1; };

  await context.deleteStockoutReturn(7);

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].url, '/api/stockout-returns/7');
  assert.strictEqual(calls[0].options.method, 'DELETE');
  assert.deepStrictEqual(toasts, [{ message: '⚠️ 刪除失敗測試', type: 'error' }]);
  assert.strictEqual(refreshed, 0, 'failed return deletion must not refresh stockout records');
}

async function testPreparedOnlyItemCanSubmitPreparedOut() {
  const calls = [];
  let refreshed = 0;
  const elements = {
    'po-item-name': { value: '' },
    'po-item-prepared': { value: '' },
    'po-qty': { value: '2' },
    'po-dest': { value: 'Customer' },
    'po-datetime': { value: '' },
  };
  const context = vm.createContext({
    console,
    document: { getElementById: id => elements[id] },
    qtyInputOrToast: () => 2,
    closeModalForce: () => {},
    openModal: () => {},
    toast: () => {},
    loadData: async () => { refreshed += 1; },
    fetch: async (url, options) => {
      calls.push({ url, options });
      return mockResponse(({}));
    },
  });
  load(['features/stockout/modals.js'], context);
  seedReadModels(context, { allItems: [], preparedItems: [{ id: 42, name: 'Prepared only', brand: 'PB', prepared_qty: 5, unit: '箱' }] });

  context.openPreparedOutModal(42);
  assert.strictEqual(elements['po-item-name'].value, 'Prepared only (PB)');
  elements['po-qty'].value = '2';
  elements['po-dest'].value = 'Customer';
  elements['po-datetime'].value = '2026-10-20';
  await (context.submitPreparedOut());

  assert.strictEqual(calls.length, 1, `prepared-only submit should issue one request; calls=${JSON.stringify(calls)}; fields=${JSON.stringify(elements)}`);
  assert.strictEqual(calls[0].url, '/api/items/42/prepared-out');
  assert.strictEqual(JSON.stringify(JSON.parse(calls[0].options.body)), JSON.stringify({ qty: 2, note: 'Customer', created_at: '2026-10-20 00:00:00' }));
  assert.strictEqual(refreshed, 1, 'successful prepared-only submit should refresh data');
}

async function testDirectStockoutDatePayload() {
  const calls = [];
  let refreshed = 0;
  const elements = {
    'o-qty': { value: '2' },
    'o-dest': { value: 'Customer' },
    'o-note': { value: '' },
    'o-location': { value: '' },
    'o-datetime': { value: '2026-10-21' },
  };
  const context = vm.createContext({
    console,
    document: { getElementById: id => elements[id] },
    qtyInputOrToast: () => 2,
    closeModalForce: () => {},
    toast: () => {},
    loadData: async () => { refreshed += 1; },
    fetch: async (url, options) => {
      calls.push({ url, options });
      return mockResponse({});
    },
  });
  load(['features/stockout/modals.js'], context);
  seedReadModels(context, { allItems: [{ id: 7, name: 'Copper', qty: 10, unit: '個', stocks: [] }], preparedItems: [] });
  context.stockoutState.outItemId = 7;

  await context.submitStockOut();

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].url, '/api/stockout');
  assert.deepStrictEqual(JSON.parse(calls[0].options.body), {
    item_id: 7, qty: 2, destination: 'Customer', note: '', location: '',
    created_at: '2026-10-21 00:00:00',
  });
  assert.strictEqual(refreshed, 1);
}

async function testDirectNonStockoutDatePayload() {
  const calls = [];
  let refreshed = 0;
  const elements = {
    'ns-name': { value: 'Non-stock item' },
    'ns-code': { value: 'NS-1' },
    'ns-unit': { value: '個' },
    'ns-qty': { value: '2' },
    'ns-dest': { value: 'Customer' },
    'ns-note': { value: 'Repair' },
    'ns-datetime': { value: '2026-10-21' },
  };
  const context = vm.createContext({
    console,
    document: { getElementById: id => elements[id] },
    qtyInputOrToast: () => 2,
    closeModalForce: () => {},
    toast: () => {},
    loadData: async () => { refreshed += 1; },
    fetch: async (url, options) => {
      calls.push({ url, options });
      return mockResponse({});
    },
  });
  load(['features/stockout/modals.js'], context);

  await context.submitNonStockOut();

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].url, '/api/stockout/nonstock');
  assert.deepStrictEqual(JSON.parse(calls[0].options.body), {
    name: 'Non-stock item', code: 'NS-1', unit: '個', qty: 2,
    destination: 'Customer', note: 'Repair', created_at: '2026-10-21 00:00:00',
  });
  assert.strictEqual(refreshed, 1);
}

(async () => {
  const selected = process.argv[2] || 'all';
  if (selected === 'c003' || selected === 'all') {
    await testDesktopDelegatedReturnDeleteExecutesHandler();
    await testMobileReturnDeleteExecutesHandler();
    await testReturnDeleteFailureDoesNotRefresh();
  }
  if (selected === 'c004' || selected === 'all') await testPreparedOnlyItemCanSubmitPreparedOut();
  if (selected === 'c005' || selected === 'all') {
    await testDirectStockoutDatePayload();
    await testDirectNonStockoutDatePayload();
  }
  console.log('PR1 defect runtime regressions: PASS');
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
