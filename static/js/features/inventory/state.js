// 跨模組共用、會被其他模組改寫的狀態（issue #39：原本是全域變數）
import { createRequestGuard } from '../../core/request-guard.js';
export const inventoryState = {
  batchMode: false,  // 批次改位置模式（2026-09-06 方案 A；切離庫存頁時由 shell 關閉）
  stockLocationPickerState: null, // pending item and delta while choosing a location
  inventoryStatusGuard: createRequestGuard(),
  inventoryStatusModalType: '',
  savingAll: false,  // 防止連點「全部儲存」重複送出同一批調整（adjust / location-adjustments / qty-dialog 共用）
};
