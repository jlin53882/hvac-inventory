// apiFetch（api-client.js）共用 API 呼叫契約：成功 JSON / 204 / 空內容、字串與結構化 detail、
// 非 JSON 錯誤頁、JSON 格式錯誤、網路錯誤、AbortError、401；錯誤訊息一律經 apiErrorMessage 並支援 fallback。
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const { installApiClient } = require('./support/frontend-runtime');


const calls = [];
let nextFetch = null;
const context = {
  fetch: async (url, init) => { calls.push({ url, init }); return nextFetch(); },
};
vm.createContext(context);
installApiClient(context);

const json = (payload, status = 200, statusText = '') => () => new Response(JSON.stringify(payload), {
  status, statusText, headers: { 'Content-Type': 'application/json' },
});

async function rejects(call) {
  try { await call(); } catch (error) { return error; }
  throw new Error('apiFetch should have thrown');
}

(async () => {
  // 200 + JSON：回傳解析結果；method / headers / body 原樣交給 fetch，fallback 不外洩到 fetch
  nextFetch = json({ id: 7, name: '顆' });
  const body = JSON.stringify({ name: '顆' });
  const data = await context.apiFetch('/api/units', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body, fallback: '新增失敗',
  });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(data)), { id: 7, name: '顆' });
  assert.strictEqual(calls[0].url, '/api/units');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(calls[0].init)), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
  });
  assert.ok(!('fallback' in calls[0].init), 'fallback must not be sent to fetch');

  // 沒有 options：fetch 仍收到 GET 預設（空 init）
  nextFetch = json([]);
  await context.apiFetch('/api/units');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(calls[1].init)), {});

  // FormData body 原樣傳遞（上傳 JSON 憑證）
  const form = new FormData();
  form.append('name', 'k');
  nextFetch = json({ ok: true });
  await context.apiFetch('/api/gcal-keys', { method: 'POST', body: form });
  assert.strictEqual(calls[2].init.body, form);

  // 204 / 空內容 → null
  nextFetch = () => new Response(null, { status: 204 });
  assert.strictEqual(await context.apiFetch('/api/x', { method: 'DELETE' }), null);
  nextFetch = () => new Response('', { status: 200 });
  assert.strictEqual(await context.apiFetch('/api/x'), null);

  // 400 字串 detail → 原文訊息
  nextFetch = json({ detail: '單位已存在' }, 400);
  let error = await rejects(() => context.apiFetch('/api/units', { fallback: '新增失敗' }));
  assert.strictEqual(error.name, 'ApiError');
  assert.strictEqual(error.message, '單位已存在');
  assert.strictEqual(error.status, 400);
  assert.strictEqual(error.detail, '單位已存在');

  // 422 結構化 detail → 經 apiErrorMessage 格式化，不出現 [object Object]
  const detail = [{ loc: ['body', 'name'], type: 'string_too_long', ctx: { max_length: 100 } }];
  nextFetch = json({ detail }, 422);
  error = await rejects(() => context.apiFetch('/api/units', { fallback: '新增失敗' }));
  assert.strictEqual(error.message, '「名稱」不可超過 100 個字');
  assert.strictEqual(error.status, 422);
  assert.ok(!error.message.includes('[object Object]'));

  // 409 物件 detail：保留原始 detail 讓呼叫端自行判斷（例：Google 事件刪除未完成）
  nextFetch = json({ detail: { ok: false, google_failed: 2 } }, 409);
  error = await rejects(() => context.apiFetch('/api/gcal-keys/1', { method: 'DELETE' }));
  assert.strictEqual(error.status, 409);
  assert.strictEqual(error.detail.google_failed, 2);

  // 500 非 JSON（HTML 錯誤頁）→ fallback；沒有 fallback 用 statusText；都沒有用預設文字
  const html = (statusText = '') => () => new Response('<html>Internal Server Error</html>', {
    status: 500, statusText, headers: { 'Content-Type': 'text/html' },
  });
  nextFetch = html('Internal Server Error');
  error = await rejects(() => context.apiFetch('/api/units', { fallback: '操作失敗' }));
  assert.strictEqual(error.message, '操作失敗');
  assert.strictEqual(error.status, 500);
  assert.strictEqual(error.detail, undefined);
  nextFetch = html('Internal Server Error');
  error = await rejects(() => context.apiFetch('/api/units'));
  assert.strictEqual(error.message, 'Internal Server Error');
  nextFetch = html('');
  error = await rejects(() => context.apiFetch('/api/units'));
  assert.strictEqual(error.message, '操作失敗');

  // 錯誤回應有 JSON 但沒有 detail → fallback
  nextFetch = json({ message: 'nope' }, 400);
  error = await rejects(() => context.apiFetch('/api/units', { fallback: '儲存失敗' }));
  assert.strictEqual(error.message, '儲存失敗');

  // 200 但 JSON 格式錯誤 → 視為失敗（status 保留 200），訊息用 fallback
  nextFetch = () => new Response('{not json', { status: 200 });
  error = await rejects(() => context.apiFetch('/api/units', { fallback: '載入失敗' }));
  assert.strictEqual(error.name, 'ApiError');
  assert.strictEqual(error.status, 200);
  assert.strictEqual(error.message, '載入失敗');

  // 網路錯誤 → status 0，訊息用 fallback 或預設
  nextFetch = () => Promise.reject(new TypeError('Failed to fetch'));
  error = await rejects(() => context.apiFetch('/api/units', { fallback: '新增失敗' }));
  assert.strictEqual(error.name, 'ApiError');
  assert.strictEqual(error.status, 0);
  assert.strictEqual(error.message, '新增失敗');
  nextFetch = () => Promise.reject(new TypeError('Failed to fetch'));
  error = await rejects(() => context.apiFetch('/api/units'));
  assert.strictEqual(error.message, '網路連線失敗，請稍後再試');

  // AbortError 原樣丟出，讓呼叫端可以忽略被取消的請求
  const abort = new DOMException('The operation was aborted.', 'AbortError');
  nextFetch = () => Promise.reject(abort);
  error = await rejects(() => context.apiFetch('/api/units', { fallback: '新增失敗' }));
  assert.strictEqual(error, abort);

  // 401：auth.js 的 fetch 攔截負責轉登入；apiFetch 只回報 status，不自行導頁
  nextFetch = json({ detail: '未登入' }, 401);
  error = await rejects(() => context.apiFetch('/api/units'));
  assert.strictEqual(error.status, 401);
  assert.strictEqual(error.message, '未登入');

  // json 選項：自動帶 Content-Type 並序列化；呼叫端自帶的 header 保留
  nextFetch = json({ ok: true });
  await context.apiFetch('/api/units/1', { method: 'PUT', json: { is_active: false }, headers: { 'X-Test': '1' } });
  const jsonCall = calls[calls.length - 1];
  assert.strictEqual(jsonCall.init.body, '{"is_active":false}');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(jsonCall.init.headers)), { 'Content-Type': 'application/json', 'X-Test': '1' });
  assert.ok(!('json' in jsonCall.init), 'json option must not be sent to fetch');

  // apiDownload：檔名優先用伺服器 Content-Disposition；沒有時用預設檔名；錯誤與 apiFetch 相同
  const saved = [];
  context.URL = { createObjectURL: blob => { saved.push(blob); return 'blob:1'; }, revokeObjectURL() {} };
  context.document = {
    createElement: () => ({ click() { saved.push(this.download); }, remove() {} }),
    body: { appendChild() {} },
  };
  nextFetch = () => new Response(new Blob(['xlsx']), {
    status: 200, headers: { 'Content-Disposition': "attachment; filename*=UTF-8''%E5%BA%AB%E5%AD%98.xlsx" },
  });
  assert.strictEqual(await context.apiDownload('/api/export?x=1', { filename: '預設.xlsx' }), '庫存.xlsx');
  assert.strictEqual(saved[saved.length - 1], '庫存.xlsx');
  nextFetch = () => new Response(new Blob(['xlsx']), { status: 200 });
  assert.strictEqual(await context.apiDownload('/api/export', { filename: '預設.xlsx' }), '預設.xlsx');
  nextFetch = json({ detail: '沒有可匯出的資料' }, 400);
  error = await rejects(() => context.apiDownload('/api/export', { filename: '預設.xlsx', fallback: '請稍後再試' }));
  assert.strictEqual(error.message, '沒有可匯出的資料');
  nextFetch = html('Bad Gateway');
  error = await rejects(() => context.apiDownload('/api/export', { filename: '預設.xlsx', fallback: '請稍後再試' }));
  assert.strictEqual(error.message, '請稍後再試');

  console.log('apiFetch runtime: PASS');
})().catch(error => { console.error(error); process.exit(1); });
