// 庫存管理系統 - 設定頁：櫃子管理

import { apiFetch } from '../../core/api-client.js';
import { closeModalForce, esc, openModal, toast } from '../../core/utils.js';

// ========== 櫃子管理（2026-09-27 多位置共用） ==========
var cabinetList = [];

export async function loadCabinets() {
  try {
    cabinetList = await apiFetch('/api/cabinets', { fallback: '查詢櫃子清單失敗' });
    renderCabinetTable();
  } catch (e) {
    toast('⚠️ ' + e.message, 'error');
  }
}

function renderCabinetTable() {
  const tbody = document.getElementById('cabinetList');
  if (!tbody) return;
  if (!cabinetList.length) {
    tbody.innerHTML = '<tr><td colspan="3" class="cabinet-empty">尚未新增任何櫃子</td></tr>';
    return;
  }
  tbody.innerHTML = cabinetList.map(c => `
    <tr>
      <td><strong>${esc(c.name)}</strong></td>
      <td>${esc(c.note || '（無備註）')}</td>
      <td class="cabinet-actions">
        <button class="btn btn--secondary btn--sm btn-save u-shrink-0" onclick="Settings.editCabinet(${c.id})">✎ 編輯</button>
        <button class="btn btn--danger btn--sm btn-cancel-ghost u-shrink-0" onclick="Settings.deleteCabinet(${c.id})">🗑 刪除</button>
      </td>
    </tr>
  `).join('');
}

export async function addCabinet() {
  const name = document.getElementById('cabinet-name').value.trim();
  const note = document.getElementById('cabinet-note').value.trim();
  if (!name) {
    toast('請輸入櫃子編號或名稱', 'error');
    return;
  }
  try {
    const data = await apiFetch('/api/cabinets', {
      method: 'POST',
      json: { name, note },
      fallback: '新增失敗'
    });
    cabinetList.push(data);
    renderCabinetTable();
    document.getElementById('cabinet-name').value = '';
    document.getElementById('cabinet-note').value = '';
    toast('✅ 已新增櫃子「' + name + '」', 'success');
  } catch (e) {
    toast('⚠️ ' + e.message, 'error');
  }
}

export async function deleteCabinet(cabinetId) {
  const cab = cabinetList.find(c => c.id === cabinetId);
  if (!cab || !confirm('確定刪除櫃子「' + cab.name + '」？')) return;
  try {
    // 櫃子仍被單一庫存/整組位置使用時後端回 409，錯誤訊息會帶出原因
    await apiFetch(`/api/cabinets/${cabinetId}`, { method: 'DELETE', fallback: '刪除失敗' });
    cabinetList = cabinetList.filter(c => c.id !== cabinetId);
    renderCabinetTable();
    toast('✅ 已刪除櫃子', 'success');
  } catch (e) {
    toast('⚠️ ' + e.message, 'error');
  }
}

// Settings 初始化（與 Units 一樣調用）
export async function initCabinetsTab() {
  await loadCabinets();
}

// 2026-09-27：編輯櫃子邏輯
var currentEditCabinetId = null;
export function editCabinet(id) {
  const cabinet = cabinetList.find(c => c.id === id);
  if (!cabinet) return;
  currentEditCabinetId = id;
  document.getElementById('edit-cabinet-name').value = cabinet.name || '';
  document.getElementById('edit-cabinet-note').value = cabinet.note || '';
  openModal('edit-cabinet-modal');
}

export async function submitCabinetEdit() {
  const name = document.getElementById('edit-cabinet-name').value.trim();
  if (!name) {
    toast('請輸入櫃子編號或名稱', 'error');
    return;
  }
  const note = document.getElementById('edit-cabinet-note').value.trim();
  try {
    const data = await apiFetch(`/api/cabinets/${currentEditCabinetId}`, {
      method: 'PUT',
      json: { name, note },
      fallback: '編輯失敗'
    });
    const idx = cabinetList.findIndex(c => c.id === currentEditCabinetId);
    if (idx >= 0) {
      cabinetList[idx] = data;
    }
    renderCabinetTable();
    closeModalForce('edit-cabinet-modal');
    toast('✅ 已編輯櫃子「' + name + '」', 'success');
  } catch (e) {
    toast('⚠️ ' + e.message, 'error');
  }
}
