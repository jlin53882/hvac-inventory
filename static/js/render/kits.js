// 庫存管理系統 - 整組頁渲染（v8 拆分）
// ========== 整組（套件）頁籤 ==========
async function renderKits() {
  const content = document.getElementById('content');
  content.innerHTML = '<div class="loading"><div class="spin"></div><div>載入整組清單…</div></div>';
  const isViewer = !hasPerm('kit-mgmt');

  try {
    const res = await fetch(`/api/kits?site=${currentSite}`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const kits = await res.json();
    const filteredKits = filterBySearch(kits, function(k) {
      return [k.name, k.note, (k.components || []).map(function(c) {
        return c.brand + ' ' + c.name + ' ' + (c.code || '');
      }).join(' ')].join(' ');
    });
    const isM = (typeof isMobileView === 'function') && isMobileView();
    let html = renderKitPageHeader(isViewer);
    html += renderKitDashboard(getKitDashboardStats(filteredKits));
    html += renderKitToolbar(filteredKits.length);

    if (!filteredKits.length) {
      const hasSearch = !!(document.getElementById('search-input') && document.getElementById('search-input').value.trim());
      html += `<div class="kit-empty-state">
        <div class="kit-empty-icon" aria-hidden="true">🔧</div>
        <h2>${esc(hasSearch ? '沒有符合搜尋條件的整組' : '目前沒有整組資料') }</h2>
        <p>${esc(hasSearch ? '可以清除搜尋或調整關鍵字。' : '可以建立整組並加入組成材料。') }</p>
        ${hasSearch ? '<button class="kit-action kit-action-clear" onclick="clearSearchAutofill();renderKits()">清除搜尋</button>' : (isViewer ? '' : '<button class="kit-add-button" onclick="openKitModal()">＋ 新增整組</button>')}
      </div>`;
    } else {
      html += filteredKits.map(function(k) { return renderKitCard(k, isViewer, isM); }).join('');
    }
    content.innerHTML = html;
  } catch (e) {
    content.innerHTML = `<div class="kit-empty-state"><div class="kit-empty-icon" aria-hidden="true">⚠️</div><h2>載入整組庫存失敗</h2><p>${esc(e.message || '請稍後再試')}</p><button class="kit-action" onclick="renderKits()">重新載入</button></div>`;
  }
}

function formatKitNumber(value) {
  const n = Number(value || 0);
  return (Math.round(n * 1000) / 1000).toLocaleString('en-US');
}

function getKitStatus(kit) {
  const components = Array.isArray(kit.components) ? kit.components : [];
  const hasShortage = components.some(function(c) {
    return Number(c.need_qty || 0) > 0 && Number(c.stock || 0) <= 0;
  });
  const hasInsufficient = !hasShortage && components.some(function(c) {
    return Number(c.stock || 0) < Number(c.need_qty || 0);
  });
  return {
    status: hasShortage ? 'shortage' : (hasInsufficient ? 'insufficient' : 'normal'),
    canAssemble: !hasShortage && !hasInsufficient,
  };
}

function getKitDashboardStats(kits) {
  const materialIds = new Set();
  let shortageCount = 0;
  let insufficientCount = 0;
  (kits || []).forEach(function(kit) {
    (kit.components || []).forEach(function(component) {
      const key = component.item_id !== undefined && component.item_id !== null
        ? String(component.item_id)
        : [component.brand, component.name, component.code || ''].join('|');
      materialIds.add(key);
    });
    const status = getKitStatus(kit).status;
    if (status === 'shortage') shortageCount += 1;
    else if (status === 'insufficient') insufficientCount += 1;
  });
  return {
    kitCount: (kits || []).length,
    materialCount: materialIds.size,
    insufficientCount: insufficientCount,
    shortageCount: shortageCount,
  };
}

function renderKitPageHeader(isViewer) {
  return `<section class="kit-page-header">
    <div class="kit-heading-copy">
      <div class="kit-heading-icon" aria-hidden="true">🔧</div>
      <div><h1>整組庫存</h1><p>管理設備整組與其組成材料，查看庫存狀態與需求數量。</p></div>
    </div>
    ${isViewer ? '' : '<button class="kit-add-button" onclick="openKitModal()">＋ 新增整組</button>'}
  </section>`;
}

function renderKitDashboard(stats) {
  const cards = [
    ['📦', stats.kitCount, '整組總數', ''],
    ['🧩', stats.materialCount, '組成材料', ''],
    ['⚠️', stats.insufficientCount, '庫存不足', stats.insufficientCount ? 'is-warning' : ''],
    ['⛔', stats.shortageCount, '缺料', stats.shortageCount ? 'is-danger' : ''],
  ];
  return `<section class="kit-kpi-grid" aria-label="整組庫存統計">${cards.map(function(card) {
    return `<div class="kit-kpi-card ${esc(card[3])}"><span class="kit-kpi-icon" aria-hidden="true">${esc(card[0])}</span><div><div class="kit-kpi-number">${esc(formatKitNumber(card[1]))}</div><div class="kit-kpi-label">${esc(card[2])}</div></div></div>`;
  }).join('')}</section>`;
}

function renderKitToolbar(count) {
  const search = document.getElementById('search-input');
  const query = search ? search.value.trim() : '';
  const searchText = query ? `目前搜尋：${query}` : '使用上方搜尋框搜尋整組、材料、型號';
  return `<div class="kit-toolbar"><span class="kit-toolbar-count">共 ${esc(formatKitNumber(count))} 組</span><span class="kit-toolbar-search">🔍 <b>${esc(searchText)}</b></span></div>`;
}

function renderKitStatusBadge(status) {
  if (status === 'shortage') return '<span class="kit-status-badge is-shortage">缺料</span>';
  if (status === 'insufficient') return '<span class="kit-status-badge is-insufficient">庫存不足</span>';
  return '';
}

function renderKitActionButtons(k, isViewer, isM, status) {
  if (isViewer) return '';
  if (isM) return `<button class="kit-more" type="button" onclick="openKitSheet(${k.id})" aria-label="整組操作">⋯</button>`;
  return `<div class="kit-assembly-actions">
    <button class="kit-action is-prepare" onclick="openPrepareModal(${k.item_id}, event)">📤 待領出</button>
    <button class="kit-action is-out" onclick="openOutModal(${k.item_id}, event)">🚚 已領出</button>
    <button class="kit-action is-edit" onclick="editKit(${k.id})">✏️ 編輯</button>
    <button class="kit-action is-delete" onclick="deleteKit(${k.id})">🗑 刪除</button>
    <button class="kit-action is-assemble" onclick="assembleKit(${k.id})" ${esc(status.canAssemble ? '' : 'disabled title="材料不足"')}>🛠️ 組裝</button>
    <button class="kit-action is-disassemble" onclick="disassembleKit(${k.id})" ${Number(k.stock_qty || 0) > 0 ? '' : 'disabled title="整組庫存為 0"'}>✂️ 拆解</button>
  </div>`;
}

function renderKitComponentRow(c) {
  const stock = Number(c.stock || 0);
  const need = Number(c.need_qty || 0);
  const state = stock <= 0 && need > 0 ? 'shortage' : (stock < need ? 'insufficient' : 'normal');
  const stateLabel = state === 'shortage' ? '缺料' : (state === 'insufficient' ? '庫存不足' : '正常');
  const stateClass = `kit-component-status is-${state}`;
  return `<tr>
    <td><div class="kit-component-info">
      <span class="cphoto">${c.has_photo ? `<img src="/uploads/${c.item_id}.jpg" alt="" onclick="openPhotoLightbox(${c.item_id})" title="點擊看大圖">` : '<span class="cphoto-empty">📷</span>'}</span>
      <span><span class="kit-component-name">${esc(c.brand || '')} ${esc(c.name || '')}</span>${c.code ? `<span class="kit-component-model">型號 ${esc(c.code)}</span>` : ''}</span>
    </div></td>
    <td class="kit-component-qty">${esc(formatKitNumber(need))} ${esc(c.unit || '')}</td>
    <td class="kit-component-qty">${esc(formatKitNumber(stock))} ${esc(c.unit || '')}</td>
    <td><span class="${esc(stateClass)}">${esc(stateLabel)}</span></td>
  </tr>`;
}

function renderKitCard(k, isViewer, isM) {
  const status = getKitStatus(k);
  const components = Array.isArray(k.components) ? k.components : [];
  const stockQty = Number(k.stock_qty || 0);
  const mobileStockout = isViewer ? '' : `<div class="m-card-actions"><button class="kit-action is-prepare" onclick="openPrepareModal(${k.item_id}, event)">📤 待領出</button><button class="kit-action is-out" onclick="openOutModal(${k.item_id}, event)">🚚 已領出</button></div>`;
  return `<article class="kit-assembly-card is-${esc(status.status)}">
    <header class="kit-assembly-header">
      <div class="kit-assembly-title"><div class="kit-assembly-name">🔧 ${esc(k.name || '未命名整組')}</div><div class="kit-assembly-meta"><span class="kit-stock-badge ${stockQty > 0 ? '' : 'is-empty'}">庫存 ${esc(formatKitNumber(stockQty))} ${esc(k.unit || '組')}</span>${renderKitStatusBadge(status.status)}<span>${components.length} 項組成材料</span></div></div>
      ${renderKitActionButtons(k, isViewer, isM, status)}
    </header>
    ${mobileStockout}
    <div class="kit-component-wrap"><table class="kit-component-table"><thead><tr><th>材料</th><th>需求數量</th><th>目前庫存</th><th>狀態</th></tr></thead><tbody>${components.map(renderKitComponentRow).join('')}</tbody></table></div>
  </article>`;
}

// 渲染整組 Modal 的材料選擇（demo 樣式：已選灰卡片列 + 單一可搜尋輸入框）
// 資料存 kitModalCompRows：[{item_id, qty}...]；選中材料自動 push 新列
function renderKitCompRows() {
  const wrap = document.getElementById('kit-comps');
  let html = '';
  if (!kitModalCompRows.length) {
    html = '<div class="kit-empty">尚未加入材料</div>';
  } else {
    html = kitModalCompRows.map((row, idx) => {
      const sel = row.item_id ? ALL_ITEMS.find(i => i.id == row.item_id) : null;
      return `<div class="selected-row">
        <div class="info">
          <div class="nm">${sel ? esc(sel.brand) + ' ' + esc(sel.name) : ''}</div>
          <div class="bd">${sel ? `${sel.code ? `型號 <span class="model">${esc(sel.code)}</span> ・ ` : ''}庫存 ${sel.qty} ${esc(sel.unit || '個')}` : ''}</div>
        </div>
        <input type="number" min="1" step="any" value="${row.qty || 1}" onchange="kitModalCompRows[${idx}].qty = parseFloat(this.value) || 1">
        <button class="rm" onclick="removeKitCompRow(${idx})">✕</button>
      </div>`;
    }).join('');
  }
  // 單一可搜尋輸入框（🔍 搜尋材料想加的…）
  html += `<div class="mat-search">
    <div class="input-wrap">
      <input type="text" id="kit-mat-input" placeholder="🔍 搜尋材料想加的（名稱/型號/廠牌）…" autocomplete="off"
        onfocus="openKitSearch()" oninput="filterKitSearch(this.value)">
      <span class="caret">▼</span>
    </div>
    <div class="kit-dropdown" id="kit-drop"></div>
  </div>`;
  wrap.innerHTML = html;
}

// 開啟材料候選清單（顯示前 15 筆）
function openKitSearch() {
  filterKitSearch(document.getElementById('kit-mat-input').value);
}

// 依關鍵字過濾材料（名稱/型號/廠牌）並渲染候選清單
function filterKitSearch(kw) {
  const drop = document.getElementById('kit-drop');
  const q = (kw || '').trim().toLowerCase();
  let list = ALL_ITEMS.filter(i => !i.is_kit);
  if (q) list = list.filter(i => (i.brand + ' ' + i.name + ' ' + (i.code || '')).toLowerCase().includes(q));
  list = list.slice(0, 15);
  if (!list.length) {
    drop.innerHTML = '<div class="kit-drop-empty">找不到符合的材料</div>';
  } else {
    drop.innerHTML = list.map(it => `
      <div class="kit-drop-opt" onclick="pickKitItem(${it.id})">
        <div><div class="nm">${esc(it.brand)} ${esc(it.name)}</div><div class="bd">${it.code ? `型號 <span class="model">${esc(it.code)}</span> ・ ` : ''}${esc(it.unit || '')}</div></div>
        <span class="stk">庫存 ${it.qty}</span>
      </div>`).join('');
  }
  drop.classList.add('open');
}

// 選中候選材料：已加過同材料 → 數量 +1；否則新增一列；清空搜尋框、收合候選清單
function pickKitItem(itemId) {
  const it = ALL_ITEMS.find(i => i.id === itemId);
  if (!it) return;
  const exist = kitModalCompRows.findIndex(r => r.item_id == itemId);
  if (exist >= 0) {
    kitModalCompRows[exist].qty = (kitModalCompRows[exist].qty || 1) + 1;
  } else {
    kitModalCompRows.push({ item_id: itemId, qty: 1 });
  }
  const input = document.getElementById('kit-mat-input');
  if (input) input.value = '';
  document.getElementById('kit-drop').classList.remove('open');
  renderKitCompRows();
  const ni = document.getElementById('kit-mat-input');
  if (ni) ni.focus();
}
document.addEventListener('click', (e) => {
  const inSearch = e.target.closest('.mat-search');
  document.querySelectorAll('.kit-dropdown.open').forEach(d => {
    if (!inSearch || !inSearch.contains(d)) d.classList.remove('open');
  });
});

// 組裝整組：輸入組數 → POST /api/kits/{id}/assemble 扣材料、加整組庫存
async function assembleKit(kitId) {
  const qty = prompt('要組裝幾組？', 1);
  if (qty === null) return;
  const n = parseInt(qty);
  if (!n || n <= 0) { toast('請輸入有效數量', 'error'); return; }
  try {
    const res = await fetch(`/api/kits/${kitId}/assemble`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ qty: n })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || '組裝失敗');
    }
    toast(`✅ 已組裝 ${n} 組（材料已扣）`, 'success');
    await loadData();
    renderKits();
  } catch (e) {
    toast('⚠️ ' + e.message, 'error');
  }
}

// 拆解整組：輸入組數 → POST /api/kits/{id}/disassemble 還材料、扣整組庫存
async function disassembleKit(kitId) {
  const qty = prompt('要拆解幾組？', 1);
  if (qty === null) return;
  const n = parseInt(qty);
  if (!n || n <= 0) { toast('請輸入有效數量', 'error'); return; }
  try {
    const res = await fetch(`/api/kits/${kitId}/disassemble`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ qty: n })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || '拆解失敗');
    }
    toast(`✅ 已拆解 ${n} 組（材料已加回）`, 'success');
    await loadData();
    renderKits();
  } catch (e) {
    toast('⚠️ ' + e.message, 'error');
  }
}

// 編輯整組（2026-08-11 Sarah 需求：整組也要能編輯/刪除，與單一庫存一致）
async function editKit(kitId) {
  let kit = null;
  try {
    const res = await fetch('/api/kits?site=all');
    kit = (await res.json()).find(k => k.id === kitId);
  } catch (e) { /* fallthrough */ }
  if (!kit) { toast('找不到整組資料', 'error'); return; }
  editingKitId = kitId;
  kitUpdatedAt = kit.updated_at || null;  // 2026-08-14 樂觀鎖快照
  kitModalCompRows = kit.components.map(c => ({ item_id: c.item_id, qty: c.need_qty }));
  document.getElementById('k-name').value = kit.name;
  document.getElementById('k-note').value = kit.note || '';
  document.querySelector('#kit-modal h3').textContent = '🔧 編輯整組';
  const btn = document.querySelector('#kit-modal .btn-confirm');
  btn.textContent = '💾 儲存整組';
  btn.setAttribute('onclick', 'submitKitEdit()');
  renderKitCompRows();
  openModal('kit-modal');
}

// 刪除整組（含定義、材料關聯、整組品項與紀錄）
async function deleteKit(kitId) {
  if (!confirm('確定刪除這個整組？它的定義、整組庫存與紀錄都會一起刪除，無法恢復。')) return;
  try {
    const res = await fetch(`/api/kits/${kitId}`, { method: 'DELETE' });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.detail || '刪除失敗');
    }
    toast('✅ 已刪除整組', 'success');
    await loadData();
    renderKits();
  } catch (e) {
    toast('⚠️ ' + e.message, 'error');
  }
}


// ========== 手機版 ⋯ 動作選單（整組卡） ==========
function openKitSheet(kitId) {
  const isViewer = !hasPerm('kit-mgmt');
  const actions = [];
  if (!isViewer) {
    actions.push({ icon: '🛠️', label: '組裝', cls: 'out', fn: () => assembleKit(kitId) });
    actions.push({ icon: '✂️', label: '拆解', cls: 'back', fn: () => disassembleKit(kitId) });
    actions.push({ icon: '✏️', label: '編輯', fn: () => editKit(kitId) });
    actions.push({ icon: '🗑', label: '刪除', cls: 'del', fn: () => deleteKit(kitId) });
  }
  openSheet('整組操作', actions);
}
