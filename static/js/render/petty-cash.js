// 庫存管理系統 - 零用金月報頁（2026-09-12，沿每日簽名日報表架構）
// 權限：登入可查/建；編輯/刪除限本人或具 petty-cash-delete-all 者

var pcReports = [];
var pcPage = 1;
var pcPageSize = 20;
var pcTotal = 0;
var pcPersons = [];
var pcDetail = null;

// 將 Date 物件轉為 YYYY-MM-DD 字串
function _pcIso(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// YYYY-MM-DD → YYYY/MM/DD（畫面顯示用）
function _pcDate(s) {
  return String(s || '').replace(/-/g, '/');
}

// YYYY-MM-DD → MM/DD（檔名/標題用）
function _pcMD(s) {
  var p = String(s || '').split('-');
  return p.length === 3 ? p[1] + '/' + p[2] : String(s || '');
}

// 金額千分位（純數字格式化，不可控）
function _pcMoney(v) {
  var n = Number(v);
  if (!isFinite(n)) return '0';
  return Math.round(n * 100) / 100 .toLocaleString('en-US');
}

// 報表期間文字（起～迄）
function _pcPeriodText(r) {
  return esc(_pcDate(r.start_date)) + '～' + esc(_pcDate(r.end_date));
}

// UI 顯示檔名：零用金-資材08/26~09/25（斜線僅顯示用）
function _pcFileLabel(r) {
  return esc('零用金-' + (r.filename_text || '') + _pcMD(r.start_date) + '~' + _pcMD(r.end_date));
}

// 狀態徽章（固定映射輸出，使用者輸入只決定分支）
function pcStatusBadge(status) {
  return status === 'completed'
    ? '<span class="pc-status pc-status--completed">已完成</span>'
    : '<span class="pc-status pc-status--draft">草稿</span>';
}

// 渲染零用金月報首頁（含 KPI、篩選、列表）
async function renderPettyCash() {
  const el = document.getElementById('content');
  el.innerHTML = `
    <div class="pc-wrap">
      <div class="pc-page-header">
        <div class="pc-page-title">
          <h1>🪙 零用金月報</h1>
          <p>記錄每月零用金收支，可建立多人員報表並匯出 Excel 交付主管。</p>
        </div>
        <div class="pc-page-actions">
          <button class="pc-btn pc-btn--primary" onclick="pcOpenReportModal()">＋ 新增零用金月報</button>
        </div>
      </div>

      <section class="pc-card" aria-label="彙總">
        <div class="pc-card__bd">
          <div class="pc-kpi-row ui-kpi-grid">
            <div class="pc-kpi-card ui-kpi-card"><div class="pc-kpi-card__head"><span class="ui-kpi-icon" aria-hidden="true">🪙</span><span class="ui-kpi-label">報表總數</span></div><div class="pc-kpi-card__num ui-kpi-value pc-kpi-blue" id="pc-kpi-total">—</div><div class="pc-kpi-card__foot ui-kpi-meta">篩選全量</div></div>
            <div class="pc-kpi-card ui-kpi-card"><div class="pc-kpi-card__head"><span class="ui-kpi-icon" aria-hidden="true">✅</span><span class="ui-kpi-label">已完成</span></div><div class="pc-kpi-card__num ui-kpi-value pc-kpi-green" id="pc-kpi-done">—</div><div class="pc-kpi-card__foot ui-kpi-meta">篩選全量</div></div>
            <div class="pc-kpi-card ui-kpi-card"><div class="pc-kpi-card__head"><span class="ui-kpi-icon" aria-hidden="true">📝</span><span class="ui-kpi-label">草稿</span></div><div class="pc-kpi-card__num ui-kpi-value pc-kpi-amber" id="pc-kpi-draft">—</div><div class="pc-kpi-card__foot ui-kpi-meta">篩選全量</div></div>
          </div>
        </div>
      </section>

      <section class="pc-card" aria-label="篩選與列表">
        <div class="pc-card__hd">
          <h2>🔍 報表查詢</h2>
          <p>可依報表期間交集 / 上傳人 / 狀態 / 關鍵字篩選</p>
          <div class="pc-filter-bar">
            <div class="pc-field"><label>報表期間（起）</label><input id="pc-f-from" type="date"></div>
            <div class="pc-field"><label>報表期間（迄）</label><input id="pc-f-to" type="date"></div>
            <div class="pc-field"><label>上傳人姓名</label><select id="pc-f-person"><option value="">全部</option></select></div>
            <div class="pc-field"><label>狀態</label><select id="pc-f-status"><option value="">全部</option><option value="draft">草稿</option><option value="completed">已完成</option></select></div>
            <div class="pc-field pc-field--search"><label>檔名關鍵字</label><input id="pc-f-q" type="text" placeholder="檔名文字 / 上傳人 / 製表人"></div>
            <div class="pc-filter-actions">
              <button class="pc-btn pc-btn--primary" onclick="pcLoadHistory(true)">搜尋</button>
              <button class="pc-btn pc-btn--ghost" onclick="pcResetFilter()">清除</button>
            </div>
          </div>
          <div class="pc-chips">
            <button class="pc-chip" onclick="pcQuickRange('month',this)">本月</button>
            <button class="pc-chip" onclick="pcQuickRange('prev',this)">上月</button>
            <button class="pc-chip" onclick="pcQuickRange('year',this)">今年</button>
            <button class="pc-chip active" onclick="pcQuickRange('all',this)">全部</button>
            <span class="pc-result-count"><span id="pc-result-count">0 筆</span></span>
          </div>
        </div>
        <div class="pc-card__bd" style="padding-top:0">
          <div class="pc-table-wrap"><table class="pc-table">
            <thead><tr><th>#</th><th>報表期間</th><th>檔名</th><th>上傳人</th><th>製表人</th><th>上期餘額</th><th>本期收入</th><th>本期支出</th><th>期末餘額</th><th>狀態</th><th>操作</th></tr></thead>
            <tbody id="pc-tbody"></tbody>
          </table></div>
          <div class="pc-cards" id="pc-cards"></div>
          <div id="pc-empty" class="pc-empty" style="display:none">
            <div class="pc-empty__icon">🪙</div>
            <div>沒有符合條件的月報</div>
            <div class="pc-hint">試試放寬期間或關鍵字，或切換「全部」</div>
          </div>
        </div>
        <div class="pc-pagination">
          <span id="pc-page-info"></span>
          <span style="display:flex;gap:6px">
            <button class="pc-btn-sm" onclick="pcChangePage(-1)">‹ 上一頁</button>
            <button class="pc-btn-sm pc-btn-sm--primary" onclick="pcChangePage(1)">下一頁 ›</button>
          </span>
        </div>
      </section>
    </div>`;

  pcLoadPersons();
  pcLoadHistory();
}

// 載入上傳人下拉（歷史上傳人 + 啟用中使用者）
async function pcLoadPersons() {
  try {
    const res = await fetch('/api/petty-cash-persons');
    if (!res.ok) return;
    const data = await res.json();
    pcPersons = data.persons || [];
    const sel = document.getElementById('pc-f-person');
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="">全部</option>' + pcPersons.map(p =>
      `<option value="${esc(p)}">${esc(p)}</option>`).join('');
    sel.value = cur;
  } catch(e) {}
}

// 載入月報列表（後端篩選 + 分頁）
async function pcLoadHistory(resetPage) {
  if (resetPage) pcPage = 1;
  const fromEl = document.getElementById('pc-f-from');
  if (!fromEl) return;
  const p = new URLSearchParams({
    start_date: fromEl.value || '',
    end_date: document.getElementById('pc-f-to').value || '',
    upload_person: document.getElementById('pc-f-person').value || '',
    status: document.getElementById('pc-f-status').value || '',
    search: document.getElementById('pc-f-q').value.trim(),
    page: pcPage, page_size: pcPageSize
  });
  try {
    const res = await fetch('/api/petty-cash-reports?' + p);
    if (!res.ok) return;
    const data = await res.json();
    pcReports = data.items || [];
    pcTotal = data.total || 0;
    pcPage = data.page || pcPage;
    document.getElementById('pc-result-count').textContent = pcTotal + ' 筆';
    pcRenderTable();
    pcUpdateKPI();
  } catch(e) {}
}

// 列表 desktop table + mobile cards（同一份後端資料）
function pcRenderTable() {
  const tb = document.getElementById('pc-tbody');
  const cards = document.getElementById('pc-cards');
  const empty = document.getElementById('pc-empty');
  if (!tb) return;
  if (!pcReports.length) {
    tb.innerHTML = '';
    cards.innerHTML = '';
    empty.style.display = 'block';
  } else {
    empty.style.display = 'none';
    tb.innerHTML = pcReports.map(pcDesktopRowHtml).join('');
    cards.innerHTML = pcReports.map(pcCardHtml).join('');
  }
  const max = Math.max(1, Math.ceil(pcTotal / pcPageSize));
  document.getElementById('pc-page-info').textContent = `第 ${esc(pcPage)} / ${esc(max)} 頁 · 共 ${esc(pcTotal)} 筆`;
}

// desktop 列（金額欄皆為格式化數字字串，使用者文字皆 esc）
function pcDesktopRowHtml(r, idx) {
  const ops = pcRowOpsHtml(r);
  return `<tr>
    <td>${esc(pcPageSize * (pcPage - 1) + idx + 1)}</td>
    <td style="white-space:nowrap">${_pcPeriodText(r)}</td>
    <td>${_pcFileLabel(r)}</td>
    <td>${esc(r.upload_person)}</td>
    <td>${esc(r.prepared_by)}</td>
    <td class="pc-num">${esc(_pcMoney(r.opening_balance))}</td>
    <td class="pc-num pc-kpi-income">${esc(_pcMoney(r.income))}</td>
    <td class="pc-num pc-kpi-expense">${esc(_pcMoney(r.expense))}</td>
    <td class="pc-num pc-kpi-balance"><strong>${esc(_pcMoney(r.closing_balance))}</strong></td>
    <td>${pcStatusBadge(r.status)}</td>
    <td><div class="pc-row-actions">${ops}</div></td>
  </tr>`;
}

// mobile 卡（期末餘額為重要視覺資訊）
function pcCardHtml(r) {
  const ops = pcRowOpsHtml(r);
  return `<div class="pc-report-card" onclick="pcOpenDetail(${r.id})">
    <div class="pc-report-card__top">
      <span class="pc-report-card__period">${_pcPeriodText(r)}</span>
      ${pcStatusBadge(r.status)}
    </div>
    <div class="pc-report-card__file">${_pcFileLabel(r)}</div>
    <div class="pc-report-card__meta">上傳人：${esc(r.upload_person)} · 製表人：${esc(r.prepared_by)}</div>
    <div class="pc-report-card__balance">期末餘額 $${esc(_pcMoney(r.closing_balance))}</div>
    <div class="pc-row-actions" style="margin-top:8px" onclick="event.stopPropagation()">${ops}</div>
  </div>`;
}

// 列操作（id 為 DB 數字主鍵；編輯鍵依後端 can_edit）
function pcRowOpsHtml(r) {
  const editBtn = r.can_edit ? `<button class="pc-btn-sm" onclick="event.stopPropagation();pcOpenReportModal(${r.id})">✏️ 編輯</button>` : '';
  const delBtn = r.can_edit ? `<button class="pc-btn-sm pc-btn-sm--danger" onclick="event.stopPropagation();pcDelete(${r.id})">🗑 刪除</button>` : '';
  return `<button class="pc-btn-sm" onclick="event.stopPropagation();pcOpenDetail(${r.id})">檢視</button>${editBtn}<button class="pc-btn-sm" onclick="event.stopPropagation();pcExport(${r.id})">⬇️ 匯出</button>${delBtn}`;
}

// KPI（同篩選全量，不受分頁影響）
async function pcUpdateKPI() {
  const fromEl = document.getElementById('pc-f-from');
  if (!fromEl) return;
  const p = new URLSearchParams({
    start_date: fromEl.value || '',
    end_date: document.getElementById('pc-f-to').value || '',
    upload_person: document.getElementById('pc-f-person').value || '',
    status: document.getElementById('pc-f-status').value || '',
    search: document.getElementById('pc-f-q').value.trim()
  });
  try {
    const res = await fetch('/api/petty-cash/kpi?' + p);
    if (!res.ok) return;
    const k = await res.json();
    document.getElementById('pc-kpi-total').textContent = k.total;
    document.getElementById('pc-kpi-done').textContent = k.completed;
    document.getElementById('pc-kpi-draft').textContent = k.draft;
  } catch(e) {}
}

// 重設篩選為全部並重新查詢
function pcResetFilter() {
  document.getElementById('pc-f-from').value = '';
  document.getElementById('pc-f-to').value = '';
  document.getElementById('pc-f-person').value = '';
  document.getElementById('pc-f-status').value = '';
  document.getElementById('pc-f-q').value = '';
  document.querySelectorAll('.pc-chip').forEach(c => c.classList.remove('active'));
  document.querySelectorAll('.pc-chip')[3].classList.add('active');
  pcPage = 1;
  pcLoadHistory();
}

// 快捷期間（本月/上月/今年/全部，以報表期間交集篩選）
function pcQuickRange(k, btn) {
  document.querySelectorAll('.pc-chip').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  const now = new Date();
  const f = document.getElementById('pc-f-from');
  const t = document.getElementById('pc-f-to');
  if (k === 'month') {
    f.value = _pcIso(new Date(now.getFullYear(), now.getMonth(), 1));
    t.value = _pcIso(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  } else if (k === 'prev') {
    f.value = _pcIso(new Date(now.getFullYear(), now.getMonth() - 1, 1));
    t.value = _pcIso(new Date(now.getFullYear(), now.getMonth(), 0));
  } else if (k === 'year') {
    f.value = _pcIso(new Date(now.getFullYear(), 0, 1));
    t.value = _pcIso(new Date(now.getFullYear(), 11, 31));
  } else { f.value = ''; t.value = ''; }
  pcPage = 1;
  pcLoadHistory();
}

// 翻頁（觸發重新查詢）
function pcChangePage(d) {
  const max = Math.max(1, Math.ceil(pcTotal / pcPageSize));
  const next = Math.min(max, Math.max(1, pcPage + d));
  if (next === pcPage) return;
  pcPage = next;
  pcLoadHistory();
}

// 開啟單份月報檢視
async function pcOpenDetail(id) {
  try {
    const res = await fetch('/api/petty-cash-reports/' + id);
    if (!res.ok) return toast('⚠️ 讀取失敗');
    pcDetail = await res.json();
    pcRenderDetail();
  } catch(e) { toast('⚠️ 網路錯誤：' + e.message); }
}

// 明細檢視頁（4 KPI + 明細 table，多項目以 rowspan 合併）
function pcRenderDetail() {
  const el = document.getElementById('content');
  const r = pcDetail;
  const t = r.totals;
  const canEdit = !!r.can_edit;
  const rowsHtml = pcDetailRowsHtml(r.entries);
  const fileLabel = '零用金-' + (r.filename_text || '') + _pcMD(r.start_date) + '~' + _pcMD(r.end_date);
  el.innerHTML = `
    <div class="pc-wrap">
      <div class="pc-page-header">
        <div class="pc-page-title">
          <h1>🪙 ${_pcPeriodText(r)} ${pcStatusBadge(r.status)}</h1>
          <p>${esc(fileLabel)} · 上傳人：${esc(r.upload_person)} · 製表人：${esc(r.prepared_by)}</p>
        </div>
        <div class="pc-page-actions">
          <button class="pc-btn pc-btn--ghost" onclick="renderPettyCash()">← 返回列表</button>
          ${canEdit ? `<button class="pc-btn pc-btn--ghost" onclick="pcOpenReportModal(${r.id})">✏️ 編輯</button>` : ''}
          <button class="pc-btn pc-btn--primary" onclick="pcExport(${r.id})">⬇️ 匯出 Excel</button>
          ${canEdit ? `<button class="pc-btn pc-btn--ghost" onclick="pcDelete(${r.id}, true)">🗑 刪除</button>` : ''}
        </div>
      </div>
      <section class="pc-card"><div class="pc-card__bd">
        <div class="pc-kpi-row">
          <div class="pc-kpi-card ui-kpi-card"><div class="pc-kpi-card__head"><span class="ui-kpi-label">上期餘額</span></div><div class="pc-kpi-card__num ui-kpi-value pc-kpi-opening">$${esc(_pcMoney(t.opening_balance))}</div><div class="pc-kpi-card__foot ui-kpi-meta">期初</div></div>
          <div class="pc-kpi-card ui-kpi-card"><div class="pc-kpi-card__head"><span class="ui-kpi-label">本期收入</span></div><div class="pc-kpi-card__num ui-kpi-value pc-kpi-income">+$${esc(_pcMoney(t.income))}</div><div class="pc-kpi-card__foot ui-kpi-meta">收入合計</div></div>
          <div class="pc-kpi-card ui-kpi-card"><div class="pc-kpi-card__head"><span class="ui-kpi-label">本期支出</span></div><div class="pc-kpi-card__num ui-kpi-value pc-kpi-expense">-$${esc(_pcMoney(t.expense))}</div><div class="pc-kpi-card__foot ui-kpi-meta">支出合計</div></div>
          <div class="pc-kpi-card ui-kpi-card"><div class="pc-kpi-card__head"><span class="ui-kpi-label">本期餘額</span></div><div class="pc-kpi-card__num ui-kpi-value pc-kpi-balance">$${esc(_pcMoney(t.closing_balance))}</div><div class="pc-kpi-card__foot ui-kpi-meta">期末</div></div>
        </div>
      </div></section>
      <section class="pc-card">
        <div class="pc-card__hd"><h2>📝 收支明細</h2></div>
        <div class="pc-card__bd">
          <div class="pc-table-wrap pc-detail-table-wrap"><table class="pc-detail-table">
            <thead><tr><th>項次</th><th>日期</th><th>摘要</th><th>收入</th><th>支出</th><th>科目</th></tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table></div>
        </div>
      </section>
    </div>`;
}

// 明細列（含多項目 rowspan；警示列為固定 HTML + esc 警示文字）
function pcDetailRowsHtml(entries) {
  let seq = 0;
  return (entries || []).map(e => {
    const items = e.items || [];
    const isIncome = e.entry_type === 'income';
    const incomeCell = isIncome ? esc(_pcMoney(e.amount)) : '';
    const expenseCell = isIncome ? '' : esc(_pcMoney(e.amount));
    const warnRow = e.amount_warning
      ? `<tr><td></td><td colspan="5"><div class="pc-entry-card__warn">⚠️ ${esc(e.amount_warning)}</div></td></tr>` : '';
    if (!isIncome && items.length) {
      const n = items.length;
      const first = items[0];
      let html = `<tr><td>${esc(seq + 1)}</td>`
        + `<td rowspan="${n}" style="white-space:nowrap">${esc(_pcDate(e.entry_date))}</td>`
        + `<td>${pcItemText(first)}</td>`
        + `<td rowspan="${n}"></td><td rowspan="${n}" class="pc-num">${expenseCell}</td>`
        + `<td rowspan="${n}">${esc(e.category)}</td></tr>`;
      seq += 1;
      for (let i = 1; i < n; i++) {
        seq += 1;
        html += `<tr><td>${esc(seq)}</td><td>${pcItemText(items[i])}</td></tr>`;
      }
      return html + warnRow;
    }
    seq += 1;
    return `<tr><td>${esc(seq)}</td><td style="white-space:nowrap">${esc(_pcDate(e.entry_date))}</td>`
      + `<td>${esc(e.description)}</td><td class="pc-num">${incomeCell}</td>`
      + `<td class="pc-num">${expenseCell}</td><td>${esc(e.category)}</td></tr>` + warnRow;
  }).join('');
}

// 明細項目文字（回傳已 esc 的 HTML 片段，呼叫端直接內插；與 Excel 一致：名稱 數量單位 $金額）
function pcItemText(it) {
  return `${esc(it.item_name)} ${esc(Number(it.qty))}${esc(it.unit || '')} $${esc(it.amount)}`;
}

// 匯出 Excel（檔名由後端安全格式產生）
function pcExport(id) {
  window.open('/api/petty-cash-reports/' + id + '/export.xlsx', '_blank');
}

// 刪除月報（二次確認；含 entries/items CASCADE）
async function pcDelete(id, backToList) {
  if (!confirm('確定刪除這份零用金月報？底下收支紀錄會一併刪除。')) return;
  const res = await fetch('/api/petty-cash-reports/' + id, { method: 'DELETE' });
  const data = await res.json().catch(() => ({}));
  if (res.ok) {
    toast('🗑 已刪除');
    if (backToList) renderPettyCash();
    else pcLoadHistory();
  } else toast('⚠️ ' + (data.detail || '刪除失敗'));
}
