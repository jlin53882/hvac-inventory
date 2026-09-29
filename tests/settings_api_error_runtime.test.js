// 設定頁零用金選單新增 / 改名 / 刪除：後端回結構化 422 時，交給 toast 的必須是已格式化的文字，
// 不可把 detail 陣列直接丟給畫面（呼叫端需先經 apiErrorMessage）。
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

function extractFunction(source, name) {
  const start = source.search(new RegExp(`(async )?function ${name}\\(`));
  assert(start >= 0, `${name} must exist`);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`${name} is not closed`);
}

const utils = fs.readFileSync('static/js/utils.js', 'utf8');
const settings = fs.readFileSync('static/js/settings.js', 'utf8');
const detail = [{ loc: ['body', 'name'], type: 'string_too_long', ctx: { max_length: 100 } }];
const expected = '「名稱」不可超過 100 個字';

const toastNode = { textContent: '', className: '' };
const received = [];
const context = {
  document: { getElementById: id => (id === 'toast' ? toastNode : { value: '很長的名稱' }) },
  setTimeout: () => 1,
  clearTimeout: () => {},
  toastTimer: null,
  prompt: () => '很長的名稱',
  confirm: () => true,
  pettyOptionCache: { general: { category: [{ id: 1, name: '舊名稱' }] } },
  loadPettyOptions: async () => { throw new Error('success path must not run on 422'); },
  renderPettyOptionsPanel: () => {},
  fetch: async () => ({ ok: false, status: 422, json: async () => ({ detail }) }),
};
vm.createContext(context);
vm.runInContext(extractFunction(utils, 'apiErrorMessage'), context);
vm.runInContext(extractFunction(utils, 'toast'), context);
// 記錄呼叫端交給 toast 的原始參數，再交給正式的 toast 呈現
vm.runInContext('const __realToast = toast; toast = (msg, type) => { __received.push(msg); return __realToast(msg, type); };',
  Object.assign(context, { __received: received }));
for (const name of ['createPettyOptionKind', 'renamePettyOption', 'deletePettyOption']) {
  vm.runInContext(extractFunction(settings, name), context);
}

(async () => {
  for (const [name, call] of [
    ['createPettyOptionKind', "createPettyOptionKind('general', 'category')"],
    ['renamePettyOption', "renamePettyOption(1, 'general', 'category')"],
    ['deletePettyOption', "deletePettyOption(1, 'general', 'category')"],
  ]) {
    received.length = 0;
    toastNode.textContent = '';
    await vm.runInContext(call, context);
    assert.strictEqual(received.length, 1, `${name} should show exactly one toast`);
    assert.strictEqual(typeof received[0], 'string', `${name} passed raw API detail to toast`);
    assert.strictEqual(received[0], expected, `${name} message`);
    assert.strictEqual(toastNode.textContent, expected, `${name} rendered text`);
    assert.ok(!toastNode.textContent.includes('[object Object]'));
  }
  console.log('settings API error runtime: PASS');
})().catch(error => { console.error(error); process.exit(1); });
