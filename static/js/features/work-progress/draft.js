// 庫存管理系統 - 工作進度：未儲存內容保護（離開確認）

import { switchTab } from '../shell/app.js';
import { wprClosePendingGallery } from './gallery.js';
import { wprUpdateNoteCount } from './page.js';
import { workProgressState } from './state.js';
import { wprCloseSubmitConfirmation, wprPendingSubmit, wprRenderPendingPhotos } from './upload.js';

var wprBeforeUnloadInstalled = false;
var wprLeaveRequest = null;
/**
 * Return whether the create form contains content that would be lost.
 * @returns {boolean} Whether an unsaved appointment, field value, or photo exists.
 */
export function wprHasUnsavedChanges() {
  var uploader = document.getElementById('wpr-uploader');
  var note = document.getElementById('wpr-note');
  return !!(
    (workProgressState.wprCurrentReport && !workProgressState.wprCurrentReport.id && workProgressState.wprCurrentReport.appointment_id) ||
    (note && note.value.trim()) ||
    (uploader && uploader.value.trim() !== workProgressState.wprInitialUploaderName) ||
    workProgressState.wprSelectedFiles.length
  );
}

/**
 * Install the browser unload guard once for the Work Progress page.
 * @returns {void} Function result.
 */
export function wprInstallBeforeUnload() {
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
export function wprClearPendingFiles() {
  wprClosePendingGallery();
  workProgressState.wprSelectedFiles.forEach(function(item) {
    if (item && item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  });
  workProgressState.wprSelectedFiles = [];
  wprRenderPendingPhotos();
}

/**
 * Open the discard confirmation before switching away from Work Progress.
 * @param {string} nextTab - Requested destination tab.
 * @returns {void} Function result.
 */
export function wprRequestLeave(nextTab) {
  wprOpenUnsavedConfirmation({tab: nextTab, action: null});
}

/**
 * Open the discard confirmation before replacing the current create draft.
 * @param {Function} action - Action to run after the draft is discarded.
 * @returns {void} Function result.
 */
export function wprRequestDraftReset(action, restoreDate) {
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
  overlay.innerHTML = '<div class="wpr-unsaved-dialog" role="dialog" aria-modal="true" aria-labelledby="wpr-unsaved-title"><h3 id="wpr-unsaved-title">尚未儲存工作進度</h3><p>目前輸入內容與待上傳照片尚未儲存。<br>離開後這些內容將會遺失。</p><div class="wpr-unsaved-actions"><button type="button" class="btn btn--secondary btn--md" onclick="WorkProgress.wprCloseLeaveConfirmation()">繼續編輯</button><button type="button" class="btn btn--danger btn--md" onclick="WorkProgress.wprDiscardAndLeave()">放棄並離開</button></div></div>';
  document.body.appendChild(overlay);
}

/**
 * Close the unsaved-draft confirmation and keep the form intact.
 * @returns {void} Function result.
 */
export function wprCloseLeaveConfirmation() {
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
  if (uploader) uploader.value = workProgressState.wprInitialUploaderName;
  workProgressState.wprCurrentReport = null;
  var area = document.getElementById('wpr-selected-area');
  if (area) { area.hidden = true; area.innerHTML = ''; }
  var save = document.getElementById('wpr-save');
  if (save) save.disabled = true;
}

/**
 * Discard the draft, release URLs, and continue the requested action.
 * @returns {void} Function result.
 */
export function wprDiscardAndLeave() {
  var request = wprLeaveRequest;
  wprCloseLeaveConfirmation();
  wprCloseSubmitConfirmation();
  wprResetCreateDraft();
  if (request && request.action) request.action();
  else if (request && request.tab) switchTab(request.tab);
}
