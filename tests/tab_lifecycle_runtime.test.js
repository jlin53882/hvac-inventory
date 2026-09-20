const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const apiSource = fs.readFileSync('static/js/api.js', 'utf8');
const appSource = fs.readFileSync('static/js/app.js', 'utf8');

function createContext(currentTab) {
  const calls = { fetch: 0, inventoryFetch: 0, switchTab: 0, renderWorkProgress: 0 };
  const context = {
    console,
    AbortController,
    URLSearchParams,
    ITEMLESS_TABS: new Set(['calendar', 'work-progress', 'signed-reports', 'quotation', 'petty-cash']),
    DATA_REFRESH_PRESERVE_MOUNT_TABS: new Set(['work-progress', 'signed-reports', 'quotation', 'petty-cash']),
    currentTab,
    currentSite: 'office',
    dataRequestSeq: 0,
    dataAbortController: null,
    statsRequestSeq: 0,
    statsAbortController: null,
    ALERTS_BY_SITE: {},
    ALL_ITEMS: ['stale-item'],
    fullItemsLoadedSite: 'office',
    updateNotifications() {},
    updateSubInfo() {},
    loadPreparedBadge() {},
    checkReminder() {},
    document: {
      getElementById() {
        return { innerHTML: '', textContent: '' };
      },
    },
    fetch: async (url) => {
      calls.fetch += 1;
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
    switchTab(tab) {
      calls.switchTab += 1;
      this.currentTab = tab;
      if (tab === 'work-progress') calls.renderWorkProgress += 1;
    },
  };
  vm.createContext(context);
  vm.runInContext(apiSource, context);
  return { context, calls };
}

function loadProductionBootstrapHelper(context) {
  const start = appSource.indexOf('function mountPreservedTabAfterBootstrap()');
  assert(start >= 0, 'app.js bootstrap helper is missing');
  const end = appSource.indexOf('\n}', start) + 2;
  assert(end > start, 'app.js bootstrap helper body is incomplete');
  vm.runInContext(appSource.slice(start, end), context);
}

async function assertRefreshContract(tab, expectedSwitchCalls) {
  const { context, calls } = createContext(tab);
  await context.loadData();
  assert.strictEqual(calls.inventoryFetch, 0, `${tab}: loadData should skip inventory fetch`);
  assert.strictEqual(calls.switchTab, expectedSwitchCalls, `${tab}: unexpected remount count`);
}

(async () => {
  // Background refresh must not remount stateful independent pages.
  await assertRefreshContract('work-progress', 0);
  await assertRefreshContract('signed-reports', 0);
  await assertRefreshContract('quotation', 0);
  await assertRefreshContract('petty-cash', 0);

  // Calendar remains the existing itemless page that mounts from loadData.
  await assertRefreshContract('calendar', 1);

  // F5 work-progress path: loadData does not mount; bootstrap mounts exactly once.
  const { context, calls } = createContext('work-progress');
  loadProductionBootstrapHelper(context);
  await context.loadData();
  assert.strictEqual(calls.renderWorkProgress, 0, 'loadData mounted Work Progress during boot');
  context.mountPreservedTabAfterBootstrap();
  assert.strictEqual(calls.renderWorkProgress, 1, 'bootstrap must mount Work Progress exactly once');

  // A later background refresh must preserve the existing mount and draft state.
  await context.loadData();
  assert.strictEqual(calls.renderWorkProgress, 1, 'background refresh remounted Work Progress');

  assert(appSource.includes('function mountPreservedTabAfterBootstrap()'),
    'app bootstrap helper must be defined in production app.js');
  assert(appSource.includes('mountPreservedTabAfterBootstrap();'),
    'app bootstrap must call the production mount helper');
  assert(!appSource.includes("currentTab === 'work-progress' || currentTab === 'quotation'"),
    'app bootstrap must not duplicate the independent-page registry');

  console.log('tab lifecycle runtime: PASS');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
