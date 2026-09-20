const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const elements = new Map([
  ['qup-tbody', { innerHTML: '' }],
  ['qup-empty', { style: { display: '' } }],
  ['qup-page-info', { textContent: '' }],
]);
const context = {
  console,
  document: { getElementById: (id) => elements.get(id) },
  esc: (value) => String(value ?? ''),
};
const source = fs.readFileSync(
  path.join(__dirname, '..', 'static', 'js', 'render', 'quotation-upload.js'),
  'utf8',
);
vm.runInNewContext(source, context, { filename: 'quotation-upload.js' });

function render(capabilities) {
  context.qupFiltered = [{
    id: 100,
    report_date: '2026-09-20',
    uploader_name: '測試上傳人',
    upload_time: '2026-09-20 10:00:00',
    file_name: 'Q001.pdf',
    mime_type: 'application/pdf',
    note: '測試報價單',
    ...capabilities,
  }];
  context.qupTotal = 1;
  context.qupRenderTable();
  return elements.get('qup-tbody').innerHTML;
}

let html = render({ can_edit: true, can_delete: false });
assert.ok(html.includes('Q001.pdf'));
assert.ok(html.includes('qupEdit(100)'));
assert.ok(!html.includes('qupDelete(100)'));

html = render({ can_edit: false, can_delete: true });
assert.ok(!html.includes('qupEdit(100)'));
assert.ok(html.includes('qupDelete(100)'));

html = render({ can_edit: false, can_delete: false });
assert.ok(!html.includes('qupEdit(100)'));
assert.ok(!html.includes('qupDelete(100)'));

html = render({ can_edit: true, can_delete: true });
assert.ok(html.includes('qupEdit(100)'));
assert.ok(html.includes('qupDelete(100)'));

console.log('quotation upload capability runtime: PASS');
