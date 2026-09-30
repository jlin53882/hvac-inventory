const assert = require('assert');
const vm = require('vm');
const { installApiClient, loadModules, mockResponse } = require('./support/frontend-runtime');

/**
 * Provide the minimum DOM surface required by the production Calendar handlers.
 * @returns {object} Fake document and element registry.
 */
function createDocument() {
  const elements = new Map();

  class FakeElement {
    constructor(id = '') {
      this.id = id;
      this.value = '';
      this._innerHTML = '';
      Object.defineProperty(this, 'innerHTML', {
        get: () => this._innerHTML,
        set: value => {
          this._innerHTML = String(value);
          if (this._innerHTML === "") this.children = [];
          const selected = this._innerHTML.match(/<option value="([^"]+)"[^>]*selected/);
          if (selected) this.value = selected[1];
        },
      });
      this.innerText = '';
      this.textContent = '';
      this.style = { display: '', setProperty(name, value) { this[name] = value; } };
      this.children = [];
      this.className = '';
      this.hidden = false;
    }

    /**
     * Append a child element to the fake DOM node.
     * @param {object} child Element-like child.
     * @returns {object} The appended child.
     */
    appendChild(child) {
      this.children.push(child);
      return child;
    }
  }

  return {
    elements,
    document: {
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, new FakeElement(id));
        return elements.get(id);
      },
      createElement() {
        return new FakeElement();
      },
    },
  };
}

/**
 * Build a VM with production Calendar code and controlled API responses.
 * @returns {{context: object, calls: object, dom: object, state: object}}
 *   Runtime context, request log, fake DOM, and mutable API state.
 */
function createContext() {
  const dom = createDocument();
  const today = new Date();
  const todayDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const state = {
    events: [{
      id: 1,
      client_name: '既有客戶',
      address: '既有地址',
      date: todayDate,
      start_time: '09:00',
      user_ids: [9],
      service_type_id: 7,
      updated_at: '2026-09-21T00:00:00',
      my_sync_status: {
        status: 'failed',
        key_name: '測試 Key',
        cal_id: 'calendar@example.com',
        error: 'invalid_grant: expired',
      },
    }],
    services: [{ id: 7, name: '維修', is_active: 1, sort_order: 1 }],
    assignable: [{ id: 9, display_name: '測試人員', username: 'tester', color: '#123456' }],
  };
  const calls = { requests: [], refreshes: 0, toasts: [], openedModal: '' };
  const month = new Date(today.getFullYear(), today.getMonth(), 1);

  const context = {
    console,
    Date,
    URLSearchParams,
    location: { search: '' },
    document: dom.document,
    confirm: () => true,
    esc(value) {
      return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
    },
    toast(message) {
      calls.toasts.push(message);
    },
    openModal(id) {
      calls.openedModal = id;
    },
    syncViewUrl() {},
    fetch: async (url, options = {}) => {
      const method = options.method || 'GET';
      calls.requests.push({ url, method, body: options.body ? JSON.parse(options.body) : null });

      if (url.startsWith('/api/appointments?year=')) {
        calls.refreshes += 1;
        return mockResponse(state.events);
      }
      if (url.startsWith('/api/appointments?date=')) {
        return mockResponse(state.events);
      }
      if (url === '/api/service-types') {
        return mockResponse(state.services);
      }
      if (url === '/api/assignable-users') {
        return mockResponse(state.assignable);
      }
      if (method === 'POST' && url === '/api/appointments') {
        const body = JSON.parse(options.body);
        state.events.push({ ...body, id: 2, user_ids: body.user_ids || [], updated_at: 'new' });
        return mockResponse({ id: 2 });
      }
      if (method === 'PUT' && url === '/api/appointments/1') {
        const body = JSON.parse(options.body);
        state.events = state.events.map(event => event.id === 1 ? { ...event, ...body } : event);
        return mockResponse({ id: 1 });
      }
      if (method === 'DELETE' && url === '/api/appointments/2') {
        state.events = state.events.filter(event => event.id !== 2);
        return mockResponse({});
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    },
  };
  vm.createContext(context);
  installApiClient(context);
  loadModules(context, 'core/state.js', 'features/calendar/state.js');
  context.appState.calMonth = month;
  context.calendarState.calSelected = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  // issue #39：頁面外殼 renderCalendar 在 features/calendar/page.js
  loadModules(context, 'features/calendar/format.js', 'features/calendar/sync-status.js', 'features/calendar/search.js',
    'features/calendar/view.js', 'features/calendar/appt-modal.js', 'features/calendar/page.js');

  // Page-entry dependencies outside this finding are kept minimal: the actual
  // renderCalendar/calLoadData/page-shell path remains production code.
  context.hasPerm = () => true;
  context.calSettingsHtml = () => '<div id="cal-settings-stub"></div>';
  context.calMountSearchResults = () => {};
  context.calBindSearchViewportListener = () => {};

  // The production renderers may be replaced only for non-target visual details;
  // renderCalendar and calLoadData themselves remain untouched and executable.
  context.calRenderMonthProduction = context.calRenderMonth;
  context.calRenderMonth = () => {};
  context.calRenderDay = () => {};
  return { context, calls, dom, state };
}

/**
 * Assert the Calendar load contract populates events, services, and assignees.
 * @param {object} context Production VM context.
 * @param {object} state Mutable API fixture state.
 */
async function assertCalendarLoad(context, state) {
  const applied = await context.calLoadData();
  assert.strictEqual(applied, true, 'Calendar load should apply the API response');
  // 回應經 JSON 解析（與瀏覽器相同，是新物件），以值比較
  const plain = value => JSON.parse(JSON.stringify(value));
  assert.deepStrictEqual(plain(context.calendarState.calEvents), state.events);
  assert.deepStrictEqual(plain(context.calendarState.calSvc), state.services);
  assert.deepStrictEqual(plain(context.calendarState.calAssignable), state.assignable);
}

(async () => {
  const { context, calls, dom, state } = createContext();
  const get = id => dom.elements.get(id) || dom.document.getElementById(id);

  // Execute the actual month renderer across every supported week-count shape.
  context.calendarState.calEvents = [];
  context.calendarState.calLoadError = null;
  for (const [month, weeks, cellCount] of [[1, 4, 35], [8, 5, 42], [7, 6, 49]]) {
    context.appState.calMonth = new Date(2026, month, 1);
    context.calRenderMonthProduction();
    assert.strictEqual(get('cal-grid').style['--cal-week-count'], String(weeks));
    assert.strictEqual(get('cal-grid').children.length, cellCount);
    if (month === 8) {
      assert.strictEqual(get('cal-grid').children.at(-1).innerHTML, '<span class="cal-day-num">3</span>',
        'September 2026 must end on October 3');
    }
  }
  // Loading skeleton must follow the month being loaded, not the previous month's row count.
  for (const [month, weeks] of [[1, 4], [7, 6]]) {
    context.appState.calMonth = new Date(2026, month, 1);
    context.calRenderLoadingUi();
    const html = get('cal-grid').innerHTML;
    assert.strictEqual(get('cal-grid').style['--cal-week-count'], String(weeks));
    assert.strictEqual((html.match(/cal-skeleton-cell/g) || []).length, weeks * 7);
    assert.strictEqual((html.match(/class="cal-weekday/g) || []).length, 7);
  }
  context.appState.calMonth = new Date();


  // F1: execute the production page entry instead of jumping directly to calLoadData.
  assert.strictEqual(typeof context.renderCalendar, 'function', 'renderCalendar must be production-loaded');
  await context.renderCalendar();
  assert(get('content').innerHTML.includes('cal-wrap'), 'page entry must build the Calendar shell');
  assert(get('content').innerHTML.includes('cal-grid'), 'page entry must build the Calendar grid');
  assert(get('content').innerHTML.includes('cal-day-list'), 'page entry must build the day detail shell');
  assert(calls.requests.some(request => request.url.startsWith('/api/appointments?year=')),
    'page entry must load monthly appointments through the production path');
  assert(calls.requests.some(request => request.url === '/api/service-types'),
    'page entry must load service types through the production path');
  assert(calls.requests.some(request => request.url === '/api/assignable-users'),
    'page entry must load assignable users through the production path');
  assert.strictEqual(get('cal-load-state').className, 'cal-load-state',
    'page entry must reach the production ready state');
  assert.strictEqual(calls.refreshes, 1, 'page entry must orchestrate exactly one Calendar data load');

  await assertCalendarLoad(context, state);

  // Open/edit uses production modal wiring and preserves the existing assignment.
  context.calOpenAppt(1);
  assert.strictEqual(get('cal-f-client').value, '既有客戶');
  assert.strictEqual(get('cal-f-svc').value, '7');
  assert.strictEqual(get('cal-f-hour').value, '09');
  assert.strictEqual(get('cal-f-minute').value, '00');
  assert.strictEqual(get('cal-appt-modal').style.display, 'flex');

  // Edit follows the production PUT path, sends service type and optimistic-lock data,
  // then refreshes the Calendar data exactly through calLoadData.
  get('cal-f-client').value = '更新客戶';
  get('cal-f-address').value = '更新地址';
  get('cal-f-note').value = '更新備註';
  await context.calSubmitAppt();
  const edit = calls.requests.find(request => request.method === 'PUT');
  assert(edit, 'Calendar edit must issue a PUT request');
  assert.strictEqual(edit.url, '/api/appointments/1');
  assert.strictEqual(edit.body.client_name, '更新客戶');
  assert.strictEqual(edit.body.service_type_id, 7);
  assert.deepStrictEqual(edit.body.user_ids, [9]);
  assert.strictEqual(edit.body.updated_at, '2026-09-21T00:00:00');
  assert.strictEqual(calls.refreshes, 3, 'Calendar edit must refresh once after the page-open and explicit load');

  // Create follows the production POST path and keeps an optional time empty when
  // either time selector is left at the production "--" option.
  context.calOpenAppt();
  get('cal-f-client').value = '新增客戶';
  get('cal-f-address').value = '新增地址';
  get('cal-f-svc').value = '7';
  get('cal-f-hour').value = '';
  get('cal-f-minute').value = '';
  get('cal-f-note').value = '新增備註';
  await context.calSubmitAppt();
  const create = calls.requests.find(request => request.method === 'POST');
  assert(create, 'Calendar create must issue a POST request');
  assert.strictEqual(create.url, '/api/appointments');
  assert.strictEqual(create.body.client_name, '新增客戶');
  assert.strictEqual(create.body.service_type_id, 7);
  assert.strictEqual(create.body.start_time, '');
  assert.strictEqual(create.body.end_time, '');
  assert.deepStrictEqual(create.body.user_ids, []);
  assert.strictEqual(calls.refreshes, 4, 'Calendar create must refresh once after page-open and edit');

  // Delete follows the production DELETE path and refreshes after success.
  await context.calDeleteAppt(2);
  const deletion = calls.requests.find(request => request.method === 'DELETE');
  assert(deletion, 'Calendar delete must issue a DELETE request');
  assert.strictEqual(deletion.url, '/api/appointments/2');
  assert.strictEqual(calls.refreshes, 5, 'Calendar delete must refresh once after page-open and mutations');
  assert(!state.events.some(event => event.id === 2), 'Deleted event must not remain in refreshed state');

  // Sync error detail uses the production status mapping and opens the real modal path.
  context.calShowSyncError(1);
  assert.strictEqual(get('cal-sync-err-status').textContent, '同步失敗');
  assert.strictEqual(get('cal-sync-err-msg').textContent, 'invalid_grant: expired');
  assert.strictEqual(calls.openedModal, 'cal-sync-error-modal');
  assert(calls.toasts.includes('✅ 行程已更新'), 'Edit success toast should be emitted');
  assert(calls.toasts.includes('✅ 行程已新增'), 'Create success toast should be emitted');
  assert(calls.toasts.includes('🗑 已刪除'), 'Delete success toast should be emitted');

  console.log('calendar runtime: PASS');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
