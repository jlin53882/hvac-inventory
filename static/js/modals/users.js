// 庫存管理系統 - 使用者管理（v11，僅 admin）
// ==================================================
// openUsersModal() 由 auth.js 的 topbar「👥 使用者」按鈕觸發
var usersModalData = [];  // [{id, username, display_name, role, is_active, ...}]

// Esc 鍵關閉使用者管理 modal（桌機習慣）
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') closeUsersModal();
});

// 建立並顯示使用者管理 modal（僅 admin；已存在則不重複建立）
function openUsersModal() {
  if (document.getElementById('usersModal')) return;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay show';  // .show 才會 display:flex
  overlay.id = 'usersModal';
  overlay.innerHTML = `
    <div class="modal" style="max-width:560px">
      <div class="modal-header">
        <h3>👥 使用者管理</h3>
        <button class="modal-close" onclick="closeUsersModal()">✕ 關閉</button>
      </div>
      <div class="create-row">
        <input type="text" id="newUsername" placeholder="新帳號" class="cr-input">
        <input type="password" id="newPassword" placeholder="密碼(8碼以上,含大小寫+數字)" class="cr-input">
        <input type="text" id="newDisplay" placeholder="顯示名稱" class="cr-input">
        <select id="newRole" class="cr-input">
          <option value="user">User</option>
          <option value="viewer">檢視者</option>
          <option value="admin">Admin</option>
        </select>
        <button class="btn cr-btn" onclick="createUserFromModal()">＋ 新增</button>
      </div>
      <details class="batch-create" style="margin:10px 0">
        <summary style="cursor:pointer; color:#1890ff; font-size:13.5px; padding:6px 2px">📋 批次新增（表格方式，一列一位使用者）</summary>
        <div style="margin-top:8px; overflow-x:auto">
          <table class="batch-table" style="width:100%; border-collapse:collapse; font-size:13px">
            <thead><tr style="color:#8a94a6; font-size:12px; text-align:left">
              <th style="padding:4px">帳號</th><th>密碼</th><th>顯示名稱</th><th>角色</th><th></th>
            </tr></thead>
            <tbody id="batchTableBody"></tbody>
          </table>
        </div>
        <div style="margin-top:8px; display:flex; gap:8px; flex-wrap:wrap">
          <button class="btn-ghost" onclick="addBatchRow()">＋ 加一列</button>
          <button class="btn cr-btn" onclick="createUsersBatch()">🚀 批次建立</button>
          <span id="batchResult" style="font-size:13px; align-self:center"></span>
        </div>
      </details>
      <table class="users-table" style="width:100%; border-collapse:collapse; font-size:13.5px">
        <thead><tr style="color:#8a94a6; font-size:12px; text-align:left">
          <th style="padding:6px">帳號</th><th>顯示名稱</th><th>角色</th><th>狀態</th><th></th>
        </tr></thead>
        <tbody id="usersTableBody"></tbody>
      </table>
    </div>`;
  document.body.appendChild(overlay);
  // 點 modal 外背景關閉（手機/桌機直覺操作）
  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) closeUsersModal();
  });
  loadUsersTable();
  addBatchRow();  // 預設先給一列空的批次輸入
}

// 批次新增表格加一列空輸入（帳號/密碼/顯示名稱/角色）
function addBatchRow() {
  const tb = document.getElementById('batchTableBody');
  if (!tb) return;
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td style="padding:4px"><input type="text" class="batch-username cr-input" placeholder="帳號" style="min-width:90px"></td>
    <td style="padding:4px"><input type="password" class="batch-password cr-input" placeholder="密碼" style="min-width:90px"></td>
    <td style="padding:4px"><input type="text" class="batch-display cr-input" placeholder="顯示名稱" style="min-width:100px"></td>
    <td style="padding:4px"><select class="batch-role cr-input">
      <option value="user">User</option>
      <option value="viewer">檢視者</option>
      <option value="admin">Admin</option>
    </select></td>
    <td style="padding:4px"><button class="btn-ghost danger" onclick="this.closest('tr').remove()">✕</button></td>`;
  tb.appendChild(tr);
}

// 批次建立使用者（POST /api/users/batch），逐列標記 ✅/❌
async function createUsersBatch() {
  const rows = Array.from(document.querySelectorAll('#batchTableBody tr'));
  const users = [];
  rows.forEach((tr, i) => {
    const username = tr.querySelector('.batch-username').value.trim();
    const password = tr.querySelector('.batch-password').value;
    const display_name = tr.querySelector('.batch-display').value.trim();
    const role = tr.querySelector('.batch-role').value;
    if (!username && !password && !display_name) return;  // 整列空白跳過
    users.push({ username, password, display_name, role, _row: i + 1 });
  });
  if (!users.length) { toast('⚠️ 請至少填一列'); return; }
  const resultEl = document.getElementById('batchResult');
  resultEl.textContent = '⏳ 建立中…';
  try {
    const res = await fetch('/api/users/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ users: users.map(({ _row, ...u }) => u) }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { toast('⚠️ ' + (data.detail || '批次建立失敗')); resultEl.textContent = ''; return; }
    // 逐列顯示 ✔/✘
    rows.forEach((tr, i) => {
      if (i >= data.results.length) return;
      const r = data.results[i];
      const mark = r.status === 'ok' ? '✅' : '❌';
      let markEl = tr.querySelector('.batch-mark');
      if (!markEl) {
        markEl = document.createElement('td');
        markEl.className = 'batch-mark';
        tr.appendChild(markEl);
      }
      markEl.textContent = r.status === 'ok' ? '✅' : '❌ ' + r.detail;
      markEl.style.color = r.status === 'ok' ? '#16a34a' : '#dc2626';
      markEl.style.fontSize = '12px';
    });
    resultEl.textContent = `✔ 建 ${data.created} 筆 / ✘ 失敗 ${data.failed} 筆`;
    resultEl.style.color = data.failed === 0 ? '#16a34a' : '#dc2626';
    toast(data.failed === 0 ? `✅ 已建立 ${data.created} 個帳號` : `⚠️ 建 ${data.created} 筆，失敗 ${data.failed} 筆（請看表格標記）`);
    loadUsersTable();
  } catch (e) { toast('⚠️ ' + e.message); resultEl.textContent = ''; }
}

// 關閉並移除使用者管理 modal
function closeUsersModal() {
  const el = document.getElementById('usersModal');
  if (el) el.remove();
  usersModalData = null;
}

// 載入使用者清單並渲染表格（角色 badge / 鎖定狀態 / 操作按鈕）
async function loadUsersTable() {
  try {
    const res = await fetch('/api/users');
    if (!res.ok) { toast('⚠️ 載入使用者失敗 ' + res.status); return; }
    const data = await res.json();
    usersModalData = data.users;
    const tb = document.getElementById('usersTableBody');
    tb.innerHTML = data.users.map(u => {
      const me = currentUser && u.id === currentUser.id;
      const roleLabel = ROLE_LABELS[u.role] || (u.role === 'admin' ? '🛡️ 管理員' : u.role === 'viewer' ? '👀 檢視者' : '👤 使用者');
      const roleClass = u.role === 'admin' ? 'role-badge-admin' : u.role === 'viewer' ? 'role-badge-viewer' : 'role-badge-user';
      return `<tr>
        <td style="padding:8px; font-weight:700">${esc(u.username)}${me ? ' <small>(我)</small>' : ''}</td>
        <td style="padding:8px">${esc(u.display_name)}</td>
        <td style="padding:8px"><span class="role-badge ${roleClass}">${roleLabel}</span><br><button class="perm-btn" onclick="toggleUserPerms(${u.id}, this)">📋 權限</button></td>
        <td style="padding:8px">${u.is_active ? '✅ 啟用' : '⛔ 停用'}${u.locked_until ? '<br><small style="color:#dc2626">🔒 鎖定至 ' + esc(u.locked_until) + '</small>' : ''}</td>
        <td class="user-actions">
          <button class="btn-ghost" onclick="openResetPwModal(${u.id})">🔑 修改密碼</button>
          <button class="btn-ghost" onclick="toggleUserActive(${u.id})">${u.is_active ? '⏸ 帳號停用' : '▶️ 帳號啟用'}</button>
          ${me ? '' : `<button class="btn-ghost danger" onclick="deleteUser(${u.id})">🗑 刪除帳號</button>`}
        </td>
      </tr>`;
    }).join('');
  } catch (e) {
    toast('⚠️ ' + e.message);
  }
}

// 展開/收合使用者的權限一覽（permissions.js 資料來源）
function toggleUserPerms(uid, btn) {
  const tr = btn.closest('tr');
  const existing = tr.nextElementSibling;
  if (existing && existing.classList.contains('perm-detail-row')) {
    existing.remove();
    btn.textContent = '📋 權限';
    return;
  }
  const u = usersModalData.find(x => x.id === uid);
  if (!u) return;
  const perms = getRolePerms(u.role);
  const detailRow = document.createElement('tr');
  detailRow.className = 'perm-detail-row';
  detailRow.innerHTML = `<td colspan="5" style="padding:6px 8px 10px 8px; background:#f8fafc; border-radius:8px">
    <div style="font-size:12px; color:#64748b; margin-bottom:4px">🔐 <b>${ROLE_LABELS[u.role] || u.role}</b> 權限一覽</div>
    <div class="perm-grid">${perms.map(p =>
      `<div class="${p.allowed ? 'perm-ok' : 'perm-no'}">${p.allowed ? '✅' : '🚫'} ${esc(p.label)}</div>`
    ).join('')}</div>
  </td>`;
  tr.after(detailRow);
  btn.textContent = '📋 收起';
}

// HTML 跳脫統一用 utils.js 的 esc()（2026-08-11 整併：含單引號 escape 已併入 utils.js）

// B2：密碼 policy 前端檢查（與後端 _check_pw 一致）— 至少 8 碼 + 大寫 + 小寫 + 數字
function pwPolicyMsg(pw) {
  if (pw.length < 8) return '密碼至少 8 碼';
  if (!/[A-Z]/.test(pw)) return '密碼需包含至少一個大寫字母';
  if (!/[a-z]/.test(pw)) return '密碼需包含至少一個小寫字母';
  if (!/\d/.test(pw)) return '密碼需包含至少一個數字';
  return '';
}

// 從 modal 表單新增單一使用者（先過密碼 policy 檢查）
async function createUserFromModal() {
  const username = document.getElementById('newUsername').value.trim();
  const password = document.getElementById('newPassword').value;
  const display_name = document.getElementById('newDisplay').value.trim();
  const role = document.getElementById('newRole').value;
  if (!username || !password) { toast('⚠️ 請填帳號與密碼'); return; }
  const pwErr = pwPolicyMsg(password);
  if (pwErr) { toast('⚠️ ' + pwErr); return; }
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

// ========== 重設指定帳號密碼（v11.2：改用與個人改密碼相同的變體 B modal，不再用 prompt） ==========
let resetPwUserId = null;

function openResetPwModal(id) {
  resetPwUserId = id;
  document.getElementById('rpw-new').value = '';
  document.getElementById('rpw-confirm').value = '';
  pwStrengthCheck('rpw-new');  // 重設打勾狀態
  document.getElementById('rpw-mismatch').style.display = 'none';
  openModal('resetpw-modal');
  document.getElementById('rpw-new').focus();
}

async function submitResetPw() {
  const pw = document.getElementById('rpw-new').value;
  const confirmPw = document.getElementById('rpw-confirm').value;
  const pwErr = pwPolicyMsg(pw);
  if (pwErr) { toast('⚠️ ' + pwErr); return; }
  if (pw !== confirmPw) { toast('⚠️ 兩次輸入的密碼不一致'); return; }
  try {
    const res = await fetch(`/api/users/${resetPwUserId}/password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      toast('⚠️ ' + (d.detail || '重設失敗')); return;
    }
    closeModalForce('resetpw-modal');
    toast('✅ 密碼已重設');
    loadUsersTable();
  } catch (e) { toast('⚠️ ' + e.message); }
}

// 啟用/停用指定帳號
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

// 刪除指定帳號（含確認對話框）
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