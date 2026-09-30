// 庫存管理系統 - 跨模組共用狀態（issue #39：原 globals.js）
// 會被多個模組改寫的值集中在 appState；只被原地修改（不重新指定）的物件與常數直接 export。

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

// 跨模組共用、會被其他模組改寫的狀態（issue #39：原本是全域變數）
export const appState = {
  // 品項資料與狀態
  ALL_ITEMS: [],
  INVENTORY_META: { page: 1, page_size: 50, total: 0, stats: null },
  INVENTORY_FACETS: { brands: {}, categories: {}, locations: [] },
  inventoryLoadedSite: '',
  fullItemsLoadedSite: '',
  preparedItems: [], // 待領出清單（含非庫存品項；openPreparedSheet 資料源，2026-08-16 家豪）
  currentBrands: [], // 多選品牌篩選（空=全部）
  currentCategories: [], // 多選分類篩選（空=全部）
  // 目前頁籤（inventory/prepared/stockout/stocktake/kit/calendar/work-progress/signed-reports/quotation/petty-cash）
  // 2026-08-13 Sarah：登入預設顯示行事曆（原本 inventory）
  currentTab: 'calendar',
  currentSite: 'office', // office=公司 / warehouse=倉庫 / van=廂型車 / truck=貨車
  currentKitItems: [], // 整組頁目前篩選結果，異常 KPI 明細使用同一份資料
  // 去向下拉建議清單（loadDestinations 填入）
  DESTINATIONS: [],
  destinationsLoadedSite: '',
  unitListActive: [], // 啟用中（select 用）
  // 2026-09-27：產生櫃子下拉 options（從 API 動態載入，不用硬編碼）
  globalCabinetList: [], // 全局存放櫃子清單
};
