// settings.html 的進入點（issue #39）：載入本頁需要的模組、把 inline handler 用的命名空間掛到 window，
// 並依原本 <script> 的載入順序執行各模組的初始化。
import { addCabinet, deleteCabinet, editCabinet, submitCabinetEdit } from '../features/settings/cabinets.js';
import { addGcalReminderRow, bindGcalUser, deleteGcalKey, forceSyncNow, removeGcalReminderRow, saveGcalSetting, saveKeyReminders, selectGcalKey, switchGcalTab, toggleGcalKey } from '../features/settings/gcal.js';
import { addUnitFromSettings, applyQtySuggest, consolidateGroup, consolidateItem, initSettingsUnits, moveUnit, setUnitQtyType, toggleUnit } from '../features/settings/units.js';
import { clearGcalFile, closeGcalKeyModal, gcalFileSelected, openGcalKeyModal, submitGcalKey } from '../features/settings/gcal-key-modal.js';
import { clearPwForm, initSettingsPage, settingsSubmitPw, settingsSwitch } from '../features/settings/page.js';
import { closeModalForce, initUtils } from '../core/utils.js';
import { cpwCheckMatch, cpwCheckStrength } from '../features/account/change-password.js';
import { createPettyOptionKind } from '../features/settings/petty-options.js';
import { handleUnauthorized, logout } from '../core/session.js';
import { setUnauthorizedHandler } from '../core/api-client.js';

// 除錯 / 自動化測試入口（瀏覽器 console、Playwright）：依模組路徑取用本頁模組；正式程式碼不得依賴
import * as m0 from '../core/api-client.js';
import * as m1 from '../core/qty.js';
import * as m2 from '../core/session.js';
import * as m3 from '../core/shared-read-model.js';
import * as m4 from '../core/state.js';
import * as m5 from '../core/units.js';
import * as m6 from '../core/utils.js';
import * as m7 from '../features/account/change-password.js';
import * as m8 from '../features/settings/cabinets.js';
import * as m9 from '../features/settings/gcal-key-modal.js';
import * as m10 from '../features/settings/gcal.js';
import * as m11 from '../features/settings/page.js';
import * as m12 from '../features/settings/petty-options.js';
import * as m13 from '../features/settings/units.js';

window.Account = { cpwCheckMatch, cpwCheckStrength };
window.Auth = { logout };
window.Settings = { addCabinet, addGcalReminderRow, addUnitFromSettings, applyQtySuggest, bindGcalUser, clearGcalFile, clearPwForm, closeGcalKeyModal, consolidateGroup, consolidateItem, createPettyOptionKind, deleteCabinet, deleteGcalKey, editCabinet, forceSyncNow, gcalFileSelected, moveUnit, openGcalKeyModal, removeGcalReminderRow, saveGcalSetting, saveKeyReminders, selectGcalKey, setUnitQtyType, settingsSubmitPw, settingsSwitch, submitCabinetEdit, submitGcalKey, switchGcalTab, toggleGcalKey, toggleUnit };
window.UI = { closeModalForce };
window.__hvac = Object.freeze({
  'core/api-client.js': m0,
  'core/qty.js': m1,
  'core/session.js': m2,
  'core/shared-read-model.js': m3,
  'core/state.js': m4,
  'core/units.js': m5,
  'core/utils.js': m6,
  'features/account/change-password.js': m7,
  'features/settings/cabinets.js': m8,
  'features/settings/gcal-key-modal.js': m9,
  'features/settings/gcal.js': m10,
  'features/settings/page.js': m11,
  'features/settings/petty-options.js': m12,
  'features/settings/units.js': m13,
});

setUnauthorizedHandler(handleUnauthorized);   // 401 一律跳登入（登入頁 / 權限頁不註冊）
initUtils();
initSettingsPage();
initSettingsUnits();
