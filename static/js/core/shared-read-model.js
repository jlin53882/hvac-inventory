// 跨 feature 讀取的共用資料 owner 模組（延續 inventory-read-model.js；issue #39 後續：appState 收斂）
//
// 這些欄位的資料就存在這個模組裡（不再放在 appState）：
// - 讀：其他模組一律用 getter。
// - 寫：只有各欄位的 owner 透過 setter 寫入（tests/test_frontend_state_ownership.py 的 ALLOWED_SETTERS 明列誰能呼叫哪個 setter）。
// - getter 回傳 live reference（不複製）：不得原地修改（push / splice / obj.k = …），靜態守衛把關；
//   currentBrands / currentCategories 一律用 setter 整批指派新陣列。
// - currentTab / currentSite 是導覽層的全域狀態，留在 core/state.js 的 appState（見 test_frontend_state_ownership.py）。
// - 只放函式宣告與一個模組私有的資料物件（零依賴葉節點），tests/support/frontend-runtime.js 會在 vm 測試中自動補上。

var sharedData = {
  preparedItems: [],
  currentKitItems: [],
  globalCabinetList: [],
  destinations: [],
  activeUnitList: [],
  inventoryLoadedSite: '',
  fullItemsLoadedSite: '',
  destinationsLoadedSite: '',
  currentBrands: [],
  currentCategories: [],
};

export function getPreparedItems() {
  return sharedData.preparedItems;
}

export function getCurrentKitItems() {
  return sharedData.currentKitItems;
}

export function getGlobalCabinetList() {
  return sharedData.globalCabinetList;
}

export function getDestinations() {
  return sharedData.destinations;
}

export function getActiveUnitList() {
  return sharedData.activeUnitList;
}

export function getInventoryLoadedSite() {
  return sharedData.inventoryLoadedSite;
}

export function getFullItemsLoadedSite() {
  return sharedData.fullItemsLoadedSite;
}

export function getDestinationsLoadedSite() {
  return sharedData.destinationsLoadedSite;
}

export function getCurrentBrands() {
  return sharedData.currentBrands;
}

export function getCurrentCategories() {
  return sharedData.currentCategories;
}

export function setPreparedItems(items) {
  sharedData.preparedItems = items;
}

export function setCurrentKitItems(items) {
  sharedData.currentKitItems = items;
}

export function setGlobalCabinetList(list) {
  sharedData.globalCabinetList = list;
}

export function setDestinations(list) {
  sharedData.destinations = list;
}

export function setActiveUnitList(list) {
  sharedData.activeUnitList = list;
}

export function setInventoryLoadedSite(site) {
  sharedData.inventoryLoadedSite = site;
}

export function setFullItemsLoadedSite(site) {
  sharedData.fullItemsLoadedSite = site;
}

export function setDestinationsLoadedSite(site) {
  sharedData.destinationsLoadedSite = site;
}

/**
 * 更新目前整組清單裡單一整組的欄位（例如刪除整組照片後同步縮圖狀態）；整組是 read-model 內的資料，
 * consumer 不可自己 `getCurrentKitItems().find(...)` 之後直接改欄位。
 * @param {number} kitId 整組 id（kits.id）。
 * @param {object} patch 要合併進整組的欄位。
 * @returns {boolean} 有找到並更新時為 true。
 */
export function patchCurrentKit(kitId, patch) {
  const kit = sharedData.currentKitItems.find(entry => Number(entry.id) === Number(kitId));
  if (!kit) return false;
  Object.assign(kit, patch);
  return true;
}

export function setCurrentBrands(brands) {
  sharedData.currentBrands = brands;
}

export function setCurrentCategories(categories) {
  sharedData.currentCategories = categories;
}
