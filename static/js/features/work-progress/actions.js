// 每日工作進度頁的事件委派（data-action="wpr-*"）。標記只寫 data-action 與 data-*，不掛 window.WorkProgress。
// 本檔只由 pages/main.js 載入（它 import 本 feature 的各模組，沒有其他模組 import 它）。

import { createActionDelegate } from '../../core/actions.js';
import {
  wprAddExistingPhotos, wprBatchDeletePhotos, wprClearPhotoSelection, wprDeleteReport, wprEditReport, wprOpenHistoryDetail,
  wprSelectAllPhotoSelection, wprTogglePhotoManage, wprTogglePhotoSelection,
} from './detail.js';
import { wprCloseLeaveConfirmation, wprDiscardAndLeave, wprUpdateNoteCount } from './draft.js';
import { wprCloseGallery, wprClosePendingGallery, wprGalleryMove, wprOpenGallery, wprOpenPendingGallery, wprPendingGalleryMove } from './gallery.js';
import { wprLoadHistory, wprQuickRange, wprResetFilter } from './history.js';
import { wprHandleDateChange, wprHistoryToggled, wprSelectJob } from './page.js';
import { wprAddPendingFiles, wprRemovePending } from './pending-photos.js';
import { wprSubmit } from './upload.js';

const id = function(el) { return Number(el.dataset.id); };
const index = function(el) { return Number(el.dataset.index); };
const clickInput = function(inputId) { const input = document.getElementById(inputId); if (input) input.click(); };

const WPR_ACTIONS = {
  'wpr-scroll-history': { click: function() { document.getElementById('wpr-history').scrollIntoView({ behavior: 'smooth' }); } },
  'wpr-query': { keydown: function(el, event) { if (event.key === 'Enter') wprLoadHistory(1); } },
  'wpr-search': { click: function() { wprLoadHistory(1); } },
  'wpr-reset-filter': { click: function() { wprResetFilter(); } },
  'wpr-range': { click: function(el) { wprQuickRange(el.dataset.range, el); } },
  'wpr-history-page': { click: function(el) { wprLoadHistory(Number(el.dataset.page)); } },
  // <details> 的 toggle 事件不冒泡，delegate 以 capture 接
  'wpr-history-toggle': { toggle: function(el) { wprHistoryToggled(el, id(el)); } },
  'wpr-history-detail': { click: function(el) { wprOpenHistoryDetail(id(el), el.dataset.target); } },
  'wpr-date-change': { change: function() { wprHandleDateChange(); } },
  'wpr-note-input': { input: function() { wprUpdateNoteCount(); } },
  'wpr-pick-album': { click: function() { clickInput('wpr-album'); } },
  'wpr-pick-camera': { click: function() { clickInput('wpr-camera'); } },
  'wpr-add-files': { change: function(el) { wprAddPendingFiles(el.files); el.value = ''; } },
  'wpr-submit': { click: function() { wprSubmit(); } },
  'wpr-select-job': { click: function(el) { wprSelectJob(id(el)); } },
  'wpr-leave-cancel': { click: function() { wprCloseLeaveConfirmation(); } },
  'wpr-leave-discard': { click: function() { wprDiscardAndLeave(); } },
  // 待上傳照片
  'wpr-pending-open': { click: function(el) { wprOpenPendingGallery(index(el)); } },
  'wpr-pending-remove': { click: function(el) { wprRemovePending(index(el)); } },
  'wpr-pending-gallery-close': { click: function() { wprClosePendingGallery(); } },
  'wpr-pending-gallery-move': { click: function(el) { wprPendingGalleryMove(Number(el.dataset.dir)); } },
  // 已上傳照片
  'wpr-gallery-open': { click: function(el) { wprOpenGallery(id(el), index(el)); } },
  'wpr-gallery-close': { click: function() { wprCloseGallery(); } },
  'wpr-gallery-move': { click: function(el) { wprGalleryMove(Number(el.dataset.dir)); } },
  // 回報詳情
  'wpr-report-edit': { click: function(el) { wprEditReport(id(el), el.dataset.target); } },
  'wpr-report-delete': { click: function(el) { wprDeleteReport(id(el)); } },
  'wpr-photo-add-existing': { click: function(el) { wprAddExistingPhotos(id(el), el.dataset.target); } },
  'wpr-photo-manage-toggle': { click: function(el) { wprTogglePhotoManage(id(el), el.dataset.target); } },
  'wpr-photo-toggle-selection': { click: function(el) { wprTogglePhotoSelection(id(el), index(el), el.dataset.target); } },
  'wpr-photo-select-all': { click: function(el) { wprSelectAllPhotoSelection(id(el), el.dataset.target); } },
  'wpr-photo-clear-selection': { click: function(el) { wprClearPhotoSelection(id(el), el.dataset.target); } },
  'wpr-photo-batch-delete': { click: function(el) { wprBatchDeletePhotos(id(el), el.dataset.target); } },
};

const delegate = createActionDelegate('wpr-', WPR_ACTIONS);

/** 測試入口：直接分派一個（模擬的）事件。 */
export const handleWorkProgressEvent = delegate.handle;

export const initWorkProgressActions = delegate.init;
