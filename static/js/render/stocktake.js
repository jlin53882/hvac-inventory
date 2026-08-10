// 庫存管理系統 - 盤點頁渲染（v10：以位置庫存為單位對帳）
// ========== 盤點頁 ==========
async function renderStocktake() {
  document.getElementById('brand-tabs').style.display = 'none';
  const content = document.getElementById('content');

  // 載入盤點日期歷史 + 品項
  let takeDates = [];
  try {
    const res = await fetch('/api/stocktake/dates');
    takeDates = await res.json();
  } catch {}

  // 統計卡片（缺貨只算單一材料；低庫存整組與單一都算）— 以總量判斷
  const zeroItems = ALL_ITEMS.filter(i => !i.is_kit && i.qty <= 0);
  const lowItems = ALL_ITEMS.filter(i => i.low_stock > 0 && i.qty <= i.low_stock);
  const zero = zeroItems.length;
  const low = lowItems.length;
  const totalQty = ALL_ITEMS.reduce((s, i) => s + i.qty, 0);

  let html = `
    <div class="stat-cards">
      <div class="stat-card"><div class="num">${ALL_ITEMS.length}</div><div class="lbl">品項總數</div></div>
      <div class="stat-card clickable ${low ? 'warn' : ''}" onclick="showStocktakeList('low')"><div class="num">${low}</div><div class="lbl">低庫存 ▶</div></div>
      <div class="stat-card clickable ${zero ? 'danger' : ''}" onclick="showStocktakeList('zero')"><div class="num">${zero}</div><div class="lbl">缺貨 ▶</div></div>
    </div>`;

  // 上次盤點摘要
  if (takeDates.length) {
    const last = takeDates[0];
    html += `<div class="section-title"><span class="loc">🗓️ 上次盤點</span><span>${esc(last.take_date)}</span></div>
      <div style="background:#fff;border-radius:10px;padding:10px 14px;margin-bottom:14px;font-size:12.5px;color:#555;display:flex;gap:16px;flex-wrap:wrap">
        <span>盤點 <b>${last.item_count}</b> 項</span>
        <span>差異 <b style="color:${last.total_diff > 0 ? '#16a34a' : '#dc2626'}">${last.total_diff}</b> 件</span>
        <span>有差異品項 <b>${last.diff_count}</b> 項</span>
      </div>`;
  }

  // 盤點日期歷史（最近5次）
  if (takeDates.length > 1) {
    html += `<div class="section-title"><span class="loc">📚 盤點歷史</span></div>`;
    html += `<table class="data-table"><thead><tr><th>日期</th><th>盤點數</th><th>有差異</th><th>總差異</th></tr></thead><tbody>`;
    takeDates.slice(0, 5).forEach(d => {
      html += `<tr>
        <td>${esc(d.take_date)}</td>
        <td>${d.item_count} 項</td>
        <td>${d.diff_count} 項</td>
        <td style="color:${d.total_diff > 0 ? '#16a34a' : (d.total_diff < 0 ? '#dc2626' : '#999')}">${d.total_diff}</td>
      </tr>`;
    });
    html += '</tbody></table>';
  }

  // 盤點輸入表（v10：展開每個位置 = 一列）
  html += `<div class="section-title" style="margin-top:18px"><span class="loc">✏️ 本次盤點（${todayStr()}）</span>
    <span>共 ${ALL_ITEMS.length} 項</span></div>`;
  html += `<div style="background:#fff;border-radius:12px;padding:12px 14px;margin-bottom:12px;font-size:12.5px;color:#555">
    逐項輸入<b>實際清點數量</b>，系統會自動計算盤盈/盤虧。<br>
    沒填的品項維持原數量不變。
  </div>`;

  // 依位置分組列出（同品項放多處 → 每個位置各一列）
  const rows = [];
  ALL_ITEMS.forEach(i => {
    const stocks = i.stocks && i.stocks.length ? i.stocks : [{ location: i.location || '', qty: i.qty }];
    stocks.forEach(s => {
      rows.push({ item: i, stock: s });
    });
  });
  const byLoc = {};
  rows.forEach(r => {
    const loc = r.stock.location || '未標示';
    (byLoc[loc] = byLoc[loc] || []).push(r);
  });

  Object.keys(byLoc).sort().forEach(loc => {
    const locRows = byLoc[loc];
    html += `<div class="section-title"><span class="loc">位置：${loc}</span><span>${locRows.length} 項</span></div>`;
    html += `<table class="data-table"><thead><tr>
      <th>品項</th><th style="width:130px">系統數量</th><th style="width:110px">實際數量</th>
    </tr></thead><tbody>`;
    locRows.forEach(r => {
      const i = r.item, s = r.stock;
      const key = `${i.id}:${s.location}`;
      const val = stocktakeValues[key] !== undefined ? stocktakeValues[key] : '';
      const displayLoc = s.location ? `位置：${esc(s.location)}` : '';
      html += `<tr>
        <td>${esc(i.brand)} ${esc(i.name)}<br><small style="color:#999">${displayLoc || '未標示'}${s.note ? ' · 📝 ' + esc(s.note) : ''}</small></td>
        <td style="text-align:center;font-weight:700">${s.qty} ${esc(i.unit)}</td>
        <td><div class="count-row">
          <input type="number" step="any" min="0" value="${val}"
            oninput="stocktakeValues['${key.replace(/'/g, "\\'")}'] = this.value"
            onchange="stocktakeValues['${key.replace(/'/g, "\\'")}'] = this.value; markChanged(this, '${key.replace(/'/g, "\\'")}')"
            data-key="${key.replace(/'/g, "\\'")}">
        </div></td>
      </tr>`;
    });
    html += '</tbody></table>';
  });

  html += `<div style="margin-top:16px">
    <button class="btn-save" style="width:100%;padding:13px;font-size:15px" onclick="submitStocktake()">📋 完成盤點並更新庫存</button>
  </div>`;

  content.innerHTML = html;
}

// ========== 盤點：低庫存 / 缺貨清單 ==========
function showStocktakeList(type) {
  const content = document.getElementById('content');
  const isLow = type === 'low';
  // 低庫存清單列整組及單一；缺貨清單只列單一材料
  const items = isLow
    ? ALL_ITEMS.filter(i => i.low_stock > 0 && i.qty <= i.low_stock)
    : ALL_ITEMS.filter(i => !i.is_kit && i.qty <= 0);

  let html = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <div class="section-title" style="margin:0"><span class="loc">${isLow ? '⚠️ 低庫存品項' : '⛔ 缺貨品項'}</span><span>${items.length} 項</span></div>
      <button class="btn-cancel" onclick="switchTab('stocktake')" style="padding:7px 14px">← 返回盤點</button>
    </div>
    <div style="background:${isLow ? '#fffbeb' : '#fef2f2'};border-radius:10px;padding:10px 14px;margin-bottom:12px;font-size:12.5px;color:${isLow ? '#92400e' : '#991b1b'}">
      ${isLow
        ? '💡 庫存數量已低於（或等於）警示值，建議盡快補貨。點品項可直接編輯警示值。'
        : '💡 庫存為 0 或以下的品項，需要補貨或盤點確認。'}
    </div>`;

  if (!items.length) {
    html += `<div class="empty">${isLow ? '🎉 沒有低庫存品項' : '🎉 沒有缺貨品項'}</div>`;
    content.innerHTML = html;
    return;
  }

  html += `<table class="data-table"><thead><tr>
    <th>品項</th><th>庫存</th><th>${isLow ? '警示值' : '位置'}</th>
  </tr></thead><tbody>`;

  items.sort((a, b) => a.qty - b.qty).forEach(i => {
    const locStr = (i.stocks || []).map(s => s.location || '未標示').join('、');
    html += `<tr style="cursor:pointer" onclick="openEditModal(${i.id})">
      <td>${esc(i.brand)} ${esc(i.name)}<br><small style="color:#999">${esc(locStr || '未標示')}</small></td>
      <td style="text-align:center"><b style="color:${i.qty <= 0 ? '#dc2626' : '#f59e0b'}">${i.qty}</b> ${esc(i.unit)}</td>
      <td style="text-align:center;color:#999">${isLow ? (i.low_stock || 0) : esc(locStr || '—')}</td>
    </tr>`;
  });

  html += '</tbody></table>';
  content.innerHTML = html;
}

// 盤點輸入值與系統數量不同時加上 changed 樣式（黃底），相同則移除
function markChanged(input, key) {
  // key = "itemId:location"
  const parts = key.split(':');
  const item = ALL_ITEMS.find(i => i.id === parseInt(parts[0]));
  const stock = (item && item.stocks || []).find(s => s.location === parts[1]);
  if (stock && parseFloat(input.value) !== stock.qty) input.classList.add('changed');
  else input.classList.remove('changed');
}

// 收集所有有差異的盤點值 → POST /api/stocktake 更新庫存並記錄盤點結果
async function submitStocktake() {
  const items = [];
  for (const key of Object.keys(stocktakeValues)) {
    const v = parseFloat(stocktakeValues[key]);
    if (isNaN(v)) continue;
    const parts = key.split(':');
    const itemId = parseInt(parts[0]);
    const location = parts[1];
    const item = ALL_ITEMS.find(i => i.id === itemId);
    const stock = (item && item.stocks || []).find(s => s.location === location);
    if (item && stock && v !== stock.qty) {
      items.push({ item_id: item.id, location: location, actual_qty: v });
    }
  }

  if (!items.length) { toast('沒有需要調整的品項（實際數量 = 系統數量）', 'error'); return; }

  const confirmed = confirm(`盤點 ${items.length} 項有差異，將更新庫存並記錄。\n確定送出？`);
  if (!confirmed) return;

  try {
    const res = await fetch('/api/stocktake', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ take_date: todayStr(), items: items })
    });
    if (!res.ok) throw new Error();
    const r = await res.json();
    stocktakeValues = {};
    toast(`✅ 盤點完成：${r.count} 項已更新`, 'success');
    await loadData();
  } catch (e) {
    toast('盤點送出失敗', 'error');
  }
}