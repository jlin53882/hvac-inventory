/**
 * Queue a quantity change with explicit multi-location targeting and save-in-flight protection.
 * @param {Object} item - Inventory item with its persisted stock rows.
 * @param {number} delta - Signed quantity change to queue.
 * @returns {void}
 */
function queueInventoryAdjustment(item, delta) {
  if (typeof savingAll !== 'undefined' && savingAll) {
    toast('儲存中，請稍後再調整。', 'info');
    return;
  }
  const amount = Math.round(Number(delta) * 1000) / 1000;
  if (!Number.isFinite(amount) || amount === 0) return;
  const stocks = Array.isArray(item.stocks) ? item.stocks : [];
  if (amount > 0 && stocks.length > 1) {
    openStockLocationPicker(item, amount);
    return;
  }
  if (applyPendingInventoryAdjustment(item, amount, null)) renderInventory();
}

/**
 * Update the pending net delta and preserve selected stock allocations for saving.
 * @param {Object} item - Inventory item whose aggregate quantity is changing.
 * @param {number} delta - Signed quantity change.
 * @param {number|null} stockId - Persisted target stock ID for a selected addition.
 * @returns {boolean} Whether the pending change was accepted.
 */
function applyPendingInventoryAdjustment(item, delta, stockId) {
  const itemId = String(item.id);
  const next = Math.round(((Number(pending[itemId]) || 0) + delta) * 1000) / 1000;
  if (Number(item.qty) + next < 0) return false;

  if (delta < 0) {
    const stockIds = Object.keys(pendingByStock).filter(function(key) {
      return String(pendingByStock[key].itemId) === itemId;
    }).reverse();
    let remaining = -delta;
    for (const key of stockIds) {
      if (remaining <= 0) break;
      const entry = pendingByStock[key];
      const cancelled = Math.min(entry.delta, remaining);
      entry.delta = Math.round((entry.delta - cancelled) * 1000) / 1000;
      remaining = Math.round((remaining - cancelled) * 1000) / 1000;
      if (entry.delta <= 0) delete pendingByStock[key];
    }
  }

  if (stockId !== null && delta > 0) {
    const key = String(stockId);
    const entry = pendingByStock[key];
    if (entry && String(entry.itemId) !== itemId) {
      toast('位置資料已變更，請重新載入後再試', 'error');
      return false;
    }
    pendingByStock[key] = {
      itemId: Number(item.id),
      delta: Math.round(((entry ? entry.delta : 0) + delta) * 1000) / 1000,
    };
  }

  const hasSelectedStock = Object.keys(pendingByStock).some(function(key) {
    return String(pendingByStock[key].itemId) === itemId;
  });
  if (next === 0 && !hasSelectedStock) {
    delete pending[itemId];
    if (typeof INVENTORY_PENDING_ITEMS !== 'undefined') delete INVENTORY_PENDING_ITEMS[itemId];
  } else {
    pending[itemId] = next;
    if (typeof INVENTORY_PENDING_ITEMS !== 'undefined') INVENTORY_PENDING_ITEMS[itemId] = item;
  }
  return true;
}

/**
 * Open a picker that lists each exact location before a positive multi-location adjustment.
 * @param {Object} item - Item whose stock locations are offered.
 * @param {number} delta - Positive amount to queue after selection.
 * @returns {void}
 */
function openStockLocationPicker(item, delta) {
  const options = document.getElementById('stock-location-options');
  const title = document.getElementById('stock-location-title');
  const description = document.getElementById('stock-location-description');
  const stocks = (Array.isArray(item.stocks) ? item.stocks : []).filter(function(stock) {
    return Number.isSafeInteger(Number(stock.id));
  });
  if (!options || !title || !description || !stocks.length) {
    toast('找不到可選的位置，請重新載入品項', 'error');
    return;
  }

  stockLocationPickerState = { itemId: Number(item.id), delta: delta };
  const amount = typeof Qty !== 'undefined' ? Qty.format(delta, Qty.unitTypeOf(item.unit)) : String(delta);
  title.textContent = '選擇入庫位置';
  description.textContent = '增加 ' + amount + ' ' + (item.unit || '') + '，請選擇要放入的位置。';
  options.innerHTML = stocks.map(function(stock) {
    const location = stock.location || '未標示位置';
    const current = typeof Qty !== 'undefined'
      ? Qty.format(stock.qty || 0, Qty.unitTypeOf(item.unit)) : String(stock.qty || 0);
    return '<button type="button" class="stock-adjust-location-option" onclick="queueStockLocationAdjustment(' +
      Number(item.id) + ',' + Number(stock.id) + ')"><span class="stock-adjust-location-name">' + esc(location) +
      '</span><span class="stock-adjust-location-qty">目前 ' + esc(current) + ' ' + esc(item.unit || '') +
      '</span></button>';
  }).join('');
  openModal('stock-location-modal');
}

/**
 * Queue the selected location change and close the picker.
 * @param {number} itemId - Inventory item ID.
 * @param {number} stockId - Selected persisted stock ID.
 * @returns {void}
 */
function queueStockLocationAdjustment(itemId, stockId) {
  if (typeof savingAll !== 'undefined' && savingAll) {
    toast('儲存中，請稍後再調整。', 'info');
    return;
  }
  const state = stockLocationPickerState;
  const item = ALL_ITEMS.find(function(candidate) { return Number(candidate.id) === Number(itemId); });
  const stock = item && Array.isArray(item.stocks)
    ? item.stocks.find(function(candidate) { return Number(candidate.id) === Number(stockId); }) : null;
  if (!state || Number(state.itemId) !== Number(itemId) || !stock) {
    toast('位置資料已變更，請重新載入後再試', 'error');
    return;
  }
  if (!applyPendingInventoryAdjustment(item, state.delta, Number(stock.id))) return;
  stockLocationPickerState = null;
  closeModalForce('stock-location-modal');
  renderInventory();
}

/**
 * Cancel location selection without changing the pending inventory quantity.
 * @returns {void}
 */
function cancelStockLocationPicker() {
  stockLocationPickerState = null;
  closeModalForce('stock-location-modal');
}
