// ========== 手機卡片共用元件（2026-08-11 A+B 重構） ==========
// 庫存/待領出/已領出 三頁手機卡共用外框與小工具。
// 改手機卡片長相：改本檔即可，三頁自動同步（不再各寫一份模板）。
// 整組(kits)卡片結構特殊（kit-head/kit-comps，無照片/數量列），不套本外框。

// 縮圖：有照片 → img（點擊放大）；無 → placeholder emoji
function buildThumb(id, hasPhoto, name, placeholder) {
  return hasPhoto
    ? `<img src="/uploads/${id}.jpg" alt="${esc(name || '')}" onclick="openPhotoLightbox(${id})" title="點擊看大圖">`
    : (placeholder || '📦');
}

// 位置逐行 HTML（解析「櫃子 | 位置」格式，分開顯示）
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
    return `<div class="item-loc">位置：${display}${s.note ? `｜${esc(s.note)}` : ''}</div>`;
  }).join('');
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
function buildQtyNum(display, unit, cls) {
  return `<div class="qty-num${cls ? ' ' + cls : ''}">${display}</div><div class="qty-unit">${esc(unit)}</div>`;
}

// 手機卡片外框：共用 thumb/info/qty-col 結構（各頁填內容）
// p: { reverted, moreBtnHTML, thumb, nameHTML, subHTML, extraHTML, qtyHTML, actionsHTML, checkboxHTML }
function mobileCardShell(p) {
  return `<div class="m-card${p.reverted ? ' reverted' : ''}">
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
    ${p.actionsHTML || ''}
  </div>`;
}
