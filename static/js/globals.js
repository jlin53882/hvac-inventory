// 庫存管理系統 - 全域共享變數（v8）
// ========================================
// 注意：跨檔共享必須用 var（let/const 不跨 <script> 共享）
// 載入順序：本檔必須最先載入

// 品項資料與狀態
var ALL_ITEMS = [];
var currentBrand = '全部';
var pending = {};   // itemId -> delta
// 目前頁籤（inventory/prepared/stockout/stocktake/kit）
var currentTab = 'inventory';
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
var kitModalSelections = [];  // [{item_id, qty}]
var kitModalCompRows = [];

// toast
var toastTimer;

var editingKitId = null;  // 編輯整組時記錄 kit id（2026-08-11 Sarah）
