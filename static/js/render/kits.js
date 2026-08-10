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

// 渲染整組 Modal 的材料選擇列（可搜尋輸入 + 數量 + 刪除鈕）
function renderKitCompRows() {
  const wrap = document.getElementById('kit-comps');
  wrap.innerHTML = '';
  if (!kitModalCompRows.length) {
    wrap.innerHTML = '<div class="kit-empty">尚未加入材料</div>';
    return;
  }
  kitModalCompRows.forEach((row, idx) => {
    const sel = row.item_id ? ALL_ITEMS.find(i => i.id == row.item_id) : null;
    const disp = sel ? `${sel.brand} ${sel.name}` : '';
    wrap.innerHTML += `<div class="kit-comp-row">
      <div class="kit-search">
        <input type="text" id="kit-sel-${idx}" class="kit-search-input" value="${esc(disp)}"
          placeholder="搜尋材料想加的 (名稱/型號/廠牌) ..." autocomplete="off"
          onfocus="openKitSearch(${idx})" oninput="filterKitSearch(${idx}, this.value)">
        ${sel ? `<div class="kit-sel-info">庫存 ${sel.qty} ${esc(sel.unit || '個')}</div>` : ''}
        <span class="kit-caret">▼</span>
        <div class="kit-dropdown" id="kit-drop-${idx}"></div>
      </div>
      <input type="number" class="kit-qty" min="1" step="any" value="${row.qty || 1}" placeholder="數量" onchange="kitModalCompRows[${idx}].qty = parseFloat(this.value) || 1">
      <button class="btn-cancel kit-rm" onclick="removeKitCompRow(${idx})">✕</button>
    </div>`;
  });
}

// 開啟第 idx 列的材料候選清單（顯示前 15 筆）
function openKitSearch(idx) {
  filterKitSearch(idx, document.getElementById(`kit-sel-${idx}`).value);
}

// 依關鍵字過濾材料（名稱/型號/廠牌）並渲染候選清單
function filterKitSearch(idx, kw) {
  const drop = document.getElementById(`kit-drop-${idx}`);
  const q = (kw || '').trim().toLowerCase();
  let list = ALL_ITEMS.filter(i => !i.is_kit);
  if (q) list = list.filter(i => (i.brand + ' ' + i.name + ' ' + (i.code || '')).toLowerCase().includes(q));
  list = list.slice(0, 15);
  if (!list.length) {
    drop.innerHTML = '<div class="kit-drop-empty">找不到符合的材料</div>';
  } else {
    drop.innerHTML = list.map(it => `
      <div class="kit-drop-opt" onclick="pickKitItem(${idx}, ${it.id})">
        <div><div class="nm">${esc(it.brand)} ${esc(it.name)}</div><div class="bd">${esc(it.unit || '')}</div></div>
        <span class="stk">庫存 ${it.qty}</span>
      </div>`).join('');
  }
  drop.classList.add('open');
}

// 選中候選材料：寫入列資料、更新輸入框顯示、收合候選清單
function pickKitItem(idx, itemId) {
  const it = ALL_ITEMS.find(i => i.id === itemId);
  if (!it) return;
  kitModalCompRows[idx].item_id = itemId;
  kitModalCompRows[idx].qty = kitModalCompRows[idx].qty || 1;
  const input = document.getElementById(`kit-sel-${idx}`);
  input.value = `${it.brand} ${it.name}`;
  document.getElementById(`kit-drop-${idx}`).classList.remove('open');
}
document.addEventListener('click', (e) => {
  const inSearch = e.target.closest('.kit-search');
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
