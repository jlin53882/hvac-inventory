// core/inventory-read-model.js：資料存在 owner 模組（不在 appState）；getter 讀到 setter 寫入的最新值。
const assert = require('assert');
const vm = require('vm');
const { loadModules } = require('./support/frontend-runtime');

const plain = value => JSON.parse(JSON.stringify(value));   // 跨 vm realm 比較內容
const context = vm.createContext({});
loadModules(context, 'core/inventory-read-model.js');
loadModules(context, 'core/inventory-read-model.js');   // 重複載入（葉節點每個 context 只執行一次）不得重置資料

// 預設值
assert.deepStrictEqual(plain(context.getAllItems()), []);
assert.deepStrictEqual(JSON.parse(JSON.stringify(context.getInventoryMeta())), { page: 1, page_size: 50, total: 0, stats: null });
assert.deepStrictEqual(JSON.parse(JSON.stringify(context.getInventoryFacets())), { brands: {}, categories: {}, locations: [] });

// owner 重新指派後（inventory reload / 切換分片），reader 立刻讀到新值，不會拿到舊 reference
const items = [{ id: 1 }, { id: 2 }];
context.setAllItems(items);
context.setInventoryMeta({ page: 2, page_size: 50, total: 2, stats: { zero_items: 1 } });
context.setInventoryFacets({ brands: { A: 2 }, categories: {}, locations: ['L1'] });
loadModules(context, 'core/inventory-read-model.js');   // 再載入一次也不會把資料清掉
assert.strictEqual(context.getAllItems(), items);
assert.strictEqual(context.getInventoryMeta().page, 2);
assert.deepStrictEqual(Object.keys(context.getInventoryFacets().brands), ['A']);
context.setAllItems([]);
assert.deepStrictEqual(plain(context.getAllItems()), [], '切換分片清空後 reader 不得讀到舊清單');

// setter 只改對應欄位，且 reader 看得到
context.setInventoryPage(1);
assert.strictEqual(context.getInventoryMeta().page, 1);
context.setInventoryStats(null);
assert.strictEqual(context.getInventoryMeta().stats, null);
assert.strictEqual(context.getInventoryMeta().total, 2, 'setter 不得動到其他欄位');
context.setInventoryStats({ zero_items: 3 });
assert.strictEqual(context.getInventoryMeta().stats.zero_items, 3);

// patchItem：更新清單內單一品項（Number 比對 id），找不到回傳 false，且只改該品項
context.setAllItems([{ id: 1, has_photo: false }, { id: 2, has_photo: false }]);
assert.strictEqual(context.patchItem('2', { has_photo: true, thumbnail_url: '/t' }), true);
assert.deepStrictEqual(plain(context.getAllItems()), [{ id: 1, has_photo: false }, { id: 2, has_photo: true, thumbnail_url: '/t' }]);
assert.strictEqual(context.patchItem(99, { has_photo: true }), false);

// 資料不在 appState 上
assert.strictEqual(context.appState, undefined);

console.log('inventory read model runtime: PASS');
