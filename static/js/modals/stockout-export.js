// 已領出 Excel 匯出對話框邏輯 (2026-09-27)

var stockoutExportInFlight = false;

function exportPadStockout(value) { return String(value).padStart(2, '0'); }

/**
 * 開啟已領出匯出對話框，重設預設值
 * @returns {void}
 */
function openStockoutExportDialog() {
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
  
  modal.classList.add('show');
  modal.setAttribute('aria-hidden', 'false');
}

function closeStockoutExportDialog() {
  const modal = document.getElementById('stockout-export-dialog');
  if (!modal) return;
  modal.classList.remove('show');
  modal.setAttribute('aria-hidden', 'true');
}

function syncStockoutExportPeriodMode() {
  const custom = document.getElementById('stockout-export-custom-mode').checked;
  document.getElementById('stockout-export-month-fields').hidden = custom;
  document.getElementById('stockout-export-custom-fields').hidden = !custom;
}

document.getElementById('stockout-export-month-mode')?.addEventListener('change', syncStockoutExportPeriodMode);
document.getElementById('stockout-export-custom-mode')?.addEventListener('change', syncStockoutExportPeriodMode);

/**
 * 提交已領出匯出，驗證參數並下載報表
 * @returns {Promise<void>}
 */
async function submitStockoutExport() {
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
    const response = await fetch(`/api/stockout-export?${params.toString()}&sections=overview,movements`);
    if (!response.ok) {
      let message = `HTTP ${response.status}`;
      try {
        const body = await response.json();
        message = body.detail || body.message || message;
      } catch (e) { /* 非 JSON 錯誤 */ }
      throw new Error(message);
    }
    
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const disposition = response.headers.get('Content-Disposition') || '';
    const utf8Name = disposition.match(/filename\*=UTF-8''([^;]+)/i);
    const plainName = disposition.match(/filename="?([^\";]+)"?/i);
    link.download = utf8Name ? decodeURIComponent(utf8Name[1]) : (plainName ? plainName[1] : '已領出報表.xlsx');
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
    
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
