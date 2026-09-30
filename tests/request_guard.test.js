// createRequestGuard（core/request-guard.js）契約：最新請求優先 / invalidate / 守衛互相獨立 / 模擬亂序回應
const assert = require('assert');
const vm = require('vm');
const { loadModules } = require('./support/frontend-runtime');

const context = {};
vm.createContext(context);
loadModules(context, 'core/request-guard.js');
const { createRequestGuard } = context;

// 1) token 遞增；只有最新一輪 isCurrent
const guard = createRequestGuard();
const first = guard.next();
const second = guard.next();
assert.strictEqual(second, first + 1);
assert.strictEqual(guard.isCurrent(first), false, 'older token must be stale');
assert.strictEqual(guard.isCurrent(second), true);

// 2) invalidate：不開新一輪，但讓進行中的 token 全部作廢；之後 next 仍可用
guard.invalidate();
assert.strictEqual(guard.isCurrent(second), false, 'invalidate must stale in-flight tokens');
const third = guard.next();
assert.strictEqual(guard.isCurrent(third), true);
assert.ok(third > second);

// 3) 守衛互相獨立
const other = createRequestGuard();
const a = guard.next();
const b = other.next();
guard.next();
assert.strictEqual(other.isCurrent(b), true, 'other guard must be unaffected');
assert.strictEqual(guard.isCurrent(a), false);

// 4) 亂序回應：後發先至的舊回應必須被丟棄
(async () => {
  const applied = [];
  const load = (label, delayMs) => {
    const token = guard.next();
    return new Promise(resolve => setTimeout(resolve, delayMs)).then(() => {
      if (!guard.isCurrent(token)) return;
      applied.push(label);
    });
  };
  await Promise.all([load('slow-old', 30), load('fast-new', 5)]);
  assert.deepStrictEqual(applied, ['fast-new'], 'stale slow response must not overwrite the newer one');
  console.log('request guard runtime: PASS');
})().catch(error => { console.error(error); process.exit(1); });
