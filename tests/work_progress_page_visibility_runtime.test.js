const assert = require('assert');
const vm = require('vm');
const { extractFunction, moduleScript, read } = require('./support/frontend-runtime');

// 頁面可用性判斷在 core/session.js；套用到側欄與目前頁籤的 applyRoleView 由 auth.js 搬到 features/shell/app.js（issue #39）
const sessionSource = moduleScript('core/session.js');
const appSource = read('static/js/features/shell/app.js');

function createContext() {
  const elements = {
    workProgress: { style: {}, dataset: { pageKey: 'work-progress' } },
    calendar: { style: {}, dataset: { pageKey: 'calendar' } },
    stocktake: { style: {}, dataset: { pageKey: 'stocktake' } },
    saveBar: { style: {} },
  };
  const context = {
    console,
    window: {},
    document: {
      querySelectorAll(selector) {
        assert.strictEqual(selector, '[data-page-key]');
        return Object.values(elements).filter((element) => element.dataset && element.dataset.pageKey);
      },
      getElementById(id) {
        if (id === 'sb-nav-work-progress') return elements.workProgress;
        if (id === 'sb-nav-stocktake') return elements.stocktake;
        if (id === 'save-bar') return elements.saveBar;
        return null;
      },
    },
    currentUser: null,
    appState: { currentTab: 'work-progress' },
    checkReminder() {},
    switchTab(tab) { this.appState.currentTab = tab; },
  };
  vm.createContext(context);
  vm.runInContext(sessionSource, context);
  for (const name of ['applyPageVisibility', 'applyRoleView']) vm.runInContext(extractFunction(appSource, name), context);
  return { context, elements };
}

function assertMatrix(visiblePages, permissions, expectedAccessible, label) {
  const { context, elements } = createContext();
  context.currentUser = { visible_pages: visiblePages, permissions };
  context.appState.currentTab = 'work-progress';
  context.applyRoleView(context.currentUser);
  assert.strictEqual(
    context.canAccessPage('work-progress'),
    expectedAccessible,
    `${label}: canAccessPage mismatch`,
  );
  assert.strictEqual(
    elements.workProgress.style.display,
    expectedAccessible ? '' : 'none',
    `${label}: sidebar display mismatch`,
  );
  assert.strictEqual(
    context.appState.currentTab,
    expectedAccessible ? 'work-progress' : 'calendar',
    `${label}: direct tab fallback mismatch`,
  );
  assert.strictEqual(
    context.resolveAccessiblePageTab('work-progress'),
    expectedAccessible ? 'work-progress' : 'calendar',
    `${label}: resolver fallback mismatch`,
  );
}

assertMatrix(
  ['calendar', 'work-progress'],
  { view: true, 'work-progress-view': true },
  true,
  'visibility ON + capability ON',
);
assertMatrix(
  ['calendar'],
  { view: true, 'work-progress-view': true },
  false,
  'visibility OFF + capability ON',
);
assertMatrix(
  ['calendar', 'work-progress'],
  { view: true, 'work-progress-view': false },
  false,
  'visibility ON + capability OFF',
);
assertMatrix(
  ['calendar'],
  { view: true, 'work-progress-view': false },
  false,
  'visibility OFF + capability OFF',
);

console.log('work-progress page visibility runtime: PASS');
