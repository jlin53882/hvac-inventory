// 冷凍空調庫存系統 - 庫存頁渲染（v8 拆分）
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
    tab.innerHTML = `${b}<span class="count">${counts[b] || ALL_ITEMS.length}</span>`;
    tab.onclick = () => { currentBrand = b; renderInventory(); };
    el.appendChild(tab);
  });
  el.style.display = 'flex';
}

function buildDatalists() {
  const brands = [...new Set(ALL_ITEMS.map(i => i.brand))].sort();
  const locs = [...new Set(ALL_ITEMS.map(i => i.location))].sort();
  document.getElementById('brand-list').innerHTML = brands.map(b => `<option value="${b}">`).join('');
  document.getElementById('location-list').innerHTML = locs.map(l => `<option value="${l}">`).join('');
  loadDestinations();
}

// ========== 庫存頁渲染 ==========
function renderInventory() {
  document.getElementById('brand-tabs').style.display = 'flex';
  const kw = document.getElementById('search-input').value.trim().toLowerCase();
  // 庫存頁只顯示單一材料（整組在「🔧 整組」頁籤管理）
  let list = ALL_ITEMS.filter(i => !i.is_kit);
  if (currentBrand !== '全部') list = list.filter(i => i.brand === currentBrand);
  if (kw) {
    list = list.filter(i =>
      (i.name || '').toLowerCase().includes(kw) ||
      (i.code || '').toLowerCase().includes(kw) ||
      (i.note || '').toLowerCase().includes(kw) ||
      (i.brand || '').toLowerCase().includes(kw)
    );
  }

  const content = document.getElementById('content');
  if (!list.length) {
    content.innerHTML = '<div class="empty">沒有符合的品項 🔍</div>';
    updateSaveBar();
    return;
  }

  const byLoc = {};
  list.forEach(i => { (byLoc[i.location || '未標示'] = byLoc[i.location || '未標示'] || []).push(i); });

  let html = '';
  Object.keys(byLoc).sort().forEach(loc => {
    const locItems = byLoc[loc];
    html += `<div class="section-title"><span class="loc">📍 ${loc}</span><span>${locItems.length} 項</span></div>`;
    locItems.forEach(i => {
      const delta = pending[i.id] || 0;
      const display = i.qty + delta;
      const isZero = display <= 0;
      const prepared = i.prepared_qty || 0;
      // 具體位置（note 像位置描述時）併入 📍 位置標籤；真正備註才用 📝
      const noteLikeLoc = i.note && /[層排格右左上櫃門鐵架]/.test(i.note);
      const locText = (i.location || '未標示') + (noteLikeLoc ? ' · ' + i.note : '');
      html += `
      <div class="item-card" id="card-${i.id}">
        <button class="edit-btn" onclick="openEditModal(${i.id})" title="編輯品項">編輯</button>
        <div class="item-info" onclick="openEditModal(${i.id})">
          <div class="item-name">${esc(i.name) || '—'}${i.site === 'warehouse' ? '<span class="site-badge wh">🏭 倉庫</span>' : ''}</div>
          <div class="item-code">${esc(i.brand)}${i.code ? ' · ' + esc(i.code) : ''}</div>
          ${i.note && !noteLikeLoc ? `<div class="item-note">📝 ${esc(i.note)}</div>` : ''}
          ${i.is_kit ? `<div class="kit-tag">🔧 整組</div>` : ''}
          ${prepared > 0 ? `<div class="prepared-tag">📤 待領出 ${prepared} ${esc(i.unit)}</div>` : ''}
          <div style="margin-top:4px">
            <span class="item-loc">📍 ${esc(locText)}</span>
            <div style="display:flex;flex-direction:column;gap:4px;margin-top:5px">
              ${!i.is_kit ? `<button class="btn-prepare" onclick="openPrepareModal(${i.id}, event)">📤 待領出</button>` : ''}
              <button class="btn-out" onclick="openOutModal(${i.id}, event)">🚚 已領出</button>
            </div>
          </div>
        </div>
        <div class="qty-control">
          <button class="qty-btn qty-minus" onclick="changeQty(${i.id}, -1)" ${isZero && delta <= 0 ? 'disabled' : ''}>−</button>
          <div class="qty-value" onclick="quickSet(${i.id})" title="點數字可輸入">${display}<span class="unit"> ${esc(i.unit)}</span></div>
          <button class="qty-btn qty-plus" onclick="changeQty(${i.id}, 1)">+</button>
        </div>
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

function quickSet(id) {
  const item = ALL_ITEMS.find(i => i.id === id);
  if (!item) return;
  const cur = item.qty + (pending[id] || 0);
  const input = prompt(`輸入「${item.name}」的新數量：`, cur);
  if (input === null) return;
  const val = parseFloat(input);
  if (isNaN(val) || val < 0) { toast('請輸入有效的數字', 'error'); return; }
  const newDelta = val - item.qty;
  if (newDelta === 0) delete pending[id];
  else pending[id] = newDelta;
  renderInventory();
}

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
