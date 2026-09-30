// 庫存管理系統 - 庫存數量增減、儲存列與「全部儲存」

import { apiFetch } from '../../core/api-client.js';
import { loadData } from '../shell/data-refresh.js';
import { Qty } from '../../core/qty.js';
import { INVENTORY_PENDING_ITEMS, appState, pending, pendingByStock } from '../../core/state.js';
import { getAllItems } from '../../core/inventory-read-model.js';
import { toast } from '../../core/utils.js';
import { queueInventoryAdjustment } from './location-adjustments.js';
import { openQtyDialog } from './qty-dialog.js';
import { inventoryState } from './state.js';

/**
 * Save aggregate and explicitly targeted stock adjustments without discarding partial successes.
 * @returns {Promise<void>}
 */
export async function saveAll() {
  if (inventoryState.savingAll) return;
  const ids = Object.keys(pending);
  if (!ids.length) return;
  inventoryState.savingAll = true;
  const button = document.getElementById('btn-save');
  if (button) button.disabled = true;
  let ok = 0;
  let fail = 0;
  try {
    for (const id of ids) {
      const changes = Object.entries(pendingByStock)
        .filter(([, entry]) => String(entry.itemId) === String(id))
        .map(([stockId, entry]) => ({ stockId: stockId, delta: entry.delta }));
      const selectedTotal = changes.reduce((sum, change) => sum + change.delta, 0);
      const globalDelta = Math.round(((Number(pending[id]) || 0) - selectedTotal) * 1000) / 1000;
      const operations = [];
      if (globalDelta !== 0) {
        operations.push({
          url: `/api/items/${id}/adjust`,
          delta: globalDelta,
          stockId: null,
        });
      }
      changes.forEach(change => operations.push({
        url: `/api/stocks/${change.stockId}/adjust`,
        delta: change.delta,
        stockId: change.stockId,
      }));

      // Apply additions before subtractions so prepared-stock guards see the net-safe intermediate state.
      operations.sort((left, right) => Number(left.delta < 0) - Number(right.delta < 0));
      for (const operation of operations) {
        try {
          await apiFetch(operation.url, { method: 'POST', json: { delta: operation.delta, reason: '手動調整' } });
          ok++;
          pending[id] = Math.round(((Number(pending[id]) || 0) - operation.delta) * 1000) / 1000;
          if (operation.stockId !== null) {
            const current = pendingByStock[operation.stockId];
            if (current) {
              current.delta = Math.round((current.delta - operation.delta) * 1000) / 1000;
              if (current.delta <= 0) delete pendingByStock[operation.stockId];
            }
          }
        } catch (error) {
          fail++;
        }
      }
    }

    Object.keys(pending).forEach(function(id) {
      const hasSelectedStock = Object.keys(pendingByStock).some(function(stockId) {
        return String(pendingByStock[stockId].itemId) === String(id);
      });
      if (Math.abs(Number(pending[id]) || 0) < 0.0005 && !hasSelectedStock) {
        delete pending[id];
        delete INVENTORY_PENDING_ITEMS[id];
      }
    });
    await loadData();
    if (fail === 0) toast(`✅ 已儲存 ${ok} 項庫存調整`, 'success');
    else toast(`⚠️ ${ok} 成功，${fail} 失敗——失敗調整已保留，可修正後再儲存`, 'error');
  } finally {
    inventoryState.savingAll = false;
    if (button) button.disabled = false;
  }
}


// ========== 數量增減（暫存） ==========

/**
 * Queue a +/- adjustment while preventing new modal flows during a save batch.
 * @param {number} id - Inventory item ID.
 * @param {number} delta - Signed quantity change.
 * @returns {void}
 */
export function changeQty(id, delta) {
  if (inventoryState.savingAll) {
    toast('儲存中，請稍後再調整。', 'info');
    return;
  }
  const item = getAllItems().find(function(candidate) { return Number(candidate.id) === Number(id); });
  if (!item) return;
  if (Qty.inputTypeOf(item.unit) !== 'integer') {
    openQtyDialog(id, delta > 0 ? 'add' : 'sub'); return;
  }
  queueInventoryAdjustment(item, delta);
}

/**
 * Open a direction dialog for multi-location items or set a single-location total.
 * @param {number} id - Inventory item ID.
 * @returns {void}
 */
export function quickSet(id) {
  if (inventoryState.savingAll) {
    toast('儲存中，請稍後再調整。', 'info');
    return;
  }
  const item = getAllItems().find(function(candidate) { return Number(candidate.id) === Number(id); });
  if (!item) return;
  if (Array.isArray(item.stocks) && item.stocks.length > 1) {
    openQtyDialog(id, 'choose');
    return;
  }
  const currentDelta = Number(pending[id] || 0);
  const current = Number(item.qty) + currentDelta;
  const input = prompt(`輸入「${item.name}」的新數量：`, current);
  if (input === null) return;

  let value;
  const parsed = Qty.validFor(input, Qty.inputTypeOf(item.unit));
  if (!parsed.ok) { toast(parsed.error, 'error'); return; }
  value = parsed.value;
  const desiredDelta = Math.round((value - item.qty) * 1000) / 1000;
  queueInventoryAdjustment(item, Math.round((desiredDelta - currentDelta) * 1000) / 1000);
}


// 依 pending 是否有未儲存變更，顯示/隱藏底部「儲存變更」列

export function updateSaveBar() {

  const n = Object.keys(pending).length;

  const bar = document.getElementById('save-bar');

  if (n > 0 && appState.currentTab === 'inventory') {

    bar.classList.add('is-open');

    document.getElementById('pending-count').textContent = n;

  } else {

    bar.classList.remove('is-open');

  }

}
