// 庫存管理系統 - 報價單頁（CRUD、歷史、庫存帶入與匯出）
var quotationItems = [];
var quotationEditingId = null;
var quotationHistory = [];
var quotationInventoryResults = [];
var quotationForm = {};

function quoteMoney(value) {
  return Number(value || 0).toLocaleString('zh-TW', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
function quoteNumber(value) {
  var number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}
function quoteToday() { return new Date().toISOString().slice(0, 10); }
function quoteBlankForm() {
  return { quote_number: '', quote_date: quoteToday(), customer_name: '', contact: '', address: '', valid_days: 30, tax_type: 'included', note: '' };
}
function quoteReadForm() {
  return {
    quote_number: document.getElementById('quote-number')?.value.trim() || '',
    quote_date: document.getElementById('quote-date')?.value || '',
    customer_name: document.getElementById('quote-customer')?.value.trim() || '',
    contact: document.getElementById('quote-contact')?.value.trim() || '',
    address: document.getElementById('quote-address')?.value.trim() || '',
    valid_days: Math.max(1, Number(document.getElementById('quote-valid-days')?.value || 30)),
    tax_type: document.getElementById('quote-tax')?.value || 'included',
    note: document.getElementById('quote-note')?.value.trim() || '',
  };
}
function quoteFillForm(form) {
  Object.entries({ 'quote-number': form.quote_number, 'quote-date': form.quote_date, 'quote-customer': form.customer_name, 'quote-contact': form.contact, 'quote-address': form.address, 'quote-valid-days': form.valid_days, 'quote-tax': form.tax_type, 'quote-note': form.note }).forEach(function(pair) {
    var el = document.getElementById(pair[0]); if (el) el.value = pair[1] ?? '';
  });
}

function quoteModeTabs(active) {
  return `<div class="quote-mode-tabs" role="tablist"><button type="button" class="quote-mode-tab ${active === 'quotation' ? 'active' : ''}" onclick="quoteSwitchMode('quotation')">🧾 報價單</button><button type="button" class="quote-mode-tab ${active === 'upload' ? 'active' : ''}" onclick="quoteSwitchMode('upload')">📤 報價單上傳</button></div>`;
}
function quoteSwitchMode(mode) {
  var content = document.getElementById('content');
  if (content) {
    content.classList.toggle('quotation-content', mode === 'quotation');
    content.classList.toggle('quotation-upload-content', mode === 'upload');
  }
  if (mode === 'upload') renderQuotationUploads();
  else renderQuotation();
}

function renderQuotation() {
  var el = document.getElementById('content');
  if (!el) return;
  if (!quotationForm.quote_date) quotationForm = quoteBlankForm();
  if (!quotationItems.length) quotationItems = [{ inventory_item_id: null, item_name: '', specification: '', qty: 1, unit: '式', unit_price: 0 }];
  var pageTitle = quotationEditingId ? '編輯報價單' : '報價單';
  var saveLabel = quotationEditingId ? '更新報價單' : '儲存報價單';
  el.innerHTML = `
    <div class="quote-wrap">
      ${quoteModeTabs('quotation')}
      <div class="dsr-page-header quote-page-header">
        <div class="dsr-page-title"><h1>🧾 ${esc(pageTitle)} <span class="dsr-new-badge">NEW</span></h1><p>建立冷凍空調工程報價單，整理客戶資料與報價明細。</p></div>
        <div class="dsr-page-actions"><button class="dsr-btn dsr-btn--ghost" onclick="quoteReset()">清除表單</button><button class="dsr-btn dsr-btn--primary" onclick="quoteSave()">💾 ${esc(saveLabel)}</button></div>
      </div>
      <div class="quote-layout">
        <section class="dsr-card quote-card" aria-labelledby="quote-basic-title"><div class="dsr-card__hd"><h2 id="quote-basic-title">📋 報價單資料</h2><p>建立日期與有效期限</p></div><div class="dsr-card__bd">
          <div class="dsr-form-grid dsr-form-grid--two">
            <div class="dsr-field"><label for="quote-number">報價單號</label><input id="quote-number" type="text" placeholder="留白自動編號"></div>
            <div class="dsr-field"><label for="quote-date">報價日期 <span class="dsr-required">*</span></label><input id="quote-date" type="date"></div>
            <div class="dsr-field"><label for="quote-customer">客戶名稱 <span class="dsr-required">*</span></label><input id="quote-customer" type="text" placeholder="例：振佳空調工程行"></div>
            <div class="dsr-field"><label for="quote-contact">聯絡人／電話</label><input id="quote-contact" type="text" placeholder="例：王先生／02-1234-5678"></div>
            <div class="dsr-field"><label for="quote-valid-days">報價有效天數</label><input id="quote-valid-days" type="number" min="1" max="3650" value="30"></div>
            <div class="dsr-field"><label for="quote-tax">稅別</label><select id="quote-tax"><option value="included">含稅</option><option value="excluded">未稅</option></select></div>
          </div>
          <div class="dsr-field quote-field-gap"><label for="quote-address">工程地址</label><input id="quote-address" type="text" placeholder="例：台北市○○區○○路 100 號"></div>
          <div class="dsr-field quote-field-gap"><label for="quote-note">備註／付款條件</label><textarea id="quote-note" rows="3" placeholder="例：訂金 30%，完工驗收後付清"></textarea></div>
        </div></section>
        <aside class="quote-side"><div class="dsr-info"><h3>💡 報價流程</h3><ul><li><span class="dsr-badge">1</span>填寫客戶與工程基本資料</li><li><span class="dsr-badge">2</span>從庫存帶入或新增報價明細</li><li><span class="dsr-badge">3</span>確認數量、單價與合計金額</li><li><span class="dsr-badge">4</span>儲存後可編輯、刪除、列印或匯出</li></ul><div class="dsr-info-badges"><span class="dsr-badge">🧾 可保存歷史</span><span class="dsr-badge">📱 手機可編輯</span></div></div>
          <div class="dsr-card quote-summary-card"><div class="dsr-card__hd"><h2>📊 金額摘要</h2><p>即時試算</p></div><div class="dsr-card__bd"><div class="quote-summary-row"><span>明細項目</span><strong id="quote-summary-count">0 項</strong></div><div class="quote-summary-row"><span>未稅小計</span><strong id="quote-summary-subtotal">$0</strong></div><div class="quote-summary-row"><span>稅額</span><strong id="quote-summary-tax">$0</strong></div><div class="quote-summary-total"><span>報價總額</span><strong id="quote-summary-total">$0</strong></div></div></div></aside>
        <section class="dsr-card quote-card quote-items-card"><div class="dsr-card__hd"><div class="quote-items-heading"><h2>🛠️ 報價明細</h2><p>材料、設備、人工與其他費用</p></div><div class="quote-items-actions"><button class="dsr-btn dsr-btn--ghost" onclick="quoteOpenInventory()">📦 從庫存帶入</button><button class="dsr-btn dsr-btn--primary" onclick="quoteAddItem()">＋ 新增明細</button></div></div><div class="dsr-card__bd" style="padding-top:0"><div class="quote-items-table-wrap"><table class="quote-items-table"><thead><tr><th>品項名稱</th><th>規格／說明</th><th>數量</th><th>單位</th><th>單價</th><th>小計</th><th>操作</th></tr></thead><tbody id="quote-items-body"></tbody></table></div></div></section>
        <section class="dsr-card quote-card quote-history-card"><div class="dsr-card__hd"><div class="quote-items-heading"><h2>🗂️ 歷史報價單</h2><p>可搜尋、編輯、刪除與匯出</p></div><div class="quote-history-filter"><input id="quote-history-q" type="search" placeholder="搜尋報價單號／客戶"><button class="dsr-btn dsr-btn--ghost" onclick="quoteLoadHistory()">搜尋</button></div></div><div class="dsr-card__bd" style="padding-top:0"><div id="quote-history-list" class="quote-history-list"></div><div id="quote-history-empty" class="dsr-empty" style="display:none"><div class="dsr-empty__icon">🗂</div><div>目前沒有歷史報價單</div></div></div></section>
      </div>
    </div>
    <div id="quote-inventory-overlay" class="quote-overlay" onclick="if(event.target===this)quoteCloseInventory()"><div class="quote-inventory-modal"><div class="dsr-modal__hd"><h3>📦 從庫存帶入品項</h3><button class="dsr-btn-sm" onclick="quoteCloseInventory()">✕ 關閉</button></div><div class="quote-inventory-search"><input id="quote-inventory-q" type="search" placeholder="搜尋品項、品牌或型號"><button class="dsr-btn dsr-btn--primary" onclick="quoteSearchInventory()">搜尋</button></div><div id="quote-inventory-list" class="quote-inventory-list"></div></div></div>`;
  quoteFillForm(quotationForm); quoteRenderItems(); quoteLoadHistory();
}

function quoteRenderItems() {
  var body = document.getElementById('quote-items-body'); if (!body) return;
  body.innerHTML = quotationItems.map(function(item, index) { return `<tr data-index="${esc(String(index))}"><td data-label="品項名稱"><input class="quote-line-input" data-field="item_name" type="text" value="${esc(item.item_name)}" placeholder="例：分離式冷氣安裝"></td><td data-label="規格／說明"><input class="quote-line-input" data-field="specification" type="text" value="${esc(item.specification)}" placeholder="例：3.6kW，含基本安裝"></td><td data-label="數量"><input class="quote-line-input quote-number-input" data-field="qty" type="number" min="0.01" step="any" value="${esc(String(item.qty))}"></td><td data-label="單位"><input class="quote-line-input quote-unit-input" data-field="unit" type="text" value="${esc(item.unit)}"></td><td data-label="單價"><input class="quote-line-input quote-number-input" data-field="unit_price" type="number" min="0" step="any" value="${esc(String(item.unit_price))}"></td><td data-label="小計" class="quote-line-total">$${esc(String(quoteMoney(quoteNumber(item.qty) * quoteNumber(item.unit_price))))}</td><td data-label="操作"><button class="dsr-action-btn dsr-action-btn--danger" type="button" data-remove-index="${esc(String(index))}">刪除</button></td></tr>`; }).join('');
  body.querySelectorAll('.quote-line-input').forEach(function(input) { input.addEventListener('input', function() { var item = quotationItems[Number(input.closest('tr').dataset.index)]; var field = input.dataset.field; item[field] = ['qty', 'unit_price'].includes(field) ? quoteNumber(input.value) : input.value; quoteUpdateTotals(); }); });
  body.querySelectorAll('[data-remove-index]').forEach(function(button) { button.addEventListener('click', function() { quotationItems.splice(Number(button.dataset.removeIndex), 1); if (!quotationItems.length) quoteAddItem(); else quoteRenderItems(); }); });
  quoteUpdateTotals();
}
function quoteUpdateTotals() {
  var lineTotal = quotationItems.reduce(function(sum, item) { return sum + quoteNumber(item.qty) * quoteNumber(item.unit_price); }, 0);
  var included = document.getElementById('quote-tax')?.value === 'included'; var tax = included ? lineTotal * 5 / 105 : lineTotal * .05; var subtotal = included ? lineTotal - tax : lineTotal; var total = included ? lineTotal : lineTotal + tax;
  var values = [['quote-summary-count', quotationItems.length + ' 項'], ['quote-summary-subtotal', '$' + quoteMoney(subtotal)], ['quote-summary-tax', '$' + quoteMoney(tax)], ['quote-summary-total', '$' + quoteMoney(total)]];
  values.forEach(function(pair) { var el = document.getElementById(pair[0]); if (el) el.textContent = pair[1]; });
  document.querySelectorAll('.quote-line-total').forEach(function(cell, index) { var item = quotationItems[index]; if (item) cell.textContent = '$' + quoteMoney(quoteNumber(item.qty) * quoteNumber(item.unit_price)); });
}
function quoteAddItem() { quotationItems.push({ inventory_item_id: null, item_name: '', specification: '', qty: 1, unit: '式', unit_price: 0 }); quoteRenderItems(); }
function quoteReset() { quotationEditingId = null; quotationForm = quoteBlankForm(); quotationItems = []; renderQuotation(); }
function quotePayload() { var form = quoteReadForm(); if (!form.quote_date || !form.customer_name) { toast('⚠️ 請填寫報價日期與客戶名稱'); return null; } if (quotationItems.some(function(item) { return !item.item_name.trim() || item.qty <= 0 || item.unit_price < 0; })) { toast('⚠️ 請確認每筆明細的品項、數量與單價'); return null; } return Object.assign(form, { items: quotationItems }); }
async function quoteSave() { var payload = quotePayload(); if (!payload) return; try { var url = quotationEditingId ? '/api/quotations/' + quotationEditingId : '/api/quotations'; var res = await fetch(url, { method: quotationEditingId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); var data = await res.json(); if (!res.ok) throw new Error(data.detail || '儲存失敗'); quotationEditingId = data.id; quotationForm = data; quotationItems = data.items; toast('✅ 報價單已儲存'); renderQuotation(); } catch (e) { toast('⚠️ ' + e.message, 'error'); } }
async function quoteLoadHistory() { var list = document.getElementById('quote-history-list'); if (!list) return; var q = document.getElementById('quote-history-q')?.value.trim() || ''; try { var res = await fetch('/api/quotations?q=' + encodeURIComponent(q)); var data = await res.json(); if (!res.ok) throw new Error(data.detail || '歷史報價單載入失敗'); quotationHistory = data.items || []; list.innerHTML = quotationHistory.map(function(item) { return `<div class="quote-history-row"><div><strong>${esc(item.quote_number)}</strong><span>${esc(item.customer_name)}</span><small>${esc(item.quote_date)} · ${esc(item.tax_type === 'included' ? '含稅' : '未稅')}</small></div><strong class="quote-history-total">$${esc(String(quoteMoney(item.total)))}</strong><div class="quote-history-actions"><button class="dsr-action-btn" onclick="quoteEdit(${esc(String(item.id))})">編輯</button><button class="dsr-action-btn" onclick="quoteDownload(${esc(String(item.id))}, 'xlsx')">Excel</button><button class="dsr-action-btn" onclick="quoteDownload(${esc(String(item.id))}, 'pdf')">PDF</button><button class="dsr-action-btn dsr-action-btn--danger" onclick="quoteDelete(${esc(String(item.id))})">刪除</button></div></div>`; }).join(''); var empty = document.getElementById('quote-history-empty'); if (empty) empty.style.display = quotationHistory.length ? 'none' : 'block'; } catch (e) { list.innerHTML = `<div class="dsr-empty">⚠️ ${esc(e.message)}</div>`; } }
async function quoteEdit(id) { try { var res = await fetch('/api/quotations/' + id); var data = await res.json(); if (!res.ok) throw new Error(data.detail || '讀取失敗'); quotationEditingId = id; quotationForm = data; quotationItems = data.items; renderQuotation(); window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) { toast('⚠️ ' + e.message, 'error'); } }
async function quoteDelete(id) { if (!confirm('確定要刪除此報價單？刪除後無法復原。')) return; try { var res = await fetch('/api/quotations/' + id, { method: 'DELETE' }); var data = await res.json(); if (!res.ok) throw new Error(data.detail || '刪除失敗'); if (quotationEditingId === id) quoteReset(); else quoteLoadHistory(); toast('✅ 報價單已刪除'); } catch (e) { toast('⚠️ ' + e.message, 'error'); } }
function quoteDownload(id, ext) { window.open('/api/quotations/' + id + '/export.' + ext, '_blank'); }
function quoteOpenInventory() { var overlay = document.getElementById('quote-inventory-overlay'); if (overlay) { overlay.classList.add('open'); document.getElementById('quote-inventory-q')?.focus(); quoteSearchInventory(); } }
function quoteCloseInventory() { document.getElementById('quote-inventory-overlay')?.classList.remove('open'); }
async function quoteSearchInventory() { var list = document.getElementById('quote-inventory-list'); if (!list) return; var q = document.getElementById('quote-inventory-q')?.value.trim() || ''; try { var res = await fetch('/api/quotations/inventory-items?q=' + encodeURIComponent(q)); var data = await res.json(); if (!res.ok) throw new Error(data.detail || '庫存載入失敗'); quotationInventoryResults = data;
 list.innerHTML = data.map(function(item) { return `<button class="quote-inventory-row" type="button" onclick="quoteUseInventory(${esc(String(item.id))})"><span><strong>${esc(item.brand || '無品牌')} ${esc(item.name)}</strong><small>${esc(item.code || '無型號')} · ${esc(item.site === 'warehouse' ? '倉庫' : '辦公室')} · 庫存 ${esc((typeof Qty !== 'undefined') ? Qty.disp(item.total_qty, item.unit) : String(item.total_qty))} ${esc(item.unit)}</small></span><b>帶入</b></button>`; }).join('') || '<div class="dsr-empty">沒有符合的庫存品項</div>'; } catch (e) { list.innerHTML = `<div class="dsr-empty">⚠️ ${esc(e.message)}</div>`; } }
function quoteUseInventory(id) { try { var item = quotationInventoryResults.find(function(row) { return row.id === id; }); if (!item) throw new Error('找不到庫存品項'); var empty = quotationItems.find(function(row) { return !row.item_name.trim(); }); var target = empty || { inventory_item_id: null, item_name: '', specification: '', qty: 1, unit: '式', unit_price: 0 }; target.inventory_item_id = item.id; target.item_name = item.name; target.unit = item.unit || '式'; if (!empty) quotationItems.push(target); quoteRenderItems(); quoteCloseInventory(); toast('✅ 已帶入「' + item.name + '」'); } catch (e) { toast('⚠️ ' + e.message, 'error'); } }

document.addEventListener('change', function(event) { if (event.target?.id === 'quote-tax') quoteUpdateTotals(); });
