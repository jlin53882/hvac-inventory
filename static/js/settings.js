// settings.js — 設定中心（2026-08-16 家豪 B-1 定案：左右清單）
// 依賴：utils.js（esc/jsStr/hasPerm/toast）、units.js（unitList/unitListActive/loadUnits）、
//       changepw.js（submitChangePw/cpwResetChecks/cpwCheckStrength/cpwCheckMatch）
var orphanItems = [];  // 逐筆收編資料源（GET /api/units/orphans，2026-08-16 方案 B）
var orphanLoadFailed = false;  // 2026-08-16 no-op 修復：載入失敗時顯示警告而非「✅ 全在清單」假成功

function settingsSwitch(panel) {
  document.querySelectorAll('#settingsSideList .side-item').forEach(el =>
    el.classList.toggle('active', el.dataset.panel === panel));
  document.querySelectorAll('#settingsChipBar .chip').forEach(el =>
    el.classList.toggle('active', el.dataset.panel === panel));
  const showUnits = panel === 'units';
  const showGcal = panel === 'gcal';
  document.getElementById('panel-units').style.display = showUnits ? '' : 'none';
  document.getElementById('panel-gcal').style.display = showGcal ? '' : 'none';
  document.getElementById('panel-pw').style.display = (!showUnits && !showGcal) ? '' : 'none';
  if (showUnits) renderUnitsPanel();
  if (showGcal) renderGcalPanel();
}

async function loadOrphans() {
  try {
    const res = await fetch('/api/units/orphans');
    if (res.ok) { orphanItems = await res.json(); orphanLoadFailed = false; }
    else { console.error('[loadOrphans] /api/units/orphans 失敗', res.status); orphanLoadFailed = true; }
  } catch (e) { console.error('[loadOrphans] 網路錯誤', e); orphanLoadFailed = true; }
}

// 依 unit 分組（'' 顯示「（空白）」）；順序依 orphans API 的 ORDER BY unit
function groupOrphans(items) {
  const map = new Map();
  items.forEach(it => {
    if (!map.has(it.unit)) map.set(it.unit, []);
    map.get(it.unit).push(it);
  });
  return Array.from(map.entries()).map(([unit, arr]) => ({
    unit,
    label: unit === '' ? '（空白）' : unit,
    items: arr
  }));
}

// ========== 單位管理面板 ==========
function renderUnitsPanel() {
  const canManage = hasPerm('unit-mgmt');
  const canAdd = hasPerm('item-mgmt');
  let html = '<h4>📦 單位管理</h4>';
  if (canAdd) {
    html += '<div class="u-add-row"><input id="u-new-name" placeholder="新單位名稱（例：顆）" maxlength="20">' +
            '<button class="btn-primary" onclick="addUnitFromSettings()">＋ 新增</button></div>';
  }
  html += '<table class="u-table">';
  unitList.forEach(u => {
    html += `<tr><td class="${u.is_active ? '' : 'off'}">${esc(u.name)}${u.is_active ? '' : ' <small>（停用）</small>'}</td><td style="text-align:right">`;
    if (canManage) {
      html += `<a class="updown" onclick="moveUnit(${u.id}, -1)" title="上移">↑</a>` +
              `<a class="updown" onclick="moveUnit(${u.id}, 1)" title="下移">↓</a> ` +
              `<label class="settings-switch"><input type="checkbox" ${u.is_active ? 'checked' : ''} onchange="toggleUnit(${u.id}, this.checked)"><span class="slider"></span></label>`;
    }
    html += '</td></tr>';
  });
  html += '</table>';
  if (canManage) {
    const groups = groupOrphans(orphanItems);
    if (groups.length) {
      html += '<div class="hist-clean"><b>⚠️ 不在清單的歷史單位（點開逐筆處理）</b>';
      html += '<div style="font-size:11.5px;color:#a08a3e;margin:4px 0 8px">每筆品項各自指定正確單位；處理完自動消失。組底可整組快速套用。</div>';
      groups.forEach(g => {
        html += `<div class="grp">
          <div class="grp-head" onclick="this.parentElement.classList.toggle('open')">
            <span class="grp-title"><span class="arrow">▶</span> ${esc(g.label)}</span>
            <span class="grp-count">${g.items.length} 筆</span></div>
          <div class="grp-body"><table class="g-table">`;
        g.items.forEach(it => {
          html += `<tr><td class="p-name">${esc(it.name)}${it.is_deleted ? ' <small>（非庫存）</small>' : ''}</td>
            <td class="qty">×${absNum(it.total_qty)}</td>
            <td style="text-align:right"><select class="u-ci-to" required><option value="">— 請選擇 —</option>`;
          unitListActive.forEach(u => { html += `<option>${esc(u.name)}</option>`; });
          html += `</select> <button class="btn-primary" onclick="consolidateItem(${it.item_id}, this)">改為</button></td></tr>`;
        });
        html += `</table>
          <div class="grp-fast">整組快速套用：<select class="u-ci-fast" required><option value="">— 請選擇 —</option>`;
        unitListActive.forEach(u => { html += `<option>${esc(u.name)}</option>`; });
        html += `</select><button class="btn-primary" data-from="${esc(g.unit)}" onclick="consolidateGroup(this)">套用全部</button></div>
          </div></div>`;
      });
      html += '</div>';
    } else if (orphanLoadFailed) {
      html += '<div class="hist-clean" style="color:#c62828">⚠️ 歷史單位載入失敗（無法確認是否收編乾淨）</div>';
    } else {
      html += '<div class="hist-clean" style="color:#2e7d32">✅ 所有品項單位皆在清單中</div>';
    }
  }
  document.getElementById('panel-units').innerHTML = html;
}

async function addUnitFromSettings() {
  const inp = document.getElementById('u-new-name');
  const name = inp ? inp.value.trim() : '';
  if (!name) { toast('請輸入單位名稱', 'error'); return; }
  try {
    const res = await fetch('/api/units', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    const data = await res.json();
    if (!res.ok) { toast(data.detail || '新增失敗', 'error'); return; }
    unitList.push(data);
    unitListActive = unitList.filter(u => u.is_active);
    if (inp) inp.value = '';
    renderUnitsPanel();
    toast(`✅ 單位「${name}」已新增`, 'success');
  } catch (e) { toast('新增失敗', 'error'); }
}

async function toggleUnit(id, on) {
  try {
    const res = await fetch(`/api/units/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: on })
    });
    const data = await res.json();
    if (!res.ok) { toast(data.detail || '操作失敗', 'error'); renderUnitsPanel(); return; }
    const u = unitList.find(x => x.id === id);
    if (u) u.is_active = on;
    unitListActive = unitList.filter(x => x.is_active);
    renderUnitsPanel();
    toast(on ? '✅ 已啟用' : '已停用（歷史品項仍顯示原單位）', on ? 'success' : '');
  } catch (e) { toast('操作失敗', 'error'); }
}

async function moveUnit(id, dir) {
  const u = unitList.find(x => x.id === id);
  if (!u) return;
  const target = u.sort_order + dir;
  try {
    const res = await fetch(`/api/units/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sort_order: target })
    });
    const data = await res.json();
    if (!res.ok) { toast(data.detail || '排序失敗', 'error'); return; }
    await loadUnits();  // 重載排序（可能與鄰居互換）
    renderUnitsPanel();
  } catch (e) { toast('排序失敗', 'error'); }
}

async function consolidateItem(itemId, btn) {
  const sel = btn.closest('tr').querySelector('.u-ci-to');
  const to = sel ? sel.value : '';
  if (!to) { toast('請先選擇目標單位', 'error'); return; }
  const nameEl = btn.closest('tr').querySelector('.p-name');
  if (!confirm('將「' + (nameEl ? nameEl.textContent : '') + '」的單位改為「' + to + '」？')) return;
  try {
    const res = await fetch('/api/units/consolidate-item', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: itemId, to_unit: to })
    });
    const data = await res.json();
    if (!res.ok) { toast(data.detail || '改單位失敗', 'error'); return; }
    await Promise.all([loadUnits(), loadOrphans()]);
    renderUnitsPanel();
    toast('✅ 已改為「' + to + '」', 'success');
  } catch (e) { toast('改單位失敗', 'error'); }
}

async function consolidateGroup(btn) {
  const from = btn.dataset.from;
  const sel = btn.closest('.grp-fast').querySelector('.u-ci-fast');
  const to = sel ? sel.value : '';
  if (!to) { toast('請先選擇目標單位', 'error'); return; }
  const label = from === '' ? '（空白）' : from;
  const n = orphanItems.filter(o => o.unit === from).length;
  if (!confirm('將「' + label + '」全部 ' + n + ' 筆的單位改為「' + to + '」？此操作一次套用整組。')) return;
  try {
    const res = await fetch('/api/units/consolidate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from_unit: from, to_unit: to })
    });
    const data = await res.json();
    if (!res.ok) { toast(data.detail || '收編失敗', 'error'); return; }
    await Promise.all([loadUnits(), loadOrphans()]);
    renderUnitsPanel();
    toast('✅ 已收編 ' + data.affected + ' 筆為「' + to + '」', 'success');
  } catch (e) { toast('收編失敗', 'error'); }
}

// ========== 修改密碼（內嵌表單，複用 changepw.js）==========
async function settingsSubmitPw() {
  await submitChangePw();
  // 成功/失敗都清空（密碼欄位殘留是安全問題）；submitChangePw 內部已 toast
  setTimeout(clearPwForm, 500);
}

function clearPwForm() {
  ['cpw-old', 'cpw-new', 'cpw-confirm'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  cpwResetChecks();
  const mm = document.getElementById('cpw-mismatch');
  if (mm) mm.style.display = 'none';
}

// ========== 行事曆同步面板 ==========
var gcalKeys = [];
var gcalUsers = [];  // 使用者清單（含 gcal_key）

async function loadGcalKeys() {
  try {
    const res = await fetch('/api/gcal-keys');
    if (res.ok) gcalKeys = await res.json();
  } catch (e) { console.error('[loadGcalKeys]', e); }
}

async function loadGcalUsers() {
  try {
    const res = await fetch('/api/users');
    if (res.ok) { const d = await res.json(); gcalUsers = d.users || []; }
  } catch (e) { console.error('[loadGcalUsers]', e); }
}

function renderGcalPanel() {
  const canManage = hasPerm('unit-mgmt');
  let html = '<h4>📅 行事曆同步（Google Calendar）</h4>';
  html += '<p style="font-size:12.5px;color:#888;margin-bottom:14px">將本地派工行程單向同步到 Google 行事曆。每個 Key 對應一個廠商的 Service Account。</p>';

  if (gcalKeys.length === 0) {
    html += '<div class="gcal-empty"><div class="icon">📅</div>';
    html += '<p>尚未設定任何 Service Account Key</p>';
    html += '<p style="font-size:12px;margin-top:6px;color:#bbb">點擊下方按鈕新增第一把 Key，開始同步行程到 Google 行事曆</p>';
    if (canManage) html += '<button class="btn-primary" style="margin-top:14px" onclick="openGcalKeyModal()">＋ 新增第一把 Key</button>';
    html += '</div>';
  } else {
    html += '<table class="gcal-table"><thead><tr>';
    html += '<th>名稱</th><th>行事曆 ID</th><th>狀態</th>';
    if (canManage) html += '<th>操作</th>';
    html += '</tr></thead><tbody>';
    gcalKeys.forEach(k => {
      html += '<tr>';
      html += '<td class="gcal-name">' + esc(k.name) + '</td>';
      html += '<td class="gcal-cal-id" title="' + esc(k.calendar_id) + '">' + esc(k.calendar_id) + '</td>';
      html += '<td><label class="settings-switch"><input type="checkbox" ' + (k.is_active ? 'checked' : '') + ' onchange="toggleGcalKey(' + k.id + ', this.checked)"><span class="slider"></span></label></td>';
      if (canManage) {
        html += '<td class="gcal-actions">';
        html += '<button class="btn-ghost" style="padding:4px 8px;font-size:12px" onclick="openGcalKeyModal(' + k.id + ')">✏️ 編輯</button> ';
        html += '<button class="btn-danger" data-id="' + k.id + '" data-name="' + esc(k.name) + '" onclick="deleteGcalKey(this)">🗑️ 刪除</button>';
        html += '</td>';
      }
      html += '</tr>';
    });
    html += '</tbody></table>';
    if (canManage) html += '<div style="margin-top:12px"><button class="btn-primary" onclick="openGcalKeyModal()">＋ 新增 Key</button></div>';
  }

  html += '<div class="gcal-hint">📌 行程依「指派人員綁定的 Key」決定同步到哪本行事曆 ｜ 🔄 同一行程可同步到多本（一對多） ｜ ⏱ 同步間隔 5 分鐘</div>';

  // 使用者綁 key
  html += '<div class="gcal-user-section"><h5>👤 使用者綁定 Key（指派人 → 同步到該 Key 的行事曆）</h5>';
  if (gcalUsers.length && gcalKeys.length) {
    html += '<table class="gcal-user-table"><thead><tr><th>使用者</th><th>綁定 Key</th></tr></thead><tbody>';
    gcalUsers.forEach(u => {
      html += '<tr><td>👤 ' + esc(u.display_name || u.username) + '</td><td>';
      html += '<select onchange="bindGcalUser(' + u.id + ', this.value)">';
      html += '<option value=""' + (!u.gcal_key ? ' selected' : '') + '>— 未綁定 —</option>';
      gcalKeys.filter(k => k.is_active).forEach(k => {
        html += '<option value="' + esc(k.name) + '"' + (u.gcal_key === k.name ? ' selected' : '') + '>' + esc(k.name) + '</option>';
      });
      html += '</select></td></tr>';
    });
    html += '</tbody></table>';
    html += '<p style="font-size:11px;color:#999;margin-top:6px">未綁定 Key 的使用者，其指派的行程不會同步到任何行事曆。</p>';
  } else if (!gcalKeys.length) {
    html += '<p style="font-size:12px;color:#999">請先新增至少一把 Key，再綁定使用者。</p>';
  }
  html += '</div>';

  document.getElementById('panel-gcal').innerHTML = html;
}

async function toggleGcalKey(id, on) {
  try {
    const res = await fetch('/api/gcal-keys/' + id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: on })
    });
    if (!res.ok) { toast((await res.json()).detail || '操作失敗', 'error'); renderGcalPanel(); return; }
    const k = gcalKeys.find(x => x.id === id);
    if (k) k.is_active = on;
    renderGcalPanel();
    toast(on ? '✅ 已啟用' : '已停用', on ? 'success' : '');
  } catch (e) { toast('操作失敗', 'error'); }
}

async function deleteGcalKey(btn) {
  var id = parseInt(btn.dataset.id);
  var name = btn.dataset.name;
  if (!confirm('確定要刪除 Key「' + name + '」？')) return;
  try {
    const res = await fetch('/api/gcal-keys/' + id, { method: 'DELETE' });
    if (!res.ok) { toast((await res.json()).detail || '刪除失敗', 'error'); return; }
    gcalKeys = gcalKeys.filter(k => k.id !== id);
    renderGcalPanel();
    toast('✅ 已刪除', 'success');
  } catch (e) { toast('刪除失敗', 'error'); }
}

async function bindGcalUser(userId, keyName) {
  try {
    const res = await fetch('/api/users/' + userId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gcal_key: keyName })
    });
    if (!res.ok) { toast((await res.json()).detail || '綁定失敗', 'error'); return; }
    const u = gcalUsers.find(x => x.id === userId);
    if (u) u.gcal_key = keyName;
    toast('✅ 已綁定', 'success');
  } catch (e) { toast('綁定失敗', 'error'); }
}

// ========== 初始化 ==========
(async function initSettings() {
  const user = await checkAuth();
  if (!user) return;  // checkAuth 內跳登入
  const canUnits = hasPerm('unit-mgmt');
  // B3 權限 gating：無 unit-mgmt 隱藏左清單「單位管理」項
  if (!canUnits) {
    const item = document.querySelector('#settingsSideList .side-item[data-panel="units"]');
    if (item) item.style.display = 'none';
  }
  // 手機 chip-bar
  const chipBar = document.getElementById('settingsChipBar');
  if (chipBar) {
    chipBar.innerHTML = [
      ['units', '📦 單位管理'],
      ['gcal', '📅 行事曆同步'],
      ['pw', '🔑 修改密碼']
    ].filter(([p]) => p !== 'units' || canUnits)
     .map(([p, label]) => '<span class="chip' + (p === 'units' ? ' active' : '') + '" data-panel="' + p + '" onclick="settingsSwitch(\'' + p + '\')">' + label + '</span>')
     .join('');
  }
  await Promise.all([loadUnits(), loadOrphans(), loadGcalKeys(), loadGcalUsers()]);
  settingsSwitch(canUnits ? 'units' : 'pw');
})();
