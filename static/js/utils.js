// 振佳空調庫存管理系統 - 工具函式（v8 拆分）
// esc / absNum / todayStr / Modal 開關 / toast
function esc(s) {
  return (s === null || s === undefined) ? '' :
    String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// 取絕對值並去掉結尾的 .0（例如 -3.0 → 3），回傳字串
function absNum(v) {
  return String(Math.abs(v)).replace(/\.0$/, '');
}

// 回傳今天日期字串 YYYY-MM-DD（月份/日期自動補零）
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ========== Modal ==========
function openModal(id) {
  document.getElementById(id).classList.add('show');
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
