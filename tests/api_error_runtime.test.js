const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync('static/js/utils.js', 'utf8');
const start = source.indexOf('function apiErrorMessage(');
const end = source.indexOf('function toast(', start);
assert(start >= 0 && end > start, 'production formatter must exist before toast');
const toastNode = { textContent: '', className: '' };
const context = {
  document: { getElementById: () => toastNode },
  setTimeout: () => 1,
  clearTimeout: () => {},
  toastTimer: null,
};
vm.createContext(context);
vm.runInContext(source.slice(start), context);
const detail = [{ loc: ['body', 'prepared_by'], type: 'string_too_long', ctx: { max_length: 50 } }];
assert.strictEqual(context.apiErrorMessage(detail), '「製表人」不可超過 50 個字');
assert.strictEqual(context.apiErrorMessage('一般錯誤'), '一般錯誤');
assert.ok(!context.apiErrorMessage(detail).includes('[object Object]'));
context.toast(detail, 'error');
assert.strictEqual(toastNode.textContent, '「製表人」不可超過 50 個字');
context.toast('⚠️ ' + context.apiErrorMessage(detail), 'error');
assert.strictEqual(toastNode.textContent, '⚠️ 「製表人」不可超過 50 個字');
console.log('API error formatting runtime: PASS');
