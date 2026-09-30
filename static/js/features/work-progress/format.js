// 庫存管理系統 - 工作進度：日期與建立者顯示格式

import { currentUser } from '../../core/session.js';
import { esc } from '../../core/utils.js';

// Gallery dynamically creates id="wpr-gallery-overlay" before lookup.
// Work Progress dialogs dynamically create id="wpr-confirm-overlay", id="wpr-unsaved-overlay", and id="wpr-pending-gallery-overlay".

/**
 * Format a local Date as the date value used by the Work Progress API.
 * @param {Date} date - Function input.
 * @returns {void} Function result.
 */
export function wprIsoDate(date) {
  var d = date || new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
/**
 * Extract the YYYY-MM month used by KPI requests.
 * @param {string} dateValue - Function input.
 * @returns {void} Function result.
 */
export function wprMonth(dateValue) { return (dateValue || wprIsoDate()).slice(0, 7); }
/**
 * Render a job time range without inventing a midnight time.
 * @param {Object} job - Function input.
 * @returns {void} Function result.
 */
export function wprTimeText(job) {
  return job.start_time && job.end_time ? esc(job.start_time) + '–' + esc(job.end_time) : '未指定時間';
}
/**
 * Resolve the read-only display name shown on the create form.
 * @returns {void} Function result.
 */
export function wprCurrentUserName() {
  return ((currentUser && (currentUser.display_name || currentUser.username)) || '目前登入者');
}
/**
 * Format the immutable creator identity shown in history.
 * @param {Object} report - Function input.
 * @returns {void} Function result.
 */
export function wprCreatedByText(report) {
  return report.created_by_display_name || report.created_by_username || '未知帳號';
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
