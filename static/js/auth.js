// 庫存管理系統 - 登入守衛（v11）
// ======================================
// 1) 攔截 window.fetch：任何 API 回 401 → 跳轉登入頁
// 2) 載入時檢查 /api/auth/me：未登入 → 進登入頁；已登入 → topbar 顯示使用者
// 3) 提供登出 / 使用者管理入口

// ---------- 攔截 fetch：401 一律跳登入 ----------
(function () {
  const _origFetch = window.fetch;
  window.fetch = async function (url, opts) {
    const res = await _origFetch(url, opts);
    if (res.status === 401 && !window.__authRedirecting) {
      // 登入請求本身不要跳（login.html 沒有載入本檔，不會走到這）
      window.__authRedirecting = true;
      window.location.href = '/login.html';
    }
    return res;
  };
})();

// ---------- 登入狀態 ----------
var currentUser = null;  // 全域：目前登入者 {id, username, display_name, role}（跨檔共享須用 var）

async function checkAuth() {
  try {
    const res = await fetch('/api/auth/me');
    if (!res.ok) {
      window.location.href = '/login.html';
      return null;
    }
    const data = await res.json();
    currentUser = data.user;  // {id, username, display_name, role}
    return currentUser;
  } catch {
    return null;
  }
}

// 登出
async function logout() {
  try { await fetch('/api/auth/logout', { method: 'POST' }); } catch {}
  window.location.href = '/login.html';
}

// ---------- topbar 使用者選單 ----------
function renderUserMenu(user) {
  const menu = document.getElementById('userMenu');
  if (!menu || !user) return;
  const isAdmin = user.role === 'admin';
  const roleChip = user.role === 'admin' ? ' <span class="admin-badge">管理員</span>'
    : user.role === 'viewer' ? ' <span class="admin-badge" style="background:#6b7280">👀 檢視者</span>'
    : '';
  menu.innerHTML =
    `<span class="user-chip" title="${esc(user.username)}">👤 ${esc(user.display_name || user.username)}` +
    roleChip + `</span>` +
    `<button class="btn-ghost" onclick="openChangePwModal()">🔑<span class="users-text"> 改密碼</span></button>` +
    (isAdmin ? `<button class="btn-ghost" onclick="openUsersModal()">👥<span class="users-text"> 使用者</span></button>` : '') +
    `<button class="btn-ghost" onclick="logout()">🚪<span class="logout-text"> 登出</span></button>`;
  menu.style.display = 'flex';
}

// ---------- 角色 UI 控制（viewer 唯讀模式） ----------
// 前端隱藏 = UX 防呆；真正的防護在後端 require_login 的 method 封鎖（403）。
function applyRoleView(user) {
  if (!user) return;
  const isViewer = user.role === 'viewer';
  const btnAdd = document.getElementById('btn-add');
  const btnExport = document.getElementById('btn-export');
  const navStocktake = document.getElementById('nav-stocktake');
  const reminder = document.getElementById('reminder');
  const saveBar = document.getElementById('save-bar');

  if (isViewer) {
    // 新增按鈕隱藏；匯出保留（家豪已確認 viewer 可匯出）
    if (btnAdd) btnAdd.style.display = 'none';
    // 盤點 tab 隱藏（不能盤點就不顯示）；待領出/已領出保留（家豪已確認可看）
    if (navStocktake) navStocktake.style.display = 'none';
    // 盤點提醒橫幅隱藏
    if (reminder) reminder.style.display = 'none';
    // 儲存列隱藏（數量不可編輯）
    if (saveBar) saveBar.style.display = 'none';
    // 若 viewer 停在隱藏的盤點 tab → 強制切回庫存頁
    if (typeof currentTab !== 'undefined' && currentTab === 'stocktake') {
      switchTab('inventory');
    }
  } else {
    // 非 viewer：確認該顯示的都顯示（避免前次登入殘留 display:none）
    if (btnAdd) btnAdd.style.display = '';
    if (navStocktake) navStocktake.style.display = '';
    if (saveBar) saveBar.style.display = '';
  }
  // 匯出按鈕：admin/user/viewer 全部顯示
  if (btnExport) btnExport.style.display = '';
}