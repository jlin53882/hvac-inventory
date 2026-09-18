// 庫存管理系統 - 全域共享變數（v8）
// ========================================
// 注意：跨檔共享必須用 var（let/const 不跨 <script> 共享）
// 載入順序：本檔必須最先載入

// 品項資料與狀態
var ALL_ITEMS = [];
var INVENTORY_META = { page: 1, page_size: 50, total: 0, stats: null };
var INVENTORY_FACETS = { brands: {}, categories: {}, locations: [] };
var inventoryRequestSeq = 0;
var inventoryAbortController = null;
var dataRequestSeq = 0;
var dataAbortController = null;
var statsRequestSeq = 0;
var statsAbortController = null;
var ALERTS_BY_SITE = {};
var inventoryLoadedSite = '';
var inventoryFacetsLoadedSite = '';
var fullItemsLoadedSite = '';
var preparedItems = [];  // 待領出清單（含非庫存品項；openPreparedSheet 資料源，2026-08-16 家豪）

var currentBrands = [];   // 多選品牌篩選（空=全部）
var currentCategories = [];  // 多選分類篩選（空=全部）
var pending = {};   // itemId -> delta
var INVENTORY_PENDING_ITEMS = {};   // itemId -> base item snapshot for paged KPI adjustments
var inventoryStatusRequestSeq = 0;
var inventoryStatusModalType = '';
var INVENTORY_ALERT_ITEMS = {};  // lazy 警示清單快取，供跨頁編輯使用
var STATUS_LIST_CONTEXT = null;   // 共用異常清單 renderer 狀態
// 目前頁籤（inventory/prepared/stockout/stocktake/kit/calendar）
// 2026-08-13 Sarah：登入預設顯示行事曆（原本 inventory）
var currentTab = 'calendar';
var INVENTORY_SITES = ['office', 'warehouse', 'van', 'truck'];
var currentSite = 'office';  // office=辦公室 / warehouse=倉庫 / van=廂型車 / truck=貨車
// 正在編輯的品項 id（編輯 modal）
var editItemId = null;
// 出庫 modal 的品項 id
var outItemId = null;
var stocktakeValues = {};  // itemId -> actual_qty
var stocktakeKits = [];    // 盤點頁整組 tab 的組成材料清單（render/stocktake.js fetch /api/kits 填入）
var currentKitItems = [];  // 整組頁目前篩選結果，異常 KPI 明細使用同一份資料
// 去向下拉建議清單（loadDestinations 填入）
var DESTINATIONS = [];
var destinationsLoadedSite = '';

// 兩階段出庫
var prepareItemId = null;
var preparedOutItemId = null;

// 已領出（出庫記錄）清單與編輯狀態
var stockoutRecords = [];   // render/stockout.js 填入，退回/編輯 modal 用
var stockoutDateFrom = '';
var stockoutDateTo = '';
var stockoutPageSearch = '';
var editStockoutId = null;

// 整組 Modal
var kitModalCompRows = [];

// toast
var toastTimer;

var editingKitId = null;  // 編輯整組時記錄 kit id（2026-08-11 Sarah）

// 行事曆（render/calendar.js + modals/* 共享；let/const 不跨檔，2026-08-16 拆檔搬入）
var _calM = new URLSearchParams(location.search).get('month');   // 原 calendar.js：?month=YYYY-MM（F5 保留月份）
var calMonth = _calM && /^\d{4}-\d{2}$/.test(_calM) && Number(_calM.slice(5,7)) >= 1 && Number(_calM.slice(5,7)) <= 12 ? new Date(parseInt(_calM.slice(0,4)), parseInt(_calM.slice(5,7))-1, 1) : new Date();
var calSelected = new Date();    // 選取的日期
var wprSelectedFiles = [];       // 工作進度待上傳照片（含 file/previewUrl）
var wprAppointments = [];
var wprReportsByAppointment = {};
var wprCurrentReport = null;
var wprHistoryPage = 1;
var wprHistoryPageSize = 20;
var wprHistoryTotal = 0;
var wprDayRequestToken = 0;
var wprHistoryRequestToken = 0;
var wprKpiRequestToken = 0;
var wprDetailRequestTokens = {};
var wprSelectRequestToken = 0;
// 工作進度（render/work-progress.js）
var calEvents = [];              // 當月/當日行程
var calTodayEvents = [];          // 今日派工（KPI 用，沿用既有 date API）
var calLoadError = '';             // 行事曆資料載入錯誤
var calLoadRequestToken = 0;
var calSvc = [];                 // 服務項目字典（全部，含停用）
var calAssignable = [];          // 可指派人員
var CAL_PALETTE = ['#1a73e8', '#e91e63', '#9c27b0', '#2e7d32', '#f57c00', '#00838f', '#c62828', '#5d4037'];
var CAL_WEEK = ['日', '一', '二', '三', '四', '五', '六'];
