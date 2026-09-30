// core/shared-read-model.js：資料存在 owner 模組（不在 appState）；getter 讀到 setter 寫入的最新值；篩選以 setter 整批指派新陣列。
const assert = require('assert');
const vm = require('vm');
const { loadModules } = require('./support/frontend-runtime');

const plain = value => JSON.parse(JSON.stringify(value));   // 跨 vm realm 比較內容
const context = vm.createContext({});
loadModules(context, 'core/shared-read-model.js');

// 預設值
for (const getter of ['getPreparedItems', 'getCurrentKitItems', 'getGlobalCabinetList', 'getDestinations', 'getActiveUnitList', 'getCurrentBrands', 'getCurrentCategories']) {
  assert.deepStrictEqual(plain(context[getter]()), [], getter);
}
for (const getter of ['getInventoryLoadedSite', 'getFullItemsLoadedSite', 'getDestinationsLoadedSite']) assert.strictEqual(context[getter](), '', getter);

// owner 用 setter 重新指派後 reader 讀到最新值（切換分片 / 重新載入）
const prepared = [{ id: 1 }];
context.setPreparedItems(prepared);
context.setCurrentKitItems([{ id: 9 }]);
context.setGlobalCabinetList([{ name: 'A' }]);
context.setDestinations(['X']);
context.setActiveUnitList([{ name: '個' }]);
context.setInventoryLoadedSite('office');
context.setFullItemsLoadedSite('warehouse');
context.setDestinationsLoadedSite('van');
loadModules(context, 'core/shared-read-model.js');   // 重複載入不得重置資料
assert.strictEqual(context.getPreparedItems(), prepared);
assert.strictEqual(context.getCurrentKitItems()[0].id, 9);
assert.strictEqual(context.getGlobalCabinetList()[0].name, 'A');
assert.deepStrictEqual(plain(context.getDestinations()), ['X']);
assert.strictEqual(context.getActiveUnitList()[0].name, '個');
assert.deepStrictEqual([context.getInventoryLoadedSite(), context.getFullItemsLoadedSite(), context.getDestinationsLoadedSite()], ['office', 'warehouse', 'van']);

// 篩選 setter：整批換成新陣列，舊 reference 不被修改
const before = context.getCurrentBrands();
context.setCurrentBrands(['A', 'B']);
context.setCurrentCategories(['C']);
assert.deepStrictEqual(Array.from(context.getCurrentBrands()), ['A', 'B']);
assert.deepStrictEqual(Array.from(context.getCurrentCategories()), ['C']);
assert.deepStrictEqual(Array.from(before), [], '舊陣列不得被原地修改');
context.setCurrentBrands([]);
assert.strictEqual(context.getCurrentBrands().length, 0);

// 資料不在 appState 上
assert.strictEqual(context.appState, undefined);

console.log('shared read model runtime: PASS');
