// 整組庫存的狀態判定與「缺料 / 庫存不足」清單（通知中心與整組頁共用；issue #39 自 kits/page.js 抽出以消除循環 import）

import { buildThumb } from '../../components/card.js';
import { openSharedStatusListModal, statusListFormatQuantity } from '../../components/status-list.js';
import { appState } from '../../core/state.js';
import { getAllItems } from '../../core/inventory-read-model.js';
import { esc, hasPerm } from '../../core/utils.js';

export function getKitStatus(kit) {
  const components = Array.isArray(kit.components) ? kit.components : [];
  const hasShortage = components.some(function(c) {
    return Number(c.need_qty || 0) > 0 && Number(c.stock || 0) <= 0;
  });
  const hasInsufficient = !hasShortage && components.some(function(c) {
    // 2026-09-12：容差 1e-9（0.3 vs 0.1+0.2 塵不得誤判不足）
    return Number(c.stock || 0) < Number(c.need_qty || 0) - 1e-9;
  });
  return {
    status: hasShortage ? 'shortage' : (hasInsufficient ? 'insufficient' : 'normal'),
    canAssemble: !hasShortage && !hasInsufficient,
  };
}

function renderKitStatusItem(kit, type) {
  const stock = Number(kit.stock_qty || 0);
  const source = Array.isArray(getAllItems()) ? getAllItems().find(function(item) { return Number(item.id) === Number(kit.item_id); }) || {} : {};
  const location = kit.location || source.location || (source.stocks && source.stocks[0] && source.stocks[0].location) || '未標示';
  const isShortage = type === 'shortage';
  const statusLabel = isShortage ? '缺料' : '庫存不足';
  const statusClass = isShortage ? 'status-out' : 'status-low';
  const missingLabel = isShortage ? '缺料' : '不足';
  const missing = (kit.components || []).filter(function(c) { return Number(c.need_qty || 0) > 0 && Number(c.stock || 0) < Number(c.need_qty || 0); });
  const missingHTML = missing.length
    ? `<div class="kit-status-missing">${esc(missingLabel)} ${missing.length} 項：${missing.map(function(c) { return `<span>${esc(c.name || '未命名材料')}</span>`; }).join('')}</div>`
    : '';
  const editAction = hasPerm('kit-mgmt') && Number.isInteger(Number(kit.id))
    ? `<button type="button" class="btn btn--secondary btn--sm inventory-status-edit" onclick="Inventory.closeInventoryStatusModal();Kits.editKit(${esc(String(Number(kit.id)))})">編輯</button>`
    : '';
  return `<article class="inventory-status-item status-list-mobile-row kit-status-item ${esc(statusClass)}">
    <div class="inventory-status-thumb">${buildThumb(kit.item_id, !!kit.has_photo, kit.name, '🔧', kit.thumbnail_url)}</div>
    <div class="inventory-status-info">
      <div class="inventory-status-name">${esc(kit.name || '未命名整組')}</div>
      <div class="inventory-status-sub">${esc(source.brand || kit.brand || '整組')}${esc(kit.code ? ' · 型號 ' + kit.code : '')}</div>
      ${missingHTML}
    </div>
    <div class="inventory-status-location status-list-location-cell">📍 ${esc(location)}</div>
    <div class="inventory-status-values">
      <span class="inventory-status-badge ${esc(statusClass)}">${esc(statusLabel)}</span>
      <strong>${esc(statusListFormatQuantity(stock, '組'))} <small>組</small></strong>
    </div>
    ${editAction}
  </article>`;
}
export function showKitStatusList(type) {
  const validType = type === 'shortage' ? 'shortage' : 'insufficient';
  const items = appState.currentKitItems.filter(function(k) { return getKitStatus(k).status === validType; });
  const isShortage = validType === 'shortage';
  openSharedStatusListModal({
    title: isShortage ? '⛔ 缺料的整組' : '⚠ 庫存不足的整組',
    intro: isShortage ? '以下整組因必要材料不足，目前無法正常組成。' : '目前仍有庫存，但庫存數量低於需求條件。',
    headerClass: isShortage ? 'is-out' : 'is-low',
    columnLabels: ['照片', '整組 / 缺料材料', '位置', '庫存 / 狀態', '操作'],
    items: items,
    emptyText: isShortage ? '✅ 目前沒有缺料的整組' : '✅ 目前沒有庫存不足的整組',
    emptyIntro: '目前整組庫存均符合條件。',
    searchPlaceholder: '搜尋整組名稱、材料或型號…',
    getSearchText: function(kit) {
      return [kit.name, kit.brand, kit.code, kit.note, (kit.components || []).map(function(c) {
        return [c.brand, c.name, c.code].join(' ');
      }).join(' ')].join(' ');
    },
    renderItem: function(kit) { return renderKitStatusItem(kit, validType); },
  });
}
