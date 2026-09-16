// 庫存管理系統 - 出庫/待領出 Modal（v8 拆分）
// ========== 出庫 ==========
function openOutModal(id, ev) {
  if (ev) ev.stopPropagation();
  const item = ALL_ITEMS.find(i => i.id === id);
  if (!item) return;
  outItemId = id;
  document.getElementById('o-item-name').value = `${item.name}${item.brand ? ' (' + item.brand + ')' : ''}`;
  document.getElementById('o-item-stock').value = `${(typeof Qty !== 'undefined') ? Qty.disp(item.qty, item.unit) : item.qty} ${item.unit}`;
  // v10：位置下拉（空白 = 依序扣全部位置）
  const sel = document.getElementById('o-location');
  const stocks = item.stocks && item.stocks.length ? item.stocks : [{ location: item.location || '' }];
  sel.innerHTML = '<option value="">全部位置（自動依序扣）</option>' +
    stocks.map(s => `<option value="${esc(s.location || '')}">${esc(s.location || '未標示')}（剩 ${(typeof Qty !== 'undefined') ? Qty.disp(s.qty, item.unit) : s.qty}）</option>`).join('');
  document.getElementById('o-qty').value = '';
  document.getElementById('o-dest').value = '';
  document.getElementById('o-note').value = '';
  openModal('out-modal');
}

// 送出「已領出」表單（POST /api/stockout）：驗證數量與去向、扣庫存並記錄
async function submitStockOut() {
  const item = ALL_ITEMS.find(i => i.id === outItemId);
  const qty = qtyInputOrToast('o-qty', item && item.unit);
  const dest = document.getElementById('o-dest').value.trim();
  const note = document.getElementById('o-note').value.trim();
  const location = document.getElementById('o-location').value;

  if (!qty || qty <= 0) { toast('請輸入領出數量', 'error'); return; }
  if (!dest) { toast('請填寫去哪裡（客戶/案場/工地）', 'error'); return; }
  if (location) {
    const st = (item.stocks || []).find(s => s.location === location);
    if (st && qty > st.qty) { toast(`「${location}」庫存不足！只剩 ${(typeof Qty !== 'undefined') ? Qty.disp(st.qty, item.unit) : st.qty} ${item.unit}`, 'error'); return; }
  } else if (qty > item.qty) { toast(`庫存不足！只剩 ${(typeof Qty !== 'undefined') ? Qty.disp(item.qty, item.unit) : item.qty} ${item.unit}`, 'error'); return; }

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
    toast(`✅ 已領出 ${(typeof Qty !== 'undefined') ? Qty.disp(qty, item.unit) : qty} ${item.unit} → ${dest}`, 'success');
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
  const qty = qtyInputOrToast('ns-qty', unit);
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
  const qty = qtyInputOrToast('nsp-qty', unit);
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
  document.getElementById('p-item-stock').value = `${(typeof Qty !== 'undefined') ? Qty.disp(item.qty, item.unit) : item.qty} ${item.unit}（可領 ${(typeof Qty !== 'undefined') ? Qty.disp(item.qty - (item.prepared_qty || 0), item.unit) : (item.qty - (item.prepared_qty || 0))}）`;
  document.getElementById('p-qty').value = '';
  document.getElementById('p-note').value = '';
  openModal('prepare-modal');
}

// 送出「待領出」表單（POST /api/items/{id}/prepare）：只標記待領出，不扣庫存
async function submitPrepare() {
  const item = ALL_ITEMS.find(i => i.id === prepareItemId);
  const qty = qtyInputOrToast('p-qty', item && item.unit);
  const note = document.getElementById('p-note').value.trim();
  if (!qty || qty <= 0) { toast('請輸入領出數量', 'error'); return; }
  try {
    const res = await fetch(`/api/items/${prepareItemId}/prepare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ qty: qty, note: note, location: note })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || '領出失敗');
    }
    closeModalForce('prepare-modal');
    toast(`📤 已標記待領出 ${(typeof Qty !== 'undefined') ? Qty.disp(qty, item.unit) : qty} ${item.unit}（庫存未扣）`, 'success');
    await loadData();
  } catch (e) {
    toast('⚠️ ' + e.message, 'error');
  }
}

// 開啟「待領出轉已領出」Modal，帶入品項名稱與已準備數量
function openPreparedOutModal(id) {
  const item = ALL_ITEMS.find(i => i.id === id) || preparedItems.find(i => i.id === id);  // 非庫存品項不在 ALL_ITEMS（2026-09-07 Sarah）
  if (!item) return;
  preparedOutItemId = id;
  document.getElementById('po-item-name').value = `${item.name}${item.brand ? ' (' + item.brand + ')' : ''}`;
  document.getElementById('po-item-prepared').value = `${(typeof Qty !== 'undefined') ? Qty.disp(item.prepared_qty, item.unit) : item.prepared_qty} ${item.unit}`;
  document.getElementById('po-qty').value = '';
  document.getElementById('po-dest').value = '';
  openModal('prepared-out-modal');
}

// 送出「待領出轉已領出」表單（POST /api/items/{id}/prepared-out），此時才真正扣庫存
async function submitPreparedOut() {
  const item = ALL_ITEMS.find(i => i.id === preparedOutItemId);
  const qty = qtyInputOrToast('po-qty', item && item.unit);
  const dest = document.getElementById('po-dest').value.trim();
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
    toast(`✅ 已領出 ${(typeof Qty !== 'undefined') ? Qty.disp(qty, item.unit) : qty} ${item.unit} → ${dest}（庫存已扣）`, 'success');
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

// ========== 已領出：退回 / 編輯（v11 + 退回 Modal） ==========

var returnStockoutId = null;  // 當前退回的記錄 ID
var editStockoutReturnId = null;
var repairStockoutReturnId = null;

// 開啟「退回已領出」Modal，帶入原記錄資料
function openReturnStockoutModal(movementId) {
  editStockoutReturnId = null;
  repairStockoutReturnId = null;
  document.getElementById('rs-title').textContent = '↩️ 退回已領出';
  document.getElementById('rs-submit').textContent = '↩️ 退回';
  document.getElementById('rs-parent-row').style.display = 'none';
  document.getElementById('rs-qty').disabled = false;
  const rec = (stockoutRecords || []).find(r => r.id === movementId);
  if (!rec) return;
  returnStockoutId = movementId;
  const origQty = Math.abs(rec.delta);
  const returned = (stockoutRecords || []).filter(r =>
    r.source_movement_id === movementId && r.reason === '退回已領出' && !r.reverted_at
  ).reduce((sum, r) => sum + Math.abs(r.delta), 0);
  const remaining = origQty - returned;
  document.getElementById('rs-item-name').value = `${rec.brand} ${rec.item_name}${rec.code ? ' (' + rec.code + ')' : ''}`;
  document.getElementById('rs-original-qty').textContent = remaining > 0 ? `${origQty}（已退 ${returned}，剩 ${remaining}）` : `${origQty}（已全數退回）`;
  document.getElementById('rs-qty').value = remaining > 0 ? remaining : 0;
  document.getElementById('rs-qty').max = remaining;
  document.getElementById('rs-dest').value = '公司';
  const sourceLabel = rec.source_site || rec.source_location
    ? `${rec.source_site || ''}${rec.source_site && rec.source_location ? '／' : ''}${rec.source_location || ''}`
    : '原始位置未記錄';
  document.getElementById('rs-source-location').value = sourceLabel;
  const item = (typeof ALL_ITEMS !== 'undefined' ? ALL_ITEMS : []).find(i => i.id === rec.item_id);
  const sel = document.getElementById('rs-location');
  sel.innerHTML = '<option value="">— 請選擇 —</option>';
  (item && item.stocks || []).forEach(s => {
    const label = `${item.site || ''}${item.site && s.location ? '／' : ''}${s.location || '未標示'}`;
    sel.insertAdjacentHTML('beforeend', `<option value="${esc(Number(s.id))}">${esc(label)}</option>`);
  });
  if (rec.source_stock_id && sel.querySelector(`option[value="${Number(rec.source_stock_id)}"]`)) {
    sel.value = String(rec.source_stock_id);
  } else if (sel.options.length === 2) {
    sel.value = sel.options[1].value;
  }
  const today = new Date().toISOString().slice(0, 10);
  document.getElementById('rs-datetime').value = today;
  if (remaining <= 0) {
    toast('此記錄已全數退回', 'error');
    return;
  }
  openModal('return-stockout-modal');
}

// 送出「退回已領出」（POST /api/stockouts/{id}/return）：部分退回 + 去向 + 日期
async function submitReturnStockout() {
  const _rsRec = (typeof stockoutRecords !== 'undefined' ? stockoutRecords : []).find(r => r.id === returnStockoutId);
  const qty = qtyInputOrToast('rs-qty', _rsRec && _rsRec.unit);
  const dest = document.getElementById('rs-dest').value.trim();
  const dt = document.getElementById('rs-datetime').value;
  const returnStockId = Number(document.getElementById('rs-location').value);
  if (repairStockoutReturnId) {
    const parentId = Number(document.getElementById('rs-parent-movement').value);
    if (!parentId || !returnStockId) { toast('請選擇原始出庫與退回庫存位置', 'error'); return; }
    try {
      const res = await fetch(`/api/stockout-returns/${repairStockoutReturnId}/repair`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_movement_id: parentId, return_stock_id: returnStockId })
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.detail || '修復退回資料失敗'); }
      repairStockoutReturnId = null;
      closeModalForce('return-stockout-modal');
      toast('✅ 已補齊退回資料，現在可以編輯或撤銷', 'success');
      await loadData();
    } catch (e) { toast('⚠️ ' + e.message, 'error'); }
    return;
  }
  if (editStockoutReturnId) {
    if (!qty || qty <= 0 || !returnStockId) { toast('請輸入有效數量並選擇退回庫存位置', 'error'); return; }
    const updateBody = { qty: qty, return_stock_id: returnStockId };
    if (dest) updateBody.destination = dest;
    if (dt) updateBody.created_at = dt + ' 00:00:00';
    try {
      const res = await fetch(`/api/stockout-returns/${editStockoutReturnId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updateBody)
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.detail || '儲存退回紀錄失敗'); }
      editStockoutReturnId = null;
      closeModalForce('return-stockout-modal');
      toast('✅ 已更新退回紀錄', 'success');
      await loadData();
    } catch (e) { toast('⚠️ ' + e.message, 'error'); }
    return;
  }
  if (!qty || qty <= 0) { toast('請輸入有效退回數量', 'error'); return; }
  if (!returnStockId) { toast('請選擇退回庫存位置', 'error'); return; }
  const rec = stockoutRecords.find(r => r.id === returnStockoutId);
  const origQty = rec ? Math.abs(rec.delta) : 0;
  const returned = rec ? stockoutRecords.filter(r => r.source_movement_id === returnStockoutId && r.reason === '退回已領出' && !r.reverted_at).reduce((s, r) => s + Math.abs(r.delta), 0) : 0;
  if (qty > origQty - returned) { toast(`退回數量不可超過剩餘可退數量 ${origQty - returned}`, 'error'); return; }
  const body = { qty: qty, return_stock_id: returnStockId };
  if (dest) body.destination = dest;
  if (dt) body.created_at = dt + ' 00:00:00';
  try {
    const res = await fetch(`/api/stockouts/${returnStockoutId}/return`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || '退回失敗');
    }
    closeModalForce('return-stockout-modal');
    toast('↩️ 已退回，數量已加回庫存', 'success');
    await loadData();
  } catch (e) {
    toast('⚠️ ' + e.message, 'error');
  }
}

// 向後相容：直接呼叫 returnStockout(id) 開 Modal
function returnStockout(movementId) {
  openReturnStockoutModal(movementId);
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
  document.getElementById('es-datetime').value = dt ? dt.slice(0, 10) : '';
  openModal('edit-stockout-modal');
}

// 送出「編輯已領出」（PATCH /api/stockouts/{id}）：數量差額自動補/扣庫存
async function submitEditStockout() {
  const _esRec = (typeof stockoutRecords !== 'undefined' ? stockoutRecords : []).find(r => r.id === editStockoutId);
  const qty = qtyInputOrToast('es-qty', _esRec && _esRec.unit);
  const dest = document.getElementById('es-dest').value.trim();
  const dt = document.getElementById('es-datetime').value;
  if (!qty || qty <= 0) { toast('請輸入有效數量', 'error'); return; }
  // 上限檢查：不可超過原記錄數量的 10 倍（防誤輸入）
  const rec = stockoutRecords.find(r => r.id === editStockoutId);
  if (rec && qty > Math.abs(rec.delta) * 10) {
    toast('數量異常大，請確認', 'error'); return;
  }
  const body = { qty: qty };
  if (dest) body.destination = dest;
  if (dt) body.created_at = dt + ' 00:00:00';
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


function openRepairStockoutReturnModal(movementId) {
  const rec = (stockoutRecords || []).find(r => r.id === movementId);
  if (!rec || rec.reason !== '退回已領出' || rec.reverted_at) return;
  repairStockoutReturnId = movementId;
  editStockoutReturnId = null;
  document.getElementById('rs-title').textContent = '🛠️ 修復舊退回資料';
  document.getElementById('rs-submit').textContent = '🛠️ 儲存關聯';
  document.getElementById('rs-parent-row').style.display = '';
  document.getElementById('rs-item-name').value = `${rec.brand} ${rec.item_name}${rec.code ? ' (' + rec.code + ')' : ''}`;
  document.getElementById('rs-original-qty').textContent = `${rec.delta}（舊退回資料）`;
  document.getElementById('rs-qty').value = rec.delta;
  document.getElementById('rs-qty').disabled = true;
  document.getElementById('rs-source-location').value = rec.source_location || '原始位置未記錄';
  const parentSel = document.getElementById('rs-parent-movement');
  parentSel.innerHTML = '<option value="">— 請選擇原始出庫 —</option>';
  (stockoutRecords || []).filter(r => r.item_id === rec.item_id && r.delta < 0 && String(r.reason || '').startsWith('出庫')).forEach(parent => {
    const label = `${(parent.created_at || '').slice(0, 10)}｜${parent.destination || '未填去向'}｜出庫 ${Math.abs(parent.delta)} ${parent.unit || ''}`;
    parentSel.insertAdjacentHTML('beforeend', `<option value="${esc(Number(parent.id))}">${esc(label)}</option>`);
  });
  if (rec.source_movement_id && parentSel.querySelector(`option[value="${Number(rec.source_movement_id)}"]`)) {
    parentSel.value = String(rec.source_movement_id);
  }
  const sel = document.getElementById('rs-location');
  sel.innerHTML = '<option value="">— 請選擇當時回補位置 —</option>';
  const item = (typeof ALL_ITEMS !== 'undefined' ? ALL_ITEMS : []).find(i => i.id === rec.item_id);
  (item && item.stocks || []).forEach(st => {
    const label = `${item.site || ''}${item.site && st.location ? '／' : ''}${st.location || '未標示'}`;
    sel.insertAdjacentHTML('beforeend', `<option value="${esc(Number(st.id))}">${esc(label)}</option>`);
  });
  if (rec.return_stock_id && sel.querySelector(`option[value="${Number(rec.return_stock_id)}"]`)) {
    sel.value = String(rec.return_stock_id);
  }
  document.getElementById('rs-dest').value = rec.destination || '';
  document.getElementById('rs-datetime').value = (rec.created_at || '').slice(0, 10);
  openModal('return-stockout-modal');
}

function openEditStockoutReturnModal(movementId) {
  repairStockoutReturnId = null;
  document.getElementById('rs-title').textContent = '↩️ 編輯退回已領出';
  document.getElementById('rs-submit').textContent = '💾 儲存';
  document.getElementById('rs-parent-row').style.display = 'none';
  document.getElementById('rs-qty').disabled = false;
  const rec = (stockoutRecords || []).find(r => r.id === movementId);
  if (!rec || rec.reason !== '退回已領出' || rec.reverted_at) return;
  editStockoutReturnId = movementId;
  document.getElementById('rs-item-name').value = `${rec.brand} ${rec.item_name}${rec.code ? ' (' + rec.code + ')' : ''}`;
  document.getElementById('rs-source-location').value = rec.source_location || '原始位置未記錄';
  const item = (typeof ALL_ITEMS !== 'undefined' ? ALL_ITEMS : []).find(i => i.id === rec.item_id);
  const sel = document.getElementById('rs-location');
  sel.innerHTML = '<option value="">— 請選擇 —</option>';
  (item && item.stocks || []).forEach(st => {
    const label = `${item.site || ''}${item.site && st.location ? '／' : ''}${st.location || '未標示'}`;
    sel.insertAdjacentHTML('beforeend', `<option value="${esc(Number(st.id))}">${esc(label)}</option>`);
  });
  sel.value = String(rec.return_stock_id || '');
  document.getElementById('rs-qty').value = rec.delta;
  document.getElementById('rs-qty').max = rec.delta;
  document.getElementById('rs-dest').value = rec.destination || '';
  document.getElementById('rs-datetime').value = (rec.created_at || '').slice(0, 10);
  openModal('return-stockout-modal');
}

async function deleteStockoutReturn(movementId) {
  if (!confirm('確定刪除這筆退回紀錄？活動退回會扣回已補入庫存的數量。')) return;
  try {
    const res = await fetch(`/api/stockout-returns/${movementId}`, { method: 'DELETE' });
    if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.detail || '刪除退回紀錄失敗'); }
    toast('✅ 已刪除退回紀錄', 'success');
    await renderStockOuts();
  } catch (e) { toast('⚠️ ' + e.message, 'error'); }
}




// ========== 待領出編輯（pre-built modal） ==========
var _preparedEditContext = false;  // 標記從待領出頁開啟

function openPreparedEditModal(id) {
  const item = (typeof preparedItems !== 'undefined' && preparedItems)
    ? preparedItems.find(i => i.id === id)
    : null;
  if (!item) return;
  _preparedEditContext = true;
  editItemId = id;  // 復用 editItemId 供共用流程
  document.getElementById('pe-name').value = item.name || '';
  document.getElementById('pe-brand').value = item.brand || '';
  document.getElementById('pe-code').value = item.code || '';
  fillUnitSelect(document.getElementById('pe-unit'), item.unit || '個');
  document.getElementById('pe-qty').value = item.prepared_qty || 0;
  document.getElementById('pe-note').value = item.note || '';
  document.getElementById('pe-dest').value = item.destination || '';
  openModal('prepared-edit-modal');
}

async function submitPreparedEdit() {
  const name = document.getElementById('pe-name').value.trim();
  const brand = document.getElementById('pe-brand').value.trim();
  const code = document.getElementById('pe-code').value.trim();
  const unit = document.getElementById('pe-unit').value;
  const qty = parseFloat(document.getElementById('pe-qty').value) || 0;
  const note = document.getElementById('pe-note').value.trim();
  if (!name) { toast('品項名稱為必填', 'error'); return; }
  if (qty < 0) { toast('數量不可為負數', 'error'); return; }
  try {
    const res = await fetch(`/api/items/${editItemId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, brand, code, unit, note })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || '更新失敗');
    }
    // 更新準備說明（movements.destination）
    const dest = document.getElementById('pe-dest').value.trim();
    const curDest = (preparedItems.find(i => i.id === editItemId) || {}).destination || '';
    if (dest !== curDest) {
      await fetch(`/api/prepared/${editItemId}/destination`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ destination: dest })
      });
    }
    closeModalForce('prepared-edit-modal');
    toast('✅ 已儲存修改', 'success');
    await renderPrepared();
  } catch (e) {
    toast('⚠️ ' + e.message, 'error');
  }
}

// ========== 整組待領出 BOM Modal ==========
function openKitPrepareModal(kitId, kitName) {
  const kit = (typeof currentKitItems !== 'undefined' && currentKitItems)
    ? currentKitItems.find(k => k.item_id === kitId || k.id === kitId)
    : null;
  if (!kit) return;
  const comps = kit.components || [];
  document.getElementById('kit-prepare-title').textContent = '📤 整組待領出：' + kitName;
  document.getElementById('kit-prepare-desc').textContent = '整組包含 ' + comps.length + ' 個品項，按「確認領出」一次領出整組。';
  let listHtml = '';
  comps.forEach(c => {
    const photo = c.has_photo
      ? '<img src="' + photoSrc(c.item_id, 'thumbnail') + '" style="width:36px;height:36px;border-radius:6px;object-fit:cover" loading="lazy">'
      : '<div style="width:36px;height:36px;border-radius:6px;background:#f1f5f9;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:14px">📷</div>';
    const stockOk = (c.stock || 0) >= c.need_qty;
    listHtml += '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #f1f5f9">' +
      photo +
      '<div style="flex:1;min-width:0">' +
        '<div style="font-size:13px;font-weight:600">' + esc(c.brand || '') + ' ' + esc(c.name) + '</div>' +
        '<div style="font-size:11px;color:#888">' + (c.code ? '型號：' + esc(c.code) : '') + '</div>' +
      '</div>' +
      '<div style="text-align:right;font-size:12px">' +
        '<div>需要 ' + c.need_qty + ' ' + esc(c.unit || '個') + '</div>' +
        '<div style="color:' + (stockOk ? '#15803d' : '#dc2626') + '">庫存 ' + (c.stock || 0) + '</div>' +
      '</div>' +
    '</div>';
  });
  document.getElementById('kit-prepare-list').innerHTML = listHtml;
  document.getElementById('kit-prepare-note').value = '';
  document.getElementById('kit-prepare-submit').onclick = function() { submitKitPrepare(kit.item_id); };
  openModal('kit-prepare-modal');
}

async function submitKitPrepare(kitItemId) {
  const item = ALL_ITEMS.find(i => i.id === kitItemId);
  if (!item) { toast('品項不存在', 'error'); return; }
  const note = document.getElementById('kit-prepare-note').value.trim();
  try {
    const res = await fetch(`/api/items/${kitItemId}/prepare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ qty: 1, note: note, location: note })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || '領出失敗');
    }
    closeModalForce('kit-prepare-modal');
    toast('📤 已標記待領出 1 ' + (item.unit || '組') + '（整組）', 'success');
    await loadData();
  } catch (e) {
    toast('⚠️ ' + e.message, 'error');
  }
}
