// 庫存管理系統 - 工作進度：載入並繪製所選日期的行事曆工作（issue #39 自 page.js 抽出，讓儲存 / 編輯後可重載當日工作而不 import 頁面模組）

import { apiFetch } from '../../core/api-client.js';
import { esc } from '../../core/utils.js';
import { wprTimeText } from './format.js';
import { workProgressState } from './state.js';

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
    workProgressState.wprCurrentDateValue = dateValue;
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
export function wprRenderJobs() {
  var list = document.getElementById('wpr-job-list');
  if (!list) return;
  if (!workProgressState.wprAppointments.length) { list.innerHTML = '<div class="wpr-empty">📅 此日期尚無工作安排<br><a href="/">前往行事曆</a></div>'; return; }
  list.innerHTML = workProgressState.wprAppointments.map(function(job) {
    var existing = workProgressState.wprReportsByAppointment[job.id];
    var selected = workProgressState.wprCurrentReport && workProgressState.wprCurrentReport.appointment_id === job.id;
    return '<button type="button" class="wpr-job-card ' + (selected ? 'is-selected' : '') + '" onclick="WorkProgress.wprSelectJob(' + job.id + ')"><span class="wpr-job-radio">' + (selected ? '●' : '○') + '</span><span class="wpr-job-body"><strong>' + wprTimeText(job) + '</strong><b>' + esc(job.service_name || '未指定服務') + '</b><span>👤 ' + esc(job.client_name || '') + '</span>' + (job.address ? '<span>📍 ' + esc(job.address) + '</span>' : '') + '</span><span class="wpr-job-status">' + (existing ? '✅ 已回報' : '尚未回報') + '</span></button>';
  }).join('');
}
