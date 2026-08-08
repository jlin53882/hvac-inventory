// 冷凍空調庫存系統 - 新增品項 Modal（v8 拆分）
// ========== 新增品項 ==========
function openAddModal() {
  openModal('add-modal');
  document.getElementById('f-site').value = currentSite;  // 預設加到目前分片
  document.getElementById('f-brand').focus();
}

async function submitAdd() {
  const name = document.getElementById('f-name').value.trim();
  if (!name) { toast('品項名稱必填', 'error'); return; }
  const payload = {
    brand: document.getElementById('f-brand').value.trim(),
    code: document.getElementById('f-code').value.trim(),
    name: name,
    qty: parseFloat(document.getElementById('f-qty').value) || 0,
    unit: document.getElementById('f-unit').value,
    location: document.getElementById('f-location').value.trim(),
    note: document.getElementById('f-note').value.trim(),
    site: document.getElementById('f-site').value,
  };
  try {
    const res = await fetch('/api/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error();
    toast(`✅ 已新增「${name}」`, 'success');
    closeModal('add-modal');
    ['f-brand','f-code','f-name','f-qty','f-unit','f-location','f-note'].forEach(id => {
      document.getElementById(id).value = id === 'f-qty' ? '0' : id === 'f-unit' ? '個' : '';
    });
    await loadData();
  } catch (e) {
    toast('新增失敗', 'error');
  }
}
