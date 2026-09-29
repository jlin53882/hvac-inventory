// login.html 的進入點（issue #39：原 login.html 內嵌 script）：已登入直接進主頁、記住帳號、密碼顯示切換、登入送出。
// 登入頁不呼叫 initSession（不攔截 401 跳轉），API 一律經 core/api-client.js。

import { apiFetch } from '../core/api-client.js';

const form = document.getElementById('loginForm');
const usernameEl = document.getElementById('username');
const passwordEl = document.getElementById('password');
const loginBtn = document.getElementById('loginBtn');
const btnText = document.getElementById('btnText');
const errorBox = document.getElementById('errorBox');
const errorMsg = document.getElementById('errorMsg');
const successOv = document.getElementById('successOverlay');
const rememberEl = document.getElementById('remember');
const forgotLink = document.getElementById('forgotLink');
const toggleBtn = document.getElementById('pwToggle');

function showError(msg, info) {
  errorMsg.textContent = msg;
  errorBox.classList.remove('is-open', 'info');
  void errorBox.offsetWidth;  // 重新觸發 shake 動畫
  if (info) errorBox.classList.add('info');
  errorBox.classList.add('is-open');
  if (!info) {
    passwordEl.classList.add('err');
    setTimeout(() => passwordEl.classList.remove('err'), 1500);
  }
}

// 登入失敗的畫面訊息（依 HTTP 狀態；status 0 = 連不到伺服器）
function loginErrorMessage(status) {
  if (status === 429) return '嘗試次數過多，請 15 分鐘後再試';
  if (status === 403) return '帳號已被停用，請聯絡管理員';
  if (!status) return '無法連線伺服器，請稍後再試';
  return '帳號或密碼錯誤';
}

async function submitLogin(e) {
  e.preventDefault();
  const u = usernameEl.value.trim();
  const p = passwordEl.value;
  if (!u) { showError('請輸入帳號'); usernameEl.focus(); return; }
  if (!p) { showError('請輸入密碼'); passwordEl.focus(); return; }

  loginBtn.disabled = true;
  btnText.textContent = '⏳ 登入中…';
  try {
    await apiFetch('/api/auth/login', { method: 'POST', json: { username: u, password: p } });
    // 記住帳號（只存帳號）
    try {
      if (rememberEl.checked) localStorage.setItem('inv_username', u);
      else localStorage.removeItem('inv_username');
    } catch (err) {}
    // ✅ 成功：顯示覆蓋層 → 跳轉主頁
    successOv.classList.add('is-open');
    setTimeout(() => { window.location.href = '/'; }, 900);
  } catch (err) {
    showError(loginErrorMessage(err.status));
    if (err.status && err.status !== 429 && err.status !== 403) { passwordEl.value = ''; passwordEl.focus(); }
  } finally {
    loginBtn.disabled = false;
    btnText.textContent = '🔓 登入';
  }
}

// 已登入（有 session）就直接進主頁
apiFetch('/api/auth/me').then(() => { window.location.href = '/'; }).catch(() => {});

// 記住帳號：載入時回填（只存帳號，不存密碼）
try {
  const saved = localStorage.getItem('inv_username');
  if (saved) { usernameEl.value = saved; rememberEl.checked = true; }
} catch (e) { /* localStorage 不可用就略過 */ }

// 密碼顯示/隱藏
toggleBtn.addEventListener('click', () => {
  const show = passwordEl.type === 'password';
  passwordEl.type = show ? 'text' : 'password';
  toggleBtn.textContent = show ? '🙈' : '👁️';
});

// 忘記密碼：系統無信箱機制 → 提示聯絡管理員
forgotLink.addEventListener('click', (e) => {
  e.preventDefault();
  showError('請聯絡系統管理員重設密碼', true);
});

form.addEventListener('submit', submitLogin);

// 預先聚焦帳號欄
usernameEl.focus();
