// permissions.html 的進入點（issue #39）：載入本頁需要的模組、把 inline handler 用的命名空間掛到 window，
// 並依原本 <script> 的載入順序執行各模組的初始化。
import { addUserMode, closeAccountEditModal, closeAddUserModal, closeResetPermModal, closeResetPwModal, confirmResetPerm, initPermissionsPage, openAddUserModal, openResetPermModal, permDelete, permEditAccount, permFilter, permPage, permPageToggle, permResetPw, permSave, permSearch, permSelect, permSubTab, permSwitchTab, permToggle, permToggleActive, submitAccountEdit, submitAddUser, submitResetPw } from '../features/permissions/page.js';
import { initUtils } from '../core/utils.js';

// 除錯 / 自動化測試入口（瀏覽器 console、Playwright）：依模組路徑取用本頁模組；正式程式碼不得依賴
import * as m0 from '../core/api-client.js';
import * as m1 from '../core/session.js';
import * as m2 from '../core/state.js';
import * as m3 from '../core/utils.js';
import * as m4 from '../features/permissions/page.js';

window.Perms = { addUserMode, closeAccountEditModal, closeAddUserModal, closeResetPermModal, closeResetPwModal, confirmResetPerm, openAddUserModal, openResetPermModal, permDelete, permEditAccount, permFilter, permPage, permPageToggle, permResetPw, permSave, permSearch, permSelect, permSubTab, permSwitchTab, permToggle, permToggleActive, submitAccountEdit, submitAddUser, submitResetPw };
window.__hvac = Object.freeze({
  'core/api-client.js': m0,
  'core/session.js': m1,
  'core/state.js': m2,
  'core/utils.js': m3,
  'features/permissions/page.js': m4,
});

initUtils();
initPermissionsPage();
