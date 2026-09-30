// 行事曆頁的事件委派（data-action="cal-*"）。標記只寫 data-action 與 data-*，不掛 window.Calendar。
// 本檔只由 pages/main.js 載入（它 import 本 feature 的各模組，沒有其他模組 import 它）。

import { createActionDelegate } from '../../core/actions.js';
import {
  calDeleteAppt, calOpenAppt, calRetryMySync, calRetryTeamMember, calRetryTeamSync, calShowSyncError, calShowTeamSyncDetails,
  calSubmitAppt, closeCalModal,
} from './appt-modal.js';
import { calSearch } from './search.js';
import { calAddSvc, calDelSvc, calSetColor, calSetTab, calUpdSvc, calUpdSvcActive } from './settings-modal.js';
import {
  calChangeMonth, calClearSearch, calExport, calJumpToDate, calPickDate, calPickToday, calRetryLoad, calShiftDay,
} from './view.js';

const id = function(el) { return Number(el.dataset.id); };

const CAL_ACTIONS = {
  'cal-pick-date': { change: function(el) { calPickDate(el.value); } },
  'cal-search-input': { keydown: function(el, event) { if (event.key === 'Enter') calSearch(); } },
  'cal-search': { click: function() { calSearch(); } },
  'cal-clear-search': { click: function() { calClearSearch(); } },
  // 搜尋結果列是 role="button"：滑鼠點擊與 Enter / 空白鍵都要能跳到該日
  'cal-jump-date': {
    click: function(el) { calJumpToDate(el.dataset.date); },
    keydown: function(el, event) { if (event.key === 'Enter' || event.key === ' ') el.click(); },
  },
  'cal-month': { click: function(el) { calChangeMonth(Number(el.dataset.delta)); } },
  'cal-today': { click: function() { calPickToday(); } },
  'cal-day': { click: function(el) { calShiftDay(Number(el.dataset.delta)); } },
  'cal-export': { click: function() { calExport(); } },
  'cal-retry-load': { click: function() { calRetryLoad(); } },
  // 派工
  'cal-appt-open': { click: function(el) { calOpenAppt(el.dataset.id ? id(el) : undefined); } },
  'cal-appt-delete': { click: function(el) { calDeleteAppt(id(el)); } },
  'cal-appt-submit': { click: function() { calSubmitAppt(); } },
  'cal-modal-close': { click: function() { closeCalModal(); } },
  // 同步狀態
  'cal-sync-error': { click: function(el) { calShowSyncError(id(el)); } },
  'cal-my-sync-retry': { click: function(el) { calRetryMySync(id(el)); } },
  'cal-team-sync-details': { click: function(el) { calShowTeamSyncDetails(id(el)); } },
  'cal-team-sync-retry': { click: function() { calRetryTeamSync(); } },
  'cal-team-member-retry': { click: function(el) { calRetryTeamMember(Number(el.dataset.apptId), Number(el.dataset.userId)); } },
  // 行事曆設定
  'cal-settings-tab': { click: function(el) { calSetTab(el.dataset.tab); } },
  'cal-svc-add': { click: function() { calAddSvc(); } },
  'cal-svc-update': { change: function(el) { calUpdSvc(id(el), el.value); } },
  'cal-svc-active': { click: function(el) { calUpdSvcActive(id(el)); } },
  'cal-svc-delete': { click: function(el) { calDelSvc(id(el)); } },
  'cal-person-color': { click: function(el) { calSetColor(id(el), el.dataset.color); } },
};

const delegate = createActionDelegate('cal-', CAL_ACTIONS);

/** 測試入口：直接分派一個（模擬的）事件。 */
export const handleCalendarEvent = delegate.handle;

export const initCalendarActions = delegate.init;
