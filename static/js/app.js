// 庫存管理系統 - 入口控制（v8 拆分）
// 載入順序：globals → utils → api → render/* → modals/* → 本檔（最後觸發啟動）

// ========== 分片切換（辦公室 / 倉庫） ==========
// M15：有未儲存的數量調整 → 切分片/重整前先確認，避免 pending 錯位或靜默丟失
function hasPending() {
  return typeof pending !== 'undefined' && Object.keys(pending).length > 0;
}

function switchSite(site) {
  if (site === currentSite) return;
  if (hasPending() && !confirm('⚠️ 有未儲存的數量調整，切換分片將遺失。確定要切換嗎？')) return;
  currentSite = site;
  document.querySelectorAll('.site-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('site-' + site).classList.add('active');
  loadData();
  syncViewUrl();  // 2026-08-14：URL 同步畫面狀態（F5 保留分片）
}

window.addEventListener('beforeunload', (e) => {
  if (!hasPending()) return;
  e.preventDefault();
  e.returnValue = '';
});

// ========== 頁籤切換 ==========
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const nav = document.getElementById('nav-' + tab);
  if (nav) nav.classList.add('active');
  // 行事曆頁不需要庫存搜尋、辦公室/倉庫分片與廠牌 tab（家豪 2026-08-12 指定）
  const isCal = tab === 'calendar';
  const sb = document.querySelector('.search-box');
  const st = document.querySelector('.site-tabs');
  const bt = document.getElementById('brand-tabs');
  if (sb) sb.style.display = isCal ? 'none' : '';
  if (st) st.style.display = isCal ? 'none' : '';
  if (bt) bt.style.display = isCal ? 'none' : '';
  if (tab === 'inventory') renderInventory();
  else if (tab === 'prepared') renderPrepared();
  else if (tab === 'stockout') renderStockOuts();
  else if (tab === 'stocktake') renderStocktake();
  else if (tab === 'kit') renderKits();
  else if (tab === 'calendar') renderCalendar();
  syncViewUrl();  // 2026-08-14：URL 同步畫面狀態（F5 保留頁籤）
}

// 檢查今天日期，每月 25 號（含）後顯示「月底記得盤點」提醒橫幅
function checkReminder() {
  const now = new Date();
  const day = now.getDate();
  const el = document.getElementById('reminder');
  if (day >= 25) {
    el.style.display = 'flex';
    document.getElementById('today-str').textContent =
      `${now.getMonth()+1}月${day}日`;
  } else {
    el.style.display = 'none';
  }
}


document.getElementById('search-input').addEventListener('input', () => {
  if (currentTab === 'inventory') renderInventory();
});

// 2026-08-13 Sarah：重新打開網站搜尋框殘留「admin」——瀏覽器 autofill 把登入帳號填入
// 頁面第一個文字框。三重防護：type=search（Chrome 不對 search input 填帳號）+ autocomplete=new-password
// + load 後延遲清空兜底（autofill 常在 DOMContentLoaded 之後才寫入，啟動時清太早）
function clearSearchAutofill() {
  const si = document.getElementById('search-input');
  if (si) si.value = '';
}
window.addEventListener('load', () => {
  clearSearchAutofill();
  setTimeout(clearSearchAutofill, 500);
});

// ========== 多使用者即時性與畫面狀態持久化（2026-08-14 Phase 3） ==========
// F5 後恢復畫面狀態（URL 參數白名單驗證）
const _TABS = ['inventory', 'prepared', 'stockout', 'stocktake', 'kit', 'calendar'];
const _SITES = ['office', 'warehouse'];

// 切回頁籤/視窗自動重載最新資料（多使用者即時性；有未儲存調整時跳過）
let _focusReloadTimer = null;  // 2026-08-14 審查補：visibilitychange+focus 雙觸發去重（300ms debounce）
function autoReloadOnFocus() {
  if (hasPending()) return;  // M15：有未儲存調整不重載，避免 pending 錯位
  if (document.querySelector('.modal-overlay.show')) return;  // 2026-08-14 審查補：modal 開啟中不重載（避免編輯/盤點輸入被重繪）
  if (document.visibilityState !== 'visible') return;
  if (_focusReloadTimer) return;  // 已排程，等 debounce
  _focusReloadTimer = setTimeout(() => { _focusReloadTimer = null; loadData(); }, 300);
}
document.addEventListener('visibilitychange', autoReloadOnFocus);
window.addEventListener('focus', autoReloadOnFocus);

// 畫面狀態寫入 URL（不觸發重載）；行事曆月份 calMonth 一併帶上
function syncViewUrl() {
  const p = new URLSearchParams();
  p.set('tab', currentTab);
  p.set('site', currentSite);
  const cm = (typeof calMonth !== 'undefined') ? calMonth : new Date();
  p.set('month', cm.getFullYear() + '-' + String(cm.getMonth() + 1).padStart(2, '0'));
  history.replaceState(null, '', '?' + p.toString());
}

// 啟動：先檢查登入，過關才載資料
(async () => {
  const user = await checkAuth();
  if (user) {
    // 2026-08-14：F5 後從 URL 恢復畫面狀態（白名單驗證，壞值忽略）
    const _p = new URLSearchParams(location.search);
    const _t = _p.get('tab');
    const _s = _p.get('site');
    if (_TABS.includes(_t)) currentTab = _t;
    if (_SITES.includes(_s)) currentSite = _s;
    renderUserMenu(user);
    applyRoleView(user);  // viewer 唯讀模式：隱藏新增/盤點/儲存列等
    if (user.password_expired) openExpiryModal();  // v11.2：6 個月未改密碼 → 提示（非強制）
    await loadUnits();  // 2026-08-16 單位動態清單：先載入再渲染（modal 開啟時清單已就緒）
    loadData();
  } else {
    // checkAuth 回 null = 網路錯誤/伺服器掛（401 已在 checkAuth 內跳登入）→ 顯示錯誤不卡轉圈
    const content = document.getElementById('content');
    if (content) content.innerHTML = '<div class="empty">⚠️ 無法連線伺服器，請重新整理頁面<br><small>若持續發生請聯絡管理員</small></div>';
  }
})();
