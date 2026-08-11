// 庫存管理系統 - 已領出紀錄頁渲染（v8 拆分）
// ========== 出庫紀錄頁 ==========
async function renderStockOuts() {
  const isViewer = typeof currentUser !== 'undefined' && currentUser && currentUser.role === 'viewer';
  document.getElementById('brand-tabs').style.display = 'none';
  const content = document.getElementById('content');
  content.innerHTML = '<div class="loading"><div class="spin"></div><div>載入紀錄…</div></div>';

  try {
    const res = await fetch('/api/stockouts?limit=200');
    const outs = await res.json();
    stockoutRecords = outs;  // 供退回/編輯 modal 查品項資訊

    if (!outs.length) {
      content.innerHTML = '<div class="empty">🚚 還沒有已領出紀錄<br><small>在庫存頁點「已領出」就會記錄在這裡</small></div>';
      return;
    }

    // 分組：按月
    const byMonth = {};
    outs.forEach(o => {
      const m = (o.created_at || '').slice(0, 7);
      (byMonth[m] = byMonth[m] || []).push(o);
    });

    let html = '';
    Object.keys(byMonth).sort().reverse().forEach(m => {
      const list = byMonth[m];
      // 統計只算「未退回」的出庫（退回的數量已加回庫存）
      const active = list.filter(o => !o.reverted_at);
      const totalOut = active.reduce((s, o) => s + Math.abs(o.delta), 0);
      html += `<div class="section-title"><span class="loc">📅 ${m}</span><span>${list.length} 筆 · 領出 ${totalOut} 件</span></div>`;
      html += `<table class="data-table"><thead><tr>
        <th>照片</th><th>日期</th><th>品項</th><th>數量</th><th>去向</th><th>操作</th>
      </tr></thead><tbody>`;
      list.forEach(o => {
        const reverted = !!o.reverted_at;
        const soPhoto = o.has_photo
          ? `<img class="so-photo" src="/uploads/${o.item_id}.jpg" alt="" loading="lazy">`
          : `<div class="so-photo so-photo-empty">📷</div>`;
        html += `<tr${reverted ? ' style="opacity:0.55"' : ''}>
          <td class="photo-cell">${soPhoto}</td>
          <td style="white-space:nowrap">${esc((o.created_at||'').slice(5,16))}</td>
          <td>${esc(o.brand)} ${esc(o.item_name)}${o.code ? '<br><small style="color:#999">'+esc(o.code)+'</small>' : ''}</td>
          <td class="qty-neg">-${absNum(o.delta)} ${esc(o.unit)}</td>
          <td>${o.destination ? `<span class="dest-chip">🏢 ${esc(o.destination)}</span>` : '<span style="color:#ccc">—</span>'}
              ${reverted ? '<br><span style="color:#999;font-size:11px">↩️ 已退回</span>' : ''}</td>
          <td style="white-space:nowrap">
            ${isViewer ? '' : (reverted
              ? `<button class="btn-del" style="padding:4px 8px" onclick="deleteStockoutRecord(${o.id})">刪除</button>`
              : `<button class="btn-prepare" style="padding:4px 8px" onclick="openEditStockoutModal(${o.id})">✏️ 編輯</button>
                 <button class="btn-out" style="padding:4px 8px" onclick="returnStockout(${o.id})">↩️ 退回</button>
                 <button class="btn-del" style="padding:4px 8px" onclick="deleteStockoutRecord(${o.id})">刪除</button>`)}
          </td>
        </tr>`;
      });
      html += '</tbody></table>';
    });
    content.innerHTML = html;
  } catch (e) {
    content.innerHTML = `<div class="empty">⚠️ 載入失敗<br><small>${e.message}</small></div>`;
  }
}

// 刪除已領出紀錄（僅刪紀錄、不回補庫存；2026-08-11 Sarah 需求）
async function deleteStockoutRecord(movementId) {
  if (!confirm('確定刪除這筆已領出紀錄？只刪紀錄、不會回補庫存。')) return;
  try {
    const res = await fetch(`/api/stockouts/${movementId}`, { method: 'DELETE' });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.detail || '刪除失敗');
    }
    toast('✅ 已刪除紀錄', 'success');
    renderStockOuts();
  } catch (e) {
    toast('⚠️ ' + e.message, 'error');
  }
}
