// 冷凍空調庫存系統 - 整組 Modal（v8 拆分）
function openKitModal() {
  kitModalSelections = [];
  kitModalCompRows = [];
  document.getElementById('k-name').value = '';
  document.getElementById('k-note').value = '';
  renderKitCompRows();
  openModal('kit-modal');
}

function addKitCompRow() {
  kitModalCompRows.push({});
  renderKitCompRows();
}

function removeKitCompRow(idx) {
  kitModalCompRows.splice(idx, 1);
  renderKitCompRows();
}

async function submitKit() {
  const name = document.getElementById('k-name').value.trim();
  if (!name) { toast('請輸入整組名稱', 'error'); return; }
  const items = kitModalCompRows
    .filter(r => r.item_id && r.qty > 0)
    .map(r => ({ item_id: parseInt(r.item_id), qty: r.qty }));
  if (!items.length) { toast('請至少加入一個材料', 'error'); return; }
  try {
    const res = await fetch('/api/kits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, items: items, note: document.getElementById('k-note').value.trim() })
    });
    if (!res.ok) throw new Error();
    closeModal('kit-modal');
    toast(`✅ 已新增整組「${name}」`, 'success');
    await loadData();
    renderKits();
  } catch (e) {
    toast('新增失敗', 'error');
  }
}
