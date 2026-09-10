// 庫存管理系統 - API 呼叫層（v8 拆分）
// loadData / updateSubInfo / loadDestinations / saveAll / exportExcel
async function loadData(options) {
  const full = Boolean(options && options.full);
  const requestId = ++dataRequestSeq;
  if (dataAbortController) dataAbortController.abort();
  if (!full && currentTab === 'inventory') {
    await loadInventoryPage(INVENTORY_META.page || 1);
    return;
  }
  const controller = new AbortController();
  dataAbortController = controller;
  const siteAtRequest = currentSite;
  try {
    const skipItems = !full && ['calendar', 'signed-reports', 'quotation'].indexOf(currentTab) >= 0;
    if (skipItems) {
      if (requestId !== dataRequestSeq || siteAtRequest !== currentSite) return;
      ALL_ITEMS = [];
      fullItemsLoadedSite = '';
      updateNotifications();
      updateSubInfo();
      if (currentTab !== 'signed-reports' && currentTab !== 'quotation') switchTab(currentTab);
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
async function loadInventoryPage(page) {
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
    const [res, facetsRes] = await Promise.all([
      fetch(`/api/items?${params}`, { signal: controller.signal }),
      fetch(`/api/items/facets?site=${encodeURIComponent(siteAtRequest)}`, { signal: controller.signal }),
    ]);
    if (!res.ok) throw new Error('庫存列表 API 錯誤: ' + res.status);
    const body = await res.json();
    const facets = facetsRes.ok ? await facetsRes.json() : null;
    if (requestId !== inventoryRequestSeq || siteAtRequest !== currentSite) return;
    ALL_ITEMS = body.items || [];
    INVENTORY_ITEMS = ALL_ITEMS;
    INVENTORY_META = {
      page: body.page || pageAtRequest,
      page_size: body.page_size || 50,
      total: body.total || 0,
    };
    if (facets) INVENTORY_FACETS = facets;
    inventoryLoadedSite = siteAtRequest;
    fullItemsLoadedSite = '';
    buildDatalists();
    buildFilterPanel();
    checkReminder();
    updateNotifications();
    updateSubInfo();
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
    };
    const current = ALERTS_BY_SITE[currentSite] || ALERTS_BY_SITE.all;
    document.getElementById('sub-info').textContent =
      `單一材料 ${current.single_items} 項 · 整組 ${current.kit_items} 組 · ${current.brands} 種廠牌 · 缺貨 ${current.zero_stock} 項`;
    const officeStats = ALERTS_BY_SITE.office;
    const warehouseStats = ALERTS_BY_SITE.warehouse;
    document.getElementById('site-office-sub').textContent =
      `${officeStats.total_items} 項 · ${officeStats.total_qty}`;
    document.getElementById('site-warehouse-sub').textContent =
      `${warehouseStats.total_items} 項 · ${warehouseStats.total_qty}`;
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

// 將 pending 暫存的所有數量調整逐筆送出（POST /api/items/{id}/adjust），成功後重載資料
let savingAll = false;  // in-flight 旗標：防止連點「全部儲存」重複送出同一批調整
async function saveAll() {
  if (savingAll) return;
  const ids = Object.keys(pending);
  if (!ids.length) return;
  savingAll = true;
  const btn = document.getElementById('btn-save');
  if (btn) btn.disabled = true;
  let ok = 0, fail = 0;
  const failed = [];  // 2026-08-14 P4-2：失敗的調整 id 保留（不靜默丟失）
  try {
    for (const id of ids) {
      try {
        const res = await fetch(`/api/items/${id}/adjust`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ delta: pending[id], reason: '手動調整' })
        });
        if (res.ok) ok++;
        else { fail++; failed.push(id); }
      } catch (e) { fail++; failed.push(id); }
    }
    // 2026-08-14 P4-2：只保留失敗的 pending（併發被他人先扣 400 的調整可修正後再存）
    if (failed.length) {
      const kept = {};
      failed.forEach(id => { kept[id] = pending[id]; });
      pending = kept;
    } else {
      pending = {};
    }
    await loadData();
    if (fail === 0) toast(`✅ 已儲存 ${ok} 項變更`, 'success');
    else toast(`⚠️ ${ok} 成功，${fail} 失敗——失敗的調整已保留，可修正後再儲存`, 'error');
  } finally {
    savingAll = false;
    if (btn) btn.disabled = false;
  }
}

// 向 /api/export 索取 Excel 報表並觸發瀏覽器下載，成功/失敗各顯示 toast
function exportExcel() {
  toast('⏳ 產生報表中…');
  fetch('/api/export').then(r => {
    if (!r.ok) throw new Error();
    return r.blob();
  }).then(blob => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const ts = new Date();
    const pad = n => String(n).padStart(2, '0');
    a.download = `庫存報表_${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}_${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
    toast('✅ 報表已下載', 'success');
  }).catch(() => toast('匯出失敗', 'error'));
}
