// ========== 手機卡片共用元件（2026-08-11 A+B 重構） ==========
// 庫存/待領出/已領出 三頁手機卡共用外框與小工具。
// 改手機卡片長相：改本檔即可，三頁自動同步（不再各寫一份模板）。
// 整組(kits)卡片結構特殊（kit-head/kit-comps，無照片/數量列），不套本外框。

// 圖片 URL：列表優先 thumbnail，lightbox 優先 preview；舊資料 fallback 到 legacy URL。
function photoSrc(id, variant) {
  const items = typeof ALL_ITEMS !== 'undefined' ? ALL_ITEMS : [];
  const item = items.find(i => i.id === id);
  if (item) {
    if (variant === 'thumbnail' && item.thumbnail_url) return item.thumbnail_url;
    if (variant === 'preview' && item.preview_url) return item.preview_url;
  }
  return `/uploads/${id}.jpg`;
}

// 縮圖：有照片 → thumbnail；載入失敗 → 同一個 neutral placeholder
function buildThumb(id, hasPhoto, name, placeholder, thumbnailUrl) {
  const fallback = '<span class="product-thumbnail-placeholder' + (hasPhoto ? ' hidden' : '') + '">' + esc(placeholder || '📦') + '</span>';
  if (!hasPhoto) return fallback;
  const src = thumbnailUrl || photoSrc(id, 'thumbnail');
  return '<span class="product-thumbnail-wrap"><img src="' + esc(src) + '" alt="' + esc(name || '') + '" loading="lazy" decoding="async" width="52" height="52" onclick="openPhotoLightbox(' + id + ')" title="點擊看大圖" onload="this.nextElementSibling.hidden=true" onerror="this.hidden=true;this.nextElementSibling.hidden=false">' + fallback + '</span>';
}

// 位置與註解分層 HTML：主資訊保留位置，長註解由卡片獨立區塊承載。
function buildLocHTML(locs) {
  const list = (locs && locs.length) ? locs : [{location: '', note: ''}];
  return list.map(s => {
    const loc = s.location || '未標示';
    const pipeIdx = loc.indexOf(' | ');
    let display;
    if (pipeIdx >= 0) {
      const cab = loc.substring(0, pipeIdx);
      const sub = loc.substring(pipeIdx + 3);
      display = `<b>${esc(cab)}</b>｜${esc(sub)}`;
    } else {
      display = esc(loc);
    }
    return `<div class="item-loc"><span class="item-loc-label">位置：</span>${display}</div>`;
  }).join('');
}

function buildNoteHTML(locs) {
  const notes = (locs || []).filter(s => s && s.note);
  return notes.map(s => `<div class="item-note"><span class="item-note-label">📝 註解</span><span class="item-note-text">${esc(s.note)}</span></div>`).join('');
}

// 數量控制（庫存卡）：viewer 唯讀數字 / 一般 −[數量]＋（對齊電腦版）
function buildQtyControl(opts) {
  const {id, display, unit, isZero, delta, viewer} = opts;
  if (viewer) {
    return `<div class="qty-num">${display}</div><div class="qty-unit">${esc(unit)}</div>`;
  }
  return `<div class="qty-control">
    <button class="qty-btn qty-minus" onclick="changeQty(${id}, -1)" ${isZero && delta <= 0 ? 'disabled' : ''}>−</button>
    <div class="qty-value" onclick="quickSet(${id})" title="點數字可輸入">${display}<span class="unit"> ${esc(unit)}</span></div>
    <button class="qty-btn qty-plus" onclick="changeQty(${id}, 1)">+</button>
  </div>`;
}

// 純數量顯示（待領出 qty-violet / 已領出 qty-neg）
// 2026-09-12：有 Qty 時依單位類型顯示（分數單位 3/4 而非 0.75）
function buildQtyNum(display, unit, cls) {
  const d = (typeof Qty !== 'undefined' && typeof unitKnownQty !== 'undefined' && unit)
    ? Qty.signed(display, unit) : display;
  return `<div class="qty-num${cls ? ' ' + cls : ''}">${d}</div><div class="qty-unit">${esc(unit)}</div>`;
}

// 手機卡片外框：共用 thumb/info/qty-col 結構（各頁填內容）
// p: { reverted, moreBtnHTML, thumb, nameHTML, subHTML, extraHTML, noteHTML, qtyHTML, actionsHTML, checkboxHTML }
function mobileCardShell(p) {
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
    </div>
    ${p.noteHTML || ''}
    ${p.actionsHTML || ''}
  </div>`;
}
