// gcal-key.js — Google 行事曆同步 Key 新增/編輯 Modal
// 新增可上傳 .json；編輯也可重新上傳，但伺服器端憑證路徑不回傳到瀏覽器。

import { apiFetch } from '../../core/api-client.js';
import { toast } from '../../core/utils.js';
import { gcalKeys, loadGcalKeys, renderGcalPanel } from './gcal.js';

var _gcalEditingId = null;  // null=新增, 數字=編輯

export function gcalFileSelected(input) {
  const file = input && input.files && input.files[0];
  const meta = document.getElementById('gk-file-meta');
  const name = document.getElementById('gk-file-name');
  const hint = document.getElementById('gk-file-hint');
  const path = document.getElementById('gk-cred');
  if (file) {
    if (path) path.value = '';
    if (name) name.textContent = file.name;
    if (meta) meta.style.display = 'flex';
    if (hint) hint.textContent = '已選擇上傳檔案，不需要再輸入 JSON 路徑。';
  } else {
    clearGcalFile();
  }
}

export function clearGcalFile() {
  const file = document.getElementById('gk-file');
  const meta = document.getElementById('gk-file-meta');
  const name = document.getElementById('gk-file-name');
  const hint = document.getElementById('gk-file-hint');
  if (file) file.value = '';
  if (meta) meta.style.display = 'none';
  if (name) name.textContent = '';
  if (hint) hint.textContent = '上傳後由伺服器固定儲存檔名；只會顯示 client_email，不會顯示 private_key。';
}

export function openGcalKeyModal(id) {
  _gcalEditingId = id || null;
  const modal = document.getElementById('gcalKeyModal');
  if (!modal) return;

  if (_gcalEditingId) {
    // 編輯模式：填入現有值
    const k = gcalKeys.find(x => x.id === _gcalEditingId);
    document.getElementById('gk-name').value = k ? k.name : '';
    document.getElementById('gk-cred').value = ''; // server path is intentionally not exposed
    clearGcalFile();
    document.getElementById('gk-cal').value = k ? k.calendar_id : '';
    document.querySelector('#gcalKeyModal h4').textContent = '✏️ 編輯 Service Account Key';
  } else {
    // 新增模式
    document.getElementById('gk-name').value = '';
    document.getElementById('gk-cred').value = '';
    clearGcalFile();
    document.getElementById('gk-cal').value = '';
    document.querySelector('#gcalKeyModal h4').textContent = '＋ 新增 Service Account Key';
  }
  modal.classList.add('is-open');
}

export function closeGcalKeyModal() {
  const modal = document.getElementById('gcalKeyModal');
  if (modal) modal.classList.remove('is-open');
  _gcalEditingId = null;
}

export async function submitGcalKey() {
  const name = (document.getElementById('gk-name').value || '').trim();
  const cred = (document.getElementById('gk-cred').value || '').trim();
  const cal = (document.getElementById('gk-cal').value || '').trim();

  if (!name) { toast('請輸入 Key 名稱', 'error'); return; }
  const file = document.getElementById('gk-file').files[0];
  if (!_gcalEditingId && !cred && !file) { toast('請上傳 JSON 或輸入 JSON 檔路徑', 'error'); return; }
  if (!cal) { toast('請輸入 Calendar ID', 'error'); return; }

  const url = _gcalEditingId ? '/api/gcal-keys/' + _gcalEditingId : '/api/gcal-keys';
  const method = _gcalEditingId ? 'PUT' : 'POST';
  let options;
  if (file) {
    // 有選檔案 → 用 FormData（新增或編輯都支援上傳）
    const form = new FormData();
    form.append('name', name);
    form.append('calendar_id', cal);
    form.append('credentials_file', file);
    options = { method, body: form, fallback: '儲存失敗' };
  } else if (_gcalEditingId) {
    // 編輯但沒選檔案 → 用 JSON（可能改名稱/calendar_id）
    options = {
      method,
      json: { name, credentials_path: cred || undefined, calendar_id: cal },
      fallback: '儲存失敗',
    };
  } else {
    // 新增沒選檔案 → 必須有路徑
    if (!cred) { toast('請上傳 JSON 或輸入 JSON 檔路徑', 'error'); return; }
    const form = new FormData();
    form.append('name', name);
    form.append('calendar_id', cal);
    form.append('credentials_path', cred);
    options = { method, body: form, fallback: '儲存失敗' };
  }

  try {
    await apiFetch(url, options);
    await loadGcalKeys();
    renderGcalPanel();
    closeGcalKeyModal();
    toast(_gcalEditingId ? '✅ 已更新' : '✅ 已新增', 'success');
  } catch (e) { toast(gcalKeySaveErrorMessage(e), 'error'); }
}

/**
 * 儲存 Key 失敗的顯示文字：更換 Calendar ID 時舊行事曆事件未刪完（409 物件 detail）顯示專屬說明，其餘沿用 apiFetch 訊息。
 * @param {Error & {status?: number, detail?: unknown}} e apiFetch 丟出的錯誤。
 * @returns {string} 可顯示的錯誤訊息。
 */
export function gcalKeySaveErrorMessage(e) {
  const d = e && e.detail;
  if (e && e.status === 409 && d && typeof d === 'object' && d.key_updated === false) {
    return '舊行事曆的 Google 事件刪除未完成（已刪除 ' + (Number(d.google_deleted) || 0) + ' 筆、失敗 '
      + (Number(d.google_failed) || 0) + ' 筆），Key 未更新；請先處理同步清單後再更換 Calendar ID';
  }
  return e && e.message ? e.message : '儲存失敗';
}
