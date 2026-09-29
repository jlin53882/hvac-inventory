// 庫存管理系統 - 手機版 ⋯ 動作選單（Bottom Sheet，2026-08-11 手機 UI v2）
// ============================================================
// 用法：openSheet(title, actions)
//   title   = 選單標題（通常是品項名）
//   actions = [{ icon, label, cls, fn }]
//     icon  = emoji 圖示（可省略）
//     label = 選項文字
//     cls   = 'out' | 'back' | 'del' | ''（決定顏色：藍/橘/紅/黑）
//     fn    = 點擊執行函式（執行後自動關閉選單）
// 點選單外或「取消」關閉。
// ============================================================

import { appState } from './state.js';
import { esc } from './utils.js';
import { switchTab } from '../features/shell/app.js';

let sheetEl = null;       // 目前開啟的選單 DOM（全域：render 切頁時可能殘留）
let sheetEscBound = false;

// 開啟動作選單
export function openSheet(title, actions) {
  closeSheet();  // 先清掉殘留

  const overlay = document.createElement('div');
  overlay.className = 'sheet-overlay';
  overlay.id = 'sheet-overlay';

  const items = (actions || []).map(a => {
    const cls = 's-item' + (a.cls ? ' ' + a.cls : '');
    const icon = a.icon ? `<span class="ic">${a.icon}</span>` : '';
    return `<div class="${cls}" data-role="sheet-item">${icon}${a.label}</div>`;
  }).join('');

  overlay.innerHTML = `
    <div class="sheet">
      <div class="sheet-title">${esc(title)}</div>
      ${items}
      <button class="s-cancel" data-role="sheet-cancel">取消</button>
    </div>`;

  // 綁定選項點擊
  overlay.querySelectorAll('[data-role="sheet-item"]').forEach((el, i) => {
    el.addEventListener('click', () => {
      const a = actions[i];
      closeSheet();
      if (a && a.fn) a.fn();
    });
  });

  // 點遮罩（非選單區）關閉
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeSheet();
  });
  overlay.querySelector('[data-role="sheet-cancel"]').addEventListener('click', closeSheet);

  document.body.appendChild(overlay);
  sheetEl = overlay;
  requestAnimationFrame(() => overlay.classList.add('is-open'));

  // ESC 關閉
  if (!sheetEscBound) {
    sheetEscBound = true;
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeSheet();
    });
  }
}

// 關閉動作選單
export function closeSheet() {
  if (sheetEl) {
    sheetEl.remove();
    sheetEl = null;
  }
}

// ========== 手機版判斷（<768px 視為手機，render 走卡片式模板） ==========
export function isMobileView() {
  return window.matchMedia('(max-width: 767px)').matches;
}

// 手機 viewport 變化時：切頁自動重繪（render 函式每次呼叫都會重新判斷）
// 桌面↔手機 resize 跨過 768px 斷點時，若停在庫存頁則重繪一次
let _lastMobileState = null;

// 模組載入時要執行的副作用：由頁面 entry 依原本的載入順序呼叫（issue #39）
export function initBottomsheet() {
  window.addEventListener('resize', () => {
    const now = isMobileView();
    if (_lastMobileState !== null && _lastMobileState !== now) {
      _lastMobileState = now;
      if (typeof appState.currentTab !== 'undefined') {
        switchTab(appState.currentTab);
      }
    } else {
      _lastMobileState = now;
    }
  });
}
