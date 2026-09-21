const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const apiSource = fs.readFileSync('static/js/api.js', 'utf8');
const appSource = fs.readFileSync('static/js/app.js', 'utf8');

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
    currentTab: 'inventory',
    currentSite: 'office',
    dataRequestSeq: 0,
    dataAbortController: null,
    statsRequestSeq: 0,
    statsAbortController: null,
    ALL_ITEMS: ['stale-item'],
    fullItemsLoadedSite: 'office',
    inventoryLoadedSite: '',
    INVENTORY_META: { page: 1, stats: null },
    INVENTORY_FACETS: { brands: {}, categories: {}, locations: [] },
    ALERTS_BY_SITE: {},
    pending: {},
    checkAuth: async () => {
      calls.checkAuth += 1;
      return { username: 'runtime-user', display_name: 'Runtime User', role: 'viewer', password_expired: false };
    },
    loadUnits: async () => { calls.loadUnits += 1; },
    renderUserMenu() {},
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

    // Execute the complete production app.js bootstrap IIFE, not the helper in isolation.
    vm.runInContext(appSource, context);
    await new Promise(resolve => setTimeout(resolve, 25));

    assert.strictEqual(calls.checkAuth, 1, `${tab}: production bootstrap must authenticate once`);
    assert.strictEqual(calls.loadUnits, 1, `${tab}: production bootstrap must load units once`);
    assert.strictEqual(context.currentTab, tab, `${tab}: URL tab must reach production bootstrap`);
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
