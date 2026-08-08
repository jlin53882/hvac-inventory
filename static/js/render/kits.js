// 冷凍空調庫存系統 - 整組頁渲染（v8 拆分）
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

function renderKitCompRows() {
  const wrap = document.getElementById('kit-comps');
  wrap.innerHTML = '';
  kitModalCompRows.forEach((row, idx) => {
    const options = ALL_ITEMS
      .filter(i => !i.is_kit)
      .map(i => `<option value="${i.id}" ${row.item_id == i.id ? 'selected' : ''}>${esc(i.brand)} ${esc(i.name)}（庫存 ${i.qty} ${esc(i.unit)}）</option>`)
      .join('');
    wrap.innerHTML += `<div style="display:flex;gap:8px;margin-bottom:8px;align-items:center">
      <select style="flex:1;padding:8px;border:1.5px solid #d0d5dd;border-radius:8px;font-size:13px" onchange="kitModalCompRows[${idx}].item_id = this.value">
        <option value="">選擇材料…</option>${options}
      </select>
      <input type="number" style="width:60px;padding:8px;border:1.5px solid #d0d5dd;border-radius:8px;font-size:13px;text-align:center" min="1" step="any" value="${row.qty || 1}" placeholder="數量" onchange="kitModalCompRows[${idx}].qty = parseFloat(this.value) || 1">
      <button class="btn-cancel" style="padding:7px 10px" onclick="removeKitCompRow(${idx})">✕</button>
    </div>`;
  });
}

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
