// 庫存管理系統 - 檔案上傳清單頁（每日簽名報表、報價單上傳共用；issue #39 第 2 項合併）
// 兩頁只差設定（API 路徑、標題文字、上傳權限、是否目前頁面）；上傳、歷史查詢、預覽、編輯、刪除共用同一份實作。
// 權限：登入可查/預覽/下載；編輯/刪除直接消費 backend final capabilities（r.can_edit / r.can_delete）
// 模板只輸出 data-action / data-ctl（控制器名稱）；本檔的 delegate 依 data-ctl 找到對應控制器

import { createActionDelegate } from '../../core/actions.js';
import { apiFetch } from '../../core/api-client.js';
import { isMobileView } from '../../core/bottomsheet.js';
import { createRequestGuard } from '../../core/request-guard.js';
import { esc, toast } from '../../core/utils.js';

const UPLOAD_LIST_IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'gif'];

// 將 Date 物件轉為 YYYY-MM-DD 字串
function _uplIso(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// 上傳時間資料仍保留完整值，列表只顯示日期。
function _uplDateOnly(value) {
  return String(value || '').split(/[T ]/)[0];
}

// 依副檔名回傳圖示 emoji 與色塊（CSS：.upl-file-tone--*）
function _uplIconFor(mime) {
  if (['jpg','jpeg','png','webp','heic','gif'].includes(mime)) return {icon:'🖼', tone:'image'};
  if (mime === 'pdf') return {icon:'📄', tone:'pdf'};
  if (['docx','doc'].includes(mime)) return {icon:'📝', tone:'doc'};
  if (['xlsx','xls'].includes(mime)) return {icon:'📊', tone:'sheet'};
  return {icon:'📎', tone:'other'};
}

/**
 * 建立一個檔案上傳清單頁控制器。
 * @param {object} config 頁面設定。
 * @param {string} config.global 控制器名稱（模板 data-ctl 使用，例：'SignedReports'）。
 * @param {string} config.api API 路徑（例：'/api/signed-reports'）。
 * @param {() => boolean} config.isActive 目前是否仍在本頁（切頁 / 重新掛載後舊請求不可再寫畫面）。
 * @param {string} config.title 頁面標題。
 * @param {string} config.uploadLabel 上傳對象名稱（「＋ 上傳…」「⬆️ 上傳…」）。
 * @param {string} config.editTitle 編輯視窗標題。
 * @param {{archived: string, rate: string}} config.kpiIcons KPI 卡圖示。
 * @param {string|null} config.uploadPermission 需要的上傳權限；null 代表登入即可上傳。
 * @param {string} config.intro 頁首說明文字。
 * @param {string[]} config.steps 右側「使用流程」步驟文字。
 * @param {string} config.missingHint 「缺檔日」KPI 的定義說明。
 * @param {() => string} [config.headerHtml] 頁首上方額外 HTML（已跳脫的固定內容）。
 * @returns {object} 頁面控制器（state 與模板呼叫的方法）。
 */
export function createUploadListPage(config) {
  const ctl = config.global;
  const api = config.api;
  const state = {
    reports: [],
    page: 1,
    pageSize: 20,
    total: 0,
    selectedFile: null,
    renderSeq: 0,
    historyGuard: createRequestGuard(),
    kpiGuard: createRequestGuard(),
  };
  const $ = id => document.getElementById(id);
  const isCurrent = renderSeq => renderSeq === state.renderSeq && config.isActive();

  // 渲染頁面（含上傳區、KPI、歷史查詢）
  async function render() {
    const renderSeq = ++state.renderSeq;
    const el = $('content');
    if (!el) return;
    const today = _uplIso(new Date());
    const gate = config.uploadPermission ? 'hidden ' : '';
    const stepsHtml = config.steps.map((step, i) => '<li><span class="dsr-badge">' + (i + 1) + '</span> ' + esc(step) + '</li>').join('');
    el.innerHTML = `
    <div class="upl-wrap">
      ${config.headerHtml ? config.headerHtml() : ''}
      <div class="dsr-page-header">
        <div class="dsr-page-title">
          <h1>🗂 ${esc(config.title)} <span class="dsr-new-badge">NEW</span></h1>
          <p>${esc(config.intro)}</p>
        </div>
        <div class="dsr-page-actions">
          <button class="btn btn--secondary btn--md" data-action="upl-scroll-history">↓ 查看歷史查詢</button>
          <button ${esc(gate)}data-role="upl-upload-surface" class="btn btn--primary btn--md" data-action="upl-pick-file">＋ 上傳${esc(config.uploadLabel)}</button>
        </div>
      </div>

      <div class="upl-layout">
        <!-- 左：上傳區 -->
        <section ${esc(gate)}data-role="upl-upload-surface" class="dsr-card" aria-labelledby="upl-upload-title">
          <div class="dsr-card__hd">
            <h2 id="upl-upload-title">⬆️ 上傳${esc(config.uploadLabel)}</h2>
            <p>支援 PDF / 圖片格式 · 單檔 ≤ 20MB · 自動記錄上傳時間</p>
          </div>
          <div class="dsr-card__bd">
            <div class="dsr-form-grid dsr-form-grid--two">
              <div class="dsr-field">
                <label>上傳人姓名<span class="dsr-required">*</span></label>
                <input id="upl-uploader" type="text" placeholder="例：蘇昱豪">
              </div>
              <div class="dsr-field">
                <label>報表日期（業務日期）<span class="dsr-required">*</span></label>
                <input id="upl-report-date" type="date" value="${esc(today)}">
              </div>
            </div>
            <div class="u-mt-12 dsr-field">
              <label>備註 / 備忘（選填）</label>
              <textarea id="upl-note" rows="2" placeholder="例：今日有現場工安檢查，客戶臨時增加 2 台保養"></textarea>
            </div>
            <!-- 拖曳上傳 -->
            <div id="upl-drop" class="u-mt-12 upl-drop" data-action="upl-pick-file">
              <div class="upl-drop__icon">📎</div>
              <div class="upl-drop__title">拖曳檔案到此，或點擊選擇</div>
              <div class="upl-drop__sub">支援 PDF / PNG / JPG / GIF / WebP 格式</div>
              <div class="upl-drop__actions">
                <span data-action="upl-pick-file">選擇檔案</span>
                <span data-action="upl-pick-camera">📷 相機拍攝</span>
              </div>
              <input id="upl-file-input" type="file" style="display:none" accept="image/*,.pdf">
              <input id="upl-camera-input" type="file" style="display:none" accept="image/*" capture="environment">
            </div>
            <!-- 選檔後預覽 -->
            <div id="upl-file-preview" style="display:none">
              <div class="upl-file-preview">
                <div id="upl-fp-icon" class="upl-file-preview__icon upl-file-tone--pdf">📄</div>
                <div class="upl-file-preview__meta">
                  <div id="upl-fp-name" class="upl-file-preview__name"></div>
                  <div id="upl-fp-sub" class="upl-file-preview__sub"></div>
                  <div class="upl-progress"><div id="upl-progress-bar" class="upl-progress__bar"></div></div>
                </div>
                <button class="btn btn--secondary btn--sm" data-action="upl-clear-file" data-ctl="${esc(ctl)}">移除</button>
              </div>
              <div class="upl-upload-actions">
                <button class="btn btn--primary btn--md upl-btn--primary" data-action="upl-submit" data-ctl="${esc(ctl)}">⬆️ 確認上傳</button>
                <button class="btn btn--secondary btn--md" data-action="upl-preview-file" data-ctl="${esc(ctl)}">👁 預覽</button>
              </div>
            </div>
            <div class="upl-tags">
              <span class="upl-tag">✦ 自動寫入上傳時間</span>
              <span class="upl-tag">✦ 檔名自動 esc / 公式注入防護</span>
              <span class="upl-tag">✦ 刪除：有「全域刪除」權限者可刪全部，其餘僅能刪自己上傳的</span>
            </div>
          </div>
        </section>

        <!-- 右：說明 / KPI -->
        <aside class="upl-side">
          <div class="dsr-info">
            <h3>💡 使用流程</h3>
            <ul>
              ${stepsHtml}
            </ul>
            <div class="dsr-info-badges">
              <span class="dsr-badge">🔒 登入可查</span>
              <span class="dsr-badge">✏️ 自己刪自己的；有「全域刪除」權限者可刪全部</span>
              <span class="dsr-badge">📱 手機可掃描直傳</span>
            </div>
          </div>
          <div class="dsr-card">
            <div class="dsr-card__hd"><h2>📊 本月概況</h2><p id="upl-kpi-month"></p></div>
            <div class="dsr-card__bd">
              <div class="upl-kpi ui-kpi-grid ui-kpi-grid--compact">
                <div class="ui-kpi-card ui-kpi-card--blue ui-kpi-card--compact"><span class="ui-kpi-icon" aria-hidden="true">${esc(config.kpiIcons.archived)}</span><div class="ui-kpi-body"><div class="ui-kpi-label">已歸檔</div><div class="ui-kpi-value" id="upl-kpi-total">—</div><span class="ui-kpi-meta">本月</span></div></div>
                <div class="ui-kpi-card ui-kpi-card--amber ui-kpi-card--compact"><span class="ui-kpi-icon" aria-hidden="true">⚠</span><div class="ui-kpi-body"><div class="ui-kpi-label">缺檔日</div><div class="ui-kpi-value" id="upl-kpi-missing">—</div><span class="ui-kpi-meta">本月</span></div></div>
                <div class="ui-kpi-card ui-kpi-card--green ui-kpi-card--compact"><span class="ui-kpi-icon" aria-hidden="true">${esc(config.kpiIcons.rate)}</span><div class="ui-kpi-body"><div class="ui-kpi-label">歸檔率</div><div class="ui-kpi-value" id="upl-kpi-rate">—</div><span class="ui-kpi-meta">本月</span></div></div>
              </div>
              <div class="upl-hint">${esc(config.missingHint)}</div>
            </div>
          </div>
        </aside>

        <!-- 歷史查詢（全寬） -->
        <section id="upl-history" class="dsr-card upl-history">
          <div class="dsr-card__hd">
            <div class="upl-history-heading">
              <h2>🔍 歷史報表查詢</h2>
              <p>可查單日 / 週 / 自訂區間 · 關鍵字搜尋上傳人或備註</p>
            </div>
            <div class="upl-filter-bar">
              <div class="dsr-field"><label>起始日</label><input id="upl-f-from" type="date"></div>
              <div class="dsr-field"><label>迄止日</label><input id="upl-f-to" type="date"></div>
              <div class="dsr-field upl-field--search"><label>關鍵字（上傳人 / 備註 / 檔名）</label><input id="upl-f-q" type="text" placeholder="例：昱豪、工安"></div>
              <div class="upl-filter-actions">
                <button class="btn btn--primary btn--md" data-action="upl-search" data-ctl="${esc(ctl)}">搜尋</button>
                <button class="btn btn--secondary btn--md" data-action="upl-reset-filter" data-ctl="${esc(ctl)}">清除</button>
              </div>
            </div>
            <div class="upl-chips">
              <button class="chip" data-role="upl-range" data-range="today" data-action="upl-range" data-ctl="${esc(ctl)}">今天</button>
              <button class="chip" data-role="upl-range" data-range="week" data-action="upl-range" data-ctl="${esc(ctl)}">本週</button>
              <button class="chip is-active" data-role="upl-range" data-range="month" data-action="upl-range" data-ctl="${esc(ctl)}">本月</button>
              <button class="chip" data-role="upl-range" data-range="all" data-action="upl-range" data-ctl="${esc(ctl)}">全部</button>
              <span class="upl-result-count"><span id="upl-result-count">0 筆</span></span>
            </div>
          </div>
          <div class="u-pt-0 dsr-card__bd">
            <div class="upl-report-list" id="upl-tbody"></div>
            <div id="upl-empty" class="dsr-empty" style="display:none">
                <div class="dsr-empty__icon">🗂</div>
                <div>沒有符合條件的報表</div>
                <div class="upl-hint">試試放寬日期或關鍵字，或切換「全部」</div>
              </div>
            </div>
            <div class="upl-pagination">
              <span id="upl-page-info"></span>
              <span class="u-d-flex u-gap-6">
                <button class="btn btn--secondary btn--sm" data-action="upl-page" data-delta="-1" data-ctl="${esc(ctl)}">‹ 上一頁</button>
                <button class="btn btn--secondary btn--sm" data-action="upl-page" data-delta="1" data-ctl="${esc(ctl)}">下一頁 ›</button>
              </span>
            </div>
          </div>
        </section>
      </div>
    </div>

    <!-- 預覽 Modal -->
    <div id="upl-overlay" class="upl-overlay" data-action="upl-close-preview-backdrop" data-ctl="${esc(ctl)}">
      <div class="dsr-modal">
        <div class="dsr-modal__hd"><h3 id="upl-preview-title">👁 預覽</h3><button class="btn btn--secondary btn--sm" data-action="upl-close-preview" data-ctl="${esc(ctl)}">✕ 關閉</button></div>
        <div class="dsr-modal__bd" id="upl-preview-body"></div>
        <div class="dsr-modal__ft">
          <span class="dsr-modal__note">若預覽失敗，請直接下載原檔</span>
          <span class="dsr-modal__actions">
            <button class="btn btn--secondary btn--md" data-action="upl-close-preview" data-ctl="${esc(ctl)}">關閉</button>
            <button class="btn btn--primary btn--md" id="upl-dl-btn">⬇️ 下載原檔</button>
          </span>
        </div>
      </div>
    </div>`;

    // 帶入登入者姓名；需要上傳權限的頁面依權限顯示上傳區
    const me = await apiFetch('/api/auth/me').catch(() => null);
    if (!isCurrent(renderSeq)) return;
    const canUpload = !config.uploadPermission || !!(me && me.user && me.user.permissions && me.user.permissions[config.uploadPermission]);
    document.querySelectorAll('[data-role="upl-upload-surface"]').forEach(node => { node.hidden = !canUpload; });
    if (canUpload && me && me.user && me.user.display_name) $('upl-uploader').value = me.user.display_name;

    // 預設日期範圍 = 本月
    const now = new Date();
    $('upl-f-from').value = _uplIso(new Date(now.getFullYear(), now.getMonth(), 1));
    $('upl-f-to').value = _uplIso(new Date(now.getFullYear(), now.getMonth()+1, 0));

    // 拖曳事件
    const drop = $('upl-drop');
    ['dragenter','dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('drag'); }));
    ['dragleave','drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('drag'); }));
    drop.addEventListener('drop', e => { if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); });
    $('upl-file-input').addEventListener('change', e => { if (e.target.files[0]) handleFile(e.target.files[0]); });
    $('upl-camera-input').addEventListener('change', e => { if (e.target.files[0]) handleFile(e.target.files[0]); });

    loadHistory();
  }

  // 處理使用者選擇/拖曳的檔案，更新預覽區
  function handleFile(f) {
    const ext = (f.name.split('.').pop() || '').toLowerCase();
    const ic = _uplIconFor(ext);
    $('upl-fp-icon').textContent = ic.icon;
    $('upl-fp-icon').className = 'upl-file-preview__icon upl-file-tone--' + ic.tone;
    $('upl-fp-name').textContent = f.name;
    $('upl-fp-sub').textContent = ext.toUpperCase() + ' · ' + (f.size/1024/1024).toFixed(1) + ' MB';
    $('upl-file-preview').style.display = 'block';
    $('upl-progress-bar').style.width = '0%';
    $('upl-drop').style.display = 'none';
    state.selectedFile = f;
  }

  // 清除已選檔案，恢復拖曳區
  function clearFile() {
    $('upl-file-preview').style.display = 'none';
    $('upl-drop').style.display = 'block';
    $('upl-file-input').value = '';
    state.selectedFile = null;
  }

  // 上傳成功後清除欄位數值，保留表單、歷史表格與上傳人姓名。
  function keepUploaderOnly() {
    const dateField = $('upl-report-date');
    const noteField = $('upl-note');
    const fileField = $('upl-file-input');
    const cameraField = $('upl-camera-input');
    if (dateField) dateField.value = _uplIso(new Date());
    if (noteField) noteField.value = '';
    if (fileField) fileField.value = '';
    if (cameraField) cameraField.value = '';
    state.selectedFile = null;
    const drop = $('upl-drop');
    const preview = $('upl-file-preview');
    if (drop) drop.style.display = 'block';
    if (preview) preview.style.display = 'none';
  }

  // 預覽已選的本地檔案（上傳前）
  function openPreviewFile() {
    const file = state.selectedFile;
    if (!file) return;
    const url = URL.createObjectURL(file);
    showPreview(file.name, (file.name.split('.').pop()||'').toLowerCase(), url, url);
  }

  // 上傳檔案到伺服器
  async function submitUpload() {
    const file = state.selectedFile;
    if (!file) return toast('⚠️ 請先選擇檔案');
    const uploader = $('upl-uploader').value.trim();
    const reportDate = $('upl-report-date').value;
    const note = $('upl-note').value.trim();
    if (!uploader) return toast('⚠️ 請填上傳人姓名');
    if (!reportDate) return toast('⚠️ 請選擇報表日期');
    const bar = $('upl-progress-bar');
    bar.style.width = '10%';
    const fd = new FormData();
    fd.append('file', file);
    fd.append('report_date', reportDate);
    fd.append('uploader_name', uploader);
    fd.append('note', note);
    try {
      bar.style.width = '30%';
      await apiFetch(api, { method: 'POST', body: fd, fallback: '上傳失敗' });
      bar.style.width = '100%';
      setTimeout(() => toast('✅ 上傳成功'), 300);
      keepUploaderOnly();
      loadHistory();
    } catch(e) { toast(e.status ? '⚠️ ' + e.message : '⚠️ 網路錯誤：' + e.message); }
  }

  // 載入歷史報表列表（分頁 + 篩選）；只採用本頁、最新一次請求的回應
  async function loadHistory(resetPage) {
    const renderSeq = state.renderSeq;
    if (!isCurrent(renderSeq)) return;
    if (resetPage) state.page = 1;
    const from = $('upl-f-from').value || '';
    const to = $('upl-f-to').value || '';
    const q = $('upl-f-q').value.trim();
    const pageAtRequest = state.page;
    const requestSeq = state.historyGuard.next();
    const p = new URLSearchParams({ from_date: from, to_date: to, q, page: pageAtRequest, page_size: state.pageSize });
    let data;
    try {
      data = await apiFetch(api + '?' + p);
    } catch(e) {
      return;
    }
    if (!isCurrent(renderSeq) || !state.historyGuard.isCurrent(requestSeq)) return;
    state.reports = data.items || [];
    state.total = data.total || 0;
    state.page = data.page || pageAtRequest;
    $('upl-result-count').textContent = state.total + ' 筆';
    renderTable();
    updateKPI(renderSeq);
  }

  // 渲染歷史報表清單
  function renderTable() {
    const tb = $('upl-tbody');
    const empty = $('upl-empty');
    if (!state.reports.length) { tb.innerHTML = ''; empty.style.display = 'block'; }
    else {
      empty.style.display = 'none';
      tb.innerHTML = state.reports.map(r => {
        const ext = (r.file_name || '').split('.').pop().toLowerCase();
        const ic = _uplIconFor(ext);
        const note = r.note ? esc(r.note) : '<span class="upl-note-empty">—</span>';
        const isImage = UPLOAD_LIST_IMAGE_EXTS.includes(ext);
        const fileVisual = isImage
          ? `<img class="upl-report-thumb" src="${esc(api)}/${r.id}/preview" alt="${esc(r.file_name)}" loading="lazy" data-action="upl-preview" data-id="${r.id}" data-ctl="${esc(ctl)}" title="點擊圖片預覽">`
          : `<div class="upl-file-icon upl-file-tone--${esc(ic.tone)}">${ic.icon}</div>`;
        return `<details class="upl-report-card">
          <summary class="upl-report-summary">
            <span class="upl-report-summary__date">${esc(r.report_date)}</span>
            <span class="upl-report-summary__uploader upl-tag">${esc(r.uploader_name)}</span>
            <span class="upl-report-summary__file">${esc(r.file_name)}</span>
          </summary>
          <div class="upl-report-detail">
            <div class="upl-report-detail__grid">
              <div><span class="upl-report-detail__label">報表日期</span><strong>${esc(r.report_date)}</strong></div>
              <div><span class="upl-report-detail__label">上傳人</span><strong>${esc(r.uploader_name)}</strong></div>
              <div><span class="upl-report-detail__label">上傳日期</span><strong>${esc(_uplDateOnly(r.upload_time))}</strong></div>
              <div class="upl-report-detail__file"><span class="upl-report-detail__label">檔案</span><div class="upl-file-cell">${fileVisual}<div class="u-minw-0"><div class="upl-file-name upl-ellipsis">${esc(r.file_name)}</div><div class="upl-file-meta">${esc((r.mime_type||'').toUpperCase())}</div></div></div></div>
              <div class="upl-report-detail__note"><span class="upl-report-detail__label">備註</span><div class="upl-note-cell">${note}</div></div>
            </div>
            <div class="upl-actions-cell">
              ${!isImage ? `<button class="btn btn--secondary btn--sm" data-action="upl-preview" data-id="${r.id}" data-ctl="${esc(ctl)}">👁 預覽</button>` : ''}
              ${r.can_edit ? `<button class="btn btn--secondary btn--sm" data-action="upl-edit" data-id="${r.id}" data-ctl="${esc(ctl)}">✏️ 編輯</button>` : ''}
              <button class="btn btn--secondary btn--sm" data-action="upl-download" data-id="${r.id}" data-ctl="${esc(ctl)}">⬇️ 下載</button>
              ${r.can_delete ? `<button class="btn btn--danger btn--sm" data-action="upl-remove" data-id="${r.id}" data-ctl="${esc(ctl)}">🗑 刪除</button>` : ''}
            </div>
          </div>
        </details>`;
      }).join('');
    }
    const max = Math.max(1, Math.ceil(state.total / state.pageSize));
    $('upl-page-info').textContent = `第 ${state.page} / ${max} 頁 · 共 ${state.total} 筆`;
  }

  // 從伺服器載入月級 KPI 統計；只採用本頁、最新一次請求的回應
  async function updateKPI(renderSeq) {
    const requestSeq = state.kpiGuard.next();
    if (!isCurrent(renderSeq)) return;
    let k;
    try {
      k = await apiFetch(api + '/kpi');
    } catch(e) {
      return;
    }
    if (!isCurrent(renderSeq) || !state.kpiGuard.isCurrent(requestSeq)) return;
    $('upl-kpi-month').textContent = k.month;
    $('upl-kpi-total').textContent = k.archived;
    $('upl-kpi-missing').textContent = k.missing;
    $('upl-kpi-rate').textContent = k.total > 0 ? k.rate + '%' : '—';
  }

  // 重設篩選條件為本月並重新查詢
  function resetFilter() {
    const now = new Date();
    $('upl-f-from').value = _uplIso(new Date(now.getFullYear(), now.getMonth(), 1));
    $('upl-f-to').value = _uplIso(new Date(now.getFullYear(), now.getMonth()+1, 0));
    $('upl-f-q').value = '';
    document.querySelectorAll('[data-role="upl-range"]').forEach(c => c.classList.toggle('is-active', c.dataset.range === 'month'));
    state.page = 1;
    loadHistory();
  }

  // 快捷日期範圍（今天/本週/本月/全部）
  function quickRange(k, btn) {
    document.querySelectorAll('[data-role="upl-range"]').forEach(c => c.classList.remove('is-active'));
    btn.classList.add('is-active');
    const now = new Date();
    const from = $('upl-f-from');
    const to = $('upl-f-to');
    if (k === 'today') { from.value = _uplIso(now); to.value = _uplIso(now); }
    else if (k === 'week') { const d = new Date(now); d.setDate(d.getDate()-d.getDay()); from.value = _uplIso(d); const e = new Date(d); e.setDate(e.getDate()+6); to.value = _uplIso(e); }
    else if (k === 'month') { from.value = _uplIso(new Date(now.getFullYear(), now.getMonth(), 1)); to.value = _uplIso(new Date(now.getFullYear(), now.getMonth()+1, 0)); }
    else { from.value = ''; to.value = ''; }
    state.page = 1; loadHistory();
  }

  // 翻頁（觸發重新查詢）
  function changePage(d) {
    const max = Math.max(1, Math.ceil(state.total / state.pageSize));
    const next = Math.min(max, Math.max(1, state.page + d));
    if (next === state.page) return;
    state.page = next;
    loadHistory();
  }

  // 開啟預覽 Modal（從歷史列表）
  function preview(id) {
    const report = state.reports.find(item => item.id === id);
    if (!report) return;
    const base = api + '/' + id;
    const ext = (report.file_name || '').split('.').pop().toLowerCase();
    showPreview(report.file_name, ext, base + '/preview', base + '/download');
  }

  // 依檔案類型顯示預覽（圖片/PDF/不支援格式）
  function showPreview(name, mime, previewUrl, downloadUrl) {
    const body = $('upl-preview-body');
    $('upl-preview-title').textContent = '👁 預覽 — ' + name;
    if (UPLOAD_LIST_IMAGE_EXTS.includes(mime)) body.innerHTML = '<img src="' + previewUrl + '" class="upl-preview-img">';
    else if (mime === 'pdf') {
      // 手機瀏覽器不支援 iframe 內嵌 PDF（顯示「已遭到封鎖」），改用系統閱讀器開啟；桌面維持內嵌。
      // 按鈕用 data-pdf-url + addEventListener 接線（不用 inline handler，避開多層引號轉義）。
      if (isMobileView()) {
        body.innerHTML = '<div class="upl-preview-fallback"><div class="upl-preview-icon">📄</div><div class="upl-preview-title">手機請用系統閱讀器開啟 PDF</div><button class="btn btn--primary btn--md" data-pdf-url="' + previewUrl + '">📄 開啟 PDF</button></div>';
        body.querySelector('[data-pdf-url]').addEventListener('click', function() { window.open(this.getAttribute('data-pdf-url'), '_blank'); });
      } else body.innerHTML = '<iframe src="' + previewUrl + '" class="upl-preview-frame">';
    }
    else body.innerHTML = '<div class="upl-preview-fallback upl-preview-fallback--dark"><div class="upl-preview-icon">📎</div><div class="upl-preview-name">' + esc(name) + '</div><div class="upl-preview-note">此格式不支援線上預覽</div></div>';
    $('upl-dl-btn').onclick = () => window.open(downloadUrl, '_blank');
    $('upl-overlay').classList.add('is-open');
  }

  // 關閉預覽 Modal
  function closePreview() { $('upl-overlay').classList.remove('is-open'); $('upl-preview-body').innerHTML = ''; }

  // 下載原檔
  function download(id) { window.open(api + '/' + id + '/download', '_blank'); }

  // 編輯報表日期、檔案、上傳人與備註（上傳者或全域權限者）。
  // uploader_name 是顯示文字；後端仍依原始 uploader_user_id 判斷 owner/權限。
  async function edit(id) {
    const report = state.reports.find(item => item.id === id);
    if (!report) return;
    const overlay = document.createElement('div');
    overlay.className = 'upl-overlay is-open';
    overlay.innerHTML = `
      <div class="dsr-modal upl-edit-modal" role="dialog" aria-modal="true" aria-labelledby="upl-edit-title">
        <div class="dsr-modal__hd"><h3 id="upl-edit-title">✏️ ${esc(config.editTitle)}</h3><button class="btn btn--secondary btn--sm" type="button" data-upl-edit-cancel>✕ 關閉</button></div>
        <div class="dsr-modal__bd">
          <div class="dsr-field"><label for="upl-edit-date">報表日期（YYYY-MM-DD）*</label><input id="upl-edit-date" type="date" value="${esc(report.report_date || '')}"></div>
          <div class="u-mt-12 dsr-field"><label for="upl-edit-uploader">上傳人姓名*</label><input id="upl-edit-uploader" type="text" maxlength="50" value="${esc(report.uploader_name || '')}"></div>
          <div class="u-mt-12 dsr-field"><label for="upl-edit-note">備註(選填)</label><textarea id="upl-edit-note" rows="4" maxlength="500">${esc(report.note || '')}</textarea></div>
          <div class="u-mt-12 dsr-field"><label for="upl-edit-file">替換檔案(選填)</label><input id="upl-edit-file" type="file" accept=".pdf,image/png,image/jpeg,image/gif,image/webp"></div>
          <div class="upl-hint">不選擇新檔案會保留目前檔案。</div>
        </div>
        <div class="dsr-modal__ft"><button class="btn btn--secondary btn--md" type="button" data-upl-edit-cancel>取消</button><button class="btn btn--primary btn--md" type="button" data-upl-edit-save>儲存</button></div>
      </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelectorAll('[data-upl-edit-cancel]').forEach(button => button.addEventListener('click', close));
    overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
    overlay.querySelector('[data-upl-edit-save]').addEventListener('click', async () => {
      const reportDate = overlay.querySelector('#upl-edit-date').value;
      const uploaderName = overlay.querySelector('#upl-edit-uploader').value.trim();
      // 只更新顯示名稱，不變更 uploader_user_id；權限 owner 仍是原始登入者。
      const note = overlay.querySelector('#upl-edit-note').value.trim();
      const file = overlay.querySelector('#upl-edit-file').files[0];
      if (!reportDate) return toast('⚠️ 請選擇報表日期');
      if (!uploaderName) return toast('⚠️ 請填上傳人姓名');
      if (note.length > 500) return toast('⚠️ 備註最多 500 字');
      const fd = new FormData();
      fd.append('report_date', reportDate);
      fd.append('uploader_name', uploaderName);
      fd.append('note', note);
      if (file) fd.append('file', file);
      try {
        const data = await apiFetch(api + '/' + id, { method: 'PATCH', body: fd, fallback: '報表更新失敗' });
        close();
        Object.assign(report, data);
        await loadHistory();
        toast('✅ 報表已更新');
      } catch(e) { toast(e.status ? '⚠️ ' + e.message : '⚠️ 網路錯誤：' + e.message); }
    });
  }

  // 刪除（二次確認）
  async function remove(id) {
    if (!confirm('確定刪除？')) return;
    try {
      await apiFetch(api + '/' + id, { method: 'DELETE', fallback: '刪除失敗' });
      toast('🗑 已刪除');
      loadHistory();
    } catch(e) { toast('⚠️ ' + e.message); }
  }

  const controller = {
    state, render, renderTable, showPreview, loadHistory, resetFilter, quickRange, changePage,
    clearFile, submitUpload, openPreviewFile, preview, closePreview, download, edit, remove,
  };
  uploadListControllers[ctl] = controller;
  return controller;
}

// ========== 事件委派（data-action="upl-*"；兩個上傳清單頁共用，依 data-ctl 找控制器） ==========
const uploadListControllers = {};
const controllerOf = function(el) { return uploadListControllers[el.dataset.ctl]; };
const isFileInput = function(event) { return !!(event.target && event.target.tagName === 'INPUT'); };
const clickInput = function(id) { const input = document.getElementById(id); if (input) input.click(); };

const UPLOAD_LIST_ACTIONS = {
  'upl-scroll-history': { click: function() { document.getElementById('upl-history').scrollIntoView({ behavior: 'smooth' }); } },
  // 選檔輸入框放在拖曳區裡，它自己的 click 會冒泡回拖曳區，所以目標是 input 時不再重複觸發
  'upl-pick-file': { click: function(el, event) { if (!isFileInput(event)) clickInput('upl-file-input'); } },
  'upl-pick-camera': { click: function() { clickInput('upl-camera-input'); } },
  'upl-clear-file': { click: function(el) { controllerOf(el).clearFile(); } },
  'upl-submit': { click: function(el) { controllerOf(el).submitUpload(); } },
  'upl-preview-file': { click: function(el) { controllerOf(el).openPreviewFile(); } },
  'upl-search': { click: function(el) { controllerOf(el).loadHistory(true); } },
  'upl-reset-filter': { click: function(el) { controllerOf(el).resetFilter(); } },
  'upl-range': { click: function(el) { controllerOf(el).quickRange(el.dataset.range, el); } },
  'upl-page': { click: function(el) { controllerOf(el).changePage(Number(el.dataset.delta)); } },
  'upl-close-preview': { click: function(el) { controllerOf(el).closePreview(); } },
  'upl-close-preview-backdrop': { click: function(el, event) { if (event.target === el) controllerOf(el).closePreview(); } },
  'upl-preview': { click: function(el) { controllerOf(el).preview(Number(el.dataset.id)); } },
  'upl-edit': { click: function(el) { controllerOf(el).edit(Number(el.dataset.id)); } },
  'upl-download': { click: function(el) { controllerOf(el).download(Number(el.dataset.id)); } },
  'upl-remove': { click: function(el) { controllerOf(el).remove(Number(el.dataset.id)); } },
};

const uploadListDelegate = createActionDelegate('upl-', UPLOAD_LIST_ACTIONS);

/** 測試入口：直接分派一個（模擬的）事件。 */
export const handleUploadListEvent = uploadListDelegate.handle;

export const initUploadListActions = uploadListDelegate.init;
