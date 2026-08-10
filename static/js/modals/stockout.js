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
    stocks.map(s => `<option value="${esc(s.location || '')}">${s.location || '未標示'}（剩 ${s.qty}）</option>`).join('');
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
    closeModal('out-modal');
    toast(`✅ 已領出 ${qty} ${item.unit} → ${dest}`, 'success');
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
    closeModal('prepare-modal');
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
    closeModal('prepared-out-modal');
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
