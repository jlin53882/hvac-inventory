import { P as __exportAll, S as logout, c as closeModalForce, s as closeModal } from "./api-client-DYnNJvCF.js";
//#region static/js/core/actions.js
var actions_exports = /* @__PURE__ */ __exportAll({ createActionDelegate: () => createActionDelegate });
/**
* @param {string} prefix action 名稱前綴，例如 'stockout-'。
* @param {Object<string, Object<string, function(HTMLElement, Event): void>>} actions action → 事件類型 → handler。
* @returns {{ handle: function(Event): boolean, init: function(): void }}
*/
function createActionDelegate(prefix, actions) {
	const selector = "[data-action^=\"" + prefix + "\"]";
	/** 依事件目標（含巢狀子元素）找到最近的 action 並執行；回傳是否有 handler 被執行。 */
	function handle(event) {
		const el = event.target && event.target.closest ? event.target.closest(selector) : null;
		if (!el || el.disabled) return false;
		const handler = (actions[el.dataset.action] || {})[event.type];
		if (!handler) return false;
		handler(el, event);
		return true;
	}
	function init() {
		[
			"click",
			"change",
			"input",
			"keydown",
			"focusin"
		].forEach(function(type) {
			document.addEventListener(type, handle);
		});
		[
			"error",
			"load",
			"toggle"
		].forEach(function(type) {
			document.addEventListener(type, handle, true);
		});
	}
	return {
		handle,
		init
	};
}
//#endregion
//#region static/js/core/ui-actions.js
var ui_actions_exports = /* @__PURE__ */ __exportAll({
	handleUiEvent: () => handleUiEvent,
	initUiActions: () => initUiActions
});
var UI_ACTIONS = {
	"ui-close-modal": { click: function(el) {
		closeModal(el.dataset.modal);
	} },
	"ui-close-modal-backdrop": { click: function(el, event) {
		if (event.target === el) closeModal(el.dataset.modal);
	} },
	"ui-close-modal-force": { click: function(el) {
		closeModalForce(el.dataset.modal);
	} },
	"ui-close-modal-force-backdrop": { click: function(el, event) {
		if (event.target === el) closeModalForce(el.dataset.modal);
	} },
	"ui-goto": { click: function(el) {
		location.href = el.dataset.href;
	} },
	"auth-logout": { click: function() {
		logout();
	} }
};
var delegate = createActionDelegate("ui-", UI_ACTIONS);
var authDelegate = createActionDelegate("auth-", UI_ACTIONS);
/** 測試入口：直接分派一個（模擬的）事件。 */
var handleUiEvent = function(event) {
	return delegate.handle(event) || authDelegate.handle(event);
};
function initUiActions() {
	delegate.init();
	authDelegate.init();
}
//#endregion
export { createActionDelegate as i, ui_actions_exports as n, actions_exports as r, initUiActions as t };
