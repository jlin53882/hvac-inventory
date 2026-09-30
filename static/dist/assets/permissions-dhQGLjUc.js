import { F as __exportAll, P as state_exports, T as session_exports, _ as utils_exports, d as initUtils, f as jsStr, h as toast, l as esc, m as pwPolicyMsg, n as apiFetch, o as apiErrorMessage, r as api_client_exports } from "./api-client-VLQpIKT7.js";
//#region static/js/features/permissions/page.js
var page_exports = /* @__PURE__ */ __exportAll({
	addUserMode: () => addUserMode,
	closeAccountEditModal: () => closeAccountEditModal,
	closeAddUserModal: () => closeAddUserModal,
	closeResetPermModal: () => closeResetPermModal,
	closeResetPwModal: () => closeResetPwModal,
	confirmResetPerm: () => confirmResetPerm,
	initPermissionsPage: () => initPermissionsPage,
	openAddUserModal: () => openAddUserModal,
	openResetPermModal: () => openResetPermModal,
	permDelete: () => permDelete,
	permEditAccount: () => permEditAccount,
	permFilter: () => permFilter,
	permPage: () => permPage,
	permPageToggle: () => permPageToggle,
	permResetPw: () => permResetPw,
	permSave: () => permSave,
	permSearch: () => permSearch,
	permSelect: () => permSelect,
	permSubTab: () => permSubTab,
	permSwitchTab: () => permSwitchTab,
	permToggle: () => permToggle,
	permToggleActive: () => permToggleActive,
	submitAccountEdit: () => submitAccountEdit,
	submitAddUser: () => submitAddUser,
	submitResetPw: () => submitResetPw
});
var ROLE_LABELS = {
	admin: "🛡️ 管理員",
	user: "👤 使用者",
	tech: "🔧 工程師",
	viewer: "👀 檢視者"
};
var GROUP_LABELS = {
	view: "📋 瀏覽與匯出",
	stock: "📦 庫存管理",
	calendar: "📅 行事曆與派工",
	reports: "📑 報表與零用金",
	system: "⚙️ 系統設定"
};
var PAGE_LABELS = {
	calendar: "📅 行事曆",
	"work-progress": "📸 每日工作進度回報",
	"signed-reports": "🗂 每日簽名日報表",
	quotation: "🧾 報價單",
	"petty-cash": "🪙 零用金月報",
	inventory: "📦 單一庫存",
	prepared: "📤 待領出",
	stockout: "🚚 已領出",
	stocktake: "📋 盤點",
	kit: "🔧 整組庫存",
	perms: "👥 帳號與權限",
	settings: "⚙️ 系統設定",
	"change-password": "🔑 修改密碼"
};
var permUsers = [];
var me = null;
var curUid = null;
var permChanges = {};
var pageChanges = {};
var addMode = "single";
var permissionDetail = null;
var permissionView = "features";
var permissionPage = 1;
var permissionSearch = "";
var permissionModule = "all";
var PERMISSIONS_PAGE_SIZE = 10;
var WORK_PROGRESS_VIEW_KEY = "work-progress-view";
var WORK_PROGRESS_DEPENDENT_KEYS = [
	"work-progress-create",
	"work-progress-edit",
	"work-progress-edit-all",
	"work-progress-delete",
	"work-progress-delete-all"
];
async function permRequest(url, init) {
	try {
		return await apiFetch(url, init);
	} catch (e) {
		if (e.status === 401) {
			location.href = "/login.html";
			throw new Error("未登入");
		}
		throw e;
	}
}
function apiGet(url) {
	return permRequest(url);
}
function apiSend(url, method, body) {
	return permRequest(url, {
		method,
		json: body || void 0
	});
}
async function initPermPage() {
	try {
		me = (await apiGet("/api/auth/me")).user;
		if (!me.is_admin_role || !(me.permissions || {})["user-mgmt"] || Array.isArray(me.visible_pages) && !me.visible_pages.includes("perms")) {
			location.href = "/";
			return;
		}
		permUsers = (await apiGet("/api/users")).users;
		renderUserList();
		renderChips();
		permSelect(permUsers[0].id);
	} catch (e) {
		toast(e.message || "載入失敗", "error");
	}
}
function renderUserList() {
	const el = document.getElementById("userList");
	el.innerHTML = permUsers.map((u) => {
		const isMe = me.id === u.id;
		const cls = u.is_active ? "is-active" : "is-inactive";
		const badge = ROLE_LABELS[u.role] || u.role;
		return `<div class="user-list-item ${u.id === curUid ? "is-active" : ""}" data-uid="${u.id}" onclick="Perms.permSelect(${u.id})">
      <div class="user-avatar ${cls}">${esc(u.display_name ? u.display_name.charAt(0) : "?")}</div>
      <div class="user-meta">
        <div class="user-name">${esc(u.display_name)}${isMe ? " <span class=\"me-tag\">（自己）</span>" : ""}</div>
        <div class="user-sub">${badge} · @${esc(u.username)}</div>
      </div>
      <div class="status-dot ${cls}" title="${u.is_active ? "啟用中" : "已停用"}"></div>
    </div>`;
	}).join("");
}
function renderChips() {
	const el = document.getElementById("chipBar");
	el.innerHTML = permUsers.map((u) => {
		const isMe = me.id === u.id;
		return `<button class="chip ${u.id === curUid ? "is-active" : ""} ${u.is_active ? "" : "is-inactive"}" onclick="Perms.permSelect(${u.id})">
      <span class="status-dot ${u.is_active ? "is-active" : "is-inactive"}"></span>${esc(u.display_name)}${isMe ? "（自己）" : ""}
    </button>`;
	}).join("");
}
async function permSelect(uid) {
	if (uid === curUid) return;
	curUid = uid;
	permChanges = {};
	pageChanges = {};
	renderUserList();
	renderChips();
	renderPanelHead();
	await loadUserDetail();
}
function renderPanelHead() {
	const u = permUsers.find((x) => x.id === curUid);
	if (!u) return;
	const isMe = me.id === u.id;
	document.getElementById("panelHead").innerHTML = `
    <div class="user-avatar ${u.is_active ? "" : "is-inactive"}">${esc(u.display_name.charAt(0) || "?")}</div>
    <div>
      <div class="panel-title">${esc(u.display_name)}${isMe ? " <span class=\"perm-self-tag\">（自己）</span>" : ""}</div>
      <div class="panel-sub">${ROLE_LABELS[u.role] || u.role} · @${esc(u.username)} · ${u.is_active ? "✅ 啟用中" : "⏸ 已停用"}</div>
    </div>`;
}
async function loadUserDetail() {
	try {
		const detail = await apiGet(`/api/users/${curUid}/permissions`);
		renderPerms(detail);
		renderAccount(detail);
	} catch (e) {
		toast(e.message || "載入權限失敗", "error");
	}
}
function renderPerms(detail) {
	permissionDetail = detail;
	permissionPage = 1;
	permissionSearch = "";
	permissionModule = "all";
	permissionView = "features";
	renderPermissionShell();
}
function renderPermissionShell() {
	if (!permissionDetail) return;
	const el = document.getElementById("tab-perms");
	const isMe = me.id === curUid;
	const featureActive = permissionView === "features" ? "is-active" : "";
	const pageActive = permissionView === "pages" ? "is-active" : "";
	let html = isMe ? "<div class=\"warn-box\">⚠️ 不能修改自己的權限（系統保護）——你的權限由另一位管理員管理。</div>" : "";
	html += `<div class="perm-subtabs" role="tablist">
    <button class="chip chip--seg perm-subtab ${esc(featureActive)}" onclick="Perms.permSubTab('features')">🔐 功能權限</button>
    <button class="chip chip--seg perm-subtab ${esc(pageActive)}" onclick="Perms.permSubTab('pages')">🖥 頁面顯示</button>
  </div><div id="permission-view"><div id="permission-toolbar"></div><div id="permission-results"></div></div>`;
	const pendingCount = Object.keys(permChanges).length + Object.keys(pageChanges).length;
	html += `<div class="save-bar">
    <div class="save-bar-inner">
      <span class="save-hint" id="saveHint">${pendingCount ? `有 ${pendingCount} 項未儲存變更` : "變更立即生效，不需重新登入"}</span>
      <div class="save-btns">
        <button class="btn btn--secondary btn--md btn-ghost" onclick="Perms.openResetPermModal()" ${isMe ? "disabled" : ""}>↩ 重設為角色預設</button>
        <button class="btn btn--primary btn--md btn-primary" onclick="Perms.permSave()" ${isMe ? "disabled" : ""}>💾 儲存變更</button>
      </div>
    </div>
  </div>`;
	el.innerHTML = html;
	renderPermissionToolbar();
	renderPermissionView();
	if (pendingCount) document.getElementById("saveHint")?.classList.add("is-changed");
}
function renderPermissionToolbar() {
	const toolbar = document.getElementById("permission-toolbar");
	if (!toolbar || !permissionDetail || permissionView !== "features") return;
	const permissions = permissionDetail.permissions || [];
	const modules = [...new Set(permissions.map((p) => p.module))];
	toolbar.innerHTML = `<label class="perm-search-label" for="permission-search">搜尋權限名稱或 key</label>
    <input id="permission-search" class="perm-search" type="search" value="${esc(permissionSearch)}" placeholder="例如：日報、上傳、delete-all" oninput="Perms.permSearch(this.value)">
    <div class="perm-module-filter" role="group" aria-label="權限分類">
      <button class="chip perm-filter ${esc(permissionModule === "all" ? "is-active" : "")}" data-module="all" onclick="Perms.permFilter('all')">全部</button>
      ${modules.map((mod) => `<button class="chip perm-filter ${esc(permissionModule === mod ? "is-active" : "")}" data-module="${esc(mod)}" onclick="Perms.permFilter('${jsStr(mod)}')">${esc(GROUP_LABELS[mod] || mod)}</button>`).join("")}
    </div>`;
}
function updatePermissionFilterState() {
	document.querySelectorAll?.("#permission-toolbar .perm-filter").forEach((button) => {
		button.classList.toggle("is-active", button.dataset.module === permissionModule);
	});
}
function renderPermissionView() {
	const viewHost = document.getElementById("permission-view");
	if (!viewHost || !permissionDetail) return;
	if (permissionView === "pages") {
		renderPageVisibilityView(viewHost);
		return;
	}
	const host = document.getElementById("permission-results");
	if (!host) return;
	const permissions = permissionDetail.permissions || [];
	const isMe = me.id === curUid;
	const query = permissionSearch.trim().toLowerCase();
	const filtered = permissions.filter((p) => {
		const matchesModule = permissionModule === "all" || p.module === permissionModule;
		const haystack = `${p.label} ${p.key}`.toLowerCase();
		return matchesModule && (!query || haystack.includes(query));
	});
	const pageCount = Math.max(1, Math.ceil(filtered.length / PERMISSIONS_PAGE_SIZE));
	permissionPage = Math.min(Math.max(1, permissionPage), pageCount);
	const start = (permissionPage - 1) * PERMISSIONS_PAGE_SIZE;
	const visible = filtered.slice(start, start + PERMISSIONS_PAGE_SIZE);
	let html = "";
	if (!visible.length) html += "<div class=\"perm-empty\">沒有符合條件的權限</div>";
	else {
		html += "<div class=\"perm-list\">";
		for (const p of visible) {
			const locked = p.source === "locked";
			const hasPending = Object.prototype.hasOwnProperty.call(permChanges, p.key);
			let srcLabel;
			let srcCls;
			if (locked) {
				srcLabel = "🔒 鎖定";
				srcCls = "locked";
			} else if (hasPending) {
				srcLabel = "✏️ 自訂";
				srcCls = "override";
			} else if (p.source === "override") {
				srcLabel = "✏️ 自訂";
				srcCls = "override";
			} else {
				srcLabel = "✓ 跟隨角色";
				srcCls = p.source;
			}
			const checked = (hasPending ? permChanges[p.key] : p.allowed) ? "checked" : "";
			const disabled = locked || isMe;
			html += `<div class="perm-row ${locked ? "locked" : ""}" data-role="perm-row">
        <div class="perm-label">${esc(p.label)}<small>${esc(p.key)}<span class="perm-src ${esc(srcCls)}" data-role="perm-src">${srcLabel}</span></small></div>
        <label class="switch">
          <input type="checkbox" data-key="${esc(p.key)}" ${checked} ${disabled ? "disabled" : ""} onchange="Perms.permToggle('${jsStr(p.key)}', this.checked)">
          <span class="slider"></span>
        </label>
      </div>`;
		}
		html += "</div>";
	}
	const from = filtered.length ? start + 1 : 0;
	const to = Math.min(start + PERMISSIONS_PAGE_SIZE, filtered.length);
	html += `<div class="perm-pagination">
    <span>顯示 ${esc(from)}–${esc(to)} / 共 ${esc(filtered.length)} 項</span>
    <div class="perm-page-buttons">
      <button class="btn btn--secondary btn--sm perm-page-btn" onclick="Perms.permPage(-1)" ${permissionPage <= 1 ? "disabled" : ""}>‹ 上一頁</button>
      <span>第 ${esc(permissionPage)} / ${esc(pageCount)} 頁</span>
      <button class="btn btn--secondary btn--sm perm-page-btn" onclick="Perms.permPage(1)" ${permissionPage >= pageCount ? "disabled" : ""}>下一頁 ›</button>
    </div>
  </div>`;
	host.innerHTML = html;
	updatePermissionFilterState();
}
function renderPageVisibilityView(host) {
	const pageInfo = permissionDetail.page_visibility || {
		all_pages: [],
		visible_pages: []
	};
	const visiblePages = pageInfo.visible_pages || [];
	const isMe = me.id === curUid;
	let html = "<div class=\"perm-group page-visibility-group\"><div class=\"perm-group-title\">🖥 頁面顯示（每頁獨立設定）</div><div class=\"perm-grid\">";
	for (const key of pageInfo.all_pages || []) {
		const checkedValue = Object.prototype.hasOwnProperty.call(pageChanges, key) ? pageChanges[key] : visiblePages.includes(key);
		html += `<div class="perm-row" data-role="perm-row">
      <div class="perm-label">${esc(PAGE_LABELS[key] || key)}<small>${esc(key)}</small></div>
      <label class="switch"><input type="checkbox" data-page-key="${esc(key)}" ${esc(checkedValue ? "checked" : "")} ${isMe ? "disabled" : ""} onchange="Perms.permPageToggle('${jsStr(key)}', this.checked)"><span class="slider"></span></label>
    </div>`;
	}
	host.innerHTML = html + "</div></div>";
}
function permSubTab(view) {
	permissionView = view === "pages" ? "pages" : "features";
	renderPermissionShell();
}
function permSearch(value) {
	permissionSearch = value;
	permissionPage = 1;
	renderPermissionView();
}
function permFilter(module) {
	permissionModule = module;
	permissionPage = 1;
	renderPermissionView();
}
function permPage(delta) {
	permissionPage += delta;
	renderPermissionView();
}
/** Mark a permission row as a local override after a user edit. */
function markPermOverride(key) {
	const row = document.querySelector(`input[data-key="${key}"]`)?.closest("[data-role=\"perm-row\"]");
	const src = row && row.querySelector("[data-role=\"perm-src\"]");
	if (src) {
		src.textContent = "✏️ 自訂";
		src.className = "perm-src override";
	}
}
/** Synchronize a permission checkbox and its pending change record. */
function setPermCheckbox(key, allowed) {
	const input = document.querySelector(`input[data-key="${key}"]`);
	if (input) input.checked = !!allowed;
	permChanges[key] = allowed ? 1 : 0;
	markPermOverride(key);
}
/** Refresh the unsaved-permission count shown to the administrator. */
function refreshPermissionSaveHint() {
	const hint = document.getElementById("saveHint");
	if (!hint) return;
	const n = Object.keys(permChanges).length + Object.keys(pageChanges).length;
	hint.className = n ? "save-hint is-changed" : "save-hint";
	hint.textContent = n ? `有 ${n} 項未儲存變更` : "變更立即生效，不需重新登入";
}
function permToggle(key, checked) {
	permChanges[key] = checked ? 1 : 0;
	markPermOverride(key);
	if (key === WORK_PROGRESS_VIEW_KEY && !checked) WORK_PROGRESS_DEPENDENT_KEYS.forEach(function(dep) {
		setPermCheckbox(dep, false);
	});
	else if (WORK_PROGRESS_DEPENDENT_KEYS.includes(key) && checked) {
		const viewInput = document.querySelector(`input[data-key="${WORK_PROGRESS_VIEW_KEY}"]`);
		if (viewInput && !viewInput.checked) setPermCheckbox(WORK_PROGRESS_VIEW_KEY, true);
	}
	refreshPermissionSaveHint();
}
function permPageToggle(key, checked) {
	pageChanges[key] = checked ? 1 : 0;
	const hint = document.getElementById("saveHint");
	if (hint) {
		const n = Object.keys(permChanges).length + Object.keys(pageChanges).length;
		hint.className = "save-hint is-changed";
		hint.textContent = `有 ${n} 項未儲存變更`;
	}
}
async function permSave() {
	const keys = Object.keys(permChanges);
	const pageKeys = Object.keys(pageChanges);
	if (!keys.length && !pageKeys.length) {
		toast("沒有變更", "info");
		return;
	}
	let permissionsSaved = !keys.length;
	let pageVisibilitySaved = !pageKeys.length;
	try {
		if (keys.length) {
			await apiSend(`/api/users/${curUid}/permissions`, "PUT", { permissions: permChanges });
			permissionsSaved = true;
		}
		if (pageKeys.length) {
			await apiSend(`/api/users/${curUid}/page-visibility`, "PUT", { pages: pageChanges });
			pageVisibilitySaved = true;
		}
		permChanges = {};
		pageChanges = {};
		toast("權限與頁面顯示設定已更新（立即生效）", "success");
		await loadUserDetail();
		renderUserList();
	} catch (e) {
		const partial = keys.length > 0 && permissionsSaved && !pageVisibilitySaved;
		permChanges = {};
		pageChanges = {};
		await loadUserDetail();
		renderUserList();
		toast(partial ? "權限已儲存，但頁面顯示設定儲存失敗，已重新載入最新狀態" : e.message || "儲存失敗", "error");
	}
}
function openResetPermModal() {
	const u = permUsers.find((x) => x.id === curUid);
	if (!u) return;
	document.getElementById("resetPermTarget").textContent = `${u.display_name}（@${u.username}）`;
	document.getElementById("resetPermRole").textContent = ROLE_LABELS[u.role] || u.role;
	document.getElementById("resetPermOverlay").classList.add("is-open");
}
function closeResetPermModal() {
	document.getElementById("resetPermOverlay").classList.remove("is-open");
}
async function confirmResetPerm() {
	closeResetPermModal();
	try {
		await apiSend(`/api/users/${curUid}/permissions`, "PUT", { reset_all: true });
		permChanges = {};
		try {
			await apiSend(`/api/users/${curUid}/page-visibility`, "PUT", { reset_all: true });
			pageChanges = {};
		} catch (pvErr) {
			await loadUserDetail();
			renderUserList();
			toast("權限已重設，但頁面顯示重設失敗，已重新載入最新狀態", "error");
			return;
		}
		toast("已重設為角色預設（權限 + 頁面顯示）", "success");
		await loadUserDetail();
	} catch (e) {
		toast(e.message || "重設失敗", "error");
	}
}
function renderAccount(detail) {
	const el = document.getElementById("tab-account");
	const u = permUsers.find((x) => x.id === curUid);
	if (!u) return;
	const isMe = me.id === curUid;
	const overrideCount = detail.permissions.filter((p) => p.source === "override").length;
	let html = `<div class="account-card">
    <div class="account-field"><div class="k">帳號</div><div class="v">@${esc(u.username)}</div></div>
    <div class="account-field"><div class="k">顯示名稱</div><div class="v">${esc(u.display_name)}</div></div>
    <div class="account-field"><div class="k">角色</div><div class="v">${ROLE_LABELS[u.role] || u.role}</div></div>
    <div class="account-field"><div class="k">狀態</div><div class="v">${u.is_active ? "✅ 啟用中" : "⏸ 已停用"}</div></div>
    <div class="account-field"><div class="k">個人權限設定</div><div class="v">${overrideCount ? `${overrideCount} 項自訂` : "無（完全跟隨角色）"}</div></div>
  </div>`;
	if (isMe) html += `<div class="warn-box">⚠️ 不能停用、刪除或修改自己的帳號（系統保護）。</div>`;
	else {
		html += `<div class="account-actions">
      <button class="btn btn--secondary btn--md" onclick="Perms.permEditAccount(${u.id})">✏️ 編輯帳號</button>
      <button class="btn btn--secondary btn--md" onclick="Perms.permResetPw(${u.id})">🔑 重設密碼</button>
      <button class="btn btn--secondary btn--md" onclick="Perms.permToggleActive(${u.id}, ${u.is_active ? 0 : 1})">${u.is_active ? "⏸ 停用帳號" : "▶️ 啟用帳號"}</button>
      <button class="btn btn--danger btn--md" onclick="Perms.permDelete(${u.id})">🗑 刪除帳號</button>
    </div>`;
		if (u.is_active) html += `<div class="warn-box">💡 停用後該帳號立即無法登入（既有 session 也會失效）。離職員工請用「停用」而非「刪除」。</div>`;
	}
	el.innerHTML = html;
}
function permResetPw(uid) {
	const u = permUsers.find((x) => x.id === uid);
	document.getElementById("resetPwTarget").textContent = `重設 ${u.display_name}（@${u.username}）的密碼`;
	document.getElementById("rp-password").value = "";
	document.getElementById("resetPwOverlay").classList.add("is-open");
}
async function permToggleActive(uid, nextActive) {
	const u = permUsers.find((x) => x.id === uid);
	const msg = nextActive ? `確定要停用「${u.display_name}」嗎？停用後立即無法登入。` : `確定要重新啟用「${u.display_name}」嗎？`;
	if (!confirm(msg)) return;
	try {
		await apiSend(`/api/users/${uid}`, "PUT", { is_active: nextActive });
		toast(nextActive ? "已停用" : "已啟用", "success");
		await reloadUsers();
	} catch (e) {
		toast(e.message || "操作失敗", "error");
	}
}
async function permDelete(uid) {
	const u = permUsers.find((x) => x.id === uid);
	if (!confirm(`確定要刪除「${u.display_name}」嗎？此操作不可復原！\n（有派工紀錄的帳號無法刪除，請改用停用）`)) return;
	try {
		await apiSend(`/api/users/${uid}`, "DELETE");
		toast("已刪除", "success");
		permUsers = permUsers.filter((x) => x.id !== uid);
		curUid = null;
		selectNextUser();
	} catch (e) {
		toast(e.message || "刪除失敗", "error");
	}
}
function selectNextUser() {
	if (!permUsers.length) {
		location.href = "/";
		return;
	}
	permSelect(permUsers[0].id);
}
function permSwitchTab(tab) {
	document.querySelectorAll("[data-role=\"perm-tab\"]").forEach((t) => t.classList.toggle("is-active", t.dataset.tab === tab));
	document.getElementById("tab-perms").style.display = tab === "perms" ? "" : "none";
	document.getElementById("tab-account").style.display = tab === "account" ? "" : "none";
}
function openAddUserModal() {
	addUserMode("single");
	document.getElementById("nu-username").value = "";
	document.getElementById("nu-display").value = "";
	document.getElementById("nu-password").value = "";
	document.getElementById("nu-batch").value = "";
	document.getElementById("nu-batch-result").innerHTML = "";
	document.getElementById("addUserOverlay").classList.add("is-open");
}
function closeAddUserModal() {
	document.getElementById("addUserOverlay").classList.remove("is-open");
}
function addUserMode(mode) {
	addMode = mode;
	document.getElementById("addSingle").style.display = mode === "single" ? "" : "none";
	document.getElementById("addBatch").style.display = mode === "batch" ? "" : "none";
	document.querySelectorAll("#addUserOverlay [data-role=\"add-user-mode\"]").forEach((t) => t.classList.toggle("is-active", t.dataset.mode === mode));
}
async function submitAddUser() {
	const btn = document.getElementById("nu-submit");
	btn.disabled = true;
	try {
		if (addMode === "single") {
			const username = document.getElementById("nu-username").value.trim();
			const display = document.getElementById("nu-display").value.trim();
			const role = document.getElementById("nu-role").value;
			const password = document.getElementById("nu-password").value;
			if (!username || !password) {
				toast("帳號與密碼必填", "error");
				return;
			}
			const pwErr = pwPolicyMsg(password);
			if (pwErr) {
				toast(pwErr, "error");
				return;
			}
			await apiSend("/api/users", "POST", {
				username,
				display_name: display || username,
				role,
				password
			});
			toast(`已建立 ${username}`, "success");
			closeAddUserModal();
			await reloadUsers();
		} else {
			const lines = document.getElementById("nu-batch").value.split("\n").map((s) => s.trim()).filter(Boolean);
			if (!lines.length) {
				toast("請輸入至少一筆", "error");
				return;
			}
			const users = [];
			for (const line of lines) {
				const parts = line.split(",").map((s) => s.trim());
				if (parts.length < 4) {
					toast(`格式錯誤（需 4 欄）：${line}`, "error");
					return;
				}
				const [username, display, role, password] = parts;
				if (!username || !password) {
					toast(`帳號與密碼必填：${line}`, "error");
					return;
				}
				const pwErr = pwPolicyMsg(password);
				if (pwErr) {
					toast(`${username}：${pwErr}`, "error");
					return;
				}
				users.push({
					username,
					display_name: display || username,
					role,
					password
				});
			}
			const res = await apiSend("/api/users/batch", "POST", { users });
			const box = document.getElementById("nu-batch-result");
			box.innerHTML = res.results.map((x) => `<div class="${x.status === "ok" ? "ok" : "err"}">${x.status === "ok" ? "✔" : "✘"} ${esc(x.username)} — ${esc(apiErrorMessage(x.detail))}</div>`).join("");
			if (res.created) {
				toast(`已建立 ${res.created} 筆`, "success");
				await reloadUsers();
			}
		}
	} catch (e) {
		toast(e.message || "建立失敗", "error");
	} finally {
		btn.disabled = false;
	}
}
function permEditAccount(uid) {
	const u = permUsers.find((x) => x.id === uid);
	if (!u || me.id === uid) return;
	document.getElementById("ae-display-name").value = u.display_name || "";
	document.getElementById("ae-role").value = u.role;
	document.getElementById("accountEditOverlay").classList.add("is-open");
}
function closeAccountEditModal() {
	document.getElementById("accountEditOverlay").classList.remove("is-open");
}
async function submitAccountEdit() {
	const uid = curUid;
	const name = document.getElementById("ae-display-name").value.trim();
	const role = document.getElementById("ae-role").value;
	if (!uid || !role) {
		toast("請選擇角色", "error");
		return;
	}
	try {
		await apiSend(`/api/users/${uid}`, "PUT", {
			display_name: name,
			role
		});
		closeAccountEditModal();
		toast("帳號設定已更新", "success");
		await reloadUsers();
	} catch (e) {
		toast(e.message || "更新失敗", "error");
	}
}
async function submitResetPw() {
	const password = document.getElementById("rp-password").value;
	if (!password) {
		toast("請輸入新密碼", "error");
		return;
	}
	const pwErr = pwPolicyMsg(password);
	if (pwErr) {
		toast(pwErr, "error");
		return;
	}
	try {
		await apiSend(`/api/users/${curUid}/password`, "PUT", { password });
		toast("密碼已重設", "success");
		closeResetPwModal();
	} catch (e) {
		toast(e.message || "重設失敗", "error");
	}
}
function closeResetPwModal() {
	document.getElementById("resetPwOverlay").classList.remove("is-open");
}
async function reloadUsers() {
	permUsers = (await apiGet("/api/users")).users;
	renderUserList();
	renderChips();
	renderPanelHead();
	if (curUid) await loadUserDetail();
}
function initPermissionsPage() {
	document.addEventListener("DOMContentLoaded", initPermPage);
}
//#endregion
//#region static/js/pages/permissions.js
window.Perms = {
	addUserMode,
	closeAccountEditModal,
	closeAddUserModal,
	closeResetPermModal,
	closeResetPwModal,
	confirmResetPerm,
	openAddUserModal,
	openResetPermModal,
	permDelete,
	permEditAccount,
	permFilter,
	permPage,
	permPageToggle,
	permResetPw,
	permSave,
	permSearch,
	permSelect,
	permSubTab,
	permSwitchTab,
	permToggle,
	permToggleActive,
	submitAccountEdit,
	submitAddUser,
	submitResetPw
};
window.__hvac = Object.freeze({
	"core/api-client.js": api_client_exports,
	"core/session.js": session_exports,
	"core/state.js": state_exports,
	"core/utils.js": utils_exports,
	"features/permissions/page.js": page_exports
});
initUtils();
initPermissionsPage();
//#endregion
