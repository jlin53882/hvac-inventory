// 庫存管理系統 - 主頁外殼：頁籤切換、側欄、使用者選單、開機流程

import { loadData, loadInventoryPage } from '../../core/data.js';
import { getStocktakeReminderState, updateNotifications } from '../../core/notifications.js';
import { canAccessPage, checkAuth, firstAccessiblePageTab, resolveAccessiblePageTab } from '../../core/session.js';
import { DATA_REFRESH_PRESERVE_MOUNT_TABS, INVENTORY_SITES, appState, pending } from '../../core/state.js';
import { loadUnits } from '../../core/units.js';
import { openExpiryModal } from '../account/password-expiry.js';
import { renderCalendar } from '../calendar/view.js';
import { selectedStockIds } from '../inventory/batch-location.js';
import { renderInventory } from '../inventory/list.js';
import { closeInventoryStatusModal } from '../inventory/status.js';
import { renderKits } from '../kits/page.js';
import { renderPettyCash } from '../petty-cash/page.js';
import { renderPrepared } from '../prepared/page.js';
import { renderQuotation } from '../quotation/page.js';
import { renderStockOuts } from '../stockout/page.js';
import { renderStocktake } from '../stocktake/page.js';
import { renderSignedReports } from '../upload-list/signed-reports.js';
import { wprClearPendingFiles, wprHasUnsavedChanges, wprRequestLeave } from '../work-progress/draft.js';
import { wprCloseGallery } from '../work-progress/gallery.js';
import { renderWorkProgress } from '../work-progress/page.js';

// ---------- 頭像下拉選單 ----------
function renderUserMenu(user) {
  // 更新下拉選單 header 顯示使用者名稱
  var header = document.getElementById('avatarMenuHeader');
  if (header && user) {
    header.textContent = '👤 ' + (user.display_name || user.username);
  }
  // 更新 sidebar 使用者資訊
  renderSidebarUser(user);
}

function applyPageVisibility(user) {
  var visible = Array.isArray(user.visible_pages) ? user.visible_pages : null;
  document.querySelectorAll('[data-page-key]').forEach(function(el) {
    var pageKey = el.dataset.pageKey;
    el.style.display = !visible || canAccessPage(pageKey) ? '' : 'none';
  });
  if (typeof appState.currentTab !== 'undefined' && !canAccessPage(appState.currentTab)) {
    appState.currentTab = firstAccessiblePageTab() || '';
  }
}

// ---------- 角色 UI 控制（RBAC 2026-08-13） ----------
function applyRoleView(user) {
  if (!user) return;
  applyPageVisibility(user);
  var perms = user.permissions || {};
  var canAdjust = !!perms['stock-mgmt'];
  var sbNavStocktake = document.getElementById('sb-nav-stocktake');
  var sbNavWorkProgress = document.getElementById('sb-nav-work-progress');
  var saveBar = document.getElementById('save-bar');

  if (sbNavStocktake) sbNavStocktake.style.display = canAccessPage('stocktake') ? '' : 'none';
  if (sbNavWorkProgress) sbNavWorkProgress.style.display = canAccessPage('work-progress') ? '' : 'none';
  checkReminder();
  if (saveBar) saveBar.style.display = canAdjust ? '' : 'none';
  if (!canAccessPage('work-progress') && typeof appState.currentTab !== 'undefined' && appState.currentTab === 'work-progress') {
    switchTab('calendar');
  }
  if (!canAccessPage('stocktake') && typeof appState.currentTab !== 'undefined' && appState.currentTab === 'stocktake') {
    switchTab('inventory');
  }
}
// 庫存管理系統 - 入口控制（v8 拆分 → Phase 1 Shell v2 2026-09-06）

// ========== 分片切換（公司 / 倉庫 / 廂型車 / 貨車） ==========
// M15：有未儲存的數量調整 → 切分片/重整前先確認，避免 pending 錯位或靜默丟失
function hasPending() {
  return Object.keys(pending).length > 0;
}

export function switchSite(site) {
  if (INVENTORY_SITES.indexOf(site) < 0) return;
  if (site === appState.currentSite) return;
  if (hasPending() && !confirm('⚠️ 有未儲存的數量調整，切換分片將遺失。確定要切換嗎？')) return;
  appState.currentSite = site;
  appState.inventoryLoadedSite = '';
  appState.fullItemsLoadedSite = '';
  appState.INVENTORY_META.page = 1;
  appState.INVENTORY_META.stats = null;
  appState.INVENTORY_FACETS = { brands: {}, categories: {}, locations: [] };
  appState.inventoryFacetsLoadedSite = '';
  appState.ALL_ITEMS = [];
  appState.ALERTS_BY_SITE = {};
  updateNotifications();
  document.querySelectorAll('[data-role="header-site"] button').forEach(function(t){ t.classList.remove('is-active'); });
  var el = document.getElementById('site-' + site);
  if (el) el.classList.add('is-active');
  loadData();
  syncViewUrl();
}

// ========== Shell v2：Sidebar + More Menu + Breadcrumb + Notif ==========

export function openSidebar() {
  document.getElementById('sidebar').classList.add('mob-open');
  document.getElementById('sbOverlay').classList.add('is-open');
}
export function closeSidebar() {
  document.getElementById('sidebar').classList.remove('mob-open');
  document.getElementById('sbOverlay').classList.remove('is-open');
}

// Sidebar toggle (desktop: hidden ↔ shown, mobile: drawer)
export function toggleSidebar() {
  var sb = document.getElementById('sidebar');
  var mn = document.querySelector('[data-role="app-main"]');
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
export function toggleAvatarMenu() {
  document.getElementById('avatarMenu').classList.toggle('is-open');
}
function closeAvatarMenu() {
  var m = document.getElementById('avatarMenu');
  if (m) m.classList.remove('is-open');
}

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
  appState.currentTab = '';
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

export function setPageScope(page) {
  if (page) document.body.dataset.page = page;
  else delete document.body.dataset.page;
  var content = document.getElementById('content');
  if (!content) return;
  Object.keys(PAGE_CONTENT_CLASS).forEach(function(key) {
    content.classList.toggle(PAGE_CONTENT_CLASS[key], key === page);
  });
}

export function switchTab(tab) {
  tab = resolveAccessiblePageTab(tab);
  if (!tab) { renderNoAccessiblePage(); return; }
  var previousTab = appState.currentTab;
  if (previousTab === 'work-progress' && tab !== 'work-progress' && wprHasUnsavedChanges()) {
    wprRequestLeave(tab);
    return;
  }
  if (previousTab === 'work-progress' && tab !== 'work-progress') {
    wprClearPendingFiles();
    wprCloseGallery();
  }
  closeInventoryStatusModal();
  appState.currentTab = tab;
  syncViewUrl();
  checkReminder();
  updateNotifications();
  setPageScope(tab);
  document.querySelectorAll('[data-role="sidebar-nav-link"]').forEach(function(n){ n.classList.remove('is-active'); });
  var nav = document.getElementById('nav-' + tab);
  if (nav) nav.classList.add('is-active');
  var sbNav = document.getElementById('sb-nav-' + tab);
  if (sbNav) sbNav.classList.add('is-active');
  updateBreadcrumb(tab);
  closeSidebar();

  // 行事曆與簽名報表不需要搜尋框、公司／倉庫分片與廠牌分頁
  var isCal = tab === 'calendar' || tab === 'work-progress' || tab === 'signed-reports' || tab === 'quotation' || tab === 'petty-cash';
  var isInventory = tab === 'inventory';
  var sb = document.querySelector('[data-role="header-search"]');
  var st = document.querySelector('[data-role="header-site"]');
  if (sb) sb.style.display = isCal ? 'none' : '';
  if (st) st.style.display = isCal ? 'none' : '';
  // 篩選面板只在庫存頁顯示
  var fp = document.getElementById('filter-panel');
  if (fp) fp.style.display = isInventory ? '' : 'none';
  // 批款改位置價限單一庫存別離時自動退出批款模式伦隱藨 batch-bar\uff08避免跨頁殘留\uff09
  if (!isInventory) {
    if (typeof appState.batchMode !== 'undefined' && appState.batchMode) {
      appState.batchMode = false;
      var bt = document.getElementById('batch-toggle');
      if (bt) bt.classList.remove('is-active');
    }
    selectedStockIds.clear();
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
    if (appState.inventoryLoadedSite !== appState.currentSite) {
      loadInventoryPage(1);
      return;
    }
    renderInventory();
  } else if (['prepared', 'stockout', 'stocktake', 'kit'].indexOf(tab) >= 0 && appState.fullItemsLoadedSite !== appState.currentSite) {
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
export function checkReminder() {
  var el = document.getElementById('reminder');
  if (!el) return;
  if (!canAccessPage('stocktake', 'operate')) {
    el.style.display = 'none';
    return;
  }
  var state = getStocktakeReminderState();
  if (state.visible) {
    el.style.display = 'flex';
    var today = document.getElementById('today-str');
    if (today) today.textContent = state.todayLabel;
  } else {
    el.style.display = 'none';
  }
}

var _searchTimer;

export function clearSearchAutofill() {
  var si = document.getElementById('search-input');
  if (si) si.value = '';
}

// 多使用者即時性與畫面狀態持久化
var _TABS = ['inventory', 'prepared', 'stockout', 'stocktake', 'kit', 'calendar', 'work-progress', 'signed-reports', 'quotation', 'petty-cash'];

var _focusReloadTimer = null;
var _lastVisibilityReloadAt = 0;
function autoReloadOnFocus() {
  if (hasPending()) return;
  if (document.querySelector('[data-role="modal"].is-open')) return;
  if (document.visibilityState !== 'visible') return;
  // 只在 hidden → visible 時觸發；避免 window focus、手機輸入框/原生視窗反覆重畫。
  var now = Date.now();
  if (now - _lastVisibilityReloadAt < 1500) return;
  if (_focusReloadTimer) return;
  _focusReloadTimer = setTimeout(function() {
    _focusReloadTimer = null;
    if (document.visibilityState !== 'visible' || hasPending() || document.querySelector('[data-role="modal"].is-open')) return;
    _lastVisibilityReloadAt = Date.now();
    loadData();
  }, 300);
}

export function syncViewUrl() {
  var p = new URLSearchParams();
  p.set('tab', appState.currentTab);
  p.set('site', appState.currentSite);
  var cm = (typeof appState.calMonth !== 'undefined') ? appState.calMonth : new Date();
  p.set('month', cm.getFullYear() + '-' + String(cm.getMonth() + 1).padStart(2, '0'));
  history.replaceState(null, '', '?' + p.toString());
}

// Bootstrap only: mount a stateful itemless page once after initial data setup.
function mountPreservedTabAfterBootstrap() {
  if (DATA_REFRESH_PRESERVE_MOUNT_TABS.has(appState.currentTab)) switchTab(appState.currentTab);
}

// 模組載入時要執行的副作用：由頁面 entry 依原本的載入順序呼叫（issue #39）
export function initShellApp() {
  window.addEventListener('beforeunload', function(e) {
    if (!hasPending()) return;
    e.preventDefault();
    e.returnValue = '';
  });
  document.addEventListener('click', function(e) {
    if (!e.target.closest('#avatarDropdown')) closeAvatarMenu();
  });
  document.getElementById('search-input').addEventListener('input', function() {
    clearTimeout(_searchTimer);
    _searchTimer = setTimeout(function() {
      if (appState.currentTab === 'inventory') loadInventoryPage(1);
      else if (appState.currentTab === 'prepared') renderPrepared();
      else if (appState.currentTab === 'stockout') renderStockOuts();
      else if (appState.currentTab === 'stocktake') renderStocktake();
      else if (appState.currentTab === 'kit') renderKits();
    }, 200);
  });
  window.addEventListener('load', function() {
    clearSearchAutofill();
    setTimeout(clearSearchAutofill, 500);
  });
  document.addEventListener('visibilitychange', autoReloadOnFocus);

  // ========== 啟動 ==========
  (async function() {
    var user = await checkAuth();
    if (user) {
      var _p = new URLSearchParams(location.search);
      var _t = _p.get('tab');
      var _s = _p.get('site');
      if (_TABS.indexOf(_t) >= 0) appState.currentTab = _t;
      if (INVENTORY_SITES.indexOf(_s) >= 0) appState.currentSite = _s;
      renderUserMenu(user);
      renderSidebarUser(user);
      applyRoleView(user);
      if (!appState.currentTab) { renderNoAccessiblePage(); return; }
      if (user.password_expired) openExpiryModal();
      var bootTab = appState.currentTab;
      await loadUnits();
      // 等待期間使用者已自行切頁（switchTab 已掛載該頁與範圍）→ 不可再用啟動時的流程覆蓋（例：報價單上傳被重掛成報價單）
      var tabChangedDuringBoot = appState.currentTab !== bootTab;
      updateBreadcrumb(appState.currentTab);
      // site active 同步
      document.querySelectorAll('[data-role="header-site"] button').forEach(function(t){ t.classList.remove('is-active'); });
      var siteEl = document.getElementById('site-' + appState.currentSite);
      if (siteEl) siteEl.classList.add('is-active');
      // sidebar active 同步
      var sbNav = document.getElementById('sb-nav-' + appState.currentTab);
      document.querySelectorAll('[data-role="sidebar-nav-link"]').forEach(function(n){ n.classList.remove('is-active'); });
      if (sbNav) sbNav.classList.add('is-active');
      if (!tabChangedDuringBoot) setPageScope(appState.currentTab);
      loadData();
      // loadData 不重繪保留 mount 的頁面；F5 直接開啟時由 bootstrap 建立一次頁面。
      if (!tabChangedDuringBoot) mountPreservedTabAfterBootstrap();
    } else {
      var content = document.getElementById('content');
      if (content) content.innerHTML = '<div class="empty">⚠️ 無法連線伺服器，請重新整理頁面<br><small>若持續發生請聯絡管理員</small></div>';
    }
  })();
}
