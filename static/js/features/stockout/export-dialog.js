// 已領出 Excel 匯出對話框邏輯 (2026-09-27)

import { apiDownload } from '../../core/api-client.js';
import { toast } from '../../core/utils.js';

var stockoutExportInFlight = false;

function exportPadStockout(value) { return String(value).padStart(2, '0'); }

/**
 * 開啟已領出匯出對話框，重設預設值
 * @returns {void}
 */
export function openStockoutExportDialog() {
  const modal = document.getElementById('stockout-export-dialog');
  if (!modal) return;

  const now = new Date();
  const monthSelect = document.getElementById('stockout-export-month');

  // 初始化月份選項
  if (!monthSelect.options.length) {
    for (let month = 1; month <= 12; month += 1) {
      const option = document.createElement('option');
      option.value = exportPadStockout(month);
      option.textContent = `${exportPadStockout(month)} 月`;
      monthSelect.appendChild(option);
    }
  }

  // 設定日期預設值（本月）
  document.getElementById('stockout-export-year').value = now.getFullYear();
  monthSelect.value = exportPadStockout(now.getMonth() + 1);
  document.getElementById('stockout-export-start').value = `${now.getFullYear()}-${exportPadStockout(now.getMonth() + 1)}-01`;
  document.getElementById('stockout-export-end').value = `${now.getFullYear()}-${exportPadStockout(now.getMonth() + 1)}-${exportPadStockout(now.getDate())}`;

  // 設定期間模式
  document.getElementById('stockout-export-month-mode').checked = true;
  document.getElementById('stockout-export-custom-mode').checked = false;
  syncStockoutExportPeriodMode();

  modal.classList.add('is-open');
  modal.setAttribute('aria-hidden', 'false');
}

export function closeStockoutExportDialog() {
  const modal = document.getElementById('stockout-export-dialog');
  if (!modal) return;
  modal.classList.remove('is-open');
  modal.setAttribute('aria-hidden', 'true');
}

function syncStockoutExportPeriodMode() {
  const custom = document.getElementById('stockout-export-custom-mode').checked;
  document.getElementById('stockout-export-month-fields').hidden = custom;
  document.getElementById('stockout-export-custom-fields').hidden = !custom;
}

/**
 * 提交已領出匯出，驗證參數並下載報表
 * @returns {Promise<void>}
 */
export async function submitStockoutExport() {
  if (stockoutExportInFlight) return;

  const button = document.getElementById('stockout-export-submit');
  const custom = document.getElementById('stockout-export-custom-mode').checked;
  const params = new URLSearchParams();

  // 驗證期間
  if (custom) {
    const start = document.getElementById('stockout-export-start').value;
    const end = document.getElementById('stockout-export-end').value;
    if (!start || !end || start > end) {
      toast('匯出失敗：日期範圍無效', 'error');
      return;
    }
    params.set('start_date', start);
    params.set('end_date', end);
  } else {
    params.set('month', `${document.getElementById('stockout-export-year').value}-${document.getElementById('stockout-export-month').value}`);
  }

  // 已領出只支援異動紀錄匯出
  params.set('sections', 'movements');

  stockoutExportInFlight = true;
  if (button) {
    button.disabled = true;
    button.textContent = '產生報表中…';
  }

  try {
    // 呼叫已領出專用匯出端點
    await apiDownload(`/api/stockout-export?${params.toString()}`, { filename: '已領出報表.xlsx', fallback: '請稍後再試' });
    toast('✅ 已領出報表已下載', 'success');
    closeStockoutExportDialog();
  } catch (e) {
    toast('⚠️ 匯出失敗：' + e.message, 'error');
  } finally {
    stockoutExportInFlight = false;
    if (button) {
      button.disabled = false;
      button.textContent = '匯出報表';
    }
  }
}

// 模組載入時要執行的副作用：由頁面 entry 依原本的載入順序呼叫（issue #39）
export function initStockoutExportDialog() {
  document.getElementById('stockout-export-month-mode')?.addEventListener('change', syncStockoutExportPeriodMode);
  document.getElementById('stockout-export-custom-mode')?.addEventListener('change', syncStockoutExportPeriodMode);
}
