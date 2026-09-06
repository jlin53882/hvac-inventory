// 庫存管理系統 - 新增品項 Modal（v10：多位置 stocks）
// ========== 新增品項 ==========
function openAddModal() {
  openModal('add-modal');
  document.getElementById('f-site').value = currentSite;  // 預設加到目前分片
  document.getElementById('f-brand').focus();
  // v10.1：相似品項提示（新增 → 不排除任何品項）
  const warnBox = document.getElementById('f-similar-warn');
  warnBox.style.display = 'none';
  warnBox.innerHTML = '';
  bindSimilarCheck('f-name', 'f-code', 'f-similar-warn', 0);
  // 分類：重置為「— 請選擇 —」
  document.getElementById('f-category').value = '';
  // 名稱輸入時自動推斷分類
  document.getElementById('f-name').removeEventListener('input', _autoInferCategory);
  document.getElementById('f-name').addEventListener('input', _autoInferCategory);
  // 2026-08-16：單位動態清單（寫死 options 移除）
  fillUnitSelect(document.getElementById('f-unit'), '個');
  const fUnitSearch = document.getElementById('f-unit-search');
  if (fUnitSearch) fUnitSearch.value = '';  // 重開 modal 清空搜尋
  // 2026-08-16：快速新增單位按鈕（item-mgmt 才顯示）
  const fUnitAdd = document.getElementById('f-unit-add');
  if (fUnitAdd) fUnitAdd.style.display = hasPerm('item-mgmt') ? '' : 'none';
  // 品項照片：初始化照片上傳區塊
  renderAddPhotoBox();
}

// 渲染新增 modal 的照片上傳區塊（無品項 ID，建立後自動上傳）
function _autoInferCategory() {
  var name = document.getElementById('f-name').value || '';
  var cat = '';
  if (/遙控|遙器|控制器|線控/.test(name)) cat = '遙控器';
  else if (/基板|控制板|PCB|電路/.test(name)) cat = '電子零件';
  else if (/線圈|接觸器|繼電器|開關|插座|斷路|跳脫/.test(name)) cat = '電氣配件';
  else if (/管|銅|鐵氟龍|配管/.test(name)) cat = '管材';
  else if (/劑|脂|膠|發泡|樹脂/.test(name)) cat = '化學品';
  else if (/濾|網|棉|濾網/.test(name)) cat = '過濾耗材';
  else if (/馬達|風扇|壓縮|軸流/.test(name)) cat = '動力設備';
  else if (/面板|蓋板|外殼|支架|固定/.test(name)) cat = '外觀/結構';
  if (cat) document.getElementById('f-category').value = cat;
}

function renderAddPhotoBox() {
  const box = document.getElementById('f-photo-box');
  if (!box) return;
  if (!hasPerm('photo')) {
    box.innerHTML = '<div style="font-size:11px;color:#999;padding:6px 0">無照片上傳權限</div>';
    return;
  }
  box.innerHTML = `
    <div style="font-size:11px;color:#999;padding:6px 0">新增後可立即上傳照片</div>
    <div class="photo-actions" style="flex-direction:row;gap:8px;flex-wrap:wrap">
      <label class="btn-prepare" style="margin:0;text-align:center;cursor:pointer">📷 拍照
        <input type="file" accept="image/*" capture="environment" id="f-photo-input" style="display:none">
      </label>
      <label class="btn-prepare" style="margin:0;text-align:center;cursor:pointer">🖼 從相簿選
        <input type="file" accept="image/*" id="f-photo-album" style="display:none">
      </label>
    </div>`;
  // 兩個 input 同步到同一個 hidden state（submitAdd 只讀一個）
  const cam = document.getElementById('f-photo-input');
  const album = document.getElementById('f-photo-album');
  cam.addEventListener('change', () => { if (cam.files[0]) album.value = ''; });
  album.addEventListener('change', () => { if (album.files[0]) cam.value = ''; });
}

// 送出新增品項表單（POST /api/items），成功後關閉 Modal、清空表單並重載資料
// v10.1：新增成功後自動上傳照片（若已選檔）
async function submitAdd() {
  const name = document.getElementById('f-name').value.trim();
  if (!name) { toast('品項名稱必填', 'error'); return; }
  const brand = document.getElementById('f-brand').value.trim();
  const code = document.getElementById('f-code').value.trim();
  const cabinet = document.getElementById('f-cabinet').value;
  const sub = document.getElementById('f-sub').value.trim();
  const location = cabinet ? (sub ? `${cabinet} | ${sub}` : cabinet) : '';
  if (!brand) { toast('廠牌必填', 'error'); return; }
  if (!code) { toast('型號必填', 'error'); return; }
  if (!location) { toast('位置必填（至少選櫃子）', 'error'); return; }
  const payload = {
    brand: brand,
    code: code,
    name: name,
    unit: document.getElementById('f-unit').value,
    site: document.getElementById('f-site').value,
    category: document.getElementById('f-category').value,
    // v10：位置庫存陣列（一筆 = 一個位置）
    stocks: [{
      location: location,
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
    const newItem = await res.json();
    const newItemId = newItem.id;
    // v10.1：若有選擇照片，自動上傳（拍照或相簿擇一）
    const photoInput = document.getElementById('f-photo-input');
    const albumInput = document.getElementById('f-photo-album');
    const chosenFile = (photoInput && photoInput.files && photoInput.files[0])
      || (albumInput && albumInput.files && albumInput.files[0]);
    let photoMsg = '';
    if (chosenFile) {
      try {
        const fd = new FormData();
        fd.append('file', chosenFile);
        const photoRes = await fetch(`/api/items/${newItemId}/photo`, { method: 'POST', body: fd });
        if (photoRes.ok) photoMsg = '（含照片）';
      } catch {}
    }
    toast(`✅ 已新增「${name}」${photoMsg}`, 'success');
    closeModalForce('add-modal');
    // f-unit 是動態 select（2026-08-16）→ 不參與 value reset，改重填
    ['f-brand','f-code','f-name','f-qty','f-sub','f-note'].forEach(id => {
      document.getElementById(id).value = id === 'f-qty' ? '0' : '';
    });
    document.getElementById('f-cabinet').value = '';
    document.getElementById('f-category').value = '';
    fillUnitSelect(document.getElementById('f-unit'), '個');
    await loadData();
  } catch (e) {
    toast('新增失敗', 'error');
  }
}