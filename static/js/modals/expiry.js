// 庫存管理系統 - 密碼過期提示 modal（v11.2：6 個月未改密碼進站彈出，非強制）
// 規則：按「立即改密碼」或「繼續使用原密碼」任一鍵 → 後端重置 180 天（帳號層級）
// ========== 開啟 ==========
function openExpiryModal() {
  openModal('expiry-modal');
}

// 過期提示的「🔑 立即改密碼」→ 關提示、開改密碼 modal
function expiryGoChangePw() {
  closeModal('expiry-modal');
  openChangePwModal();
}

// 「繼續使用原密碼」→ 呼叫 ack 端點重置 180 天計時（跨裝置一致）→ 關閉
async function ackPasswordExpiry() {
  try {
    await fetch('/api/auth/password-ack', { method: 'POST' });
  } catch (e) { /* 網路失敗仍關閉提示，不擋使用 */ }
  closeModal('expiry-modal');
}
