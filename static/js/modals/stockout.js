// 庫存管理系統 - 出庫/待領出 Modal（v8 拆分）
// ========== 出庫 ==========
function openOutModal(id, ev) {
  if (ev) ev.stopPropagation();
  const item = ALL_ITEMS.find(i => i.id === id);
  if (!item) return;
  outItemId = id;
  document.getElementById('o-item-name').value = `${item.name}${item.brand ? ' (' + item.brand + ')' : ''}`;
  document.getElementById('o-item-stock').value = `${item.qty} ${item.unit}`;
  // v10：位置下拉（空白 = 依序扣全部位置）
  const sel = document.getElementById('o-location');
  const stocks = item.stocks && item.stocks.length ? item.stocks : [{ location: item.location || '' }];
  sel.innerHTML = '<option value="">全部位置（自動依序扣）</option>' +
    stocks.map(s => `<option value="${esc(s.location || '')}">${esc(s.location || '未標示')}（剩 ${s.qty}）</option>`).join('');
  document.getElementById('o-qty').value = '';
  document.getElementById('o-dest').value = '';
  document.getElementById('o-note').value = '';
  openModal('out-modal');
}

// 送出「已領出」表單（POST /api/stockout）：驗證數量與去向、扣庫存並記錄
async function submitStockOut() {
  const qty = parseFloat(document.getElementById('o-qty').value);
  const dest = document.getElementById('o-dest').value.trim();
  const note = document.getElementById('o-note').value.trim();
  const location = document.getElementById('o-location').value;
  const item = ALL_ITEMS.find(i => i.id === outItemId);

  if (!qty || qty <= 0) { toast('請輸入領出數量', 'error'); return; }
  if (!dest) { toast('請填寫去哪裡（客戶/案場/工地）', 'error'); return; }
  if (location) {
    const st = (item.stocks || []).find(s => s.location === location);
    if (st && qty > st.qty) { toast(`「${location}」庫存不足！只剩 ${st.qty} ${item.unit}`, 'error'); return; }
  } else if (qty > item.qty) { toast(`庫存不足！只剩 ${item.qty} ${item.unit}`, 'error'); return; }

  try {
    const res = await fetch('/api/stockout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: outItemId, qty: qty, destination: dest, note: note, location: location })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || '領出失敗');
    }
    closeModalForce('out-modal');
    toast(`✅ 已領出 ${qty} ${item.unit} → ${dest}`, 'success');
    await loadData();
  } catch (e) {
    toast('⚠️ ' + e.message, 'error');
  }
}

// ========== 非庫存品項出庫（2026-08-13 Sarah：直接新增不在庫存的東西，只記流水） ==========
function openNonStockOutModal() {
  document.getElementById('ns-name').value = '';
  document.getElementById('ns-code').value = '';
  fillUnitSelect(document.getElementById('ns-unit'), '個');  // 2026-08-16 動態清單
  // 2026-08-16：快速新增單位按鈕（item-mgmt 才顯示）
  const nsUnitAdd = document.getElementById('ns-unit-add');
  if (nsUnitAdd) nsUnitAdd.style.display = hasPerm('item-mgmt') ? '' : 'none';
  const nsUnitSearch = document.getElementById('ns-unit-search');
  if (nsUnitSearch) nsUnitSearch.value = '';  // 重開 modal 清空搜尋
  document.getElementById('ns-qty').value = '';
  document.getElementById('ns-dest').value = '';
  document.getElementById('ns-note').value = '';
  openModal('nonstock-out-modal');
}

async function submitNonStockOut() {
  const name = document.getElementById('ns-name').value.trim();
  const code = document.getElementById('ns-code').value.trim();
  const unit = document.getElementById('ns-unit').value.trim() || '個';
  const qty = parseFloat(document.getElementById('ns-qty').value);
  const dest = document.getElementById('ns-dest').value.trim();
  const note = document.getElementById('ns-note').value.trim();

  if (!name) { toast('請輸入品項名稱', 'error'); return; }
  if (!qty || qty <= 0) { toast('請輸入領出數量', 'error'); return; }
  if (!dest) { toast('請填寫去哪裡（客戶/案場/工地）', 'error'); return; }

  try {
    const res = await fetch('/api/stockout/nonstock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, code: code, unit: unit, qty: qty, destination: dest, note: note })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || '領出失敗');
    }
    closeModalForce('nonstock-out-modal');
    toast(`✅ 已領出 ${qty} ${unit} → ${dest}`, 'success');
    await loadData();
  } catch (e) {
    toast('⚠️ ' + e.message, 'error');
  }
}

// ========== 非庫存品項待領出（2026-08-13 家豪：比照已領出，待領出頁直接新增不在庫存的東西） ==========
function openNonStockPrepareModal() {
  document.getElementById('nsp-name').value = '';
  document.getElementById('nsp-code').value = '';
  fillUnitSelect(document.getElementById('nsp-unit'), '個');  // 2026-08-16 動態清單
  // 2026-08-16：快速新增單位按鈕（item-mgmt 才顯示）
  const nspUnitAdd = document.getElementById('nsp-unit-add');
  if (nspUnitAdd) nspUnitAdd.style.display = hasPerm('item-mgmt') ? '' : 'none';
  const nspUnitSearch = document.getElementById('nsp-unit-search');
  if (nspUnitSearch) nspUnitSearch.value = '';  // 重開 modal 清空搜尋
  document.getElementById('nsp-qty').value = '';
  document.getElementById('nsp-note').value = '';
  openModal('nonstock-prepare-modal');
}

async function submitNonStockPrepare() {
  const name = document.getElementById('nsp-name').value.trim();
  const code = document.getElementById('nsp-code').value.trim();
  const unit = document.getElementById('nsp-unit').value.trim() || '個';
  const qty = parseFloat(document.getElementById('nsp-qty').value);
  const note = document.getElementById('nsp-note').value.trim();

  if (!name) { toast('請輸入品項名稱', 'error'); return; }
  if (!qty || qty <= 0) { toast('請輸入待領出數量', 'error'); return; }

  try {
    const res = await fetch('/api/prepare/nonstock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, code: code, unit: unit, qty: qty, destination: '', note: note })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || '新增失敗');
    }
    closeModalForce('nonstock-prepare-modal');
    toast(`✅ 已新增待領出 ${qty} ${unit}`, 'success');
    await loadData();
  } catch (e) {
    toast('⚠️ ' + e.message, 'error');
  }
}

// ========== 領出準備（兩階段出庫） ==========
function openPrepareModal(id, ev) {
  if (ev) ev.stopPropagation();
  const item = ALL_ITEMS.find(i => i.id === id);
  if (!item) return;
  prepareItemId = id;
  document.getElementById('p-item-name').value = `${item.name}${item.brand ? ' (' + item.brand + ')' : ''}`;
  document.getElementById('p-item-stock').value = `${item.qty} ${item.unit}（可領 ${item.qty - (item.prepared_qty || 0)}）`;
  document.getElementById('p-qty').value = '';
  document.getElementById('p-note').value = '';
  openModal('prepare-modal');
}

// 送出「待領出」表單（POST /api/items/{id}/prepare）：只標記待領出，不扣庫存
async function submitPrepare() {
  const qty = parseFloat(document.getElementById('p-qty').value);
  const note = document.getElementById('p-note').value.trim();
  const item = ALL_ITEMS.find(i => i.id === prepareItemId);
  if (!qty || qty <= 0) { toast('請輸入領出數量', 'error'); return; }
  try {
    const res = await fetch(`/api/items/${prepareItemId}/prepare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ qty: qty, note: note })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || '領出失敗');
    }
    closeModalForce('prepare-modal');
    toast(`📤 已標記待領出 ${qty} ${item.unit}（庫存未扣）`, 'success');
    await loadData();
  } catch (e) {
    toast('⚠️ ' + e.message, 'error');
  }
}

// 開啟「待領出轉已領出」Modal，帶入品項名稱與已準備數量
function openPreparedOutModal(id) {
  const item = ALL_ITEMS.find(i => i.id === id);
  if (!item) return;
  preparedOutItemId = id;
  document.getElementById('po-item-name').value = `${item.name}${item.brand ? ' (' + item.brand + ')' : ''}`;
  document.getElementById('po-item-prepared').value = `${item.prepared_qty} ${item.unit}`;
  document.getElementById('po-qty').value = '';
  document.getElementById('po-dest').value = '';
  openModal('prepared-out-modal');
}

// 送出「待領出轉已領出」表單（POST /api/items/{id}/prepared-out），此時才真正扣庫存
async function submitPreparedOut() {
  const qty = parseFloat(document.getElementById('po-qty').value);
  const dest = document.getElementById('po-dest').value.trim();
  const item = ALL_ITEMS.find(i => i.id === preparedOutItemId);
  if (!qty || qty <= 0) { toast('請輸入領出數量', 'error'); return; }
  if (!dest) { toast('請填寫去哪裡（客戶/案場/工地）', 'error'); return; }
  try {
    const res = await fetch(`/api/items/${preparedOutItemId}/prepared-out`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ qty: qty, note: dest })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || '領出失敗');
    }
    closeModalForce('prepared-out-modal');
    toast(`✅ 已領出 ${qty} ${item.unit} → ${dest}（庫存已扣）`, 'success');
    await loadData();
  } catch (e) {
    toast('⚠️ ' + e.message, 'error');
  }
}

// 退回指定品項的全部待領出數量（POST /api/items/{id}/prepared-return），先 confirm 確認
async function returnPrepared(id) {
  const item = ALL_ITEMS.find(i => i.id === id);
  if (!item) return;
  const confirmed = confirm(`退回「${item.name}」全部 ${item.prepared_qty} ${item.unit}？`);
  if (!confirmed) return;
  try {
    const res = await fetch(`/api/items/${id}/prepared-return`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ qty: item.prepared_qty })
    });
    if (!res.ok) throw new Error();
    toast('↩️ 已退回', 'success');
    await loadData();
  } catch (e) {
    toast('退回失敗', 'error');
  }
}

// ========== 已領出：退回 / 編輯（v11） ==========

// 退回一筆已領出記錄（POST /api/stockouts/{id}/return）：數量加回庫存
async function returnStockout(movementId) {
  const rec = (stockoutRecords || []).find(r => r.id === movementId);
  const label = rec ? `${rec.brand} ${rec.item_name} ${Math.abs(rec.delta)} ${rec.unit}` : `這筆已領出（#${movementId}）`;
  if (!confirm(`退回已領出「${label}」？數量會加回庫存`)) return;
  try {
    const res = await fetch(`/api/stockouts/${movementId}/return`, { method: 'POST' });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || '退回失敗');
    }
    toast('↩️ 已退回，數量已加回庫存', 'success');
    await loadData();
  } catch (e) {
    toast('⚠️ ' + e.message, 'error');
  }
}

// 開啟「編輯已領出」Modal，帶入原記錄資料
function openEditStockoutModal(movementId) {
  const rec = (stockoutRecords || []).find(r => r.id === movementId);
  if (!rec) return;
  editStockoutId = movementId;
  document.getElementById('es-item-name').value = `${rec.brand} ${rec.item_name}${rec.code ? ' (' + rec.code + ')' : ''}`;
  document.getElementById('es-qty').value = Math.abs(rec.delta);
  document.getElementById('es-dest').value = rec.destination || '';
  const dt = (rec.created_at || '').replace(' ', 'T');
  document.getElementById('es-datetime').value = dt ? dt.slice(0, 16) : '';
  openModal('edit-stockout-modal');
}

// 送出「編輯已領出」（PATCH /api/stockouts/{id}）：數量差額自動補/扣庫存
async function submitEditStockout() {
  const qty = parseFloat(document.getElementById('es-qty').value);
  const dest = document.getElementById('es-dest').value.trim();
  const dt = document.getElementById('es-datetime').value;
  if (!qty || qty <= 0) { toast('請輸入有效數量', 'error'); return; }
  const body = { qty: qty };
  if (dest) body.destination = dest;
  if (dt) body.created_at = dt.replace('T', ' ') + ':00';
  try {
    const res = await fetch(`/api/stockouts/${editStockoutId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || '儲存失敗');
    }
    closeModalForce('edit-stockout-modal');
    toast('✅ 已更新已領出記錄', 'success');
    await loadData();
  } catch (e) {
    toast('⚠️ ' + e.message, 'error');
  }
}
