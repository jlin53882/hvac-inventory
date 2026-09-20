// 庫存管理系統 - 每日簽名報表頁（2026-09-07 v2 對齊 demo）
// 權限：登入可查/預覽/下載；刪除：有 signed-report-delete-all 可刪全部，其餘僅刪自己的

var dsrEvents = [];
var dsrFiltered = [];
var dsrPage = 1;
var dsrPageSize = 20;
var dsrTotal = 0;
var dsrSelectedFile = null;

// 將 Date 物件轉為 YYYY-MM-DD 字串
function _dsrIso(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// 上傳時間資料仍保留完整值，列表只顯示日期。
function _dsrDateOnly(value) {
  return String(value || '').split(/[T ]/)[0];
}

// 渲染每日簽名報表頁面（含上傳區、KPI、歷史查詢）
async function renderSignedReports() {
  const el = document.getElementById('content');
  const today = _dsrIso(new Date());
  el.innerHTML = `
    <div class="dsr-wrap">
      <div class="dsr-page-header">
        <div class="dsr-page-title">
          <h1>🗂 每日簽名報表 <span class="dsr-new-badge">NEW</span></h1>
          <p>位置：底部導覽「行事曆」旁新增「報表」Tab。讀取需登入，刪除見下方權限規則。</p>
        </div>
        <div class="dsr-page-actions">
          <button class="dsr-btn dsr-btn--ghost" onclick="document.getElementById('dsr-history').scrollIntoView({behavior:'smooth'})">↓ 查看歷史查詢</button>
          <button hidden data-signed-upload class="dsr-btn dsr-btn--primary" onclick="document.getElementById('dsr-file-input').click()">＋ 上傳每日簽名日報表</button>
        </div>
      </div>

      <div class="dsr-layout">
        <!-- 左：上傳區 -->
        <section hidden data-signed-upload class="dsr-card" aria-labelledby="dsr-upload-title">
          <div class="dsr-card__hd">
            <h2 id="dsr-upload-title">⬆️ 上傳每日簽名日報表</h2>
            <p>支援 PDF / 圖片格式 · 單檔 ≤ 20MB · 自動記錄上傳時間</p>
          </div>
          <div class="dsr-card__bd">
            <div class="dsr-form-grid dsr-form-grid--two">
              <div class="dsr-field">
                <label>上傳人姓名 <span class="dsr-required">*</span></label>
                <input id="dsr-uploader" type="text" placeholder="例：蘇昱豪">
              </div>
              <div class="dsr-field">
                <label>報表日期（業務日期） <span class="dsr-required">*</span></label>
                <input id="dsr-report-date" type="date" value="${esc(today)}">
              </div>
            </div>
            <div class="dsr-field" style="margin-top:12px">
              <label>備註 / 備忘（選填）</label>
              <textarea id="dsr-note" rows="2" placeholder="例：今日有現場工安檢查，客戶臨時增加 2 台保養"></textarea>
            </div>
            <!-- 拖曳上傳 -->
            <div id="dsr-drop" class="dsr-drop" style="margin-top:12px" onclick="document.getElementById('dsr-file-input').click()">
              <div class="dsr-drop__icon">📎</div>
              <div class="dsr-drop__title">拖曳檔案到此，或點擊選擇</div>
              <div class="dsr-drop__sub">支援 PDF / PNG / JPG / GIF / WebP 格式</div>
              <div class="dsr-drop__actions">
                <span class="dsr-btn dsr-btn--primary" onclick="document.getElementById('dsr-file-input').click()">選擇檔案</span>
                <span class="dsr-btn dsr-btn--ghost" onclick="document.getElementById('dsr-camera-input').click()">📷 相機拍攝</span>
              </div>
              <input id="dsr-file-input" type="file" style="display:none" accept="image/*,.pdf">
              <input id="dsr-camera-input" type="file" style="display:none" accept="image/*" capture="environment">
            </div>
            <!-- 選檔後預覽 -->
            <div id="dsr-file-preview" style="display:none">
              <div class="dsr-file-preview">
                <div id="dsr-fp-icon" class="dsr-file-preview__icon" style="background:#fee2e2">📄</div>
                <div class="dsr-file-preview__meta">
                  <div id="dsr-fp-name" class="dsr-file-preview__name"></div>
                  <div id="dsr-fp-sub" class="dsr-file-preview__sub"></div>
                  <div class="dsr-progress"><div id="dsr-progress-bar" class="dsr-progress__bar"></div></div>
                </div>
                <button class="dsr-btn-sm" onclick="dsrClearFile()">移除</button>
              </div>
              <div class="dsr-upload-actions">
                <button class="dsr-btn dsr-btn--primary" onclick="dsrSubmitUpload()">⬆️ 確認上傳</button>
                <button class="dsr-btn dsr-btn--ghost" onclick="dsrOpenPreviewFile()">👁 預覽</button>
              </div>
            </div>
            <div class="dsr-tags">
              <span class="dsr-tag">✦ 自動寫入上傳時間</span>
              <span class="dsr-tag">✦ 檔名自動 esc / 公式注入防護</span>
              <span class="dsr-tag">✦ 刪除：有「全域刪除」權限者可刪全部，其餘僅能刪自己上傳的</span>
            </div>
          </div>
        </section>

        <!-- 右：說明 / KPI -->
        <aside class="dsr-side">
          <div class="dsr-info">
            <h3>💡 使用流程</h3>
            <ul>
              <li><span class="dsr-badge">1</span> 行事曆「📤 匯出日報表」下載 xlsx → 列印簽名</li>
              <li><span class="dsr-badge">2</span> 隔日掃描成 PDF/圖片 → 回到本頁拖曳上傳</li>
              <li><span class="dsr-badge">3</span> 選擇「報表日期」= 簽名所屬的工作日（非上傳當天）</li>
              <li><span class="dsr-badge">4</span> 歷史區以日期/關鍵字篩選，支援預覽與下載</li>
            </ul>
            <div class="dsr-info-badges">
              <span class="dsr-badge">🔒 登入可查</span>
              <span class="dsr-badge">✏️ 自己刪自己的；有「全域刪除」權限者可刪全部</span>
              <span class="dsr-badge">📱 手機可掃描直傳</span>
            </div>
          </div>
          <div class="dsr-card">
            <div class="dsr-card__hd"><h2>📊 本月概況</h2><p id="dsr-kpi-month"></p></div>
            <div class="dsr-card__bd">
              <div class="dsr-kpi ui-kpi-grid ui-kpi-grid--compact">
                <div class="dsr-kpi__card ui-kpi-card ui-kpi-card--blue ui-kpi-card--compact"><span class="ui-kpi-icon" aria-hidden="true">🗂</span><div class="ui-kpi-body"><div class="dsr-kpi__label ui-kpi-label">已歸檔</div><div class="dsr-kpi__num ui-kpi-value" id="dsr-kpi-total">—</div><span class="ui-kpi-meta">本月</span></div></div>
                <div class="dsr-kpi__card ui-kpi-card ui-kpi-card--amber ui-kpi-card--compact"><span class="ui-kpi-icon" aria-hidden="true">⚠</span><div class="ui-kpi-body"><div class="dsr-kpi__label ui-kpi-label">缺檔日</div><div class="dsr-kpi__num ui-kpi-value" id="dsr-kpi-missing">—</div><span class="ui-kpi-meta">本月</span></div></div>
                <div class="dsr-kpi__card ui-kpi-card ui-kpi-card--green ui-kpi-card--compact"><span class="ui-kpi-icon" aria-hidden="true">📈</span><div class="ui-kpi-body"><div class="dsr-kpi__label ui-kpi-label">歸檔率</div><div class="dsr-kpi__num ui-kpi-value" id="dsr-kpi-rate">—</div><span class="ui-kpi-meta">本月</span></div></div>
              </div>
              <div class="dsr-hint">缺檔日 = 行事曆有派工但未上傳簽名檔的日期（可一鍵跳至行事曆該日）</div>
            </div>
          </div>
        </aside>

        <!-- 歷史查詢（全寬） -->
        <section id="dsr-history" class="dsr-card dsr-history">
          <div class="dsr-card__hd">
            <div class="dsr-history-heading">
              <h2>🔍 歷史報表查詢</h2>
              <p>可查單日 / 週 / 自訂區間 · 關鍵字搜尋上傳人或備註</p>
            </div>
            <div class="dsr-filter-bar">
              <div class="dsr-field"><label>起始日</label><input id="dsr-f-from" type="date"></div>
              <div class="dsr-field"><label>迄止日</label><input id="dsr-f-to" type="date"></div>
              <div class="dsr-field dsr-field--search"><label>關鍵字（上傳人 / 備註 / 檔名）</label><input id="dsr-f-q" type="text" placeholder="例：昱豪、工安"></div>
              <div class="dsr-filter-actions">
                <button class="dsr-btn dsr-btn--primary" onclick="dsrLoadHistory(true)">搜尋</button>
                <button class="dsr-btn dsr-btn--ghost" onclick="dsrResetFilter()">清除</button>
              </div>
            </div>
            <div class="dsr-chips">
              <button class="dsr-chip" onclick="dsrQuickRange('today',this)">今天</button>
              <button class="dsr-chip" onclick="dsrQuickRange('week',this)">本週</button>
              <button class="dsr-chip active" onclick="dsrQuickRange('month',this)">本月</button>
              <button class="dsr-chip" onclick="dsrQuickRange('all',this)">全部</button>
              <span class="dsr-result-count"><span id="dsr-result-count">0 筆</span></span>
            </div>
          </div>
          <div class="dsr-card__bd" style="padding-top:0">
            <div class="dsr-report-list" id="dsr-tbody"></div>
            <div id="dsr-empty" class="dsr-empty" style="display:none">
                <div class="dsr-empty__icon">🗂</div>
                <div>沒有符合條件的報表</div>
                <div class="dsr-hint">試試放寬日期或關鍵字，或切換「全部」</div>
              </div>
            </div>
            <div class="dsr-pagination">
              <span id="dsr-page-info"></span>
              <span style="display:flex;gap:6px">
                <button class="dsr-btn-sm" onclick="dsrChangePage(-1)">‹ 上一頁</button>
                <button class="dsr-btn-sm dsr-btn-sm--primary" onclick="dsrChangePage(1)">下一頁 ›</button>
              </span>
            </div>
          </div>
        </section>
      </div>
    </div>

    <!-- 預覽 Modal -->
    <div id="dsr-overlay" class="dsr-overlay" onclick="if(event.target===this)dsrClosePreview()">
      <div class="dsr-modal">
        <div class="dsr-modal__hd"><h3 id="dsr-preview-title">👁 預覽</h3><button class="dsr-btn-sm" onclick="dsrClosePreview()">✕ 關閉</button></div>
        <div class="dsr-modal__bd" id="dsr-preview-body"></div>
        <div class="dsr-modal__ft">
          <span class="dsr-modal__note">若預覽失敗，請直接下載原檔</span>
          <span class="dsr-modal__actions">
            <button class="dsr-btn dsr-btn--ghost" onclick="dsrClosePreview()">關閉</button>
            <button class="dsr-btn dsr-btn--primary" id="dsr-dl-btn">⬇️ 下載原檔</button>
          </span>
        </div>
      </div>
    </div>`;

  // 帶入登入者姓名
  try {
    const me = await fetch('/api/auth/me').then(r => r.ok ? r.json() : null);
    const canUpload = !!(me && me.user && me.user.permissions && me.user.permissions['signed-report-upload']);
    document.querySelectorAll('[data-signed-upload]').forEach(node => { node.hidden = !canUpload; });
    if (canUpload && me.user.display_name) document.getElementById('dsr-uploader').value = me.user.display_name;
  } catch(e) {}

  // 預設日期範圍 = 本月
  const now = new Date();
  document.getElementById('dsr-f-from').value = _dsrIso(new Date(now.getFullYear(), now.getMonth(), 1));
  document.getElementById('dsr-f-to').value = _dsrIso(new Date(now.getFullYear(), now.getMonth()+1, 0));

  // 拖曳事件
  const drop = document.getElementById('dsr-drop');
  ['dragenter','dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('drag'); }));
  ['dragleave','drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('drag'); }));
  drop.addEventListener('drop', e => { if (e.dataTransfer.files[0]) dsrHandleFile(e.dataTransfer.files[0]); });
  document.getElementById('dsr-file-input').addEventListener('change', e => { if (e.target.files[0]) dsrHandleFile(e.target.files[0]); });
    document.getElementById('dsr-camera-input').addEventListener('change', e => { if (e.target.files[0]) dsrHandleFile(e.target.files[0]); });

  dsrLoadHistory();
}

// 依副檔名回傳圖示 emoji 與背景色
function _dsrIconFor(mime) {
  if (['jpg','jpeg','png','webp','heic','gif'].includes(mime)) return {icon:'🖼', bg:'#e0f2fe'};
  if (mime === 'pdf') return {icon:'📄', bg:'#fee2e2'};
  if (['docx','doc'].includes(mime)) return {icon:'📝', bg:'#dbeafe'};
  if (['xlsx','xls'].includes(mime)) return {icon:'📊', bg:'#dcfce7'};
  return {icon:'📎', bg:'#f1f5f9'};
}

// 處理使用者選擇/拖曳的檔案，更新預覽區
function dsrHandleFile(f) {
  const ext = (f.name.split('.').pop() || '').toLowerCase();
  const ic = _dsrIconFor(ext);
  document.getElementById('dsr-fp-icon').textContent = ic.icon;
  document.getElementById('dsr-fp-icon').style.background = ic.bg;
  document.getElementById('dsr-fp-name').textContent = f.name;
  document.getElementById('dsr-fp-sub').textContent = ext.toUpperCase() + ' · ' + (f.size/1024/1024).toFixed(1) + ' MB';
  document.getElementById('dsr-file-preview').style.display = 'block';
  document.getElementById('dsr-progress-bar').style.width = '0%';
  document.getElementById('dsr-drop').style.display = 'none';
  dsrSelectedFile = f;
}

// 清除已選檔案，恢復拖曳區
function dsrClearFile() {
  document.getElementById('dsr-file-preview').style.display = 'none';
  document.getElementById('dsr-drop').style.display = 'block';
  document.getElementById('dsr-file-input').value = '';
  dsrSelectedFile = null;
}

// 上傳成功後清除欄位數值，保留表單、歷史表格與上傳人姓名。
function dsrKeepUploaderOnly() {
  const dateField = document.getElementById('dsr-report-date');
  const noteField = document.getElementById('dsr-note');
  const fileField = document.getElementById('dsr-file-input');
  const cameraField = document.getElementById('dsr-camera-input');
  if (dateField) dateField.value = _dsrIso(new Date());
  if (noteField) noteField.value = '';
  if (fileField) fileField.value = '';
  if (cameraField) cameraField.value = '';
  dsrSelectedFile = null;
  const drop = document.getElementById('dsr-drop');
  const preview = document.getElementById('dsr-file-preview');
  if (drop) drop.style.display = 'block';
  if (preview) preview.style.display = 'none';
}

// 預覽已選的本地檔案（上傳前）
function dsrOpenPreviewFile() {
  if (!dsrSelectedFile) return;
  const url = URL.createObjectURL(dsrSelectedFile);
  dsrShowPreview(dsrSelectedFile.name, (dsrSelectedFile.name.split('.').pop()||'').toLowerCase(), url, url);
}

// 上傳每日簽名日報表到伺服器
async function dsrSubmitUpload() {
  const file = dsrSelectedFile;
  if (!file) return toast('⚠️ 請先選擇檔案');
  const uploader = document.getElementById('dsr-uploader').value.trim();
  const reportDate = document.getElementById('dsr-report-date').value;
  const note = document.getElementById('dsr-note').value.trim();
  if (!uploader) return toast('⚠️ 請填上傳人姓名');
  if (!reportDate) return toast('⚠️ 請選擇報表日期');
  const bar = document.getElementById('dsr-progress-bar');
  bar.style.width = '10%';
  const fd = new FormData();
  fd.append('file', file);
  fd.append('report_date', reportDate);
  fd.append('uploader_name', uploader);
  fd.append('note', note);
  try {
    bar.style.width = '30%';
    const res = await fetch('/api/signed-reports', { method: 'POST', body: fd });
    bar.style.width = '70%';
    const data = await res.json();
    if (!res.ok) return toast('⚠️ ' + (data.detail || '上傳失敗'));
    bar.style.width = '100%';
    setTimeout(() => toast('✅ 上傳成功'), 300);
    dsrClearFile();
    dsrKeepUploaderOnly();
    dsrLoadHistory();
  } catch(e) { toast('⚠️ 網路錯誤：' + e.message); }
}

// 載入歷史報表列表（分頁 + 篩選）
async function dsrLoadHistory(resetPage) {
  if (resetPage) dsrPage = 1;
  const from = document.getElementById('dsr-f-from').value || '';
  const to = document.getElementById('dsr-f-to').value || '';
  const q = document.getElementById('dsr-f-q').value.trim();
  const p = new URLSearchParams({ from_date: from, to_date: to, q, page: dsrPage, page_size: dsrPageSize });
  try {
    const res = await fetch('/api/signed-reports?' + p);
    if (!res.ok) return;
    const data = await res.json();
    dsrEvents = data.items || [];
    dsrFiltered = dsrEvents;
    dsrTotal = data.total || 0;
    dsrPage = data.page || dsrPage;
    document.getElementById('dsr-result-count').textContent = dsrTotal + ' 筆';
    dsrRenderTable();
    dsrUpdateKPI();
  } catch(e) {}
}

// 渲染歷史報表表格
function dsrRenderTable() {
  const tb = document.getElementById('dsr-tbody');
  const empty = document.getElementById('dsr-empty');
  if (!dsrFiltered.length) { tb.innerHTML = ''; empty.style.display = 'block'; }
  else {
    empty.style.display = 'none';
    tb.innerHTML = dsrFiltered.map(r => {
      const ext = (r.file_name || '').split('.').pop().toLowerCase();
      const ic = _dsrIconFor(ext);
      const note = r.note ? esc(r.note) : '<span class="dsr-note-empty">—</span>';
      const isImage = ['jpg','jpeg','png','webp','gif'].includes(ext);
      const fileVisual = isImage
        ? `<img class="dsr-report-thumb" src="/api/signed-reports/${r.id}/preview" alt="${esc(r.file_name)}" loading="lazy" onclick="dsrPreview(${r.id})" title="點擊圖片預覽">`
        : `<div class="dsr-file-icon" style="background:${ic.bg}">${ic.icon}</div>`;
      return `<details class="dsr-report-card">
        <summary class="dsr-report-summary">
          <span class="dsr-report-summary__date">${esc(r.report_date)}</span>
          <span class="dsr-report-summary__uploader dsr-tag">${esc(r.uploader_name)}</span>
          <span class="dsr-report-summary__file">${esc(r.file_name)}</span>
        </summary>
        <div class="dsr-report-detail">
          <div class="dsr-report-detail__grid">
            <div><span class="dsr-report-detail__label">報表日期</span><strong>${esc(r.report_date)}</strong></div>
            <div><span class="dsr-report-detail__label">上傳人</span><strong>${esc(r.uploader_name)}</strong></div>
            <div><span class="dsr-report-detail__label">上傳日期</span><strong>${esc(_dsrDateOnly(r.upload_time))}</strong></div>
            <div class="dsr-report-detail__file"><span class="dsr-report-detail__label">檔案</span><div class="dsr-file-cell">${fileVisual}<div style="min-width:0"><div class="dsr-ellipsis" style="font-weight:700">${esc(r.file_name)}</div><div style="font-size:11px;color:#64748b">${esc((r.mime_type||'').toUpperCase())}</div></div></div></div>
            <div class="dsr-report-detail__note"><span class="dsr-report-detail__label">備註</span><div class="dsr-note-cell">${note}</div></div>
          </div>
          <div class="dsr-actions-cell">
            ${!isImage ? `<button class="dsr-action-btn" onclick="dsrPreview(${r.id})">👁 預覽</button>` : ''}
            ${r.can_delete ? `<button class="dsr-action-btn" onclick="dsrEdit(${r.id})">✏️ 編輯</button>` : ''}
            <button class="dsr-action-btn" onclick="dsrDownload(${r.id})">⬇️ 下載</button>
            ${r.can_delete ? `<button class="dsr-action-btn dsr-action-btn--danger" onclick="dsrDelete(${r.id})">🗑 刪除</button>` : ''}
          </div>
        </div>
      </details>`;
    }).join('');
  }
  const max = Math.max(1, Math.ceil(dsrTotal / dsrPageSize));
  document.getElementById('dsr-page-info').textContent = `第 ${dsrPage} / ${max} 頁 · 共 ${dsrTotal} 筆`;
}

// 從伺服器載入月級 KPI 統計
async function dsrUpdateKPI() {
  try {
    const res = await fetch('/api/signed-reports/kpi');
    if (!res.ok) return;
    const k = await res.json();
    document.getElementById('dsr-kpi-month').textContent = k.month;
    document.getElementById('dsr-kpi-total').textContent = k.archived;
    document.getElementById('dsr-kpi-missing').textContent = k.missing;
    document.getElementById('dsr-kpi-rate').textContent = k.total > 0 ? k.rate + '%' : '\u2014';
  } catch(e) {}
}

// 重設篩選條件為本月並重新查詢
function dsrResetFilter() {
  const now = new Date();
  document.getElementById('dsr-f-from').value = _dsrIso(new Date(now.getFullYear(), now.getMonth(), 1));
  document.getElementById('dsr-f-to').value = _dsrIso(new Date(now.getFullYear(), now.getMonth()+1, 0));
  document.getElementById('dsr-f-q').value = '';
  document.querySelectorAll('.dsr-chip').forEach(c => c.classList.remove('active'));
  document.querySelectorAll('.dsr-chip')[2].classList.add('active');
  dsrPage = 1;
  dsrLoadHistory();
}

// 快捷日期範圍（今天/本週/本月/全部）
function dsrQuickRange(k, btn) {
  document.querySelectorAll('.dsr-chip').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  const now = new Date();
  if (k === 'today') { document.getElementById('dsr-f-from').value = _dsrIso(now); document.getElementById('dsr-f-to').value = _dsrIso(now); }
  else if (k === 'week') { const d = new Date(now); d.setDate(d.getDate()-d.getDay()); document.getElementById('dsr-f-from').value = _dsrIso(d); const e = new Date(d); e.setDate(e.getDate()+6); document.getElementById('dsr-f-to').value = _dsrIso(e); }
  else if (k === 'month') { document.getElementById('dsr-f-from').value = _dsrIso(new Date(now.getFullYear(), now.getMonth(), 1)); document.getElementById('dsr-f-to').value = _dsrIso(new Date(now.getFullYear(), now.getMonth()+1, 0)); }
  else { document.getElementById('dsr-f-from').value = ''; document.getElementById('dsr-f-to').value = ''; }
  dsrPage = 1; dsrLoadHistory();
}

// 翻頁（觸發重新查詢）
function dsrChangePage(d) {
  const max = Math.max(1, Math.ceil(dsrTotal / dsrPageSize));
  const next = Math.min(max, Math.max(1, dsrPage + d));
  if (next === dsrPage) return;
  dsrPage = next;
  dsrLoadHistory();
}

// 開啟預覽 Modal（從歷史列表）
function dsrPreview(id) {
  const report = dsrFiltered.find(item => item.id === id);
  if (!report) return;
  const base = '/api/signed-reports/' + id;
  const ext = (report.file_name || '').split('.').pop().toLowerCase();
  dsrShowPreview(report.file_name, ext, base + '/preview', base + '/download');
}
// 依檔案類型顯示預覽（圖片/PDF/不支援格式）
function dsrShowPreview(name, mime, previewUrl, downloadUrl) {
  const body = document.getElementById('dsr-preview-body');
  document.getElementById('dsr-preview-title').textContent = '👁 預覽 — ' + name;
  if (['jpg','jpeg','png','webp','gif'].includes(mime)) body.innerHTML = '<img src="' + previewUrl + '" style="width:100%">';
  else if (mime === 'pdf') {
    // 手機瀏覽器不支援 iframe 內嵌 PDF（顯示「已遭到封鎖」），改用系統閱讀器開啟；桌面維持內嵌。
    // 按鈕用 data-pdf-url + addEventListener 接線（不用 inline handler，避開多層引號轉義）。
    if (typeof isMobileView === 'function' && isMobileView()) {
      body.innerHTML = '<div style="padding:32px;text-align:center"><div style="font-size:32px">📄</div><div style="margin:12px 0 16px;font-weight:800">手機請用系統閱讀器開啟 PDF</div><button class="dsr-btn dsr-btn--primary" data-pdf-url="' + previewUrl + '">📄 開啟 PDF</button></div>';
      body.querySelector('[data-pdf-url]').addEventListener('click', function() { window.open(this.getAttribute('data-pdf-url'), '_blank'); });
    } else body.innerHTML = '<iframe src="' + previewUrl + '" style="width:100%;height:72vh;border:0">';
  }
  else body.innerHTML = '<div style="padding:32px;text-align:center;color:#e2e8f0"><div style="font-size:32px">📎</div><div style="margin-top:8px;font-weight:800">' + esc(name) + '</div><div style="font-size:12px;color:#94a3b8;margin-top:6px">此格式不支援線上預覽</div></div>';
  document.getElementById('dsr-dl-btn').onclick = () => window.open(downloadUrl, '_blank');
  document.getElementById('dsr-overlay').classList.add('open');
}
// 關閉預覽 Modal
function dsrClosePreview() { document.getElementById('dsr-overlay').classList.remove('open'); document.getElementById('dsr-preview-body').innerHTML = ''; }
// 下載簽名報表原檔
function dsrDownload(id) { window.open('/api/signed-reports/' + id + '/download', '_blank'); }
// 編輯報表日期、檔案、上傳人與備註（上傳者或全域權限者）。
// uploader_name 是顯示文字；後端仍依原始 uploader_user_id 判斷 owner/權限。
async function dsrEdit(id) {
  const report = dsrFiltered.find(item => item.id === id);
  if (!report) return;
  const overlay = document.createElement('div');
  overlay.className = 'dsr-overlay open';
  overlay.innerHTML = `
    <div class="dsr-modal dsr-edit-modal" role="dialog" aria-modal="true" aria-labelledby="dsr-edit-title">
      <div class="dsr-modal__hd"><h3 id="dsr-edit-title">✏️ 編輯每日簽名日報表</h3><button class="dsr-btn-sm" type="button" data-dsr-edit-cancel>✕ 關閉</button></div>
      <div class="dsr-modal__bd">
        <div class="dsr-field"><label for="dsr-edit-date">報表日期（YYYY-MM-DD）</label><input id="dsr-edit-date" type="date" value="${esc(report.report_date || '')}"></div>
        <div class="dsr-field" style="margin-top:12px"><label for="dsr-edit-uploader">上傳人姓名</label><input id="dsr-edit-uploader" type="text" maxlength="50" value="${esc(report.uploader_name || '')}"></div>
        <div class="dsr-field" style="margin-top:12px"><label for="dsr-edit-note">備註</label><textarea id="dsr-edit-note" rows="4" maxlength="500">${esc(report.note || '')}</textarea></div>
        <div class="dsr-field" style="margin-top:12px"><label for="dsr-edit-file">替換檔案（選填）</label><input id="dsr-edit-file" type="file" accept=".pdf,image/png,image/jpeg,image/gif,image/webp"></div>
        <div class="dsr-hint">不選擇新檔案會保留目前檔案。</div>
      </div>
      <div class="dsr-modal__ft"><button class="dsr-btn dsr-btn--ghost" type="button" data-dsr-edit-cancel>取消</button><button class="dsr-btn dsr-btn--primary" type="button" data-dsr-edit-save>儲存</button></div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelectorAll('[data-dsr-edit-cancel]').forEach(button => button.addEventListener('click', close));
  overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
  overlay.querySelector('[data-dsr-edit-save]').addEventListener('click', async () => {
    const reportDate = overlay.querySelector('#dsr-edit-date').value;
    const uploaderName = overlay.querySelector('#dsr-edit-uploader').value.trim();
    // 只更新顯示名稱，不變更 uploader_user_id；權限 owner 仍是原始登入者。
    const note = overlay.querySelector('#dsr-edit-note').value.trim();
    const file = overlay.querySelector('#dsr-edit-file').files[0];
    if (!reportDate) return toast('⚠️ 請選擇報表日期');
    if (!uploaderName) return toast('⚠️ 請填上傳人姓名');
    if (note.length > 500) return toast('⚠️ 備註最多 500 字');
    const fd = new FormData();
    fd.append('report_date', reportDate);
    fd.append('uploader_name', uploaderName);
    fd.append('note', note);
    if (file) fd.append('file', file);
    try {
      const res = await fetch('/api/signed-reports/' + id, { method: 'PATCH', body: fd });
      const data = await res.json();
      if (!res.ok) return toast('⚠️ ' + (data.detail || '報表更新失敗'));
      close();
      Object.assign(report, data);
      await dsrLoadHistory();
      toast('✅ 報表已更新');
    } catch(e) { toast('⚠️ 網路錯誤：' + e.message); }
  });
}

// 刪除簽名報表（二次確認）
async function dsrDelete(id) {
  if (!confirm('確定刪除？')) return;
  const res = await fetch('/api/signed-reports/' + id, { method: 'DELETE' });
  const data = await res.json();
  if (res.ok) { toast('🗑 已刪除'); dsrLoadHistory(); } else toast('⚠️ ' + (data.detail || '刪除失敗'));
}
