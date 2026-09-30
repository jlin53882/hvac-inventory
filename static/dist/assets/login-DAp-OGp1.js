import { n as apiFetch } from "./api-client-BONt4_ll.js";
//#region static/js/pages/login.js
var form = document.getElementById("loginForm");
var usernameEl = document.getElementById("username");
var passwordEl = document.getElementById("password");
var loginBtn = document.getElementById("loginBtn");
var btnText = document.getElementById("btnText");
var errorBox = document.getElementById("errorBox");
var errorMsg = document.getElementById("errorMsg");
var successOv = document.getElementById("successOverlay");
var rememberEl = document.getElementById("remember");
var forgotLink = document.getElementById("forgotLink");
var toggleBtn = document.getElementById("pwToggle");
function showError(msg, info) {
	errorMsg.textContent = msg;
	errorBox.classList.remove("is-open", "info");
	errorBox.offsetWidth;
	if (info) errorBox.classList.add("info");
	errorBox.classList.add("is-open");
	if (!info) {
		passwordEl.classList.add("err");
		setTimeout(() => passwordEl.classList.remove("err"), 1500);
	}
}
function loginErrorMessage(status) {
	if (status === 429) return "嘗試次數過多，請 15 分鐘後再試";
	if (status === 403) return "帳號已被停用，請聯絡管理員";
	if (!status) return "無法連線伺服器，請稍後再試";
	return "帳號或密碼錯誤";
}
async function submitLogin(e) {
	e.preventDefault();
	const u = usernameEl.value.trim();
	const p = passwordEl.value;
	if (!u) {
		showError("請輸入帳號");
		usernameEl.focus();
		return;
	}
	if (!p) {
		showError("請輸入密碼");
		passwordEl.focus();
		return;
	}
	loginBtn.disabled = true;
	btnText.textContent = "⏳ 登入中…";
	try {
		await apiFetch("/api/auth/login", {
			method: "POST",
			json: {
				username: u,
				password: p
			}
		});
		try {
			if (rememberEl.checked) localStorage.setItem("inv_username", u);
			else localStorage.removeItem("inv_username");
		} catch (err) {}
		successOv.classList.add("is-open");
		setTimeout(() => {
			window.location.href = "/";
		}, 900);
	} catch (err) {
		showError(loginErrorMessage(err.status));
		if (err.status && err.status !== 429 && err.status !== 403) {
			passwordEl.value = "";
			passwordEl.focus();
		}
	} finally {
		loginBtn.disabled = false;
		btnText.textContent = "🔓 登入";
	}
}
apiFetch("/api/auth/me").then(() => {
	window.location.href = "/";
}).catch(() => {});
try {
	const saved = localStorage.getItem("inv_username");
	if (saved) {
		usernameEl.value = saved;
		rememberEl.checked = true;
	}
} catch (e) {}
toggleBtn.addEventListener("click", () => {
	const show = passwordEl.type === "password";
	passwordEl.type = show ? "text" : "password";
	toggleBtn.textContent = show ? "🙈" : "👁️";
});
forgotLink.addEventListener("click", (e) => {
	e.preventDefault();
	showError("請聯絡系統管理員重設密碼", true);
});
form.addEventListener("submit", submitLogin);
usernameEl.focus();
//#endregion
