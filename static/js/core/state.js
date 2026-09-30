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

// 行事曆（網址 ?month= 的初始月份；features/calendar/* 共用）
/**
 * 解析網址 ?month=YYYY-MM（F5 保留月份）；格式不合或月份不在 1–12 一律回到「本月」。
 * @param {string} search location.search（例如 '?month=2026-09'）。
 * @param {Date} [now] 測試用：指定「現在」。
 * @returns {Date} 該月 1 號。
 */
export function parseCalendarMonth(search, now) {
  const raw = new URLSearchParams(search).get('month');
  if (raw && /^\d{4}-\d{2}$/.test(raw)) {
    const year = parseInt(raw.slice(0, 4));
    const month = Number(raw.slice(5, 7));
    if (month >= 1 && month <= 12) return new Date(year, month - 1, 1);
  }
  return now || new Date();
}
// 跨模組共用、會被其他模組改寫的狀態（issue #39：原本是全域變數）
export const appState = {
  // 品項資料與狀態
  ALL_ITEMS: [],
  INVENTORY_META: { page: 1, page_size: 50, total: 0, stats: null },
  INVENTORY_FACETS: { brands: {}, categories: {}, locations: [] },
  inventoryAbortController: null,
  dataAbortController: null,
  statsAbortController: null,
  ALERTS_BY_SITE: {},
  inventoryLoadedSite: '',
  inventoryFacetsLoadedSite: '',
  fullItemsLoadedSite: '',
  preparedItems: [], // 待領出清單（含非庫存品項；openPreparedSheet 資料源，2026-08-16 家豪）
  currentBrands: [], // 多選品牌篩選（空=全部）
  currentCategories: [], // 多選分類篩選（空=全部）
  STATUS_LIST_CONTEXT: null, // 共用異常清單 renderer 狀態
  // 目前頁籤（inventory/prepared/stockout/stocktake/kit/calendar/work-progress/signed-reports/quotation/petty-cash）
  // 2026-08-13 Sarah：登入預設顯示行事曆（原本 inventory）
  currentTab: 'calendar',
  currentSite: 'office', // office=公司 / warehouse=倉庫 / van=廂型車 / truck=貨車
  // 正在編輯的品項 id（編輯 modal）
  editItemId: null,
  currentKitItems: [], // 整組頁目前篩選結果，異常 KPI 明細使用同一份資料
  // 去向下拉建議清單（loadDestinations 填入）
  DESTINATIONS: [],
  destinationsLoadedSite: '',
  // toast
  toastTimer: undefined,
  calMonth: parseCalendarMonth(location.search),
  unitListActive: [], // 啟用中（select 用）
  // ========== 批次改位置（2026-09-06 方案 A） ==========
  batchMode: false,
  // 2026-09-27：產生櫃子下拉 options（從 API 動態載入，不用硬編碼）
  globalCabinetList: [], // 全局存放櫃子清單
};
export const wprHistoryPageSize = 20;
export const CAL_PALETTE = Object.freeze(['#1a73e8', '#e91e63', '#9c27b0', '#2e7d32', '#f57c00', '#00838f', '#c62828', '#5d4037']);
export const CAL_WEEK = Object.freeze(['日', '一', '二', '三', '四', '五', '六']);
