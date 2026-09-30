// core/inventory-read-model.js：accessor 讀到的是 owner（shell）寫入的最新值；setter 是 INVENTORY_META 原地修改的唯一入口。
const assert = require('assert');
const vm = require('vm');
const { loadModules } = require('./support/frontend-runtime');

const context = vm.createContext({
  appState: {
    ALL_ITEMS: [],
    INVENTORY_META: { page: 1, page_size: 50, total: 0, stats: null },
    INVENTORY_FACETS: { brands: {}, categories: {}, locations: [] },
  },
});
loadModules(context, 'core/inventory-read-model.js');
const state = context.appState;

// 預設值
assert.deepStrictEqual(context.getAllItems(), []);
assert.deepStrictEqual(JSON.parse(JSON.stringify(context.getInventoryMeta())), { page: 1, page_size: 50, total: 0, stats: null });
assert.deepStrictEqual(JSON.parse(JSON.stringify(context.getInventoryFacets())), { brands: {}, categories: {}, locations: [] });

// owner 重新指派後（inventory reload / 切換分片），reader 立刻讀到新值，不會拿到舊 reference
const items = [{ id: 1 }, { id: 2 }];
state.ALL_ITEMS = items;
state.INVENTORY_META = { page: 2, page_size: 50, total: 2, stats: { zero_items: 1 } };
state.INVENTORY_FACETS = { brands: { A: 2 }, categories: {}, locations: ['L1'] };
assert.strictEqual(context.getAllItems(), items);
assert.strictEqual(context.getInventoryMeta().page, 2);
assert.deepStrictEqual(Object.keys(context.getInventoryFacets().brands), ['A']);
state.ALL_ITEMS = [];
assert.deepStrictEqual(context.getAllItems(), [], '切換分片清空後 reader 不得讀到舊清單');

// setter 只改對應欄位，且 reader 看得到
context.setInventoryPage(1);
assert.strictEqual(context.getInventoryMeta().page, 1);
context.setInventoryStats(null);
assert.strictEqual(context.getInventoryMeta().stats, null);
assert.strictEqual(context.getInventoryMeta().total, 2, 'setter 不得動到其他欄位');
context.setInventoryStats({ zero_items: 3 });
assert.strictEqual(state.INVENTORY_META.stats.zero_items, 3);

console.log('inventory read model runtime: PASS');
