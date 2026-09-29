// 庫存管理系統 - 已領出紀錄頁渲染（v8 拆分 + 退回紀錄顯示）

import { buildQtyNum, buildThumb, mobileCardShell, photoSrc } from '../../components/card.js';
import { apiFetch } from '../../core/api-client.js';
import { isMobileView, openSheet } from '../../core/bottomsheet.js';
import { refreshDestinationsAfterMutation } from '../../core/data.js';
import { Qty } from '../../core/qty.js';
import { inventorySiteLabel } from '../../core/site-label.js';
import { appState } from '../../core/state.js';
import { absNum, esc, hasPerm, toast } from '../../core/utils.js';
import { deleteStockoutReturn, openEditStockoutModal, openEditStockoutReturnModal, returnStockout } from './modals.js';
import { stockoutState } from './state.js';

// ========== 出庫紀錄頁 ==========
function filterStockoutRecords(records) {
  const searchInput = document.getElementById('search-input');
  const globalSearchQuery = searchInput ? String(searchInput.value || '').trim() : '';
  const query = String(stockoutState.stockoutPageSearch || globalSearchQuery).trim().toLowerCase();
  const keywords = query ? query.split(/\s+/).filter(function(word) { return word.length > 0; }) : [];
  let filtered = keywords.length ? records.filter(function(o) {
    const haystack = [o.name, o.item_name, o.code, o.brand, o.destination, o.note, o.return_site, o.return_location].join(' ').toLowerCase();
    return keywords.every(function(keyword) { return haystack.includes(keyword); });
  }) : records;
  return filtered.filter(function(o) {
    const date = String(o.created_at || '').slice(0, 10);
    return (!stockoutState.stockoutDateFrom || date >= stockoutState.stockoutDateFrom) && (!stockoutState.stockoutDateTo || date <= stockoutState.stockoutDateTo);
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

/**
 * Build desktop actions with callbacks to the modal-layer handlers.
 * @param {object} o Stockout record.
 * @param {boolean} isViewer Whether mutation actions are forbidden.
 * @returns {string} Escaped action-button HTML.
 */
function renderStockoutActions(o, isViewer) {
  if (isViewer) return '';
  const reverted = !!o.reverted_at;
  const isReturn = o.reason === '退回已領出';
  if (isReturn) {
    return reverted ? '' : `<button type="button" class="btn btn--secondary btn--sm" onclick="Stockout.openEditStockoutReturnModal(${o.id})">✏️ 編輯</button><button type="button" class="btn btn--danger btn--sm" onclick="Stockout.deleteStockoutReturn(${o.id})">撤銷退回</button>`;
  }
  if (reverted) return `<button type="button" class="btn btn--danger btn--sm" onclick="Stockout.deleteStockoutRecord(${o.id})">刪除</button>`;
  return `<button type="button" class="btn btn--secondary btn--sm" onclick="Stockout.openEditStockoutModal(${o.id})">✏️ 編輯</button><button type="button" class="btn btn--secondary btn--sm" onclick="Stockout.returnStockout(${o.id})">↩️ 退回</button><button type="button" class="btn btn--danger btn--sm" onclick="Stockout.deleteStockoutRecord(${o.id})">刪除</button>`;
}

/**
 * 以桌面列呈現一筆記錄，並顯示轉換後的退回庫存區名稱。
 * @param {object} o 出庫記錄物件。
 * @param {boolean} isViewer 是否為僅檢視者；若是，則不提供異動操作。
 * @returns {string} 已跳脫 HTML 的記錄列字串。
 */
function renderStockoutDesktopRow(o, isViewer) {
  const reverted = !!o.reverted_at;
  const isReturn = o.reason === '退回已領出';
  const returnReverted = isReturn && reverted;
  const rowClass = returnReverted ? 'is-reverted-return' : (isReturn ? 'is-return' : (reverted ? 'is-reverted' : ''));
  const photo = o.has_photo ? `<img class="so-photo stockout-photo" src="${photoSrc(o.item_id, 'thumbnail')}" alt="" loading="lazy" onclick="Inventory.openPhotoLightbox(${o.item_id})" title="點擊看大圖">` : '<div class="so-photo stockout-photo stockout-photo-empty">📷</div>';
  const destination = o.destination ? `<span class="stockout-destination-badge">🏢 ${esc(o.destination)}</span>` : '';
  const returnSite = inventorySiteLabel(o.return_site || '');
  const returnSeparator = returnSite ? '／' : '';
  const returnLocation = isReturn && o.return_location ? `<span class="stockout-destination-badge return-location">📍 ${esc(returnSite)}${esc(returnSeparator)}${esc(o.return_location)}</span>` : '';
  const returned = returnReverted ? '<span class="stockout-returned-badge revoked">↩️ 已撤銷退回</span>' : (isReturn ? '<span class="stockout-returned-badge">↩️ 已退回</span>' : (reverted ? '<span class="stockout-returned-badge revoked">已撤銷</span>' : ''));
  const quantityClass = returnReverted ? 'is-revoked' : (isReturn ? 'qty-pos' : 'qty-neg');
  return `<tr class="stockout-record-row ${esc(rowClass)}"><td>${photo}</td><td><div class="stockout-item-name">${esc(o.brand)} ${esc(o.item_name)}${o.item_deleted ? '<span class="tag-nonstock">非庫存</span>' : ''}${returned}</div>${o.code ? `<small class="stockout-item-meta">型號 ${esc(o.code)}</small>` : ''}${o.note ? `<small class="stockout-note">📝 ${esc(o.note)}</small>` : ''}</td><td class="stockout-qty ${esc(quantityClass)}">${isReturn ? '+' : '-'}${esc(Qty.disp(o.delta, o.unit))} ${esc(o.unit)}</td><td><div class="stockout-destination">${destination}${returnLocation}</div>${!destination && !returnLocation ? '<span class="muted">—</span>' : ''}</td><td><div class="stockout-actions">${renderStockoutActions(o, isViewer)}</div></td></tr>`;
}

/**
 * 以行動版卡片呈現一筆記錄，並顯示轉換後的退回庫存區名稱。
 * @param {object} o 出庫記錄物件。
 * @param {boolean} isViewer 是否為僅檢視者；若是，則不提供異動操作。
 * @returns {string} 已跳脫 HTML 的記錄卡片字串。
 */
function renderStockoutMobileCard(o, isViewer) {
  const reverted = !!o.reverted_at;
  const isReturn = o.reason === '退回已領出';
  const returnReverted = isReturn && reverted;
  const returned = returnReverted ? '<span class="stockout-returned-badge revoked">↩️ 已撤銷退回</span>' : (isReturn ? '<span class="stockout-returned-badge">↩️ 已退回</span>' : (reverted ? '<span class="stockout-returned-badge revoked">已撤銷</span>' : ''));
  const returnSite = inventorySiteLabel(o.return_site || '');
  return mobileCardShell({
    reverted: reverted,
    moreBtnHTML: `<button class="more-btn" onclick="Stockout.openStockoutSheet(${o.id})">⋯</button>`,
    thumb: buildThumb(o.item_id, o.has_photo, o.item_name, '📷'),
    nameHTML: `${esc(o.brand)} ${esc(o.item_name)}${o.item_deleted ? '<span class="tag-nonstock">非庫存</span>' : ''}${o.code ? `<small class="stockout-item-meta">型號 ${esc(o.code)}</small>` : ''}${returned}`,
    subHTML: esc(String(o.created_at || '').slice(5,10)),
    extraHTML: `${o.destination ? `<div><span class="loc-tag">🏢 ${esc(o.destination)}</span></div>` : ''}${isReturn && o.return_location ? `<div><span class="loc-tag">📍 ${esc(returnSite)}${esc(returnSite ? '／' : '')}${esc(o.return_location)}</span></div>` : ''}`,
    noteHTML: o.note ? `<div class="item-note"><span class="item-note-label">📝 註解: </span><span class="item-note-text">${esc(o.note)}</span></div>` : '',
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
  const searchValue = String(stockoutState.stockoutPageSearch || globalSearchValue);
  return `<section class="stockout-page-header"><div class="stockout-heading-copy"><div class="stockout-heading-icon" aria-hidden="true">🚚</div><div><h1>已領出</h1><p>查看所有已從庫存領出的品項紀錄。</p></div></div><div class="stockout-filter-bar"><label class="stockout-filter-field">開始日期<input type="date" value="${esc(stockoutState.stockoutDateFrom)}" onchange="Stockout.setStockoutFilter('from', this.value)"></label><label class="stockout-filter-field">結束日期<input type="date" value="${esc(stockoutState.stockoutDateTo)}" onchange="Stockout.setStockoutFilter('to', this.value)"></label><label class="stockout-filter-field search">關鍵字搜尋<input type="search" value="${esc(searchValue)}" placeholder="搜尋品項、型號、領用去向..." oninput="Stockout.setStockoutFilter('search', this.value)" onkeydown="if(event.key === 'Enter') Stockout.renderStockOuts()"></label><button type="button" class="btn btn--secondary btn--md stockout-filter-action" onclick="Stockout.renderStockOuts()">搜尋</button><button type="button" class="btn btn--secondary btn--md stockout-filter-action" onclick="Stockout.clearStockoutFilters()">清除</button>${isViewer ? '' : '<button type="button" class="btn btn--primary btn--md stockout-filter-action primary" onclick="Stockout.openNonStockOutModal()">＋ 新增已領出</button>'}</div></section><section class="stockout-kpi-grid ui-kpi-grid"><div class="stockout-kpi-card ui-kpi-card ui-kpi-card--purple purple"><div class="stockout-kpi-icon ui-kpi-icon">📋</div><div class="ui-kpi-body"><div class="stockout-kpi-label ui-kpi-label">領出總筆數</div><div class="stockout-kpi-number ui-kpi-value">${esc(String(kpis.recordCount))}</div><span class="ui-kpi-meta">目前篩選結果</span></div></div><div class="stockout-kpi-card ui-kpi-card ui-kpi-card--green green"><div class="stockout-kpi-icon ui-kpi-icon">📦</div><div class="ui-kpi-body"><div class="stockout-kpi-label ui-kpi-label">總領出數量(個)</div><div class="stockout-kpi-number ui-kpi-value">${esc(String(kpis.totalOutbound))}</div><span class="ui-kpi-meta">有效領出合計</span></div></div><div class="stockout-kpi-card ui-kpi-card ui-kpi-card--blue blue"><div class="stockout-kpi-icon ui-kpi-icon">📅</div><div class="ui-kpi-body"><div class="stockout-kpi-label ui-kpi-label">領出日期 (天)</div><div class="stockout-kpi-number ui-kpi-value">${esc(String(kpis.dateGroupCount))}</div><span class="ui-kpi-meta">去重日期</span></div></div><div class="stockout-kpi-card ui-kpi-card ui-kpi-card--amber amber"><div class="stockout-kpi-icon ui-kpi-icon">🔧</div><div class="ui-kpi-body"><div class="stockout-kpi-label ui-kpi-label">品項種類</div><div class="stockout-kpi-number ui-kpi-value">${esc(String(kpis.uniqueItemCount))}</div><span class="ui-kpi-meta">去重品項</span></div></div></section>`;
}

export function clearStockoutFilters() {
  stockoutState.stockoutDateFrom = '';
  stockoutState.stockoutDateTo = '';
  stockoutState.stockoutPageSearch = '';
  const globalSearch = document.getElementById('search-input');
  if (globalSearch) globalSearch.value = '';
  renderStockOuts();
}

// 篩選列的 inline handler：日期變更即重新查詢；關鍵字只記錄，按 Enter 才查詢
export function setStockoutFilter(field, value) {
  if (field === 'search') { stockoutState.stockoutPageSearch = value; return; }
  if (field === 'from') stockoutState.stockoutDateFrom = value;
  else stockoutState.stockoutDateTo = value;
  renderStockOuts();
}

var stockoutRenderRequestSeq = 0;

export async function renderStockOuts() {
  const requestId = ++stockoutRenderRequestSeq;
  const siteAtRequest = appState.currentSite;
  const isCurrent = function() {
    return requestId === stockoutRenderRequestSeq
      && appState.currentTab === 'stockout'
      && siteAtRequest === appState.currentSite;
  };
  const isViewer = !hasPerm('stockout');
  const content = document.getElementById('content');
  if (!content) return;
  content.innerHTML = '<div class="stockout-loading">載入已領出紀錄…</div>';
  try {
    const outs = await apiFetch(`/api/stockouts?limit=200&site=${encodeURIComponent(siteAtRequest)}`);
    if (!isCurrent()) return;
    stockoutState.stockoutRecords = outs;
    const filteredOuts = filterStockoutRecords(outs);
    const kpis = getStockoutKpis(filteredOuts);
    const stockoutBar = renderStockoutPageHeader(isViewer, kpis);
    let html = stockoutBar;
    html += `<div class="stockout-toolbar"><span>共 <strong>${esc(String(kpis.recordCount))}</strong> 筆</span>${filteredOuts.length !== outs.length ? `<span>已篩選 ${esc(String(filteredOuts.length))} / ${esc(String(outs.length))} 筆</span>` : ''}<button class="btn btn--export btn--md btn-export" onclick="Stockout.openStockoutExportDialog()">📊 匯出報表</button></div>`;
    if (!filteredOuts.length) {
      const filtered = outs.length > 0;
      html += `<div class="stockout-empty-state"><span class="empty-icon">🚚</span><strong>${esc(filtered ? '沒有符合條件的已領出紀錄' : '目前沒有已領出的紀錄')}</strong><p>${esc(filtered ? '可以清除搜尋或日期篩選後再試一次。' : '當商品正式領出後，紀錄會顯示在這裡。')}</p>${filtered ? '<button type="button" class="btn btn--secondary btn--md stockout-filter-action" onclick="Stockout.clearStockoutFilters()">清除篩選</button>' : ''}</div>`;
      if (!isCurrent()) return;
      content.innerHTML = html;
      return;
    }
    const byDate = {};
    filteredOuts.forEach(function(o) { const date = String(o.created_at || '').slice(0, 10); (byDate[date] = byDate[date] || []).push(o); });
    const isMobile = isMobileView();
    Object.keys(byDate).sort().reverse().forEach(function(date) { html += renderStockoutGroup(date, byDate[date], isViewer, isMobile); });
    if (!isCurrent()) return;
    content.innerHTML = html;
  } catch (e) {
    if (!isCurrent()) return;
    console.error('[renderStockOuts] 已領出紀錄載入失敗', e);
    content.innerHTML = `<div class="stockout-error-state"><h2>載入已領出紀錄失敗</h2><p>${esc(e.message || '請稍後再試')}</p><button type="button" class="btn btn--secondary btn--md stockout-filter-action" onclick="Stockout.renderStockOuts()">重新載入</button></div>`;
  }
}

// 分組：按日（套用日期與關鍵字篩選後）

// 刪除已領出紀錄（僅刪紀錄、不回補庫存；2026-08-11 Sarah 需求）

export async function deleteStockoutRecord(movementId) {
  if (!confirm('確定刪除這筆已領出紀錄？只刪紀錄、不會回補庫存。')) return;
  try {
    await apiFetch(`/api/stockouts/${movementId}`, { method: 'DELETE', fallback: '刪除失敗' });
    toast('✅ 已刪除紀錄', 'success');
    await refreshDestinationsAfterMutation();
    renderStockOuts();
  } catch (e) {
    toast('⚠️ ' + e.message, 'error');
  }
}





// ========== 手機版 ⋯ 動作選單（已領出卡） ==========

export function openStockoutSheet(movementId) {

  const rec = (typeof stockoutState.stockoutRecords !== 'undefined' ? stockoutState.stockoutRecords : []).find(r => r.id === movementId);

  if (!rec) return;

  const isViewer = !hasPerm('stockout');

  const reverted = !!rec.reverted_at;
  const isReturn = rec.reason === '退回已領出';

  const actions = [];

  if (!isViewer) {

    if (isReturn && !reverted) {
      actions.push({ icon: '✏️', label: '編輯', cls: 'out', fn: () => openEditStockoutReturnModal(movementId) });
      actions.push({ icon: '↩️', label: '撤銷退回', cls: 'del', fn: () => deleteStockoutReturn(movementId) });
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
