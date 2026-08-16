// 庫存管理系統 - 全域共享變數（v8）
// ========================================
// 注意：跨檔共享必須用 var（let/const 不跨 <script> 共享）
// 載入順序：本檔必須最先載入

// 品項資料與狀態
var ALL_ITEMS = [];
var currentBrand = '全部';
var pending = {};   // itemId -> delta
// 目前頁籤（inventory/prepared/stockout/stocktake/kit/calendar）
// 2026-08-13 Sarah：登入預設顯示行事曆（原本 inventory）
var currentTab = 'calendar';
var currentSite = 'office';  // office=辦公室 / warehouse=倉庫
// 正在編輯的品項 id（編輯 modal）
var editItemId = null;
// 出庫 modal 的品項 id
var outItemId = null;
var stocktakeValues = {};  // itemId -> actual_qty
// 去向下拉建議清單（loadDestinations 填入）
var DESTINATIONS = [];

// 兩階段出庫
var prepareItemId = null;
var preparedOutItemId = null;

// 已領出（出庫記錄）清單與編輯狀態
var stockoutRecords = [];   // render/stockout.js 填入，退回/編輯 modal 用
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
var calEvents = [];              // 當月/當日行程
var calSvc = [];                 // 服務項目字典（全部，含停用）
var calAssignable = [];          // 可指派人員
var CAL_PALETTE = ['#1a73e8', '#e91e63', '#9c27b0', '#2e7d32', '#f57c00', '#00838f', '#c62828', '#5d4037'];
var CAL_WEEK = ['日', '一', '二', '三', '四', '五', '六'];
