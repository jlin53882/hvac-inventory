// 歷史報價單全展開 runtime 回歸（2026-09-15）：後端 /api/quotations 預設只回前 20 筆，
// 舊版 quoteLoadHistory 只抓第一頁，第 21 筆後永遠看不到。字串斷言抓不到這種錯，
// 必須實際執行翻頁邏輯驗證。由 tests/test_frontend_assets.py 包裝執行。
// 舊版跑此測試必紅（25 筆只渲染 20 列）。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let failures = 0;

function check(cond, msg) {
  if (!cond) { failures++; console.error('FAIL:', msg); }
  else console.log('ok:', msg);
}

function loadFunction(renderFile, fnName) {
  const src = fs.readFileSync(path.join(ROOT, 'static', 'js', 'render', renderFile), 'utf8');
  let start = src.indexOf('function ' + fnName);
  if (start === -1) throw new Error('找不到 ' + fnName + ' in ' + renderFile);
  if (src.slice(start - 6, start) === 'async ') start -= 6; // 保留 async 前綴
  let depth = 0, end = -1;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end === -1) throw new Error('函式結尾定位失敗: ' + fnName);
  return src.slice(start, end);
}

const HEAD = fs.readFileSync(
  path.join(ROOT, 'static', 'js', 'render', 'quotation.js'), 'utf8'
).split('function quoteMoney')[0];
const FN = loadFunction('quotation.js', 'quoteLoadHistory');

// 模擬後端：預設 page_size=20、有 total（與 app/routes/quotations.py 一致）
function mockBackend(total) {
  const calls = [];
  global.fetch = async (u) => {
    calls.push(String(u));
    const m = String(u).match(/page=(\d+).*page_size=(\d+)/);
    const page = m ? +m[1] : 1;
    const ps = m ? +m[2] : 20;
    const s = (page - 1) * ps, e = Math.min(s + ps, total);
    const items = [];
    for (let i = s; i < e; i++) items.push({
      id: i + 1, quote_number: 'Q' + (i + 1), customer_name: '客戶',
      quote_date: '2026-09-15', tax_type: 'included', total: 100,
    });
    return { ok: true, json: async () => ({ items, total, page, page_size: ps }) };
  };
  return calls;
}

function mockDom() {
  const els = {
    'quote-history-list': { innerHTML: '' },
    'quote-history-empty': { style: { display: '' } },
    'quote-history-q': { value: '' },
  };
  global.document = { getElementById: (id) => els[id] || null, addEventListener: () => {}, querySelectorAll: () => [] };
  global.window = { scrollTo() {} };
  global.esc = (s) => String(s);
  global.quoteMoney = (v) => String(v);
  global.toast = () => {};
  return els;
}

async function runCase(total, label) {
  const calls = mockBackend(total);
  const els = mockDom();
  eval(HEAD + ';' + FN + `
    ; quotationHistory = [];
    (async () => {
      await quoteLoadHistory();
      global.__len = quotationHistory.length;
      global.__rows = (document.getElementById('quote-history-list').innerHTML.match(/quote-history-row/g) || []).length;
    })();`);
  await new Promise((r) => setTimeout(r, 50));
  check(global.__len === total, label + ' 全部載入（' + global.__len + '/' + total + '）');
  check(global.__rows === total, label + ' 全部渲染（' + global.__rows + '/' + total + ' 列）');
  return { calls, els };
}

(async () => {
  const c25 = await runCase(25, '[25 筆]');
  check(c25.calls.some((u) => u.includes('page_size=100')), '[25 筆] 有用 page_size=100 逐頁抓');
  check(c25.calls.length === 1, '[25 筆] 一次請求即抓完（' + c25.calls.length + ' 次）');

  const c250 = await runCase(250, '[250 筆]');
  check(c250.calls.length === 3, '[250 筆] 分 3 次逐頁抓完（' + c250.calls.length + ' 次）');

  const c0 = await runCase(0, '[0 筆]');
  check(c0.els['quote-history-list'].innerHTML === '', '[0 筆] 列表為空');
  check(c0.els['quote-history-empty'].style.display === 'block', '[0 筆] 空清單顯示提示');

  if (failures > 0) { console.error(failures + ' 項失敗'); process.exit(1); }
  console.log('全部通過');
})();
