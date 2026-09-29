// index.html 的進入點（issue #39）：載入本頁需要的模組、把 inline handler 用的命名空間掛到 window，
// 並依原本 <script> 的載入順序執行各模組的初始化。
import { QuotationUploads } from '../features/upload-list/quotation-upload.js';
import { SignedReports } from '../features/upload-list/signed-reports.js';
import { _previewKitPhoto, closePhotoLightbox, deleteItemPhoto, deleteKitPhoto, goEditSimilar, initInventoryPhoto, openPhotoLightbox, uploadItemPhoto } from '../features/inventory/photo.js';
import { ackPasswordExpiry, expiryGoChangePw } from '../features/account/password-expiry.js';
import { addAddStockRow, openAddModal, removeAddStockRow, submitAdd } from '../features/inventory/add-modal.js';
import { addEditStockRow, deleteEditStockRow, openEditModal, submitEdit } from '../features/inventory/edit-modal.js';
import { addKitCompRow, addKitLocationRow, openKitModal, removeKitCompRow, removeKitLocationRow, submitKit, submitKitEdit } from '../features/kits/kit-modal.js';
import { assembleKit, deleteKit, disassembleKit, editKit, filterKitSearch, initKitsPage, kitCompQtyChanged, openKitSearch, openKitSheet, pickKitItem, renderKits, showKitStatusList } from '../features/kits/page.js';
import { calAddSvc, calDelSvc, calSetColor, calSetTab, calUpdSvc, calUpdSvcActive } from '../features/calendar/settings-modal.js';
import { calChangeMonth, calExport, calPickDate, calPickToday, calRetryLoad, calShiftDay } from '../features/calendar/view.js';
import { calClearSearch, calJumpToDate, calSearch } from '../features/calendar/search.js';
import { calDeleteAppt, calOpenAppt, calRetryMySync, calRetryTeamMember, calRetryTeamSync, calShowSyncError, calShowTeamSyncDetails, calSubmitAppt, closeCalModal } from '../features/calendar/appt-modal.js';
import { calcDiff, markChanged, renderStocktake, setStocktakeValue, showStocktakeList, submitStocktake, switchStocktakeTab } from '../features/stocktake/page.js';
import { cancelBatch, closeBatchConfirm, selectAllStocks, showBatchConfirm, submitBatchLocation, toggleBatchMode, toggleStockSelect } from '../features/inventory/batch-location.js';
import { cancelStockLocationPicker, queueStockLocationAdjustment } from '../features/inventory/location-adjustments.js';
import { changeInventoryPage } from '../features/shell/data-refresh.js';
import { changeQty, quickSet, saveAll } from '../features/inventory/adjust.js';
import { clearFilterPanel, initInventoryFilters, toggleFilterCollapse, toggleInventoryBrand, toggleInventoryCategory } from '../features/inventory/filters.js';
import { clearPrepared, openPreparedSheet, renderPrepared, toggleKitSubItems } from '../features/prepared/page.js';
import { clearSearchAutofill, closeSidebar, initShellApp, switchSite, switchTab, toggleAvatarMenu, toggleSidebar } from '../features/shell/app.js';
import { clearStockoutFilters, deleteStockoutRecord, openStockoutSheet, renderStockOuts, setStockoutFilter } from '../features/stockout/page.js';
import { closeInventoryActionMenus, closeMoreActions, deleteItem, initInventoryActions, openInventoryActionMenu, openItemSheet, toggleMoreActions } from '../features/inventory/actions.js';
import { closeInventoryExportDialog, initInventoryExportDialog, openInventoryExportDialog, submitInventoryExport, syncInventoryExportAllSites, toggleInventoryExportSites } from '../features/inventory/export-dialog.js';
import { closeInventoryStatusModal, showInventoryStatusList } from '../features/inventory/status.js';
import { closeKitExportDialog, initKitsExportDialog, openKitExportDialog, submitKitExport } from '../features/kits/export-dialog.js';
import { closeModal, initUtils } from '../core/utils.js';
import { closeNotif, initNotifications, toggleNotif } from '../features/notifications/center.js';
import { closeStockoutExportDialog, initStockoutExportDialog, openStockoutExportDialog, submitStockoutExport } from '../features/stockout/export-dialog.js';
import { closeTransferModal, openTransferModal, submitTransfer } from '../features/inventory/transfer-modal.js';
import { cpwCheckMatch, cpwCheckStrength, openChangePwModal, submitChangePw } from '../features/account/change-password.js';
import { deleteStockoutReturn, openEditStockoutModal, openEditStockoutReturnModal, openKitPrepareModal, openNonStockOutModal, openNonStockPrepareModal, openOutModal, openPrepareModal, openPreparedEditModal, openPreparedOutModal, returnPrepared, returnStockout, submitEditStockout, submitNonStockOut, submitNonStockPrepare, submitPrepare, submitPreparedEdit, submitPreparedOut, submitReturnStockout, submitStockOut } from '../features/stockout/modals.js';
import { engAddCategory, engAddDetail, engAddReceipt, engCloseModal, engDeleteCategory, engDeleteDetail, engDeleteGroup, engDeleteReceipt, engFilenamePreview, engGotoStep, engSave, engSelectCategory, engSetNameFromSelect, engToggleEditorReceipt, pcChooseReportType, pcOpenEngineeringModal } from '../features/petty-cash/engineering-modal.js';
import { engToggle, pcChangePage, pcCloseMoreMenuFromAction, pcDelete, pcExport, pcLoadHistory, pcOpenDetail, pcQuickRange, pcResetFilter, renderPettyCash } from '../features/petty-cash/page.js';
import { filterUnitSelect, openUnitQuickAdd } from '../core/units.js';
import { initBottomsheet } from '../core/bottomsheet.js';
import { appState } from '../core/state.js';
import { initQuotationPage, quoteAddItem, quoteCloseInventory, quoteDelete, quoteDownload, quoteEdit, quoteLoadHistory, quoteOpenInventory, quoteReset, quoteSave, quoteSearchInventory, quoteSwitchMode, quoteUseInventory } from '../features/quotation/page.js';
import { initSession, logout } from '../core/session.js';
import { initWorkProgressGallery, wprCloseGallery, wprClosePendingGallery, wprGalleryMove, wprOpenGallery, wprOpenPendingGallery, wprPendingGalleryMove } from '../features/work-progress/gallery.js';
import { pcCloseEntryModal, pcCloseReportModal, pcEntryAddItemRow, pcEntryAmountHint, pcEntryDelete, pcEntryRemoveItem, pcEntrySave, pcEntrySetType, pcFetchPreviousBalance, pcGeneralCategoryChanged, pcModalGotoStep, pcModalSave, pcOpenEntryModal, pcOpenReportModal, pcOpeningEdited, pcUpdateFilenamePreview, pcUploaderChanged } from '../features/petty-cash/report-modal.js';
import { qtydQuick, setQtyDialogMode, submitQtyDialog } from '../features/inventory/qty-dialog.js';
import { setInventoryView, toggleLoc } from '../features/inventory/list.js';
import { setSharedStatusListLocation, setSharedStatusListSearch } from '../components/status-list.js';
import { wprAddExistingPhotos, wprBatchDeletePhotos, wprClearPhotoSelection, wprDeleteReport, wprEditReport, wprOpenHistoryDetail, wprSelectAllPhotoSelection, wprTogglePhotoManage, wprTogglePhotoSelection } from '../features/work-progress/detail.js';
import { wprAddPendingFiles, wprRemovePending, wprSubmit } from '../features/work-progress/upload.js';
import { wprCloseLeaveConfirmation, wprDiscardAndLeave } from '../features/work-progress/draft.js';
import { wprHandleDateChange, wprHistoryToggled, wprSelectJob, wprUpdateNoteCount } from '../features/work-progress/page.js';
import { wprLoadHistory, wprQuickRange, wprResetFilter } from '../features/work-progress/history.js';

// 除錯 / 自動化測試入口（瀏覽器 console、Playwright）：依模組路徑取用本頁模組；正式程式碼不得依賴
import * as m0 from '../components/card.js';
import * as m1 from '../components/status-list.js';
import * as m2 from '../core/api-client.js';
import * as m3 from '../core/bottomsheet.js';
import * as m4 from '../core/data.js';
import * as m5 from '../core/qty.js';
import * as m6 from '../core/search.js';
import * as m7 from '../core/session.js';
import * as m8 from '../core/site-label.js';
import * as m9 from '../core/state.js';
import * as m10 from '../core/units.js';
import * as m11 from '../core/utils.js';
import * as m12 from '../features/account/change-password.js';
import * as m13 from '../features/account/password-expiry.js';
import * as m14 from '../features/calendar/appt-modal.js';
import * as m15 from '../features/calendar/format.js';
import * as m16 from '../features/calendar/search.js';
import * as m17 from '../features/calendar/settings-modal.js';
import * as m18 from '../features/calendar/state.js';
import * as m19 from '../features/calendar/sync-status.js';
import * as m20 from '../features/calendar/view.js';
import * as m21 from '../features/inventory/actions.js';
import * as m22 from '../features/inventory/add-modal.js';
import * as m23 from '../features/inventory/adjust.js';
import * as m24 from '../features/inventory/batch-location.js';
import * as m25 from '../features/inventory/edit-modal.js';
import * as m26 from '../features/inventory/export-dialog.js';
import * as m27 from '../features/inventory/filters.js';
import * as m28 from '../features/inventory/list.js';
import * as m29 from '../features/inventory/location-adjustments.js';
import * as m30 from '../features/inventory/photo.js';
import * as m31 from '../features/inventory/qty-dialog.js';
import * as m32 from '../features/inventory/state.js';
import * as m33 from '../features/inventory/status.js';
import * as m34 from '../features/inventory/transfer-modal.js';
import * as m35 from '../features/kits/export-dialog.js';
import * as m36 from '../features/kits/kit-modal.js';
import * as m37 from '../features/kits/page.js';
import * as m38 from '../features/kits/state.js';
import * as m39 from '../features/notifications/center.js';
import * as m40 from '../features/petty-cash/engineering-modal.js';
import * as m41 from '../features/petty-cash/page.js';
import * as m42 from '../features/petty-cash/report-modal.js';
import * as m43 from '../features/petty-cash/state.js';
import * as m44 from '../features/prepared/page.js';
import * as m45 from '../features/quotation/page.js';
import * as m46 from '../features/shell/app.js';
import * as m47 from '../features/shell/data-refresh.js';
import * as m48 from '../features/stockout/export-dialog.js';
import * as m49 from '../features/stockout/modals.js';
import * as m50 from '../features/stockout/page.js';
import * as m51 from '../features/stockout/state.js';
import * as m52 from '../features/stocktake/page.js';
import * as m53 from '../features/stocktake/state.js';
import * as m54 from '../features/upload-list/quotation-upload.js';
import * as m55 from '../features/upload-list/signed-reports.js';
import * as m56 from '../features/upload-list/upload-list.js';
import * as m57 from '../features/work-progress/detail.js';
import * as m58 from '../features/work-progress/draft.js';
import * as m59 from '../features/work-progress/format.js';
import * as m60 from '../features/work-progress/gallery.js';
import * as m61 from '../features/work-progress/history.js';
import * as m62 from '../features/work-progress/page.js';
import * as m63 from '../features/work-progress/state.js';
import * as m64 from '../features/work-progress/upload.js';

window.Account = { ackPasswordExpiry, cpwCheckMatch, cpwCheckStrength, expiryGoChangePw, openChangePwModal, submitChangePw };
window.App = { clearSearchAutofill, closeSidebar, switchSite, switchTab, toggleAvatarMenu, toggleSidebar };
window.Auth = { logout };
window.Calendar = { calAddSvc, calChangeMonth, calClearSearch, calDelSvc, calDeleteAppt, calExport, calJumpToDate, calOpenAppt, calPickDate, calPickToday, calRetryLoad, calRetryMySync, calRetryTeamMember, calRetryTeamSync, calSearch, calSetColor, calSetTab, calShiftDay, calShowSyncError, calShowTeamSyncDetails, calSubmitAppt, calUpdSvc, calUpdSvcActive, closeCalModal };
window.Components = { setSharedStatusListLocation, setSharedStatusListSearch };
window.Core = { filterUnitSelect, openUnitQuickAdd };
window.Data = { changeInventoryPage };
window.Inventory = { _previewKitPhoto, addAddStockRow, addEditStockRow, cancelBatch, cancelStockLocationPicker, changeQty, clearFilterPanel, closeBatchConfirm, closeInventoryActionMenus, closeInventoryExportDialog, closeInventoryStatusModal, closeMoreActions, closePhotoLightbox, closeTransferModal, deleteEditStockRow, deleteItem, deleteItemPhoto, deleteKitPhoto, goEditSimilar, openAddModal, openEditModal, openInventoryActionMenu, openInventoryExportDialog, openItemSheet, openPhotoLightbox, openTransferModal, qtydQuick, queueStockLocationAdjustment, quickSet, removeAddStockRow, saveAll, selectAllStocks, setInventoryView, setQtyDialogMode, showBatchConfirm, showInventoryStatusList, submitAdd, submitBatchLocation, submitEdit, submitInventoryExport, submitQtyDialog, submitTransfer, syncInventoryExportAllSites, toggleBatchMode, toggleFilterCollapse, toggleInventoryBrand, toggleInventoryCategory, toggleInventoryExportSites, toggleLoc, toggleMoreActions, toggleStockSelect, uploadItemPhoto };
window.Kits = { addKitCompRow, addKitLocationRow, assembleKit, closeKitExportDialog, deleteKit, disassembleKit, editKit, filterKitSearch, kitCompQtyChanged, openKitExportDialog, openKitModal, openKitSearch, openKitSheet, pickKitItem, removeKitCompRow, removeKitLocationRow, renderKits, showKitStatusList, submitKit, submitKitEdit, submitKitExport };
window.Notifications = { closeNotif, toggleNotif };
window.PettyCash = { engAddCategory, engAddDetail, engAddReceipt, engCloseModal, engDeleteCategory, engDeleteDetail, engDeleteGroup, engDeleteReceipt, engFilenamePreview, engGotoStep, engSave, engSelectCategory, engSetNameFromSelect, engToggle, engToggleEditorReceipt, pcChangePage, pcChooseReportType, pcCloseEntryModal, pcCloseMoreMenuFromAction, pcCloseReportModal, pcDelete, pcEntryAddItemRow, pcEntryAmountHint, pcEntryDelete, pcEntryRemoveItem, pcEntrySave, pcEntrySetType, pcExport, pcFetchPreviousBalance, pcGeneralCategoryChanged, pcLoadHistory, pcModalGotoStep, pcModalSave, pcOpenDetail, pcOpenEngineeringModal, pcOpenEntryModal, pcOpenReportModal, pcOpeningEdited, pcQuickRange, pcResetFilter, pcUpdateFilenamePreview, pcUploaderChanged, renderPettyCash };
window.Prepared = { clearPrepared, openPreparedSheet, renderPrepared, toggleKitSubItems };
window.Quotation = { quoteAddItem, quoteCloseInventory, quoteDelete, quoteDownload, quoteEdit, quoteLoadHistory, quoteOpenInventory, quoteReset, quoteSave, quoteSearchInventory, quoteSwitchMode, quoteUseInventory };
window.Stockout = { clearStockoutFilters, closeStockoutExportDialog, deleteStockoutRecord, deleteStockoutReturn, openEditStockoutModal, openEditStockoutReturnModal, openKitPrepareModal, openNonStockOutModal, openNonStockPrepareModal, openOutModal, openPrepareModal, openPreparedEditModal, openPreparedOutModal, openStockoutExportDialog, openStockoutSheet, renderStockOuts, returnPrepared, returnStockout, setStockoutFilter, submitEditStockout, submitNonStockOut, submitNonStockPrepare, submitPrepare, submitPreparedEdit, submitPreparedOut, submitReturnStockout, submitStockOut, submitStockoutExport };
window.Stocktake = { calcDiff, markChanged, renderStocktake, setStocktakeValue, showStocktakeList, submitStocktake, switchStocktakeTab };
window.UI = { closeModal };
window.WorkProgress = { wprAddExistingPhotos, wprAddPendingFiles, wprBatchDeletePhotos, wprClearPhotoSelection, wprCloseGallery, wprCloseLeaveConfirmation, wprClosePendingGallery, wprDeleteReport, wprDiscardAndLeave, wprEditReport, wprGalleryMove, wprHandleDateChange, wprHistoryToggled, wprLoadHistory, wprOpenGallery, wprOpenHistoryDetail, wprOpenPendingGallery, wprPendingGalleryMove, wprQuickRange, wprRemovePending, wprResetFilter, wprSelectAllPhotoSelection, wprSelectJob, wprSubmit, wprTogglePhotoManage, wprTogglePhotoSelection, wprUpdateNoteCount };
window.SignedReports = SignedReports;  // 上傳清單控制器：inline handler 以 SignedReports.method() 呼叫
window.QuotationUploads = QuotationUploads;  // 上傳清單控制器：inline handler 以 QuotationUploads.method() 呼叫
window.__hvac = Object.freeze({
  'components/card.js': m0,
  'components/status-list.js': m1,
  'core/api-client.js': m2,
  'core/bottomsheet.js': m3,
  'core/data.js': m4,
  'core/qty.js': m5,
  'core/search.js': m6,
  'core/session.js': m7,
  'core/site-label.js': m8,
  'core/state.js': m9,
  'core/units.js': m10,
  'core/utils.js': m11,
  'features/account/change-password.js': m12,
  'features/account/password-expiry.js': m13,
  'features/calendar/appt-modal.js': m14,
  'features/calendar/format.js': m15,
  'features/calendar/search.js': m16,
  'features/calendar/settings-modal.js': m17,
  'features/calendar/state.js': m18,
  'features/calendar/sync-status.js': m19,
  'features/calendar/view.js': m20,
  'features/inventory/actions.js': m21,
  'features/inventory/add-modal.js': m22,
  'features/inventory/adjust.js': m23,
  'features/inventory/batch-location.js': m24,
  'features/inventory/edit-modal.js': m25,
  'features/inventory/export-dialog.js': m26,
  'features/inventory/filters.js': m27,
  'features/inventory/list.js': m28,
  'features/inventory/location-adjustments.js': m29,
  'features/inventory/photo.js': m30,
  'features/inventory/qty-dialog.js': m31,
  'features/inventory/state.js': m32,
  'features/inventory/status.js': m33,
  'features/inventory/transfer-modal.js': m34,
  'features/kits/export-dialog.js': m35,
  'features/kits/kit-modal.js': m36,
  'features/kits/page.js': m37,
  'features/kits/state.js': m38,
  'features/notifications/center.js': m39,
  'features/petty-cash/engineering-modal.js': m40,
  'features/petty-cash/page.js': m41,
  'features/petty-cash/report-modal.js': m42,
  'features/petty-cash/state.js': m43,
  'features/prepared/page.js': m44,
  'features/quotation/page.js': m45,
  'features/shell/app.js': m46,
  'features/shell/data-refresh.js': m47,
  'features/stockout/export-dialog.js': m48,
  'features/stockout/modals.js': m49,
  'features/stockout/page.js': m50,
  'features/stockout/state.js': m51,
  'features/stocktake/page.js': m52,
  'features/stocktake/state.js': m53,
  'features/upload-list/quotation-upload.js': m54,
  'features/upload-list/signed-reports.js': m55,
  'features/upload-list/upload-list.js': m56,
  'features/work-progress/detail.js': m57,
  'features/work-progress/draft.js': m58,
  'features/work-progress/format.js': m59,
  'features/work-progress/gallery.js': m60,
  'features/work-progress/history.js': m61,
  'features/work-progress/page.js': m62,
  'features/work-progress/state.js': m63,
  'features/work-progress/upload.js': m64,
});

initSession();
initUtils();
initInventoryExportDialog();
initKitsExportDialog();
initStockoutExportDialog();
initInventoryActions();
initInventoryFilters();
initKitsPage();
initWorkProgressGallery();
initQuotationPage();
initInventoryPhoto();
initBottomsheet(() => switchTab(appState.currentTab));
initNotifications();
initShellApp();
