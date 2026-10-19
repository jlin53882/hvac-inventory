// 庫存管理系統 - 品項照片 + 相似品項提示（v10.1）
// ============================================================
// 照片：編輯 modal 內顯示/上傳/刪除（POST/DELETE /api/items/{id}/photo）
// 相似：新增/編輯時 name/code 輸入 debounce → GET /api/items/similar → 警示框

import { createActionDelegate } from '../../core/actions.js';
import { photoSrc } from '../../components/card.js';
import { apiFetch } from '../../core/api-client.js';
import { loadData, renderInventoryView } from '../shell/data-refresh.js';
import { Qty } from '../../core/qty.js';
import { createRequestGuard } from '../../core/request-guard.js';
import { appState } from '../../core/state.js';
import { patchCurrentKit } from '../../core/shared-read-model.js';
import { patchItem } from '../../core/inventory-read-model.js';
import { esc, hasPerm, toast } from '../../core/utils.js';

let similarTimer = null;          // 相似查詢 debounce timer
const similarGuard = createRequestGuard();   // 防舊回應覆蓋新輸入（競態防護）

// ========== 照片（編輯 modal） ==========
const ITEM_PHOTO_BOX_ID = 'e-photo-box';
// 照片變更後通知所屬頁面（boxId → handler(itemId, patch)）；由各 modal 開啟時註冊，載入時不產生副作用
const photoChangeListeners = new Map();

export function onItemPhotoChange(boxId, handler) {
  photoChangeListeners.set(boxId, handler);
}

// 拍照 / 從相簿選 兩個選檔按鈕；屬性值一律 esc() 後以字串串接（不用內插，XSS 掃描不需放寬白名單）。
// inputIds 有給 = 預覽模式（兩個 input 依序用這兩個 id，選檔後只預覽）；否則為既有品項，選檔即上傳。
function photoPickButtons(boxId, itemId, inputIds) {
  const pickInput = (camera, n) => '<input type="file" accept="image/*"' + (camera ? ' capture="environment"' : '') +
    (inputIds
      ? ' id="' + esc(inputIds[n]) + '" data-action="inventory-pending-photo-preview"'
      : ' data-action="inventory-photo-upload" data-id="' + esc(itemId) + '"') +
    ' data-box="' + esc(boxId) + '" style="display:none">';
  return '<label class="btn btn--secondary btn--md btn-prepare">📷 拍照\n' + pickInput(true, 0) + '\n</label>\n' +
    '<label class="btn btn--secondary btn--md btn-prepare">🖼 從相簿選\n' + pickInput(false, 1) + '\n</label>';
}

// boxId：照片區容器 id（預設單一庫存編輯 modal；待領出編輯 modal 傳 pe-photo-box）
export function renderPhotoBox(itemId, hasPhoto, boxId = ITEM_PHOTO_BOX_ID) {
  const box = document.getElementById(boxId);
  if (!box) return;
  const canPhoto = hasPerm('photo');
  if (hasPhoto) {
    box.innerHTML = `
      <img src="${photoSrc(itemId, 'thumbnail')}" alt="品項照片" loading="lazy" decoding="async" width="320" height="240" data-action="photo-lightbox" data-id="${itemId}"
           class="photo-box-thumb" title="點擊看大圖" data-fallback="hide">
      ${canPhoto ? `<div class="photo-actions">
        ${photoPickButtons(boxId, itemId)}
        <button class="btn btn--danger btn--md btn-prepare" data-action="inventory-photo-delete" data-id="${itemId}" data-box="${esc(boxId)}">🗑 刪除</button>
      </div>` : ''}`;
  } else {
    box.innerHTML = canPhoto
      ? `<div class="photo-box-hint">尚無照片</div>
      <div class="photo-actions">
        ${photoPickButtons(boxId, itemId)}
      </div>`
      : '<div class="photo-box-hint">尚無照片</div>';
  }
}

// 前端驗證：副檔名白名單 + 大小上限 10MB；回傳錯誤訊息，通過回 null
function photoFileError(file) {
  const ALLOWED = ['.jpg', '.jpeg', '.png', '.webp'];
  const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
  if (ALLOWED.indexOf(ext) === -1) return '不支援的圖片格式（限 jpg/png/webp）';
  if (file.size > 10 * 1024 * 1024) return '圖片超過 10MB 上限';
  return null;
}

// 上傳照片（手機：無 capture 屬性 → 系統彈「拍照/相簿」選擇器，兩者皆可）
export async function uploadItemPhoto(itemId, input) {
  const file = input.files && input.files[0];
  if (!file) return;
  const fileError = photoFileError(file);
  if (fileError) { toast(fileError, 'error'); return; }
  const boxId = input.dataset.box || ITEM_PHOTO_BOX_ID;
  const fd = new FormData();
  fd.append('file', file);
  try {
    let body;
    try {
      body = (await apiFetch(`/api/items/${itemId}/photo`, { method: 'POST', body: fd, fallback: '上傳失敗' })) || {};
    } catch (e) {
      toast('⚠️ ' + e.message, 'error');
      return;
    }
    toast('✅ 照片已更新', 'success');
    // 先更新列表狀態，再重繪照片區，避免 modal 暫留舊縮圖
    const patch = { has_photo: true, photo_asset_id: body.asset_id || null, thumbnail_url: body.thumbnail_url || null, preview_url: body.preview_url || null };
    if (patchItem(itemId, patch)) renderInventoryView();
    const listener = photoChangeListeners.get(boxId);
    if (listener) listener(itemId, patch);
    renderPhotoBox(itemId, true, boxId);
  } catch { toast('上傳失敗', 'error'); }
  input.value = '';  // 允許重選同一檔案
}

// 刪除照片（冪等）
export async function deleteItemPhoto(itemId, boxId = ITEM_PHOTO_BOX_ID) {
  try {
    await apiFetch(`/api/items/${itemId}/photo`, { method: 'DELETE' });
    toast('🗑 照片已刪除', 'success');
    const listener = photoChangeListeners.get(boxId);
    if (listener) listener(itemId, { has_photo: false, photo_asset_id: null, thumbnail_url: null, preview_url: null });
    renderPhotoBox(itemId, false, boxId);
    if (patchItem(itemId, { has_photo: false })) renderInventoryView();
  } catch { toast('刪除失敗', 'error'); }
}

// ========== 預覽式照片區（整組新增/編輯、待領出新增：先選檔預覽，由呼叫端在儲存後上傳） ==========
// prefix 決定元素 id：${prefix}-box（容器）、-input / -album（選檔）、-preview、-message
// headHtml：預覽之前的內容（既有照片縮圖）；extraButtons：選檔按鈕之後的按鈕（刪除）；兩者由呼叫端負責 esc。
export function renderPendingPhotoBox(prefix, { message = '建立後自動上傳照片', headHtml = '', extraButtons = '' } = {}) {
  const box = document.getElementById(prefix + '-box');
  if (!box) return;
  if (!hasPerm('photo')) {
    box.innerHTML = '<div class="photo-box-hint">無照片上傳權限</div>';
    return;
  }
  box.innerHTML = headHtml +
    (message ? '<div id="' + esc(prefix) + '-message" class="photo-box-hint">' + esc(message) + '</div>' : '') +
    '<div id="' + esc(prefix) + '-preview" class="photo-box-preview"></div>' +
    '<div class="photo-actions">' + photoPickButtons(prefix, null, [prefix + '-input', prefix + '-album']) + extraButtons + '</div>';
}

// 回傳使用者選的照片（拍照或相簿擇一）；沒選回 null
export function getPendingPhotoFile(prefix) {
  const cam = document.getElementById(prefix + '-input');
  const album = document.getElementById(prefix + '-album');
  return (cam && cam.files && cam.files[0]) || (album && album.files && album.files[0]) || null;
}

// 清除預覽並重置兩個輸入
function clearPendingPhoto(prefix) {
  const preview = document.getElementById(prefix + '-preview');
  const message = document.getElementById(prefix + '-message');
  if (preview) preview.innerHTML = '';
  if (message) message.style.display = '';
  const cam = document.getElementById(prefix + '-input');
  const album = document.getElementById(prefix + '-album');
  if (cam) cam.value = '';
  if (album) album.value = '';
}

// 選檔後預覽（兩個 input 互斥）；格式/大小不符 → 提示並只清掉這次的選擇，另一個 input 已選好的合規照片保留
export function previewPendingPhoto(input) {
  const prefix = input.dataset.box;
  const preview = document.getElementById(prefix + '-preview');
  const message = document.getElementById(prefix + '-message');
  if (!preview) return;
  const other = document.getElementById(input.id === prefix + '-input' ? prefix + '-album' : prefix + '-input');
  const file = input.files && input.files[0];
  if (!file) { clearPendingPhoto(prefix); return; }
  const fileError = photoFileError(file);
  if (fileError) {
    toast(fileError, 'error');
    input.value = '';
    if (!(other && other.files && other.files[0])) clearPendingPhoto(prefix);
    return;
  }
  if (other) other.value = '';
  if (message) message.style.display = 'none';
  const reader = new FileReader();
  reader.onload = function(e) {
    const wrapper = document.createElement('div');
    wrapper.className = 'photo-preview';
    const image = document.createElement('img');
    image.src = e.target.result;
    image.alt = '預覽';
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.textContent = '✕ 清除';
    clear.className = 'btn btn--danger btn--sm photo-preview-clear';
    clear.addEventListener('click', () => clearPendingPhoto(prefix));
    wrapper.append(image, clear);
    preview.replaceChildren(wrapper);
  };
  reader.readAsDataURL(file);
}

// 上傳已選的預覽照片；失敗只提示不中斷（品項已建立）。沒選檔回 false
export async function uploadPendingPhoto(itemId, prefix) {
  const file = getPendingPhotoFile(prefix);
  if (!file) return false;
  const fd = new FormData();
  fd.append('file', file);
  try {
    await apiFetch(`/api/items/${itemId}/photo`, { method: 'POST', body: fd, fallback: '照片上傳失敗' });
    return true;
  } catch (e) {
    toast('⚠️ 品項已建立，但照片上傳失敗：' + e.message, 'error');
    return false;
  }
}

// ========== 大圖檢視（lightbox） ==========
// 點卡片/編輯 modal 的縮圖 → 全螢幕 overlay 顯示 800px 大圖，點擊或 ESC 關閉
let photoLightboxEl = null;

export function openPhotoLightbox(itemId) {
  closePhotoLightbox();
  const overlay = document.createElement('div');
  overlay.id = 'photo-lightbox';
  overlay.innerHTML = `
    <div class="lightbox-content">
      <img src="${photoSrc(itemId, 'preview')}" alt="品項照片大圖" decoding="async">
      <div class="lightbox-close">✕</div>
    </div>`;
  // 點 ✕ 或空白處關閉；點到照片本身不關閉
  overlay.onclick = function(event) { if (!(event && event.target && event.target.tagName === 'IMG')) closePhotoLightbox(); };
  document.body.appendChild(overlay);
  photoLightboxEl = overlay;
}

// 關閉大圖檢視（移除 overlay 元素）
export function closePhotoLightbox() {
  if (photoLightboxEl) { photoLightboxEl.remove(); photoLightboxEl = null; }
}

// ========== 相似品項提示（新增/編輯共用） ==========
// bindSimilarCheck(inputNameId, inputCodeId, warnId, excludeId)
//   - inputNameId/inputCodeId：觸發輸入框 id
//   - warnId：警示框 id
//   - excludeId：排除的品項 id（編輯時排除自己；新增傳 null）
export function bindSimilarCheck(nameId, codeId, warnId, excludeId) {
  const nameEl = document.getElementById(nameId);
  const codeEl = document.getElementById(codeId);
  if (!nameEl || !codeEl) return;
  // dataset flag：modal 多次開啟（openAdd/openEdit）避免對同一 input 重複綁定監聽器
  if (nameEl.dataset.similarBound === '1') return;
  nameEl.dataset.similarBound = '1';
  codeEl.dataset.similarBound = '1';
  const trigger = () => {
    clearTimeout(similarTimer);
    const name = document.getElementById(nameId).value.trim();
    const code = document.getElementById(codeId).value.trim();
    if (!name && !code) {
      document.getElementById(warnId).style.display = 'none';
      return;
    }
    similarTimer = setTimeout(() => checkSimilar(name, code, warnId, excludeId), 350);
  };
  nameEl.addEventListener('input', trigger);
  codeEl.addEventListener('input', trigger);
}

// 查詢相似品項（debounce 後呼叫）；seq 序號防舊回應覆蓋新輸入
async function checkSimilar(name, code, warnId, excludeId) {
  const seq = similarGuard.next();
  const params = new URLSearchParams();
  if (name) params.set('name', name);
  if (code) params.set('code', code);
  params.set('site', appState.currentSite);
  if (excludeId) params.set('exclude_id', excludeId);
  try {
    const hits = await apiFetch(`/api/items/similar?${params}`);
    if (!similarGuard.isCurrent(seq)) return;  // 已有更新的輸入 → 丟棄這次結果
    renderSimilarWarn(warnId, hits);
  } catch {}
}

// 渲染警示框：列出疑似重複品項 + 位置/數量 + 「去編輯」
function renderSimilarWarn(warnId, hits) {
  const box = document.getElementById(warnId);
  if (!hits.length) { box.style.display = 'none'; return; }
  box.innerHTML = `⚠️ 可能已有相似品項，請確認是否要新增：
    ${hits.map(h => `
      <div class="sim-row">
        <span>${esc(h.name)}${h.code ? '（' + esc(h.code) + '）' : ''}
          · 共 ${Qty.disp(h.total_qty, h.unit)} ${esc(h.unit || '個')}
          ${h.stocks && h.stocks.length ? '· ' + esc(h.stocks.map(s => s.location + '×' + s.qty).join(', ')) : ''}</span>
        <a href="#" data-action="inventory-similar-edit" data-id="${h.id}">去編輯 →</a>
      </div>`).join('')}`;
  box.style.display = 'block';
}

// ========== 整組照片（新增/編輯 modal） ==========
// 整組照片：新增時建立後自動上傳（背景），編輯時可修改；選檔後立即預覽
// 元素 id 前綴（k-photo-box / -input / -album / -preview / -message）；kit-modal.js 以 getPendingPhotoFile('k-photo') 取已選檔案
const KIT_PHOTO_PREFIX = 'k-photo';
/**
 * 依 Kit 定義與其庫存品項的不同識別碼渲染整組照片控制。
 * @param {number|null} kitId - kits.id；用於整組專屬上傳與刪除端點。
 * @param {number|null} itemId - kits.item_id；用於照片縮圖與 lightbox 媒體查詢。
 * @param {boolean} hasPhoto - 該 backing item 是否已有照片。
 * @returns {void} 更新整組編輯 modal 的照片區塊。
 */
export function renderKitPhotoBox(kitId, itemId, hasPhoto) {
  // 新增模式沒有 Kit/item 識別碼；編輯模式分開使用 Kit ID 與 backing item ID。
  if (kitId === null || kitId === undefined) {
    renderPendingPhotoBox(KIT_PHOTO_PREFIX, { message: '建立後可立即上傳照片' });
  } else if (hasPhoto) {
    renderPendingPhotoBox(KIT_PHOTO_PREFIX, {
      message: '',
      headHtml: `<img src="${photoSrc(itemId, 'thumbnail')}" alt="整組照片" loading="lazy" decoding="async" width="320" height="240" data-action="photo-lightbox" data-id="${itemId}" class="photo-box-thumb" title="點擊看大圖" data-fallback="hide">`,
      extraButtons: `<button class="btn btn--danger btn--md btn-prepare" data-action="inventory-kit-photo-delete" data-kit-id="${kitId}" data-id="${itemId}">🗑 刪除</button>`,
    });
  } else {
    renderPendingPhotoBox(KIT_PHOTO_PREFIX, { message: '尚無照片' });
  }
}

/**
 * 透過 Kit 專屬端點刪除照片，避免將 Kit ID 誤當成 backing item ID。
 * @param {number} kitId - kits.id；用於 DELETE /api/kits/{kitId}/photo。
 * @param {number} itemId - kits.item_id；用於更新前端 item/Kit 照片狀態。
 * @returns {Promise<void>} 刪除成功後重繪照片區並刷新目前資料。
 */
export async function deleteKitPhoto(kitId, itemId) {
  try {
    await apiFetch(`/api/kits/${kitId}/photo`, { method: 'DELETE' });

    const clearedPhoto = { has_photo: false, thumbnail_url: null, preview_url: null };
    patchCurrentKit(kitId, clearedPhoto);
    patchItem(itemId, clearedPhoto);
    renderKitPhotoBox(kitId, itemId, false);
    toast('🗑 照片已刪除', 'success');
    await loadData();
  } catch {
    toast('刪除失敗', 'error');
  }
}

// 模組載入時要執行的副作用：由頁面 entry 依原本的載入順序呼叫（issue #39）
// 照片放大的事件委派：各 feature 的縮圖只輸出 data-action="photo-lightbox" data-id，不必 import 或掛 window.Inventory
const PHOTO_ACTIONS = {
  // 縮圖載入失敗時的備援（error / load 不冒泡，delegate 以 capture 接）：hide = 隱藏圖片；sibling = 換成同層的替代圖示
  'photo-lightbox': {
    click: function(el) { openPhotoLightbox(Number(el.dataset.id)); },
    error: function(el) {
      if (el.dataset.fallback === 'sibling') { el.hidden = true; el.nextElementSibling.hidden = false; }
      else if (el.dataset.fallback === 'hide') el.style.display = 'none';
    },
    load: function(el) { if (el.dataset.fallback === 'sibling') el.nextElementSibling.hidden = true; },
  },
};

const photoActions = createActionDelegate('photo-', PHOTO_ACTIONS);

export const handlePhotoActionEvent = photoActions.handle;

export function initInventoryPhoto() {
  photoActions.init();
  // ESC 關閉
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closePhotoLightbox(); });
}
