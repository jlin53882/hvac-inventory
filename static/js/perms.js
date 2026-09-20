// perms.js — 帳號與權限頁（RBAC 2026-08-13）
// 桌面：左帳號列表 + 右側 Tab（3-B）；手機：chip 橫滑列（M1）
// 安全守則：使用者可控資料內插一律 esc()/jsStr()
(() => {
  'use strict';

  const ROLE_LABELS = { admin: '🛡️ 管理員', user: '👤 使用者', tech: '🔧 工程師', viewer: '👀 檢視者' };
  const GROUP_LABELS = {
    view: '📋 瀏覽與匯出',
    stock: '📦 庫存管理',
    calendar: '📅 行事曆與派工',
    system: '⚙️ 系統設定',
  };
  const PAGE_LABELS = {
    calendar: '📅 行事曆',
    'signed-reports': '🗂 每日簽名日報表',
    quotation: '🧾 報價單',
    'petty-cash': '🪙 零用金月報',
    inventory: '📦 單一庫存',
    prepared: '📤 待領出',
    stockout: '🚚 已領出',
    stocktake: '📋 盤點',
    kit: '🔧 整組庫存',
    perms: '👥 帳號與權限',
    settings: '⚙️ 系統設定',
    'change-password': '🔑 修改密碼',
  };

  let permUsers = [];       // 全部帳號
  let me = null;            // 當前登入者
  let curUid = null;        // 選中帳號 id
  let permChanges = {};     // 未儲存開關變更 {key: 0|1}
  let pageChanges = {};     // 未儲存頁面顯示變更 {page_key: 0|1}
  let addMode = 'single';
  let permissionDetail = null;
  let permissionView = 'features';
  let permissionPage = 1;
  let permissionSearch = '';
  let permissionModule = 'all';
  const PERMISSIONS_PAGE_SIZE = 10;

  // ---------- fetch 封裝 ----------
  async function apiGet(url) {
    const r = await fetch(url);
    if (r.status === 401) { location.href = '/login.html'; throw new Error('未登入'); }
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      throw new Error(body.detail || r.statusText);
    }
    return r.json();
  }

  async function apiSend(url, method, body) {
    const r = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.status === 401) { location.href = '/login.html'; throw new Error('未登入'); }
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.detail || r.statusText);
    }
    return r.json();
  }

  // ---------- 初始化 ----------
  async function initPermPage() {
    try {
      const meRes = await apiGet('/api/auth/me');
      me = meRes.user;
      if (!me.is_admin_role || !(me.permissions || {})['user-mgmt']
          || (Array.isArray(me.visible_pages) && !me.visible_pages.includes('perms'))) {
        location.href = '/';
        return;
      }
      const users = await apiGet('/api/users');
      permUsers = users.users;
      renderUserList();
      renderChips();
      window.permSelect(permUsers[0].id);  // 2026-08-14 修：舊名 selectUser 未定義 → 自動選中失敗
    } catch (e) {
      toast(e.message || '載入失敗', 'error');
    }
  }

  // ---------- 列表渲染 ----------
  function renderUserList() {
    const el = document.getElementById('userList');
    el.innerHTML = permUsers.map(u => {
      const isMe = me.id === u.id;
      const cls = u.is_active ? 'on' : 'off';
      const badge = ROLE_LABELS[u.role] || u.role;
      return `<div class="user-list-item ${u.id === curUid ? 'active' : ''}" data-uid="${u.id}" onclick="window.permSelect(${u.id})">
        <div class="user-avatar ${cls}">${esc(u.display_name ? u.display_name.charAt(0) : '?')}</div>
        <div class="user-meta">
          <div class="user-name">${esc(u.display_name)}${isMe ? ' <span class="me-tag">（自己）</span>' : ''}</div>
          <div class="user-sub">${badge} · @${esc(u.username)}</div>
        </div>
        <div class="status-dot ${cls}" title="${u.is_active ? '啟用中' : '已停用'}"></div>
      </div>`;
    }).join('');
  }

  function renderChips() {
    const el = document.getElementById('chipBar');
    el.innerHTML = permUsers.map(u => {
      const isMe = me.id === u.id;
      return `<button class="chip ${u.id === curUid ? 'active' : ''} ${u.is_active ? '' : 'off'}" onclick="window.permSelect(${u.id})">
        <span class="status-dot ${u.is_active ? 'on' : 'off'}"></span>${esc(u.display_name)}${isMe ? '（自己）' : ''}
      </button>`;
    }).join('');
  }

  // ---------- 選中帳號 ----------
  window.permSelect = async function permSelect(uid) {
    if (uid === curUid) return;
    curUid = uid;
    permChanges = {};
    pageChanges = {};
    renderUserList();
    renderChips();
    renderPanelHead();
    await loadUserDetail();
  };

  function renderPanelHead() {
    const u = permUsers.find(x => x.id === curUid);
    if (!u) return;
    const isMe = me.id === u.id;
    document.getElementById('panelHead').innerHTML = `
      <div class="user-avatar ${u.is_active ? '' : 'off'}">${esc(u.display_name.charAt(0) || '?')}</div>
      <div>
        <div class="panel-title">${esc(u.display_name)}${isMe ? ' <span style="font-size:12px;color:#999">（自己）</span>' : ''}</div>
        <div class="panel-sub">${ROLE_LABELS[u.role] || u.role} · @${esc(u.username)} · ${u.is_active ? '✅ 啟用中' : '⏸ 已停用'}</div>
      </div>`;
  }

  async function loadUserDetail() {
    try {
      const detail = await apiGet(`/api/users/${curUid}/permissions`);
      renderPerms(detail);
      renderAccount(detail);
    } catch (e) {
      toast(e.message || '載入權限失敗', 'error');
    }
  }

  // ---------- 權限設定 tab ----------
  function renderPerms(detail) {
    permissionDetail = detail;
    permissionPage = 1;
    permissionSearch = '';
    permissionModule = 'all';
    permissionView = 'features';
    renderPermissionShell();
  }

  function renderPermissionShell() {
    const detail = permissionDetail;
    if (!detail) return;
    const el = document.getElementById('tab-perms');
    const isMe = me.id === curUid;
    const featureActive = permissionView === 'features' ? 'active' : '';
    const pageActive = permissionView === 'pages' ? 'active' : '';
    let html = isMe
      ? '<div class="warn-box">⚠️ 不能修改自己的權限（系統保護）——你的權限由另一位管理員管理。</div>'
      : '';
    html += `<div class="perm-subtabs" role="tablist">
      <button class="perm-subtab ${esc(featureActive)}" onclick="window.permSubTab('features')">🔐 功能權限</button>
      <button class="perm-subtab ${esc(pageActive)}" onclick="window.permSubTab('pages')">🖥 頁面顯示</button>
    </div><div id="permission-view"><div id="permission-toolbar"></div><div id="permission-results"></div></div>`;
    const pendingCount = Object.keys(permChanges).length + Object.keys(pageChanges).length;
    html += `<div class="save-bar">
      <div class="save-bar-inner">
        <span class="save-hint" id="saveHint">${pendingCount ? `有 ${pendingCount} 項未儲存變更` : '變更立即生效，不需重新登入'}</span>
        <div class="save-btns">
          <button class="btn-ghost" onclick="window.openResetPermModal()" ${isMe ? 'disabled' : ''}>↩ 重設為角色預設</button>
          <button class="btn-primary" onclick="window.permSave()" ${isMe ? 'disabled' : ''}>💾 儲存變更</button>
        </div>
      </div>
    </div>`;
    el.innerHTML = html;
    renderPermissionToolbar();
    renderPermissionView();
    if (pendingCount) document.getElementById('saveHint')?.classList.add('changed');
  }

  function renderPermissionToolbar() {
    const toolbar = document.getElementById('permission-toolbar');
    if (!toolbar || !permissionDetail || permissionView !== 'features') return;
    const permissions = permissionDetail.permissions || [];
    const modules = [...new Set(permissions.map(p => p.module))];
    let html = `<label class="perm-search-label" for="permission-search">搜尋權限名稱或 key</label>
      <input id="permission-search" class="perm-search" type="search" value="${esc(permissionSearch)}" placeholder="例如：日報、上傳、delete-all" oninput="window.permSearch(this.value)">
      <div class="perm-module-filter" role="group" aria-label="權限分類">
        <button class="perm-filter ${esc(permissionModule === 'all' ? 'active' : '')}" data-module="all" onclick="window.permFilter('all')">全部</button>
        ${modules.map(mod => `<button class="perm-filter ${esc(permissionModule === mod ? 'active' : '')}" data-module="${esc(mod)}" onclick="window.permFilter('${jsStr(mod)}')">${esc(GROUP_LABELS[mod] || mod)}</button>`).join('')}
      </div>`;
    toolbar.innerHTML = html;
  }

  function updatePermissionFilterState() {
    document.querySelectorAll?.('#permission-toolbar .perm-filter').forEach(button => {
      button.classList.toggle('active', button.dataset.module === permissionModule);
    });
  }

  function renderPermissionView() {
    const viewHost = document.getElementById('permission-view');
    if (!viewHost || !permissionDetail) return;
    if (permissionView === 'pages') {
      renderPageVisibilityView(viewHost);
      return;
    }
    const host = document.getElementById('permission-results');
    if (!host) return;
    const permissions = permissionDetail.permissions || [];
    const isMe = me.id === curUid;
    const query = permissionSearch.trim().toLowerCase();
    const filtered = permissions.filter(p => {
      const matchesModule = permissionModule === 'all' || p.module === permissionModule;
      const haystack = `${p.label} ${p.key}`.toLowerCase();
      return matchesModule && (!query || haystack.includes(query));
    });
    const pageCount = Math.max(1, Math.ceil(filtered.length / PERMISSIONS_PAGE_SIZE));
    permissionPage = Math.min(Math.max(1, permissionPage), pageCount);
    const start = (permissionPage - 1) * PERMISSIONS_PAGE_SIZE;
    const visible = filtered.slice(start, start + PERMISSIONS_PAGE_SIZE);
    let html = '';
    if (!visible.length) {
      html += '<div class="perm-empty">沒有符合條件的權限</div>';
    } else {
      html += '<div class="perm-list">';
      for (const p of visible) {
        const locked = p.source === 'locked';
        const hasPending = Object.prototype.hasOwnProperty.call(permChanges, p.key);
        let srcLabel;
        let srcCls;
        if (locked) {
          srcLabel = '🔒 鎖定';
          srcCls = 'locked';
        } else if (hasPending) {
          srcLabel = '✏️ 自訂';
          srcCls = 'override';
        } else if (p.source === 'override') {
          srcLabel = '✏️ 自訂';
          srcCls = 'override';
        } else {
          srcLabel = '✓ 跟隨角色';
          srcCls = p.source;
        }
        const checkedValue = hasPending ? permChanges[p.key] : p.allowed;
        const checked = checkedValue ? 'checked' : '';
        const disabled = locked || isMe;
        html += `<div class="perm-row ${locked ? 'locked' : ''}">
          <div class="perm-label">${esc(p.label)}<small>${esc(p.key)}<span class="perm-src ${esc(srcCls)}">${srcLabel}</span></small></div>
          <label class="switch">
            <input type="checkbox" data-key="${esc(p.key)}" ${checked} ${disabled ? 'disabled' : ''} onchange="window.permToggle('${jsStr(p.key)}', this.checked)">
            <span class="slider"></span>
          </label>
        </div>`;
      }
      html += '</div>';
    }
    const from = filtered.length ? start + 1 : 0;
    const to = Math.min(start + PERMISSIONS_PAGE_SIZE, filtered.length);
    html += `<div class="perm-pagination">
      <span>顯示 ${esc(from)}–${esc(to)} / 共 ${esc(filtered.length)} 項</span>
      <div class="perm-page-buttons">
        <button class="perm-page-btn" onclick="window.permPage(-1)" ${permissionPage <= 1 ? 'disabled' : ''}>‹ 上一頁</button>
        <span>第 ${esc(permissionPage)} / ${esc(pageCount)} 頁</span>
        <button class="perm-page-btn" onclick="window.permPage(1)" ${permissionPage >= pageCount ? 'disabled' : ''}>下一頁 ›</button>
      </div>
    </div>`;
    host.innerHTML = html;
    updatePermissionFilterState();
  }

  function renderPageVisibilityView(host) {
    const pageInfo = permissionDetail.page_visibility || { all_pages: [], visible_pages: [] };
    const visiblePages = pageInfo.visible_pages || [];
    const isMe = me.id === curUid;
    let html = '<div class="perm-group page-visibility-group"><div class="perm-group-title">🖥 頁面顯示（每頁獨立設定）</div><div class="perm-grid">';
    for (const key of pageInfo.all_pages || []) {
      const checkedValue = Object.prototype.hasOwnProperty.call(pageChanges, key) ? pageChanges[key] : visiblePages.includes(key);
      html += `<div class="perm-row">
        <div class="perm-label">${esc(PAGE_LABELS[key] || key)}<small>${esc(key)}</small></div>
        <label class="switch"><input type="checkbox" data-page-key="${esc(key)}" ${esc(checkedValue ? 'checked' : '')} ${isMe ? 'disabled' : ''} onchange="window.permPageToggle('${jsStr(key)}', this.checked)"><span class="slider"></span></label>
      </div>`;
    }
    host.innerHTML = html + '</div></div>';
  }

  window.permSubTab = function permSubTab(view) {
    permissionView = view === 'pages' ? 'pages' : 'features';
    renderPermissionShell();
  };
  window.permSearch = function permSearch(value) {
    permissionSearch = value;
    permissionPage = 1;
    renderPermissionView();
  };
  window.permFilter = function permFilter(module) {
    permissionModule = module;
    permissionPage = 1;
    renderPermissionView();
  };
  window.permPage = function permPage(delta) {
    permissionPage += delta;
    renderPermissionView();
  };

  window.permToggle = function permToggle(key, checked) {
    permChanges[key] = checked ? 1 : 0;
    // 2026-08-14：切換即時把該列來源標籤改「✏️ 自訂」（跟隨角色→自訂），
    // 避免開關動了但標籤沒變的「狀態殘影」感
    const row = document.querySelector(`input[data-key="${key}"]`)?.closest('.perm-row');
    const src = row && row.querySelector('.perm-src');
    if (src) { src.textContent = '✏️ 自訂'; src.className = 'perm-src override'; }
    const hint = document.getElementById('saveHint');
    if (hint) {
      const n = Object.keys(permChanges).length + Object.keys(pageChanges).length;
      hint.className = 'save-hint changed';
      hint.textContent = `有 ${n} 項未儲存變更`;
    }
  };

  window.permPageToggle = function permPageToggle(key, checked) {
    pageChanges[key] = checked ? 1 : 0;
    const hint = document.getElementById('saveHint');
    if (hint) {
      const n = Object.keys(permChanges).length + Object.keys(pageChanges).length;
      hint.className = 'save-hint changed';
      hint.textContent = `有 ${n} 項未儲存變更`;
    }
  };

  window.permSave = async function permSave() {
    const keys = Object.keys(permChanges);
    const pageKeys = Object.keys(pageChanges);
    if (!keys.length && !pageKeys.length) { toast('沒有變更', 'info'); return; }
    let permissionsSaved = !keys.length;
    let pageVisibilitySaved = !pageKeys.length;
    try {
      if (keys.length) {
        await apiSend(`/api/users/${curUid}/permissions`, 'PUT', { permissions: permChanges });
        permissionsSaved = true;
      }
      if (pageKeys.length) {
        await apiSend(`/api/users/${curUid}/page-visibility`, 'PUT', { pages: pageChanges });
        pageVisibilitySaved = true;
      }
      permChanges = {};
      pageChanges = {};
      toast('權限與頁面顯示設定已更新（立即生效）', 'success');
      await loadUserDetail();
      renderUserList();  // 刷新來源標記無需，但保持狀態一致
    } catch (e) {
      const partial = keys.length > 0 && permissionsSaved && !pageVisibilitySaved;
      permChanges = {};
      pageChanges = {};
      await loadUserDetail();  // 重新讀取 server state，避免顯示未儲存的本地假狀態
      renderUserList();
      toast(partial
        ? '權限已儲存，但頁面顯示設定儲存失敗，已重新載入最新狀態'
        : (e.message || '儲存失敗'), 'error');
    }
  };

    // 2026-08-15 家豪選定：重設改自訂確認 modal（取代原生 confirm），桌面+手機共用
  window.openResetPermModal = function openResetPermModal() {
    const u = permUsers.find(x => x.id === curUid);
    if (!u) return;
    document.getElementById('resetPermTarget').textContent = `${u.display_name}（@${u.username}）`;
    document.getElementById('resetPermRole').textContent = ROLE_LABELS[u.role] || u.role;
    document.getElementById('resetPermOverlay').classList.add('show');
  };

  window.closeResetPermModal = function closeResetPermModal() {
    document.getElementById('resetPermOverlay').classList.remove('show');
  };

  window.confirmResetPerm = async function confirmResetPerm() {
    closeResetPermModal();
    try {
      await apiSend(`/api/users/${curUid}/permissions`, 'PUT', { reset_all: true });
      permChanges = {};
      try {
        await apiSend(`/api/users/${curUid}/page-visibility`, 'PUT', { reset_all: true });
        pageChanges = {};
      } catch (pvErr) {
        await loadUserDetail();
        renderUserList();
        toast('權限已重設，但頁面顯示重設失敗，已重新載入最新狀態', 'error');
        return;
      }
      toast('已重設為角色預設（權限 + 頁面顯示）', 'success');
      await loadUserDetail();
    } catch (e) {
      toast(e.message || '重設失敗', 'error');
    }
  };

  // ---------- 帳號設定 tab ----------
  function renderAccount(detail) {
    const el = document.getElementById('tab-account');
    const u = permUsers.find(x => x.id === curUid);
    if (!u) return;
    const isMe = me.id === curUid;
    const overrideCount = detail.permissions.filter(p => p.source === 'override').length;
    let html = `<div class="account-card">
      <div class="account-field"><div class="k">帳號</div><div class="v">@${esc(u.username)}</div></div>
      <div class="account-field"><div class="k">顯示名稱</div><div class="v">${esc(u.display_name)}</div></div>
      <div class="account-field"><div class="k">角色</div><div class="v">${ROLE_LABELS[u.role] || u.role}</div></div>
      <div class="account-field"><div class="k">狀態</div><div class="v">${u.is_active ? '✅ 啟用中' : '⏸ 已停用'}</div></div>
      <div class="account-field"><div class="k">個人權限設定</div><div class="v">${overrideCount ? `${overrideCount} 項自訂` : '無（完全跟隨角色）'}</div></div>
    </div>`;
    if (isMe) {
      html += `<div class="warn-box">⚠️ 不能停用、刪除或修改自己的帳號（系統保護）。</div>`;
    } else {
      html += `<div class="account-actions">
        <button class="btn-primary" onclick="window.permEditAccount(${u.id})">✏️ 編輯帳號</button>
        <button class="btn-primary" onclick="window.permResetPw(${u.id})">🔑 重設密碼</button>
        <button class="btn-warn" onclick="window.permToggleActive(${u.id}, ${u.is_active ? 0 : 1})">${u.is_active ? '⏸ 停用帳號' : '▶️ 啟用帳號'}</button>
        <button class="btn-danger" onclick="window.permDelete(${u.id})">🗑 刪除帳號</button>
      </div>`;
      if (u.is_active) {
        html += `<div class="warn-box">💡 停用後該帳號立即無法登入（既有 session 也會失效）。離職員工請用「停用」而非「刪除」。</div>`;
      }
    }
    el.innerHTML = html;
  }

  window.permResetPw = function permResetPw(uid) {
    const u = permUsers.find(x => x.id === uid);
    document.getElementById('resetPwTarget').textContent = `重設 ${u.display_name}（@${u.username}）的密碼`;
    document.getElementById('rp-password').value = '';
    document.getElementById('resetPwOverlay').classList.add('show');
  };

  window.permToggleActive = async function permToggleActive(uid, nextActive) {
    const u = permUsers.find(x => x.id === uid);
    const msg = nextActive ? `確定要停用「${u.display_name}」嗎？停用後立即無法登入。` : `確定要重新啟用「${u.display_name}」嗎？`;
    if (!confirm(msg)) return;
    try {
      await apiSend(`/api/users/${uid}`, 'PUT', { is_active: nextActive });
      toast(nextActive ? '已停用' : '已啟用', 'success');
      await reloadUsers();
    } catch (e) {
      toast(e.message || '操作失敗', 'error');
    }
  };

  window.permDelete = async function permDelete(uid) {
    const u = permUsers.find(x => x.id === uid);
    if (!confirm(`確定要刪除「${u.display_name}」嗎？此操作不可復原！\n（有派工紀錄的帳號無法刪除，請改用停用）`)) return;
    try {
      await apiSend(`/api/users/${uid}`, 'DELETE');
      toast('已刪除', 'success');
      permUsers = permUsers.filter(x => x.id !== uid);
      curUid = null;
      selectNextUser();
    } catch (e) {
      toast(e.message || '刪除失敗', 'error');
    }
  };

  function selectNextUser() {
    if (!permUsers.length) { location.href = '/'; return; }
    window.permSelect(permUsers[0].id);
  }

  // ---------- tab 切換 ----------
  window.switchTab = function switchTab(tab) {
    document.querySelectorAll('.tab[data-tab]').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    document.getElementById('tab-perms').style.display = tab === 'perms' ? '' : 'none';
    document.getElementById('tab-account').style.display = tab === 'account' ? '' : 'none';
  };

  // ---------- 新增帳號 modal ----------
  window.openAddUserModal = function openAddUserModal() {
    addUserMode('single');
    document.getElementById('nu-username').value = '';
    document.getElementById('nu-display').value = '';
    document.getElementById('nu-password').value = '';
    document.getElementById('nu-batch').value = '';
    document.getElementById('nu-batch-result').innerHTML = '';
    document.getElementById('addUserOverlay').classList.add('show');
  };

  window.closeAddUserModal = function closeAddUserModal() {
    document.getElementById('addUserOverlay').classList.remove('show');
  };

  window.addUserMode = function addUserMode(mode) {
    addMode = mode;
    document.getElementById('addSingle').style.display = mode === 'single' ? '' : 'none';
    document.getElementById('addBatch').style.display = mode === 'batch' ? '' : 'none';
    document.querySelectorAll('#addUserOverlay .tab').forEach(t => t.classList.toggle('active', t.textContent.includes(mode === 'single' ? '單一' : '批次')));
  };

  window.submitAddUser = async function submitAddUser() {
    const btn = document.getElementById('nu-submit');
    btn.disabled = true;
    try {
      if (addMode === 'single') {
        const username = document.getElementById('nu-username').value.trim();
        const display = document.getElementById('nu-display').value.trim();
        const role = document.getElementById('nu-role').value;
        const password = document.getElementById('nu-password').value;
        if (!username || !password) { toast('帳號與密碼必填', 'error'); return; }
        const pwErr = typeof pwPolicyMsg === 'function' ? pwPolicyMsg(password) : null;
        if (pwErr) { toast(pwErr, 'error'); return; }
        await apiSend('/api/users', 'POST', { username, display_name: display || username, role, password });
        toast(`已建立 ${username}`, 'success');
        closeAddUserModal();
        await reloadUsers();
      } else {
        const lines = document.getElementById('nu-batch').value.split('\n').map(s => s.trim()).filter(Boolean);
        if (!lines.length) { toast('請輸入至少一筆', 'error'); return; }
        const users = [];
        for (const line of lines) {
          const parts = line.split(',').map(s => s.trim());
          if (parts.length < 4) { toast(`格式錯誤（需 4 欄）：${line}`, 'error'); return; }
          const [username, display, role, password] = parts;
          if (!username || !password) { toast(`帳號與密碼必填：${line}`, 'error'); return; }
          const pwErr = typeof pwPolicyMsg === 'function' ? pwPolicyMsg(password) : null;
          if (pwErr) { toast(`${username}：${pwErr}`, 'error'); return; }
          users.push({ username, display_name: display || username, role, password });
        }
        const res = await apiSend('/api/users/batch', 'POST', { users });
        const box = document.getElementById('nu-batch-result');
        box.innerHTML = res.results.map(x =>
          `<div class="${x.status === 'ok' ? 'ok' : 'err'}">${x.status === 'ok' ? '✔' : '✘'} ${esc(x.username)} — ${esc(x.detail)}</div>`
        ).join('');
        if (res.created) {
          toast(`已建立 ${res.created} 筆`, 'success');
          await reloadUsers();
        }
      }
    } catch (e) {
      toast(e.message || '建立失敗', 'error');
    } finally {
      btn.disabled = false;
    }
  };

  // ---------- 帳號編輯 modal（顯示名稱/角色共用流程） ----------
  window.permEditAccount = function permEditAccount(uid) {
    const u = permUsers.find(x => x.id === uid);
    if (!u || me.id === uid) return;
    document.getElementById('ae-display-name').value = u.display_name || '';
    document.getElementById('ae-role').value = u.role;
    document.getElementById('accountEditOverlay').classList.add('show');
  };

  window.closeAccountEditModal = function closeAccountEditModal() {
    document.getElementById('accountEditOverlay').classList.remove('show');
  };

  window.submitAccountEdit = async function submitAccountEdit() {
    const uid = curUid;
    const name = document.getElementById('ae-display-name').value.trim();
    const role = document.getElementById('ae-role').value;
    if (!uid || !role) { toast('請選擇角色', 'error'); return; }
    try {
      await apiSend(`/api/users/${uid}`, 'PUT', { display_name: name, role });
      closeAccountEditModal();
      toast('帳號設定已更新', 'success');
      await reloadUsers();
    } catch (e) {
      toast(e.message || '更新失敗', 'error');
    }
  };

  // ---------- 重設密碼 modal ----------
  window.submitResetPw = async function submitResetPw() {
    const password = document.getElementById('rp-password').value;
    if (!password) { toast('請輸入新密碼', 'error'); return; }
    const pwErr = typeof pwPolicyMsg === 'function' ? pwPolicyMsg(password) : null;
    if (pwErr) { toast(pwErr, 'error'); return; }
    try {
      await apiSend(`/api/users/${curUid}/password`, 'PUT', { password });
      toast('密碼已重設', 'success');
      closeResetPwModal();
    } catch (e) {
      toast(e.message || '重設失敗', 'error');
    }
  };

  window.closeResetPwModal = function closeResetPwModal() {
    document.getElementById('resetPwOverlay').classList.remove('show');
  };

  // ---------- 共用 ----------
  async function reloadUsers() {
    const users = await apiGet('/api/users');
    permUsers = users.users;
    renderUserList();
    renderChips();
    renderPanelHead();
    if (curUid) await loadUserDetail();
  }

  document.addEventListener('DOMContentLoaded', initPermPage);
})();
