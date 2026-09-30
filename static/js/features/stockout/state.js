// 跨模組共用、會被其他模組改寫的狀態（issue #39：原本是全域變數）
export const stockoutState = {
  editPreparedId: null,  // 待領出編輯 modal 正在編輯的品項 id（原本與庫存編輯共用 appState.editItemId）
  // 出庫 modal 的品項 id
  outItemId: null,
  // 兩階段出庫
  prepareItemId: null,
  preparedOutItemId: null,
  // 已領出（出庫記錄）清單與編輯狀態
  stockoutRecords: [], // features/stockout/page.js 填入，退回/編輯 modal 用
  stockoutDateFrom: '',
  stockoutDateTo: '',
  stockoutPageSearch: '',
  editStockoutId: null,
};
