// 庫存管理系統 - 零用金月報彈窗（2026-09-12，基本資料兩步式 + 收支明細）
// render/petty-cash.js 負責列表/檢視；本檔負責新增/編輯 modal 與暫存 state

var pcModalEditingId = null;
var pcModalEntries = [];
var pcModalReturnToDetail = false;
var pcOpeningSource = 'manual';
var pcEntryEditIndex = -1;
var pcEntryType = 'expense';
var pcEntryItemDraft = [];
var pcGeneralOptions = { category: [] };

function pcGeneralCategoryOptions(value) {
  const current = String(value || '');
  const known = pcGeneralOptions.category || [];
  const extra = current && !known.some(o => o.name === current) ? `<option value="${esc(current)}" selected>${esc(current)}（歷史／自訂）</option>` : '';
  return `<option value="">— 請選擇或輸入自訂科目 —</option>${known.map(o => `<option value="${esc(o.name)}"${o.name === current ? ' selected' : ''}>${esc(o.name)}</option>`).join('')}${extra}<option value="__custom__">＋ 自訂科目…</option>`;
}
function pcGeneralCategoryChanged(select) {
  if (select.value !== '__custom__') return;
  const value = prompt('請輸入自訂科目名稱', '') || '';
  if (!value.trim()) { select.selectedIndex = 0; return; }
  const option = document.createElement('option'); option.value = value.trim(); option.textContent = value.trim() + '（自訂）'; option.selected = true;
  select.insertBefore(option, select.lastElementChild);
}

// 開啟新增/編輯月報 modal（id 缺省 = 新增）
async function pcOpenReportModal(id) {
  pcModalEditingId = id || null;
  pcModalEntries = [];
  pcModalReturnToDetail = !!pcDetail && pcDetail.id === id;
  pcOpeningSource = 'manual';
  const today = _pcIso(new Date());
  let d = {
    start_date: today, end_date: today, filename_text: '', upload_person: '',
    prepared_by: '', opening_balance: 0, opening_balance_source: 'manual',
    status: 'draft', entries: []
  };
  try {
    const optionRes = await fetch('/api/petty-cash-options?report_type=general&option_type=category');
    if (optionRes.ok) pcGeneralOptions.category = (await optionRes.json()).items || [];
  } catch (e) { /* 選單載入失敗仍允許輸入自訂科目 */ }
  if (id) {
    try {
      const res = await fetch('/api/petty-cash-reports/' + id);
      if (!res.ok) return toast('⚠️ 讀取失敗');
      d = await res.json();
    } catch(e) { return toast('⚠️ 網路錯誤：' + e.message); }
  }
  pcModalEntries = (d.entries || []).map((e, i) => ({
    _key: 'e' + Date.now() + '_' + i,
    entry_date: e.entry_date, entry_type: e.entry_type, description: e.description,
    amount: e.amount, category: e.category || '', sort_order: e.sort_order || i,
    items: (e.items || []).map((it, j) => ({
      _key: 't' + Date.now() + '_' + i + '_' + j,
      item_name: it.item_name, qty: it.qty, unit: it.unit || '', amount: it.amount
    }))
  }));
  pcOpeningSource = d.opening_balance_source || 'manual';
  const el = document.getElementById('content');
  el.insertAdjacentHTML('beforeend', `
    <div id="pc-report-overlay" class="pc-overlay open" onclick="if(event.target===this)pcCloseReportModal()">
      <div class="pc-modal" role="dialog" aria-label="零用金月報">
        <div class="pc-modal__hd"><h3 id="pc-modal-title">${id ? '✏️ 編輯零用金月報' : '＋ 新增零用金月報'}</h3><button class="pc-btn-sm" onclick="pcCloseReportModal()">✕</button></div>
        <div class="pc-modal__bd">
          <div class="pc-steps">
            <button type="button" class="pc-step active" id="pc-step-1-tab" onclick="pcModalGotoStep(1)">① 基本資料</button>
            <button type="button" class="pc-step" id="pc-step-2-tab" onclick="pcModalGotoStep(2)">② 收支明細</button>
          </div>
          <div id="pc-step-1">
            <div class="pc-form-grid pc-form-grid--two">
              <div class="pc-field"><label>報表期間（起） <span class="pc-required">*</span></label><input id="pc-m-start" type="date" value="${esc(d.start_date)}"></div>
              <div class="pc-field"><label>報表期間（迄） <span class="pc-required">*</span></label><input id="pc-m-end" type="date" value="${esc(d.end_date)}"></div>
              <div class="pc-field"><label>檔名文字 <span class="pc-required">*</span></label><input id="pc-m-filetext" type="text" placeholder="例：資材" value="${esc(d.filename_text)}" oninput="pcUpdateFilenamePreview()"></div>
              <div class="pc-field"><label>上傳人姓名 <span class="pc-required">*</span></label><input id="pc-m-uploader" type="text" list="pc-persons-list" placeholder="例：王小明" value="${esc(d.upload_person)}" oninput="pcUploaderChanged()"></div>
              <div class="pc-field"><label>製表人 <span class="pc-required">*</span></label><input id="pc-m-prepared" type="text" placeholder="預設同上傳人，可修改" value="${esc(d.prepared_by)}"></div>
              <div class="pc-field"><label>上期餘額</label><input id="pc-m-opening" type="number" min="0" step="0.01" value="${esc(d.opening_balance)}" oninput="pcOpeningEdited()"></div>
            </div>
            <datalist id="pc-persons-list">${pcPersons.map(p => `<option value="${esc(p)}">`).join('')}</datalist>
            <div class="pc-filename-preview" id="pc-filename-preview"></div>
            <div class="pc-balance-hint" id="pc-opening-hint"></div>
            <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
              <button class="pc-btn-sm" onclick="pcFetchPreviousBalance()">🔍 帶入上一期餘額</button>
            </div>
          </div>
          <div id="pc-step-2" style="display:none">
            <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap">
              <button class="pc-btn-sm pc-btn-sm--primary" onclick="pcOpenEntryModal()">＋ 新增紀錄</button>
            </div>
            <div id="pc-modal-entries"></div>
            <div class="pc-summary-bar">
              <span>收入 <strong class="pc-kpi-income" id="pc-sum-income">$0</strong></span>
              <span>支出 <strong class="pc-kpi-expense" id="pc-sum-expense">$0</strong></span>
              <span>餘額 <strong class="pc-kpi-balance" id="pc-sum-closing">$0</strong></span>
            </div>
          </div>
        </div>
        <div class="pc-modal__ft">
          <span id="pc-modal-step-ops-1">
            <button class="pc-btn pc-btn--ghost" onclick="pcCloseReportModal()">取消</button>
            <button class="pc-btn pc-btn--primary" onclick="pcModalGotoStep(2)">下一步：填寫明細 →</button>
          </span>
          <span id="pc-modal-step-ops-2" style="display:none">
            <button class="pc-btn pc-btn--ghost" onclick="pcModalGotoStep(1)">← 上一步</button>
            <button class="pc-btn pc-btn--ghost" onclick="pcCloseReportModal()">取消</button>
            <button class="pc-btn pc-btn--ghost" onclick="pcModalSave('draft')">儲存草稿</button>
            <button class="pc-btn pc-btn--primary" onclick="pcModalSave('completed')">儲存完成</button>
          </span>
        </div>
      </div>
    </div>`);
  document.getElementById('pc-m-start').addEventListener('change', pcUpdateFilenamePreview);
  document.getElementById('pc-m-end').addEventListener('change', pcUpdateFilenamePreview);
  pcUpdateFilenamePreview();
  pcUpdateOpeningHint();
  pcModalRenderEntries();
}

// 上傳人變更 → 製表人空白時預設同上傳人
function pcUploaderChanged() {
  const u = document.getElementById('pc-m-uploader').value.trim();
  const p = document.getElementById('pc-m-prepared');
  if (p && !p.value.trim() && u) p.value = u;
}

// 檔名即時預覽（顯示用含斜線；實際下載由後端轉安全格式）
function pcUpdateFilenamePreview() {
  const ft = (document.getElementById('pc-m-filetext').value || '').trim() || '？';
  const s = document.getElementById('pc-m-start').value;
  const e = document.getElementById('pc-m-end').value;
  document.getElementById('pc-filename-preview').textContent =
    `預覽檔名：零用金-${ft}${_pcMD(s) || '？'}~${_pcMD(e) || '？'}.xlsx`;
}

// 上期餘額提示（auto 帶入可改；手改後不再被覆蓋）
function pcUpdateOpeningHint() {
  const hint = document.getElementById('pc-opening-hint');
  if (!hint) return;
  if (pcOpeningSource === 'auto') {
    hint.className = 'pc-balance-hint pc-balance-hint--auto';
    hint.textContent = '✓ 已從上一期自動帶入，可手動修改（修改後不再自動覆蓋）。';
  } else {
    hint.className = 'pc-balance-hint pc-balance-hint--manual';
    hint.textContent = '⚠ 未找到上一期資料或已手動輸入，請確認上期餘額。';
  }
}

// 使用者手改上期餘額 → 轉 manual，避免 reload 蓋掉
function pcOpeningEdited() {
  pcOpeningSource = 'manual';
  pcUpdateOpeningHint();
}

// 向後端查詢同一上傳人的上一期本期餘額
async function pcFetchPreviousBalance() {
  const uploader = document.getElementById('pc-m-uploader').value.trim();
  const start = document.getElementById('pc-m-start').value;
  if (!uploader) return toast('⚠️ 請先填上傳人姓名');
  if (!start) return toast('⚠️ 請先選報表開始日期');
  try {
    const p = new URLSearchParams({ upload_person: uploader, before: start });
    const res = await fetch('/api/petty-cash-reports/previous-balance?' + p);
    if (!res.ok) return toast('⚠️ 查詢失敗');
    const data = await res.json();
    if (!data.found) {
      pcOpeningSource = 'manual';
      pcUpdateOpeningHint();
      return toast('⚠️ ' + (data.message || '未找到上一期'));
    }
    document.getElementById('pc-m-opening').value = data.opening_balance;
    pcOpeningSource = 'auto';
    pcUpdateOpeningHint();
    toast(`✅ 已帶入上一期餘額 $${data.opening_balance}（${data.previous_period}）`);
  } catch(e) { toast('⚠️ 網路錯誤：' + e.message); }
}

// 步驟切換
function pcModalGotoStep(n) {
  if (n === 2 && !pcValidateBasic(true)) return;
  document.getElementById('pc-step-1').style.display = n === 1 ? '' : 'none';
  document.getElementById('pc-step-2').style.display = n === 2 ? '' : 'none';
  document.getElementById('pc-step-1-tab').classList.toggle('active', n === 1);
  document.getElementById('pc-step-2-tab').classList.toggle('active', n === 2);
  document.getElementById('pc-modal-step-ops-1').style.display = n === 1 ? '' : 'none';
  document.getElementById('pc-modal-step-ops-2').style.display = n === 2 ? '' : 'none';
  if (n === 2) pcModalRenderEntries();
}

// 基本資料驗證（quiet 僅回傳布林）
function pcValidateBasic(quiet) {
  const fail = m => { if (!quiet) toast('⚠️ ' + m); return false; };
  const s = document.getElementById('pc-m-start').value;
  const e = document.getElementById('pc-m-end').value;
  if (!s || !e) return fail('請選擇報表期間');
  if (s > e) return fail('開始日期不可晚於結束日期');
  if (!document.getElementById('pc-m-filetext').value.trim()) return fail('請填檔名文字');
  if (!document.getElementById('pc-m-uploader').value.trim()) return fail('請填上傳人姓名');
  if (!document.getElementById('pc-m-prepared').value.trim()) return fail('請填製表人');
  const opening = Number(document.getElementById('pc-m-opening').value);
  if (!isFinite(opening) || opening < 0) return fail('上期餘額需為 ≥0 的數字');
  return true;
}

// modal 內收支列表 + 即時合計
function pcModalRenderEntries() {
  const box = document.getElementById('pc-modal-entries');
  if (!box) return;
  if (!pcModalEntries.length) {
    box.innerHTML = '<div class="pc-empty"><div>尚未新增收支紀錄</div><div class="pc-hint">按「＋ 新增紀錄」開始記帳</div></div>';
    let income = 0, expense = 0;
    const opening = Number(document.getElementById('pc-m-opening').value) || 0;
    document.getElementById('pc-sum-income').textContent = '$' + _pcMoney(income);
    document.getElementById('pc-sum-expense').textContent = '$' + _pcMoney(expense);
    document.getElementById('pc-sum-closing').textContent = '$' + _pcMoney(opening + income - expense);
    return;
  }
  // Sort by date (oldest first), then by original index
  const sorted = pcModalEntries.map((e, i) => ({...e, _origIdx: i}))
    .sort((a, b) => a.entry_date !== b.entry_date ? (a.entry_date < b.entry_date ? -1 : 1) : a._origIdx - b._origIdx);
  // Group by date
  const groups = {};
  const groupOrder = [];
  sorted.forEach(e => {
    if (!groups[e.entry_date]) { groups[e.entry_date] = []; groupOrder.push(e.entry_date); }
    groups[e.entry_date].push(e);
  });
  let html = '';
  groupOrder.forEach(date => {
    const entries = groups[date];
    const collapsible = entries.length > 1;
    html += '<div class="pc-entry-date-group">';
    html += '<div class="pc-entry-date-header' + (collapsible ? ' collapsible' : '') + '"'
      + (collapsible ? " onclick=\"this.parentElement.classList.toggle('collapsed')\"" : '') + '>';
    html += '<span class="pc-entry-date-label">' + esc(_pcDate(date)) + '</span>';
    html += '<span class="pc-entry-date-count">' + entries.length + ' 筆</span>';
    if (collapsible) html += '<span class="pc-entry-date-toggle">▼</span>';
    html += '</div>';
    html += '<div class="pc-entry-date-body">';
    entries.forEach(e => {
      html += pcModalEntryCardHtml(e, e._origIdx);
    });
    html += '</div></div>';
  });
  box.innerHTML = html;
  // Calculate sums
  let income = 0, expense = 0;
  pcModalEntries.forEach(e => {
    const a = Number(e.amount) || 0;
    if (e.entry_type === 'income') income += a; else expense += a;
  });
  const opening = Number(document.getElementById('pc-m-opening').value) || 0;
  document.getElementById('pc-sum-income').textContent = '$' + _pcMoney(income);
  document.getElementById('pc-sum-expense').textContent = '$' + _pcMoney(expense);
  document.getElementById('pc-sum-closing').textContent = '$' + _pcMoney(opening + income - expense);
}
// modal 內單筆 entry 卡（內部 state 已由 input 驗證，文字 esc）
function pcModalEntryCardHtml(e, i) {
  const amt = e.entry_type === 'income'
    ? `<span class="pc-entry-card__amt pc-kpi-income">+$${esc(_pcMoney(e.amount))}</span>`
    : `<span class="pc-entry-card__amt pc-kpi-expense">-$${esc(_pcMoney(e.amount))}</span>`;
  const itemsHtml = (e.items && e.items.length)
    ? `<ul class="pc-entry-card__items">${e.items.map(it =>
        `<li>${esc(it.item_name)} ${esc(Number(it.qty))}${esc(it.unit || '')} $${esc(it.amount)}</li>`).join('')}</ul>`
    : '';
  return `<div class="pc-entry-card pc-entry-card--clickable" role="button" tabindex="0" onclick="pcOpenEntryModal(${i})" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){pcOpenEntryModal(${i})}">
    <div class="pc-entry-card__top">
      <span class="pc-entry-card__date">${esc(_pcDate(e.entry_date))}</span>
      <span class="pc-entry-card__desc">${esc(e.description)}</span>
      ${amt}
      ${e.category ? `<span class="pc-entry-card__cat">${esc(e.category)}</span>` : ''}
    </div>
    ${itemsHtml}
    <div class="pc-entry-card__ops">
      <button class="pc-btn-sm" onclick="event.stopPropagation();pcOpenEntryModal(${i})">✏️ 編輯</button>
      <button class="pc-btn-sm pc-btn-sm--danger" onclick="event.stopPropagation();pcEntryDelete(${i})">🗑 刪除</button>
    </div>
  </div>`;
}

// 開啟收支紀錄 modal（idx 缺省 = 新增）
function pcOpenEntryModal(idx) {
  pcEntryEditIndex = (typeof idx === 'number') ? idx : -1;
  const src = pcEntryEditIndex >= 0 ? pcModalEntries[pcEntryEditIndex]
    : { entry_date: _pcIso(new Date()),
        entry_type: 'expense', description: '', amount: '', category: '', items: [] };
  pcEntryType = src.entry_type || 'expense';
  pcEntryItemDraft = (src.items || []).map((it, j) => ({
    _key: 'x' + Date.now() + '_' + j,
    item_name: it.item_name, qty: it.qty, unit: it.unit || '', amount: it.amount
  }));
  document.getElementById('content').insertAdjacentHTML('beforeend', `
    <div id="pc-entry-overlay" class="pc-overlay open" onclick="if(event.target===this)pcCloseEntryModal()">
      <div class="pc-modal" role="dialog" aria-label="收支紀錄" style="max-width:640px">
        <div class="pc-modal__hd"><h3>${pcEntryEditIndex >= 0 ? '✏️ 編輯紀錄' : '＋ 新增紀錄'}</h3><button class="pc-btn-sm" onclick="pcCloseEntryModal()">✕</button></div>
        <div class="pc-modal__bd">
          <div class="pc-steps">
            <button class="pc-step pc-step--income${pcEntryType === 'income' ? ' active' : ''}" id="pc-type-income" onclick="pcEntrySetType('income')">💰 收入</button>
            <button class="pc-step pc-step--expense${pcEntryType === 'expense' ? ' active' : ''}" id="pc-type-expense" onclick="pcEntrySetType('expense')">💸 支出</button>
          </div>
          <div class="pc-form-grid pc-form-grid--two">
            <div class="pc-field"><label>日期 <span class="pc-required">*</span></label><input id="pc-e-date" type="date" value="${esc(src.entry_date)}"></div>
            <div class="pc-field"><label>科目</label><select id="pc-e-category" onchange="pcGeneralCategoryChanged(this)">${pcGeneralCategoryOptions(src.category || '')}</select></div>
          </div>
          <div class="pc-field" style="margin-top:10px"><label>摘要 <span class="pc-required" id="pc-e-desc-req">*</span></label><input id="pc-e-desc" type="text" placeholder="例：零用金 / 畚箕 ×1" value="${esc(src.description || '')}"></div>
          <div class="pc-field" style="margin-top:10px"><label>總金額 <span class="pc-required">*</span></label><input id="pc-e-amount" type="number" min="0.01" step="0.01" placeholder="例：1334" value="${esc(src.amount)}" oninput="pcEntryAmountHint()"></div>
          <div id="pc-entry-items-wrap" style="margin-top:10px;${pcEntryType === 'income' ? 'display:none' : ''}">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
              <strong>明細項目</strong>
              <button class="pc-btn-sm" onclick="pcEntryAddItemRow()">＋ 新增項目</button>
            </div>
            <div class="pc-items-header"><span>項目名稱</span><span>數量</span><span>單位</span><span>金額</span><span>刪除</span></div>
            <div id="pc-entry-items"></div>
            <div class="pc-balance-hint" id="pc-entry-amount-hint"></div>
          </div>
        </div>
        <div class="pc-modal__ft">
          <button class="pc-btn pc-btn--ghost" onclick="pcCloseEntryModal()">取消</button>
          <button class="pc-btn pc-btn--primary" onclick="pcEntrySave()">確定</button>
        </div>
      </div>
    </div>`);
  pcEntryRenderItems();
  pcEntryAmountHint();
  pcUpdateDescRequired();
}

// 收支類型切換（收入不可帶明細：切換即清空項目草稿）
function pcEntrySetType(t) {
  pcEntryType = t;
  document.getElementById('pc-type-income').classList.toggle('active', t === 'income');
  document.getElementById('pc-type-expense').classList.toggle('active', t === 'expense');
  document.getElementById('pc-entry-items-wrap').style.display = t === 'income' ? 'none' : '';
  if (t === 'income') pcEntryItemDraft = [];
  pcEntryAmountHint();
  pcUpdateDescRequired();
}

// 明細項目列渲染
function pcEntryRenderItems() {
  const box = document.getElementById('pc-entry-items');
  box.innerHTML = pcEntryItemDraft.map((it, i) => `
    <div class="pc-item-row">
      <input data-k="item_name" data-i="${i}" placeholder="品項名稱" value="${esc(it.item_name || '')}">
      <input data-k="qty" data-i="${i}" type="number" min="0.01" step="0.01" placeholder="數量" value="${esc(it.qty ?? '')}">
      <input data-k="unit" data-i="${i}" placeholder="單位" value="${esc(it.unit || '')}">
      <input data-k="amount" data-i="${i}" type="number" min="0.01" step="0.01" placeholder="金額" value="${esc(it.amount ?? '')}">
      <button class="pc-btn-sm pc-btn-sm--danger" onclick="pcEntryRemoveItem(${i})">✕</button>
    </div>`).join('');
  box.querySelectorAll('input').forEach(inp => inp.addEventListener('input', () => {
    const row = pcEntryItemDraft[Number(inp.dataset.i)];
    if (row) row[inp.dataset.k] = inp.value;
    pcEntryAmountHint();
  }));
  pcEntryAmountHint();
  pcUpdateDescRequired();
}

// 新增明細項目列
function pcEntryAddItemRow() {
  pcEntryItemDraft.push({ _key: 'x' + Date.now(), item_name: '', qty: '', unit: '', amount: '' });
  pcEntryRenderItems();
}

// 刪除明細項目列
function pcEntryRemoveItem(i) {
  pcEntryItemDraft.splice(i, 1);
  pcEntryRenderItems();
}

// 摘要必填標記：有明細項目時摘要改非必填
function pcUpdateDescRequired() {
  const req = document.getElementById('pc-e-desc-req');
  if (!req) return;
  const hasItems = pcEntryType === 'expense' && pcEntryItemDraft.length > 0;
  req.style.display = hasItems ? 'none' : '';
}

// 明細合計 vs 支出總額一致性提醒（僅提醒不擋存，匯出前再次顯示）
function pcEntryAmountHint() {
  const hint = document.getElementById('pc-entry-amount-hint');
  if (!hint) return;
  if (pcEntryType !== 'expense' || !pcEntryItemDraft.length) { hint.textContent = ''; return; }
  const total = pcEntryItemDraft.reduce((s, it) => s + (Number(it.amount) || 0), 0);
  const amt = Number(document.getElementById('pc-e-amount').value) || 0;
  hint.className = 'pc-balance-hint ' + (Math.abs(total - amt) > 0.005 ? 'pc-balance-hint--manual' : 'pc-balance-hint--auto');
  hint.textContent = Math.abs(total - amt) > 0.005
    ? `⚠️ 明細合計 $${_pcMoney(total)} 與支出總額 $${_pcMoney(amt)} 不一致，請確認。`
    : `✓ 明細合計 $${_pcMoney(total)} 與支出總額一致。`;
}

// 收支紀錄存檔（驗證後寫入 modal 暫存）
function pcEntrySave() {
  const date = document.getElementById('pc-e-date').value;
  const desc = document.getElementById('pc-e-desc').value.trim();
  const amount = Number(document.getElementById('pc-e-amount').value);
  const category = document.getElementById('pc-e-category').value.trim();
  if (!date) return toast('⚠️ 請選日期');
  const ps = document.getElementById('pc-m-start').value;
  const pe = document.getElementById('pc-m-end').value;
  if ((ps && date < ps) || (pe && date > pe)) return toast('⚠️ 收支日期必須落在報表期間內');
  const hasItems = pcEntryType === 'expense' && pcEntryItemDraft.length > 0;
  if (!desc && !hasItems) return toast('⚠️ 請填摘要（或新增明細項目以取代摘要）');
  if (!isFinite(amount) || amount <= 0) return toast('⚠️ 金額需 > 0');
  let items = [];
  if (pcEntryType === 'expense') {
    for (const it of pcEntryItemDraft) {
      const nm = (it.item_name || '').trim();
      const q = Number(it.qty);
      const a = Number(it.amount);
      if (!nm) return toast('⚠️ 明細品項名稱不可空白');
      if (!isFinite(q) || q <= 0) return toast('⚠️ 明細數量需 > 0');
      if (!isFinite(a) || a <= 0) return toast('⚠️ 明細金額需 > 0');
      items.push({ _key: it._key, item_name: nm, qty: q, unit: (it.unit || '').trim(), amount: a });
    }
  }
  const rec = {
    _key: pcEntryEditIndex >= 0 ? pcModalEntries[pcEntryEditIndex]._key : 'e' + Date.now(),
    entry_date: date, entry_type: pcEntryType, description: desc,
    amount, category, sort_order: pcEntryEditIndex >= 0 ? pcModalEntries[pcEntryEditIndex].sort_order : pcModalEntries.length,
    items
  };
  if (pcEntryEditIndex >= 0) pcModalEntries[pcEntryEditIndex] = rec;
  else pcModalEntries.push(rec);
  pcCloseEntryModal();
  pcModalRenderEntries();
}

// 刪除暫存收支紀錄
function pcEntryDelete(i) {
  if (!confirm('確定刪除這筆收支紀錄？')) return;
  pcModalEntries.splice(i, 1);
  pcModalRenderEntries();
}

// 關閉收支 modal
function pcCloseEntryModal() {
  document.getElementById('pc-entry-overlay')?.remove();
}

// 月報存檔（草稿/完成皆完整驗證；後端再驗一次）
async function pcModalSave(status) {
  if (!pcValidateBasic(false)) { pcModalGotoStep(1); return; }
  const body = {
    start_date: document.getElementById('pc-m-start').value,
    end_date: document.getElementById('pc-m-end').value,
    filename_text: document.getElementById('pc-m-filetext').value.trim(),
    upload_person: document.getElementById('pc-m-uploader').value.trim(),
    prepared_by: document.getElementById('pc-m-prepared').value.trim(),
    opening_balance: Number(document.getElementById('pc-m-opening').value) || 0,
    opening_balance_source: pcOpeningSource,
    status,
    entries: pcModalEntries.map((e, i) => ({
      entry_date: e.entry_date, entry_type: e.entry_type, description: e.description,
      amount: e.amount, category: e.category || '', sort_order: i,
      items: (e.items || []).map((it, j) => ({
        item_name: it.item_name, qty: it.qty, unit: it.unit || '', amount: it.amount, sort_order: j
      }))
    }))
  };
  try {
    const url = pcModalEditingId ? '/api/petty-cash-reports/' + pcModalEditingId : '/api/petty-cash-reports';
    const res = await fetch(url, {
      method: pcModalEditingId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 409 && data.detail) return toast('⚠️ ' + data.detail);
      return toast('⚠️ ' + (data.detail || '儲存失敗'));
    }
    toast(status === 'completed' ? '✅ 已儲存完成' : '✅ 草稿已儲存');
    const savedId = data.id || pcModalEditingId;
    pcCloseReportModal();
    if (pcModalReturnToDetail && savedId) pcOpenDetail(savedId);
    else { pcDetail = null; renderPettyCash(); }
  } catch(e) { toast('⚠️ 網路錯誤：' + e.message); }
}

// 關閉月報 modal
function pcCloseReportModal() {
  document.getElementById('pc-report-overlay')?.remove();
}
