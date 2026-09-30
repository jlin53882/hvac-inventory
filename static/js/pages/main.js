// index.html 的進入點（issue #39）：載入本頁需要的模組、把 inline handler 用的命名空間掛到 window，
// 並依原本 <script> 的載入順序執行各模組的初始化。
import { QuotationUploads } from '../features/upload-list/quotation-upload.js';
import { SignedReports } from '../features/upload-list/signed-reports.js';
import { initInventoryPhoto } from '../features/inventory/photo.js';
import { addEditStockRow, openEditModal, submitEdit } from '../features/inventory/edit-modal.js';
import { ackPasswordExpiry, expiryGoChangePw } from '../features/account/password-expiry.js';
import { addAddStockRow, openAddModal, submitAdd } from '../features/inventory/add-modal.js';
import { addKitCompRow, addKitLocationRow, openKitModal, submitKit, submitKitEdit } from '../features/kits/kit-modal.js';
import { editKit, initKitsPage, renderKits } from '../features/kits/page.js';
import { showKitStatusList } from '../features/kits/status.js';
import { calAddSvc, calDelSvc, calSetColor, calSetTab, calUpdSvc, calUpdSvcActive } from '../features/calendar/settings-modal.js';
import { calChangeMonth, calExport, calPickDate, calPickToday, calRetryLoad, calShiftDay, calClearSearch, calJumpToDate } from '../features/calendar/view.js';
import { calSearch } from '../features/calendar/search.js';
import { calDeleteAppt, calOpenAppt, calRetryMySync, calRetryTeamMember, calRetryTeamSync, calShowSyncError, calShowTeamSyncDetails, calSubmitAppt, closeCalModal } from '../features/calendar/appt-modal.js';
import { calcDiff, markChanged, renderStocktake, setStocktakeValue, showStocktakeList, submitStocktake, switchStocktakeTab } from '../features/stocktake/page.js';
import { cancelBatch, closeBatchConfirm, showBatchConfirm, submitBatchLocation } from '../features/inventory/batch-location.js';
import { cancelStockLocationPicker } from '../features/inventory/location-adjustments.js';
import { saveAll } from '../features/inventory/adjust.js';
import { clearFilterPanel, initInventoryFilters, toggleFilterCollapse } from '../features/inventory/filters.js';
import { renderPrepared } from '../features/prepared/page.js';
import { clearSearchAutofill, closeSidebar, configureShell, initShellApp, switchSite, switchTab, toggleAvatarMenu, toggleSidebar } from '../features/shell/app.js';
import { createActionDelegate } from '../core/actions.js';
import { initInventoryDispatch } from '../features/inventory/dispatch.js';
import { initKitsActions } from '../features/kits/actions.js';
import { initStockoutActions } from '../features/stockout/actions.js';
import { initPreparedActions } from '../features/prepared/actions.js';
import { initInventoryActions } from '../features/inventory/actions.js';
import { closeInventoryExportDialog, initInventoryExportDialog, openInventoryExportDialog, submitInventoryExport, syncInventoryExportAllSites, toggleInventoryExportSites } from '../features/inventory/export-dialog.js';
import { closeInventoryStatusModal, showInventoryStatusList } from '../features/inventory/status.js';
import { closeKitExportDialog, initKitsExportDialog, openKitExportDialog, submitKitExport } from '../features/kits/export-dialog.js';
import { closeModal, initUtils } from '../core/utils.js';
import { closeNotif, initNotifications, toggleNotif } from '../features/notifications/center.js';
import { closeStockoutExportDialog, initStockoutExportDialog, openStockoutExportDialog, submitStockoutExport } from '../features/stockout/export-dialog.js';
import { closeTransferModal, openTransferModal, submitTransfer } from '../features/inventory/transfer-modal.js';
import { cpwCheckMatch, cpwCheckStrength, openChangePwModal, submitChangePw } from '../features/account/change-password.js';
import { openKitPrepareModal, openNonStockOutModal, openNonStockPrepareModal, openOutModal, openPrepareModal, openPreparedEditModal, submitEditStockout, submitNonStockOut, submitNonStockPrepare, submitPrepare, submitPreparedEdit, submitPreparedOut, submitReturnStockout, submitStockOut } from '../features/stockout/modals.js';
import { engAddCategory, engAddDetail, engAddReceipt, engCloseModal, engDeleteCategory, engDeleteDetail, engDeleteGroup, engDeleteReceipt, engFilenamePreview, engGotoStep, engSave, engSelectCategory, engSetNameFromSelect, engToggleEditorReceipt, pcChooseReportType, pcOpenEngineeringModal } from '../features/petty-cash/engineering-modal.js';
import { engToggle, pcChangePage, pcCloseMoreMenuFromAction, pcDelete, pcExport, pcLoadHistory, pcOpenDetail, pcQuickRange, pcResetFilter, renderPettyCash } from '../features/petty-cash/page.js';
import { filterUnitSelect, openUnitQuickAdd } from '../core/units.js';
import { initBottomsheet } from '../core/bottomsheet.js';
import { appState } from '../core/state.js';
import { initQuotationPage, quoteAddItem, quoteCloseInventory, quoteDelete, quoteDownload, quoteEdit, quoteLoadHistory, quoteOpenInventory, quoteReset, quoteSave, quoteSearchInventory, quoteSwitchMode, quoteUseInventory } from '../features/quotation/page.js';
import { handleUnauthorized, logout } from '../core/session.js';
import { setUnauthorizedHandler } from '../core/api-client.js';
import { initWorkProgressGallery, wprCloseGallery, wprClosePendingGallery, wprGalleryMove, wprOpenGallery, wprOpenPendingGallery, wprPendingGalleryMove } from '../features/work-progress/gallery.js';
import { pcCloseEntryModal, pcCloseReportModal, pcEntryAddItemRow, pcEntryAmountHint, pcEntryDelete, pcEntryRemoveItem, pcEntrySave, pcEntrySetType, pcFetchPreviousBalance, pcGeneralCategoryChanged, pcModalGotoStep, pcModalSave, pcOpenEntryModal, pcOpenReportModal, pcOpeningEdited, pcUpdateFilenamePreview, pcUploaderChanged } from '../features/petty-cash/report-modal.js';
import { qtydQuick, setQtyDialogMode, submitQtyDialog } from '../features/inventory/qty-dialog.js';
import { setInventoryView } from '../features/inventory/list.js';
import { initStatusListActions } from '../components/status-list.js';
import { wprAddExistingPhotos, wprBatchDeletePhotos, wprClearPhotoSelection, wprDeleteReport, wprEditReport, wprOpenHistoryDetail, wprSelectAllPhotoSelection, wprTogglePhotoManage, wprTogglePhotoSelection } from '../features/work-progress/detail.js';
import { wprSubmit } from '../features/work-progress/upload.js';
import { wprAddPendingFiles, wprRemovePending } from '../features/work-progress/pending-photos.js';
import { wprCloseLeaveConfirmation, wprDiscardAndLeave, wprUpdateNoteCount } from '../features/work-progress/draft.js';
import { wprHandleDateChange, wprHistoryToggled, wprSelectJob } from '../features/work-progress/page.js';
import { wprLoadHistory, wprQuickRange, wprResetFilter } from '../features/work-progress/history.js';

// 除錯 / 自動化測試入口（瀏覽器 console、Playwright）：依模組路徑取用本頁模組；正式程式碼不得依賴
import * as m0 from '../components/card.js';
import * as m1 from '../components/status-list.js';
import * as m2 from '../core/actions.js';
import * as m3 from '../core/api-client.js';
import * as m4 from '../core/bottomsheet.js';
import * as m5 from '../core/data.js';
import * as m6 from '../core/inventory-read-model.js';
import * as m7 from '../core/qty.js';
import * as m8 from '../core/request-guard.js';
import * as m9 from '../core/search.js';
import * as m10 from '../core/session.js';
import * as m11 from '../core/shared-read-model.js';
import * as m12 from '../core/site-label.js';
import * as m13 from '../core/state.js';
import * as m14 from '../core/units.js';
import * as m15 from '../core/utils.js';
import * as m16 from '../features/account/change-password.js';
import * as m17 from '../features/account/password-expiry.js';
import * as m18 from '../features/calendar/appt-modal.js';
import * as m19 from '../features/calendar/format.js';
import * as m20 from '../features/calendar/page.js';
import * as m21 from '../features/calendar/search.js';
import * as m22 from '../features/calendar/settings-modal.js';
import * as m23 from '../features/calendar/state.js';
import * as m24 from '../features/calendar/sync-status.js';
import * as m25 from '../features/calendar/view.js';
import * as m26 from '../features/inventory/actions.js';
import * as m27 from '../features/inventory/add-modal.js';
import * as m28 from '../features/inventory/adjust.js';
import * as m29 from '../features/inventory/batch-location.js';
import * as m30 from '../features/inventory/dispatch.js';
import * as m31 from '../features/inventory/edit-modal.js';
import * as m32 from '../features/inventory/export-dialog.js';
import * as m33 from '../features/inventory/filters.js';
import * as m34 from '../features/inventory/list.js';
import * as m35 from '../features/inventory/location-adjustments.js';
import * as m36 from '../features/inventory/photo.js';
import * as m37 from '../features/inventory/qty-dialog.js';
import * as m38 from '../features/inventory/state.js';
import * as m39 from '../features/inventory/status.js';
import * as m40 from '../features/inventory/transfer-modal.js';
import * as m41 from '../features/kits/actions.js';
import * as m42 from '../features/kits/component-rows.js';
import * as m43 from '../features/kits/export-dialog.js';
import * as m44 from '../features/kits/kit-modal.js';
import * as m45 from '../features/kits/page.js';
import * as m46 from '../features/kits/state.js';
import * as m47 from '../features/kits/status.js';
import * as m48 from '../features/notifications/center.js';
import * as m49 from '../features/petty-cash/engineering-modal.js';
import * as m50 from '../features/petty-cash/page.js';
import * as m51 from '../features/petty-cash/report-modal.js';
import * as m52 from '../features/petty-cash/state.js';
import * as m53 from '../features/prepared/actions.js';
import * as m54 from '../features/prepared/page.js';
import * as m55 from '../features/prepared/sheet.js';
import * as m56 from '../features/quotation/mode-tabs.js';
import * as m57 from '../features/quotation/page.js';
import * as m58 from '../features/shell/app.js';
import * as m59 from '../features/shell/data-refresh.js';
import * as m60 from '../features/shell/navigation.js';
import * as m61 from '../features/shell/page-scope.js';
import * as m62 from '../features/shell/state.js';
import * as m63 from '../features/stockout/actions.js';
import * as m64 from '../features/stockout/export-dialog.js';
import * as m65 from '../features/stockout/modals.js';
import * as m66 from '../features/stockout/page.js';
import * as m67 from '../features/stockout/sheet.js';
import * as m68 from '../features/stockout/state.js';
import * as m69 from '../features/stocktake/page.js';
import * as m70 from '../features/stocktake/state.js';
import * as m71 from '../features/upload-list/quotation-upload.js';
import * as m72 from '../features/upload-list/signed-reports.js';
import * as m73 from '../features/upload-list/upload-list.js';
import * as m74 from '../features/work-progress/day.js';
import * as m75 from '../features/work-progress/detail.js';
import * as m76 from '../features/work-progress/draft.js';
import * as m77 from '../features/work-progress/format.js';
import * as m78 from '../features/work-progress/gallery.js';
import * as m79 from '../features/work-progress/history.js';
import * as m80 from '../features/work-progress/page.js';
import * as m81 from '../features/work-progress/pending-photos.js';
import * as m82 from '../features/work-progress/photo-upload.js';
import * as m83 from '../features/work-progress/state.js';
import * as m84 from '../features/work-progress/upload.js';

window.Account = { ackPasswordExpiry, cpwCheckMatch, cpwCheckStrength, expiryGoChangePw, openChangePwModal, submitChangePw };
window.App = { closeSidebar, switchSite, switchTab, toggleAvatarMenu, toggleSidebar };
window.Auth = { logout };
window.Calendar = { calAddSvc, calChangeMonth, calClearSearch, calDelSvc, calDeleteAppt, calExport, calJumpToDate, calOpenAppt, calPickDate, calPickToday, calRetryLoad, calRetryMySync, calRetryTeamMember, calRetryTeamSync, calSearch, calSetColor, calSetTab, calShiftDay, calShowSyncError, calShowTeamSyncDetails, calSubmitAppt, calUpdSvc, calUpdSvcActive, closeCalModal };
window.Components = {  };
window.Core = { filterUnitSelect, openUnitQuickAdd };
window.Data = {  };
window.Inventory = { addAddStockRow, addEditStockRow, cancelBatch, cancelStockLocationPicker, clearFilterPanel, closeBatchConfirm, closeInventoryExportDialog, closeInventoryStatusModal, closeTransferModal, openAddModal, openEditModal, openInventoryExportDialog, openTransferModal, qtydQuick, saveAll, setInventoryView, setQtyDialogMode, showBatchConfirm, showInventoryStatusList, submitAdd, submitBatchLocation, submitEdit, submitInventoryExport, submitQtyDialog, submitTransfer, syncInventoryExportAllSites, toggleFilterCollapse, toggleInventoryExportSites };
window.Kits = { addKitCompRow, addKitLocationRow, closeKitExportDialog, editKit, openKitExportDialog, openKitModal, showKitStatusList, submitKit, submitKitEdit, submitKitExport };
window.Notifications = { closeNotif, toggleNotif };
window.PettyCash = { engAddCategory, engAddDetail, engAddReceipt, engCloseModal, engDeleteCategory, engDeleteDetail, engDeleteGroup, engDeleteReceipt, engFilenamePreview, engGotoStep, engSave, engSelectCategory, engSetNameFromSelect, engToggle, engToggleEditorReceipt, pcChangePage, pcChooseReportType, pcCloseEntryModal, pcCloseMoreMenuFromAction, pcCloseReportModal, pcDelete, pcEntryAddItemRow, pcEntryAmountHint, pcEntryDelete, pcEntryRemoveItem, pcEntrySave, pcEntrySetType, pcExport, pcFetchPreviousBalance, pcGeneralCategoryChanged, pcLoadHistory, pcModalGotoStep, pcModalSave, pcOpenDetail, pcOpenEngineeringModal, pcOpenEntryModal, pcOpenReportModal, pcOpeningEdited, pcQuickRange, pcResetFilter, pcUpdateFilenamePreview, pcUploaderChanged, renderPettyCash };
window.Prepared = { renderPrepared };
window.Quotation = { quoteAddItem, quoteCloseInventory, quoteDelete, quoteDownload, quoteEdit, quoteLoadHistory, quoteOpenInventory, quoteReset, quoteSave, quoteSearchInventory, quoteSwitchMode, quoteUseInventory };
window.Stockout = { closeStockoutExportDialog, openKitPrepareModal, openNonStockOutModal, openNonStockPrepareModal, openOutModal, openPrepareModal, openPreparedEditModal, openStockoutExportDialog, submitEditStockout, submitNonStockOut, submitNonStockPrepare, submitPrepare, submitPreparedEdit, submitPreparedOut, submitReturnStockout, submitStockOut, submitStockoutExport };
window.Stocktake = { calcDiff, markChanged, renderStocktake, setStocktakeValue, showStocktakeList, submitStocktake, switchStocktakeTab };
window.UI = { closeModal };
window.WorkProgress = { wprAddExistingPhotos, wprAddPendingFiles, wprBatchDeletePhotos, wprClearPhotoSelection, wprCloseGallery, wprCloseLeaveConfirmation, wprClosePendingGallery, wprDeleteReport, wprDiscardAndLeave, wprEditReport, wprGalleryMove, wprHandleDateChange, wprHistoryToggled, wprLoadHistory, wprOpenGallery, wprOpenHistoryDetail, wprOpenPendingGallery, wprPendingGalleryMove, wprQuickRange, wprRemovePending, wprResetFilter, wprSelectAllPhotoSelection, wprSelectJob, wprSubmit, wprTogglePhotoManage, wprTogglePhotoSelection, wprUpdateNoteCount };
window.SignedReports = SignedReports;  // 上傳清單控制器：inline handler 以 SignedReports.method() 呼叫
window.QuotationUploads = QuotationUploads;  // 上傳清單控制器：inline handler 以 QuotationUploads.method() 呼叫
window.__hvac = Object.freeze({
  'components/card.js': m0,
  'components/status-list.js': m1,
  'core/actions.js': m2,
  'core/api-client.js': m3,
  'core/bottomsheet.js': m4,
  'core/data.js': m5,
  'core/inventory-read-model.js': m6,
  'core/qty.js': m7,
  'core/request-guard.js': m8,
  'core/search.js': m9,
  'core/session.js': m10,
  'core/shared-read-model.js': m11,
  'core/site-label.js': m12,
  'core/state.js': m13,
  'core/units.js': m14,
  'core/utils.js': m15,
  'features/account/change-password.js': m16,
  'features/account/password-expiry.js': m17,
  'features/calendar/appt-modal.js': m18,
  'features/calendar/format.js': m19,
  'features/calendar/page.js': m20,
  'features/calendar/search.js': m21,
  'features/calendar/settings-modal.js': m22,
  'features/calendar/state.js': m23,
  'features/calendar/sync-status.js': m24,
  'features/calendar/view.js': m25,
  'features/inventory/actions.js': m26,
  'features/inventory/add-modal.js': m27,
  'features/inventory/adjust.js': m28,
  'features/inventory/batch-location.js': m29,
  'features/inventory/dispatch.js': m30,
  'features/inventory/edit-modal.js': m31,
  'features/inventory/export-dialog.js': m32,
  'features/inventory/filters.js': m33,
  'features/inventory/list.js': m34,
  'features/inventory/location-adjustments.js': m35,
  'features/inventory/photo.js': m36,
  'features/inventory/qty-dialog.js': m37,
  'features/inventory/state.js': m38,
  'features/inventory/status.js': m39,
  'features/inventory/transfer-modal.js': m40,
  'features/kits/actions.js': m41,
  'features/kits/component-rows.js': m42,
  'features/kits/export-dialog.js': m43,
  'features/kits/kit-modal.js': m44,
  'features/kits/page.js': m45,
  'features/kits/state.js': m46,
  'features/kits/status.js': m47,
  'features/notifications/center.js': m48,
  'features/petty-cash/engineering-modal.js': m49,
  'features/petty-cash/page.js': m50,
  'features/petty-cash/report-modal.js': m51,
  'features/petty-cash/state.js': m52,
  'features/prepared/actions.js': m53,
  'features/prepared/page.js': m54,
  'features/prepared/sheet.js': m55,
  'features/quotation/mode-tabs.js': m56,
  'features/quotation/page.js': m57,
  'features/shell/app.js': m58,
  'features/shell/data-refresh.js': m59,
  'features/shell/navigation.js': m60,
  'features/shell/page-scope.js': m61,
  'features/shell/state.js': m62,
  'features/stockout/actions.js': m63,
  'features/stockout/export-dialog.js': m64,
  'features/stockout/modals.js': m65,
  'features/stockout/page.js': m66,
  'features/stockout/sheet.js': m67,
  'features/stockout/state.js': m68,
  'features/stocktake/page.js': m69,
  'features/stocktake/state.js': m70,
  'features/upload-list/quotation-upload.js': m71,
  'features/upload-list/signed-reports.js': m72,
  'features/upload-list/upload-list.js': m73,
  'features/work-progress/day.js': m74,
  'features/work-progress/detail.js': m75,
  'features/work-progress/draft.js': m76,
  'features/work-progress/format.js': m77,
  'features/work-progress/gallery.js': m78,
  'features/work-progress/history.js': m79,
  'features/work-progress/page.js': m80,
  'features/work-progress/pending-photos.js': m81,
  'features/work-progress/photo-upload.js': m82,
  'features/work-progress/state.js': m83,
  'features/work-progress/upload.js': m84,
});

// 先組裝 shell 的 port（切頁、資料重新整理後的畫面更新），之後各模組的 init 與使用者操作才可能用到
configureShell();
setUnauthorizedHandler(handleUnauthorized);   // 401 一律跳登入（登入頁 / 權限頁不註冊）
initUtils();
initInventoryExportDialog();
initKitsExportDialog();
initStockoutExportDialog();
initStockoutActions();
initPreparedActions();
initKitsActions();
initInventoryDispatch();
initStatusListActions();
// 跨 shell / feature 的組合動作由 page entry 接線（features 不可 import shell/app.js）
createActionDelegate('app-', {
  'app-kits-clear-search': { click: function() { clearSearchAutofill(); renderKits(); } },
}).init();
initInventoryActions();
initInventoryFilters();
initKitsPage();
initWorkProgressGallery();
initQuotationPage();
initInventoryPhoto();
initBottomsheet(() => switchTab(appState.currentTab));
initNotifications();
initShellApp();
