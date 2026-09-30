// 主頁 shell 自己的內部狀態（資料重新載入用的 AbortController 與警示快取）。
// 只有 features/shell/* 讀寫（tests/test_frontend_state_ownership.py 守衛）；
// 其他 feature 需要的跨頁共用資料（ALL_ITEMS、INVENTORY_META 等）仍在 core/state.js 的 appState。
export const shellState = {
  inventoryAbortController: null,
  dataAbortController: null,
  statsAbortController: null,
  ALERTS_BY_SITE: {},            // 各庫存區的警示統計快取（global summary 只吃這份）
  inventoryFacetsLoadedSite: '', // 篩選面板 facets 已載入的庫存區
};
