// 待領出頁的事件委派（data-action="prepared-*"）。標記只寫 data-action / data-id，不掛 window.Prepared。
// 待領出頁上屬於已領出流程的按鈕（編輯 / 已領出 / 退回 / 新增）由 stockout/actions.js 的 "stockout-*" action 處理。

import { createActionDelegate } from '../../core/actions.js';
import { clearPrepared, renderPrepared, toggleKitSubItems } from './page.js';
import { openPreparedSheet } from './sheet.js';

const PREPARED_ACTIONS = {
  'prepared-toggle-subitems': { click: function(el) { toggleKitSubItems(el); } },
  'prepared-clear': { click: function(el) { clearPrepared(Number(el.dataset.id), Number(el.dataset.qty)); } },
  'prepared-sheet': { click: function(el) { openPreparedSheet(Number(el.dataset.id)); } },
  'prepared-reload': { click: function() { renderPrepared(); } },
};

const delegate = createActionDelegate('prepared-', PREPARED_ACTIONS);

/** 測試入口：直接分派一個（模擬的）事件。 */
export const handlePreparedEvent = delegate.handle;

export const initPreparedActions = delegate.init;
