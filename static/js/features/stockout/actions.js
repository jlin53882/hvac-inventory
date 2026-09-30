// 已領出頁的事件委派：頁面標記只寫 data-action（與 data-id / data-filter），不再寫 inline handler，
// 也不需要把函式掛到 window.Stockout。action 一律以 "stockout-" 開頭，避免和其他 feature 的 data-action 互相誤觸。
// 本檔只由 pages/main.js 載入（page.js 不能 import modals.js：modals 會回頭重繪本頁）。

import { openStockoutExportDialog } from './export-dialog.js';
import { deleteStockoutReturn, openEditStockoutModal, openEditStockoutReturnModal, openNonStockOutModal, returnStockout } from './modals.js';
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
  // 日期變更即重新查詢；關鍵字只記錄，按 Enter 才查詢
  'stockout-filter': {
    change: function(el) { if (el.dataset.filter !== 'search') setStockoutFilter(el.dataset.filter, el.value); },
    input: function(el) { if (el.dataset.filter === 'search') setStockoutFilter('search', el.value); },
    keydown: function(el, event) { if (el.dataset.filter === 'search' && event.key === 'Enter') renderStockOuts(); },
  },
};

/**
 * 依事件目標（含巢狀子元素）找到最近的 stockout action 並執行。
 * @param {Event} event click / change / input / keydown 事件。
 * @returns {boolean} 是否有 action 被執行。
 */
export function handleStockoutEvent(event) {
  const el = event.target && event.target.closest ? event.target.closest('[data-action^="stockout-"]') : null;
  if (!el || el.disabled) return false;
  const handler = (STOCKOUT_ACTIONS[el.dataset.action] || {})[event.type];
  if (!handler) return false;
  handler(el, event);
  return true;
}

export function initStockoutActions() {
  ['click', 'change', 'input', 'keydown'].forEach(function(type) {
    document.addEventListener(type, handleStockoutEvent);
  });
}
