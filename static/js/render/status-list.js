// 共用商品 / 庫存異常清單 renderer
// 只負責 Dialog、搜尋/位置 filter 與呈現；不處理庫存計算或 API mutation。

// 2026-09-12：有 Qty 且知單位時依單位類型顯示（分數單位顯示 3/4 而非 0.75）；缺時維持舊行為
function statusListFormatQuantity(value, unit) {
  if (typeof Qty !== 'undefined' && unit) return Qty.format(value, Qty.unitTypeOf(unit));
  const number = Number(value);
  if (!Number.isFinite(number)) return '0';
  return (Math.round(number * 1000) / 1000).toLocaleString('en-US');
}

function statusListLocations(item) {
  const stocks = Array.isArray(item && item.stocks) ? item.stocks : [];
  const locations = stocks.map(function(stock) { return stock.location || '未標示'; }).filter(Boolean);
  if (locations.length) return [...new Set(locations)];
  return item && item.location ? [item.location] : ['未標示'];
}

function statusListFilteredItems() {
  const state = typeof STATUS_LIST_CONTEXT !== 'undefined' ? STATUS_LIST_CONTEXT : null;
  if (!state) return [];
  const query = String(state.search || '').trim().toLowerCase();
  return state.items.filter(function(item) {
    const text = state.getSearchText ? state.getSearchText(item) : '';
    const matchesSearch = !query || String(text || '').toLowerCase().includes(query);
    const matchesLocation = !state.location || statusListLocations(item).includes(state.location);
    return matchesSearch && matchesLocation;
  });
}

function renderSharedStatusListModal() {
  const state = typeof STATUS_LIST_CONTEXT !== 'undefined' ? STATUS_LIST_CONTEXT : null;
  const body = document.getElementById('inventory-status-modal-body');
  if (!state || !body) return;

  const items = statusListFilteredItems();
  const locations = [...new Set(state.items.reduce(function(all, item) {
    return all.concat(statusListLocations(item));
  }, []))].sort();
  const countText = items.length === state.items.length
    ? `共 ${items.length} 項`
    : `顯示 ${items.length} / ${state.items.length} 項`;
  const locationFilter = locations.length > 1 ? `<label class="status-list-location">位置
      <select onchange="setSharedStatusListLocation(this.value)">
        <option value="">全部位置</option>
        ${locations.map(function(location) {
          const selected = state.location === location ? ' selected' : '';
          return `<option value="${esc(location)}"${selected}>${esc(location)}</option>`;
        }).join('')}
      </select>
    </label>` : '';
  const rows = items.length
    ? items.map(function(item) { return state.renderItem(item); }).join('')
    : `<div class="inventory-status-empty status-list-empty"><span aria-hidden="true">✓</span><strong>${esc(state.emptyText)}</strong><p>${esc(state.emptyIntro)}</p></div>`;
  const columnLabels = state.columnLabels || ['照片', '品項名稱 / 型號', '位置', '庫存 / 狀態', '操作'];
  const columnHeadings = columnLabels.map(function(label) { return `<span>${esc(label)}</span>`; }).join('');

  body.innerHTML = `<div class="inventory-status-header status-list-header ${esc(state.headerClass || '')}">
    <div><h2 id="inventory-status-modal-title">${esc(state.title)}</h2><p>${esc(state.intro)}</p></div>
    <div class="status-list-header-actions"><strong>${esc(countText)}</strong><button type="button" class="inventory-status-close" onclick="closeInventoryStatusModal()" aria-label="關閉">✕</button></div>
  </div>
  <div class="status-list-toolbar">
    <label class="status-list-search">搜尋
      <input type="search" value="${esc(state.search || '')}" placeholder="${esc(state.searchPlaceholder || '搜尋品項名稱、型號或位置…')}" oninput="setSharedStatusListSearch(this.value)">
    </label>
    ${locationFilter}
  </div>
  <div class="status-list-column-headings">${columnHeadings}</div>
  <div class="inventory-status-list status-list-table">${rows}</div>`;
}

function setSharedStatusListContext(config) {
  STATUS_LIST_CONTEXT = Object.assign({
    items: [],
    search: '',
    location: '',
    emptyText: '目前沒有符合的品項',
    emptyIntro: '目前條件下沒有符合的清單項目。',
    searchPlaceholder: '搜尋品項名稱、型號或位置…',
    getSearchText: function(item) { return [item.name, item.brand, item.code, item.location].join(' '); },
    renderItem: function() { return ''; },
  }, config, { items: Array.isArray(config.items) ? config.items.slice() : [] });
  renderSharedStatusListModal();
}

function openSharedStatusListModal(config) {
  const modal = document.getElementById('inventory-status-modal');
  if (!modal) return;
  setSharedStatusListContext(config);
  modal.classList.add('show');
  modal.setAttribute('aria-hidden', 'false');
}

function setSharedStatusListSearch(value) {
  if (!STATUS_LIST_CONTEXT) return;
  STATUS_LIST_CONTEXT.search = value || '';
  renderSharedStatusListModal();
}

function setSharedStatusListLocation(value) {
  if (!STATUS_LIST_CONTEXT) return;
  STATUS_LIST_CONTEXT.location = value || '';
  renderSharedStatusListModal();
}

function clearSharedStatusListModal() {
  STATUS_LIST_CONTEXT = null;
}

function renderSharedProductStatusItem(item, options) {
  const config = options || {};
  const status = config.status || (typeof getInventoryStatus === 'function'
    ? getInventoryStatus(item)
    : { qty: Number(item.qty || 0), isOutOfStock: Number(item.qty || 0) <= 0, isLowStock: false });
  const statusType = config.statusType || (status.isOutOfStock ? 'out' : 'low');
  const isOut = statusType === 'out' || status.isOutOfStock;
  const badgeClass = isOut ? 'status-out' : 'status-low';
  const badgeText = isOut ? '⛔ 缺貨' : '⚠ 低庫存';
  const itemId = Number(item.id);
  const canEdit = config.editable && Number.isInteger(itemId) && typeof hasPerm === 'function' && hasPerm('item-mgmt');
  const editAction = canEdit
    ? `<button type="button" class="inventory-status-edit" onclick="closeInventoryStatusModal();openEditModal(${itemId})">編輯</button>`
    : '';
  const locations = statusListLocations(item).join('、');
  const threshold = !isOut && item.low_stock > 0
    ? `<span class="inventory-status-meta">警示值 ${esc(statusListFormatQuantity(item.low_stock, item.unit))}</span>`
    : '';
  if (typeof rememberInventoryAlertItem === 'function') rememberInventoryAlertItem(item);
  return `<article class="inventory-status-item status-list-mobile-row ${esc(isOut ? 'is-out' : 'is-low')}">
    <div class="inventory-status-thumb">${buildThumb(item.id, item.has_photo, item.name, '📦', item.thumbnail_url)}</div>
    <div class="inventory-status-info">
      <div class="inventory-status-name">${esc(item.brand || '無廠牌')} ${esc(item.name || '未命名')}</div>
      <div class="inventory-status-sub">${esc(item.code ? '型號： ' + item.code : '')}</div>
      ${config.extraHTML || ''}
    </div>
    <div class="inventory-status-location status-list-location-cell">📍 ${esc(locations)}</div>
    <div class="inventory-status-values">
      <span class="inventory-status-badge ${esc(badgeClass)}">${esc(badgeText)}</span>
      <strong>${esc(statusListFormatQuantity(status.qty, item.unit))} <small>${esc(item.unit || '')}</small></strong>
      ${threshold}
    </div>
    ${editAction}
  </article>`;
}
