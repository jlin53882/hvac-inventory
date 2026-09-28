// 2026-09-28 runtime 契約：新增品項多位置、櫃子下拉保留既有值、整組位置顯示與輸入保留
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const escapeHtml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

/** Extract one top-level `function name(...) {...}` declaration from a source file. */
function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} must exist`);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unterminated function ${name}`);
}

// ---- 1. buildAddStocks：多位置驗證與 location 組合 ----
const addContext = vm.createContext({});
vm.runInContext(extractFunction(read('static/js/modals/add.js'), 'buildAddStocks'), addContext);
const build = rows => JSON.parse(JSON.stringify(addContext.buildAddStocks(rows)));

assert.deepEqual(build([
  { cabinet: '編號A', sub: '1-1', qty: 2, note: '主存區' },
  { cabinet: '編號B', sub: '', qty: 0.5, note: '' },
]), {
  stocks: [
    { location: '編號A | 1-1', qty: 2, note: '主存區' },
    { location: '編號B', qty: 0.5, note: '' },
  ],
  error: '',
}, '多位置需各自組成「櫃子 | 位置」並保留數量/備註');
assert.deepEqual(build([
  { cabinet: '編號A', sub: '1-1', qty: 1, note: '' },
  { cabinet: '', sub: '', qty: 0, note: '' },
]).stocks.length, 1, '完全空白的額外列需忽略');
assert.match(build([{ cabinet: '', sub: '1-1', qty: 1, note: '' }]).error, /第 1 個位置請選擇櫃子/, '有填位置但沒選櫃子需擋下');
assert.match(build([
  { cabinet: '編號A', sub: '1-1', qty: 1, note: '' },
  { cabinet: '編號A', sub: '1-1', qty: 2, note: '' },
]).error, /重複/, '同一位置重複需擋下');
assert.match(build([{ cabinet: '', sub: '', qty: 0, note: '' }]).error, /位置必填/, '至少需一個位置');

// ---- 2. _cabinetOptions：清單外（未載入/已改名）的既有櫃子不可被靜默清空 ----
const editContext = vm.createContext({ esc: escapeHtml, globalCabinetList: [] });
vm.runInContext(extractFunction(read('static/js/modals/edit.js'), '_cabinetOptions'), editContext);
const unloaded = editContext._cabinetOptions('編號B');
assert.match(unloaded, /<option value="編號B" selected>/, '櫃子清單未載入時仍需保留已存櫃子並選取');
editContext.globalCabinetList = [{ name: '編號B', note: '二樓' }];
const loaded = editContext._cabinetOptions('編號B');
assert.equal((loaded.match(/value="編號B"/g) || []).length, 1, '櫃子已在清單內時不得重複');
assert.ok(!editContext._cabinetOptions('').includes('不在櫃子清單'), '空值不得新增額外選項');

// ---- 3. kitLocationEntries / renderKitLocationList：每個位置一行，備註接在該位置後面 ----
const kitsContext = vm.createContext({ esc: escapeHtml });
const kitsSource = read('static/js/render/kits.js');
vm.runInContext(extractFunction(kitsSource, 'kitLocationEntries'), kitsContext);
vm.runInContext(extractFunction(kitsSource, 'renderKitLocationList'), kitsContext);
const entries = JSON.parse(JSON.stringify(kitsContext.kitLocationEntries({
  stock_positions: [
    { location: '', qty: 1, note: '整組備註複本' },
    { location: '編號A | 1-1', qty: 2, note: '實際位置備註' },
  ],
  locations: [
    { cabinet: '編號B', position: '1-1', note: '123' },
    { cabinet: '編號A', position: '1-1', note: '666' },
    { cabinet: '編號C', position: '', note: '' },
  ],
})));
assert.deepEqual(entries, [
  { label: '編號A | 1-1', notes: ['實際位置備註', '666'] },
  { label: '編號B | 1-1', notes: ['123'] },
  { label: '編號C', notes: [] },
], '實際位置在前、建議存放位置在後；同位置合併備註；空位置列略過');
assert.deepEqual(JSON.parse(JSON.stringify(kitsContext.kitLocationEntries({}))), [], '無位置時回傳空陣列');
assert.equal(kitsContext.renderKitLocationList([]), '', '無位置時不輸出區塊');
const listHtml = kitsContext.renderKitLocationList([
  { label: '編號A | 1-1', notes: ['<b>x</b>'] },
  { label: '編號B', notes: [] },
]);
assert.equal((listHtml.match(/<li class="kit-loc-item">/g) || []).length, 2, '每個位置各自一行');
assert.ok(listHtml.includes('<span class="kit-loc-name">編號A | 1-1</span><span class="kit-loc-note">&lt;b&gt;x&lt;/b&gt;</span>'), '備註接在位置後面且需 escape');
assert.ok(listHtml.includes('<span class="kit-loc-name">編號B</span></li>'), '無備註的位置不輸出備註欄');
assert.ok(extractFunction(kitsSource, 'renderKitCard').includes('renderKitLocationList(kitLocationEntries(k))'), 'renderKitCard 需使用位置清單');
assert.ok(extractFunction(kitsSource, 'editKit').includes('loadKitCabinetOptions();'), '編輯整組需載入櫃子清單');

// ---- 4. 整組位置列：新增/刪除列與櫃子清單晚到時，不得清掉已輸入的值 ----
const container = { html: '', set innerHTML(markup) { this.html = markup; }, get innerHTML() { return this.html; } };
let domRows = [];
/** Parse rendered rows into DOM-like objects whose field values can be edited. */
function parseRows(markup) {
  return [...markup.matchAll(/<div class="edit-stock-row"[\s\S]*?<\/div>/g)].map(match => {
    const html = match[0];
    const fields = {
      '.kit-loc-cabinet': { value: (html.match(/<option value="([^"]*)" selected>/) || [])[1] || '' },
      '.kit-loc-pos': { value: (html.match(/class="kit-loc-pos" value="([^"]*)"/) || [])[1] || '' },
      '.kit-loc-note': { value: (html.match(/class="kit-loc-note" value="([^"]*)"/) || [])[1] || '' },
    };
    return { querySelector: selector => fields[selector] };
  });
}
const kitContext = vm.createContext({
  console,
  esc: escapeHtml,
  globalCabinetList: [],
  document: {
    getElementById: id => (id === 'kit-location-rows' ? container : null),
    querySelectorAll: selector => (selector === '#kit-location-rows .edit-stock-row' ? domRows : []),
  },
  fetch: async () => ({ ok: true, json: async () => [{ name: '編號A' }, { name: '編號B' }] }),
});
vm.runInContext(extractFunction(read('static/js/modals/edit.js'), '_cabinetOptions'), kitContext);
vm.runInContext(read('static/js/modals/kit.js'), kitContext, { filename: 'kit.js' });
const render = () => { kitContext.renderKitLocationRows(); domRows = parseRows(container.html); };
kitContext.addKitLocationRow();
domRows = parseRows(container.html);
// 使用者在第一列輸入（尚未寫回陣列），接著按「新增位置」
domRows[0].querySelector('.kit-loc-cabinet').value = '編號B';
domRows[0].querySelector('.kit-loc-pos').value = '1-1';
domRows[0].querySelector('.kit-loc-note').value = '123';
kitContext.addKitLocationRow();
domRows = parseRows(container.html);
assert.equal(domRows.length, 2, '需新增第二列');
assert.deepEqual(
  ['.kit-loc-cabinet', '.kit-loc-pos', '.kit-loc-note'].map(sel => domRows[0].querySelector(sel).value),
  ['編號B', '1-1', '123'],
  '新增列時不得清掉第一列已輸入的櫃子/位置/備註',
);
domRows[1].querySelector('.kit-loc-cabinet').value = '編號A';
domRows[1].querySelector('.kit-loc-pos').value = '2-1';
kitContext.removeKitLocationRow(0);
domRows = parseRows(container.html);
assert.equal(domRows[0].querySelector('.kit-loc-pos').value, '2-1', '刪除列後其他列輸入需保留');
render();
(async () => {
  await kitContext.loadKitCabinetOptions();
  domRows = parseRows(container.html);
  assert.equal(domRows[0].querySelector('.kit-loc-cabinet').value, '編號A', '櫃子清單載入後需保留已選櫃子');
  assert.deepEqual(JSON.parse(JSON.stringify(kitContext.getKitLocations())), [{ cabinet: '編號A', position: '2-1', note: '' }]);
  console.log('add stock rows / kit location runtime contracts passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
