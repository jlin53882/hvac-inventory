// 庫存管理系統 - 個人改密碼 modal（v11.2 變體 B：密碼強度即時打勾）
// ========== 開啟 / 重設 ==========
function openChangePwModal() {
  document.getElementById('cpw-old').value = '';
  document.getElementById('cpw-new').value = '';
  document.getElementById('cpw-confirm').value = '';
  cpwResetChecks();
  document.getElementById('cpw-mismatch').style.display = 'none';
  openModal('changepw-modal');
  document.getElementById('cpw-old').focus();
}

function cpwResetChecks() {
  ['cpw-len', 'cpw-up', 'cpw-low', 'cpw-digit'].forEach(id => {
    const el = document.getElementById(id);
    el.classList.remove('ok');
    el.innerHTML = '⬜ ' + el.textContent.replace(/^[✅⬜]\s*/, '').trim();
  });
}

// 新密碼輸入時：即時打勾（8 碼以上 / 含大寫 / 含小寫 / 含數字）——共用（cpw-* 與 rpw-* modal 皆可用）
function cpwCheckStrength() { pwStrengthCheck('cpw-new'); }

function pwStrengthCheck(inputId) {
  const v = document.getElementById(inputId).value;
  const prefix = inputId.replace(/-new$/, '');
  const set = (suffix, ok) => {
    const el = document.getElementById(prefix + '-' + suffix);
    if (!el) return;
    const label = el.textContent.replace(/^[✅⬜]\s*/, '').trim();
    el.classList.toggle('ok', ok);
    el.innerHTML = (ok ? '✅ ' : '⬜ ') + label;
  };
  set('len', v.length >= 8);
  set('up', /[A-Z]/.test(v));
  set('low', /[a-z]/.test(v));
  set('digit', /\d/.test(v));
}

// 確認密碼輸入時：不一致警示——共用
function cpwCheckMatch() { pwMatchCheck('cpw-new', 'cpw-confirm', 'cpw-mismatch'); }

function pwMatchCheck(newId, confirmId, warnId) {
  const a = document.getElementById(newId).value;
  const b = document.getElementById(confirmId).value;
  document.getElementById(warnId).style.display = (a && b && a !== b) ? 'block' : 'none';
}

// 送出（PUT /api/auth/password）：驗證舊密碼 → policy → 清其他 session 保留當前
async function submitChangePw() {
  const oldPw = document.getElementById('cpw-old').value;
  const newPw = document.getElementById('cpw-new').value;
  const confirmPw = document.getElementById('cpw-confirm').value;
  if (!oldPw) { toast('請輸入目前密碼', 'error'); return; }
  const pwErr = pwPolicyMsg(newPw);
  if (pwErr) { toast(pwErr, 'error'); return; }
  if (newPw !== confirmPw) { toast('兩次輸入的新密碼不一致', 'error'); return; }
  if (newPw === oldPw) { toast('新密碼不能與原密碼相同', 'error'); return; }
  try {
    const res = await fetch('/api/auth/password', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ old_password: oldPw, new_password: newPw })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { toast('⚠️ ' + (data.detail || '修改失敗'), 'error'); return; }
    closeModal('changepw-modal');
    closeModal('expiry-modal');  // 從過期提示進來的也一起關
    toast('✅ 密碼已更新', 'success');
  } catch (e) {
    toast('⚠️ 修改失敗，請稍後再試', 'error');
  }
}
