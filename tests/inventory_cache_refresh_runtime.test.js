const assert = require('node:assert/strict');
const vm = require('node:vm');
const { installApiClient, loadModules, mockResponse } = require('./support/frontend-runtime');

const requests = [];
let facetsPayload = { brands: { Old: 1 }, categories: { OldCategory: 1 }, locations: ['OldLocation'] };
let stockoutsPayload = [{ destination: '新案場' }];
const elements = {};
function makeElement() {
  const classes = new Set();
  const element = {
    innerHTML: '', textContent: '', value: '', children: [], offsetWidth: 1200,
    classList: {
      toggle(name, force) { if (force === undefined ? !classes.has(name) : force) classes.add(name); else classes.delete(name); return classes.has(name); },
      contains(name) { return classes.has(name); },
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
    },
    appendChild(child) { this.children.push(child); },
  };
  Object.defineProperty(element, 'innerHTML', {
    get() { return this._innerHTML || ''; },
    set(value) { this._innerHTML = value; this.children = []; },
  });
  return element;
}
const context = {
  // 跨模組狀態（issue #39：原本是全域變數）
  appState: {
    dataRequestSeq: 0,
    inventoryRequestSeq: 0,
    dataAbortController: null,
    inventoryAbortController: null,
    currentTab: 'inventory',
    currentSite: 'office',
    INVENTORY_META: { page: 1, page_size: 50, total: 1, stats: null },
    INVENTORY_FACETS: { brands: { Old: 1 }, categories: { OldCategory: 1 }, locations: ['OldLocation'] },
    inventoryLoadedSite: 'office',
    inventoryFacetsLoadedSite: 'office',
    fullItemsLoadedSite: '',
    destinationsLoadedSite: 'office',
    DESTINATIONS: ['舊案場'],
    ALL_ITEMS: [],
    currentBrands: [],
    currentCategories: [],
  },
  ITEMLESS_TABS: new Set(),
  DATA_REFRESH_PRESERVE_MOUNT_TABS: new Set(),
  ALERTS_BY_SITE: { office: {} },
  document: {
    getElementById: id => elements[id] || (elements[id] = makeElement()),
    createElement: () => makeElement(),
    addEventListener() {},
  },
  window: { innerWidth: 1200, addEventListener() {} },
  esc: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;'),
  AbortController,
  URLSearchParams,
  fetch: async (url, options) => {
    requests.push(String(url));
    if (String(url).includes('/api/items/facets')) return mockResponse(facetsPayload);
    if (String(url).startsWith('/api/stockouts?')) return mockResponse(stockoutsPayload);
    if (String(url).includes('/api/items?') && String(url).includes('page=')) return mockResponse({ items: [], page: 1, page_size: 50, total: 0, stats: {} });
    return mockResponse([]);
  },
  checkReminder() {},
  updateNotifications() {},
  updateSubInfo: async () => {},
  renderSubInfo() {},
  renderInventory() {},
  loadPreparedBadge() {},
  switchTab() {},
  hasSummaryCache: () => true,
  console,
};
vm.createContext(context);
installApiClient(context);
// 原 render/inventory.js 依職責拆成多個模組；原 api.js 的資料載入在 core/data.js（issue #39）
loadModules(context, 'core/qty.js', 'features/inventory/state.js', 'features/inventory/filters.js', 'core/search.js',
  'features/inventory/list.js', 'features/inventory/status.js', 'features/inventory/actions.js', 'features/inventory/adjust.js',
  'features/inventory/batch-location.js', 'core/data.js');
context.updateSubInfo = async () => {};

(async () => {
  // Ordinary paging keeps the cached facets; mutation refresh must fetch and replace them.
  await context.loadInventoryPage(2);
  assert.equal(requests.filter(url => url.includes('/api/items/facets')).length, 0, '分頁不應重新抓 facets');
  facetsPayload = { brands: { New: 1 }, categories: { NewCategory: 1 }, locations: ['NewLocation'] };
  context.appState.currentCategories.push('OldCategory');
  await context.loadData();
  assert.equal(requests.filter(url => url.includes('/api/items/facets')).length, 1, '庫存資料變更後應重新抓 facets');
  assert.deepEqual(Array.from(context.appState.currentCategories), [], '已不存在的分類篩選應清除');
  assert.equal(requests.filter(url => url.includes('categories=OldCategory')).length, 1, '清除不存在的分類後應重查未篩選清單');
  assert.equal(context.appState.INVENTORY_FACETS.categories.NewCategory, 1, '篩選資料應替換為最新分類');
  assert.equal(context.appState.INVENTORY_FACETS.categories.OldCategory, undefined, '舊分類不應殘留');
  assert.ok(elements['fp-cat-chips'].children.some(chip => chip.innerHTML.includes('NewCategory')));
  assert.ok(!elements['fp-cat-chips'].children.some(chip => chip.innerHTML.includes('OldCategory')));

  // Full item reloads while inventory is mounted (for example kit edit) also refresh facets.
  facetsPayload = { brands: {}, categories: {}, locations: [] };
  context.appState.currentBrands.push('New');
  await context.loadData({ full: true });
  assert.equal(requests.filter(url => url.includes('/api/items/facets')).length, 2, '庫存頁完整重載也應重新抓 facets');
  assert.deepEqual(Array.from(context.appState.currentBrands), [], '完整重載後不存在的品牌篩選應清除');
  assert.deepEqual(Object.keys(context.appState.INVENTORY_FACETS.categories), []);
  assert.ok(!elements['fp-cat-chips'].children.some(chip => chip.innerHTML.includes('NewCategory')));

  // Stockout mutations explicitly refresh the per-site destination suggestions.
  context.appState.currentTab = 'stockout';
  context.appState.DESTINATIONS = ['舊案場'];
  context.appState.destinationsLoadedSite = 'office';
  stockoutsPayload = [{ destination: '新案場' }, { destination: '新案場' }];
  await context.loadData({ refreshDestinations: true });
  assert.equal(requests.filter(url => url.startsWith('/api/stockouts?')).length, 1, '出庫異動後應重新抓去向建議');
  assert.deepEqual(Array.from(context.appState.DESTINATIONS), ['新案場'], '去向建議應更新且去重');
  assert.ok(elements['dest-list'].innerHTML.includes('新案場'));
  assert.ok(!elements['dest-list'].innerHTML.includes('舊案場'));
  console.log('inventory cache refresh runtime tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
