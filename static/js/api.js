// 庫存管理系統 - API 呼叫層（v8 拆分）
// loadData / updateSubInfo / loadDestinations / saveAll

async function loadData(options) {
  const full = Boolean(options && options.full);
  const requestId = ++dataRequestSeq;
  if (dataAbortController) dataAbortController.abort();
  // P1-D：mutation 後的 loadData 預設刷新 global summary；搜尋/換頁/filter 走 wrapper（不刷）。
  const refreshSummary = !options || options.refreshSummary !== false;
  if (!full && currentTab === 'inventory') {
    await loadInventoryPageImpl(INVENTORY_META.page || 1, refreshSummary);
    return;
  }
  const controller = new AbortController();
  dataAbortController = controller;
  const siteAtRequest = currentSite;
  try {
    const skipItems = !full && ITEMLESS_TABS.has(currentTab);
    if (skipItems) {
      if (requestId !== dataRequestSeq || siteAtRequest !== currentSite) return;
      ALL_ITEMS = [];
      fullItemsLoadedSite = '';
      updateNotifications();
      updateSubInfo();
      if (!DATA_REFRESH_PRESERVE_MOUNT_TABS.has(currentTab)) switchTab(currentTab);
      loadPreparedBadge();
      return;
    }
    const res = await fetch(`/api/items?site=${encodeURIComponent(siteAtRequest)}`, { signal: controller.signal });
    if (!res.ok) throw new Error('API 錯誤: ' + res.status);
    const items = await res.json();
    if (requestId !== dataRequestSeq || siteAtRequest !== currentSite) return;
    ALL_ITEMS = items;
    fullItemsLoadedSite = siteAtRequest;
    inventoryLoadedSite = '';
    buildDatalists();
    if (typeof buildFilterPanel === 'function') buildFilterPanel();
    checkReminder();
    updateNotifications();
    updateSubInfo();
    switchTab(currentTab);
    loadPreparedBadge();
  } catch (e) {
    if (e.name === 'AbortError' || requestId !== dataRequestSeq || siteAtRequest !== currentSite) return;
    document.getElementById('content').innerHTML =
      `<div class="empty">⚠️ 無法連線伺服器<br><small>${e.message}</small></div>`;
  } finally {
    if (dataAbortController === controller) dataAbortController = null;
  }
}

// 庫存頁只取當前頁資料，篩選與 facets 在伺服器端完成。
// P1-D：搜尋/換頁/filter 入口——只用 body.stats 更新 KPI，不重打 /api/stats/summary。
async function loadInventoryPage(page) {
  return loadInventoryPageImpl(page, false);
}

// refreshSummary=true：mutation 成功後，global summary cache 已過期才重刷。
async function loadInventoryPageImpl(page, refreshSummary) {
  dataRequestSeq++;
  if (dataAbortController) dataAbortController.abort();
  const requestId = ++inventoryRequestSeq;
  if (inventoryAbortController) inventoryAbortController.abort();
  const controller = new AbortController();
  inventoryAbortController = controller;
  const siteAtRequest = currentSite;
  const pageAtRequest = Math.max(1, page || 1);
  try {
    const params = new URLSearchParams({
      site: siteAtRequest,
      page: String(pageAtRequest),
      page_size: String(INVENTORY_META.page_size || 50),
      sort: 'brand',
    });
    const search = document.getElementById('search-input');
    if (search && search.value.trim()) params.set('search', search.value.trim());
    if (currentBrands.length) params.set('brands', currentBrands.join(','));
    if (currentCategories.length) params.set('categories', currentCategories.join(','));
    const shouldLoadFacets = inventoryFacetsLoadedSite !== siteAtRequest;
    const facetsRequest = shouldLoadFacets
      ? fetch(`/api/items/facets?site=${encodeURIComponent(siteAtRequest)}`, { signal: controller.signal })
      : Promise.resolve(null);
    const [res, facetsRes] = await Promise.all([
      fetch(`/api/items?${params}`, { signal: controller.signal }),
      facetsRequest,
    ]);
    if (!res.ok) throw new Error('庫存列表 API 錯誤: ' + res.status);
    const body = await res.json();
    const facets = facetsRes && facetsRes.ok ? await facetsRes.json() : null;
    if (requestId !== inventoryRequestSeq || siteAtRequest !== currentSite) return;
    ALL_ITEMS = body.items || [];
    INVENTORY_META = {
      page: body.page || pageAtRequest,
      page_size: body.page_size || 50,
      total: body.total || 0,
      stats: body.stats || null,
    };
    if (facets) {
      INVENTORY_FACETS = facets;
      inventoryFacetsLoadedSite = siteAtRequest;
    }
    inventoryLoadedSite = siteAtRequest;
    fullItemsLoadedSite = '';
    buildDatalists();
    buildFilterPanel();
    checkReminder();
    updateNotifications();
    if (refreshSummary || !hasSummaryCache()) {
      await updateSubInfo();
    } else {
      renderSubInfo();
    }
    renderInventory();
  } catch (e) {
    if (e.name === 'AbortError' || requestId !== inventoryRequestSeq || siteAtRequest !== currentSite) return;
    document.getElementById('content').innerHTML =
      `<div class="empty">⚠️ 無法載入庫存<br><small>${e.message}</small></div>`;
  } finally {
    if (inventoryAbortController === controller) inventoryAbortController = null;
  }
}

function changeInventoryPage(page) {
  if (page < 1 || page > Math.ceil(INVENTORY_META.total / INVENTORY_META.page_size)) return;
  loadInventoryPage(page);
}

// 抓待領出數量 → 更新底部「📤 待領出」小標（網頁剛進就要顯示）
async function loadPreparedBadge() {
  const siteAtRequest = currentSite;
  try {
    const res = await fetch(`/api/prepared?site=${encodeURIComponent(siteAtRequest)}`);
    if (!res.ok) return;
    const items = await res.json();
    if (siteAtRequest !== currentSite) return;
    updatePreparedBadge(items.length);
  } catch (e) { if (e.name !== 'AbortError') return; }
}

// P1-D：global summary 渲染只吃 cache（ALERTS_BY_SITE），body.stats 是 filter dataset，兩者語意不同不可互蓋。
function hasSummaryCache() {
  return typeof ALERTS_BY_SITE !== 'undefined' && ALERTS_BY_SITE && ALERTS_BY_SITE.all &&
    typeof ALERTS_BY_SITE.all.single_items !== 'undefined';
}

function renderSubInfo() {
  if (!hasSummaryCache()) return;
  const current = ALERTS_BY_SITE[currentSite] || ALERTS_BY_SITE.all;
  document.getElementById('sub-info').textContent =
    `單一材料 ${current.single_items} 項 · 整組 ${current.kit_items} 組 · ${current.brands} 種廠牌 · 缺貨 ${current.zero_stock} 項`;
  const officeStats = ALERTS_BY_SITE.office;
  const warehouseStats = ALERTS_BY_SITE.warehouse;
  const vanStats = ALERTS_BY_SITE.van;
  const truckStats = ALERTS_BY_SITE.truck;
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
  const requestId = ++statsRequestSeq;
  if (statsAbortController) statsAbortController.abort();
  const controller = new AbortController();
  statsAbortController = controller;
  const siteAtRequest = currentSite;
  try {
    const res = await fetch('/api/stats/summary', { signal: controller.signal });
    if (!res.ok) { console.error('[updateSubInfo] /api/stats/summary 失敗', res.status); return; }
    const summary = await res.json();
    if (requestId !== statsRequestSeq || siteAtRequest !== currentSite) return;
    ALERTS_BY_SITE = {
      all: summary.all || {},
      office: summary.office || {},
      warehouse: summary.warehouse || {},
      van: summary.van || {},
      truck: summary.truck || {},
    };
    renderSubInfo();
    updateNotifications();
  } catch (e) {
    if (e.name !== 'AbortError' && requestId === statsRequestSeq && siteAtRequest === currentSite) {
      console.error('[updateSubInfo] 統計失敗', e);
    }
  } finally {
    if (statsAbortController === controller) statsAbortController = null;
  }
}

// 載入最近 100 筆出庫紀錄的去向 → 建立 destination 下拉建議清單（DESTINATIONS）
async function loadDestinations() {
  const siteAtRequest = currentSite;
  try {
    const res = await fetch(`/api/stockouts?limit=100&site=${encodeURIComponent(siteAtRequest)}`);
    if (!res.ok) { console.error('[loadDestinations] /api/stockouts 失敗', res.status); return; }
    const outs = await res.json();
    if (siteAtRequest !== currentSite) return;
    DESTINATIONS = [...new Set(outs.map(o => o.destination).filter(Boolean))];
    destinationsLoadedSite = siteAtRequest;
    document.getElementById('dest-list').innerHTML =
      DESTINATIONS.map(d => `<option value="${esc(d)}">`).join('');
  } catch (e) { if (e.name !== 'AbortError') console.error('[loadDestinations] 網路錯誤', e); }
}

/**
 * Save aggregate and explicitly targeted stock adjustments without discarding partial successes.
 * @returns {Promise<void>}
 */
let savingAll = false;  // 防止連點「全部儲存」重複送出同一批調整
async function saveAll() {
  if (savingAll) return;
  const ids = Object.keys(pending);
  if (!ids.length) return;
  savingAll = true;
  const button = document.getElementById('btn-save');
  if (button) button.disabled = true;
  let ok = 0;
  let fail = 0;
  try {
    for (const id of ids) {
      const changes = Object.entries(pendingByStock)
        .filter(([, entry]) => String(entry.itemId) === String(id))
        .map(([stockId, entry]) => ({ stockId: stockId, delta: entry.delta }));
      const selectedTotal = changes.reduce((sum, change) => sum + change.delta, 0);
      const globalDelta = Math.round(((Number(pending[id]) || 0) - selectedTotal) * 1000) / 1000;
      const operations = [];
      if (globalDelta !== 0) {
        operations.push({
          url: `/api/items/${id}/adjust`,
          delta: globalDelta,
          stockId: null,
        });
      }
      changes.forEach(change => operations.push({
        url: `/api/stocks/${change.stockId}/adjust`,
        delta: change.delta,
        stockId: change.stockId,
      }));

      // Apply additions before subtractions so prepared-stock guards see the net-safe intermediate state.
      operations.sort((left, right) => Number(left.delta < 0) - Number(right.delta < 0));
      for (const operation of operations) {
        try {
          const response = await fetch(operation.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ delta: operation.delta, reason: '手動調整' }),
          });
          if (!response.ok) { fail++; continue; }
          ok++;
          pending[id] = Math.round(((Number(pending[id]) || 0) - operation.delta) * 1000) / 1000;
          if (operation.stockId !== null) {
            const current = pendingByStock[operation.stockId];
            if (current) {
              current.delta = Math.round((current.delta - operation.delta) * 1000) / 1000;
              if (current.delta <= 0) delete pendingByStock[operation.stockId];
            }
          }
        } catch (error) {
          fail++;
        }
      }
    }

    Object.keys(pending).forEach(function(id) {
      const hasSelectedStock = Object.keys(pendingByStock).some(function(stockId) {
        return String(pendingByStock[stockId].itemId) === String(id);
      });
      if (Math.abs(Number(pending[id]) || 0) < 0.0005 && !hasSelectedStock) {
        delete pending[id];
        if (typeof INVENTORY_PENDING_ITEMS !== 'undefined') delete INVENTORY_PENDING_ITEMS[id];
      }
    });
    await loadData();
    if (fail === 0) toast(`✅ 已儲存 ${ok} 項庫存調整`, 'success');
    else toast(`⚠️ ${ok} 成功，${fail} 失敗——失敗調整已保留，可修正後再儲存`, 'error');
  } finally {
    savingAll = false;
    if (button) button.disabled = false;
  }
}
