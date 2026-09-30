// permissions.html 的進入點（issue #39）：載入本頁需要的模組、註冊事件委派（data-action）；不再把命名空間掛到 window，
// 並依原本 <script> 的載入順序執行各模組的初始化。
import { initPermissionsPage } from '../features/permissions/page.js';
import { initPermsActions } from '../features/permissions/actions.js';
import { initUiActions } from '../core/ui-actions.js';
import { initUtils } from '../core/utils.js';

// 除錯 / 自動化測試入口（瀏覽器 console、Playwright）：依模組路徑取用本頁模組；正式程式碼不得依賴
import * as m0 from '../core/actions.js';
import * as m1 from '../core/api-client.js';
import * as m2 from '../core/session.js';
import * as m3 from '../core/state.js';
import * as m4 from '../core/ui-actions.js';
import * as m5 from '../core/utils.js';
import * as m6 from '../features/permissions/actions.js';
import * as m7 from '../features/permissions/page.js';

window.__hvac = Object.freeze({
  'core/actions.js': m0,
  'core/api-client.js': m1,
  'core/session.js': m2,
  'core/state.js': m3,
  'core/ui-actions.js': m4,
  'core/utils.js': m5,
  'features/permissions/actions.js': m6,
  'features/permissions/page.js': m7,
});

initUtils();
initUiActions();
initPermsActions();
initPermissionsPage();
