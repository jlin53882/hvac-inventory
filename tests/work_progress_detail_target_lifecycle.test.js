'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sourcePath = path.join(__dirname, '..', 'static', 'js', 'render', 'work-progress.js');
const source = fs.readFileSync(sourcePath, 'utf8');

/**
 * Build a minimal DOM harness for the production selected-detail lifecycle.
 * @returns {{sandbox: object, elements: Map<string, object>, requests: object[]}}
 *   Harness state and controlled fetch requests.
 */
function createHarness() {
  const elements = new Map();
  const requests = [];
  const selectedId = 'wpr-selected-report-detail-42';
  elements.set(selectedId, { id: selectedId, innerHTML: '', textContent: '' });
  elements.set('wpr-history-list', { id: 'wpr-history-list', innerHTML: '', textContent: '' });
  elements.set('wpr-from', { value: '' });
  elements.set('wpr-to', { value: '' });
  elements.set('wpr-query', { value: '' });
  elements.set('wpr-result-count', { textContent: '' });
  elements.set('wpr-selected-area', { hidden: false, innerHTML: '' });
  elements.set('wpr-save', { disabled: false });
  elements.set('wpr-date', { value: '2026-09-21' });
  const document = {
    body: { appendChild() {} },
    createElement() {
      return {
        className: '',
        id: '',
        innerHTML: '',
        remove() {},
        querySelectorAll() { return []; },
        addEventListener() {},
      };
    },
    getElementById(id) { return elements.get(id) || null; },
    addEventListener() {},
  };
  const sandbox = {
    document,
    window: { confirm: () => true },
    currentTab: 'work-progress',
    toast() {},
    esc(value) { return String(value); },
    jsStr(value) { return String(value); },
    wprFetch(url, options) {
      let resolve;
      let reject;
      const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
      requests.push({ resolve, reject, url, options });
      return promise;
    },
    console,
    Promise,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    fetch(url, options) {
      let resolve;
      let reject;
      const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
      requests.push({ resolve, reject, url, options });
      return promise;
    },
    wprDetailRequestTokens: {},
    wprHistoryRequestToken: 0,
    wprHistoryPageSize: 10,
    wprHistoryPage: 1,
    wprSelectRequestToken: 0,
  };
  vm.runInNewContext(source, sandbox, { filename: sourcePath });
  return { sandbox, elements, requests };
}

/**
 * Return a minimal production-shaped report with one manageable photo.
 * @param {string} note - Progress note marker.
 * @returns {object} Report response.
 */
function report(note) {
  return {
    report_date: '2026-09-21',
    service_name: '保養',
    client_name: '三重 A6-12F',
    uploader_name: '測試人員',
    note,
    photos: [
      { asset_id: 'asset-42', thumbnail_url: '/thumb.jpg' },
      { asset_id: 'asset-43', thumbnail_url: '/thumb-2.jpg' },
    ],
    photo_count: 2,
    can_edit: true,
    can_delete: false,
  };
}

/**
 * Flush pending promise continuations.
 * @returns {Promise<void>} Completion promise.
 */
async function flush() {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

/**
 * Prove manage-photo refresh keeps the selected-detail target context.
 * @returns {Promise<void>} Completion promise.
 */
async function testSelectedDetailManageRefreshesSelectedTarget() {
  const h = createHarness();
  const selectedId = 'wpr-selected-report-detail-42';

  h.sandbox.wprOpenHistoryDetail(42, selectedId);
  assert.strictEqual(h.requests.length, 1, 'initial selected detail must fetch the report');
  h.requests[0].resolve({ ok: true, json: async () => report('initial') });
  await flush();
  assert.match(h.elements.get(selectedId).innerHTML, /wprTogglePhotoManage\(42/);

  h.sandbox.wprTogglePhotoManage(42, selectedId);
  assert.strictEqual(h.requests.length, 2, 'manage action must refresh the selected detail');
  h.requests[1].resolve({ ok: true, json: async () => report('managed') });
  await flush();

  assert.match(h.elements.get(selectedId).innerHTML, /wprTogglePhotoSelection\(42/);
  assert.match(h.elements.get(selectedId).innerHTML, /wprTogglePhotoManage\(42/);
  assert.match(h.elements.get(selectedId).innerHTML, /wprEditReport\(42,'wpr-selected-report-detail-42'/);
  assert.match(h.elements.get(selectedId).innerHTML, /wprAddExistingPhotos\(42,'wpr-selected-report-detail-42'/);
  assert.match(h.elements.get(selectedId).innerHTML, /wprTogglePhotoSelection\(42/);
}

/**
 * Prove the history target remains the default when no target is supplied.
 * @returns {Promise<void>} Completion promise.
 */
async function testHistoryTargetFallbackRemainsAvailable() {
  const h = createHarness();
  const historyId = 'wpr-detail-7';
  h.elements.set(historyId, { id: historyId, innerHTML: '', textContent: '' });

  h.sandbox.wprOpenHistoryDetail(7);
  assert.strictEqual(h.requests.length, 1, 'history detail must use the default target');
  h.requests[0].resolve({ ok: true, json: async () => report('history') });
  await flush();
  assert.match(h.elements.get(historyId).innerHTML, /wpr-detail-action-edit/);
}

/**
 * Prove the shared reload helper can refresh a selected target without history DOM.
 * @returns {Promise<void>} Completion promise.
 */
async function testReloadHelperPreservesSelectedTarget() {
  const h = createHarness();
  const selectedId = 'wpr-selected-report-detail-42';
  const pages = [];
  h.sandbox.wprLoadHistory = async (page) => { pages.push(page); };

  h.sandbox.wprReloadAndReopenDetail(42, 3, selectedId);
  await flush();
  assert.deepStrictEqual(pages, [3], 'selected refresh must retain the requested history page');
  assert.strictEqual(h.requests.length, 1, 'selected refresh must reopen the selected target');
  h.requests[0].resolve({ ok: true, json: async () => report('reloaded') });
  await flush();
  assert.match(h.elements.get(selectedId).innerHTML, /reloaded/);
}

/**
 * Prove history and selected targets have independent detail freshness tokens.
 * @returns {Promise<void>} Completion promise.
 */
async function testDetailTokensAreScopedPerTarget() {
  const h = createHarness();
  const historyId = 'wpr-detail-42';
  h.elements.set(historyId, { id: historyId, innerHTML: '', textContent: '' });

  h.sandbox.wprOpenHistoryDetail(42);
  h.sandbox.wprOpenHistoryDetail(42, 'wpr-selected-report-detail-42');
  assert.strictEqual(h.requests.length, 2, 'both detail targets must fetch independently');
  h.requests[0].resolve({ ok: true, json: async () => report('history-response') });
  h.requests[1].resolve({ ok: true, json: async () => report('selected-response') });
  await flush();
  assert.match(h.elements.get(historyId).innerHTML, /history-response/);
  assert.match(h.elements.get('wpr-selected-report-detail-42').innerHTML, /selected-response/);
}


/**
 * Prove selection management sends one batch mutation and preserves its target.
 * @returns {Promise<void>} Completion promise.
 */
async function testPhotoManagementUsesOneBatchRequest() {
  const h = createHarness();
  const selectedId = 'wpr-selected-report-detail-42';
  h.sandbox.wprOpenHistoryDetail(42, selectedId);
  h.requests[0].resolve({ ok: true, json: async () => report('initial') });
  await flush();
  h.sandbox.wprTogglePhotoManage(42, selectedId);
  h.requests[1].resolve({ ok: true, json: async () => report('managed') });
  await flush();
  const beforeSelectionRequests = h.requests.length;
  h.sandbox.wprTogglePhotoSelection(42, 0, selectedId);
  await flush();
  assert.strictEqual(h.requests.length, beforeSelectionRequests, 'toggle selection must not fetch the report');
  h.sandbox.wprSelectAllPhotoSelection(42, selectedId);
  await flush();
  assert.strictEqual(h.requests.length, beforeSelectionRequests, 'select all must not fetch the report');
  h.sandbox.wprClearPhotoSelection(42, selectedId);
  await flush();
  assert.strictEqual(h.requests.length, beforeSelectionRequests, 'clear selection must not fetch the report');
  h.sandbox.wprSelectAllPhotoSelection(42, selectedId);
  await flush();
  h.sandbox.window = { confirm: () => true };
  h.sandbox.wprLoadHistory = async () => {};
  h.sandbox.wprBatchDeletePhotos(42, selectedId);
  assert.strictEqual(h.requests.length, 3, 'batch delete must issue one mutation request');
  assert.strictEqual(h.requests[2].url, '/api/work-progress/42/photos/batch-delete');
  assert.strictEqual(h.requests[2].options.method, 'POST');
  const payload = JSON.parse(h.requests[2].options.body);
  assert.deepStrictEqual(payload.asset_ids.sort(), ['asset-42', 'asset-43']);
  h.requests[2].resolve({ ok: true, json: async () => ({ deleted_count: 2, remaining_count: 0 }) });
  await flush();
  assert.strictEqual(h.requests.length, 4, 'successful mutation must refresh the same detail target');
  assert.strictEqual(h.requests[3].url, '/api/work-progress/42');
}
/**
 * History replacement clears history state but preserves selected-detail state.
 * @returns {Promise<void>} Completion promise.
 */
async function testHistoryReloadCleansOnlyHistoryTargets() {
  const h = createHarness();
  const historyState = h.sandbox.wprPhotoManageState(42, 'wpr-detail-42');
  historyState.manage = true;
  historyState.selected['asset-42'] = true;
  const selectedState = h.sandbox.wprPhotoManageState(42, 'wpr-selected-report-detail-42');
  selectedState.manage = true;
  selectedState.selected['asset-43'] = true;
  h.sandbox.wprLoadHistory(1);
  assert.strictEqual(h.requests.length, 1);
  h.requests[0].resolve({ ok: true, json: async () => ({ page: 2, total: 1, items: [{ id: 42, report_date: '2026-09-21', service_name: '保養', client_name: '三重', uploader_name: '測試', photo_count: 2 }] }) });
  await flush();
  assert.strictEqual(h.sandbox.wprPhotoManageState(42, 'wpr-detail-42').manage, false);
  assert.deepStrictEqual(Object.keys(h.sandbox.wprPhotoManageState(42, 'wpr-detail-42').selected), []);
  assert.strictEqual(h.sandbox.wprPhotoManageState(42, 'wpr-selected-report-detail-42').manage, true);
  assert.deepStrictEqual(Object.keys(h.sandbox.wprPhotoManageState(42, 'wpr-selected-report-detail-42').selected), ['asset-43']);
}
/**
 * A failed report delete leaves the live detail state and cache untouched.
 * @returns {Promise<void>} Completion promise.
 */
async function testDeleteReportFailurePreservesPhotoManagementState() {
  const h = createHarness();
  const targetId = 'wpr-selected-report-detail-42';
  const key = h.sandbox.wprPhotoManageKey(42, targetId);
  const state = h.sandbox.wprPhotoManageState(42, targetId);
  state.manage = true;
  state.selected['asset-42'] = true;
  const cached = report('cached-before-delete');
  h.sandbox.wprPhotoManageReports[key] = cached;
  h.sandbox.wprLoadHistory = async () => {};
  h.sandbox.wprLoadDay = async () => {};
  h.sandbox.wprLoadKpi = async () => {};
  h.sandbox.wprDeleteReport(42);
  assert.strictEqual(h.requests.length, 1);
  assert.strictEqual(h.sandbox.wprPhotoManageState(42, targetId).manage, true);
  h.requests[0].reject(new Error('delete failed'));
  await flush();
  assert.strictEqual(h.sandbox.wprPhotoManageState(42, targetId).manage, true);
  assert.strictEqual(h.sandbox.wprPhotoManageState(42, targetId).selected['asset-42'], true);
  assert.strictEqual(h.sandbox.wprPhotoManageReports[key], cached);
}

/**
 * A successful report delete clears its old detail state only after the response.
 * @returns {Promise<void>} Completion promise.
 */
async function testDeleteReportSuccessClearsPhotoManagementState() {
  const h = createHarness();
  const targetId = 'wpr-selected-report-detail-42';
  const key = h.sandbox.wprPhotoManageKey(42, targetId);
  const state = h.sandbox.wprPhotoManageState(42, targetId);
  state.manage = true;
  state.selected['asset-42'] = true;
  h.sandbox.wprPhotoManageReports[key] = report('deleted');
  h.sandbox.wprLoadHistory = async () => {};
  h.sandbox.wprLoadDay = async () => {};
  h.sandbox.wprLoadKpi = async () => {};
  h.sandbox.wprDeleteReport(42);
  assert.strictEqual(h.requests.length, 1);
  assert.strictEqual(h.sandbox.wprPhotoManageStates[key].manage, true);
  h.requests[0].resolve({ ok: true, json: async () => ({ ok: true }) });
  await flush();
  assert.strictEqual(h.sandbox.wprPhotoManageStates[key], undefined);
  assert.strictEqual(h.sandbox.wprPhotoManageReports[key], undefined);
}

/**
 * A failed selected-report navigation preserves the previous report state.
 * @returns {Promise<void>} Completion promise.
 */
async function testSelectedReportSwitchFailurePreservesPreviousManagementState() {
  const h = createHarness();
  const targetId = 'wpr-selected-report-detail-42';
  const oldState = h.sandbox.wprPhotoManageState(42, targetId);
  oldState.manage = true;
  oldState.selected['asset-42'] = true;
  const oldReport = { id: 42, appointment_id: 1 };
  h.sandbox.wprCurrentReport = oldReport;
  h.sandbox.wprAppointments = [{ id: 1 }, { id: 2 }];
  h.sandbox.wprReportsByAppointment = { 2: { id: 43, note: 'B' } };
  h.sandbox.wprHasUnsavedChanges = () => false;
  h.sandbox.wprRenderJobs = () => {};
  h.sandbox.wprSelectJob(2);
  assert.strictEqual(h.requests.length, 1);
  assert.strictEqual(h.sandbox.wprPhotoManageState(42, targetId).manage, true);
  h.requests[0].reject(new Error('switch failed'));
  await flush();
  assert.strictEqual(h.sandbox.wprCurrentReport, oldReport);
  assert.strictEqual(h.sandbox.wprPhotoManageState(42, targetId).selected['asset-42'], true);
}

/**
 * A successful selected-report navigation clears only the previous report state.
 * @returns {Promise<void>} Completion promise.
 */
async function testSelectedReportSwitchSuccessClearsPreviousManagementState() {
  const h = createHarness();
  const targetId = 'wpr-selected-report-detail-42';
  const key = h.sandbox.wprPhotoManageKey(42, targetId);
  const oldState = h.sandbox.wprPhotoManageState(42, targetId);
  oldState.manage = true;
  oldState.selected['asset-42'] = true;
  h.sandbox.wprPhotoManageReports[key] = report('old');
  h.sandbox.wprCurrentReport = { id: 42, appointment_id: 1 };
  h.sandbox.wprAppointments = [{ id: 1 }, { id: 2 }];
  h.sandbox.wprReportsByAppointment = { 2: { id: 43, note: 'B' } };
  h.sandbox.wprHasUnsavedChanges = () => false;
  h.sandbox.wprRenderJobs = () => {};
  h.sandbox.wprSelectJob(2);
  assert.strictEqual(h.requests.length, 1);
  assert.strictEqual(h.sandbox.wprPhotoManageStates[key].manage, true);
  h.requests[0].resolve({ ok: true, json: async () => ({ id: 43, appointment_id: 2, photos: [] }) });
  await flush();
  assert.strictEqual(h.sandbox.wprPhotoManageStates[key], undefined);
  assert.strictEqual(h.sandbox.wprCurrentReport.id, 43);
}
Promise.resolve()
  .then(testDeleteReportFailurePreservesPhotoManagementState)
  .then(testDeleteReportSuccessClearsPhotoManagementState)
  .then(testSelectedReportSwitchFailurePreservesPreviousManagementState)
  .then(testSelectedReportSwitchSuccessClearsPreviousManagementState)
  .then(testHistoryReloadCleansOnlyHistoryTargets)
  .then(testSelectedDetailManageRefreshesSelectedTarget)
  .then(testPhotoManagementUsesOneBatchRequest)
  .then(testHistoryTargetFallbackRemainsAvailable)
  .then(testReloadHelperPreservesSelectedTarget)
  .then(testDetailTokensAreScopedPerTarget)
  .then(() => console.log('work_progress_detail_target_lifecycle: 10 passed'))
  .catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
