// 零用金頁的事件委派（data-action="pc-*" / "eng-*"）。標記只寫 data-action 與 data-*，不掛 window.PettyCash。
// 本檔只由 pages/main.js 載入（它 import 本 feature 的各模組，沒有其他模組 import 它）。

import { createActionDelegate } from '../../core/actions.js';
import {
  engAddCategory, engAddDetail, engAddReceipt, engCloseModal, engDeleteCategory, engDeleteDetail, engDeleteGroup,
  engDeleteReceipt, engFilenamePreview, engGotoStep, engSave, engSelectCategory, engSetNameFromSelect,
  engToggleEditorReceipt, pcChooseReportType, pcOpenEngineeringModal,
} from './engineering-modal.js';
import {
  engToggle, pcChangePage, pcCloseMoreMenuFromAction, pcDelete, pcExport, pcLoadHistory, pcOpenDetail, pcQuickRange,
  pcResetFilter, renderPettyCash,
} from './page.js';
import {
  pcCloseEntryModal, pcCloseReportModal, pcEntryAddItemRow, pcEntryAmountHint, pcEntryDelete, pcEntryRemoveItem,
  pcEntrySave, pcEntrySetType, pcFetchPreviousBalance, pcGeneralCategoryChanged, pcModalGotoStep, pcModalSave,
  pcOpenEntryModal, pcOpenReportModal, pcOpeningEdited, pcUpdateFilenamePreview, pcUploaderChanged,
} from './report-modal.js';

const num = function(value) { return Number(value); };
const ci = function(el) { return num(el.dataset.ci); };
const gi = function(el) { return num(el.dataset.gi); };
const ri = function(el) { return num(el.dataset.ri); };
const entryIndex = function(el) { return el.dataset.index === undefined ? undefined : num(el.dataset.index); };

/** 報表列 / 卡片 / 詳情頁上的單筆報表操作（op 對應 page.js 的 pcReportActionEntries）。 */
function runReportOp(el) {
  const id = num(el.dataset.id);
  switch (el.dataset.op) {
    case 'detail': pcOpenDetail(id); break;
    case 'export': pcExport(id); break;
    case 'edit-report': pcOpenReportModal(id); break;
    case 'edit-engineering': pcOpenEngineeringModal(id); break;
    case 'delete': pcDelete(id, el.dataset.back === '1' ? true : undefined); break;
  }
}

const PC_ACTIONS = {
  // 列表頁
  'pc-choose-type': { click: function() { pcChooseReportType(); } },
  'pc-search': { click: function() { pcLoadHistory(true); } },
  'pc-reset-filter': { click: function() { pcResetFilter(); } },
  'pc-range': { click: function(el) { pcQuickRange(el.dataset.range, el); } },
  'pc-page': { click: function(el) { pcChangePage(num(el.dataset.delta)); } },
  'pc-back-to-list': { click: function() { renderPettyCash(); } },
  // 點到這些容器內部（更多選單、行動版操作列）不要觸發外層卡片的「檢視」
  'pc-noop': { click: function() {} },
  'pc-report-op': { click: function(el) { runReportOp(el); } },
  'pc-menu-op': { click: function(el) { pcCloseMoreMenuFromAction(el); runReportOp(el); } },
  'pc-eng-toggle': { click: function(el) { engToggle(el.dataset.kind, el.dataset.key); } },
  // 新增報表：選擇類型
  'pc-type-overlay-close': { click: function() { document.getElementById('eng-type-overlay').remove(); } },
  'pc-type-choose': {
    click: function(el) {
      document.getElementById('eng-type-overlay').remove();
      if (el.dataset.type === 'engineering') pcOpenEngineeringModal(); else pcOpenReportModal();
    },
  },
  // 一般零用金月報 modal
  'pc-report-modal-backdrop': { click: function(el, event) { if (event.target === el) pcCloseReportModal(); } },
  'pc-report-modal-close': { click: function() { pcCloseReportModal(); } },
  'pc-modal-step': { click: function(el) { pcModalGotoStep(num(el.dataset.step)); } },
  'pc-filename-preview': { input: function() { pcUpdateFilenamePreview(); } },
  'pc-uploader-changed': { input: function() { pcUploaderChanged(); } },
  'pc-opening-edited': { input: function() { pcOpeningEdited(); } },
  'pc-fetch-previous-balance': { click: function() { pcFetchPreviousBalance(); } },
  'pc-modal-save': { click: function(el) { pcModalSave(el.dataset.status); } },
  'pc-collapse-toggle': { click: function(el) { el.parentElement.classList.toggle('is-collapsed'); } },
  // 收支明細
  'pc-entry-open': {
    click: function(el) { pcOpenEntryModal(entryIndex(el)); },
    keydown: function(el, event) { if (event.key === 'Enter' || event.key === ' ') pcOpenEntryModal(entryIndex(el)); },
  },
  'pc-entry-delete': { click: function(el) { pcEntryDelete(entryIndex(el)); } },
  'pc-entry-modal-backdrop': { click: function(el, event) { if (event.target === el) pcCloseEntryModal(); } },
  'pc-entry-modal-close': { click: function() { pcCloseEntryModal(); } },
  'pc-entry-type': { click: function(el) { pcEntrySetType(el.dataset.type); } },
  'pc-general-category': { change: function(el) { pcGeneralCategoryChanged(el); } },
  'pc-entry-amount-hint': { input: function() { pcEntryAmountHint(); } },
  'pc-entry-add-item': { click: function() { pcEntryAddItemRow(); } },
  'pc-entry-save': { click: function() { pcEntrySave(); } },
  'pc-entry-remove-item': { click: function(el) { pcEntryRemoveItem(entryIndex(el)); } },
  // 工程零用金 modal
  'eng-modal-backdrop': { click: function(el, event) { if (event.target === el) engCloseModal(); } },
  'eng-modal-close': { click: function() { engCloseModal(); } },
  'eng-step': { click: function(el) { engGotoStep(num(el.dataset.step)); } },
  'eng-filename-preview': { input: function() { engFilenamePreview(); } },
  'eng-save': { click: function(el) { engSave(el.dataset.status); } },
  'eng-select-category': { click: function(el) { engSelectCategory(ci(el)); } },
  'eng-add-category': { click: function() { engAddCategory(); } },
  'eng-delete-category': { click: function(el) { engDeleteCategory(ci(el)); } },
  'eng-name-select': {
    change: function(el) {
      if (el.dataset.kind === 'group') engSetNameFromSelect(el, 'group', ci(el), gi(el));
      else engSetNameFromSelect(el, 'category', ci(el));
    },
  },
  'eng-add-receipt': { click: function(el) { engAddReceipt(ci(el), gi(el)); } },
  'eng-delete-group': { click: function(el) { engDeleteGroup(ci(el), gi(el)); } },
  'eng-toggle-editor-receipt': { click: function(el) { engToggleEditorReceipt(ci(el), gi(el), ri(el)); } },
  'eng-delete-receipt': { click: function(el) { engDeleteReceipt(ci(el), gi(el), ri(el)); } },
  'eng-add-detail': { click: function(el) { engAddDetail(ci(el), gi(el), ri(el)); } },
  'eng-delete-detail': { click: function(el) { engDeleteDetail(ci(el), gi(el), ri(el), num(el.dataset.di)); } },
};

const pcDelegate = createActionDelegate('pc-', PC_ACTIONS);
const engDelegate = createActionDelegate('eng-', PC_ACTIONS);

/** 測試入口：直接分派一個（模擬的）事件。 */
export const handlePettyCashEvent = function(event) { return pcDelegate.handle(event) || engDelegate.handle(event); };

export function initPettyCashActions() {
  pcDelegate.init();
  engDelegate.init();
}
