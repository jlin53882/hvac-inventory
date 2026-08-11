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

let sheetEl = null;       // 目前開啟的選單 DOM（全域：render 切頁時可能殘留）
let sheetEscBound = false;

// 開啟動作選單
function openSheet(title, actions) {
  closeSheet();  // 先清掉殘留

  const overlay = document.createElement('div');
  overlay.className = 'sheet-overlay';
  overlay.id = 'sheet-overlay';

  const items = (actions || []).map(a => {
    const cls = 's-item' + (a.cls ? ' ' + a.cls : '');
    const icon = a.icon ? `<span class="ic">${a.icon}</span>` : '';
    return `<div class="${cls}">${icon}${a.label}</div>`;
  }).join('');

  overlay.innerHTML = `
    <div class="sheet">
      <div class="sheet-title">${title}</div>
      ${items}
      <button class="s-cancel">取消</button>
    </div>`;

  // 綁定選項點擊
  overlay.querySelectorAll('.s-item').forEach((el, i) => {
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
  overlay.querySelector('.s-cancel').addEventListener('click', closeSheet);

  document.body.appendChild(overlay);
  sheetEl = overlay;
  requestAnimationFrame(() => overlay.classList.add('show'));

  // ESC 關閉
  if (!sheetEscBound) {
    sheetEscBound = true;
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeSheet();
    });
  }
}

// 關閉動作選單
function closeSheet() {
  if (sheetEl) {
    sheetEl.remove();
    sheetEl = null;
  }
}

// ========== 手機版 ☰ 功能選單（topbar 漢堡） ==========
function openTopMenu() {
  const u = (typeof currentUser !== 'undefined') ? currentUser : null;
  const actions = [];
  if (typeof exportExcel === 'function') {
    actions.push({ icon: '⬇️', label: '匯出報表', fn: () => exportExcel() });
  }
  if (u && u.role !== 'viewer' && typeof openChangePwModal === 'function') {
    actions.push({ icon: '🔑', label: '改密碼', fn: () => openChangePwModal() });
  }
  if (u && u.role === 'admin' && typeof openUsersModal === 'function') {
    actions.push({ icon: '👥', label: '使用者管理', fn: () => openUsersModal() });
  }
  actions.push({ icon: '🚪', label: '登出', cls: 'del', fn: () => logout() });
  openSheet('功能選單', actions);
}

// ========== 手機版判斷（<768px 視為手機，render 走卡片式模板） ==========
function isMobileView() {
  return window.matchMedia('(max-width: 767px)').matches;
}

// 手機 viewport 變化時：切頁自動重繪（render 函式每次呼叫都會重新判斷）
// 桌面↔手機 resize 跨過 768px 斷點時，若停在庫存頁則重繪一次
let _lastMobileState = null;
window.addEventListener('resize', () => {
  const now = isMobileView();
  if (_lastMobileState !== null && _lastMobileState !== now) {
    _lastMobileState = now;
    if (typeof currentTab !== 'undefined' && typeof switchTab === 'function') {
      switchTab(currentTab);
    }
  } else {
    _lastMobileState = now;
  }
});
