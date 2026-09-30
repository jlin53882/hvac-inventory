// 跨模組共用、會被其他模組改寫的狀態（issue #39：原本是全域變數）
import { createRequestGuard } from '../../core/request-guard.js';
export const inventoryState = {
  stockLocationPickerState: null, // pending item and delta while choosing a location
  inventoryStatusGuard: createRequestGuard(),
  inventoryStatusModalType: '',
  savingAll: false,  // 防止連點「全部儲存」重複送出同一批調整（adjust / location-adjustments / qty-dialog 共用）
};
