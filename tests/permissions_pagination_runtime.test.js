const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

class FakeClassList {
  constructor(owner) { this.owner = owner; }
  add(name) { this.owner.className = `${this.owner.className} ${name}`.trim(); }
  remove(name) { this.owner.className = this.owner.className.split(/\s+/).filter(x => x && x !== name).join(' '); }
  toggle(name, force) {
    const present = this.owner.className.split(/\s+/).includes(name);
    const next = force === undefined ? !present : Boolean(force);
    if (next) this.add(name); else this.remove(name);
    return next;
  }
}

class FakeElement {
  constructor(document, tag = 'div', id = '') {
    this.document = document;
    this.tagName = tag.toUpperCase();
    this.id = id;
    this.children = [];
    this.parentElement = null;
    this.className = '';
    this.dataset = {};
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
  append(child) { child.parentElement = this; this.children.push(child); }
  querySelector(selector) { return this.document.find(this, selector); }
  querySelectorAll(selector) { return this.document.findAll(this, selector); }
  closest(selector) {
    let node = this;
    while (node) {
      if (selector === '.perm-row' && node.className.split(/\s+/).includes('perm-row')) return node;
      node = node.parentElement;
    }
    return null;
  }
}

class FakeDocument {
  constructor() {
    this.roots = new Map();
    for (const id of ['tab-perms', 'tab-account', 'userList', 'chipBar', 'panelHead']) {
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
    for (const id of ['permission-view', 'permission-toolbar', 'permission-results', 'saveHint']) {
      if (html.includes(`id="${id}"`)) this.make(parent, 'div', id);
    }
    const search = html.match(/<input[^>]*id="permission-search"[^>]*>/);
    if (search) {
      const input = this.make(parent, 'input', 'permission-search');
      input.value = decodeHtml((search[0].match(/value="([^"]*)"/) || ['', ''])[1]);
    }
    const filterRe = /<button class="perm-filter ([^"]*)" data-module="([^"]+)"[^>]*>([^<]*)<\/button>/g;
    let match;
    while ((match = filterRe.exec(html))) {
      const button = this.make(parent, 'button');
      button.className = `perm-filter ${match[1]}`.trim();
      button.dataset.module = match[2];
      button.textContent = match[3];
    }
    const inputRe = /<input[^>]*(?:data-key|data-page-key)="([^"]+)"[^>]*>/g;
    while ((match = inputRe.exec(html))) {
      const inputTag = match[0];
      const key = (inputTag.match(/data-key="([^"]+)"/) || [])[1];
      const pageKey = (inputTag.match(/data-page-key="([^"]+)"/) || [])[1];
      const rowStart = html.lastIndexOf('<div class="perm-row', match.index);
      const row = this.make(parent, 'div');
      row.className = html.slice(rowStart, match.index).match(/<div class="perm-row([^\"]*)">/)?.[1] ? `perm-row${html.slice(rowStart, match.index).match(/<div class="perm-row([^\"]*)">/)[1]}` : 'perm-row';
      const input = this.make(row, 'input');
      if (key) input.dataset.key = key;
      if (pageKey) input.dataset.pageKey = pageKey;
      input.checked = /(?:^|\s)checked(?:=|\s|>)/.test(inputTag);
      input.disabled = /\sdisabled(?:\s|>)/.test(inputTag);
      const rowText = html.slice(rowStart, match.index);
      const srcMatch = rowText.match(/<span class="perm-src ([^"]+)">([^<]*)<\/span>/);
      if (srcMatch) {
        const source = this.make(row, 'span');
        source.className = `perm-src ${srcMatch[1]}`;
        source.textContent = srcMatch[2];
      }
    }
  }
  descendants(root) {
    const all = [];
    const walk = node => { for (const child of node.children) { all.push(child); walk(child); } };
    walk(root);
    return all;
  }
  findAll(root, selector) {
    const all = this.descendants(root);
    if (selector === '#permission-toolbar .perm-filter') {
      return all.filter(x => x.className.split(/\s+/).includes('perm-filter'));
    }
    const keyMatch = selector.match(/^input\[data-key="([^"]+)"\]$/);
    if (keyMatch) return all.filter(x => x.tagName === 'INPUT' && x.dataset.key === keyMatch[1]);
    const pageMatch = selector.match(/^input\[data-page-key="([^"]+)"\]$/);
    if (pageMatch) return all.filter(x => x.tagName === 'INPUT' && x.dataset.pageKey === pageMatch[1]);
    return [];
  }
  find(root, selector) {
    const found = this.findAll(root, selector);
    if (found.length) return found[0];
    if (selector === '.perm-src') return this.descendants(root).find(x => x.className.split(/\s+/).includes('perm-src')) || null;
    return null;
  }
  querySelector(selector) {
    for (const root of this.roots.values()) {
      const found = this.find(root, selector);
      if (found) return found;
    }
    return null;
  }
  querySelectorAll(selector) {
    for (const root of this.roots.values()) {
      const found = this.findAll(root, selector);
      if (found.length) return found;
    }
    return [];
  }
}

function decodeHtml(value) {
  return value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

function response(payload, status = 200) {
  return { status, ok: status >= 200 && status < 300, statusText: 'OK', json: async () => payload };
}

function buildPermissions() {
  const fixed = [
    ['view', '庫存瀏覽/搜尋/看照片', 'view', true, 'locked'],
    ['signed-report-upload', '每日簽名日報表 上傳', 'reports', true, 'role'],
    ['signed-report-edit', '簽名報表 編輯本人', 'reports', true, 'role'],
    ['signed-report-delete', '簽名報表 刪除本人', 'reports', true, 'role'],
    ['quotation-upload-manage', '報價單上傳 管理本人', 'reports', true, 'role'],
    ['item-mgmt', '品項／報價單 CRUD + 單位快速新增', 'stock', false, 'role'],
    ['stock-mgmt', '庫存位置/數量調整', 'stock', true, 'role'],
  ];
  const permissions = fixed.map(([key, label, module, allowed, source]) => ({ key, label, module, allowed, source }));
  for (let i = permissions.length; i < 22; i += 1) {
    permissions.push({ key: `permission-${i}`, label: `測試權限 ${i}`, module: i % 2 ? 'stock' : 'reports', allowed: true, source: 'role' });
  }
  return permissions;
}

async function setup() {
  const document = new FakeDocument();
  const detail = {
    permissions: buildPermissions(),
    page_visibility: { all_pages: ['inventory', 'calendar'], visible_pages: ['calendar'] },
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
    setTimeout,
    fetch: async () => fetchQueue.shift() || response({}),
    toast: () => {},
    esc: value => String(value),
    jsStr: value => String(value).replaceAll("'", "\\'"),
  };
  context.window = context;
  vm.runInNewContext(fs.readFileSync('static/js/perms.js', 'utf8'), context, { filename: 'static/js/perms.js' });
  await document.dispatchReady();
  await new Promise(resolve => setTimeout(resolve, 20));
  return { context, document };
}

function resultHtml(document) { return document.getElementById('permission-results').innerHTML; }
function renderedKeys(document) { return [...resultHtml(document).matchAll(/data-key="([^"]+)"/g)].map(match => match[1]); }
function pageText(document) { return resultHtml(document).match(/第 (\d+) \/ (\d+) 頁/); }
function sourceFor(document, key) { return document.querySelector(`input[data-key="${key}"]`).closest('.perm-row').querySelector('.perm-src'); }
function filterButton(document, module) { return document.querySelectorAll('#permission-toolbar .perm-filter').find(button => button.dataset.module === module); }

async function testSearchFilteringAndFirstKeystrokeIdentity() {
  const { context, document } = await setup();
  const before = document.getElementById('permission-search');
  context.permSearch('日報');
  const afterFirst = document.getElementById('permission-search');
  assert.strictEqual(before, afterFirst, 'first search keystroke must not replace search input DOM node');
  assert.ok(renderedKeys(document).includes('signed-report-upload'));
  assert.ok(!renderedKeys(document).includes('stock-mgmt'));
  afterFirst.value = 'signed-report';
  context.permSearch('signed-report');
  const afterSecond = document.getElementById('permission-search');
  assert.strictEqual(afterFirst, afterSecond, 'subsequent search must preserve input DOM identity');
  assert.deepStrictEqual(renderedKeys(document).sort(), ['signed-report-delete', 'signed-report-edit', 'signed-report-upload']);
}

async function testSearchAndFilterResetPageAndActiveState() {
  const { context, document } = await setup();
  context.permPage(1);
  assert.strictEqual(pageText(document)[1], '2');
  context.permSearch('signed-report');
  assert.strictEqual(pageText(document)[1], '1', 'search must reset page to 1');
  context.permSearch('');
  context.permFilter('reports');
  assert.strictEqual(pageText(document)[1], '1', 'module filter must reset page to 1');
  assert.ok(filterButton(document, 'reports').className.split(/\s+/).includes('active'));
  assert.ok(!filterButton(document, 'all').className.split(/\s+/).includes('active'));
  context.permFilter('stock');
  assert.ok(filterButton(document, 'stock').className.split(/\s+/).includes('active'));
  assert.ok(!filterButton(document, 'reports').className.split(/\s+/).includes('active'));
}

async function testPendingAcrossPaginationSearchAndFilter() {
  const { context, document } = await setup();
  context.permToggle('signed-report-upload', false);
  context.permPage(1);
  context.permPage(-1);
  let input = document.querySelector('input[data-key="signed-report-upload"]');
  assert.strictEqual(input.checked, false);
  assert.strictEqual(sourceFor(document, 'signed-report-upload').textContent, '✏️ 自訂');
  assert.ok(sourceFor(document, 'signed-report-upload').className.includes('override'));
  context.permSearch('stock');
  context.permSearch('');
  input = document.querySelector('input[data-key="signed-report-upload"]');
  assert.strictEqual(input.checked, false, 'pending value must survive search');
  context.permFilter('stock');
  context.permFilter('reports');
  input = document.querySelector('input[data-key="signed-report-upload"]');
  assert.strictEqual(input.checked, false, 'pending value must survive module filter');
}

async function testPendingAcrossTabs() {
  const featureFirst = await setup();
  featureFirst.context.permToggle('signed-report-upload', false);
  featureFirst.context.permSubTab('pages');
  featureFirst.context.permSubTab('features');
  let input = featureFirst.document.querySelector('input[data-key="signed-report-upload"]');
  assert.strictEqual(input.checked, false, 'feature pending value must survive tab switch');
  assert.strictEqual(sourceFor(featureFirst.document, 'signed-report-upload').textContent, '✏️ 自訂');

  const pageFirst = await setup();
  pageFirst.context.permSubTab('pages');
  const pageInput = pageFirst.document.querySelector('input[data-page-key="inventory"]');
  pageFirst.context.permPageToggle('inventory', true);
  pageFirst.context.permSubTab('features');
  pageFirst.context.permSubTab('pages');
  assert.ok(pageFirst.document.querySelector('input[data-page-key="inventory"]').checked, 'page pending value must survive tab switch');
  assert.ok(pageInput, 'page visibility input must exist');
}

async function testToggleDirectionsAndLockedPermission() {
  const { context, document } = await setup();
  const input = document.querySelector('input[data-key="item-mgmt"]');
  input.checked = true;
  context.permToggle('item-mgmt', true);
  assert.ok(input.checked, 'OFF to ON must check the permission');
  assert.strictEqual(sourceFor(document, 'item-mgmt').textContent, '✏️ 自訂');
  input.checked = false;
  context.permToggle('item-mgmt', false);
  assert.ok(!input.checked, 'ON to OFF must uncheck the permission');
  const locked = document.querySelector('input[data-key="view"]');
  assert.ok(locked.disabled, 'locked permission must remain disabled');
  assert.strictEqual(sourceFor(document, 'view').textContent, '🔒 鎖定');
  assert.ok(sourceFor(document, 'view').className.includes('locked'));
}

async function testNoResultToolbarStability() {
  const { context, document } = await setup();
  const before = document.getElementById('permission-search');
  context.permSearch('完全不存在的權限xyz');
  assert.strictEqual(before, document.getElementById('permission-search'));
  assert.ok(resultHtml(document).includes('沒有符合條件的權限'));
  assert.ok(document.getElementById('permission-toolbar'));
  context.permSearch('');
  assert.ok(renderedKeys(document).length > 0, 'clearing search must restore results');
}

(async () => {
  await testSearchFilteringAndFirstKeystrokeIdentity();
  await testSearchAndFilterResetPageAndActiveState();
  await testPendingAcrossPaginationSearchAndFilter();
  await testPendingAcrossTabs();
  await testToggleDirectionsAndLockedPermission();
  await testNoResultToolbarStability();
  console.log('permissions pagination runtime: PASS');
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
