const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('static/js/render/petty-cash.js', 'utf8');
const start = source.indexOf('function pcReportActionEntries');
const end = source.indexOf('\n}\r\n', start) + 3;
if (start < 0 || end < 2) throw new Error('pcReportActionEntries not found');
const context = {};
vm.runInNewContext(source.slice(start, end), context);

function labels(report) {
  return context.pcReportActionEntries(report, false).map(action => action.label);
}

const editOnly = labels({ id: 1, can_edit: true, can_delete: false });
assert.ok(editOnly.includes('✏️ 編輯'));
assert.ok(!editOnly.includes('🗑 刪除'));

const deleteOnly = labels({ id: 1, can_edit: false, can_delete: true });
assert.ok(!deleteOnly.includes('✏️ 編輯'));
assert.ok(deleteOnly.includes('🗑 刪除'));

const readOnly = labels({ id: 1, can_edit: false, can_delete: false });
assert.ok(!readOnly.includes('✏️ 編輯'));
assert.ok(!readOnly.includes('🗑 刪除'));

console.log('petty cash capability runtime: PASS');
