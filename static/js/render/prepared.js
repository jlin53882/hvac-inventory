// 庫存管理系統 - 待領出頁渲染（v8 拆分）

// ========== 待領出頁籤 ==========

async function renderPrepared() {

  const content = document.getElementById('content');

  content.innerHTML = '<div class="loading"><div class="spin"></div><div>載入待領出清單…</div></div>';

  const isViewer = !hasPerm('stockout');



  try {

    const res = await fetch(`/api/prepared?site=${currentSite}`);

    let items = await res.json();
    preparedItems = items;  // 含非庫存品項（openPreparedSheet 資料源，2026-08-16 家豪）


    // 搜尋過濾

    items = filterBySearch(items, function(i) {

      return [i.name, i.code, i.brand, i.note, i.destination].join(' ');

    });

    if (!items.length) {

      content.innerHTML = '<div class="empty">📤 目前沒有待領出的品項<br><small>在庫存頁點「待領出」把要帶的材料先準備好</small>' +

        (isViewer ? '' : '<br><br><button class="btn-add-inv" onclick="openNonStockPrepareModal()">＋ 新增待領出</button>') + '</div>';

      updatePreparedBadge(0);

      return;

    }



    const totalPrepared = items.reduce((s, i) => s + i.prepared_qty, 0);

    let html = '';

    // 2026-08-13 家豪：待領出頁也可直接新增「不在庫存」的品項（比照已領出）

    const preparedBar = `<div class="loc-export-bar"><span>共 ${items.length} 筆</span>${isViewer ? '' : '<button class="btn-add-inv" onclick="openNonStockPrepareModal()">＋ 新增待領出</button>'}</div>`;

    html += preparedBar;

    const isM = (typeof isMobileView === 'function') && isMobileView();

    if (isM) {

      // ===== 手機版：卡片式（⋯ 動作選單） =====

      html += `<div class="section-title"><span class="loc">📤 待領出（已拿出未出去）</span><span>${items.length} 項 · ${totalPrepared} 件</span></div>`;

      items.forEach(i => {

        html += mobileCardShell({

          reverted: false,

          moreBtnHTML: isViewer ? '' : `<button class="more-btn" onclick="openPreparedSheet(${i.id})">⋯</button>`,

          thumb: buildThumb(i.id, i.has_photo, i.name, '📷'),

          nameHTML: `${esc(i.brand)} ${esc(i.name)}${i.is_deleted ? '<span class="tag-nonstock">非庫存</span>' : ''}`,  // V1b 2026-08-16：chip 移出品名行（防長名截出誤導 ⋯）
          subHTML: `${i.code ? '<small style="color:#1890FF;font-weight:600">型號 ' + esc(i.code) + '</small><br>' : ''}<small style="color:#999">${esc(i.location || '未標示')}</small>`,
          extraHTML: `<div style="margin-top:3px"><span class="chip green">待領出</span><span class="loc-tag">庫存 ${i.qty} ${esc(i.unit)}</span></div>`,
          qtyHTML: buildQtyNum(i.prepared_qty, i.unit, 'qty-violet'),

          actionsHTML: ''

        });

      });

    } else {

      // ===== 桌面版：原表格 =====

    html = preparedBar + `

      <div class="section-title"><span class="loc">📤 待領出（已拿出未出去）</span><span>${items.length} 項 · ${totalPrepared} 件</span></div>

      <div style="background:#f5f3ff;border-radius:10px;padding:10px 14px;margin-bottom:12px;font-size:12.5px;color:#6d28d9">

        💡 待領出 <b>不會扣庫存</b>。真正出去時按「已領出」才會扣，也可以「退回」。

      </div>`;



    html += `<table class="data-table"><thead><tr>

      <th>照片</th><th>品項</th><th>待領出</th><th>庫存</th>${isViewer ? '' : '<th>操作</th>'}

    </tr></thead><tbody>`;



    items.forEach(i => {

      const pPhoto = i.has_photo

        ? `<img class="so-photo" src="/uploads/${i.id}.jpg" alt="" loading="lazy" onclick="openPhotoLightbox(${i.id})" title="點擊看大圖">`

        : `<div class="so-photo so-photo-empty">📷</div>`;

      html += `<tr>

        <td class="photo-cell">${pPhoto}</td>

        <td>${esc(i.brand)} ${esc(i.name)}${i.is_deleted ? '<span class="tag-nonstock">非庫存</span>' : ''}${i.code ? '<br><small style="color:#1890FF;font-weight:600">型號 ' + esc(i.code) + '</small>' : ''}<br><small style="color:#999">${esc(i.location || '未標示')}</small></td>

        <td style="text-align:center"><b style="color:#6d28d9">${i.prepared_qty}</b> ${esc(i.unit)}</td>

        <td style="text-align:center">${i.qty} ${esc(i.unit)}</td>

        ${isViewer ? '' : `<td style="white-space:nowrap">

          <button class="btn-out" style="padding:4px 8px" onclick="openPreparedOutModal(${i.id})">🚚 已領出</button>

          ${i.is_deleted ? '' : `<button class="btn-prepare" style="padding:4px 8px;margin-top:0" onclick="returnPrepared(${i.id})">↩️ 退回</button>`}

          <button class="btn-del" style="padding:4px 8px;margin-top:0" onclick="clearPrepared(${i.id}, ${i.prepared_qty})">刪除</button>

        </td>`}

      </tr>`;

    });



    html += '</tbody></table>';

    }

    content.innerHTML = html;

    updatePreparedBadge(items.length);

  } catch (e) {

    content.innerHTML = `<div class="empty">⚠️ 載入失敗<br><small>${e.message}</small></div>`;

  }

}



// 更新底部「待領出」小標：有數量時顯示數字，沒有則隱藏

function updatePreparedBadge(n) {
  var badge = document.getElementById('prepared-badge');
  var sbBadge = document.getElementById('sb-prepared-badge');
  if (n > 0) {
    if (badge) { badge.style.display = 'inline-block'; badge.textContent = n; }
    if (sbBadge) { sbBadge.style.display = ''; sbBadge.textContent = n; }
  } else {
    if (badge) badge.style.display = 'none';
    if (sbBadge) sbBadge.style.display = 'none';
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





// ========== 手機版 ⋯ 動作選單（待領出卡） ==========

function openPreparedSheet(itemId) {

  const item = preparedItems.find(i => i.id === itemId) || ALL_ITEMS.find(i => i.id === itemId);  // 非庫存品項不在 ALL_ITEMS（2026-08-16 家豪：點 ⋯ 無效 bug）

  if (!item) return;

  const isViewer = !hasPerm('stockout');

  const actions = [];

  if (!isViewer) {

    actions.push({ icon: '🚚', label: '已領出', cls: 'out', fn: () => openPreparedOutModal(itemId) });

    if (!item.is_deleted) actions.push({ icon: '↩️', label: '退回', cls: 'back', fn: () => returnPrepared(itemId) });  // 非庫存無退回（家豪 2026-08-16）

    actions.push({ icon: '🗑', label: '刪除', cls: 'del', fn: () => clearPrepared(itemId, item.prepared_qty) });

  }

  openSheet(`${item.brand} ${item.name}`, actions);

}

