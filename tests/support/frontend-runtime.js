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

/**
 * ES module 原始碼轉成可在 vm context 執行的 script：去掉 import 行與 export 關鍵字，
 * export 的 const/let 改成 var，讓測試能像以前一樣用 context 全域注入替身、以 context.X 讀取狀態。
 * 模組之間的 import/export 是否真的對得上，由 tests/esm_link.test.js 用正式的 ESM linker 檢查。
 */
function moduleScript(relative) {
  // 接受 static/js 之下的相對路徑，也接受 'static/js/...' 或絕對路徑（Python 測試內嵌的 node 腳本會傳完整路徑）
  const file = path.isAbsolute(relative) ? relative : path.join(ROOT, relative.startsWith('static/') ? relative : `static/js/${relative}`);
  const script = strip(fs.readFileSync(file, 'utf8'));
  // 零依賴的葉節點模組：harness 會去掉 import，頁面模組用到它們時在同一支 script 前面補上，
  // 各測試不必手動把它們加進載入清單（葉節點只含 function 宣告，重複載入無害）。
  const leaves = Object.entries(LEAF_MODULES)
    .filter(([name, leaf]) => script.includes(`${name}(`) && !file.endsWith(leaf))
    .map(([, leaf]) => strip(fs.readFileSync(path.join(ROOT, 'static/js', leaf), 'utf8')));
  return leaves.concat(script).join('\n');
}

const LEAF_MODULES = { createRequestGuard: 'core/request-guard.js', createKeyedRequestGuard: 'core/request-guard.js' };

function strip(source) {
  return source
    .replace(/^import [^;]+;\n/gm, '')
    .replace(/^export (const|let) /gm, 'var ')
    .replace(/^export (?=(async )?function|var |class )/gm, '');
}

/** 依序把模組（static/js 之下的相對路徑）載入 vm context。 */
function loadModules(context, ...relatives) {
  for (const relative of relatives) vm.runInContext(moduleScript(relative), context, { filename: relative });
  return context;
}

/**
 * 讓 inline handler 字串（例如 onclick="Stockout.deleteStockoutReturn(7)"）能在 vm context 執行：
 * 正式環境由 pages/*.js 把命名空間掛到 window；測試中模組函式都在 context 全域，命名空間直接指向 context。
 */
function installNamespaces(context, ...namespaces) {
  for (const name of namespaces) context[name] = context;
  return context;
}

/** 工作進度頁（原 render/work-progress.js）拆分後的模組，依原檔順序載入，並執行模組載入時的副作用。 */
function loadWorkProgress(context) {
  vm.createContext(context);
  loadModules(context, 'features/shell/navigation.js', 'features/work-progress/state.js', 'features/work-progress/format.js',
    'features/work-progress/photo-upload.js', 'features/work-progress/gallery.js', 'features/work-progress/pending-photos.js',
    'features/work-progress/history.js', 'features/work-progress/day.js', 'features/work-progress/draft.js',
    'features/work-progress/detail.js', 'features/work-progress/upload.js', 'features/work-progress/page.js');
  configureShellPorts(context);
  context.initWorkProgressGallery();
  return context;
}

/**
 * 把 shell 的 port 接到 vm context 內的同名函式（正式環境由 features/shell/app.js 的 configureShell 組裝）：
 * data-refresh.js 的畫面更新 hook、navigation.js 的切頁。呼叫時才解析 context 上的函式，測試可在之後替換替身。
 */
function configureShellPorts(context) {
  const hook = name => (...args) => context[name](...args);
  if (typeof context.configureDataRefresh === 'function') {
    context.configureDataRefresh({
      buildDatalists: hook('buildDatalists'), buildFilterPanel: hook('buildFilterPanel'), checkReminder: hook('checkReminder'),
      updateNotifications: hook('updateNotifications'), remountTab: hook('switchTab'), renderInventory: hook('renderInventory'),
      updatePreparedBadge: hook('updatePreparedBadge'),
    });
  }
  if (typeof context.provideTabNavigator === 'function') context.provideTabNavigator(hook('switchTab'));
  return context;
}

/** 把正式的 apiErrorMessage 與 api-client.js 載入 vm context（取代各測試自寫的 fetch 解析替身）。 */
function installApiClient(context) {
  vm.runInContext(extractFunction(read('static/js/core/utils.js'), 'apiErrorMessage'), context);
  return loadModules(context, 'core/api-client.js');
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

module.exports = { ROOT, read, extractFunction, moduleScript, loadModules, loadWorkProgress, configureShellPorts, installNamespaces, installApiClient, mockResponse };
