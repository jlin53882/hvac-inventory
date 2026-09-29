// 庫存管理系統 - 待領出頁渲染（v8 拆分）

import { buildThumb, mobileCardShell, photoSrc } from '../../components/card.js';
import { apiFetch } from '../../core/api-client.js';
import { isMobileView, openSheet } from '../../core/bottomsheet.js';
import { loadData } from '../shell/data-refresh.js';
import { Qty } from '../../core/qty.js';
import { filterBySearch } from '../../core/search.js';
import { appState } from '../../core/state.js';
import { absNum, esc, hasPerm, toast } from '../../core/utils.js';
import { openPreparedEditModal, openPreparedOutModal, returnPrepared } from '../stockout/modals.js';

// ========== 待領出頁籤 ==========

function renderPreparedPageHeader(itemCount, totalPrepared, isViewer) {
  const addButton = isViewer ? '' : '<button class="btn btn--primary btn--md btn-add-inv" onclick="Stockout.openNonStockPrepareModal()">＋ 新增待領出</button>';
  return `<section class="prepared-page-header">
    <div class="prepared-heading-copy">
      <div class="prepared-heading-icon" aria-hidden="true">📤</div>
      <div><h1>待領出 <span>（已拿出未出去）</span></h1><p>管理已拿出的品項，真正出去時按「已領出」才會扣庫存，也可以退回。</p></div>
    </div>
    <div class="prepared-header-actions">
      <div class="prepared-summary-card ui-kpi-card ui-kpi-card--inline ui-kpi-card--purple prepared-summary-purple"><span class="ui-kpi-icon" aria-hidden="true">📤</span><div class="ui-kpi-body"><span class="ui-kpi-label">待領出品項</span><strong class="ui-kpi-value">${esc(String(itemCount))}</strong><span class="ui-kpi-meta">目前篩選結果</span></div></div>
      <div class="prepared-summary-card ui-kpi-card ui-kpi-card--inline ui-kpi-card--blue prepared-summary-blue"><span class="ui-kpi-icon" aria-hidden="true">📦</span><div class="ui-kpi-body"><span class="ui-kpi-label">待領出總件數</span><strong class="ui-kpi-value">${esc(String(absNum(totalPrepared)))}</strong><span class="ui-kpi-meta">目前待領出合計</span></div></div>
      ${addButton}
    </div>
  </section>
  <div class="prepared-alert" role="note">💡 <b>待領出不會扣庫存</b>，請確認真正出去時再按「已領出」。</div>`;
}


// ========== 整組子品項展開 ==========
function renderKitSubItems(item) {
  if (!item.is_kit || !item.components || !item.components.length) return '';
  let html = '<tr class="kit-subitems-row"><td colspan="6"><div class="kit-subitems-toggle" onclick="Prepared.toggleKitSubItems(this)">';
  html += '<span class="kit-subitems-arrow" data-role="kit-subitems-arrow">▶</span> 整組包含 ' + item.components.length + ' 個品項';
  html += '</div><div class="kit-subitems-list" style="display:none">';
  item.components.forEach(c => {
    const photo = c.has_photo
      ? '<img src="' + photoSrc(c.item_id, 'thumbnail') + '" class="prepared-kit-thumb" loading="lazy" onclick="Inventory.openPhotoLightbox(' + c.item_id + ')">'
      : '<div class="prepared-kit-thumb prepared-kit-thumb--empty">📷</div>';
    html += '<div class="kit-subitem">';
    html += photo;
    html += '<span class="kit-subitem-name">' + esc(c.brand || '') + ' ' + esc(c.name) + '</span>';
    html += '<span class="kit-subitem-code">' + (c.code ? esc(c.code) : '') + '</span>';
    html += '<span class="kit-subitem-qty">×' + c.need_qty + ' ' + esc(c.unit || '個') + '</span>';
    html += '</div>';
  });
  html += '</div></td></tr>';
  return html;
}

// 手機版整組子品項展開（card 格式）
export function renderKitSubItemsMobile(item) {
  if (!item.is_kit || !item.components || !item.components.length) return '';
  let html = '<div class="kit-subitems-mobile-wrap">';
  html += '<div class="kit-subitems-toggle" onclick="Prepared.toggleKitSubItems(this)">';
  html += '<span class="kit-subitems-arrow" data-role="kit-subitems-arrow">▶</span> 整組包含 ' + item.components.length + ' 個品項';
  html += '</div><div class="kit-subitems-list" style="display:none">';
  item.components.forEach(c => {
    const photo = c.has_photo
      ? '<img src="' + photoSrc(c.item_id, 'thumbnail') + '" class="prepared-kit-thumb" loading="lazy" onclick="Inventory.openPhotoLightbox(' + c.item_id + ')">'
      : '<div class="prepared-kit-thumb prepared-kit-thumb--empty">📷</div>';
    html += '<div class="kit-subitem">';
    html += photo;
    html += '<span class="kit-subitem-name">' + esc(c.brand || '') + ' ' + esc(c.name) + '</span>';
    html += '<span class="kit-subitem-code">' + (c.code ? esc(c.code) : '') + '</span>';
    html += '<span class="kit-subitem-qty">×' + c.need_qty + ' ' + esc(c.unit || '個') + '</span>';
    html += '</div>';
  });
  html += '</div></div>';
  return html;
}

export function toggleKitSubItems(el) {
  const list = el.nextElementSibling;
  const arrow = el.querySelector('[data-role="kit-subitems-arrow"]');
  if (list.style.display === 'none') {
    list.style.display = 'block';
    arrow.textContent = '▼';
  } else {
    list.style.display = 'none';
    arrow.textContent = '▶';
  }
}

// 整組品項型號/標籤顯示（桌面+手機共用）
function kitModelHTML(item) {
  if (item.is_kit && item.components && item.components.length) {
    if (item.code) return '型號： ' + esc(item.code) + ' · 整組 ' + item.components.length + ' 項';
    return '整組 · ' + item.components.length + ' 個品項';
  }
  return item.code ? '型號： ' + esc(item.code) : '';
}

function renderPreparedDesktopRow(item, isViewer) {
  const photo = item.has_photo
    ? `<img class="prepared-photo" src="${photoSrc(item.id, 'thumbnail')}" alt="" loading="lazy" onclick="Inventory.openPhotoLightbox(${item.id})" title="點擊看大圖">`
    : '<div class="prepared-photo prepared-photo-empty" aria-hidden="true">📷</div>';
  const nonStock = item.is_deleted ? '<span class="tag-nonstock">非庫存</span>' : '';
  const location = item.location || '未標示';
  const actions = isViewer ? '' : `<td class="prepared-actions-cell"><div class="prepared-row-actions">
    <button class="btn btn--secondary btn--sm btn-prepare" onclick="Stockout.openPreparedEditModal(${item.id})">✏️ 編輯</button>
    <button class="btn btn--out btn--sm btn-out" onclick="Stockout.openPreparedOutModal(${item.id})">🚚 已領出</button>
    ${item.is_deleted ? '' : `<button class="btn btn--secondary btn--sm btn-prepare" onclick="Stockout.returnPrepared(${item.id})">↩ 退回</button>`}
    <button class="btn btn--danger btn--sm btn-del" onclick="Prepared.clearPrepared(${item.id}, ${item.prepared_qty})">🗑 刪除</button>
  </div></td>`;
  return `<tr class="prepared-row">
    <td class="prepared-photo-cell">${photo}</td>
    <td class="prepared-item-cell"><div class="prepared-item-name">${esc(item.brand || '無廠牌')} ${esc(item.name || '未命名')} ${nonStock}</div>
      <div class="prepared-item-model">${kitModelHTML(item)}</div>
      <div class="prepared-item-location">📍 ${esc(location)}</div>
      ${item.destination ? '<div class="prepared-item-dest">📋 ' + esc(item.destination) + '</div>' : ''}</td>
    <td class="prepared-quantity-cell"><span class="prepared-qty-badge">📦 ${Qty.disp(item.prepared_qty, item.unit)} <small>${esc(item.unit)}</small></span></td>
    <td class="prepared-stock-cell"><span class="prepared-stock-badge">目前庫存 ${Qty.disp(item.qty, item.unit)} <small>${esc(item.unit)}</small></span></td>
    ${actions}
  </tr>${renderKitSubItems(item)}`;
}

// ========== 待領出頁籤 ==========
var preparedRenderRequestSeq = 0;

export async function renderPrepared() {
  const renderRequestId = ++preparedRenderRequestSeq;
  const siteAtRequest = appState.currentSite;
  const content = document.getElementById('content');
  const isViewer = !hasPerm('stockout');
  content.innerHTML = '<div class="loading"><div class="spin"></div><div>載入待領出清單…</div></div>';

  try {
    let items = await apiFetch(`/api/prepared?site=${siteAtRequest}`);
    if (renderRequestId !== preparedRenderRequestSeq || appState.currentTab !== 'prepared' || siteAtRequest !== appState.currentSite) return;
    appState.preparedItems = items;  // 含非庫存品項（openPreparedSheet 資料源，2026-08-16 家豪）

    items = filterBySearch(items, function(i) {
      return [i.name, i.code, i.brand, i.note, i.destination].join(' ');
    });

    const totalPrepared = items.reduce((s, i) => s + (Number(i.prepared_qty) || 0), 0);
    let html = renderPreparedPageHeader(items.length, totalPrepared, isViewer);

    if (!items.length) {
      html += `<section class="prepared-panel"><div class="prepared-empty-state">
        <div class="prepared-empty-icon" aria-hidden="true">📦</div>
        <h2>目前沒有待領出的品項</h2>
        <p>拿出商品後，可以在這裡管理尚未正式出庫的項目。</p>
        ${isViewer ? '' : '<button class="btn btn--primary btn--md btn-add-inv" onclick="Stockout.openNonStockPrepareModal()">＋ 新增待領出</button>'}
      </div></section>`;
      content.innerHTML = html;
      updatePreparedBadge(0);
      return;
    }

    const isM = isMobileView();
    html += `<section class="prepared-panel">
      <div class="prepared-toolbar"><div><strong>待領出清單</strong><span>共 ${items.length} 筆</span></div></div>`;

    if (isM) {
      html += '<div class="prepared-mobile-list">';
      items.forEach(function(item) {
        const qtyText = String(Qty.disp(item.prepared_qty, item.unit));
        const stockText = String(Qty.disp(item.qty, item.unit));
        html += mobileCardShell({
          reverted: false,
          cardClass: 'prepared-mobile-card',
          moreBtnHTML: '',
          thumb: buildThumb(item.id, item.has_photo, item.name, '📷'),
          nameHTML: `<span class="prepared-mobile-name">${esc(item.brand || '無廠牌')} ${esc(item.name || '未命名')}</span>${item.is_deleted ? '<span class="tag-nonstock">非庫存</span>' : ''}`,
          subHTML: `<span class="prepared-mobile-model">${kitModelHTML(item)}</span>`,
          extraHTML: `<div class="prepared-mobile-location">📍 ${esc(item.location || '未標示')}</div>${item.destination ? '<div class="prepared-card-dest">📋 ' + esc(item.destination) + '</div>' : ''}`,
          qtyHTML: `<div class="prepared-mobile-qty"><b>${esc(qtyText)}</b><small>待領出 ${esc(item.unit)}</small></div>`,
          actionsHTML: renderKitSubItemsMobile(item) + `<div class="prepared-mobile-meta"><span class="prepared-mobile-stock">庫存 ${esc(stockText)} ${esc(item.unit)}</span>${isViewer ? '' : `<button class="btn btn--out btn--sm" onclick="Stockout.openPreparedOutModal(${item.id})">🚚 已領出</button><button class="btn btn--secondary btn--sm" onclick="Prepared.openPreparedSheet(${item.id})" aria-label="更多操作">⋯</button>`}</div>`
        });
      });
      html += '</div>';
    } else {
      html += `<div class="prepared-table-wrap"><table class="prepared-table"><thead><tr>
        <th class="prepared-col-photo">照片</th><th>品項資訊</th><th class="prepared-col-qty">待領出</th><th class="prepared-col-stock">庫存</th>${isViewer ? '' : '<th class="prepared-col-actions">操作</th>'}
      </tr></thead><tbody>`;
      items.forEach(function(item) { html += renderPreparedDesktopRow(item, isViewer); });
      html += '</tbody></table></div>';
    }
    html += '</section>';
    content.innerHTML = html;
    updatePreparedBadge(items.length);
  } catch (e) {
    if (renderRequestId !== preparedRenderRequestSeq || appState.currentTab !== 'prepared' || siteAtRequest !== appState.currentSite) return;
    content.innerHTML = `<div class="prepared-error-state"><div class="prepared-error-icon">⚠️</div><h2>載入待領出資料失敗</h2><p>${esc(e.message || '請稍後再試')}</p><button class="btn btn--secondary btn--md btn-cancel" onclick="Prepared.renderPrepared()">重新載入</button></div>`;
  }
}


// 更新底部「待領出」小標：有數量時顯示數字，沒有則隱藏

export function updatePreparedBadge(n) {
  var sbBadge = document.getElementById('sb-prepared-badge');
  if (n > 0) {
    if (sbBadge) { sbBadge.style.display = ''; sbBadge.textContent = n; }
  } else {
    if (sbBadge) sbBadge.style.display = 'none';
  }
}


// 刪除待領出：把該品項的待領出數量全部清掉（不影響庫存；2026-08-11 Sarah 需求）

export async function clearPrepared(itemId, qty) {
  if (!confirm('確定刪除這筆待領出（' + qty + ' 件）？不會影響庫存。')) return;
  try {
    await apiFetch(`/api/items/${itemId}/prepared-return`, { method: 'POST', json: { qty: qty, location: '' }, fallback: '刪除失敗' });
    toast('✅ 已刪除待領出', 'success');
    await loadData();
  } catch (e) {
    toast('⚠️ ' + e.message, 'error');
  }
}





// ========== 手機版 ⋯ 動作選單（待領出卡） ==========

export function openPreparedSheet(itemId) {

  const item = appState.preparedItems.find(i => i.id === itemId) || appState.ALL_ITEMS.find(i => i.id === itemId);  // 非庫存品項不在 ALL_ITEMS（2026-08-16 家豪：點 ⋯ 無效 bug）

  if (!item) return;

  const isViewer = !hasPerm('stockout');

  const actions = [];

  if (!isViewer) {

    actions.push({ icon: '✏️', label: '編輯', cls: 'back', fn: () => openPreparedEditModal(itemId) });
    actions.push({ icon: '🚚', label: '已領出', cls: 'out', fn: () => openPreparedOutModal(itemId) });

    if (!item.is_deleted) actions.push({ icon: '↩️', label: '退回', cls: 'back', fn: () => returnPrepared(itemId) });  // 非庫存無退回（家豪 2026-08-16）

    actions.push({ icon: '🗑', label: '刪除', cls: 'del', fn: () => clearPrepared(itemId, item.prepared_qty) });

  }

  openSheet(`${item.brand} ${item.name}`, actions);

}
