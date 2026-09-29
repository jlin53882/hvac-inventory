const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const ROOT = process.cwd();
const stockoutSource = fs.readFileSync('static/js/render/stockout.js', 'utf8');
const stocktakeSource = fs.readFileSync('static/js/render/stocktake.js', 'utf8');
// 簽名報表 / 報價單上傳共用 render/upload-list.js（issue #39），各頁只帶設定
const uploadListSource = fs.readFileSync('static/js/render/upload-list.js', 'utf8');
const signedSource = uploadListSource + '\n' + fs.readFileSync('static/js/render/signed-reports.js', 'utf8');
const quotationSource = uploadListSource + '\n' + fs.readFileSync('static/js/render/quotation-upload.js', 'utf8');
const utilsSource = fs.readFileSync('static/js/utils.js', 'utf8');

function extractFunction(source, name) {
  const start = source.search(new RegExp(`(async )?function ${name}\\(`));
  assert(start >= 0, `${name} must exist`);
  let depth = 0;
  for (let i = source.indexOf(') {', start) + 2; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`${name} is not closed`);
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// text() 給 apiFetch（簽名報表 / 報價單上傳）讀取；json() 給仍直接 fetch 的頁面
function response(value, ok = true) {
  return { ok, status: ok ? 200 : 500, statusText: '', json: async () => value, text: async () => JSON.stringify(value) };
}

function element(id) {
  return {
    id,
    innerHTML: '',
    textContent: '',
    value: '',
    style: {},
    hidden: false,
    classList: { add() {}, remove() {}, toggle() {} },
    listeners: {},
    addEventListener(type) { this.listeners[type] = (this.listeners[type] || 0) + 1; },
    querySelector() { return { addEventListener() {} }; },
    querySelectorAll() { return []; },
  };
}

function baseContext(overrides = {}) {
  const elements = new Map();
  const content = element('content');
  elements.set('content', content);
  const context = {
    console: { error() {}, log() {} },
    URLSearchParams,
    currentTab: 'stockout',
    currentSite: 'office',
    currentUser: { permissions: { stocktake: false } },
    ALL_ITEMS: [],
    stocktakeKits: [],
    stockoutRecords: [],
    stockoutDateFrom: '',
    stockoutDateTo: '',
    stockoutPageSearch: '',
    document: {
      body: { dataset: { page: 'quotation-upload' } },
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, element(id));
        return elements.get(id);
      },
      querySelectorAll() { return []; },
    },
    fetch: async () => response([]),
    hasPerm() { return false; },
    esc(value) { return String(value ?? ''); },
    filterStockoutRecords(records) { return records; },
    getStockoutKpis(records) { return { recordCount: records.length, totalOutbound: 0 }; },
    renderStockoutPageHeader() { return '<stockout-header>'; },
    renderStockoutGroup() { return '<stockout-group>'; },
    isMobileView() { return false; },
    absNum(value) { return Math.abs(Number(value) || 0); },
    todayStr() { return '2026-09-21'; },
    filterBySearch(items) { return items; },
    getInventoryStatus() { return { isOutOfStock: false, isLowStock: false }; },
    stkGroupByLoc() { return ''; },
    quoteModeTabs() { return ''; },
    toast() {},
    ...overrides,
  };
  vm.createContext(context);
  for (const name of ['apiErrorMessage', 'apiFetch']) vm.runInContext(extractFunction(utilsSource, name), context);
  context._elements = elements;
  return context;
}

async function flush() {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
}

async function testStockoutTabLeaveAndLatestWins() {
  const requests = [];
  const context = baseContext({
    fetch(url) {
      const request = deferred();
      requests.push({ url, request });
      return request.promise;
    },
  });
  vm.runInContext(stockoutSource, context);

  context.renderStockOuts();
  const loading = context._elements.get('content').innerHTML;
  context.currentTab = 'inventory';
  requests[0].request.resolve(response([{ id: 1 }]));
  await flush();
  assert.strictEqual(context._elements.get('content').innerHTML, loading,
    'stockout response rendered after leaving the tab');

  context.currentTab = 'stockout';
  context.renderStockOuts();
  context.renderStockOuts();
  requests[2].request.resolve(response([{ id: 'new' }]));
  await flush();
  requests[1].request.resolve(response([{ id: 'old' }]));
  await flush();
  assert.strictEqual(context.stockoutRecords[0].id, 'new', 'stockout latest render did not win');
}

async function testStocktakeTabLeaveAndSiteSnapshot() {
  const requests = [];
  const context = baseContext({
    currentTab: 'stocktake',
    fetch(url) {
      const request = deferred();
      requests.push({ url, request });
      return request.promise;
    },
  });
  vm.runInContext(stocktakeSource, context);

  context.renderStocktake();
  const loading = context._elements.get('content').innerHTML;
  context.currentTab = 'inventory';
  requests[0].request.resolve(response([]));
  await flush();
  assert.strictEqual(context._elements.get('content').innerHTML, loading,
    'stocktake response rendered after leaving the tab');

  const siteRequests = [];
  const siteContext = baseContext({
    currentTab: 'stocktake',
    fetch(url) {
      const request = deferred();
      siteRequests.push({ url, request });
      return request.promise;
    },
  });
  vm.runInContext(stocktakeSource, siteContext);
  siteContext.renderStocktake();
  assert(siteRequests[0].url.includes('site=office'), 'stocktake dates did not snapshot office site');
  siteContext.currentSite = 'warehouse';
  siteRequests[0].request.resolve(response([]));
  await flush();
  assert.strictEqual(siteRequests.length, 1, 'stale stocktake render continued into the next site');
}

async function testStocktakeStaleKitsResponseDoesNotMutateSharedState() {
  const requests = [];
  const context = baseContext({
    currentTab: 'stocktake',
    fetch(url) {
      const request = deferred();
      requests.push({ url, request });
      return request.promise;
    },
  });
  vm.runInContext(stocktakeSource, context);

  context.renderStocktake();
  requests[0].request.resolve(response([]));
  await flush();
  assert.strictEqual(requests.length, 2, 'stocktake did not issue the kits request after dates succeeded');
  assert(requests[1].url.includes('site=office'), 'kits request did not keep the original site snapshot');

  context.stocktakeKits = [{ id: 'warehouse-current' }];
  context.currentSite = 'warehouse';
  requests[1].request.resolve(response([{ id: 'office-stale' }]));
  await flush();

  assert.deepStrictEqual(context.stocktakeKits, [{ id: 'warehouse-current' }],
    'stale kits response polluted shared stocktakeKits state');
  assert.strictEqual(context._elements.get('content').innerHTML,
    '<div class="stocktake-loading">載入盤點資料…</div>',
    'stale kits response rendered stocktake content');
}
function setupHistoryContext(source, ctl, tab, endpoint) {
  const requests = [];
  const context = baseContext({
    currentTab: tab,
    document: {
      body: { dataset: { page: 'quotation-upload' } },
      getElementById(id) {
        if (!context._elements.has(id)) context._elements.set(id, element(id));
        return context._elements.get(id);
      },
      querySelectorAll() { return []; },
    },
    fetch(url) {
      const request = deferred();
      requests.push({ url, request });
      return request.promise;
    },
  });
  vm.runInContext(source, context);
  context[ctl].state.renderSeq = 1;
  context[ctl].loadHistory(true);
  context[ctl].loadHistory(true);
  assert(requests[0].url.startsWith(endpoint), `${ctl} history endpoint changed unexpectedly`);
  return { context, requests };
}

async function testSignedReportsAbaAndHistoryRace() {
  const authA = deferred();
  const authB = deferred();
  const history = deferred();
  const context = baseContext({
    currentTab: 'signed-reports',
    fetch(url) {
      if (url === '/api/auth/me') return context._authCalls++ === 0 ? authA.promise : authB.promise;
      if (url.startsWith('/api/signed-reports?')) {
        context._historyCalls += 1;
        return history.promise;
      }
      return Promise.resolve(response({}));
    },
    _authCalls: 0,
    _historyCalls: 0,
  });
  vm.runInContext(signedSource, context);
  context.renderSignedReports();
  context.currentTab = 'inventory';
  context.currentTab = 'signed-reports';
  context.renderSignedReports();
  authA.resolve(response({ user: { display_name: 'A', permissions: {} } }));
  await flush();
  assert.strictEqual(context.SignedReports.state.renderSeq, 2, 'signed report mount generation did not advance');
  authB.resolve(response({ user: { display_name: 'B', permissions: {} } }));
  await flush();
  assert.strictEqual(context._authCalls, 2, 'signed report did not issue one auth request per mount');
  assert.strictEqual(context._historyCalls, 1, 'stale signed report mount triggered duplicate history fetch');
  assert.strictEqual(context._elements.get('upl-drop').listeners.drop, 2,
    'signed report drop listener was bound more than once');

  const setup = setupHistoryContext(signedSource, 'SignedReports', 'signed-reports', '/api/signed-reports?');
  setup.requests[1].request.resolve(response({ items: [{ id: 'new' }], total: 1, page: 1 }));
  await flush();
  setup.requests[0].request.resolve(response({ items: [{ id: 'old' }], total: 1, page: 1 }));
  await flush();
  assert.strictEqual(setup.context.SignedReports.state.reports[0].id, 'new', 'signed report history did not use latest response');
}

async function testQuotationAbaAndHistoryRace() {
  const authA = deferred();
  const authB = deferred();
  const context = baseContext({
    currentTab: 'quotation',
    fetch(url) {
      if (url === '/api/auth/me') return context._authCalls++ === 0 ? authA.promise : authB.promise;
      if (url.startsWith('/api/quotation-uploads?')) {
        context._historyCalls += 1;
        return context._history.promise;
      }
      return Promise.resolve(response({}));
    },
    _authCalls: 0,
    _historyCalls: 0,
    _history: deferred(),
  });
  vm.runInContext(quotationSource, context);
  context.renderQuotationUploads();
  context.currentTab = 'inventory';
  context.currentTab = 'quotation';
  context.renderQuotationUploads();
  authA.resolve(response({ user: { display_name: 'A' } }));
  await flush();
  authB.resolve(response({ user: { display_name: 'B' } }));
  await flush();
  assert.strictEqual(context._authCalls, 2, 'quotation did not issue one auth request per mount');
  assert.strictEqual(context._historyCalls, 1, 'stale quotation mount triggered duplicate history fetch');
  assert.strictEqual(context._elements.get('upl-drop').listeners.drop, 2,
    'quotation drop listener was bound more than once');

  const setup = setupHistoryContext(quotationSource, 'QuotationUploads', 'quotation', '/api/quotation-uploads?');
  setup.requests[1].request.resolve(response({ items: [{ id: 'new' }], total: 1, page: 1 }));
  await flush();
  setup.requests[0].request.resolve(response({ items: [{ id: 'old' }], total: 1, page: 1 }));
  await flush();
  assert.strictEqual(setup.context.QuotationUploads.state.reports[0].id, 'new', 'quotation history did not use latest response');
}

(async () => {
  await testStockoutTabLeaveAndLatestWins();
  await testStocktakeTabLeaveAndSiteSnapshot();
  await testStocktakeStaleKitsResponseDoesNotMutateSharedState();
  await testSignedReportsAbaAndHistoryRace();
  await testQuotationAbaAndHistoryRace();
  console.log('tab async lifecycle runtime: 9 passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
