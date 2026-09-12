// tests/qty.test.js — Qty 共用數量 domain 純函式測試（node 直接執行）
// 對應 static/js/qty.js；pytest 由 tests/test_quantity.py 包裝呼叫。
// 用法：node tests/qty.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'static', 'js', 'qty.js'), 'utf8');
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const Qty = sandbox.Qty;

let pass = 0, fail = 0;
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; }
  else { fail++; console.error(`FAIL ${msg}: got ${a}, want ${e}`); }
}
function ok(cond, msg) {
  if (cond) { pass++; }
  else { fail++; console.error(`FAIL ${msg}`); }
}

// ---------- parse ----------
eq(Qty.parse('3'), { num: 3, den: 1, value: 3 }, 'parse int');
eq(Qty.parse('0.5'), { num: 1, den: 2, value: 0.5 }, 'parse decimal');
eq(Qty.parse('0.25'), { num: 1, den: 4, value: 0.25 }, 'parse decimal 0.25');
eq(Qty.parse('1/4'), { num: 1, den: 4, value: 0.25 }, 'parse fraction');
eq(Qty.parse('1/3').num * 3, 3, 'parse 1/3 exact num');
eq(Qty.parse('2/3').den, 3, 'parse 2/3 den');
eq(Qty.parse('3/4'), { num: 3, den: 4, value: 0.75 }, 'parse 3/4');
eq(Qty.parse('1 1/2'), { num: 3, den: 2, value: 1.5 }, 'parse mixed');
eq(Qty.parse('2 3/4'), { num: 11, den: 4, value: 2.75 }, 'parse mixed 2 3/4');
ok(Qty.parse('1/0').error, 'reject zero denominator');
ok(Qty.parse('abc').error, 'reject abc');
ok(Qty.parse('1//4').error, 'reject double slash');
ok(Qty.parse('').error, 'reject empty');
ok(Qty.parse('   ').error, 'reject blank');
ok(Qty.parse('NaN').error && Qty.parse('Infinity').error, 'reject NaN/Infinity');
ok(Qty.parse('1/2').value === 0.5, 'parse 1/2 is 0.5 not 1 (parseFloat trap)');
ok(Qty.parse('1abc').error, 'reject trailing garbage');

// ---------- arithmetic（精確有理數） ----------
eq(Qty.add('1/4', '1/4'), '1/2', 'add fractions');
eq(Qty.add('3/4', '1/4'), '1', 'add to one');
eq(Qty.sub('1', '1/4'), '3/4', 'sub fraction');
eq(Qty.add('2/3', '1/3'), '1', 'add thirds exact');
eq(Qty.sub('3/4', '1/2'), '1/4', 'stocktake diff');
eq(Qty.add('0.1', '0.2'), '3/10', 'no float drift 0.1+0.2');

// ---------- format ----------
eq(Qty.format(0, 'fraction'), '0', 'zero');
eq(Qty.format(0.25, 'fraction'), '1/4', 'format 1/4');
eq(Qty.format(0.75, 'fraction'), '3/4', 'format 3/4');
eq(Qty.format(1.5, 'fraction'), '1 1/2', 'format mixed');
eq(Qty.format(1 / 3, 'fraction'), '1/3', 'format 1/3 from float');
eq(Qty.format(1.25, 'decimal'), '1.25', 'decimal keeps decimal');
eq(Qty.format(1.27, 'fraction'), '1.27', 'no forced ugly fraction');
eq(Qty.format(0.30000000000000004, 'fraction'), '0.3', 'float dust stays decimal');
eq(Qty.format(0.3300000001, 'fraction'), '0.33', 'old dust tail never leaks raw');
eq(Qty.format(0.333, 'fraction'), '1/3', 'rounded 1/3 restores fraction');
eq(Qty.format(0.667, 'fraction'), '2/3', 'rounded 2/3 restores fraction');
eq(Qty.format(0.123, 'fraction'), '0.123', 'true decimal stays decimal');
eq(Qty.format(0.333, 'integer'), '1/3', 'non-integer stock readable even for integer unit');
eq(Qty.format(3, 'integer'), '3', 'integer');
eq(Qty.formatWithUnit(0.75, '罐', 'fraction'), '3/4 罐', 'format with unit');

// ---------- validFor ----------
ok(Qty.validFor('3', 'integer').ok, 'integer accepts 3');
ok(!Qty.validFor('1/2', 'integer').ok, 'integer rejects fraction');
ok(!Qty.validFor('0.5', 'integer').ok, 'integer rejects decimal');
ok(Qty.validFor('3.0', 'integer').ok, 'integer accepts 3.0 value');
ok(Qty.validFor('0.5', 'decimal').ok, 'decimal accepts 0.5');
ok(!Qty.validFor('1/2', 'decimal').ok, 'decimal rejects fraction');
ok(Qty.validFor('1/3', 'fraction').ok, 'fraction accepts 1/3');
ok(Qty.validFor('1 1/2', 'fraction').ok, 'fraction accepts mixed');
ok(!Qty.validFor('-1', 'fraction').ok, 'reject negative');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
