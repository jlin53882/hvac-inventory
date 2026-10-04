// 工程零用金 editor：沿用一般零用金的兩步切換式 UI

import { apiFetch } from '../../core/api-client.js';
import { esc, toast } from '../../core/utils.js';
import { _pcIsCurrentModal, _pcIso, _pcMoney, pcSetSaveButtonsDisabled, pcSwitchModalStep, renderPettyCash } from './page.js';
import { pettyCashState } from './state.js';

var engEditingId = null;
var engData = {};
var engActiveCategory = 0;
var engOptions = { category: [], group: [] };

export function pcChooseReportType() {
  document.getElementById('content').insertAdjacentHTML('beforeend', `<div id="eng-type-overlay" class="pc-overlay is-open"><div class="pc-modal" role="dialog" aria-label="新增零用金月報"><div class="pc-modal__hd"><h3>新增零用金月報</h3><button class="btn btn--secondary btn--sm btn--icon" data-action="pc-type-overlay-close">✕</button></div><div class="pc-modal__bd"><p>請選擇報表類型</p><div class="pc-form-grid pc-form-grid--two"><button class="btn btn--secondary btn--md pc-btn" data-action="pc-type-choose" data-type="general">一般零用金<br><small>收入／支出月報</small></button><button class="btn btn--primary btn--md pc-btn" data-action="pc-type-choose" data-type="engineering">工程零用金<br><small>發票、收據與工程費用</small></button></div></div></div></div>`);
}

export async function pcOpenEngineeringModal(id) {
  const modalToken = ++pettyCashState.pcModalOpenSeq;
  pettyCashState.pcModalSessionType = 'engineering';
  document.getElementById('pc-report-overlay')?.remove();
  document.getElementById('eng-report-overlay')?.remove();
  engEditingId = id || null;
  engActiveCategory = 0;
  engData = {start_date:_pcIso(new Date()), end_date:_pcIso(new Date()), upload_person:'', prepared_by:'', filename_text:'', status:'draft', categories:[]};
  try {
    await Promise.all(['category', 'group'].map(kind => apiFetch('/api/petty-cash-options?report_type=engineering&option_type='+kind).catch(e => (e.status ? {items:[]} : Promise.reject(e))).then(d => {
      if (_pcIsCurrentModal(modalToken, 'engineering')) engOptions[kind] = d.items || [];
    })));
    if (!_pcIsCurrentModal(modalToken, 'engineering')) return;
    if (id) {
      let d;
      try {
        d = await apiFetch('/api/petty-cash-reports/'+id);
      } catch (e) {
        if (!e.status) throw e;
        if (_pcIsCurrentModal(modalToken, 'engineering')) toast('⚠️ 讀取失敗');
        return;
      }
      if (!_pcIsCurrentModal(modalToken, 'engineering')) return;
      engData = JSON.parse(JSON.stringify(d));
    }
    if (_pcIsCurrentModal(modalToken, 'engineering')) engRenderModal();
  } catch(e) {
    if (_pcIsCurrentModal(modalToken, 'engineering')) toast('⚠️ 工程選單載入失敗');
  }
}

function engRenderModal() {
  const title = engEditingId ? '編輯工程零用金' : '新增工程零用金';
  document.getElementById('content').insertAdjacentHTML('beforeend', `<div id="eng-report-overlay" class="pc-overlay is-open" data-action="eng-modal-backdrop"><div class="pc-modal" role="dialog" aria-label="工程零用金"><div class="pc-modal__hd"><h3>${esc(title)}</h3><button class="btn btn--secondary btn--sm btn--icon" data-action="eng-modal-close">✕</button></div><div class="pc-modal__bd"><div class="pc-steps"><button class="chip chip--seg pc-step is-active" id="eng-step-1-tab" data-action="eng-step" data-step="1">① 基本資料</button><button class="chip chip--seg pc-step" id="eng-step-2-tab" data-action="eng-step" data-step="2">② 分類與明細</button></div><div id="eng-step-1"><div class="pc-form-grid pc-form-grid--two"><div class="pc-field"><label>報表期間（起）<span class="pc-required">*</span></label><input id="eng-start" type="date" value="${esc(engData.start_date||'')}"></div><div class="pc-field"><label>報表期間（迄）<span class="pc-required">*</span></label><input id="eng-end" type="date" value="${esc(engData.end_date||'')}"></div><div class="pc-field"><label>報表歸屬人<span class="pc-required">*</span></label><input id="eng-owner" type="text" value="${esc(engData.upload_person||'')}" data-action="eng-filename-preview"></div><div class="pc-field"><label>製表人<span class="pc-required">*</span></label><input id="eng-prepared" type="text" value="${esc(engData.prepared_by||'')}"></div><div class="pc-field"><label>檔名備註(選填)</label><input id="eng-note" type="text" value="${esc(engData.filename_text||'')}" data-action="eng-filename-preview"></div></div><div id="eng-filename" class="pc-filename-preview"></div></div><div id="eng-step-2" style="display:none"><div id="eng-editor" class="eng-editor"></div></div></div><div class="pc-modal__ft"><span id="eng-ops-1"><button class="btn btn--secondary btn--md pc-btn" data-action="eng-modal-close">取消</button><button class="btn btn--primary btn--md pc-btn" data-action="eng-step" data-step="2">下一步：填寫明細 →</button></span><span id="eng-ops-2" style="display:none"><button class="btn btn--secondary btn--md pc-btn" data-action="eng-step" data-step="1">← 上一步</button><button class="btn btn--secondary btn--md pc-btn" data-action="eng-modal-close">取消</button><button class="btn btn--secondary btn--md pc-btn" data-action="eng-save" data-status="draft">儲存草稿</button><button class="btn btn--primary btn--md pc-btn" data-action="eng-save" data-status="completed">儲存完成</button></span></div></div></div>`);
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
export function engFilenamePreview(){const s=document.getElementById('eng-start')?.value,e=document.getElementById('eng-end')?.value,n=document.getElementById('eng-note')?.value.trim()||'',o=document.getElementById('eng-owner')?.value.trim()||'？';const period=_engFilenamePeriod(s,e);const el=document.getElementById('eng-filename');if(el)el.textContent=`預覽檔名：(${period}${n?' '+n:''})${o} 工程零用金.xlsx`;}
function engValidateBasic(){const s=document.getElementById('eng-start').value,e=document.getElementById('eng-end').value,o=document.getElementById('eng-owner').value.trim(),p=document.getElementById('eng-prepared').value.trim();if(!s||!e||s>e||!o||!p){toast('⚠️ 請完整填寫期間、報表歸屬人與製表人');return false;}return true;}
export function engGotoStep(n){return pcSwitchModalStep(n,{validate:engValidateBasic,stepIds:['eng-step-1','eng-step-2'],tabIds:['eng-step-1-tab','eng-step-2-tab'],opsIds:['eng-ops-1','eng-ops-2'],onDetail:engRenderEditor});}
export function engAddCategory(){engData.categories.push({name:'',groups:[{name:'',receipts:[]}]});engActiveCategory=engData.categories.length-1;engRenderEditor();}
export function engSelectCategory(i){engActiveCategory=i;engRenderEditor();}
export function engDeleteDetail(ci,gi,ri,di){engData.categories[ci].groups[gi].receipts[ri].details.splice(di,1);engRenderEditor();}
var engEditorExpandedReceipts = new Set();
function engEditorReceiptKey(ci, gi, ri) { return `${ci}:${gi}:${ri}`; }
export function engToggleEditorReceipt(ci, gi, ri) {
  const key = engEditorReceiptKey(ci, gi, ri);
  if (engEditorExpandedReceipts.has(key)) engEditorExpandedReceipts.delete(key);
  else engEditorExpandedReceipts.add(key);
  engRenderEditor();
}
export function engAddReceipt(ci,gi){
  engData.categories[ci].groups[gi].receipts.push({tax_id_mark:'',receipt_number:'',amount:'',details:['']});
  engEditorExpandedReceipts.add(engEditorReceiptKey(ci, gi, engData.categories[ci].groups[gi].receipts.length - 1));
  engRenderEditor();
}
export function engAddDetail(ci,gi,ri){engData.categories[ci].groups[gi].receipts[ri].details.push('');engEditorExpandedReceipts.add(engEditorReceiptKey(ci, gi, ri));engRenderEditor();}
export function engDeleteCategory(ci){if(!confirm('確定刪除分類及其底下所有資料？'))return;engData.categories.splice(ci,1);engEditorExpandedReceipts.clear();engActiveCategory=Math.max(0,Math.min(engActiveCategory,engData.categories.length-1));engRenderEditor();}
export function engDeleteGroup(ci,gi){if(!confirm('確定刪除項目及其底下所有單據？'))return;engData.categories[ci].groups.splice(gi,1);engEditorExpandedReceipts.clear();engRenderEditor();}
export function engDeleteReceipt(ci,gi,ri){if(!confirm('確定刪除這張單據及細項？'))return;engData.categories[ci].groups[gi].receipts.splice(ri,1);engEditorExpandedReceipts.clear();engRenderEditor();}
function engCategoryHtml(ci){
  const c=engData.categories[ci];
  return `<div class="eng-category-title"><select class="eng-name" data-c="${esc(ci)}" data-action="eng-name-select" data-kind="category" data-ci="${esc(ci)}">${engOptionSelect('category', c.name)}</select><span>分類小計 $${esc(_pcMoney((c.groups||[]).reduce((n,g)=>n+(g.receipts||[]).reduce((m,r)=>m+(Number(r.amount)||0),0),0)))}</span><button class="btn btn--danger btn--sm pc-btn-sm--danger" data-action="eng-delete-category" data-ci="${esc(ci)}">刪除分類</button></div>${(c.groups||[]).map((g,gi)=>`<div class="eng-group-block"><div class="eng-group-head"><select class="eng-group" data-c="${esc(ci)}" data-g="${esc(gi)}" data-action="eng-name-select" data-kind="group" data-ci="${esc(ci)}" data-gi="${esc(gi)}">${engOptionSelect('group', g.name)}</select><span>小計 $${esc(_pcMoney((g.receipts||[]).reduce((n,r)=>n+(Number(r.amount)||0),0)))} </span><button class="btn btn--secondary btn--sm" data-action="eng-add-receipt" data-ci="${esc(ci)}" data-gi="${esc(gi)}">＋ 新增單據</button><button class="btn btn--danger btn--sm pc-btn-sm--danger" data-action="eng-delete-group" data-ci="${esc(ci)}" data-gi="${esc(gi)}">刪除項目</button></div><div class="eng-receipts">${(g.receipts||[]).map((r,ri)=>{
    const key=engEditorReceiptKey(ci,gi,ri), expanded=engEditorExpandedReceipts.has(key), details=r.details||[], receiptClass=expanded?' is-expanded':'', receiptChevron=expanded?'▼':'▶';
    return `<article class="eng-receipt${esc(receiptClass)}"><button type="button" class="eng-editor-receipt-toggle" aria-expanded="${expanded}" data-action="eng-toggle-editor-receipt" data-ci="${esc(ci)}" data-gi="${esc(gi)}" data-ri="${esc(ri)}"><span><span class="eng-receipt-chevron">${esc(receiptChevron)}</span><b>單據 ${esc(ri+1)}</b><span class="eng-editor-receipt-no">${esc(r.receipt_number||'未填寫單據')}</span></span><strong>$${esc(_pcMoney(r.amount||0))}</strong></button>${expanded?`<div class="eng-editor-receipt-body"><div class="eng-receipt-grid"><div class="pc-field"><label>統編(選填)</label><input class="eng-tax" data-c="${esc(ci)}" data-g="${esc(gi)}" data-r="${esc(ri)}" value="${esc(r.tax_id_mark||'')}" placeholder="V／實際統編"></div><div class="pc-field"><label>發票／收據號碼(選填)</label><input class="eng-no" data-c="${esc(ci)}" data-g="${esc(gi)}" data-r="${esc(ri)}" value="${esc(r.receipt_number||'')}"></div><div class="pc-field"><label>金額<span class="pc-required">*</span></label><input class="eng-amount" data-c="${esc(ci)}" data-g="${esc(gi)}" data-r="${esc(ri)}" type="number" min="0" step="0.01" value="${esc(r.amount??'')}"></div></div>${details.map((d,di)=>`<div class="eng-detail-row"><label>細項 ${esc(di+1)}(選填)</label><input class="eng-detail" data-c="${esc(ci)}" data-g="${esc(gi)}" data-r="${esc(ri)}" data-d="${esc(di)}" value="${esc(d||'')}"><button class="btn btn--danger btn--sm pc-btn-sm--danger" data-action="eng-delete-detail" data-ci="${esc(ci)}" data-gi="${esc(gi)}" data-ri="${esc(ri)}" data-di="${esc(di)}">刪除</button></div>`).join('')}<div class="eng-editor-receipt-actions"><button class="btn btn--secondary btn--sm" data-action="eng-add-detail" data-ci="${esc(ci)}" data-gi="${esc(gi)}" data-ri="${esc(ri)}">＋ 新增細項</button><button class="btn btn--danger btn--sm pc-btn-sm--danger" data-action="eng-delete-receipt" data-ci="${esc(ci)}" data-gi="${esc(gi)}" data-ri="${esc(ri)}">刪除單據</button></div></div>`:''}</article>`;
  }).join('')}</div></div>`).join('')}</div>`;
}
function engRenderEditor(){const box=document.getElementById('eng-editor');if(!box)return;const cats=engData.categories||[];box.innerHTML=`<aside class="eng-category-nav"><strong>分類</strong>${cats.map((c,i)=>`<button class="chip chip--seg eng-category-tab${i===engActiveCategory?' is-active':''}" data-action="eng-select-category" data-ci="${esc(i)}">${esc(c.name||'未命名分類')}</button>`).join('')}<button class="btn btn--secondary btn--sm" data-action="eng-add-category">＋ 新增分類</button></aside><section class="eng-detail-pane">${cats.length?engCategoryHtml(engActiveCategory):'<div class="pc-empty">尚未建立任何分類<br><button class="btn btn--secondary btn--sm" data-action="eng-add-category">＋ 新增第一個分類</button></div>'}</section>`;box.querySelectorAll('input,select').forEach(x=>x.addEventListener('input',engSyncInput));}
function engOptionSelect(kind, value) {
  const current = String(value || '');
  const known = engOptions[kind] || [];
  const extra = current && !known.some(o => o.name === current) ? `<option value="${esc(current)}" selected>${esc(current)}（歷史／自訂）</option>` : '';
  return `<option value="">— 請選擇或輸入自訂名稱 —</option>${known.map(o => `<option value="${esc(o.name)}"${o.name === current ? ' selected' : ''}>${esc(o.name)}</option>`).join('')}${extra}<option value="__custom__">＋ 自訂名稱…</option>`;
}
export function engSetNameFromSelect(select, kind, ci, gi) {
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
export function engCloseModal(){
  if (pettyCashState.pcModalSessionType === 'engineering') {
    pettyCashState.pcModalOpenSeq += 1;
    pettyCashState.pcModalSessionType = '';
  }
  document.getElementById('eng-report-overlay')?.remove();
}
export async function engSave(status){
  if (pettyCashState.pcSaveInFlight) { toast('⚠️ 目前已有儲存作業進行中'); return; }
  if (!engValidateBasic()) return;
  engSyncAll();
  const body={report_type:'engineering',start_date:document.getElementById('eng-start').value,end_date:document.getElementById('eng-end').value,upload_person:document.getElementById('eng-owner').value.trim(),prepared_by:document.getElementById('eng-prepared').value.trim(),filename_text:document.getElementById('eng-note').value.trim(),status,categories:engData.categories.map((c,ci)=>({...c,sort_order:ci,groups:(c.groups||[]).map((g,gi)=>({...g,sort_order:gi,receipts:(g.receipts||[]).map((r,ri)=>({...r,sort_order:ri,amount:Number(r.amount)||0,details:(r.details||[]).filter(Boolean)}))}))}))};
  const url=engEditingId?'/api/petty-cash-reports/'+engEditingId:'/api/petty-cash-reports';
  const saveToken = pettyCashState.pcModalOpenSeq;
  pettyCashState.pcSaveInFlight = true;
  pettyCashState.pcSaveInFlightToken = saveToken;
  pcSetSaveButtonsDisabled('eng-report-overlay', true);
  try {
    await apiFetch(url, { method: engEditingId ? 'PUT' : 'POST', json: body, fallback: '儲存失敗' });
    if (saveToken !== pettyCashState.pcModalOpenSeq) return;
    toast(status==='completed'?'✅ 已儲存完成':'✅ 草稿已儲存');
    engCloseModal();
    renderPettyCash();
  } catch(e) {
    if (saveToken === pettyCashState.pcModalOpenSeq) toast(e.status ? '⚠️ ' + e.message : '⚠️ 網路錯誤：' + e.message);
  } finally {
    if (pettyCashState.pcSaveInFlightToken === saveToken) {
      pettyCashState.pcSaveInFlight = false;
      pettyCashState.pcSaveInFlightToken = 0;
      if (saveToken === pettyCashState.pcModalOpenSeq) pcSetSaveButtonsDisabled('eng-report-overlay', false);
    }
  }
}
function engSyncAll(){document.querySelectorAll('#eng-editor input').forEach(x=>engSyncInput({target:x}));}
