// 庫存清單資料的 owner 模組（issue #39 後續：appState 收斂）
//
// ALL_ITEMS / INVENTORY_META / INVENTORY_FACETS 的資料就存在這個模組裡（不再放在 appState）：
// - 讀：其他模組一律用 getter（getAllItems / getInventoryMeta / getInventoryFacets）。
// - 寫：只有 features/shell（載入 / 切換分片）與 features/inventory（stats、頁碼）透過 setter 寫入，
//   由 tests/test_frontend_state_ownership.py 的 ALLOWED_SETTERS 把關。
// - getter 回傳的是 live reference（清單很大、每次渲染都讀，不做複製）：不得原地修改（push / splice / obj.k = …），
//   靜態守衛會擋；要改請走 setter。
// - 只放函式宣告與一個模組私有的資料物件（零依賴葉節點），tests/support/frontend-runtime.js 會在 vm 測試中自動補上。

var inventoryData = {
  items: [],
  meta: { page: 1, page_size: 50, total: 0, stats: null },
  facets: { brands: {}, categories: {}, locations: [] },
};

export function getAllItems() {
  return inventoryData.items;
}

export function getInventoryMeta() {
  return inventoryData.meta;
}

export function getInventoryFacets() {
  return inventoryData.facets;
}

export function setAllItems(items) {
  inventoryData.items = items;
}

export function setInventoryMeta(meta) {
  inventoryData.meta = meta;
}

export function setInventoryFacets(facets) {
  inventoryData.facets = facets;
}

export function setInventoryPage(page) {
  inventoryData.meta.page = page;
}

export function setInventoryStats(stats) {
  inventoryData.meta.stats = stats;
}
