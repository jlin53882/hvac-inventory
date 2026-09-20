const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const elements = new Map([
  ['dsr-tbody', { innerHTML: '' }],
  ['dsr-empty', { style: { display: '' } }],
  ['dsr-page-info', { textContent: '' }],
]);
const context = {
  console,
  document: { getElementById: (id) => elements.get(id) },
  esc: (value) => String(value ?? ''),
};
const source = fs.readFileSync(
  path.join(__dirname, '..', 'static', 'js', 'render', 'signed-reports.js'),
  'utf8',
);
vm.runInNewContext(source, context, { filename: 'signed-reports.js' });

function render(capabilities) {
  context.dsrFiltered = [{
    id: 100,
    report_date: '2026-09-20',
    uploader_name: '測試上傳人',
    upload_time: '2026-09-20 10:00:00',
    file_name: 'Q001.pdf',
    mime_type: 'application/pdf',
    note: '測試報表',
    ...capabilities,
  }];
  context.dsrTotal = 1;
  context.dsrRenderTable();
  return elements.get('dsr-tbody').innerHTML;
}

let html = render({ can_edit: true, can_delete: false });
assert.ok(html.includes('Q001.pdf'));
assert.ok(html.includes('dsrEdit(100)'));
assert.ok(!html.includes('dsrDelete(100)'));

html = render({ can_edit: false, can_delete: true });
assert.ok(!html.includes('dsrEdit(100)'));
assert.ok(html.includes('dsrDelete(100)'));

html = render({ can_edit: false, can_delete: false });
assert.ok(!html.includes('dsrEdit(100)'));
assert.ok(!html.includes('dsrDelete(100)'));

html = render({ can_edit: true, can_delete: true });
assert.ok(html.includes('dsrEdit(100)'));
assert.ok(html.includes('dsrDelete(100)'));

console.log('signed report capability runtime: PASS');
