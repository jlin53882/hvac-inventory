const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

class FakeElement {
  constructor(id) {
    this.id = id;
    this.value = '';
    this.innerHTML = '';
    this.style = { display: '' };
  }
}

class FakeDocument {
  constructor() {
    this.elements = new Map([
      ['content', new FakeElement('content')],
      ['quote-history-list', new FakeElement('quote-history-list')],
      ['quote-history-empty', new FakeElement('quote-history-empty')],
      ['quote-history-q', new FakeElement('quote-history-q')],
    ]);
  }
  getElementById(id) {
    return this.elements.get(id) || null;
  }
  querySelectorAll() { return []; }
  addEventListener() {}
}

function renderWithPermission(allowed) {
  const document = new FakeDocument();
  const history = {
    items: [{
      id: 100,
      quote_number: 'Q001',
      customer_name: '測試客戶',
      quote_date: '2026-09-20',
      tax_type: 'included',
      total: 1000,
    }],
    total: 1,
  };
  const context = {
    console,
    document,
    window: {},
    hasPerm: key => key === 'item-mgmt' && allowed,
    esc: value => String(value),
    toast: () => {},
    confirm: () => true,
    fetch: async () => ({ ok: true, json: async () => history }),
  };
  context.window = context;
  vm.runInNewContext(fs.readFileSync('static/js/render/quotation.js', 'utf8'), context, {
    filename: 'static/js/render/quotation.js',
  });
  context.renderQuotation();
  return { context, document };
}

(async () => {
  const readOnly = renderWithPermission(false);
  await readOnly.context.quoteLoadHistory();
  const readOnlyFormHtml = readOnly.document.getElementById('content').innerHTML;
  const readOnlyHistoryHtml = readOnly.document.getElementById('quote-history-list').innerHTML;
  assert.ok(readOnlyHistoryHtml.includes('Q001'), 'read-only history row must render quote number');
  assert.ok(readOnlyHistoryHtml.includes('測試客戶'), 'read-only history row must render customer');
  assert.ok(readOnlyHistoryHtml.includes('Excel'), 'read-only history row must render Excel');
  assert.ok(readOnlyHistoryHtml.includes('PDF'), 'read-only history row must render PDF');
  assert.ok(!readOnlyFormHtml.includes('onclick="quoteSave()"'), 'save control must be hidden without item-mgmt');
  assert.ok(!readOnlyFormHtml.includes('onclick="quoteAddItem()"'), 'add-line control must be hidden without item-mgmt');
  assert.ok(!readOnlyFormHtml.includes('onclick="quoteOpenInventory()"'), 'inventory import control must be hidden without item-mgmt');
  assert.ok(!readOnlyHistoryHtml.includes('quoteEdit('), 'history edit control must be hidden without item-mgmt');
  assert.ok(!readOnlyHistoryHtml.includes('quoteDelete('), 'history delete control must be hidden without item-mgmt');

  const writable = renderWithPermission(true);
  await writable.context.quoteLoadHistory();
  const writableFormHtml = writable.document.getElementById('content').innerHTML;
  const writableHistoryHtml = writable.document.getElementById('quote-history-list').innerHTML;
  assert.ok(writableHistoryHtml.includes('Q001'), 'writable history row must render quote number');
  assert.ok(writableHistoryHtml.includes('quoteEdit(100)'), 'history edit control must show with item-mgmt');
  assert.ok(writableHistoryHtml.includes('quoteDelete(100)'), 'history delete control must show with item-mgmt');
  assert.ok(writableHistoryHtml.includes('Excel'), 'writable history row must render Excel');
  assert.ok(writableHistoryHtml.includes('PDF'), 'writable history row must render PDF');
  assert.ok(writableFormHtml.includes('onclick="quoteSave()"'), 'save control must show with item-mgmt');
  assert.ok(writableFormHtml.includes('onclick="quoteAddItem()"'), 'add-line control must show with item-mgmt');
  assert.ok(writableFormHtml.includes('onclick="quoteOpenInventory()"'), 'inventory import control must show with item-mgmt');

  console.log('quotation permission runtime: PASS');
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
