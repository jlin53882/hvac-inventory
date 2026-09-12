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

// 渲染編輯 modal 的位置清單列（兩段式：櫃子下拉 + 位置輸入）
// 2026-09-12：數量載入即格式化（0.333…→1/3，不再顯示一串小數；type=number 照樣可填分數）
function renderEditStockRows(stocks, unit) {
  const box = document.getElementById('edit-stock-rows');
  const _t = (typeof Qty !== 'undefined') ? Qty.unitTypeOf(unit) : 'fraction';
  box.innerHTML = stocks.map((s, idx) => {
    // 解析 location：「編號A | 1-1」→ cabinet=編號A, sub=1-1
    const loc = s.location || '';
    const pipeIdx = loc.indexOf(' | ');
    const cabinet = pipeIdx >= 0 ? loc.substring(0, pipeIdx) : loc;
    const sub = pipeIdx >= 0 ? loc.substring(pipeIdx + 3) : '';
    const qv = (typeof Qty !== 'undefined') ? Qty.format(s.qty ?? 0, _t) : (s.qty ?? 0);
    return `
    <div class="stock-row" data-idx="${idx}">
      <select class="stock-cabinet">${_cabinetOptions(cabinet)}</select>
      <input type="text" class="stock-sub" value="${esc(sub)}" list="location-list" placeholder="位置">
      <input type="number" class="stock-qty" value="${esc(qv)}" min="0" step="any" placeholder="數量">
      <input type="text" class="stock-note" value="${esc(s.note || '')}" placeholder="備註（選填）">
    </div>`;
  }).join('');
}

// 產生櫃子下拉 options
function _cabinetOptions(selected) {
  const cabs = ['','編號A','編號B','編號C','編號D','編號E','編號F','鐵架','二樓'];
  return cabs.map(c => `<option value="${c}" ${c === selected ? 'selected' : ''}>${c || '— 請選擇 —'}</option>`).join('');
}

// 在編輯 Modal 新增一列位置庫存輸入列
function addEditStockRow() {
  const box = document.getElementById('edit-stock-rows');
  const idx = box.children.length;
  const row = document.createElement('div');
  row.className = 'stock-row';
  row.dataset.idx = idx;
  row.innerHTML = `
    <select class="stock-cabinet">${_cabinetOptions('')}</select>
    <input type="text" class="stock-sub" list="location-list" placeholder="位置">
    <input type="number" class="stock-qty" value="0" min="0" step="any" placeholder="數量">
    <input type="text" class="stock-note" placeholder="備註（選填）">
  `;
  box.appendChild(row);
  row.querySelector('.stock-sub').focus();
}

// 刪除編輯 Modal 中指定按鈕所在的庫存列（至少保留一列）
function deleteEditStockRow(btn) {
  const box = document.getElementById('edit-stock-rows');
  if (box.querySelectorAll('.stock-row').length <= 1) return;
  btn.closest('.stock-row').remove();
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
    site: document.getElementById('e-site').value,
    category: document.getElementById('e-category').value,
    // v10：完整位置清單（全量替換）
    stocks: [...document.querySelectorAll('#edit-stock-rows .stock-row')].map(row => {
      const cab = row.querySelector('.stock-cabinet').value;
      const sub = row.querySelector('.stock-sub').value.trim();
      const location = cab ? (sub ? `${cab} | ${sub}` : cab) : '';
      // 2026-09-12：分數/小數單位可輸 1/4；非法整包擋下（qtyInputOrToast 已 toast）
      const _qq = (function() {
        if (typeof Qty === 'undefined') { const _p = parseFloat(row.querySelector('.stock-qty').value); return isNaN(_p) || _p < 0 ? 0 : _p; }
        let _t = Qty.unitTypeOf(document.getElementById('e-unit').value);
        const _vv = Qty.validFor(row.querySelector('.stock-qty').value, _t);
        if (!_vv.ok) { toast(_vv.error, 'error'); return null; }
        return _vv.value;
      })();
      if (_qq === null) return null;
      return {
        location: location,
        qty: _qq,
        note: row.querySelector('.stock-note').value.trim(),
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