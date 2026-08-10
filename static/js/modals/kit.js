// 庫存管理系統 - 整組 Modal（v8 拆分；材料選擇為 demo 樣式：已選列 + 單一可搜尋框）
function openKitModal() {
  kitModalSelections = [];
  kitModalCompRows = [];
  document.getElementById('k-name').value = '';
  document.getElementById('k-note').value = '';
  renderKitCompRows();  // 顯示「尚未加入材料」+ 搜尋框（同 demo）
  openModal('kit-modal');
}

// 在整組 Modal「＋ 加入另一材料」：聚焦搜尋框（demo 行為：選中即自動加列）
function addKitCompRow() {
  const input = document.getElementById('kit-mat-input');
  if (input) input.focus();
}

// 移除整組 Modal 中指定索引的材料列後重繪
function removeKitCompRow(idx) {
  kitModalCompRows.splice(idx, 1);
  renderKitCompRows();
}

// 送出新增整組表單（POST /api/kits），成功後關閉 Modal 並重載資料
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
