// 庫存清單資料的讀取介面（issue #39 後續：appState 讀取耦合收斂）
//
// ALL_ITEMS / INVENTORY_META / INVENTORY_FACETS 由 features/shell 載入並指派；其他模組一律透過本檔的 accessor 讀取，
// 不再直接 `appState.ALL_ITEMS…`，這樣之後要換 backing storage 時 consumer 不用改。
// - accessor 回傳的是 live reference（清單很大、每次渲染都讀，不做複製）：不得原地修改（push / splice / obj.k = …），
//   由 tests/test_frontend_state_ownership.py 的靜態守衛把關；要改請走 owner 的 setter（見下方 setInventory*）。
// - 只放函式宣告（零依賴葉節點），tests/support/frontend-runtime.js 會在 vm 測試中自動補上。

import { appState } from './state.js';

export function getAllItems() {
  return appState.ALL_ITEMS;
}

export function getInventoryMeta() {
  return appState.INVENTORY_META;
}

export function getInventoryFacets() {
  return appState.INVENTORY_FACETS;
}

// INVENTORY_META 的原地修改集中在這裡（原本 shell 與 inventory/status.js 各自直接改欄位）
export function setInventoryPage(page) {
  appState.INVENTORY_META.page = page;
}

export function setInventoryStats(stats) {
  appState.INVENTORY_META.stats = stats;
}
