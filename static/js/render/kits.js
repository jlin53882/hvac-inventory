// 庫存管理系統 - 整組頁渲染（v8 拆分）
// ========== 整組（套件）頁籤 ==========
async function renderKits() {
  document.getElementById('brand-tabs').style.display = 'none';
  const content = document.getElementById('content');
  content.innerHTML = '<div class="loading"><div class="spin"></div><div>載入整組清單…</div></div>';

  try {
    const res = await fetch(`/api/kits?site=${currentSite}`);
    const kits = await res.json();

    let html = `
      <div class="section-title"><span class="loc">🔧 整組（套件）</span><span>${kits.length} 個</span></div>
      <div style="display:flex;gap:8px;margin-bottom:14px">
        <button class="btn-save" style="flex:1;padding:11px;font-size:13.5px" onclick="openKitModal()">➕ 新增整組</button>
      </div>`;

    if (!kits.length) {
      html += '<div class="empty">🔧 還沒有整組定義<br><small>例如「電磁閥套組」由線圈+本體組成，可一鍵組裝/拆解</small></div>';
    } else {
      kits.forEach(k => {
        const canAssemble = k.components.every(c => c.stock >= c.need_qty);
        html += `<div style="background:#fff;border-radius:12px;padding:14px;margin-bottom:10px;box-shadow:0 1px 3px rgba(0,0,0,0.06)">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <div>
              <b style="font-size:14.5px">🔧 ${esc(k.name)}</b>
              <span class="kit-tag" style="margin-left:6px">庫存 ${k.stock_qty} ${esc(k.unit || '組')}</span>
            </div>
            <div style="display:flex;gap:6px">
              <button class="btn-prepare" style="margin-top:0" onclick="assembleKit(${k.id})" ${canAssemble ? '' : 'disabled title="材料不足"'}>🛠️ 組裝</button>
              <button class="btn-out" style="margin-top:0" onclick="disassembleKit(${k.id})" ${k.stock_qty > 0 ? '' : 'disabled title="整組庫存為0"'}>✂️ 拆解</button>
            </div>
          </div>
          <table class="data-table"><thead><tr><th>材料</th><th>需要</th><th>庫存</th></tr></thead><tbody>`;
        k.components.forEach(c => {
          const enough = c.stock >= c.need_qty;
          html += `<tr>
            <td>${esc(c.brand)} ${esc(c.name)}</td>
            <td style="text-align:center">${c.need_qty} ${esc(c.unit)}</td>
            <td style="text-align:center;color:${enough ? '#16a34a' : '#dc2626'}">${c.stock} ${esc(c.unit)}</td>
          </tr>`;
        });
        html += '</tbody></table>';
        html += '</div>';
      });
    }
    content.innerHTML = html;
  } catch (e) {
    content.innerHTML = `<div class="empty">⚠️ 載入失敗<br><small>${e.message}</small></div>`;
  }
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
          <div class="bd">${sel ? `庫存 ${sel.qty} ${esc(sel.unit || '個')}` : ''}</div>
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
        <div><div class="nm">${esc(it.brand)} ${esc(it.name)}</div><div class="bd">${esc(it.unit || '')}</div></div>
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
