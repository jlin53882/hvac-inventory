// 庫存管理系統 - 工作進度：KPI、歷史清單與分頁

import { apiFetch } from '../../core/api-client.js';
import { wprHistoryPageSize } from '../../core/state.js';
import { esc } from '../../core/utils.js';
import { wprClearPhotoManageStates } from './detail.js';
import { wprCreatedByText, wprIsoDate, wprMonth, wprTimeText } from './format.js';
import { workProgressState } from './state.js';

/**
 * Load and render the appointment-based monthly KPI summary.
 * @returns {void} Function result.
 */
export async function wprLoadKpi() {
  var el = document.getElementById('wpr-kpi'); if (!el) return;
  var token = ++workProgressState.wprKpiRequestToken;
  try { var data = await apiFetch('/api/work-progress/kpi?month=' + encodeURIComponent(wprMonth())); if (token !== workProgressState.wprKpiRequestToken) return; el.innerHTML = [{label:'已回報',value:data.reported},{label:'待回報',value:data.missing},{label:'回報率',value:data.rate === null ? '—' : data.rate + '%'}].map(function(item) { return '<div class="wpr-kpi"><span>' + item.label + '</span><strong>' + item.value + '</strong></div>'; }).join('') + '<div class="wpr-kpi-meta">本月目前 ' + data.total + ' 筆行事曆工作 · ' + data.photo_count + ' 張照片</div>'; } catch (error) { if (token === workProgressState.wprKpiRequestToken) el.innerHTML = ''; }
}
/**
 * Initialize history filters to the current calendar month.
 * @returns {void} Function result.
 */
export function wprSetHistoryMonth() {
  var now = new Date();
  var from = document.getElementById('wpr-from');
  var to = document.getElementById('wpr-to');
  if (from) from.value = wprIsoDate(new Date(now.getFullYear(), now.getMonth(), 1));
  if (to) to.value = wprIsoDate(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  document.querySelectorAll('[data-role="wpr-range"]').forEach(function(button) { button.classList.toggle('is-active', button.dataset.range === 'month'); });
}
/**
 * Clear history filters and reload the default month.
 * @returns {void} Function result.
 */
export function wprResetFilter() {
  var query = document.getElementById('wpr-query');
  if (query) query.value = '';
  wprSetHistoryMonth();
  wprLoadHistory(1);
}
/**
 * Apply a quick date range and reload history.
 * @param {string} type - Function input.
 * @param {HTMLElement} button - Function input.
 * @returns {void} Function result.
 */
export function wprQuickRange(type, button) {
  var today = new Date(), from = '', to = '';
  if (type === 'today') from = to = wprIsoDate(today);
  if (type === 'month') { from = wprIsoDate(new Date(today.getFullYear(), today.getMonth(), 1)); to = wprIsoDate(new Date(today.getFullYear(), today.getMonth() + 1, 0)); }
  if (type === 'week') { var day = today.getDay() || 7; var start = new Date(today); start.setDate(today.getDate() - day + 1); from = wprIsoDate(start); to = wprIsoDate(today); }
  if (button) document.querySelectorAll('[data-role="wpr-range"]').forEach(function(item) { item.classList.toggle('is-active', item === button); });
  var fromInput = document.getElementById('wpr-from');
  var toInput = document.getElementById('wpr-to');
  if (fromInput) fromInput.value = from;
  if (toInput) toInput.value = to;
  wprLoadHistory(1);
}
/**
 * Build pagination controls for the current history result set.
 * @returns {void} Function result.
 */
function wprRenderHistoryPagination() {
  var lastPage = Math.max(1, Math.ceil(workProgressState.wprHistoryTotal / wprHistoryPageSize));
  if (lastPage <= 1) return '';
  return '<nav class="wpr-pagination" aria-label="工作進度歷史分頁"><button type="button" class="btn btn--secondary btn--sm" onclick="WorkProgress.wprLoadHistory(' + (workProgressState.wprHistoryPage - 1) + ')"' + (workProgressState.wprHistoryPage <= 1 ? ' disabled' : '') + '>上一頁</button><span>第 ' + workProgressState.wprHistoryPage + ' / ' + lastPage + ' 頁 · 共 ' + workProgressState.wprHistoryTotal + ' 筆</span><button type="button" class="btn btn--secondary btn--sm" onclick="WorkProgress.wprLoadHistory(' + (workProgressState.wprHistoryPage + 1) + ')"' + (workProgressState.wprHistoryPage >= lastPage ? ' disabled' : '') + '>下一頁</button></nav>';
}

/**
 * Load the paginated history list and discard replaced history detail state.
 * @param {number} page - Requested history page.
 * @returns {Promise<void>} Completion promise.
 */
export async function wprLoadHistory(page) {
  var list = document.getElementById('wpr-history-list'); if (!list) return;
  page = Number.isInteger(page) && page > 0 ? page : 1;
  var token = ++workProgressState.wprHistoryRequestToken;
  var p = new URLSearchParams({ page: String(page), page_size: String(wprHistoryPageSize) }); var from = document.getElementById('wpr-from').value; var to = document.getElementById('wpr-to').value; var q = document.getElementById('wpr-query').value.trim();
  if (from) p.set('from_date', from); if (to) p.set('to_date', to); if (q) p.set('q', q);
  try {
    var data = await apiFetch('/api/work-progress?' + p);
    if (token !== workProgressState.wprHistoryRequestToken) return;
    workProgressState.wprHistoryTotal = Number(data.total) || 0;
    var resultCount = document.getElementById('wpr-result-count'); if (resultCount) resultCount.textContent = workProgressState.wprHistoryTotal + ' 筆';
    var lastPage = Math.max(1, Math.ceil(workProgressState.wprHistoryTotal / wprHistoryPageSize));
    if (page > lastPage) { wprLoadHistory(lastPage); return; }
    workProgressState.wprHistoryPage = Number(data.page) || page;
    wprClearPhotoManageStates(function(targetId) { return targetId.indexOf('wpr-detail-') === 0; });
    if (!data.items.length) { list.innerHTML = '<div class="wpr-empty wpr-history-empty">📸 尚無工作進度<br><small>目前沒有符合條件的工作進度回報。</small></div>'; return; }
    list.innerHTML = data.items.map(wprHistoryCard).join('') + wprRenderHistoryPagination();
  } catch (error) { if (token === workProgressState.wprHistoryRequestToken) list.innerHTML = '<div class="wpr-empty">⚠️ ' + esc(error.message) + '</div>'; }
}
function wprHistoryCard(report) { return '<details class="wpr-history-item" ontoggle="WorkProgress.wprHistoryToggled(this, ' + report.id + ')"><summary><span class="wpr-history-date">' + esc(report.report_date) + '</span><span><b>' + esc(report.service_name || '未指定服務') + ' · ' + esc(report.client_name) + '</b><small>' + wprTimeText(report) + ' · 回報人：' + esc(report.uploader_name) + ' · 建立帳號：' + esc(wprCreatedByText(report)) + '</small></span><span class="wpr-history-photo-count">📷 ' + report.photo_count + '</span></summary><div class="wpr-history-detail" id="wpr-detail-' + report.id + '">載入詳情中…</div></details>'; }
