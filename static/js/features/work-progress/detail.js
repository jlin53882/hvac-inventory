// 庫存管理系統 - 工作進度：歷史詳情、編輯、照片管理

import { apiFetch } from '../../core/api-client.js';
import { esc, jsStr, toast } from '../../core/utils.js';
import { wprCreatedByText, wprTimeText, wprOptionalNoteHtml } from './format.js';
import { wprLoadHistory, wprLoadKpi } from './history.js';
import { wprLoadDay } from './day.js';
import { wprClearPhotoManageStates, workProgressState } from './state.js';
import { wprUploadProgressText, wprUploadWithProgress, wprValidatePhotoBatch } from './photo-upload.js';

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
    workProgressState.wprSuppressHistoryToggle[id] = true;
    item.open = true;
  }
  await wprOpenHistoryDetail(id, resolvedTargetId);
}

/**
 * Build the stable key used to isolate photo management per detail surface.
 * @param {number} id - Report identifier.
 * @param {string} [targetId] - Detail surface identifier.
 * @returns {string} Report and target state key.
 */
function wprPhotoManageKey(id, targetId) {
  return String(id) + ':' + wprDetailTargetId(id, targetId);
}

/**
 * Return target-scoped selection state without sharing it across detail surfaces.
 * @param {number} id - Report identifier.
 * @param {string} [targetId] - Detail surface identifier.
 * @returns {{manage: boolean, selected: Object, deleting: boolean}} Mutable state.
 */
function wprPhotoManageState(id, targetId) {
  var key = wprPhotoManageKey(id, targetId);
  if (!workProgressState.wprPhotoManageStates[key]) workProgressState.wprPhotoManageStates[key] = {manage: false, selected: Object.create(null), deleting: false};
  return workProgressState.wprPhotoManageStates[key];
}

/**
 * Build report-scoped thumbnails; management mode changes clicks into selection.
 * @param {Object} report - Work progress report payload.
 * @param {number} id - Report identifier.
 * @param {string} [targetId] - Detail surface identifier.
 * @returns {string} Thumbnail markup.
 */
function wprPhotoGalleryHtml(report, id, targetId) {
  var actionTargetId = wprDetailTargetId(id, targetId);
  var state = wprPhotoManageState(id, actionTargetId);
  return (report.photos || []).map(function(photo, index) {
    var selected = !!state.selected[photo.asset_id];
    var handler = state.manage
      ? 'WorkProgress.wprTogglePhotoSelection(' + id + ',' + index + ',\'' + esc(jsStr(actionTargetId)) + '\')'
      : 'WorkProgress.wprOpenGallery(' + id + ',' + index + ')';
    return '<div class="wpr-photo-manage-tile ' + (selected ? 'is-selected' : '') + '"><button type="button" onclick="' + handler + '" aria-pressed="' + (selected ? 'true' : 'false') + '" aria-label="' + (state.manage ? '選取' : '開啟') + '施工照片 ' + (index + 1) + '">' + (state.manage ? '<span class="wpr-photo-selection-badge" aria-hidden="true">' + (selected ? '✓' : '') + '</span>' : '') + '<img src="' + esc(photo.thumbnail_url) + '" alt="施工照片 ' + (index + 1) + '" loading="lazy" decoding="async"></button></div>';
  }).join('');
}

/**
 * Build the explicit multi-select toolbar for one report/detail target.
 * @param {Object} report - Work progress report payload.
 * @param {number} id - Report identifier.
 * @param {string} targetId - Detail surface identifier.
 * @returns {string} Management toolbar markup.
 */
function wprPhotoManagementToolbarHtml(id, targetId) {
  var state = wprPhotoManageState(id, targetId);
  var selectedCount = Object.keys(state.selected).length;
  var disabled = state.deleting ? ' disabled' : '';
  return '<div class="wpr-photo-management-toolbar" role="toolbar" aria-label="施工照片管理"><span class="wpr-photo-selected-count">已選 ' + selectedCount + ' 張</span><div class="wpr-photo-management-actions"><button type="button" class="btn btn--secondary btn--sm" onclick="WorkProgress.wprSelectAllPhotoSelection(' + id + ',\'' + esc(jsStr(targetId)) + '\')"' + disabled + '>全選</button><button type="button" class="btn btn--secondary btn--sm wpr-photo-clear-selection" onclick="WorkProgress.wprClearPhotoSelection(' + id + ',\'' + esc(jsStr(targetId)) + '\')"' + (disabled || selectedCount === 0 ? ' disabled' : '') + '>取消選取</button><button type="button" class="btn btn--danger btn--sm wpr-photo-batch-delete" onclick="WorkProgress.wprBatchDeletePhotos(' + id + ',\'' + esc(jsStr(targetId)) + '\')" aria-label="刪除選取的 ' + selectedCount + ' 張照片"' + (selectedCount === 0 || state.deleting ? ' disabled' : '') + '>' + (state.deleting ? '刪除中…' : '刪除選取') + '</button><button type="button" class="btn btn--secondary btn--sm wpr-photo-finish" onclick="WorkProgress.wprTogglePhotoManage(' + id + ',\'' + esc(jsStr(targetId)) + '\')"' + disabled + '>完成選取</button></div></div>';
}
/**
 * Load and render the full detail body for one report.
 * @param {number} id - Report identifier.
 * @param {string} [targetId] - Optional detail container id for non-history callers.
 * @returns {Promise<void>} Completion promise.
 */
export async function wprOpenHistoryDetail(id, targetId, cachedReport) {
  var detailTargetId = wprDetailTargetId(id, targetId);
  var detail = document.getElementById(detailTargetId); if (!detail) return;
  var tokenKey = id + ':' + detailTargetId;
  var token = (workProgressState.wprDetailRequestTokens[tokenKey] || 0) + 1; workProgressState.wprDetailRequestTokens[tokenKey] = token;
  var cacheKey = wprPhotoManageKey(id, detailTargetId);
  if (cachedReport) workProgressState.wprPhotoManageReports[cacheKey] = cachedReport;
  if (workProgressState.wprLastDetailReport && workProgressState.wprLastDetailReport.id === id && !cachedReport) workProgressState.wprLastDetailReport = null;
  try {
    var report = cachedReport || (await apiFetch('/api/work-progress/' + id));
    if (token !== workProgressState.wprDetailRequestTokens[tokenKey]) return;
    workProgressState.wprPhotoManageReports[cacheKey] = report;
    workProgressState.wprLastDetailReport = { id: id, report: report };
    var actionTargetId = esc(jsStr(detailTargetId));
    detail.innerHTML = '<div class="wpr-detail-grid"><span>工作日期<b>' + esc(report.report_date) + '</b></span><span>服務項目<b>' + esc(report.service_name || '未指定服務') + '</b></span><span>客戶 / 案場<b>' + esc(report.client_name) + '</b></span><span>時間<b>' + wprTimeText(report) + '</b></span><span>地址<b>' + esc(report.address || '—') + '</b></span><span>回報人<b>' + esc(report.uploader_name) + '</b></span><span>建立帳號<b>' + esc(wprCreatedByText(report)) + '</b></span></div>' + wprOptionalNoteHtml('行事曆備註', report.appointment_note) + wprOptionalNoteHtml('工作進度', report.note) + '<div class="wpr-detail-photo-section"><h4 class="wpr-detail-photo-title">施工照片</h4>' + (wprPhotoManageState(id, detailTargetId).manage ? wprPhotoManagementToolbarHtml(id, detailTargetId) : '') + '<div class="wpr-gallery-grid">' + wprPhotoGalleryHtml(report, id, detailTargetId) + '</div></div><div class="wpr-detail-actions">' + (report.can_edit ? '<button type="button" class="btn btn--secondary btn--sm wpr-detail-action-edit" onclick="WorkProgress.wprEditReport(' + id + ',\'' + actionTargetId + '\')">✏️ 編輯回報</button><button type="button" class="btn btn--secondary btn--sm wpr-detail-action-manage" onclick="WorkProgress.wprTogglePhotoManage(' + id + ',\'' + actionTargetId + '\')">' + (wprPhotoManageState(id, detailTargetId).manage ? '結束照片管理' : '📷 管理照片') + '</button><span class="wpr-photo-limit">目前 ' + report.photo_count + ' / 20 張照片' + (report.photo_count >= 20 ? ' · 已達照片上限' : ' · 最多還可新增 ' + (20 - report.photo_count) + ' 張') + '</span><button type="button" class="btn btn--secondary btn--sm wpr-detail-action-add" onclick="WorkProgress.wprAddExistingPhotos(' + id + ',\'' + actionTargetId + '\')"' + (report.photo_count >= 20 ? ' disabled' : '') + '>📷 新增照片</button>' : '') + (report.can_delete ? '<button type="button" class="btn btn--danger btn--sm wpr-detail-action-delete" onclick="WorkProgress.wprDeleteReport(' + id + ')">🗑 刪除</button>' : '') + '</div>';
  } catch (error) { if (token === workProgressState.wprDetailRequestTokens[tokenKey]) detail.textContent = error.message; }
}
/**
 * Toggle destructive photo controls for one report.
 * @param {number} id - Report identifier.
 * @param {string} [targetId] - Internal detail container id to refresh.
 * @returns {Promise<void>} Completion promise.
 */
export function wprTogglePhotoManage(id, targetId) {
  var state = wprPhotoManageState(id, targetId);
  state.manage = !state.manage;
  if (!state.manage) state.selected = Object.create(null);
  wprOpenHistoryDetail(id, targetId);
}

/**
 * Toggle one photo in a target-scoped management selection.
 * @param {number} id - Report identifier.
 * @param {number} index - Photo index in the current authoritative report.
 * @param {string} targetId - Detail surface identifier.
 * @returns {Promise<void>} Completion promise.
 */
export async function wprTogglePhotoSelection(id, index, targetId) {
  var state = wprPhotoManageState(id, targetId);
  var report = workProgressState.wprPhotoManageReports[wprPhotoManageKey(id, targetId)] || null;
  var photo = report && report.photos && report.photos[index];
  if (!state.manage || !photo) return;
  if (state.selected[photo.asset_id]) delete state.selected[photo.asset_id];
  else state.selected[photo.asset_id] = true;
  await wprOpenHistoryDetail(id, targetId, report);
}

/**
 * Select every photo in the current report only.
 * @param {number} id - Report identifier.
 * @param {string} targetId - Detail surface identifier.
 * @returns {Promise<void>} Completion promise.
 */
export async function wprSelectAllPhotoSelection(id, targetId) {
  var state = wprPhotoManageState(id, targetId);
  var report = workProgressState.wprPhotoManageReports[wprPhotoManageKey(id, targetId)] || null;
  if (!state.manage || !report) return;
  state.selected = Object.create(null);
  (report.photos || []).forEach(function(photo) { state.selected[photo.asset_id] = true; });
  await wprOpenHistoryDetail(id, targetId, report);
}

/**
 * Clear the selection without leaving management mode.
 * @param {number} id - Report identifier.
 * @param {string} targetId - Detail surface identifier.
 * @returns {Promise<void>} Completion promise.
 */
export async function wprClearPhotoSelection(id, targetId) {
  var state = wprPhotoManageState(id, targetId);
  var report = workProgressState.wprPhotoManageReports[wprPhotoManageKey(id, targetId)] || null;
  state.selected = Object.create(null);
  await wprOpenHistoryDetail(id, targetId, report);
}

/**
 * Delete all selected photos through one report-scoped API mutation.
 * @param {number} id - Report identifier.
 * @param {string} targetId - Detail surface identifier.
 * @returns {Promise<void>} Completion promise.
 */
export async function wprBatchDeletePhotos(id, targetId) {
  var state = wprPhotoManageState(id, targetId);
  var report = workProgressState.wprPhotoManageReports[wprPhotoManageKey(id, targetId)] || null;
  var assetIds = Object.keys(state.selected);
  if (!state.manage || !assetIds.length || state.deleting) return;
  if (!window.confirm('確定刪除選取的 ' + assetIds.length + ' 張施工照片？\\n此動作無法復原。')) return;
  state.deleting = true;
  try {
    await apiFetch('/api/work-progress/' + id + '/photos/batch-delete', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({asset_ids:assetIds})});
    state.selected = Object.create(null);
    state.manage = false;
    state.deleting = false;
    toast('選取照片已刪除', 'success');
    await wprReloadAndReopenDetail(id, workProgressState.wprHistoryPage, targetId);
  } catch (error) {
    state.deleting = false;
    toast(error.message, 'error');
    await wprOpenHistoryDetail(id, targetId, report);
  }
}
/**
 * Persist report-owned note and display-name changes.
 * @param {number} id - Report identifier.
 * @param {string} [targetId] - Internal detail container id to refresh after save.
 * @returns {Promise<void>} Completion promise.
 */
export async function wprEditReport(id, targetId) {
  try {
    var report = await apiFetch('/api/work-progress/' + id);
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
            <label for="wpr-edit-uploader">回報人顯示名稱*</label>
            <input id="wpr-edit-uploader" type="text" maxlength="50" value="${esc(report.uploader_name || '')}">
            <div class="wpr-edit-creator">建立帳號：${esc(wprCreatedByText(report))}</div>
            <div class="wpr-edit-hint">修改回報人顯示名稱不會變更原始建立帳號與 ownership（權限）。</div>
            <label for="wpr-edit-note">工作進度(選填)</label>
            <textarea id="wpr-edit-note" maxlength="1000" rows="6">${esc(report.note || '')}</textarea>
          </section>
        </div>
        <div class="wpr-edit-footer"><button type="button" class="btn btn--secondary btn--md" data-wpr-edit-close>取消</button><button type="button" class="btn btn--primary btn--md" data-wpr-edit-save>儲存</button></div>
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
        await apiFetch('/api/work-progress/' + id, {method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uploader_name:uploader, note:note})});
        close();
        await wprReloadAndReopenDetail(id, workProgressState.wprHistoryPage, targetId);
        toast('工作進度已更新', 'success');
      } catch (error) { toast(error.message, 'error'); save.disabled = false; }
    });
  } catch (error) { toast(error.message, 'error'); }
}

/**
 * Open a multi-file picker and append photos to an existing report.
 * @param {number} id - Report identifier.
 * @param {string} [targetId] - Internal detail container id to refresh after upload.
 * @returns {void} Function result.
 */
export function wprAddExistingPhotos(id, targetId) {
  var input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/jpeg,image/png,image/webp';
  input.multiple = true;
  input.onchange = async function() {
    try {
      var files = Array.from(input.files || []);
      var report = await apiFetch('/api/work-progress/' + id);
      var validation = wprValidatePhotoBatch(files, Number(report.photo_count) || 0);
      if (!validation.ok) { toast(validation.error, 'error'); return; }
      var form = new FormData();
      files.forEach(function(file) { form.append('files', file, file.name); });
      await wprUploadWithProgress('/api/work-progress/' + id + '/photos', form, function(phase, percent) {
        toast(wprUploadProgressText(phase, percent));
      });
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
export async function wprDeleteReport(id) { if (!window.confirm('確定刪除此工作進度？\n將一併刪除備註與所有施工照片，此動作無法復原。')) return; try { await apiFetch('/api/work-progress/' + id, {method:'DELETE'}); wprClearPhotoManageStates(function(targetId) { return targetId === 'wpr-detail-' + id || targetId === 'wpr-selected-report-detail-' + id; }); toast('工作進度已刪除', 'success'); wprLoadHistory(1); wprLoadDay(); wprLoadKpi(); } catch (error) { toast(error.message, 'error'); } }
