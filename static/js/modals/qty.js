// modals/qty.js — 庫存數量增減 Dialog（2026-09-12 數量系統）
// 非整數單位 +/- 按鈕固定方向輸入；多位置品項點總數時可在 Dialog 選擇 +/−。
// 依賴：utils.js（esc/toast/openModal/closeModal）、qty.js（Qty）、render/inventory.js（pending/renderInventory/ALL_ITEMS）
var __qtyTargetId = null;
var __qtyMode = 'add';

/**
 * Open the quantity dialog, optionally exposing a direction choice for aggregate edits.
 * @param {number} itemId - Inventory item identifier.
 * @param {'add'|'sub'|'choose'} mode - Fixed direction or user-selected direction.
 * @returns {void}
 */
function openQtyDialog(itemId, mode) {
  const item = (typeof ALL_ITEMS !== 'undefined' ? ALL_ITEMS : []).find(i => i.id === itemId);
  if (!item) return;
  __qtyTargetId = itemId;
  __qtyMode = mode === 'sub' ? 'sub' : 'add';
  const direction = document.getElementById('qtyd-direction');
  if (direction) direction.hidden = mode !== 'choose';
  const cur = item.qty + ((typeof pending !== 'undefined' && pending[itemId]) || 0);
  document.getElementById('qtyd-cur').value =
    Qty.formatWithUnit(Math.round(cur * 1000) / 1000, item.unit, Qty.unitTypeOf(item.unit));
  document.getElementById('qtyd-name').value = (item.brand ? item.brand + ' ' : '') + (item.name || '');
  const inp = document.getElementById('qtyd-input');
  inp.value = '';
  inp.placeholder = '例如 1/4、1/3、0.5、1';
  setQtyDialogMode(__qtyMode);
  openModal('qty-dialog');
  setTimeout(() => inp.focus(), 50);
}

/**
 * Set the quantity dialog direction and synchronize its accessible controls.
 * @param {'add'|'sub'} mode - Direction to select.
 * @returns {void}
 */
function setQtyDialogMode(mode) {
  __qtyMode = mode === 'sub' ? 'sub' : 'add';
  const title = document.getElementById('qtyd-title');
  if (title) title.textContent = __qtyMode === 'add' ? '➕ 增加庫存' : '➖ 減少庫存';
  const addButton = document.getElementById('qtyd-mode-add');
  const subButton = document.getElementById('qtyd-mode-sub');
  if (addButton) addButton.setAttribute('aria-pressed', String(__qtyMode === 'add'));
  if (subButton) subButton.setAttribute('aria-pressed', String(__qtyMode === 'sub'));
}

function qtydQuick(v) {
  document.getElementById('qtyd-input').value = v;
  document.getElementById('qtyd-input').focus();
}

/**
 * Validate the entered amount, then queue it through the same location-aware adjustment flow.
 * @returns {void}
 */
function submitQtyDialog() {
  if (typeof savingAll !== 'undefined' && savingAll) {
    toast('儲存中，請稍後再調整。', 'info');
    return;
  }
  const item = (typeof ALL_ITEMS !== 'undefined' ? ALL_ITEMS : []).find(i => Number(i.id) === Number(__qtyTargetId));
  if (!item) { closeModalForce('qty-dialog'); return; }
  const raw = document.getElementById('qtyd-input').value;
  const parsed = Qty.validFor(raw, Qty.inputTypeOf(item.unit));
  if (!parsed.ok) { toast(parsed.error, 'error'); return; }
  if (parsed.value <= 0) { toast('增減數量必須大於 0。', 'error'); return; }
  const signed = __qtyMode === 'add' ? parsed.value : -parsed.value;
  const current = (typeof pending !== 'undefined' && pending[item.id]) || 0;
  if (item.qty + current + signed < 0) { toast('減少後庫存不可為負數。', 'error'); return; }
  closeModalForce('qty-dialog');
  queueInventoryAdjustment(item, signed);
}
