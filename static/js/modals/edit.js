// 庫存管理系統 - 編輯品項 Modal（v10：多位置 stocks）
var editUpdatedAt = null;  // 2026-08-14 樂觀鎖：開啟編輯 modal 時的 updated_at 快照（併發防覆蓋）
// ========== 編輯品項 ==========
function getInventoryEditableItem(id) {
  const numericId = Number(id);
  const current = Array.isArray(ALL_ITEMS) ? ALL_ITEMS.find(i => Number(i.id) === numericId) : null;
  if (current) return current;
  if (typeof INVENTORY_ALERT_ITEMS !== 'undefined') return INVENTORY_ALERT_ITEMS[String(numericId)] || null;
  return null;
}

function openEditModal(id) {
  const item = getInventoryEditableItem(id);
  if (!item) return;
  editItemId = id;
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
  const qtyType = typeof Qty !== 'undefined' ? Qty.unitTypeOf(unit) : 'fraction';
  box.innerHTML = stocks.map((stock, index) => {
    const location = stock.location || '';
    const separator = location.indexOf(' | ');
    const cabinet = separator >= 0 ? location.substring(0, separator) : location;
    const subLocation = separator >= 0 ? location.substring(separator + 3) : '';
    const quantity = typeof Qty !== 'undefined' ? Qty.format(stock.qty ?? 0, qtyType) : (stock.qty ?? 0);
    const stockId = stock.id != null ? stock.id : '';
    const revision = stock.updated_at || '';
    return `
    <div class="stock-row" data-idx="${esc(String(index))}" data-stock-id="${esc(String(stockId))}" data-stock-qty="${esc(String(stock.qty ?? 0))}" data-stock-updated-at="${esc(revision)}">
      <label class="stock-field stock-field-cabinet"><span class="stock-mobile-label">櫃子</span><select class="stock-cabinet">${_cabinetOptions(cabinet)}</select></label>
      <label class="stock-field stock-field-sub"><span class="stock-mobile-label">位置</span><input type="text" class="stock-sub" value="${esc(subLocation)}" list="location-list" placeholder="位置"></label>
      <label class="stock-field stock-field-qty"><span class="stock-mobile-label">數量</span><input type="text" inputmode="decimal" class="stock-qty" value="${esc(quantity)}" placeholder="數量（可輸 1/4）"></label>
      <label class="stock-field stock-field-note"><span class="stock-mobile-label">備註</span><input type="text" class="stock-note" value="${esc(stock.note || '')}" placeholder="備註（選填）"></label>
      <button type="button" class="stock-remove" onclick="deleteEditStockRow(this)" aria-label="移除第 ${esc(String(index + 1))} 個位置" title="移除此位置">✕</button>
    </div>`;
  }).join('');
}

// 產生櫃子下拉 options
function _cabinetOptions(selected) {
  const cabs = ['','編號A','編號B','編號C','編號D','編號E','編號F','鐵架','二樓'];
  return cabs.map(c => `<option value="${c}" ${c === selected ? 'selected' : ''}>${c || '— 請選擇 —'}</option>`).join('');
}

/**
 * Append a zero-quantity editable location row with a removable control.
 * @returns {void}
 */
function addEditStockRow() {
  const box = document.getElementById('edit-stock-rows');
  const row = document.createElement('div');
  row.className = 'stock-row';
  row.dataset.idx = box.children.length;
  row.dataset.stockId = '';
  row.dataset.stockUpdatedAt = '';
  row.dataset.stockQty = '0';
  row.innerHTML = `
    <label class="stock-field stock-field-cabinet"><span class="stock-mobile-label">櫃子</span><select class="stock-cabinet">${_cabinetOptions('')}</select></label>
    <label class="stock-field stock-field-sub"><span class="stock-mobile-label">位置</span><input type="text" class="stock-sub" list="location-list" placeholder="位置"></label>
    <label class="stock-field stock-field-qty"><span class="stock-mobile-label">數量</span><input type="text" inputmode="decimal" class="stock-qty" value="0" placeholder="數量（可輸 1/4）"></label>
    <label class="stock-field stock-field-note"><span class="stock-mobile-label">備註</span><input type="text" class="stock-note" placeholder="備註（選填）"></label>
    <button type="button" class="stock-remove" onclick="deleteEditStockRow(this)" aria-label="移除此位置" title="移除此位置">✕</button>
  `;
  box.appendChild(row);
  row.querySelector('.stock-sub').focus();
}

/**
 * Remove an empty persisted location or discard an unsaved row without risking stock loss.
 * @param {HTMLButtonElement} button - Remove control inside the location row.
 * @returns {void}
 */
function deleteEditStockRow(button) {
  const box = document.getElementById('edit-stock-rows');
  const row = button && button.closest('.stock-row');
  if (!row) return;
  if (box.querySelectorAll('.stock-row').length <= 1) {
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
async function submitEdit() {
  const nameVal = document.getElementById('e-name').value.trim();
  if (!nameVal) toast('名稱未修改（保留原值）', 'info');
  // 2026-09-12：門檻支援分數（Qty.parse；無 Qty 回退 parseFloat）
  const _lsRaw = document.getElementById('e-lowstock').value;
  const lowstockVal = (typeof Qty !== 'undefined')
    ? (function() { const _p = Qty.parse(_lsRaw.trim() === '' ? '0' : _lsRaw); return _p.error ? NaN : _p.value; })()
    : parseFloat(_lsRaw);
  if (document.getElementById('e-lowstock').value !== '' && (isNaN(lowstockVal) || lowstockVal < 0)) {
    toast('警示值不能為負數', 'error'); return;
  }
  const payload = {
    brand: document.getElementById('e-brand').value.trim(),
    code: document.getElementById('e-code').value.trim(),
    // 名稱空白時不更新（保留原值），避免把原名覆蓋成空白
    ...(nameVal ? { name: nameVal } : {}),
    unit: document.getElementById('e-unit').value,
    low_stock: isNaN(lowstockVal) ? 0 : lowstockVal,
    category: document.getElementById('e-category').value,
    // v10：完整位置清單（全量替換）
    stocks: [...document.querySelectorAll('#edit-stock-rows .stock-row')].map(row => {
      const cab = row.querySelector('.stock-cabinet').value;
      const sub = row.querySelector('.stock-sub').value.trim();
      const location = cab ? (sub ? `${cab} | ${sub}` : cab) : '';
      // 2026-09-12：分數/小數單位可輸 1/4；非法整包擋下（qtyInputOrToast 已 toast，回 NaN→null）
      const _el = row.querySelector('.stock-qty');
      const _qv = qtyInputOrToast(_el, document.getElementById('e-unit').value);
      if (typeof _qv !== 'number' || isNaN(_qv)) return null;
      const _qq = _qv;
      // F2/F3：送回 stock id + stock_updated_at（existing = 有 id；new = 無 id）
      const sid = row.dataset.stockId;
      const srev = row.dataset.stockUpdatedAt;
      return {
        id: sid !== '' ? Number(sid) : null,
        location: location,
        qty: _qv,
        note: row.querySelector('.stock-note').value.trim(),
        stock_updated_at: srev || null,
      };
    }),
    // 2026-08-14 樂觀鎖：帶開啟時的 updated_at 快照，後端比對被他人改過 → 409
    updated_at: editUpdatedAt,
  };
  // 2026-09-12：任一位置數量非法（map 回 null，已 toast）→ 整包擋下不送
  if (payload.stocks.some(s => s === null)) return;
  try {
    const res = await fetch(`/api/items/${editItemId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      let msg = '儲存失敗';
      try { const err = await res.json(); if (err.detail) msg = err.detail; } catch {}
      toast('⚠️ ' + msg, 'error');
      return;
    }
    closeModalForce('edit-modal');
    toast('✅ 已儲存修改', 'success');
    await loadData();
  } catch (e) {
    toast('儲存失敗', 'error');
  }
}