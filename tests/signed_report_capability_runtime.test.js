const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

// 每日簽名報表 列表的編輯 / 刪除按鈕只跟隨後端 capability（共用 render/upload-list.js + 本頁設定 signed-reports.js）
const elements = new Map([
  ['upl-tbody', { innerHTML: '' }],
  ['upl-empty', { style: { display: '' } }],
  ['upl-page-info', { textContent: '' }],
]);
const context = {
  console,
  document: { getElementById: (id) => elements.get(id) },
  esc: (value) => String(value ?? ''),
};
for (const file of ['upload-list.js', 'signed-reports.js']) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'static', 'js', 'render', file), 'utf8');
  vm.runInNewContext(source, context, { filename: file });
}
const page = context.SignedReports;

function render(capabilities) {
  page.state.reports = [{
    id: 100,
    report_date: '2026-09-20',
    uploader_name: '測試上傳人',
    upload_time: '2026-09-20 10:00:00',
    file_name: 'Q001.pdf',
    mime_type: 'application/pdf',
    note: '測試報表',
    ...capabilities,
  }];
  page.state.total = 1;
  page.renderTable();
  return elements.get('upl-tbody').innerHTML;
}

let html = render({ can_edit: true, can_delete: false });
assert.ok(html.includes('Q001.pdf'));
assert.ok(html.includes('SignedReports.edit(100)'));
assert.ok(!html.includes('SignedReports.remove(100)'));

html = render({ can_edit: false, can_delete: true });
assert.ok(!html.includes('SignedReports.edit(100)'));
assert.ok(html.includes('SignedReports.remove(100)'));

html = render({ can_edit: false, can_delete: false });
assert.ok(!html.includes('SignedReports.edit(100)'));
assert.ok(!html.includes('SignedReports.remove(100)'));

html = render({ can_edit: true, can_delete: true });
assert.ok(html.includes('SignedReports.edit(100)'));
assert.ok(html.includes('SignedReports.remove(100)'));

console.log('signed report capability runtime: PASS');
