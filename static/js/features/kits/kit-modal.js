// 庫存管理系統 - 整組 Modal（v8 拆分；材料選擇為 demo 樣式：已選列 + 單一可搜尋框）

import { apiFetch } from '../../core/api-client.js';
import { loadData } from '../shell/data-refresh.js';
import { appState } from '../../core/state.js';
import { closeModalForce, esc, openModal, toast } from '../../core/utils.js';
import { _cabinetOptions } from '../inventory/edit-modal.js';
import { renderKitPhotoBox } from '../inventory/photo.js';
import { renderKitCompRows } from './component-rows.js';
import { kitsState } from './state.js';

export async function loadKitCabinetOptions() {
  try {
    appState.globalCabinetList = await apiFetch('/api/cabinets');
    syncKitLocationRowsFromDom();  // 櫃子清單晚到時，先保留使用者已輸入的值再重繪
    renderKitLocationRows();
  } catch (e) {
    console.warn('整組位置載入櫃子清單失敗', e);
  }
}
export function openKitModal() {
  kitsState.editingKitId = null;
  kitsState.kitModalCompRows = [];
  kitsState.kitLocationRows = [];
  document.getElementById('k-name').value = '';
  document.getElementById('k-note').value = '';
  document.getElementById('k-brand').value = '';
  document.getElementById('k-code').value = '';
  document.getElementById('k-site').value = 'office';
  document.querySelector('#kit-modal h3').textContent = '🔧 新增整組';
  const btn = document.getElementById('kit-submit');
  btn.textContent = '✅ 建立整組';
  btn.setAttribute('onclick', 'Kits.submitKit()');
  renderKitCompRows();  // 顯示「尚未加入材料」+ 搜尋框（同 demo）
  renderKitLocationRows();  // 顯示位置清單（初始為空）
  loadKitCabinetOptions();
  renderKitPhotoBox(null, null, false);  // 新增模式：選檔，建立後背景上傳
  openModal('kit-modal');
}

// 在整組 Modal「＋ 加入另一材料」：聚焦搜尋框（demo 行為：選中即自動加列）
export function addKitCompRow() {
  const input = document.getElementById('kit-mat-input');
  if (input) input.focus();
}

// 移除整組 Modal 中指定索引的材料列後重繪
export function removeKitCompRow(idx) {
  kitsState.kitModalCompRows.splice(idx, 1);
  renderKitCompRows();
}

export function setKitSubmitBusy(isBusy) {
  const btn = document.getElementById('kit-submit');
  if (!btn) return;
  btn.disabled = isBusy;
  btn.setAttribute('aria-busy', String(isBusy));
}

// 送出新增整組表單（POST /api/kits），成功後立即關閉 Modal，背景上傳照片（避免多人併發卡頓）
export async function submitKit() {
  if (document.getElementById('kit-submit')?.disabled) return;
  const name = document.getElementById('k-name').value.trim();
  const brand = document.getElementById('k-brand').value.trim();
  const code = document.getElementById('k-code').value.trim();
  if (!name) { toast('請輸入整組名稱', 'error'); return; }
  const items = kitsState.kitModalCompRows
    .filter(r => r.item_id && r.qty > 0)
    .map(r => ({ item_id: parseInt(r.item_id), qty: r.qty }));
  if (!items.length) { toast('請至少加入一個材料', 'error'); return; }
  const locations = getKitLocations();
  setKitSubmitBusy(true);
  try {
    const data = await apiFetch('/api/kits', {
      method: 'POST',
      json: { name: name, brand: brand, code: code, site: appState.currentSite, items: items, locations: locations, note: document.getElementById('k-note').value.trim() },
      fallback: '新增失敗'
    });
    const kitId = data.id;
    closeModalForce('kit-modal');
    toast(`✅ 已新增整組「${data.name || name}」｜品牌：${data.brand || '未填寫'}｜型號：${data.code || '未填寫'}`, 'success');
    // 背景非同步上傳照片（不阻擋 UI，避免多人上傳時卡頓）
    _uploadKitPhotoAsync(kitId);
    await loadData();
  } catch (e) {
    toast('⚠️ ' + e.message, 'error');
  } finally {
    setKitSubmitBusy(false);
  }
}

// 背景上傳整組照片（非同步，不 await，避免阻擋多人併發操作）
function _uploadKitPhotoAsync(kitId) {
  const photoInput = document.getElementById('k-photo-input');
  const albumInput = document.getElementById('k-photo-album');
  const chosenFile = (photoInput && photoInput.files && photoInput.files[0])
    || (albumInput && albumInput.files && albumInput.files[0]);
  if (!chosenFile) return;  // 沒選檔，不上傳

  const fd = new FormData();
  fd.append('file', chosenFile);
  apiFetch(`/api/kits/${kitId}/photo`, { method: 'POST', body: fd })
    .then(() => {
      toast('📷 整組照片已上傳', 'info');
      // 背景重載資料，確保照片顯示
      setTimeout(() => loadData({ full: false }), 500);
    })
    .catch(e => {
      console.warn('整組照片上傳失敗:', e.message);
      toast(e.status ? '⚠️ 照片上傳失敗，請重試' : '⚠️ 照片上傳出錯', 'error');
    });
}

// 送出編輯整組（PUT /api/kits/{id}；與新增共用同一個 modal）
export async function submitKitEdit() {
  if (document.getElementById('kit-submit')?.disabled) return;
  const name = document.getElementById('k-name').value.trim();
  const brand = document.getElementById('k-brand').value.trim();
  const code = document.getElementById('k-code').value.trim();
  if (!name) { toast('請輸入整組名稱', 'error'); return; }
  const items = kitsState.kitModalCompRows
    .filter(r => r.item_id && r.qty > 0)
    .map(r => ({ item_id: parseInt(r.item_id), qty: r.qty }));
  if (!items.length) { toast('請至少加入一個材料', 'error'); return; }
  if (!kitsState.editingKitId) { toast('編輯目標遺失，請重開', 'error'); return; }
  const locations = getKitLocations();
  setKitSubmitBusy(true);
  try {
    const saved = await apiFetch(`/api/kits/${kitsState.editingKitId}`, {
      method: 'PUT',
      json: { name: name, brand: brand, code: code, items: items, locations: locations, note: document.getElementById('k-note').value.trim(),
              updated_at: kitsState.kitUpdatedAt },
      fallback: '儲存失敗'
    });
    closeModalForce('kit-modal');
    toast('✅ 已更新整組「' + saved.name + '」｜品牌：' + (saved.brand || '未填寫') + '｜型號：' + (saved.code || '未填寫'), 'success');
    // 背景非同步上傳照片（如果有新選檔）+ 背景重載資料
    _uploadKitPhotoAsync(kitsState.editingKitId);
    setTimeout(() => {
      // 同步 ALL_ITEMS 與整組頁，避免下一個待領出/已領出操作讀到舊品牌或型號。
      loadData({ full: true });
    }, 600);
  } catch (e) {
    toast('⚠️ ' + e.message, 'error');
  } finally {
    setKitSubmitBusy(false);
  }
}

/**
 * Render the Kit location display-metadata rows.
 * @returns {void} Updates the location-row container when it exists.
 */
export function renderKitLocationRows() {
  const container = document.getElementById('kit-location-rows');
  if (!container) return;
  container.innerHTML = kitsState.kitLocationRows.map((row, idx) => `
    <div class="edit-stock-row" data-role="kit-location-row" data-idx="${idx}">
      <select class="kit-loc-cabinet" data-role="kit-loc-cabinet">${_cabinetOptions(row.cabinet || '')}</select>
      <input type="text" class="kit-loc-pos" data-role="kit-loc-pos" value="${esc(row.position || '')}" placeholder="1-1" list="location-list">
      <input type="text" class="kit-loc-note" data-role="kit-loc-note" value="${esc(row.note || '')}" placeholder="（可選）">
      <button type="button" class="btn-remove" onclick="Kits.removeKitLocationRow(${idx})">🗑</button>
    </div>
  `).join('');
}

/**
 * Append one empty Kit location metadata row.
 * @returns {void} Renders the updated row list.
 */
export function addKitLocationRow() {
  syncKitLocationRowsFromDom();  // 重繪前保存目前輸入，避免新增列時清掉已填的櫃子/位置/備註
  kitsState.kitLocationRows.push({ cabinet: '', position: '', note: '' });
  renderKitLocationRows();
}

// 刪除位置列
export function removeKitLocationRow(idx) {
  syncKitLocationRowsFromDom();
  kitsState.kitLocationRows.splice(idx, 1);
  renderKitLocationRows();
}

/**
 * Copy the currently rendered row values back into kitLocationRows (keeps blank rows).
 * @returns {void}
 */
function syncKitLocationRowsFromDom() {
  const rows = document.querySelectorAll('#kit-location-rows [data-role="kit-location-row"]');
  if (!rows.length) return;
  kitsState.kitLocationRows = Array.from(rows).map(row => ({
    cabinet: row.querySelector('[data-role="kit-loc-cabinet"]').value.trim(),
    position: row.querySelector('[data-role="kit-loc-pos"]').value.trim(),
    note: row.querySelector('[data-role="kit-loc-note"]').value.trim()
  }));
}

/**
 * Collect Kit display metadata for the create/update request.
 * @returns {Array<{cabinet: string, position: string, note: string}>} Non-empty metadata rows.
 */
function getKitLocations() {
  const rows = document.querySelectorAll('#kit-location-rows [data-role="kit-location-row"]');
  return Array.from(rows).map(row => ({
    cabinet: row.querySelector('[data-role="kit-loc-cabinet"]').value.trim(),
    position: row.querySelector('[data-role="kit-loc-pos"]').value.trim(),
    note: row.querySelector('[data-role="kit-loc-note"]').value.trim()
  })).filter(r => r.cabinet || r.position);  // 至少一個欄位填寫才算有效
}
