// 庫存管理系統 - 入口控制（v8 拆分 → Phase 1 Shell v2 2026-09-06）
// 載入順序：globals → utils → api → render/* → modals/* → 本檔（最後觸發啟動）

// ========== 分片切換（公司 / 倉庫 / 廂型車 / 貨車） ==========
// M15：有未儲存的數量調整 → 切分片/重整前先確認，避免 pending 錯位或靜默丟失
function hasPending() {
  return typeof pending !== 'undefined' && Object.keys(pending).length > 0;
}

function switchSite(site) {
  if (INVENTORY_SITES.indexOf(site) < 0) return;
  if (site === currentSite) return;
  if (hasPending() && !confirm('⚠️ 有未儲存的數量調整，切換分片將遺失。確定要切換嗎？')) return;
  currentSite = site;
  inventoryLoadedSite = '';
  fullItemsLoadedSite = '';
  INVENTORY_META.page = 1;
  INVENTORY_META.stats = null;
  INVENTORY_FACETS = { brands: {}, categories: {}, locations: [] };
  inventoryFacetsLoadedSite = '';
  ALL_ITEMS = [];
  ALERTS_BY_SITE = {};
  updateNotifications();
  document.querySelectorAll('.h-site button').forEach(function(t){ t.classList.remove('is-active'); });
  var el = document.getElementById('site-' + site);
  if (el) el.classList.add('is-active');
  loadData();
  syncViewUrl();
}

window.addEventListener('beforeunload', function(e) {
  if (!hasPending()) return;
  e.preventDefault();
  e.returnValue = '';
});

// ========== Shell v2：Sidebar + More Menu + Breadcrumb + Notif ==========

function openSidebar() {
  document.getElementById('sidebar').classList.add('mob-open');
  document.getElementById('sbOverlay').classList.add('is-open');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('mob-open');
  document.getElementById('sbOverlay').classList.remove('is-open');
}

// Sidebar toggle (desktop: hidden ↔ shown, mobile: drawer)
function toggleSidebar() {
  var sb = document.getElementById('sidebar');
  var mn = document.querySelector('.main');
  var isDesktop = window.innerWidth >= 768;
  if (!isDesktop) {
    // Mobile: use drawer behavior
    if (sb.classList.contains('mob-open')) closeSidebar();
    else openSidebar();
    return;
  }
  // Desktop: toggle hidden/expanded
  var expanded = sb.classList.toggle('is-expanded');
  mn.classList.toggle('sidebar-expanded', expanded);
}

// Sidebar 預設關閉（不從 localStorage 恢復展開狀態）
// 使用者可透過 ☰ 按鈕手動展開，但每次進入網頁都從關閉狀態開始

// 頭像下拉選單
function toggleAvatarMenu() {
  document.getElementById('avatarMenu').classList.toggle('is-open');
}
function closeAvatarMenu() {
  var m = document.getElementById('avatarMenu');
  if (m) m.classList.remove('is-open');
}
document.addEventListener('click', function(e) {
  if (!e.target.closest('.avatar-dropdown')) closeAvatarMenu();
});

// Sidebar 使用者
function renderSidebarUser(user) {
  if (!user) return;
  var sbUser = document.getElementById('sb-user');
  var sbName = document.getElementById('sb-user-name');
  var sbRole = document.getElementById('sb-user-role');
  var sbAv   = document.getElementById('sb-user-av');
  
  var hAv    = document.getElementById('h-av');
  if (sbUser) sbUser.style.display = '';
  if (sbName) sbName.textContent = user.display_name || user.username;
  if (sbRole) sbRole.textContent = user.role === 'admin' ? '管理員' : user.role === 'viewer' ? '檢視者' : '使用者';
  if (sbAv) sbAv.textContent = (user.display_name || user.username || '—').charAt(0);
  if (hAv) hAv.textContent = (user.display_name || user.username || '—').charAt(0);
}

// ========== 頁籤切換 ==========
var _TAB_LABEL = { calendar:'行事曆', 'work-progress':'每日工作進度回報', inventory:'單一庫存', prepared:'待領出', stockout:'已領出', stocktake:'盤點', kit:'整組庫存', 'signed-reports':'每日簽名日報表', quotation:'報價單', 'petty-cash':'零用金月報' };
var _TAB_ICON  = { calendar:'📅', 'work-progress':'📸', inventory:'📦', prepared:'📤', stockout:'🚚', stocktake:'📋', kit:'🔧', 'signed-reports':'🗂', quotation:'🧾', 'petty-cash':'🪙' };

function updateBreadcrumb(tab) {
  var el = document.getElementById('breadcrumb');
  if (el) el.innerHTML = (_TAB_ICON[tab]||'📦') + ' <b>' + (_TAB_LABEL[tab]||tab) + '</b>';
}

function renderNoAccessiblePage() {
  currentTab = '';
  setPageScope('');
  var content = document.getElementById('content');
  if (content) content.innerHTML = '<div class="empty">目前沒有可用的頁面</div>';

  updateBreadcrumb('');
  syncViewUrl();
}

// 頁面範圍（CSS 架構重構 P1）：body[data-page] 是頁面樣式的唯一範圍，modal 也在 body 內。
// 過渡期同時維護 #content 上的舊 *-content class；每次都先全部移除，避免上一頁的 class 殘留
// （例：報價單上傳的 quotation-upload-content 曾在切回庫存後殘留，改掉庫存頁內距）。
var PAGE_CONTENT_CLASS = {
  'signed-reports': 'dsr-content',
  'calendar': 'cal-content',
  'quotation': 'quotation-content',
  'quotation-upload': 'quotation-upload-content',
  'petty-cash': 'pc-content',
  'inventory': 'inventory-content',
  'prepared': 'prepared-content',
  'kit': 'kit-content',
  'stocktake': 'stocktake-content',
  'stockout': 'stockout-content',
  'work-progress': 'wpr-content'
};

function setPageScope(page) {
  if (page) document.body.dataset.page = page;
  else delete document.body.dataset.page;
  var content = document.getElementById('content');
  if (!content) return;
  Object.keys(PAGE_CONTENT_CLASS).forEach(function(key) {
    content.classList.toggle(PAGE_CONTENT_CLASS[key], key === page);
  });
}

function switchTab(tab) {
  if (typeof resolveAccessiblePageTab === 'function') {
    tab = resolveAccessiblePageTab(tab);
    if (!tab) { renderNoAccessiblePage(); return; }
  }
  var previousTab = currentTab;
  if (previousTab === 'work-progress' && tab !== 'work-progress' && typeof wprHasUnsavedChanges === 'function' && wprHasUnsavedChanges()) {
    if (typeof wprRequestLeave === 'function') wprRequestLeave(tab);
    return;
  }
  if (previousTab === 'work-progress' && tab !== 'work-progress') {
    if (typeof wprClearPendingFiles === 'function') wprClearPendingFiles();
    if (typeof wprCloseGallery === 'function') wprCloseGallery();
  }
  if (typeof closeInventoryStatusModal === 'function') closeInventoryStatusModal();
  currentTab = tab;
  syncViewUrl();
  checkReminder();
  updateNotifications();
  setPageScope(tab);
  document.querySelectorAll('.nav-item').forEach(function(n){ n.classList.remove('is-active'); });
  document.querySelectorAll('.sb-nav-link').forEach(function(n){ n.classList.remove('is-active'); });
  var nav = document.getElementById('nav-' + tab);
  if (nav) nav.classList.add('is-active');
  var sbNav = document.getElementById('sb-nav-' + tab);
  if (sbNav) sbNav.classList.add('is-active');
  updateBreadcrumb(tab);
  closeSidebar();

  // 行事曆與簽名報表不需要搜尋框、公司／倉庫分片與廠牌分頁
  var isCal = tab === 'calendar' || tab === 'work-progress' || tab === 'signed-reports' || tab === 'quotation' || tab === 'petty-cash';
  var isInventory = tab === 'inventory';
  var sb = document.querySelector('.h-search');
  var st = document.querySelector('.h-site');
  if (sb) sb.style.display = isCal ? 'none' : '';
  if (st) st.style.display = isCal ? 'none' : '';
  // 篩選面板只在庫存頁顯示
  var fp = document.getElementById('filter-panel');
  if (fp) fp.style.display = isInventory ? '' : 'none';
  // 批款改位置價限單一庫存別離時自動退出批款模式伦隱藨 batch-bar\uff08避免跨頁殘留\uff09
  if (!isInventory) {
    if (typeof batchMode !== 'undefined' && batchMode) {
      batchMode = false;
      var bt = document.getElementById('batch-toggle');
      if (bt) bt.classList.remove('is-active');
    }
    if (typeof selectedStockIds !== 'undefined') selectedStockIds.clear();
    var bn = document.getElementById('batch-num');
    if (bn) bn.textContent = '0';
    var bc = document.getElementById('batch-confirm');
    if (bc) bc.disabled = true;
    var bb = document.getElementById('batch-bar');
    if (bb) bb.classList.remove('is-open');
    var cab = document.getElementById('batch-cabinet');
    if (cab) cab.value = '';
    var sub = document.getElementById('batch-sub');
    if (sub) sub.value = '';
  }
  if (tab === 'inventory') {
    if (inventoryLoadedSite !== currentSite) {
      loadInventoryPage(1);
      return;
    }
    renderInventory();
  } else if (['prepared', 'stockout', 'stocktake', 'kit'].indexOf(tab) >= 0 && fullItemsLoadedSite !== currentSite) {
    loadData({ full: true });
    return;
  } else if (tab === 'prepared') renderPrepared();
  else if (tab === 'stockout') renderStockOuts();
  else if (tab === 'stocktake') renderStocktake();
  else if (tab === 'kit') renderKits();
  else if (tab === 'calendar') renderCalendar();
  else if (tab === 'work-progress') renderWorkProgress();
  else if (tab === 'signed-reports') renderSignedReports();
  else if (tab === 'quotation') renderQuotation();
  else if (tab === 'petty-cash') renderPettyCash();
  syncViewUrl();
}

// 檢查今天日期，每月 25 號（含）後顯示「月底記得盤點」提醒橫幅
function checkReminder() {
  var el = document.getElementById('reminder');
  if (!el) return;
  if (typeof canAccessPage === 'function' && !canAccessPage('stocktake', 'operate')) {
    el.style.display = 'none';
    return;
  }
  var state = typeof getStocktakeReminderState === 'function'
    ? getStocktakeReminderState()
    : { visible: false, todayLabel: '' };
  if (state.visible) {
    el.style.display = 'flex';
    var today = document.getElementById('today-str');
    if (today) today.textContent = state.todayLabel;
  } else {
    el.style.display = 'none';
  }
}

var _searchTimer;
document.getElementById('search-input').addEventListener('input', function() {
  clearTimeout(_searchTimer);
  _searchTimer = setTimeout(function() {
    if (currentTab === 'inventory') loadInventoryPage(1);
    else if (currentTab === 'prepared') renderPrepared();
    else if (currentTab === 'stockout') renderStockOuts();
    else if (currentTab === 'stocktake') renderStocktake();
    else if (currentTab === 'kit') renderKits();
  }, 200);
});

function clearSearchAutofill() {
  var si = document.getElementById('search-input');
  if (si) si.value = '';
}
window.addEventListener('load', function() {
  clearSearchAutofill();
  setTimeout(clearSearchAutofill, 500);
});

// 多使用者即時性與畫面狀態持久化
var _TABS = ['inventory', 'prepared', 'stockout', 'stocktake', 'kit', 'calendar', 'work-progress', 'signed-reports', 'quotation', 'petty-cash'];

var _focusReloadTimer = null;
var _lastVisibilityReloadAt = 0;
function autoReloadOnFocus() {
  if (hasPending()) return;
  if (document.querySelector('.modal-overlay.is-open')) return;
  if (document.visibilityState !== 'visible') return;
  // 只在 hidden → visible 時觸發；避免 window focus、手機輸入框/原生視窗反覆重畫。
  var now = Date.now();
  if (now - _lastVisibilityReloadAt < 1500) return;
  if (_focusReloadTimer) return;
  _focusReloadTimer = setTimeout(function() {
    _focusReloadTimer = null;
    if (document.visibilityState !== 'visible' || hasPending() || document.querySelector('.modal-overlay.is-open')) return;
    _lastVisibilityReloadAt = Date.now();
    loadData();
  }, 300);
}
document.addEventListener('visibilitychange', autoReloadOnFocus);

function syncViewUrl() {
  var p = new URLSearchParams();
  p.set('tab', currentTab);
  p.set('site', currentSite);
  var cm = (typeof calMonth !== 'undefined') ? calMonth : new Date();
  p.set('month', cm.getFullYear() + '-' + String(cm.getMonth() + 1).padStart(2, '0'));
  history.replaceState(null, '', '?' + p.toString());
}

// Bootstrap only: mount a stateful itemless page once after initial data setup.
function mountPreservedTabAfterBootstrap() {
  if (DATA_REFRESH_PRESERVE_MOUNT_TABS.has(currentTab)) switchTab(currentTab);
}

// ========== 啟動 ==========
(async function() {
  var user = await checkAuth();
  if (user) {
    var _p = new URLSearchParams(location.search);
    var _t = _p.get('tab');
    var _s = _p.get('site');
    if (_TABS.indexOf(_t) >= 0) currentTab = _t;
    if (INVENTORY_SITES.indexOf(_s) >= 0) currentSite = _s;
    renderUserMenu(user);
    renderSidebarUser(user);
    applyRoleView(user);
    if (!currentTab) { renderNoAccessiblePage(); return; }
    if (user.password_expired) openExpiryModal();
    var bootTab = currentTab;
    await loadUnits();
    // 等待期間使用者已自行切頁（switchTab 已掛載該頁與範圍）→ 不可再用啟動時的流程覆蓋（例：報價單上傳被重掛成報價單）
    var tabChangedDuringBoot = currentTab !== bootTab;
    updateBreadcrumb(currentTab);
    // site active 同步
    document.querySelectorAll('.h-site button').forEach(function(t){ t.classList.remove('is-active'); });
    var siteEl = document.getElementById('site-' + currentSite);
    if (siteEl) siteEl.classList.add('is-active');
    // sidebar active 同步
    var sbNav = document.getElementById('sb-nav-' + currentTab);
    document.querySelectorAll('.sb-nav-link').forEach(function(n){ n.classList.remove('is-active'); });
    if (sbNav) sbNav.classList.add('is-active');
    if (!tabChangedDuringBoot) setPageScope(currentTab);
    loadData();
    // loadData 不重繪保留 mount 的頁面；F5 直接開啟時由 bootstrap 建立一次頁面。
    if (!tabChangedDuringBoot) mountPreservedTabAfterBootstrap();
  } else {
    var content = document.getElementById('content');
    if (content) content.innerHTML = '<div class="empty">⚠️ 無法連線伺服器，請重新整理頁面<br><small>若持續發生請聯絡管理員</small></div>';
  }
})();
