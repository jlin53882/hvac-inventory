// 振佳空調庫存管理系統 - 使用者管理（v11，僅 admin）
// ==================================================
// openUsersModal() 由 auth.js 的 topbar「👥 使用者」按鈕觸發
var usersModalData = [];  // [{id, username, display_name, role, is_active, ...}]

function openUsersModal() {
  if (document.getElementById('usersModal')) return;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay show';  // .show 才會 display:flex
  overlay.id = 'usersModal';
  overlay.innerHTML = `
    <div class="modal" style="max-width:560px">
      <div class="modal-header">
        <h3>👥 使用者管理</h3>
        <button class="modal-close" onclick="closeUsersModal()">✕</button>
      </div>
      <div class="create-row">
        <input type="text" id="newUsername" placeholder="新帳號" class="cr-input">
        <input type="password" id="newPassword" placeholder="密碼(至少4碼)" class="cr-input">
        <input type="text" id="newDisplay" placeholder="顯示名稱" class="cr-input">
        <select id="newRole" class="cr-input">
          <option value="user">User</option>
          <option value="admin">Admin</option>
        </select>
        <button class="btn cr-btn" onclick="createUserFromModal()">＋ 新增</button>
      </div>
      <table class="users-table" style="width:100%; border-collapse:collapse; font-size:13.5px">
        <thead><tr style="color:#8a94a6; font-size:12px; text-align:left">
          <th style="padding:6px">帳號</th><th>顯示名稱</th><th>角色</th><th>狀態</th><th></th>
        </tr></thead>
        <tbody id="usersTableBody"></tbody>
      </table>
    </div>`;
  document.body.appendChild(overlay);
  loadUsersTable();
}

function closeUsersModal() {
  const el = document.getElementById('usersModal');
  if (el) el.remove();
  usersModalData = null;
}

async function loadUsersTable() {
  try {
    const res = await fetch('/api/users');
    if (!res.ok) { toast('⚠️ 載入使用者失敗 ' + res.status); return; }
    const data = await res.json();
    usersModalData = data.users;
    const tb = document.getElementById('usersTableBody');
    tb.innerHTML = data.users.map(u => {
      const me = currentUser && u.id === currentUser.id;
      return `<tr>
        <td style="padding:8px; font-weight:700">${u.username}${me ? ' <small>(我)</small>' : ''}</td>
        <td style="padding:8px">${esc(u.display_name)}</td>
        <td style="padding:8px">${u.role === 'admin' ? '🛡️ 管理員' : '👤 使用者'}</td>
        <td style="padding:8px">${u.is_active ? '✅ 啟用' : '⛔ 停用'}${u.locked_until ? '<br><small style="color:#dc2626">🔒 鎖定至 ' + esc(u.locked_until) + '</small>' : ''}</td>
        <td class="user-actions">
          <button class="btn-ghost" onclick="resetUserPw(${u.id})">🔑 修改密碼</button>
          <button class="btn-ghost" onclick="toggleUserActive(${u.id})">${u.is_active ? '⏸ 帳號停用' : '▶️ 帳號啟用'}</button>
          ${me ? '' : `<button class="btn-ghost danger" onclick="deleteUser(${u.id})">🗑 刪除帳號</button>`}
        </td>
      </tr>`;
    }).join('');
  } catch (e) {
    toast('⚠️ ' + e.message);
  }
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

async function createUserFromModal() {
  const username = document.getElementById('newUsername').value.trim();
  const password = document.getElementById('newPassword').value;
  const display_name = document.getElementById('newDisplay').value.trim();
  const role = document.getElementById('newRole').value;
  if (!username || !password) { toast('⚠️ 請填帳號與密碼'); return; }
  if (password.length < 4) { toast('⚠️ 密碼至少 4 碼'); return; }
  try {
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, display_name, role }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { toast('⚠️ ' + (data.detail || '新增失敗')); return; }
    toast('✅ 已新增 ' + username);
    loadUsersTable();
  } catch (e) { toast('⚠️ ' + e.message); }
}

async function resetUserPw(id) {
  const pw = prompt('輸入新密碼（至少 4 碼）：');
  if (!pw) return;
  if (pw.length < 4) { toast('⚠️ 密碼至少 4 碼'); return; }
  try {
    const res = await fetch(`/api/users/${id}/password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    });
    if (!res.ok) { toast('⚠️ 重設失敗 ' + res.status); return; }
    toast('✅ 密碼已重設');
  } catch (e) { toast('⚠️ ' + e.message); }
}

async function toggleUserActive(id) {
  const u = usersModalData.find(x => x.id === id);
  if (!u) return;
  try {
    const res = await fetch(`/api/users/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: u.is_active ? 0 : 1 }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      toast('⚠️ ' + (d.detail || '操作失敗')); return;
    }
    toast('✅ 已更新狀態');
    loadUsersTable();
  } catch (e) { toast('⚠️ ' + e.message); }
}

async function deleteUser(id) {
  const u = usersModalData.find(x => x.id === id);
  if (!u) return;
  if (!confirm(`確定刪除帳號「${u.username}」？此操作無法復原`)) return;
  try {
    const res = await fetch(`/api/users/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      toast('⚠️ ' + (d.detail || '刪除失敗')); return;
    }
    toast('✅ 已刪除 ' + u.username);
    loadUsersTable();
  } catch (e) { toast('⚠️ ' + e.message); }
}