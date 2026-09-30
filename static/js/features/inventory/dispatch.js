// 庫存頁的事件委派（data-action="inventory-*"）。標記只寫 data-action 與 data-*，不再寫 inline handler，也不需要 window.Inventory。
// 其他 feature 的按鈕（整組頁調撥、共用狀態清單的關閉 / 編輯）也用 inventory-* action，因為對應的 modal / 函式 owner 是 inventory。
// 本檔只由 pages/main.js 載入；它 import 各 inventory 模組（list.js 已 import actions.js，所以不能放在 actions.js 裡）。

import { createActionDelegate } from '../../core/actions.js';
import { changeInventoryPage } from '../shell/data-refresh.js';
import { closeInventoryActionMenus, closeMoreActions, deleteItem, openInventoryActionMenu, openItemSheet, toggleMoreActions } from './actions.js';
import { openAddModal, removeAddStockRow } from './add-modal.js';
import { changeQty, quickSet } from './adjust.js';
import { selectAllStocks, toggleBatchMode, toggleStockSelect } from './batch-location.js';
import { deleteEditStockRow, goEditSimilar, openEditModal } from './edit-modal.js';
import { openInventoryExportDialog } from './export-dialog.js';
import { clearFilterPanel, toggleInventoryBrand, toggleInventoryCategory } from './filters.js';
import { setInventoryView, toggleLoc } from './list.js';
import { queueStockLocationAdjustment } from './location-adjustments.js';
import { _previewKitPhoto, deleteItemPhoto, deleteKitPhoto, uploadItemPhoto } from './photo.js';
import { closeInventoryStatusModal, showInventoryStatusList } from './status.js';
import { openTransferModal } from './transfer-modal.js';

const itemId = function(el) { return Number(el.dataset.id); };

const INVENTORY_ACTIONS = {
  'inventory-filter-clear': { click: function() { clearFilterPanel(); } },
  'inventory-brand-toggle': { click: function(el) { toggleInventoryBrand(el.dataset.value); } },
  'inventory-category-toggle': { click: function(el) { toggleInventoryCategory(el.dataset.value); } },
  'inventory-add-open': { click: function() { openAddModal(); } },
  'inventory-add-stock-remove': { click: function(el) { removeAddStockRow(el); } },
  'inventory-edit-stock-remove': { click: function(el) { deleteEditStockRow(el); } },
  'inventory-view': { click: function(el) { setInventoryView(el.dataset.view); } },
  'inventory-more-toggle': { click: function() { toggleMoreActions(); } },
  'inventory-batch-toggle': { click: function() { toggleBatchMode(); } },
  'inventory-batch-from-menu': { click: function() { toggleBatchMode(); closeMoreActions(); } },
  'inventory-select-all': { click: function() { selectAllStocks(); } },
  'inventory-stock-select': { change: function(el) { toggleStockSelect(el.dataset.key); } },
  'inventory-export': { click: function() { openInventoryExportDialog(); } },
  'inventory-export-from-menu': { click: function() { openInventoryExportDialog(); closeMoreActions(); } },
  'inventory-loc-toggle': { click: function(el) { toggleLoc(el, el.dataset.loc); } },
  'inventory-item-sheet': { click: function(el) { openItemSheet(itemId(el)); } },
  'inventory-edit': { click: function(el) { openEditModal(itemId(el)); } },
  'inventory-delete': { click: function(el) { deleteItem(itemId(el)); } },
  'inventory-transfer': { click: function(el) { openTransferModal(itemId(el)); } },
  'inventory-qty-change': { click: function(el) { changeQty(itemId(el), Number(el.dataset.delta)); } },
  'inventory-qty-quickset': { click: function(el) { quickSet(itemId(el)); } },
  'inventory-page': { click: function(el) { changeInventoryPage(Number(el.dataset.page)); } },
  'inventory-menu-open': { click: function(el, event) { openInventoryActionMenu(el, event); } },
  'inventory-menu-edit': { click: function(el) { openEditModal(itemId(el)); closeInventoryActionMenus(); } },
  'inventory-menu-transfer': { click: function(el) { openTransferModal(itemId(el)); closeInventoryActionMenus(); } },
  'inventory-menu-delete': { click: function(el) { deleteItem(itemId(el)); closeInventoryActionMenus(); } },
  'inventory-status-list': { click: function(el) { showInventoryStatusList(el.dataset.type); } },
  'inventory-status-close': { click: function() { closeInventoryStatusModal(); } },
  'inventory-status-edit': { click: function(el) { closeInventoryStatusModal(); openEditModal(itemId(el)); } },
  'inventory-photo-upload': { change: function(el) { uploadItemPhoto(itemId(el), el); } },
  'inventory-photo-delete': { click: function(el) { deleteItemPhoto(itemId(el)); } },
  'inventory-kit-photo-preview': { change: function(el) { _previewKitPhoto(el); } },
  'inventory-kit-photo-delete': { click: function(el) { deleteKitPhoto(Number(el.dataset.kitId), itemId(el)); } },
  'inventory-similar-edit': { click: function(el, event) { event.preventDefault(); goEditSimilar(itemId(el)); } },
  'inventory-location-adjust': { click: function(el) { queueStockLocationAdjustment(Number(el.dataset.itemId), Number(el.dataset.stockId)); } },
};

const delegate = createActionDelegate('inventory-', INVENTORY_ACTIONS);

/** 測試入口：直接分派一個（模擬的）事件。 */
export const handleInventoryEvent = delegate.handle;

export const initInventoryDispatch = delegate.init;
