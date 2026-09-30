// 庫存管理系統 - 庫存品項操作選單（編輯 / 調撥 / 刪除、手機 action sheet）

import { apiFetch } from '../../core/api-client.js';
import { openSheet } from '../../core/bottomsheet.js';
import { loadData } from '../shell/data-refresh.js';
import { getAllItems } from '../../core/inventory-read-model.js';
import { hasPerm } from '../../core/utils.js';
import { openEditModal } from './edit-modal.js';
import { openTransferModal } from './transfer-modal.js';

function getInventoryItemActions(itemId, isViewer, includePhoto) {
  if (isViewer) return [];
  const actions = [
    { key: 'edit', icon: '✏️', label: '編輯品項', fn: () => openEditModal(itemId) }
  ];
  if (includePhoto !== false) actions.push({ key: 'photo', icon: '📷', label: '更換照片', fn: () => openEditModal(itemId) });
  if (hasPerm('stock-mgmt')) actions.push({ key: 'transfer', icon: '🔄', label: '調撥庫存', fn: () => openTransferModal(itemId) });
  actions.push({ key: 'delete', icon: '🗑', label: '刪除品項', cls: 'del', fn: () => deleteItem(itemId) });
  return actions;
}

export function buildInventoryItemActionMenu(itemId, isViewer) {
  const actions = getInventoryItemActions(itemId, isViewer, false);
  if (!actions.length) return '';
  const buttons = actions.map(a => {
    return '<button class="inventory-action-item' + (a.cls ? ' ' + a.cls : '') + '" data-action="inventory-menu-' + a.key + '" data-id="' + itemId + '">' + a.icon + ' ' + a.label + '</button>';
  }).join('');
  return '<div class="inventory-action-menu" data-role="inventory-action-menu"><button type="button" class="inventory-action-trigger" aria-label="更多操作" data-action="inventory-menu-open">⋮</button><div class="inventory-action-dropdown" data-role="inventory-action-dropdown">' + buttons + '</div></div>';
}





// ========== 刪除材料（2026-08-11 Sarah 需求：每張卡片 ✕ 刪除整筆材料） ==========

/**
 * 刪除材料；失敗時將結構化驗證內容轉為可讀訊息。
 * @param {number} itemId 材料識別碼。
 * @returns {Promise<void>} 刪除與清單更新流程完成後解析。
 */
export async function deleteItem(itemId) {
  if (!confirm('確定刪除這個材料？會一併刪除它的庫存、照片與異動紀錄，無法恢復。')) return;
  try {
    await apiFetch(`/api/items/${itemId}`, { method: 'DELETE', fallback: '刪除失敗' });
    await loadData();
  } catch (e) { alert(e.status ? e.message : '刪除失敗：' + e.message); }
}





// ========== 手機版 ⋯ 動作選單（庫存卡） ==========

export function openItemSheet(itemId) {

  const item = getAllItems().find(i => i.id === itemId);

  if (!item) return;

  const isViewer = !(hasPerm('item-mgmt') || hasPerm('stock-mgmt') || hasPerm('photo'));

  const actions = getInventoryItemActions(itemId, isViewer);

  openSheet(`${item.brand} ${item.name}`, actions);

}


// ========== 手機版更多操作選單 ==========
export function toggleMoreActions() {
  var dd = document.getElementById('moreActionsDropdown');
  if (dd) dd.classList.toggle('is-open');
}
export function closeMoreActions() {
  var dd = document.getElementById('moreActionsDropdown');
  if (dd) dd.classList.remove('is-open');
}
export function openInventoryActionMenu(button, event) {
  if (event) event.stopPropagation();
  document.querySelectorAll('[data-role="inventory-action-dropdown"].is-open').forEach(function(el) { el.classList.remove('is-open'); });
  var menu = button && button.parentElement ? button.parentElement.querySelector('[data-role="inventory-action-dropdown"]') : null;
  if (menu) menu.classList.toggle('is-open');
}
export function closeInventoryActionMenus() {
  document.querySelectorAll('[data-role="inventory-action-dropdown"].is-open').forEach(function(el) { el.classList.remove('is-open'); });
}

// 模組載入時要執行的副作用：由頁面 entry 依原本的載入順序呼叫（issue #39）
export function initInventoryActions() {
  document.addEventListener('click', function(e) {
    if (!e.target.closest('[data-role="more-actions"]')) closeMoreActions();
    if (!e.target.closest('[data-role="inventory-action-menu"]')) closeInventoryActionMenus();
  });
}
