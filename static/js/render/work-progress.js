// 每日工作進度回報（獨立頁面；資料/權限/照片不與簽名報表共用）
// 依賴：globals.js、utils.js（esc/toast/hasPerm）

var wprGallery = { report: null, index: 0 };
var wprGalleryRequestToken = 0;
var wprGalleryPreloadState = wprCreateGalleryPreloadState();
var wprLastDetailReport = null;
var wprPhotoManageReports = {};
var wprSuppressHistoryToggle = {};
var wprPendingSubmit = null;
var wprPendingGallery = { index: -1 };
var wprInitialUploaderName = '';
var wprCurrentDateValue = '';
var wprBeforeUnloadInstalled = false;
var wprLeaveRequest = null;
// Gallery dynamically creates id="wpr-gallery-overlay" before lookup.
// Work Progress dialogs dynamically create id="wpr-confirm-overlay", id="wpr-unsaved-overlay", and id="wpr-pending-gallery-overlay".

/**
 * Format a local Date as the date value used by the Work Progress API.
 * @param {Date} date - Function input.
 * @returns {void} Function result.
 */
function wprIsoDate(date) {
  var d = date || new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
/**
 * Extract the YYYY-MM month used by KPI requests.
 * @param {string} dateValue - Function input.
 * @returns {void} Function result.
 */
function wprMonth(dateValue) { return (dateValue || wprIsoDate()).slice(0, 7); }
/**
 * Render a job time range without inventing a midnight time.
 * @param {Object} job - Function input.
 * @returns {void} Function result.
 */
function wprTimeText(job) {
  return job.start_time && job.end_time ? esc(job.start_time) + '–' + esc(job.end_time) : '未指定時間';
}
/**
 * Convert a non-success API response into the shared promise error path.
 * @param {Response} response - Function input.
 * @returns {void} Function result.
 */
function wprApiError(response) {
  return response.json().catch(function() { return {}; }).then(function(body) {
    throw new Error(body.detail || ('API 錯誤：' + response.status));
  });
}
/**
 * Fetch and decode a JSON Work Progress response.
 * @param {string} url - Function input.
 * @param {RequestInit} options - Function input.
 * @returns {void} Function result.
 */
async function wprFetch(url, options) {
  var response = await fetch(url, options);
  if (!response.ok) return wprApiError(response);
  return response.json();
}
/**
 * Resolve the read-only display name shown on the create form.
 * @returns {void} Function result.
 */
function wprCurrentUserName() {
  return ((typeof currentUser !== 'undefined' && currentUser && (currentUser.display_name || currentUser.username)) || '目前登入者');
}

/**
 * Mount the Work Progress page and start its initial data loads.
 * @returns {void} Function result.
 */
async function renderWorkProgress() {
  var el = document.getElementById('content');
  if (!el) return;
  wprClearPendingFiles();
  wprDayRequestToken++; wprHistoryRequestToken++; wprKpiRequestToken++; wprDetailRequestTokens = {}; wprPhotoManageReports = {}; wprSuppressHistoryToggle = {}; wprSelectRequestToken++;
  wprAppointments = [];
  wprReportsByAppointment = {};
  wprCurrentReport = null;
  el.innerHTML = `
    <div class="wpr-wrap">
      <section class="wpr-page-header">
        <div><div class="wpr-eyebrow">📸 現場紀錄</div><h1>每日工作進度回報</h1><p>記錄每日工作進度、備註及施工現場照片。</p></div>
        <button class="wpr-history-jump" type="button" onclick="document.getElementById('wpr-history').scrollIntoView({behavior:'smooth'})">查看歷史 ↓</button>
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
              <span class="wpr-badge">📸 首次回報至少 1 張照片</span>
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
            <div class="wpr-filter-field wpr-filter-field--search"><label for="wpr-query">關鍵字（客戶／服務／地址／備註／回報人）</label><input type="search" id="wpr-query" placeholder="例：王先生、安裝、配管" aria-label="搜尋工作進度" onkeydown="if(event.key==='Enter') wprLoadHistory(1)"></div>
            <div class="wpr-filter-actions"><button type="button" class="wpr-filter-primary" onclick="wprLoadHistory(1)">搜尋</button><button type="button" onclick="wprResetFilter()">清除</button></div>
          </div>
          <div class="wpr-quick-filters">
            <button type="button" class="wpr-chip" onclick="wprQuickRange('today', this)">今天</button>
            <button type="button" class="wpr-chip" onclick="wprQuickRange('week', this)">本週</button>
            <button type="button" class="wpr-chip active" onclick="wprQuickRange('month', this)">本月</button>
            <button type="button" class="wpr-chip" onclick="wprQuickRange('all', this)">全部</button>
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
function wprCanCreate() {
  return typeof hasPerm === 'function' ? hasPerm('work-progress-create') : !!(
    typeof currentUser !== 'undefined' && currentUser &&
    currentUser.permissions && currentUser.permissions['work-progress-create']
  );
}

/**
 * Render the create form or the view-only permission message.
 * @returns {void} Function result.
 */
function wprRenderCreate() {
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
    <div class="wpr-field"><label for="wpr-date">工作日期 <b>*</b></label><input type="date" id="wpr-date" value="${esc(wprIsoDate())}" onchange="wprHandleDateChange()"></div>
    <div class="wpr-field"><label>選擇工作內容 <b>*</b></label><div id="wpr-job-list" class="wpr-job-list"></div></div>
    <div id="wpr-selected-area" hidden></div>
    <section class="wpr-create-progress-section" aria-labelledby="wpr-create-progress-title">
      <h3 id="wpr-create-progress-title">工作進度資料</h3>
      <div class="wpr-field"><label for="wpr-uploader">回報人顯示名稱 <b>*</b></label><input id="wpr-uploader" type="text" maxlength="50"><div class="wpr-create-creator" id="wpr-create-creator"></div><div class="wpr-hint">修改回報人顯示名稱不會變更原始建立帳號與 ownership（權限）。</div></div>
      <div class="wpr-field"><label for="wpr-note">工作進度</label><textarea id="wpr-note" maxlength="1000" rows="5" placeholder="記錄今日完成內容、未完成項目或明日安排" oninput="wprUpdateNoteCount()"></textarea><div class="wpr-counter" id="wpr-note-count">0 / 1000</div></div>
      <div class="wpr-field"><label>施工照片 <b>*</b></label>
        <div class="wpr-photo-limit-copy">JPG、PNG、WebP · 單張最多 20MB · 每份最多 20 張</div>
        <div id="wpr-drop" class="wpr-drop">
          <div class="wpr-drop-icon">📸</div><div class="wpr-drop-title">拖曳多張圖片到此</div><div class="wpr-drop-sub">支援 JPG、PNG、WebP；也可以使用相簿或手機相機連續新增</div>
          <div class="wpr-photo-actions"><button id="wpr-album-button" type="button" class="wpr-photo-button" onclick="document.getElementById('wpr-album').click()">🖼 從相簿選擇</button><button id="wpr-camera-button" type="button" class="wpr-photo-button" onclick="document.getElementById('wpr-camera').click()">📷 拍照新增</button></div>
          <input id="wpr-album" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onchange="wprAddPendingFiles(this.files);this.value=''"><input id="wpr-camera" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden onchange="wprAddPendingFiles(this.files);this.value=''">
        </div>
        <div class="wpr-photo-counter" id="wpr-photo-counter">已選 0 / 20 張</div>
        <div id="wpr-pending-photos" class="wpr-photo-grid"></div>
      </div>
    </section>
    <button id="wpr-save" type="button" class="wpr-save-button" disabled onclick="wprSubmit()">儲存工作進度回報</button>`;
  var uploaderInput = document.getElementById('wpr-uploader');
  var creatorIdentity = document.getElementById('wpr-create-creator');
  var currentUserName = wprCurrentUserName();
  if (uploaderInput) uploaderInput.value = currentUserName;
  wprInitialUploaderName = currentUserName;
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
async function wprLoadDay() {
  var dateInput = document.getElementById('wpr-date');
  if (!dateInput) return;
  var dateValue = dateInput.value;
  var token = ++wprDayRequestToken;
  try {
    var jobs = await wprFetch('/api/appointments?date=' + encodeURIComponent(dateValue));
    if (token !== wprDayRequestToken) return;
    var reports = await wprFetch('/api/work-progress?from_date=' + encodeURIComponent(dateValue) + '&to_date=' + encodeURIComponent(dateValue) + '&page_size=100');
    if (token !== wprDayRequestToken) return;
    wprAppointments = jobs || [];
    wprCurrentDateValue = dateValue;
    wprReportsByAppointment = {};
    (reports.items || []).forEach(function(report) { if (report.appointment_id !== null) wprReportsByAppointment[report.appointment_id] = report; });
    wprRenderJobs();
  } catch (error) {
    if (token !== wprDayRequestToken) return;
    wprAppointments = [];
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
  if (!wprAppointments.length) { list.innerHTML = '<div class="wpr-empty">📅 此日期尚無工作安排<br><a href="/">前往行事曆</a></div>'; return; }
  list.innerHTML = wprAppointments.map(function(job) {
    var existing = wprReportsByAppointment[job.id];
    var selected = wprCurrentReport && wprCurrentReport.appointment_id === job.id;
    return '<button type="button" class="wpr-job-card ' + (selected ? 'is-selected' : '') + '" onclick="wprSelectJob(' + job.id + ')"><span class="wpr-job-radio">' + (selected ? '●' : '○') + '</span><span class="wpr-job-body"><strong>' + wprTimeText(job) + '</strong><b>' + esc(job.service_name || '未指定服務') + '</b><span>👤 ' + esc(job.client_name || '') + '</span>' + (job.address ? '<span>📍 ' + esc(job.address) + '</span>' : '') + '</span><span class="wpr-job-status">' + (existing ? '✅ 已回報' : '尚未回報') + '</span></button>';
  }).join('');
}
/**
 * Render an optional escaped note row only when the source has content.
 * @param {string} label - Visible label for the note.
 * @param {string} value - User-authored note text.
 * @returns {string} Empty string or escaped note markup.
 */
function wprOptionalNoteHtml(label, value) {
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
async function wprSelectJob(id) {
  var token = ++wprSelectRequestToken;
  var job = wprAppointments.find(function(item) { return item.id === id; });
  if (!job) return;
  if (wprCurrentReport && wprCurrentReport.appointment_id !== id && wprHasUnsavedChanges()) {
    wprRequestDraftReset(function() { wprSelectJob(id); });
    return;
  }
  var existing = wprReportsByAppointment[id];
  if (existing) {
    try {
      var report = await wprFetch('/api/work-progress/' + existing.id);
      if (token !== wprSelectRequestToken) return;
      wprCurrentReport = report;
    } catch (error) {
      if (token !== wprSelectRequestToken) return;
      toast(error.message, 'error');
      return;
    }
  } else {
    wprCurrentReport = { appointment_id: id, appointment: job };
  }
  wprRenderJobs();
  var area = document.getElementById('wpr-selected-area');
  var save = document.getElementById('wpr-save');
  if (existing) {
    area.hidden = false;
    area.innerHTML = '<div class="wpr-selected-summary"><strong>✓ 此工作已有工作進度回報</strong>' + wprOptionalNoteHtml('工作進度', existing.note) + '<button type="button" onclick="wprOpenHistoryDetail(' + existing.id + ',\'wpr-selected-report-detail-' + existing.id + '\')">查看工作進度</button><div id="wpr-selected-report-detail-' + existing.id + '" class="wpr-selected-report-detail"></div></div>' + wprCalendarReadonlyHtml(job, document.getElementById('wpr-date').value);
    save.disabled = true;
  } else {
    area.hidden = false;
    area.innerHTML = '<div class="wpr-selected-summary"><strong>✓ 已選工作</strong></div>' + wprCalendarReadonlyHtml(job, document.getElementById('wpr-date').value);
    save.disabled = wprSelectedFiles.length === 0;
  }
}
/**
 * Synchronize the progress-note character counter.
 * @returns {void} Function result.
 */
function wprUpdateNoteCount() { var note = document.getElementById('wpr-note'); var counter = document.getElementById('wpr-note-count'); if (note && counter) counter.textContent = note.value.length + ' / 1000'; }
/**
 * Bind drag-and-drop handlers for pending photo selection.
 * @returns {void} Function result.
 */
function wprBindDropZone() {
  var drop = document.getElementById('wpr-drop');
  if (!drop) return;
  ['dragenter', 'dragover'].forEach(function(eventName) {
    drop.addEventListener(eventName, function(event) { event.preventDefault(); drop.classList.add('is-dragging'); });
  });
  ['dragleave', 'drop'].forEach(function(eventName) {
    drop.addEventListener(eventName, function(event) { event.preventDefault(); drop.classList.remove('is-dragging'); });
  });
  drop.addEventListener('drop', function(event) { wprAddPendingFiles(event.dataTransfer.files); });
}
/**
 * Return whether the create form contains content that would be lost.
 * @returns {boolean} Whether an unsaved appointment, field value, or photo exists.
 */
function wprHasUnsavedChanges() {
  var uploader = document.getElementById('wpr-uploader');
  var note = document.getElementById('wpr-note');
  return !!(
    (wprCurrentReport && !wprCurrentReport.id && wprCurrentReport.appointment_id) ||
    (note && note.value.trim()) ||
    (uploader && uploader.value.trim() !== wprInitialUploaderName) ||
    wprSelectedFiles.length
  );
}

/**
 * Install the browser unload guard once for the Work Progress page.
 * @returns {void} Function result.
 */
function wprInstallBeforeUnload() {
  if (wprBeforeUnloadInstalled) return;
  window.addEventListener('beforeunload', wprBeforeUnload);
  wprBeforeUnloadInstalled = true;
}

/**
 * Block browser reload/close only while the create form is dirty.
 * @param {BeforeUnloadEvent} event - Browser unload event.
 * @returns {void} Function result.
 */
function wprBeforeUnload(event) {
  if (!wprHasUnsavedChanges()) return;
  event.preventDefault();
  event.returnValue = '';
}

/**
 * Clear the pending create draft and release every owned object URL.
 * @returns {void} Function result.
 */
function wprClearPendingFiles() {
  wprClosePendingGallery();
  wprSelectedFiles.forEach(function(item) {
    if (item && item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  });
  wprSelectedFiles = [];
  wprRenderPendingPhotos();
}

var WPR_ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
var WPR_ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
var WPR_MAX_FILES = 20;
var WPR_MAX_FILE_BYTES = 20 * 1024 * 1024;
var WPR_MAX_BATCH_BYTES = 100 * 1024 * 1024;

/**
 * Validate one photo batch before mutating pending state or sending an append request.
 * @param {File[]|FileList} fileList - Candidate files.
 * @param {number} currentCount - Existing report or pending-photo count.
 * @returns {{ok: boolean, error?: string}} Validation result.
 */
function wprValidatePhotoBatch(fileList, currentCount) {
  var files = Array.from(fileList || []);
  var remaining = WPR_MAX_FILES - currentCount;
  if (!files.length) return {ok: false, error: '請選擇至少 1 張照片。'};
  if (files.length > remaining) return {ok: false, error: '目前已選 ' + currentCount + ' 張，最多還能新增 ' + Math.max(remaining, 0) + ' 張照片。請重新選擇不超過上限的照片。'};
  var totalBytes = 0;
  for (var i = 0; i < files.length; i += 1) {
    var file = files[i];
    var extension = (file.name || '').slice((file.name || '').lastIndexOf('.')).toLowerCase();
    if (WPR_ALLOWED_EXTENSIONS.indexOf(extension) < 0 || WPR_ALLOWED_MIME_TYPES.indexOf(file.type) < 0) return {ok: false, error: '不支援此圖片格式。目前僅支援 JPG、PNG、WebP。'};
    if (file.size > WPR_MAX_FILE_BYTES) return {ok: false, error: '單張圖片上限 20MB。'};
    totalBytes += file.size;
  }
  if (totalBytes > WPR_MAX_BATCH_BYTES) return {ok: false, error: '本次選擇圖片總大小不可超過 100MB。'};
  return {ok: true};
}

/**
 * Update the create photo counter and disable controls at the report limit.
 * @returns {void} Function result.
 */
function wprUpdatePendingPhotoControls() {
  var count = wprSelectedFiles.length;
  var counter = document.getElementById('wpr-photo-counter');
  if (counter) counter.textContent = '已選 ' + count + ' / ' + WPR_MAX_FILES + ' 張' + (count >= WPR_MAX_FILES ? ' · 已達照片上限' : '');
  ['wpr-album-button', 'wpr-camera-button'].forEach(function(id) {
    var button = document.getElementById(id);
    if (button) button.disabled = count >= WPR_MAX_FILES;
  });
}

/**
 * Validate and append a complete supported image batch without replacing earlier photos.
 * @param {FileList|File[]} fileList - Candidate files.
 * @returns {void} Function result.
 */
function wprAddPendingFiles(fileList) {
  var files = Array.from(fileList || []);
  var validation = wprValidatePhotoBatch(files, wprSelectedFiles.length);
  if (!validation.ok) { toast(validation.error, 'error'); return; }
  files.forEach(function(file) { wprSelectedFiles.push({file: file, previewUrl: URL.createObjectURL(file)}); });
  wprRenderPendingPhotos();
  if (wprCurrentReport && wprCurrentReport.appointment_id && !wprReportsByAppointment[wprCurrentReport.appointment_id]) document.getElementById('wpr-save').disabled = !wprSelectedFiles.length;
}

/**
 * Render pending photo thumbnails with separate preview and remove actions.
 * @returns {void} Function result.
 */
function wprRenderPendingPhotos() {
  var grid = document.getElementById('wpr-pending-photos');
  if (!grid) return;
  var addDisabled = wprSelectedFiles.length >= WPR_MAX_FILES ? ' disabled' : '';
  grid.innerHTML = wprSelectedFiles.map(function(item, index) { return '<div class="wpr-photo-tile"><button type="button" class="wpr-pending-preview" onclick="wprOpenPendingGallery(' + index + ')" aria-label="預覽第 ' + (index + 1) + ' 張待上傳照片"><img src="' + esc(item.previewUrl) + '" alt="待上傳照片 ' + (index + 1) + '"></button><button type="button" class="wpr-photo-remove" onclick="event.stopPropagation();wprRemovePending(' + index + ')" aria-label="移除第 ' + (index + 1) + ' 張照片">✕</button></div>'; }).join('') + '<button type="button" id="wpr-add-pending-button" class="wpr-add-tile" onclick="document.getElementById(\'wpr-album\').click()"' + addDisabled + '>＋新增</button>';
  wprUpdatePendingPhotoControls();
}

/**
 * Remove one pending photo and release only its object URL.
 * @param {number} index - Pending photo index.
 * @returns {void} Function result.
 */
function wprRemovePending(index) {
  var item = wprSelectedFiles[index];
  if (!item) return;
  wprClosePendingGallery();
  if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  wprSelectedFiles.splice(index, 1);
  wprRenderPendingPhotos();
  var save = document.getElementById('wpr-save');
  if (save && (!wprCurrentReport || !wprCurrentReport.appointment_id || !wprReportsByAppointment[wprCurrentReport.appointment_id])) save.disabled = !wprSelectedFiles.length;
}

/**
 * Build an immutable snapshot for the save confirmation modal.
 * @returns {Object|null} Snapshot containing file references but not copied file bytes.
 */
function wprBuildSubmitSnapshot() {
  var uploader = document.getElementById('wpr-uploader');
  var note = document.getElementById('wpr-note');
  var appointment = wprCurrentReport && wprCurrentReport.appointment;
  if (!uploader || !note || !wprCurrentReport || !appointment) return null;
  return {appointmentId: wprCurrentReport.appointment_id, uploaderName: uploader.value.trim(), note: note.value.trim(), files: wprSelectedFiles.slice(), date: document.getElementById('wpr-date').value, time: wprTimeText(appointment), clientName: appointment.client_name || '—', serviceName: appointment.service_name || '未指定服務'};
}

/**
 * Open a Work Progress-scoped final save confirmation dialog.
 * @param {Object} snapshot - Immutable content to display and submit.
 * @returns {void} Function result.
 */
function wprOpenSubmitConfirmation(snapshot) {
  wprPendingSubmit = snapshot;
  var old = document.getElementById('wpr-confirm-overlay');
  if (old) old.remove();
  var overlay = document.createElement('div');
  overlay.className = 'wpr-confirm-overlay';
  overlay.id = 'wpr-confirm-overlay';
  overlay.innerHTML = '<div class="wpr-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="wpr-confirm-title"><div class="wpr-confirm-header"><h3 id="wpr-confirm-title">確認儲存工作進度？</h3><button type="button" class="wpr-confirm-close" data-wpr-confirm-cancel aria-label="返回修改">✕</button></div><div class="wpr-confirm-body"><p>請確認以下工作進度內容無誤。</p><dl><dt>行事曆工作</dt><dd>' + esc(snapshot.date) + ' ' + snapshot.time + '<br>' + esc(snapshot.clientName) + ' · ' + esc(snapshot.serviceName) + '</dd><dt>回報人</dt><dd>' + esc(snapshot.uploaderName) + '</dd>' + (snapshot.note ? '<dt>工作進度</dt><dd>' + esc(snapshot.note) + '</dd>' : '') + '<dt>待上傳照片</dt><dd>' + snapshot.files.length + ' 張</dd></dl></div><div class="wpr-confirm-footer"><button type="button" class="wpr-confirm-secondary" data-wpr-confirm-cancel>返回修改</button><button type="button" class="wpr-confirm-primary" data-wpr-confirm-submit>確認儲存</button></div></div>';
  document.body.appendChild(overlay);
  overlay.querySelectorAll('[data-wpr-confirm-cancel]').forEach(function(button) { button.addEventListener('click', wprCloseSubmitConfirmation); });
  overlay.querySelector('[data-wpr-confirm-submit]').addEventListener('click', wprConfirmSubmit);
}

/**
 * Close the save confirmation without changing the draft.
 * @returns {void} Function result.
 */
function wprCloseSubmitConfirmation() {
  var overlay = document.getElementById('wpr-confirm-overlay');
  if (overlay) overlay.remove();
  wprPendingSubmit = null;
}

/**
 * Submit the exact snapshot after the user confirms the save dialog.
 * @returns {Promise<void>} Completion promise.
 */
async function wprConfirmSubmit() {
  var snapshot = wprPendingSubmit;
  var button = document.querySelector('[data-wpr-confirm-submit]');
  if (!snapshot || !button) return;
  button.disabled = true;
  button.textContent = '儲存中…';
  var form = new FormData();
  form.append('appointment_id', snapshot.appointmentId);
  form.append('uploader_name', snapshot.uploaderName);
  form.append('note', snapshot.note);
  snapshot.files.forEach(function(item) { form.append('files', item.file, item.file.name); });
  try {
    await wprFetch('/api/work-progress', {method: 'POST', body: form});
    wprCloseSubmitConfirmation();
    wprClearPendingFiles();
    wprCurrentReport = null;
    wprRenderCreate();
    await Promise.all([wprLoadDay(), wprLoadHistory(1), wprLoadKpi()]);
    toast('工作進度已儲存', 'success');
  } catch (error) {
    button.disabled = false;
    button.textContent = '確認儲存';
    toast(error.message, 'error');
  }
}

/**
 * Validate the draft and open confirmation instead of posting immediately.
 * @returns {void} Function result.
 */
async function wprSubmit() {
  if (!wprCanCreate()) { toast('沒有新增工作進度回報的權限', 'error'); return; }
  if (wprPendingSubmit || !wprCurrentReport || !wprCurrentReport.appointment_id || wprReportsByAppointment[wprCurrentReport.appointment_id] || !wprSelectedFiles.length) return;
  var uploader = document.getElementById('wpr-uploader');
  var uploaderName = uploader ? uploader.value.trim() : '';
  var note = document.getElementById('wpr-note');
  if (!uploaderName) { toast('請填寫回報人顯示名稱', 'error'); return; }
  if (uploaderName.length > 50) { toast('回報人顯示名稱最多 50 字', 'error'); return; }
  if (note && note.value.length > 1000) { toast('工作進度最多 1000 字', 'error'); return; }
  var snapshot = wprBuildSubmitSnapshot();
  if (snapshot) wprOpenSubmitConfirmation(snapshot);
}

/**
 * Load and render the appointment-based monthly KPI summary.
 * @returns {void} Function result.
 */
async function wprLoadKpi() {
  var el = document.getElementById('wpr-kpi'); if (!el) return;
  var token = ++wprKpiRequestToken;
  try { var data = await wprFetch('/api/work-progress/kpi?month=' + encodeURIComponent(wprMonth())); if (token !== wprKpiRequestToken) return; el.innerHTML = [{label:'已回報',value:data.reported},{label:'待回報',value:data.missing},{label:'回報率',value:data.rate === null ? '—' : data.rate + '%'}].map(function(item) { return '<div class="wpr-kpi"><span>' + item.label + '</span><strong>' + item.value + '</strong></div>'; }).join('') + '<div class="wpr-kpi-meta">本月目前 ' + data.total + ' 筆行事曆工作 · ' + data.photo_count + ' 張照片</div>'; } catch (error) { if (token === wprKpiRequestToken) el.innerHTML = ''; }
}
/**
 * Initialize history filters to the current calendar month.
 * @returns {void} Function result.
 */
function wprSetHistoryMonth() {
  var now = new Date();
  var from = document.getElementById('wpr-from');
  var to = document.getElementById('wpr-to');
  if (from) from.value = wprIsoDate(new Date(now.getFullYear(), now.getMonth(), 1));
  if (to) to.value = wprIsoDate(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  document.querySelectorAll('.wpr-chip').forEach(function(button) { button.classList.toggle('active', button.textContent.trim() === '本月'); });
}
/**
 * Clear history filters and reload the default month.
 * @returns {void} Function result.
 */
function wprResetFilter() {
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
function wprQuickRange(type, button) {
  var today = new Date(), from = '', to = '';
  if (type === 'today') from = to = wprIsoDate(today);
  if (type === 'month') { from = wprIsoDate(new Date(today.getFullYear(), today.getMonth(), 1)); to = wprIsoDate(new Date(today.getFullYear(), today.getMonth() + 1, 0)); }
  if (type === 'week') { var day = today.getDay() || 7; var start = new Date(today); start.setDate(today.getDate() - day + 1); from = wprIsoDate(start); to = wprIsoDate(today); }
  if (button) document.querySelectorAll('.wpr-chip').forEach(function(item) { item.classList.toggle('active', item === button); });
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
  var lastPage = Math.max(1, Math.ceil(wprHistoryTotal / wprHistoryPageSize));
  if (lastPage <= 1) return '';
  return '<nav class="wpr-pagination" aria-label="工作進度歷史分頁"><button type="button" onclick="wprLoadHistory(wprHistoryPage - 1)"' + (wprHistoryPage <= 1 ? ' disabled' : '') + '>上一頁</button><span>第 ' + wprHistoryPage + ' / ' + lastPage + ' 頁 · 共 ' + wprHistoryTotal + ' 筆</span><button type="button" onclick="wprLoadHistory(wprHistoryPage + 1)"' + (wprHistoryPage >= lastPage ? ' disabled' : '') + '>下一頁</button></nav>';
}
/**
 * Load and render a filtered, paginated history result.
 * @param {number} page - Function input.
 * @returns {void} Function result.
 */
async function wprLoadHistory(page) {
  var list = document.getElementById('wpr-history-list'); if (!list) return;
  page = Number.isInteger(page) && page > 0 ? page : 1;
  var token = ++wprHistoryRequestToken;
  var p = new URLSearchParams({ page: String(page), page_size: String(wprHistoryPageSize) }); var from = document.getElementById('wpr-from').value; var to = document.getElementById('wpr-to').value; var q = document.getElementById('wpr-query').value.trim();
  if (from) p.set('from_date', from); if (to) p.set('to_date', to); if (q) p.set('q', q);
  try {
    var data = await wprFetch('/api/work-progress?' + p);
    if (token !== wprHistoryRequestToken) return;
    wprHistoryTotal = Number(data.total) || 0;
    var resultCount = document.getElementById('wpr-result-count'); if (resultCount) resultCount.textContent = wprHistoryTotal + ' 筆';
    var lastPage = Math.max(1, Math.ceil(wprHistoryTotal / wprHistoryPageSize));
    if (page > lastPage) { wprLoadHistory(lastPage); return; }
    wprHistoryPage = Number(data.page) || page;
    if (!data.items.length) { list.innerHTML = '<div class="wpr-empty wpr-history-empty">📸 尚無工作進度<br><small>目前沒有符合條件的工作進度回報。</small></div>'; return; }
    list.innerHTML = data.items.map(wprHistoryCard).join('') + wprRenderHistoryPagination();
  } catch (error) { if (token === wprHistoryRequestToken) list.innerHTML = '<div class="wpr-empty">⚠️ ' + esc(error.message) + '</div>'; }
}
/**
 * Resolve the DOM id used by one report detail surface.
 * @param {number} id - Report identifier.
 * @param {string} [targetId] - Internal detail container id.
 * @returns {string} Detail container id.
 */
function wprDetailTargetId(id, targetId) {
  return targetId || ('wpr-detail-' + id);
}

/**
 * Reload history and reopen a detail element after a change.
 * @param {number} id - Report identifier.
 * @param {number} page - History page to reload.
 * @param {string} [targetId] - Internal detail container id to refresh.
 * @returns {Promise<void>} Completion promise.
 */
async function wprReloadAndReopenDetail(id, page, targetId) {
  await wprLoadHistory(page);
  var resolvedTargetId = wprDetailTargetId(id, targetId);
  var selectedTarget = targetId && resolvedTargetId !== 'wpr-detail-' + id;
  var detail = document.getElementById(resolvedTargetId);
  if (selectedTarget) {
    if (detail) await wprOpenHistoryDetail(id, resolvedTargetId);
    return;
  }
  if (!detail) return;
  var item = detail.closest('details');
  if (item) {
    wprSuppressHistoryToggle[id] = true;
    item.open = true;
  }
  await wprOpenHistoryDetail(id, resolvedTargetId);
}
/**
 * Format the immutable creator identity shown in history.
 * @param {Object} report - Function input.
 * @returns {void} Function result.
 */
function wprCreatedByText(report) {
  return report.created_by_display_name || report.created_by_username || '未知帳號';
}
/**
 * Build one expandable history card summary.
 * @param {Object} report - Function input.
 * @returns {void} Function result.
 */
function wprHistoryCard(report) { return '<details class="wpr-history-item" ontoggle="if(this.open && !wprSuppressHistoryToggle[' + report.id + ']) wprOpenHistoryDetail(' + report.id + '); wprSuppressHistoryToggle[' + report.id + ']=false"><summary><span class="wpr-history-date">' + esc(report.report_date) + '</span><span><b>' + esc(report.service_name || '未指定服務') + ' · ' + esc(report.client_name) + '</b><small>' + wprTimeText(report) + ' · 回報人：' + esc(report.uploader_name) + ' · 建立帳號：' + esc(wprCreatedByText(report)) + '</small></span><span class="wpr-history-photo-count">📷 ' + report.photo_count + '</span></summary><div class="wpr-history-detail" id="wpr-detail-' + report.id + '">載入詳情中…</div></details>'; }
/**
 * Build the scoped thumbnail gallery for a report.
 * @param {Object} report - Work progress report payload.
 * @param {number} id - Report identifier.
 * @param {string} [targetId] - Internal detail container id for action refresh.
 * @returns {string} Gallery markup.
 */
function wprPhotoGalleryHtml(report, id, targetId) {
  var actionTargetId = wprDetailTargetId(id, targetId);
  return (report.photos || []).map(function(photo, index) {
    var deleteButton = report.can_edit && wprPhotoManageReports[id]
      ? '<button type="button" class="wpr-photo-delete" onclick="event.stopPropagation();wprDeletePhoto(' + id + ',\'' + esc(jsStr(photo.asset_id)) + '\',\'' + esc(jsStr(actionTargetId)) + '\')" aria-label="刪除第 ' + (index + 1) + ' 張照片">✕</button>'
      : '';
    return '<div class="wpr-photo-manage-tile"><button type="button" onclick="wprOpenGallery(' + id + ',' + index + ')"><img src="' + esc(photo.thumbnail_url) + '" alt="施工照片 ' + (index + 1) + '" loading="lazy" decoding="async"></button>' + deleteButton + '</div>';
  }).join('');
}
/**
 * Load and render the full detail body for one report.
 * @param {number} id - Report identifier.
 * @param {string} [targetId] - Optional detail container id for non-history callers.
 * @returns {Promise<void>} Completion promise.
 */
async function wprOpenHistoryDetail(id, targetId) {
  var detailTargetId = wprDetailTargetId(id, targetId);
  var detail = document.getElementById(detailTargetId); if (!detail) return;
  var tokenKey = id + ':' + detailTargetId;
  var token = (wprDetailRequestTokens[tokenKey] || 0) + 1; wprDetailRequestTokens[tokenKey] = token;
  if (wprLastDetailReport && wprLastDetailReport.id === id) wprLastDetailReport = null;
  try {
    var report = await wprFetch('/api/work-progress/' + id);
    if (token !== wprDetailRequestTokens[tokenKey]) return;
    wprLastDetailReport = { id: id, report: report };
    var actionTargetId = esc(jsStr(detailTargetId));
    detail.innerHTML = '<div class="wpr-detail-grid"><span>工作日期<b>' + esc(report.report_date) + '</b></span><span>服務項目<b>' + esc(report.service_name || '未指定服務') + '</b></span><span>客戶 / 案場<b>' + esc(report.client_name) + '</b></span><span>時間<b>' + wprTimeText(report) + '</b></span><span>地址<b>' + esc(report.address || '—') + '</b></span><span>回報人<b>' + esc(report.uploader_name) + '</b></span><span>建立帳號<b>' + esc(wprCreatedByText(report)) + '</b></span></div>' + wprOptionalNoteHtml('行事曆備註', report.appointment_note) + wprOptionalNoteHtml('工作進度', report.note) + '<div class="wpr-detail-photo-section"><h4 class="wpr-detail-photo-title">施工照片</h4><div class="wpr-gallery-grid">' + wprPhotoGalleryHtml(report, id, detailTargetId) + '</div></div><div class="wpr-detail-actions">' + (report.can_edit ? '<button type="button" class="wpr-detail-action-edit" onclick="wprEditReport(' + id + ',\'' + actionTargetId + '\')">✏️ 編輯回報</button><button type="button" class="wpr-detail-action-manage" onclick="wprTogglePhotoManage(' + id + ',\'' + actionTargetId + '\')">' + (wprPhotoManageReports[id] ? '結束照片管理' : '📷 管理照片') + '</button><span class="wpr-photo-limit">目前 ' + report.photo_count + ' / 20 張照片' + (report.photo_count >= 20 ? ' · 已達照片上限' : ' · 最多還可新增 ' + (20 - report.photo_count) + ' 張') + '</span><button type="button" class="wpr-detail-action-add" onclick="wprAddExistingPhotos(' + id + ',\'' + actionTargetId + '\')"' + (report.photo_count >= 20 ? ' disabled' : '') + '>📷 新增照片</button>' : '') + (report.can_delete ? '<button type="button" class="wpr-detail-action-delete wpr-danger" onclick="wprDeleteReport(' + id + ')">🗑 刪除</button>' : '') + '</div>';
  } catch (error) { if (token === wprDetailRequestTokens[tokenKey]) detail.textContent = error.message; }
}
/**
 * Toggle destructive photo controls for one report.
 * @param {number} id - Report identifier.
 * @param {string} [targetId] - Internal detail container id to refresh.
 * @returns {Promise<void>} Completion promise.
 */
function wprTogglePhotoManage(id, targetId) {
  wprPhotoManageReports[id] = !wprPhotoManageReports[id];
  wprOpenHistoryDetail(id, targetId);
}
/**
 * Persist report-owned note and display-name changes.
 * @param {number} id - Report identifier.
 * @param {string} [targetId] - Internal detail container id to refresh after save.
 * @returns {Promise<void>} Completion promise.
 */
async function wprEditReport(id, targetId) {
  try {
    var report = await wprFetch('/api/work-progress/' + id);
    var overlay = document.createElement('div');
    overlay.className = 'wpr-edit-overlay';
    overlay.innerHTML = `
      <div class="wpr-edit-dialog" role="dialog" aria-modal="true" aria-labelledby="wpr-edit-title">
        <div class="wpr-edit-header"><h3 id="wpr-edit-title">✏️ 編輯工作進度回報</h3><button type="button" class="wpr-edit-close" data-wpr-edit-close aria-label="關閉">✕</button></div>
        <div class="wpr-edit-body">
          <section class="wpr-edit-readonly-section" aria-labelledby="wpr-edit-calendar-title">
            <h4 id="wpr-edit-calendar-title">行事曆資料</h4>
            <div class="wpr-edit-readonly-grid">
              <div class="wpr-edit-readonly-row"><span>工作日期</span><strong>${esc(report.report_date || '—')}</strong></div>
              <div class="wpr-edit-readonly-row"><span>時間</span><strong>${esc(wprTimeText(report))}</strong></div>
              <div class="wpr-edit-readonly-row"><span>客戶 / 案場</span><strong>${esc(report.client_name || '—')}</strong></div>
              <div class="wpr-edit-readonly-row"><span>地址</span><strong>${esc(report.address || '—')}</strong></div>
              <div class="wpr-edit-readonly-row"><span>指定服務</span><strong>${esc(report.service_name || '未指定服務')}</strong></div>
              ${report.appointment_note ? '<div class="wpr-edit-readonly-row"><span>行事曆備註</span><strong>' + esc(report.appointment_note) + '</strong></div>' : ''}
            </div>
            <p class="wpr-edit-source-hint">以上內容來源自行事曆，如需修改請至行事曆調整；更新後會自動同步至工作進度回報。</p>
          </section>
          <section class="wpr-edit-form-section" aria-labelledby="wpr-edit-progress-title">
            <h4 id="wpr-edit-progress-title">工作進度資料</h4>
            <label for="wpr-edit-uploader">回報人顯示名稱</label>
            <input id="wpr-edit-uploader" type="text" maxlength="50" value="${esc(report.uploader_name || '')}">
            <div class="wpr-edit-creator">建立帳號：${esc(wprCreatedByText(report))}</div>
            <div class="wpr-edit-hint">修改回報人顯示名稱不會變更原始建立帳號與 ownership（權限）。</div>
            <label for="wpr-edit-note">工作進度</label>
            <textarea id="wpr-edit-note" maxlength="1000" rows="6">${esc(report.note || '')}</textarea>
          </section>
        </div>
        <div class="wpr-edit-footer"><button type="button" class="wpr-edit-secondary" data-wpr-edit-close>取消</button><button type="button" class="wpr-edit-primary" data-wpr-edit-save>儲存</button></div>
      </div>`;
    document.body.appendChild(overlay);
    var close = function() { overlay.remove(); };
    overlay.querySelectorAll('[data-wpr-edit-close]').forEach(function(button) { button.addEventListener('click', close); });
    overlay.addEventListener('click', function(event) { if (event.target === overlay) close(); });
    overlay.querySelector('[data-wpr-edit-save]').addEventListener('click', async function() {
      var uploader = overlay.querySelector('#wpr-edit-uploader').value.trim();
      var note = overlay.querySelector('#wpr-edit-note').value.trim();
      if (!uploader) { toast('請填寫回報人'); return; }
      if (uploader.length > 50) { toast('回報人最多 50 字'); return; }
      if (note.length > 1000) { toast('工作進度最多 1000 字'); return; }
      var save = overlay.querySelector('[data-wpr-edit-save]'); save.disabled = true;
      try {
        await wprFetch('/api/work-progress/' + id, {method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uploader_name:uploader, note:note})});
        close();
        await wprReloadAndReopenDetail(id, wprHistoryPage, targetId);
        toast('工作進度已更新', 'success');
      } catch (error) { toast(error.message, 'error'); save.disabled = false; }
    });
  } catch (error) { toast(error.message, 'error'); }
}
/**
 * Confirm and delete one scoped report photo.
 * @param {number} reportId - Report identifier.
 * @param {string} assetId - Asset identifier.
 * @param {string} [targetId] - Internal detail container id to refresh.
 * @returns {Promise<void>} Completion promise.
 */
async function wprDeletePhoto(reportId, assetId, targetId) {
  if (!window.confirm('確定刪除此照片？\n此動作無法復原。')) return;
  try {
    await wprFetch('/api/work-progress/' + reportId + '/photos/' + encodeURIComponent(assetId), {method:'DELETE'});
    toast('照片已刪除', 'success');
    await wprReloadAndReopenDetail(reportId, wprHistoryPage, targetId);
  } catch (error) { toast(error.message, 'error'); }
}
/**
 * Open a full-size gallery for one pending upload without creating another object URL.
 * @param {number} index - Pending photo index.
 * @returns {void} Function result.
 */
function wprOpenPendingGallery(index) {
  if (!wprSelectedFiles[index]) return;
  wprPendingGallery.index = index;
  var old = document.getElementById('wpr-pending-gallery-overlay');
  if (old) old.remove();
  var overlay = document.createElement('div');
  overlay.className = 'wpr-pending-gallery-overlay';
  overlay.id = 'wpr-pending-gallery-overlay';
  overlay.innerHTML = '<div class="wpr-pending-gallery-dialog" role="dialog" aria-modal="true" aria-labelledby="wpr-pending-gallery-title"><button type="button" class="wpr-pending-gallery-close" onclick="wprClosePendingGallery()" aria-label="關閉待上傳照片預覽">✕</button><div id="wpr-pending-gallery-title" class="wpr-pending-gallery-count"></div><img id="wpr-pending-gallery-image" alt="待上傳照片預覽"><div id="wpr-pending-gallery-name" class="wpr-pending-gallery-name"></div><div class="wpr-pending-gallery-nav"><button type="button" onclick="wprPendingGalleryMove(-1)">← 上一張</button><button type="button" onclick="wprPendingGalleryMove(1)">下一張 →</button></div></div>';
  document.body.appendChild(overlay);
  wprRenderPendingGallery();
}

/**
 * Render the current pending photo using its existing preview URL.
 * @returns {void} Function result.
 */
function wprRenderPendingGallery() {
  var item = wprSelectedFiles[wprPendingGallery.index];
  if (!item) { wprClosePendingGallery(); return; }
  var count = document.getElementById('wpr-pending-gallery-title');
  var image = document.getElementById('wpr-pending-gallery-image');
  var name = document.getElementById('wpr-pending-gallery-name');
  if (count) count.textContent = (wprPendingGallery.index + 1) + ' / ' + wprSelectedFiles.length;
  if (image) image.src = item.previewUrl;
  if (name) name.textContent = item.file.name;
}

/**
 * Move through pending photos with wraparound navigation.
 * @param {number} delta - Relative gallery movement.
 * @returns {void} Function result.
 */
function wprPendingGalleryMove(delta) {
  if (!wprSelectedFiles.length) return;
  wprPendingGallery.index = (wprPendingGallery.index + delta + wprSelectedFiles.length) % wprSelectedFiles.length;
  wprRenderPendingGallery();
}

/**
 * Close the pending gallery without revoking its still-live object URL.
 * @returns {void} Function result.
 */
function wprClosePendingGallery() {
  var overlay = document.getElementById('wpr-pending-gallery-overlay');
  if (overlay) overlay.remove();
  wprPendingGallery.index = -1;
}

/**
 * Open the discard confirmation before switching away from Work Progress.
 * @param {string} nextTab - Requested destination tab.
 * @returns {void} Function result.
 */
function wprRequestLeave(nextTab) {
  wprOpenUnsavedConfirmation({tab: nextTab, action: null});
}

/**
 * Open the discard confirmation before replacing the current create draft.
 * @param {Function} action - Action to run after the draft is discarded.
 * @returns {void} Function result.
 */
function wprRequestDraftReset(action, restoreDate) {
  wprOpenUnsavedConfirmation({tab: null, action: action, restoreDate: restoreDate});
}

/**
 * Render the shared unsaved-draft confirmation for navigation or replacement.
 * @param {{tab: (string|null), action: (Function|null)}} request - Pending action.
 * @returns {void} Function result.
 */
function wprOpenUnsavedConfirmation(request) {
  if (wprPendingSubmit) return;
  wprLeaveRequest = request;
  var old = document.getElementById('wpr-unsaved-overlay');
  if (old) old.remove();
  var overlay = document.createElement('div');
  overlay.className = 'wpr-unsaved-overlay';
  overlay.id = 'wpr-unsaved-overlay';
  overlay.innerHTML = '<div class="wpr-unsaved-dialog" role="dialog" aria-modal="true" aria-labelledby="wpr-unsaved-title"><h3 id="wpr-unsaved-title">尚未儲存工作進度</h3><p>目前輸入內容與待上傳照片尚未儲存。<br>離開後這些內容將會遺失。</p><div class="wpr-unsaved-actions"><button type="button" class="wpr-unsaved-secondary" onclick="wprCloseLeaveConfirmation()">繼續編輯</button><button type="button" class="wpr-unsaved-danger" onclick="wprDiscardAndLeave()">放棄並離開</button></div></div>';
  document.body.appendChild(overlay);
}

/**
 * Close the unsaved-draft confirmation and keep the form intact.
 * @returns {void} Function result.
 */
function wprCloseLeaveConfirmation() {
  var request = wprLeaveRequest;
  var overlay = document.getElementById('wpr-unsaved-overlay');
  if (overlay) overlay.remove();
  if (request && request.restoreDate) {
    var dateInput = document.getElementById('wpr-date');
    if (dateInput) dateInput.value = request.restoreDate;
  }
  wprLeaveRequest = null;
}

/**
 * Reset the create draft without leaving the Work Progress tab.
 * @returns {void} Function result.
 */
function wprResetCreateDraft() {
  wprClosePendingGallery();
  wprClearPendingFiles();
  var note = document.getElementById('wpr-note');
  var uploader = document.getElementById('wpr-uploader');
  if (note) { note.value = ''; wprUpdateNoteCount(); }
  if (uploader) uploader.value = wprInitialUploaderName;
  wprCurrentReport = null;
  var area = document.getElementById('wpr-selected-area');
  if (area) { area.hidden = true; area.innerHTML = ''; }
  var save = document.getElementById('wpr-save');
  if (save) save.disabled = true;
}

/**
 * Discard the draft, release URLs, and continue the requested action.
 * @returns {void} Function result.
 */
function wprDiscardAndLeave() {
  var request = wprLeaveRequest;
  wprCloseLeaveConfirmation();
  wprCloseSubmitConfirmation();
  wprResetCreateDraft();
  if (request && request.action) request.action();
  else if (request && request.tab && typeof switchTab === 'function') switchTab(request.tab);
}

/**
 * Handle date changes without silently moving an unsaved draft.
 * @returns {void} Function result.
 */
function wprHandleDateChange() {
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

/**
 * Open a multi-file picker and append photos to an existing report.
 * @param {number} id - Report identifier.
 * @param {string} [targetId] - Internal detail container id to refresh after upload.
 * @returns {void} Function result.
 */
function wprAddExistingPhotos(id, targetId) {
  var input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/jpeg,image/png,image/webp';
  input.multiple = true;
  input.onchange = async function() {
    try {
      var files = Array.from(input.files || []);
      var report = await wprFetch('/api/work-progress/' + id);
      var validation = wprValidatePhotoBatch(files, Number(report.photo_count) || 0);
      if (!validation.ok) { toast(validation.error, 'error'); return; }
      var form = new FormData();
      files.forEach(function(file) { form.append('files', file, file.name); });
      await wprFetch('/api/work-progress/' + id + '/photos', {method:'POST', body:form});
      toast('照片已新增', 'success');
      await wprReloadAndReopenDetail(id, 1, targetId);
    } catch (error) { toast(error.message, 'error'); }
  };
  input.click();
}
/**
 * Confirm and delete a report with its managed photos.
 * @param {number} id - Function input.
 * @returns {void} Function result.
 */
async function wprDeleteReport(id) { if (!window.confirm('確定刪除此工作進度？\n將一併刪除備註與所有施工照片，此動作無法復原。')) return; try { await wprFetch('/api/work-progress/' + id, {method:'DELETE'}); toast('工作進度已刪除', 'success'); wprLoadHistory(1); wprLoadDay(); wprLoadKpi(); } catch (error) { toast(error.message, 'error'); } }
/**
 * Create isolated preload state for one Gallery lifecycle.
 * @returns {{completed: Object, inflight: Object}} Lifecycle-owned preload state.
 */
function wprCreateGalleryPreloadState() {
  return { completed: Object.create(null), inflight: Object.create(null) };
}

/**
 * Start one background request for a preview URL and release the Image after settlement.
 * @param {Object} photo - Gallery photo metadata.
 * @returns {void} Nothing; failures fall back to normal image navigation.
 */
function wprPreloadGalleryPhoto(photo) {
  var url = photo && photo.preview_url;
  var state = wprGalleryPreloadState;
  if (!url || state.completed[url] || state.inflight[url] || typeof Image === 'undefined') return;
  var image;
  var settled = false;
  var settle;
  try {
    image = new Image();
    state.inflight[url] = image;
    image.decoding = 'async';
    settle = function(success) {
      if (settled) return;
      settled = true;
      if (success) state.completed[url] = true;
      delete state.inflight[url];
      image.onload = null;
      image.onerror = null;
    };
    image.onload = function() { settle(true); };
    image.onerror = function() { settle(false); };
    image.src = url;
    if (typeof image.decode === 'function') {
      Promise.resolve(image.decode()).then(function() { settle(true); }, function() { settle(false); });
    }
  } catch (error) {
    if (settle) settle(false);
    else delete state.inflight[url];
  }
}

/**
 * Return preload offsets around the current photo for the initial render or move direction.
 * @param {number} [direction] - Positive for next, negative for previous, omitted initially.
 * @returns {number[]} Relative photo offsets to preload.
 */
function wprGalleryPreloadOffsets(direction) {
  if (direction > 0) return [-1, 1, 2];
  if (direction < 0) return [1, -1, -2];
  return [-1, 1];
}

/**
 * Preload bounded adjacent photos, optionally looking one extra step in the move direction.
 * @param {Object} report - Work Progress report containing photos.
 * @param {number} index - Current photo index.
 * @param {number} [direction] - Relative navigation direction.
 * @returns {void} Nothing.
 */
function wprPreloadGalleryAround(report, index, direction) {
  var photos = report && report.photos;
  if (!photos || photos.length < 2) return;
  var count = photos.length;
  wprGalleryPreloadOffsets(direction).forEach(function(offset) {
    wprPreloadGalleryPhoto(photos[(index + offset + count) % count]);
  });
}

/**
 * Load a report and open its preview gallery.
 * @param {number} id - Report identifier.
 * @param {number} index - Initial photo index.
 * @returns {void} Nothing; the gallery opens after the report is available.
 */
function wprOpenGallery(id, index) {
  var token = ++wprGalleryRequestToken;
  wprCloseGallery(false);
  var reportPromise = wprLastDetailReport && wprLastDetailReport.id === id
    ? Promise.resolve(wprLastDetailReport.report)
    : wprFetch('/api/work-progress/' + id);
  reportPromise.then(function(report) {
    if (token !== wprGalleryRequestToken) return;
    if (typeof currentTab !== 'undefined' && currentTab !== 'work-progress') return;
    wprGallery.report = report;
    wprGallery.index = index;
    var overlay = document.createElement('div');
    overlay.className = 'wpr-gallery-overlay';
    overlay.id = 'wpr-gallery-overlay';
    overlay.innerHTML = '<div class="wpr-gallery-dialog"><button type="button" class="wpr-gallery-close" onclick="wprCloseGallery()">✕</button><div class="wpr-gallery-count" id="wpr-gallery-count"></div><img id="wpr-gallery-image" alt="施工照片"><div class="wpr-gallery-caption" id="wpr-gallery-caption"></div><div class="wpr-gallery-nav"><button type="button" onclick="wprGalleryMove(-1)">← 上一張</button><a id="wpr-gallery-download" class="wpr-gallery-download">原圖下載</a><button type="button" onclick="wprGalleryMove(1)">下一張 →</button></div></div>';
    document.body.appendChild(overlay);
    wprRenderGallery();
  }).catch(function(error) { if (token !== wprGalleryRequestToken) return; toast(error.message, 'error'); });
}
/**
 * Render the current gallery photo and navigation controls.
 * @param {number} [direction] - Relative navigation direction for lookahead preload.
 * @returns {void} Nothing.
 */
function wprRenderGallery(direction) {
  var report = wprGallery.report, photo = report && report.photos[wprGallery.index];
  if (!photo) return;
  document.getElementById('wpr-gallery-count').textContent = (wprGallery.index + 1) + ' / ' + report.photos.length;
  var image = document.getElementById('wpr-gallery-image');
  image.decoding = 'async';
  image.src = photo.preview_url;
  document.getElementById('wpr-gallery-caption').textContent = report.client_name + ' · ' + report.service_name + ' · ' + report.report_date;
  document.getElementById('wpr-gallery-download').href = photo.download_url;
  document.getElementById('wpr-gallery-download').download = photo.original_name;
  wprPreloadGalleryAround(report, wprGallery.index, direction);
}
/**
 * Move the gallery selection with wraparound navigation.
 * @param {number} delta - Relative gallery movement.
 * @returns {void} Nothing.
 */
function wprGalleryMove(delta) {
  if (!wprGallery.report || !wprGallery.report.photos.length) return;
  wprGallery.index = (wprGallery.index + delta + wprGallery.report.photos.length) % wprGallery.report.photos.length;
  wprRenderGallery(delta);
}
/**
 * Close the gallery overlay and release its state.
 * @param {boolean} [invalidateRequest=true] - Whether to invalidate pending gallery fetches.
 * @returns {void} Nothing.
 */
function wprCloseGallery(invalidateRequest) {
  if (invalidateRequest !== false) ++wprGalleryRequestToken;
  var overlay = document.getElementById('wpr-gallery-overlay');
  if (overlay) overlay.remove();
  wprGallery.report = null;
  wprGalleryPreloadState = wprCreateGalleryPreloadState();
}
document.addEventListener('keydown', function(event) { if (wprPendingGallery.index >= 0) { if (event.key === 'Escape') wprClosePendingGallery(); if (event.key === 'ArrowLeft') wprPendingGalleryMove(-1); if (event.key === 'ArrowRight') wprPendingGalleryMove(1); return; } if (!wprGallery.report) return; if (event.key === 'Escape') wprCloseGallery(); if (event.key === 'ArrowLeft') wprGalleryMove(-1); if (event.key === 'ArrowRight') wprGalleryMove(1); });
