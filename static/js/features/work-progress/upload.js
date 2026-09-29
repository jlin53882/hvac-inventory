// 庫存管理系統 - 工作進度：照片選取、驗證與上傳

import { apiErrorMessage, esc, toast } from '../../core/utils.js';
import { wprClearPendingFiles } from './draft.js';
import { wprTimeText } from './format.js';
import { wprClosePendingGallery } from './gallery.js';
import { wprLoadHistory, wprLoadKpi } from './history.js';
import { wprCanCreate, wprLoadDay, wprRenderCreate } from './page.js';
import { workProgressState } from './state.js';

export var wprPendingSubmit = null;
/**
 * Label for the upload phases shown on the submit button.
 * @param {string} phase - 'upload' while bytes are sent, 'processing' after the server has them.
 * @param {number} percent - Upload percentage (0-100), ignored for processing.
 * @returns {string} Button label.
 */
export function wprUploadProgressText(phase, percent) {
  if (phase === 'processing') return '伺服器處理中…';
  var value = Math.max(0, Math.min(100, Math.floor(Number(percent) || 0)));
  return '上傳中 ' + value + '%';
}
/**
 * POST multipart data with upload progress (fetch cannot report request-body progress).
 * Error messages match apiFetch (core/api-client.js); structured API validation details use the shared readable formatter.
 * @param {string} url - Endpoint.
 * @param {FormData} form - Multipart body.
 * @param {function(string, number): void} onProgress - Receives ('upload', percent) then ('processing', 100).
 * @returns {Promise<object>} Parsed JSON response.
 */
export function wprUploadWithProgress(url, form, onProgress) {
  return new Promise(function(resolve, reject) {
    var xhr = new XMLHttpRequest();
    var report = function(phase, percent) { if (onProgress) onProgress(phase, percent); };
    xhr.open('POST', url);
    xhr.upload.onprogress = function(event) {
      if (event.lengthComputable && event.total > 0) report('upload', event.loaded * 100 / event.total);
    };
    xhr.upload.onload = function() { report('processing', 100); };
    xhr.onload = function() {
      var body = {};
      try { body = JSON.parse(xhr.responseText || '{}'); } catch (error) { body = {}; }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(new Error(apiErrorMessage(body.detail) || ('API 錯誤：' + xhr.status)));
    };
    xhr.onerror = function() { reject(new Error('網路連線中斷，上傳失敗，請重試')); };
    xhr.onabort = function() { reject(new Error('上傳已中止')); };
    report('upload', 0);
    xhr.send(form);
  });
}
/**
 * Bind drag-and-drop handlers for pending photo selection.
 * @returns {void} Function result.
 */
export function wprBindDropZone() {
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
export function wprValidatePhotoBatch(fileList, currentCount) {
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
  var count = workProgressState.wprSelectedFiles.length;
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
export function wprAddPendingFiles(fileList) {
  var files = Array.from(fileList || []);
  var validation = wprValidatePhotoBatch(files, workProgressState.wprSelectedFiles.length);
  if (!validation.ok) { toast(validation.error, 'error'); return; }
  files.forEach(function(file) { workProgressState.wprSelectedFiles.push({file: file, previewUrl: URL.createObjectURL(file)}); });
  wprRenderPendingPhotos();
}

/**
 * Render pending photo thumbnails with separate preview and remove actions.
 * @returns {void} Function result.
 */
export function wprRenderPendingPhotos() {
  var grid = document.getElementById('wpr-pending-photos');
  if (!grid) return;
  var addDisabled = workProgressState.wprSelectedFiles.length >= WPR_MAX_FILES ? ' disabled' : '';
  grid.innerHTML = workProgressState.wprSelectedFiles.map(function(item, index) { return '<div class="wpr-photo-tile"><button type="button" class="wpr-pending-preview" onclick="WorkProgress.wprOpenPendingGallery(' + index + ')" aria-label="預覽第 ' + (index + 1) + ' 張待上傳照片"><img src="' + esc(item.previewUrl) + '" alt="待上傳照片 ' + (index + 1) + '"></button><button type="button" class="wpr-photo-remove" onclick="event.stopPropagation();WorkProgress.wprRemovePending(' + index + ')" aria-label="移除第 ' + (index + 1) + ' 張照片">✕</button></div>'; }).join('') + '<button type="button" id="wpr-add-pending-button" class="wpr-add-tile" onclick="document.getElementById(\'wpr-album\').click()"' + addDisabled + '>＋新增</button>';
  wprUpdatePendingPhotoControls();
}

/**
 * Remove one pending photo and release only its object URL.
 * @param {number} index - Pending photo index.
 * @returns {void} Function result.
 */
export function wprRemovePending(index) {
  var item = workProgressState.wprSelectedFiles[index];
  if (!item) return;
  wprClosePendingGallery();
  if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  workProgressState.wprSelectedFiles.splice(index, 1);
  wprRenderPendingPhotos();
  var save = document.getElementById('wpr-save');
  if (save && (!workProgressState.wprCurrentReport || !workProgressState.wprCurrentReport.appointment_id || !workProgressState.wprReportsByAppointment[workProgressState.wprCurrentReport.appointment_id])) save.disabled = false;
}

/**
 * Build an immutable snapshot for the save confirmation modal.
 * @returns {Object|null} Snapshot containing file references but not copied file bytes.
 */
function wprBuildSubmitSnapshot() {
  var uploader = document.getElementById('wpr-uploader');
  var note = document.getElementById('wpr-note');
  var appointment = workProgressState.wprCurrentReport && workProgressState.wprCurrentReport.appointment;
  if (!uploader || !note || !workProgressState.wprCurrentReport || !appointment) return null;
  return {appointmentId: workProgressState.wprCurrentReport.appointment_id, uploaderName: uploader.value.trim(), note: note.value.trim(), files: workProgressState.wprSelectedFiles.slice(), date: document.getElementById('wpr-date').value, time: wprTimeText(appointment), clientName: appointment.client_name || '—', serviceName: appointment.service_name || '未指定服務'};
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
  overlay.innerHTML = '<div class="wpr-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="wpr-confirm-title"><div class="wpr-confirm-header"><h3 id="wpr-confirm-title">確認儲存工作進度？</h3><button type="button" class="wpr-confirm-close" data-wpr-confirm-cancel aria-label="返回修改">✕</button></div><div class="wpr-confirm-body"><p>請確認以下工作進度內容無誤。</p><dl><dt>行事曆工作</dt><dd>' + esc(snapshot.date) + ' ' + snapshot.time + '<br>' + esc(snapshot.clientName) + ' · ' + esc(snapshot.serviceName) + '</dd><dt>回報人</dt><dd>' + esc(snapshot.uploaderName) + '</dd>' + (snapshot.note ? '<dt>工作進度</dt><dd>' + esc(snapshot.note) + '</dd>' : '') + '<dt>待上傳照片</dt><dd>' + snapshot.files.length + ' 張</dd></dl></div><div class="wpr-confirm-footer"><button type="button" class="btn btn--secondary btn--md" data-wpr-confirm-cancel>返回修改</button><button type="button" class="btn btn--primary btn--md" data-wpr-confirm-submit>確認儲存</button></div></div>';
  document.body.appendChild(overlay);
  overlay.querySelectorAll('[data-wpr-confirm-cancel]').forEach(function(button) { button.addEventListener('click', wprCloseSubmitConfirmation); });
  overlay.querySelector('[data-wpr-confirm-submit]').addEventListener('click', wprConfirmSubmit);
}

/**
 * Close the save confirmation without changing the draft.
 * @returns {void} Function result.
 */
export function wprCloseSubmitConfirmation() {
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
    await wprUploadWithProgress('/api/work-progress', form, function(phase, percent) {
      button.textContent = wprUploadProgressText(phase, percent);
    });
    wprCloseSubmitConfirmation();
    wprClearPendingFiles();
    workProgressState.wprCurrentReport = null;
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
export async function wprSubmit() {
  if (!wprCanCreate()) { toast('沒有新增工作進度回報的權限', 'error'); return; }
  if (wprPendingSubmit || !workProgressState.wprCurrentReport || !workProgressState.wprCurrentReport.appointment_id || workProgressState.wprReportsByAppointment[workProgressState.wprCurrentReport.appointment_id]) return;
  var uploader = document.getElementById('wpr-uploader');
  var uploaderName = uploader ? uploader.value.trim() : '';
  var note = document.getElementById('wpr-note');
  if (!uploaderName) { toast('請填寫回報人顯示名稱', 'error'); return; }
  if (uploaderName.length > 50) { toast('回報人顯示名稱最多 50 字', 'error'); return; }
  if (note && note.value.length > 1000) { toast('工作進度最多 1000 字', 'error'); return; }
  var snapshot = wprBuildSubmitSnapshot();
  if (snapshot) wprOpenSubmitConfirmation(snapshot);
}
