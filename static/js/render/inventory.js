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

  const brands = [...new Set(ALL_ITEMS.map(i => i.brand))].sort();

  const locs = [...new Set(ALL_ITEMS.flatMap(i => (i.stocks || []).map(s => s.location)))].sort();

  document.getElementById('brand-list').innerHTML = brands.map(b => `<option value="${esc(b)}">`).join('');

  document.getElementById('location-list').innerHTML = locs.map(l => `<option value="${esc(l)}">`).join('');

  loadDestinations();

}



// ========== 庫存頁渲染（Phase 5 重構版） ==========

function renderInventory() {
  // 品項管理與出庫是不同權限：不可用 isViewer 代替 stockout，否則僅有出庫權限者在手機會看不到入口。
  const isViewer = !(hasPerm('item-mgmt') || hasPerm('stock-mgmt') || hasPerm('photo'));
  const canStockout = hasPerm('stockout');
  let list = getFilteredInventoryItems();
  const content = document.getElementById('content');
  if (!list.length) {
    content.innerHTML = '<div class="empty">沒有符合的品項 🔍</div>';
    updateSaveBar();
    return;
  }
  const viewMode = localStorage.getItem('inventoryViewMode') || 'card';
  const isM = (typeof isMobileView === 'function') && isMobileView();
  let html = renderInventoryDashboard(list);
  buildFilterPanel();
  html += renderInventoryToolbar(list, isViewer);
  if (viewMode === 'table') {
    html += renderInventoryTable(list, isViewer, canStockout);
  } else {
    html += renderInventoryCard(list, isViewer, canStockout, isM);
  }
  content.innerHTML = html;
  updateSaveBar();
}

function renderInventoryDashboard(list) {
  const totalQty = list.reduce((s, i) => s + (i.stocks || []).reduce((ss, st) => ss + (st.qty || 0), 0), 0);
  const lowCount = list.filter(i => i.low_stock > 0 && i.qty <= i.low_stock).length;
  const zeroCount = list.filter(i => !i.is_kit && i.qty <= 0).length;
  return '<div class="dash-cards">' +
    '<div class="dash-card"><div class="dc-num">' + list.length + '</div><div class="dc-lbl">篩選品項</div></div>' +
    '<div class="dash-card"><div class="dc-num">' + totalQty + '</div><div class="dc-lbl">庫存總數</div></div>' +
    '<div class="dash-card' + (lowCount > 0 ? ' warn' : '') + '"><div class="dc-num">' + lowCount + '</div><div class="dc-lbl">低庫存</div></div>' +
    '<div class="dash-card' + (zeroCount > 0 ? ' danger' : '') + '"><div class="dc-num">' + zeroCount + '</div><div class="dc-lbl">缺貨</div></div>' +
    '</div>';
}

function renderInventoryChips() {
  const brands = [...new Set(ALL_ITEMS.filter(i => !i.is_kit).map(i => i.brand || '無廠牌'))].sort();
  const cats = [...new Set(ALL_ITEMS.filter(i => !i.is_kit).map(i => i.category || '').filter(Boolean))].sort();
  let h = '<div class="chip-bar">';
  h += '<span class="chip' + (currentBrands.length === 0 ? ' on' : '') + '" onclick="toggleInventoryBrand(\'\')">全部廠牌</span>';
  brands.forEach(b => { h += '<span class="chip' + (currentBrands.includes(b) ? ' on' : '') + '" onclick="toggleInventoryBrand(\'' + b.replace(/'/g, "\\'") + '\')">' + esc(b) + '</span>'; });
  h += '</div>';
  h += '<div class="chip-bar">';
  h += '<span class="chip' + (currentCategories.length === 0 ? ' on' : '') + '" onclick="toggleInventoryCategory(\'\')">全部分類</span>';
  cats.forEach(c => { h += '<span class="chip' + (currentCategories.includes(c) ? ' on' : '') + '" onclick="toggleInventoryCategory(\'' + c.replace(/'/g, "\\'") + '\')">' + esc(c) + '</span>'; });
  h += '</div>';
  return h;
}

function renderInventoryToolbar(list, isViewer) {
  const viewMode = localStorage.getItem('inventoryViewMode') || 'card';
  const isM = (typeof isMobileView === 'function') && isMobileView();
  let h = '<div class="loc-export-bar">';
  h += '<span class="loc-export-count">共 ' + list.length + ' 項</span>';
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
  if (batchMode) h += '<button class="btn-sm btn-select-all" id="btn-select-toggle" onclick="selectAllStocks()">' + (_allSelected() ? '☐ 取消全選' : '☑ 全選') + '</button>';
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
      const delta = pending[i.id] || 0;
      const display = Math.round((i.qty + delta) * 1000) / 1000;
      const isZero = display <= 0;
      const isLow = i.low_stock > 0 && display > 0 && display <= i.low_stock;
      const rowClass = isZero ? 'row-danger' : (isLow ? 'row-warn' : '');
      const statusHTML = isZero ? '<span class="status-danger">⛔ 缺貨</span>' : (isLow ? '<span class="status-warn">⚠ 低庫存</span>' : '<span class="status-ok">✓ 正常</span>');
      const stocks = i.stocks && i.stocks.length ? i.stocks : [{location: i.location || '未標示', note: i.note || ''}];
      const locStr = stocks.map(s => esc(s.location)).join(', ');
      const photoHTML = i.has_photo ? '<span class="cphoto"><img src="/uploads/' + i.id + '.jpg" alt="" onclick="openPhotoLightbox(' + i.id + ')" title="點擊看大圖"></span>' : '<span class="cphoto"><span class="cphoto-empty">📷</span></span>';
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
      if (!isViewer) {
        h += '<button onclick="openEditModal(' + i.id + ')" title="編輯">✏️</button> ';
        h += '<button onclick="deleteItem(' + i.id + ')" title="刪除">🗑️</button>';
      }
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
    h += '<div class="section-title' + (locCollapsed ? ' collapsed' : '') + '" data-loc="' + esc(loc) + '" onclick="toggleLoc(this, \'' + esc(loc) + '\')">';
    h += '<button class="collapse-btn" type="button" aria-label="折疊/展開">▾</button>';
    h += '<span class="loc">位置：' + esc(loc) + '</span><span>' + locItems.length + ' 項</span>';
    h += '</div>';
    h += '<div class="loc-group' + (locCollapsed ? ' collapsed' : '') + '" data-loc="' + esc(loc) + '">';
    locItems.forEach(i => {
      const delta = pending[i.id] || 0;
      const display = Math.round((i.qty + delta) * 1000) / 1000;
      const isZero = display <= 0;
      const isLow = i.low_stock > 0 && display > 0 && display <= i.low_stock;
      const cardClass = isZero ? 'item-card danger' : (isLow ? 'item-card warn' : 'item-card');
      const prepared = i.prepared_qty || 0;
      if (isM) {
        const locs = (i.stocks && i.stocks.length ? i.stocks : [{location: i.location || '未標示', note: i.note || ''}]);
        const locStr = buildLocHTML(locs);
        h += mobileCardShell({
          reverted: false,
          // 手機外框不可再掛 desktop .item-card：該 class 是 flex row，會把底部 actions 擠到右側。
          cardClass: isZero ? 'danger' : (isLow ? 'warn' : ''),
          moreBtnHTML: isViewer ? '' : '<button class="more-btn" onclick="openItemSheet(' + i.id + ')">⋯</button>',
          checkboxHTML: batchMode ? '<input type="checkbox" class="stock-checkbox" ' + (selectedStockIds.has(i.stocks && i.stocks.length ? i.stocks[0].id : 0) ? 'checked' : '') + ' onchange="toggleStockSelect(\'item-' + i.id + '\')">' : '',
          thumb: buildThumb(i.id, i.has_photo, i.name, '📦'),
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
        if (i.has_photo) h += '<img class="item-photo" src="/uploads/' + i.id + '.jpg" alt="' + esc(i.name) + '" loading="lazy" onclick="openPhotoLightbox(' + i.id + ')" title="點擊看大圖" onerror="this.style.display=\'none\'">';
        if (!isViewer) h += '<button class="edit-btn" onclick="openEditModal(' + i.id + ')" title="編輯品項">編輯</button><button class="del-btn" onclick="deleteItem(' + i.id + ')" title="刪除材料">刪除</button>';
        h += '<div class="item-info"' + (isViewer ? '' : ' onclick="openEditModal(' + i.id + ')"') + '>';
        h += '<div class="item-name">' + (esc(i.name) || '—') + (i.site === 'warehouse' ? '<span class="site-badge wh">🏭 倉庫</span>' : '') + '</div>';
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

  const actions = [];

  if (!isViewer) {

    actions.push({ icon: '✏️', label: '編輯品項', fn: () => openEditModal(itemId) });

    actions.push({ icon: '📷', label: '更換照片', fn: () => openEditModal(itemId) });

    actions.push({ icon: '🗑', label: '刪除品項', cls: 'del', fn: () => deleteItem(itemId) });

  }

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

  var brandCounts = {};

  ALL_ITEMS.filter(function(i) { return !i.is_kit; }).forEach(function(i) {

    var b = i.brand || '無廠牌';

    brandCounts[b] = (brandCounts[b] || 0) + 1;

  });

  var brands = Object.entries(brandCounts).sort(function(a, b) { return b[1] - a[1]; });

  document.getElementById('fp-brand-count').textContent = '(' + brands.length + ' 個品牌)';

  renderFilterChips('fp-brand-chips', brands, currentBrands, 'brand', 'fp-brand-toggle');

  var catCounts = {};

  ALL_ITEMS.filter(function(i) { return !i.is_kit; }).forEach(function(i) {

    var c = i.category || '';

    if (c) catCounts[c] = (catCounts[c] || 0) + 1;

  });

  var cats = Object.entries(catCounts).sort(function(a, b) { return b[1] - a[1]; });

  document.getElementById('fp-cat-count').textContent = '(' + cats.length + ' 類)';

  renderFilterChips('fp-cat-chips', cats, currentCategories, 'category', 'fp-cat-toggle');

  var list = getFilteredItems();

  document.getElementById('fp-summary').textContent = '共 ' + list.length + ' 項';

}



function renderFilterChips(containerId, counts, selectedArr, type, toggleBtnId) {

  var el = document.getElementById(containerId);

  el.innerHTML = '';
  el.classList.toggle('collapsed', !filterExpandedState[type]);

  var allChip = document.createElement('span');

  allChip.className = 'filter-chip' + (selectedArr.length === 0 ? ' active' : '');

  allChip.textContent = '全部';

  allChip.onclick = function() { selectedArr.length = 0; buildFilterPanel(); renderInventory(); };

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

      buildFilterPanel();

      renderInventory();

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

  buildFilterPanel();

  renderInventory();

}



// ========== 批次改位置（2026-09-06 方案 A） ==========
var batchMode = false;
var selectedStockIds = new Set();

function toggleBatchMode() {
  batchMode = !batchMode;
  selectedStockIds.clear();
  document.getElementById('batch-toggle').classList.toggle('active', batchMode);
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
  document.getElementById('batch-cabinet').value = '';
  document.getElementById('batch-sub').value = '';
  renderInventory();
}

function showBatchConfirm() {
  var cab = document.getElementById('batch-cabinet').value;
  if (!cab) { toast('\u26a0\ufe0f \u8acb\u5148\u9078\u64c7\u76ee\u6a19\u6ac3\u5b50'); return; }
  var sub = document.getElementById('batch-sub').value.trim();
  var target = sub ? cab + ' | ' + sub : cab;
  document.getElementById('batch-confirm-count').textContent = selectedStockIds.size;
  document.getElementById('batch-confirm-loc').textContent = target;
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
  var cab = document.getElementById('batch-cabinet').value;
  var sub = document.getElementById('batch-sub').value.trim();
  var target = sub ? cab + ' | ' + sub : cab;
  closeBatchConfirm();
  try {
    var res = await fetch('/api/stocks/batch-location', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stock_ids: Array.from(selectedStockIds), new_location: target })
    });
    if (!res.ok) {
      var err = await res.json();
      throw new Error(err.detail || '\u6279\u6b21\u66f4\u65b0\u5931\u6557');
    }
    toast('\u2705 \u5df2\u5c07 ' + selectedStockIds.size + ' \u7b0c\u4f4d\u7f6e\u6539\u70ba\u300c' + target + '\u300d');
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
  renderInventory();
}
function toggleInventoryCategory(cat) {
  if (!cat) { currentCategories = []; }
  else {
    var idx = currentCategories.indexOf(cat);
    if (idx >= 0) currentCategories.splice(idx, 1); else currentCategories.push(cat);
  }
  renderInventory();
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
document.addEventListener('click', function(e) {
  if (!e.target.closest('.more-actions-wrap')) closeMoreActions();
});