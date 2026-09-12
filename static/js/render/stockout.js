// 庫存管理系統 - 已領出紀錄頁渲染（v8 拆分 + 退回紀錄顯示）
// ========== 出庫紀錄頁 ==========
function filterStockoutRecords(records) {
  const searchInput = document.getElementById('search-input');
  const globalSearchQuery = searchInput ? String(searchInput.value || '').trim() : '';
  const query = String(stockoutPageSearch || globalSearchQuery).trim().toLowerCase();
  const keywords = query ? query.split(/\s+/).filter(function(word) { return word.length > 0; }) : [];
  let filtered = keywords.length ? records.filter(function(o) {
    const haystack = [o.name, o.item_name, o.code, o.brand, o.destination, o.note, o.return_site, o.return_location].join(' ').toLowerCase();
    return keywords.every(function(keyword) { return haystack.includes(keyword); });
  }) : records;
  return filtered.filter(function(o) {
    const date = String(o.created_at || '').slice(0, 10);
    return (!stockoutDateFrom || date >= stockoutDateFrom) && (!stockoutDateTo || date <= stockoutDateTo);
  });
}

function getStockoutKpis(records) {
  const active = records.filter(function(o) { return !o.reverted_at && o.reason !== '退回已領出'; });
  return {
    recordCount: records.length,
    totalOutbound: active.reduce(function(sum, o) { return sum + Math.abs(o.delta); }, 0),
    dateGroupCount: new Set(records.map(function(o) { return String(o.created_at || '').slice(0, 10); })).size,
    uniqueItemCount: new Set(records.map(function(o) { return o.item_id; })).size,
  };
}

function formatStockoutDate(dateValue) {
  const date = String(dateValue || '').slice(0, 10);
  const parts = date.split('-').map(Number);
  const weekday = parts.length === 3 && parts.every(Number.isFinite) ? ['日', '一', '二', '三', '四', '五', '六'][new Date(parts[0], parts[1] - 1, parts[2]).getDay()] : '';
  return weekday ? `${date}（星期${weekday}）` : date;
}

function renderStockoutActions(o, isViewer) {
  if (isViewer) return '';
  const reverted = !!o.reverted_at;
  const isReturn = o.reason === '退回已領出';
  if (isReturn) {
    return reverted ? '' : `<button type="button" onclick="openEditStockoutReturnModal(${o.id})">✏️ 編輯</button><button type="button" class="danger" onclick="revokeStockoutReturn(${o.id})">撤銷退回</button>`;
  }
  if (reverted) return `<button type="button" class="danger" onclick="deleteStockoutRecord(${o.id})">刪除</button>`;
  return `<button type="button" onclick="openEditStockoutModal(${o.id})">✏️ 編輯</button><button type="button" class="return" onclick="returnStockout(${o.id})">↩️ 退回</button><button type="button" class="danger" onclick="deleteStockoutRecord(${o.id})">刪除</button>`;
}

function renderStockoutDesktopRow(o, isViewer) {
  const reverted = !!o.reverted_at;
  const isReturn = o.reason === '退回已領出';
  const returnReverted = isReturn && reverted;
  const rowClass = returnReverted ? 'is-reverted-return' : (isReturn ? 'is-return' : (reverted ? 'is-reverted' : ''));
  const photo = o.has_photo ? `<img class="so-photo stockout-photo" src="${photoSrc(o.item_id, 'thumbnail')}" alt="" loading="lazy" onclick="openPhotoLightbox(${o.item_id})" title="點擊看大圖">` : '<div class="so-photo stockout-photo stockout-photo-empty">📷</div>';
  const destination = o.destination ? `<span class="stockout-destination-badge">🏢 ${esc(o.destination)}</span>` : '';
  const returnSeparator = o.return_site ? '／' : '';
  const returnLocation = isReturn && o.return_location ? `<span class="stockout-destination-badge return-location">📍 ${esc(o.return_site || '')}${esc(returnSeparator)}${esc(o.return_location)}</span>` : '';
  const returned = returnReverted ? '<span class="stockout-returned-badge revoked">↩️ 已撤銷退回</span>' : (isReturn ? '<span class="stockout-returned-badge">↩️ 已退回</span>' : (reverted ? '<span class="stockout-returned-badge revoked">已撤銷</span>' : ''));
  const quantityClass = returnReverted ? 'is-revoked' : (isReturn ? 'qty-pos' : 'qty-neg');
  return `<tr class="stockout-record-row ${esc(rowClass)}"><td>${photo}</td><td><div class="stockout-item-name">${esc(o.brand)} ${esc(o.item_name)}${o.item_deleted ? '<span class="tag-nonstock">非庫存</span>' : ''}${returned}</div>${o.code ? `<small class="stockout-item-meta">型號 ${esc(o.code)}</small>` : ''}${o.note ? `<small class="stockout-note">📝 ${esc(o.note)}</small>` : ''}</td><td class="stockout-qty ${esc(quantityClass)}">${isReturn ? '+' : '-'}${esc((typeof Qty !== 'undefined') ? Qty.disp(o.delta, o.unit) : String(absNum(o.delta)))} ${esc(o.unit)}</td><td><div class="stockout-destination">${destination}${returnLocation}</div>${!destination && !returnLocation ? '<span class="muted">—</span>' : ''}</td><td><div class="stockout-actions">${renderStockoutActions(o, isViewer)}</div></td></tr>`;
}

function renderStockoutMobileCard(o, isViewer) {
  const reverted = !!o.reverted_at;
  const isReturn = o.reason === '退回已領出';
  const returnReverted = isReturn && reverted;
  const returned = returnReverted ? '<span class="stockout-returned-badge revoked">↩️ 已撤銷退回</span>' : (isReturn ? '<span class="stockout-returned-badge">↩️ 已退回</span>' : (reverted ? '<span class="stockout-returned-badge revoked">已撤銷</span>' : ''));
  return mobileCardShell({
    reverted: reverted,
    moreBtnHTML: `<button class="more-btn" onclick="openStockoutSheet(${o.id})">⋯</button>`,
    thumb: buildThumb(o.item_id, o.has_photo, o.item_name, '📷'),
    nameHTML: `${esc(o.brand)} ${esc(o.item_name)}${o.item_deleted ? '<span class="tag-nonstock">非庫存</span>' : ''}${o.code ? `<small class="stockout-item-meta">型號 ${esc(o.code)}</small>` : ''}${returned}`,
    subHTML: esc(String(o.created_at || '').slice(5,10)),
    extraHTML: `${o.destination ? `<div><span class="loc-tag">🏢 ${esc(o.destination)}</span></div>` : ''}${isReturn && o.return_location ? `<div><span class="loc-tag">📍 ${esc(o.return_site || '')}${esc(o.return_site ? '／' : '')}${esc(o.return_location)}</span></div>` : ''}${o.note ? `<div class="stockout-note">📝 ${esc(o.note)}</div>` : ''}`,
    qtyHTML: buildQtyNum((isReturn ? '+' : '-') + absNum(o.delta), o.unit, returnReverted ? 'is-revoked' : (isReturn ? 'qty-pos' : 'qty-neg')),
    actionsHTML: '',
  });
}

function renderStockoutGroup(date, records, isViewer, isMobile) {
  const active = records.filter(function(o) { return !o.reverted_at && o.reason !== '退回已領出'; });
  const totalOut = active.reduce(function(sum, o) { return sum + Math.abs(o.delta); }, 0);
  const desktopRows = records.map(function(o) { return renderStockoutDesktopRow(o, isViewer); }).join('');
  const body = isMobile ? records.map(function(o) { return renderStockoutMobileCard(o, isViewer); }).join('') : `<div class="stockout-table-wrap"><table class="data-table stockout-table"><colgroup><col class="stockout-col-photo"><col class="stockout-col-item"><col class="stockout-col-qty"><col class="stockout-col-destination"><col class="stockout-col-actions"></colgroup><thead><tr><th>照片</th><th>品項資訊</th><th>數量</th><th>領用去向</th><th>操作</th></tr></thead><tbody>${desktopRows}</tbody></table></div>`;
  return `<section class="stockout-date-group"><header class="stockout-date-header"><span class="stockout-date-title">📅 ${esc(formatStockoutDate(date))}</span><span class="stockout-date-summary">${esc(String(records.length))} 筆 · 領出 ${esc(String(totalOut))} 件</span></header>${body}</section>`;
}

function renderStockoutPageHeader(isViewer, kpis) {
  const globalSearchInput = document.getElementById('search-input');
  const globalSearchValue = globalSearchInput ? String(globalSearchInput.value || '') : '';
  const searchValue = String(stockoutPageSearch || globalSearchValue);
  return `<section class="stockout-page-header"><div class="stockout-heading-copy"><div class="stockout-heading-icon" aria-hidden="true">🚚</div><div><h1>已領出</h1><p>查看所有已從庫存領出的品項紀錄。</p></div></div><div class="stockout-filter-bar"><label class="stockout-filter-field">開始日期<input type="date" value="${esc(stockoutDateFrom)}" onchange="stockoutDateFrom = this.value; renderStockOuts()"></label><label class="stockout-filter-field">結束日期<input type="date" value="${esc(stockoutDateTo)}" onchange="stockoutDateTo = this.value; renderStockOuts()"></label><label class="stockout-filter-field search">關鍵字搜尋<input type="search" value="${esc(searchValue)}" placeholder="搜尋品項、型號、領用去向..." oninput="stockoutPageSearch = this.value" onkeydown="if(event.key === 'Enter') renderStockOuts()"></label><button type="button" class="stockout-filter-action" onclick="renderStockOuts()">搜尋</button><button type="button" class="stockout-filter-action" onclick="clearStockoutFilters()">清除</button>${isViewer ? '' : '<button type="button" class="stockout-filter-action primary" onclick="openNonStockOutModal()">＋ 新增已領出</button>'}</div></section><section class="stockout-kpi-grid ui-kpi-grid"><div class="stockout-kpi-card ui-kpi-card ui-kpi-card--purple purple"><div class="stockout-kpi-icon ui-kpi-icon">📋</div><div class="ui-kpi-body"><div class="stockout-kpi-label ui-kpi-label">領出總筆數</div><div class="stockout-kpi-number ui-kpi-value">${esc(String(kpis.recordCount))}</div><span class="ui-kpi-meta">目前篩選結果</span></div></div><div class="stockout-kpi-card ui-kpi-card ui-kpi-card--green green"><div class="stockout-kpi-icon ui-kpi-icon">📦</div><div class="ui-kpi-body"><div class="stockout-kpi-label ui-kpi-label">總領出數量(個)</div><div class="stockout-kpi-number ui-kpi-value">${esc(String(kpis.totalOutbound))}</div><span class="ui-kpi-meta">有效領出合計</span></div></div><div class="stockout-kpi-card ui-kpi-card ui-kpi-card--blue blue"><div class="stockout-kpi-icon ui-kpi-icon">📅</div><div class="ui-kpi-body"><div class="stockout-kpi-label ui-kpi-label">領出日期 (天)</div><div class="stockout-kpi-number ui-kpi-value">${esc(String(kpis.dateGroupCount))}</div><span class="ui-kpi-meta">去重日期</span></div></div><div class="stockout-kpi-card ui-kpi-card ui-kpi-card--amber amber"><div class="stockout-kpi-icon ui-kpi-icon">🔧</div><div class="ui-kpi-body"><div class="stockout-kpi-label ui-kpi-label">品項種類</div><div class="stockout-kpi-number ui-kpi-value">${esc(String(kpis.uniqueItemCount))}</div><span class="ui-kpi-meta">去重品項</span></div></div></section>`;
}

function clearStockoutFilters() {
  stockoutDateFrom = '';
  stockoutDateTo = '';
  stockoutPageSearch = '';
  const globalSearch = document.getElementById('search-input');
  if (globalSearch) globalSearch.value = '';
  renderStockOuts();
}

async function renderStockOuts() {
  const isViewer = !hasPerm('stockout');
  const content = document.getElementById('content');
  if (!content) return;
  content.innerHTML = '<div class="stockout-loading">載入已領出紀錄…</div>';
  try {
    const res = await fetch(`/api/stockouts?limit=200&site=${currentSite}`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const outs = await res.json();
    stockoutRecords = outs;
    const filteredOuts = filterStockoutRecords(outs);
    const kpis = getStockoutKpis(filteredOuts);
    const stockoutBar = renderStockoutPageHeader(isViewer, kpis);
    let html = stockoutBar;
    html += `<div class="stockout-toolbar"><span>共 <strong>${esc(String(kpis.recordCount))}</strong> 筆</span>${filteredOuts.length !== outs.length ? `<span>已篩選 ${esc(String(filteredOuts.length))} / ${esc(String(outs.length))} 筆</span>` : ''}</div>`;
    if (!filteredOuts.length) {
      const filtered = outs.length > 0;
      html += `<div class="stockout-empty-state"><span class="empty-icon">🚚</span><strong>${esc(filtered ? '沒有符合條件的已領出紀錄' : '目前沒有已領出的紀錄')}</strong><p>${esc(filtered ? '可以清除搜尋或日期篩選後再試一次。' : '當商品正式領出後，紀錄會顯示在這裡。')}</p>${filtered ? '<button type="button" class="stockout-filter-action" onclick="clearStockoutFilters()">清除篩選</button>' : ''}</div>`;
      content.innerHTML = html;
      return;
    }
    const byDate = {};
    filteredOuts.forEach(function(o) { const date = String(o.created_at || '').slice(0, 10); (byDate[date] = byDate[date] || []).push(o); });
    const isMobile = typeof isMobileView === 'function' && isMobileView();
    Object.keys(byDate).sort().reverse().forEach(function(date) { html += renderStockoutGroup(date, byDate[date], isViewer, isMobile); });
    content.innerHTML = html;
  } catch (e) {
    console.error('[renderStockOuts] 已領出紀錄載入失敗', e);
    content.innerHTML = `<div class="stockout-error-state"><h2>載入已領出紀錄失敗</h2><p>${esc(e.message || '請稍後再試')}</p><button type="button" class="stockout-filter-action" onclick="renderStockOuts()">重新載入</button></div>`;
  }
}

// 分組：按日（套用日期與關鍵字篩選後）

// 刪除已領出紀錄（僅刪紀錄、不回補庫存；2026-08-11 Sarah 需求）

async function deleteStockoutRecord(movementId) {

  if (!confirm('確定刪除這筆已領出紀錄？只刪紀錄、不會回補庫存。')) return;

  try {

    const res = await fetch(`/api/stockouts/${movementId}`, { method: 'DELETE' });

    if (!res.ok) {

      const e = await res.json().catch(() => ({}));

      throw new Error(e.detail || '刪除失敗');

    }

    toast('✅ 已刪除紀錄', 'success');

    renderStockOuts();

  } catch (e) {

    toast('⚠️ ' + e.message, 'error');

  }

}





// ========== 手機版 ⋯ 動作選單（已領出卡） ==========

function openStockoutSheet(movementId) {

  const rec = (typeof stockoutRecords !== 'undefined' ? stockoutRecords : []).find(r => r.id === movementId);

  if (!rec) return;

  const isViewer = !hasPerm('stockout');

  const reverted = !!rec.reverted_at;
  const isReturn = rec.reason === '退回已領出';

  const actions = [];

  if (!isViewer) {

    if (isReturn && !reverted) {
      actions.push({ icon: '✏️', label: '編輯', cls: 'out', fn: () => openEditStockoutReturnModal(movementId) });
      actions.push({ icon: '↩️', label: '撤銷退回', cls: 'del', fn: () => revokeStockoutReturn(movementId) });
    } else if (!isReturn && !reverted) {
      actions.push({ icon: '✏️', label: '編輯', cls: 'out', fn: () => openEditStockoutModal(movementId) });
      actions.push({ icon: '↩️', label: '退回', cls: 'back', fn: () => returnStockout(movementId) });
    }

    if (!isReturn) {
      actions.push({ icon: '🗑', label: '刪除', cls: 'del', fn: () => deleteStockoutRecord(movementId) });
    }

  }

  openSheet(`${rec.brand} ${rec.item_name}`, actions);

}

