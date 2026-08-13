// 庫存管理系統 - 密碼過期提示 modal（v11.2：6 個月未改密碼進站彈出，非強制）
// 規則：按「立即改密碼」或「繼續使用原密碼」任一鍵 → 後端重置 180 天（帳號層級）
// ========== 開啟 ==========
function openExpiryModal() {
  // B4（2026-08-13）：只有 admin 可自行改密碼/ack——非 admin 過期只顯示「請聯絡管理員重設」
  const u = (typeof currentUser !== 'undefined') ? currentUser : null;
  const isAdmin = u && !!(u.permissions || {})['change-own-password'];
  const btn = document.querySelector('#expiry-modal .btn-save');
  const ack = document.querySelector('#expiry-modal .btn-cancel');
  const adminOnly = document.getElementById('expiry-admin-only');
  if (btn) btn.style.display = isAdmin ? '' : 'none';
  if (ack) ack.style.display = isAdmin ? '' : 'none';
  if (adminOnly) adminOnly.style.display = isAdmin ? 'none' : '';
  openModal('expiry-modal');
}

// 過期提示的「🔑 立即改密碼」→ 關提示、開改密碼 modal
function expiryGoChangePw() {
  closeModalForce('expiry-modal');
  openChangePwModal();
}

// 「繼續使用原密碼」→ 呼叫 ack 端點重置 180 天計時（跨裝置一致）→ 關閉
async function ackPasswordExpiry() {
  try {
    await fetch('/api/auth/password-ack', { method: 'POST' });
  } catch (e) { /* 網路失敗仍關閉提示，不擋使用 */ }
  closeModalForce('expiry-modal');
}
