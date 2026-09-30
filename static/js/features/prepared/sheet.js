// 待領出卡的手機版 ⋯ 動作選單（由 inline handler Prepared.openPreparedSheet 開啟；issue #39 自 page.js 抽出，
// 讓待領出頁不必 import 會回頭重繪本頁的 stockout/modals.js）

import { openSheet } from '../../core/bottomsheet.js';
import { appState } from '../../core/state.js';
import { getAllItems } from '../../core/inventory-read-model.js';
import { hasPerm } from '../../core/utils.js';
import { openPreparedEditModal, openPreparedOutModal, returnPrepared } from '../stockout/modals.js';
import { clearPrepared } from './page.js';

// ========== 手機版 ⋯ 動作選單（待領出卡） ==========

export function openPreparedSheet(itemId) {

  const item = appState.preparedItems.find(i => i.id === itemId) || getAllItems().find(i => i.id === itemId);  // 非庫存品項不在 ALL_ITEMS（2026-08-16 家豪：點 ⋯ 無效 bug）

  if (!item) return;

  const isViewer = !hasPerm('stockout');

  const actions = [];

  if (!isViewer) {

    actions.push({ icon: '✏️', label: '編輯', cls: 'back', fn: () => openPreparedEditModal(itemId) });
    actions.push({ icon: '🚚', label: '已領出', cls: 'out', fn: () => openPreparedOutModal(itemId) });

    if (!item.is_deleted) actions.push({ icon: '↩️', label: '退回', cls: 'back', fn: () => returnPrepared(itemId) });  // 非庫存無退回（家豪 2026-08-16）

    actions.push({ icon: '🗑', label: '刪除', cls: 'del', fn: () => clearPrepared(itemId, item.prepared_qty) });

  }

  openSheet(`${item.brand} ${item.name}`, actions);

}
