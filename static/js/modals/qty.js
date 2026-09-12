// modals/qty.js — 分數/小數單位增減 dialog（2026-09-12 數量系統）
// 整數單位維持 changeQty 直調 ±1；非整數單位點 +/- 開此 dialog 輸入增減量。
// 依賴：utils.js（esc/toast/openModal/closeModal）、qty.js（Qty）、render/inventory.js（pending/renderInventory/ALL_ITEMS）
var __qtyTargetId = null;
var __qtyMode = 'add';

function openQtyDialog(itemId, mode) {
  const item = (typeof ALL_ITEMS !== 'undefined' ? ALL_ITEMS : []).find(i => i.id === itemId);
  if (!item) return;
  __qtyTargetId = itemId;
  __qtyMode = mode === 'sub' ? 'sub' : 'add';
  const cur = item.qty + ((typeof pending !== 'undefined' && pending[itemId]) || 0);
  document.getElementById('qtyd-title').textContent = (__qtyMode === 'add' ? '➕ 增加庫存' : '➖ 減少庫存');
  document.getElementById('qtyd-cur').value =
    Qty.formatWithUnit(Math.round(cur * 1000) / 1000, item.unit, Qty.unitTypeOf(item.unit));
  document.getElementById('qtyd-name').value = (item.brand ? item.brand + ' ' : '') + (item.name || '');
  const inp = document.getElementById('qtyd-input');
  inp.value = __qtyMode === 'add' ? '' : '';
  inp.placeholder = '例如 1/4、1/3、0.5、1';
  openModal('qty-dialog');
  setTimeout(() => inp.focus(), 50);
}

function qtydQuick(v) {
  document.getElementById('qtyd-input').value = v;
  document.getElementById('qtyd-input').focus();
}

function submitQtyDialog() {
  const item = (typeof ALL_ITEMS !== 'undefined' ? ALL_ITEMS : []).find(i => i.id === __qtyTargetId);
  if (!item) { closeModalForce('qty-dialog'); return; }
  const raw = document.getElementById('qtyd-input').value;
  const v = Qty.validFor(raw, Qty.unitTypeOf(item.unit));
  if (!v.ok) { toast(v.error, 'error'); return; }
  if (v.value <= 0) { toast('增減數量必須大於 0。', 'error'); return; }
  const signed = __qtyMode === 'add' ? v.value : -v.value;
  const cur = (typeof pending !== 'undefined' && pending[item.id]) || 0;
  const next = Math.round((cur + signed) * 1000) / 1000;
  if (item.qty + next < 0) { toast('減少後庫存不可為負數。', 'error'); return; }
  if (next === 0) {
    delete pending[item.id];
    if (typeof INVENTORY_PENDING_ITEMS !== 'undefined') delete INVENTORY_PENDING_ITEMS[item.id];
  } else {
    pending[item.id] = next;
    if (typeof INVENTORY_PENDING_ITEMS !== 'undefined') INVENTORY_PENDING_ITEMS[item.id] = item;
  }
  closeModalForce('qty-dialog');
  renderInventory();
}
