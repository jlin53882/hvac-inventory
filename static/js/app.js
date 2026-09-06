// 庫存管理系統 - 入口控制（v8 拆分 → Phase 1 Shell v2 2026-09-06）
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
  const el = document.getElementById('site-' + site);
  if (el) el.classList.add('active');
  loadData();
  syncViewUrl();  // 2026-08-14：URL 同步畫面狀態（F5 保留分片）
}

window.addEventListener('beforeunload', (e) => {
  if (!hasPending()) return;
  e.preventDefault();
  e.returnValue = '';
});

// ========== Shell v2：Sidebar + More Menu + Breadcrumb ==========

// Sidebar overlay / 開關
function openSidebar() {
  document.getElementById('sidebar')?.classList.add('mob-open');
  document.getElementById('sbOverlay')?.classList.add('open');
}
function closeSidebar() {
  document.getElementById('sidebar')?.classList.remove('mob-open');
  document.getElementById('sbOverlay')?.classList.remove('open');
}

// 手機底部「更多」選單
function toggleMoreMenu() {
  document.getElementById('moreMenu')?.classList.toggle('open');
}
function closeMoreMenu() {
  document.getElementById('moreMenu')?.classList.remove('open');
}
// 點其他區域關閉
document.addEventListener('click', function(e) {
  if (!e.target.closest('#moreMenu') && !e.target.closest('#nav-more')) closeMoreMenu();
});

// Sidebar 使用者
function renderSidebarUser(user) {
  if (!user) return;
  const sbUser = document.getElementById('sb-user');
  const sbName = document.getElementById('sb-user-name');
  const sbRole = document.getElementById('sb-user-role');
  const sbAv   = document.getElementById('sb-user-av');
  const sbActs = document.getElementById('sb-user-actions');
  if (!sbUser) return;
  sbUser.style.display = '';
  sbName.textContent = user.display_name || user.username;
  sbRole.textContent = user.role === 'admin' ? '管理員' : user.role === 'viewer' ? '檢視者' : '使用者';
  sbAv.textContent = (user.display_name || user.username || '—').charAt(0);
  // 改密碼/登出
  if (sbActs) {
    sbActs.style.display = 'flex';
  }
}

// ========== 頁籤切換 ==========
var _TAB_LABEL = { calendar:'行事曆', inventory:'單一庫存', prepared:'待領出', stockout:'已領出', stocktake:'盤點', kit:'整組庫存' };
var _TAB_ICON  = { calendar:'📅', inventory:'📦', prepared:'📤', stockout:'🚚', stocktake:'📋', kit:'🔧' };

function updateBreadcrumb(tab) {
  var el = document.getElementById('breadcrumb');
  if (el) el.innerHTML = (_TAB_ICON[tab]||'📦') + ' <b>' + (_TAB_LABEL[tab]||tab) + '</b>';
}

function switchTab(tab) {
  currentTab = tab;
  // 桌面 bottom-nav + sidebar 同步 active
  document.querySelectorAll('.nav-item').forEach(function(n){ n.classList.remove('active'); });
  document.querySelectorAll('.sb-nav-link').forEach(function(n){ n.classList.remove('active'); });
  var nav = document.getElementById('nav-' + tab);
  if (nav) nav.classList.add('active');
  var sbNav = document.getElementById('sb-nav-' + tab);
  if (sbNav) sbNav.classList.add('active');
  // 「更多」內的 kit：切到 kit 時讓 more 按鈕也高亮
  var moreBtn = document.getElementById('nav-more');
  if (moreBtn) moreBtn.classList.toggle('active', tab === 'kit');
  updateBreadcrumb(tab);
  // 關 sidebar / more menu（手機切頁後收起）
  closeSidebar();
  closeMoreMenu();

  // 行事曆頁不需要庫存搜尋、辦公室/倉庫分片與廠牌 tab（家豪 2026-08-12 指定）
  var isCal = tab === 'calendar';
  var isInventory = tab === 'inventory';
  var sb = document.querySelector('.search-box');
  var st = document.querySelector('.site-tabs');
  var fp = document.getElementById('filter-panel');
  // 搜尋框：行事曆隱藏，其餘顯示
  if (sb) sb.style.display = isCal ? 'none' : '';
  if (st) st.style.display = isCal ? 'none' : '';
  // 篩選面板：只在單一庫存頁顯示
  if (fp) fp.style.display = isInventory ? '' : 'none';
  // 批次改位置僅限單一庫存：切離時自動退出批次模式並隱藏 batch-bar（避免跨頁殘留）
  if (!isInventory) {
    if (typeof batchMode !== 'undefined' && batchMode) {
      batchMode = false;
      var bt = document.getElementById('batch-toggle');
      if (bt) bt.classList.remove('active');
    }
    if (typeof selectedStockIds !== 'undefined') selectedStockIds.clear();
    var bn = document.getElementById('batch-num');
    if (bn) bn.textContent = '0';
    var bc = document.getElementById('batch-confirm');
    if (bc) bc.disabled = true;
    var bb = document.getElementById('batch-bar');
    if (bb) bb.classList.remove('show');
    var cab = document.getElementById('batch-cabinet');
    if (cab) cab.value = '';
    var sub = document.getElementById('batch-sub');
    if (sub) sub.value = '';
  }
  if (tab === 'inventory') renderInventory();
  else if (tab === 'prepared') renderPrepared();
  else if (tab === 'stockout') renderStockOuts();
  else if (tab === 'stocktake') renderStocktake();
  else if (tab === 'kit') renderKits();
  else if (tab === 'calendar') renderCalendar();
  syncViewUrl();  // 2026-08-14：URL 同步畫面狀態（F5 保留頁籤）
}

// 檢查今天日期，每月 25 號（含）後顯示「月底記得盤點」提醒橫幅
// 2026-09-06：完成盤點後當月不再顯示（localStorage 追蹤）
function checkReminder() {
  var now = new Date();
  var day = now.getDate();
  var el = document.getElementById('reminder');
  var currentMonth = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0');
  var lastStocktakeMonth = localStorage.getItem('lastStocktakeMonth');

  if (day >= 25 && lastStocktakeMonth !== currentMonth) {
    el.style.display = 'flex';
    document.getElementById('today-str').textContent =
      (now.getMonth()+1) + '月' + day + '日';
  } else {
    el.style.display = 'none';
  }
}


var _searchTimer;
document.getElementById('search-input').addEventListener('input', function() {
  // 所有頁面都支援搜尋（行事曆頁搜尋框已隱藏，不會觸發）；debounce 200ms 防每字元完整 fetch
  clearTimeout(_searchTimer);
  _searchTimer = setTimeout(function() {
    if (currentTab === 'inventory') renderInventory();
    else if (currentTab === 'prepared') renderPrepared();
    else if (currentTab === 'stockout') renderStockOuts();
    else if (currentTab === 'stocktake') renderStocktake();
    else if (currentTab === 'kit') renderKits();
  }, 200);
});

// 2026-08-13 Sarah：重新打開網站搜尋框殘留「admin」——瀏覽器 autofill 把登入帳號填入
// 頁面第一個文字框。三重防護：type=search（Chrome 不對 search input 填帳號）+ autocomplete=new-password
// + load 後延遲清空兜底（autofill 常在 DOMContentLoaded 之後才寫入，啟動時清太早）
function clearSearchAutofill() {
  var si = document.getElementById('search-input');
  if (si) si.value = '';
}
window.addEventListener('load', function() {
  clearSearchAutofill();
  setTimeout(clearSearchAutofill, 500);
});

// ========== 多使用者即時性與畫面狀態持久化（2026-08-14 Phase 3） ==========
// F5 後恢復畫面狀態（URL 參數白名單驗證）
var _TABS = ['inventory', 'prepared', 'stockout', 'stocktake', 'kit', 'calendar'];
var _SITES = ['office', 'warehouse'];

// 切回頁籤/視窗自動重載最新資料（多使用者即時性；有未儲存調整時跳過）
var _focusReloadTimer = null;  // 2026-08-14 審查補：visibilitychange+focus 雙觸發去重（300ms debounce）
function autoReloadOnFocus() {
  if (hasPending()) return;  // M15：有未儲存調整不重載，避免 pending 錯位
  if (document.querySelector('.modal-overlay.show')) return;  // 2026-08-14 審查補：modal 開啟中不重載（避免編輯/盤點輸入被重繪）
  if (document.visibilityState !== 'visible') return;
  if (_focusReloadTimer) return;  // 已排程，等 debounce
  _focusReloadTimer = setTimeout(function() { _focusReloadTimer = null; loadData(); }, 300);
}
document.addEventListener('visibilitychange', autoReloadOnFocus);
window.addEventListener('focus', autoReloadOnFocus);

// 畫面狀態寫入 URL（不觸發重載）；行事曆月份 calMonth 一併帶上
function syncViewUrl() {
  var p = new URLSearchParams();
  p.set('tab', currentTab);
  p.set('site', currentSite);
  var cm = (typeof calMonth !== 'undefined') ? calMonth : new Date();
  p.set('month', cm.getFullYear() + '-' + String(cm.getMonth() + 1).padStart(2, '0'));
  history.replaceState(null, '', '?' + p.toString());
}

// ========== 啟動 ==========
(async function() {
  var user = await checkAuth();
  if (user) {
    // 2026-08-14：F5 後從 URL 恢復畫面狀態（白名單驗證，壞值忽略）
    var _p = new URLSearchParams(location.search);
    var _t = _p.get('tab');
    var _s = _p.get('site');
    if (_TABS.indexOf(_t) >= 0) currentTab = _t;
    if (_SITES.indexOf(_s) >= 0) currentSite = _s;
    renderUserMenu(user);
    renderSidebarUser(user);
    applyRoleView(user);  // viewer 唯讀模式：隱藏新增/盤點/儲存列等
    if (user.password_expired) openExpiryModal();  // v11.2：6 個月未改密碼 → 提示（非強制）
    await loadUnits();  // 2026-08-16 單位動態清單：先載入再渲染（modal 開啟時清單已就緒）
    updateBreadcrumb(currentTab);
    // site active 同步
    var siteEl = document.getElementById('site-' + currentSite);
    if (siteEl) {
      document.querySelectorAll('.site-tab').forEach(function(t){ t.classList.remove('active'); });
      siteEl.classList.add('active');
    }
    // sidebar active 同步
    var sbNav = document.getElementById('sb-nav-' + currentTab);
    if (sbNav) sbNav.classList.add('active');
    loadData();
  } else {
    // checkAuth 回 null = 網路錯誤/伺服器掛（401 已在 checkAuth 內跳登入）→ 顯示錯誤不卡轉圈
    var content = document.getElementById('content');
    if (content) content.innerHTML = '<div class="empty">⚠️ 無法連線伺服器，請重新整理頁面<br><small>若持續發生請聯絡管理員</small></div>';
  }
})();
