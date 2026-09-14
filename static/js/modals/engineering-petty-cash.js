// 工程零用金 editor：沿用一般零用金的兩步切換式 UI
var engEditingId = null;
var engData = {};
var engActiveCategory = 0;
var engOptions = { category: [], group: [] };

function pcChooseReportType() {
  document.getElementById('content').insertAdjacentHTML('beforeend', `<div id="eng-type-overlay" class="pc-overlay open"><div class="pc-modal" role="dialog" aria-label="新增零用金月報"><div class="pc-modal__hd"><h3>新增零用金月報</h3><button class="pc-btn-sm" onclick="document.getElementById('eng-type-overlay').remove()">✕</button></div><div class="pc-modal__bd"><p>請選擇報表類型</p><div class="pc-form-grid pc-form-grid--two"><button class="pc-btn pc-btn--ghost" onclick="document.getElementById('eng-type-overlay').remove();pcOpenReportModal()">一般零用金<br><small>收入／支出月報</small></button><button class="pc-btn pc-btn--primary" onclick="document.getElementById('eng-type-overlay').remove();pcOpenEngineeringModal()">工程零用金<br><small>發票、收據與工程費用</small></button></div></div></div></div>`);
}

async function pcOpenEngineeringModal(id) {
  const modalToken = ++pcModalOpenSeq;
  pcModalSessionType = 'engineering';
  document.getElementById('pc-report-overlay')?.remove();
  document.getElementById('eng-report-overlay')?.remove();
  engEditingId = id || null;
  engActiveCategory = 0;
  engData = {start_date:_pcIso(new Date()), end_date:_pcIso(new Date()), upload_person:'', prepared_by:'', filename_text:'', status:'draft', categories:[]};
  try {
    await Promise.all(['category', 'group'].map(kind => fetch('/api/petty-cash-options?report_type=engineering&option_type='+kind).then(r=>r.ok ? r.json() : {items:[]}).then(d => {
      if (_pcIsCurrentModal(modalToken, 'engineering')) engOptions[kind] = d.items || [];
    })));
    if (!_pcIsCurrentModal(modalToken, 'engineering')) return;
    if (id) {
      const res = await fetch('/api/petty-cash-reports/'+id);
      if (!_pcIsCurrentModal(modalToken, 'engineering')) return;
      if (!res.ok) return toast('⚠️ 讀取失敗');
      const d = await res.json();
      engData = JSON.parse(JSON.stringify(d));
    }
    if (_pcIsCurrentModal(modalToken, 'engineering')) engRenderModal();
  } catch(e) {
    if (_pcIsCurrentModal(modalToken, 'engineering')) toast('⚠️ 工程選單載入失敗');
  }
}

function engRenderModal() {
  const title = engEditingId ? '編輯工程零用金' : '新增工程零用金';
  document.getElementById('content').insertAdjacentHTML('beforeend', `<div id="eng-report-overlay" class="pc-overlay open" onclick="if(event.target===this)engCloseModal()"><div class="pc-modal" role="dialog" aria-label="工程零用金"><div class="pc-modal__hd"><h3>${esc(title)}</h3><button class="pc-btn-sm" onclick="engCloseModal()">✕</button></div><div class="pc-modal__bd"><div class="pc-steps"><button class="pc-step active" id="eng-step-1-tab" onclick="engGotoStep(1)">① 基本資料</button><button class="pc-step" id="eng-step-2-tab" onclick="engGotoStep(2)">② 分類與明細</button></div><div id="eng-step-1"><div class="pc-form-grid pc-form-grid--two"><div class="pc-field"><label>報表期間（起） <span class="pc-required">*</span></label><input id="eng-start" type="date" value="${esc(engData.start_date||'')}"></div><div class="pc-field"><label>報表期間（迄） <span class="pc-required">*</span></label><input id="eng-end" type="date" value="${esc(engData.end_date||'')}"></div><div class="pc-field"><label>報表歸屬人 <span class="pc-required">*</span></label><input id="eng-owner" type="text" value="${esc(engData.upload_person||'')}" oninput="engFilenamePreview()"></div><div class="pc-field"><label>製表人 <span class="pc-required">*</span></label><input id="eng-prepared" type="text" value="${esc(engData.prepared_by||'')}"></div><div class="pc-field"><label>檔名備註</label><input id="eng-note" type="text" value="${esc(engData.filename_text||'')}" oninput="engFilenamePreview()"></div></div><div id="eng-filename" class="pc-filename-preview"></div></div><div id="eng-step-2" style="display:none"><div id="eng-editor" class="eng-editor"></div></div></div><div class="pc-modal__ft"><span id="eng-ops-1"><button class="pc-btn pc-btn--ghost" onclick="engCloseModal()">取消</button><button class="pc-btn pc-btn--primary" onclick="engGotoStep(2)">下一步：填寫明細 →</button></span><span id="eng-ops-2" style="display:none"><button class="pc-btn pc-btn--ghost" onclick="engGotoStep(1)">← 上一步</button><button class="pc-btn pc-btn--ghost" onclick="engCloseModal()">取消</button><button class="pc-btn pc-btn--ghost" onclick="engSave('draft')">儲存草稿</button><button class="pc-btn pc-btn--primary" onclick="engSave('completed')">儲存完成</button></span></div></div></div>`);
  document.getElementById('eng-start').addEventListener('change',engFilenamePreview); document.getElementById('eng-end').addEventListener('change',engFilenamePreview); engFilenamePreview();
}
function _engFilenamePeriod(start, end){
  const s=String(start||''), e=String(end||'');
  const compact=v=>{const p=v.split('-');return p.length===3?p.join(''):'';};
  if(s===e){const value=compact(s);return value?value.slice(4):'？';}
  const sc=compact(s)||'？', ec=compact(e)||'？';
  if(sc!=='？' && ec!=='？' && s.slice(0,4)===e.slice(0,4)) return `${sc.slice(4)}-${ec.slice(4)}`;
  return `${sc}-${ec}`;
}
function engFilenamePreview(){const s=document.getElementById('eng-start')?.value,e=document.getElementById('eng-end')?.value,n=document.getElementById('eng-note')?.value.trim()||'',o=document.getElementById('eng-owner')?.value.trim()||'？';const period=_engFilenamePeriod(s,e);const el=document.getElementById('eng-filename');if(el)el.textContent=`預覽檔名：(${period}${n?' '+n:''})${o} 工程零用金.xlsx`;}
function engValidateBasic(){const s=document.getElementById('eng-start').value,e=document.getElementById('eng-end').value,o=document.getElementById('eng-owner').value.trim(),p=document.getElementById('eng-prepared').value.trim();if(!s||!e||s>e||!o||!p){toast('⚠️ 請完整填寫期間、報表歸屬人與製表人');return false;}return true;}
function engGotoStep(n){return pcSwitchModalStep(n,{validate:engValidateBasic,stepIds:['eng-step-1','eng-step-2'],tabIds:['eng-step-1-tab','eng-step-2-tab'],opsIds:['eng-ops-1','eng-ops-2'],onDetail:engRenderEditor});}
function engAddCategory(){engData.categories.push({name:'',groups:[{name:'',receipts:[]}]});engActiveCategory=engData.categories.length-1;engRenderEditor();}
function engAddGroup(ci){engData.categories[ci].groups.push({name:'',receipts:[]});engRenderEditor();}
var engEditorExpandedReceipts = new Set();
function engEditorReceiptKey(ci, gi, ri) { return `${ci}:${gi}:${ri}`; }
function engToggleEditorReceipt(ci, gi, ri) {
  const key = engEditorReceiptKey(ci, gi, ri);
  if (engEditorExpandedReceipts.has(key)) engEditorExpandedReceipts.delete(key);
  else engEditorExpandedReceipts.add(key);
  engRenderEditor();
}
function engAddReceipt(ci,gi){
  engData.categories[ci].groups[gi].receipts.push({tax_id_mark:'',receipt_number:'',amount:'',details:['']});
  engEditorExpandedReceipts.add(engEditorReceiptKey(ci, gi, engData.categories[ci].groups[gi].receipts.length - 1));
  engRenderEditor();
}
function engAddDetail(ci,gi,ri){engData.categories[ci].groups[gi].receipts[ri].details.push('');engEditorExpandedReceipts.add(engEditorReceiptKey(ci, gi, ri));engRenderEditor();}
function engDeleteCategory(ci){if(!confirm('確定刪除分類及其底下所有資料？'))return;engData.categories.splice(ci,1);engEditorExpandedReceipts.clear();engActiveCategory=Math.max(0,Math.min(engActiveCategory,engData.categories.length-1));engRenderEditor();}
function engDeleteGroup(ci,gi){if(!confirm('確定刪除項目及其底下所有單據？'))return;engData.categories[ci].groups.splice(gi,1);engEditorExpandedReceipts.clear();engRenderEditor();}
function engDeleteReceipt(ci,gi,ri){if(!confirm('確定刪除這張單據及細項？'))return;engData.categories[ci].groups[gi].receipts.splice(ri,1);engEditorExpandedReceipts.clear();engRenderEditor();}
function engCategoryHtml(ci){
  const c=engData.categories[ci];
  return `<div class="eng-category-title"><select class="eng-name" data-c="${esc(ci)}" onchange="engSetNameFromSelect(this,'category',${esc(ci)})">${engOptionSelect('category', c.name)}</select><span>分類小計 $${esc(_pcMoney((c.groups||[]).reduce((n,g)=>n+(g.receipts||[]).reduce((m,r)=>m+(Number(r.amount)||0),0),0)))}</span><button class="pc-btn-sm pc-btn-sm--danger" onclick="engDeleteCategory(${esc(ci)})">刪除分類</button></div>${(c.groups||[]).map((g,gi)=>`<div class="eng-group-block"><div class="eng-group-head"><select class="eng-group" data-c="${esc(ci)}" data-g="${esc(gi)}" onchange="engSetNameFromSelect(this,'group',${esc(ci)},${esc(gi)})">${engOptionSelect('group', g.name)}</select><span>小計 $${esc(_pcMoney((g.receipts||[]).reduce((n,r)=>n+(Number(r.amount)||0),0)))} </span><button class="pc-btn-sm" onclick="engAddReceipt(${esc(ci)},${esc(gi)})">＋ 新增單據</button><button class="pc-btn-sm pc-btn-sm--danger" onclick="engDeleteGroup(${esc(ci)},${esc(gi)})">刪除項目</button></div><div class="eng-receipts">${(g.receipts||[]).map((r,ri)=>{
    const key=engEditorReceiptKey(ci,gi,ri), expanded=engEditorExpandedReceipts.has(key), details=r.details||[], receiptClass=expanded?' is-expanded':'', receiptChevron=expanded?'▼':'▶';
    return `<article class="eng-receipt${esc(receiptClass)}"><button type="button" class="eng-editor-receipt-toggle" aria-expanded="${expanded}" onclick="engToggleEditorReceipt(${esc(ci)},${esc(gi)},${esc(ri)})"><span><span class="eng-receipt-chevron">${esc(receiptChevron)}</span><b>單據 ${esc(ri+1)}</b><span class="eng-editor-receipt-no">${esc(r.receipt_number||'未填寫單據')}</span></span><strong>$${esc(_pcMoney(r.amount||0))}</strong></button>${expanded?`<div class="eng-editor-receipt-body"><div class="eng-receipt-grid"><div class="pc-field"><label>統編</label><input class="eng-tax" data-c="${esc(ci)}" data-g="${esc(gi)}" data-r="${esc(ri)}" value="${esc(r.tax_id_mark||'')}" placeholder="V／實際統編"></div><div class="pc-field"><label>發票號碼／收據</label><input class="eng-no" data-c="${esc(ci)}" data-g="${esc(gi)}" data-r="${esc(ri)}" value="${esc(r.receipt_number||'')}"></div><div class="pc-field"><label>金額 <span class="pc-required">*</span></label><input class="eng-amount" data-c="${esc(ci)}" data-g="${esc(gi)}" data-r="${esc(ri)}" type="number" min="0" step="0.01" value="${esc(r.amount??'')}"></div></div>${details.map((d,di)=>`<div class="eng-detail-row"><label>細項 ${esc(di+1)}</label><input class="eng-detail" data-c="${esc(ci)}" data-g="${esc(gi)}" data-r="${esc(ri)}" data-d="${esc(di)}" value="${esc(d||'')}"><button class="pc-btn-sm pc-btn-sm--danger" onclick="engData.categories[${esc(ci)}].groups[${esc(gi)}].receipts[${esc(ri)}].details.splice(${esc(di)},1);engRenderEditor()">刪除</button></div>`).join('')}<div class="eng-editor-receipt-actions"><button class="pc-btn-sm" onclick="engAddDetail(${esc(ci)},${esc(gi)},${esc(ri)})">＋ 新增細項</button><button class="pc-btn-sm pc-btn-sm--danger" onclick="engDeleteReceipt(${esc(ci)},${esc(gi)},${esc(ri)})">刪除單據</button></div></div>`:''}</article>`;
  }).join('')}</div></div>`).join('')}</div>`;
}
function engRenderEditor(){const box=document.getElementById('eng-editor');if(!box)return;const cats=engData.categories||[];box.innerHTML=`<aside class="eng-category-nav"><strong>分類</strong>${cats.map((c,i)=>`<button class="eng-category-tab${i===engActiveCategory?' active':''}" onclick="engActiveCategory=${esc(i)};engRenderEditor()">${esc(c.name||'未命名分類')}</button>`).join('')}<button class="pc-btn-sm" onclick="engAddCategory()">＋ 新增分類</button></aside><section class="eng-detail-pane">${cats.length?engCategoryHtml(engActiveCategory):'<div class="pc-empty">尚未建立任何分類<br><button class="pc-btn-sm" onclick="engAddCategory()">＋ 新增第一個分類</button></div>'}</section>`;box.querySelectorAll('input,select').forEach(x=>x.addEventListener('input',engSyncInput));}
function engOptionSelect(kind, value) {
  const current = String(value || '');
  const known = engOptions[kind] || [];
  const extra = current && !known.some(o => o.name === current) ? `<option value="${esc(current)}" selected>${esc(current)}（歷史／自訂）</option>` : '';
  return `<option value="">— 請選擇或輸入自訂名稱 —</option>${known.map(o => `<option value="${esc(o.name)}"${o.name === current ? ' selected' : ''}>${esc(o.name)}</option>`).join('')}${extra}<option value="__custom__">＋ 自訂名稱…</option>`;
}
function engSetNameFromSelect(select, kind, ci, gi) {
  let value = select.value;
  if (value === '__custom__') {
    value = prompt(kind === 'category' ? '請輸入自訂分類名稱' : '請輸入自訂項目名稱', '') || '';
    if (!value.trim()) return engRenderEditor();
    value = value.trim();
  }
  if (kind === 'category') engData.categories[ci].name = value;
  else engData.categories[ci].groups[gi].name = value;
  engRenderEditor();
}
function engSyncInput(e){const x=e.target,d=engData.categories[+x.dataset.c],g=d?.groups?.[+x.dataset.g],r=g?.receipts?.[+x.dataset.r];if(x.classList.contains('eng-name'))d.name=x.value;if(x.classList.contains('eng-group'))g.name=x.value;if(r){if(x.classList.contains('eng-tax'))r.tax_id_mark=x.value;if(x.classList.contains('eng-no'))r.receipt_number=x.value;if(x.classList.contains('eng-amount'))r.amount=x.value;if(x.classList.contains('eng-detail'))r.details[+x.dataset.d]=x.value;}engFilenamePreview();}
function engCloseModal(){
  if (pcModalSessionType === 'engineering') {
    pcModalOpenSeq += 1;
    pcModalSessionType = '';
  }
  document.getElementById('eng-report-overlay')?.remove();
}
async function engSave(status){
  if (pcSaveInFlight) { toast('⚠️ 目前已有儲存作業進行中'); return; }
  if (!engValidateBasic()) return;
  engSyncAll();
  const body={report_type:'engineering',start_date:document.getElementById('eng-start').value,end_date:document.getElementById('eng-end').value,upload_person:document.getElementById('eng-owner').value.trim(),prepared_by:document.getElementById('eng-prepared').value.trim(),filename_text:document.getElementById('eng-note').value.trim(),status,categories:engData.categories.map((c,ci)=>({...c,sort_order:ci,groups:(c.groups||[]).map((g,gi)=>({...g,sort_order:gi,receipts:(g.receipts||[]).map((r,ri)=>({...r,sort_order:ri,amount:Number(r.amount)||0,details:(r.details||[]).filter(Boolean)}))}))}))};
  const url=engEditingId?'/api/petty-cash-reports/'+engEditingId:'/api/petty-cash-reports';
  const saveToken = pcModalOpenSeq;
  pcSaveInFlight = true;
  pcSaveInFlightToken = saveToken;
  pcSetSaveButtonsDisabled('eng-report-overlay', true);
  try {
    const res=await fetch(url,{method:engEditingId?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const data=await res.json().catch(()=>({}));
    if (saveToken !== pcModalOpenSeq) return;
    if (!res.ok) return toast('⚠️ '+(data.detail||'儲存失敗'));
    toast(status==='completed'?'✅ 已儲存完成':'✅ 草稿已儲存');
    engCloseModal();
    renderPettyCash();
  } catch(e) {
    if (saveToken === pcModalOpenSeq) toast('⚠️ 網路錯誤：' + e.message);
  } finally {
    if (pcSaveInFlightToken === saveToken) {
      pcSaveInFlight = false;
      pcSaveInFlightToken = 0;
      if (saveToken === pcModalOpenSeq) pcSetSaveButtonsDisabled('eng-report-overlay', false);
    }
  }
}
function engSyncAll(){document.querySelectorAll('#eng-editor input').forEach(x=>engSyncInput({target:x}));}
