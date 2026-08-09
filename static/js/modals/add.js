// 振佳空調庫存管理系統 - 新增品項 Modal（v10：多位置 stocks）
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
    unit: document.getElementById('f-unit').value,
    site: document.getElementById('f-site').value,
    // v10：位置庫存陣列（一筆 = 一個位置）
    stocks: [{
      location: document.getElementById('f-location').value.trim(),
      qty: parseFloat(document.getElementById('f-qty').value) || 0,
      note: document.getElementById('f-note').value.trim(),
    }],
  };
  try {
    const res = await fetch('/api/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      // 去重：顯示後端錯誤訊息（例如「該品項已存在…用編輯→新增位置」）
      let msg = '新增失敗';
      try {
        const err = await res.json();
        if (err.detail) msg = err.detail;
      } catch {}
      toast('⚠️ ' + msg, 'error');
      return;
    }
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