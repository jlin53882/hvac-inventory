// 庫存管理系統 - 待領出頁渲染（v8 拆分）
// ========== 待領出頁籤 ==========
async function renderPrepared() {
  document.getElementById('brand-tabs').style.display = 'none';
  const content = document.getElementById('content');
  content.innerHTML = '<div class="loading"><div class="spin"></div><div>載入待領出清單…</div></div>';
  const isViewer = typeof currentUser !== 'undefined' && currentUser && currentUser.role === 'viewer';

  try {
    const res = await fetch(`/api/prepared?site=${currentSite}`);
    const items = await res.json();

    if (!items.length) {
      content.innerHTML = '<div class="empty">📤 目前沒有待領出的品項<br><small>在庫存頁點「待領出」把要帶的材料先準備好</small></div>';
      updatePreparedBadge(0);
      return;
    }

    const totalPrepared = items.reduce((s, i) => s + i.prepared_qty, 0);
    let html = `
      <div class="section-title"><span class="loc">📤 待領出（已拿出未出去）</span><span>${items.length} 項 · ${totalPrepared} 件</span></div>
      <div style="background:#f5f3ff;border-radius:10px;padding:10px 14px;margin-bottom:12px;font-size:12.5px;color:#6d28d9">
        💡 待領出 <b>不會扣庫存</b>。真正出去時按「已領出」才會扣，也可以「退回」。
      </div>`;

    html += `<table class="data-table"><thead><tr>
      <th>品項</th><th>待領出</th><th>庫存</th>${isViewer ? '' : '<th>操作</th>'}
    </tr></thead><tbody>`;

    items.forEach(i => {
      html += `<tr>
        <td>${esc(i.brand)} ${esc(i.name)}<br><small style="color:#999">${esc(i.location || '未標示')}</small></td>
        <td style="text-align:center"><b style="color:#6d28d9">${i.prepared_qty}</b> ${esc(i.unit)}</td>
        <td style="text-align:center">${i.qty} ${esc(i.unit)}</td>
        ${isViewer ? '' : `<td style="white-space:nowrap">
          <button class="btn-out" style="padding:4px 8px" onclick="openPreparedOutModal(${i.id})">🚚 已領出</button>
          <button class="btn-prepare" style="padding:4px 8px;margin-top:0" onclick="returnPrepared(${i.id})">↩️ 退回</button>
          <button class="btn-del" style="padding:4px 8px;margin-top:0" onclick="clearPrepared(${i.id}, ${i.prepared_qty})">刪除</button>
        </td>`}
      </tr>`;
    });

    html += '</tbody></table>';
    content.innerHTML = html;
    updatePreparedBadge(items.length);
  } catch (e) {
    content.innerHTML = `<div class="empty">⚠️ 載入失敗<br><small>${e.message}</small></div>`;
  }
}

// 更新底部「待領出」小標：有數量時顯示數字，沒有則隱藏
function updatePreparedBadge(n) {
  const badge = document.getElementById('prepared-badge');
  if (n > 0) {
    badge.style.display = 'inline-block';
    badge.textContent = n;
  } else {
    badge.style.display = 'none';
  }
}

// 刪除待領出：把該品項的待領出數量全部清掉（不影響庫存；2026-08-11 Sarah 需求）
async function clearPrepared(itemId, qty) {
  if (!confirm('確定刪除這筆待領出（' + qty + ' 件）？不會影響庫存。')) return;
  try {
    const res = await fetch(`/api/items/${itemId}/prepared-return`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ qty: qty, location: '' })
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.detail || '刪除失敗');
    }
    toast('✅ 已刪除待領出', 'success');
    await loadData();
    renderPrepared();
  } catch (e) {
    toast('⚠️ ' + e.message, 'error');
  }
}
