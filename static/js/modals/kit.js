// 庫存管理系統 - 整組 Modal（v8 拆分；材料選擇為 demo 樣式：已選列 + 單一可搜尋框）
var kitUpdatedAt = null;  // 2026-08-14 樂觀鎖：開啟編輯整組 modal 時的 updated_at 快照
function openKitModal() {
  editingKitId = null;
  kitModalCompRows = [];
  document.getElementById('k-name').value = '';
  document.getElementById('k-note').value = '';
  document.getElementById('k-brand').value = '';
  document.getElementById('k-code').value = '';
  document.getElementById('k-location').value = '';
  document.querySelector('#kit-modal h3').textContent = '🔧 新增整組';
  const btn = document.querySelector('#kit-modal .btn-confirm');
  btn.textContent = '✅ 建立整組';
  btn.setAttribute('onclick', 'submitKit()');
  renderKitCompRows();  // 顯示「尚未加入材料」+ 搜尋框（同 demo）
  renderKitPhotoBox(null);  // 新增模式：選檔，建立後背景上傳
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

function setKitSubmitBusy(isBusy) {
  const btn = document.querySelector('#kit-modal .btn-confirm');
  if (!btn) return;
  btn.disabled = isBusy;
  btn.setAttribute('aria-busy', String(isBusy));
}

// 送出新增整組表單（POST /api/kits），成功後立即關閉 Modal，背景上傳照片（避免多人併發卡頓）
async function submitKit() {
  if (document.querySelector('#kit-modal .btn-confirm')?.disabled) return;
  const name = document.getElementById('k-name').value.trim();
  const brand = document.getElementById('k-brand').value.trim();
  const code = document.getElementById('k-code').value.trim();
  if (!name) { toast('請輸入整組名稱', 'error'); return; }
  const items = kitModalCompRows
    .filter(r => r.item_id && r.qty > 0)
    .map(r => ({ item_id: parseInt(r.item_id), qty: r.qty }));
  if (!items.length) { toast('請至少加入一個材料', 'error'); return; }
  setKitSubmitBusy(true);
  try {
    const res = await fetch('/api/kits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, brand: brand, code: code, location: document.getElementById('k-location').value.trim(), site: currentSite, items: items, note: document.getElementById('k-note').value.trim() })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || '新增失敗');
    const kitId = data.id;
    closeModalForce('kit-modal');
    toast(`✅ 已新增整組「${data.name || name}」｜品牌：${data.brand || '未填寫'}｜型號：${data.code || '未填寫'}`, 'success');
    // 背景非同步上傳照片（不阻擋 UI，避免多人上傳時卡頓）
    _uploadKitPhotoAsync(kitId);
    await loadData();
  } catch (e) {
    toast('⚠️ ' + e.message, 'error');
  } finally {
    setKitSubmitBusy(false);
  }
}

// 背景上傳整組照片（非同步，不 await，避免阻擋多人併發操作）
function _uploadKitPhotoAsync(kitId) {
  const photoInput = document.getElementById('k-photo-input');
  const albumInput = document.getElementById('k-photo-album');
  const chosenFile = (photoInput && photoInput.files && photoInput.files[0])
    || (albumInput && albumInput.files && albumInput.files[0]);
  if (!chosenFile) return;  // 沒選檔，不上傳
  
  const fd = new FormData();
  fd.append('file', chosenFile);
  fetch(`/api/kits/${kitId}/photo`, { method: 'POST', body: fd })
    .then(r => {
      if (r.ok) {
        toast('📷 整組照片已上傳', 'info');
        // 背景重載資料，確保照片顯示
        setTimeout(() => loadData({ full: false }), 500);
      } else {
        return r.json().then(e => {
          console.warn('整組照片上傳失敗:', e.detail || '未知錯誤');
          toast('⚠️ 照片上傳失敗，請重試', 'error');
        }).catch(() => {
          console.warn('整組照片上傳失敗 (無回應)');
          toast('⚠️ 照片上傳失敗', 'error');
        });
      }
    })
    .catch(e => {
      console.warn('整組照片上傳錯誤:', e.message);
      toast('⚠️ 照片上傳出錯', 'error');
    });
}

// 送出編輯整組（PUT /api/kits/{id}；與新增共用同一個 modal）
async function submitKitEdit() {
  if (document.querySelector('#kit-modal .btn-confirm')?.disabled) return;
  const name = document.getElementById('k-name').value.trim();
  const brand = document.getElementById('k-brand').value.trim();
  const code = document.getElementById('k-code').value.trim();
  if (!name) { toast('請輸入整組名稱', 'error'); return; }
  const items = kitModalCompRows
    .filter(r => r.item_id && r.qty > 0)
    .map(r => ({ item_id: parseInt(r.item_id), qty: r.qty }));
  if (!items.length) { toast('請至少加入一個材料', 'error'); return; }
  if (!editingKitId) { toast('編輯目標遺失，請重開', 'error'); return; }
  setKitSubmitBusy(true);
  try {
    const res = await fetch(`/api/kits/${editingKitId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, brand: brand, code: code, location: document.getElementById('k-location').value.trim(), items: items, note: document.getElementById('k-note').value.trim(),
                             updated_at: kitUpdatedAt })
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.detail || '儲存失敗');
    }
    const saved = await res.json();
    closeModalForce('kit-modal');
    toast('✅ 已更新整組「' + saved.name + '」｜品牌：' + (saved.brand || '未填寫') + '｜型號：' + (saved.code || '未填寫'), 'success');
    // 背景非同步上傳照片（如果有新選檔）+ 背景重載資料
    _uploadKitPhotoAsync(editingKitId);
    setTimeout(() => {
      // 同步 ALL_ITEMS 與整組頁，避免下一個待領出/已領出操作讀到舊品牌或型號。
      loadData({ full: true });
    }, 600);
  } catch (e) {
    toast('⚠️ ' + e.message, 'error');
  } finally {
    setKitSubmitBusy(false);
  }
}
