// 庫存管理系統 - 行事曆 ⚙️ 設定（admin；2026-08-16 從 render/calendar.js 拆出）

import { apiFetch } from '../../core/api-client.js';
import { CAL_PALETTE } from './state.js';
import { esc, toast } from '../../core/utils.js';
import { calendarState } from './state.js';

export function calSettingsHtml(isAdmin) {
  if (!isAdmin) return '';
  return `
  <div class="modal-overlay" data-role="modal" id="cal-set-modal" style="display:none">
    <div class="modal">
      <h3>⚙️ 行事曆設定</h3>
      <div class="cal-set-tabs">
        <button class="chip chip--seg is-active" id="cal-tab-svc" data-action="cal-settings-tab" data-tab="svc">服務項目</button>
        <button class="chip chip--seg" id="cal-tab-ppl" data-action="cal-settings-tab" data-tab="ppl">人員與顏色</button>
      </div>
      <div id="cal-tab-svc-panel">
        <table class="cal-set-table">
          <thead><tr><th>名稱</th><th>排序</th><th>啟用</th><th></th></tr></thead>
          <tbody id="cal-svc-rows"></tbody>
        </table>
        <div class="cal-add-row">
          <input type="text" id="cal-svc-new" placeholder="新服務項目名稱（例：報價勘查）">
          <button class="btn btn--primary btn--sm btn-sm btn-primary" data-action="cal-svc-add">＋ 加入</button>
        </div>
        <div class="cal-hint">日報表勾選欄位固定：保養 / 維修 / 施工 / 場勘（其他服務匯出時附註於地點欄）</div>
      </div>
      <div id="cal-tab-ppl-panel" style="display:none">
        <table class="cal-set-table">
          <thead><tr><th>人員</th><th>角色</th><th>顏色</th></tr></thead>
          <tbody id="cal-ppl-rows"></tbody>
        </table>
        <div class="cal-hint">顏色只影響行事曆與日報表顯示；人員啟用/停用請到 👥 使用者管理</div>
      </div>
      <div class="modal-actions">
        <button class="btn btn--primary btn--md btn-confirm" data-action="cal-modal-close">完成</button>
      </div>
    </div>
  </div>`;
}

// ========== 資料載入 ==========
export function calSetTab(t) {
  ['svc', 'ppl'].forEach(x => {
    // 只切 panel 顯示 + tab 按鈕 active class（按鈕本身不能隱藏，否則切不回來）
    document.getElementById('cal-tab-' + x + '-panel').style.display = x === t ? 'block' : 'none';
    document.getElementById('cal-tab-' + x).className = 'chip chip--seg' + (x === t ? ' is-active' : '');
  });
  if (t === 'svc') calRenderSvcRows();
  else calRenderPplRows();
}

export function calOpenSettings() {
  calRenderSvcRows();
  calRenderPplRows();
  document.getElementById('cal-set-modal').style.display = 'flex';
}

function calRenderSvcRows() {
  const tb = document.getElementById('cal-svc-rows');
  tb.innerHTML = '';
  [...calendarState.calSvc].sort((a, b) => a.sort_order - b.sort_order).forEach(s => {
    tb.innerHTML += `<tr>
      <td>${esc(s.name)}</td>
      <td><input type="number" value="${s.sort_order}" class="cal-set-sort-input" data-action="cal-svc-update" data-id="${s.id}"></td>
      <td><button class="switch ${s.is_active ? 'is-active' : ''}" data-action="cal-svc-active" data-id="${s.id}"></button></td>
      <td>${s.is_active ? `<button class="btn btn--danger btn--sm btn-delete" data-action="cal-svc-delete" data-id="${s.id}">停用</button>` : '<span class="cal-off">已停用</span>'}</td>
    </tr>`;
  });
}

export async function calUpdSvc(id, sort) {
  const s = calendarState.calSvc.find(x => x.id === id);
  if (!s) return;
  try {
    await apiFetch(`/api/service-types/${id}`, { method: 'PUT', json: { name: s.name, sort_order: Number(sort) || 0, is_active: s.is_active } });
  } catch (e) { toast('❌ 更新失敗'); return; }
  s.sort_order = Number(sort) || 0;
  calRenderSvcRows();
  toast('✅ 已更新');
}

export async function calUpdSvcActive(id) {
  const s = calendarState.calSvc.find(x => x.id === id);
  if (!s) return;
  try {
    await apiFetch(`/api/service-types/${id}`, { method: 'PUT', json: { name: s.name, sort_order: s.sort_order, is_active: s.is_active ? 0 : 1 } });
  } catch (e) { toast('❌ 更新失敗'); return; }
  s.is_active = s.is_active ? 0 : 1;
  calRenderSvcRows();
  toast(s.is_active ? '✅ 已啟用' : '已停用');
}

export async function calAddSvc() {
  const v = document.getElementById('cal-svc-new').value.trim();
  if (!v) return;
  let data;
  try {
    data = await apiFetch('/api/service-types', { method: 'POST', json: { name: v, sort_order: calendarState.calSvc.length + 1, is_active: 1 }, fallback: '新增失敗' });
  } catch (e) { toast('❌ ' + e.message); return; }
  document.getElementById('cal-svc-new').value = '';
  calendarState.calSvc.push(data);
  calRenderSvcRows();
  toast(`✅ 已新增「${v}」`);
}

export async function calDelSvc(id) {
  if (!confirm('確定停用此服務項目嗎？（舊行程不受影響）')) return;
  try {
    await apiFetch(`/api/service-types/${id}`, { method: 'DELETE' });
  } catch (e) { toast('❌ 停用失敗'); return; }
  const s = calendarState.calSvc.find(x => x.id === id);
  if (s) s.is_active = 0;
  calRenderSvcRows();
  toast('已停用');
}

function calRenderPplRows() {
  const tb = document.getElementById('cal-ppl-rows');
  tb.innerHTML = '';
  const roleName = { admin: '管理員', user: '使用者', viewer: '檢視者' };
  calendarState.calAssignable.forEach(p => {
    tb.innerHTML += `<tr>
      <td>${esc(p.display_name || p.username)}</td>
      <td>${esc(roleName[p.role] || p.role || '')}</td>
      <td><div class="cal-color-dots">${CAL_PALETTE.map(c =>
        `<span style="background:${c}" class="${(p.color || CAL_PALETTE[0]) === c ? 'sel' : ''}" data-action="cal-person-color" data-id="${p.id}" data-color="${c}"></span>`).join('')}</div></td>
    </tr>`;
  });
}

export async function calSetColor(uid, color) {
  try {
    await apiFetch(`/api/users/${uid}`, { method: 'PUT', json: { color } });
  } catch (e) { toast('❌ 顏色更新失敗'); return; }
  const p = calendarState.calAssignable.find(x => x.id === uid);
  if (p) p.color = color;
  calRenderPplRows();
  toast('✅ 顏色已更新');
}
