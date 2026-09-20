const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const authSource = fs.readFileSync('static/js/auth.js', 'utf8');

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
    currentTab: 'work-progress',
    canViewStocktake: false,
    checkReminder() {},
    switchTab(tab) { this.currentTab = tab; },
  };
  vm.createContext(context);
  vm.runInContext(authSource, context);
  return { context, elements };
}

function assertMatrix(visiblePages, permissions, expectedAccessible, label) {
  const { context, elements } = createContext();
  context.currentUser = { visible_pages: visiblePages, permissions };
  context.currentTab = 'work-progress';
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
    context.currentTab,
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
