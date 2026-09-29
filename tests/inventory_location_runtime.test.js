const assert = require('node:assert/strict');
const vm = require('node:vm');
const { installApiClient, loadModules, mockResponse } = require('./support/frontend-runtime');

const inventoryRequests = [];
const openedModals = [];
const elements = {
  'btn-save': { disabled: false },
  'stock-location-options': { innerHTML: '' },
};
const sandbox = {
  appState: { currentTab: 'inventory', currentSite: 'office', ALL_ITEMS: [
    { id: 1, name: '多位置品項', unit: '個', qty: 12, stocks: [
      { id: 101, location: '編號A | 1-1', qty: 10 },
      { id: 102, location: '編號B <img src=x onerror=alert(1)>', qty: 2 },
    ] },
    { id: 2, name: '單位置品項', unit: '個', qty: 4, stocks: [
      { id: 201, location: '編號C | 3-1', qty: 4 },
    ] },
    { id: 3, name: '小數多位置品項', unit: 'kg', qty: 2, stocks: [
      { id: 301, location: '秤台A', qty: 1 },
      { id: 302, location: '秤台B', qty: 1 },
    ] },
    { id: 4, name: '分數多位置品項', unit: '罐', qty: 1, stocks: [
      { id: 401, location: '罐架A', qty: 0.5 },
      { id: 402, location: '罐架B', qty: 0.5 },
    ] },
  ] },
  pending: {},
  pendingByStock: {},
  INVENTORY_PENDING_ITEMS: {},
  failNextSave: false,
  prompt: () => '13',
  setTimeout: () => 0,
  esc: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;'),
  document: {
    getElementById: id => elements[id] || (elements[id] = {
      innerHTML: '', textContent: '', disabled: false, hidden: false, attributes: {},
      setAttribute(name, value) { this.attributes[name] = value; },
      classList: (() => { const set = new Set(); return { toggle(c, on) { if (on) set.add(c); else set.delete(c); }, contains: c => set.has(c) }; })(),
    }),
    addEventListener: () => {},
  },
  openModal: id => openedModals.push(id),
  closeModalForce: () => {},
  toast: () => {},
  renderInventory: () => {},
  fetch: async (url, options) => {
    inventoryRequests.push({ url, options, body: JSON.parse(options.body) });
    if (sandbox.failNextSave) {
      sandbox.failNextSave = false;
      return mockResponse(({ detail: 'temporary failure' }), 400);
    }
    return mockResponse(({}));
  },
  console,
};
vm.createContext(sandbox);
installApiClient(sandbox);
loadModules(sandbox, 'core/qty.js');
sandbox.unitList = [
  { name: '個', qty_type: 'integer' },
  { name: 'kg', qty_type: 'decimal' },
  { name: '罐', qty_type: 'fraction' },
];
// 原 render/inventory.js 已依職責拆成多個模組（issue #39）
loadModules(sandbox, 'features/inventory/state.js', 'features/inventory/filters.js', 'core/search.js', 'features/inventory/list.js',
  'features/inventory/status.js', 'features/inventory/actions.js', 'features/inventory/adjust.js', 'features/inventory/batch-location.js');
sandbox.renderInventory = () => {};
loadModules(sandbox, 'features/inventory/location-adjustments.js', 'core/data.js', 'features/shell/data-refresh.js');
sandbox.loadData = async () => {};
loadModules(sandbox, 'features/inventory/qty-dialog.js');

(async () => {
  sandbox.changeQty(1, 1);
  assert.equal(openedModals.at(-1), 'stock-location-modal', '多位置品項按 + 應先要求選擇位置');
  assert.equal(sandbox.pending['1'], undefined, '選擇位置前不可先暫存到預設位置');
  assert.ok(elements['stock-location-options'].innerHTML.includes('&lt;img'));
  assert.ok(!elements['stock-location-options'].innerHTML.includes('<img'));
  sandbox.queueStockLocationAdjustment(1, 102);
  assert.equal(sandbox.pending['1'], 1, '選定位置後應反映在總數待存變更');
  assert.equal(sandbox.pendingByStock['102'].delta, 1, '待存變更需保留指定 stock ID');
  await sandbox.saveAll();
  assert.deepEqual(inventoryRequests.map(request => request.url), ['/api/stocks/102/adjust']);
  assert.equal(inventoryRequests[0].body.delta, 1);

  vm.runInContext('savingAll = true; inventoryState.stockLocationPickerState = null;', sandbox);
  sandbox.changeQty(2, 1);
  assert.equal(sandbox.pending['2'], undefined, '儲存中不得立刻修改單位置品項的 pending');
  sandbox.changeQty(2, -1);
  assert.equal(sandbox.pending['2'], undefined, '儲存中不得建立負向 pending');
  sandbox.changeQty(1, 1);
  assert.equal(sandbox.inventoryState.stockLocationPickerState, null, '儲存中不得打開位置選擇器');
  const openModalCount = openedModals.length;
  sandbox.changeQty(3, 1);
  assert.equal(openedModals.length, openModalCount, '儲存中不得打開小數數量輸入對話框');
  sandbox.queueInventoryAdjustment(sandbox.appState.ALL_ITEMS[1], 1);
  assert.equal(sandbox.pending['2'], undefined, '共用 queue 必須攔截所有調整入口');
  assert.equal(sandbox.pendingByStock['101'], undefined);
  vm.runInContext('savingAll = false; inventoryState.stockLocationPickerState = null;', sandbox);

  inventoryRequests.length = 0;
  sandbox.failNextSave = true;
  sandbox.changeQty(1, 1);
  sandbox.queueStockLocationAdjustment(1, 101);
  await sandbox.saveAll();
  assert.equal(sandbox.pending['1'], 1, '失敗的調整應留在 pending');
  assert.equal(sandbox.pendingByStock['101'].delta, 1, '失敗的指定位置不得丟失');
  assert.equal(sandbox.INVENTORY_PENDING_ITEMS['1'].id, 1, '失敗時保留跨頁渲染需要的品項快照');
  await sandbox.saveAll();
  assert.equal(sandbox.pending['1'], undefined, '重試成功後才清除 pending');
  assert.equal(sandbox.INVENTORY_PENDING_ITEMS['1'], undefined, '成功後才清除品項快照');
  assert.deepEqual(inventoryRequests.map(request => request.url), ['/api/stocks/101/adjust', '/api/stocks/101/adjust']);

  inventoryRequests.length = 0;
  sandbox.changeQty(2, 1);
  await sandbox.saveAll();
  assert.deepEqual(inventoryRequests.map(request => request.url), ['/api/items/2/adjust'], '單一位置品項保留原本快速 + 操作');

  inventoryRequests.length = 0;
  sandbox.changeQty(1, 1);
  sandbox.queueStockLocationAdjustment(1, 101);
  sandbox.changeQty(1, -1);
  assert.equal(sandbox.pending['1'], undefined);
  assert.equal(sandbox.pendingByStock['101'], undefined);
  await sandbox.saveAll();
  assert.deepEqual(inventoryRequests, [], '取消的暫存加量不得送出');

  sandbox.changeQty(1, -1);
  sandbox.changeQty(1, 1);
  sandbox.queueStockLocationAdjustment(1, 102);
  inventoryRequests.length = 0;
  await sandbox.saveAll();
  assert.deepEqual(inventoryRequests.map(request => request.url), ['/api/stocks/102/adjust', '/api/items/1/adjust'], '有抵銷的多位置操作先入庫、再出庫');
  assert.deepEqual(inventoryRequests.map(request => request.body.delta), [1, -1]);

  inventoryRequests.length = 0;
  sandbox.prompt = () => { throw new Error('多位置點數量不可再使用 prompt'); };
  sandbox.quickSet(1);
  assert.equal(openedModals.at(-1), 'qty-dialog', '多位置品項點數量應直接開啟增減 Dialog');
  assert.equal(elements['qtyd-direction'].hidden, false, '多位置點數量應顯示 +／− 方向選擇');
  assert.equal(sandbox.__qtyMode, 'add', '新開的方向選擇 Dialog 預設增加');
  elements['qtyd-input'].value = '0.5';
  sandbox.submitQtyDialog();
  assert.equal(sandbox.pending['1'], undefined, '整數單位方向 Dialog 必須使用正式 Qty 驗證並拒絕小數');
  assert.equal(sandbox.inventoryState.stockLocationPickerState, null, '非法數量不得進入儲位選擇');
  sandbox.setQtyDialogMode('sub');
  assert.equal(sandbox.__qtyMode, 'sub');
  assert.equal(elements['qtyd-title'].textContent, '➖ 減少庫存');
  assert.equal(elements['qtyd-mode-add'].attributes['aria-pressed'], 'false');
  assert.equal(elements['qtyd-mode-sub'].attributes['aria-pressed'], 'true');
  assert.equal(elements['qtyd-mode-add'].classList.contains('is-active'), false);
  assert.equal(elements['qtyd-mode-sub'].classList.contains('is-active'), true);
  elements['qtyd-input'].value = '2';
  sandbox.submitQtyDialog();
  assert.equal(sandbox.pending['1'], -2, '減少模式應排入 aggregate 負向 delta');
  assert.equal(sandbox.inventoryState.stockLocationPickerState, null, '減少沿用既有 aggregate 扣減，不要求新增儲位選擇');
  await sandbox.saveAll();
  assert.deepEqual(inventoryRequests.map(request => request.url), ['/api/items/1/adjust']);
  assert.equal(inventoryRequests[0].body.delta, -2);

  inventoryRequests.length = 0;
  sandbox.quickSet(1);
  assert.equal(elements['qtyd-direction'].hidden, false);
  assert.equal(sandbox.__qtyMode, 'add', '每次開啟都重設預設方向，不沿用前次減少狀態');
  assert.equal(elements['qtyd-title'].textContent, '➕ 增加庫存');
  assert.equal(elements['qtyd-mode-add'].attributes['aria-pressed'], 'true');
  assert.equal(elements['qtyd-mode-sub'].attributes['aria-pressed'], 'false');
  assert.equal(elements['qtyd-mode-add'].classList.contains('is-active'), true);
  assert.equal(elements['qtyd-mode-sub'].classList.contains('is-active'), false);
  elements['qtyd-input'].value = '1';
  sandbox.submitQtyDialog();
  assert.equal(openedModals.at(-1), 'stock-location-modal', '多位置 Dialog 加量後仍須選儲位');
  assert.equal(sandbox.inventoryState.stockLocationPickerState.delta, 1);
  sandbox.queueStockLocationAdjustment(1, 102);
  await sandbox.saveAll();
  assert.deepEqual(inventoryRequests.map(request => request.url), ['/api/stocks/102/adjust']);

  inventoryRequests.length = 0;
  sandbox.prompt = () => '5';
  sandbox.quickSet(2);
  assert.equal(sandbox.pending['2'], 1, '單一位置品項點數字維持輸入目標總量');
  await sandbox.saveAll();
  assert.deepEqual(inventoryRequests.map(request => request.url), ['/api/items/2/adjust']);

  sandbox.__qtyTargetId = 3;
  sandbox.__qtyMode = 'add';
  elements['qtyd-input'] = { value: '0.5' };
  sandbox.submitQtyDialog();
  assert.equal(openedModals.at(-1), 'stock-location-modal', '小數單位加量也必須選擇位置');
  sandbox.queueStockLocationAdjustment(3, 302);
  inventoryRequests.length = 0;
  await sandbox.saveAll();
  assert.deepEqual(inventoryRequests.map(request => request.url), ['/api/stocks/302/adjust']);
  assert.equal(inventoryRequests[0].body.delta, 0.5);

  inventoryRequests.length = 0;
  sandbox.quickSet(4);
  assert.equal(elements['qtyd-direction'].hidden, false, '分數單位多位置總數點擊也須顯示方向控制');
  elements['qtyd-input'].value = '1/2';
  sandbox.submitQtyDialog();
  assert.equal(sandbox.inventoryState.stockLocationPickerState.delta, 0.5, '方向 Dialog 必須使用正式 parser 接受分數輸入');
  sandbox.queueStockLocationAdjustment(4, 402);
  await sandbox.saveAll();
  assert.deepEqual(inventoryRequests.map(request => request.url), ['/api/stocks/402/adjust']);
  assert.equal(inventoryRequests[0].body.delta, 0.5);

  const editBox = { innerHTML: '' };
  const editContext = {
    document: { getElementById: id => id === 'edit-stock-rows' ? editBox : null },
    esc: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;'),
    toast: message => { editContext.lastToast = message; },
    appState: { globalCabinetList: [] },
    unitList: [],
  };
  vm.createContext(editContext);
  loadModules(editContext, 'core/qty.js', 'features/inventory/edit-modal.js');
  editContext.renderEditStockRows([{ id: 101, location: '編號A | 1-1', qty: 0, note: '' }], '個');
  assert.match(editBox.innerHTML, /deleteEditStockRow\(this\)/, '既有位置列需出現移除按鈕');
  assert.match(editBox.innerHTML, /data-stock-qty="0"/, '既有列需保存原始庫存量供安全移除判斷');

  const newRow = {
    dataset: {},
    innerHTML: '',
    querySelector: () => ({ focus: () => {} }),
  };
  editBox.children = [];
  editBox.appendChild = row => editBox.children.push(row);
  editContext.document.createElement = () => newRow;
  editContext.addEditStockRow();
  assert.ok(newRow.innerHTML.includes('deleteEditStockRow(this)'), '新增位置列也需出現移除按鈕');
  assert.equal(newRow.dataset.stockQty, '0', '新列原始數量需設為 0');

  let removed = false;
  const stockRow = {
    dataset: { stockId: '', stockQty: '0' },
    qty: '2',
    querySelector: () => ({ value: stockRow.qty }),
    remove: () => { removed = true; },
  };
  const rows = [stockRow, {}];
  const button = { closest: () => stockRow };
  editContext.document.getElementById = () => ({ querySelectorAll: () => rows });
  editContext.deleteEditStockRow(button);
  assert.equal(removed, true, '未儲存的位置列可直接放棄');
  removed = false;
  stockRow.dataset.stockId = '101';
  stockRow.dataset.stockQty = '2';
  stockRow.qty = '0';
  editContext.deleteEditStockRow(button);
  assert.equal(removed, false, '已存非零位置即使表單暫改 0 也必須先保存歸零');
  assert.match(editContext.lastToast, /庫存/, '已存非零位置需提示先保存歸零再移除');
  stockRow.dataset.stockQty = '0';
  stockRow.qty = '2';
  editContext.deleteEditStockRow(button);
  assert.equal(removed, true, '已存數量歸零的位置可以移除');

  const editFields = {
    'e-name': { value: '測試品項' },
    'e-brand': { value: '測試廠牌' },
    'e-code': { value: 'TEST-01' },
    'e-lowstock': { value: '' },
    'e-unit': { value: '個' },
    'e-category': { value: '其他' },
  };
  editContext.document.getElementById = id => editFields[id] || null;
  editContext.document.querySelectorAll = () => [];
  editContext.editItemId = 1;
  editContext.editUpdatedAt = '2026-09-29T00:00:00';
  let patchRequests = 0;
  editContext.fetch = async () => { patchRequests += 1; return { ok: true }; };
  for (const [field, label] of [['e-brand', '廠牌'], ['e-code', '型號'], ['e-name', '品項名稱']]) {
    editFields[field].value = '   ';
    await editContext.submitEdit();
    assert.match(editContext.lastToast, new RegExp(`${label}必填`), `${label}空白需顯示必填錯誤`);
    assert.equal(patchRequests, 0, `${label}空白時不得送出 PATCH`);
    editFields[field].value = field === 'e-brand' ? '測試廠牌' : field === 'e-code' ? 'TEST-01' : '測試品項';
  }
  await editContext.submitEdit();
  assert.match(editContext.lastToast, /位置必填/, '缺少庫存位置需顯示必填錯誤');
  assert.equal(patchRequests, 0, '缺少庫存位置時不得送出 PATCH');
  console.log('inventory location runtime contracts passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
