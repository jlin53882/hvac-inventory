// 庫存管理系統 - 批次改位置（2026-09-06 方案 A）

import { apiFetch } from '../../core/api-client.js';
import { loadData, renderInventoryView } from '../shell/data-refresh.js';
import { getAllItems } from '../../core/inventory-read-model.js';
import { inventoryState } from './state.js';
import { esc, toast } from '../../core/utils.js';
import { getFilteredInventoryItems } from './filters.js';

export var selectedStockIds = new Set();

export function toggleBatchMode() {
  inventoryState.batchMode = !inventoryState.batchMode;
  selectedStockIds.clear();
  var bt = document.getElementById('batch-toggle');
  if (bt) bt.classList.toggle('is-active', inventoryState.batchMode);
  document.getElementById('batch-num').textContent = 0;
  document.getElementById('batch-confirm').disabled = true;
  if (inventoryState.batchMode) {
    document.getElementById('batch-bar').classList.add('is-open');
  } else {
    document.getElementById('batch-bar').classList.remove('is-open');
  }
  renderInventoryView();
}

export function toggleStockSelect(stockId) {
  // stockId 可能是 number 或 string，統一轉 number
  const numId = Number(stockId);
  if (String(stockId).startsWith('item-')) {
    // 整筆品項選取：切換該品項所有 stocks
    const itemId = parseInt(String(stockId).replace('item-', ''));
    const item = getAllItems().find(i => i.id === itemId);
    if (item) {
      const allSelected = (item.stocks || []).every(s => selectedStockIds.has(s.id));
      (item.stocks || []).forEach(s => {
        if (allSelected) selectedStockIds.delete(s.id);
        else selectedStockIds.add(s.id);
      });
    }
  } else {
    if (selectedStockIds.has(numId)) selectedStockIds.delete(numId);
    else selectedStockIds.add(numId);
  }
  _syncBatchUI();
}

export function selectAllStocks() {
  // 全選/取消全選 toggle（尊重搜尋/品牌/分類篩選）
  const filtered = getFilteredInventoryItems();
  const allStocks = filtered.flatMap(i => i.stocks || []);
  const allSelected = allStocks.length > 0 && allStocks.every(s => selectedStockIds.has(s.id));
  if (allSelected) {
    selectedStockIds.clear();
  } else {
    allStocks.forEach(s => selectedStockIds.add(s.id));
  }
  _syncBatchUI();
}

export function _allSelected() {
  const filtered = getFilteredInventoryItems();
  const allStocks = filtered.flatMap(i => i.stocks || []);
  return allStocks.length > 0 && allStocks.every(s => selectedStockIds.has(s.id));
}

function _syncBatchUI() {
  document.getElementById('batch-num').textContent = selectedStockIds.size;
  document.getElementById('batch-confirm').disabled = selectedStockIds.size === 0;
  document.getElementById('batch-bar').classList.toggle('is-open', selectedStockIds.size > 0);
  renderInventoryView();
}

export function cancelBatch() {
  selectedStockIds.clear();
  document.getElementById('batch-bar').classList.remove('is-open');
  document.getElementById('batch-cabinet').value = '';
  document.getElementById('batch-sub').value = '';
  renderInventoryView();
}

export function showBatchConfirm() {
  var cab = document.getElementById('batch-cabinet').value;
  if (!cab) { toast('\u26a0\ufe0f \u8acb\u5148\u9078\u64c7\u76ee\u6a19\u6ac3\u5b50'); return; }
  var sub = document.getElementById('batch-sub').value.trim();
  var target = sub ? cab + ' | ' + sub : cab;
  var targetDisplay = target;
  document.getElementById('batch-confirm-count').textContent = selectedStockIds.size;
  document.getElementById('batch-confirm-loc').textContent = targetDisplay;
  var details = [];
  getAllItems().forEach(function(item) {
    (item.stocks || []).forEach(function(s) {
      if (selectedStockIds.has(s.id)) {
        details.push('<div class="modal-item-row"><span>' + esc(item.brand) + ' ' + esc(item.name) + '</span><span class="modal-item-from">' + esc(s.location) + ' \u2192 <b class="modal-item-to">' + esc(target) + '</b></span></div>');
      }
    });
  });
  document.getElementById('batch-confirm-items').innerHTML = details.join('');
  document.getElementById('batch-confirm-modal').classList.add('is-open');
}

export function closeBatchConfirm() {
  document.getElementById('batch-confirm-modal').classList.remove('is-open');
}

export async function submitBatchLocation() {
  var cab = document.getElementById('batch-cabinet').value;
  var sub = document.getElementById('batch-sub').value.trim();
  var target = sub ? cab + ' | ' + sub : cab;
  var targetDisplay = target;
  closeBatchConfirm();
  try {
    await apiFetch('/api/stocks/batch-location', {
      method: 'POST',
      json: { stock_ids: Array.from(selectedStockIds), new_location: target },
      fallback: '\u6279\u6b21\u66f4\u65b0\u5931\u6557'
    });
    toast('\u2705 \u5df2\u5c07 ' + selectedStockIds.size + ' \u7b0c\u4f4d\u7f6e\u6539\u70ba\u300c' + targetDisplay + '\u300d');
    cancelBatch();
    await loadData();
  } catch (e) {
    toast('\u26a0\ufe0f ' + e.message, 'error');
  }
}
