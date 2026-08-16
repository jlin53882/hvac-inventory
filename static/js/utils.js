// 庫存管理系統 - 工具函式（v8 拆分）
// esc / jsStr / absNum / todayStr / Modal 開關 / toast
// RBAC（2026-08-13）：前端權限判斷 helper——currentUser.permissions 由 /api/auth/me 回傳
function hasPerm(key) {
  return typeof currentUser !== 'undefined' && !!currentUser && !!(currentUser.permissions || {})[key];
}

// 密碼 policy（2026-08-16 補：對齊後端 _check_pw——至少 8 碼 + 大寫 + 小寫 + 數字）
// 通過回傳 null，否則回傳錯誤訊息（changepw.js submitChangePw 依賴此函式）
function pwPolicyMsg(pw) {
  if (!pw || pw.length < 8) return '密碼至少 8 碼';
  if (!/[A-Z]/.test(pw)) return '密碼需包含至少一個大寫字母';
  if (!/[a-z]/.test(pw)) return '密碼需包含至少一個小寫字母';
  if (!/\d/.test(pw)) return '密碼需包含至少一個數字';
  return null;
}

function esc(s) {
  return (s === null || s === undefined) ? '' :
    String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// JS 字串 literal escape（用在 inline handler 的 '...' 內，防單引號/反斜線注入 XSS）
function jsStr(s) {
  return String(s == null ? '' : s)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

// 取絕對值、四捨五入到小數 3 位並去掉結尾的 .0（例如 -3.0 → 3、0.30000000000000004 → 0.3），回傳字串
function absNum(v) {
  const n = Math.abs(Number(v));
  if (!isFinite(n)) return '';
  const r = Math.round(n * 1000) / 1000;
  return String(r).replace(/\.0$/, '');
}

// 回傳今天日期字串 YYYY-MM-DD（月份/日期自動補零）
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ========== Modal ==========
function openModal(id) {
  const el = document.getElementById(id);
  if (!el) { console.error('[openModal] modal 不存在:', id); return; }
  el.classList.add('show');
  // 移到 DOM 最後：所有 modal 同 z-index（200），後開的必須蓋過先開的（DOM 順序決定覆蓋）
  document.body.appendChild(el);
  _snapshotModal(id);  // M15：開啟時快照初始值（未存變更保護用）
}

// ---------- 未存變更保護（M15）：開啟快照 → 關閉前比對，有變更先確認 ----------
var __modalSnapshots = {};
function _snapshotModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const vals = [];
  el.querySelectorAll('input, select, textarea').forEach(f => vals.push(f.value));
  __modalSnapshots[id] = vals.join('\u0001');
}
function _modalDirty(id) {
  const el = document.getElementById(id);
  if (!el || !(id in __modalSnapshots)) return false;
  const vals = [];
  el.querySelectorAll('input, select, textarea').forEach(f => vals.push(f.value));
  return vals.join('\u0001') !== __modalSnapshots[id];
}
// 關閉指定 id 的 Modal（移除 show class）；有未存變更先確認
function closeModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  if (_modalDirty(id) && !confirm('有未儲存的變更，確定要離開嗎？')) return;
  el.classList.remove('show');
  delete __modalSnapshots[id];
}
function closeModalForce(id) {  // 儲存成功等明確動作：跳過未存變更確認
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('show');
  delete __modalSnapshots[id];
}
document.querySelectorAll('.modal-overlay').forEach(m => {
  m.addEventListener('click', e => { if (e.target === m) closeModal(m.id); });
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') document.querySelectorAll('.modal-overlay.show').forEach(m => closeModal(m.id));
});

// ========== toast ==========
function toast(msg, type) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show ' + (type || '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.className = 'toast', 2000);
}
