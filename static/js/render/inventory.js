// 庫存管理系統 - 庫存頁渲染（v8 拆分）
// buildBrandTabs / buildDatalists / renderInventory / 數量增減
// ========== 廠牌 tab ==========
function buildBrandTabs() {
  const counts = {};
  // 廠牌 tab 只統計單一材料（整組另外在整組頁管理）
  ALL_ITEMS.filter(i => !i.is_kit).forEach(i => { counts[i.brand] = (counts[i.brand] || 0) + 1; });
  const brands = ['全部', ...Object.keys(counts).sort((a,b) => counts[b]-counts[a])];
  const el = document.getElementById('brand-tabs');
  el.innerHTML = '';
  brands.forEach(b => {
    const tab = document.createElement('div');
    tab.className = 'brand-tab' + (b === currentBrand ? ' active' : '');
    tab.innerHTML = `${esc(b)}<span class="count">${counts[b] || ALL_ITEMS.length}</span>`;
    tab.onclick = () => {
      currentBrand = b;
      // 更新所有 tab 的 active 樣式（點哪個哪個變深色）
      document.querySelectorAll('.brand-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      renderInventory();
    };
    el.appendChild(tab);
  });
  el.style.display = 'flex';
}

// 從 ALL_ITEMS 建立廠牌與位置的 datalist 建議清單，並載入去向建議
function buildDatalists() {
  const brands = [...new Set(ALL_ITEMS.map(i => i.brand))].sort();
  const locs = [...new Set(ALL_ITEMS.flatMap(i => (i.stocks || []).map(s => s.location)))].sort();
  document.getElementById('brand-list').innerHTML = brands.map(b => `<option value="${esc(b)}">`).join('');
  document.getElementById('location-list').innerHTML = locs.map(l => `<option value="${esc(l)}">`).join('');
  loadDestinations();
}

// ========== 庫存頁渲染 ==========
function renderInventory() {
  const isViewer = typeof currentUser !== 'undefined' && currentUser && currentUser.role === 'viewer';
  document.getElementById('brand-tabs').style.display = 'flex';
  const kw = document.getElementById('search-input').value.trim().toLowerCase();
  // 庫存頁只顯示單一材料（整組在「🔧 整組」頁籤管理）
  let list = ALL_ITEMS.filter(i => !i.is_kit);
  if (currentBrand !== '全部') list = list.filter(i => i.brand === currentBrand);
  if (kw) {
      list = list.filter(i => {
        // 品項本身 + 每個位置的 location/note 都列入搜尋
        const stockStr = (i.stocks || []).map(s => `${s.location} ${s.note}`).join(' ');
        return (i.name || '').toLowerCase().includes(kw) ||
        (i.code || '').toLowerCase().includes(kw) ||
        (i.brand || '').toLowerCase().includes(kw) ||
        stockStr.toLowerCase().includes(kw);
      });
    }

  const content = document.getElementById('content');
  if (!list.length) {
    content.innerHTML = '<div class="empty">沒有符合的品項 🔍</div>';
    updateSaveBar();
    return;
  }

  const byLoc = {};
  // 多位置品項：以「第一個位置」為主分組（卡片上會列出全部位置）
  list.forEach(i => {
    const mainLoc = (i.stocks && i.stocks.length && i.stocks[0].location) || '未標示';
    (byLoc[mainLoc] = byLoc[mainLoc] || []).push(i);
  });

  let html = '';
  Object.keys(byLoc).sort().forEach(loc => {
    const locItems = byLoc[loc];
    html += `<div class="section-title"><span class="loc">位置：${esc(loc)}</span><span>${locItems.length} 項</span></div>`;
    locItems.forEach(i => {
      const delta = pending[i.id] || 0;
      const display = Math.round((i.qty + delta) * 1000) / 1000;
      const isZero = display <= 0;
      const prepared = i.prepared_qty || 0;
      // 位置標籤（位置：文字）與備註（📝 具體位置/說明）分開兩行顯示
      // v10：多位置品項列出所有位置行；單一位置維持原本兩行樣式
      const stocks = i.stocks && i.stocks.length ? i.stocks : [{id: null, location: i.location || '', qty: i.qty, note: i.note || ''}];
      const locHtml = stocks.map(s => `
            <div class="item-loc">位置：${esc(s.location || '未標示')}${s.note ? `｜${esc(s.note)}` : ''}</div>`).join('');
      html += `
      <div class="item-card" id="card-${i.id}">
        ${i.has_photo
                  ? `<img class="item-photo" src="/uploads/${i.id}.jpg" alt="${esc(i.name)}" loading="lazy"
                       onclick="openPhotoLightbox(${i.id})" title="點擊看大圖"
                       onerror="this.style.display='none'">`
                  : ''}
        ${isViewer ? '' : `<button class="edit-btn" onclick="openEditModal(${i.id})" title="編輯品項">編輯</button>
        <button class="del-btn" onclick="deleteItem(${i.id})" title="刪除材料">刪除</button>`}
        <div class="item-info" ${isViewer ? '' : `onclick="openEditModal(${i.id})"`}>
          <div class="item-name">${esc(i.name) || '—'}${i.site === 'warehouse' ? '<span class="site-badge wh">🏭 倉庫</span>' : ''}</div>
          <div class="item-code">${esc(i.brand)}${i.code ? ' · ' + esc(i.code) : ''}</div>
          ${locHtml}
          
          ${i.is_kit ? `<div class="kit-tag">🔧 整組</div>` : ''}
          ${prepared > 0 ? `<div class="prepared-tag">📤 待領出 ${prepared} ${esc(i.unit)}</div>` : ''}
          ${isViewer ? '' : `<div style="margin-top:4px">
            <div style="display:flex;flex-direction:column;gap:4px;margin-top:5px">
              ${!i.is_kit ? `<button class="btn-prepare" onclick="openPrepareModal(${i.id}, event)">📤 待領出</button>` : ''}
              <button class="btn-out" onclick="openOutModal(${i.id}, event)">🚚 已領出</button>
            </div>
          </div>`}
        </div>
        ${isViewer
          ? `<div class="qty-control"><div class="qty-value" style="cursor:default" title="唯讀">${display}<span class="unit"> ${esc(i.unit)}</span></div></div>`
          : `<div class="qty-control">
          <button class="qty-btn qty-minus" onclick="changeQty(${i.id}, -1)" ${isZero && delta <= 0 ? 'disabled' : ''}>−</button>
          <div class="qty-value" onclick="quickSet(${i.id})" title="點數字可輸入">${display}<span class="unit"> ${esc(i.unit)}</span></div>
          <button class="qty-btn qty-plus" onclick="changeQty(${i.id}, 1)">+</button>
        </div>`}
      </div>`;
    });
  });
  content.innerHTML = html;
  updateSaveBar();
}

// ========== 數量增減（暫存） ==========
function changeQty(id, delta) {
  const item = ALL_ITEMS.find(i => i.id === id);
  if (!item) return;
  const cur = pending[id] || 0;
  const newDelta = cur + delta;
  if (item.qty + newDelta < 0) return;
  if (newDelta === 0) delete pending[id];
  else pending[id] = newDelta;
  renderInventory();
}

// 點卡片數量數字 → prompt 輸入新數量，差異寫入 pending 暫存後重繪
function quickSet(id) {
  const item = ALL_ITEMS.find(i => i.id === id);
  if (!item) return;
  const cur = item.qty + (pending[id] || 0);
  const input = prompt(`輸入「${item.name}」的新數量：`, cur);
  if (input === null) return;
  const val = parseFloat(input);
  if (!isFinite(val) || val < 0) { toast('請輸入有效的數字', 'error'); return; }
  const newDelta = val - item.qty;
  if (newDelta === 0) delete pending[id];
  else pending[id] = newDelta;
  renderInventory();
}

// 依 pending 是否有未儲存變更，顯示/隱藏底部「儲存變更」列
function updateSaveBar() {
  const n = Object.keys(pending).length;
  const bar = document.getElementById('save-bar');
  if (n > 0 && currentTab === 'inventory') {
    bar.classList.add('show');
    document.getElementById('pending-count').textContent = n;
  } else {
    bar.classList.remove('show');
  }
}


// ========== 刪除材料（2026-08-11 Sarah 需求：每張卡片 ✕ 刪除整筆材料） ==========
async function deleteItem(itemId) {
  if (!confirm('確定刪除這個材料？會一併刪除它的庫存、照片與異動紀錄，無法恢復。')) return;
  try {
    const res = await fetch(`/api/items/${itemId}`, { method: 'DELETE' });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      alert(e.detail || '刪除失敗');
      return;
    }
    await loadData();
  } catch (e) { alert('刪除失敗：' + e.message); }
}
