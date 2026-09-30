// 庫存管理系統 - 主頁資料重新整理流程（v8 拆分；issue #39 從 core/data.js 移出）
// loadData / loadInventoryPage：取資料 → 更新 state → 重建篩選 / 通知 / 統計 → 重新掛載目前分頁。
// 會呼叫各 feature 的 UI，所以屬於 shell feature；純資料 primitive（去向清單）留在 core/data.js。

import { apiFetch } from '../../core/api-client.js';
import { refreshDestinationsAfterMutation } from '../../core/data.js';
import { createRequestGuard } from '../../core/request-guard.js';
import { DATA_REFRESH_PRESERVE_MOUNT_TABS, ITEMLESS_TABS, appState } from '../../core/state.js';
import { getCurrentBrands, getCurrentCategories, setCurrentBrands, setCurrentCategories, setFullItemsLoadedSite, setInventoryLoadedSite } from '../../core/shared-read-model.js';
import { getInventoryMeta, setAllItems, setInventoryFacets, setInventoryMeta } from '../../core/inventory-read-model.js';
import { esc } from '../../core/utils.js';
import { shellState } from './state.js';

// 「最新請求優先」：資料載入 / 庫存分頁 / 統計各自一個守衛（AbortController 仍放在 appState，供切頁時中止）
const dataGuard = createRequestGuard();
const inventoryGuard = createRequestGuard();
const statsGuard = createRequestGuard();

// 資料載入後要更新的畫面（庫存篩選 / 清單、通知、盤點提醒、待領出小標、重新掛載目前頁籤）由組裝層注入：
// 本模組只 import core，feature 可以 import loadData 而不會和各頁 renderer 互相 import（issue #39 消除循環）。
var VIEW_HOOKS = ['buildDatalists', 'buildFilterPanel', 'checkReminder', 'updateNotifications', 'remountTab', 'renderInventory', 'updatePreparedBadge'];
var dataRefreshView = null;

export function configureDataRefresh(hooks) {
  var missing = VIEW_HOOKS.filter(function(name) { return typeof (hooks && hooks[name]) !== 'function'; });
  if (missing.length) throw new TypeError('configureDataRefresh 缺少：' + missing.join(', '));
  dataRefreshView = Object.freeze(VIEW_HOOKS.reduce(function(view, name) { view[name] = hooks[name]; return view; }, {}));
}

function view() {
  if (!dataRefreshView) throw new Error('data-refresh：尚未設定畫面更新實作（pages/main.js 需先呼叫 configureShell）');
  return dataRefreshView;
}

// 只重繪庫存清單、不重新載入資料（批次選取、待存調整、照片更新後）：feature 不直接 import inventory/list.js
export function renderInventoryView() {
  view().renderInventory();
}

export async function loadData(options) {
  const full = Boolean(options && options.full);
  const refreshDestinations = Boolean(options && options.refreshDestinations);
  const requestId = dataGuard.next();
  if (shellState.dataAbortController) shellState.dataAbortController.abort();
  // P1-D：mutation 後的 loadData 預設刷新 global summary；搜尋/換頁/filter 走 wrapper（不刷）。
  const refreshSummary = !options || options.refreshSummary !== false;
  if (!full && appState.currentTab === 'inventory') {
    await loadInventoryPageImpl(getInventoryMeta().page || 1, refreshSummary, true, refreshDestinations);
    return;
  }
  const controller = new AbortController();
  shellState.dataAbortController = controller;
  const siteAtRequest = appState.currentSite;
  try {
    const skipItems = !full && ITEMLESS_TABS.has(appState.currentTab);
    if (skipItems) {
      if (!dataGuard.isCurrent(requestId) || siteAtRequest !== appState.currentSite) return;
      setAllItems([]);
      setFullItemsLoadedSite('');
      view().updateNotifications();
      updateSubInfo();
      if (!DATA_REFRESH_PRESERVE_MOUNT_TABS.has(appState.currentTab)) view().remountTab(appState.currentTab);
      loadPreparedBadge();
      return;
    }
    const refreshFacets = appState.currentTab === 'inventory';
    // facets 失敗（HTTP 錯誤）不擋列表，只是篩選選項沿用舊資料；網路錯誤 / 取消則照常中止
    const [items, facets] = await Promise.all([
      apiFetch(`/api/items?site=${encodeURIComponent(siteAtRequest)}`, { signal: controller.signal }),
      refreshFacets
        ? apiFetch(`/api/items/facets?site=${encodeURIComponent(siteAtRequest)}`, { signal: controller.signal })
          .catch(e => (e.status ? null : Promise.reject(e)))
        : Promise.resolve(null),
    ]);
    if (!dataGuard.isCurrent(requestId) || siteAtRequest !== appState.currentSite) return;
    setAllItems(items);
    setFullItemsLoadedSite(siteAtRequest);
    setInventoryLoadedSite('');
    if (facets) {
      setInventoryFacets(facets);
      shellState.inventoryFacetsLoadedSite = siteAtRequest;
      reconcileInventoryFilters(facets);
    }
    if (refreshDestinations) await refreshDestinationsAfterMutation();
    view().buildDatalists(refreshDestinations);
    view().buildFilterPanel();
    view().checkReminder();
    view().updateNotifications();
    updateSubInfo();
    // 載入期間使用者可能已切到保留掛載的頁（報價單 / 簽名報表…）：不可重新 mount，否則會丟掉子模式與表單狀態
    if (!DATA_REFRESH_PRESERVE_MOUNT_TABS.has(appState.currentTab)) view().remountTab(appState.currentTab);
    loadPreparedBadge();
  } catch (e) {
    if (e.name === 'AbortError' || !dataGuard.isCurrent(requestId) || siteAtRequest !== appState.currentSite) return;
    document.getElementById('content').innerHTML =
      `<div class="empty">⚠️ 無法連線伺服器<br><small>${esc(e.message)}</small></div>`;
  } finally {
    if (shellState.dataAbortController === controller) shellState.dataAbortController = null;
  }
}

// 庫存頁只取當前頁資料，篩選與 facets 在伺服器端完成。
// P1-D：搜尋/換頁/filter 入口——只用 body.stats 更新 KPI，不重打 /api/stats/summary。
export async function loadInventoryPage(page) {
  return loadInventoryPageImpl(page, false);
}

function reconcileInventoryFilters(facets) {
  let changed = false;
  const validBrands = new Set(Object.keys((facets && facets.brands) || {}));
  const validCategories = new Set(Object.keys((facets && facets.categories) || {}));
  const brands = getCurrentBrands().filter(function(brand) { return validBrands.has(brand); });
  const categories = getCurrentCategories().filter(function(category) { return validCategories.has(category); });
  if (brands.length !== getCurrentBrands().length) { setCurrentBrands(brands); changed = true; }
  if (categories.length !== getCurrentCategories().length) { setCurrentCategories(categories); changed = true; }
  return changed;
}

// refreshSummary=true：mutation 成功後，global summary cache 已過期才重刷。
async function loadInventoryPageImpl(page, refreshSummary, refreshFacets, refreshDestinations) {
  dataGuard.invalidate();
  if (shellState.dataAbortController) shellState.dataAbortController.abort();
  const requestId = inventoryGuard.next();
  if (shellState.inventoryAbortController) shellState.inventoryAbortController.abort();
  const controller = new AbortController();
  shellState.inventoryAbortController = controller;
  const siteAtRequest = appState.currentSite;
  const pageAtRequest = Math.max(1, page || 1);
  try {
    const params = new URLSearchParams({
      site: siteAtRequest,
      page: String(pageAtRequest),
      page_size: String(getInventoryMeta().page_size || 50),
      sort: 'brand',
    });
    const search = document.getElementById('search-input');
    if (search && search.value.trim()) params.set('search', search.value.trim());
    if (getCurrentBrands().length) params.set('brands', getCurrentBrands().join(','));
    if (getCurrentCategories().length) params.set('categories', getCurrentCategories().join(','));
    const shouldLoadFacets = Boolean(refreshFacets) || shellState.inventoryFacetsLoadedSite !== siteAtRequest;
    // facets 失敗（HTTP 錯誤）不擋列表，只是篩選選項沿用舊資料；網路錯誤 / 取消則照常中止
    const facetsRequest = shouldLoadFacets
      ? apiFetch(`/api/items/facets?site=${encodeURIComponent(siteAtRequest)}`, { signal: controller.signal })
        .catch(e => (e.status ? null : Promise.reject(e)))
      : Promise.resolve(null);
    const [pageBody, facets] = await Promise.all([
      apiFetch(`/api/items?${params}`, { signal: controller.signal }),
      facetsRequest,
    ]);
    let body = pageBody;
    if (!inventoryGuard.isCurrent(requestId) || siteAtRequest !== appState.currentSite) return;
    if (facets && reconcileInventoryFilters(facets)) {
      if (getCurrentBrands().length) params.set('brands', getCurrentBrands().join(','));
      else params.delete('brands');
      if (getCurrentCategories().length) params.set('categories', getCurrentCategories().join(','));
      else params.delete('categories');
      body = await apiFetch(`/api/items?${params}`, { signal: controller.signal });
      if (!inventoryGuard.isCurrent(requestId) || siteAtRequest !== appState.currentSite) return;
    }
    setAllItems(body.items || []);
    setInventoryMeta({
      page: body.page || pageAtRequest,
      page_size: body.page_size || 50,
      total: body.total || 0,
      stats: body.stats || null,
    });
    if (facets) {
      setInventoryFacets(facets);
      shellState.inventoryFacetsLoadedSite = siteAtRequest;
      reconcileInventoryFilters(facets);
    }
    setInventoryLoadedSite(siteAtRequest);
    setFullItemsLoadedSite('');
    if (refreshDestinations) await refreshDestinationsAfterMutation();
    view().buildDatalists(refreshDestinations);
    view().buildFilterPanel();
    view().checkReminder();
    view().updateNotifications();
    if (refreshSummary || !hasSummaryCache()) {
      await updateSubInfo();
    } else {
      renderSubInfo();
    }
    // await updateSubInfo 期間可能已切頁或有新請求：不可把庫存頁畫進別頁的 #content
    if (!inventoryGuard.isCurrent(requestId) || appState.currentTab !== 'inventory') return;
    view().renderInventory();
  } catch (e) {
    if (e.name === 'AbortError' || !inventoryGuard.isCurrent(requestId) || siteAtRequest !== appState.currentSite) return;
    document.getElementById('content').innerHTML =
      `<div class="empty">⚠️ 無法載入庫存<br><small>${esc(e.message)}</small></div>`;
  } finally {
    if (shellState.inventoryAbortController === controller) shellState.inventoryAbortController = null;
  }
}

export function changeInventoryPage(page) {
  if (page < 1 || page > Math.ceil(getInventoryMeta().total / getInventoryMeta().page_size)) return;
  loadInventoryPage(page);
}

// 抓待領出數量 → 更新底部「📤 待領出」小標（網頁剛進就要顯示）
async function loadPreparedBadge() {
  const siteAtRequest = appState.currentSite;
  try {
    const items = await apiFetch(`/api/prepared?site=${encodeURIComponent(siteAtRequest)}`);
    if (siteAtRequest !== appState.currentSite) return;
    view().updatePreparedBadge(items.length);
  } catch (e) { /* 小標載入失敗不影響頁面 */ }
}

// P1-D：global summary 渲染只吃 cache（ALERTS_BY_SITE），body.stats 是 filter dataset，兩者語意不同不可互蓋。
function hasSummaryCache() {
  return typeof shellState.ALERTS_BY_SITE !== 'undefined' && shellState.ALERTS_BY_SITE && shellState.ALERTS_BY_SITE.all &&
    typeof shellState.ALERTS_BY_SITE.all.single_items !== 'undefined';
}

function renderSubInfo() {
  if (!hasSummaryCache()) return;
  const current = shellState.ALERTS_BY_SITE[appState.currentSite] || shellState.ALERTS_BY_SITE.all;
  document.getElementById('sub-info').textContent =
    `單一材料 ${current.single_items} 項 · 整組 ${current.kit_items} 組 · ${current.brands} 種廠牌 · 缺貨 ${current.zero_stock} 項`;
  const officeStats = shellState.ALERTS_BY_SITE.office;
  const warehouseStats = shellState.ALERTS_BY_SITE.warehouse;
  const vanStats = shellState.ALERTS_BY_SITE.van;
  const truckStats = shellState.ALERTS_BY_SITE.truck;
  document.getElementById('site-office-sub').textContent =
    `${officeStats.total_items} 項 · ${officeStats.total_qty}`;
  document.getElementById('site-warehouse-sub').textContent =
    `${warehouseStats.total_items} 項 · ${warehouseStats.total_qty}`;
  document.getElementById('site-van-sub').textContent =
    `${vanStats.total_items} 項 · ${vanStats.total_qty}`;
  document.getElementById('site-truck-sub').textContent =
    `${truckStats.total_items} 項 · ${truckStats.total_qty}`;
}

// 更新頂部統計資訊（單一材料/整組/廠牌/缺貨數 + 分片按鈕數字）
async function updateSubInfo() {
  const requestId = statsGuard.next();
  if (shellState.statsAbortController) shellState.statsAbortController.abort();
  const controller = new AbortController();
  shellState.statsAbortController = controller;
  const siteAtRequest = appState.currentSite;
  try {
    const summary = await apiFetch('/api/stats/summary', { signal: controller.signal });
    if (!statsGuard.isCurrent(requestId) || siteAtRequest !== appState.currentSite) return;
    shellState.ALERTS_BY_SITE = {
      all: summary.all || {},
      office: summary.office || {},
      warehouse: summary.warehouse || {},
      van: summary.van || {},
      truck: summary.truck || {},
    };
    renderSubInfo();
    view().updateNotifications();
  } catch (e) {
    if (e.name !== 'AbortError' && statsGuard.isCurrent(requestId) && siteAtRequest === appState.currentSite) {
      console.error('[updateSubInfo] 統計失敗', e);
    }
  } finally {
    if (shellState.statsAbortController === controller) shellState.statsAbortController = null;
  }
}
