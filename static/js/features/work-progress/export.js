// 庫存管理系統 - 工作進度：單筆匯出與「搜尋條件匯出」（確認清單分頁 → 背景產生 → 進度條 → 下載）

import { apiDownload, apiFetch } from '../../core/api-client.js';
import { esc, toast } from '../../core/utils.js';
import { wprHistoryPageSize } from './state.js';

var WPR_EXPORT_POLL_MS = 500;
var WPR_EXPORT_LARGE_PHOTOS = 500;   // 照片總數超過此值時在確認視窗提醒檔案較大
var wprExportCond = null;            // 目前確認視窗的條件 { from, to, q }
var wprExportJobId = null;           // 進行中的背景工作編號
var wprExportPollTimer = null;

/**
 * 驗證搜尋列條件：起迄日需同時填寫，且日期區間與關鍵字至少一項。
 * @param {string} from - 起始日。
 * @param {string} to - 迄止日。
 * @param {string} q - 關鍵字（已去頭尾空白）。
 * @returns {string} 錯誤訊息；空字串代表可匯出。
 */
export function wprExportConditionError(from, to, q) {
  if (Boolean(from) !== Boolean(to)) return '起始日與迄止日需同時填寫';
  if (!from && !q) return '請輸入關鍵字或日期區間';
  if (from && to && from > to) return '起始日期不可晚於迄止日期';
  return '';
}

/**
 * 進度百分比：以照片張數為主（最耗時），沒有照片時以筆數計。
 * @param {{total_reports:number, done_reports:number, total_photos:number, done_photos:number}} job - 進度。
 * @returns {number} 0~100 的整數。
 */
export function wprExportPercent(job) {
  var total = job.total_photos + job.total_reports;
  if (!total) return 0;
  return Math.min(100, Math.floor((job.done_photos + job.done_reports) * 100 / total));
}

function wprExportQuery(cond) {
  var p = new URLSearchParams();
  if (cond.from) { p.set('from_date', cond.from); p.set('to_date', cond.to); }
  if (cond.q) p.set('q', cond.q);
  return p;
}

/**
 * 單筆工作進度匯出（完整版），直接下載。
 * @param {number} id - 回報編號。
 * @param {HTMLElement} button - 觸發按鈕（匯出中停用）。
 * @returns {Promise<void>} Completion promise.
 */
export async function wprExportSingle(id, button) {
  if (button) { button.disabled = true; button.dataset.label = button.textContent; button.textContent = '匯出中…'; }
  try {
    var name = await apiDownload('/api/work-progress/' + encodeURIComponent(id) + '/export', { filename: '工程進度回報.xlsx', fallback: '匯出失敗' });
    toast('📤 已匯出 ' + name);
  } catch (e) {
    toast(e.status ? '❌ ' + e.message : '⚠️ 匯出失敗：' + e.message);
  } finally {
    if (button) { button.disabled = false; button.textContent = button.dataset.label || '📤 匯出 Excel'; }
  }
}

/**
 * 依歷史搜尋列條件開啟匯出確認視窗（第一頁）。
 * @returns {Promise<void>} Completion promise.
 */
export async function wprOpenConditionExport() {
  var from = (document.getElementById('wpr-from') || {}).value || '';
  var to = (document.getElementById('wpr-to') || {}).value || '';
  var q = ((document.getElementById('wpr-query') || {}).value || '').trim();
  var error = wprExportConditionError(from, to, q);
  if (error) { toast('⚠️ ' + error); return; }
  wprExportCond = { from: from, to: to, q: q };
  await wprExportPreviewPage(1);
}

/**
 * 載入並顯示確認清單的指定頁。
 * @param {number} page - 頁碼。
 * @returns {Promise<void>} Completion promise.
 */
export async function wprExportPreviewPage(page) {
  if (!wprExportCond) return;
  var p = wprExportQuery(wprExportCond);
  p.set('page', String(page)); p.set('page_size', String(wprHistoryPageSize));
  try {
    var data = await apiFetch('/api/work-progress/export/preview?' + p, { fallback: '無法載入匯出清單' });
    if (!wprExportCond) return;
    wprRenderExportDialog(wprExportPreviewHtml(data));
  } catch (e) {
    toast(e.status ? '❌ ' + e.message : '⚠️ ' + e.message);
  }
}

function wprExportConditionText(cond) {
  var parts = [];
  if (cond.from) parts.push(esc(cond.from) + ' ~ ' + esc(cond.to));
  if (cond.q) parts.push('關鍵字「' + esc(cond.q) + '」');
  return parts.join(' ／ ');
}

function wprExportPreviewHtml(data) {
  var lastPage = Math.max(1, Math.ceil(data.total / data.page_size));
  var rows = data.items.map(function(item) { return '<li><span class="wpr-export-date">' + esc(item.report_date) + '</span><span class="wpr-export-title">' + esc(item.title) + '</span><span class="wpr-export-photos">📷 ' + item.photo_count + '</span></li>'; }).join('');
  var pager = lastPage > 1 ? '<nav class="wpr-pagination wpr-export-pagination" aria-label="匯出清單分頁"><button type="button" class="btn btn--secondary btn--sm" data-action="wpr-export-page" data-page="' + (data.page - 1) + '"' + (data.page <= 1 ? ' disabled' : '') + '>上一頁</button><span>第 ' + data.page + ' / ' + lastPage + ' 頁</span><button type="button" class="btn btn--secondary btn--sm" data-action="wpr-export-page" data-page="' + (data.page + 1) + '"' + (data.page >= lastPage ? ' disabled' : '') + '>下一頁</button></nav>' : '';
  var warn = data.photo_total > WPR_EXPORT_LARGE_PHOTOS ? '<p class="wpr-export-warn">⚠️ 照片共 ' + data.photo_total + ' 張，檔案較大，匯出需要一些時間。</p>' : '';
  var body = data.total ? '<ul class="wpr-export-list">' + rows + '</ul>' + pager : '<div class="wpr-empty">沒有符合條件的工作進度回報。</div>';
  return '<div class="wpr-confirm-header"><h3 id="wpr-export-title">匯出確認</h3><button type="button" class="wpr-confirm-close" data-action="wpr-export-close" aria-label="關閉">✕</button></div>'
    + '<div class="wpr-confirm-body"><dl><dt>條件</dt><dd>' + wprExportConditionText(wprExportCond) + '</dd><dt>版面</dt><dd>精簡版</dd><dt>筆數 / 照片</dt><dd>共 ' + data.total + ' 筆 · 照片 ' + data.photo_total + ' 張</dd><dt>檔名</dt><dd>' + esc(data.filename) + '</dd></dl>' + warn + body + '</div>'
    + '<div class="wpr-confirm-footer"><button type="button" class="btn btn--secondary btn--md" data-action="wpr-export-close">取消</button><button type="button" class="btn btn--primary btn--md" data-action="wpr-export-confirm"' + (data.total ? '' : ' disabled') + '>確認匯出</button></div>';
}

function wprRenderExportDialog(inner) {
  var overlay = document.getElementById('wpr-export-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'wpr-confirm-overlay';
    overlay.id = 'wpr-export-overlay';
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = '<div class="wpr-confirm-dialog wpr-export-dialog" role="dialog" aria-modal="true" aria-labelledby="wpr-export-title">' + inner + '</div>';
}

function wprExportProgressHtml(job) {
  var percent = wprExportPercent(job);
  return '<div class="wpr-confirm-header"><h3 id="wpr-export-title">匯出中…</h3></div>'
    + '<div class="wpr-confirm-body"><div class="wpr-export-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + percent + '"><div class="wpr-export-progress-bar" id="wpr-export-progress-bar"></div></div>'
    + '<p class="wpr-export-progress-text" id="wpr-export-progress-text">' + wprExportProgressText(job, percent) + '</p><p>' + esc(job.filename) + '</p></div>'
    + '<div class="wpr-confirm-footer"><button type="button" class="btn btn--secondary btn--md" data-action="wpr-export-close">取消匯出</button></div>';
}

// 進度條寬度是執行期狀態，用 el.style.width 設定（不寫在 inline style 字串裡）
// 第一次畫出進度視窗，之後只更新寬度與文字，進度條才會連續前進
function wprShowExportProgress(job) {
  var percent = wprExportPercent(job);
  var bar = document.getElementById('wpr-export-progress-bar');
  if (!bar) {
    wprRenderExportDialog(wprExportProgressHtml(job));
    bar = document.getElementById('wpr-export-progress-bar');
  }
  bar.style.width = percent + '%';
  bar.parentElement.setAttribute('aria-valuenow', String(percent));
  document.getElementById('wpr-export-progress-text').textContent = wprExportProgressText(job, percent);
}

function wprExportProgressText(job, percent) {
  return percent + '% · ' + job.done_reports + ' / ' + job.total_reports + ' 筆（照片 ' + job.done_photos + ' / ' + job.total_photos + ' 張）';
}

/**
 * 確認匯出：建立背景工作並開始輪詢進度，完成後自動下載。
 * @returns {Promise<void>} Completion promise.
 */
export async function wprConfirmConditionExport() {
  if (!wprExportCond || wprExportJobId) return;
  try {
    var job = await apiFetch('/api/work-progress/export/jobs?' + wprExportQuery(wprExportCond), { method: 'POST', fallback: '無法開始匯出' });
    wprExportJobId = job.job_id;
    wprShowExportProgress(job);
    wprExportSchedulePoll();
  } catch (e) {
    toast(e.status ? '❌ ' + e.message : '⚠️ ' + e.message);
  }
}

function wprExportSchedulePoll() { wprExportPollTimer = setTimeout(wprExportPoll, WPR_EXPORT_POLL_MS); }

async function wprExportPoll() {
  var jobId = wprExportJobId;
  if (!jobId) return;
  try {
    var job = await apiFetch('/api/work-progress/export/jobs/' + encodeURIComponent(jobId), { fallback: '無法取得匯出進度' });
    if (wprExportJobId !== jobId) return;
    wprShowExportProgress(job);
    if (job.status === 'running') { wprExportSchedulePoll(); return; }
    if (job.status === 'done') {
      var name = await apiDownload('/api/work-progress/export/jobs/' + encodeURIComponent(jobId) + '/download', { filename: job.filename, fallback: '下載失敗' });
      wprExportJobId = null;
      wprCloseConditionExport();
      toast('📤 已匯出 ' + name);
      return;
    }
    wprExportJobId = null;
    wprCloseConditionExport();
    toast(job.status === 'error' ? '❌ ' + (job.error || '匯出失敗') : '已取消匯出');
  } catch (e) {
    if (wprExportJobId !== jobId) return;
    wprExportJobId = null;
    wprCloseConditionExport();
    toast(e.status ? '❌ ' + e.message : '⚠️ ' + e.message);
  }
}

/**
 * 關閉匯出視窗；背景工作仍在進行時一併取消（伺服器刪除暫存檔）。
 * @returns {void} Function result.
 */
export function wprCloseConditionExport() {
  if (wprExportPollTimer) { clearTimeout(wprExportPollTimer); wprExportPollTimer = null; }
  var jobId = wprExportJobId;
  wprExportJobId = null;
  wprExportCond = null;
  if (jobId) {
    apiFetch('/api/work-progress/export/jobs/' + encodeURIComponent(jobId), { method: 'DELETE' }).catch(function() {});
    toast('已取消匯出');
  }
  var overlay = document.getElementById('wpr-export-overlay');
  if (overlay) overlay.remove();
}
