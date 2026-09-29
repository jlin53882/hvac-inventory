// ES module 連結檢查（issue #39）：以 Node 正式的 ESM linker 解析四個頁面進入點的整個 import 圖，
// 任何 import 不到的名稱、打錯的路徑都會在 link() 失敗。只連結不執行（瀏覽器行為由 visual 測試驗證）。
// runtime 測試用 moduleScript() 去掉 import/export 注入替身，所以模組之間的接線要靠這支測試守護。
// 需以 node --experimental-vm-modules 執行；由 tests/test_frontend_assets.py::test_esm_pages_link 包裝。
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JS_ROOT = path.join(__dirname, '..', 'static', 'js');
const cache = new Map();
const context = vm.createContext({});

function load(file) {
  if (!cache.has(file)) {
    cache.set(file, new vm.SourceTextModule(fs.readFileSync(file, 'utf8'), { identifier: file, context }));
  }
  return cache.get(file);
}

async function linkPage(entry) {
  const module = load(path.join(JS_ROOT, 'pages', entry));
  await module.link((specifier, referencing) => {
    assert.ok(specifier.startsWith('.'), `${referencing.identifier}: 只允許相對路徑 import（${specifier}）`);
    const target = path.resolve(path.dirname(referencing.identifier), specifier);
    assert.ok(fs.existsSync(target), `${referencing.identifier}: 找不到 ${specifier}`);
    return load(target);
  });
  assert.strictEqual(module.status, 'linked');
}

(async () => {
  for (const entry of ['main.js', 'settings.js', 'permissions.js', 'login.js']) await linkPage(entry);
  // 每個模組都至少被一個頁面用到（沒有孤兒檔）
  const all = [];
  (function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.js')) all.push(full);
    }
  })(JS_ROOT);
  const orphans = all.filter(file => !cache.has(file)).map(file => path.relative(JS_ROOT, file));
  assert.deepStrictEqual(orphans, [], '沒有被任何頁面 import 的模組');
  console.log(`ESM link: ${cache.size} modules linked from 4 pages`);
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
