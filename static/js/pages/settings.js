// settings.html 的進入點（issue #39）：載入本頁需要的模組、註冊事件委派（data-action）；不再把命名空間掛到 window，
// 並依原本 <script> 的載入順序執行各模組的初始化。
import { initSettingsUnits } from '../features/settings/units.js';
import { initSettingsActions } from '../features/settings/actions.js';
import { initAccountActions } from '../features/account/change-password.js';
import { initUiActions } from '../core/ui-actions.js';
import { initSettingsPage } from '../features/settings/page.js';
import { initUtils } from '../core/utils.js';
import { handleUnauthorized } from '../core/session.js';
import { setUnauthorizedHandler } from '../core/api-client.js';

// 除錯 / 自動化測試入口（瀏覽器 console、Playwright）：依模組路徑取用本頁模組；正式程式碼不得依賴
import * as m0 from '../core/actions.js';
import * as m1 from '../core/api-client.js';
import * as m2 from '../core/qty.js';
import * as m3 from '../core/session.js';
import * as m4 from '../core/shared-read-model.js';
import * as m5 from '../core/state.js';
import * as m6 from '../core/ui-actions.js';
import * as m7 from '../core/units.js';
import * as m8 from '../core/utils.js';
import * as m9 from '../features/account/change-password.js';
import * as m10 from '../features/settings/actions.js';
import * as m11 from '../features/settings/cabinets.js';
import * as m12 from '../features/settings/gcal-key-modal.js';
import * as m13 from '../features/settings/gcal.js';
import * as m14 from '../features/settings/page.js';
import * as m15 from '../features/settings/petty-options.js';
import * as m16 from '../features/settings/units.js';

window.__hvac = Object.freeze({
  'core/actions.js': m0,
  'core/api-client.js': m1,
  'core/qty.js': m2,
  'core/session.js': m3,
  'core/shared-read-model.js': m4,
  'core/state.js': m5,
  'core/ui-actions.js': m6,
  'core/units.js': m7,
  'core/utils.js': m8,
  'features/account/change-password.js': m9,
  'features/settings/actions.js': m10,
  'features/settings/cabinets.js': m11,
  'features/settings/gcal-key-modal.js': m12,
  'features/settings/gcal.js': m13,
  'features/settings/page.js': m14,
  'features/settings/petty-options.js': m15,
  'features/settings/units.js': m16,
});

setUnauthorizedHandler(handleUnauthorized);   // 401 一律跳登入（登入頁 / 權限頁不註冊）
initUtils();
initUiActions();
initAccountActions();
initSettingsActions();
initSettingsPage();
initSettingsUnits();
