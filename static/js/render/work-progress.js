// 每日工作進度回報（獨立頁面；資料/權限/照片不與簽名報表共用）
// 依賴：globals.js、utils.js（esc/toast/hasPerm）

var wprGallery = { report: null, index: 0 };
// Gallery dynamically creates id="wpr-gallery-overlay" before lookup.

function wprIsoDate(date) {
  var d = date || new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function wprMonth(dateValue) { return (dateValue || wprIsoDate()).slice(0, 7); }
function wprTimeText(job) {
  return job.start_time && job.end_time ? esc(job.start_time) + '–' + esc(job.end_time) : '未指定時間';
}
function wprApiError(response) {
  return response.json().catch(function() { return {}; }).then(function(body) {
    throw new Error(body.detail || ('API 錯誤：' + response.status));
  });
}
async function wprFetch(url, options) {
  var response = await fetch(url, options);
  if (!response.ok) return wprApiError(response);
  return response.json();
}
function wprCurrentUserName() {
  return esc((typeof currentUser !== 'undefined' && currentUser && (currentUser.display_name || currentUser.username)) || '目前登入者');
}

async function renderWorkProgress() {
  var el = document.getElementById('content');
  if (!el) return;
  wprClearPendingFiles();
  wprDayRequestToken++; wprHistoryRequestToken++; wprKpiRequestToken++; wprDetailRequestTokens = {}; wprSelectRequestToken++;
  wprAppointments = [];
  wprReportsByAppointment = {};
  wprCurrentReport = null;
  el.innerHTML = '<div class="wpr-wrap"><section class="wpr-page-header"><div><div class="wpr-eyebrow">📸 現場紀錄</div><h1>每日工作進度回報</h1><p>記錄每日工作進度、備註及施工現場照片。</p></div><button class="wpr-history-jump" type="button" onclick="document.getElementById(\'wpr-history\').scrollIntoView({behavior:\'smooth\'})">查看歷史 ↓</button></section><div class="wpr-kpi-grid" id="wpr-kpi"></div><div class="wpr-layout"><section class="wpr-card wpr-create-card" id="wpr-create"></section><section class="wpr-card wpr-history-card" id="wpr-history"><div class="wpr-section-heading"><div><h2>歷史工作進度</h2><p>可依日期或關鍵字查找已回報工作。</p></div></div><div class="wpr-history-filters"><input type="date" id="wpr-from" aria-label="起始日期"><input type="date" id="wpr-to" aria-label="迄止日期"><input type="search" id="wpr-query" placeholder="搜尋客戶、服務、地址、備註或回報人" aria-label="搜尋工作進度" onkeydown="if(event.key===\'Enter\') wprLoadHistory()"><button type="button" onclick="wprLoadHistory()">搜尋</button></div><div class="wpr-quick-filters"><button type="button" onclick="wprQuickRange(\'today\')">今天</button><button type="button" onclick="wprQuickRange(\'week\')">本週</button><button type="button" onclick="wprQuickRange(\'month\')">本月</button><button type="button" onclick="wprQuickRange(\'all\')">全部</button></div><div id="wpr-history-list"></div></section></div></div>';
  wprRenderCreate();
  await Promise.all([wprLoadDay(), wprLoadHistory(), wprLoadKpi()]);
}

function wprRenderCreate() {
  var create = document.getElementById('wpr-create');
  if (!create) return;
  create.innerHTML = '<div class="wpr-section-heading"><div><h2>建立工作進度</h2><p>選擇行事曆工作後填寫現場回報。</p></div></div><div class="wpr-field"><label>回報人</label><div class="wpr-readonly">' + wprCurrentUserName() + '</div></div><div class="wpr-field"><label for="wpr-date">工作日期 <b>*</b></label><input type="date" id="wpr-date" value="' + esc(wprIsoDate()) + '" onchange="wprLoadDay()"></div><div class="wpr-field"><label>選擇工作內容 <b>*</b></label><div id="wpr-job-list" class="wpr-job-list"></div></div><div id="wpr-selected-area" hidden></div><div class="wpr-field"><label for="wpr-note">工作進度備註</label><textarea id="wpr-note" maxlength="1000" rows="5" placeholder="記錄今日完成內容、未完成項目或明日安排" oninput="wprUpdateNoteCount()"></textarea><div class="wpr-counter" id="wpr-note-count">0 / 1000</div></div><div class="wpr-field"><label>工作照片 <b>*</b></label><div class="wpr-photo-actions"><button type="button" class="wpr-photo-button" onclick="document.getElementById(\'wpr-album\').click()">🖼 從相簿選擇</button><button type="button" class="wpr-photo-button" onclick="document.getElementById(\'wpr-camera\').click()">📷 拍照新增</button><input id="wpr-album" type="file" accept="image/*" multiple hidden onchange="wprAddPendingFiles(this.files);this.value=\'\'"><input id="wpr-camera" type="file" accept="image/*" capture="environment" hidden onchange="wprAddPendingFiles(this.files);this.value=\'\'"></div><div id="wpr-pending-photos" class="wpr-photo-grid"></div></div><button id="wpr-save" type="button" class="wpr-save-button" disabled onclick="wprSubmit()">儲存工作進度回報</button>';
  wprUpdateNoteCount();
  wprRenderPendingPhotos();
}

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
async function wprSelectJob(id) {
  var token = ++wprSelectRequestToken;
  var job = wprAppointments.find(function(item) { return item.id === id; });
  if (!job) return;
  var existing = wprReportsByAppointment[id];
  if (existing) {
    try {
      wprCurrentReport = await wprFetch('/api/work-progress/' + existing.id);
      if (token !== wprSelectRequestToken) return;
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
    area.innerHTML = '<div class="wpr-selected-summary"><strong>✓ 此工作已有工作進度回報</strong><span>' + esc(existing.note || '尚未填寫備註') + '</span><button type="button" onclick="wprOpenHistoryDetail(' + existing.id + ')">查看工作進度</button></div><div class="wpr-calendar-note"><label>行事曆備註（只讀）</label><div>' + esc(job.note || '無備註') + '</div></div>';
    save.disabled = true;
  } else {
    area.hidden = false;
    area.innerHTML = '<div class="wpr-selected-summary"><strong>✓ 已選工作</strong><b>' + esc(job.service_name || '未指定服務') + ' · ' + esc(job.client_name || '') + '</b><span>' + esc(document.getElementById('wpr-date').value) + ' · ' + wprTimeText(job) + '</span>' + (job.address ? '<span>📍 ' + esc(job.address) + '</span>' : '') + '</div><div class="wpr-calendar-note"><label>行事曆備註（只讀）</label><div>' + esc(job.note || '無備註') + '</div></div>';
    save.disabled = wprSelectedFiles.length === 0;
  }
}
function wprUpdateNoteCount() { var note = document.getElementById('wpr-note'); var counter = document.getElementById('wpr-note-count'); if (note && counter) counter.textContent = note.value.length + ' / 1000'; }
function wprClearPendingFiles() {
  wprSelectedFiles.forEach(function(item) {
    if (item && item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  });
  wprSelectedFiles = [];
}
function wprAddPendingFiles(fileList) {
  Array.from(fileList || []).forEach(function(file) {
    if (!file.type.startsWith('image/')) { toast('只能選擇圖片', 'error'); return; }
    if (file.size > 20 * 1024 * 1024) { toast('單張圖片上限 20MB', 'error'); return; }
    if (wprSelectedFiles.length >= 20) return;
    wprSelectedFiles.push({file: file, previewUrl: URL.createObjectURL(file)});
  });
  wprRenderPendingPhotos();
  if (wprCurrentReport && wprCurrentReport.appointment_id && !wprReportsByAppointment[wprCurrentReport.appointment_id]) document.getElementById('wpr-save').disabled = !wprSelectedFiles.length;
}
function wprRenderPendingPhotos() {
  var grid = document.getElementById('wpr-pending-photos');
  if (!grid) return;
  grid.innerHTML = wprSelectedFiles.map(function(item, index) { return '<div class="wpr-photo-tile"><img src="' + esc(item.previewUrl) + '" alt="待上傳照片 ' + (index + 1) + '"><button type="button" onclick="wprRemovePending(' + index + ')" aria-label="移除第 ' + (index + 1) + ' 張照片">✕</button></div>'; }).join('') + '<button type="button" class="wpr-add-tile" onclick="document.getElementById(\'wpr-album\').click()">＋新增</button>';
}
function wprRemovePending(index) {
  var item = wprSelectedFiles[index];
  if (item && item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  wprSelectedFiles.splice(index, 1);
  wprRenderPendingPhotos();
  var save = document.getElementById('wpr-save');
  if (save && (!wprCurrentReport || !wprCurrentReport.appointment_id || !wprReportsByAppointment[wprCurrentReport.appointment_id])) save.disabled = !wprSelectedFiles.length;
}
async function wprSubmit() {
  if (!wprCurrentReport || !wprCurrentReport.appointment_id || !wprSelectedFiles.length) return;
  var button = document.getElementById('wpr-save'); button.disabled = true;
  var form = new FormData(); form.append('appointment_id', wprCurrentReport.appointment_id); form.append('note', (document.getElementById('wpr-note').value || '').trim());
  wprSelectedFiles.forEach(function(item) { form.append('files', item.file, item.file.name); });
  try { await wprFetch('/api/work-progress', { method: 'POST', body: form }); toast('工作進度已儲存', 'success'); wprClearPendingFiles(); wprCurrentReport = null; wprRenderCreate(); await Promise.all([wprLoadDay(), wprLoadHistory(1), wprLoadKpi()]); } catch (error) { toast(error.message, 'error'); button.disabled = false; }
}

async function wprLoadKpi() {
  var el = document.getElementById('wpr-kpi'); if (!el) return;
  var token = ++wprKpiRequestToken;
  try { var data = await wprFetch('/api/work-progress/kpi?month=' + encodeURIComponent(wprMonth())); if (token !== wprKpiRequestToken) return; el.innerHTML = [{label:'已回報',value:data.reported},{label:'待回報',value:data.missing},{label:'回報率',value:data.rate === null ? '—' : data.rate + '%'}].map(function(item) { return '<div class="wpr-kpi"><span>' + item.label + '</span><strong>' + item.value + '</strong></div>'; }).join('') + '<div class="wpr-kpi-meta">本月目前 ' + data.total + ' 筆行事曆工作 · ' + data.photo_count + ' 張照片</div>'; } catch (error) { if (token === wprKpiRequestToken) el.innerHTML = ''; }
}
function wprQuickRange(type) {
  var today = new Date(), from = '', to = '';
  if (type === 'today') from = to = wprIsoDate(today);
  if (type === 'month') { from = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-01'; to = wprIsoDate(today); }
  if (type === 'week') { var day = today.getDay() || 7; var start = new Date(today); start.setDate(today.getDate() - day + 1); from = wprIsoDate(start); to = wprIsoDate(today); }
  document.getElementById('wpr-from').value = from; document.getElementById('wpr-to').value = to; wprLoadHistory(1);
}
function wprRenderHistoryPagination() {
  var lastPage = Math.max(1, Math.ceil(wprHistoryTotal / wprHistoryPageSize));
  if (lastPage <= 1) return '';
  return '<nav class="wpr-pagination" aria-label="工作進度歷史分頁"><button type="button" onclick="wprLoadHistory(wprHistoryPage - 1)"' + (wprHistoryPage <= 1 ? ' disabled' : '') + '>上一頁</button><span>第 ' + wprHistoryPage + ' / ' + lastPage + ' 頁 · 共 ' + wprHistoryTotal + ' 筆</span><button type="button" onclick="wprLoadHistory(wprHistoryPage + 1)"' + (wprHistoryPage >= lastPage ? ' disabled' : '') + '>下一頁</button></nav>';
}
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
    var lastPage = Math.max(1, Math.ceil(wprHistoryTotal / wprHistoryPageSize));
    if (page > lastPage) { wprLoadHistory(lastPage); return; }
    wprHistoryPage = Number(data.page) || page;
    if (!data.items.length) { list.innerHTML = '<div class="wpr-empty wpr-history-empty">📸 尚無工作進度<br><small>目前沒有符合條件的工作進度回報。</small></div>'; return; }
    list.innerHTML = data.items.map(wprHistoryCard).join('') + wprRenderHistoryPagination();
  } catch (error) { if (token === wprHistoryRequestToken) list.innerHTML = '<div class="wpr-empty">⚠️ ' + esc(error.message) + '</div>'; }
}
function wprHistoryCard(report) { return '<details class="wpr-history-item" ontoggle="if(this.open) wprOpenHistoryDetail(' + report.id + ')"><summary><span class="wpr-history-date">' + esc(report.report_date) + '</span><span><b>' + esc(report.service_name || '未指定服務') + ' · ' + esc(report.client_name) + '</b><small>' + wprTimeText(report) + ' · 回報人：' + esc(report.uploader_name) + '</small></span><span class="wpr-history-photo-count">📷 ' + report.photo_count + '</span></summary><div class="wpr-history-detail" id="wpr-detail-' + report.id + '">載入詳情中…</div></details>'; }
async function wprOpenHistoryDetail(id) {
  var detail = document.getElementById('wpr-detail-' + id); if (!detail) return;
  var token = (wprDetailRequestTokens[id] || 0) + 1; wprDetailRequestTokens[id] = token;
  try {
    var report = await wprFetch('/api/work-progress/' + id);
    if (token !== wprDetailRequestTokens[id]) return;
    detail.innerHTML = '<div class="wpr-detail-grid"><span>工作日期<b>' + esc(report.report_date) + '</b></span><span>服務項目<b>' + esc(report.service_name || '未指定服務') + '</b></span><span>客戶 / 案場<b>' + esc(report.client_name) + '</b></span><span>時間<b>' + wprTimeText(report) + '</b></span><span>地址<b>' + esc(report.address || '—') + '</b></span><span>回報人<b>' + esc(report.uploader_name) + '</b></span></div><div class="wpr-detail-note"><label>行事曆原備註</label><p>' + esc(report.appointment_note || '無備註') + '</p><label>工作進度備註</label><p>' + esc(report.note || '無備註') + '</p></div><div class="wpr-gallery-grid">' + report.photos.map(function(photo, index) { return '<button type="button" onclick="wprOpenGallery(' + id + ',' + index + ')"><img src="' + esc(photo.thumbnail_url) + '" alt="施工照片 ' + (index + 1) + '"></button>'; }).join('') + '</div><div class="wpr-detail-actions">' + (report.can_edit ? '<button type="button" onclick="wprEditNote(' + id + ')">✏️ 編輯備註</button><button type="button" onclick="wprAddExistingPhotos(' + id + ')">📷 新增照片</button>' : '') + (report.can_delete ? '<button type="button" class="wpr-danger" onclick="wprDeleteReport(' + id + ')">🗑 刪除</button>' : '') + '</div>';
  } catch (error) { if (token === wprDetailRequestTokens[id]) detail.textContent = error.message; }
}
async function wprEditNote(id) { var note = window.prompt('工作進度備註（最多 1000 字）'); if (note === null) return; try { await wprFetch('/api/work-progress/' + id, { method: 'PATCH', headers: {'Content-Type':'application/json'}, body: JSON.stringify({note: note}) }); toast('備註已更新', 'success'); wprLoadHistory(1); } catch (error) { toast(error.message, 'error'); } }
function wprAddExistingPhotos(id) { var input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*'; input.multiple = true; input.onchange = async function() { var form = new FormData(); Array.from(input.files).forEach(function(file) { form.append('files', file, file.name); }); try { await wprFetch('/api/work-progress/' + id + '/photos', {method:'POST', body:form}); toast('照片已新增', 'success'); wprOpenHistoryDetail(id); wprLoadHistory(1); } catch (error) { toast(error.message, 'error'); } }; input.click(); }
async function wprDeleteReport(id) { if (!window.confirm('確定刪除此工作進度？\n將一併刪除備註與所有施工照片，此動作無法復原。')) return; try { await wprFetch('/api/work-progress/' + id, {method:'DELETE'}); toast('工作進度已刪除', 'success'); wprLoadHistory(1); wprLoadDay(); wprLoadKpi(); } catch (error) { toast(error.message, 'error'); } }
function wprOpenGallery(id, index) { wprFetch('/api/work-progress/' + id).then(function(report) { wprGallery.report = report; wprGallery.index = index; var overlay = document.createElement('div'); overlay.className = 'wpr-gallery-overlay'; overlay.id = 'wpr-gallery-overlay'; overlay.innerHTML = '<div class="wpr-gallery-dialog"><button type="button" class="wpr-gallery-close" onclick="wprCloseGallery()">✕</button><div class="wpr-gallery-count" id="wpr-gallery-count"></div><img id="wpr-gallery-image" alt="工作照片"><div class="wpr-gallery-caption" id="wpr-gallery-caption"></div><div class="wpr-gallery-nav"><button type="button" onclick="wprGalleryMove(-1)">← 上一張</button><a id="wpr-gallery-download" class="wpr-gallery-download">原圖下載</a><button type="button" onclick="wprGalleryMove(1)">下一張 →</button></div></div>'; document.body.appendChild(overlay); wprRenderGallery(); }).catch(function(error) { toast(error.message, 'error'); }); }
function wprRenderGallery() { var report = wprGallery.report, photo = report.photos[wprGallery.index]; if (!photo) return; document.getElementById('wpr-gallery-count').textContent = (wprGallery.index + 1) + ' / ' + report.photos.length; document.getElementById('wpr-gallery-image').src = photo.preview_url; document.getElementById('wpr-gallery-caption').textContent = report.client_name + ' · ' + report.service_name + ' · ' + report.report_date; document.getElementById('wpr-gallery-download').href = photo.download_url; document.getElementById('wpr-gallery-download').download = photo.original_name; }
function wprGalleryMove(delta) { if (!wprGallery.report || !wprGallery.report.photos.length) return; wprGallery.index = (wprGallery.index + delta + wprGallery.report.photos.length) % wprGallery.report.photos.length; wprRenderGallery(); }
function wprCloseGallery() { var overlay = document.getElementById('wpr-gallery-overlay'); if (overlay) overlay.remove(); wprGallery.report = null; }
document.addEventListener('keydown', function(event) { if (!wprGallery.report) return; if (event.key === 'Escape') wprCloseGallery(); if (event.key === 'ArrowLeft') wprGalleryMove(-1); if (event.key === 'ArrowRight') wprGalleryMove(1); });
