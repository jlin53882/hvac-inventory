// 庫存 Excel 匯出 Dialog：期間、庫存區與固定六張工作表。
var exportInFlight = false;
var EXPORT_SITES = [
  ['office', '辦公室'], ['warehouse', '倉庫'], ['van', '廂型車'], ['truck', '貨車'],
];

function exportPad(value) { return String(value).padStart(2, '0'); }

function openInventoryExportDialog() {
  const modal = document.getElementById('inventory-export-dialog');
  if (!modal) return;
  const now = new Date();
  const monthSelect = document.getElementById('inventory-export-month');
  if (!monthSelect.options.length) {
    for (let month = 1; month <= 12; month += 1) {
      const option = document.createElement('option'); option.value = exportPad(month); option.textContent = `${exportPad(month)} 月`; monthSelect.appendChild(option);
    }
  }
  document.getElementById('inventory-export-year').value = now.getFullYear();
  monthSelect.value = exportPad(now.getMonth() + 1);
  document.getElementById('inventory-export-start').value = `${now.getFullYear()}-${exportPad(now.getMonth() + 1)}-01`;
  document.getElementById('inventory-export-end').value = `${now.getFullYear()}-${exportPad(now.getMonth() + 1)}-${exportPad(now.getDate())}`;
  document.getElementById('inventory-export-month-mode').checked = true;
  document.getElementById('inventory-export-custom-mode').checked = false;
  syncInventoryExportPeriodMode();
  document.getElementById('inventory-export-all-sites').checked = true;
  document.querySelectorAll('#inventory-export-sites input[data-site]').forEach(input => { input.checked = true; });
  modal.classList.add('show');
  modal.setAttribute('aria-hidden', 'false');
}

function closeInventoryExportDialog() {
  const modal = document.getElementById('inventory-export-dialog');
  if (!modal) return;
  modal.classList.remove('show');
  modal.setAttribute('aria-hidden', 'true');
}

function syncInventoryExportPeriodMode() {
  const custom = document.getElementById('inventory-export-custom-mode').checked;
  document.getElementById('inventory-export-month-fields').hidden = custom;
  document.getElementById('inventory-export-custom-fields').hidden = !custom;
}

document.getElementById('inventory-export-month-mode').addEventListener('change', syncInventoryExportPeriodMode);
document.getElementById('inventory-export-custom-mode').addEventListener('change', syncInventoryExportPeriodMode);

function toggleInventoryExportSites(source) {
  document.querySelectorAll('#inventory-export-sites input[data-site]').forEach(input => { input.checked = source.checked; });
}

function syncInventoryExportAllSites() {
  const inputs = [...document.querySelectorAll('#inventory-export-sites input[data-site]')];
  document.getElementById('inventory-export-all-sites').checked = inputs.every(input => input.checked);
}

function exportExcel() { openInventoryExportDialog(); }

async function submitInventoryExport() {
  if (exportInFlight) return;
  const button = document.getElementById('inventory-export-submit');
  const custom = document.getElementById('inventory-export-custom-mode').checked;
  const params = new URLSearchParams();
  if (custom) {
    const start = document.getElementById('inventory-export-start').value;
    const end = document.getElementById('inventory-export-end').value;
    if (!start || !end || start > end) { toast('匯出失敗：日期範圍無效', 'error'); return; }
    params.set('start_date', start); params.set('end_date', end);
  } else {
    params.set('month', `${document.getElementById('inventory-export-year').value}-${document.getElementById('inventory-export-month').value}`);
  }
  const sites = [...document.querySelectorAll('#inventory-export-sites input[data-site]:checked')].map(input => input.dataset.site);
  if (!sites.length) { toast('匯出失敗：至少選擇一個庫存區', 'error'); return; }
  params.set('sites', sites.join(','));
  params.set('sections', 'overview,inventory,positions,alerts,movements,stats');
  exportInFlight = true;
  if (button) { button.disabled = true; button.textContent = '產生報表中…'; }
  try {
    const response = await fetch(`/api/export?${params.toString()}`);
    if (!response.ok) {
      let message = `HTTP ${response.status}`;
      try { const body = await response.json(); message = body.detail || body.message || message; } catch (e) { /* 非 JSON 錯誤 */ }
      throw new Error(message);
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const disposition = response.headers.get('Content-Disposition') || '';
    const utf8Name = disposition.match(/filename\*=UTF-8''([^;]+)/i);
    const plainName = disposition.match(/filename="?([^";]+)"?/i);
    link.download = utf8Name ? decodeURIComponent(utf8Name[1]) : (plainName ? plainName[1] : '庫存報表.xlsx');
    link.href = url; link.click(); URL.revokeObjectURL(url);
    closeInventoryExportDialog();
    toast('✅ 報表已下載', 'success');
  } catch (error) {
    toast(`匯出失敗：${esc(error.message || '請稍後再試')}`, 'error');
  } finally {
    exportInFlight = false;
    if (button) { button.disabled = false; button.textContent = '匯出報表'; }
  }
}
