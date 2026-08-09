// 振佳空調庫存管理系統 - 編輯品項 Modal（v10：多位置 stocks）
// ========== 編輯品項 ==========
function openEditModal(id) {
  const item = ALL_ITEMS.find(i => i.id === id);
  if (!item) return;
  editItemId = id;
  document.getElementById('e-brand').value = item.brand || '';
  document.getElementById('e-code').value = item.code || '';
  document.getElementById('e-name').value = item.name || '';
  document.getElementById('e-unit').value = item.unit || '個';
  document.getElementById('e-lowstock').value = item.low_stock || 0;
  document.getElementById('e-site').value = item.site || 'office';
  // v10：位置清單（從 stocks 展開，每列一個位置）
  const stocks = item.stocks && item.stocks.length
    ? item.stocks
    : [{ location: item.location || '', qty: item.qty || 0, note: item.note || '' }];
  renderEditStockRows(stocks);
  // v10.1：照片區塊 + 相似品項提示（排除自己）
  renderPhotoBox(id, !!item.has_photo);
  const warnBox = document.getElementById('e-similar-warn');
  warnBox.style.display = 'none';
  warnBox.innerHTML = '';
  openModal('edit-modal');
  // 名稱/型號輸入時即時檢查相似（350ms debounce）
  bindSimilarCheck('e-name', 'e-code', 'e-similar-warn', id);
}

// 渲染編輯 modal 的位置清單列
function renderEditStockRows(stocks) {
  const box = document.getElementById('edit-stock-rows');
  box.innerHTML = stocks.map((s, idx) => `
    <div class="stock-row" data-idx="${idx}">
      <input type="text" class="stock-loc" value="${esc(s.location || '')}" list="location-list" placeholder="位置">
      <input type="number" class="stock-qty" value="${s.qty ?? 0}" min="0" step="any" placeholder="數量">
      <input type="text" class="stock-note" value="${esc(s.note || '')}" placeholder="備註（選填）">
      <button type="button" class="btn-cancel stock-del" onclick="deleteEditStockRow(this)" ${stocks.length <= 1 ? 'disabled' : ''}>✕</button>
    </div>
  `).join('');
}

// 在編輯 Modal 新增一列位置庫存輸入列，並自動 focus 位置欄位方便連續輸入
function addEditStockRow() {
  const box = document.getElementById('edit-stock-rows');
  const idx = box.children.length;
  const row = document.createElement('div');
  row.className = 'stock-row';
  row.dataset.idx = idx;
  row.innerHTML = `
    <input type="text" class="stock-loc" list="location-list" placeholder="位置">
    <input type="number" class="stock-qty" value="0" min="0" step="any" placeholder="數量">
    <input type="text" class="stock-note" placeholder="備註（選填）">
    <button type="button" class="btn-cancel stock-del" onclick="this.closest('.stock-row').remove()">✕</button>
  `;
  // 新增後第一個 input（位置）自動 focus，方便連續輸入
  box.appendChild(row);
  row.querySelector('.stock-loc').focus();
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
  const payload = {
    brand: document.getElementById('e-brand').value.trim(),
    code: document.getElementById('e-code').value.trim(),
    // 名稱空白時不更新（保留原值），避免把原名覆蓋成空白
    ...(nameVal ? { name: nameVal } : {}),
    unit: document.getElementById('e-unit').value,
    low_stock: parseFloat(document.getElementById('e-lowstock').value) || 0,
    site: document.getElementById('e-site').value,
    // v10：完整位置清單（全量替換）
    stocks: [...document.querySelectorAll('#edit-stock-rows .stock-row')].map(row => ({
      location: row.querySelector('.stock-loc').value.trim(),
      qty: parseFloat(row.querySelector('.stock-qty').value) || 0,
      note: row.querySelector('.stock-note').value.trim(),
    })),
  };
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
    closeModal('edit-modal');
    toast('✅ 已儲存修改', 'success');
    await loadData();
  } catch (e) {
    toast('儲存失敗', 'error');
  }
}