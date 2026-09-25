const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
/**
 * Escape test data using the same HTML context needed by stocktake model labels.
 * @param {*} value - Untrusted model value supplied to the production renderer.
 * @returns {string} HTML-safe text.
 */
const htmlEscape = value => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');
const sandbox = {
  ALL_ITEMS: [],
  Qty: {
    /** Format a value deterministically for the renderer fixture. @param {number} value @returns {string} */
    format: value => String(value),
    /** Return the fixture's single canonical unit type. @returns {string} */
    unitTypeOf: () => 'integer',
  },
  stocktakeValues: {},
  esc: htmlEscape,
  /** Convert test quantities to numbers. @param {*} value @returns {number} */
  absNum: value => Number(value),
  /** Return a stable fixture photo URL. @param {number} id @returns {string} */
  photoSrc: id => '/photo/' + id,
  /** Serialize renderer keys for inline handler fixtures. @param {*} value @returns {string} */
  jsStr: value => String(value),
};

vm.createContext(sandbox);
vm.runInContext(
  fs.readFileSync(path.join(root, 'static/js/render/stocktake.js'), 'utf8'),
  sandbox,
  { filename: 'stocktake.js' },
);

/**
 * Build a stocktake item fixture while keeping identical display names across model cases.
 * @param {Object} overrides - Item fields that vary for a scenario.
 * @returns {Object} Complete stocktake item fixture.
 */
const makeItem = overrides => ({
  id: 1,
  brand: '品牌',
  name: '相同品項',
  code: 'MODEL-A',
  unit: '個',
  qty: 1,
  is_kit: false,
  has_photo: false,
  ...overrides,
});
const stock = { location: 'A倉', qty: 1, note: '' };
const modelA = sandbox.stocktakeRow(makeItem({ code: 'MODEL-A' }), stock, null);
const modelB = sandbox.stocktakeRow(makeItem({ code: 'MODEL-B' }), stock, null);
assert.match(modelA, /型號 MODEL-A/);
assert.match(modelB, /型號 MODEL-B/);
assert.notEqual(modelA, modelB, '相同品牌與品項名稱應能以型號區分');

const unsafeCode = `M<&"'`;
const escapedModel = sandbox.stocktakeRow(makeItem({ code: unsafeCode }), stock, null);
assert.ok(escapedModel.includes('型號 M&lt;&amp;&quot;&#39;'));
assert.ok(!escapedModel.includes(unsafeCode), '型號必須先 HTML escape');

const noModel = sandbox.stocktakeRow(makeItem({ code: '' }), stock, null);
assert.ok(!noModel.includes('stocktake-model'), '空白型號不應留下空標籤');

const kit = sandbox.stocktakeRow(makeItem({ is_kit: true, code: 'KIT-MODEL' }), stock, null);
assert.ok(!kit.includes('stocktake-model'), '整組品項不可誤顯示單一材料型號');

console.log('stocktake model runtime contracts passed');
