// 已領出卡的手機版 ⋯ 動作選單（由 stockout/actions.js 的 data-action="stockout-sheet" 開啟；issue #39 自 page.js 抽出，
// 讓已領出頁不必 import 會回頭重繪本頁的 modals.js）

import { openSheet } from '../../core/bottomsheet.js';
import { hasPerm } from '../../core/utils.js';
import { deleteStockoutReturn, openEditStockoutModal, openEditStockoutReturnModal, returnStockout } from './modals.js';
import { deleteStockoutRecord } from './page.js';
import { stockoutState } from './state.js';

// ========== 手機版 ⋯ 動作選單（已領出卡） ==========

export function openStockoutSheet(movementId) {

  const rec = (typeof stockoutState.stockoutRecords !== 'undefined' ? stockoutState.stockoutRecords : []).find(r => r.id === movementId);

  if (!rec) return;

  const isViewer = !hasPerm('stockout');

  const reverted = !!rec.reverted_at;
  const isReturn = rec.reason === '退回已領出';

  const actions = [];

  if (!isViewer) {

    if (isReturn && !reverted) {
      actions.push({ icon: '✏️', label: '編輯', cls: 'out', fn: () => openEditStockoutReturnModal(movementId) });
      actions.push({ icon: '↩️', label: '撤銷退回', cls: 'del', fn: () => deleteStockoutReturn(movementId) });
    } else if (!isReturn && !reverted) {
      actions.push({ icon: '✏️', label: '編輯', cls: 'out', fn: () => openEditStockoutModal(movementId) });
      actions.push({ icon: '↩️', label: '退回', cls: 'back', fn: () => returnStockout(movementId) });
    }

    if (!isReturn) {
      actions.push({ icon: '🗑', label: '刪除', cls: 'del', fn: () => deleteStockoutRecord(movementId) });
    }

  }

  openSheet(`${rec.brand} ${rec.item_name}`, actions);

}
