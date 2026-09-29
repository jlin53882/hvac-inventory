// 前端 runtime 測試共用工具（issue #39）：載入正式的 API client，提供與瀏覽器 Response 相同介面的回應替身。
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

/** 從原始碼取出單一具名函式（略過參數預設值的 {}）。 */
function extractFunction(source, name) {
  const start = source.search(new RegExp(`(async )?function ${name}\\(`));
  if (start < 0) throw new Error(`${name} must exist`);
  let depth = 0;
  for (let i = source.indexOf(') {', start) + 2; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`${name} is not closed`);
}

/** 把正式的 apiErrorMessage 與 api-client.js 載入 vm context（取代各測試自寫的 fetch 解析替身）。 */
function installApiClient(context) {
  vm.runInContext(extractFunction(read('static/js/utils.js'), 'apiErrorMessage'), context);
  vm.runInContext(read('static/js/api-client.js'), context, { filename: 'api-client.js' });
  return context;
}

/** 測試用回應：ok / status / text() / json() 與瀏覽器 Response 相同；payload 為 undefined 代表沒有內容。 */
function mockResponse(payload, status = 200) {
  const text = payload === undefined ? '' : JSON.stringify(payload);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    headers: { get: () => null },
    text: async () => text,
    json: async () => JSON.parse(text || 'null'),
  };
}

module.exports = { ROOT, read, extractFunction, installApiClient, mockResponse };
