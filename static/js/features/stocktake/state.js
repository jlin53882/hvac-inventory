// 跨模組共用、會被其他模組改寫的狀態（issue #39：原本是全域變數）
export const stocktakeState = {
  stocktakeValues: {}, // itemId -> actual_qty
  stocktakeKits: [], // 盤點頁整組 tab 的組成材料清單（features/stocktake/page.js fetch /api/kits 填入）
};
