// 整組庫存 Excel 匯出對話框邏輯 (2026-09-27)
// 複用單一庫存的匯出結構，改為整組版本

var kitExportInFlight = false;

function exportPadKit(value) { return String(value).padStart(2, '0'); }

/**
 * 開啟整組匯出對話框，重設預設值
 * @returns {void}
 */
function openKitExportDialog() {
  const modal = document.getElementById('kit-export-dialog');
  if (!modal) return;
  
  const now = new Date();
  const monthSelect = document.getElementById('kit-export-month');
  
  // 初始化月份選項
  if (!monthSelect.options.length) {
    for (let month = 1; month <= 12; month += 1) {
      const option = document.createElement('option');
      option.value = exportPadKit(month);
      option.textContent = `${exportPadKit(month)} 月`;
      monthSelect.appendChild(option);
    }
  }
  
  // 設定日期預設值（本月）
  document.getElementById('kit-export-year').value = now.getFullYear();
  monthSelect.value = exportPadKit(now.getMonth() + 1);
  document.getElementById('kit-export-start').value = `${now.getFullYear()}-${exportPadKit(now.getMonth() + 1)}-01`;
  document.getElementById('kit-export-end').value = `${now.getFullYear()}-${exportPadKit(now.getMonth() + 1)}-${exportPadKit(now.getDate())}`;
  
  // 設定期間模式
  document.getElementById('kit-export-month-mode').checked = true;
  document.getElementById('kit-export-custom-mode').checked = false;
  syncKitExportPeriodMode();
  
  // 設定預設勾選的工作表
  const defaultSections = ['inventory', 'positions', 'movements'];
  document.querySelectorAll('#kit-export-content input[data-section]').forEach(input => {
    input.checked = defaultSections.includes(input.dataset.section);
  });
  
  modal.classList.add('is-open');
  modal.setAttribute('aria-hidden', 'false');
}

function closeKitExportDialog() {
  const modal = document.getElementById('kit-export-dialog');
  if (!modal) return;
  modal.classList.remove('is-open');
  modal.setAttribute('aria-hidden', 'true');
}

function syncKitExportPeriodMode() {
  const custom = document.getElementById('kit-export-custom-mode').checked;
  document.getElementById('kit-export-month-fields').hidden = custom;
  document.getElementById('kit-export-custom-fields').hidden = !custom;
}

document.getElementById('kit-export-month-mode')?.addEventListener('change', syncKitExportPeriodMode);
document.getElementById('kit-export-custom-mode')?.addEventListener('change', syncKitExportPeriodMode);

/**
 * 提交整組匯出，驗證參數並下載報表
 * @returns {Promise<void>}
 */
async function submitKitExport() {
  if (kitExportInFlight) return;
  
  const button = document.getElementById('kit-export-submit');
  const custom = document.getElementById('kit-export-custom-mode').checked;
  const params = new URLSearchParams();
  
  // 驗證期間
  if (custom) {
    const start = document.getElementById('kit-export-start').value;
    const end = document.getElementById('kit-export-end').value;
    if (!start || !end || start > end) {
      toast('匯出失敗：日期範圍無效', 'error');
      return;
    }
    params.set('start_date', start);
    params.set('end_date', end);
  } else {
    params.set('month', `${document.getElementById('kit-export-year').value}-${document.getElementById('kit-export-month').value}`);
  }
  
  // 驗證工作表選擇
  const sections = [...document.querySelectorAll('#kit-export-content input[data-section]:checked')].map(input => input.dataset.section);
  if (!sections.length) {
    toast('匯出失敗：至少選擇一種匯出內容', 'error');
    return;
  }
  params.set('sections', sections.join(','));
  
  kitExportInFlight = true;
  if (button) {
    button.disabled = true;
    button.textContent = '產生報表中…';
  }
  
  try {
    const response = await fetch(`/api/kit-export?${params.toString()}`);
    if (!response.ok) {
      let message = `HTTP ${response.status}`;
      try {
        const body = await response.json();
        message = apiErrorMessage(body.detail) || body.message || message;
      } catch (e) { /* 非 JSON 錯誤 */ }
      throw new Error(message);
    }
    
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const disposition = response.headers.get('Content-Disposition') || '';
    const utf8Name = disposition.match(/filename\*=UTF-8''([^;]+)/i);
    const plainName = disposition.match(/filename="?([^\";]+)"?/i);
    link.download = utf8Name ? decodeURIComponent(utf8Name[1]) : (plainName ? plainName[1] : '整組報表.xlsx');
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
    
    toast('✅ 整組報表已下載', 'success');
    closeKitExportDialog();
  } catch (e) {
    toast('⚠️ 匯出失敗：' + e.message, 'error');
  } finally {
    kitExportInFlight = false;
    if (button) {
      button.disabled = false;
      button.textContent = '匯出報表';
    }
  }
}
