// 庫存管理系統 - 庫存頁渲染（v8 拆分）

// filterBySearch / buildFilterPanel / renderInventory / 數量增減

// ========== 共用搜尋過濾（多詞 AND） ==========

// 回傳符合當前搜尋 + 品牌 + 分類篩選的非整組品項（供全選 / render 共用）
function getFilteredInventoryItems() {
  var raw = document.getElementById('search-input').value.trim().toLowerCase();
  var kws = raw ? raw.split(/\s+/).filter(function(w) { return w.length > 0; }) : [];
  var list = ALL_ITEMS.filter(function(i) { return !i.is_kit; });
  if (currentBrands.length > 0) {
    list = list.filter(function(i) { return currentBrands.indexOf(i.brand || '無廠牌') >= 0; });
  }
  if (currentCategories.length > 0) {
    list = list.filter(function(i) { return currentCategories.indexOf(i.category || '') >= 0; });
  }
  if (kws.length > 0) {
    list = list.filter(function(i) {
      var stockStr = (i.stocks || []).map(function(s) { return s.location + ' ' + s.note; }).join(' ').toLowerCase();
      var hay = (i.name||'') + ' ' + (i.code||'') + ' ' + (i.brand||'') + ' ' + stockStr;
      hay = hay.toLowerCase();
      return kws.every(function(kw) { return hay.indexOf(kw) >= 0; });
    });
  }
  return list;
}

function filterBySearch(items, matchFn) {

  var raw = document.getElementById('search-input').value.trim().toLowerCase();

  var kws = raw ? raw.split(/\s+/).filter(function(w) { return w.length > 0; }) : [];

  if (kws.length === 0) return items;

  return items.filter(function(item) {

    var hay = matchFn(item).toLowerCase();

    return kws.every(function(kw) { return hay.indexOf(kw) >= 0; });

  });

}



// 從 ALL_ITEMS 建立廠牌與位置的 datalist 建議清單，並載入去向建議

function buildDatalists() {
  const facetReady = inventoryLoadedSite === currentSite && INVENTORY_FACETS;
  const brands = facetReady && Object.keys(INVENTORY_FACETS.brands || {}).length
    ? Object.keys(INVENTORY_FACETS.brands).sort()
    : [...new Set(ALL_ITEMS.map(i => i.brand))].sort();
  const locs = facetReady && (INVENTORY_FACETS.locations || []).length
    ? INVENTORY_FACETS.locations
    : [...new Set(ALL_ITEMS.flatMap(i => (i.stocks || []).map(s => s.location)))].sort();
  document.getElementById('brand-list').innerHTML = brands.map(b => `<option value="${esc(b)}">`).join('');
  document.getElementById('location-list').innerHTML = locs.map(l => `<option value="${esc(l)}">`).join('');
  if (destinationsLoadedSite !== currentSite) loadDestinations();
}


// ========== 庫存頁渲染（Phase 5 重構版） ==========

function renderInventory() {
  // 品項管理與出庫是不同權限：不可用 isViewer 代替 stockout，否則僅有出庫權限者在手機會看不到入口。
  const isViewer = !(hasPerm('item-mgmt') || hasPerm('stock-mgmt') || hasPerm('photo'));
  const canStockout = hasPerm('stockout');
  const content = document.getElementById('content');
  const list = getFilteredInventoryItems();

  // 篩選變更或數量暫存後重繪，避免清單顯示舊的 KPI 詳情。
  closeInventoryStatusModal();
  renderInventoryPageHeading();
  buildFilterPanel();

  if (!list.length) {
    content.innerHTML = renderInventoryEmptyState(isViewer);
    updateSaveBar();
    return;
  }

  const viewMode = localStorage.getItem('inventoryViewMode') || 'card';
  const isM = (typeof isMobileView === 'function') && isMobileView();
  let html = renderInventoryDashboard(list);
  html += renderInventoryToolbar(list, isViewer);
  if (viewMode === 'table') {
    html += renderInventoryTable(list, isViewer, canStockout);
  } else {
    html += renderInventoryCard(list, isViewer, canStockout, isM);
  }
  html += renderInventoryPagination();
  content.innerHTML = html;
  updateSaveBar();
}

function renderInventoryPageHeading() {
  const heading = document.getElementById('inventory-page-heading');
  if (!heading) return;
  heading.innerHTML = `
    <div class="inventory-heading-icon" aria-hidden="true">📦</div>
    <div>
      <h1>單一庫存</h1>
      <p>管理單一材料的庫存、位置與出庫狀態，快速掌握目前可用數量。</p>
    </div>`;
}

function renderInventoryEmptyState(isViewer) {
  const search = document.getElementById('search-input');
  const hasFilter = currentBrands.length > 0 || currentCategories.length > 0 || (search && search.value.trim());
  const clearButton = hasFilter ? '<button class="inventory-empty-secondary" onclick="clearFilterPanel()">清除篩選</button>' : '';
  const addButton = isViewer ? '' : '<button class="btn-add-inv" onclick="openAddModal()">＋ 新增品項</button>';
  return `<div class="inventory-empty-state">
    <div class="inventory-empty-icon" aria-hidden="true">📦</div>
    <h2>${hasFilter ? '沒有符合條件的庫存品項' : '目前沒有庫存品項'}</h2>
    <p>${hasFilter ? '可以嘗試清除篩選或調整搜尋條件。' : '新增品項後，庫存與位置會在這裡集中管理。'}</p>
    <div class="inventory-empty-actions">${clearButton}${addButton}</div>
  </div>`;
}


function formatInventoryQuantity(value) {
  const n = Number(value);
  if (!isFinite(n)) return '0';
  return (Math.round(n * 1000) / 1000).toLocaleString('en-US');
}

function getInventoryDisplayQty(item) {
  const delta = (typeof pending !== 'undefined' && pending[item.id]) || 0;
  return Math.round((Number(item.qty || 0) + Number(delta)) * 1000) / 1000;
}

// 單一庫存、KPI、卡片、表格與詳情清單共用既有判定語意。
function getInventoryStatus(item) {
  const qty = getInventoryDisplayQty(item);
  const isOutOfStock = !item.is_kit && qty <= 0;
  return {
    qty: qty,
    isOutOfStock: isOutOfStock,
    isLowStock: !isOutOfStock && item.low_stock > 0 && qty <= item.low_stock,
  };
}

function renderInventoryDashboard(list) {
  const totalQty = list.reduce((s, i) => s + getInventoryDisplayQty(i), 0);
  const lowCount = list.filter(i => getInventoryStatus(i).isLowStock).length;
  const zeroCount = list.filter(i => getInventoryStatus(i).isOutOfStock).length;
  return `<section class="inventory-kpi-grid" aria-label="庫存統計">
    <div class="inventory-kpi-card inventory-kpi-blue">
      <span class="inventory-kpi-icon" aria-hidden="true">📦</span>
      <div><div class="inventory-kpi-number">${list.length}</div><div class="inventory-kpi-label">篩選品項</div></div>
    </div>
    <div class="inventory-kpi-card inventory-kpi-purple">
      <span class="inventory-kpi-icon" aria-hidden="true">🗄️</span>
      <div><div class="inventory-kpi-number">${formatInventoryQuantity(totalQty)}</div><div class="inventory-kpi-label">庫存總數</div></div>
    </div>
    <button type="button" class="inventory-kpi-card inventory-kpi-low" onclick="showInventoryStatusList('low')" aria-label="查看低庫存商品">
      <span class="inventory-kpi-icon" aria-hidden="true">⚠</span>
      <div><div class="inventory-kpi-number">${lowCount}</div><div class="inventory-kpi-label">低庫存 <span class="inventory-kpi-action">查看清單</span></div></div>
    </button>
    <button type="button" class="inventory-kpi-card inventory-kpi-out" onclick="showInventoryStatusList('out')" aria-label="查看缺貨商品">
      <span class="inventory-kpi-icon" aria-hidden="true">⛔</span>
      <div><div class="inventory-kpi-number">${zeroCount}</div><div class="inventory-kpi-label">缺貨 <span class="inventory-kpi-action">查看清單</span></div></div>
    </button>
  </section>`;
}

function getInventoryStatusItems(type) {
  const isLow = type === 'low';
  return getFilteredInventoryItems()
    .filter(function(item) {
      const status = getInventoryStatus(item);
      return isLow ? status.isLowStock : status.isOutOfStock;
    })
    .slice()
    .sort(function(a, b) { return getInventoryStatus(a).qty - getInventoryStatus(b).qty; });
}

function renderInventoryStatusItem(item, type) {
  const status = getInventoryStatus(item);
  const isOut = status.isOutOfStock;
  const locStr = (item.stocks || []).map(function(stock) { return stock.location || '未標示'; }).join('、') || '未標示';
  const thumb = buildThumb(item.id, item.has_photo, item.name, '📦');
  const editAction = hasPerm('item-mgmt')
    ? `<button type="button" class="inventory-status-edit" onclick="closeInventoryStatusModal();openEditModal(${item.id})">編輯</button>`
    : '';
  const threshold = type === 'low' ? `<span class="inventory-status-meta">警示值 ${formatInventoryQuantity(item.low_stock)}</span>` : '';
  const badge = isOut
    ? '<span class="inventory-status-badge status-out">⛔ 缺貨</span>'
    : '<span class="inventory-status-badge status-low">⚠ 低庫存</span>';
  return `<article class="inventory-status-item ${isOut ? 'is-out' : 'is-low'}">
    <div class="inventory-status-thumb">${thumb}</div>
    <div class="inventory-status-info">
      <div class="inventory-status-name">${esc(item.name || '未命名')}</div>
      <div class="inventory-status-sub">${esc(item.brand || '無廠牌')}${item.code ? ' · 型號 ' + esc(item.code) : ''}</div>
      <div class="inventory-status-location">📍 ${esc(locStr)}</div>
    </div>
    <div class="inventory-status-values">
      ${badge}
      <strong>${formatInventoryQuantity(status.qty)} <small>${esc(item.unit || '')}</small></strong>
      ${threshold}
    </div>
    ${editAction}
  </article>`;
}

function showInventoryStatusList(type) {
  const modal = document.getElementById('inventory-status-modal');
  const body = document.getElementById('inventory-status-modal-body');
  if (!modal || !body) return;
  const isLow = type === 'low';
  const items = getInventoryStatusItems(type);
  const title = isLow ? '⚠ 低庫存商品' : '⛔ 缺貨商品';
  const empty = isLow ? '目前沒有低庫存商品' : '目前沒有缺貨商品';
  const intro = isLow ? '庫存數量已低於或等於目前警示值。' : '目前庫存為 0 或以下的單一庫存品項。';
  const listHTML = items.length
    ? items.map(function(item) { return renderInventoryStatusItem(item, type); }).join('')
    : `<div class="inventory-status-empty"><span aria-hidden="true">✓</span><strong>${empty}</strong><p>目前篩選條件下沒有符合的品項。</p></div>`;
  body.innerHTML = `<div class="inventory-status-header">
    <div><h2 id="inventory-status-modal-title">${title}</h2><p>${intro}</p></div>
    <button type="button" class="inventory-status-close" onclick="closeInventoryStatusModal()" aria-label="關閉">✕</button>
  </div>
  <div class="inventory-status-count">共 ${items.length} 項</div>
  <div class="inventory-status-list">${listHTML}</div>`;
  modal.classList.add('show');
  modal.setAttribute('aria-hidden', 'false');
}

function closeInventoryStatusModal() {
  const modal = document.getElementById('inventory-status-modal');
  if (!modal) return;
  modal.classList.remove('show');
  modal.setAttribute('aria-hidden', 'true');
}


function renderInventoryChips() {
  const brands = [...new Set(ALL_ITEMS.filter(i => !i.is_kit).map(i => i.brand || '無廠牌'))].sort();
  const cats = [...new Set(ALL_ITEMS.filter(i => !i.is_kit).map(i => i.category || '').filter(Boolean))].sort();
  let h = '<div class="chip-bar">';
  h += '<span class="chip' + (currentBrands.length === 0 ? ' on' : '') + '" onclick="toggleInventoryBrand(\'\')">全部廠牌</span>';
  brands.forEach(b => { h += '<span class="chip' + (currentBrands.includes(b) ? ' on' : '') + '" onclick="toggleInventoryBrand(\'' + esc(jsStr(b)) + '\')">' + esc(b) + '</span>'; });
  h += '</div>';
  h += '<div class="chip-bar">';
  h += '<span class="chip' + (currentCategories.length === 0 ? ' on' : '') + '" onclick="toggleInventoryCategory(\'\')">全部分類</span>';
  cats.forEach(c => { h += '<span class="chip' + (currentCategories.includes(c) ? ' on' : '') + '" onclick="toggleInventoryCategory(\'' + esc(jsStr(c)) + '\')">' + esc(c) + '</span>'; });
  h += '</div>';
  return h;
}

function getInventoryItemActions(itemId, isViewer, includePhoto) {
  if (isViewer) return [];
  const actions = [
    { key: 'edit', icon: '✏️', label: '編輯品項', fn: () => openEditModal(itemId) }
  ];
  if (includePhoto !== false) actions.push({ key: 'photo', icon: '📷', label: '更換照片', fn: () => openEditModal(itemId) });
  actions.push({ key: 'delete', icon: '🗑', label: '刪除品項', cls: 'del', fn: () => deleteItem(itemId) });
  return actions;
}

function buildInventoryItemActionMenu(itemId, isViewer) {
  const actions = getInventoryItemActions(itemId, isViewer, false);
  if (!actions.length) return '';
  const buttons = actions.map(a => {
    const command = a.key === 'edit' ? 'openEditModal(' + itemId + ')' : 'deleteItem(' + itemId + ')';
    return '<button class="inventory-action-item' + (a.cls ? ' ' + a.cls : '') + '" onclick="' + command + ';closeInventoryActionMenus()">' + a.icon + ' ' + a.label + '</button>';
  }).join('');
  return '<div class="inventory-action-menu"><button type="button" class="inventory-action-trigger" aria-label="更多操作" onclick="openInventoryActionMenu(this, event)">⋮</button><div class="inventory-action-dropdown">' + buttons + '</div></div>';
}

function renderInventoryToolbar(list, isViewer) {
  const viewMode = localStorage.getItem('inventoryViewMode') || 'card';
  const isM = (typeof isMobileView === 'function') && isMobileView();
  let h = '<div class="loc-export-bar">';
  if (batchMode) h += '<button class="btn-sm btn-select-all" id="btn-select-toggle" onclick="selectAllStocks()">' + (_allSelected() ? '☐ 取消全選' : '☑ 全選') + '</button>';
  h += '<span class="loc-export-count">共 ' + (INVENTORY_META.total || list.length) + ' 項</span>';
  h += '<div class="view-toggle"><button onclick="setInventoryView(\'table\')" class="' + (viewMode === 'table' ? 'active' : '') + '">📊 表格</button><button onclick="setInventoryView(\'card\')" class="' + (viewMode === 'card' ? 'active' : '') + '">🃏 卡片</button></div>';
  if (!isViewer) h += '<button class="btn-sm btn-add-inv" onclick="openAddModal()">＋ 新增</button>';
  if (isM) {
    h += '<div class="more-actions-wrap"><button class="btn-sm btn-more-actions" onclick="toggleMoreActions()">⋮</button>';
    h += '<div class="more-actions-dropdown" id="moreActionsDropdown">';
    if (hasPerm('batch-loc-mgmt')) h += '<button onclick="toggleBatchMode();closeMoreActions()">📦 批次改位置</button>';
    h += '<button onclick="exportExcel();closeMoreActions()">⬇️ 匯出庫存</button>';
    h += '</div></div>';
  } else {
    if (hasPerm('batch-loc-mgmt')) h += '<button class="btn-sm btn-batch" id="batch-toggle" onclick="toggleBatchMode()">📦 批次改位置</button>';
    h += '<button class="btn-sm btn-export" onclick="exportExcel()">⬇️ 匯出庫存</button>';
  }
  h += '</div>';
  return h;
}
function renderInventoryTable(list, isViewer, canStockout) {
  const byLoc = {};
  list.forEach(i => {
    const mainLoc = (i.stocks && i.stocks.length && i.stocks[0].location) || '未標示';
    (byLoc[mainLoc] = byLoc[mainLoc] || []).push(i);
  });
  let h = '<div class="tbl-wrap"><table class="data-table"><thead><tr>';
  if (batchMode && hasPerm('batch-loc-mgmt')) h += '<th style="width:30px"></th>';
  h += '<th style="width:44px"></th><th>品項名稱</th><th>品牌</th><th>庫存</th><th>單位</th><th>位置</th><th>狀態</th><th>操作</th>';
  h += '</tr></thead><tbody>';
  Object.keys(byLoc).sort().forEach(loc => {
    byLoc[loc].forEach(i => {
      const status = getInventoryStatus(i);
      const display = status.qty;
      const isZero = status.isOutOfStock;
      const isLow = status.isLowStock;
      const rowClass = isZero ? 'row-danger' : (isLow ? 'row-warn' : '');
      const statusHTML = isZero ? '<span class="status-danger">⛔ 缺貨</span>' : (isLow ? '<span class="status-warn">⚠ 低庫存</span>' : '<span class="status-ok">✓ 正常</span>');
      const stocks = i.stocks && i.stocks.length ? i.stocks : [{location: i.location || '未標示', note: i.note || ''}];
      const locStr = stocks.map(s => esc(s.location)).join(', ');
      const photoHTML = i.has_photo ? '<span class="cphoto"><img src="' + (i.thumbnail_url || photoSrc(i.id, 'thumbnail')) + '" alt="" onclick="openPhotoLightbox(' + i.id + ')" title="點擊看大圖"></span>' : '<span class="cphoto"><span class="cphoto-empty">📷</span></span>';
      h += '<tr class="' + rowClass + '">';
      if (batchMode && hasPerm('batch-loc-mgmt')) h += '<td style="text-align:center"><input type="checkbox" class="stock-checkbox" ' + (selectedStockIds.has(i.stocks && i.stocks.length ? i.stocks[0].id : 0) ? 'checked' : '') + ' onchange="toggleStockSelect(' + i.id + ')"></td>';
      h += '<td class="photo-cell">' + photoHTML + '</td>';
      h += '<td class="col-name">' + esc(i.name) + (i.code ? '<br><small style="color:#64748b">' + esc(i.code) + '</small>' : '') + '</td>';
      h += '<td>' + esc(i.brand) + '</td>';
      h += '<td class="col-qty" style="color:' + (isZero ? '#dc2626' : (isLow ? '#d97706' : '#16a34a')) + '">' + display + '</td>';
      h += '<td>' + esc(i.unit) + '</td>';
      h += '<td class="col-loc">' + locStr + '</td>';
      h += '<td class="col-status">' + statusHTML + '</td>';
      h += '<td class="col-actions">';
      h += buildInventoryStockoutActions(i, canStockout, false);
      h += buildInventoryItemActionMenu(i.id, isViewer);
      h += '</td></tr>';
    });
  });
  h += '</tbody></table></div>';
  return h;
}

// 單一庫存的待領出／已領出入口：卡片與表格共用，避免手機與桌面分支漂移。
function buildInventoryStockoutActions(i, canStockout, mobile) {
  if (!canStockout) return '';
  const prepare = i.is_kit ? '' : '<button class="btn-prepare" style="margin:0" onclick="openPrepareModal(' + i.id + ', event)">📤 待領出</button>';
  const out = '<button class="btn-out" style="margin:0" onclick="openOutModal(' + i.id + ', event)">🚚 已領出</button>';
  return '<div class="' + (mobile ? 'm-card-actions' : 'inventory-stockout-actions') + '">' + prepare + out + '</div>';
}

function renderInventoryCard(list, isViewer, canStockout, isM) {
  const collapsedKey = 'hvac_collapsed_locs_' + (typeof currentSite !== 'undefined' ? currentSite : 'office');
  let collapsedLocs = [];
  try { collapsedLocs = JSON.parse(localStorage.getItem(collapsedKey) || '[]') || []; } catch (e) { collapsedLocs = []; }
  const byLoc = {};
  list.forEach(i => {
    const mainLoc = (i.stocks && i.stocks.length && i.stocks[0].location) || '未標示';
    (byLoc[mainLoc] = byLoc[mainLoc] || []).push(i);
  });
  let h = '';
  Object.keys(byLoc).sort().forEach(loc => {
    const locItems = byLoc[loc];
    const locCollapsed = collapsedLocs.indexOf(loc) >= 0;
    h += '<div class="section-title' + (locCollapsed ? ' collapsed' : '') + '" data-loc="' + esc(loc) + '" onclick="toggleLoc(this, \'' + esc(jsStr(loc)) + '\')">';
    h += '<button class="collapse-btn" type="button" aria-label="折疊/展開">▾</button>';
    h += '<span class="loc">位置：' + esc(loc) + '</span><span>' + locItems.length + ' 項</span>';
    h += '</div>';
    h += '<div class="loc-group' + (locCollapsed ? ' collapsed' : '') + '" data-loc="' + esc(loc) + '">';
    locItems.forEach(i => {
      const status = getInventoryStatus(i);
      const display = status.qty;
      const isZero = status.isOutOfStock;
      const isLow = status.isLowStock;
      const delta = display - Number(i.qty || 0);
      const cardClass = isZero ? 'item-card danger' : (isLow ? 'item-card warn' : 'item-card');
      const prepared = i.prepared_qty || 0;
      const statusBadge = isZero ? '<span class="inventory-card-status status-out">⛔ 缺貨</span>' : (isLow ? '<span class="inventory-card-status status-low">⚠ 低庫存</span>' : '');
      if (isM) {
        const locs = (i.stocks && i.stocks.length ? i.stocks : [{location: i.location || '未標示', note: i.note || ''}]);
        const locStr = buildLocHTML(locs);
        h += mobileCardShell({
          reverted: false,
          // 手機外框不可再掛 desktop .item-card：該 class 是 flex row，會把底部 actions 擠到右側。
          cardClass: isZero ? 'danger' : (isLow ? 'warn' : ''),
          moreBtnHTML: isViewer ? '' : '<button class="more-btn" onclick="openItemSheet(' + i.id + ')">⋯</button>',
          checkboxHTML: batchMode ? '<input type="checkbox" class="stock-checkbox" ' + (selectedStockIds.has(i.stocks && i.stocks.length ? i.stocks[0].id : 0) ? 'checked' : '') + ' onchange="toggleStockSelect(\'item-' + i.id + '\')">' : '',
          thumb: buildThumb(i.id, i.has_photo, i.name, '📦', i.thumbnail_url),
          nameHTML: esc(i.name) + (i.site === 'warehouse' ? ' 🏭' : ''),
          subHTML: (prepared > 0 ? '<span class="chip green">待領出 ' + prepared + '</span> ' : '') + esc(i.brand) + (i.code ? ' · ' + esc(i.code) : ''),
          extraHTML: locStr,
          qtyHTML: buildQtyControl({id: i.id, display, unit: i.unit, isZero, delta, viewer: isViewer}),
          actionsHTML: buildInventoryStockoutActions(i, canStockout, true)
        });
      } else {
        const stocks = i.stocks && i.stocks.length ? i.stocks : [{id: null, location: i.location || '', qty: i.qty, note: i.note || ''}];
        const locHtml = buildLocHTML(stocks);
        h += '<div class="' + cardClass + '" id="card-' + i.id + '"' + (batchMode ? ' style="padding-left:32px"' : '') + '>';
        if (batchMode) h += '<input type="checkbox" class="stock-checkbox" ' + (selectedStockIds.has(i.stocks && i.stocks.length ? i.stocks[0].id : 0) ? 'checked' : '') + ' onchange="toggleStockSelect(\'item-' + i.id + '\')">';
        if (i.has_photo) h += '<img class="item-photo" src="' + (i.thumbnail_url || photoSrc(i.id, 'thumbnail')) + '" alt="' + esc(i.name) + '" loading="lazy" onclick="openPhotoLightbox(' + i.id + ')" title="點擊看大圖" onerror="this.style.display=\'none\'">';
        else h += '<span class="item-photo item-photo-empty" aria-hidden="true">📷</span>';
        if (!isViewer) h += '<button class="edit-btn" onclick="openEditModal(' + i.id + ')" title="編輯品項">編輯</button><button class="del-btn" onclick="deleteItem(' + i.id + ')" title="刪除材料">刪除</button>';
        h += '<div class="item-info"' + (isViewer ? '' : ' onclick="openEditModal(' + i.id + ')"') + '>';
        h += '<div class="item-name">' + (esc(i.name) || '—') + (i.site === 'warehouse' ? '<span class="site-badge wh">🏭 倉庫</span>' : '') + statusBadge + '</div>';
        h += '<div class="item-code">' + esc(i.brand) + (i.code ? ' · ' + esc(i.code) : '') + '</div>';
        h += locHtml;
        if (i.is_kit) h += '<div class="kit-tag">🔧 整組</div>';
        if (prepared > 0) h += '<div class="prepared-tag">📤 待領出 ' + prepared + ' ' + esc(i.unit) + '</div>';
        h += buildInventoryStockoutActions(i, canStockout, false);
        h += '</div>';
        if (isViewer) {
          h += '<div class="qty-control"><div class="qty-value" style="cursor:default" title="唯讀">' + display + '<span class="unit"> ' + esc(i.unit) + '</span></div></div>';
        } else {
          h += '<div class="qty-control"><button class="qty-btn qty-minus" onclick="changeQty(' + i.id + ', -1)"' + (isZero && delta <= 0 ? ' disabled' : '') + '>−</button><div class="qty-value" onclick="quickSet(' + i.id + ')" title="點數字可輸入">' + display + '<span class="unit"> ' + esc(i.unit) + '</span></div><button class="qty-btn qty-plus" onclick="changeQty(' + i.id + ', 1)">+</button></div>';
        }
        h += '</div>';
      }
    });
    h += '</div>';
  });
  return h;
}

function renderInventoryPagination() {
  const totalPages = Math.ceil((INVENTORY_META.total || 0) / (INVENTORY_META.page_size || 50));
  if (totalPages <= 1) return '';
  const current = INVENTORY_META.page || 1;
  let h = '<div class="inventory-pagination">';
  h += '<button type="button" onclick="changeInventoryPage(' + (current - 1) + ')"' + (current <= 1 ? ' disabled' : '') + '>上一頁</button>';
  h += '<span>第 ' + current + ' / ' + totalPages + ' 頁</span>';
  h += '<button type="button" onclick="changeInventoryPage(' + (current + 1) + ')"' + (current >= totalPages ? ' disabled' : '') + '>下一頁</button>';
  return h + '</div>';
}


function setInventoryView(mode) {
  localStorage.setItem('inventoryViewMode', mode);
  renderInventory();
}


// ========== 數量增減（暫存） ==========

function changeQty(id, delta) {

  const item = ALL_ITEMS.find(i => i.id === id);

  if (!item) return;

  const cur = pending[id] || 0;

  const newDelta = cur + delta;

  if (item.qty + newDelta < 0) return;

  if (newDelta === 0) delete pending[id];

  else pending[id] = newDelta;

  renderInventory();

}



// 點卡片數量數字 → prompt 輸入新數量，差異寫入 pending 暫存後重繪

function quickSet(id) {

  const item = ALL_ITEMS.find(i => i.id === id);

  if (!item) return;

  const cur = item.qty + (pending[id] || 0);

  const input = prompt(`輸入「${item.name}」的新數量：`, cur);

  if (input === null) return;

  const val = parseFloat(input);

  if (!isFinite(val) || val < 0) { toast('請輸入有效的數字', 'error'); return; }

  const newDelta = val - item.qty;

  if (newDelta === 0) delete pending[id];

  else pending[id] = newDelta;

  renderInventory();

}



// 依 pending 是否有未儲存變更，顯示/隱藏底部「儲存變更」列

function updateSaveBar() {

  const n = Object.keys(pending).length;

  const bar = document.getElementById('save-bar');

  if (n > 0 && currentTab === 'inventory') {

    bar.classList.add('show');

    document.getElementById('pending-count').textContent = n;

  } else {

    bar.classList.remove('show');

  }

}





// ========== 刪除材料（2026-08-11 Sarah 需求：每張卡片 ✕ 刪除整筆材料） ==========

async function deleteItem(itemId) {

  if (!confirm('確定刪除這個材料？會一併刪除它的庫存、照片與異動紀錄，無法恢復。')) return;

  try {

    const res = await fetch(`/api/items/${itemId}`, { method: 'DELETE' });

    if (!res.ok) {

      const e = await res.json().catch(() => ({}));

      alert(e.detail || '刪除失敗');

      return;

    }

    await loadData();

  } catch (e) { alert('刪除失敗：' + e.message); }

}





// ========== 手機版 ⋯ 動作選單（庫存卡） ==========

function openItemSheet(itemId) {

  const item = ALL_ITEMS.find(i => i.id === itemId);

  if (!item) return;

  const isViewer = !(hasPerm('item-mgmt') || hasPerm('stock-mgmt') || hasPerm('photo'));

  const actions = getInventoryItemActions(itemId, isViewer);

  openSheet(`${item.brand} ${item.name}`, actions);

}





// ========== 位置折疊/展開（點位置標題最左邊箭頭） ==========

// 狀態存 localStorage（per site），登出時清除還原預設展開

function toggleLoc(titleEl, loc) {

  const collapsedKey = 'hvac_collapsed_locs_' + (typeof currentSite !== 'undefined' ? currentSite : 'office');

  let arr = [];

  try { arr = JSON.parse(localStorage.getItem(collapsedKey) || '[]') || []; } catch (e) { arr = []; }

  const idx = arr.indexOf(loc);

  const nowCollapsed = idx < 0;

  if (nowCollapsed) arr.push(loc); else arr.splice(idx, 1);

  try { localStorage.setItem(collapsedKey, JSON.stringify(arr)); } catch (e) {}

  if (titleEl) titleEl.classList.toggle('collapsed', nowCollapsed);

  try {

    const groups = document.querySelectorAll('.loc-group[data-loc="' + CSS.escape(loc) + '"]');

    groups.forEach(g => g.classList.toggle('collapsed', nowCollapsed));

  } catch (e) {}

}



// ========== 篩選面板（品牌+分類 chips） ==========

var filterExpandedState = { brand: false, category: false };

function buildFilterPanel() {
  var brandCounts = INVENTORY_FACETS && INVENTORY_FACETS.brands && Object.keys(INVENTORY_FACETS.brands).length
    ? INVENTORY_FACETS.brands
    : {};
  if (!Object.keys(brandCounts).length) {
    ALL_ITEMS.filter(function(i) { return !i.is_kit; }).forEach(function(i) {
      var b = i.brand || '無廠牌';
      brandCounts[b] = (brandCounts[b] || 0) + 1;
    });
  }
  var brands = Object.entries(brandCounts).sort(function(a, b) { return b[1] - a[1]; });
  document.getElementById('fp-brand-count').textContent = '(' + brands.length + ' 個品牌)';
  renderFilterChips('fp-brand-chips', brands, currentBrands, 'brand', 'fp-brand-toggle');

  var catCounts = INVENTORY_FACETS && INVENTORY_FACETS.categories && Object.keys(INVENTORY_FACETS.categories).length
    ? INVENTORY_FACETS.categories
    : {};
  if (!Object.keys(catCounts).length) {
    ALL_ITEMS.filter(function(i) { return !i.is_kit; }).forEach(function(i) {
      var c = i.category || '';
      if (c) catCounts[c] = (catCounts[c] || 0) + 1;
    });
  }
  var cats = Object.entries(catCounts).sort(function(a, b) { return b[1] - a[1]; });
  document.getElementById('fp-cat-count').textContent = '(' + cats.length + ' 類)';
  renderFilterChips('fp-cat-chips', cats, currentCategories, 'category', 'fp-cat-toggle');
  var list = getFilteredItems();
  document.getElementById('fp-summary').textContent = '共 ' + (INVENTORY_META.total || list.length) + ' 項';
}


function renderFilterChips(containerId, counts, selectedArr, type, toggleBtnId) {

  var el = document.getElementById(containerId);

  el.innerHTML = '';
  el.classList.toggle('collapsed', !filterExpandedState[type]);

  var allChip = document.createElement('span');

  allChip.className = 'filter-chip' + (selectedArr.length === 0 ? ' active' : '');

  allChip.textContent = '全部';

  allChip.onclick = function() { selectedArr.length = 0; loadInventoryPage(1); };

  el.appendChild(allChip);

  counts.forEach(function(pair) {

    var name = pair[0], count = pair[1];

    var chip = document.createElement('span');

    var isSelected = selectedArr.includes(name);

    chip.className = 'filter-chip' + (isSelected ? ' active' : '');

    chip.innerHTML = esc(name) + ' <span class="badge">' + count + '</span>';

    chip.onclick = function() {

      var idx = selectedArr.indexOf(name);

      if (idx >= 0) selectedArr.splice(idx, 1);

      else selectedArr.push(name);

      loadInventoryPage(1);

    };

    el.appendChild(chip);

  });

  if (toggleBtnId) {

    var btn = document.getElementById(toggleBtnId);

    if (btn && el.classList.contains('collapsed')) {

      var hidden = counts.length - 3;

      if (hidden > 0) btn.textContent = '還有 ' + hidden + ' 個' + (type === 'brand' ? '品牌' : '分類') + ' ▼';

    }

  }

}



function getFilteredItems() {

  var raw = document.getElementById('search-input').value.trim().toLowerCase();

  var kws = raw ? raw.split(/\s+/).filter(function(w) { return w.length > 0; }) : [];

  var list = ALL_ITEMS.filter(function(i) { return !i.is_kit; });

  if (currentBrands.length > 0) list = list.filter(function(i) { return currentBrands.includes(i.brand || '無廠牌'); });

  if (currentCategories.length > 0) list = list.filter(function(i) { return currentCategories.includes(i.category || ''); });

  if (kws.length > 0) {

    list = list.filter(function(i) {

      var stockStr = (i.stocks || []).map(function(s) { return s.location + ' ' + s.note; }).join(' ').toLowerCase();

      var hay = ((i.name || '') + ' ' + (i.code || '') + ' ' + (i.brand || '') + ' ' + stockStr).toLowerCase();

      return kws.every(function(kw) { return hay.indexOf(kw) >= 0; });

    });

  }

  return list;

}



function toggleFilterCollapse(containerId, toggleBtnId) {

  var el = document.getElementById(containerId);

  var btn = document.getElementById(toggleBtnId);

  var isCollapsed = el.classList.toggle('collapsed');
  var filterType = containerId === 'fp-brand-chips' ? 'brand' : 'category';
  filterExpandedState[filterType] = !isCollapsed;

  btn.textContent = isCollapsed ? '展開 ▼' : '收合 ▲';

}



function clearFilterPanel() {
  currentBrands.length = 0;
  currentCategories.length = 0;
  document.getElementById('search-input').value = '';
  loadInventoryPage(1);
}


// ========== 批次改位置（2026-09-06 方案 A） ==========
var batchMode = false;
var selectedStockIds = new Set();

function toggleBatchMode() {
  batchMode = !batchMode;
  selectedStockIds.clear();
  var bt = document.getElementById('batch-toggle');
  if (bt) bt.classList.toggle('active', batchMode);
  document.getElementById('batch-num').textContent = 0;
  document.getElementById('batch-confirm').disabled = true;
  if (batchMode) {
    document.getElementById('batch-bar').classList.add('show');
  } else {
    document.getElementById('batch-bar').classList.remove('show');
  }
  renderInventory();
}

function toggleStockSelect(stockId) {
  // stockId 可能是 number 或 string，統一轉 number
  const numId = Number(stockId);
  if (String(stockId).startsWith('item-')) {
    // 整筆品項選取：切換該品項所有 stocks
    const itemId = parseInt(String(stockId).replace('item-', ''));
    const item = ALL_ITEMS.find(i => i.id === itemId);
    if (item) {
      const allSelected = (item.stocks || []).every(s => selectedStockIds.has(s.id));
      (item.stocks || []).forEach(s => {
        if (allSelected) selectedStockIds.delete(s.id);
        else selectedStockIds.add(s.id);
      });
    }
  } else {
    if (selectedStockIds.has(numId)) selectedStockIds.delete(numId);
    else selectedStockIds.add(numId);
  }
  _syncBatchUI();
}

function selectAllStocks() {
  // 全選/取消全選 toggle（尊重搜尋/品牌/分類篩選）
  const filtered = getFilteredInventoryItems();
  const allStocks = filtered.flatMap(i => i.stocks || []);
  const allSelected = allStocks.length > 0 && allStocks.every(s => selectedStockIds.has(s.id));
  if (allSelected) {
    selectedStockIds.clear();
  } else {
    allStocks.forEach(s => selectedStockIds.add(s.id));
  }
  _syncBatchUI();
}

function _allSelected() {
  const filtered = getFilteredInventoryItems();
  const allStocks = filtered.flatMap(i => i.stocks || []);
  return allStocks.length > 0 && allStocks.every(s => selectedStockIds.has(s.id));
}

function _syncBatchUI() {
  document.getElementById('batch-num').textContent = selectedStockIds.size;
  document.getElementById('batch-confirm').disabled = selectedStockIds.size === 0;
  document.getElementById('batch-bar').classList.toggle('show', selectedStockIds.size > 0);
  renderInventory();
}

function cancelBatch() {
  selectedStockIds.clear();
  document.getElementById('batch-bar').classList.remove('show');
  document.getElementById('batch-site').value = '';
  document.getElementById('batch-cabinet').value = '';
  document.getElementById('batch-sub').value = '';
  renderInventory();
}

function showBatchConfirm() {
  var site = document.getElementById('batch-site').value;
  if (!site) { toast('請先選擇目標場所'); return; }
  var cab = document.getElementById('batch-cabinet').value;
  if (!cab) { toast('\u26a0\ufe0f \u8acb\u5148\u9078\u64c7\u76ee\u6a19\u6ac3\u5b50'); return; }
  var sub = document.getElementById('batch-sub').value.trim();
  var target = sub ? cab + ' | ' + sub : cab;
  var siteLabel = site === 'warehouse' ? '🏭 倉庫' : '🏢 辦公室';
  var targetDisplay = siteLabel + '／' + target;
  document.getElementById('batch-confirm-count').textContent = selectedStockIds.size;
  document.getElementById('batch-confirm-loc').textContent = targetDisplay;
  var details = [];
  ALL_ITEMS.forEach(function(item) {
    (item.stocks || []).forEach(function(s) {
      if (selectedStockIds.has(s.id)) {
        details.push('<div class="modal-item-row"><span>' + esc(item.brand) + ' ' + esc(item.name) + '</span><span style="color:#999">' + esc(s.location) + ' \u2192 <b style="color:#2d5a8e">' + esc(target) + '</b></span></div>');
      }
    });
  });
  document.getElementById('batch-confirm-items').innerHTML = details.join('');
  document.getElementById('batch-confirm-modal').classList.add('show');
}

function closeBatchConfirm() {
  document.getElementById('batch-confirm-modal').classList.remove('show');
}

async function submitBatchLocation() {
  var site = document.getElementById('batch-site').value;
  if (!site) { toast('請先選擇目標場所'); return; }
  var cab = document.getElementById('batch-cabinet').value;
  var sub = document.getElementById('batch-sub').value.trim();
  var target = sub ? cab + ' | ' + sub : cab;
  var siteLabel = site === 'warehouse' ? '🏭 倉庫' : '🏢 辦公室';
  var targetDisplay = siteLabel + '／' + target;
  closeBatchConfirm();
  try {
    var res = await fetch('/api/stocks/batch-location', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stock_ids: Array.from(selectedStockIds), new_location: target, new_site: site })
    });
    if (!res.ok) {
      var err = await res.json();
      throw new Error(err.detail || '\u6279\u6b21\u66f4\u65b0\u5931\u6557');
    }
    toast('\u2705 \u5df2\u5c07 ' + selectedStockIds.size + ' \u7b0c\u4f4d\u7f6e\u6539\u70ba\u300c' + targetDisplay + '\u300d');
    cancelBatch();
    await loadData();
  } catch (e) {
    toast('\u26a0\ufe0f ' + e.message, 'error');
  }
}


// ========== Chip 篩選 toggler ==========
function toggleInventoryBrand(brand) {
  if (!brand) { currentBrands = []; }
  else {
    var idx = currentBrands.indexOf(brand);
    if (idx >= 0) currentBrands.splice(idx, 1); else currentBrands.push(brand);
  }
  loadInventoryPage(1);
}
function toggleInventoryCategory(cat) {
  if (!cat) { currentCategories = []; }
  else {
    var idx = currentCategories.indexOf(cat);
    if (idx >= 0) currentCategories.splice(idx, 1); else currentCategories.push(cat);
  }
  loadInventoryPage(1);
}


// ========== 手機版更多操作選單 ==========
function toggleMoreActions() {
  var dd = document.getElementById('moreActionsDropdown');
  if (dd) dd.classList.toggle('open');
}
function closeMoreActions() {
  var dd = document.getElementById('moreActionsDropdown');
  if (dd) dd.classList.remove('open');
}
function openInventoryActionMenu(button, event) {
  if (event) event.stopPropagation();
  document.querySelectorAll('.inventory-action-dropdown.open').forEach(function(el) { el.classList.remove('open'); });
  var menu = button && button.parentElement ? button.parentElement.querySelector('.inventory-action-dropdown') : null;
  if (menu) menu.classList.toggle('open');
}
function closeInventoryActionMenus() {
  document.querySelectorAll('.inventory-action-dropdown.open').forEach(function(el) { el.classList.remove('open'); });
}
document.addEventListener('click', function(e) {
  if (!e.target.closest('.more-actions-wrap')) closeMoreActions();
  if (!e.target.closest('.inventory-action-menu')) closeInventoryActionMenus();
});
