// 庫存管理系統 - 已領出紀錄頁渲染（v8 拆分 + 退回紀錄顯示）
// ========== 出庫紀錄頁 ==========
async function renderStockOuts() {
  const isViewer = !hasPerm('stockout');
  const content = document.getElementById('content');
  content.innerHTML = '<div class="loading"><div class="spin"></div><div>載入紀錄…</div></div>';

  try {
    const res = await fetch(`/api/stockouts?limit=200&site=${currentSite}`);
    let outs = await res.json();
    stockoutRecords = outs;  // 供退回/編輯 modal 查品項資訊

    // 搜尋過濾
    outs = filterBySearch(outs, function(o) {
      return [o.name, o.code, o.brand, o.destination, o.note].join(' ');
    });
    if (!outs.length) {
      content.innerHTML = '<div class="empty">🚚 還沒有已領出紀錄<br><small>在庫存頁點「已領出」就會記錄在這裡</small>' +
        (isViewer ? '' : '<br><br><button class="btn-add-inv" onclick="openNonStockOutModal()">＋ 新增已領出</button>') + '</div>';
      return;
    }

    // 分組：按日（包含退回紀錄）
    const byMonth = {};
    outs.forEach(o => {
      const m = (o.created_at || '').slice(0, 10);
      (byMonth[m] = byMonth[m] || []).push(o);
    });

    const isM = (typeof isMobileView === 'function') && isMobileView();
    let html = '';
    const stockoutBar = `<div class="loc-export-bar"><span>共 ${outs.length} 筆</span>${isViewer ? '' : '<button class="btn-add-inv" onclick="openNonStockOutModal()">＋ 新增已領出</button>'}</div>`;
    html += stockoutBar;
    if (isM) {
      // ===== 手機版：卡片式（⋯ 動作選單） =====
      Object.keys(byMonth).sort().reverse().forEach(m => {
        const list = byMonth[m];
        const active = list.filter(o => !o.reverted_at && o.reason !== '退回已領出');
        const totalOut = active.reduce((s, o) => s + Math.abs(o.delta), 0);
        html += `<div class="section-title"><span class="loc">📅 ${m}</span><span>${list.length} 筆 · 領出 ${totalOut} 件</span></div>`;
        list.forEach(o => {
          const reverted = !!o.reverted_at;
          const isReturn = o.reason === '退回已領出';
          html += mobileCardShell({
            reverted,
            moreBtnHTML: `<button class="more-btn" onclick="openStockoutSheet(${o.id})">⋯</button>`,
            thumb: buildThumb(o.item_id, o.has_photo, o.item_name, '📷'),
            nameHTML: isReturn
              ? `${esc(o.brand)} ${esc(o.item_name)}${o.code ? '<br><small style="color:#1890FF;font-weight:600">型號 ' + esc(o.code) + '</small>' : ''}<span class="reverted-tag" style="background:#52c41a;color:#fff">↩️ 已退回</span>`
              : `${esc(o.brand)} ${esc(o.item_name)}${o.item_deleted ? '<span class="tag-nonstock">非庫存</span>' : ''}${o.code ? '<br><small style="color:#1890FF;font-weight:600">型號 ' + esc(o.code) + '</small>' : ''}${reverted ? '<span class="reverted-tag">↩️ 已退回</span>' : ''}`,
            subHTML: `${esc((o.created_at||'').slice(5,10))}`,
            extraHTML: `${o.destination ? `<div><span class="loc-tag">🏢 ${esc(o.destination)}</span></div>` : ''}${isReturn && o.return_location ? `<div><span class="loc-tag">📍 ${esc(o.return_site || '')}${o.return_site ? '／' : ''}${esc(o.return_location)}</span></div>` : ''}`,
            qtyHTML: isReturn
              ? buildQtyNum('+' + absNum(o.delta), o.unit, 'qty-pos')
              : buildQtyNum('-' + absNum(o.delta), o.unit, 'qty-neg'),
            actionsHTML: ''
          });
        });
      });
    } else {
      // ===== 桌面版：原表格 =====
    html = stockoutBar;
    Object.keys(byMonth).sort().reverse().forEach(m => {
      const list = byMonth[m];
      const active = list.filter(o => !o.reverted_at && o.reason !== '退回已領出');
      const totalOut = active.reduce((s, o) => s + Math.abs(o.delta), 0);
      html += `<div class="section-title"><span class="loc">📅 ${m}</span><span>${list.length} 筆 · 領出 ${totalOut} 件</span></div>`;
      html += `<table class="data-table"><thead><tr>
        <th>照片</th><th>日期</th><th>品項</th><th>數量</th><th>去向</th><th>操作</th>
      </tr></thead><tbody>`;
      list.forEach(o => {
        const reverted = !!o.reverted_at;
        const isReturn = o.reason === '退回已領出';
        const needsRepair = isReturn && (!o.source_movement_id || !o.return_stock_id);
        const soPhoto = o.has_photo
          ? `<img class="so-photo" src="/uploads/${o.item_id}.jpg" alt="" loading="lazy" onclick="openPhotoLightbox(${o.item_id})" title="點擊看大圖">`
          : `<div class="so-photo so-photo-empty">📷</div>`;
        html += `<tr${reverted ? ' style="opacity:0.55"' : ''}${isReturn ? ' style="background:#f6ffed"' : ''}>
          <td class="photo-cell">${soPhoto}</td>
          <td style="white-space:nowrap">${esc((o.created_at||'').slice(5,10))}</td>
          <td>${esc(o.brand)} ${esc(o.item_name)}${o.item_deleted ? '<span class="tag-nonstock">非庫存</span>' : ''}${o.code ? '<br><small style="color:#1890FF;font-weight:600">型號 ' + esc(o.code) + '</small>' : ''}${isReturn ? '<span class="reverted-tag" style="background:#52c41a;color:#fff;margin-left:4px">↩️ 已退回</span>' : ''}</td>
          <td class="${isReturn ? 'qty-pos' : 'qty-neg'}">${isReturn ? '+' : '-'}${absNum(o.delta)} ${esc(o.unit)}</td>
          <td>${o.destination ? `<span class="dest-chip">🏢 ${esc(o.destination)}</span>` : ''}${isReturn && o.return_location ? `<br><span class="dest-chip">📍 ${esc(o.return_site || '')}${o.return_site ? '／' : ''}${esc(o.return_location)}</span>` : (!o.destination ? '<span style="color:#ccc">—</span>' : '')}</td>
          <td style="white-space:nowrap">
            ${isViewer ? '' : (isReturn
              ? (reverted
                ? '<span style="color:#999;font-size:12px">↩️ 已撤銷退回</span>'
                : (needsRepair
                  ? `<button class="btn-prepare" style="padding:4px 8px" onclick="openRepairStockoutReturnModal(${o.id})">🛠️ 修復退回資料</button>`
                  : `<button class="btn-prepare" style="padding:4px 8px" onclick="openEditStockoutReturnModal(${o.id})">✏️ 編輯</button>
                     <button class="btn-del" style="padding:4px 8px" onclick="revokeStockoutReturn(${o.id})">撤銷退回</button>`))
              : (reverted
                ? `<button class="btn-del" style="padding:4px 8px" onclick="deleteStockoutRecord(${o.id})">刪除</button>`
                : `<button class="btn-prepare" style="padding:4px 8px" onclick="openEditStockoutModal(${o.id})">✏️ 編輯</button>
                   <button class="btn-out" style="padding:4px 8px" onclick="returnStockout(${o.id})">↩️ 退回</button>
                   <button class="btn-del" style="padding:4px 8px" onclick="deleteStockoutRecord(${o.id})">刪除</button>`))}
          </td>
        </tr>`;
      });
      html += '</tbody></table>';
    });
    }
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





// ========== 手機版 ⋯ 動作選單（已領出卡） ==========

function openStockoutSheet(movementId) {

  const rec = (typeof stockoutRecords !== 'undefined' ? stockoutRecords : []).find(r => r.id === movementId);

  if (!rec) return;

  const isViewer = !hasPerm('stockout');

  const reverted = !!rec.reverted_at;
  const isReturn = rec.reason === '退回已領出';
  const needsRepair = isReturn && (!rec.source_movement_id || !rec.return_stock_id);

  const actions = [];

  if (!isViewer) {

    if (isReturn) {
      if (reverted) {
        actions.push({ icon: '↩️', label: '已撤銷退回', cls: 'disabled', fn: () => {} });
      } else if (needsRepair) {
        actions.push({ icon: '🛠️', label: '修復退回資料', cls: 'out', fn: () => openRepairStockoutReturnModal(movementId) });
      } else {
        actions.push({ icon: '✏️', label: '編輯', cls: 'out', fn: () => openEditStockoutReturnModal(movementId) });
        actions.push({ icon: '↩️', label: '撤銷退回', cls: 'del', fn: () => revokeStockoutReturn(movementId) });
      }
    } else if (!isReturn && !reverted) {
      actions.push({ icon: '✏️', label: '編輯', cls: 'out', fn: () => openEditStockoutModal(movementId) });
      actions.push({ icon: '↩️', label: '退回', cls: 'back', fn: () => returnStockout(movementId) });
    }

    if (!isReturn) {
      actions.push({ icon: '🗑', label: '刪除', cls: 'del', fn: () => deleteStockoutRecord(movementId) });
    }

  }

  openSheet(`${rec.brand} ${rec.item_name}`, actions);

}

