// 庫存管理系統 - 全域共享變數（v8）
// ========================================
// 注意：跨檔共享必須用 var（let/const 不跨 <script> 共享）
// 載入順序：本檔必須最先載入

// 品項資料與狀態
var ALL_ITEMS = [];
var currentBrand = '全部';
var pending = {};   // itemId -> delta
var currentTab = 'inventory';
var currentSite = 'office';  // office=辦公室 / warehouse=倉庫
var editItemId = null;
var outItemId = null;
var stocktakeValues = {};  // itemId -> actual_qty
var DESTINATIONS = [];

// 兩階段出庫
var prepareItemId = null;
var preparedOutItemId = null;

// 整組 Modal
var kitModalSelections = [];  // [{item_id, qty}]
var kitModalCompRows = [];

// toast
var toastTimer;
