// 振佳空調庫存管理系統 - 登入守衛（v11）
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
  menu.innerHTML =
    `<span class="user-chip" title="${user.username}">👤 ${user.display_name || user.username}` +
    (isAdmin ? ' <span class="admin-badge">管理員</span>' : '') + `</span>` +
    (isAdmin ? `<button class="btn-ghost" onclick="openUsersModal()">👥 使用者</button>` : '') +
    `<button class="btn-ghost" onclick="logout()">🚪 登出</button>`;
  menu.style.display = 'flex';
}