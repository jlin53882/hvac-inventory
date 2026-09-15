// settings.js — 設定中心（2026-08-27 gcal-sync-settings 重寫）
// 依賴：utils.js（esc/jsStr/hasPerm/toast）、units.js（unitList/unitListActive/loadUnits）、
//       changepw.js（submitChangePw/cpwResetChecks/cpwCheckStrength/cpwCheckMatch）
var orphanItems = [];
var orphanLoadFailed = false;

// ========== 零用金下拉選單管理（general / engineering 分離） ==========
var pettyOptionCache = { general: { category: [], group: [] }, engineering: { category: [], group: [] } };
async function loadPettyOptions() {
  for (const type of ['general', 'engineering']) {
    for (const kind of ['category', 'group']) {
      const res = await fetch('/api/petty-cash-options?report_type=' + type + '&option_type=' + kind);
      if (res.ok) pettyOptionCache[type][kind] = (await res.json()).items || [];
    }
  }
}
function pettyOptionRows(type, kind, can) {
  const items = pettyOptionCache[type][kind] || [];
  if (!items.length) return '<div class="pc-option-empty">尚未設定選項</div>';
  return items.map((o, i) => '<div class="pc-option-row"><div><span class="pc-option-index">' + (i + 1) + '</span><strong>' + esc(o.name) + '</strong><small class="pc-option-status ' + (o.is_active ? 'is-active' : 'is-off') + '">' + (o.is_active ? '● 使用中' : '○ 已停用') + '</small></div>' + (can ? '<span class="pc-option-actions"><button type="button" class="pc-icon-action" data-petty-action="rename" data-id="' + o.id + '" data-type="' + esc(type) + '" data-kind="' + esc(kind) + '">✎ 編輯</button><button type="button" class="pc-icon-action pc-icon-action--danger" data-petty-action="delete" data-id="' + o.id + '" data-type="' + esc(type) + '" data-kind="' + esc(kind) + '">🗑 刪除</button></span>' : '') + '</div>').join('');
}
function renderPettyOptionsPanel() {
  const can = hasPerm('petty-cash-config');
  const panel = document.getElementById('panel-petty-cash');
  if (!panel) return;
  let html = '<div class="pc-settings-title"><div><h4>🪙 零用金選單</h4><p>管理零用金報表使用的科目、分類與項目，資料不與其他報表類型共用。</p></div></div>';
  html += '<section class="pc-option-settings pc-option-settings--general"><div class="pc-settings-card-head"><div><span class="pc-settings-icon">💳</span><div><h5>一般零用金</h5><p>管理一般零用金使用的科目</p></div></div><span class="pc-settings-note">ⓘ 僅需設定科目</span></div>';
  if (can) html += '<div class="pc-option-add"><label for="pc-opt-name-general-category">新增科目</label><div class="pc-option-add-row"><input id="pc-opt-name-general-category" maxlength="100" placeholder="輸入科目名稱（例如：文具費）"><button class="btn-primary" onclick="createPettyOptionKind(\'general\',\'category\')">＋ 新增科目</button></div></div>';
  html += '<div class="pc-option-list-head"><span>#　科目名稱</span><span>操作</span></div><div class="pc-option-list">' + pettyOptionRows('general', 'category', can) + '</div></section>';
  html += '<section class="pc-option-settings pc-option-settings--engineering"><div class="pc-settings-card-head"><div><span class="pc-settings-icon">👷</span><div><h5>工程零用金</h5><p>管理工程零用金使用的分類與項目</p></div></div></div><div class="pc-option-engineering-grid">';
  for (const kind of ['category', 'group']) {
    const label = kind === 'category' ? '📁 分類選項' : '📦 項目選項';
    const placeholder = kind === 'category' ? '輸入分類名稱（例如：交通費）' : '輸入項目名稱（例如：油資）';
    html += '<div class="pc-option-column"><div class="pc-option-column-head"><div><h6>' + label + '</h6><p>工程零用金' + (kind === 'category' ? '分類' : '項目') + '</p></div><b>' + (pettyOptionCache.engineering[kind] || []).length + ' 筆</b></div>';
    if (can) html += '<div class="pc-option-add"><label for="pc-opt-name-engineering-' + kind + '">新增' + (kind === 'category' ? '分類' : '項目') + '</label><div class="pc-option-add-row"><input id="pc-opt-name-engineering-' + kind + '" maxlength="100" placeholder="' + placeholder + '"><button class="btn-primary" onclick="createPettyOptionKind(\'engineering\',\'' + kind + '\')">＋ 新增</button></div></div>';
    html += '<div class="pc-option-list">' + pettyOptionRows('engineering', kind, can) + '</div></div>';
  }
  html += '</div></section>';
  panel.innerHTML = html;
  panel.querySelectorAll('[data-petty-action]').forEach(button => button.addEventListener('click', () => {
    const id = Number(button.dataset.id), type = button.dataset.type, kind = button.dataset.kind;
    if (button.dataset.pettyAction === 'rename') renamePettyOption(id, type, kind);
    else deletePettyOption(id, type, kind);
  }));
}
async function createPettyOptionKind(type, kind) {
  const input = document.getElementById('pc-opt-name-' + type + '-' + kind);
  const name = input.value.trim();
  if (!name) return toast('請輸入選單名稱', 'error');
  const res = await fetch('/api/petty-cash-options', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({report_type:type, option_type:kind, name:name, sort_order:pettyOptionCache[type][kind].length}) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return toast(data.detail || '新增失敗', 'error');
  await loadPettyOptions(); renderPettyOptionsPanel(); toast('✅ 已新增', 'success');
}

async function renamePettyOption(id, type, kind) {
  const old = (pettyOptionCache[type][kind].find(o => o.id === id) || {}).name || '';
  const name = prompt('請輸入新的選單名稱', old);
  if (name === null || !name.trim()) return;
  const res = await fetch('/api/petty-cash-options/' + id, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name:name.trim()}) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return toast(data.detail || '修改失敗', 'error');
  await loadPettyOptions(); renderPettyOptionsPanel();
}
async function deletePettyOption(id, type, kind) {
  if (!confirm('確定刪除此下拉選單項目？')) return;
  const res = await fetch('/api/petty-cash-options/' + id, { method:'DELETE' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return toast(data.detail || '刪除失敗', 'error');
  await loadPettyOptions(); renderPettyOptionsPanel();
}

var gcalKeys = [];
var gcalUsers = [];
var gcalSettings = {};
var selectedKeyId = null;


function settingsSwitch(panel) {
  document.querySelectorAll('#settingsSideList .side-item').forEach(el =>
    el.classList.toggle('active', el.dataset.panel === panel));
  document.querySelectorAll('#settingsChipBar .chip').forEach(el =>
    el.classList.toggle('active', el.dataset.panel === panel));
  const showUnits = panel === 'units';
  const showGcal = panel === 'gcal';
  const showPetty = panel === 'petty-cash';
  document.getElementById('panel-units').style.display = showUnits ? '' : 'none';
  document.getElementById('panel-gcal').style.display = showGcal ? '' : 'none';
  document.getElementById('panel-petty-cash').style.display = showPetty ? '' : 'none';
  document.getElementById('panel-pw').style.display = (!showUnits && !showGcal && !showPetty) ? '' : 'none';
  if (showUnits) renderUnitsPanel();
  if (showGcal) renderGcalPanel();
  if (showPetty) renderPettyOptionsPanel();
}

// ========== 單位管理面板 ==========
async function loadOrphans() {
  try {
    const res = await fetch('/api/units/orphans');
    if (res.ok) { orphanItems = await res.json(); orphanLoadFailed = false; }
    else { orphanLoadFailed = true; }
  } catch (e) { orphanLoadFailed = true; }
}

// 2026-09-12 數量系統：單位類型標籤
var QTY_TYPE_LABELS = { integer: '整數', decimal: '小數', fraction: '分數/小數' };
function qtyTypeLabel(t) { return QTY_TYPE_LABELS[t] || '整數'; }
// 歷史單位轉換建議：僅「/d + 純單位名」且總量明確時建議 new=total/d；其餘一律 ambiguous → null（不猜）
function suggestQtyConvert(unitStr, totalQty) {
  const m = /^\/(\d+)([^\/\+\(\)\s]+)$/.exec(String(unitStr || '').trim());
  if (!m) return null;
  const d = parseInt(m[1]);
  if (!d || d <= 0) return null;
  const total = Number(totalQty || 0);
  if (!isFinite(total) || total < 0) return null;
  return { qty: Math.round((total / d) * 1000) / 1000, unit: m[2] };
}
function groupOrphans(items) {
  const map = new Map();
  items.forEach(it => {
    if (!map.has(it.unit)) map.set(it.unit, []);
    map.get(it.unit).push(it);
  });
  return Array.from(map.entries()).map(([unit, arr]) => ({
    unit, label: unit === '' ? '（空白）' : unit, items: arr
  }));
}

function renderUnitsPanel() {
  const canManage = hasPerm('unit-mgmt');
  const canAdd = hasPerm('item-mgmt');
  let html = '<h4>📦 單位管理</h4>';
  if (canAdd) {
    html += '<div class="u-add-row"><input id="u-new-name" placeholder="新單位名稱（例：顆）" maxlength="20">' +
            '<select id="u-new-type" title="數量輸入類型"><option value="integer">整數</option><option value="decimal">小數</option><option value="fraction">分數/小數</option></select>' +
            '<button class="btn-primary" onclick="addUnitFromSettings()">＋ 新增</button></div>';
  }
  html += '<table class="u-table"><thead><tr><th>單位名稱</th><th>數量類型</th><th style="text-align:right">操作</th></tr></thead>';
  unitList.forEach(u => {
    const _tl = qtyTypeLabel(u.qty_type);
    const _typeCell = canManage
      ? '<select class="u-qty-type" onchange="setUnitQtyType(' + u.id + ', this.value)" title="數量輸入類型">' +
        ['integer', 'decimal', 'fraction'].map(t => '<option value="' + t + '"' + ((u.qty_type || 'integer') === t ? ' selected' : '') + '>' + qtyTypeLabel(t) + '</option>').join('') + '</select>'
      : '<span class="u-qty-label">' + esc(_tl) + '</span>';
    html += '<tr data-unit-row="' + u.id + '"><td class="u-name ' + (u.is_active ? '' : 'off') + '">' + esc(u.name) + (u.is_active ? '' : ' <small>（停用）</small>') + '</td><td>' + _typeCell + '</td><td style="text-align:right">';
    if (canManage) {
      html += '<a class="updown" onclick="moveUnit(' + u.id + ', -1)" title="上移">↑</a>' +
              '<a class="updown" onclick="moveUnit(' + u.id + ', 1)" title="下移">↓</a> ' +
              '<label class="settings-switch"><input type="checkbox" ' + (u.is_active ? 'checked' : '') + ' onchange="toggleUnit(' + u.id + ', this.checked)"><span class="slider"></span></label>';
    }
    html += '</td></tr>';
  });
  html += '</table>';
  if (canManage) {
    const groups = groupOrphans(orphanItems);
    if (groups.length) {
      html += '<div class="hist-clean"><b>⚠️ 歷史單位待處理（點開逐筆處理）</b>';
      html += '<div style="font-size:11.5px;color:#a08a3e;margin:4px 0 8px">這些資料可能包含舊式「數量 + 單位」混合格式，需要轉換成標準數量與正式單位。有轉換建議的可一鍵套用；判斷不出的請手填確認，處理完自動消失。</div>';
      groups.forEach(g => {
        html += '<div class="grp"><div class="grp-head" onclick="this.parentElement.classList.toggle(\'open\')">' +
          '<span class="grp-title"><span class="arrow">▶</span> ' + esc(g.label) + '</span>' +
          '<span class="grp-count">' + g.items.length + ' 筆</span></div>' +
          '<div class="grp-body"><table class="g-table">';
        g.items.forEach(it => {
          const _sg = (typeof suggestQtyConvert === 'function') ? suggestQtyConvert(it.unit, it.total_qty) : null;
          const _sgHtml = _sg
            ? '<div class="u-suggest">建議：' + esc(String(_sg.qty)) + ' ' + esc(_sg.unit) + ' <button class="btn-primary" onclick="applyQtySuggest(' + it.item_id + ', this)" data-qty="' + esc(String(_sg.qty)) + '" data-to="' + esc(_sg.unit) + '">套用建議</button></div>'
            : '<div class="u-suggest u-ambiguous">⚠ 需人工確認（無法自動判讀）</div>';
          html += '<tr><td class="p-name">' + esc(it.name) + (it.is_deleted ? ' <small>（非庫存）</small>' : '') + '</td>' +
            '<td class="qty">×' + absNum(it.total_qty) + '</td>' +
            '<td>' + _sgHtml +
            '<div class="u-manual"><select class="u-ci-to" required><option value="">— 請選擇 —</option>';
          unitListActive.forEach(u => { html += '<option>' + esc(u.name) + '</option>'; });
          html += '</select><input class="u-ci-qty" inputmode="decimal" placeholder="新總量（選填）" title="轉換後總量，例：0.75"> <button class="btn-primary" onclick="consolidateItem(' + it.item_id + ', this)">改為</button></div></td></tr>';
        });
        html += '</table><div class="grp-fast">整組快速套用：<select class="u-ci-fast" required><option value="">— 請選擇 —</option>';
        unitListActive.forEach(u => { html += '<option>' + esc(u.name) + '</option>'; });
        html += '</select><button class="btn-primary" data-from="' + esc(g.unit) + '" onclick="consolidateGroup(this)">套用全部</button></div></div></div>';
      });
      html += '</div>';
    } else if (orphanLoadFailed) {
      html += '<div class="hist-clean" style="color:#c62828">⚠️ 歷史單位載入失敗</div>';
    } else {
      html += '<div class="hist-clean" style="color:#2e7d32">✅ 所有品項單位皆在清單中</div>';
    }
  }
  document.getElementById('panel-units').innerHTML = html;
}

async function addUnitFromSettings() {
  const inp = document.getElementById('u-new-name');
  const name = inp ? inp.value.trim() : '';
  const typeSel = document.getElementById('u-new-type');
  const qtyType = typeSel ? typeSel.value : 'integer';
  if (!name) { toast('請輸入單位名稱', 'error'); return; }
  try {
    const res = await fetch('/api/units', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, qty_type: qtyType })
    });
    const data = await res.json();
    if (!res.ok) { toast(data.detail || '新增失敗', 'error'); return; }
    unitList.push(data);
    unitListActive = unitList.filter(u => u.is_active);
    if (inp) inp.value = '';
    renderUnitsPanel();
    toast('✅ 單位「' + name + '」已新增', 'success');
  } catch (e) { toast('新增失敗', 'error'); }
}

async function setUnitQtyType(id, qtyType) {
  try {
    const res = await fetch('/api/units/' + id, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ qty_type: qtyType })
    });
    if (!res.ok) { toast((await res.json()).detail || '操作失敗', 'error'); renderUnitsPanel(); return; }
    const u = unitList.find(x => x.id === id);
    if (u) u.qty_type = qtyType;
    renderUnitsPanel();
    toast('✅ 數量類型已更新', 'success');
  } catch (e) { toast('操作失敗', 'error'); }
}

async function toggleUnit(id, on) {
  try {
    const res = await fetch('/api/units/' + id, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: on })
    });
    if (!res.ok) { toast((await res.json()).detail || '操作失敗', 'error'); renderUnitsPanel(); return; }
    const u = unitList.find(x => x.id === id);
    if (u) u.is_active = on;
    unitListActive = unitList.filter(x => x.is_active);
    renderUnitsPanel();
    toast(on ? '✅ 已啟用' : '已停用', on ? 'success' : '');
  } catch (e) { toast('操作失敗', 'error'); }
}

async function moveUnit(id, dir) {
  const u = unitList.find(x => x.id === id);
  if (!u) return;
  try {
    await fetch('/api/units/' + id, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sort_order: u.sort_order + dir })
    });
    await loadUnits();
    renderUnitsPanel();
  } catch (e) { toast('排序失敗', 'error'); }
}

async function consolidateItem(itemId, btn) {
  const tr = btn.closest('tr');
  const sel = tr ? tr.querySelector('.u-ci-to') : null;
  const to = sel ? sel.value : '';
  if (!to) { toast('請先選擇目標單位', 'error'); return; }
  const qInp = tr ? tr.querySelector('.u-ci-qty') : null;
  const qRaw = qInp ? qInp.value.trim() : '';
  let newQty = null;
  if (qRaw !== '') {
    if (typeof Qty !== 'undefined') {
      const _p = Qty.parse(qRaw);
      if (_p.error || _p.value < 0) { toast(_p.error || '數量不可為負數。', 'error'); return; }
      newQty = _p.value;
    } else {
      newQty = parseFloat(qRaw);
      if (!isFinite(newQty) || newQty < 0) { toast('請輸入有效數量', 'error'); return; }
    }
  }
  const nameEl = tr ? tr.querySelector('.p-name') : null;
  const qtyNote = newQty === null ? '' : '，總量改為 ' + newQty;
  if (!confirm('將「' + (nameEl ? nameEl.textContent : '') + '」的單位改為「' + to + '」' + qtyNote + '？')) return;
  try {
    const res = await fetch('/api/units/consolidate-item', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newQty === null ? { item_id: itemId, to_unit: to } : { item_id: itemId, to_unit: to, new_qty: newQty })
    });
    if (!res.ok) { toast((await res.json()).detail || '改單位失敗', 'error'); return; }
    await Promise.all([loadUnits(), loadOrphans()]);
    renderUnitsPanel();
    toast('✅ 已改為「' + to + '」', 'success');
  } catch (e) { toast('改單位失敗', 'error'); }
}

async function applyQtySuggest(itemId, btn) {
  const qty = parseFloat(btn.dataset.qty);
  const to = btn.dataset.to || '';
  if (!to || !isFinite(qty) || qty < 0) { toast('建議值無效，請手填確認', 'error'); return; }
  const tr = btn.closest('tr');
  const nameEl = tr ? tr.querySelector('.p-name') : null;
  if (!confirm('套用建議：將「' + (nameEl ? nameEl.textContent : '') + '」改為 ' + qty + ' ' + to + '？')) return;
  try {
    const res = await fetch('/api/units/consolidate-item', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: itemId, to_unit: to, new_qty: qty })
    });
    const data = await res.json();
    if (!res.ok) { toast(data.detail || '轉換失敗', 'error'); return; }
    await Promise.all([loadUnits(), loadOrphans()]);
    renderUnitsPanel();
    toast('✅ 已轉換為 ' + qty + ' ' + to, 'success');
  } catch (e) { toast('轉換失敗', 'error'); }
}

async function consolidateGroup(btn) {
  const from = btn.dataset.from;
  const sel = btn.closest('.grp-fast').querySelector('.u-ci-fast');
  const to = sel ? sel.value : '';
  if (!to) { toast('請先選擇目標單位', 'error'); return; }
  const label = from === '' ? '（空白）' : from;
  const n = orphanItems.filter(o => o.unit === from).length;
  if (!confirm('將「' + label + '」全部 ' + n + ' 筆的單位改為「' + to + '」？')) return;
  try {
    const res = await fetch('/api/units/consolidate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from_unit: from, to_unit: to })
    });
    const data = await res.json();
    if (!res.ok) { toast(data.detail || '收編失敗', 'error'); return; }
    await Promise.all([loadUnits(), loadOrphans()]);
    renderUnitsPanel();
    toast('✅ 已收編 ' + data.affected + ' 筆為「' + to + '」', 'success');
  } catch (e) { toast('收編失敗', 'error'); }
}

// ========== 修改密碼 ==========
async function settingsSubmitPw() {
  await submitChangePw();
  setTimeout(clearPwForm, 500);
}

function clearPwForm() {
  ['cpw-old', 'cpw-new', 'cpw-confirm'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  cpwResetChecks();
}

// ========== 行事曆同步面板（左右佈局 v3）==========
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

async function loadGcalSettings() {
  try {
    const res = await fetch('/api/gcal-sync-settings');
    if (res.ok) gcalSettings = await res.json();
  } catch (e) { console.error('[loadGcalSettings]', e); }
}

function renderGcalPanel() {
  const canManage = hasPerm('gcal-keys-manage');
  const canSync = hasPerm('gcal-sync-manage');
  const canForce = hasPerm('gcal-sync-force');

  let html = '<h4>📅 行事曆同步</h4>';

  // 左側 Key 列表 + 右側面板（用 CSS flex 模擬）
  html += '<div class="gcal-layout" style="display:flex;gap:16px;margin-top:12px;align-items:flex-start">';

  // 左側 Key 列表
  html += '<div class="gcal-key-list" style="width:220px;flex-shrink:0;background:#fff;border-radius:12px;border:1px solid #eee;overflow:hidden">';
  gcalKeys.forEach(k => {
    const isActive = k.id === selectedKeyId;
    const cls = k.is_active ? 'on' : 'off';
    html += '<div class="gcal-key-item' + (isActive ? ' active' : '') + '" onclick="selectGcalKey(' + k.id + ')" style="display:flex;align-items:center;gap:10px;padding:10px 12px;cursor:pointer;border-bottom:1px solid #f5f5f5;transition:background .15s' + (isActive ? ';background:#e6f4ff;border-left:3px solid #1890ff' : '') + '">' +
      '<div style="width:30px;height:30px;border-radius:50%;background:' + (k.is_active ? '#52c41a' : '#bbb') + ';color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0">📅</div>' +
      '<div style="flex:1;min-width:0">' +
        '<div style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(k.name) + '</div>' +
        '<div style="font-size:11px;color:#888;margin-top:1px">' + (k.is_active ? '✅ 啟用' : '⏸ 停用') + '</div>' +
        '<div style="font-size:10px;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="' + esc(k.client_email || '') + '">' + esc(k.client_email || 'Client email 未讀取') + '</div>' +
      '</div>' +
      '<div style="width:8px;height:8px;border-radius:50%;background:' + (k.is_active ? '#52c41a' : '#ff4d4f') + ';flex-shrink:0"></div>' +
      '</div>';
  });
  if (canManage) {
    html += '<div onclick="openGcalKeyModal()" style="display:flex;align-items:center;justify-content:center;gap:6px;padding:10px;border-top:1px solid #f0f0f0;color:#1890ff;font-size:13px;cursor:pointer">＋ 新增 Key</div>';
  }
  html += '</div>';

  // 右側面板
  html += '<div class="gcal-detail-panel" style="flex:1;min-width:0;background:#fff;border-radius:12px;border:1px solid #eee;padding:18px 20px">';

  if (selectedKeyId) {
    const key = gcalKeys.find(k => k.id === selectedKeyId);
    if (key) {
      // Panel Head
      html += '<div style="display:flex;align-items:center;gap:12px;padding-bottom:14px;border-bottom:1px solid #f0f0f0">' +
        '<div style="width:40px;height:40px;border-radius:50%;background:#52c41a;color:#fff;display:flex;align-items:center;justify-content:center;font-size:17px">📅</div>' +
        '<div style="flex:1"><div style="font-size:16px;font-weight:700">' + esc(key.name) + '</div>' +
        '<div style="font-size:12px;color:#888;margin-top:2px">' + esc(key.calendar_id) + ' · ' + (key.is_active ? '✅ 啟用中' : '⏸ 停用') + '</div>' +
        '<div style="font-size:12px;color:#2563eb;margin-top:3px">Client email：' + esc(key.client_email || '未讀取') + '</div></div>';
      // 操作按鈕
      if (canManage) {
        html += '<div style="display:flex;gap:6px;align-items:center">' +
          '<label class="settings-switch" title="' + (key.is_active ? '點擊停用' : '點擊啟用') + '"><input type="checkbox" ' + (key.is_active ? 'checked' : '') + ' onchange="toggleGcalKey(' + key.id + ', this.checked)"><span class="slider"></span></label>' +
          '<button onclick="openGcalKeyModal(' + key.id + ')" style="padding:4px 8px;font-size:12px;border:1px solid #ddd;border-radius:6px;background:#fff;cursor:pointer">✏️ 編輯</button>' +
          '<button type="button" onclick="deleteGcalKey(' + key.id + ')" style="padding:4px 8px;font-size:12px;border:1px solid #fecaca;border-radius:6px;background:#fff;color:#dc2626;cursor:pointer">🗑️ 刪除</button>' +
          '</div>';
      }
      html += '</div>';

      // Tabs
      html += '<div style="display:flex;gap:6px;margin:14px 0 4px;border-bottom:1px solid #eee">' +
        '<button class="gcal-tab active" onclick="switchGcalTab(\'sync\')" data-tab="sync">⚙️ 同步設定</button>' +
        '<button class="gcal-tab" onclick="switchGcalTab(\'users\')" data-tab="users">👤 使用者綁定</button>' +
        '</div>';

      // Tab 1: 同步設定
      html += '<div id="gcal-tab-sync">';
      if (canSync) {
        html += renderGcalSyncSettings(key);
      } else {
        html += '<p style="color:#999;font-size:13px;margin-top:16px">無權限修改同步設定</p>';
      }
      html += '</div>';

      // Tab 2: 使用者綁定
      html += '<div id="gcal-tab-users" style="display:none">';
      html += renderGcalUserBind(key);
      html += '</div>';
    }
  } else {
    html += '<div style="text-align:center;padding:40px 20px;color:#999">' +
      '<div style="font-size:36px;margin-bottom:10px">📅</div>' +
      '<p>請選擇左側的 Key 查看設定</p></div>';
  }

  html += '</div>'; // 右側面板結束
  html += '</div>'; // flex 結束

  // 直接同步按鈕
  if (canForce) {
    html += '<div style="margin-top:16px;padding:12px 16px;background:#f0f5ff;border:1px solid #d6e4ff;border-radius:8px;display:flex;align-items:center;justify-content:space-between">' +
      '<div><b>🔄 強制立即同步</b><div style="font-size:12px;color:#666;margin-top:2px">忽略排程間隔，立即執行同步</div></div>' +
      '<button class="btn-primary" onclick="forceSyncNow()">立即同步</button></div>';
  }

  document.getElementById('panel-gcal').innerHTML = html;
}

function renderGcalSyncSettings(key) {
  let html = '';

  // Event 內容區塊
  html += '<div style="margin-top:16px"><div style="font-size:12px;color:#999;font-weight:600;margin-bottom:10px">📍 Event 內容</div>';

  // 地址→地點欄位
  html += '<div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;flex-wrap:wrap">' +
    '<label style="font-size:13px;color:#444;font-weight:600;min-width:140px">地址同步到地點欄位</label>' +
    '<label class="settings-switch"><input type="checkbox" ' + (gcalSettings.gcal_use_location === '1' ? 'checked' : '') + ' onchange="saveGcalSetting(\'gcal_use_location\', this.checked ? \'1\' : \'0\')"><span class="slider"></span></label>' +
    '<span style="font-size:11px;color:#999">客戶地址顯示在 Google Calendar 的「地點」欄位</span></div>';

  // 顯示為
  html += '<div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;flex-wrap:wrap">' +
    '<label style="font-size:13px;color:#444;font-weight:600;min-width:140px">顯示為</label>' +
    '<select onchange="saveGcalSetting(\'gcal_transparency\', this.value)" style="padding:6px 10px;border:1px solid #cfd6df;border-radius:8px;font-size:13px">' +
    '<option value="transparent"' + (gcalSettings.gcal_transparency === 'transparent' ? ' selected' : '') + '>🟢 空閒（不阻塞時段）</option>' +
    '<option value="opaque"' + (gcalSettings.gcal_transparency === 'opaque' ? ' selected' : '') + '>🔴 忙碌（阻塞時段）</option></select>' +
    '<span style="font-size:11px;color:#999">空閒 = 不會阻塞行事曆上的其他邀請</span></div>';
  html += '</div>';

  // 時間設定區塊
  html += '<div style="margin-top:16px"><div style="font-size:12px;color:#999;font-weight:600;margin-bottom:10px">⏰ 時間設定</div>';

  // 預設截止時間
  html += '<div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;flex-wrap:wrap">' +
    '<label style="font-size:13px;color:#444;font-weight:600;min-width:140px">預設截止時間</label>' +
    '<select onchange="saveGcalSetting(\'gcal_default_duration_min\', this.value)" style="padding:6px 10px;border:1px solid #cfd6df;border-radius:8px;font-size:13px">' +
    ['15', '30', '45', '60', '90', '120'].map(v => {
      var label = v === '60' ? '60 分鐘（1 小時）' : v === '120' ? '120 分鐘（2 小時）' : v + ' 分鐘';
      return '<option value="' + v + '"' + (gcalSettings.gcal_default_duration_min === v ? ' selected' : '') + '>' + label + '</option>';
    }).join('') + '</select>' +
    '<span style="font-size:11px;color:#999">未填截止時間的行程，同步時使用此時長</span></div>';

  // 同步間隔
  html += '<div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;flex-wrap:wrap">' +
    '<label style="font-size:13px;color:#444;font-weight:600;min-width:140px">同步間隔</label>' +
    '<input type="number" value="' + (gcalSettings.gcal_sync_interval_min || '5') + '" min="1" max="30" ' +
    'onchange="saveGcalSetting(\'gcal_sync_interval_min\', this.value)" style="padding:6px 10px;border:1px solid #cfd6df;border-radius:8px;font-size:13px;width:70px"> 分鐘' +
    '<span style="font-size:11px;color:#999">背景排程器每 N 分鐘掃描待同步隊列（1~30）</span></div>';
  html += '</div>';

  // Per-Key 提醒設定
  html += '<div style="margin-top:16px"><div style="font-size:12px;color:#999;font-weight:600;margin-bottom:10px">🔔 事件提醒（此 Key 專用）</div>';
  html += '<p style="font-size:12px;color:#999;margin-bottom:12px">同步到 Google Calendar 時附帶的提醒通知。</p>';

  var reminders = (key.reminders || []).filter(r => r.method === 'popup');
  if (!reminders.length) reminders = [{ method: 'popup', minutes: 30 }];
  reminders = reminders.slice(0, 5);
  var reminderDisplay = function(minutes) {
    var units = [['weeks', 10080], ['days', 1440], ['hours', 60], ['minutes', 1]];
    var total = Number(minutes) || 0;
    for (var i = 0; i < units.length; i += 1) {
      if (total === 0 || total % units[i][1] === 0) return { value: total / units[i][1], unit: units[i][0] };
    }
    return { value: total, unit: 'minutes' };
  };
  var reminderRow = function(reminder, index) {
    var display = reminderDisplay(reminder.minutes);
    return '<div class="gcal-reminder-row" data-reminder-index="' + index + '">' +
      '<div class="gcal-reminder-label">🔔 提前通知 ' + (index + 1) + '</div>' +
      '<div class="gcal-reminder-control">' +
      '<input type="number" id="gcal-reminder-val-' + key.id + '-' + index + '" value="' + display.value + '" min="0" max="40320">' +
      '<select id="gcal-reminder-unit-' + key.id + '-' + index + '">' +
      '<option value="minutes"' + (display.unit === 'minutes' ? ' selected' : '') + '>分鐘</option><option value="hours"' + (display.unit === 'hours' ? ' selected' : '') + '>小時</option><option value="days"' + (display.unit === 'days' ? ' selected' : '') + '>天</option><option value="weeks"' + (display.unit === 'weeks' ? ' selected' : '') + '>週</option></select></div>' +
      '<button type="button" class="gcal-reminder-remove" onclick="removeGcalReminderRow(' + key.id + ',' + index + ')"' + (reminders.length <= 1 ? ' disabled' : '') + '>移除</button>' +
      '<span class="gcal-reminder-hint">Google Calendar Popup 提醒</span></div>';
  };
  html += '<div class="gcal-reminders-list" id="gcal-reminders-' + key.id + '">' + reminders.map(reminderRow).join('') + '</div>';
  html += '<button type="button" class="gcal-add-reminder" onclick="addGcalReminderRow(' + key.id + ')"' + (reminders.length >= 5 ? ' disabled' : '') + '>＋ 新增通知（最多 5 個）</button>';
  html += '<div style="margin-top:10px;padding:8px 12px;background:#f0f5ff;border:1px solid #d6e4ff;border-radius:6px;font-size:11.5px;color:#2d5a8e">' +
    '💡 Google Calendar API 上限：最長 4 週（40320 分鐘）= 672 小時 = 28 天 = 4 週</div>';

  // 儲存提醒按鈕
  html += '<button class="btn-primary" style="margin-top:12px" onclick="saveKeyReminders(' + key.id + ')">💾 儲存提醒設定</button>';
  html += '</div>';

  return html;
}

function renderGcalUserBind(key) {
  let html = '<p style="font-size:13px;color:#666;margin:12px 0">指派人員綁定此 Key → 該人員的行程同步到這本行事曆。</p>';
  html += '<table style="width:100%;font-size:12.5px;border-collapse:collapse"><thead><tr>' +
    '<th style="text-align:left;padding:7px 6px;border-bottom:2px solid #e0e0e0;color:#666;font-size:12px">使用者</th>' +
    '<th style="text-align:left;padding:7px 6px;border-bottom:2px solid #e0e0e0;color:#666;font-size:12px">綁定 Key</th></tr></thead><tbody>';
  gcalUsers.forEach(u => {
    html += '<tr><td style="padding:7px 6px;border-bottom:1px solid #f0f0f0">👤 ' + esc(u.display_name || u.username) + '</td><td style="padding:7px 6px;border-bottom:1px solid #f0f0f0">' +
      '<select onchange="bindGcalUser(' + u.id + ', this.value)" style="padding:4px 8px;border:1px solid #cfd6df;border-radius:6px;font-size:12px">' +
      '<option value=""' + (!u.gcal_key ? ' selected' : '') + '>— 未綁定 —</option>';
    gcalKeys.filter(k => k.is_active).forEach(k => {
      html += '<option value="' + esc(k.name) + '"' + (u.gcal_key === k.name ? ' selected' : '') + '>' + esc(k.name) + '</option>';
    });
    html += '</select></td></tr>';
  });
  html += '</tbody></table>';
  html += '<p style="font-size:11px;color:#999;margin-top:8px">未綁定 Key 的使用者，其指派的行程不會同步到任何行事曆。</p>';
  return html;
}

function selectGcalKey(id) {
  selectedKeyId = id;
  renderGcalPanel();
}

function switchGcalTab(tab) {
  document.querySelectorAll('.gcal-tab').forEach(t => t.classList.remove('active'));
  document.querySelector('.gcal-tab[data-tab="' + tab + '"]').classList.add('active');
  document.getElementById('gcal-tab-sync').style.display = tab === 'sync' ? '' : 'none';
  document.getElementById('gcal-tab-users').style.display = tab === 'users' ? '' : 'none';
}

async function saveGcalSetting(key, value) {
  try {
    await fetch('/api/gcal-sync-settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [key]: value })
    });
    gcalSettings[key] = value;
    toast('✅ 已儲存', 'success');
  } catch (e) { toast('儲存失敗', 'error'); }
}

async function saveKeyReminders(keyId) {
  const rows = Array.from(document.querySelectorAll('#gcal-reminders-' + keyId + ' .gcal-reminder-row'));
  // 儲存時重新依目前 DOM 的列順序組合；index 不是永久識別碼，刪除後由 reindexGcalReminders() 重排。
  if (!rows.length || rows.length > 5) return toast('通知數量需為 1~5 個', 'error');
  const reminders = [];
  for (let i = 0; i < rows.length; i += 1) {
    const index = rows[i].dataset.reminderIndex;
    const value = Number(document.getElementById('gcal-reminder-val-' + keyId + '-' + index).value);
    const unit = document.getElementById('gcal-reminder-unit-' + keyId + '-' + index).value;
    const minutes = unit === 'weeks' ? value * 10080 : unit === 'days' ? value * 1440 : unit === 'hours' ? value * 60 : value;
    if (!Number.isInteger(value) || value < 0 || minutes > 40320) return toast('通知時間需介於 0 分鐘至 4 週', 'error');
    reminders.push({ method: 'popup', minutes: minutes });
  }
  try {
    const res = await fetch('/api/gcal-keys/' + keyId + '/reminders', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reminders: reminders })
    });
    if (!res.ok) { toast((await res.json()).detail || '儲存失敗', 'error'); return; }
    const key = gcalKeys.find(k => k.id === keyId);
    if (key) key.reminders = reminders;
    renderGcalPanel();
    toast('✅ 提醒設定已儲存', 'success');
  } catch (e) { toast('儲存失敗', 'error'); }
}

function addGcalReminderRow(keyId) {
  const container = document.getElementById('gcal-reminders-' + keyId);
  if (!container || container.children.length >= 5) return;
  const index = container.children.length;
  const row = document.createElement('div');
  row.className = 'gcal-reminder-row';
  row.dataset.reminderIndex = index;
  row.innerHTML = '<div class="gcal-reminder-label">🔔 提前通知 ' + (index + 1) + '</div><div class="gcal-reminder-control"><input type="number" id="gcal-reminder-val-' + keyId + '-' + index + '" value="30" min="0" max="40320"><select id="gcal-reminder-unit-' + keyId + '-' + index + '"><option value="minutes" selected>分鐘</option><option value="hours">小時</option><option value="days">天</option><option value="weeks">週</option></select></div><button type="button" class="gcal-reminder-remove" onclick="removeGcalReminderRow(' + keyId + ',' + index + ')">移除</button><span class="gcal-reminder-hint">Google Calendar Popup 提醒</span>';
  container.appendChild(row);
  const add = document.querySelector('.gcal-add-reminder[onclick="addGcalReminderRow(' + keyId + ')"]');
  if (add && container.children.length >= 5) add.disabled = true;
}

function removeGcalReminderRow(keyId, index) {
  const container = document.getElementById('gcal-reminders-' + keyId);
  if (!container || container.children.length <= 1) return;
  const row = container.querySelector('[data-reminder-index="' + index + '"]');
  if (row) row.remove();
  Array.from(container.children).forEach((item, i) => {
    item.dataset.reminderIndex = i;
    const value = item.querySelector('input[type="number"]');
    const unit = item.querySelector('select');
    if (value) value.id = 'gcal-reminder-val-' + keyId + '-' + i;
    if (unit) unit.id = 'gcal-reminder-unit-' + keyId + '-' + i;
    const label = item.querySelector('.gcal-reminder-label');
    if (label) label.textContent = '🔔 提前通知 ' + (i + 1);
  });
  const add = document.querySelector('.gcal-add-reminder[onclick="addGcalReminderRow(' + keyId + ')"]');
  if (add) add.disabled = container.children.length >= 5;
}


async function forceSyncNow() {
  if (!confirm('確定要立即執行同步？')) return;
  try {
    var res = await fetch('/api/gcal-sync-now', { method: 'POST' });
    if (!res.ok) { toast((await res.json()).detail || '同步失敗', 'error'); return; }
    toast('✅ 同步信號已發送，3 秒後自動更新狀態…', 'success');
    // 3 秒後刷新行事曆（sync 在背景跑，等它完成）
    setTimeout(async () => {
      if (typeof calLoadData === 'function') {
        try {
          await calLoadData();
          if (typeof calRenderMonth === 'function') calRenderMonth();
          if (typeof calRenderDay === 'function') calRenderDay();
          toast('🔄 行事曆已更新', 'success');
        } catch (e) { console.error('[forceSyncNow] 刷新失敗', e); }
      }
    }, 3000);
  } catch (e) { toast('同步失敗', 'error'); }
}

async function toggleGcalKey(id, on) {
  try {
    const res = await fetch('/api/gcal-keys/' + id, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: on })
    });
    if (!res.ok) { toast((await res.json()).detail || '操作失敗', 'error'); return; }
    const k = gcalKeys.find(x => x.id === id);
    if (k) k.is_active = on;
    renderGcalPanel();
    toast(on ? '✅ 已啟用' : '已停用', on ? 'success' : '');
  } catch (e) { toast('操作失敗', 'error'); }
}

async function deleteGcalKey(id) {
  const key = gcalKeys.find(k => k.id === id);
  const name = key ? key.name : '未知';
  if (!confirm('確定要刪除 Key「' + name + '」？\n\n此操作會同時刪除 Google 行事曆上已同步的事件。')) return;
  try {
    const res = await fetch('/api/gcal-keys/' + id, { method: 'DELETE' });
    if (!res.ok) { toast((await res.json()).detail || '刪除失敗', 'error'); return; }
    const data = await res.json();
    gcalKeys = gcalKeys.filter(k => k.id !== id);
    if (selectedKeyId === id) selectedKeyId = gcalKeys.length ? gcalKeys[0].id : null;
    renderGcalPanel();
    var msg = '✅ Key「' + name + '」已刪除';
    if (data.google_deleted > 0) msg += '（Google 事件 ' + data.google_deleted + ' 筆已清除）';
    if (data.google_failed > 0) msg += '⚠️ Google 事件 ' + data.google_failed + ' 筆清除失敗';
    toast(msg, data.google_failed > 0 ? 'error' : 'success');
  } catch (e) { toast('❌ 刪除失敗：' + e.message, 'error'); }
}

async function bindGcalUser(userId, keyName) {
  try {
    const res = await fetch('/api/users/' + userId, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
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
  if (!user) return;
  const canUnits = hasPerm('unit-mgmt');
  const canPettyOptions = hasPerm('petty-cash-config');
  if (!canUnits) {
    const item = document.querySelector('#settingsSideList .side-item[data-panel="units"]');
    if (item) item.style.display = 'none';
  }
  if (!canPettyOptions) {
    const item = document.querySelector('#settingsSideList .side-item[data-panel="petty-cash"]');
    if (item) item.style.display = 'none';
  }
  const chipBar = document.getElementById('settingsChipBar');
  if (chipBar) {
    chipBar.innerHTML = [
      ['units', '📦 單位管理'],
      ['gcal', '📅 行事曆同步'],
      ['petty-cash', '🪙 零用金選單'],
      ['pw', '🔑 修改密碼']
    ].filter(([p]) => (p !== 'units' || canUnits) && (p !== 'petty-cash' || canPettyOptions))
     .map(([p, label]) => '<span class="chip' + (p === 'units' ? ' active' : '') + '" data-panel="' + p + '" onclick="settingsSwitch(\'' + p + '\')">' + label + '</span>')
     .join('');
  }
  await Promise.all([loadUnits(), loadOrphans(), loadGcalKeys(), loadGcalUsers(), loadGcalSettings(), loadPettyOptions()]);
  // 預選第一個 key
  if (gcalKeys.length && !selectedKeyId) selectedKeyId = gcalKeys[0].id;
  settingsSwitch(canUnits ? 'units' : canPettyOptions ? 'petty-cash' : 'pw');
})();
