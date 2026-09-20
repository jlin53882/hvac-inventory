const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

class FakeClassList {
  constructor(owner) { this.owner = owner; }
  add(name) { this.owner.className = `${this.owner.className} ${name}`.trim(); }
  remove(name) { this.owner.className = this.owner.className.split(/\s+/).filter(x => x && x !== name).join(' '); }
}

class FakeElement {
  constructor(document, tag = 'div', id = '') {
    this.document = document;
    this.tagName = tag.toUpperCase();
    this.id = id;
    this.children = [];
    this.parentElement = null;
    this.className = '';
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.textContent = '';
    this._innerHTML = '';
    this.classList = new FakeClassList(this);
  }
  set innerHTML(value) {
    this._innerHTML = value;
    this.children = [];
    this.document.parse(this, value);
  }
  get innerHTML() { return this._innerHTML; }
  append(child) {
    child.parentElement = this;
    this.children.push(child);
  }
  querySelector(selector) {
    return this.document.find(this, selector);
  }
  closest(selector) {
    if (selector === '.perm-row' && this.parentElement?.className.split(/\s+/).includes('perm-row')) {
      return this.parentElement;
    }
    return null;
  }
}

class FakeDocument {
  constructor() {
    this.roots = new Map();
    for (const id of ['tab-perms', 'userList', 'chipBar', 'panelHead']) {
      this.roots.set(id, new FakeElement(this, 'div', id));
    }
    this.domReady = null;
  }
  getElementById(id) { return this.roots.get(id) || null; }
  addEventListener(event, callback) { if (event === 'DOMContentLoaded') this.domReady = callback; }
  dispatchReady() { return this.domReady(); }
  register(element) { if (element.id) this.roots.set(element.id, element); }
  make(parent, tag, id = '') {
    const element = new FakeElement(this, tag, id);
    parent.append(element);
    this.register(element);
    return element;
  }
  parse(parent, html) {
    if (html.includes('id="permission-view"')) this.make(parent, 'div', 'permission-view');
    if (html.includes('id="permission-toolbar"')) this.make(parent, 'div', 'permission-toolbar');
    if (html.includes('id="permission-results"')) this.make(parent, 'div', 'permission-results');
    if (html.includes('id="saveHint"')) this.make(parent, 'span', 'saveHint');

    const search = html.match(/<input[^>]*id="permission-search"[^>]*>/);
    if (search) {
      const input = this.make(parent, 'input', 'permission-search');
      input.value = decodeHtml((search[0].match(/value="([^"]*)"/) || ['', ''])[1]);
    }

    const rowRe = /<div class="perm-row([^\"]*)">([\s\S]*?)<\/div>\s*<\/div>/g;
    let rowMatch;
    while ((rowMatch = rowRe.exec(html))) {
      const row = this.make(parent, 'div');
      row.className = `perm-row${rowMatch[1]}`;
      const body = rowMatch[2];
      const key = (body.match(/data-key="([^"]+)"/) || [])[1];
      if (!key) continue;
      const input = this.make(row, 'input');
      input.dataset = { key };
      const inputTag = (body.match(/<input[^>]*>/) || [''])[0];
      input.checked = /(?:^|\s)checked(?:=|\s|>)/.test(inputTag);
      input.disabled = /\sdisabled(?:\s|>)/.test(body);
      const srcMatch = body.match(/<span class="perm-src ([^"]+)">([^<]*)<\/span>/);
      if (srcMatch) {
        const src = this.make(row, 'span');
        src.className = `perm-src ${srcMatch[1]}`;
        src.textContent = srcMatch[2];
      }
    }
  }
  find(root, selector) {
    const all = [];
    const walk = node => { for (const child of node.children) { all.push(child); walk(child); } };
    walk(root);
    if (selector === '.perm-src') return all.find(x => x.className.split(/\s+/).includes('perm-src')) || null;
    const keyMatch = selector.match(/^input\[data-key="([^"]+)"\]$/);
    if (keyMatch) return all.find(x => x.tagName === 'INPUT' && x.dataset?.key === keyMatch[1]) || null;
    return null;
  }
  querySelector(selector) {
    for (const root of this.roots.values()) {
      const found = this.find(root, selector);
      if (found) return found;
    }
    return null;
  }
}

function decodeHtml(value) {
  return value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

function response(payload, status = 200) {
  return { status, ok: status >= 200 && status < 300, statusText: 'OK', json: async () => payload };
}

async function setup() {
  const document = new FakeDocument();
  const detail = {
    permissions: Array.from({ length: 11 }, (_, i) => ({
      key: i === 0 ? 'signed-report-upload' : `permission-${i}`,
      label: i === 0 ? '每日簽名日報表 上傳' : `測試權限 ${i}`,
      module: i === 0 ? 'calendar' : 'stock',
      allowed: true,
      source: 'role',
    })),
    page_visibility: { all_pages: [], visible_pages: [] },
  };
  const fetchQueue = [
    response({ user: { id: 1, is_admin_role: true, permissions: { 'user-mgmt': true }, visible_pages: ['perms'] } }),
    response({ users: [{ id: 2, display_name: '測試帳號', username: 'tester', role: 'user', is_active: true }] }),
    response(detail),
  ];
  const context = {
    console,
    document,
    window: {},
    location: { href: '' },
    fetch: async () => fetchQueue.shift() || response({}),
    toast: () => {},
    esc: value => String(value),
    jsStr: value => String(value).replaceAll("'", "\\'") ,
  };
  context.window = context;
  vm.runInNewContext(fs.readFileSync('static/js/perms.js', 'utf8'), context, { filename: 'static/js/perms.js' });
  await document.dispatchReady();
  await new Promise(resolve => setTimeout(resolve, 20));
  return { context, document };
}

async function testSearchKeepsStableInput() {
  const { context, document } = await setup();
  const before = document.getElementById('permission-search');
  before.value = '日';
  context.permSearch('日');
  const afterFirst = document.getElementById('permission-search');
  afterFirst.value = '日報';
  context.permSearch('日報');
  const afterSecond = document.getElementById('permission-search');
  assert.strictEqual(afterFirst, afterSecond, 'search input DOM identity must remain stable');
  assert.strictEqual(afterSecond.value, '日報', 'search value must accumulate across keystrokes');
  assert.ok(document.getElementById('permission-results') || document.getElementById('permission-view'), 'search results must remain rendered');
}

async function testPendingSourceSurvivesPagination() {
  const { context, document } = await setup();
  context.permToggle('signed-report-upload', false);
  context.permPage(1);
  context.permPage(-1);
  const input = document.querySelector('input[data-key="signed-report-upload"]');
  const source = input.closest('.perm-row').querySelector('.perm-src');
  assert.strictEqual(input.checked, false, 'pending checkbox value must survive page changes');
  assert.strictEqual(source.textContent, '✏️ 自訂', 'pending source label must survive page changes');
  assert.ok(source.className.split(/\s+/).includes('override'), 'pending source class must be override');
}

(async () => {
  await testSearchKeepsStableInput();
  await testPendingSourceSurvivesPagination();
  console.log('permissions pagination runtime: PASS');
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
