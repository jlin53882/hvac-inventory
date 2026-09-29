const assert = require('assert');
const vm = require('vm');
const { extractFunction, read } = require('./support/frontend-runtime');

const source = read('static/js/features/petty-cash/page.js');
const context = {};
vm.runInNewContext(extractFunction(source, 'pcReportActionEntries'), context);

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
