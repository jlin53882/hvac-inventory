// 設定中心頁：面板切換與修改密碼（2026-08-27 gcal-sync-settings 重寫；各面板在 features/settings/*）

import { cpwResetChecks, submitChangePw } from '../account/change-password.js';
import { initCabinetsTab } from './cabinets.js';
import { renderGcalPanel } from './gcal.js';
import { renderPettyOptionsPanel } from './petty-options.js';
import { renderUnitsPanel } from './units.js';

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
