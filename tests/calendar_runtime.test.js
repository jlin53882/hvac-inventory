const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const globalsSource = fs.readFileSync('static/js/globals.js', 'utf8');
const calendarRenderSource = fs.readFileSync('static/js/render/calendar.js', 'utf8');
const calendarModalSource = fs.readFileSync('static/js/modals/calendar.js', 'utf8');

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
          const selected = this._innerHTML.match(/<option value="([^"]+)"[^>]*selected/);
          if (selected) this.value = selected[1];
        },
      });
      this.innerText = '';
      this.textContent = '';
      this.style = { display: '' };
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
        return { ok: true, async json() { return state.events; } };
      }
      if (url.startsWith('/api/appointments?date=')) {
        return { ok: true, async json() { return state.events; } };
      }
      if (url === '/api/service-types') {
        return { ok: true, async json() { return state.services; } };
      }
      if (url === '/api/assignable-users') {
        return { ok: true, async json() { return state.assignable; } };
      }
      if (method === 'POST' && url === '/api/appointments') {
        const body = JSON.parse(options.body);
        state.events.push({ ...body, id: 2, user_ids: body.user_ids || [], updated_at: 'new' });
        return { ok: true, async json() { return { id: 2 }; } };
      }
      if (method === 'PUT' && url === '/api/appointments/1') {
        const body = JSON.parse(options.body);
        state.events = state.events.map(event => event.id === 1 ? { ...event, ...body } : event);
        return { ok: true, async json() { return { id: 1 }; } };
      }
      if (method === 'DELETE' && url === '/api/appointments/2') {
        state.events = state.events.filter(event => event.id !== 2);
        return { ok: true, async json() { return {}; } };
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    },
  };
  vm.createContext(context);
  vm.runInContext(globalsSource, context);
  context.calMonth = month;
  context.calSelected = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  vm.runInContext(calendarRenderSource, context);
  vm.runInContext(calendarModalSource, context);

  // These are production render dependencies; this harness asserts the production
  // data-loading/mutation handlers and records their required refresh calls.
  context.calRenderMonth = () => {};
  context.calRenderDay = () => {};
  context.calLoadData = context.calLoadData.bind(context);
  const originalLoadData = context.calLoadData;
  context.calLoadData = async (...args) => {
    calls.refreshes += 1;
    return originalLoadData(...args);
  };
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
  assert.deepStrictEqual(Array.from(context.calEvents), state.events);
  assert.deepStrictEqual(Array.from(context.calSvc), state.services);
  assert.deepStrictEqual(Array.from(context.calAssignable), state.assignable);
}

(async () => {
  const { context, calls, dom, state } = createContext();
  const get = id => dom.elements.get(id) || dom.document.getElementById(id);

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
  assert.strictEqual(calls.refreshes, 2, 'Calendar edit must refresh once after the initial load');

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
  assert.strictEqual(calls.refreshes, 3, 'Calendar create must refresh once');

  // Delete follows the production DELETE path and refreshes after success.
  await context.calDeleteAppt(2);
  const deletion = calls.requests.find(request => request.method === 'DELETE');
  assert(deletion, 'Calendar delete must issue a DELETE request');
  assert.strictEqual(deletion.url, '/api/appointments/2');
  assert.strictEqual(calls.refreshes, 4, 'Calendar delete must refresh once');
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
