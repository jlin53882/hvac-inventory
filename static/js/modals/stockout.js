// 冷凍空調庫存系統 - 出庫/待領出 Modal（v8 拆分）
// ========== 出庫 ==========
function openOutModal(id, ev) {
  if (ev) ev.stopPropagation();
  const item = ALL_ITEMS.find(i => i.id === id);
  if (!item) return;
  outItemId = id;
  document.getElementById('o-item-name').value = `${item.name}${item.brand ? ' (' + item.brand + ')' : ''}`;
  document.getElementById('o-item-stock').value = `${item.qty} ${item.unit}`;
  document.getElementById('o-qty').value = '';
  document.getElementById('o-dest').value = '';
  document.getElementById('o-note').value = '';
  openModal('out-modal');
}

async function submitStockOut() {
  const qty = parseFloat(document.getElementById('o-qty').value);
  const dest = document.getElementById('o-dest').value.trim();
  const note = document.getElementById('o-note').value.trim();
  const item = ALL_ITEMS.find(i => i.id === outItemId);

  if (!qty || qty <= 0) { toast('請輸入領出數量', 'error'); return; }
  if (!dest) { toast('請填寫去哪裡（客戶/案場/工地）', 'error'); return; }
  if (qty > item.qty) { toast(`庫存不足！只剩 ${item.qty} ${item.unit}`, 'error'); return; }

  try {
    const res = await fetch('/api/stockout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: outItemId, qty: qty, destination: dest, note: note })
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
