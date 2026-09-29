// 每日工作進度回報（獨立頁面；資料/權限/照片不與簽名報表共用）

import { apiFetch } from '../../core/api-client.js';
import { esc, hasPerm, toast } from '../../core/utils.js';
import { wprClearPhotoManageStates, wprOpenHistoryDetail } from './detail.js';
import { wprClearPendingFiles, wprHasUnsavedChanges, wprInstallBeforeUnload, wprRequestDraftReset } from './draft.js';
import { wprCurrentUserName, wprIsoDate, wprTimeText } from './format.js';
import { wprLoadHistory, wprLoadKpi, wprSetHistoryMonth } from './history.js';
import { workProgressState } from './state.js';
import { wprBindDropZone, wprRenderPendingPhotos } from './upload.js';

var wprCurrentDateValue = '';

/**
 * Mount the Work Progress page and start its initial data loads.
 * @returns {void} Function result.
 */
export async function renderWorkProgress() {
  var el = document.getElementById('content');
  if (!el) return;
  wprClearPendingFiles();
  workProgressState.wprDayRequestToken++; workProgressState.wprHistoryRequestToken++; workProgressState.wprKpiRequestToken++; workProgressState.wprDetailRequestTokens = {}; workProgressState.wprPhotoManageStates = {}; workProgressState.wprPhotoManageReports = {}; workProgressState.wprSuppressHistoryToggle = {}; workProgressState.wprSelectRequestToken++;
  workProgressState.wprAppointments = [];
  workProgressState.wprReportsByAppointment = {};
  workProgressState.wprCurrentReport = null;
  el.innerHTML = `
    <div class="wpr-wrap">
      <section class="wpr-page-header">
        <div><div class="wpr-eyebrow">📸 現場紀錄</div><h1>每日工作進度回報</h1><p>記錄每日工作進度、備註及施工現場照片。</p></div>
        <button class="btn btn--secondary btn--md wpr-history-jump" type="button" onclick="document.getElementById('wpr-history').scrollIntoView({behavior:'smooth'})">查看歷史 ↓</button>
      </section>
      <div class="wpr-layout">
        <section class="wpr-card wpr-create-card" id="wpr-create"></section>
        <aside class="wpr-side">
          <div class="wpr-info">
            <h3>💡 使用流程</h3>
            <ul>
              <li><span class="wpr-badge">1</span>選擇工作日期，載入當日行事曆工作</li>
              <li><span class="wpr-badge">2</span>選擇一筆工作，確認工作摘要與行事曆備註</li>
              <li><span class="wpr-badge">3</span>填寫進度備註，拍照或從相簿加入施工照片</li>
              <li><span class="wpr-badge">4</span>儲存回報，之後可在歷史區查看、編輯或管理照片</li>
            </ul>
            <div class="wpr-info-badges">
              <span class="wpr-badge">📅 工作來源：行事曆</span>
              <span class="wpr-badge">📸 施工照片可選填</span>
              <span class="wpr-badge">🔒 依權限管理本人或全部資料</span>
            </div>
          </div>
          <div class="wpr-card wpr-kpi-card">
            <div class="wpr-section-heading"><div><h2>📊 本月概況</h2><p>依目前存在的行事曆工作計算。</p></div></div>
            <div class="wpr-kpi-grid" id="wpr-kpi"></div>
            <div class="wpr-hint">待回報 = 本月仍沒有工作進度回報的行事曆工作。</div>
          </div>
        </aside>
        <section class="wpr-card wpr-history-card" id="wpr-history">
          <div class="wpr-section-heading">
            <div><h2>歷史工作進度</h2><p>可查單日／週／本月／全部，並搜尋客戶、服務、地址、備註或回報人。</p></div>
          </div>
          <div class="wpr-history-filters">
            <div class="wpr-filter-field"><label for="wpr-from">起始日</label><input type="date" id="wpr-from" aria-label="起始日期"></div>
            <div class="wpr-filter-field"><label for="wpr-to">迄止日</label><input type="date" id="wpr-to" aria-label="迄止日期"></div>
            <div class="wpr-filter-field wpr-filter-field--search"><label for="wpr-query">關鍵字（客戶／服務／地址／備註／回報人）</label><input type="search" id="wpr-query" placeholder="例：王先生、安裝、配管" aria-label="搜尋工作進度" onkeydown="if(event.key==='Enter') WorkProgress.wprLoadHistory(1)"></div>
            <div class="wpr-filter-actions"><button type="button" class="btn btn--primary btn--md" onclick="WorkProgress.wprLoadHistory(1)">搜尋</button><button type="button" class="btn btn--secondary btn--md" onclick="WorkProgress.wprResetFilter()">清除</button></div>
          </div>
          <div class="wpr-quick-filters">
            <button type="button" class="chip wpr-chip" data-role="wpr-range" data-range="today" onclick="WorkProgress.wprQuickRange('today', this)">今天</button>
            <button type="button" class="chip wpr-chip" data-role="wpr-range" data-range="week" onclick="WorkProgress.wprQuickRange('week', this)">本週</button>
            <button type="button" class="chip wpr-chip is-active" data-role="wpr-range" data-range="month" onclick="WorkProgress.wprQuickRange('month', this)">本月</button>
            <button type="button" class="chip wpr-chip" data-role="wpr-range" data-range="all" onclick="WorkProgress.wprQuickRange('all', this)">全部</button>
            <span class="wpr-result-count"><span id="wpr-result-count">0 筆</span></span>
          </div>
          <div id="wpr-history-list"></div>
        </section>
      </div>
    </div>`;
  wprSetHistoryMonth();
  wprRenderCreate();
  await Promise.all([wprLoadDay(), wprLoadHistory(), wprLoadKpi()]);
}

/**
 * Check the permission used to render and submit the create form.
 * @returns {void} Function result.
 */
export function wprCanCreate() {
  return hasPerm('work-progress-create');
}

/**
 * Render the create form or the view-only permission message.
 * @returns {void} Function result.
 */
export function wprRenderCreate() {
  var create = document.getElementById('wpr-create');
  if (!create) return;
  if (!wprCanCreate()) {
    create.innerHTML = `
      <div class="wpr-readonly-permission">
        <div class="wpr-readonly-permission-icon">🔒</div>
        <h2>目前只有檢視權限</h2>
        <p>你可以查看歷史工作進度與照片，但沒有新增工作進度回報的權限。</p>
      </div>`;
    return;
  }
  create.innerHTML = `
    <div class="wpr-section-heading"><div><h2>建立工作進度</h2><p>選擇行事曆工作後填寫現場回報。</p></div></div>
    <div class="wpr-field"><label for="wpr-date">工作日期 <b>*</b></label><input type="date" id="wpr-date" value="${esc(wprIsoDate())}" onchange="WorkProgress.wprHandleDateChange()"></div>
    <div class="wpr-field"><label>選擇工作內容 <b>*</b></label><div id="wpr-job-list" class="wpr-job-list"></div></div>
    <div id="wpr-selected-area" hidden></div>
    <section class="wpr-create-progress-section" aria-labelledby="wpr-create-progress-title">
      <h3 id="wpr-create-progress-title">工作進度資料</h3>
      <div class="wpr-field"><label for="wpr-uploader">回報人顯示名稱 <b>*</b></label><input id="wpr-uploader" type="text" maxlength="50"><div class="wpr-create-creator" id="wpr-create-creator"></div><div class="wpr-hint">修改回報人顯示名稱不會變更原始建立帳號與 ownership（權限）。</div></div>
      <div class="wpr-field"><label for="wpr-note">工作進度</label><textarea id="wpr-note" maxlength="1000" rows="5" placeholder="記錄今日完成內容、未完成項目或明日安排" oninput="WorkProgress.wprUpdateNoteCount()"></textarea><div class="wpr-counter" id="wpr-note-count">0 / 1000</div></div>
      <div class="wpr-field"><label>施工照片（選填）</label>
        <div class="wpr-photo-limit-copy">JPG、PNG、WebP · 單張最多 20MB · 每份最多 20 張</div>
        <div id="wpr-drop" class="wpr-drop">
          <div class="wpr-drop-icon">📸</div><div class="wpr-drop-title">拖曳多張圖片到此</div><div class="wpr-drop-sub">支援 JPG、PNG、WebP；也可以使用相簿或手機相機連續新增</div>
          <div class="wpr-photo-actions"><button id="wpr-album-button" type="button" class="btn btn--secondary btn--md" onclick="document.getElementById('wpr-album').click()">🖼 從相簿選擇</button><button id="wpr-camera-button" type="button" class="btn btn--secondary btn--md" onclick="document.getElementById('wpr-camera').click()">📷 拍照新增</button></div>
          <input id="wpr-album" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onchange="WorkProgress.wprAddPendingFiles(this.files);this.value=''"><input id="wpr-camera" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden onchange="WorkProgress.wprAddPendingFiles(this.files);this.value=''">
        </div>
        <div class="wpr-photo-counter" id="wpr-photo-counter">已選 0 / 20 張</div>
        <div id="wpr-pending-photos" class="wpr-photo-grid"></div>
      </div>
    </section>
    <button id="wpr-save" type="button" class="btn btn--primary btn--md wpr-save-button" disabled onclick="WorkProgress.wprSubmit()">儲存工作進度回報</button>`;
  var uploaderInput = document.getElementById('wpr-uploader');
  var creatorIdentity = document.getElementById('wpr-create-creator');
  var currentUserName = wprCurrentUserName();
  if (uploaderInput) uploaderInput.value = currentUserName;
  workProgressState.wprInitialUploaderName = currentUserName;
  var dateInput = document.getElementById('wpr-date');
  wprCurrentDateValue = dateInput ? dateInput.value : '';
  if (creatorIdentity) creatorIdentity.textContent = '建立帳號：' + currentUserName;
  wprInstallBeforeUnload();
  wprBindDropZone();
  wprUpdateNoteCount();
  wprRenderPendingPhotos();
}

/**
 * Load appointments and existing reports for the selected work date.
 * @returns {void} Function result.
 */
export async function wprLoadDay() {
  var dateInput = document.getElementById('wpr-date');
  if (!dateInput) return;
  var dateValue = dateInput.value;
  var token = ++workProgressState.wprDayRequestToken;
  try {
    var jobs = await apiFetch('/api/appointments?date=' + encodeURIComponent(dateValue));
    if (token !== workProgressState.wprDayRequestToken) return;
    var reports = await apiFetch('/api/work-progress?from_date=' + encodeURIComponent(dateValue) + '&to_date=' + encodeURIComponent(dateValue) + '&page_size=100');
    if (token !== workProgressState.wprDayRequestToken) return;
    workProgressState.wprAppointments = jobs || [];
    wprCurrentDateValue = dateValue;
    workProgressState.wprReportsByAppointment = {};
    (reports.items || []).forEach(function(report) { if (report.appointment_id !== null) workProgressState.wprReportsByAppointment[report.appointment_id] = report; });
    wprRenderJobs();
  } catch (error) {
    if (token !== workProgressState.wprDayRequestToken) return;
    workProgressState.wprAppointments = [];
    var list = document.getElementById('wpr-job-list');
    if (list) list.innerHTML = '<div class="wpr-empty">⚠️ 無法載入當日工作：' + esc(error.message) + '</div>';
  }
}
/**
 * Render appointment cards with their reported status.
 * @returns {void} Function result.
 */
function wprRenderJobs() {
  var list = document.getElementById('wpr-job-list');
  if (!list) return;
  if (!workProgressState.wprAppointments.length) { list.innerHTML = '<div class="wpr-empty">📅 此日期尚無工作安排<br><a href="/">前往行事曆</a></div>'; return; }
  list.innerHTML = workProgressState.wprAppointments.map(function(job) {
    var existing = workProgressState.wprReportsByAppointment[job.id];
    var selected = workProgressState.wprCurrentReport && workProgressState.wprCurrentReport.appointment_id === job.id;
    return '<button type="button" class="wpr-job-card ' + (selected ? 'is-selected' : '') + '" onclick="WorkProgress.wprSelectJob(' + job.id + ')"><span class="wpr-job-radio">' + (selected ? '●' : '○') + '</span><span class="wpr-job-body"><strong>' + wprTimeText(job) + '</strong><b>' + esc(job.service_name || '未指定服務') + '</b><span>👤 ' + esc(job.client_name || '') + '</span>' + (job.address ? '<span>📍 ' + esc(job.address) + '</span>' : '') + '</span><span class="wpr-job-status">' + (existing ? '✅ 已回報' : '尚未回報') + '</span></button>';
  }).join('');
}
/**
 * Render an optional escaped note row only when the source has content.
 * @param {string} label - Visible label for the note.
 * @param {string} value - User-authored note text.
 * @returns {string} Empty string or escaped note markup.
 */
export function wprOptionalNoteHtml(label, value) {
  return value ? '<div class="wpr-calendar-note"><span>' + esc(label) + '</span><strong>' + esc(value) + '</strong></div>' : '';
}

/**
 * Render the appointment-owned fields as a read-only create summary.
 * @param {Object} job - Selected calendar appointment.
 * @param {string} dateValue - Selected work date.
 * @returns {string} Escaped read-only calendar markup.
 */
function wprCalendarReadonlyHtml(job, dateValue) {
  return '<section class="wpr-create-calendar-section" aria-labelledby="wpr-create-calendar-title"><h3 id="wpr-create-calendar-title">行事曆資料</h3><div class="wpr-create-calendar-grid"><div><span>工作日期</span><strong>' + esc(dateValue || '—') + '</strong></div><div><span>時間</span><strong>' + wprTimeText(job) + '</strong></div><div><span>客戶 / 案場</span><strong>' + esc(job.client_name || '—') + '</strong></div><div><span>地址</span><strong>' + esc(job.address || '—') + '</strong></div><div><span>指定服務</span><strong>' + esc(job.service_name || '未指定服務') + '</strong></div></div>' + wprOptionalNoteHtml('行事曆備註', job.note) + '<p class="wpr-create-source-hint">以上內容來源自行事曆，如需修改請至行事曆調整。</p></section>';
}

/**
 * Select an appointment and render its snapshot or existing report summary.
 * @param {number} id - Function input.
 * @returns {void} Function result.
 */
export async function wprSelectJob(id) {
  var token = ++workProgressState.wprSelectRequestToken;
  var job = workProgressState.wprAppointments.find(function(item) { return item.id === id; });
  if (!job) return;
  if (workProgressState.wprCurrentReport && workProgressState.wprCurrentReport.appointment_id !== id && wprHasUnsavedChanges()) {
    wprRequestDraftReset(function() { wprSelectJob(id); });
    return;
  }
  var previousReportId = workProgressState.wprCurrentReport && Number.isInteger(workProgressState.wprCurrentReport.id) ? workProgressState.wprCurrentReport.id : null;
  var existing = workProgressState.wprReportsByAppointment[id];
  if (existing) {
    try {
      var report = await apiFetch('/api/work-progress/' + existing.id);
      if (token !== workProgressState.wprSelectRequestToken) return;
      workProgressState.wprCurrentReport = report;
    } catch (error) {
      if (token !== workProgressState.wprSelectRequestToken) return;
      toast(error.message, 'error');
      return;
    }
  } else {
    workProgressState.wprCurrentReport = { appointment_id: id, appointment: job };
  }
  var nextReportId = existing ? report.id : null;
  if (previousReportId && previousReportId !== nextReportId) {
    wprClearPhotoManageStates(function(targetId) { return targetId === 'wpr-selected-report-detail-' + previousReportId; });
  }
  wprRenderJobs();
  var area = document.getElementById('wpr-selected-area');
  var save = document.getElementById('wpr-save');
  if (existing) {
    area.hidden = false;
    area.innerHTML = '<div class="wpr-selected-summary"><strong>✓ 此工作已有工作進度回報</strong>' + wprOptionalNoteHtml('工作進度', existing.note) + '<button type="button" class="btn btn--secondary btn--sm" onclick="WorkProgress.wprOpenHistoryDetail(' + existing.id + ',\'wpr-selected-report-detail-' + existing.id + '\')">查看工作進度</button><div id="wpr-selected-report-detail-' + existing.id + '" class="wpr-selected-report-detail"></div></div>' + wprCalendarReadonlyHtml(job, document.getElementById('wpr-date').value);
    save.disabled = true;
  } else {
    area.hidden = false;
    area.innerHTML = '<div class="wpr-selected-summary"><strong>✓ 已選工作</strong></div>' + wprCalendarReadonlyHtml(job, document.getElementById('wpr-date').value);
    save.disabled = false;
  }
}
/**
 * Synchronize the progress-note character counter.
 * @returns {void} Function result.
 */
export function wprUpdateNoteCount() { var note = document.getElementById('wpr-note'); var counter = document.getElementById('wpr-note-count'); if (note && counter) counter.textContent = note.value.length + ' / 1000'; }
/**
 * Build one expandable history card summary.
 * @param {Object} report - Function input.
 * @returns {void} Function result.
 */
// <details> 展開時開啟詳情；程式主動展開（wprSuppressHistoryToggle 標記）時略過一次
export function wprHistoryToggled(el, id) { if (el.open && !workProgressState.wprSuppressHistoryToggle[id]) wprOpenHistoryDetail(id); workProgressState.wprSuppressHistoryToggle[id] = false; }

/**
 * Handle date changes without silently moving an unsaved draft.
 * @returns {void} Function result.
 */
export function wprHandleDateChange() {
  var dateInput = document.getElementById('wpr-date');
  var nextDate = dateInput ? dateInput.value : '';
  if (wprHasUnsavedChanges()) {
    var previousDate = wprCurrentDateValue;
    wprRequestDraftReset(function() {
      if (dateInput) dateInput.value = nextDate;
      wprCurrentDateValue = nextDate;
      wprLoadDay();
    }, previousDate);
    return;
  }
  wprCurrentDateValue = nextDate;
  wprLoadDay();
}
