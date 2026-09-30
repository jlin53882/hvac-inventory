// 庫存管理系統 - 跨模組共用狀態（issue #39：原 globals.js）
// 導覽層的全域狀態集中在 appState；只被原地修改（不重新指定）的物件與常數直接 export。

export var pending = {};   // itemId -> net delta, including selected stock changes
export var pendingByStock = {};  // stockId -> { itemId, delta } for exact-location additions
export var INVENTORY_PENDING_ITEMS = {};   // itemId -> base item snapshot for paged KPI adjustments
export var INVENTORY_ALERT_ITEMS = {};  // lazy 警示清單快取，供跨頁編輯使用

// Tab lifecycle contract：兩份名單故意分開，避免資料載入與頁面 mount 語意混用。
// ITEMLESS_TABS：不需要載入 inventory ALL_ITEMS 的頁面。
// DATA_REFRESH_PRESERVE_MOUNT_TABS：背景 loadData refresh 不得重新 mount 的 stateful 頁面。
export const ITEMLESS_TABS = new Set(['calendar', 'work-progress', 'signed-reports', 'quotation', 'petty-cash']);
export const DATA_REFRESH_PRESERVE_MOUNT_TABS = new Set(['work-progress', 'signed-reports', 'quotation', 'petty-cash']);
export const INVENTORY_SITES = Object.freeze(['office', 'warehouse', 'van', 'truck']);

// 導覽層的全域狀態（issue #39：原本是全域變數）：目前頁籤與庫存區，由 features/shell 切換，多數 feature 讀取。
// 庫存清單資料在 core/inventory-read-model.js；其他跨 feature 共用資料在 core/shared-read-model.js（各自 owner 用 setter 寫入）。
export const appState = {
  // 目前頁籤（inventory/prepared/stockout/stocktake/kit/calendar/work-progress/signed-reports/quotation/petty-cash）
  // 2026-08-13 Sarah：登入預設顯示行事曆（原本 inventory）
  currentTab: 'calendar',
  currentSite: 'office', // office=公司 / warehouse=倉庫 / van=廂型車 / truck=貨車
};
