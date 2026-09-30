// index.html 的進入點（issue #39）：載入本頁需要的模組、註冊事件委派（data-action）；不再把命名空間掛到 window，
// 並依原本 <script> 的載入順序執行各模組的初始化。
import { initPettyCashActions } from '../features/petty-cash/actions.js';
import { initStocktakeActions } from '../features/stocktake/page.js';
import { initQuotationActions } from '../features/quotation/page.js';
import { initCalendarActions } from '../features/calendar/actions.js';
import { initWorkProgressActions } from '../features/work-progress/actions.js';
import { initUploadListActions } from '../features/upload-list/upload-list.js';
import { initNotifActions } from '../features/notifications/center.js';
import { initUnitActions } from '../core/units.js';
import { initExpiryActions } from '../features/account/password-expiry.js';
import { initAccountActions } from '../features/account/change-password.js';
import { initUiActions } from '../core/ui-actions.js';
import { initInventoryPhoto } from '../features/inventory/photo.js';
import { initKitsPage, renderKits } from '../features/kits/page.js';
import { initInventoryFilters } from '../features/inventory/filters.js';
import { clearSearchAutofill, closeSidebar, configureShell, initShellApp, switchSite, switchTab, toggleAvatarMenu, toggleSidebar } from '../features/shell/app.js';
import { createActionDelegate } from '../core/actions.js';
import { initInventoryDispatch } from '../features/inventory/dispatch.js';
import { initKitsActions } from '../features/kits/actions.js';
import { initStockoutActions } from '../features/stockout/actions.js';
import { initPreparedActions } from '../features/prepared/actions.js';
import { initInventoryActions } from '../features/inventory/actions.js';
import { initInventoryExportDialog } from '../features/inventory/export-dialog.js';
import { initKitsExportDialog } from '../features/kits/export-dialog.js';
import { initUtils } from '../core/utils.js';
import { initNotifications } from '../features/notifications/center.js';
import { initStockoutExportDialog } from '../features/stockout/export-dialog.js';
import { initBottomsheet } from '../core/bottomsheet.js';
import { appState } from '../core/state.js';
import { initQuotationPage } from '../features/quotation/page.js';
import { handleUnauthorized } from '../core/session.js';
import { setUnauthorizedHandler } from '../core/api-client.js';
import { initWorkProgressGallery } from '../features/work-progress/gallery.js';
import { initStatusListActions } from '../components/status-list.js';

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
import * as m14 from '../core/ui-actions.js';
import * as m15 from '../core/units.js';
import * as m16 from '../core/utils.js';
import * as m17 from '../features/account/change-password.js';
import * as m18 from '../features/account/password-expiry.js';
import * as m19 from '../features/calendar/actions.js';
import * as m20 from '../features/calendar/appt-modal.js';
import * as m21 from '../features/calendar/format.js';
import * as m22 from '../features/calendar/page.js';
import * as m23 from '../features/calendar/search.js';
import * as m24 from '../features/calendar/settings-modal.js';
import * as m25 from '../features/calendar/state.js';
import * as m26 from '../features/calendar/sync-status.js';
import * as m27 from '../features/calendar/view.js';
import * as m28 from '../features/inventory/actions.js';
import * as m29 from '../features/inventory/add-modal.js';
import * as m30 from '../features/inventory/adjust.js';
import * as m31 from '../features/inventory/batch-location.js';
import * as m32 from '../features/inventory/dispatch.js';
import * as m33 from '../features/inventory/edit-modal.js';
import * as m34 from '../features/inventory/export-dialog.js';
import * as m35 from '../features/inventory/filters.js';
import * as m36 from '../features/inventory/list.js';
import * as m37 from '../features/inventory/location-adjustments.js';
import * as m38 from '../features/inventory/photo.js';
import * as m39 from '../features/inventory/qty-dialog.js';
import * as m40 from '../features/inventory/state.js';
import * as m41 from '../features/inventory/status.js';
import * as m42 from '../features/inventory/transfer-modal.js';
import * as m43 from '../features/kits/actions.js';
import * as m44 from '../features/kits/component-rows.js';
import * as m45 from '../features/kits/export-dialog.js';
import * as m46 from '../features/kits/kit-modal.js';
import * as m47 from '../features/kits/page.js';
import * as m48 from '../features/kits/state.js';
import * as m49 from '../features/kits/status.js';
import * as m50 from '../features/notifications/center.js';
import * as m51 from '../features/petty-cash/actions.js';
import * as m52 from '../features/petty-cash/engineering-modal.js';
import * as m53 from '../features/petty-cash/page.js';
import * as m54 from '../features/petty-cash/report-modal.js';
import * as m55 from '../features/petty-cash/state.js';
import * as m56 from '../features/prepared/actions.js';
import * as m57 from '../features/prepared/page.js';
import * as m58 from '../features/prepared/sheet.js';
import * as m59 from '../features/quotation/mode-tabs.js';
import * as m60 from '../features/quotation/page.js';
import * as m61 from '../features/shell/app.js';
import * as m62 from '../features/shell/data-refresh.js';
import * as m63 from '../features/shell/navigation.js';
import * as m64 from '../features/shell/page-scope.js';
import * as m65 from '../features/shell/state.js';
import * as m66 from '../features/stockout/actions.js';
import * as m67 from '../features/stockout/export-dialog.js';
import * as m68 from '../features/stockout/modals.js';
import * as m69 from '../features/stockout/page.js';
import * as m70 from '../features/stockout/sheet.js';
import * as m71 from '../features/stockout/state.js';
import * as m72 from '../features/stocktake/page.js';
import * as m73 from '../features/stocktake/state.js';
import * as m74 from '../features/upload-list/quotation-upload.js';
import * as m75 from '../features/upload-list/signed-reports.js';
import * as m76 from '../features/upload-list/upload-list.js';
import * as m77 from '../features/work-progress/actions.js';
import * as m78 from '../features/work-progress/day.js';
import * as m79 from '../features/work-progress/detail.js';
import * as m80 from '../features/work-progress/draft.js';
import * as m81 from '../features/work-progress/format.js';
import * as m82 from '../features/work-progress/gallery.js';
import * as m83 from '../features/work-progress/history.js';
import * as m84 from '../features/work-progress/page.js';
import * as m85 from '../features/work-progress/pending-photos.js';
import * as m86 from '../features/work-progress/photo-upload.js';
import * as m87 from '../features/work-progress/state.js';
import * as m88 from '../features/work-progress/upload.js';

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
  'core/ui-actions.js': m14,
  'core/units.js': m15,
  'core/utils.js': m16,
  'features/account/change-password.js': m17,
  'features/account/password-expiry.js': m18,
  'features/calendar/actions.js': m19,
  'features/calendar/appt-modal.js': m20,
  'features/calendar/format.js': m21,
  'features/calendar/page.js': m22,
  'features/calendar/search.js': m23,
  'features/calendar/settings-modal.js': m24,
  'features/calendar/state.js': m25,
  'features/calendar/sync-status.js': m26,
  'features/calendar/view.js': m27,
  'features/inventory/actions.js': m28,
  'features/inventory/add-modal.js': m29,
  'features/inventory/adjust.js': m30,
  'features/inventory/batch-location.js': m31,
  'features/inventory/dispatch.js': m32,
  'features/inventory/edit-modal.js': m33,
  'features/inventory/export-dialog.js': m34,
  'features/inventory/filters.js': m35,
  'features/inventory/list.js': m36,
  'features/inventory/location-adjustments.js': m37,
  'features/inventory/photo.js': m38,
  'features/inventory/qty-dialog.js': m39,
  'features/inventory/state.js': m40,
  'features/inventory/status.js': m41,
  'features/inventory/transfer-modal.js': m42,
  'features/kits/actions.js': m43,
  'features/kits/component-rows.js': m44,
  'features/kits/export-dialog.js': m45,
  'features/kits/kit-modal.js': m46,
  'features/kits/page.js': m47,
  'features/kits/state.js': m48,
  'features/kits/status.js': m49,
  'features/notifications/center.js': m50,
  'features/petty-cash/actions.js': m51,
  'features/petty-cash/engineering-modal.js': m52,
  'features/petty-cash/page.js': m53,
  'features/petty-cash/report-modal.js': m54,
  'features/petty-cash/state.js': m55,
  'features/prepared/actions.js': m56,
  'features/prepared/page.js': m57,
  'features/prepared/sheet.js': m58,
  'features/quotation/mode-tabs.js': m59,
  'features/quotation/page.js': m60,
  'features/shell/app.js': m61,
  'features/shell/data-refresh.js': m62,
  'features/shell/navigation.js': m63,
  'features/shell/page-scope.js': m64,
  'features/shell/state.js': m65,
  'features/stockout/actions.js': m66,
  'features/stockout/export-dialog.js': m67,
  'features/stockout/modals.js': m68,
  'features/stockout/page.js': m69,
  'features/stockout/sheet.js': m70,
  'features/stockout/state.js': m71,
  'features/stocktake/page.js': m72,
  'features/stocktake/state.js': m73,
  'features/upload-list/quotation-upload.js': m74,
  'features/upload-list/signed-reports.js': m75,
  'features/upload-list/upload-list.js': m76,
  'features/work-progress/actions.js': m77,
  'features/work-progress/day.js': m78,
  'features/work-progress/detail.js': m79,
  'features/work-progress/draft.js': m80,
  'features/work-progress/format.js': m81,
  'features/work-progress/gallery.js': m82,
  'features/work-progress/history.js': m83,
  'features/work-progress/page.js': m84,
  'features/work-progress/pending-photos.js': m85,
  'features/work-progress/photo-upload.js': m86,
  'features/work-progress/state.js': m87,
  'features/work-progress/upload.js': m88,
});

// 先組裝 shell 的 port（切頁、資料重新整理後的畫面更新），之後各模組的 init 與使用者操作才可能用到
configureShell();
setUnauthorizedHandler(handleUnauthorized);   // 401 一律跳登入（登入頁 / 權限頁不註冊）
initUtils();
initUiActions();
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
  'app-sidebar-close': { click: function() { closeSidebar(); } },
  'app-sidebar-toggle': { click: function() { toggleSidebar(); } },
  'app-tab': { click: function(el) { switchTab(el.dataset.tab); } },
  'app-site': { click: function(el) { switchSite(el.dataset.site); } },
  'app-avatar-menu': { click: function() { toggleAvatarMenu(); } },
  'app-kits-clear-search': { click: function() { clearSearchAutofill(); renderKits(); } },
}).init();
initNotifActions();
initAccountActions();
initExpiryActions();
initUnitActions();
initWorkProgressActions();
initCalendarActions();
initQuotationActions();
initStocktakeActions();
initPettyCashActions();
initUploadListActions();
initInventoryActions();
initInventoryFilters();
initKitsPage();
initWorkProgressGallery();
initQuotationPage();
initInventoryPhoto();
initBottomsheet(() => switchTab(appState.currentTab));
initNotifications();
initShellApp();
