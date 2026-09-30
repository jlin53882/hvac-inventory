// 庫存管理系統 - 編輯品項 Modal（v10：多位置 stocks）

import { apiFetch } from '../../core/api-client.js';
import { Qty, qtyInputOrToast } from '../../core/qty.js';
import { appState, INVENTORY_ALERT_ITEMS } from '../../core/state.js';
import { getGlobalCabinetList } from '../../core/shared-read-model.js';
import { getAllItems } from '../../core/inventory-read-model.js';
import { inventoryState } from './state.js';
import { fillUnitSelect } from '../../core/units.js';
import { closeModalForce, esc, hasPerm, openModal, toast } from '../../core/utils.js';
import { loadData } from '../shell/data-refresh.js';
import { bindSimilarCheck, renderPhotoBox } from './photo.js';

var editUpdatedAt = null;  // 2026-08-14 樂觀鎖：開啟編輯 modal 時的 updated_at 快照（併發防覆蓋）
// ========== 編輯品項 ==========
function getInventoryEditableItem(id) {
  const numericId = Number(id);
  const current = Array.isArray(getAllItems()) ? getAllItems().find(i => Number(i.id) === numericId) : null;
  if (current) return current;
  return INVENTORY_ALERT_ITEMS[String(numericId)] || null;
}

export function openEditModal(id) {
  const item = getInventoryEditableItem(id);
  if (!item) return;
  inventoryState.editItemId = id;
  editUpdatedAt = item.updated_at || null;  // 快照：儲存時帶回後端做 WHERE 守衛
  document.getElementById('e-brand').value = item.brand || '';
  document.getElementById('e-code').value = item.code || '';
  document.getElementById('e-name').value = item.name || '';
  fillUnitSelect(document.getElementById('e-unit'), item.unit || '個');  // 2026-08-16 動態清單（歷史值自動補「（歷史）」）
  // 2026-08-16：快速新增單位按鈕（item-mgmt 才顯示）
  const eUnitAdd = document.getElementById('e-unit-add');
  if (eUnitAdd) eUnitAdd.style.display = hasPerm('item-mgmt') ? '' : 'none';
  const eUnitSearch = document.getElementById('e-unit-search');
  if (eUnitSearch) eUnitSearch.value = '';  // 重開 modal 清空搜尋
  document.getElementById('e-lowstock').value = item.low_stock || 0;
  document.getElementById('e-site').value = item.site || 'office';
  document.getElementById('e-site').disabled = true;
  document.getElementById('e-category').value = item.category || '';
  // v10：位置清單（從 stocks 展開，每列一個位置）
  const stocks = item.stocks && item.stocks.length
    ? item.stocks
    : [{ location: item.location || '', qty: item.qty || 0, note: item.note || '' }];
  renderEditStockRows(stocks, item.unit || '個');
  // v10.1：照片區塊 + 相似品項提示（排除自己）
  renderPhotoBox(id, !!item.has_photo);
  const warnBox = document.getElementById('e-similar-warn');
  warnBox.style.display = 'none';
  warnBox.innerHTML = '';
  openModal('edit-modal');
  // 2026-09-27：編輯時也載入最新櫃子清單
  (async () => {
    try {
      appState.globalCabinetList = await apiFetch('/api/cabinets');
      // 重新渲染位置列表（更新櫃子選項）
      renderEditStockRows(stocks, item.unit || '個');
    } catch (e) {
      console.warn('編輯 modal 載入櫃子清單失敗', e);
    }
  })();
  // 名稱/型號輸入時即時檢查相似（350ms debounce）
  bindSimilarCheck('e-name', 'e-code', 'e-similar-warn', id);
}

/**
 * Render editable location rows with mobile labels and a remove control.
 * @param {Array<Object>} stocks - Persisted stock rows belonging to the item.
 * @param {string} unit - Unit used to format quantities.
 * @returns {void}
 */
function renderEditStockRows(stocks, unit) {
  const box = document.getElementById('edit-stock-rows');
  const qtyType = Qty.unitTypeOf(unit);
  box.innerHTML = stocks.map((stock, index) => {
    const location = stock.location || '';
    const separator = location.indexOf(' | ');
    const cabinet = separator >= 0 ? location.substring(0, separator) : location;
    const subLocation = separator >= 0 ? location.substring(separator + 3) : '';
    const quantity = Qty.format(stock.qty ?? 0, qtyType);
    const stockId = stock.id != null ? stock.id : '';
    const revision = stock.updated_at || '';
    return `
    <div class="stock-row" data-role="stock-row" data-idx="${esc(String(index))}" data-stock-id="${esc(String(stockId))}" data-stock-qty="${esc(String(stock.qty ?? 0))}" data-stock-updated-at="${esc(revision)}">
      <label class="stock-field stock-field-cabinet"><span class="stock-mobile-label">櫃子*</span><select class="stock-cabinet" data-role="stock-cabinet">${_cabinetOptions(cabinet)}</select></label>
      <label class="stock-field stock-field-sub"><span class="stock-mobile-label">位置(選填)</span><input type="text" class="stock-sub" data-role="stock-sub" value="${esc(subLocation)}" list="location-list" placeholder="位置"></label>
      <label class="stock-field stock-field-qty"><span class="stock-mobile-label">數量(選填)</span><input type="text" inputmode="decimal" class="stock-qty" data-role="stock-qty" value="${esc(quantity)}" placeholder="數量（可輸 1/4）"></label>
      <label class="stock-field stock-field-note"><span class="stock-mobile-label">備註(選填)</span><input type="text" class="stock-note" data-role="stock-note" value="${esc(stock.note || '')}" placeholder="備註（選填）"></label>
      <button type="button" class="stock-remove" data-action="inventory-edit-stock-remove" aria-label="移除第 ${esc(String(index + 1))} 個位置" title="移除此位置">✕</button>
    </div>`;
  }).join('');
}
export function _cabinetOptions(selected) {
  // 若全局清單為空，用預設值（應不會發生，除非 loadCabinets 還未完成）
  const cabs = [{ name: '', note: '' }, ...getGlobalCabinetList()];
  // 已存的櫃子若不在目前清單（清單尚未載入或櫃子已改名/刪除）→ 保留為選項，避免儲存時被靜默清空
  if (selected && !cabs.some(c => (c.name || '') === selected)) {
    cabs.push({ name: selected, note: '不在櫃子清單' });
  }
  return cabs.map(c => {
    const name = c.name || '';
    const label = name ? name + (c.note ? `(${c.note})` : '') : '— 請選擇 —';
    return `<option value="${esc(name)}" ${name === selected ? 'selected' : ''}>${esc(label)}</option>`;
  }).join('');
}

/**
 * Append a zero-quantity editable location row with a removable control.
 * @returns {void}
 */
export function addEditStockRow() {
  const box = document.getElementById('edit-stock-rows');
  const row = document.createElement('div');
  row.className = 'stock-row';
  row.dataset.role = 'stock-row';
  row.dataset.idx = box.children.length;
  row.dataset.stockId = '';
  row.dataset.stockUpdatedAt = '';
  row.dataset.stockQty = '0';
  row.innerHTML = `
    <label class="stock-field stock-field-cabinet"><span class="stock-mobile-label">櫃子*</span><select class="stock-cabinet" data-role="stock-cabinet">${_cabinetOptions('')}</select></label>
    <label class="stock-field stock-field-sub"><span class="stock-mobile-label">位置(選填)</span><input type="text" class="stock-sub" data-role="stock-sub" list="location-list" placeholder="位置"></label>
    <label class="stock-field stock-field-qty"><span class="stock-mobile-label">數量(選填)</span><input type="text" inputmode="decimal" class="stock-qty" data-role="stock-qty" value="0" placeholder="數量（可輸 1/4）"></label>
    <label class="stock-field stock-field-note"><span class="stock-mobile-label">備註(選填)</span><input type="text" class="stock-note" data-role="stock-note" placeholder="備註（選填）"></label>
    <button type="button" class="stock-remove" data-action="inventory-edit-stock-remove" aria-label="移除此位置" title="移除此位置">✕</button>
  `;
  box.appendChild(row);
  row.querySelector('[data-role="stock-sub"]').focus();
}

/**
 * Remove an empty persisted location or discard an unsaved row without risking stock loss.
 * @param {HTMLButtonElement} button - Remove control inside the location row.
 * @returns {void}
 */
export function deleteEditStockRow(button) {
  const box = document.getElementById('edit-stock-rows');
  const row = button && button.closest('[data-role="stock-row"]');
  if (!row) return;
  if (box.querySelectorAll('[data-role="stock-row"]').length <= 1) {
    toast('至少保留一個位置列；若要清空庫存，請先確認品項資料。', 'info');
    return;
  }

  const stockId = row.dataset.stockId || '';
  if (stockId) {
    const persistedQty = Number(row.dataset.stockQty);
    if (!Number.isFinite(persistedQty)) {
      toast('位置庫存快照不完整，請重新載入後再移除。', 'error');
      return;
    }
    if (Math.round(persistedQty * 1000) / 1000 !== 0) {
      toast('此位置目前仍有庫存，請先將數量調整為 0 並儲存；重新開啟編輯後再移除。', 'error');
      return;
    }
  }
  row.remove();
}

// 送出編輯表單（PATCH /api/items/{id}，位置庫存全量替換），成功後關閉 Modal 並重載資料
export async function submitEdit() {
  const nameVal = document.getElementById('e-name').value.trim();
  const brandVal = document.getElementById('e-brand').value.trim();
  const codeVal = document.getElementById('e-code').value.trim();
  if (!brandVal) { toast('廠牌必填', 'error'); return; }
  if (!codeVal) { toast('型號必填', 'error'); return; }
  if (!nameVal) { toast('品項名稱必填', 'error'); return; }
  // 2026-09-12：門檻支援分數（Qty.parse）
  const _lsRaw = document.getElementById('e-lowstock').value;
  const lowstockVal = (function() { const _p = Qty.parse(_lsRaw.trim() === '' ? '0' : _lsRaw); return _p.error ? NaN : _p.value; })();
  if (document.getElementById('e-lowstock').value !== '' && (isNaN(lowstockVal) || lowstockVal < 0)) {
    toast('警示值不能為負數', 'error'); return;
  }
  const stocks = [];
  for (const row of document.querySelectorAll('#edit-stock-rows [data-role="stock-row"]')) {
    const cabinet = row.querySelector('[data-role="stock-cabinet"]').value.trim();
    const sub = row.querySelector('[data-role="stock-sub"]').value.trim();
    const note = row.querySelector('[data-role="stock-note"]').value.trim();
    const qtyInput = row.querySelector('[data-role="stock-qty"]');
    const rawQty = qtyInput.value.trim();
    const qty = rawQty === '' ? 0 : qtyInputOrToast(qtyInput, document.getElementById('e-unit').value);
    if (typeof qty !== 'number' || isNaN(qty)) return;
    if (!row.dataset.stockId && !cabinet && !sub && qty === 0 && !note) continue;
    if (!cabinet) { toast('請選擇櫃子', 'error'); return; }
    const location = sub ? `${cabinet} | ${sub}` : cabinet;
    stocks.push({
      id: row.dataset.stockId !== '' ? Number(row.dataset.stockId) : null,
      location: location,
      qty: qty,
      note: note,
      stock_updated_at: row.dataset.stockUpdatedAt || null,
    });
  }
  if (!stocks.length) { toast('位置必填（至少選櫃子）', 'error'); return; }
  const payload = {
    brand: brandVal,
    code: codeVal,
    name: nameVal,
    unit: document.getElementById('e-unit').value,
    low_stock: isNaN(lowstockVal) ? 0 : lowstockVal,
    category: document.getElementById('e-category').value,
    stocks: stocks,
    // 2026-08-14 樂觀鎖：帶開啟時的 updated_at 快照，後端比對被他人改過 → 409
    updated_at: editUpdatedAt,
  };
  try {
    await apiFetch(`/api/items/${inventoryState.editItemId}`, { method: 'PATCH', json: payload, fallback: '儲存失敗' });
    closeModalForce('edit-modal');
    toast('✅ 已儲存修改', 'success');
    await loadData();
  } catch (e) {
    toast(e.status ? '⚠️ ' + e.message : '儲存失敗', 'error');
  }
}

// 點「去編輯」→ 關閉新增/編輯 modal、開該品項編輯 modal
export function goEditSimilar(id) {
  closeModalForce('add-modal');
  closeModalForce('edit-modal');
  openEditModal(id);
}
