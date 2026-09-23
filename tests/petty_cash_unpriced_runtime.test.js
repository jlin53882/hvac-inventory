const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('static/js/render/petty-cash.js', 'utf8');
function productionFunction(fileSource, name) {
  const start = fileSource.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name} not found`);
  const end = fileSource.indexOf('\n}\r\n', start);
  if (end < 0) throw new Error(`${name} end not found`);
  return fileSource.slice(start, end + 2);
}

const renderContext = {
  esc: value => String(value),
  _pcMoney: value => Number(value).toFixed(0),
  pcItemText: item => item.item_name,
  pcDetailSubtableHtml: rows => rows.map(row => row.description).join(', '),
};
vm.createContext(renderContext);
vm.runInContext(
  `${productionFunction(source, 'pcEntryStatus')}\n${productionFunction(source, 'pcGeneralDetailsHtml')}`,
  renderContext,
);

const unpriced = {
  items: [{ item_name: '未標價品項', amount: 0 }],
  amount: 100,
  amount_warning: '舊版可能產生的假警示',
  detail_total: 0,
  difference: -100,
};
assert.strictEqual(renderContext.pcEntryStatus(unpriced), '');
const unpricedHtml = renderContext.pcGeneralDetailsHtml(unpriced);
assert.ok(!unpricedHtml.includes('pc-entry-status'));
assert.ok(!unpricedHtml.includes('pc-general-discrepancy'));
assert.ok(!unpricedHtml.includes('明細合計'));
assert.ok(!unpricedHtml.includes('差額'));

const partiallyPriced = {
  items: [
    { item_name: '已標價品項', amount: 40 },
    { item_name: '未標價品項', amount: 0 },
  ],
  amount: 100,
  amount_warning: '明細合計 $40 與支出總額 $100 不一致，請確認。',
  detail_total: 40,
  difference: -60,
};
assert.ok(renderContext.pcEntryStatus(partiallyPriced).includes('金額不一致'));
const partialHtml = renderContext.pcGeneralDetailsHtml(partiallyPriced);
assert.ok(partialHtml.includes('明細合計'));
assert.ok(partialHtml.includes('差額'));
assert.ok(partialHtml.includes('$40'));
assert.ok(partialHtml.includes('-$60'));

const matched = {
  items: [{ item_name: '已標價品項', amount: 100 }],
  amount: 100,
  amount_warning: null,
  detail_total: 100,
  difference: 0,
};
assert.ok(renderContext.pcEntryStatus(matched).includes('正常'));
const matchedHtml = renderContext.pcGeneralDetailsHtml(matched);
assert.ok(matchedHtml.includes('明細合計'));
assert.ok(matchedHtml.includes('差額'));
assert.ok(matchedHtml.includes('+$0'));

const modalSource = fs.readFileSync('static/js/modals/petty-cash.js', 'utf8');
function saveEntryAtViewport(isMobile) {
  const values = {
    'pc-e-date': '2026-09-10',
    'pc-e-desc': '',
    'pc-e-amount': '100',
    'pc-e-category': '',
    'pc-m-start': '2026-08-26',
    'pc-m-end': '2026-09-25',
  };
  const notifications = [];
  const context = {
    document: { getElementById: id => ({ value: values[id] }) },
    window: { matchMedia: () => ({ matches: isMobile }) },
    pcEntryType: 'expense',
    pcEntryItemDraft: [{ _key: 'item-1', item_name: '未標價品項', qty: 1, unit: '個', amount: '' }],
    pcEntryEditIndex: -1,
    pcModalEntries: [],
    toast: message => notifications.push(message),
    pcCloseEntryModal: () => {},
    pcModalRenderEntries: () => {},
  };
  vm.createContext(context);
  vm.runInContext(productionFunction(modalSource, 'pcEntrySave'), context);
  context.pcEntrySave();
  return { entries: context.pcModalEntries, notifications };
}

for (const [platform, isMobile] of [['desktop', false], ['mobile', true]]) {
  const saved = saveEntryAtViewport(isMobile);
  assert.strictEqual(saved.entries.length, 1, `${platform} must accept a blank optional item amount`);
  assert.strictEqual(saved.entries[0].items[0].amount, null);
  assert.deepStrictEqual(saved.notifications, []);

  const hint = { className: '', textContent: '' };
  const hintContext = {
    document: { getElementById: id => id === 'pc-entry-amount-hint' ? hint : { value: '100' } },
    window: { matchMedia: () => ({ matches: isMobile }) },
    pcEntryType: 'expense',
    pcEntryItemDraft: [{ amount: '' }],
    _pcMoney: value => String(value),
  };
  vm.createContext(hintContext);
  vm.runInContext(productionFunction(modalSource, 'pcEntryAmountHint'), hintContext);
  hintContext.pcEntryAmountHint();
  assert.strictEqual(hint.textContent, '', `${platform} hides totals when all amounts are blank`);

  hintContext.pcEntryItemDraft = [{ amount: 40 }];
  hintContext.pcEntryAmountHint();
  assert.ok(hint.textContent.includes('明細合計 $40'), `${platform} shows totals once an amount is entered`);
}

console.log('petty cash optional detail runtime: PASS (blank, partial, matched, desktop/mobile save and hint)');
