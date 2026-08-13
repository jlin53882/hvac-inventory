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
      // M17：saveAll 迴圈中 session 過期 = 存一半 → 跳轉前先提示
      const hasUnsaved = typeof pending !== 'undefined' && Object.keys(pending).length > 0;
      if (hasUnsaved) alert('⚠️ 登入已過期，部分調整可能未儲存。請重新登入。');
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
  // 清除位置折疊狀態（登出後還原預設展開）
  try {
    Object.keys(localStorage).filter(k => k.indexOf('hvac_collapsed_locs_') === 0)
      .forEach(k => localStorage.removeItem(k));
  } catch (e) {}
  window.location.href = '/login.html';
}

// ---------- topbar 使用者選單 ----------
function renderUserMenu(user) {
  const menu = document.getElementById('userMenu');
  if (!menu || !user) return;
  // 2026-08-13 Sarah：user 角色不要功能選單 bottom sheet，topbar 直接顯示登出按鈕
  if (user.role === 'user') {
    // 2026-08-13 Sarah：登出要有文字（手機版 .users-text 會隱藏 → 用獨立 span）
    menu.innerHTML =
      `<span class="user-chip" title="${esc(user.username)}">👤 ${esc(user.display_name || user.username)}</span>` +
      `<button class="btn-ghost btn-logout-direct" onclick="logout()">🚪<span class="logout-direct-text"> 登出</span></button>`;
    menu.style.display = 'flex';
    return;
  }
  const isAdmin = user.role === 'admin';
  const roleChip = user.role === 'admin' ? ' <span class="admin-badge">管理員</span>'
    : user.role === 'viewer' ? ' <span class="admin-badge" style="background:#6b7280">👀 檢視者</span>'
    : '';  // tech 不顯示 badge（2026-08-13 Sarah：不要列出工程師）
  // 2026-08-13 Sarah：user/tech 角色不可自行改密碼（topbar 不顯示；由 admin 重設）
  const canChangePw = user.role !== 'user' && user.role !== 'tech';
  menu.innerHTML =
    `<span class="user-chip" title="${esc(user.username)}">👤 ${esc(user.display_name || user.username)}` +
    roleChip + `</span>` +
    (canChangePw ? `<button class="btn-ghost" onclick="openChangePwModal()">🔑<span class="users-text"> 改密碼</span></button>` : '') +
    (isAdmin ? `<button class="btn-ghost" onclick="openUsersModal()">👥<span class="users-text"> 使用者</span></button>` : '') +
    // 2026-08-13 Sarah：登出直接顯示在 topbar（btn-logout-direct 手機版不隱藏），☰ 選單不放登出
    `<button class="btn-ghost btn-logout-direct" onclick="logout()">🚪<span class="logout-direct-text"> 登出</span></button>`;
  menu.style.display = 'flex';
}

// ---------- 角色 UI 控制（viewer 唯讀模式） ----------
// 前端隱藏 = UX 防呆；真正的防護在後端 require_login 的 method 封鎖（403）。
function applyRoleView(user) {
  if (!user) return;
  const isViewer = user.role === 'viewer' || user.role === 'tech';
  // 2026-08-13 Sarah：新增按鈕已移到庫存清單頂部（inventory.js renderInventory 內，viewer 由 isViewer 判斷隱藏）
  const navStocktake = document.getElementById('nav-stocktake');
  const reminder = document.getElementById('reminder');
  const saveBar = document.getElementById('save-bar');

  if (isViewer) {
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
    if (navStocktake) navStocktake.style.display = '';
    if (saveBar) saveBar.style.display = '';
  }
  // 匯出按鈕已移到庫存清單頂部（inventory.js renderInventory 內，2026-08-13 Sarah）
}