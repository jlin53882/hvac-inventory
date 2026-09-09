// 庫存管理系統 - 報價單上傳頁（2026-09-07 v2 對齊 demo）
// 權限：登入可查/預覽/下載；刪除：有 signed-report-delete-all 可刪全部，其餘僅刪自己的

var qupEvents = [];
var qupFiltered = [];
var qupPage = 1;
var qupPageSize = 20;
var qupTotal = 0;
var qupSelectedFile = null;

// 將 Date 物件轉為 YYYY-MM-DD 字串
function _qupIso(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// 上傳時間資料仍保留完整值，列表只顯示日期。
function _qupDateOnly(value) {
  return String(value || '').split(/[T ]/)[0];
}

// 渲染報價單上傳頁面（含上傳區、KPI、歷史查詢）
async function renderQuotationUploads() {
  const el = document.getElementById('content');
  const today = _qupIso(new Date());
  el.innerHTML = `
    <div class="qup-wrap">
      <div class="qup-page-header">
        <div class="qup-page-title">
          <h1>🗂 報價單上傳 <span class="qup-new-badge">NEW</span></h1>
          <p>位置：底部導覽「行事曆」旁新增「報表」Tab。讀取需登入，刪除見下方權限規則。</p>
        </div>
        <div class="qup-page-actions">
          <button class="qup-btn qup-btn--ghost" onclick="document.getElementById('qup-history').scrollIntoView({behavior:'smooth'})">↓ 查看歷史查詢</button>
          <button class="qup-btn qup-btn--primary" onclick="document.getElementById('qup-file-input').click()">＋ 上傳報價單</button>
        </div>
      </div>

      <div class="qup-layout">
        <!-- 左：上傳區 -->
        <section class="qup-card" aria-labelledby="qup-upload-title">
          <div class="qup-card__hd">
            <h2 id="qup-upload-title">⬆️ 上傳報價單</h2>
            <p>支援 PDF / 圖片格式 · 單檔 ≤ 20MB · 自動記錄上傳時間</p>
          </div>
          <div class="qup-card__bd">
            <div class="qup-form-grid qup-form-grid--two">
              <div class="qup-field">
                <label>上傳人姓名 <span class="qup-required">*</span></label>
                <input id="qup-uploader" type="text" placeholder="例：蘇昱豪">
              </div>
              <div class="qup-field">
                <label>報表日期（業務日期） <span class="qup-required">*</span></label>
                <input id="qup-report-date" type="date" value="${esc(today)}">
              </div>
            </div>
            <div class="qup-field" style="margin-top:12px">
              <label>備註 / 備忘（選填）</label>
              <textarea id="qup-note" rows="2" placeholder="例：今日有現場工安檢查，客戶臨時增加 2 台保養"></textarea>
            </div>
            <!-- 拖曳上傳 -->
            <div id="qup-drop" class="qup-drop" style="margin-top:12px" onclick="document.getElementById('qup-file-input').click()">
              <div class="qup-drop__icon">📎</div>
              <div class="qup-drop__title">拖曳檔案到此，或點擊選擇</div>
              <div class="qup-drop__sub">支援 PDF / PNG / JPG / GIF / WebP 格式</div>
              <div class="qup-drop__actions">
                <span class="qup-btn qup-btn--primary" onclick="document.getElementById('qup-file-input').click()">選擇檔案</span>
                <span class="qup-btn qup-btn--ghost" onclick="document.getElementById('qup-camera-input').click()">📷 相機拍攝</span>
              </div>
              <input id="qup-file-input" type="file" style="display:none" accept="image/*,.pdf">
              <input id="qup-camera-input" type="file" style="display:none" accept="image/*" capture="environment">
            </div>
            <!-- 選檔後預覽 -->
            <div id="qup-file-preview" style="display:none">
              <div class="qup-file-preview">
                <div id="qup-fp-icon" class="qup-file-preview__icon" style="background:#fee2e2">📄</div>
                <div class="qup-file-preview__meta">
                  <div id="qup-fp-name" class="qup-file-preview__name"></div>
                  <div id="qup-fp-sub" class="qup-file-preview__sub"></div>
                  <div class="qup-progress"><div id="qup-progress-bar" class="qup-progress__bar"></div></div>
                </div>
                <button class="qup-btn-sm" onclick="qupClearFile()">移除</button>
              </div>
              <div class="qup-upload-actions">
                <button class="qup-btn qup-btn--primary" onclick="qupSubmitUpload()">⬆️ 確認上傳</button>
                <button class="qup-btn qup-btn--ghost" onclick="qupOpenPreviewFile()">👁 預覽</button>
              </div>
            </div>
            <div class="qup-tags">
              <span class="qup-tag">✦ 自動寫入上傳時間</span>
              <span class="qup-tag">✦ 檔名自動 esc / 公式注入防護</span>
              <span class="qup-tag">✦ 刪除：有「全域刪除」權限者可刪全部，其餘僅能刪自己上傳的</span>
            </div>
          </div>
        </section>

        <!-- 右：說明 / KPI -->
        <aside class="qup-side">
          <div class="qup-info">
            <h3>💡 使用流程</h3>
            <ul>
              <li><span class="qup-badge">1</span> 行事曆「📤 匯出日報表」下載 xlsx → 列印簽名</li>
              <li><span class="qup-badge">2</span> 隔日掃描成 PDF/圖片 → 回到本頁拖曳上傳</li>
              <li><span class="qup-badge">3</span> 選擇「報表日期」= 簽名所屬的工作日（非上傳當天）</li>
              <li><span class="qup-badge">4</span> 歷史區以日期/關鍵字篩選，支援預覽與下載</li>
            </ul>
            <div class="qup-info-badges">
              <span class="qup-badge">🔒 登入可查</span>
              <span class="qup-badge">✏️ 自己刪自己的；有「全域刪除」權限者可刪全部</span>
              <span class="qup-badge">📱 手機可掃描直傳</span>
            </div>
          </div>
          <div class="qup-card">
            <div class="qup-card__hd"><h2>📊 本月概況</h2><p id="qup-kpi-month"></p></div>
            <div class="qup-card__bd">
              <div class="qup-kpi">
                <div class="qup-kpi__card"><div class="qup-kpi__num" id="qup-kpi-total">—</div><div class="qup-kpi__label">已歸檔</div></div>
                <div class="qup-kpi__card"><div class="qup-kpi__num" id="qup-kpi-missing">—</div><div class="qup-kpi__label">缺檔日</div></div>
                <div class="qup-kpi__card"><div class="qup-kpi__num" id="qup-kpi-rate">—</div><div class="qup-kpi__label">歸檔率</div></div>
              </div>
              <div class="qup-hint">缺檔日 = 行事曆有派工但未上傳簽名檔的日期（可一鍵跳至行事曆該日）</div>
            </div>
          </div>
        </aside>

        <!-- 歷史查詢（全寬） -->
        <section id="qup-history" class="qup-card qup-history">
          <div class="qup-card__hd">
            <div class="qup-history-heading">
              <h2>🔍 歷史報表查詢</h2>
              <p>可查單日 / 週 / 自訂區間 · 關鍵字搜尋上傳人或備註</p>
            </div>
            <div class="qup-filter-bar">
              <div class="qup-field"><label>起始日</label><input id="qup-f-from" type="date"></div>
              <div class="qup-field"><label>迄止日</label><input id="qup-f-to" type="date"></div>
              <div class="qup-field qup-field--search"><label>關鍵字（上傳人 / 備註 / 檔名）</label><input id="qup-f-q" type="text" placeholder="例：昱豪、工安"></div>
              <div class="qup-filter-actions">
                <button class="qup-btn qup-btn--primary" onclick="qupLoadHistory(true)">搜尋</button>
                <button class="qup-btn qup-btn--ghost" onclick="qupResetFilter()">清除</button>
              </div>
            </div>
            <div class="qup-chips">
              <button class="qup-chip" onclick="qupQuickRange('today',this)">今天</button>
              <button class="qup-chip" onclick="qupQuickRange('week',this)">本週</button>
              <button class="qup-chip active" onclick="qupQuickRange('month',this)">本月</button>
              <button class="qup-chip" onclick="qupQuickRange('all',this)">全部</button>
              <span class="qup-result-count"><span id="qup-result-count">0 筆</span></span>
            </div>
          </div>
          <div class="qup-card__bd" style="padding-top:0">
            <div class="qup-report-list" id="qup-tbody"></div>
            <div id="qup-empty" class="qup-empty" style="display:none">
                <div class="qup-empty__icon">🗂</div>
                <div>沒有符合條件的報表</div>
                <div class="qup-hint">試試放寬日期或關鍵字，或切換「全部」</div>
              </div>
            </div>
            <div class="qup-pagination">
              <span id="qup-page-info"></span>
              <span style="display:flex;gap:6px">
                <button class="qup-btn-sm" onclick="qupChangePage(-1)">‹ 上一頁</button>
                <button class="qup-btn-sm qup-btn-sm--primary" onclick="qupChangePage(1)">下一頁 ›</button>
              </span>
            </div>
          </div>
        </section>
      </div>
    </div>

    <!-- 預覽 Modal -->
    <div id="qup-overlay" class="qup-overlay" onclick="if(event.target===this)qupClosePreview()">
      <div class="qup-modal">
        <div class="qup-modal__hd"><h3 id="qup-preview-title">👁 預覽</h3><button class="qup-btn-sm" onclick="qupClosePreview()">✕ 關閉</button></div>
        <div class="qup-modal__bd" id="qup-preview-body"></div>
        <div class="qup-modal__ft">
          <span class="qup-modal__note">若預覽失敗，請直接下載原檔</span>
          <span class="qup-modal__actions">
            <button class="qup-btn qup-btn--ghost" onclick="qupClosePreview()">關閉</button>
            <button class="qup-btn qup-btn--primary" id="qup-dl-btn">⬇️ 下載原檔</button>
          </span>
        </div>
      </div>
    </div>`;

  // 帶入登入者姓名
  try {
    const me = await fetch('/api/auth/me').then(r => r.ok ? r.json() : null);
    if (me && me.user && me.user.display_name) document.getElementById('qup-uploader').value = me.user.display_name;
  } catch(e) {}

  // 預設日期範圍 = 本月
  const now = new Date();
  document.getElementById('qup-f-from').value = _qupIso(new Date(now.getFullYear(), now.getMonth(), 1));
  document.getElementById('qup-f-to').value = _qupIso(new Date(now.getFullYear(), now.getMonth()+1, 0));

  // 拖曳事件
  const drop = document.getElementById('qup-drop');
  ['dragenter','dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('drag'); }));
  ['dragleave','drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('drag'); }));
  drop.addEventListener('drop', e => { if (e.dataTransfer.files[0]) qupHandleFile(e.dataTransfer.files[0]); });
  document.getElementById('qup-file-input').addEventListener('change', e => { if (e.target.files[0]) qupHandleFile(e.target.files[0]); });
    document.getElementById('qup-camera-input').addEventListener('change', e => { if (e.target.files[0]) qupHandleFile(e.target.files[0]); });

  qupLoadHistory();
}

// 依副檔名回傳圖示 emoji 與背景色
function _qupIconFor(mime) {
  if (['jpg','jpeg','png','webp','heic','gif'].includes(mime)) return {icon:'🖼', bg:'#e0f2fe'};
  if (mime === 'pdf') return {icon:'📄', bg:'#fee2e2'};
  if (['docx','doc'].includes(mime)) return {icon:'📝', bg:'#dbeafe'};
  if (['xlsx','xls'].includes(mime)) return {icon:'📊', bg:'#dcfce7'};
  return {icon:'📎', bg:'#f1f5f9'};
}

// 處理使用者選擇/拖曳的檔案，更新預覽區
function qupHandleFile(f) {
  const ext = (f.name.split('.').pop() || '').toLowerCase();
  const ic = _qupIconFor(ext);
  document.getElementById('qup-fp-icon').textContent = ic.icon;
  document.getElementById('qup-fp-icon').style.background = ic.bg;
  document.getElementById('qup-fp-name').textContent = f.name;
  document.getElementById('qup-fp-sub').textContent = ext.toUpperCase() + ' · ' + (f.size/1024/1024).toFixed(1) + ' MB';
  document.getElementById('qup-file-preview').style.display = 'block';
  document.getElementById('qup-progress-bar').style.width = '0%';
  document.getElementById('qup-drop').style.display = 'none';
  qupSelectedFile = f;
}

// 清除已選檔案，恢復拖曳區
function qupClearFile() {
  document.getElementById('qup-file-preview').style.display = 'none';
  document.getElementById('qup-drop').style.display = 'block';
  document.getElementById('qup-file-input').value = '';
  qupSelectedFile = null;
}

// 預覽已選的本地檔案（上傳前）
function qupOpenPreviewFile() {
  if (!qupSelectedFile) return;
  const url = URL.createObjectURL(qupSelectedFile);
  qupShowPreview(qupSelectedFile.name, (qupSelectedFile.name.split('.').pop()||'').toLowerCase(), url, url);
}

// 上傳報價單到伺服器
async function qupSubmitUpload() {
  const file = qupSelectedFile;
  if (!file) return toast('⚠️ 請先選擇檔案');
  const uploader = document.getElementById('qup-uploader').value.trim();
  const reportDate = document.getElementById('qup-report-date').value;
  const note = document.getElementById('qup-note').value.trim();
  if (!uploader) return toast('⚠️ 請填上傳人姓名');
  if (!reportDate) return toast('⚠️ 請選擇報表日期');
  const bar = document.getElementById('qup-progress-bar');
  bar.style.width = '10%';
  const fd = new FormData();
  fd.append('file', file);
  fd.append('report_date', reportDate);
  fd.append('uploader_name', uploader);
  fd.append('note', note);
  try {
    bar.style.width = '30%';
    const res = await fetch('/api/quotation-uploads', { method: 'POST', body: fd });
    bar.style.width = '70%';
    const data = await res.json();
    if (!res.ok) return toast('⚠️ ' + (data.detail || '上傳失敗'));
    bar.style.width = '100%';
    setTimeout(() => toast('✅ 上傳成功'), 300);
    qupClearFile();
    qupLoadHistory();
  } catch(e) { toast('⚠️ 網路錯誤：' + e.message); }
}

// 載入歷史報表列表（分頁 + 篩選）
async function qupLoadHistory(resetPage) {
  if (resetPage) qupPage = 1;
  const from = document.getElementById('qup-f-from').value || '';
  const to = document.getElementById('qup-f-to').value || '';
  const q = document.getElementById('qup-f-q').value.trim();
  const p = new URLSearchParams({ from_date: from, to_date: to, q, page: qupPage, page_size: qupPageSize });
  try {
    const res = await fetch('/api/quotation-uploads?' + p);
    if (!res.ok) return;
    const data = await res.json();
    qupEvents = data.items || [];
    qupFiltered = qupEvents;
    qupTotal = data.total || 0;
    qupPage = data.page || qupPage;
    document.getElementById('qup-result-count').textContent = qupTotal + ' 筆';
    qupRenderTable();
    qupUpdateKPI();
  } catch(e) {}
}

// 渲染歷史報表表格
function qupRenderTable() {
  const tb = document.getElementById('qup-tbody');
  const empty = document.getElementById('qup-empty');
  if (!qupFiltered.length) { tb.innerHTML = ''; empty.style.display = 'block'; }
  else {
    empty.style.display = 'none';
    tb.innerHTML = qupFiltered.map(r => {
      const ext = (r.file_name || '').split('.').pop().toLowerCase();
      const ic = _qupIconFor(ext);
      const note = r.note ? esc(r.note) : '<span class="qup-note-empty">—</span>';
      const isImage = ['jpg','jpeg','png','webp','gif'].includes(ext);
      const fileVisual = isImage
        ? `<img class="qup-report-thumb" src="/api/quotation-uploads/${r.id}/preview" alt="${esc(r.file_name)}" loading="lazy" onclick="qupPreview(${r.id})" title="點擊圖片預覽">`
        : `<div class="qup-file-icon" style="background:${ic.bg}">${ic.icon}</div>`;
      return `<details class="qup-report-card">
        <summary class="qup-report-summary">
          <span class="qup-report-summary__date">${esc(r.report_date)}</span>
          <span class="qup-report-summary__uploader qup-tag">${esc(r.uploader_name)}</span>
          <span class="qup-report-summary__file">${esc(r.file_name)}</span>
        </summary>
        <div class="qup-report-detail">
          <div class="qup-report-detail__grid">
            <div><span class="qup-report-detail__label">報表日期</span><strong>${esc(r.report_date)}</strong></div>
            <div><span class="qup-report-detail__label">上傳人</span><strong>${esc(r.uploader_name)}</strong></div>
            <div><span class="qup-report-detail__label">上傳日期</span><strong>${esc(_qupDateOnly(r.upload_time))}</strong></div>
            <div class="qup-report-detail__file"><span class="qup-report-detail__label">檔案</span><div class="qup-file-cell">${fileVisual}<div style="min-width:0"><div class="qup-ellipsis" style="font-weight:700">${esc(r.file_name)}</div><div style="font-size:11px;color:#64748b">${esc((r.mime_type||'').toUpperCase())}</div></div></div></div>
            <div class="qup-report-detail__note"><span class="qup-report-detail__label">備註</span><div class="qup-note-cell">${note}</div></div>
          </div>
          <div class="qup-actions-cell">
            ${!isImage ? `<button class="qup-action-btn" onclick="qupPreview(${r.id})">👁 預覽</button>` : ''}
            ${r.can_delete ? `<button class="qup-action-btn" onclick="qupEditNote(${r.id})">✏️ 編輯</button>` : ''}
            <button class="qup-action-btn" onclick="qupDownload(${r.id})">⬇️ 下載</button>
            ${r.can_delete ? `<button class="qup-action-btn qup-action-btn--danger" onclick="qupDelete(${r.id})">🗑 刪除</button>` : ''}
          </div>
        </div>
      </details>`;
    }).join('');
  }
  const max = Math.max(1, Math.ceil(qupTotal / qupPageSize));
  document.getElementById('qup-page-info').textContent = `第 ${qupPage} / ${max} 頁 · 共 ${qupTotal} 筆`;
}

// 從伺服器載入月級 KPI 統計
async function qupUpdateKPI() {
  try {
    const res = await fetch('/api/quotation-uploads/kpi');
    if (!res.ok) return;
    const k = await res.json();
    document.getElementById('qup-kpi-month').textContent = k.month;
    document.getElementById('qup-kpi-total').textContent = k.archived;
    document.getElementById('qup-kpi-missing').textContent = k.missing;
    document.getElementById('qup-kpi-rate').textContent = k.total > 0 ? k.rate + '%' : '\u2014';
  } catch(e) {}
}

// 重設篩選條件為本月並重新查詢
function qupResetFilter() {
  const now = new Date();
  document.getElementById('qup-f-from').value = _qupIso(new Date(now.getFullYear(), now.getMonth(), 1));
  document.getElementById('qup-f-to').value = _qupIso(new Date(now.getFullYear(), now.getMonth()+1, 0));
  document.getElementById('qup-f-q').value = '';
  document.querySelectorAll('.qup-chip').forEach(c => c.classList.remove('active'));
  document.querySelectorAll('.qup-chip')[2].classList.add('active');
  qupPage = 1;
  qupLoadHistory();
}

// 快捷日期範圍（今天/本週/本月/全部）
function qupQuickRange(k, btn) {
  document.querySelectorAll('.qup-chip').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  const now = new Date();
  if (k === 'today') { document.getElementById('qup-f-from').value = _qupIso(now); document.getElementById('qup-f-to').value = _qupIso(now); }
  else if (k === 'week') { const d = new Date(now); d.setDate(d.getDate()-d.getDay()); document.getElementById('qup-f-from').value = _qupIso(d); const e = new Date(d); e.setDate(e.getDate()+6); document.getElementById('qup-f-to').value = _qupIso(e); }
  else if (k === 'month') { document.getElementById('qup-f-from').value = _qupIso(new Date(now.getFullYear(), now.getMonth(), 1)); document.getElementById('qup-f-to').value = _qupIso(new Date(now.getFullYear(), now.getMonth()+1, 0)); }
  else { document.getElementById('qup-f-from').value = ''; document.getElementById('qup-f-to').value = ''; }
  qupPage = 1; qupLoadHistory();
}

// 翻頁（觸發重新查詢）
function qupChangePage(d) {
  const max = Math.max(1, Math.ceil(qupTotal / qupPageSize));
  const next = Math.min(max, Math.max(1, qupPage + d));
  if (next === qupPage) return;
  qupPage = next;
  qupLoadHistory();
}

// 開啟預覽 Modal（從歷史列表）
function qupPreview(id) {
  const report = qupFiltered.find(item => item.id === id);
  if (!report) return;
  const base = '/api/quotation-uploads/' + id;
  const ext = (report.file_name || '').split('.').pop().toLowerCase();
  qupShowPreview(report.file_name, ext, base + '/preview', base + '/download');
}
// 依檔案類型顯示預覽（圖片/PDF/不支援格式）
function qupShowPreview(name, mime, previewUrl, downloadUrl) {
  const body = document.getElementById('qup-preview-body');
  document.getElementById('qup-preview-title').textContent = '👁 預覽 — ' + name;
  if (['jpg','jpeg','png','webp','gif'].includes(mime)) body.innerHTML = '<img src="' + previewUrl + '" style="width:100%">';
  else if (mime === 'pdf') body.innerHTML = '<iframe src="' + previewUrl + '" style="width:100%;height:72vh;border:0">';
  else body.innerHTML = '<div style="padding:32px;text-align:center;color:#e2e8f0"><div style="font-size:32px">📎</div><div style="margin-top:8px;font-weight:800">' + esc(name) + '</div><div style="font-size:12px;color:#94a3b8;margin-top:6px">此格式不支援線上預覽</div></div>';
  document.getElementById('qup-dl-btn').onclick = () => window.open(downloadUrl, '_blank');
  document.getElementById('qup-overlay').classList.add('open');
}
// 關閉預覽 Modal
function qupClosePreview() { document.getElementById('qup-overlay').classList.remove('open'); document.getElementById('qup-preview-body').innerHTML = ''; }
// 下載簽名報表原檔
function qupDownload(id) { window.open('/api/quotation-uploads/' + id + '/download', '_blank'); }
// 編輯報表備註（上傳者或全域權限者）
async function qupEditNote(id) {
  const report = qupFiltered.find(item => item.id === id);
  if (!report) return;
  const reportDate = prompt('編輯報表日期（YYYY-MM-DD）', report.report_date || '');
  if (reportDate === null) return;
  const uploaderName = prompt('編輯上傳人姓名（1-50 字）', report.uploader_name || '');
  if (uploaderName === null) return;
  const note = prompt('編輯備註（最多 500 字）', report.note || '');
  if (note === null) return;
  if (note.length > 500) return toast('⚠️ 備註最多 500 字');
  const res = await fetch('/api/quotation-uploads/' + id, {
    method: 'PATCH',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({report_date: reportDate, uploader_name: uploaderName, note})
  });
  const data = await res.json();
  if (!res.ok) return toast('⚠️ ' + (data.detail || '備註更新失敗'));
  report.report_date = data.report_date;
  report.uploader_name = data.uploader_name;
  report.note = data.note;
  qupRenderTable();
  toast('✅ 備註已更新');
}

// 刪除簽名報表（二次確認）
async function qupDelete(id) {
  if (!confirm('確定刪除？')) return;
  const res = await fetch('/api/quotation-uploads/' + id, { method: 'DELETE' });
  const data = await res.json();
  if (res.ok) { toast('🗑 已刪除'); qupLoadHistory(); } else toast('⚠️ ' + (data.detail || '刪除失敗'));
}
