// data-action 事件委派的共用工廠（inline handler 遷移用）。
// 每個 feature 用自己的前綴（例如 "stockout-"）建立一份 delegate，只處理 `[data-action^="<prefix>"]`，
// 不同 feature 的 action 不會互相誤觸；跨 feature 共用的 action（例如照片放大）由 pages 層用 "shared-" 前綴接線。
// 事件類型：click / change / input / keydown / focusin（冒泡），error / load / toggle（capture）。
// 零依賴葉節點；tests/support/frontend-runtime.js 會在 vm 測試中自動補上。

/**
 * @param {string} prefix action 名稱前綴，例如 'stockout-'。
 * @param {Object<string, Object<string, function(HTMLElement, Event): void>>} actions action → 事件類型 → handler。
 * @returns {{ handle: function(Event): boolean, init: function(): void }}
 */
export function createActionDelegate(prefix, actions) {
  const selector = '[data-action^="' + prefix + '"]';

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
    ['click', 'change', 'input', 'keydown', 'focusin'].forEach(function(type) {
      document.addEventListener(type, handle);
    });
    // error / load / toggle 不會冒泡：用 capture 階段在 document 接住
    ['error', 'load', 'toggle'].forEach(function(type) {
      document.addEventListener(type, handle, true);
    });
  }

  return { handle, init };
}
