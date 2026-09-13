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
  return (Math.round(n * 100) / 100).toLocaleString('en-US');
}

// 報表期間文字（起～迄）
function _pcPeriodText(r) {
  return esc(_pcDate(r.start_date)) + '～' + esc(_pcDate(r.end_date));
}

// UI 顯示檔名：零用金-資材08/26~09/25（斜線僅顯示用）
function _pcFileLabel(r) {
  return esc(r.filename || ('零用金-' + (r.filename_text || '') + _pcMD(r.start_date) + '~' + _pcMD(r.end_date) + '.xlsx'));
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
          <button class="pc-btn pc-btn--primary" onclick="pcChooseReportType()">＋ 新增零用金月報</button>
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
            <div class="pc-field"><label>報表歸屬人</label><select id="pc-f-person"><option value="">全部</option></select></div>
            <div class="pc-field"><label>報表類型</label><select id="pc-f-type"><option value="">全部</option><option value="general">一般零用金</option><option value="engineering">工程零用金</option></select></div><div class="pc-field"><label>狀態</label><select id="pc-f-status"><option value="">全部</option><option value="draft">草稿</option><option value="completed">已完成</option></select></div>
            <div class="pc-field pc-field--search"><label>檔名關鍵字</label><input id="pc-f-q" type="text" placeholder="檔名 / 歸屬人 / 製表人"></div>
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
          <div class="pc-table-wrap"><table class="pc-table pc-report-list-table">
            <thead><tr><th>#</th><th>報表期間</th><th>報表類型</th><th>檔名</th><th>報表歸屬人</th><th>製表人</th><th>金額摘要</th><th>狀態</th><th>操作</th></tr></thead>
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
    report_type: document.getElementById('pc-f-type').value || '',
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
  if (r.report_type === 'engineering') return engDesktopRowHtml(r, idx);
  const ops = pcRowOpsHtml(r);
  return `<tr>
    <td>${esc(pcPageSize * (pcPage - 1) + idx + 1)}</td>
    <td>${_pcPeriodText(r)}</td>
    <td><span class="pc-status pc-status--general">一般零用金</span></td>
    <td>${_pcFileLabel(r)}</td>
    <td>${esc(r.upload_person)}</td>
    <td>${esc(r.prepared_by)}</td>
    <td class="pc-num"><strong>本期餘額 $${esc(_pcMoney(r.closing_balance))}</strong></td>
    <td>${pcStatusBadge(r.status)}</td>
    <td><div class="pc-row-actions">${ops}</div></td>
  </tr>`;
}

// mobile 卡（期末餘額為重要視覺資訊）
function pcCardHtml(r) {
  if (r.report_type === 'engineering') return engCardHtml(r);
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

// 報表操作共用更多選單：桌面與手機使用同一組 actions
function pcMoreMenuHtml(r, engineering) {
  const edit = engineering ? `pcOpenEngineeringModal(${r.id})` : `pcOpenReportModal(${r.id})`;
  const del = `pcDelete(${r.id}${engineering ? ', true' : ''})`;
  return `<span class="pc-report-actions"><details class="pc-more-menu" onclick="event.stopPropagation()"><summary aria-label="更多操作">⋯</summary><div class="pc-more-menu__list"><button type="button" onclick="event.stopPropagation();pcOpenDetail(${r.id})">👁 檢視</button>${r.can_edit ? `<button type="button" onclick="event.stopPropagation();${edit}">✏️ 編輯</button>` : ''}<button type="button" onclick="event.stopPropagation();pcExport(${r.id})">⬇️ 匯出</button>${r.can_edit ? `<button type="button" class="pc-more-menu__danger" onclick="event.stopPropagation();${del}">🗑 刪除</button>` : ''}</div></details></span>`;
}

// 列操作（id 為 DB 數字主鍵；編輯鍵依後端 can_edit）
function pcRowOpsHtml(r) {
  return pcMoreMenuHtml(r, false);
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
    report_type: document.getElementById('pc-f-type').value || '',
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
    pcDetailExpanded = new Set();
    engExpandedCategories = new Set();
    engExpandedGroups = new Set();
    engExpandedReceipts = new Set();
    engUiInitialized = false;
    pcRenderDetail();
  } catch(e) { toast('⚠️ 網路錯誤：' + e.message); }
}

// 明細檢視頁：同一份 pcDetail，desktop table / mobile cards 分開呈現
var pcDetailExpanded = new Set();
function pcToggleGeneralEntry(index) {
  if (pcDetailExpanded.has(index)) pcDetailExpanded.delete(index); else pcDetailExpanded.add(index);
  pcRenderDetail();
}
var pcGeneralDetailEventsBound = false;
function pcBindGeneralDetailEvents() {
  if (pcGeneralDetailEventsBound) return;
  pcGeneralDetailEventsBound = true;
  document.addEventListener('click', event => {
    const element = event.target.closest('.pc-general-entry-row--expandable[data-entry-index], .pc-inline-expand[data-entry-index], .pc-general-detail-toggle[data-entry-index]');
    if (!element) return;
    event.preventDefault();
    event.stopPropagation();
    pcToggleGeneralEntry(Number(element.dataset.entryIndex));
  }, true);
}
function pcEntryStatus(e) {
  return e.amount_warning ? '<span class="pc-entry-status pc-entry-status--warn">⚠ 金額不一致</span>' : '<span class="pc-entry-status">● 正常</span>';
}
function pcGeneralDetailsHtml(e) {
  if (!e.items || !e.items.length) return '';
  const detailTotal = e.detail_total == null ? null : '$' + _pcMoney(e.detail_total);
  const difference = e.difference == null ? null : (e.difference >= 0 ? '+$' : '-$') + _pcMoney(Math.abs(e.difference));
  return `<div class="pc-general-detail-panel"><div class="pc-general-detail-title">單據明細（${esc(e.items.length)} 項）</div><div class="pc-general-detail-list">${e.items.map((it,i) => `<div class="pc-general-detail-item"><span>${esc(i+1)}. ${pcItemText(it)}</span></div>`).join('')}</div>${e.amount_warning ? `<div class="pc-general-discrepancy"><span>帳務支出 <b>$${esc(_pcMoney(e.amount))}</b></span><span>明細合計 <b>${esc(detailTotal || '—')}</b></span><span>差額 <b>${esc(difference || '—')}</b></span></div>` : ''}</div>`;
}
function pcGeneralEntryRowsHtml(entries) {
  let seq = 0;
  return (entries || []).map((e, i) => {
    seq += 1;
    const expanded = pcDetailExpanded.has(i);
    const hasItems = !!(e.items && e.items.length);
    const summary = e.description || (hasItems ? `${e.items.length} 項明細` : '—');
    const incomeText = e.entry_type === 'income' ? '+' + esc(_pcMoney(e.amount)) : '—';
    const expenseText = e.entry_type !== 'income' ? '-' + esc(_pcMoney(e.amount)) : '—';
    const toggle = hasItems ? `<button type="button" class="pc-inline-expand" aria-expanded="${expanded}" data-entry-index="${i}">${expanded ? '▼' : '▶'}</button>` : '';
    const row = `<tr class="${hasItems ? 'pc-general-entry-row pc-general-entry-row--expandable' : 'pc-general-entry-row'}"${hasItems ? ` data-entry-index="${i}"` : ''}><td>${esc(seq)}</td><td class="pc-nowrap">${esc(_pcDate(e.entry_date))}</td><td>${toggle}<span>${esc(summary)}</span>${hasItems ? ` <small>（${esc(e.items.length)} 項）</small>` : ''}</td><td class="pc-money pc-money--income">${incomeText}</td><td class="pc-money pc-money--expense">${expenseText}</td><td>${esc(e.category || '—')}</td><td>${pcEntryStatus(e)}</td><td>—</td></tr>`;
    const detail = expanded ? `<tr class="pc-general-detail-row"><td></td><td colspan="7">${pcGeneralDetailsHtml(e)}</td></tr>` : '';
    return row + detail;
  }).join('');
}
function pcGeneralMobileCardsHtml(entries) {
  return (entries || []).map((e,i) => {
    const expanded = pcDetailExpanded.has(i);
    const isIncome = e.entry_type === 'income';
    const hasItems = !!(e.items && e.items.length);
    return `<article class="pc-general-tx-card"><div class="pc-general-tx-main"><div class="pc-general-tx-top"><span class="pc-nowrap">${esc(_pcDate(e.entry_date))}</span>${e.category ? `<span class="pc-entry-card__cat">${esc(e.category)}</span>` : ''}</div><div class="pc-general-tx-desc">${esc(e.description || (hasItems ? `${e.items.length} 項明細` : '—'))}</div><div class="pc-general-tx-bottom"><span class="${isIncome ? 'pc-money--income' : 'pc-money--expense'}">${isIncome ? '收入 +' : '支出 -'}$${esc(_pcMoney(e.amount))}</span>${pcEntryStatus(e)}</div>${hasItems ? `<button type="button" class="pc-general-detail-toggle" data-entry-index="${i}">${expanded ? '收合明細 ▲' : `查看 ${e.items.length} 項明細 ▼`}</button>` : ''}</div>${expanded ? pcGeneralDetailsHtml(e) : ''}</article>`;
  }).join('');
}
function pcRenderDetail() {
  if (pcDetail.report_type === 'engineering') return engRenderDetail();
  const el = document.getElementById('content');
  const r = pcDetail, t = r.totals, canEdit = !!r.can_edit;
  const fileLabel = r.filename || ('零用金-' + (r.filename_text || '') + _pcMD(r.start_date) + '~' + _pcMD(r.end_date) + '.xlsx');
  el.innerHTML = `<div class="pc-wrap"><div class="pc-page-header"><div class="pc-page-title"><h1>🪙 ${_pcPeriodText(r)} ${pcStatusBadge(r.status)}</h1><p>${esc(fileLabel)} · 報表歸屬人：${esc(r.upload_person)} · 製表人：${esc(r.prepared_by)}</p></div><div class="pc-page-actions"><button class="pc-btn pc-btn--ghost" onclick="renderPettyCash()">← 返回列表</button>${canEdit ? `<button class="pc-btn pc-btn--ghost" onclick="pcOpenReportModal(${r.id})">✏️ 編輯</button>` : ''}<button class="pc-btn pc-btn--primary" onclick="pcExport(${r.id})">⬇️ 匯出 Excel</button>${canEdit ? `<button class="pc-btn pc-btn--ghost" onclick="pcDelete(${r.id}, true)">🗑 刪除</button>` : ''}</div></div><section class="pc-card"><div class="pc-card__bd"><div class="pc-kpi-row"><div class="pc-kpi-card ui-kpi-card"><div class="pc-kpi-card__head"><span class="ui-kpi-label">上期餘額</span></div><div class="pc-kpi-card__num ui-kpi-value pc-kpi-opening">$${esc(_pcMoney(t.opening_balance))}</div></div><div class="pc-kpi-card ui-kpi-card"><div class="pc-kpi-card__head"><span class="ui-kpi-label">本期收入</span></div><div class="pc-kpi-card__num ui-kpi-value pc-kpi-income">+$${esc(_pcMoney(t.income))}</div></div><div class="pc-kpi-card ui-kpi-card"><div class="pc-kpi-card__head"><span class="ui-kpi-label">本期支出</span></div><div class="pc-kpi-card__num ui-kpi-value pc-kpi-expense">-$${esc(_pcMoney(t.expense))}</div></div><div class="pc-kpi-card ui-kpi-card"><div class="pc-kpi-card__head"><span class="ui-kpi-label">本期餘額</span></div><div class="pc-kpi-card__num ui-kpi-value pc-kpi-balance">$${esc(_pcMoney(t.closing_balance))}</div></div></div></div></section><section class="pc-card"><div class="pc-card__hd"><h2>📝 收支明細</h2></div><div class="pc-card__bd"><div class="pc-table-wrap pc-general-detail-table-wrap"><table class="pc-detail-table pc-general-detail-table"><thead><tr><th>項次</th><th>日期</th><th>摘要／明細</th><th>收入</th><th>支出</th><th>科目</th><th>狀態</th><th>操作</th></tr></thead><tbody>${pcGeneralEntryRowsHtml(r.entries)}</tbody></table></div><div class="pc-general-mobile-list">${pcGeneralMobileCardsHtml(r.entries)}</div></div></section></div>`;
  pcBindGeneralDetailEvents();
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

function engDesktopRowHtml(r, idx) {
  const ops = pcMoreMenuHtml(r, true);
  return `<tr><td>${esc(idx + 1)}</td><td>${_pcPeriodText(r)}</td><td><span class="pc-status pc-status--engineering">工程零用金</span></td><td>${esc(r.filename || r.filename_text || '')}</td><td>${esc(r.upload_person)}</td><td>${esc(r.prepared_by)}</td><td class="pc-num"><strong>總計 $${esc(_pcMoney(r.total_amount))}</strong></td><td>${pcStatusBadge(r.status)}</td><td><div class="pc-row-actions">${ops}</div></td></tr>`;
}
function engCardHtml(r) {
  const ops = pcMoreMenuHtml(r, true);
  return `<div class="pc-report-card" onclick="pcOpenDetail(${r.id})"><div class="pc-report-card__top"><span class="pc-report-card__period">${_pcPeriodText(r)}</span>${pcStatusBadge(r.status)}</div><div class="pc-report-card__file"><span class="pc-status pc-status--engineering">工程零用金</span> ${esc(r.filename || r.filename_text || '')}</div><div class="pc-report-card__meta">報表歸屬人：${esc(r.upload_person)} · 製表人：${esc(r.prepared_by)}</div><div class="pc-report-card__balance">總計 $${esc(_pcMoney(r.total_amount))}</div><div class="pc-row-actions" style="margin-top:8px">${ops}</div></div>`;
}

var engExpandedCategories = new Set();
var engExpandedGroups = new Set();
var engExpandedReceipts = new Set();
var engUiInitialized = false;
function engToggle(set, key) { if (set.has(key)) set.delete(key); else set.add(key); engRenderDetail(); }
function engReceiptDetailsHtml(q, key) {
  const details = q.details || [];
  if (!details.length) return '';
  return `<div class="eng-receipt-details"><div class="eng-receipt-details-title">單據明細（${esc(details.length)} 項）</div>${details.map((d,i) => `<div class="eng-detail-line"><span>${esc(i + 1)}. ${esc(d)}</span></div>`).join('')}</div>`;
}
function engReceiptHtml(q, ri, groupKey) {
  const receiptKey = groupKey + ':' + ri;
  const details = q.details || [];
  const expanded = engExpandedReceipts.has(receiptKey);
  const hasDetails = details.length > 0;
  const toggle = hasDetails ? ` type="button" aria-expanded="${expanded}" onclick="engToggle(engExpandedReceipts,'${jsStr(receiptKey)}')"` : '';
  const detailRow = expanded ? `<tr class="eng-receipt-detail-row"><td colspan="4">${engReceiptDetailsHtml(q, receiptKey)}</td></tr>` : '';
  return `<tr class="eng-receipt-row"><td><button class="eng-receipt-toggle"${toggle}><span class="eng-receipt-chevron">${hasDetails ? (expanded ? '▼' : '▶') : '·'}</span><span class="eng-receipt-no">${esc(q.receipt_number || '未填寫單據')}</span></button></td><td><span class="eng-tax-mark">${esc(q.tax_id_mark || '—')}</span></td><td class="eng-detail-count">${hasDetails ? `${esc(details.length)} 項明細` : '無細項'}</td><td class="pc-num"><strong>$${esc(_pcMoney(q.amount))}</strong></td></tr>${detailRow}`;
}
function engGroupHtml(g, ci, gi) {
  const groupKey = ci + ':' + gi;
  const expanded = engExpandedGroups.has(groupKey);
  const receipts = (g.receipts || []).map((q,ri) => engReceiptHtml(q,ri,groupKey)).join('');
  return `<section class="eng-group-block"><button class="eng-group-head${expanded ? ' is-open' : ''}" aria-expanded="${expanded}" onclick="engToggle(engExpandedGroups,'${jsStr(groupKey)}')"><span><span class="eng-chevron">${expanded ? '▼' : '▶'}</span><b>${esc(g.name)}</b></span><strong>項目小計 $${esc(_pcMoney(g.subtotal))}</strong></button>${expanded ? `<div class="eng-group-body"><div class="eng-detail-table-wrap"><table class="eng-detail-table"><thead><tr><th>單據</th><th>統編</th><th>明細</th><th>金額</th></tr></thead><tbody>${receipts || '<tr><td colspan="4" class="pc-empty-cell">尚無單據</td></tr>'}</tbody></table></div></div>` : ''}</section>`;
}
function engRenderDetail() {
  const r = pcDetail, cats = r.categories || [];
  if (!engUiInitialized) {
    engUiInitialized = true;
    if (cats[0]) { engExpandedCategories.add(String(cats[0].id)); if (cats[0].groups && cats[0].groups[0]) engExpandedGroups.add('0:0'); }
  }
  const totalReceipts = cats.reduce((n,c) => n + (c.groups || []).reduce((m,g) => m + (g.receipts || []).length,0),0);
  const canEdit = !!r.can_edit;
  const categoryHtml = cats.map((c,ci) => {
    const key = String(c.id || ci), expanded = engExpandedCategories.has(key);
    return `<section class="pc-card eng-category-card"><button class="eng-category-head" aria-expanded="${expanded}" onclick="engToggle(engExpandedCategories,'${jsStr(key)}')"><span><span class="eng-chevron">${expanded ? '▼' : '▶'}</span><span class="eng-section-kicker">分類</span><h2>${esc(c.name)}</h2></span><strong class="eng-subtotal">分類小計 $${esc(_pcMoney(c.subtotal))}</strong></button>${expanded ? `<div class="pc-card__bd">${(c.groups || []).map((g,gi) => engGroupHtml(g,ci,gi)).join('') || '<div class="pc-empty-cell">此分類尚無項目</div>'}</div>` : ''}</section>`;
  }).join('');
  document.getElementById('content').innerHTML = `<div class="pc-wrap"><div class="pc-page-header"><div class="pc-page-title"><h1>🪙 ${_pcPeriodText(r)} <span class="pc-status pc-status--engineering">工程零用金</span></h1><p>報表歸屬人：${esc(r.upload_person)} · 製表人：${esc(r.prepared_by)}</p><p class="eng-file-label">${esc(r.filename || '')}</p></div><div class="pc-page-actions"><button class="pc-btn pc-btn--ghost" onclick="renderPettyCash()">← 返回列表</button>${canEdit ? `<button class="pc-btn pc-btn--ghost" onclick="pcOpenEngineeringModal(${r.id})">✏️ 編輯</button>` : ''}<button class="pc-btn pc-btn--primary" onclick="pcExport(${r.id})">⬇️ 匯出</button>${canEdit ? `<button class="pc-btn pc-btn--ghost" onclick="pcDelete(${r.id}, true)">🗑 刪除</button>` : ''}</div></div><section class="pc-card eng-guide-card"><div class="pc-card__bd"><strong>ⓘ 如何閱讀這份工程零用金？</strong><span>分類是費用大類；項目是分類下的用途；一張單據可包含多個明細項目，單據金額只計算一次。</span></div></section><section class="pc-card"><div class="pc-card__bd"><div class="pc-kpi-row ui-kpi-grid"><div class="pc-kpi-card ui-kpi-card"><div class="pc-kpi-card__head"><span class="ui-kpi-icon ui-kpi-icon--blue">▦</span><span class="ui-kpi-label">總分類數</span></div><div class="ui-kpi-value pc-kpi-blue">${cats.length}</div></div><div class="pc-kpi-card ui-kpi-card"><div class="pc-kpi-card__head"><span class="ui-kpi-icon ui-kpi-icon--green">▤</span><span class="ui-kpi-label">總單據數</span></div><div class="ui-kpi-value pc-kpi-green">${totalReceipts}</div></div><div class="pc-kpi-card ui-kpi-card"><div class="pc-kpi-card__head"><span class="ui-kpi-icon ui-kpi-icon--amber">$</span><span class="ui-kpi-label">工程零用金總計</span></div><div class="ui-kpi-value pc-kpi-balance">$${esc(_pcMoney(r.total_amount))}</div></div></div></div></section>${categoryHtml || '<div class="pc-empty">尚未建立任何分類<br><small>請按「編輯」新增第一個分類</small></div>'}</div>`;
}
