// 庫存管理系統 - 工具函式（v8 拆分）
// esc / jsStr / absNum / todayStr / Modal 開關 / toast
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
  el.classList.add('show');
  // 移到 DOM 最後：所有 modal 同 z-index（200），後開的必須蓋過先開的（DOM 順序決定覆蓋）
  document.body.appendChild(el);
}
// 關閉指定 id 的 Modal（移除 show class）
function closeModal(id) {
  document.getElementById(id).classList.remove('show');
}
document.querySelectorAll('.modal-overlay').forEach(m => {
  m.addEventListener('click', e => { if (e.target === m) m.classList.remove('show'); });
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('show'));
});

// ========== toast ==========
function toast(msg, type) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show ' + (type || '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.className = 'toast', 2000);
}
