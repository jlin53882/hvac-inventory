// 跨模組共用、會被其他模組改寫的狀態（issue #39：原本是全域變數）
export const kitsState = {
  // 整組 Modal
  kitModalCompRows: [],
  editingKitId: null, // 編輯整組時記錄 kit id（2026-08-11 Sarah）
  kitUpdatedAt: null, // 2026-08-14 樂觀鎖：開啟編輯整組 modal 時的 updated_at 快照
  kitLocationRows: [], // Display metadata only; actual stock positions are item_stocks.location.
};
