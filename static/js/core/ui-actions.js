// 全站共用的 UI 事件委派（data-action="ui-*" / "auth-*"）：關閉 modal、點背景關閉、頁面跳轉、登出。
// 各頁的 page entry 都呼叫 initUiActions()；取代 HTML 裡的 UI.closeModal(...) / Auth.logout() / location.href 等 inline handler。

import { createActionDelegate } from './actions.js';
import { logout } from './session.js';
import { closeModal, closeModalForce } from './utils.js';

const UI_ACTIONS = {
  'ui-close-modal': { click: function(el) { closeModal(el.dataset.modal); } },
  'ui-close-modal-backdrop': { click: function(el, event) { if (event.target === el) closeModal(el.dataset.modal); } },
  'ui-close-modal-force': { click: function(el) { closeModalForce(el.dataset.modal); } },
  // 點到背景（overlay 本身）才關閉；點 modal 內容不關
  'ui-close-modal-force-backdrop': { click: function(el, event) { if (event.target === el) closeModalForce(el.dataset.modal); } },
  'ui-goto': { click: function(el) { location.href = el.dataset.href; } },
  'auth-logout': { click: function() { logout(); } },
};

const delegate = createActionDelegate('ui-', UI_ACTIONS);
const authDelegate = createActionDelegate('auth-', UI_ACTIONS);

/** 測試入口：直接分派一個（模擬的）事件。 */
export const handleUiEvent = function(event) { return delegate.handle(event) || authDelegate.handle(event); };

export function initUiActions() {
  delegate.init();
  authDelegate.init();
}
