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
  document.querySelectorAll('.h-site button').forEach(function(t){ t.classList.remove('on'); });
  var el = document.getElementById('site-' + site);
  if (el) el.classList.add('on');
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
  document.getElementById('sbOverlay').classList.add('open');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('mob-open');
  document.getElementById('sbOverlay').classList.remove('open');
}

function toggleMoreMenu() {
  document.getElementById('moreMenu').classList.toggle('open');
}
function closeMoreMenu() {
  document.getElementById('moreMenu').classList.remove('open');
}
document.addEventListener('click', function(e) {
  if (!e.target.closest('#moreMenu') && !e.target.closest('#nav-more')) closeMoreMenu();
});

// 通知計數
function updateNotifCount() {
  var items = document.querySelectorAll('#notif-list .ni');
  var cnt = document.querySelector('.notif .cnt');
  if (cnt) cnt.textContent = items.length;
}

// 動態生成通知（缺貨 / 低庫存 / 盤點提醒）
function updateNotifications() {
  var html = '';
  // 缺貨警示（qty <= 0，排除整組）
  var zeroItems = ALL_ITEMS.filter(function(i) { return !i.is_kit && (i.qty || 0) <= 0; });
  zeroItems.forEach(function(i) {
    html += '<div class="ni" data-notif><span class="dot-r"></span>缺貨：' + esc(i.name) + '</div>';
  });
  // 低庫存警示（low_stock > 0 且 0 < qty <= low_stock，排除整組與已缺貨）
  var lowItems = ALL_ITEMS.filter(function(i) { return !i.is_kit && i.low_stock > 0 && (i.qty || 0) > 0 && i.qty <= i.low_stock; });
  lowItems.forEach(function(i) {
    var qty = i.qty || 0;
    var unit = i.unit || '';
    html += '<div class="ni" data-notif><span class="dot-w"></span>低庫存警示：' + esc(i.name) + ' 僅剩 ' + qty + ' ' + esc(unit) + '</div>';
  });
  // 盤點提醒（25號後 + 本月未盤點）
  var now = new Date();
  var day = now.getDate();
  var currentMonth = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0');
  var lastStocktakeMonth = localStorage.getItem('lastStocktakeMonth');
  if (day >= 25 && lastStocktakeMonth !== currentMonth) {
    var daysOverdue = day - 24;
    html += '<div class="ni" data-notif><span class="dot-r"></span>盤點已逾期 ' + daysOverdue + ' 天</div>';
  }
  document.getElementById('notif-list').innerHTML = html;
  updateNotifCount();
}
setTimeout(function() { updateNotifications(); }, 500);

// 通知面板
function toggleNotif() {
  document.getElementById('notifPanel').classList.toggle('open');
}
document.addEventListener('click', function(e) {
  if (!e.target.closest('.notif') && !e.target.closest('.notif-panel')) {
    var p = document.getElementById('notifPanel');
    if (p) p.classList.remove('open');
  }
});

// Drawer（統一操作容器）
var _drawerCurrentType = '';
function openDrawer(type, data) {
  _drawerCurrentType = type;
  var overlay = document.getElementById('drawerOverlay');
  var drawer = document.getElementById('drawer');
  var title = document.getElementById('drawerTitle');
  var body = document.getElementById('drawerBody');
  var footer = document.getElementById('drawerFooter');
  if (!overlay || !drawer) return;
  // 標題
  var titles = {add:'➕ 新增品項', edit:'✏️ 編輯品項', stockout:'📤 領出', prepare:'📤 待領出', kit:'🔧 整組'};
  title.textContent = titles[type] || type;
  // 內容由各 modal JS 動態填入
  body.innerHTML = '';
  footer.innerHTML = '';
  // 觸發對應的 open 函式（保留原有 fetch 邏輯）
  if (type === 'add' && typeof openAddModal === 'function') openAddModal();
  else if (type === 'edit' && typeof openEditModal === 'function') openEditModal(data);
  else if (type === 'stockout' && typeof openOutModal === 'function') openOutModal(data);
  else if (type === 'prepare' && typeof openPrepareModal === 'function') openPrepareModal(data);
  else if (type === 'kit' && typeof openKitModal === 'function') openKitModal(data);
  overlay.classList.add('open');
  drawer.classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeDrawer() {
  var overlay = document.getElementById('drawerOverlay');
  var drawer = document.getElementById('drawer');
  if (overlay) overlay.classList.remove('open');
  if (drawer) drawer.classList.remove('open');
  document.body.style.overflow = '';
}

// 頭像下拉選單
function toggleAvatarMenu() {
  document.getElementById('avatarMenu').classList.toggle('open');
}
function closeAvatarMenu() {
  var m = document.getElementById('avatarMenu');
  if (m) m.classList.remove('open');
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
var _TAB_LABEL = { calendar:'行事曆', inventory:'單一庫存', prepared:'待領出', stockout:'已領出', stocktake:'盤點', kit:'整組庫存' };
var _TAB_ICON  = { calendar:'📅', inventory:'📦', prepared:'📤', stockout:'🚚', stocktake:'📋', kit:'🔧' };

function updateBreadcrumb(tab) {
  var el = document.getElementById('breadcrumb');
  if (el) el.innerHTML = (_TAB_ICON[tab]||'📦') + ' <b>' + (_TAB_LABEL[tab]||tab) + '</b>';
}

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.nav-item').forEach(function(n){ n.classList.remove('active'); });
  document.querySelectorAll('.sb-nav-link').forEach(function(n){ n.classList.remove('active'); });
  var nav = document.getElementById('nav-' + tab);
  if (nav) nav.classList.add('active');
  var sbNav = document.getElementById('sb-nav-' + tab);
  if (sbNav) sbNav.classList.add('active');
  var moreBtn = document.getElementById('nav-more');
  if (moreBtn) moreBtn.classList.toggle('active', tab === 'kit');
  updateBreadcrumb(tab);
  closeSidebar();
  closeMoreMenu();

  // 行事曆頁不需要搜尋框、辦公室/倉庫分片與廠牌 tab（家豪 2026-08-12 指定）
  var isCal = tab === 'calendar';
  var isInventory = tab === 'inventory';
  var sb = document.querySelector('.h-search');
  var st = document.querySelector('.h-site');
  var fp = document.getElementById('filter-panel');
  if (sb) sb.style.display = isCal ? 'none' : '';
  if (st) st.style.display = isCal ? 'none' : '';
  if (fp) fp.style.display = isInventory ? '' : 'none';
  // 批款改位置價限單一庫存別離時自動退出批款模式伦隱藨 batch-bar\uff08避免跨頁殘留\uff09
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
  syncViewUrl();
}

// 檢查今天日期，每月 25 號（含）後顯示「月底記得盤點」提醒橫幅
function checkReminder() {
  var now = new Date();
  var day = now.getDate();
  var el = document.getElementById('reminder');
  var currentMonth = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0');
  var lastStocktakeMonth = localStorage.getItem('lastStocktakeMonth');
  if (day >= 25 && lastStocktakeMonth !== currentMonth) {
    el.style.display = 'flex';
    document.getElementById('today-str').textContent = (now.getMonth()+1) + '月' + day + '日';
  } else {
    el.style.display = 'none';
  }
}

var _searchTimer;
document.getElementById('search-input').addEventListener('input', function() {
  clearTimeout(_searchTimer);
  _searchTimer = setTimeout(function() {
    if (currentTab === 'inventory') renderInventory();
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
var _TABS = ['inventory', 'prepared', 'stockout', 'stocktake', 'kit', 'calendar'];
var _SITES = ['office', 'warehouse'];

var _focusReloadTimer = null;
function autoReloadOnFocus() {
  if (hasPending()) return;
  if (document.querySelector('.modal-overlay.show')) return;
  if (document.visibilityState !== 'visible') return;
  if (_focusReloadTimer) return;
  _focusReloadTimer = setTimeout(function() { _focusReloadTimer = null; loadData(); }, 300);
}
document.addEventListener('visibilitychange', autoReloadOnFocus);
window.addEventListener('focus', autoReloadOnFocus);

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
    var _p = new URLSearchParams(location.search);
    var _t = _p.get('tab');
    var _s = _p.get('site');
    if (_TABS.indexOf(_t) >= 0) currentTab = _t;
    if (_SITES.indexOf(_s) >= 0) currentSite = _s;
    renderUserMenu(user);
    renderSidebarUser(user);
    applyRoleView(user);
    if (user.password_expired) openExpiryModal();
    await loadUnits();
    updateBreadcrumb(currentTab);
    // site active 同步
    document.querySelectorAll('.h-site button').forEach(function(t){ t.classList.remove('on'); });
    var siteEl = document.getElementById('site-' + currentSite);
    if (siteEl) siteEl.classList.add('on');
    // sidebar active 同步
    var sbNav = document.getElementById('sb-nav-' + currentTab);
    if (sbNav) sbNav.classList.add('active');
    loadData();
  } else {
    var content = document.getElementById('content');
    if (content) content.innerHTML = '<div class="empty">⚠️ 無法連線伺服器，請重新整理頁面<br><small>若持續發生請聯絡管理員</small></div>';
  }
})();
