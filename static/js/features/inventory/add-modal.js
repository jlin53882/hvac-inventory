// 庫存管理系統 - 新增品項 Modal（v10：多位置 stocks）

import { apiFetch } from '../../core/api-client.js';
import { loadData } from '../shell/data-refresh.js';
import { qtyInputOrToast } from '../../core/qty.js';
import { appState } from '../../core/state.js';
import { setGlobalCabinetList } from '../../core/shared-read-model.js';
import { fillUnitSelect } from '../../core/units.js';
import { closeModalForce, hasPerm, openModal, toast } from '../../core/utils.js';
import { _cabinetOptions } from './edit-modal.js';
import { bindSimilarCheck } from './photo.js';

// ========== 新增品項 ==========
export function openAddModal() {
  openModal('add-modal');
  document.getElementById('f-site').value = appState.currentSite;  // 預設加到目前分片
  document.getElementById('f-brand').focus();
  // v10.1：相似品項提示（新增 → 不排除任何品項）
  const warnBox = document.getElementById('f-similar-warn');
  warnBox.style.display = 'none';
  warnBox.innerHTML = '';
  bindSimilarCheck('f-name', 'f-code', 'f-similar-warn', 0);
  // 分類：重置為「— 請選擇 —」
  document.getElementById('f-category').value = '';
  // 名稱輸入時自動推斷分類
  document.getElementById('f-name').removeEventListener('input', _autoInferCategory);
  document.getElementById('f-name').addEventListener('input', _autoInferCategory);
  // 2026-08-16：單位動態清單（寫死 options 移除）
  fillUnitSelect(document.getElementById('f-unit'), '個');
  const fUnitSearch = document.getElementById('f-unit-search');
  if (fUnitSearch) fUnitSearch.value = '';  // 重開 modal 清空搜尋
  // 2026-08-16：快速新增單位按鈕（item-mgmt 才顯示）
  const fUnitAdd = document.getElementById('f-unit-add');
  if (fUnitAdd) fUnitAdd.style.display = hasPerm('item-mgmt') ? '' : 'none';
  // 品項照片：初始化照片上傳區塊
  renderAddPhotoBox();
  // 多位置：每次開啟重置為一列空白位置（與編輯品項相同的 櫃子/位置/數量/備註 欄位）
  resetAddStockRows();
  // 2026-09-27：新增時也載入最新櫃子清單；載入後只更新下拉選項，保留使用者已輸入的值
  (async () => {
    try {
      setGlobalCabinetList(await apiFetch('/api/cabinets'));
      refreshAddStockCabinetOptions();
    } catch (e) {
      console.warn('新增 modal 載入櫃子清單失敗', e);
    }
  })();
}

/**
 * Build one editable add-modal location row (same fields/classes as the edit modal).
 * @returns {string} Row inner HTML.
 */
function addStockRowHtml() {
  return `
    <label class="stock-field stock-field-cabinet"><span class="stock-mobile-label">櫃子*</span><select class="stock-cabinet" data-role="stock-cabinet">${_cabinetOptions('')}</select></label>
    <label class="stock-field stock-field-sub"><span class="stock-mobile-label">位置(選填)</span><input type="text" class="stock-sub" data-role="stock-sub" list="location-list" placeholder="例：1-1"></label>
    <label class="stock-field stock-field-qty"><span class="stock-mobile-label">數量(選填)</span><input type="text" inputmode="decimal" class="stock-qty" data-role="stock-qty" value="0" placeholder="數量（可輸 1/4）"></label>
    <label class="stock-field stock-field-note"><span class="stock-mobile-label">備註(選填)</span><input type="text" class="stock-note" data-role="stock-note" placeholder="備註"></label>
    <button type="button" class="stock-remove" data-action="inventory-add-stock-remove" aria-label="移除此位置" title="移除此位置">✕</button>`;
}

/**
 * Append one empty location row to the add modal.
 * @param {boolean} [focus=true] Whether to focus the new row's cabinet select.
 * @returns {void}
 */
export function addAddStockRow(focus = true) {
  const box = document.getElementById('add-stock-rows');
  if (!box) return;
  const row = document.createElement('div');
  row.className = 'stock-row';
  row.dataset.role = 'stock-row';
  row.innerHTML = addStockRowHtml();
  box.appendChild(row);
  if (focus) row.querySelector('[data-role="stock-cabinet"]').focus();
}

/** Reset the add modal to a single blank location row. */
function resetAddStockRows() {
  const box = document.getElementById('add-stock-rows');
  if (!box) return;
  box.innerHTML = '';
  addAddStockRow(false);
}

/**
 * Remove one unsaved add-modal location row, keeping at least one row.
 * @param {HTMLButtonElement} button Remove control inside the row.
 * @returns {void}
 */
export function removeAddStockRow(button) {
  const box = document.getElementById('add-stock-rows');
  const row = button && button.closest('[data-role="stock-row"]');
  if (!box || !row) return;
  if (box.querySelectorAll('[data-role="stock-row"]').length <= 1) {
    toast('至少保留一個位置', 'info');
    return;
  }
  row.remove();
}

/** Rebuild cabinet options after the cabinet list loads, preserving selected values. */
function refreshAddStockCabinetOptions() {
  document.querySelectorAll('#add-stock-rows [data-role="stock-cabinet"]').forEach(select => {
    select.innerHTML = _cabinetOptions(select.value);  // _cabinetOptions 會保留清單外的已選值
  });
}

/**
 * Validate add-modal location rows and build the POST /api/items stocks payload.
 * Pure function (no DOM) so the rules can be tested directly.
 * @param {Array<{cabinet: string, sub: string, qty: number, note: string}>} rows Parsed rows.
 * @returns {{stocks: Array<{location: string, qty: number, note: string}>, error: string}}
 */
function buildAddStocks(rows) {
  const stocks = [];
  const seen = new Set();
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i];
    const cabinet = String(r.cabinet || '').trim();
    const sub = String(r.sub || '').trim();
    const note = String(r.note || '').trim();
    const qty = Number(r.qty || 0);
    // 完全空白的額外列（沒櫃子、沒位置、數量 0、沒備註）直接忽略
    if (!cabinet && !sub && !qty && !note) continue;
    if (!cabinet) return { stocks: [], error: `第 ${i + 1} 個位置請選擇櫃子` };
    const location = sub ? `${cabinet} | ${sub}` : cabinet;
    if (seen.has(location)) return { stocks: [], error: `位置「${location}」重複，請合併數量` };
    seen.add(location);
    stocks.push({ location: location, qty: qty, note: note });
  }
  if (!stocks.length) return { stocks: [], error: '位置必填（至少選櫃子）' };
  return { stocks: stocks, error: '' };
}

// 渲染新增 modal 的照片上傳區塊（無品項 ID，建立後自動上傳）
function _autoInferCategory() {
  var name = document.getElementById('f-name').value || '';
  var cat = '';
  if (/遙控|遙器|控制器|線控/.test(name)) cat = '遙控器';
  else if (/基板|控制板|PCB|電路/.test(name)) cat = '電子零件';
  else if (/線圈|接觸器|繼電器|開關|插座|斷路|跳脫/.test(name)) cat = '電氣配件';
  else if (/管|銅|鐵氟龍|配管/.test(name)) cat = '管材';
  else if (/劑|脂|膠|發泡|樹脂/.test(name)) cat = '化學品';
  else if (/濾|網|棉|濾網/.test(name)) cat = '過濾耗材';
  else if (/馬達|風扇|壓縮|軸流/.test(name)) cat = '動力設備';
  else if (/面板|蓋板|外殼|支架|固定/.test(name)) cat = '外觀/結構';
  if (cat) document.getElementById('f-category').value = cat;
}

function renderAddPhotoBox() {
  const box = document.getElementById('f-photo-box');
  if (!box) return;
  if (!hasPerm('photo')) {
    box.innerHTML = '<div class="photo-box-hint">無照片上傳權限</div>';
    return;
  }
  box.innerHTML = `
    <div class="photo-box-hint">新增後可立即上傳照片</div>
    <div class="photo-actions">
      <label class="btn btn--secondary btn--md btn-prepare">📷 拍照
        <input type="file" accept="image/*" capture="environment" id="f-photo-input" style="display:none">
      </label>
      <label class="btn btn--secondary btn--md btn-prepare">🖼 從相簿選
        <input type="file" accept="image/*" id="f-photo-album" style="display:none">
      </label>
    </div>`;
  // 兩個 input 同步到同一個 hidden state（submitAdd 只讀一個）
  const cam = document.getElementById('f-photo-input');
  const album = document.getElementById('f-photo-album');
  cam.addEventListener('change', () => { if (cam.files[0]) album.value = ''; });
  album.addEventListener('change', () => { if (album.files[0]) cam.value = ''; });
}

// 送出新增品項表單（POST /api/items），成功後關閉 Modal、清空表單並重載資料
// v10.1：新增成功後自動上傳照片（若已選檔）
export async function submitAdd() {
  const name = document.getElementById('f-name').value.trim();
  if (!name) { toast('品項名稱必填', 'error'); return; }
  const brand = document.getElementById('f-brand').value.trim();
  const code = document.getElementById('f-code').value.trim();
  if (!brand) { toast('廠牌必填', 'error'); return; }
  if (!code) { toast('型號必填', 'error'); return; }
  const unit = document.getElementById('f-unit').value;
  // 多位置：逐列解析（分數/小數單位可輸 1/4；非法數量 qtyInputOrToast 已 toast → 整包擋下）
  const parsedRows = [];
  for (const row of document.querySelectorAll('#add-stock-rows [data-role="stock-row"]')) {
    const qtyInput = row.querySelector('[data-role="stock-qty"]');
    const qty = qtyInput.value.trim() === '' ? 0 : qtyInputOrToast(qtyInput, unit);
    if (typeof qty !== 'number' || !isFinite(qty)) return;
    parsedRows.push({
      cabinet: row.querySelector('[data-role="stock-cabinet"]').value,
      sub: row.querySelector('[data-role="stock-sub"]').value,
      qty: qty,
      note: row.querySelector('[data-role="stock-note"]').value,
    });
  }
  const built = buildAddStocks(parsedRows);
  if (built.error) { toast(built.error, 'error'); return; }
  const payload = {
    brand: brand,
    code: code,
    name: name,
    unit: unit,
    site: document.getElementById('f-site').value,
    category: document.getElementById('f-category').value,
    // v10：位置庫存陣列（一筆 = 一個位置；第一筆為預設位置）
    stocks: built.stocks,
  };
  try {
    // 去重：後端錯誤訊息會帶出原因（例如「該品項已存在…用編輯→新增位置」）
    const newItem = await apiFetch('/api/items', { method: 'POST', json: payload, fallback: '新增失敗' });
    const newItemId = newItem.id;
    // v10.1：若有選擇照片，自動上傳（拍照或相簿擇一）
    const photoInput = document.getElementById('f-photo-input');
    const albumInput = document.getElementById('f-photo-album');
    const chosenFile = (photoInput && photoInput.files && photoInput.files[0])
      || (albumInput && albumInput.files && albumInput.files[0]);
    let photoMsg = '';
    if (chosenFile) {
      try {
        const fd = new FormData();
        fd.append('file', chosenFile);
        await apiFetch(`/api/items/${newItemId}/photo`, { method: 'POST', body: fd });
        photoMsg = '（含照片）';
      } catch {}
    }
    toast(`✅ 已新增「${name}」${photoMsg}`, 'success');
    closeModalForce('add-modal');
    // f-unit 是動態 select（2026-08-16）→ 不參與 value reset，改重填
    ['f-brand','f-code','f-name'].forEach(id => {
      document.getElementById(id).value = '';
    });
    resetAddStockRows();
    document.getElementById('f-category').value = '';
    fillUnitSelect(document.getElementById('f-unit'), '個');
    await loadData();
  } catch (e) {
    toast(e.status ? '⚠️ ' + e.message : '新增失敗', 'error');
  }
}
