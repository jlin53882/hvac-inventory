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
    currentTab: 'work-progress',
    toast() {},
    esc(value) { return String(value); },
    jsStr(value) { return String(value); },
    wprFetch() {
      let resolve;
      let reject;
      const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
      requests.push({ resolve, reject });
      return promise;
    },
    console,
    Promise,
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
    wprHistoryPage: 1,
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
    photos: [{ asset_id: 'asset-42', thumbnail_url: '/thumb.jpg' }],
    photo_count: 1,
    can_edit: true,
    can_delete: false,
  };
}

/**
 * Flush pending promise continuations.
 * @returns {Promise<void>} Completion promise.
 */
async function flush() {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
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

  assert.match(h.elements.get(selectedId).innerHTML, /wpr-photo-delete/);
  assert.match(h.elements.get(selectedId).innerHTML, /wprTogglePhotoManage\(42/);
  assert.match(h.elements.get(selectedId).innerHTML, /wprEditReport\(42,'wpr-selected-report-detail-42'/);
  assert.match(h.elements.get(selectedId).innerHTML, /wprAddExistingPhotos\(42,'wpr-selected-report-detail-42'/);
  assert.match(h.elements.get(selectedId).innerHTML, /wprDeletePhoto\(42,'asset-42','wpr-selected-report-detail-42'/);
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

Promise.resolve()
  .then(testSelectedDetailManageRefreshesSelectedTarget)
  .then(testHistoryTargetFallbackRemainsAvailable)
  .then(testReloadHelperPreservesSelectedTarget)
  .then(testDetailTokensAreScopedPerTarget)
  .then(() => console.log('work_progress_detail_target_lifecycle: 4 passed'))
  .catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
