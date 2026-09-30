// 已領出頁的事件委派：頁面標記只寫 data-action（與 data-id / data-filter），不再寫 inline handler，
// 也不需要把函式掛到 window.Stockout。action 一律以 "stockout-" 開頭，避免和其他 feature 的 data-action 互相誤觸。
// 本檔只由 pages/main.js 載入（page.js 不能 import modals.js：modals 會回頭重繪本頁）。

import { createActionDelegate } from '../../core/actions.js';
import { closeStockoutExportDialog, openStockoutExportDialog, submitStockoutExport } from './export-dialog.js';
import {
  deleteStockoutReturn, openEditStockoutModal, openEditStockoutReturnModal, openKitPrepareModal, openNonStockOutModal,
  openNonStockPrepareModal, openOutModal, openPrepareModal, openPreparedEditModal, openPreparedOutModal, returnPrepared, returnStockout,
  submitEditStockout, submitNonStockOut, submitNonStockPrepare, submitPrepare, submitPreparedEdit, submitPreparedOut,
  submitReturnStockout, submitStockOut,
} from './modals.js';
import { clearStockoutFilters, deleteStockoutRecord, renderStockOuts, setStockoutFilter } from './page.js';
import { openStockoutSheet } from './sheet.js';

const stockoutActionId = function(el) { return Number(el.dataset.id); };

// action → 事件類型 → handler(el, event)
const STOCKOUT_ACTIONS = {
  'stockout-edit': { click: function(el) { openEditStockoutModal(stockoutActionId(el)); } },
  'stockout-return': { click: function(el) { returnStockout(stockoutActionId(el)); } },
  'stockout-delete': { click: function(el) { deleteStockoutRecord(stockoutActionId(el)); } },
  'stockout-edit-return': { click: function(el) { openEditStockoutReturnModal(stockoutActionId(el)); } },
  'stockout-delete-return': { click: function(el) { deleteStockoutReturn(stockoutActionId(el)); } },
  'stockout-sheet': { click: function(el) { openStockoutSheet(stockoutActionId(el)); } },
  'stockout-search': { click: function() { renderStockOuts(); } },
  'stockout-clear-filters': { click: function() { clearStockoutFilters(); } },
  'stockout-new-nonstock': { click: function() { openNonStockOutModal(); } },
  'stockout-export': { click: function() { openStockoutExportDialog(); } },
  // 其他 feature（庫存 / 整組 / 待領出頁）的按鈕也用這些 action；modal 的 owner 是 stockout，所以在這裡接線
  'stockout-prepare-nonstock': { click: function() { openNonStockPrepareModal(); } },
  'stockout-prepared-edit': { click: function(el) { openPreparedEditModal(stockoutActionId(el)); } },
  'stockout-prepared-out': { click: function(el) { openPreparedOutModal(stockoutActionId(el)); } },
  'stockout-prepared-return': { click: function(el) { returnPrepared(stockoutActionId(el)); } },
  'stockout-kit-prepare': { click: function(el) { openKitPrepareModal(stockoutActionId(el), el.dataset.name); } },
  'stockout-out': { click: function(el, event) { openOutModal(stockoutActionId(el), event); } },
  'stockout-prepare': { click: function(el, event) { openPrepareModal(stockoutActionId(el), event); } },
  // index.html 的靜態 modal 按鈕
  'stockout-export-backdrop': { click: function(el, event) { if (event.target === el) closeStockoutExportDialog(); } },
  'stockout-export-close': { click: function() { closeStockoutExportDialog(); } },
  'stockout-export-submit': { click: function() { submitStockoutExport(); } },
  'stockout-submit-prepared-edit': { click: function() { submitPreparedEdit(); } },
  'stockout-submit-out': { click: function() { submitStockOut(); } },
  'stockout-submit-nonstock-out': { click: function() { submitNonStockOut(); } },
  'stockout-submit-nonstock-prepare': { click: function() { submitNonStockPrepare(); } },
  'stockout-submit-prepare': { click: function() { submitPrepare(); } },
  'stockout-submit-prepared-out': { click: function() { submitPreparedOut(); } },
  'stockout-submit-edit': { click: function() { submitEditStockout(); } },
  'stockout-submit-return': { click: function() { submitReturnStockout(); } },
  // 日期變更即重新查詢；關鍵字只記錄，按 Enter 才查詢
  'stockout-filter': {
    change: function(el) { if (el.dataset.filter !== 'search') setStockoutFilter(el.dataset.filter, el.value); },
    input: function(el) { if (el.dataset.filter === 'search') setStockoutFilter('search', el.value); },
    keydown: function(el, event) { if (el.dataset.filter === 'search' && event.key === 'Enter') renderStockOuts(); },
  },
};

const delegate = createActionDelegate('stockout-', STOCKOUT_ACTIONS);

/** 測試入口：直接分派一個（模擬的）事件。 */
export const handleStockoutEvent = delegate.handle;

export const initStockoutActions = delegate.init;
