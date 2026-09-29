// 庫存管理系統 - 庫存狀態、KPI 與異常清單

import { clearSharedStatusListModal, renderSharedProductStatusItem, setSharedStatusListContext, statusListLocations } from '../../components/status-list.js';
import { apiFetch } from '../../core/api-client.js';
import { INVENTORY_ALERT_ITEMS, INVENTORY_PENDING_ITEMS, appState, pending } from '../../core/state.js';
import { esc } from '../../core/utils.js';
import { getFilteredInventoryItems, getInventoryFilterKeywords, inventoryItemMatchesCurrentFilters } from './filters.js';
import { formatInventoryQuantity } from './list.js';
import { inventoryState } from './state.js';

function getInventoryDisplayQty(item) {
  const delta = (pending[item.id]) || 0;
  return Math.round((Number(item.qty || 0) + Number(delta)) * 1000) / 1000;
}

// 單一庫存、KPI、卡片、表格與詳情清單共用既有判定語意。
function getInventoryStatusForQty(item, qty) {
  const normalizedQty = Math.round(Number(qty || 0) * 1000) / 1000;
  const isOutOfStock = !item.is_kit && normalizedQty <= 0;
  return {
    qty: normalizedQty,
    isOutOfStock: isOutOfStock,
    isLowStock: !isOutOfStock && item.low_stock > 0 && normalizedQty <= item.low_stock,
  };
}

export function getInventoryStatus(item) {
  return getInventoryStatusForQty(item, getInventoryDisplayQty(item));
}

export function getInventoryDashboardStats(list, aggregateStats) {
  const items = Array.isArray(list) ? list : [];
  const fallbackZeroItems = items.filter(function(item) { return getInventoryStatus(item).isOutOfStock; });
  const fallbackLowItems = items.filter(function(item) { return getInventoryStatus(item).isLowStock; });
  const fallback = {
    itemCount: items.length,
    totalQty: items.reduce(function(sum, item) { return sum + getInventoryDisplayQty(item); }, 0),
    lowCount: fallbackLowItems.length,
    zeroCount: fallbackZeroItems.length,
    lowItems: fallbackLowItems,
    zeroItems: fallbackZeroItems,
  };
  const aggregate = aggregateStats && typeof aggregateStats === 'object' ? aggregateStats : null;
  const hasAggregate = aggregate && Number.isFinite(Number(aggregate.item_count))
    && Number.isFinite(Number(aggregate.total_qty))
    && Number.isFinite(Number(aggregate.low_stock))
    && Number.isFinite(Number(aggregate.zero_stock));
  if (!hasAggregate) return fallback;
  const dashboard = {
    itemCount: Number(aggregate.item_count),
    totalQty: Number(aggregate.total_qty),
    lowCount: Number(aggregate.low_stock),
    zeroCount: Number(aggregate.zero_stock),
    lowItems: Array.isArray(aggregate.low_items) ? aggregate.low_items.slice() : fallbackLowItems.slice(),
    zeroItems: Array.isArray(aggregate.zero_items) ? aggregate.zero_items.slice() : fallbackZeroItems.slice(),
  };
  const currentItems = new Map(items.map(function(item) { return [String(item.id), item]; }));
  const savedPendingItems = INVENTORY_PENDING_ITEMS;
  const filterKeywords = getInventoryFilterKeywords();
  Object.keys(pending).forEach(function(id) {
    const item = currentItems.get(String(id)) || savedPendingItems[id];
    if (!item || !inventoryItemMatchesCurrentFilters(item, filterKeywords)) return;
    const before = getInventoryStatusForQty(item, item.qty);
    const after = getInventoryStatus(item);
    dashboard.totalQty += after.qty - before.qty;
    if (before.isLowStock !== after.isLowStock) dashboard.lowCount += after.isLowStock ? 1 : -1;
    if (before.isOutOfStock !== after.isOutOfStock) dashboard.zeroCount += after.isOutOfStock ? 1 : -1;
    const replaceCurrentItem = function(source, statusKey) {
      const next = source.filter(function(candidate) { return String(candidate.id) !== String(item.id); });
      if (after[statusKey]) next.push(item);
      return next;
    };
    dashboard.lowItems = replaceCurrentItem(dashboard.lowItems, 'isLowStock');
    dashboard.zeroItems = replaceCurrentItem(dashboard.zeroItems, 'isOutOfStock');
  });
  return dashboard;
}
export function renderInventoryDashboard(list, aggregateStats) {
  const dashboard = getInventoryDashboardStats(list, aggregateStats);
  const totalQty = dashboard.totalQty;
  const lowCount = dashboard.lowCount;
  const zeroCount = dashboard.zeroCount;
  return `<section class="inventory-kpi-grid ui-kpi-grid" aria-label="庫存統計">
    <div class="inventory-kpi-card ui-kpi-card ui-kpi-card--blue">
      <span class="inventory-kpi-icon ui-kpi-icon" aria-hidden="true">📦</span>
      <div class="ui-kpi-body"><div class="inventory-kpi-label ui-kpi-label">篩選品項</div><div class="inventory-kpi-number ui-kpi-value">${esc(String(dashboard.itemCount))}</div><span class="ui-kpi-meta">目前篩選結果</span></div>
    </div>
    <div class="inventory-kpi-card ui-kpi-card ui-kpi-card--purple">
      <span class="inventory-kpi-icon ui-kpi-icon" aria-hidden="true">🗄️</span>
      <div class="ui-kpi-body"><div class="inventory-kpi-label ui-kpi-label">庫存總數</div><div class="inventory-kpi-number ui-kpi-value">${esc(formatInventoryQuantity(totalQty))}</div><span class="ui-kpi-meta">目前篩選結果合計</span></div>
    </div>
    <button type="button" class="inventory-kpi-card ui-kpi-card ui-kpi-card--amber inventory-kpi-low" onclick="Inventory.showInventoryStatusList('low')" aria-label="查看低庫存商品">
      <span class="inventory-kpi-icon ui-kpi-icon" aria-hidden="true">⚠</span>
      <div class="ui-kpi-body"><div class="inventory-kpi-label ui-kpi-label">低庫存</div><div class="inventory-kpi-number ui-kpi-value">${esc(String(lowCount))}</div><span class="ui-kpi-meta">低於警示值 · <span class="inventory-kpi-action">查看清單</span></span></div>
    </button>
    <button type="button" class="inventory-kpi-card ui-kpi-card ui-kpi-card--red inventory-kpi-out" onclick="Inventory.showInventoryStatusList('out')" aria-label="查看缺貨商品">
      <span class="inventory-kpi-icon ui-kpi-icon" aria-hidden="true">⛔</span>
      <div class="ui-kpi-body"><div class="inventory-kpi-label ui-kpi-label">缺貨</div><div class="inventory-kpi-number ui-kpi-value">${esc(String(zeroCount))}</div><span class="ui-kpi-meta">數量為 0 · <span class="inventory-kpi-action">查看清單</span></span></div>
    </button>
  </section>`;
}

function getInventoryStatusItems(type) {
  const isLow = type === 'low';
  const pageItems = getFilteredInventoryItems();
  const aggregateStats = typeof appState.INVENTORY_META !== 'undefined' ? appState.INVENTORY_META.stats : null;
  const dashboard = getInventoryDashboardStats(pageItems, aggregateStats);
  return (isLow ? dashboard.lowItems : dashboard.zeroItems)
    .slice()
    .sort(function(a, b) { return getInventoryStatus(a).qty - getInventoryStatus(b).qty; });
}

function getInventoryFilterStateKey() {
  const search = document.getElementById('search-input');
  const brands = typeof appState.currentBrands !== 'undefined' ? appState.currentBrands : [];
  const categories = typeof appState.currentCategories !== 'undefined' ? appState.currentCategories : [];
  return JSON.stringify([
    typeof appState.currentSite !== 'undefined' ? appState.currentSite : '',
    search ? search.value.trim() : '',
    brands,
    categories,
  ]);
}

function buildInventoryAlertParams() {
  const params = new URLSearchParams({
    site: appState.currentSite,
    page: '1',
    page_size: '1',
    sort: 'brand',
    include_alert_items: '1',
  });
  const search = document.getElementById('search-input');
  if (search && search.value.trim()) params.set('search', search.value.trim());
  if (appState.currentBrands.length) params.set('brands', appState.currentBrands.join(','));
  if (appState.currentCategories.length) params.set('categories', appState.currentCategories.join(','));
  return params;
}

async function loadInventoryAlertItems(type, requestId) {
  const siteAtRequest = appState.currentSite;
  const filterKeyAtRequest = getInventoryFilterStateKey();
  const body = await apiFetch(`/api/items?${buildInventoryAlertParams()}`);
  if (siteAtRequest !== appState.currentSite || filterKeyAtRequest !== getInventoryFilterStateKey()
      || (requestId !== undefined && requestId !== inventoryState.inventoryStatusRequestSeq)) return null;
  const stats = body.stats || {};
  if (!Array.isArray(stats.zero_items) || !Array.isArray(stats.low_items)) {
    throw new Error('庫存警示清單回應格式錯誤');
  }
  const mergedStats = Object.assign({}, stats, {
    zero_items: stats.zero_items,
    low_items: stats.low_items,
  });
  const adjustedStats = getInventoryDashboardStats(getFilteredInventoryItems(), mergedStats);
  if (typeof appState.INVENTORY_META !== 'undefined') {
    appState.INVENTORY_META.stats = Object.assign({}, mergedStats, {
      zero_items: adjustedStats.zeroItems,
      low_items: adjustedStats.lowItems,
    });
  }
  return (type === 'low' ? adjustedStats.lowItems : adjustedStats.zeroItems).slice();
}

export function rememberInventoryAlertItem(item) {
  if (!item || item.id === undefined) return;
  INVENTORY_ALERT_ITEMS[String(item.id)] = item;
}

function renderInventoryStatusItem(item, type) {
  rememberInventoryAlertItem(item);
  return renderSharedProductStatusItem(item, {
    status: getInventoryStatus(item),
    statusType: type,
    editable: true,
  });
}

function renderInventoryStatusModal(type, items) {
  const isLow = type === 'low';
  setSharedStatusListContext({
    title: isLow ? '⚠ 低庫存商品' : '⛔ 缺貨商品',
    intro: isLow ? '庫存數量已低於或等於目前警示值。' : '目前庫存為 0 或以下的單一庫存品項。',
    headerClass: isLow ? 'is-low' : 'is-out',
    items: items,
    emptyText: isLow ? '目前沒有低庫存商品' : '目前沒有缺貨商品',
    emptyIntro: '目前篩選條件下沒有符合的品項。',
    getSearchText: function(item) {
      return [item.name, item.brand, item.code, statusListLocations(item).join(' ')].join(' ');
    },
    renderItem: function(item) { return renderInventoryStatusItem(item, type); },
  });
}

function isInventoryStatusRequestCurrent(requestId, modal, type) {
  const isOpen = modal && modal.classList && typeof modal.classList.contains === 'function'
    ? modal.classList.contains('is-open') : true;
  return requestId === inventoryState.inventoryStatusRequestSeq && inventoryState.inventoryStatusModalType === type && isOpen;
}

export async function showInventoryStatusList(type) {
  const modal = document.getElementById('inventory-status-modal');
  const body = document.getElementById('inventory-status-modal-body');
  if (!modal || !body) return;
  const requestId = ++inventoryState.inventoryStatusRequestSeq;
  inventoryState.inventoryStatusModalType = type;
  let items = getInventoryStatusItems(type);
  const stats = typeof appState.INVENTORY_META !== 'undefined' ? appState.INVENTORY_META.stats : null;
  const hasAlertItems = stats && Array.isArray(stats.zero_items) && Array.isArray(stats.low_items);
  modal.classList.add('is-open');
  modal.setAttribute('aria-hidden', 'false');
  if (!hasAlertItems) {
    body.innerHTML = '<div class="inventory-status-loading">載入完整警示清單…</div>';
    try {
      const loaded = await loadInventoryAlertItems(type, requestId);
      if (!loaded || !isInventoryStatusRequestCurrent(requestId, modal, type)) return;
      items = loaded.sort(function(a, b) { return getInventoryStatus(a).qty - getInventoryStatus(b).qty; });
    } catch (e) {
      if (!isInventoryStatusRequestCurrent(requestId, modal, type)) return;
      body.innerHTML = `<div class="inventory-status-empty"><span aria-hidden="true">⚠</span><strong>無法載入完整清單</strong><p>${esc(e.message || '請稍後再試')}</p></div>`;
      return;
    }
  }
  if (!isInventoryStatusRequestCurrent(requestId, modal, type)) return;
  renderInventoryStatusModal(type, items);
}

export function closeInventoryStatusModal() {
  inventoryState.inventoryStatusRequestSeq += 1;
  inventoryState.inventoryStatusModalType = '';
  clearSharedStatusListModal();
  const modal = document.getElementById('inventory-status-modal');
  if (!modal) return;
  modal.classList.remove('is-open');
  modal.setAttribute('aria-hidden', 'true');
}
