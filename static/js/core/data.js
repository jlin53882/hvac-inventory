// 庫存管理系統 - 資料載入層（v8 拆分）；HTTP 呼叫一律經 core/api-client.js 的 apiFetch
// loadData / updateSubInfo / loadDestinations / saveAll

import { apiFetch } from './api-client.js';
import { updateNotifications } from './notifications.js';
import { DATA_REFRESH_PRESERVE_MOUNT_TABS, ITEMLESS_TABS, appState } from './state.js';
import { esc } from './utils.js';
import { buildFilterPanel } from '../features/inventory/filters.js';
import { buildDatalists, renderInventory } from '../features/inventory/list.js';
import { updatePreparedBadge } from '../features/prepared/page.js';
import { checkReminder, switchTab } from '../features/shell/app.js';

export async function loadData(options) {
  const full = Boolean(options && options.full);
  const requestId = ++appState.dataRequestSeq;
  if (appState.dataAbortController) appState.dataAbortController.abort();
  // P1-D：mutation 後的 loadData 預設刷新 global summary；搜尋/換頁/filter 走 wrapper（不刷）。
  const refreshSummary = !options || options.refreshSummary !== false;
  if (!full && appState.currentTab === 'inventory') {
    await loadInventoryPageImpl(appState.INVENTORY_META.page || 1, refreshSummary);
    return;
  }
  const controller = new AbortController();
  appState.dataAbortController = controller;
  const siteAtRequest = appState.currentSite;
  try {
    const skipItems = !full && ITEMLESS_TABS.has(appState.currentTab);
    if (skipItems) {
      if (requestId !== appState.dataRequestSeq || siteAtRequest !== appState.currentSite) return;
      appState.ALL_ITEMS = [];
      appState.fullItemsLoadedSite = '';
      updateNotifications();
      updateSubInfo();
      if (!DATA_REFRESH_PRESERVE_MOUNT_TABS.has(appState.currentTab)) switchTab(appState.currentTab);
      loadPreparedBadge();
      return;
    }
    const items = await apiFetch(`/api/items?site=${encodeURIComponent(siteAtRequest)}`, { signal: controller.signal });
    if (requestId !== appState.dataRequestSeq || siteAtRequest !== appState.currentSite) return;
    appState.ALL_ITEMS = items;
    appState.fullItemsLoadedSite = siteAtRequest;
    appState.inventoryLoadedSite = '';
    buildDatalists();
    buildFilterPanel();
    checkReminder();
    updateNotifications();
    updateSubInfo();
    // 載入期間使用者可能已切到保留掛載的頁（報價單 / 簽名報表…）：不可重新 mount，否則會丟掉子模式與表單狀態
    if (!DATA_REFRESH_PRESERVE_MOUNT_TABS.has(appState.currentTab)) switchTab(appState.currentTab);
    loadPreparedBadge();
  } catch (e) {
    if (e.name === 'AbortError' || requestId !== appState.dataRequestSeq || siteAtRequest !== appState.currentSite) return;
    document.getElementById('content').innerHTML =
      `<div class="empty">⚠️ 無法連線伺服器<br><small>${esc(e.message)}</small></div>`;
  } finally {
    if (appState.dataAbortController === controller) appState.dataAbortController = null;
  }
}

// 庫存頁只取當前頁資料，篩選與 facets 在伺服器端完成。
// P1-D：搜尋/換頁/filter 入口——只用 body.stats 更新 KPI，不重打 /api/stats/summary。
export async function loadInventoryPage(page) {
  return loadInventoryPageImpl(page, false);
}

// refreshSummary=true：mutation 成功後，global summary cache 已過期才重刷。
async function loadInventoryPageImpl(page, refreshSummary) {
  appState.dataRequestSeq++;
  if (appState.dataAbortController) appState.dataAbortController.abort();
  const requestId = ++appState.inventoryRequestSeq;
  if (appState.inventoryAbortController) appState.inventoryAbortController.abort();
  const controller = new AbortController();
  appState.inventoryAbortController = controller;
  const siteAtRequest = appState.currentSite;
  const pageAtRequest = Math.max(1, page || 1);
  try {
    const params = new URLSearchParams({
      site: siteAtRequest,
      page: String(pageAtRequest),
      page_size: String(appState.INVENTORY_META.page_size || 50),
      sort: 'brand',
    });
    const search = document.getElementById('search-input');
    if (search && search.value.trim()) params.set('search', search.value.trim());
    if (appState.currentBrands.length) params.set('brands', appState.currentBrands.join(','));
    if (appState.currentCategories.length) params.set('categories', appState.currentCategories.join(','));
    const shouldLoadFacets = appState.inventoryFacetsLoadedSite !== siteAtRequest;
    // facets 失敗（HTTP 錯誤）不擋列表，只是篩選選項沿用舊資料；網路錯誤 / 取消則照常中止
    const facetsRequest = shouldLoadFacets
      ? apiFetch(`/api/items/facets?site=${encodeURIComponent(siteAtRequest)}`, { signal: controller.signal })
        .catch(e => (e.status ? null : Promise.reject(e)))
      : Promise.resolve(null);
    const [body, facets] = await Promise.all([
      apiFetch(`/api/items?${params}`, { signal: controller.signal }),
      facetsRequest,
    ]);
    if (requestId !== appState.inventoryRequestSeq || siteAtRequest !== appState.currentSite) return;
    appState.ALL_ITEMS = body.items || [];
    appState.INVENTORY_META = {
      page: body.page || pageAtRequest,
      page_size: body.page_size || 50,
      total: body.total || 0,
      stats: body.stats || null,
    };
    if (facets) {
      appState.INVENTORY_FACETS = facets;
      appState.inventoryFacetsLoadedSite = siteAtRequest;
    }
    appState.inventoryLoadedSite = siteAtRequest;
    appState.fullItemsLoadedSite = '';
    buildDatalists();
    buildFilterPanel();
    checkReminder();
    updateNotifications();
    if (refreshSummary || !hasSummaryCache()) {
      await updateSubInfo();
    } else {
      renderSubInfo();
    }
    // await updateSubInfo 期間可能已切頁或有新請求：不可把庫存頁畫進別頁的 #content
    if (requestId !== appState.inventoryRequestSeq || appState.currentTab !== 'inventory') return;
    renderInventory();
  } catch (e) {
    if (e.name === 'AbortError' || requestId !== appState.inventoryRequestSeq || siteAtRequest !== appState.currentSite) return;
    document.getElementById('content').innerHTML =
      `<div class="empty">⚠️ 無法載入庫存<br><small>${esc(e.message)}</small></div>`;
  } finally {
    if (appState.inventoryAbortController === controller) appState.inventoryAbortController = null;
  }
}

export function changeInventoryPage(page) {
  if (page < 1 || page > Math.ceil(appState.INVENTORY_META.total / appState.INVENTORY_META.page_size)) return;
  loadInventoryPage(page);
}

// 抓待領出數量 → 更新底部「📤 待領出」小標（網頁剛進就要顯示）
async function loadPreparedBadge() {
  const siteAtRequest = appState.currentSite;
  try {
    const items = await apiFetch(`/api/prepared?site=${encodeURIComponent(siteAtRequest)}`);
    if (siteAtRequest !== appState.currentSite) return;
    updatePreparedBadge(items.length);
  } catch (e) { /* 小標載入失敗不影響頁面 */ }
}

// P1-D：global summary 渲染只吃 cache（ALERTS_BY_SITE），body.stats 是 filter dataset，兩者語意不同不可互蓋。
function hasSummaryCache() {
  return typeof appState.ALERTS_BY_SITE !== 'undefined' && appState.ALERTS_BY_SITE && appState.ALERTS_BY_SITE.all &&
    typeof appState.ALERTS_BY_SITE.all.single_items !== 'undefined';
}

function renderSubInfo() {
  if (!hasSummaryCache()) return;
  const current = appState.ALERTS_BY_SITE[appState.currentSite] || appState.ALERTS_BY_SITE.all;
  document.getElementById('sub-info').textContent =
    `單一材料 ${current.single_items} 項 · 整組 ${current.kit_items} 組 · ${current.brands} 種廠牌 · 缺貨 ${current.zero_stock} 項`;
  const officeStats = appState.ALERTS_BY_SITE.office;
  const warehouseStats = appState.ALERTS_BY_SITE.warehouse;
  const vanStats = appState.ALERTS_BY_SITE.van;
  const truckStats = appState.ALERTS_BY_SITE.truck;
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
  const requestId = ++appState.statsRequestSeq;
  if (appState.statsAbortController) appState.statsAbortController.abort();
  const controller = new AbortController();
  appState.statsAbortController = controller;
  const siteAtRequest = appState.currentSite;
  try {
    const summary = await apiFetch('/api/stats/summary', { signal: controller.signal });
    if (requestId !== appState.statsRequestSeq || siteAtRequest !== appState.currentSite) return;
    appState.ALERTS_BY_SITE = {
      all: summary.all || {},
      office: summary.office || {},
      warehouse: summary.warehouse || {},
      van: summary.van || {},
      truck: summary.truck || {},
    };
    renderSubInfo();
    updateNotifications();
  } catch (e) {
    if (e.name !== 'AbortError' && requestId === appState.statsRequestSeq && siteAtRequest === appState.currentSite) {
      console.error('[updateSubInfo] 統計失敗', e);
    }
  } finally {
    if (appState.statsAbortController === controller) appState.statsAbortController = null;
  }
}

// 載入最近 100 筆出庫紀錄的去向 → 建立 destination 下拉建議清單（DESTINATIONS）
export async function loadDestinations() {
  const siteAtRequest = appState.currentSite;
  try {
    const outs = await apiFetch(`/api/stockouts?limit=100&site=${encodeURIComponent(siteAtRequest)}`);
    if (siteAtRequest !== appState.currentSite) return;
    appState.DESTINATIONS = [...new Set(outs.map(o => o.destination).filter(Boolean))];
    appState.destinationsLoadedSite = siteAtRequest;
    document.getElementById('dest-list').innerHTML =
      appState.DESTINATIONS.map(d => `<option value="${esc(d)}">`).join('');
  } catch (e) { if (e.name !== 'AbortError') console.error('[loadDestinations] 去向清單載入失敗', e); }
}
