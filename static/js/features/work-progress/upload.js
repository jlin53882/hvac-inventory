// 庫存管理系統 - 工作進度：照片選取、驗證與上傳

import { esc, toast } from '../../core/utils.js';
import { wprClearPendingFiles } from './pending-photos.js';
import { wprTimeText } from './format.js';
import { wprLoadHistory, wprLoadKpi } from './history.js';
import { wprCanCreate, wprRenderCreate } from './page.js';
import { wprLoadDay } from './day.js';
import { workProgressState } from './state.js';
import { wprUploadProgressText, wprUploadWithProgress } from './photo-upload.js';
import { wprCloseSubmitConfirmation } from './draft.js';

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
  workProgressState.wprPendingSubmit = snapshot;
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
 * Submit the exact snapshot after the user confirms the save dialog.
 * @returns {Promise<void>} Completion promise.
 */
async function wprConfirmSubmit() {
  var snapshot = workProgressState.wprPendingSubmit;
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
  if (workProgressState.wprPendingSubmit || !workProgressState.wprCurrentReport || !workProgressState.wprCurrentReport.appointment_id || workProgressState.wprReportsByAppointment[workProgressState.wprCurrentReport.appointment_id]) return;
  var uploader = document.getElementById('wpr-uploader');
  var uploaderName = uploader ? uploader.value.trim() : '';
  var note = document.getElementById('wpr-note');
  if (!uploaderName) { toast('請填寫回報人顯示名稱', 'error'); return; }
  if (uploaderName.length > 50) { toast('回報人顯示名稱最多 50 字', 'error'); return; }
  if (note && note.value.length > 1000) { toast('工作進度最多 1000 字', 'error'); return; }
  var snapshot = wprBuildSubmitSnapshot();
  if (snapshot) wprOpenSubmitConfirmation(snapshot);
}
