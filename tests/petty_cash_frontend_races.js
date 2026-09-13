const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const elements = {};
const listeners = [];

function element(id, value = '') {
  const el = {
    id,
    value,
    textContent: '',
    innerHTML: '',
    style: { display: '' },
    className: '',
    dataset: {},
    disabled: false,
    classList: {
      toggle() {},
      add() {},
      remove() {},
      contains() { return false; },
    },
    addEventListener() {},
    insertAdjacentHTML(position, html) { this.innerHTML += html; },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    remove() { this.removed = true; },
  };
  elements[id] = el;
  return el;
}

[
  'content', 'pc-f-from', 'pc-f-to', 'pc-f-person', 'pc-f-status', 'pc-f-type', 'pc-f-q',
  'pc-result-count', 'pc-tbody', 'pc-cards', 'pc-empty', 'pc-page-info',
  'pc-kpi-total', 'pc-kpi-done', 'pc-kpi-draft',
  'pc-m-start', 'pc-m-end', 'pc-m-filetext', 'pc-m-uploader', 'pc-m-prepared',
  'pc-m-opening', 'pc-report-overlay', 'eng-start', 'eng-end', 'eng-owner',
  'eng-prepared', 'eng-note', 'eng-report-overlay', 'eng-editor',
].forEach(id => element(id));

elements['pc-m-start'].value = '2026-09-01';
elements['pc-m-end'].value = '2026-09-04';
elements['pc-m-filetext'].value = 'test';
elements['pc-m-uploader'].value = '藍先生';
elements['pc-m-prepared'].value = '王小明';
elements['pc-m-opening'].value = '0';
elements['eng-start'].value = '2026-09-01';
elements['eng-end'].value = '2026-09-04';
elements['eng-owner'].value = '藍先生';
elements['eng-prepared'].value = '王小明';
elements['eng-note'].value = '';

elements['pc-report-overlay'].querySelectorAll = () => [];
elements['eng-report-overlay'].querySelectorAll = () => [];

const document = {
  getElementById(id) { return elements[id] || element(id); },
  querySelectorAll() { return []; },
  addEventListener(type, fn) { listeners.push({ type, fn }); },
  createElement() {
    return {
      value: '',
      textContent: '',
      selected: false,
      insertBefore() {},
      get lastElementChild() { return null; },
    };
  },
};

const pending = [];
function controlledFetch(url) {
  return new Promise((resolve, reject) => pending.push({ url: String(url), resolve, reject }));
}
function response(payload, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => payload };
}
function findPending(fragment) {
  const item = pending.find(x => x.url.includes(fragment));
  assert(item, `pending request not found: ${fragment}\n${pending.map(x => x.url).join('\n')}`);
  return item;
}
function findPendingLast(fragment) {
  const matches = pending.filter(x => x.url.includes(fragment));
  const item = matches[matches.length - 1];
  assert(item, `pending request not found: ${fragment}\n${pending.map(x => x.url).join('\n')}`);
  return item;
}
function resolvePending(fragment, payload) {
  const item = findPending(fragment);
  pending.splice(pending.indexOf(item), 1);
  item.resolve(response(payload));
}
function resolvePendingLast(fragment, payload) {
  const item = findPendingLast(fragment);
  pending.splice(pending.indexOf(item), 1);
  item.resolve(response(payload));
}
function rejectPending(fragment, error = new Error('network failure')) {
  const item = findPending(fragment);
  pending.splice(pending.indexOf(item), 1);
  item.reject(error);
}
async function flush() {
  await Promise.resolve();
  await new Promise(resolve => setImmediate(resolve));
  await Promise.resolve();
}

const context = {
  console,
  document,
  window: { open() {} },
  fetch: controlledFetch,
  URLSearchParams,
  toast() {},
  confirm() { return true; },
  esc(value) { return String(value ?? ''); },
  jsStr(value) { return String(value ?? ''); },
};
vm.createContext(context);
for (const file of [
  'static/js/render/petty-cash.js',
  'static/js/modals/petty-cash.js',
  'static/js/modals/engineering-petty-cash.js',
]) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), context, { filename: file });
}

function report(id, owner = '藍先生') {
  return {
    id,
    report_type: 'general',
    start_date: '2026-09-01',
    end_date: '2026-09-04',
    filename: `report-${id}.xlsx`,
    filename_text: 'test',
    upload_person: owner,
    prepared_by: '王小明',
    status: 'draft',
    can_edit: true,
    opening_balance: 0,
    totals: { opening_balance: 0, income: 0, expense: 0, closing_balance: 0 },
    entries: [],
  };
}

async function testHistoryLatestResponseWins() {
  elements['pc-f-q'].value = 'A';
  context.pcLoadHistory(true);
  elements['pc-f-q'].value = 'B';
  context.pcLoadHistory(true);
  resolvePending('search=B', { items: [report(2, 'B')], total: 1, page: 1, page_size: 20 });
  await flush();
  resolvePending('/api/petty-cash/kpi?', { total: 1, completed: 0, draft: 1 });
  await flush();
  resolvePending('search=A', { items: [report(1, 'A')], total: 1, page: 1, page_size: 20 });
  await flush();
  assert.strictEqual(context.pcReports[0].id, 2, 'late history response overwrote latest filter');
  assert(elements['pc-tbody'].innerHTML.includes('report-2.xlsx'), 'latest history row was not rendered');
  assert.strictEqual(String(elements['pc-kpi-total'].textContent), '1', 'KPI did not remain on latest filter');
}

async function testDetailLatestResponseWins() {
  context.pcOpenDetail(10);
  context.pcOpenDetail(20);
  resolvePending('/api/petty-cash-reports/20', report(20));
  await flush();
  resolvePending('/api/petty-cash-reports/10', report(10));
  await flush();
  assert.strictEqual(context.pcDetail.id, 20, 'late detail response overwrote latest selection');
  assert(elements.content.innerHTML.includes('report-20.xlsx'), 'latest detail was not rendered');
}

async function testModalLatestResponseWins() {
  async function runPair(firstType, secondType) {
    elements.content.innerHTML = '';
    const first = firstType === 'general'
      ? context.pcOpenReportModal(101)
      : context.pcOpenEngineeringModal(101);
    const second = secondType === 'general'
      ? context.pcOpenReportModal(202)
      : context.pcOpenEngineeringModal(202);

    if (secondType === 'general') {
      resolvePendingLast('report_type=general', { items: [] });
      await flush();
      resolvePending('/api/petty-cash-reports/202', report(202, 'B'));
      await flush();
    } else {
      resolvePendingLast('report_type=engineering&option_type=category', { items: [] });
      resolvePendingLast('report_type=engineering&option_type=group', { items: [] });
      await flush();
      resolvePending('/api/petty-cash-reports/202', report(202, 'B'));
      await flush();
    }

    if (firstType === 'general') {
      resolvePending('report_type=general', { items: [] });
      await flush();
      if (pending.some(x => x.url.includes('/api/petty-cash-reports/101'))) {
        resolvePending('/api/petty-cash-reports/101', report(101, 'A'));
        await flush();
      }
    } else {
      resolvePending('report_type=engineering&option_type=category', { items: [] });
      resolvePending('report_type=engineering&option_type=group', { items: [] });
      await flush();
      if (pending.some(x => x.url.includes('/api/petty-cash-reports/101'))) {
        resolvePending('/api/petty-cash-reports/101', report(101, 'A'));
        await flush();
      }
    }
    await Promise.all([first, second]);

    const html = elements.content.innerHTML;
    const generalCount = (html.match(/id="pc-report-overlay"/g) || []).length;
    const engineeringCount = (html.match(/id="eng-report-overlay"/g) || []).length;
    assert.strictEqual(secondType === 'general' ? generalCount : engineeringCount, 1, `${secondType} modal was not rendered`);
    assert.strictEqual(firstType === 'general' ? generalCount : engineeringCount, secondType === firstType ? 1 : 0,
      `${firstType} stale modal survived unexpectedly`);
    if (firstType !== secondType) {
      assert.strictEqual(firstType === 'general' ? engineeringCount : generalCount, 1, 'latest cross-type modal missing');
    }
    assert.strictEqual(pending.length, 0, 'modal race left pending requests');
  }

  await runPair('general', 'general');
  await runPair('engineering', 'engineering');
  await runPair('general', 'engineering');
  await runPair('engineering', 'general');
}

async function testGeneralSaveIsSingleFlightAndRecovers() {
  context.pcValidateBasic = () => true;
  context.pcModalGotoStep = () => true;
  context.pcCloseReportModal = () => {};
  context.renderPettyCash = () => {};
  context.pcModalEditingId = null;
  context.pcModalEntries = [];
  context.pcModalReturnToDetail = false;
  context.pcOpeningSource = 'manual';
  context.pcModalSessionType = 'general';
  context.pcModalOpenSeq = 100;
  context.pcSaveInFlight = false;
  const first = context.pcModalSave('draft');
  const second = context.pcModalSave('completed');
  assert.strictEqual(pending.filter(x => x.url.includes('/api/petty-cash-reports')).length, 1, 'general double click sent two writes');
  rejectPending('/api/petty-cash-reports');
  await first;
  await second;
  assert.strictEqual(context.pcSaveInFlight, false, 'general save failure left the lock enabled');
  context.pcModalOpenSeq = 101;
  context.pcModalSessionType = 'general';
  const retry = context.pcModalSave('draft');
  assert.strictEqual(pending.filter(x => x.url.includes('/api/petty-cash-reports')).length, 1, 'general retry was blocked after failure');
  resolvePending('/api/petty-cash-reports', { id: 30 });
  await retry;
}

async function testEngineeringSaveIsSingleFlight() {
  context.engValidateBasic = () => true;
  context.engSyncAll = () => {};
  context.engCloseModal = () => {};
  context.renderPettyCash = () => {};
  context.engEditingId = null;
  context.engData = { categories: [] };
  context.pcModalSessionType = 'engineering';
  context.pcModalOpenSeq = 200;
  context.pcSaveInFlight = false;
  const first = context.engSave('completed');
  const second = context.engSave('completed');
  assert.strictEqual(pending.filter(x => x.url.includes('/api/petty-cash-reports')).length, 1, 'engineering double click sent two writes');
  resolvePending('/api/petty-cash-reports', { id: 31 });
  await first;
  await second;
  assert.strictEqual(context.pcSaveInFlight, false, 'engineering save did not release the lock');
}

async function main() {
  await testHistoryLatestResponseWins();
  await testDetailLatestResponseWins();
  await testModalLatestResponseWins();
  await testGeneralSaveIsSingleFlightAndRecovers();
  await testEngineeringSaveIsSingleFlight();
  const render = fs.readFileSync(path.join(ROOT, 'static/js/render/petty-cash.js'), 'utf8');
  assert(render.includes('pcPageSize * (pcPage - 1) + idx + 1'), 'engineering pagination offset contract missing');
  console.log('petty cash frontend race/single-flight regression harness: PASS');
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
