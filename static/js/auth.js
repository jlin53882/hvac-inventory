// 庫存管理系統 - 登入守衛（v11 → Shell v2 2026-09-06）
// =====================================
// 1) 攔截 window.fetch：任何 API 回 401 → 跳轉登入頁
// 2) 載入時檢查 /api/auth/me：未登入 → 進登入頁；已登入 → 頭像下拉選單顯示
// 3) 提供登出 / 使用者管理入口

// ---------- 攔截 fetch：401 一律跳登入 ----------
(function () {
  var _origFetch = window.fetch;
  window.fetch = async function (url, opts) {
    var res = await _origFetch(url, opts);
    if (res.status === 401 && !window.__authRedirecting) {
      var hasUnsaved = typeof pending !== 'undefined' && Object.keys(pending).length > 0;
      if (hasUnsaved) alert('⚠️ 登入已過期，部分調整可能未儲存。請重新登入。');
      window.__authRedirecting = true;
      window.location.href = '/login.html';
    }
    return res;
  };
})();

// ---------- 登入狀態 ----------
var currentUser = null;

async function checkAuth() {
  try {
    var res = await fetch('/api/auth/me');
    if (!res.ok) {
      window.location.href = '/login.html';
      return null;
    }
    var data = await res.json();
    currentUser = data.user;
    return currentUser;
  } catch (e) {
    return null;
  }
}

// 登出
async function logout() {
  try { await fetch('/api/auth/logout', { method: 'POST' }); } catch (e) {}
  try {
    Object.keys(localStorage).filter(function(k){ return k.indexOf('hvac_collapsed_locs_') === 0; })
      .forEach(function(k){ localStorage.removeItem(k); });
  } catch (e) {}
  window.location.href = '/login.html';
}

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

// ---------- 角色 UI 控制（RBAC 2026-08-13） ----------
function applyRoleView(user) {
  if (!user) return;
  var perms = user.permissions || {};
  var canStocktake = !!perms['stocktake'];
  var canViewStocktake = canStocktake || !!perms['view'];
  var canAdjust = !!perms['stock-mgmt'];
  var sbNavStocktake = document.getElementById('sb-nav-stocktake');
  var sbNavWorkProgress = document.getElementById('sb-nav-work-progress');
  var saveBar = document.getElementById('save-bar');


  if (sbNavStocktake) sbNavStocktake.style.display = canViewStocktake ? '' : 'none';
  if (sbNavWorkProgress) sbNavWorkProgress.style.display = perms['work-progress-view'] ? '' : 'none';
  if (typeof checkReminder === 'function') checkReminder();
  if (saveBar) saveBar.style.display = canAdjust ? '' : 'none';
  if (!perms['work-progress-view'] && typeof currentTab !== 'undefined' && currentTab === 'work-progress') {
    switchTab('calendar');
  }
  if (!canViewStocktake && typeof currentTab !== 'undefined' && currentTab === 'stocktake') {
    switchTab('inventory');
  }
}
