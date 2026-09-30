const assert = require('assert');
const vm = require('vm');
const { moduleScript } = require('./support/frontend-runtime');

// 原 api.js：去向清單 primitive 在 core/data.js，loadData 流程在 features/shell/data-refresh.js（issue #39）
const apiSource = moduleScript('core/data.js') + '\n' + moduleScript('features/shell/data-refresh.js');
// shell 組裝層：頁面範圍 / 網址、切頁 port 與 app.js（issue #39）
const appSource = ['features/shell/page-scope.js', 'features/shell/navigation.js', 'features/shell/app.js'].map(moduleScript).join('\n');

/**
 * Create the minimum DOM element surface required by the production bootstrap.
 * @param {string} [id=''] - Element identifier used by production selectors.
 * @returns {object} Element-like object with class and event APIs.
 */
function createElement(id = '') {
  const classes = new Set();
  return {
    id,
    value: '',
    innerHTML: '',
    textContent: '',
    style: {},
    addEventListener() {},
    classList: {
      add(...names) { names.forEach(name => classes.add(name)); },
      remove(...names) { names.forEach(name => classes.delete(name)); },
      toggle(name, force) {
        const next = force === undefined ? !classes.has(name) : force;
        if (next) classes.add(name); else classes.delete(name);
        return next;
      },
      contains(name) { return classes.has(name); },
    },
  };
}

/**
 * Build a VM context around production api.js and app.js bootstrap code.
 * @param {string} tab - Itemless page to open through the production URL path.
 * @returns {{context: object, calls: object}} Runtime context and observed calls.
 */
function createContext(tab) {
  const elements = new Map();
  const calls = {
    checkAuth: 0,
    loadUnits: 0,
    renders: {},
    inventoryFetch: 0,
  };
  const recordRender = name => {
    calls.renders[name] = (calls.renders[name] || 0) + 1;
  };
  const document = {
    visibilityState: 'visible',
    body: Object.assign(createElement('body'), { dataset: {} }),
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, createElement(id));
      return elements.get(id);
    },
    querySelectorAll() { return []; },
    querySelector() { return createElement(); },
    addEventListener() {},
  };
  const context = {
    console,
    AbortController,
    URLSearchParams,
    Date,
    document,
    window: { innerWidth: 1024, addEventListener() {} },
    history: { replaceState() {} },
    location: { search: `?tab=${tab}&site=office` },
    setTimeout,
    clearTimeout,
    ITEMLESS_TABS: new Set(['calendar', 'work-progress', 'signed-reports', 'quotation', 'petty-cash']),
    DATA_REFRESH_PRESERVE_MOUNT_TABS: new Set(['work-progress', 'signed-reports', 'quotation', 'petty-cash']),
    INVENTORY_SITES: ['office', 'warehouse', 'van', 'truck'],
    appState: {
      currentTab: 'inventory',
      currentSite: 'office',
      ALL_ITEMS: ['stale-item'],
      fullItemsLoadedSite: 'office',
      inventoryLoadedSite: '',
      INVENTORY_META: { page: 1, stats: null },
      INVENTORY_FACETS: { brands: {}, categories: {}, locations: [] },
    },
    // features/shell/state.js：shell 內部的重新載入 controller / 警示快取
    shellState: { inventoryAbortController: null, dataAbortController: null, statsAbortController: null, ALERTS_BY_SITE: {}, inventoryFacetsLoadedSite: '' },
    pending: {},
    calendarState: { calMonth: new Date(2026, 8, 1) },   // features/calendar/state.js（syncViewUrl 讀 calMonth）
    inventoryState: { batchMode: false },   // features/inventory/state.js（切離庫存頁時關閉批次模式）
    checkAuth: async () => {
      calls.checkAuth += 1;
      return { username: 'runtime-user', display_name: 'Runtime User', role: 'viewer', password_expired: false };
    },
    loadUnits: async () => { calls.loadUnits += 1; },
    renderUserMenu() {},
    // 頁面可用性由 core/session.js 判斷；本測試只驗頁籤生命週期，網址指定的頁一律可用
    resolveAccessiblePageTab: tab => tab,
    canAccessPage: () => false,
    selectedStockIds: new Set(),  // 批次改位置的選取（features/inventory/batch-location.js）  // 盤點提醒不在本測試範圍：無盤點權限 → checkReminder 直接隱藏
    renderSidebarUser() {},
    applyRoleView() {},
    updateBreadcrumb() {},
    renderNoAccessiblePage() {},
    updateNotifications() {},
    updateSubInfo() {},
    loadPreparedBadge() {},
    checkReminder() {},
    closeInventoryStatusModal() {},
    renderWorkProgress() { recordRender('work-progress'); },
    renderInventory() {},
    // data-refresh 畫面更新 hook（configureShell 注入）其餘的替身：本測試的頁籤都不載入品項，不會被呼叫
    buildDatalists() {},
    buildFilterPanel() {},
    updatePreparedBadge() {},
    renderPrepared() {},
    renderStockOuts() {},
    renderStocktake() {},
    renderKits() {},
    renderCalendar() { recordRender('calendar'); },
    renderSignedReports() { recordRender('signed-reports'); },
    renderQuotation() { recordRender('quotation'); },
    renderPettyCash() { recordRender('petty-cash'); },
    fetch: async (url) => {
      if (url.includes('/api/items?')) calls.inventoryFetch += 1;
      return {
        ok: true,
        status: 200,
        async json() {
          if (url.includes('/api/stats/summary')) {
            const empty = { total_items: 0, total_qty: 0, single_items: 0, kit_items: 0, brands: 0, zero_stock: 0 };
            return { all: empty, office: empty, warehouse: empty, van: empty, truck: empty };
          }
          return [];
        },
      };
    },
  };
  vm.createContext(context);
  vm.runInContext(apiSource, context);
  return { context, calls };
}

(async () => {
  const cases = [
    { tab: 'work-progress', preserveMount: true },
    { tab: 'signed-reports', preserveMount: true },
    { tab: 'quotation', preserveMount: true },
    { tab: 'petty-cash', preserveMount: true },
    { tab: 'calendar', preserveMount: false },
  ];

  for (const { tab, preserveMount } of cases) {
    const { context, calls } = createContext(tab);

    // Execute the complete production app.js bootstrap (initShellApp), not the helper in isolation.
    vm.runInContext(appSource, context);
    // issue #39：使用者選單 / 角色畫面控制由 auth.js 搬到 app.js；本測試只驗頁籤生命週期，維持替身
    context.renderUserMenu = () => {};
    context.applyRoleView = () => {};
    // 與 pages/main.js 相同：先組裝 port（data-refresh 的畫面更新、切頁）再啟動
    context.configureShell();
    context.initShellApp();
    await new Promise(resolve => setTimeout(resolve, 25));

    assert.strictEqual(calls.checkAuth, 1, `${tab}: production bootstrap must authenticate once`);
    assert.strictEqual(calls.loadUnits, 1, `${tab}: production bootstrap must load units once`);
    assert.strictEqual(context.appState.currentTab, tab, `${tab}: URL tab must reach production bootstrap`);
    assert.strictEqual(calls.inventoryFetch, 0, `${tab}: itemless page must skip inventory fetch`);
    assert.strictEqual(calls.renders[tab], 1, `${tab}: bootstrap must mount production renderer once`);

    // Background refresh must preserve stateful mounts but continue Calendar refreshes.
    await context.loadData();
    const expectedRenders = preserveMount ? 1 : 2;
    assert.strictEqual(calls.renders[tab], expectedRenders, `${tab}: refresh mount contract drifted`);
  }

  console.log('tab lifecycle runtime: PASS');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
