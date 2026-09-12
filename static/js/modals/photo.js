// 庫存管理系統 - 品項照片 + 相似品項提示（v10.1）
// ============================================================
// 照片：編輯 modal 內顯示/上傳/刪除（POST/DELETE /api/items/{id}/photo）
// 相似：新增/編輯時 name/code 輸入 debounce → GET /api/items/similar → 警示框

let similarTimer = null;          // 相似查詢 debounce timer
let similarReqSeq = 0;            // 請求序號：防舊回應覆蓋新輸入（競態防護）

// ========== 照片（編輯 modal） ==========
function renderPhotoBox(itemId, hasPhoto) {
  const box = document.getElementById('e-photo-box');
  if (!box) return;
  const canPhoto = hasPerm('photo');
  if (hasPhoto) {
    box.innerHTML = `
      <img src="${photoSrc(itemId, 'thumbnail')}" alt="品項照片" loading="lazy" decoding="async" width="320" height="240" onclick="openPhotoLightbox(${itemId})"
           style="cursor:pointer" title="點擊看大圖" onerror="this.style.display='none'">
      ${canPhoto ? `<div class="photo-actions" style="flex-direction:row;gap:8px;flex-wrap:wrap">
        <label class="btn-prepare" style="margin:0;text-align:center;cursor:pointer">📷 拍照
          <input type="file" accept="image/*" capture="environment" style="display:none"
                 onchange="uploadItemPhoto(${itemId}, this)">
        </label>
        <label class="btn-prepare" style="margin:0;text-align:center;cursor:pointer">🖼 從相簿選
          <input type="file" accept="image/*" style="display:none"
                 onchange="uploadItemPhoto(${itemId}, this)">
        </label>
        <button class="btn-prepare" style="margin:0;color:#dc2626" onclick="deleteItemPhoto(${itemId})">🗑 刪除</button>
      </div>` : ''}`;
  } else {
    box.innerHTML = canPhoto
      ? `<div style="font-size:11px;color:#999;padding:6px 0">尚無照片</div>
      <div class="photo-actions" style="flex-direction:row;gap:8px;flex-wrap:wrap">
        <label class="btn-prepare" style="margin:0;text-align:center;cursor:pointer">📷 拍照
          <input type="file" accept="image/*" capture="environment" style="display:none"
                 onchange="uploadItemPhoto(${itemId}, this)">
        </label>
        <label class="btn-prepare" style="margin:0;text-align:center;cursor:pointer">🖼 從相簿選
          <input type="file" accept="image/*" style="display:none"
                 onchange="uploadItemPhoto(${itemId}, this)">
        </label>
      </div>`
      : '<div style="font-size:11px;color:#999;padding:6px 0">尚無照片</div>';
  }
}

// 上傳照片（手機：無 capture 屬性 → 系統彈「拍照/相簿」選擇器，兩者皆可）
async function uploadItemPhoto(itemId, input) {
  const file = input.files && input.files[0];
  if (!file) return;
  // 前端驗證：副檔名白名單 + 大小上限 10MB
  const ALLOWED = ['.jpg', '.jpeg', '.png', '.webp'];
  const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
  if (ALLOWED.indexOf(ext) === -1) {
    toast('不支援的圖片格式（限 jpg/png/webp）', 'error'); return;
  }
  if (file.size > 10 * 1024 * 1024) {
    toast('圖片超過 10MB 上限', 'error'); return;
  }
  const fd = new FormData();
  fd.append('file', file);
  try {
    const res = await fetch(`/api/items/${itemId}/photo`, { method: 'POST', body: fd });
    if (!res.ok) {
      let msg = '上傳失敗';
      try { const err = await res.json(); if (err.detail) msg = err.detail; } catch {}
      toast('⚠️ ' + msg, 'error');
      return;
    }
    const body = await res.json().catch(() => ({}));
    toast('✅ 照片已更新', 'success');
    // 先更新列表狀態，再重繪編輯 modal，避免 modal 暫留舊縮圖
    const item = ALL_ITEMS.find(i => i.id === itemId);
    if (item) { item.has_photo = true; item.photo_asset_id = body.asset_id || null; item.thumbnail_url = body.thumbnail_url || null; item.preview_url = body.preview_url || null; renderInventory(); }
    renderPhotoBox(itemId, true);
  } catch { toast('上傳失敗', 'error'); }
  input.value = '';  // 允許重選同一檔案
}

// 刪除照片（冪等）
async function deleteItemPhoto(itemId) {
  try {
    const res = await fetch(`/api/items/${itemId}/photo`, { method: 'DELETE' });
    if (!res.ok) { toast('刪除失敗', 'error'); return; }
    toast('🗑 照片已刪除', 'success');
    renderPhotoBox(itemId, false);
    const item = ALL_ITEMS.find(i => i.id === itemId);
    if (item) { item.has_photo = false; renderInventory(); }
  } catch { toast('刪除失敗', 'error'); }
}

// ========== 大圖檢視（lightbox） ==========
// 點卡片/編輯 modal 的縮圖 → 全螢幕 overlay 顯示 800px 大圖，點擊或 ESC 關閉
let photoLightboxEl = null;

function openPhotoLightbox(itemId) {
  closePhotoLightbox();
  const overlay = document.createElement('div');
  overlay.id = 'photo-lightbox';
  overlay.innerHTML = `
    <div class="lightbox-content">
      <img src="${photoSrc(itemId, 'preview')}" alt="品項照片大圖" decoding="async" onclick="event.stopPropagation()">
      <div class="lightbox-close" onclick="closePhotoLightbox()">✕</div>
    </div>`;
  overlay.onclick = closePhotoLightbox;
  document.body.appendChild(overlay);
  photoLightboxEl = overlay;
}

// 關閉大圖檢視（移除 overlay 元素）
function closePhotoLightbox() {
  if (photoLightboxEl) { photoLightboxEl.remove(); photoLightboxEl = null; }
}

// ESC 關閉
document.addEventListener('keydown', e => { if (e.key === 'Escape') closePhotoLightbox(); });

// ========== 相似品項提示（新增/編輯共用） ==========
// bindSimilarCheck(inputNameId, inputCodeId, warnId, excludeId)
//   - inputNameId/inputCodeId：觸發輸入框 id
//   - warnId：警示框 id
//   - excludeId：排除的品項 id（編輯時排除自己；新增傳 null）
function bindSimilarCheck(nameId, codeId, warnId, excludeId) {
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
  const seq = ++similarReqSeq;
  const params = new URLSearchParams();
  if (name) params.set('name', name);
  if (code) params.set('code', code);
  params.set('site', currentSite);
  if (excludeId) params.set('exclude_id', excludeId);
  try {
    const res = await fetch(`/api/items/similar?${params}`);
    if (!res.ok) return;
    const hits = await res.json();
    if (seq !== similarReqSeq) return;  // 已有更新的輸入 → 丟棄這次結果
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
          · 共 ${(typeof Qty !== 'undefined') ? Qty.disp(h.total_qty, h.unit) : h.total_qty} ${esc(h.unit || '個')}
          ${h.stocks && h.stocks.length ? '· ' + esc(h.stocks.map(s => s.location + '×' + s.qty).join(', ')) : ''}</span>
        <a href="#" onclick="goEditSimilar(${h.id}); return false;">去編輯 →</a>
      </div>`).join('')}`;
  box.style.display = 'block';
}

// 點「去編輯」→ 關閉新增/編輯 modal、開該品項編輯 modal
function goEditSimilar(id) {
  closeModalForce('add-modal');
  closeModalForce('edit-modal');
  openEditModal(id);
}
