// 冷凍空調庫存系統 - 編輯品項 Modal（v8 拆分）
// ========== 編輯品項 ==========
function openEditModal(id) {
  const item = ALL_ITEMS.find(i => i.id === id);
  if (!item) return;
  editItemId = id;
  document.getElementById('e-brand').value = item.brand || '';
  document.getElementById('e-code').value = item.code || '';
  document.getElementById('e-name').value = item.name || '';
  document.getElementById('e-unit').value = item.unit || '個';
  document.getElementById('e-location').value = item.location || '';
  document.getElementById('e-note').value = item.note || '';
  document.getElementById('e-lowstock').value = item.low_stock || 0;
  document.getElementById('e-site').value = item.site || 'office';
  openModal('edit-modal');
}

async function submitEdit() {
  const nameVal = document.getElementById('e-name').value.trim();
  const payload = {
    brand: document.getElementById('e-brand').value.trim(),
    code: document.getElementById('e-code').value.trim(),
    // 名稱空白時不更新（保留原值），避免把原名覆蓋成空白
    ...(nameVal ? { name: nameVal } : {}),
    unit: document.getElementById('e-unit').value,
    location: document.getElementById('e-location').value.trim(),
    note: document.getElementById('e-note').value.trim(),
    low_stock: parseFloat(document.getElementById('e-lowstock').value) || 0,
    site: document.getElementById('e-site').value,
  };
  try {
    const res = await fetch(`/api/items/${editItemId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error();
    closeModal('edit-modal');
    toast('✅ 已儲存修改', 'success');
    await loadData();
  } catch (e) {
    toast('儲存失敗', 'error');
  }
}
