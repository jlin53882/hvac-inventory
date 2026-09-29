//#region \0rolldown/runtime.js
var __defProp = Object.defineProperty;
var __exportAll = (all, no_symbols) => {
	let target = {};
	for (var name in all) __defProp(target, name, {
		get: all[name],
		enumerable: true
	});
	if (!no_symbols) __defProp(target, Symbol.toStringTag, { value: "Module" });
	return target;
};
//#endregion
//#region static/js/core/state.js
var state_exports = /* @__PURE__ */ __exportAll({
	CAL_PALETTE: () => CAL_PALETTE,
	CAL_WEEK: () => CAL_WEEK,
	DATA_REFRESH_PRESERVE_MOUNT_TABS: () => DATA_REFRESH_PRESERVE_MOUNT_TABS,
	INVENTORY_ALERT_ITEMS: () => INVENTORY_ALERT_ITEMS,
	INVENTORY_PENDING_ITEMS: () => INVENTORY_PENDING_ITEMS,
	INVENTORY_SITES: () => INVENTORY_SITES,
	ITEMLESS_TABS: () => ITEMLESS_TABS,
	appState: () => appState,
	pending: () => pending,
	pendingByStock: () => pendingByStock,
	wprHistoryPageSize: () => 20
});
var pending = {};
var pendingByStock = {};
var INVENTORY_PENDING_ITEMS = {};
var INVENTORY_ALERT_ITEMS = {};
var ITEMLESS_TABS = /* @__PURE__ */ new Set([
	"calendar",
	"work-progress",
	"signed-reports",
	"quotation",
	"petty-cash"
]);
var DATA_REFRESH_PRESERVE_MOUNT_TABS = /* @__PURE__ */ new Set([
	"work-progress",
	"signed-reports",
	"quotation",
	"petty-cash"
]);
var INVENTORY_SITES = [
	"office",
	"warehouse",
	"van",
	"truck"
];
var _calM = new URLSearchParams(location.search).get("month");
var appState = {
	ALL_ITEMS: [],
	INVENTORY_META: {
		page: 1,
		page_size: 50,
		total: 0,
		stats: null
	},
	INVENTORY_FACETS: {
		brands: {},
		categories: {},
		locations: []
	},
	inventoryRequestSeq: 0,
	inventoryAbortController: null,
	dataRequestSeq: 0,
	dataAbortController: null,
	statsRequestSeq: 0,
	statsAbortController: null,
	ALERTS_BY_SITE: {},
	inventoryLoadedSite: "",
	inventoryFacetsLoadedSite: "",
	fullItemsLoadedSite: "",
	preparedItems: [],
	currentBrands: [],
	currentCategories: [],
	STATUS_LIST_CONTEXT: null,
	currentTab: "calendar",
	currentSite: "office",
	editItemId: null,
	currentKitItems: [],
	DESTINATIONS: [],
	destinationsLoadedSite: "",
	toastTimer: void 0,
	calMonth: _calM && /^\d{4}-\d{2}$/.test(_calM) && Number(_calM.slice(5, 7)) >= 1 && Number(_calM.slice(5, 7)) <= 12 ? new Date(parseInt(_calM.slice(0, 4)), parseInt(_calM.slice(5, 7)) - 1, 1) : /* @__PURE__ */ new Date(),
	unitListActive: [],
	batchMode: false,
	globalCabinetList: []
};
var CAL_PALETTE = [
	"#1a73e8",
	"#e91e63",
	"#9c27b0",
	"#2e7d32",
	"#f57c00",
	"#00838f",
	"#c62828",
	"#5d4037"
];
var CAL_WEEK = [
	"日",
	"一",
	"二",
	"三",
	"四",
	"五",
	"六"
];
//#endregion
//#region static/js/core/session.js
var session_exports = /* @__PURE__ */ __exportAll({
	canAccessPage: () => canAccessPage,
	checkAuth: () => checkAuth,
	currentUser: () => currentUser,
	firstAccessiblePageTab: () => firstAccessiblePageTab,
	initSession: () => initSession,
	logout: () => logout,
	resolveAccessiblePageTab: () => resolveAccessiblePageTab
});
var currentUser = null;
async function checkAuth() {
	try {
		var res = await fetch("/api/auth/me");
		if (!res.ok) {
			window.location.href = "/login.html";
			return null;
		}
		currentUser = (await res.json()).user;
		return currentUser;
	} catch (e) {
		return null;
	}
}
async function logout() {
	try {
		await fetch("/api/auth/logout", { method: "POST" });
	} catch (e) {}
	try {
		Object.keys(localStorage).filter(function(k) {
			return k.indexOf("hvac_collapsed_locs_") === 0;
		}).forEach(function(k) {
			localStorage.removeItem(k);
		});
	} catch (e) {}
	window.location.href = "/login.html";
}
var PAGE_VISIBILITY_TABS = [
	"calendar",
	"work-progress",
	"signed-reports",
	"quotation",
	"petty-cash",
	"inventory",
	"prepared",
	"stockout",
	"stocktake",
	"kit"
];
function isPageVisible(pageKey) {
	if (!currentUser || !Array.isArray(currentUser.visible_pages)) return true;
	return currentUser.visible_pages.indexOf(pageKey) >= 0;
}
function hasPageCapability(pageKey, mode) {
	var perms = currentUser && currentUser.permissions ? currentUser.permissions : {};
	var any = function(keys) {
		return keys.some(function(key) {
			return !!perms[key];
		});
	};
	if (pageKey === "petty-cash") return !!perms["petty-cash-view"];
	if (pageKey === "prepared" || pageKey === "stockout") return !!perms.prepared;
	if (pageKey === "stocktake") return mode === "operate" ? !!perms.stocktake : !!(perms.view || perms.stocktake);
	if (pageKey === "kit") return !!perms["kit-view"];
	if (pageKey === "calendar") return !!(perms.view || perms["cal-mgmt"]);
	if (pageKey === "work-progress") return !!perms["work-progress-view"];
	if (pageKey === "perms") return !!perms["user-mgmt"];
	if (pageKey === "settings") return any([
		"unit-mgmt",
		"gcal-sync-manage",
		"gcal-keys-manage",
		"petty-cash-config",
		"change-own-password"
	]);
	if (pageKey === "change-password") return !!perms["change-own-password"];
	return !!perms.view;
}
function canAccessPage(pageKey, mode) {
	return isPageVisible(pageKey) && hasPageCapability(pageKey, mode);
}
function firstAccessiblePageTab() {
	for (var i = 0; i < PAGE_VISIBILITY_TABS.length; i += 1) if (canAccessPage(PAGE_VISIBILITY_TABS[i])) return PAGE_VISIBILITY_TABS[i];
	return null;
}
function resolveAccessiblePageTab(requestedTab) {
	return canAccessPage(requestedTab) ? requestedTab : firstAccessiblePageTab();
}
function initSession() {
	(function() {
		var _origFetch = window.fetch;
		window.fetch = async function(url, opts) {
			var res = await _origFetch(url, opts);
			if (res.status === 401 && !window.__authRedirecting) {
				if (Object.keys(pending).length > 0) alert("⚠️ 登入已過期，部分調整可能未儲存。請重新登入。");
				window.__authRedirecting = true;
				window.location.href = "/login.html";
			}
			return res;
		};
	})();
}
//#endregion
//#region static/js/core/utils.js
var utils_exports = /* @__PURE__ */ __exportAll({
	absNum: () => absNum,
	apiErrorMessage: () => apiErrorMessage,
	closeModal: () => closeModal,
	closeModalForce: () => closeModalForce,
	esc: () => esc,
	hasPerm: () => hasPerm,
	initUtils: () => initUtils,
	jsStr: () => jsStr,
	openModal: () => openModal,
	pwPolicyMsg: () => pwPolicyMsg,
	toast: () => toast,
	todayStr: () => todayStr
});
function hasPerm(key) {
	return !!currentUser && !!(currentUser.permissions || {})[key];
}
function pwPolicyMsg(pw) {
	if (!pw || pw.length < 8) return "密碼至少 8 碼";
	if (!/[A-Z]/.test(pw)) return "密碼需包含至少一個大寫字母";
	if (!/[a-z]/.test(pw)) return "密碼需包含至少一個小寫字母";
	if (!/\d/.test(pw)) return "密碼需包含至少一個數字";
	return null;
}
function esc(s) {
	return s === null || s === void 0 ? "" : String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function jsStr(s) {
	return String(s == null ? "" : s).replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/"/g, "\\\"").replace(/\n/g, "\\n").replace(/\r/g, "\\r");
}
function absNum(v) {
	const n = Math.abs(Number(v));
	if (!isFinite(n)) return "";
	const r = Math.round(n * 1e3) / 1e3;
	return String(r).replace(/\.0$/, "");
}
function todayStr() {
	const d = /* @__PURE__ */ new Date();
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function openModal(id) {
	const el = document.getElementById(id);
	if (!el) {
		console.error("[openModal] modal 不存在:", id);
		return;
	}
	el.classList.add("is-open");
	document.body.appendChild(el);
	_snapshotModal(id);
}
var __modalSnapshots = {};
function _snapshotModal(id) {
	const el = document.getElementById(id);
	if (!el) return;
	const vals = [];
	el.querySelectorAll("input, select, textarea").forEach((f) => vals.push(f.value));
	__modalSnapshots[id] = vals.join("");
}
function _modalDirty(id) {
	const el = document.getElementById(id);
	if (!el || !(id in __modalSnapshots)) return false;
	const vals = [];
	el.querySelectorAll("input, select, textarea").forEach((f) => vals.push(f.value));
	return vals.join("") !== __modalSnapshots[id];
}
function closeModal(id) {
	const el = document.getElementById(id);
	if (!el) return;
	if (_modalDirty(id) && !confirm("有未儲存的變更，確定要離開嗎？")) return;
	el.classList.remove("is-open");
	delete __modalSnapshots[id];
}
function closeModalForce(id) {
	const el = document.getElementById(id);
	if (!el) return;
	el.classList.remove("is-open");
	delete __modalSnapshots[id];
}
/**
* 將 FastAPI 結構化驗證錯誤轉成可直接閱讀的繁體中文訊息。
* @param {unknown} value API detail、錯誤物件或一般訊息。
* @returns {string} 可顯示的純文字錯誤訊息。
*/
function apiErrorMessage(value) {
	const labels = {
		prepared_by: "製表人",
		upload_person: "上傳人",
		filename_text: "檔名文字",
		start_date: "開始日期",
		end_date: "結束日期",
		opening_balance: "上期餘額",
		report_type: "報表類型",
		name: "名稱",
		brand: "品牌",
		code: "料號",
		unit: "單位",
		category: "分類",
		low_stock: "低庫存警示",
		qty: "數量",
		amount: "金額",
		item_name: "品項",
		description: "說明",
		entry_date: "日期",
		customer_name: "客戶名稱",
		quote_date: "報價日期",
		unit_price: "單價",
		note: "備註",
		uploader_name: "上傳人姓名",
		report_date: "報表日期"
	};
	/**
	* 將單筆驗證錯誤的位置與限制轉成易讀欄位訊息。
	* @param {unknown} error FastAPI/Pydantic 回傳的驗證錯誤項目。
	* @returns {string} 單筆錯誤的繁體中文文字。
	*/
	const describe = (error) => {
		if (typeof error === "string") return error;
		if (!error || typeof error !== "object") return String(error == null ? "" : error);
		const loc = Array.isArray(error.loc) ? error.loc : [];
		const key = String([...loc].reverse().find((part) => typeof part === "string" && ![
			"body",
			"query",
			"path"
		].includes(part)) || "");
		const field = labels[key] || key;
		const ctx = error.ctx || {};
		const reason = {
			string_too_long: `不可超過 ${ctx.max_length || "限制"} 個字`,
			string_too_short: `至少需要 ${ctx.min_length || "指定"} 個字`,
			missing: "為必填欄位",
			greater_than_equal: `不可小於 ${ctx.ge}`,
			greater_than: `必須大於 ${ctx.gt}`,
			less_than_equal: `不可大於 ${ctx.le}`,
			less_than: `必須小於 ${ctx.lt}`,
			value_error: String(error.msg || "格式不正確").replace(/^Value error,?\s*/i, ""),
			json_invalid: "資料格式錯誤，請重新整理後再試",
			union_tag_invalid: "類型不正確"
		}[error.type] || "格式不正確或不符合限制";
		return field ? `「${field}」${reason}` : reason;
	};
	if (Array.isArray(value)) return value.map(describe).filter(Boolean).join("；") || "輸入資料不符合規定";
	if (value && typeof value === "object") return describe(value);
	return String(value == null ? "" : value);
}
/**
* 顯示一般或結構化 API 錯誤；一律以文字呈現以避免 HTML 注入。
* @param {unknown} msg 一般訊息或 API detail。
* @param {string} [type] Toast 樣式類型。
* @returns {void} 更新 toast 元素並啟動自動關閉計時。
*/
function toast(msg, type) {
	const t = document.getElementById("toast");
	t.textContent = apiErrorMessage(msg);
	t.className = "toast is-open " + (type || "");
	clearTimeout(appState.toastTimer);
	appState.toastTimer = setTimeout(() => t.className = "toast", 3500);
}
function initUtils() {
	document.querySelectorAll("[data-role=\"modal\"]").forEach((m) => {
		m.addEventListener("click", (e) => {
			if (e.target === m) closeModal(m.id);
		});
	});
	document.addEventListener("keydown", (e) => {
		if (e.key === "Escape") document.querySelectorAll("[data-role=\"modal\"].is-open").forEach((m) => closeModal(m.id));
	});
}
//#endregion
//#region static/js/core/api-client.js
var api_client_exports = /* @__PURE__ */ __exportAll({
	apiDownload: () => apiDownload,
	apiFetch: () => apiFetch
});
/** 建立 ApiError：message 已格式化可直接顯示；status 為 HTTP 狀態（網路錯誤 0）；detail 為後端原始 detail。 */
function _apiError(message, status, detail) {
	return Object.assign(new Error(message), {
		name: "ApiError",
		status,
		detail
	});
}
/** 拆出本檔專用參數（fallback / json），其餘原樣交給 fetch；json 會帶上 JSON header 並序列化。 */
function _apiInit(options) {
	const { fallback, json, ...init } = options;
	if (json !== void 0) {
		init.headers = {
			"Content-Type": "application/json",
			...init.headers || {}
		};
		init.body = JSON.stringify(json);
	}
	return {
		fallback,
		init
	};
}
/** 讀取回應內容；AbortError 原樣丟出，其餘讀取失敗視為網路錯誤。 */
async function _apiRead(res, read, fallback) {
	try {
		return await read();
	} catch (e) {
		if (e && e.name === "AbortError") throw e;
		throw _apiError(fallback || "網路連線失敗，請稍後再試", res ? res.status : 0);
	}
}
/** 送出請求；非 2xx 時讀出 detail 並丟出 ApiError。 */
async function _apiSend(url, options) {
	const { fallback, init } = _apiInit(options);
	const res = await _apiRead(null, () => fetch(url, init), fallback);
	if (!res.ok) {
		const text = await _apiRead(res, () => res.text(), fallback);
		let body = null;
		try {
			body = text ? JSON.parse(text) : null;
		} catch (e) {
			body = null;
		}
		const detail = body && typeof body === "object" ? body.detail : void 0;
		throw _apiError(apiErrorMessage(detail) || fallback || res.statusText || "操作失敗", res.status, detail);
	}
	return {
		res,
		fallback
	};
}
/**
* 呼叫後端 API 並解析 JSON 回應；錯誤一律丟出已格式化、可直接顯示的訊息。
* - 成功：204 / 205 / 空內容回傳 null，其餘回傳解析後的 JSON；成功但 JSON 格式錯誤視為失敗。
* - 失敗：丟出 name 為 'ApiError' 的 Error（message / status / detail，見 _apiError）。
* - AbortError 原樣丟出，讓呼叫端可以忽略被取消的請求。
* @param {string} url API 路徑。
* @param {RequestInit & {fallback?: string, json?: any}} [options] fetch 參數；
*   fallback：後端沒有可讀訊息時顯示的文字；json：要送出的 JSON 內容（自動帶 Content-Type）。
* @returns {Promise<any>} 解析後的 JSON，沒有內容時為 null。
*/
async function apiFetch(url, options = {}) {
	const { res, fallback } = await _apiSend(url, options);
	const text = res.status === 204 || res.status === 205 ? "" : await _apiRead(res, () => res.text(), fallback);
	if (!text) return null;
	try {
		return JSON.parse(text);
	} catch (e) {
		throw _apiError(fallback || "伺服器回應格式錯誤", res.status);
	}
}
/**
* 下載檔案（匯出報表）：錯誤處理同 apiFetch；檔名優先用伺服器 Content-Disposition，沒有時用 filename。
* @param {string} url API 路徑。
* @param {RequestInit & {fallback?: string, filename: string}} options fetch 參數與預設檔名。
* @returns {Promise<string>} 實際下載的檔名。
*/
async function apiDownload(url, options) {
	const { filename, ...rest } = options;
	const { res, fallback } = await _apiSend(url, rest);
	const blob = await _apiRead(res, () => res.blob(), fallback);
	const disposition = res.headers.get("Content-Disposition") || "";
	const utf8Name = disposition.match(/filename\*=UTF-8''([^;]+)/i);
	const plainName = disposition.match(/filename="?([^";]+)"?/i);
	const name = utf8Name ? decodeURIComponent(utf8Name[1]) : plainName ? plainName[1] : filename;
	const href = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = href;
	link.download = name;
	document.body.appendChild(link);
	link.click();
	link.remove();
	URL.revokeObjectURL(href);
	return name;
}
//#endregion
export { INVENTORY_SITES as A, resolveAccessiblePageTab as C, DATA_REFRESH_PRESERVE_MOUNT_TABS as D, CAL_WEEK as E, state_exports as F, __exportAll as I, appState as M, pending as N, INVENTORY_ALERT_ITEMS as O, pendingByStock as P, logout as S, CAL_PALETTE as T, canAccessPage as _, apiErrorMessage as a, firstAccessiblePageTab as b, esc as c, jsStr as d, openModal as f, utils_exports as g, todayStr as h, absNum as i, ITEMLESS_TABS as j, INVENTORY_PENDING_ITEMS as k, hasPerm as l, toast as m, apiFetch as n, closeModal as o, pwPolicyMsg as p, api_client_exports as r, closeModalForce as s, apiDownload as t, initUtils as u, checkAuth as v, session_exports as w, initSession as x, currentUser as y };
