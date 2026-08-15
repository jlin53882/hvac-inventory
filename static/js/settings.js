// settings.js — 設定中心（2026-08-16 家豪 B-1 定案：左右清單）
// 依賴：utils.js（esc/jsStr/hasPerm/toast）、units.js（unitList/unitListActive/loadUnits）、
//       changepw.js（submitChangePw/cpwResetChecks/cpwCheckStrength/cpwCheckMatch）
var unitUsage = [];

function settingsSwitch(panel) {
  document.querySelectorAll('#settingsSideList .side-item').forEach(el =>
    el.classList.toggle('active', el.dataset.panel === panel));
  document.querySelectorAll('#settingsChipBar .chip').forEach(el =>
    el.classList.toggle('active', el.dataset.panel === panel));
  const showUnits = panel === 'units';
  document.getElementById('panel-units').style.display = showUnits ? '' : 'none';
  document.getElementById('panel-pw').style.display = showUnits ? 'none' : '';
  if (showUnits) renderUnitsPanel();
}

async function loadUnitUsage() {
  try {
    const res = await fetch('/api/units/usage');
    if (res.ok) unitUsage = await res.json();
  } catch (e) { /* 忽略 */ }
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
    const orphans = unitUsage.filter(u => u.count > 0 && !unitListActive.some(x => x.name === u.unit));
    if (orphans.length) {
      html += '<div class="hist-clean"><b>⚠️ 不在清單的歷史單位（可收編）</b>';
      orphans.forEach(u => {
        const label = u.unit === '' ? '（空白）' : u.unit;
        html += `<div class="row"><span>「${esc(label)}」× ${esc(u.count)} 筆</span><span>` +
                `收編為 <select class="u-consolidate-to">${unitListActive.map(x => `<option>${esc(x.name)}</option>`).join('')}</select> ` +
                `<button class="btn-primary" data-from="${jsStr(u.unit)}" onclick="consolidateUnit(this)">收編</button></span></div>`;
      });
      html += '</div>';
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

async function consolidateUnit(btn) {
  const from = btn.dataset.from;
  const sel = btn.closest('.row').querySelector('.u-consolidate-to');
  const to = sel ? sel.value : '';
  if (!from || !to) return;
  const _cnt = unitUsage.find(u => u.unit === from)?.count || 0;
  if (!confirm('將「' + from + '」共 ' + _cnt + ' 筆品項的單位改為「' + to + '」？')) return;
  try {
    const res = await fetch('/api/units/consolidate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from_unit: from, to_unit: to })
    });
    const data = await res.json();
    if (!res.ok) { toast(data.detail || '收編失敗', 'error'); return; }
    await Promise.all([loadUnits(), loadUnitUsage()]);
    renderUnitsPanel();
    toast(`✅ 已收編 ${data.affected} 筆為「${to}」`, 'success');
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
      ['pw', '🔑 修改密碼']
    ].filter(([p]) => p !== 'units' || canUnits)
     .map(([p, label]) => '<span class="chip' + (p === 'units' ? ' active' : '') + '" data-panel="' + p + '" onclick="settingsSwitch(\'' + p + '\')">' + label + '</span>')
     .join('');
  }
  await Promise.all([loadUnits(), loadUnitUsage()]);
  settingsSwitch(canUnits ? 'units' : 'pw');
})();
