// 庫存管理系統 - 工作進度：照片上傳 I/O 與驗證規則（建立回報與歷史詳情加照片共用；issue #39 自 upload.js 抽出）

import { apiErrorMessage } from '../../core/utils.js';

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

var WPR_ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
var WPR_ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
export var WPR_MAX_FILES = 20;
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
