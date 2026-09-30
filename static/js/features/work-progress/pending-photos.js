// 庫存管理系統 - 工作進度：建立表單的待上傳照片（拖曳 / 選取、縮圖、移除、清空；issue #39 自 upload.js 抽出）

import { esc, toast } from '../../core/utils.js';
import { wprClosePendingGallery } from './gallery.js';
import { WPR_MAX_FILES, wprValidatePhotoBatch } from './photo-upload.js';
import { workProgressState } from './state.js';

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
  grid.innerHTML = workProgressState.wprSelectedFiles.map(function(item, index) { return '<div class="wpr-photo-tile"><button type="button" class="wpr-pending-preview" data-action="wpr-pending-open" data-index="' + index + '" aria-label="預覽第 ' + (index + 1) + ' 張待上傳照片"><img src="' + esc(item.previewUrl) + '" alt="待上傳照片 ' + (index + 1) + '"></button><button type="button" class="wpr-photo-remove" data-action="wpr-pending-remove" data-index="' + index + '" aria-label="移除第 ' + (index + 1) + ' 張照片">✕</button></div>'; }).join('') + '<button type="button" id="wpr-add-pending-button" class="wpr-add-tile" data-action="wpr-pick-album"' + addDisabled + '>＋新增</button>';
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
 * Clear the pending create draft and release every owned object URL.
 * @returns {void} Function result.
 */
export function wprClearPendingFiles() {
  wprClosePendingGallery();
  workProgressState.wprSelectedFiles.forEach(function(item) {
    if (item && item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  });
  workProgressState.wprSelectedFiles = [];
  wprRenderPendingPhotos();
}
