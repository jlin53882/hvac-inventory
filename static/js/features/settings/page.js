// 設定中心頁：面板切換與修改密碼（2026-08-27 gcal-sync-settings 重寫；各面板在 features/settings/*）

import { canAccessPage, checkAuth } from '../../core/session.js';
import { loadUnits } from '../../core/units.js';
import { hasPerm } from '../../core/utils.js';
import { cpwResetChecks, submitChangePw } from '../account/change-password.js';
import { initCabinetsTab } from './cabinets.js';
import { loadGcalPanelData, renderGcalPanel } from './gcal.js';
import { loadPettyOptions, renderPettyOptionsPanel } from './petty-options.js';
import { loadOrphans, renderUnitsPanel } from './units.js';

export function settingsSwitch(panel) {
  document.querySelectorAll('#settingsSideList [data-role="settings-side-item"]').forEach(el =>
    el.classList.toggle('is-active', el.dataset.panel === panel));
  document.querySelectorAll('#settingsChipBar [data-panel]').forEach(el =>
    el.classList.toggle('is-active', el.dataset.panel === panel));
  const showUnits = panel === 'units';
  const showCabinets = panel === 'cabinets';
  const showGcal = panel === 'gcal';
  const showPetty = panel === 'petty-cash';
  document.getElementById('panel-units').style.display = showUnits ? '' : 'none';
  document.getElementById('panel-cabinets').style.display = showCabinets ? '' : 'none';
  document.getElementById('panel-gcal').style.display = showGcal ? '' : 'none';
  document.getElementById('panel-petty-cash').style.display = showPetty ? '' : 'none';
  document.getElementById('panel-pw').style.display = (!showUnits && !showCabinets && !showGcal && !showPetty) ? '' : 'none';
  if (showUnits) renderUnitsPanel();
  if (showCabinets) initCabinetsTab();
  if (showGcal) renderGcalPanel();
  if (showPetty) renderPettyOptionsPanel();
}

// ========== 修改密碼 ==========
export async function settingsSubmitPw() {
  await submitChangePw();
  setTimeout(clearPwForm, 500);
}

export function clearPwForm() {
  ['cpw-old', 'cpw-new', 'cpw-confirm'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  cpwResetChecks();
}

// 設定頁啟動：權限決定可見面板、載入各面板資料、切到第一個可用面板（原在 gcal.js，issue #39 移回頁面模組以消除循環 import）
export function initSettingsPage() {
  // ========== 初始化 ==========
  (async function initSettings() {
    const user = await checkAuth();
    if (!user) return;
    if (!canAccessPage('settings')) {
      location.href = '/';
      return;
    }
    const canUnits = hasPerm('unit-mgmt');
    const canPettyOptions = hasPerm('petty-cash-config');
    const canChangePassword = canAccessPage('change-password');
    if (!canUnits) {
      const item = document.querySelector('#settingsSideList [data-role="settings-side-item"][data-panel="units"]');
      if (item) item.style.display = 'none';
    }
    if (!canPettyOptions) {
      const item = document.querySelector('#settingsSideList [data-role="settings-side-item"][data-panel="petty-cash"]');
      if (item) item.style.display = 'none';
    }
    const chipBar = document.getElementById('settingsChipBar');
    if (chipBar) {
      chipBar.innerHTML = [
        ['units', '📦 單位管理'],
        ['cabinets', '📦 櫃子'],  // 2026-09-28 手機版也要能進櫃子設定（與側欄一致）
        ['gcal', '📅 行事曆同步'],
        ['petty-cash', '🪙 零用金選單'],
        ['pw', '🔑 修改密碼']
      ].filter(([p]) => (p !== 'units' || canUnits) && (p !== 'petty-cash' || canPettyOptions) && (p !== 'pw' || canChangePassword))
       .map(([p, label]) => '<span class="chip' + (p === 'units' ? ' is-active' : '') + '" data-panel="' + p + '" onclick="Settings.settingsSwitch(\'' + p + '\')">' + label + '</span>')
       .join('');
    }
    // 行事曆同步資料由 loadGcalPanelData 載入並預選第一個 Key
    await Promise.all([loadUnits(), loadOrphans(), loadGcalPanelData(), loadPettyOptions()]);
    settingsSwitch(canUnits ? 'units' : canPettyOptions ? 'petty-cash' : canChangePassword ? 'pw' : 'gcal');
  })();
}
