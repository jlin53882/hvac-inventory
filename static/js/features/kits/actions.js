// 整組庫存頁的事件委派（data-action="kits-*"）。標記只寫 data-action / data-id / data-idx，不掛 window.Kits。
// 整組頁上屬於其他 feature 的按鈕（待領出 / 已領出 / 調撥）由該 feature 的 action 處理（stockout-* / inventory-*）。

import { createActionDelegate } from '../../core/actions.js';
import { closeInventoryStatusModal } from '../inventory/status.js';
import { filterKitSearch, kitCompQtyChanged, openKitSearch, pickKitItem } from './component-rows.js';
import { closeKitExportDialog, openKitExportDialog, submitKitExport } from './export-dialog.js';
import { addKitCompRow, addKitLocationRow, openKitModal, removeKitCompRow, removeKitLocationRow, submitKit, submitKitEdit } from './kit-modal.js';
import { assembleKit, deleteKit, disassembleKit, editKit, openKitSheet, renderKits } from './page.js';
import { showKitStatusList } from './status.js';

const kitId = function(el) { return Number(el.dataset.id); };
const rowIndex = function(el) { return Number(el.dataset.idx); };

const KITS_ACTIONS = {
  'kits-open-modal': { click: function() { openKitModal(); } },
  'kits-reload': { click: function() { renderKits(); } },
  'kits-export': { click: function() { openKitExportDialog(); } },
  // KPI 卡是 role="button"：滑鼠點擊與 Enter / 空白鍵都要能開啟清單
  'kits-export-backdrop': { click: function(el, event) { if (event.target === el) closeKitExportDialog(); } },
  'kits-export-close': { click: function() { closeKitExportDialog(); } },
  'kits-export-submit': { click: function() { submitKitExport(); } },
  'kits-location-add': { click: function() { addKitLocationRow(); } },
  'kits-comp-add': { click: function() { addKitCompRow(); } },
  'kits-submit': { click: function() { submitKit(); } },
  // 編輯整組時 kit-modal 的送出鈕改指向這個 action（見 kits/page.js editKit）
  'kits-submit-edit': { click: function() { submitKitEdit(); } },
  'kits-status-list': {
    click: function(el) { showKitStatusList(el.dataset.type); },
    keydown: function(el, event) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      showKitStatusList(el.dataset.type);
    },
  },
  'kits-sheet': { click: function(el) { openKitSheet(kitId(el)); } },
  'kits-edit': { click: function(el) { editKit(kitId(el)); } },
  'kits-delete': { click: function(el) { deleteKit(kitId(el)); } },
  'kits-assemble': { click: function(el) { assembleKit(kitId(el)); } },
  'kits-disassemble': { click: function(el) { disassembleKit(kitId(el)); } },
  'kits-edit-from-status': { click: function(el) { closeInventoryStatusModal(); editKit(kitId(el)); } },
  'kits-comp-qty': { change: function(el) { kitCompQtyChanged(rowIndex(el), el.value); } },
  'kits-comp-remove': { click: function(el) { removeKitCompRow(rowIndex(el)); } },
  'kits-search': {
    focusin: function() { openKitSearch(); },
    input: function(el) { filterKitSearch(el.value); },
  },
  'kits-pick-item': { click: function(el) { pickKitItem(kitId(el)); } },
  'kits-location-remove': { click: function(el) { removeKitLocationRow(rowIndex(el)); } },
};

const delegate = createActionDelegate('kits-', KITS_ACTIONS);

/** 測試入口：直接分派一個（模擬的）事件。 */
export const handleKitsEvent = delegate.handle;

export const initKitsActions = delegate.init;
