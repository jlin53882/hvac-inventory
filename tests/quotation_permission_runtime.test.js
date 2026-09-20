const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

class FakeElement {
  constructor(id) {
    this.id = id;
    this.value = '';
    this.innerHTML = '';
    this.classList = { toggle() {} };
  }
}

class FakeDocument {
  constructor() {
    this.elements = new Map([['content', new FakeElement('content')]]);
  }
  getElementById(id) {
    return this.elements.get(id) || null;
  }
  querySelectorAll() { return []; }
  addEventListener() {}
}

function renderWithPermission(allowed) {
  const document = new FakeDocument();
  const context = {
    console,
    document,
    window: {},
    hasPerm: key => key === 'item-mgmt' && allowed,
    esc: value => String(value),
    toast: () => {},
    confirm: () => true,
    fetch: async () => ({ ok: true, json: async () => ({ items: [], total: 0 }) }),
  };
  context.window = context;
  vm.runInNewContext(fs.readFileSync('static/js/render/quotation.js', 'utf8'), context, {
    filename: 'static/js/render/quotation.js',
  });
  context.quoteFillForm = () => {};
  context.quoteRenderItems = () => {};
  context.quoteLoadHistory = async () => {};
  context.renderQuotation();
  return document.getElementById('content').innerHTML;
}

const readOnlyHtml = renderWithPermission(false);
assert.ok(!readOnlyHtml.includes('onclick="quoteSave()"'), 'save control must be hidden without item-mgmt');
assert.ok(!readOnlyHtml.includes('onclick="quoteAddItem()"'), 'add-line control must be hidden without item-mgmt');
assert.ok(!readOnlyHtml.includes('onclick="quoteOpenInventory()"'), 'inventory import control must be hidden without item-mgmt');
assert.ok(!readOnlyHtml.includes('quoteEdit('), 'history edit control must be hidden without item-mgmt');
assert.ok(!readOnlyHtml.includes('quoteDelete('), 'history delete control must be hidden without item-mgmt');

const writableHtml = renderWithPermission(true);
assert.ok(writableHtml.includes('onclick="quoteSave()"'), 'save control must show with item-mgmt');
assert.ok(writableHtml.includes('onclick="quoteAddItem()"'), 'add-line control must show with item-mgmt');
assert.ok(writableHtml.includes('onclick="quoteOpenInventory()"'), 'inventory import control must show with item-mgmt');

console.log('quotation permission runtime: PASS');
