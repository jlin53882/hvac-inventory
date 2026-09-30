// 跨 feature 讀取的共用狀態 accessor（延續 inventory-read-model.js；issue #39 後續）
//
// 這些欄位由各自的 owner 寫入（見 tests/test_frontend_state_ownership.py 的 ALLOWED_WRITERS），
// 其他模組一律透過這裡的 getter 讀取，不直接 `appState.X`。backing storage 仍在 appState。
// - getter 回傳 live reference（不複製）：不得原地修改（push / splice / obj.k = …），靜態守衛把關。
// - currentBrands / currentCategories 的變更走 setCurrentBrands / setCurrentCategories（整批指派新陣列），
//   不再原地 splice / push。
// - currentTab / currentSite 是導覽層的全域狀態，刻意不在這裡（保留 shared，見 DIRECT_READER_BASELINE）。
// - 只放函式宣告（零依賴葉節點），tests/support/frontend-runtime.js 會在 vm 測試中自動補上。

import { appState } from './state.js';

export function getPreparedItems() {
  return appState.preparedItems;
}

export function getCurrentKitItems() {
  return appState.currentKitItems;
}

export function getGlobalCabinetList() {
  return appState.globalCabinetList;
}

export function getDestinations() {
  return appState.DESTINATIONS;
}

export function getActiveUnitList() {
  return appState.unitListActive;
}

export function getInventoryLoadedSite() {
  return appState.inventoryLoadedSite;
}

export function getFullItemsLoadedSite() {
  return appState.fullItemsLoadedSite;
}

export function getDestinationsLoadedSite() {
  return appState.destinationsLoadedSite;
}

export function getCurrentBrands() {
  return appState.currentBrands;
}

export function getCurrentCategories() {
  return appState.currentCategories;
}

export function setCurrentBrands(brands) {
  appState.currentBrands = brands;
}

export function setCurrentCategories(categories) {
  appState.currentCategories = categories;
}
