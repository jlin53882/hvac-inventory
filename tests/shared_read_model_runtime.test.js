// core/shared-read-model.js：getter 讀到 owner 寫入的最新值；brand / category 篩選以 setter 整批指派（不再原地 splice / push）。
const assert = require('assert');
const vm = require('vm');
const { loadModules } = require('./support/frontend-runtime');

const context = vm.createContext({
  appState: {
    preparedItems: [], currentKitItems: [], globalCabinetList: [], DESTINATIONS: [], unitListActive: [],
    inventoryLoadedSite: '', fullItemsLoadedSite: '', destinationsLoadedSite: '', currentBrands: [], currentCategories: [],
  },
});
loadModules(context, 'core/shared-read-model.js');
const state = context.appState;

// 預設值
for (const getter of ['getPreparedItems', 'getCurrentKitItems', 'getGlobalCabinetList', 'getDestinations', 'getActiveUnitList', 'getCurrentBrands', 'getCurrentCategories']) {
  assert.deepStrictEqual(context[getter](), [], getter);
}
for (const getter of ['getInventoryLoadedSite', 'getFullItemsLoadedSite', 'getDestinationsLoadedSite']) assert.strictEqual(context[getter](), '', getter);

// owner 重新指派後 reader 讀到最新值（切換分片 / 重新載入）
const prepared = [{ id: 1 }];
state.preparedItems = prepared;
state.currentKitItems = [{ id: 9 }];
state.globalCabinetList = [{ name: 'A' }];
state.DESTINATIONS = ['X'];
state.unitListActive = [{ name: '個' }];
state.inventoryLoadedSite = 'office';
state.fullItemsLoadedSite = 'warehouse';
state.destinationsLoadedSite = 'van';
assert.strictEqual(context.getPreparedItems(), prepared);
assert.strictEqual(context.getCurrentKitItems()[0].id, 9);
assert.strictEqual(context.getGlobalCabinetList()[0].name, 'A');
assert.deepStrictEqual(context.getDestinations(), ['X']);
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

console.log('shared read model runtime: PASS');
