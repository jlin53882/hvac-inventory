// 庫存管理系統 - 設定頁：單位管理與孤兒單位收編

import { apiFetch } from '../../core/api-client.js';
import { Qty } from '../../core/qty.js';
import { appState } from '../../core/state.js';
import { getActiveUnitList } from '../../core/shared-read-model.js';
import { loadUnits, unitList } from '../../core/units.js';
import { absNum, esc, hasPerm, toast } from '../../core/utils.js';
import { loadCabinets } from './cabinets.js';

var orphanItems = [];
var orphanLoadFailed = false;

// ========== 單位管理面板 ==========
export async function loadOrphans() {
  try {
    orphanItems = await apiFetch('/api/units/orphans');
    orphanLoadFailed = false;
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

export function renderUnitsPanel() {
  const canManage = hasPerm('unit-mgmt');
  const canAdd = hasPerm('item-mgmt');
  let html = '<h4>📦 單位管理</h4>';
  if (canAdd) {
    html += '<div class="u-add-row"><input id="u-new-name" placeholder="新單位名稱（例：顆）" maxlength="20">' +
            '<select id="u-new-type" title="數量輸入類型"><option value="integer">整數</option><option value="decimal">小數</option><option value="fraction">分數/小數</option></select>' +
            '<button class="btn btn--primary btn--md btn-primary" onclick="Settings.addUnitFromSettings()">＋ 新增</button></div>';
  }
  html += '<table class="u-table"><thead><tr><th>單位名稱</th><th>數量類型</th><th class="u-ta-right">操作</th></tr></thead>';
  unitList.forEach(u => {
    const _tl = qtyTypeLabel(u.qty_type);
    const _typeCell = canManage
      ? '<select class="u-qty-type" onchange="Settings.setUnitQtyType(' + u.id + ', this.value)" title="數量輸入類型">' +
        ['integer', 'decimal', 'fraction'].map(t => '<option value="' + t + '"' + ((u.qty_type || 'integer') === t ? ' selected' : '') + '>' + qtyTypeLabel(t) + '</option>').join('') + '</select>'
      : '<span class="u-qty-label">' + esc(_tl) + '</span>';
    html += '<tr data-unit-row="' + u.id + '"><td class="u-name ' + (u.is_active ? '' : 'is-inactive') + '">' + esc(u.name) + (u.is_active ? '' : ' <small>（停用）</small>') + '</td><td>' + _typeCell + '</td><td class="u-ta-right">';
    if (canManage) {
      html += '<a class="updown" onclick="Settings.moveUnit(' + u.id + ', -1)" title="上移">↑</a>' +
              '<a class="updown" onclick="Settings.moveUnit(' + u.id + ', 1)" title="下移">↓</a> ' +
              '<label class="settings-switch"><input type="checkbox" ' + (u.is_active ? 'checked' : '') + ' onchange="Settings.toggleUnit(' + u.id + ', this.checked)"><span class="slider"></span></label>';
    }
    html += '</td></tr>';
  });
  html += '</table>';
  if (canManage) {
    const groups = groupOrphans(orphanItems);
    if (groups.length) {
      html += '<div class="hist-clean"><b>⚠️ 歷史單位待處理（點開逐筆處理）</b>';
      html += '<div class="hist-clean-desc">這些資料可能包含舊式「數量 + 單位」混合格式，需要轉換成標準數量與正式單位。有轉換建議的可一鍵套用；判斷不出的請手填確認，處理完自動消失。</div>';
      groups.forEach(g => {
        html += '<div class="grp"><div class="grp-head" onclick="this.parentElement.classList.toggle(\'is-open\')">' +
          '<span class="grp-title"><span class="arrow">▶</span> ' + esc(g.label) + '</span>' +
          '<span class="grp-count">' + g.items.length + ' 筆</span></div>' +
          '<div class="grp-body"><table class="g-table">';
        g.items.forEach(it => {
          const _sg = suggestQtyConvert(it.unit, it.total_qty);
          const _sgHtml = _sg
            ? '<div class="u-suggest">建議：' + esc(String(_sg.qty)) + ' ' + esc(_sg.unit) + ' <button class="btn btn--primary btn--sm btn-primary" onclick="Settings.applyQtySuggest(' + it.item_id + ', this)" data-qty="' + esc(String(_sg.qty)) + '" data-to="' + esc(_sg.unit) + '">套用建議</button></div>'
            : '<div class="u-suggest u-ambiguous">⚠ 需人工確認（無法自動判讀）</div>';
          html += '<tr><td class="p-name" data-role="item-name">' + esc(it.name) + (it.is_deleted ? ' <small>（非庫存）</small>' : '') + '</td>' +
            '<td class="qty">×' + absNum(it.total_qty) + '</td>' +
            '<td>' + _sgHtml +
            '<div class="u-manual"><select class="u-ci-to" data-role="unit-consolidate-to" required><option value="">— 請選擇 —</option>';
          getActiveUnitList().forEach(u => { html += '<option>' + esc(u.name) + '</option>'; });
          html += '</select><input class="u-ci-qty" data-role="unit-consolidate-qty" inputmode="decimal" placeholder="新總量（選填）" title="轉換後總量，例：0.75"> <button class="btn btn--primary btn--sm btn-primary" onclick="Settings.consolidateItem(' + it.item_id + ', this)">改為</button></div></td></tr>';
        });
        html += '</table><div class="grp-fast" data-role="unit-group-fast">整組快速套用：<select class="u-ci-fast" data-role="unit-consolidate-fast" required><option value="">— 請選擇 —</option>';
        getActiveUnitList().forEach(u => { html += '<option>' + esc(u.name) + '</option>'; });
        html += '</select><button class="btn btn--primary btn--sm btn-primary" data-from="' + esc(g.unit) + '" onclick="Settings.consolidateGroup(this)">套用全部</button></div></div></div>';
      });
      html += '</div>';
    } else if (orphanLoadFailed) {
      html += '<div class="hist-clean--error hist-clean">⚠️ 歷史單位載入失敗</div>';
    } else {
      html += '<div class="hist-clean--ok hist-clean">✅ 所有品項單位皆在清單中</div>';
    }
  }
  document.getElementById('panel-units').innerHTML = html;
}

export async function addUnitFromSettings() {
  const inp = document.getElementById('u-new-name');
  const name = inp ? inp.value.trim() : '';
  const typeSel = document.getElementById('u-new-type');
  const qtyType = typeSel ? typeSel.value : 'integer';
  if (!name) { toast('請輸入單位名稱', 'error'); return; }
  try {
    const data = await apiFetch('/api/units', {
      method: 'POST', json: { name: name, qty_type: qtyType }, fallback: '新增失敗'
    });
    unitList.push(data);
    appState.unitListActive = unitList.filter(u => u.is_active);
    if (inp) inp.value = '';
    renderUnitsPanel();
    toast('✅ 單位「' + name + '」已新增', 'success');
  } catch (e) { toast(e.message, 'error'); }
}

export async function setUnitQtyType(id, qtyType) {
  try {
    await apiFetch('/api/units/' + id, {
      method: 'PUT', json: { qty_type: qtyType }, fallback: '操作失敗'
    });
    const u = unitList.find(x => x.id === id);
    if (u) u.qty_type = qtyType;
    renderUnitsPanel();
    toast('✅ 數量類型已更新', 'success');
  } catch (e) { toast(e.message, 'error'); renderUnitsPanel(); }
}

export async function toggleUnit(id, on) {
  try {
    await apiFetch('/api/units/' + id, {
      method: 'PUT', json: { is_active: on }, fallback: '操作失敗'
    });
    const u = unitList.find(x => x.id === id);
    if (u) u.is_active = on;
    appState.unitListActive = unitList.filter(x => x.is_active);
    renderUnitsPanel();
    toast(on ? '✅ 已啟用' : '已停用', on ? 'success' : '');
  } catch (e) { toast(e.message, 'error'); renderUnitsPanel(); }
}

export async function moveUnit(id, dir) {
  const u = unitList.find(x => x.id === id);
  if (!u) return;
  try {
    await apiFetch('/api/units/' + id, {
      method: 'PUT', json: { sort_order: u.sort_order + dir }, fallback: '排序失敗'
    });
    await loadUnits();
    renderUnitsPanel();
  } catch (e) { toast(e.message, 'error'); }
}

export async function consolidateItem(itemId, btn) {
  const tr = btn.closest('tr');
  const sel = tr ? tr.querySelector('[data-role="unit-consolidate-to"]') : null;
  const to = sel ? sel.value : '';
  if (!to) { toast('請先選擇目標單位', 'error'); return; }
  const qInp = tr ? tr.querySelector('[data-role="unit-consolidate-qty"]') : null;
  const qRaw = qInp ? qInp.value.trim() : '';
  let newQty = null;
  if (qRaw !== '') {
    const _p = Qty.parse(qRaw);
    if (_p.error || _p.value < 0) { toast(_p.error || '數量不可為負數。', 'error'); return; }
    newQty = _p.value;
  }
  const nameEl = tr ? tr.querySelector('[data-role="item-name"]') : null;
  const qtyNote = newQty === null ? '' : '，總量改為 ' + newQty;
  if (!confirm('將「' + (nameEl ? nameEl.textContent : '') + '」的單位改為「' + to + '」' + qtyNote + '？')) return;
  try {
    await apiFetch('/api/units/consolidate-item', {
      method: 'POST', json: newQty === null ? { item_id: itemId, to_unit: to } : { item_id: itemId, to_unit: to, new_qty: newQty },
      fallback: '改單位失敗'
    });
    await Promise.all([loadUnits(), loadOrphans()]);
    renderUnitsPanel();
    toast('✅ 已改為「' + to + '」', 'success');
  } catch (e) { toast(e.message, 'error'); }
}

export async function applyQtySuggest(itemId, btn) {
  const qty = parseFloat(btn.dataset.qty);
  const to = btn.dataset.to || '';
  if (!to || !isFinite(qty) || qty < 0) { toast('建議值無效，請手填確認', 'error'); return; }
  const tr = btn.closest('tr');
  const nameEl = tr ? tr.querySelector('[data-role="item-name"]') : null;
  if (!confirm('套用建議：將「' + (nameEl ? nameEl.textContent : '') + '」改為 ' + qty + ' ' + to + '？')) return;
  try {
    await apiFetch('/api/units/consolidate-item', {
      method: 'POST', json: { item_id: itemId, to_unit: to, new_qty: qty }, fallback: '轉換失敗'
    });
    await Promise.all([loadUnits(), loadOrphans()]);
    renderUnitsPanel();
    toast('✅ 已轉換為 ' + qty + ' ' + to, 'success');
  } catch (e) { toast(e.message, 'error'); }
}

export async function consolidateGroup(btn) {
  const from = btn.dataset.from;
  const sel = btn.closest('[data-role="unit-group-fast"]').querySelector('[data-role="unit-consolidate-fast"]');
  const to = sel ? sel.value : '';
  if (!to) { toast('請先選擇目標單位', 'error'); return; }
  const label = from === '' ? '（空白）' : from;
  const n = orphanItems.filter(o => o.unit === from).length;
  if (!confirm('將「' + label + '」全部 ' + n + ' 筆的單位改為「' + to + '」？')) return;
  try {
    const data = await apiFetch('/api/units/consolidate', {
      method: 'POST', json: { from_unit: from, to_unit: to }, fallback: '收編失敗'
    });
    await Promise.all([loadUnits(), loadOrphans()]);
    renderUnitsPanel();
    toast('✅ 已收編 ' + data.affected + ' 筆為「' + to + '」', 'success');
  } catch (e) { toast(e.message, 'error'); }
}

// 模組載入時要執行的副作用：由頁面 entry 依原本的載入順序呼叫（issue #39）
export function initSettingsUnits() {
  // 2026-09-27 頁面載入完成後：重新載入單位並重繪、預先載入櫃子清單（原本寫在 settings.html 的 inline script）
  window.addEventListener('load', async () => {
    await loadUnits();
    renderUnitsPanel();
    await loadCabinets();
  });
}
