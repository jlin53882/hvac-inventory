'use strict';

// 工作進度上傳進度條 runtime 回歸：以 fake XMLHttpRequest 驅動正式程式碼，
// 斷言「上傳中 xx% → 伺服器處理中…」順序、成功回傳 JSON、錯誤訊息與 wprFetch 一致。
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sourcePath = path.join(__dirname, '..', 'static', 'js', 'render', 'work-progress.js');
const source = fs.readFileSync(sourcePath, 'utf8');

function loadSandbox(xhrScript) {
  const created = [];
  class FakeXHR {
    constructor() { this.upload = {}; this.status = 0; this.responseText = ''; created.push(this); }
    open(method, url) { this.method = method; this.url = url; }
    send(body) { this.body = body; setImmediate(() => xhrScript(this)); }
  }
  const sandbox = {
    XMLHttpRequest: FakeXHR,
    document: { getElementById() { return null; }, addEventListener() {}, querySelector() { return null; } },
    window: { addEventListener() {} },
    setTimeout, clearTimeout, console,
  };
  vm.runInNewContext(source, sandbox, { filename: sourcePath });
  return { sandbox, created };
}

async function main() {
  // 1. 純函式：文字與邊界
  const { sandbox } = loadSandbox(() => {});
  assert.strictEqual(sandbox.wprUploadProgressText('upload', 0), '上傳中 0%');
  assert.strictEqual(sandbox.wprUploadProgressText('upload', 57.9), '上傳中 57%');
  assert.strictEqual(sandbox.wprUploadProgressText('upload', 140), '上傳中 100%');
  assert.strictEqual(sandbox.wprUploadProgressText('upload', NaN), '上傳中 0%');
  assert.strictEqual(sandbox.wprUploadProgressText('processing', 100), '伺服器處理中…');

  // 2. 成功：進度依序回報，resolve 伺服器 JSON
  const ok = loadSandbox((xhr) => {
    xhr.upload.onprogress({ lengthComputable: true, loaded: 25, total: 100 });
    xhr.upload.onprogress({ lengthComputable: false, loaded: 30, total: 0 });
    xhr.upload.onprogress({ lengthComputable: true, loaded: 100, total: 100 });
    xhr.upload.onload();
    xhr.status = 201; xhr.responseText = '{"id": 9}';
    xhr.onload();
  });
  const labels = [];
  const body = await ok.sandbox.wprUploadWithProgress('/api/work-progress', { form: 1 }, (phase, pct) => {
    labels.push(ok.sandbox.wprUploadProgressText(phase, pct));
  });
  assert.strictEqual(body.id, 9);
  assert.deepStrictEqual(labels, ['上傳中 0%', '上傳中 25%', '上傳中 100%', '伺服器處理中…']);
  assert.strictEqual(ok.created[0].method, 'POST');
  assert.strictEqual(ok.created[0].url, '/api/work-progress');
  assert.deepStrictEqual(ok.created[0].body, { form: 1 });

  // 3. API 錯誤：沿用 detail 訊息
  const bad = loadSandbox((xhr) => { xhr.status = 400; xhr.responseText = '{"detail": "單張圖片上限 20MB"}'; xhr.onload(); });
  await assert.rejects(bad.sandbox.wprUploadWithProgress('/x', {}, null), /單張圖片上限 20MB/);
  const noJson = loadSandbox((xhr) => { xhr.status = 502; xhr.responseText = '<html>'; xhr.onload(); });
  await assert.rejects(noJson.sandbox.wprUploadWithProgress('/x', {}, null), /API 錯誤：502/);

  // 4. 網路中斷
  const offline = loadSandbox((xhr) => xhr.onerror());
  await assert.rejects(offline.sandbox.wprUploadWithProgress('/x', {}, null), /網路連線中斷/);
  console.log('work progress upload progress runtime ok');
}

main().catch((error) => { console.error(error); process.exit(1); });
