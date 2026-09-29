// 按鈕 / chip 外觀契約探針（CSS 架構重構 P7.5）。
// 回傳目前畫面上每個可見 .btn / .chip 的 computed style 與規格不符之處，以及沒有套標準 class 的可見 <button>。
(() => {
  const rgb = (h) => { const n = parseInt(h.slice(1), 16); return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`; };
  const WHITE = 'rgb(255, 255, 255)';
  const VARIANTS = {
    primary: { bg: rgb('#2d5a8e'), fg: WHITE, bd: rgb('#2d5a8e') },
    secondary: { bg: WHITE, fg: rgb('#334155'), bd: rgb('#94a3b8') },
    ghost: { bg: rgb('#eef4fa'), fg: rgb('#2d5a8e') },
    export: { bg: rgb('#2563eb'), fg: WHITE, bd: rgb('#2563eb') },
    danger: { bg: WHITE, fg: rgb('#dc2626'), bd: rgb('#f87171') },
    prepare: { bg: WHITE, fg: rgb('#6d28d9'), bd: rgb('#a78bfa') },
    out: { bg: WHITE, fg: rgb('#b45309'), bd: rgb('#f59e0b') },
    'prepare-solid': { bg: rgb('#7c3aed'), fg: WHITE, bd: rgb('#7c3aed') },
    'out-solid': { bg: rgb('#f59e0b'), fg: WHITE, bd: rgb('#f59e0b') },
    'on-dark': { bg: 'rgba(255, 255, 255, 0.15)', fg: WHITE },
  };
  const mobile = window.innerWidth <= 767;
  const visible = (el) => {
    if (!el.getClientRects().length) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none';
  };
  const label = (el) => (el.className + ' «' + (el.textContent || '').trim().slice(0, 16) + '»');
  const problems = [];
  const px = (v) => Math.round(parseFloat(v));
  document.querySelectorAll('.btn').forEach((el) => {
    if (!visible(el)) return;
    const cs = getComputedStyle(el);
    const c = el.classList;
    const vname = ['primary', 'secondary', 'ghost', 'export', 'danger', 'prepare', 'out', 'on-dark'].find((v) => c.contains('btn--' + v));
    if (!vname) { problems.push(label(el) + ': 沒有變體 class'); return; }
    if (c.contains('is-active')) return;  // 切換型按鈕按下狀態另有樣式
    const spec = VARIANTS[c.contains('btn--solid') ? vname + '-solid' : vname];
    const want = [];
    if (cs.backgroundColor !== spec.bg) want.push(`背景 ${cs.backgroundColor} ≠ ${spec.bg}`);
    if (cs.color !== spec.fg) want.push(`文字 ${cs.color} ≠ ${spec.fg}`);
    if (spec.bd && cs.borderTopColor !== spec.bd) want.push(`框線 ${cs.borderTopColor} ≠ ${spec.bd}`);
    if (cs.borderTopWidth !== '1px') want.push(`框線寬 ${cs.borderTopWidth}`);
    if (cs.borderTopLeftRadius !== '8px') want.push(`圓角 ${cs.borderTopLeftRadius}`);
    if (cs.fontWeight !== '700') want.push(`字重 ${cs.fontWeight}`);
    const sm = c.contains('btn--sm');
    const h = sm ? 32 : (mobile ? 44 : 38);
    if (px(cs.height) !== h) want.push(`高度 ${cs.height} ≠ ${h}px`);
    const fs = sm ? '12px' : '13px';
    if (cs.fontSize !== fs) want.push(`字級 ${cs.fontSize} ≠ ${fs}`);
    if (c.contains('btn--icon') && px(cs.width) !== h) want.push(`圖示鈕寬 ${cs.width} ≠ ${h}px`);
    if (want.length) problems.push(label(el) + ': ' + want.join('、'));
  });
  document.querySelectorAll('.chip').forEach((el) => {
    if (!visible(el)) return;
    const cs = getComputedStyle(el);
    const active = el.classList.contains('is-active');
    const semantic = el.classList.contains('chip--success') || el.classList.contains('chip--danger');
    const want = [];
    if (!(active && semantic)) {
      const bg = active ? rgb('#2d5a8e') : WHITE;
      const fg = active ? WHITE : rgb('#334155');
      if (cs.backgroundColor !== bg) want.push(`背景 ${cs.backgroundColor} ≠ ${bg}`);
      if (cs.color !== fg) want.push(`文字 ${cs.color} ≠ ${fg}`);
    }
    const r = el.classList.contains('chip--seg') ? '8px' : '999px';
    if (cs.borderTopLeftRadius !== r) want.push(`圓角 ${cs.borderTopLeftRadius} ≠ ${r}`);
    if (cs.fontSize !== '12px') want.push(`字級 ${cs.fontSize}`);
    if (want.length) problems.push(label(el) + ': ' + want.join('、'));
  });
  const unstyled = [];
  document.querySelectorAll('button').forEach((el) => {
    if (!visible(el) || el.classList.contains('btn') || el.classList.contains('chip')) return;
    unstyled.push(label(el));
  });
  return { problems, unstyled };
})
