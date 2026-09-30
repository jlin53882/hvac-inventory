// ========== 手機卡片共用元件（2026-08-11 A+B 重構） ==========
// 庫存/待領出/已領出 三頁手機卡共用外框與小工具。
// 改手機卡片長相：改本檔即可，三頁自動同步（不再各寫一份模板）。
// 整組(kits)卡片結構特殊（kit-head/kit-comps，無照片/數量列），不套本外框。

import { Qty } from '../core/qty.js';
import { getAllItems } from '../core/inventory-read-model.js';
import { esc } from '../core/utils.js';

// 圖片 URL：列表優先 thumbnail，lightbox 優先 preview；舊資料 fallback 到 legacy URL。
export function photoSrc(id, variant) {
  const items = getAllItems();
  const item = items.find(i => i.id === id);
  if (item) {
    if (variant === 'thumbnail' && item.thumbnail_url) return item.thumbnail_url;
    if (variant === 'preview' && item.preview_url) return item.preview_url;
  }
  return `/uploads/${id}.jpg`;
}

// 縮圖：有照片 → thumbnail；載入失敗 → 同一個 neutral placeholder
export function buildThumb(id, hasPhoto, name, placeholder, thumbnailUrl) {
  const fallback = '<span class="product-thumbnail-placeholder' + (hasPhoto ? ' hidden' : '') + '">' + esc(placeholder || '📦') + '</span>';
  if (!hasPhoto) return fallback;
  const src = thumbnailUrl || photoSrc(id, 'thumbnail');
  return '<span class="product-thumbnail-wrap"><img src="' + esc(src) + '" alt="' + esc(name || '') + '" loading="lazy" decoding="async" width="52" height="52" data-action="photo-lightbox" data-id="' + id + '" title="點擊看大圖" onload="this.nextElementSibling.hidden=true" onerror="this.hidden=true;this.nextElementSibling.hidden=false">' + fallback + '</span>';
}

// Contract: return an escaped display string; callers must not escape it again.
function formatLocationDisplay(location) {
  const raw = String(location ?? '').trim();
  if (!raw) return '未標示';
  const parts = raw.split('|').map(x => x.trim()).filter(Boolean);
  return parts.length ? parts.map(part => esc(part)).join(' / ') : '未標示';
}

export function buildLocHTML(locs) {
  const list = (locs && locs.length) ? locs : [{location: '', note: ''}];
  return list.map(s => `
    <div class="item-loc"><span class="item-loc-label">位置：</span>${formatLocationDisplay(s.location)}</div>
  `).join('');
}

function buildStockNoteLabelHTML(stock, showLocationContext) {
  if (!showLocationContext) return '📝 註解';
  return `📝 註解 · ${formatLocationDisplay(stock.location)}`;
}

export function buildNoteHTML(locs) {
  const list = locs || [];
  const notes = list.filter(s => s && s.note);
  const showLocationContext = list.length > 1;
  return notes.map(s => `<div class="item-note"><span class="item-note-label">${buildStockNoteLabelHTML(s, showLocationContext)}: </span><span class="item-note-text">${esc(s.note)}</span></div>`).join('');
}

// 數量控制（庫存卡）：viewer 唯讀數字 / 一般 −[數量]＋（對齊電腦版）
export function buildQtyControl(opts) {
  const {id, display, unit, isZero, delta, viewer} = opts;
  if (viewer) {
    return `<div class="qty-num">${display}</div><div class="qty-unit">${esc(unit)}</div>`;
  }
  return `<div class="qty-control">
    <button class="qty-btn qty-minus" data-action="inventory-qty-change" data-id="${id}" data-delta="-1" ${isZero && delta <= 0 ? 'disabled' : ''}>−</button>
    <div class="qty-value" data-action="inventory-qty-quickset" data-id="${id}" title="點數字可輸入">${display}<span class="unit"> ${esc(unit)}</span></div>
    <button class="qty-btn qty-plus" data-action="inventory-qty-change" data-id="${id}" data-delta="1">+</button>
  </div>`;
}

// 純數量顯示（待領出 qty-violet / 已領出 qty-neg）
// 2026-09-12：依單位類型顯示（分數單位 3/4 而非 0.75）
export function buildQtyNum(display, unit, cls) {
  const d = (unit)
    ? Qty.signed(display, unit) : display;
  return `<div class="qty-num${cls ? ' ' + cls : ''}">${d}</div><div class="qty-unit">${esc(unit)}</div>`;
}

// 手機卡片外框：共用 thumb/info/qty-col 結構（各頁填內容）
// p: { reverted, moreBtnHTML, thumb, nameHTML, subHTML, extraHTML, noteHTML, qtyHTML, actionsHTML, checkboxHTML }
export function mobileCardShell(p) {
  return `<div class="m-card${p.reverted ? ' reverted' : ''}${p.cardClass ? ' ' + p.cardClass : ''}">
    ${p.moreBtnHTML || ''}
    <div class="card-main">
      ${p.checkboxHTML || ''}
      <div class="thumb">${p.thumb}</div>
      <div class="info">
        <div class="nm">${p.nameHTML}</div>
        ${p.subHTML ? `<div class="sub">${p.subHTML}</div>` : ''}
        ${p.extraHTML || ''}
      </div>
      <div class="qty-col">${p.qtyHTML}</div>
      <div class="note-slot">${p.noteHTML || ''}</div>
    </div>
    ${p.actionsHTML || ''}
  </div>`;
}
