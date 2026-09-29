// PDF 手機預覽按鈕 runtime 回歸（2026-09-14）：引號轉義曾讓 previewUrl 變字面文字，
// 按鈕看得到但點了沒反應。node --check 抓不到這種錯，必須實際執行 showPreview 驗證。
// 由 tests/test_frontend_assets.py::test_pdf_preview_button_runtime 包裝執行。
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
let failures = 0;

function check(cond, msg) {
  if (!cond) { failures++; console.error('FAIL:', msg); }
  else console.log('ok:', msg);
}

// 兩頁共用 render/upload-list.js 的 showPreview；載入正式元件與本頁設定後呼叫該頁控制器
function loadPage(renderFile, ctl, context) {
  vm.createContext(context);
  for (const file of ['upload-list.js', renderFile]) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'static', 'js', 'render', file), 'utf8'), context, { filename: file });
  }
  return context[ctl];
}

function runCase(renderFile, ctl, mobile, label) {
  let inner = '';
  let opened = null;
  let listener = null;
  const el = () => ({
    set innerHTML(v) { inner = v; },
    set textContent(v) {},
    set onclick(f) {},
    classList: { add() {} },
    querySelector: () => ({ addEventListener: (ev, fn) => { listener = fn; } }),
  });
  const page = loadPage(renderFile, ctl, {
    document: { getElementById: el },
    window: { open: (u) => { opened = u; } },
    isMobileView: () => mobile,
    esc: (s) => s,
  });
  page.showPreview('t.pdf', 'pdf', '/api/X/10/preview', '/api/X/10/download');
  const url = '/api/X/10/preview';
  check(inner.includes(url), label + ' innerHTML 含真實 URL');
  check(!inner.includes('previewUrl'), label + ' 無 previewUrl 字面殘留');
  if (mobile) {
    check(inner.includes('data-pdf-url="' + url + '"'), label + ' 按鈕帶正確 data-pdf-url');
    check(typeof listener === 'function', label + ' 按鈕有掛 click listener');
    const fake = { getAttribute: () => inner.match(/data-pdf-url="([^"]+)"/)[1] };
    listener.call(fake);
    check(opened === url, label + ' 點擊開啟正確 URL（拿到 ' + opened + '）');
  } else {
    check(inner.includes('<iframe'), label + ' 桌面維持 iframe 內嵌');
    check(inner.includes('src="' + url + '"'), label + ' iframe src 為真實 URL');
  }
}

runCase('quotation-upload.js', 'QuotationUploads', true, '[報價單上傳 手機]');
runCase('quotation-upload.js', 'QuotationUploads', false, '[報價單上傳 桌面]');
runCase('signed-reports.js', 'SignedReports', true, '[簽名報表 手機]');
runCase('signed-reports.js', 'SignedReports', false, '[簽名報表 桌面]');

if (failures > 0) { console.error(failures + ' 項失敗'); process.exit(1); }
console.log('全部通過');
