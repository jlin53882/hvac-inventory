// 庫存管理系統 - 庫存頁渲染（v8 拆分）
// filterBySearch / buildFilterPanel / renderInventory / 數量增減
// ========== 共用搜尋過濾（多詞 AND） ==========
function filterBySearch(items, matchFn) {
  var raw = document.getElementById('search-input').value.trim().toLowerCase();
  var kws = raw ? raw.split(/\s+/).filter(function(w) { return w.length > 0; }) : [];
  if (kws.length === 0) return items;
  return items.filter(function(item) {
    var hay = matchFn(item).toLowerCase();
    return kws.every(function(kw) { return hay.indexOf(kw) >= 0; });
  });
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
  const isViewer = !(hasPerm('item-mgmt') || hasPerm('stock-mgmt') || hasPerm('photo'));
  const raw = document.getElementById('search-input').value.trim().toLowerCase();
  const kws = raw ? raw.split(/\s+/).filter(w => w.length > 0) : [];
  // 庫存頁只顯示單一材料（整組在「🔧 整組」頁籤管理）
  let list = ALL_ITEMS.filter(i => !i.is_kit);
  // 品牌篩選：多選模式（currentBrands 為空 = 全部）
  if (currentBrands.length > 0) {
    list = list.filter(i => currentBrands.includes(i.brand || '無廠牌'));
  }
  // 分類篩選
  if (currentCategories.length > 0) {
    list = list.filter(i => currentCategories.includes(i.category || ''));
  }
  // 多詞 AND 搜尋：空白拆詞，每個詞都要比對到
  if (kws.length > 0) {
    list = list.filter(i => {
      const stockStr = (i.stocks || []).map(s => `${s.location} ${s.note}`).join(' ').toLowerCase();
      const hay = `${i.name||''} ${i.code||''} ${i.brand||''} ${stockStr}`.toLowerCase();
      return kws.every(kw => hay.includes(kw));
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

  // 位置折疊狀態（localStorage 記住，登出清除；per site 分開存）
  const collapsedKey = 'hvac_collapsed_locs_' + (typeof currentSite !== 'undefined' ? currentSite : 'office');
  let collapsedLocs = [];
  try { collapsedLocs = JSON.parse(localStorage.getItem(collapsedKey) || '[]') || []; } catch (e) { collapsedLocs = []; }
  const isM = (typeof isMobileView === 'function') && isMobileView();
  let html = '';
  // 2026-08-13 Sarah：新增/匯出按鈕從 topbar 移到庫存清單頂部（位置分組前，靠右；viewer 不顯示新增）
  html += `<div class="loc-export-bar">
    ${list.length ? `<span class="loc-export-count">共 ${list.length} 項</span>` : ''}
    ${isViewer ? '' : `<button class="btn-sm btn-add-inv" onclick="openAddModal()">＋ 新增</button>`}
    <button class="btn-sm btn-export" onclick="exportExcel()">⬇️ 匯出庫存</button>
  </div>`;
  if (isM) {
    // ===== 手機版：卡片式（⋯ 動作選單 + −/＋ 數量列） =====
    Object.keys(byLoc).sort().forEach(loc => {
      const locItems = byLoc[loc];
      const locCollapsed = collapsedLocs.indexOf(loc) >= 0;
      html += `<div class="section-title${locCollapsed ? ' collapsed' : ''}" data-loc="${esc(loc)}" onclick="toggleLoc(this, '${esc(loc)}')">
        <button class="collapse-btn" type="button" aria-label="折疊/展開">▾</button>
        <span class="loc">位置：${esc(loc)}</span><span>${locItems.length} 項</span>
      </div>`;
      html += `<div class="loc-group${locCollapsed ? ' collapsed' : ''}" data-loc="${esc(loc)}">`;
      locItems.forEach(i => {
        const delta = pending[i.id] || 0;
        const display = Math.round((i.qty + delta) * 1000) / 1000;
        const isZero = display <= 0;
        const prepared = i.prepared_qty || 0;
        const locs = (i.stocks && i.stocks.length ? i.stocks : [{location: i.location || '未標示', note: i.note || ''}]);
        const locStr = buildLocHTML(locs);
        html += mobileCardShell({
          reverted: false,
          moreBtnHTML: isViewer ? '' : `<button class="more-btn" onclick="openItemSheet(${i.id})">⋯</button>`,
          thumb: buildThumb(i.id, i.has_photo, i.name, '📦'),
          nameHTML: `${esc(i.name)}${i.site === 'warehouse' ? ' 🏭' : ''}`,  // V1b 2026-08-16：chip 移出品名行（防長名截出誤導 ⋯）
          subHTML: `${prepared > 0 ? '<span class="chip green">待領出 ' + prepared + '</span> ' : ''}${esc(i.brand)}${i.code ? ' · ' + esc(i.code) : ''}`,
          extraHTML: locStr,
          qtyHTML: buildQtyControl({id: i.id, display, unit: i.unit, isZero, delta, viewer: isViewer}),
          actionsHTML: isViewer ? '' : `<div class="m-card-actions">
            ${!i.is_kit ? `<button class="btn-prepare" style="margin:0" onclick="openPrepareModal(${i.id}, event)">📤 待領出</button>` : ''}
            <button class="btn-out" style="margin:0" onclick="openOutModal(${i.id}, event)">🚚 已領出</button>
          </div>`
        });
      });
      html += `</div>`;
    });
  } else {
    // ===== 桌面版：原 item-card =====
    Object.keys(byLoc).sort().forEach(loc => {
    const locItems = byLoc[loc];
    const locCollapsed = collapsedLocs.indexOf(loc) >= 0;
    html += `<div class="section-title${locCollapsed ? ' collapsed' : ''}" data-loc="${esc(loc)}" onclick="toggleLoc(this, '${esc(loc)}')">
      <button class="collapse-btn" type="button" aria-label="折疊/展開">▾</button>
      <span class="loc">位置：${esc(loc)}</span><span>${locItems.length} 項</span>
    </div>`;
    html += `<div class="loc-group${locCollapsed ? ' collapsed' : ''}" data-loc="${esc(loc)}">`;
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
    html += `</div>`;
  });
  }
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


// ========== 手機版 ⋯ 動作選單（庫存卡） ==========
function openItemSheet(itemId) {
  const item = ALL_ITEMS.find(i => i.id === itemId);
  if (!item) return;
  const isViewer = !(hasPerm('item-mgmt') || hasPerm('stock-mgmt') || hasPerm('photo'));
  const actions = [];
  if (!isViewer) {
    actions.push({ icon: '✏️', label: '編輯品項', fn: () => openEditModal(itemId) });
    actions.push({ icon: '📷', label: '更換照片', fn: () => openEditModal(itemId) });
    actions.push({ icon: '🗑', label: '刪除品項', cls: 'del', fn: () => deleteItem(itemId) });
  }
  openSheet(`${item.brand} ${item.name}`, actions);
}


// ========== 位置折疊/展開（點位置標題最左邊箭頭） ==========
// 狀態存 localStorage（per site），登出時清除還原預設展開
function toggleLoc(titleEl, loc) {
  const collapsedKey = 'hvac_collapsed_locs_' + (typeof currentSite !== 'undefined' ? currentSite : 'office');
  let arr = [];
  try { arr = JSON.parse(localStorage.getItem(collapsedKey) || '[]') || []; } catch (e) { arr = []; }
  const idx = arr.indexOf(loc);
  const nowCollapsed = idx < 0;
  if (nowCollapsed) arr.push(loc); else arr.splice(idx, 1);
  try { localStorage.setItem(collapsedKey, JSON.stringify(arr)); } catch (e) {}
  if (titleEl) titleEl.classList.toggle('collapsed', nowCollapsed);
  try {
    const groups = document.querySelectorAll('.loc-group[data-loc="' + CSS.escape(loc) + '"]');
    groups.forEach(g => g.classList.toggle('collapsed', nowCollapsed));
  } catch (e) {}
}

// ========== 篩選面板（品牌+分類 chips） ==========
function buildFilterPanel() {
  var brandCounts = {};
  ALL_ITEMS.filter(function(i) { return !i.is_kit; }).forEach(function(i) {
    var b = i.brand || '無廠牌';
    brandCounts[b] = (brandCounts[b] || 0) + 1;
  });
  var brands = Object.entries(brandCounts).sort(function(a, b) { return b[1] - a[1]; });
  document.getElementById('fp-brand-count').textContent = '(' + brands.length + ' 個品牌)';
  renderFilterChips('fp-brand-chips', brands, currentBrands, 'brand', 'fp-brand-toggle');
  var catCounts = {};
  ALL_ITEMS.filter(function(i) { return !i.is_kit; }).forEach(function(i) {
    var c = i.category || '';
    if (c) catCounts[c] = (catCounts[c] || 0) + 1;
  });
  var cats = Object.entries(catCounts).sort(function(a, b) { return b[1] - a[1]; });
  document.getElementById('fp-cat-count').textContent = '(' + cats.length + ' 類)';
  renderFilterChips('fp-cat-chips', cats, currentCategories, 'category', 'fp-cat-toggle');
  var list = getFilteredItems();
  document.getElementById('fp-summary').textContent = '共 ' + list.length + ' 項';
}

function renderFilterChips(containerId, counts, selectedArr, type, toggleBtnId) {
  var el = document.getElementById(containerId);
  el.innerHTML = '';
  var allChip = document.createElement('span');
  allChip.className = 'filter-chip' + (selectedArr.length === 0 ? ' active' : '');
  allChip.textContent = '全部';
  allChip.onclick = function() { selectedArr.length = 0; buildFilterPanel(); renderInventory(); };
  el.appendChild(allChip);
  counts.forEach(function(pair) {
    var name = pair[0], count = pair[1];
    var chip = document.createElement('span');
    var isSelected = selectedArr.includes(name);
    chip.className = 'filter-chip' + (isSelected ? ' active' : '');
    chip.innerHTML = esc(name) + ' <span class="badge">' + count + '</span>';
    chip.onclick = function() {
      var idx = selectedArr.indexOf(name);
      if (idx >= 0) selectedArr.splice(idx, 1);
      else selectedArr.push(name);
      buildFilterPanel();
      renderInventory();
    };
    el.appendChild(chip);
  });
  if (toggleBtnId) {
    var btn = document.getElementById(toggleBtnId);
    if (btn && el.classList.contains('collapsed')) {
      var hidden = counts.length - 3;
      if (hidden > 0) btn.textContent = '還有 ' + hidden + ' 個' + (type === 'brand' ? '品牌' : '分類') + ' ▼';
    }
  }
}

function getFilteredItems() {
  var raw = document.getElementById('search-input').value.trim().toLowerCase();
  var kws = raw ? raw.split(/\s+/).filter(function(w) { return w.length > 0; }) : [];
  var list = ALL_ITEMS.filter(function(i) { return !i.is_kit; });
  if (currentBrands.length > 0) list = list.filter(function(i) { return currentBrands.includes(i.brand || '無廠牌'); });
  if (currentCategories.length > 0) list = list.filter(function(i) { return currentCategories.includes(i.category || ''); });
  if (kws.length > 0) {
    list = list.filter(function(i) {
      var stockStr = (i.stocks || []).map(function(s) { return s.location + ' ' + s.note; }).join(' ').toLowerCase();
      var hay = ((i.name || '') + ' ' + (i.code || '') + ' ' + (i.brand || '') + ' ' + stockStr).toLowerCase();
      return kws.every(function(kw) { return hay.indexOf(kw) >= 0; });
    });
  }
  return list;
}

function toggleFilterCollapse(containerId, toggleBtnId) {
  var el = document.getElementById(containerId);
  var btn = document.getElementById(toggleBtnId);
  var isCollapsed = el.classList.toggle('collapsed');
  btn.textContent = isCollapsed ? '展開 ▼' : '收合 ▲';
}

function clearFilterPanel() {
  currentBrands.length = 0;
  currentCategories.length = 0;
  document.getElementById('search-input').value = '';
  buildFilterPanel();
  renderInventory();
}
