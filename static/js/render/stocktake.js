// 庫存管理系統 - 盤點頁渲染（v10：以位置庫存為單位對帳）
// ========== 盤點頁 ==========
var stocktakeRenderRequestSeq = 0;

async function renderStocktake() {
  // 盤點頁瀏覽掛 view；實際盤點操作仍由 stocktake 權限控制
  const requestId = ++stocktakeRenderRequestSeq;
  const siteAtRequest = currentSite;
  const isCurrent = function() {
    return requestId === stocktakeRenderRequestSeq
      && currentTab === 'stocktake'
      && siteAtRequest === currentSite;
  };
  const canStocktake = !!(currentUser && currentUser.permissions && currentUser.permissions['stocktake']);
  const content = document.getElementById('content');
  if (!content) return;
  content.innerHTML = '<div class="stocktake-loading">載入盤點資料…</div>';

  let takeDates = [];
  let loadError = false;
  try {
    const res = await fetch(`/api/stocktake/dates?site=${encodeURIComponent(siteAtRequest)}`);
    if (!res.ok) { console.error('[renderStocktake] /api/stocktake/dates 失敗', res.status); throw new Error('dates ' + res.status); }
    takeDates = await res.json();
    if (!isCurrent()) return;
  } catch (e) {
    if (!isCurrent()) return;
    loadError = true;
    console.error('[renderStocktake] 盤點日期載入失敗', e);
  }
  try {
    const kitRes = await fetch(`/api/kits?site=${encodeURIComponent(siteAtRequest)}`);
    if (!kitRes.ok) { console.error('[renderStocktake] /api/kits 失敗', kitRes.status); throw new Error('kits ' + kitRes.status); }
    const kits = await kitRes.json();
    if (!isCurrent()) return;
    stocktakeKits = kits;
  } catch (e) {
    if (!isCurrent()) return;
    loadError = true;
    console.error('[renderStocktake] 整組材料載入失敗', e);
    stocktakeKits = [];
  }
  if (!isCurrent()) return;

  const statusOf = typeof getInventoryStatus === 'function'
    ? getInventoryStatus
    : function(i) { return { isLowStock: i.low_stock > 0 && i.qty > 0 && i.qty <= i.low_stock, isOutOfStock: !i.is_kit && i.qty <= 0 }; };
  const zeroItems = ALL_ITEMS.filter(i => statusOf(i).isOutOfStock);
  const lowItems = ALL_ITEMS.filter(i => statusOf(i).isLowStock);
  const zero = zeroItems.length;
  const low = lowItems.length;
  const totalQty = ALL_ITEMS.reduce((s, i) => s + i.qty, 0);
  const totalQtyStr = (Math.round(totalQty * 1000) / 1000).toLocaleString('en-US');

  let html = `<section class="stocktake-page-header">
    <div class="stocktake-heading-copy"><div class="stocktake-heading-icon" aria-hidden="true">📋</div><div><h1>盤點</h1><p>核對實際庫存與系統庫存，快速找出庫存差異。</p></div></div>
    <span class="stocktake-date">📅 ${esc(todayStr())}</span>
  </section>`;
  if (loadError) {
    html += `<div class="stocktake-error-state"><h2>載入盤點資料失敗</h2><p>部分盤點資料無法載入，請重新載入。</p><button type="button" class="btn-cancel" onclick="renderStocktake()">重新載入</button></div>`;
  }
  html += `<section class="stocktake-kpi-grid ui-kpi-grid">
    <div class="stocktake-kpi-card ui-kpi-card ui-kpi-card--blue"><div class="stocktake-kpi-icon ui-kpi-icon">📦</div><div class="ui-kpi-body"><div class="stocktake-kpi-label ui-kpi-label">品項總數</div><div class="stocktake-kpi-number ui-kpi-value">${esc(String(ALL_ITEMS.length))}</div><span class="ui-kpi-meta">目前庫存品項</span></div></div>
    <div class="stocktake-kpi-card ui-kpi-card ui-kpi-card--purple"><div class="stocktake-kpi-icon ui-kpi-icon">🗄️</div><div class="ui-kpi-body"><div class="stocktake-kpi-label ui-kpi-label">庫存總數(件)</div><div class="stocktake-kpi-number ui-kpi-value">${totalQtyStr}</div><span class="ui-kpi-meta">全部品項合計</span></div></div>
    <button type="button" class="stocktake-kpi-card ui-kpi-card ui-kpi-card--amber clickable warn" onclick="showStocktakeList('low')" aria-label="查看低庫存品項"><div class="stocktake-kpi-icon ui-kpi-icon">⚠</div><div class="ui-kpi-body"><div class="stocktake-kpi-label ui-kpi-label">低庫存</div><div class="stocktake-kpi-number ui-kpi-value">${esc(String(low))}</div><span class="ui-kpi-meta">低於警示值 · 查看清單</span></div></button>
    <button type="button" class="stocktake-kpi-card ui-kpi-card ui-kpi-card--red clickable danger" onclick="showStocktakeList('zero')" aria-label="查看缺貨品項"><div class="stocktake-kpi-icon ui-kpi-icon">⛔</div><div class="ui-kpi-body"><div class="stocktake-kpi-label ui-kpi-label">缺貨</div><div class="stocktake-kpi-number ui-kpi-value">${esc(String(zero))}</div><span class="ui-kpi-meta">數量為 0 · 查看清單</span></div></button>
  </section>`;

  if (takeDates.length) {
    const last = takeDates[0];
    const lastDiff = Number(last.total_diff || 0);
    html += `<section class="stocktake-summary-card"><div class="stocktake-summary-heading"><span>📅 上次盤點</span><span class="stocktake-summary-date">${esc(last.take_date)}</span></div>
      <div class="stocktake-summary-metrics"><span>盤點 <b>${esc(String(last.item_count))}</b> 項</span><span>差異 <b class="${lastDiff > 0 ? 'is-positive' : lastDiff < 0 ? 'is-negative' : ''}">${esc(String(last.total_diff))}</b> 件</span><span>有差異品項 <b>${esc(String(last.diff_count))}</b> 項</span></div></section>`;
  }
  if (takeDates.length > 1) {
    html += `<section class="stocktake-history"><table><thead><tr><th>日期</th><th>盤點數</th><th>有差異</th><th>總差異</th></tr></thead><tbody>`;
    takeDates.slice(0, 5).forEach(d => { html += `<tr><td>${esc(d.take_date)}</td><td>${esc(String(d.item_count))} 項</td><td>${esc(String(d.diff_count))} 項</td><td>${esc(String(d.total_diff))}</td></tr>`; });
    html += '</tbody></table></section>';
  }

  html += `<section class="stocktake-current-header"><div class="stocktake-current-heading"><span>✏️ 本次盤點</span><span class="stocktake-current-date">${esc(todayStr())}</span></div><span class="stocktake-current-date">共 ${esc(String(ALL_ITEMS.length))} 項</span></section>`;
  if (!canStocktake) {
    html += `<div class="stocktake-readonly-panel">🔒 盤點作業僅限管理員 / 一般使用者操作<br><small>檢視者與工程師為唯讀，可瀏覽上方盤點歷史與統計</small></div>`;
    if (!isCurrent()) return;
    content.innerHTML = html;
    return;
  }
  html += `<section class="stocktake-info-panel"><div class="stocktake-info-title">ℹ️ 盤點操作說明</div>輸入實際清點數量後，系統會自動計算盤盈 / 盤虧。<br>未填寫的品項維持原數量不變；輸入 0 才代表實際庫存為 0。<br>「整組」盤點完整設備組數；「單一材料」盤點個別庫存品項。</section>`;

  const rows = [];
  ALL_ITEMS.forEach(i => {
    const stocks = i.stocks && i.stocks.length ? i.stocks : [{ location: i.location || '', qty: i.qty }];
    stocks.forEach(s => rows.push({ item: i, stock: s }));
  });
  const kitRows = rows.filter(r => r.item.is_kit);
  const singleRows = rows.filter(r => !r.item.is_kit);
  const searchFiltered = function(arr) { return filterBySearch(arr, function(r) { return [r.item.name, r.item.code, r.item.brand, r.stock.location].join(' '); }); };
  const filteredKitRows = searchFiltered(kitRows);
  const filteredSingleRows = searchFiltered(singleRows);
  html += `<div class="stk-tabs stocktake-tabs"><button class="stk-tab stocktake-tab active" onclick="switchStocktakeTab('kit')">🔧 整組<span>${esc(String(filteredKitRows.length))} 項</span></button><button class="stk-tab stocktake-tab" onclick="switchStocktakeTab('single')">📦 單一材料<span>${esc(String(filteredSingleRows.length))} 項</span></button></div>`;
  html += `<div id="stk-pane-kit">${stkGroupByLoc(filteredKitRows)}</div><div id="stk-pane-single" style="display:none">${stkGroupByLoc(filteredSingleRows)}</div>`;
  html += `<button type="button" class="stocktake-submit btn-save" onclick="submitStocktake()">📋 完成盤點並更新庫存</button>`;
  if (!isCurrent()) return;
  content.innerHTML = html;
}

// ========== 盤點輸入表：位置分組渲染（整組/單一材料共用，2026-08-13） ==========
function stocktakeInput(key, systemQty, unit) {
  const value = stocktakeValues[key] !== undefined ? stocktakeValues[key] : '';
  return `<input class="stocktake-input" type="text" inputmode="decimal" value="${esc(String(value))}" placeholder="實際（可輸 1/4）" data-unit="${esc(unit || '')}" data-sysqty="${esc(String(systemQty))}" oninput="stocktakeValues['${jsStr(key)}'] = this.value; calcDiff(this)" onchange="stocktakeValues['${jsStr(key)}'] = this.value; markChanged(this, '${jsStr(key)}')" data-key="${esc(key)}">`;
}

/**
 * Render one stocktake item row and any expanded kit component rows.
 * @param {Object} item - Inventory item; single-material rows may include a model code.
 * @param {Object} stock - Location-specific system stock being counted.
 * @param {Object|null} kitDef - Kit definition for an assembly row, if available.
 * @returns {string} Escaped table-row markup for the item and its kit components.
 */
function stocktakeRow(item, stock, kitDef) {
  const key = `${item.id}:${stock.location}`;
  const systemQty = (typeof Qty !== 'undefined') ? Qty.format(stock.qty, Qty.unitTypeOf(item.unit)) : absNum(stock.qty);
  const materials = kitDef && kitDef.components && kitDef.components.length ? kitDef.components.map(function(c) {
    const material = ALL_ITEMS.find(x => x.id === c.item_id);
    const materialStock = material && material.stocks && material.stocks.length ? (material.stocks.find(s => s.location === stock.location) || material.stocks[0]) : null;
    const materialLocation = materialStock ? materialStock.location : '';
    const materialKey = `${c.item_id}:${materialLocation}`;
    const materialSystemQty = (typeof Qty !== 'undefined') ? Qty.format(materialStock ? materialStock.qty : c.stock, Qty.unitTypeOf(c.unit)) : (materialStock ? absNum(materialStock.qty) : absNum(c.stock));
    const materialName = `${esc(c.brand || '')} ${esc(c.name || '未命名')}`.trim();
    const materialPhoto = c.has_photo ? `<img src="${photoSrc(c.item_id, 'thumbnail')}" alt="" onclick="openPhotoLightbox(${c.item_id})" title="點擊看大圖">` : '<span class="cphoto-empty">📷</span>';
    return `<tr class="stocktake-material-row"><td><div class="stocktake-material-cell"><span class="stocktake-material-indent" aria-hidden="true">↳</span><span class="stocktake-material-photo cphoto">${materialPhoto}</span><span><b>${materialName}</b>${c.code ? `<small class="stocktake-model">型號 ${esc(c.code)}</small>` : ''}<small class="stocktake-material-need">需 ${esc((typeof Qty !== 'undefined') ? Qty.format(c.need_qty, Qty.unitTypeOf(c.unit)) : String(c.need_qty))} ${esc(c.unit || '')}／組</small></span></div></td><td class="stocktake-material-system-qty">${esc(String(materialSystemQty))} ${esc(c.unit || '')}</td><td>${stocktakeInput(materialKey, materialSystemQty, c.unit)}</td><td class="st-diff stocktake-material-diff pending">—</td></tr>`;
  }).join('') : '';
  const displayLoc = stock.location ? `位置：${esc(stock.location)}` : '未標示';
  const photo = item.has_photo ? `<img src="${photoSrc(item.id, 'thumbnail')}" alt="" onclick="openPhotoLightbox(${item.id})" title="點擊看大圖">` : '<span class="cphoto-empty">📷</span>';
  const rowClass = item.is_kit ? 'stocktake-assembly-row' : 'stocktake-single-row';
  return `<tr class="${rowClass}"><td><div class="stocktake-item-cell"><span class="cphoto">${photo}</span><span><b>${esc(item.brand || '')} ${esc(item.name || '未命名')}</b>${!item.is_kit && item.code ? '<small class="stocktake-model">型號 ' + esc(item.code) + '</small>' : ''}<small>${displayLoc}${stock.note ? ' · 📝 ' + esc(stock.note) : ''}</small></span></div></td><td class="stocktake-system-qty">${esc(String(systemQty))} ${esc(item.unit || '')}</td><td>${stocktakeInput(key, systemQty, item.unit)}</td><td class="st-diff ${stocktakeValues[key] === undefined || stocktakeValues[key] === '' ? 'pending' : 'zero'}">${stocktakeValues[key] === undefined || stocktakeValues[key] === '' ? '—' : '0'}</td></tr>${materials}`;
}

function stkGroupByLoc(rows) {
  const byLoc = {};
  rows.forEach(r => { const loc = r.stock.location || '未標示'; (byLoc[loc] = byLoc[loc] || []).push(r); });
  let html = '';
  Object.keys(byLoc).sort().forEach(loc => {
    const locRows = byLoc[loc];
    html += `<section class="stocktake-location-group"><div class="stocktake-location-header"><span>📍 位置：${esc(loc)}</span><span class="stocktake-location-count">${esc(String(locRows.length))} 項</span></div><div class="stocktake-table-wrap"><table class="data-table stocktake-table"><colgroup><col class="stocktake-col-item"><col class="stocktake-col-system"><col class="stocktake-col-actual"><col class="stocktake-col-diff"></colgroup><thead><tr><th>品項</th><th>系統數量</th><th>實際數量</th><th>差異</th></tr></thead><tbody>`;
    locRows.forEach(r => {
      const kitDef = r.item.is_kit ? (stocktakeKits.find(k => k.item_id === r.item.id) || null) : null;
      html += stocktakeRow(r.item, r.stock, kitDef);
    });
    html += '</tbody></table></div></section>';
  });
  return html;
}

// 盤點輸入表 tab 切換（整組 / 單一材料）
function switchStocktakeTab(tab) {
  document.getElementById('stk-pane-kit').style.display = tab === 'kit' ? '' : 'none';
  document.getElementById('stk-pane-single').style.display = tab === 'single' ? '' : 'none';
  document.querySelectorAll('.stk-tab').forEach(b => b.classList.remove('active'));
  const idx = tab === 'kit' ? 0 : 1;
  document.querySelectorAll('.stk-tab')[idx].classList.add('active');
}

// ========== 盤點：低庫存 / 缺貨清單 ==========
function renderStocktakeStatusItem(item, isLow) {
  const status = getInventoryStatus(item);
  const extra = item.in_kits && item.in_kits.length
    ? `<div class="stocktake-status-extra">🔧 屬於整組：${esc(item.in_kits.join('、'))}</div>`
    : '';
  return renderSharedProductStatusItem(item, {
    status: status,
    statusType: isLow ? 'low' : 'out',
    editable: true,
    extraHTML: extra,
  });
}

function showStocktakeList(type) {
  const isLow = type === 'low';
  const items = ALL_ITEMS.filter(function(item) {
    const status = getInventoryStatus(item);
    return isLow ? status.isLowStock : status.isOutOfStock;
  }).sort(function(a, b) { return getInventoryStatus(a).qty - getInventoryStatus(b).qty; });
  openSharedStatusListModal({
    title: isLow ? '⚠ 低庫存商品' : '⛔ 缺貨商品',
    intro: isLow ? '庫存數量已低於或等於目前警示值。' : '目前庫存為 0 或以下的單一庫存品項。',
    headerClass: isLow ? 'is-low' : 'is-out',
    items: items,
    emptyText: isLow ? '目前沒有低庫存商品' : '目前沒有缺貨商品',
    emptyIntro: '目前篩選條件下沒有符合的品項。',
    getSearchText: function(item) {
      return [item.name, item.brand, item.code, statusListLocations(item).join(' ')].join(' ');
    },
    renderItem: function(item) { return renderStocktakeStatusItem(item, isLow); },
  });
}

// 盤點輸入值與系統數量不同時加上 changed 樣式（黃底），相同則移除
function markChanged(input, key) {
  // key = "itemId:location"
  const parts = key.split(':');
  const item = ALL_ITEMS.find(i => i.id === parseInt(parts[0]));
  const stock = (item && item.stocks || []).find(s => s.location === parts[1]);
  if (stock) {
    let _chg = true;
    if (typeof Qty !== 'undefined') {
      const _p = Qty.parse(input.value);
      _chg = !!(_p.error || Math.abs(_p.value - stock.qty) > 1e-9);
    } else _chg = parseFloat(input.value) !== stock.qty;
    if (_chg) input.classList.add('changed'); else input.classList.remove('changed');
  } else input.classList.remove('changed');
}

// 收集所有有差異的盤點值 → POST /api/stocktake 更新庫存並記錄盤點結果
async function submitStocktake() {
  const items = [];
  const submittedKeys = new Set(Object.keys(stocktakeValues));
  for (const key of submittedKeys) {
    const parts = key.split(':');
    const itemId = parseInt(parts[0]);
    const location = parts[1];
    const item = ALL_ITEMS.find(i => i.id === itemId);
    const stock = (item && item.stocks || []).find(s => s.location === location);

    // 2026-09-12：分數可輸；空白維持舊語意（=系統數量）；非法整包擋下
    let v;
    const _raw = (stocktakeValues[key] !== undefined && stocktakeValues[key] !== null) ? String(stocktakeValues[key]).trim() : '';
    if (_raw === '') {
      // 空白 → 視同實際數量 = 系統數量（留空表示確認）
      v = stock ? stock.qty : 0;
    } else if (typeof Qty !== 'undefined') {
      const _unitType = (typeof Qty.inputTypeOf === 'function')
        ? Qty.inputTypeOf(item ? item.unit : '')
        : Qty.unitTypeOf(item ? item.unit : '');
      const _valid = Qty.validFor(_raw, _unitType);
      if (!_valid.ok) { toast('「' + (item ? item.name : '') + '」' + (_valid.error || '請輸入符合單位類型的數量'), 'error'); return; }
      v = _valid.value;
    } else {
      v = parseFloat(_raw);
      if (isNaN(v)) { toast('請輸入有效數量', 'error'); return; }
    }

    if (item && stock) {
      items.push({ item_id: item.id, location: location, actual_qty: v });
    }
  }

  if (!items.length) { toast('沒有品項可盤點', 'error'); return; }

  const confirmed = confirm(`盤點 ${items.length} 項，將更新庫存並記錄。\n確定送出？`);
  if (!confirmed) return;

  try {
    const res = await fetch('/api/stocktake', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ take_date: todayStr(), site: currentSite, items: items })
    });
    if (!res.ok) throw new Error();
    const r = await res.json();
    stocktakeValues = {};
    // 記錄本月已盤點，當月不再顯示提醒（僅 25-31日盤點才記錄）
    const now = new Date();
    if (now.getDate() >= 25) {
      localStorage.setItem('lastStocktakeMonth', `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`);
      // 立即隱藏提醒橫幅
      const reminder = document.getElementById('reminder');
      if (reminder) reminder.style.display = 'none';
    }
    toast(`✅ 盤點完成：${r.count} 項已更新`, 'success');
    await loadData();
  } catch (e) {
    toast('盤點送出失敗', 'error');
  }
}


// ========== 內聯盤點差異計算 ==========
function calcDiff(input) {
  const row = input.closest('tr');
  const diffEl = row ? row.querySelector('.st-diff') : null;
  if (!diffEl) return;
  if (input.value.trim() === '') {
    diffEl.textContent = '—';
    diffEl.className = 'st-diff pending';
    return;
  }
  // 2026-09-12：精確分數差異（3/4-1/2=1/4；單位跟 input data-unit）
  const _unit = input.dataset.unit || '';
  if (typeof Qty !== 'undefined') {
    const _p = Qty.parse(input.value);
    if (_p.error) { diffEl.textContent = '!'; diffEl.className = 'st-diff neg'; return; }
    const _d = Math.round((_p.value - Number(input.dataset.sysqty)) * 1000) / 1000;
    diffEl.textContent = (_d > 0 ? '+' : '') + Qty.format(_d, Qty.unitTypeOf(_unit)) + (_unit ? ' ' + _unit : '');
    diffEl.className = 'st-diff ' + (_d > 0 ? 'pos' : _d < 0 ? 'neg' : 'zero');
    return;
  }
  const val = Number(input.value);
  const sysQty = Number(input.dataset.sysqty);
  const diff = val - sysQty;
  diffEl.textContent = (diff > 0 ? '+' : '') + diff;
  diffEl.className = 'st-diff ' + (diff > 0 ? 'pos' : diff < 0 ? 'neg' : 'zero');
}
