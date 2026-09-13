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

async function testHistoryFilterContextsAndRefreshes() {
  const contexts = [
    ['pc-f-from', 'start_date=B', 'start_date=A'],
    ['pc-f-to', 'end_date=B', 'end_date=A'],
    ['pc-f-person', 'upload_person=B', 'upload_person=A'],
    ['pc-f-status', 'status=B', 'status=A'],
    ['pc-f-type', 'report_type=B', 'report_type=A'],
    ['pc-f-q', 'search=B', 'search=A'],
  ];
  for (const [field, latestFragment, staleFragment] of contexts) {
    ['pc-f-from', 'pc-f-to', 'pc-f-person', 'pc-f-status', 'pc-f-type', 'pc-f-q'].forEach(id => {
      elements[id].value = '';
    });
    elements[field].value = 'A';
    context.pcLoadHistory(true);
    elements[field].value = 'B';
    context.pcLoadHistory(true);
    resolvePending(latestFragment, { items: [report(200, 'B')], total: 1, page: 1, page_size: 20 });
    await flush();
    resolvePending('/api/petty-cash/kpi?', { total: 1, completed: 0, draft: 1 });
    await flush();
    resolvePending(staleFragment, { items: [report(100, 'A')], total: 1, page: 1, page_size: 20 });
    await flush();
    assert.strictEqual(context.pcReports[0].id, 200, `${field} stale response overwrote latest context`);
  }

  elements['pc-f-q'].value = '';
  context.pcPage = 1;
  context.pcLoadHistory();
  context.pcPage = 2;
  context.pcLoadHistory();
  resolvePending('page=2', { items: [report(202, 'page-2')], total: 40, page: 2, page_size: 20 });
  await flush();
  resolvePending('/api/petty-cash/kpi?', { total: 40, completed: 20, draft: 20 });
  await flush();
  resolvePending('page=1', { items: [report(101, 'page-1')], total: 40, page: 1, page_size: 20 });
  await flush();
  assert.strictEqual(context.pcPage, 2, 'stale pagination response changed current page');
  assert.strictEqual(context.pcReports[0].id, 202, 'stale pagination response replaced current rows');
}

function testPaginationRendersPageOffsets() {
  context.pcReports = [
    report(1, 'general'),
    { ...report(2, 'engineering'), report_type: 'engineering', total_amount: 1004 },
  ];
  context.pcTotal = 60;
  for (const page of [1, 2, 3]) {
    context.pcPage = page;
    context.pcRenderTable();
    const html = elements['pc-tbody'].innerHTML;
    const first = page === 1 ? '<td>1</td>' : page === 2 ? '<td>21</td>' : '<td>41</td>';
    const second = page === 1 ? '<td>2</td>' : page === 2 ? '<td>22</td>' : '<td>42</td>';
    assert(html.includes(first) && html.includes(second), `page ${page} mixed report sequence is incorrect`);
  }
}

async function testMutationRefreshesKeepLatestResponse() {
  for (const operation of ['save', 'delete']) {
    elements['pc-f-from'].value = '';
    elements['pc-f-to'].value = '';
    elements['pc-f-person'].value = '';
    elements['pc-f-status'].value = '';
    elements['pc-f-type'].value = '';
    elements['pc-f-q'].value = '';
    context.pcPage = 1;
    context.pcLoadHistory();
    context.pcLoadHistory();
    resolvePendingLast('page=1', { items: [report(302, `${operation}-latest`)], total: 1, page: 1, page_size: 20 });
    await flush();
    resolvePending('/api/petty-cash/kpi?', { total: 1, completed: 1, draft: 0 });
    await flush();
    resolvePending('page=1', { items: [report(301, `${operation}-stale`)], total: 1, page: 1, page_size: 20 });
    await flush();
    assert.strictEqual(context.pcReports[0].id, 302, `${operation} refresh was overwritten by stale response`);
  }
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
  context.pcModalEditingId = 88;
  context.pcModalOpenSeq = 102;
  context.pcModalSessionType = 'general';
  const update = context.pcModalSave('completed');
  assert(pending.some(x => x.url.includes('/api/petty-cash-reports/88')), 'general update used create endpoint');
  resolvePending('/api/petty-cash-reports/88', { id: 88 });
  await update;
  context.pcModalEditingId = null;
  context.pcModalOpenSeq = 103;
  context.pcModalSessionType = 'general';
  const completedCreate = context.pcModalSave('completed');
  resolvePending('/api/petty-cash-reports', { id: 89 });
  await completedCreate;
  context.pcModalEditingId = 89;
  context.pcModalOpenSeq = 104;
  context.pcModalSessionType = 'general';
  const draftUpdate = context.pcModalSave('draft');
  resolvePending('/api/petty-cash-reports/89', { id: 89 });
  await draftUpdate;
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
  context.engEditingId = null;
  context.pcModalSessionType = 'engineering';
  context.pcModalOpenSeq = 202;
  const draftCreate = context.engSave('draft');
  resolvePending('/api/petty-cash-reports', { id: 32 });
  await draftCreate;
  context.engEditingId = 32;
  context.pcModalSessionType = 'engineering';
  context.pcModalOpenSeq = 203;
  const draftUpdate = context.engSave('draft');
  resolvePending('/api/petty-cash-reports/32', { id: 32 });
  await draftUpdate;
  context.engEditingId = 77;
  context.pcModalSessionType = 'engineering';
  context.pcModalOpenSeq = 204;
  const failedUpdate = context.engSave('draft');
  const duplicateUpdate = context.engSave('completed');
  assert.strictEqual(pending.filter(x => x.url.includes('/api/petty-cash-reports/77')).length, 1, 'engineering update double click sent two writes');
  rejectPending('/api/petty-cash-reports/77');
  await failedUpdate;
  await duplicateUpdate;
  assert.strictEqual(context.pcSaveInFlight, false, 'engineering failure left the lock enabled');
  const retry = context.engSave('completed');
  resolvePending('/api/petty-cash-reports/77', { id: 77 });
  await retry;
}

async function main() {
  await testHistoryLatestResponseWins();
  await testHistoryFilterContextsAndRefreshes();
  await testMutationRefreshesKeepLatestResponse();
  await testDetailLatestResponseWins();
  await testModalLatestResponseWins();
  testPaginationRendersPageOffsets();
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
