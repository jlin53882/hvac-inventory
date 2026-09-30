import { createRequestGuard } from '../../core/request-guard.js';
// 行事曆專屬狀態與常數（原本放在 core/state.js；只有行事曆與網址同步用到，所以由 calendar 擁有）
/**
 * 解析網址 ?month=YYYY-MM（F5 保留月份）；格式不合或月份不在 1–12 一律回到「本月」。
 * @param {string} search location.search（例如 '?month=2026-09'）。
 * @param {Date} [now] 測試用：指定「現在」。
 * @returns {Date} 該月 1 號。
 */
export function parseCalendarMonth(search, now) {
  const raw = new URLSearchParams(search).get('month');
  if (raw && /^\d{4}-\d{2}$/.test(raw)) {
    const year = parseInt(raw.slice(0, 4));
    const month = Number(raw.slice(5, 7));
    if (month >= 1 && month <= 12) return new Date(year, month - 1, 1);
  }
  return now || new Date();
}
export const CAL_PALETTE = Object.freeze(['#1a73e8', '#e91e63', '#9c27b0', '#2e7d32', '#f57c00', '#00838f', '#c62828', '#5d4037']);
export const CAL_WEEK = Object.freeze(['日', '一', '二', '三', '四', '五', '六']);
export const calendarState = {
  calMonth: parseCalendarMonth(location.search), // 目前檢視的月份（網址 ?month= 的初始值）
  calSelected: new Date(), // 選取的日期
  calEvents: [], // 當月/當日行程
  calTodayEvents: [], // 今日派工（KPI 用，沿用既有 date API）
  calLoadError: '', // 行事曆資料載入錯誤
  calLoadGuard: createRequestGuard(),
  calSvc: [], // 服務項目字典（全部，含停用）
  calAssignable: [], // 可指派人員
  // Search is a right-panel mode, not a new page-level section.
  calSearchMode: false,
  calSearchItems: [],
  calSearchMeta: { from: '', to: '', q: '' },
  calSearchGuard: createRequestGuard(),
  calSearchState: 'idle',
};
