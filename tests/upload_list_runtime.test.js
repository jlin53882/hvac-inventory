// 檔案上傳清單（features/upload-list/upload-list.js）runtime 契約：以正式設定檔（signed-reports.js / quotation-upload.js）
// 實際執行兩頁，驗證畫面標記、上傳權限、上傳後重設、編輯 PATCH、刪除與錯誤訊息（issue #39 第 2 項合併前後行為一致）。
const assert = require('assert');
const vm = require('vm');
const { installApiClient, loadModules } = require('./support/frontend-runtime');


const PAGES = {
  signed: {
    file: 'features/upload-list/signed-reports.js', ctl: 'SignedReports', render: 'renderSignedReports', tab: 'signed-reports',
    api: '/api/signed-reports', title: '🗂 每日簽名報表', upload: '＋ 上傳每日簽名日報表', uploadTitle: '⬆️ 上傳每日簽名日報表',
    editTitle: '✏️ 編輯每日簽名日報表', icons: ['🗂', '📈'], gated: true, modeTabs: false,
    intro: '底部導覽「行事曆」旁', step1: '行事曆「📤 匯出日報表」下載 xlsx → 列印簽名', missingHint: '缺檔日 = 行事曆有派工但未上傳簽名檔的日期',
  },
  quotation: {
    file: 'features/upload-list/quotation-upload.js', ctl: 'QuotationUploads', render: 'renderQuotationUploads', tab: 'quotation',
    api: '/api/quotation-uploads', title: '🗂 報價單上傳', upload: '＋ 上傳報價單', uploadTitle: '⬆️ 上傳報價單',
    editTitle: '✏️ 編輯報價單上傳', icons: ['🧾', '📊'], gated: false, modeTabs: true,
    intro: '「報價單」頁上方切換至「報價單上傳」', step1: '將客戶確認（回簽）的報價單掃描成 PDF/圖片', missingHint: '缺檔日 = 行事曆有派工但未上傳報價單的日期',
  },
};

function element(id) {
  return {
    id, innerHTML: '', textContent: '', value: '', className: '', hidden: false, disabled: false,
    style: {}, dataset: {}, files: [], listeners: {},
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    querySelector() { return element('inner'); },
    querySelectorAll() { return []; },
    click() {},
    remove() { this.removed = true; },
  };
}

const flush = () => new Promise(resolve => setImmediate(resolve));
const jsonResponse = (payload, status = 200) => new Response(JSON.stringify(payload), {
  status, headers: { 'Content-Type': 'application/json' },
});

function setup(pageKey, { me, fetch } = {}) {
  const page = PAGES[pageKey];
  const elements = new Map();
  const surfaces = [element('surface-1'), element('surface-2')];
  const calls = { fetch: [], toast: [], appended: [] };
  const context = {
    console, URLSearchParams, FormData, File, Blob,
    appState: { currentTab: page.tab },
    calls,
    confirm: () => true,
    setTimeout: fn => { fn(); return 0; },
    toast: message => calls.toast.push(message),
    esc: value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'),
    quoteModeTabs: mode => `<div class="quote-mode-tabs" data-mode="${mode}"></div>`,
    window: { open: url => calls.opened = url },
    isMobileView: () => false,
    document: {
      body: { dataset: { page: pageKey === 'quotation' ? 'quotation-upload' : 'signed-reports' }, appendChild: node => calls.appended.push(node) },
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, element(id));
        return elements.get(id);
      },
      querySelectorAll: selector => (selector === '[data-role="upl-upload-surface"]' ? surfaces : []),
      createElement: () => element('overlay'),
    },
    fetch: async (url, init = {}) => {
      calls.fetch.push({ url, method: init.method || 'GET', body: init.body });
      if (fetch) return fetch(url, init);
      if (url === '/api/auth/me') return jsonResponse(me || { user: { display_name: '王小明', permissions: {} } });
      if (url.includes('/kpi')) return jsonResponse({ month: '2026-09', archived: 3, missing: 1, total: 4, rate: 75 });
      return jsonResponse({ items: [], total: 0, page: 1 });
    },
  };
  vm.createContext(context);
  installApiClient(context);
  loadModules(context, 'features/upload-list/upload-list.js', page.file);
  return { page, context, elements, surfaces, calls, ctl: context[page.ctl] };
}

const REPORT = {
  id: 7, report_date: '2026-09-14', uploader_name: '王小明', upload_time: '2026-09-15 08:00:00',
  file_name: '簽名單.pdf', mime_type: 'application/pdf', note: '已簽名', can_edit: true, can_delete: true,
};

(async () => {
  for (const key of Object.keys(PAGES)) {
    // 畫面標記：兩頁共用版面，只差設定的文字 / 圖示 / 報價單模式分頁 / 上傳權限閘門
    let t = setup(key);
    await vm.runInContext(`${t.page.render}()`, t.context);
    await flush();
    const html = t.context.document.getElementById('content').innerHTML;
    assert(html.indexOf('class="dsr-page-header"') < html.indexOf('class="upl-layout"'), `${key}: header must stay above the two-column layout`);
    assert(html.includes(`<h1>${t.page.title} <span class="dsr-new-badge">NEW</span></h1>`), `${key}: title`);
    assert(html.includes(`${t.page.upload}</button>`), `${key}: header upload button`);
    assert(html.includes(`<h2 id="upl-upload-title">${t.page.uploadTitle}</h2>`), `${key}: upload card title`);
    for (const icon of t.page.icons) assert(html.includes(`aria-hidden="true">${icon}</span>`), `${key}: KPI icon ${icon}`);
    assert.strictEqual(html.includes('quote-mode-tabs'), t.page.modeTabs, `${key}: quotation mode tabs`);
    assert.strictEqual((html.match(/hidden data-role="upl-upload-surface"/g) || []).length, t.page.gated ? 2 : 0, `${key}: upload surface starts hidden only when gated`);
    assert.strictEqual((html.match(/data-role="upl-upload-surface"/g) || []).length, 2, `${key}: header button and upload card are gated together`);
    assert(html.includes('<input id="upl-camera-input" type="file" style="display:none" accept="image/*" capture="environment">'), `${key}: camera input`);
    assert(html.includes('📷 相機拍攝'), `${key}: camera button`);
    // 頁面說明 / 使用流程 / 缺檔日定義由各頁設定提供：報價單上傳不得出現簽名報表的操作說明
    assert(html.includes(t.page.intro), `${key}: page intro`);
    assert(html.includes(`<li><span class="dsr-badge">1</span> ${t.page.step1}</li>`), `${key}: usage steps`);
    assert(html.includes(`<div class="upl-hint">${t.page.missingHint}</div>`), `${key}: missing-day hint`);
    if (key === 'quotation') assert(!/簽名|匯出日報表/.test(html), 'quotation: no signed-report copy');
    // 拖曳區內的「選擇檔案 / 相機拍攝」：最近的 data-action 優先（不會再冒泡觸發拖曳區），各只開一個選檔視窗
    const drop = html.slice(html.indexOf('<div id="upl-drop"'), html.indexOf('<input id="upl-file-input"'));
    const spanActions = [...drop.matchAll(/<span data-action="([^"]*)">/g)].map(m => m[1]);
    assert.deepStrictEqual(spanActions, ['upl-pick-file', 'upl-pick-camera'], `${key}: drop-zone buttons`);
    for (const action of spanActions) {
      const clicks = { file: 0, camera: 0 };
      const realGetElementById = t.context.document.getElementById;
      t.context.document.getElementById = id => ({ click() { clicks[id === 'upl-camera-input' ? 'camera' : 'file'] += 1; } });
      const el = { dataset: { action }, disabled: false };
      const handled = t.context.handleUploadListEvent({ type: 'click', target: { tagName: 'SPAN', closest: () => el } });
      t.context.document.getElementById = realGetElementById;
      assert(handled, `${key}: ${action} must be handled`);
      assert.strictEqual(clicks.file + clicks.camera, 1, `${key}: ${action} opens exactly one picker`);
    }
    assert(html.includes('<input id="upl-file-input" type="file" style="display:none" accept="image/*,.pdf">'), `${key}: file input accept`);
    assert(!/\.docx|\.xlsx/.test(html), `${key}: accept list matches backend whitelist`);
    assert(html.includes(`data-action="upl-range" data-ctl="${t.page.ctl}"`), `${key}: range chips use this page controller`);
    assert(!html.includes(t.page.ctl === 'SignedReports' ? 'QuotationUploads.' : 'SignedReports.'), `${key}: no cross-page controller calls`);
    // 載入後：預設本月、歷史與 KPI 各打一次本頁 API
    assert.strictEqual(t.context.document.getElementById('upl-f-from').value.slice(8), '01');
    assert.deepStrictEqual(t.calls.fetch.map(c => c.url.split('?')[0]), ['/api/auth/me', t.page.api, t.page.api + '/kpi']);
    assert.strictEqual(t.context.document.getElementById('upl-kpi-rate').textContent, '75%');

    // 上傳權限：簽名報表需 signed-report-upload；報價單上傳登入即可
    assert.strictEqual(t.surfaces[0].hidden, t.page.gated, `${key}: upload surface without permission`);
    assert.strictEqual(t.context.document.getElementById('upl-uploader').value, t.page.gated ? '' : '王小明', `${key}: uploader prefill without permission`);
    t = setup(key, { me: { user: { display_name: '陳大文', permissions: { 'signed-report-upload': true } } } });
    await vm.runInContext(`${t.page.render}()`, t.context);
    await flush();
    assert.strictEqual(t.surfaces[0].hidden, false, `${key}: upload surface with permission`);
    assert.strictEqual(t.context.document.getElementById('upl-uploader').value, '陳大文', `${key}: uploader prefill with permission`);

    // 選檔 → 上傳：FormData 欄位不變；成功後保留上傳人、日期回今天、清空備註與檔案、回到拖曳區
    const file = new File(['%PDF-1.4'], '日報表.pdf', { type: 'application/pdf' });
    t.context.document.getElementById('upl-file-input').listeners.change[0]({ target: { files: [file] } });
    assert.strictEqual(t.context.document.getElementById('upl-fp-icon').className, 'upl-file-preview__icon upl-file-tone--pdf');
    assert.strictEqual(t.context.document.getElementById('upl-drop').style.display, 'none');
    t.context.document.getElementById('upl-report-date').value = '2026-09-01';
    t.context.document.getElementById('upl-note').value = '夜間施工';
    t.calls.fetch.length = 0;
    await t.ctl.submitUpload();
    await flush();
    const post = t.calls.fetch[0];
    assert.strictEqual(post.url, t.page.api);
    assert.strictEqual(post.method, 'POST');
    assert.deepStrictEqual([...post.body.keys()], ['file', 'report_date', 'uploader_name', 'note']);
    assert.strictEqual(post.body.get('report_date'), '2026-09-01');
    assert.strictEqual(post.body.get('uploader_name'), '陳大文');
    assert.strictEqual(post.body.get('note'), '夜間施工');
    assert.strictEqual(t.calls.toast.at(-1), '✅ 上傳成功');
    assert.strictEqual(t.context.document.getElementById('upl-uploader').value, '陳大文');
    assert.strictEqual(t.context.document.getElementById('upl-note').value, '');
    assert.notStrictEqual(t.context.document.getElementById('upl-report-date').value, '2026-09-01');
    assert.strictEqual(t.context.document.getElementById('upl-drop').style.display, 'block');
    assert.strictEqual(t.context.document.getElementById('upl-file-preview').style.display, 'none');
    assert.strictEqual(t.calls.fetch[1].url.split('?')[0], t.page.api, `${key}: history reloads after upload`);
    t.calls.toast.length = 0;
    await t.ctl.submitUpload();
    assert.deepStrictEqual(t.calls.toast, ['⚠️ 請先選擇檔案'], `${key}: file is cleared after upload`);

    // 歷史列表：capability 決定編輯 / 刪除；圖片直接縮圖預覽，其餘顯示預覽按鈕
    t.ctl.state.reports = [{ ...REPORT }, { ...REPORT, id: 8, file_name: 'a.png', mime_type: 'image/png', can_edit: false, can_delete: false }];
    t.ctl.state.total = 2;
    t.ctl.renderTable();
    assert.strictEqual(t.context.document.getElementById('upl-pagination').hidden, true, `${key}: hide pagination below page size`);
    const list = t.context.document.getElementById('upl-tbody').innerHTML;
    assert(list.includes(`data-action="upl-edit" data-id="7" data-ctl="${t.page.ctl}"`) && list.includes(`data-action="upl-remove" data-id="7" data-ctl="${t.page.ctl}"`));
    assert(!list.includes('data-action="upl-edit" data-id="8"') && !list.includes('data-action="upl-remove" data-id="8"'));
    assert(list.includes(`<img class="upl-report-thumb" src="${t.page.api}/8/preview"`));
    assert(list.includes(`data-action="upl-preview" data-id="7" data-ctl="${t.page.ctl}">👁 預覽</button>`));
    assert(list.includes('<strong>2026-09-15</strong>'), `${key}: upload time shows date only`);
    assert(list.includes('<div class="upl-note-cell">已簽名</div>'));
    assert.strictEqual(t.context.document.getElementById('upl-page-info').textContent, '第 1 / 1 頁 · 共 2 筆');

    for (const [total, hidden] of [[20, true], [21, false], [0, true]]) {
      t.ctl.state.total = total;
      if (total === 0) t.ctl.state.reports = [];
      t.ctl.renderTable();
      assert.strictEqual(t.context.document.getElementById('upl-pagination').hidden, hidden, `${key}: pagination visibility for ${total} rows`);
    }
    t.ctl.state.reports = [{ ...REPORT }, { ...REPORT, id: 8 }];
    t.ctl.state.total = 2;
    t.ctl.renderTable();

    // 編輯：同窗 modal，PATCH FormData；成功後關閉並重新載入歷史
    const inputs = {
      '#upl-edit-date': { value: '2026-09-20' }, '#upl-edit-uploader': { value: ' 林小華 ' },
      '#upl-edit-note': { value: ' 補簽 ' }, '#upl-edit-file': { files: [] },
    };
    const saveButton = element('save');
    const cancelButtons = [element('cancel-1'), element('cancel-2')];
    const overlay = element('overlay');
    overlay.querySelector = selector => (selector === '[data-upl-edit-save]' ? saveButton : inputs[selector]);
    overlay.querySelectorAll = selector => (selector === '[data-upl-edit-cancel]' ? cancelButtons : []);
    t.context.document.createElement = () => overlay;
    await t.ctl.edit(7);
    assert.strictEqual(overlay.className, 'upl-overlay is-open');
    assert(overlay.innerHTML.includes(`<h3 id="upl-edit-title">${t.page.editTitle}</h3>`), `${key}: edit title`);
    for (const id of ['upl-edit-date', 'upl-edit-uploader', 'upl-edit-note', 'upl-edit-file']) assert(overlay.innerHTML.includes(`id="${id}"`));
    assert(overlay.innerHTML.includes('accept=".pdf,image/png,image/jpeg,image/gif,image/webp"'));
    assert(overlay.innerHTML.includes('value="2026-09-14"') && overlay.innerHTML.includes('>已簽名</textarea>'));
    assert.strictEqual(cancelButtons.every(b => b.listeners.click.length === 1), true, `${key}: both cancel buttons close`);
    t.calls.fetch.length = 0;
    t.context.fetch = async (url, init = {}) => {
      t.calls.fetch.push({ url, method: init.method || 'GET', body: init.body });
      if (init.method === 'PATCH') return jsonResponse({ ...REPORT, report_date: '2026-09-20' });
      return jsonResponse({ items: [], total: 0, page: 1 });
    };
    await saveButton.listeners.click[0]();
    const patch = t.calls.fetch[0];
    assert.deepStrictEqual([patch.url, patch.method], [t.page.api + '/7', 'PATCH']);
    assert.deepStrictEqual([...patch.body.entries()], [['report_date', '2026-09-20'], ['uploader_name', '林小華'], ['note', '補簽']]);
    assert.strictEqual(overlay.removed, true);
    assert.strictEqual(t.calls.fetch[1].url.split('?')[0], t.page.api, `${key}: history reloads after edit`);
    assert.strictEqual(t.calls.toast.at(-1), '✅ 報表已更新');
    // 編輯失敗：結構化 detail 經 apiErrorMessage（欄位顯示中文標籤，不顯示 uploader_name），modal 保持開啟
    overlay.removed = false;
    t.context.fetch = async () => jsonResponse({ detail: [{ loc: ['body', 'uploader_name'], type: 'string_too_long', ctx: { max_length: 50 } }] }, 422);
    await saveButton.listeners.click[0]();
    assert.strictEqual(t.calls.toast.at(-1), '⚠️ 「上傳人姓名」不可超過 50 個字');
    assert.strictEqual(overlay.removed, false);

    // 刪除：二次確認後 DELETE；失敗顯示後端原因
    t.calls.fetch.length = 0;
    t.context.fetch = async (url, init = {}) => {
      t.calls.fetch.push({ url, method: init.method || 'GET' });
      return init.method === 'DELETE' ? jsonResponse({ ok: true }) : jsonResponse({ items: [], total: 0, page: 1 });
    };
    await t.ctl.remove(7);
    await flush();
    assert.deepStrictEqual(t.calls.fetch.map(c => [c.url.split('?')[0], c.method]), [[t.page.api + '/7', 'DELETE'], [t.page.api, 'GET'], [t.page.api + '/kpi', 'GET']]);
    assert.strictEqual(t.calls.toast.at(-1), '🗑 已刪除');
    t.context.fetch = async () => jsonResponse({ detail: '只能刪除自己上傳的檔案' }, 403);
    await t.ctl.remove(7);
    assert.strictEqual(t.calls.toast.at(-1), '⚠️ 只能刪除自己上傳的檔案');
    t.context.confirm = () => false;
    t.calls.fetch.length = 0;
    await t.ctl.remove(7);
    assert.strictEqual(t.calls.fetch.length, 0, `${key}: cancelled delete sends nothing`);

    // 上傳失敗：結構化 detail 格式化；網路錯誤保留「網路錯誤」前綴
    t.context.document.getElementById('upl-file-input').listeners.change[0]({ target: { files: [file] } });
    t.context.fetch = async () => jsonResponse({ detail: [{ loc: ['body', 'note'], type: 'string_too_long', ctx: { max_length: 500 } }] }, 422);
    await t.ctl.submitUpload();
    assert.strictEqual(t.calls.toast.at(-1), '⚠️ 「備註」不可超過 500 個字');
    t.context.fetch = async () => { throw new TypeError('Failed to fetch'); };
    await t.ctl.submitUpload();
    assert.strictEqual(t.calls.toast.at(-1), '⚠️ 網路錯誤：上傳失敗');

    // 下載與預覽走本頁 API
    t.ctl.download(7);
    assert.strictEqual(t.calls.opened, t.page.api + '/7/download');
    t.ctl.state.reports = [{ ...REPORT }];
    t.ctl.preview(7);
    assert.strictEqual(t.context.document.getElementById('upl-preview-title').textContent, '👁 預覽 — 簽名單.pdf');
    assert(t.context.document.getElementById('upl-preview-body').innerHTML.includes(`src="${t.page.api}/7/preview"`));
  }

  // 報價單上傳：切回報價單模式（data-page 改變）後，進行中的上傳頁掛載不可再寫畫面或查歷史
  const auth = { resolve: null };
  const t = setup('quotation', {
    fetch: url => (url === '/api/auth/me' ? new Promise(resolve => { auth.resolve = resolve; }) : jsonResponse({ items: [], total: 0 })),
  });
  const mounting = vm.runInContext('renderQuotationUploads()', t.context);
  t.context.document.body.dataset.page = 'quotation';
  auth.resolve(jsonResponse({ user: { display_name: '王小明' } }));
  await mounting;
  assert.deepStrictEqual(t.calls.fetch.map(c => c.url), ['/api/auth/me'], 'stale quotation upload mount must stop');
  assert.strictEqual(t.context.document.getElementById('upl-uploader').value, '');

  console.log('upload list runtime: PASS');
})().catch(error => { console.error(error); process.exit(1); });
