// 庫存管理系統 - 庫存頁渲染（v8 拆分）

import { buildLocHTML, buildNoteHTML, buildQtyControl, buildThumb, mobileCardShell, photoSrc } from '../../components/card.js';
import { isMobileView } from '../../core/bottomsheet.js';
import { loadDestinations } from '../../core/data.js';
import { Qty } from '../../core/qty.js';
import { appState } from '../../core/state.js';
import { inventoryState } from './state.js';
import { esc, hasPerm, jsStr } from '../../core/utils.js';
import { buildInventoryItemActionMenu } from './actions.js';
import { updateSaveBar } from './adjust.js';
import { _allSelected, selectedStockIds } from './batch-location.js';
import { buildFilterPanel, getFilteredInventoryItems } from './filters.js';
import { closeInventoryStatusModal, getInventoryStatus, renderInventoryDashboard } from './status.js';

// filterBySearch / buildFilterPanel / renderInventory / 數量增減

// ========== 共用搜尋過濾（多詞 AND） ==========




// 從 ALL_ITEMS 建立廠牌與位置的 datalist 建議清單，並載入去向建議

export function buildDatalists(skipDestinationLoad) {
  const facetReady = appState.inventoryLoadedSite === appState.currentSite && appState.INVENTORY_FACETS;
  const brands = facetReady && Object.keys(appState.INVENTORY_FACETS.brands || {}).length
    ? Object.keys(appState.INVENTORY_FACETS.brands).sort()
    : [...new Set(appState.ALL_ITEMS.map(i => i.brand))].sort();
  const locs = facetReady && (appState.INVENTORY_FACETS.locations || []).length
    ? appState.INVENTORY_FACETS.locations
    : [...new Set(appState.ALL_ITEMS.flatMap(i => (i.stocks || []).map(s => s.location)))].sort();
  document.getElementById('brand-list').innerHTML = brands.map(b => `<option value="${esc(b)}">`).join('');
  document.getElementById('location-list').innerHTML = locs.map(l => `<option value="${esc(l)}">`).join('');
  if (!skipDestinationLoad && appState.destinationsLoadedSite !== appState.currentSite) loadDestinations();
}


// ========== 庫存頁渲染（Phase 5 重構版） ==========

export function renderInventory() {
  // 品項管理與出庫是不同權限：不可用 isViewer 代替 stockout，否則僅有出庫權限者在手機會看不到入口。
  const isViewer = !(hasPerm('item-mgmt') || hasPerm('stock-mgmt') || hasPerm('photo'));
  const canStockout = hasPerm('stockout');
  const content = document.getElementById('content');
  const list = getFilteredInventoryItems();

  // 顯示篩選面板
  var filterPanel = document.getElementById('filter-panel');
  if (filterPanel) filterPanel.style.display = '';

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
  const isM = isMobileView();
  const aggregateStats = typeof appState.INVENTORY_META !== 'undefined' ? appState.INVENTORY_META.stats : null;
  let html = renderInventoryDashboard(list, aggregateStats);
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
  const hasFilter = appState.currentBrands.length > 0 || appState.currentCategories.length > 0 || (search && search.value.trim());
  const clearButton = hasFilter ? '<button class="btn btn--secondary btn--md" onclick="Inventory.clearFilterPanel()">清除篩選</button>' : '';
  const addButton = isViewer ? '' : '<button class="btn btn--primary btn--md btn-add-inv" onclick="Inventory.openAddModal()">＋ 新增品項</button>';
  return `<div class="inventory-empty-state">
    <div class="inventory-empty-icon" aria-hidden="true">📦</div>
    <h2>${hasFilter ? '沒有符合條件的庫存品項' : '目前沒有庫存品項'}</h2>
    <p>${hasFilter ? '可以嘗試清除篩選或調整搜尋條件。' : '新增品項後，庫存與位置會在這裡集中管理。'}</p>
    <div class="inventory-empty-actions">${clearButton}${addButton}</div>
  </div>`;
}


function renderInventoryToolbar(list, isViewer) {
  const viewMode = localStorage.getItem('inventoryViewMode') || 'card';
  const isM = isMobileView();
  let h = '<div class="loc-export-bar">';
  if (inventoryState.batchMode) h += '<button class="btn btn--secondary btn--md btn-select-all" id="btn-select-toggle" onclick="Inventory.selectAllStocks()">' + (_allSelected() ? '☐ 取消全選' : '☑ 全選') + '</button>';
  h += '<span class="loc-export-count">共 ' + (appState.INVENTORY_META.total || list.length) + ' 項</span>';
  h += '<div class="view-toggle"><button onclick="Inventory.setInventoryView(\'table\')" class="chip chip--seg' + (viewMode === 'table' ? ' is-active' : '') + '">📊 表格</button><button onclick="Inventory.setInventoryView(\'card\')" class="chip chip--seg' + (viewMode === 'card' ? ' is-active' : '') + '">🃏 卡片</button></div>';
  if (!isViewer) h += '<button class="btn btn--primary btn--md btn-add-inv" onclick="Inventory.openAddModal()">＋ 新增</button>';
  if (isM) {
    h += '<div class="more-actions-wrap" data-role="more-actions"><button class="btn btn--secondary btn--md btn--icon" onclick="Inventory.toggleMoreActions()">⋮</button>';
    h += '<div class="more-actions-dropdown" id="moreActionsDropdown">';
    if (hasPerm('batch-loc-mgmt')) h += '<button onclick="Inventory.toggleBatchMode();Inventory.closeMoreActions()">📦 批次改位置</button>';
    h += '<button onclick="Inventory.openInventoryExportDialog();Inventory.closeMoreActions()">⬇️ 匯出庫存</button>';
    h += '</div></div>';
  } else {
    if (hasPerm('batch-loc-mgmt')) h += '<button class="btn btn--secondary btn--md btn-batch" id="batch-toggle" onclick="Inventory.toggleBatchMode()">📦 批次改位置</button>';
    h += '<button class="btn btn--export btn--md btn-export" onclick="Inventory.openInventoryExportDialog()">⬇️ 匯出庫存</button>';
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
  if (inventoryState.batchMode && hasPerm('batch-loc-mgmt')) h += '<th class="col-check"></th>';
  h += '<th class="col-thumb"></th><th>品項名稱</th><th>品牌</th><th>庫存</th><th>單位</th><th>位置</th><th>狀態</th><th>操作</th>';
  h += '</tr></thead><tbody>';
  Object.keys(byLoc).sort().forEach(loc => {
    byLoc[loc].forEach(i => {
      const status = getInventoryStatus(i);
      const display = status.qty;
      const displayStr = Qty.format(display, Qty.unitTypeOf(i.unit));
      const isZero = status.isOutOfStock;
      const isLow = status.isLowStock;
      const rowClass = isZero ? 'row-danger' : (isLow ? 'row-warn' : '');
      const statusHTML = isZero ? '<span class="status-danger">⛔ 缺貨</span>' : (isLow ? '<span class="status-warn">⚠ 低庫存</span>' : '<span class="status-ok">✓ 正常</span>');
      const stocks = i.stocks && i.stocks.length ? i.stocks : [{location: i.location || '未標示', note: i.note || ''}];
      const locStr = stocks.map(s => esc(s.location)).join(', ');
      const photoHTML = i.has_photo ? '<span class="cphoto"><img src="' + (i.thumbnail_url || photoSrc(i.id, 'thumbnail')) + '" alt="" onclick="Inventory.openPhotoLightbox(' + i.id + ')" title="點擊看大圖"></span>' : '<span class="cphoto"><span class="cphoto-empty">📷</span></span>';
      h += '<tr class="' + rowClass + '">';
      if (inventoryState.batchMode && hasPerm('batch-loc-mgmt')) h += '<td class="u-ta-center"><input type="checkbox" class="stock-checkbox" ' + (selectedStockIds.has(i.stocks && i.stocks.length ? i.stocks[0].id : 0) ? 'checked' : '') + ' onchange="Inventory.toggleStockSelect(' + i.id + ')"></td>';
      h += '<td class="photo-cell">' + photoHTML + '</td>';
      h += '<td class="col-name">' + esc(i.name) + (i.code ? '<br><small class="col-name-code">型號： ' + esc(i.code) + '</small>' : '') + '</td>';
      h += '<td>' + esc(i.brand) + '</td>';
      h += '<td class="col-qty ' + (isZero ? 'is-out' : (isLow ? 'is-low' : 'is-ok')) + '">' + displayStr + '</td>';
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
  const prepare = i.is_kit ? '' : '<button class="btn btn--prepare btn--sm btn-prepare" onclick="Stockout.openPrepareModal(' + i.id + ', event)">📤 待領出</button>';
  const out = '<button class="btn btn--out btn--sm btn-out" onclick="Stockout.openOutModal(' + i.id + ', event)">🚚 已領出</button>';
  return '<div class="' + (mobile ? 'm-card-actions' : 'inventory-stockout-actions') + '">' + prepare + out + '</div>';
}

function renderInventoryCard(list, isViewer, canStockout, isM) {
  const collapsedKey = 'hvac_collapsed_locs_' + (typeof appState.currentSite !== 'undefined' ? appState.currentSite : 'office');
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
    h += '<div class="section-title' + (locCollapsed ? ' is-collapsed' : '') + '" data-loc="' + esc(loc) + '" onclick="Inventory.toggleLoc(this, \'' + esc(jsStr(loc)) + '\')">';
    h += '<button class="collapse-btn" type="button" aria-label="折疊/展開">▾</button>';
    h += '<span class="loc">位置：' + esc(loc) + '</span><span>' + locItems.length + ' 項</span>';
    h += '</div>';
    h += '<div class="loc-group' + (locCollapsed ? ' is-collapsed' : '') + '" data-role="loc-group" data-loc="' + esc(loc) + '">';
    locItems.forEach(i => {
      const status = getInventoryStatus(i);
      const display = status.qty;
      const displayStr = Qty.format(display, Qty.unitTypeOf(i.unit));
      const isZero = status.isOutOfStock;
      const isLow = status.isLowStock;
      const delta = display - Number(i.qty || 0);
      const cardClass = isZero ? 'item-card danger' : (isLow ? 'item-card warn' : 'item-card');
      const prepared = i.prepared_qty || 0;
      const statusBadge = isZero ? '<span class="inventory-card-status status-out">⛔ 缺貨</span>' : (isLow ? '<span class="inventory-card-status status-low">⚠ 低庫存</span>' : '');
      if (isM) {
        const locs = (i.stocks && i.stocks.length ? i.stocks : [{location: i.location || '未標示', note: i.note || ''}]);
        const locStr = buildLocHTML(locs);
        const noteStr = buildNoteHTML(locs);
        h += mobileCardShell({
          reverted: false,
          // 手機外框不可再掛 desktop .item-card：該 class 是 flex row，會把底部 actions 擠到右側。
          cardClass: isZero ? 'danger' : (isLow ? 'warn' : ''),
          moreBtnHTML: isViewer ? '' : '<button class="more-btn" onclick="Inventory.openItemSheet(' + i.id + ')">⋯</button>',
          checkboxHTML: inventoryState.batchMode ? '<input type="checkbox" class="stock-checkbox" ' + (selectedStockIds.has(i.stocks && i.stocks.length ? i.stocks[0].id : 0) ? 'checked' : '') + ' onchange="Inventory.toggleStockSelect(\'item-' + i.id + '\')">' : '',
          thumb: buildThumb(i.id, i.has_photo, i.name, '📦', i.thumbnail_url),
          nameHTML: esc(i.brand || '無廠牌') + ' ' + esc(i.name || '未命名') + (i.site === 'warehouse' ? ' 🏭' : ''),
          subHTML: (prepared > 0 ? '<span class="m-tag green">待領出 ' + prepared + '</span> ' : '') + (i.code ? '<span class="inventory-mobile-model">型號： ' + esc(i.code) + '</span>' : ''),
          extraHTML: locStr,
          noteHTML: noteStr,
          qtyHTML: buildQtyControl({id: i.id, display: displayStr, unit: i.unit, isZero, delta, viewer: isViewer}),
          actionsHTML: buildInventoryStockoutActions(i, canStockout, true)
        });
      } else {
        const stocks = i.stocks && i.stocks.length ? i.stocks : [{id: null, location: i.location || '', qty: i.qty, note: i.note || ''}];
        const locHtml = buildLocHTML(stocks);
        const noteHtml = buildNoteHTML(stocks);
        h += '<div class="' + cardClass + '" id="card-' + i.id + '"' + (inventoryState.batchMode ? ' data-batch="1"' : '') + '>';
        if (inventoryState.batchMode) h += '<input type="checkbox" class="stock-checkbox" ' + (selectedStockIds.has(i.stocks && i.stocks.length ? i.stocks[0].id : 0) ? 'checked' : '') + ' onchange="Inventory.toggleStockSelect(\'item-' + i.id + '\')">';
        if (i.has_photo) h += '<img class="item-photo" src="' + (i.thumbnail_url || photoSrc(i.id, 'thumbnail')) + '" alt="' + esc(i.name) + '" loading="lazy" onclick="Inventory.openPhotoLightbox(' + i.id + ')" title="點擊看大圖" onerror="this.style.display=\'none\'">';
        else h += '<span class="item-photo item-photo-empty" aria-hidden="true">📷</span>';
        h += '<div class="item-info"' + (isViewer ? '' : ' onclick="Inventory.openEditModal(' + i.id + ')"') + '>';
        h += '<div class="item-name">' + esc(i.brand || '無廠牌') + ' ' + (esc(i.name) || '—') + (i.site === 'warehouse' ? '<span class="site-badge wh">🏭 倉庫</span>' : '') + statusBadge + '</div>';
        h += '<div class="item-code">' + (i.code ? '型號： ' + esc(i.code) : '') + '</div>';
        h += locHtml;
        h += noteHtml;
        if (i.is_kit) h += '<div class="kit-tag">🔧 整組</div>';
        if (prepared > 0) h += '<div class="prepared-tag">📤 待領出 ' + (Qty.format(prepared, Qty.unitTypeOf(i.unit))) + ' ' + esc(i.unit) + '</div>';
        h += '</div>';
        h += buildInventoryStockoutActions(i, canStockout, false);
        if (!isViewer) h += '<div class="item-card-admin-actions"><button class="btn btn--secondary btn--sm edit-btn" onclick="Inventory.openEditModal(' + i.id + ')" title="\u7de8\u8f2f\u54c1\u9805">\u7de8\u8f2f</button><button class="btn btn--danger btn--sm del-btn" onclick="Inventory.deleteItem(' + i.id + ')" title="\u522a\u9664\u6750\u6599">\u522a\u9664</button></div>';
        if (isViewer) {
          h += '<div class="qty-control"><div class="qty-value is-readonly" title="唯讀">' + displayStr + '<span class="unit"> ' + esc(i.unit) + '</span></div></div>';
        } else {
          h += '<div class="qty-control"><button class="qty-btn qty-minus" onclick="Inventory.changeQty(' + i.id + ', -1)"' + (isZero && delta <= 0 ? ' disabled' : '') + '>−</button><div class="qty-value" onclick="Inventory.quickSet(' + i.id + ')" title="點數字可輸入">' + displayStr + '<span class="unit"> ' + esc(i.unit) + '</span></div><button class="qty-btn qty-plus" onclick="Inventory.changeQty(' + i.id + ', 1)">+</button></div>';
        }
        h += '</div>';
      }
    });
    h += '</div>';
  });
  return h;
}

function renderInventoryPagination() {
  const totalPages = Math.ceil((appState.INVENTORY_META.total || 0) / (appState.INVENTORY_META.page_size || 50));
  if (totalPages <= 1) return '';
  const current = appState.INVENTORY_META.page || 1;
  let h = '<div class="inventory-pagination">';
  h += '<button type="button" class="btn btn--secondary btn--sm" onclick="Data.changeInventoryPage(' + (current - 1) + ')"' + (current <= 1 ? ' disabled' : '') + '>上一頁</button>';
  h += '<span>第 ' + current + ' / ' + totalPages + ' 頁</span>';
  h += '<button type="button" class="btn btn--secondary btn--sm" onclick="Data.changeInventoryPage(' + (current + 1) + ')"' + (current >= totalPages ? ' disabled' : '') + '>下一頁</button>';
  return h + '</div>';
}


export function setInventoryView(mode) {
  localStorage.setItem('inventoryViewMode', mode);
  renderInventory();
}





// ========== 位置折疊/展開（點位置標題最左邊箭頭） ==========

// 狀態存 localStorage（per site），登出時清除還原預設展開

export function toggleLoc(titleEl, loc) {

  const collapsedKey = 'hvac_collapsed_locs_' + (typeof appState.currentSite !== 'undefined' ? appState.currentSite : 'office');

  let arr = [];

  try { arr = JSON.parse(localStorage.getItem(collapsedKey) || '[]') || []; } catch (e) { arr = []; }

  const idx = arr.indexOf(loc);

  const nowCollapsed = idx < 0;

  if (nowCollapsed) arr.push(loc); else arr.splice(idx, 1);

  try { localStorage.setItem(collapsedKey, JSON.stringify(arr)); } catch (e) {}

  if (titleEl) titleEl.classList.toggle('is-collapsed', nowCollapsed);

  try {

    const groups = document.querySelectorAll('[data-role="loc-group"][data-loc="' + CSS.escape(loc) + '"]');

    groups.forEach(g => g.classList.toggle('is-collapsed', nowCollapsed));

  } catch (e) {}

}
