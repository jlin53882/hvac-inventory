import { A as INVENTORY_PENDING_ITEMS, C as logout, D as CAL_WEEK, E as CAL_PALETTE, F as pendingByStock, I as state_exports$7, L as __exportAll, M as ITEMLESS_TABS, N as appState, O as DATA_REFRESH_PRESERVE_MOUNT_TABS, P as pending, S as handleUnauthorized, T as session_exports, _ as utils_exports, a as absNum, b as currentUser, c as closeModalForce, d as initUtils, f as jsStr, g as todayStr, h as toast, i as setUnauthorizedHandler, j as INVENTORY_SITES, k as INVENTORY_ALERT_ITEMS, l as esc, n as apiFetch, o as apiErrorMessage, p as openModal, r as api_client_exports, s as closeModal, t as apiDownload, u as hasPerm, v as canAccessPage, w as resolveAccessiblePageTab, x as firstAccessiblePageTab, y as checkAuth } from "./api-client-D6Lfy2Id.js";
import { a as openChangePwModal, c as qtyInputOrToast, d as filterUnitSelect, f as loadUnits, h as units_exports, l as qty_exports, n as cpwCheckMatch, o as submitChangePw, p as openUnitQuickAdd, r as cpwCheckStrength, s as Qty, t as change_password_exports, u as fillUnitSelect } from "./change-password-BgsHCBLA.js";
//#region static/js/features/quotation/mode-tabs.js
var mode_tabs_exports = /* @__PURE__ */ __exportAll({ quoteModeTabs: () => quoteModeTabs });
function quoteModeTabs(active) {
	return `<div class="quote-mode-tabs" role="tablist"><button type="button" class="chip chip--seg quote-mode-tab ${active === "quotation" ? "is-active" : ""}" onclick="Quotation.quoteSwitchMode('quotation')">🧾 報價單</button><button type="button" class="chip chip--seg quote-mode-tab ${active === "upload" ? "is-active" : ""}" onclick="Quotation.quoteSwitchMode('upload')">📤 報價單上傳</button></div>`;
}
//#endregion
//#region static/js/core/bottomsheet.js
var bottomsheet_exports = /* @__PURE__ */ __exportAll({
	closeSheet: () => closeSheet,
	initBottomsheet: () => initBottomsheet,
	isMobileView: () => isMobileView,
	openSheet: () => openSheet
});
var sheetEl = null;
var sheetEscBound = false;
function openSheet(title, actions) {
	closeSheet();
	const overlay = document.createElement("div");
	overlay.className = "sheet-overlay";
	overlay.id = "sheet-overlay";
	const items = (actions || []).map((a) => {
		return `<div class="${"s-item" + (a.cls ? " " + a.cls : "")}" data-role="sheet-item">${a.icon ? `<span class="ic">${a.icon}</span>` : ""}${a.label}</div>`;
	}).join("");
	overlay.innerHTML = `
    <div class="sheet">
      <div class="sheet-title">${esc(title)}</div>
      ${items}
      <button class="s-cancel" data-role="sheet-cancel">取消</button>
    </div>`;
	overlay.querySelectorAll("[data-role=\"sheet-item\"]").forEach((el, i) => {
		el.addEventListener("click", () => {
			const a = actions[i];
			closeSheet();
			if (a && a.fn) a.fn();
		});
	});
	overlay.addEventListener("click", (e) => {
		if (e.target === overlay) closeSheet();
	});
	overlay.querySelector("[data-role=\"sheet-cancel\"]").addEventListener("click", closeSheet);
	document.body.appendChild(overlay);
	sheetEl = overlay;
	requestAnimationFrame(() => overlay.classList.add("is-open"));
	if (!sheetEscBound) {
		sheetEscBound = true;
		document.addEventListener("keydown", (e) => {
			if (e.key === "Escape") closeSheet();
		});
	}
}
function closeSheet() {
	if (sheetEl) {
		sheetEl.remove();
		sheetEl = null;
	}
}
function isMobileView() {
	return window.matchMedia("(max-width: 767px)").matches;
}
var _lastMobileState = null;
function initBottomsheet(onViewportModeChange) {
	window.addEventListener("resize", () => {
		const now = isMobileView();
		if (_lastMobileState !== null && _lastMobileState !== now) {
			_lastMobileState = now;
			if (onViewportModeChange) onViewportModeChange();
		} else _lastMobileState = now;
	});
}
//#endregion
//#region static/js/core/request-guard.js
/** 建立一個獨立的請求守衛；每個守衛各自計數，互不影響。 */
function createRequestGuard() {
	let current = 0;
	return {
		/** 開新一輪並回傳 token；先前發出的 token 全部失效。 */
		next() {
			return ++current;
		},
		/** token 是否仍是最新一輪。 */
		isCurrent(token) {
			return token === current;
		},
		/** 讓進行中的請求全部作廢，但不開新一輪。 */
		invalidate() {
			current += 1;
		}
	};
}
//#endregion
//#region static/js/features/upload-list/upload-list.js
var upload_list_exports = /* @__PURE__ */ __exportAll({ createUploadListPage: () => createUploadListPage });
var UPLOAD_LIST_IMAGE_EXTS = [
	"jpg",
	"jpeg",
	"png",
	"webp",
	"gif"
];
function _uplIso(d) {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function _uplDateOnly(value) {
	return String(value || "").split(/[T ]/)[0];
}
function _uplIconFor(mime) {
	if ([
		"jpg",
		"jpeg",
		"png",
		"webp",
		"heic",
		"gif"
	].includes(mime)) return {
		icon: "🖼",
		tone: "image"
	};
	if (mime === "pdf") return {
		icon: "📄",
		tone: "pdf"
	};
	if (["docx", "doc"].includes(mime)) return {
		icon: "📝",
		tone: "doc"
	};
	if (["xlsx", "xls"].includes(mime)) return {
		icon: "📊",
		tone: "sheet"
	};
	return {
		icon: "📎",
		tone: "other"
	};
}
/**
* 建立一個檔案上傳清單頁控制器。
* @param {object} config 頁面設定。
* @param {string} config.global 控制器的全域名稱（模板 onclick 使用，例：'SignedReports'）。
* @param {string} config.api API 路徑（例：'/api/signed-reports'）。
* @param {() => boolean} config.isActive 目前是否仍在本頁（切頁 / 重新掛載後舊請求不可再寫畫面）。
* @param {string} config.title 頁面標題。
* @param {string} config.uploadLabel 上傳對象名稱（「＋ 上傳…」「⬆️ 上傳…」）。
* @param {string} config.editTitle 編輯視窗標題。
* @param {{archived: string, rate: string}} config.kpiIcons KPI 卡圖示。
* @param {string|null} config.uploadPermission 需要的上傳權限；null 代表登入即可上傳。
* @param {string} config.intro 頁首說明文字。
* @param {string[]} config.steps 右側「使用流程」步驟文字。
* @param {string} config.missingHint 「缺檔日」KPI 的定義說明。
* @param {() => string} [config.headerHtml] 頁首上方額外 HTML（已跳脫的固定內容）。
* @returns {object} 頁面控制器（state 與模板呼叫的方法）。
*/
function createUploadListPage(config) {
	const ctl = config.global;
	const api = config.api;
	const state = {
		reports: [],
		page: 1,
		pageSize: 20,
		total: 0,
		selectedFile: null,
		renderSeq: 0,
		historyGuard: createRequestGuard(),
		kpiGuard: createRequestGuard()
	};
	const $ = (id) => document.getElementById(id);
	const isCurrent = (renderSeq) => renderSeq === state.renderSeq && config.isActive();
	async function render() {
		const renderSeq = ++state.renderSeq;
		const el = $("content");
		if (!el) return;
		const today = _uplIso(/* @__PURE__ */ new Date());
		const gate = config.uploadPermission ? "hidden " : "";
		const stepsHtml = config.steps.map((step, i) => "<li><span class=\"dsr-badge\">" + (i + 1) + "</span> " + esc(step) + "</li>").join("");
		el.innerHTML = `
    <div class="upl-wrap">
      ${config.headerHtml ? config.headerHtml() : ""}
      <div class="dsr-page-header">
        <div class="dsr-page-title">
          <h1>🗂 ${esc(config.title)} <span class="dsr-new-badge">NEW</span></h1>
          <p>${esc(config.intro)}</p>
        </div>
        <div class="dsr-page-actions">
          <button class="btn btn--secondary btn--md" onclick="document.getElementById('upl-history').scrollIntoView({behavior:'smooth'})">↓ 查看歷史查詢</button>
          <button ${esc(gate)}data-role="upl-upload-surface" class="btn btn--primary btn--md" onclick="document.getElementById('upl-file-input').click()">＋ 上傳${esc(config.uploadLabel)}</button>
        </div>
      </div>

      <div class="upl-layout">
        <!-- 左：上傳區 -->
        <section ${esc(gate)}data-role="upl-upload-surface" class="dsr-card" aria-labelledby="upl-upload-title">
          <div class="dsr-card__hd">
            <h2 id="upl-upload-title">⬆️ 上傳${esc(config.uploadLabel)}</h2>
            <p>支援 PDF / 圖片格式 · 單檔 ≤ 20MB · 自動記錄上傳時間</p>
          </div>
          <div class="dsr-card__bd">
            <div class="dsr-form-grid dsr-form-grid--two">
              <div class="dsr-field">
                <label>上傳人姓名<span class="dsr-required">*</span></label>
                <input id="upl-uploader" type="text" placeholder="例：蘇昱豪">
              </div>
              <div class="dsr-field">
                <label>報表日期（業務日期）<span class="dsr-required">*</span></label>
                <input id="upl-report-date" type="date" value="${esc(today)}">
              </div>
            </div>
            <div class="u-mt-12 dsr-field">
              <label>備註 / 備忘（選填）</label>
              <textarea id="upl-note" rows="2" placeholder="例：今日有現場工安檢查，客戶臨時增加 2 台保養"></textarea>
            </div>
            <!-- 拖曳上傳 -->
            <div id="upl-drop" class="u-mt-12 upl-drop" onclick="document.getElementById('upl-file-input').click()">
              <div class="upl-drop__icon">📎</div>
              <div class="upl-drop__title">拖曳檔案到此，或點擊選擇</div>
              <div class="upl-drop__sub">支援 PDF / PNG / JPG / GIF / WebP 格式</div>
              <div class="upl-drop__actions">
                <span onclick="event.stopPropagation();document.getElementById('upl-file-input').click()">選擇檔案</span>
                <span onclick="event.stopPropagation();document.getElementById('upl-camera-input').click()">📷 相機拍攝</span>
              </div>
              <input id="upl-file-input" type="file" style="display:none" accept="image/*,.pdf">
              <input id="upl-camera-input" type="file" style="display:none" accept="image/*" capture="environment">
            </div>
            <!-- 選檔後預覽 -->
            <div id="upl-file-preview" style="display:none">
              <div class="upl-file-preview">
                <div id="upl-fp-icon" class="upl-file-preview__icon upl-file-tone--pdf">📄</div>
                <div class="upl-file-preview__meta">
                  <div id="upl-fp-name" class="upl-file-preview__name"></div>
                  <div id="upl-fp-sub" class="upl-file-preview__sub"></div>
                  <div class="upl-progress"><div id="upl-progress-bar" class="upl-progress__bar"></div></div>
                </div>
                <button class="btn btn--secondary btn--sm" onclick="${esc(ctl)}.clearFile()">移除</button>
              </div>
              <div class="upl-upload-actions">
                <button class="btn btn--primary btn--md upl-btn--primary" onclick="${esc(ctl)}.submitUpload()">⬆️ 確認上傳</button>
                <button class="btn btn--secondary btn--md" onclick="${esc(ctl)}.openPreviewFile()">👁 預覽</button>
              </div>
            </div>
            <div class="upl-tags">
              <span class="upl-tag">✦ 自動寫入上傳時間</span>
              <span class="upl-tag">✦ 檔名自動 esc / 公式注入防護</span>
              <span class="upl-tag">✦ 刪除：有「全域刪除」權限者可刪全部，其餘僅能刪自己上傳的</span>
            </div>
          </div>
        </section>

        <!-- 右：說明 / KPI -->
        <aside class="upl-side">
          <div class="dsr-info">
            <h3>💡 使用流程</h3>
            <ul>
              ${stepsHtml}
            </ul>
            <div class="dsr-info-badges">
              <span class="dsr-badge">🔒 登入可查</span>
              <span class="dsr-badge">✏️ 自己刪自己的；有「全域刪除」權限者可刪全部</span>
              <span class="dsr-badge">📱 手機可掃描直傳</span>
            </div>
          </div>
          <div class="dsr-card">
            <div class="dsr-card__hd"><h2>📊 本月概況</h2><p id="upl-kpi-month"></p></div>
            <div class="dsr-card__bd">
              <div class="upl-kpi ui-kpi-grid ui-kpi-grid--compact">
                <div class="ui-kpi-card ui-kpi-card--blue ui-kpi-card--compact"><span class="ui-kpi-icon" aria-hidden="true">${esc(config.kpiIcons.archived)}</span><div class="ui-kpi-body"><div class="ui-kpi-label">已歸檔</div><div class="ui-kpi-value" id="upl-kpi-total">—</div><span class="ui-kpi-meta">本月</span></div></div>
                <div class="ui-kpi-card ui-kpi-card--amber ui-kpi-card--compact"><span class="ui-kpi-icon" aria-hidden="true">⚠</span><div class="ui-kpi-body"><div class="ui-kpi-label">缺檔日</div><div class="ui-kpi-value" id="upl-kpi-missing">—</div><span class="ui-kpi-meta">本月</span></div></div>
                <div class="ui-kpi-card ui-kpi-card--green ui-kpi-card--compact"><span class="ui-kpi-icon" aria-hidden="true">${esc(config.kpiIcons.rate)}</span><div class="ui-kpi-body"><div class="ui-kpi-label">歸檔率</div><div class="ui-kpi-value" id="upl-kpi-rate">—</div><span class="ui-kpi-meta">本月</span></div></div>
              </div>
              <div class="upl-hint">${esc(config.missingHint)}</div>
            </div>
          </div>
        </aside>

        <!-- 歷史查詢（全寬） -->
        <section id="upl-history" class="dsr-card upl-history">
          <div class="dsr-card__hd">
            <div class="upl-history-heading">
              <h2>🔍 歷史報表查詢</h2>
              <p>可查單日 / 週 / 自訂區間 · 關鍵字搜尋上傳人或備註</p>
            </div>
            <div class="upl-filter-bar">
              <div class="dsr-field"><label>起始日</label><input id="upl-f-from" type="date"></div>
              <div class="dsr-field"><label>迄止日</label><input id="upl-f-to" type="date"></div>
              <div class="dsr-field upl-field--search"><label>關鍵字（上傳人 / 備註 / 檔名）</label><input id="upl-f-q" type="text" placeholder="例：昱豪、工安"></div>
              <div class="upl-filter-actions">
                <button class="btn btn--primary btn--md" onclick="${esc(ctl)}.loadHistory(true)">搜尋</button>
                <button class="btn btn--secondary btn--md" onclick="${esc(ctl)}.resetFilter()">清除</button>
              </div>
            </div>
            <div class="upl-chips">
              <button class="chip" data-role="upl-range" data-range="today" onclick="${esc(ctl)}.quickRange('today',this)">今天</button>
              <button class="chip" data-role="upl-range" data-range="week" onclick="${esc(ctl)}.quickRange('week',this)">本週</button>
              <button class="chip is-active" data-role="upl-range" data-range="month" onclick="${esc(ctl)}.quickRange('month',this)">本月</button>
              <button class="chip" data-role="upl-range" data-range="all" onclick="${esc(ctl)}.quickRange('all',this)">全部</button>
              <span class="upl-result-count"><span id="upl-result-count">0 筆</span></span>
            </div>
          </div>
          <div class="u-pt-0 dsr-card__bd">
            <div class="upl-report-list" id="upl-tbody"></div>
            <div id="upl-empty" class="dsr-empty" style="display:none">
                <div class="dsr-empty__icon">🗂</div>
                <div>沒有符合條件的報表</div>
                <div class="upl-hint">試試放寬日期或關鍵字，或切換「全部」</div>
              </div>
            </div>
            <div class="upl-pagination">
              <span id="upl-page-info"></span>
              <span class="u-d-flex u-gap-6">
                <button class="btn btn--secondary btn--sm" onclick="${esc(ctl)}.changePage(-1)">‹ 上一頁</button>
                <button class="btn btn--secondary btn--sm" onclick="${esc(ctl)}.changePage(1)">下一頁 ›</button>
              </span>
            </div>
          </div>
        </section>
      </div>
    </div>

    <!-- 預覽 Modal -->
    <div id="upl-overlay" class="upl-overlay" onclick="if(event.target===this)${esc(ctl)}.closePreview()">
      <div class="dsr-modal">
        <div class="dsr-modal__hd"><h3 id="upl-preview-title">👁 預覽</h3><button class="btn btn--secondary btn--sm" onclick="${esc(ctl)}.closePreview()">✕ 關閉</button></div>
        <div class="dsr-modal__bd" id="upl-preview-body"></div>
        <div class="dsr-modal__ft">
          <span class="dsr-modal__note">若預覽失敗，請直接下載原檔</span>
          <span class="dsr-modal__actions">
            <button class="btn btn--secondary btn--md" onclick="${esc(ctl)}.closePreview()">關閉</button>
            <button class="btn btn--primary btn--md" id="upl-dl-btn">⬇️ 下載原檔</button>
          </span>
        </div>
      </div>
    </div>`;
		const me = await apiFetch("/api/auth/me").catch(() => null);
		if (!isCurrent(renderSeq)) return;
		const canUpload = !config.uploadPermission || !!(me && me.user && me.user.permissions && me.user.permissions[config.uploadPermission]);
		document.querySelectorAll("[data-role=\"upl-upload-surface\"]").forEach((node) => {
			node.hidden = !canUpload;
		});
		if (canUpload && me && me.user && me.user.display_name) $("upl-uploader").value = me.user.display_name;
		const now = /* @__PURE__ */ new Date();
		$("upl-f-from").value = _uplIso(new Date(now.getFullYear(), now.getMonth(), 1));
		$("upl-f-to").value = _uplIso(new Date(now.getFullYear(), now.getMonth() + 1, 0));
		const drop = $("upl-drop");
		["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => {
			e.preventDefault();
			drop.classList.add("drag");
		}));
		["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => {
			e.preventDefault();
			drop.classList.remove("drag");
		}));
		drop.addEventListener("drop", (e) => {
			if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
		});
		$("upl-file-input").addEventListener("change", (e) => {
			if (e.target.files[0]) handleFile(e.target.files[0]);
		});
		$("upl-camera-input").addEventListener("change", (e) => {
			if (e.target.files[0]) handleFile(e.target.files[0]);
		});
		loadHistory();
	}
	function handleFile(f) {
		const ext = (f.name.split(".").pop() || "").toLowerCase();
		const ic = _uplIconFor(ext);
		$("upl-fp-icon").textContent = ic.icon;
		$("upl-fp-icon").className = "upl-file-preview__icon upl-file-tone--" + ic.tone;
		$("upl-fp-name").textContent = f.name;
		$("upl-fp-sub").textContent = ext.toUpperCase() + " · " + (f.size / 1024 / 1024).toFixed(1) + " MB";
		$("upl-file-preview").style.display = "block";
		$("upl-progress-bar").style.width = "0%";
		$("upl-drop").style.display = "none";
		state.selectedFile = f;
	}
	function clearFile() {
		$("upl-file-preview").style.display = "none";
		$("upl-drop").style.display = "block";
		$("upl-file-input").value = "";
		state.selectedFile = null;
	}
	function keepUploaderOnly() {
		const dateField = $("upl-report-date");
		const noteField = $("upl-note");
		const fileField = $("upl-file-input");
		const cameraField = $("upl-camera-input");
		if (dateField) dateField.value = _uplIso(/* @__PURE__ */ new Date());
		if (noteField) noteField.value = "";
		if (fileField) fileField.value = "";
		if (cameraField) cameraField.value = "";
		state.selectedFile = null;
		const drop = $("upl-drop");
		const preview = $("upl-file-preview");
		if (drop) drop.style.display = "block";
		if (preview) preview.style.display = "none";
	}
	function openPreviewFile() {
		const file = state.selectedFile;
		if (!file) return;
		const url = URL.createObjectURL(file);
		showPreview(file.name, (file.name.split(".").pop() || "").toLowerCase(), url, url);
	}
	async function submitUpload() {
		const file = state.selectedFile;
		if (!file) return toast("⚠️ 請先選擇檔案");
		const uploader = $("upl-uploader").value.trim();
		const reportDate = $("upl-report-date").value;
		const note = $("upl-note").value.trim();
		if (!uploader) return toast("⚠️ 請填上傳人姓名");
		if (!reportDate) return toast("⚠️ 請選擇報表日期");
		const bar = $("upl-progress-bar");
		bar.style.width = "10%";
		const fd = new FormData();
		fd.append("file", file);
		fd.append("report_date", reportDate);
		fd.append("uploader_name", uploader);
		fd.append("note", note);
		try {
			bar.style.width = "30%";
			await apiFetch(api, {
				method: "POST",
				body: fd,
				fallback: "上傳失敗"
			});
			bar.style.width = "100%";
			setTimeout(() => toast("✅ 上傳成功"), 300);
			keepUploaderOnly();
			loadHistory();
		} catch (e) {
			toast(e.status ? "⚠️ " + e.message : "⚠️ 網路錯誤：" + e.message);
		}
	}
	async function loadHistory(resetPage) {
		const renderSeq = state.renderSeq;
		if (!isCurrent(renderSeq)) return;
		if (resetPage) state.page = 1;
		const from = $("upl-f-from").value || "";
		const to = $("upl-f-to").value || "";
		const q = $("upl-f-q").value.trim();
		const pageAtRequest = state.page;
		const requestSeq = state.historyGuard.next();
		const p = new URLSearchParams({
			from_date: from,
			to_date: to,
			q,
			page: pageAtRequest,
			page_size: state.pageSize
		});
		let data;
		try {
			data = await apiFetch(api + "?" + p);
		} catch (e) {
			return;
		}
		if (!isCurrent(renderSeq) || !state.historyGuard.isCurrent(requestSeq)) return;
		state.reports = data.items || [];
		state.total = data.total || 0;
		state.page = data.page || pageAtRequest;
		$("upl-result-count").textContent = state.total + " 筆";
		renderTable();
		updateKPI(renderSeq);
	}
	function renderTable() {
		const tb = $("upl-tbody");
		const empty = $("upl-empty");
		if (!state.reports.length) {
			tb.innerHTML = "";
			empty.style.display = "block";
		} else {
			empty.style.display = "none";
			tb.innerHTML = state.reports.map((r) => {
				const ext = (r.file_name || "").split(".").pop().toLowerCase();
				const ic = _uplIconFor(ext);
				const note = r.note ? esc(r.note) : "<span class=\"upl-note-empty\">—</span>";
				const isImage = UPLOAD_LIST_IMAGE_EXTS.includes(ext);
				const fileVisual = isImage ? `<img class="upl-report-thumb" src="${esc(api)}/${r.id}/preview" alt="${esc(r.file_name)}" loading="lazy" onclick="${esc(ctl)}.preview(${r.id})" title="點擊圖片預覽">` : `<div class="upl-file-icon upl-file-tone--${esc(ic.tone)}">${ic.icon}</div>`;
				return `<details class="upl-report-card">
          <summary class="upl-report-summary">
            <span class="upl-report-summary__date">${esc(r.report_date)}</span>
            <span class="upl-report-summary__uploader upl-tag">${esc(r.uploader_name)}</span>
            <span class="upl-report-summary__file">${esc(r.file_name)}</span>
          </summary>
          <div class="upl-report-detail">
            <div class="upl-report-detail__grid">
              <div><span class="upl-report-detail__label">報表日期</span><strong>${esc(r.report_date)}</strong></div>
              <div><span class="upl-report-detail__label">上傳人</span><strong>${esc(r.uploader_name)}</strong></div>
              <div><span class="upl-report-detail__label">上傳日期</span><strong>${esc(_uplDateOnly(r.upload_time))}</strong></div>
              <div class="upl-report-detail__file"><span class="upl-report-detail__label">檔案</span><div class="upl-file-cell">${fileVisual}<div class="u-minw-0"><div class="upl-file-name upl-ellipsis">${esc(r.file_name)}</div><div class="upl-file-meta">${esc((r.mime_type || "").toUpperCase())}</div></div></div></div>
              <div class="upl-report-detail__note"><span class="upl-report-detail__label">備註</span><div class="upl-note-cell">${note}</div></div>
            </div>
            <div class="upl-actions-cell">
              ${!isImage ? `<button class="btn btn--secondary btn--sm" onclick="${esc(ctl)}.preview(${r.id})">👁 預覽</button>` : ""}
              ${r.can_edit ? `<button class="btn btn--secondary btn--sm" onclick="${esc(ctl)}.edit(${r.id})">✏️ 編輯</button>` : ""}
              <button class="btn btn--secondary btn--sm" onclick="${esc(ctl)}.download(${r.id})">⬇️ 下載</button>
              ${r.can_delete ? `<button class="btn btn--danger btn--sm" onclick="${esc(ctl)}.remove(${r.id})">🗑 刪除</button>` : ""}
            </div>
          </div>
        </details>`;
			}).join("");
		}
		const max = Math.max(1, Math.ceil(state.total / state.pageSize));
		$("upl-page-info").textContent = `第 ${state.page} / ${max} 頁 · 共 ${state.total} 筆`;
	}
	async function updateKPI(renderSeq) {
		const requestSeq = state.kpiGuard.next();
		if (!isCurrent(renderSeq)) return;
		let k;
		try {
			k = await apiFetch(api + "/kpi");
		} catch (e) {
			return;
		}
		if (!isCurrent(renderSeq) || !state.kpiGuard.isCurrent(requestSeq)) return;
		$("upl-kpi-month").textContent = k.month;
		$("upl-kpi-total").textContent = k.archived;
		$("upl-kpi-missing").textContent = k.missing;
		$("upl-kpi-rate").textContent = k.total > 0 ? k.rate + "%" : "—";
	}
	function resetFilter() {
		const now = /* @__PURE__ */ new Date();
		$("upl-f-from").value = _uplIso(new Date(now.getFullYear(), now.getMonth(), 1));
		$("upl-f-to").value = _uplIso(new Date(now.getFullYear(), now.getMonth() + 1, 0));
		$("upl-f-q").value = "";
		document.querySelectorAll("[data-role=\"upl-range\"]").forEach((c) => c.classList.toggle("is-active", c.dataset.range === "month"));
		state.page = 1;
		loadHistory();
	}
	function quickRange(k, btn) {
		document.querySelectorAll("[data-role=\"upl-range\"]").forEach((c) => c.classList.remove("is-active"));
		btn.classList.add("is-active");
		const now = /* @__PURE__ */ new Date();
		const from = $("upl-f-from");
		const to = $("upl-f-to");
		if (k === "today") {
			from.value = _uplIso(now);
			to.value = _uplIso(now);
		} else if (k === "week") {
			const d = new Date(now);
			d.setDate(d.getDate() - d.getDay());
			from.value = _uplIso(d);
			const e = new Date(d);
			e.setDate(e.getDate() + 6);
			to.value = _uplIso(e);
		} else if (k === "month") {
			from.value = _uplIso(new Date(now.getFullYear(), now.getMonth(), 1));
			to.value = _uplIso(new Date(now.getFullYear(), now.getMonth() + 1, 0));
		} else {
			from.value = "";
			to.value = "";
		}
		state.page = 1;
		loadHistory();
	}
	function changePage(d) {
		const max = Math.max(1, Math.ceil(state.total / state.pageSize));
		const next = Math.min(max, Math.max(1, state.page + d));
		if (next === state.page) return;
		state.page = next;
		loadHistory();
	}
	function preview(id) {
		const report = state.reports.find((item) => item.id === id);
		if (!report) return;
		const base = api + "/" + id;
		const ext = (report.file_name || "").split(".").pop().toLowerCase();
		showPreview(report.file_name, ext, base + "/preview", base + "/download");
	}
	function showPreview(name, mime, previewUrl, downloadUrl) {
		const body = $("upl-preview-body");
		$("upl-preview-title").textContent = "👁 預覽 — " + name;
		if (UPLOAD_LIST_IMAGE_EXTS.includes(mime)) body.innerHTML = "<img src=\"" + previewUrl + "\" class=\"upl-preview-img\">";
		else if (mime === "pdf") {
			if (isMobileView()) {
				body.innerHTML = "<div class=\"upl-preview-fallback\"><div class=\"upl-preview-icon\">📄</div><div class=\"upl-preview-title\">手機請用系統閱讀器開啟 PDF</div><button class=\"btn btn--primary btn--md\" data-pdf-url=\"" + previewUrl + "\">📄 開啟 PDF</button></div>";
				body.querySelector("[data-pdf-url]").addEventListener("click", function() {
					window.open(this.getAttribute("data-pdf-url"), "_blank");
				});
			} else body.innerHTML = "<iframe src=\"" + previewUrl + "\" class=\"upl-preview-frame\">";
		} else body.innerHTML = "<div class=\"upl-preview-fallback upl-preview-fallback--dark\"><div class=\"upl-preview-icon\">📎</div><div class=\"upl-preview-name\">" + esc(name) + "</div><div class=\"upl-preview-note\">此格式不支援線上預覽</div></div>";
		$("upl-dl-btn").onclick = () => window.open(downloadUrl, "_blank");
		$("upl-overlay").classList.add("is-open");
	}
	function closePreview() {
		$("upl-overlay").classList.remove("is-open");
		$("upl-preview-body").innerHTML = "";
	}
	function download(id) {
		window.open(api + "/" + id + "/download", "_blank");
	}
	async function edit(id) {
		const report = state.reports.find((item) => item.id === id);
		if (!report) return;
		const overlay = document.createElement("div");
		overlay.className = "upl-overlay is-open";
		overlay.innerHTML = `
      <div class="dsr-modal upl-edit-modal" role="dialog" aria-modal="true" aria-labelledby="upl-edit-title">
        <div class="dsr-modal__hd"><h3 id="upl-edit-title">✏️ ${esc(config.editTitle)}</h3><button class="btn btn--secondary btn--sm" type="button" data-upl-edit-cancel>✕ 關閉</button></div>
        <div class="dsr-modal__bd">
          <div class="dsr-field"><label for="upl-edit-date">報表日期（YYYY-MM-DD）*</label><input id="upl-edit-date" type="date" value="${esc(report.report_date || "")}"></div>
          <div class="u-mt-12 dsr-field"><label for="upl-edit-uploader">上傳人姓名*</label><input id="upl-edit-uploader" type="text" maxlength="50" value="${esc(report.uploader_name || "")}"></div>
          <div class="u-mt-12 dsr-field"><label for="upl-edit-note">備註(選填)</label><textarea id="upl-edit-note" rows="4" maxlength="500">${esc(report.note || "")}</textarea></div>
          <div class="u-mt-12 dsr-field"><label for="upl-edit-file">替換檔案(選填)</label><input id="upl-edit-file" type="file" accept=".pdf,image/png,image/jpeg,image/gif,image/webp"></div>
          <div class="upl-hint">不選擇新檔案會保留目前檔案。</div>
        </div>
        <div class="dsr-modal__ft"><button class="btn btn--secondary btn--md" type="button" data-upl-edit-cancel>取消</button><button class="btn btn--primary btn--md" type="button" data-upl-edit-save>儲存</button></div>
      </div>`;
		document.body.appendChild(overlay);
		const close = () => overlay.remove();
		overlay.querySelectorAll("[data-upl-edit-cancel]").forEach((button) => button.addEventListener("click", close));
		overlay.addEventListener("click", (event) => {
			if (event.target === overlay) close();
		});
		overlay.querySelector("[data-upl-edit-save]").addEventListener("click", async () => {
			const reportDate = overlay.querySelector("#upl-edit-date").value;
			const uploaderName = overlay.querySelector("#upl-edit-uploader").value.trim();
			const note = overlay.querySelector("#upl-edit-note").value.trim();
			const file = overlay.querySelector("#upl-edit-file").files[0];
			if (!reportDate) return toast("⚠️ 請選擇報表日期");
			if (!uploaderName) return toast("⚠️ 請填上傳人姓名");
			if (note.length > 500) return toast("⚠️ 備註最多 500 字");
			const fd = new FormData();
			fd.append("report_date", reportDate);
			fd.append("uploader_name", uploaderName);
			fd.append("note", note);
			if (file) fd.append("file", file);
			try {
				const data = await apiFetch(api + "/" + id, {
					method: "PATCH",
					body: fd,
					fallback: "報表更新失敗"
				});
				close();
				Object.assign(report, data);
				await loadHistory();
				toast("✅ 報表已更新");
			} catch (e) {
				toast(e.status ? "⚠️ " + e.message : "⚠️ 網路錯誤：" + e.message);
			}
		});
	}
	async function remove(id) {
		if (!confirm("確定刪除？")) return;
		try {
			await apiFetch(api + "/" + id, {
				method: "DELETE",
				fallback: "刪除失敗"
			});
			toast("🗑 已刪除");
			loadHistory();
		} catch (e) {
			toast("⚠️ " + e.message);
		}
	}
	return {
		state,
		render,
		renderTable,
		showPreview,
		loadHistory,
		resetFilter,
		quickRange,
		changePage,
		clearFile,
		submitUpload,
		openPreviewFile,
		preview,
		closePreview,
		download,
		edit,
		remove
	};
}
//#endregion
//#region static/js/features/upload-list/quotation-upload.js
var quotation_upload_exports = /* @__PURE__ */ __exportAll({
	QuotationUploads: () => QuotationUploads,
	renderQuotationUploads: () => renderQuotationUploads
});
var QuotationUploads = createUploadListPage({
	global: "QuotationUploads",
	api: "/api/quotation-uploads",
	isActive: () => appState.currentTab === "quotation" && document.body.dataset.page === "quotation-upload",
	title: "報價單上傳",
	uploadLabel: "報價單",
	editTitle: "編輯報價單上傳",
	kpiIcons: {
		archived: "🧾",
		rate: "📊"
	},
	uploadPermission: null,
	intro: "位置：「報價單」頁上方切換至「報價單上傳」。登入即可上傳與查詢，編輯/刪除見下方權限規則。",
	steps: [
		"將客戶確認（回簽）的報價單掃描成 PDF/圖片",
		"回到本頁拖曳上傳，或以手機相機直接拍攝",
		"選擇「報表日期」= 報價單所屬的業務日期（非上傳當天）",
		"歷史區以日期/關鍵字篩選，支援預覽與下載"
	],
	missingHint: "缺檔日 = 行事曆有派工但未上傳報價單的日期",
	headerHtml: () => quoteModeTabs("upload")
});
function renderQuotationUploads() {
	return QuotationUploads.render();
}
//#endregion
//#region static/js/features/upload-list/signed-reports.js
var signed_reports_exports = /* @__PURE__ */ __exportAll({
	SignedReports: () => SignedReports,
	renderSignedReports: () => renderSignedReports
});
var SignedReports = createUploadListPage({
	global: "SignedReports",
	api: "/api/signed-reports",
	isActive: () => appState.currentTab === "signed-reports",
	title: "每日簽名報表",
	uploadLabel: "每日簽名日報表",
	editTitle: "編輯每日簽名日報表",
	kpiIcons: {
		archived: "🗂",
		rate: "📈"
	},
	uploadPermission: "signed-report-upload",
	intro: "位置：底部導覽「行事曆」旁新增「報表」Tab。讀取需登入，刪除見下方權限規則。",
	steps: [
		"行事曆「📤 匯出日報表」下載 xlsx → 列印簽名",
		"隔日掃描成 PDF/圖片 → 回到本頁拖曳上傳",
		"選擇「報表日期」= 簽名所屬的工作日（非上傳當天）",
		"歷史區以日期/關鍵字篩選，支援預覽與下載"
	],
	missingHint: "缺檔日 = 行事曆有派工但未上傳簽名檔的日期"
});
function renderSignedReports() {
	return SignedReports.render();
}
//#endregion
//#region static/js/components/card.js
var card_exports = /* @__PURE__ */ __exportAll({
	buildLocHTML: () => buildLocHTML,
	buildNoteHTML: () => buildNoteHTML,
	buildQtyControl: () => buildQtyControl,
	buildQtyNum: () => buildQtyNum,
	buildThumb: () => buildThumb,
	mobileCardShell: () => mobileCardShell,
	photoSrc: () => photoSrc
});
function photoSrc(id, variant) {
	const item = (typeof appState.ALL_ITEMS !== "undefined" ? appState.ALL_ITEMS : []).find((i) => i.id === id);
	if (item) {
		if (variant === "thumbnail" && item.thumbnail_url) return item.thumbnail_url;
		if (variant === "preview" && item.preview_url) return item.preview_url;
	}
	return `/uploads/${id}.jpg`;
}
function buildThumb(id, hasPhoto, name, placeholder, thumbnailUrl) {
	const fallback = "<span class=\"product-thumbnail-placeholder" + (hasPhoto ? " hidden" : "") + "\">" + esc(placeholder || "📦") + "</span>";
	if (!hasPhoto) return fallback;
	const src = thumbnailUrl || photoSrc(id, "thumbnail");
	return "<span class=\"product-thumbnail-wrap\"><img src=\"" + esc(src) + "\" alt=\"" + esc(name || "") + "\" loading=\"lazy\" decoding=\"async\" width=\"52\" height=\"52\" onclick=\"Inventory.openPhotoLightbox(" + id + ")\" title=\"點擊看大圖\" onload=\"this.nextElementSibling.hidden=true\" onerror=\"this.hidden=true;this.nextElementSibling.hidden=false\">" + fallback + "</span>";
}
function formatLocationDisplay(location) {
	const raw = String(location ?? "").trim();
	if (!raw) return "未標示";
	const parts = raw.split("|").map((x) => x.trim()).filter(Boolean);
	return parts.length ? parts.map((part) => esc(part)).join(" / ") : "未標示";
}
function buildLocHTML(locs) {
	return (locs && locs.length ? locs : [{
		location: "",
		note: ""
	}]).map((s) => `
    <div class="item-loc"><span class="item-loc-label">位置：</span>${formatLocationDisplay(s.location)}</div>
  `).join("");
}
function buildStockNoteLabelHTML(stock, showLocationContext) {
	if (!showLocationContext) return "📝 註解";
	return `📝 註解 · ${formatLocationDisplay(stock.location)}`;
}
function buildNoteHTML(locs) {
	const list = locs || [];
	const notes = list.filter((s) => s && s.note);
	const showLocationContext = list.length > 1;
	return notes.map((s) => `<div class="item-note"><span class="item-note-label">${buildStockNoteLabelHTML(s, showLocationContext)}: </span><span class="item-note-text">${esc(s.note)}</span></div>`).join("");
}
function buildQtyControl(opts) {
	const { id, display, unit, isZero, delta, viewer } = opts;
	if (viewer) return `<div class="qty-num">${display}</div><div class="qty-unit">${esc(unit)}</div>`;
	return `<div class="qty-control">
    <button class="qty-btn qty-minus" onclick="Inventory.changeQty(${id}, -1)" ${isZero && delta <= 0 ? "disabled" : ""}>−</button>
    <div class="qty-value" onclick="Inventory.quickSet(${id})" title="點數字可輸入">${display}<span class="unit"> ${esc(unit)}</span></div>
    <button class="qty-btn qty-plus" onclick="Inventory.changeQty(${id}, 1)">+</button>
  </div>`;
}
function buildQtyNum(display, unit, cls) {
	const d = unit ? Qty.signed(display, unit) : display;
	return `<div class="qty-num${cls ? " " + cls : ""}">${d}</div><div class="qty-unit">${esc(unit)}</div>`;
}
function mobileCardShell(p) {
	return `<div class="m-card${p.reverted ? " reverted" : ""}${p.cardClass ? " " + p.cardClass : ""}">
    ${p.moreBtnHTML || ""}
    <div class="card-main">
      ${p.checkboxHTML || ""}
      <div class="thumb">${p.thumb}</div>
      <div class="info">
        <div class="nm">${p.nameHTML}</div>
        ${p.subHTML ? `<div class="sub">${p.subHTML}</div>` : ""}
        ${p.extraHTML || ""}
      </div>
      <div class="qty-col">${p.qtyHTML}</div>
      <div class="note-slot">${p.noteHTML || ""}</div>
    </div>
    ${p.actionsHTML || ""}
  </div>`;
}
//#endregion
//#region static/js/core/data.js
var data_exports = /* @__PURE__ */ __exportAll({
	loadDestinations: () => loadDestinations,
	refreshDestinationsAfterMutation: () => refreshDestinationsAfterMutation
});
async function loadDestinations() {
	const siteAtRequest = appState.currentSite;
	try {
		const outs = await apiFetch(`/api/stockouts?limit=100&site=${encodeURIComponent(siteAtRequest)}`);
		if (siteAtRequest !== appState.currentSite) return;
		appState.DESTINATIONS = [...new Set(outs.map((o) => o.destination).filter(Boolean))];
		appState.destinationsLoadedSite = siteAtRequest;
		document.getElementById("dest-list").innerHTML = appState.DESTINATIONS.map((d) => `<option value="${esc(d)}">`).join("");
	} catch (e) {
		if (e.name !== "AbortError") console.error("[loadDestinations] 去向清單載入失敗", e);
	}
}
async function refreshDestinationsAfterMutation() {
	appState.destinationsLoadedSite = "";
	appState.DESTINATIONS = [];
	const list = document.getElementById("dest-list");
	if (list) list.innerHTML = "";
	await loadDestinations();
}
//#endregion
//#region static/js/features/shell/data-refresh.js
var data_refresh_exports = /* @__PURE__ */ __exportAll({
	changeInventoryPage: () => changeInventoryPage,
	configureDataRefresh: () => configureDataRefresh,
	loadData: () => loadData,
	loadInventoryPage: () => loadInventoryPage,
	renderInventoryView: () => renderInventoryView
});
var dataGuard = createRequestGuard();
var inventoryGuard = createRequestGuard();
var statsGuard = createRequestGuard();
var VIEW_HOOKS = [
	"buildDatalists",
	"buildFilterPanel",
	"checkReminder",
	"updateNotifications",
	"remountTab",
	"renderInventory",
	"updatePreparedBadge"
];
var dataRefreshView = null;
function configureDataRefresh(hooks) {
	var missing = VIEW_HOOKS.filter(function(name) {
		return typeof (hooks && hooks[name]) !== "function";
	});
	if (missing.length) throw new TypeError("configureDataRefresh 缺少：" + missing.join(", "));
	dataRefreshView = Object.freeze(VIEW_HOOKS.reduce(function(view, name) {
		view[name] = hooks[name];
		return view;
	}, {}));
}
function view() {
	if (!dataRefreshView) throw new Error("data-refresh：尚未設定畫面更新實作（pages/main.js 需先呼叫 configureShell）");
	return dataRefreshView;
}
function renderInventoryView() {
	view().renderInventory();
}
async function loadData(options) {
	const full = Boolean(options && options.full);
	const refreshDestinations = Boolean(options && options.refreshDestinations);
	const requestId = dataGuard.next();
	if (appState.dataAbortController) appState.dataAbortController.abort();
	const refreshSummary = !options || options.refreshSummary !== false;
	if (!full && appState.currentTab === "inventory") {
		await loadInventoryPageImpl(appState.INVENTORY_META.page || 1, refreshSummary, true, refreshDestinations);
		return;
	}
	const controller = new AbortController();
	appState.dataAbortController = controller;
	const siteAtRequest = appState.currentSite;
	try {
		if (!full && ITEMLESS_TABS.has(appState.currentTab)) {
			if (!dataGuard.isCurrent(requestId) || siteAtRequest !== appState.currentSite) return;
			appState.ALL_ITEMS = [];
			appState.fullItemsLoadedSite = "";
			view().updateNotifications();
			updateSubInfo();
			if (!DATA_REFRESH_PRESERVE_MOUNT_TABS.has(appState.currentTab)) view().remountTab(appState.currentTab);
			loadPreparedBadge();
			return;
		}
		const refreshFacets = appState.currentTab === "inventory";
		const [items, facets] = await Promise.all([apiFetch(`/api/items?site=${encodeURIComponent(siteAtRequest)}`, { signal: controller.signal }), refreshFacets ? apiFetch(`/api/items/facets?site=${encodeURIComponent(siteAtRequest)}`, { signal: controller.signal }).catch((e) => e.status ? null : Promise.reject(e)) : Promise.resolve(null)]);
		if (!dataGuard.isCurrent(requestId) || siteAtRequest !== appState.currentSite) return;
		appState.ALL_ITEMS = items;
		appState.fullItemsLoadedSite = siteAtRequest;
		appState.inventoryLoadedSite = "";
		if (facets) {
			appState.INVENTORY_FACETS = facets;
			appState.inventoryFacetsLoadedSite = siteAtRequest;
			reconcileInventoryFilters(facets);
		}
		if (refreshDestinations) await refreshDestinationsAfterMutation();
		view().buildDatalists(refreshDestinations);
		view().buildFilterPanel();
		view().checkReminder();
		view().updateNotifications();
		updateSubInfo();
		if (!DATA_REFRESH_PRESERVE_MOUNT_TABS.has(appState.currentTab)) view().remountTab(appState.currentTab);
		loadPreparedBadge();
	} catch (e) {
		if (e.name === "AbortError" || !dataGuard.isCurrent(requestId) || siteAtRequest !== appState.currentSite) return;
		document.getElementById("content").innerHTML = `<div class="empty">⚠️ 無法連線伺服器<br><small>${esc(e.message)}</small></div>`;
	} finally {
		if (appState.dataAbortController === controller) appState.dataAbortController = null;
	}
}
async function loadInventoryPage(page) {
	return loadInventoryPageImpl(page, false);
}
function reconcileInventoryFilters(facets) {
	let changed = false;
	const validBrands = new Set(Object.keys(facets && facets.brands || {}));
	const validCategories = new Set(Object.keys(facets && facets.categories || {}));
	for (let i = appState.currentBrands.length - 1; i >= 0; i--) if (!validBrands.has(appState.currentBrands[i])) {
		appState.currentBrands.splice(i, 1);
		changed = true;
	}
	for (let i = appState.currentCategories.length - 1; i >= 0; i--) if (!validCategories.has(appState.currentCategories[i])) {
		appState.currentCategories.splice(i, 1);
		changed = true;
	}
	return changed;
}
async function loadInventoryPageImpl(page, refreshSummary, refreshFacets, refreshDestinations) {
	dataGuard.invalidate();
	if (appState.dataAbortController) appState.dataAbortController.abort();
	const requestId = inventoryGuard.next();
	if (appState.inventoryAbortController) appState.inventoryAbortController.abort();
	const controller = new AbortController();
	appState.inventoryAbortController = controller;
	const siteAtRequest = appState.currentSite;
	const pageAtRequest = Math.max(1, page || 1);
	try {
		const params = new URLSearchParams({
			site: siteAtRequest,
			page: String(pageAtRequest),
			page_size: String(appState.INVENTORY_META.page_size || 50),
			sort: "brand"
		});
		const search = document.getElementById("search-input");
		if (search && search.value.trim()) params.set("search", search.value.trim());
		if (appState.currentBrands.length) params.set("brands", appState.currentBrands.join(","));
		if (appState.currentCategories.length) params.set("categories", appState.currentCategories.join(","));
		const facetsRequest = Boolean(refreshFacets) || appState.inventoryFacetsLoadedSite !== siteAtRequest ? apiFetch(`/api/items/facets?site=${encodeURIComponent(siteAtRequest)}`, { signal: controller.signal }).catch((e) => e.status ? null : Promise.reject(e)) : Promise.resolve(null);
		const [pageBody, facets] = await Promise.all([apiFetch(`/api/items?${params}`, { signal: controller.signal }), facetsRequest]);
		let body = pageBody;
		if (!inventoryGuard.isCurrent(requestId) || siteAtRequest !== appState.currentSite) return;
		if (facets && reconcileInventoryFilters(facets)) {
			if (appState.currentBrands.length) params.set("brands", appState.currentBrands.join(","));
			else params.delete("brands");
			if (appState.currentCategories.length) params.set("categories", appState.currentCategories.join(","));
			else params.delete("categories");
			body = await apiFetch(`/api/items?${params}`, { signal: controller.signal });
			if (!inventoryGuard.isCurrent(requestId) || siteAtRequest !== appState.currentSite) return;
		}
		appState.ALL_ITEMS = body.items || [];
		appState.INVENTORY_META = {
			page: body.page || pageAtRequest,
			page_size: body.page_size || 50,
			total: body.total || 0,
			stats: body.stats || null
		};
		if (facets) {
			appState.INVENTORY_FACETS = facets;
			appState.inventoryFacetsLoadedSite = siteAtRequest;
			reconcileInventoryFilters(facets);
		}
		appState.inventoryLoadedSite = siteAtRequest;
		appState.fullItemsLoadedSite = "";
		if (refreshDestinations) await refreshDestinationsAfterMutation();
		view().buildDatalists(refreshDestinations);
		view().buildFilterPanel();
		view().checkReminder();
		view().updateNotifications();
		if (refreshSummary || !hasSummaryCache()) await updateSubInfo();
		else renderSubInfo();
		if (!inventoryGuard.isCurrent(requestId) || appState.currentTab !== "inventory") return;
		view().renderInventory();
	} catch (e) {
		if (e.name === "AbortError" || !inventoryGuard.isCurrent(requestId) || siteAtRequest !== appState.currentSite) return;
		document.getElementById("content").innerHTML = `<div class="empty">⚠️ 無法載入庫存<br><small>${esc(e.message)}</small></div>`;
	} finally {
		if (appState.inventoryAbortController === controller) appState.inventoryAbortController = null;
	}
}
function changeInventoryPage(page) {
	if (page < 1 || page > Math.ceil(appState.INVENTORY_META.total / appState.INVENTORY_META.page_size)) return;
	loadInventoryPage(page);
}
async function loadPreparedBadge() {
	const siteAtRequest = appState.currentSite;
	try {
		const items = await apiFetch(`/api/prepared?site=${encodeURIComponent(siteAtRequest)}`);
		if (siteAtRequest !== appState.currentSite) return;
		view().updatePreparedBadge(items.length);
	} catch (e) {}
}
function hasSummaryCache() {
	return typeof appState.ALERTS_BY_SITE !== "undefined" && appState.ALERTS_BY_SITE && appState.ALERTS_BY_SITE.all && typeof appState.ALERTS_BY_SITE.all.single_items !== "undefined";
}
function renderSubInfo() {
	if (!hasSummaryCache()) return;
	const current = appState.ALERTS_BY_SITE[appState.currentSite] || appState.ALERTS_BY_SITE.all;
	document.getElementById("sub-info").textContent = `單一材料 ${current.single_items} 項 · 整組 ${current.kit_items} 組 · ${current.brands} 種廠牌 · 缺貨 ${current.zero_stock} 項`;
	const officeStats = appState.ALERTS_BY_SITE.office;
	const warehouseStats = appState.ALERTS_BY_SITE.warehouse;
	const vanStats = appState.ALERTS_BY_SITE.van;
	const truckStats = appState.ALERTS_BY_SITE.truck;
	document.getElementById("site-office-sub").textContent = `${officeStats.total_items} 項 · ${officeStats.total_qty}`;
	document.getElementById("site-warehouse-sub").textContent = `${warehouseStats.total_items} 項 · ${warehouseStats.total_qty}`;
	document.getElementById("site-van-sub").textContent = `${vanStats.total_items} 項 · ${vanStats.total_qty}`;
	document.getElementById("site-truck-sub").textContent = `${truckStats.total_items} 項 · ${truckStats.total_qty}`;
}
async function updateSubInfo() {
	const requestId = statsGuard.next();
	if (appState.statsAbortController) appState.statsAbortController.abort();
	const controller = new AbortController();
	appState.statsAbortController = controller;
	const siteAtRequest = appState.currentSite;
	try {
		const summary = await apiFetch("/api/stats/summary", { signal: controller.signal });
		if (!statsGuard.isCurrent(requestId) || siteAtRequest !== appState.currentSite) return;
		appState.ALERTS_BY_SITE = {
			all: summary.all || {},
			office: summary.office || {},
			warehouse: summary.warehouse || {},
			van: summary.van || {},
			truck: summary.truck || {}
		};
		renderSubInfo();
		view().updateNotifications();
	} catch (e) {
		if (e.name !== "AbortError" && statsGuard.isCurrent(requestId) && siteAtRequest === appState.currentSite) console.error("[updateSubInfo] 統計失敗", e);
	} finally {
		if (appState.statsAbortController === controller) appState.statsAbortController = null;
	}
}
//#endregion
//#region static/js/features/inventory/photo.js
var photo_exports = /* @__PURE__ */ __exportAll({
	_previewKitPhoto: () => _previewKitPhoto,
	bindSimilarCheck: () => bindSimilarCheck,
	closePhotoLightbox: () => closePhotoLightbox,
	deleteItemPhoto: () => deleteItemPhoto,
	deleteKitPhoto: () => deleteKitPhoto,
	initInventoryPhoto: () => initInventoryPhoto,
	openPhotoLightbox: () => openPhotoLightbox,
	renderKitPhotoBox: () => renderKitPhotoBox,
	renderPhotoBox: () => renderPhotoBox,
	uploadItemPhoto: () => uploadItemPhoto
});
var similarTimer = null;
var similarGuard = createRequestGuard();
function renderPhotoBox(itemId, hasPhoto) {
	const box = document.getElementById("e-photo-box");
	if (!box) return;
	const canPhoto = hasPerm("photo");
	if (hasPhoto) box.innerHTML = `
      <img src="${photoSrc(itemId, "thumbnail")}" alt="品項照片" loading="lazy" decoding="async" width="320" height="240" onclick="Inventory.openPhotoLightbox(${itemId})"
           class="photo-box-thumb" title="點擊看大圖" onerror="this.style.display='none'">
      ${canPhoto ? `<div class="photo-actions">
        <label class="btn btn--secondary btn--md btn-prepare">📷 拍照
          <input type="file" accept="image/*" capture="environment" style="display:none"
                 onchange="Inventory.uploadItemPhoto(${itemId}, this)">
        </label>
        <label class="btn btn--secondary btn--md btn-prepare">🖼 從相簿選
          <input type="file" accept="image/*" style="display:none"
                 onchange="Inventory.uploadItemPhoto(${itemId}, this)">
        </label>
        <button class="btn btn--danger btn--md btn-prepare" onclick="Inventory.deleteItemPhoto(${itemId})">🗑 刪除</button>
      </div>` : ""}`;
	else box.innerHTML = canPhoto ? `<div class="photo-box-hint">尚無照片</div>
      <div class="photo-actions">
        <label class="btn btn--secondary btn--md btn-prepare">📷 拍照
          <input type="file" accept="image/*" capture="environment" style="display:none"
                 onchange="Inventory.uploadItemPhoto(${itemId}, this)">
        </label>
        <label class="btn btn--secondary btn--md btn-prepare">🖼 從相簿選
          <input type="file" accept="image/*" style="display:none"
                 onchange="Inventory.uploadItemPhoto(${itemId}, this)">
        </label>
      </div>` : "<div class=\"photo-box-hint\">尚無照片</div>";
}
async function uploadItemPhoto(itemId, input) {
	const file = input.files && input.files[0];
	if (!file) return;
	const ALLOWED = [
		".jpg",
		".jpeg",
		".png",
		".webp"
	];
	const ext = file.name.substring(file.name.lastIndexOf(".")).toLowerCase();
	if (ALLOWED.indexOf(ext) === -1) {
		toast("不支援的圖片格式（限 jpg/png/webp）", "error");
		return;
	}
	if (file.size > 10485760) {
		toast("圖片超過 10MB 上限", "error");
		return;
	}
	const fd = new FormData();
	fd.append("file", file);
	try {
		let body;
		try {
			body = await apiFetch(`/api/items/${itemId}/photo`, {
				method: "POST",
				body: fd,
				fallback: "上傳失敗"
			}) || {};
		} catch (e) {
			toast("⚠️ " + e.message, "error");
			return;
		}
		toast("✅ 照片已更新", "success");
		const item = appState.ALL_ITEMS.find((i) => i.id === itemId);
		if (item) {
			item.has_photo = true;
			item.photo_asset_id = body.asset_id || null;
			item.thumbnail_url = body.thumbnail_url || null;
			item.preview_url = body.preview_url || null;
			renderInventoryView();
		}
		renderPhotoBox(itemId, true);
	} catch {
		toast("上傳失敗", "error");
	}
	input.value = "";
}
async function deleteItemPhoto(itemId) {
	try {
		await apiFetch(`/api/items/${itemId}/photo`, { method: "DELETE" });
		toast("🗑 照片已刪除", "success");
		renderPhotoBox(itemId, false);
		const item = appState.ALL_ITEMS.find((i) => i.id === itemId);
		if (item) {
			item.has_photo = false;
			renderInventoryView();
		}
	} catch {
		toast("刪除失敗", "error");
	}
}
var photoLightboxEl = null;
function openPhotoLightbox(itemId) {
	closePhotoLightbox();
	const overlay = document.createElement("div");
	overlay.id = "photo-lightbox";
	overlay.innerHTML = `
    <div class="lightbox-content">
      <img src="${photoSrc(itemId, "preview")}" alt="品項照片大圖" decoding="async" onclick="event.stopPropagation()">
      <div class="lightbox-close" onclick="Inventory.closePhotoLightbox()">✕</div>
    </div>`;
	overlay.onclick = closePhotoLightbox;
	document.body.appendChild(overlay);
	photoLightboxEl = overlay;
}
function closePhotoLightbox() {
	if (photoLightboxEl) {
		photoLightboxEl.remove();
		photoLightboxEl = null;
	}
}
function bindSimilarCheck(nameId, codeId, warnId, excludeId) {
	const nameEl = document.getElementById(nameId);
	const codeEl = document.getElementById(codeId);
	if (!nameEl || !codeEl) return;
	if (nameEl.dataset.similarBound === "1") return;
	nameEl.dataset.similarBound = "1";
	codeEl.dataset.similarBound = "1";
	const trigger = () => {
		clearTimeout(similarTimer);
		const name = document.getElementById(nameId).value.trim();
		const code = document.getElementById(codeId).value.trim();
		if (!name && !code) {
			document.getElementById(warnId).style.display = "none";
			return;
		}
		similarTimer = setTimeout(() => checkSimilar(name, code, warnId, excludeId), 350);
	};
	nameEl.addEventListener("input", trigger);
	codeEl.addEventListener("input", trigger);
}
async function checkSimilar(name, code, warnId, excludeId) {
	const seq = similarGuard.next();
	const params = new URLSearchParams();
	if (name) params.set("name", name);
	if (code) params.set("code", code);
	params.set("site", appState.currentSite);
	if (excludeId) params.set("exclude_id", excludeId);
	try {
		const hits = await apiFetch(`/api/items/similar?${params}`);
		if (!similarGuard.isCurrent(seq)) return;
		renderSimilarWarn(warnId, hits);
	} catch {}
}
function renderSimilarWarn(warnId, hits) {
	const box = document.getElementById(warnId);
	if (!hits.length) {
		box.style.display = "none";
		return;
	}
	box.innerHTML = `⚠️ 可能已有相似品項，請確認是否要新增：
    ${hits.map((h) => `
      <div class="sim-row">
        <span>${esc(h.name)}${h.code ? "（" + esc(h.code) + "）" : ""}
          · 共 ${Qty.disp(h.total_qty, h.unit)} ${esc(h.unit || "個")}
          ${h.stocks && h.stocks.length ? "· " + esc(h.stocks.map((s) => s.location + "×" + s.qty).join(", ")) : ""}</span>
        <a href="#" onclick="Inventory.goEditSimilar(${h.id}); return false;">去編輯 →</a>
      </div>`).join("")}`;
	box.style.display = "block";
}
/**
* 依 Kit 定義與其庫存品項的不同識別碼渲染整組照片控制。
* @param {number|null} kitId - kits.id；用於整組專屬上傳與刪除端點。
* @param {number|null} itemId - kits.item_id；用於照片縮圖與 lightbox 媒體查詢。
* @param {boolean} hasPhoto - 該 backing item 是否已有照片。
* @returns {void} 更新整組編輯 modal 的照片區塊。
*/
function renderKitPhotoBox(kitId, itemId, hasPhoto) {
	const box = document.getElementById("k-photo-box");
	if (!box) return;
	if (!hasPerm("photo")) {
		box.innerHTML = "<div class=\"photo-box-hint\">無照片上傳權限</div>";
		return;
	}
	if (kitId === null || kitId === void 0) {
		box.innerHTML = `<div id="k-photo-message" class="photo-box-hint">建立後可立即上傳照片</div>
      <div id="k-photo-preview" class="photo-box-preview"></div>
      <div class="photo-actions">
        <label class="btn btn--secondary btn--md btn-prepare">📷 拍照
          <input type="file" accept="image/*" capture="environment" id="k-photo-input" style="display:none" onchange="Inventory._previewKitPhoto(this)">
        </label>
        <label class="btn btn--secondary btn--md btn-prepare">🖼 從相簿選
          <input type="file" accept="image/*" id="k-photo-album" style="display:none" onchange="Inventory._previewKitPhoto(this)">
        </label>
      </div>`;
		const cam = document.getElementById("k-photo-input");
		const album = document.getElementById("k-photo-album");
		cam?.addEventListener("change", () => {
			if (cam.files[0]) album.value = "";
		});
		album?.addEventListener("change", () => {
			if (album.files[0]) cam.value = "";
		});
	} else if (hasPhoto) box.innerHTML = `<img src="${photoSrc(itemId, "thumbnail")}" alt="整組照片" loading="lazy" decoding="async" width="320" height="240" onclick="Inventory.openPhotoLightbox(${itemId})" class="photo-box-thumb" title="點擊看大圖" onerror="this.style.display='none'">
        <div id="k-photo-preview" class="photo-box-preview"></div>
        <div class="photo-actions">
          <label class="btn btn--secondary btn--md btn-prepare">📷 拍照
            <input type="file" accept="image/*" capture="environment" id="k-photo-input" style="display:none" onchange="Inventory._previewKitPhoto(this)">
          </label>
          <label class="btn btn--secondary btn--md btn-prepare">🖼 從相簿選
            <input type="file" accept="image/*" id="k-photo-album" style="display:none" onchange="Inventory._previewKitPhoto(this)">
          </label>
          <button class="btn btn--danger btn--md btn-prepare" onclick="Inventory.deleteKitPhoto(${kitId}, ${itemId})">🗑 刪除</button>
        </div>`;
	else box.innerHTML = `<div id="k-photo-message" class="photo-box-hint">尚無照片</div>
        <div id="k-photo-preview" class="photo-box-preview"></div>
        <div class="photo-actions">
          <label class="btn btn--secondary btn--md btn-prepare">📷 拍照
            <input type="file" accept="image/*" capture="environment" id="k-photo-input" style="display:none" onchange="Inventory._previewKitPhoto(this)">
          </label>
          <label class="btn btn--secondary btn--md btn-prepare">🖼 從相簿選
            <input type="file" accept="image/*" id="k-photo-album" style="display:none" onchange="Inventory._previewKitPhoto(this)">
          </label>
        </div>`;
}
/**
* 透過 Kit 專屬端點刪除照片，避免將 Kit ID 誤當成 backing item ID。
* @param {number} kitId - kits.id；用於 DELETE /api/kits/{kitId}/photo。
* @param {number} itemId - kits.item_id；用於更新前端 item/Kit 照片狀態。
* @returns {Promise<void>} 刪除成功後重繪照片區並刷新目前資料。
*/
async function deleteKitPhoto(kitId, itemId) {
	try {
		await apiFetch(`/api/kits/${kitId}/photo`, { method: "DELETE" });
		const kit = Array.isArray(appState.currentKitItems) ? appState.currentKitItems.find((entry) => Number(entry.id) === Number(kitId)) : null;
		if (kit) {
			kit.has_photo = false;
			kit.thumbnail_url = null;
			kit.preview_url = null;
		}
		const item = Array.isArray(appState.ALL_ITEMS) ? appState.ALL_ITEMS.find((entry) => Number(entry.id) === Number(itemId)) : null;
		if (item) {
			item.has_photo = false;
			item.thumbnail_url = null;
			item.preview_url = null;
		}
		renderKitPhotoBox(kitId, itemId, false);
		toast("🗑 照片已刪除", "success");
		await loadData();
	} catch {
		toast("刪除失敗", "error");
	}
}
/**
* Preview the selected Kit image using DOM properties, not HTML interpolation.
* @param {HTMLInputElement} input File input that contains the selected image.
* @returns {void} Replaces the preview content after FileReader finishes.
*/
function _previewKitPhoto(input) {
	const preview = document.getElementById("k-photo-preview");
	const message = document.getElementById("k-photo-message");
	if (!preview) return;
	const file = input.files && input.files[0];
	if (!file) {
		preview.innerHTML = "";
		if (message) message.style.display = "";
		return;
	}
	if (message) message.style.display = "none";
	const reader = new FileReader();
	reader.onload = function(e) {
		const wrapper = document.createElement("div");
		wrapper.className = "photo-preview";
		const image = document.createElement("img");
		image.src = e.target.result;
		image.alt = "預覽";
		const clear = document.createElement("button");
		clear.type = "button";
		clear.textContent = "✕ 清除";
		clear.className = "btn btn--danger btn--sm photo-preview-clear";
		clear.addEventListener("click", _clearKitPhotoPreview);
		wrapper.append(image, clear);
		preview.replaceChildren(wrapper);
	};
	reader.readAsDataURL(file);
}
function _clearKitPhotoPreview() {
	const preview = document.getElementById("k-photo-preview");
	const message = document.getElementById("k-photo-message");
	if (preview) preview.innerHTML = "";
	if (message) message.style.display = "";
	const cam = document.getElementById("k-photo-input");
	const album = document.getElementById("k-photo-album");
	if (cam) cam.value = "";
	if (album) album.value = "";
}
function initInventoryPhoto() {
	document.addEventListener("keydown", (e) => {
		if (e.key === "Escape") closePhotoLightbox();
	});
}
//#endregion
//#region static/js/features/inventory/edit-modal.js
var edit_modal_exports = /* @__PURE__ */ __exportAll({
	_cabinetOptions: () => _cabinetOptions,
	addEditStockRow: () => addEditStockRow,
	deleteEditStockRow: () => deleteEditStockRow,
	goEditSimilar: () => goEditSimilar,
	openEditModal: () => openEditModal,
	submitEdit: () => submitEdit
});
var editUpdatedAt = null;
function getInventoryEditableItem(id) {
	const numericId = Number(id);
	const current = Array.isArray(appState.ALL_ITEMS) ? appState.ALL_ITEMS.find((i) => Number(i.id) === numericId) : null;
	if (current) return current;
	return INVENTORY_ALERT_ITEMS[String(numericId)] || null;
}
function openEditModal(id) {
	const item = getInventoryEditableItem(id);
	if (!item) return;
	appState.editItemId = id;
	editUpdatedAt = item.updated_at || null;
	document.getElementById("e-brand").value = item.brand || "";
	document.getElementById("e-code").value = item.code || "";
	document.getElementById("e-name").value = item.name || "";
	fillUnitSelect(document.getElementById("e-unit"), item.unit || "個");
	const eUnitAdd = document.getElementById("e-unit-add");
	if (eUnitAdd) eUnitAdd.style.display = hasPerm("item-mgmt") ? "" : "none";
	const eUnitSearch = document.getElementById("e-unit-search");
	if (eUnitSearch) eUnitSearch.value = "";
	document.getElementById("e-lowstock").value = item.low_stock || 0;
	document.getElementById("e-site").value = item.site || "office";
	document.getElementById("e-site").disabled = true;
	document.getElementById("e-category").value = item.category || "";
	const stocks = item.stocks && item.stocks.length ? item.stocks : [{
		location: item.location || "",
		qty: item.qty || 0,
		note: item.note || ""
	}];
	renderEditStockRows(stocks, item.unit || "個");
	renderPhotoBox(id, !!item.has_photo);
	const warnBox = document.getElementById("e-similar-warn");
	warnBox.style.display = "none";
	warnBox.innerHTML = "";
	openModal("edit-modal");
	(async () => {
		try {
			appState.globalCabinetList = await apiFetch("/api/cabinets");
			renderEditStockRows(stocks, item.unit || "個");
		} catch (e) {
			console.warn("編輯 modal 載入櫃子清單失敗", e);
		}
	})();
	bindSimilarCheck("e-name", "e-code", "e-similar-warn", id);
}
/**
* Render editable location rows with mobile labels and a remove control.
* @param {Array<Object>} stocks - Persisted stock rows belonging to the item.
* @param {string} unit - Unit used to format quantities.
* @returns {void}
*/
function renderEditStockRows(stocks, unit) {
	const box = document.getElementById("edit-stock-rows");
	const qtyType = Qty.unitTypeOf(unit);
	box.innerHTML = stocks.map((stock, index) => {
		const location = stock.location || "";
		const separator = location.indexOf(" | ");
		const cabinet = separator >= 0 ? location.substring(0, separator) : location;
		const subLocation = separator >= 0 ? location.substring(separator + 3) : "";
		const quantity = Qty.format(stock.qty ?? 0, qtyType);
		const stockId = stock.id != null ? stock.id : "";
		const revision = stock.updated_at || "";
		return `
    <div class="stock-row" data-role="stock-row" data-idx="${esc(String(index))}" data-stock-id="${esc(String(stockId))}" data-stock-qty="${esc(String(stock.qty ?? 0))}" data-stock-updated-at="${esc(revision)}">
      <label class="stock-field stock-field-cabinet"><span class="stock-mobile-label">櫃子*</span><select class="stock-cabinet" data-role="stock-cabinet">${_cabinetOptions(cabinet)}</select></label>
      <label class="stock-field stock-field-sub"><span class="stock-mobile-label">位置(選填)</span><input type="text" class="stock-sub" data-role="stock-sub" value="${esc(subLocation)}" list="location-list" placeholder="位置"></label>
      <label class="stock-field stock-field-qty"><span class="stock-mobile-label">數量(選填)</span><input type="text" inputmode="decimal" class="stock-qty" data-role="stock-qty" value="${esc(quantity)}" placeholder="數量（可輸 1/4）"></label>
      <label class="stock-field stock-field-note"><span class="stock-mobile-label">備註(選填)</span><input type="text" class="stock-note" data-role="stock-note" value="${esc(stock.note || "")}" placeholder="備註（選填）"></label>
      <button type="button" class="stock-remove" onclick="Inventory.deleteEditStockRow(this)" aria-label="移除第 ${esc(String(index + 1))} 個位置" title="移除此位置">✕</button>
    </div>`;
	}).join("");
}
function _cabinetOptions(selected) {
	const cabs = [{
		name: "",
		note: ""
	}, ...appState.globalCabinetList];
	if (selected && !cabs.some((c) => (c.name || "") === selected)) cabs.push({
		name: selected,
		note: "不在櫃子清單"
	});
	return cabs.map((c) => {
		const name = c.name || "";
		const label = name ? name + (c.note ? `(${c.note})` : "") : "— 請選擇 —";
		return `<option value="${esc(name)}" ${name === selected ? "selected" : ""}>${esc(label)}</option>`;
	}).join("");
}
/**
* Append a zero-quantity editable location row with a removable control.
* @returns {void}
*/
function addEditStockRow() {
	const box = document.getElementById("edit-stock-rows");
	const row = document.createElement("div");
	row.className = "stock-row";
	row.dataset.role = "stock-row";
	row.dataset.idx = box.children.length;
	row.dataset.stockId = "";
	row.dataset.stockUpdatedAt = "";
	row.dataset.stockQty = "0";
	row.innerHTML = `
    <label class="stock-field stock-field-cabinet"><span class="stock-mobile-label">櫃子*</span><select class="stock-cabinet" data-role="stock-cabinet">${_cabinetOptions("")}</select></label>
    <label class="stock-field stock-field-sub"><span class="stock-mobile-label">位置(選填)</span><input type="text" class="stock-sub" data-role="stock-sub" list="location-list" placeholder="位置"></label>
    <label class="stock-field stock-field-qty"><span class="stock-mobile-label">數量(選填)</span><input type="text" inputmode="decimal" class="stock-qty" data-role="stock-qty" value="0" placeholder="數量（可輸 1/4）"></label>
    <label class="stock-field stock-field-note"><span class="stock-mobile-label">備註(選填)</span><input type="text" class="stock-note" data-role="stock-note" placeholder="備註（選填）"></label>
    <button type="button" class="stock-remove" onclick="Inventory.deleteEditStockRow(this)" aria-label="移除此位置" title="移除此位置">✕</button>
  `;
	box.appendChild(row);
	row.querySelector("[data-role=\"stock-sub\"]").focus();
}
/**
* Remove an empty persisted location or discard an unsaved row without risking stock loss.
* @param {HTMLButtonElement} button - Remove control inside the location row.
* @returns {void}
*/
function deleteEditStockRow(button) {
	const box = document.getElementById("edit-stock-rows");
	const row = button && button.closest("[data-role=\"stock-row\"]");
	if (!row) return;
	if (box.querySelectorAll("[data-role=\"stock-row\"]").length <= 1) {
		toast("至少保留一個位置列；若要清空庫存，請先確認品項資料。", "info");
		return;
	}
	if (row.dataset.stockId || "") {
		const persistedQty = Number(row.dataset.stockQty);
		if (!Number.isFinite(persistedQty)) {
			toast("位置庫存快照不完整，請重新載入後再移除。", "error");
			return;
		}
		if (Math.round(persistedQty * 1e3) / 1e3 !== 0) {
			toast("此位置目前仍有庫存，請先將數量調整為 0 並儲存；重新開啟編輯後再移除。", "error");
			return;
		}
	}
	row.remove();
}
async function submitEdit() {
	const nameVal = document.getElementById("e-name").value.trim();
	const brandVal = document.getElementById("e-brand").value.trim();
	const codeVal = document.getElementById("e-code").value.trim();
	if (!brandVal) {
		toast("廠牌必填", "error");
		return;
	}
	if (!codeVal) {
		toast("型號必填", "error");
		return;
	}
	if (!nameVal) {
		toast("品項名稱必填", "error");
		return;
	}
	const _lsRaw = document.getElementById("e-lowstock").value;
	const lowstockVal = (function() {
		const _p = Qty.parse(_lsRaw.trim() === "" ? "0" : _lsRaw);
		return _p.error ? NaN : _p.value;
	})();
	if (document.getElementById("e-lowstock").value !== "" && (isNaN(lowstockVal) || lowstockVal < 0)) {
		toast("警示值不能為負數", "error");
		return;
	}
	const stocks = [];
	for (const row of document.querySelectorAll("#edit-stock-rows [data-role=\"stock-row\"]")) {
		const cabinet = row.querySelector("[data-role=\"stock-cabinet\"]").value.trim();
		const sub = row.querySelector("[data-role=\"stock-sub\"]").value.trim();
		const note = row.querySelector("[data-role=\"stock-note\"]").value.trim();
		const qtyInput = row.querySelector("[data-role=\"stock-qty\"]");
		const qty = qtyInput.value.trim() === "" ? 0 : qtyInputOrToast(qtyInput, document.getElementById("e-unit").value);
		if (typeof qty !== "number" || isNaN(qty)) return;
		if (!row.dataset.stockId && !cabinet && !sub && qty === 0 && !note) continue;
		if (!cabinet) {
			toast("請選擇櫃子", "error");
			return;
		}
		const location = sub ? `${cabinet} | ${sub}` : cabinet;
		stocks.push({
			id: row.dataset.stockId !== "" ? Number(row.dataset.stockId) : null,
			location,
			qty,
			note,
			stock_updated_at: row.dataset.stockUpdatedAt || null
		});
	}
	if (!stocks.length) {
		toast("位置必填（至少選櫃子）", "error");
		return;
	}
	const payload = {
		brand: brandVal,
		code: codeVal,
		name: nameVal,
		unit: document.getElementById("e-unit").value,
		low_stock: isNaN(lowstockVal) ? 0 : lowstockVal,
		category: document.getElementById("e-category").value,
		stocks,
		updated_at: editUpdatedAt
	};
	try {
		await apiFetch(`/api/items/${appState.editItemId}`, {
			method: "PATCH",
			json: payload,
			fallback: "儲存失敗"
		});
		closeModalForce("edit-modal");
		toast("✅ 已儲存修改", "success");
		await loadData();
	} catch (e) {
		toast(e.status ? "⚠️ " + e.message : "儲存失敗", "error");
	}
}
function goEditSimilar(id) {
	closeModalForce("add-modal");
	closeModalForce("edit-modal");
	openEditModal(id);
}
//#endregion
//#region static/js/features/account/password-expiry.js
var password_expiry_exports = /* @__PURE__ */ __exportAll({
	ackPasswordExpiry: () => ackPasswordExpiry,
	expiryGoChangePw: () => expiryGoChangePw,
	openExpiryModal: () => openExpiryModal
});
function openExpiryModal() {
	const u = currentUser;
	const isAdmin = u && !!(u.permissions || {})["change-own-password"];
	const btn = document.getElementById("expiry-change-pw");
	const ack = document.getElementById("expiry-ack");
	const adminOnly = document.getElementById("expiry-admin-only");
	if (btn) btn.style.display = isAdmin ? "" : "none";
	if (ack) ack.style.display = isAdmin ? "" : "none";
	if (adminOnly) adminOnly.style.display = isAdmin ? "none" : "";
	openModal("expiry-modal");
}
function expiryGoChangePw() {
	closeModalForce("expiry-modal");
	openChangePwModal();
}
async function ackPasswordExpiry() {
	try {
		await apiFetch("/api/auth/password-ack", { method: "POST" });
	} catch (e) {}
	closeModalForce("expiry-modal");
}
//#endregion
//#region static/js/features/inventory/add-modal.js
var add_modal_exports = /* @__PURE__ */ __exportAll({
	addAddStockRow: () => addAddStockRow,
	openAddModal: () => openAddModal,
	removeAddStockRow: () => removeAddStockRow,
	submitAdd: () => submitAdd
});
function openAddModal() {
	openModal("add-modal");
	document.getElementById("f-site").value = appState.currentSite;
	document.getElementById("f-brand").focus();
	const warnBox = document.getElementById("f-similar-warn");
	warnBox.style.display = "none";
	warnBox.innerHTML = "";
	bindSimilarCheck("f-name", "f-code", "f-similar-warn", 0);
	document.getElementById("f-category").value = "";
	document.getElementById("f-name").removeEventListener("input", _autoInferCategory);
	document.getElementById("f-name").addEventListener("input", _autoInferCategory);
	fillUnitSelect(document.getElementById("f-unit"), "個");
	const fUnitSearch = document.getElementById("f-unit-search");
	if (fUnitSearch) fUnitSearch.value = "";
	const fUnitAdd = document.getElementById("f-unit-add");
	if (fUnitAdd) fUnitAdd.style.display = hasPerm("item-mgmt") ? "" : "none";
	renderAddPhotoBox();
	resetAddStockRows();
	(async () => {
		try {
			appState.globalCabinetList = await apiFetch("/api/cabinets");
			refreshAddStockCabinetOptions();
		} catch (e) {
			console.warn("新增 modal 載入櫃子清單失敗", e);
		}
	})();
}
/**
* Build one editable add-modal location row (same fields/classes as the edit modal).
* @returns {string} Row inner HTML.
*/
function addStockRowHtml() {
	return `
    <label class="stock-field stock-field-cabinet"><span class="stock-mobile-label">櫃子*</span><select class="stock-cabinet" data-role="stock-cabinet">${_cabinetOptions("")}</select></label>
    <label class="stock-field stock-field-sub"><span class="stock-mobile-label">位置(選填)</span><input type="text" class="stock-sub" data-role="stock-sub" list="location-list" placeholder="例：1-1"></label>
    <label class="stock-field stock-field-qty"><span class="stock-mobile-label">數量(選填)</span><input type="text" inputmode="decimal" class="stock-qty" data-role="stock-qty" value="0" placeholder="數量（可輸 1/4）"></label>
    <label class="stock-field stock-field-note"><span class="stock-mobile-label">備註(選填)</span><input type="text" class="stock-note" data-role="stock-note" placeholder="備註"></label>
    <button type="button" class="stock-remove" onclick="Inventory.removeAddStockRow(this)" aria-label="移除此位置" title="移除此位置">✕</button>`;
}
/**
* Append one empty location row to the add modal.
* @param {boolean} [focus=true] Whether to focus the new row's cabinet select.
* @returns {void}
*/
function addAddStockRow(focus = true) {
	const box = document.getElementById("add-stock-rows");
	if (!box) return;
	const row = document.createElement("div");
	row.className = "stock-row";
	row.dataset.role = "stock-row";
	row.innerHTML = addStockRowHtml();
	box.appendChild(row);
	if (focus) row.querySelector("[data-role=\"stock-cabinet\"]").focus();
}
/** Reset the add modal to a single blank location row. */
function resetAddStockRows() {
	const box = document.getElementById("add-stock-rows");
	if (!box) return;
	box.innerHTML = "";
	addAddStockRow(false);
}
/**
* Remove one unsaved add-modal location row, keeping at least one row.
* @param {HTMLButtonElement} button Remove control inside the row.
* @returns {void}
*/
function removeAddStockRow(button) {
	const box = document.getElementById("add-stock-rows");
	const row = button && button.closest("[data-role=\"stock-row\"]");
	if (!box || !row) return;
	if (box.querySelectorAll("[data-role=\"stock-row\"]").length <= 1) {
		toast("至少保留一個位置", "info");
		return;
	}
	row.remove();
}
/** Rebuild cabinet options after the cabinet list loads, preserving selected values. */
function refreshAddStockCabinetOptions() {
	document.querySelectorAll("#add-stock-rows [data-role=\"stock-cabinet\"]").forEach((select) => {
		select.innerHTML = _cabinetOptions(select.value);
	});
}
/**
* Validate add-modal location rows and build the POST /api/items stocks payload.
* Pure function (no DOM) so the rules can be tested directly.
* @param {Array<{cabinet: string, sub: string, qty: number, note: string}>} rows Parsed rows.
* @returns {{stocks: Array<{location: string, qty: number, note: string}>, error: string}}
*/
function buildAddStocks(rows) {
	const stocks = [];
	const seen = /* @__PURE__ */ new Set();
	for (let i = 0; i < rows.length; i += 1) {
		const r = rows[i];
		const cabinet = String(r.cabinet || "").trim();
		const sub = String(r.sub || "").trim();
		const note = String(r.note || "").trim();
		const qty = Number(r.qty || 0);
		if (!cabinet && !sub && !qty && !note) continue;
		if (!cabinet) return {
			stocks: [],
			error: `第 ${i + 1} 個位置請選擇櫃子`
		};
		const location = sub ? `${cabinet} | ${sub}` : cabinet;
		if (seen.has(location)) return {
			stocks: [],
			error: `位置「${location}」重複，請合併數量`
		};
		seen.add(location);
		stocks.push({
			location,
			qty,
			note
		});
	}
	if (!stocks.length) return {
		stocks: [],
		error: "位置必填（至少選櫃子）"
	};
	return {
		stocks,
		error: ""
	};
}
function _autoInferCategory() {
	var name = document.getElementById("f-name").value || "";
	var cat = "";
	if (/遙控|遙器|控制器|線控/.test(name)) cat = "遙控器";
	else if (/基板|控制板|PCB|電路/.test(name)) cat = "電子零件";
	else if (/線圈|接觸器|繼電器|開關|插座|斷路|跳脫/.test(name)) cat = "電氣配件";
	else if (/管|銅|鐵氟龍|配管/.test(name)) cat = "管材";
	else if (/劑|脂|膠|發泡|樹脂/.test(name)) cat = "化學品";
	else if (/濾|網|棉|濾網/.test(name)) cat = "過濾耗材";
	else if (/馬達|風扇|壓縮|軸流/.test(name)) cat = "動力設備";
	else if (/面板|蓋板|外殼|支架|固定/.test(name)) cat = "外觀/結構";
	if (cat) document.getElementById("f-category").value = cat;
}
function renderAddPhotoBox() {
	const box = document.getElementById("f-photo-box");
	if (!box) return;
	if (!hasPerm("photo")) {
		box.innerHTML = "<div class=\"photo-box-hint\">無照片上傳權限</div>";
		return;
	}
	box.innerHTML = `
    <div class="photo-box-hint">新增後可立即上傳照片</div>
    <div class="photo-actions">
      <label class="btn btn--secondary btn--md btn-prepare">📷 拍照
        <input type="file" accept="image/*" capture="environment" id="f-photo-input" style="display:none">
      </label>
      <label class="btn btn--secondary btn--md btn-prepare">🖼 從相簿選
        <input type="file" accept="image/*" id="f-photo-album" style="display:none">
      </label>
    </div>`;
	const cam = document.getElementById("f-photo-input");
	const album = document.getElementById("f-photo-album");
	cam.addEventListener("change", () => {
		if (cam.files[0]) album.value = "";
	});
	album.addEventListener("change", () => {
		if (album.files[0]) cam.value = "";
	});
}
async function submitAdd() {
	const name = document.getElementById("f-name").value.trim();
	if (!name) {
		toast("品項名稱必填", "error");
		return;
	}
	const brand = document.getElementById("f-brand").value.trim();
	const code = document.getElementById("f-code").value.trim();
	if (!brand) {
		toast("廠牌必填", "error");
		return;
	}
	if (!code) {
		toast("型號必填", "error");
		return;
	}
	const unit = document.getElementById("f-unit").value;
	const parsedRows = [];
	for (const row of document.querySelectorAll("#add-stock-rows [data-role=\"stock-row\"]")) {
		const qtyInput = row.querySelector("[data-role=\"stock-qty\"]");
		const qty = qtyInput.value.trim() === "" ? 0 : qtyInputOrToast(qtyInput, unit);
		if (typeof qty !== "number" || !isFinite(qty)) return;
		parsedRows.push({
			cabinet: row.querySelector("[data-role=\"stock-cabinet\"]").value,
			sub: row.querySelector("[data-role=\"stock-sub\"]").value,
			qty,
			note: row.querySelector("[data-role=\"stock-note\"]").value
		});
	}
	const built = buildAddStocks(parsedRows);
	if (built.error) {
		toast(built.error, "error");
		return;
	}
	const payload = {
		brand,
		code,
		name,
		unit,
		site: document.getElementById("f-site").value,
		category: document.getElementById("f-category").value,
		stocks: built.stocks
	};
	try {
		const newItemId = (await apiFetch("/api/items", {
			method: "POST",
			json: payload,
			fallback: "新增失敗"
		})).id;
		const photoInput = document.getElementById("f-photo-input");
		const albumInput = document.getElementById("f-photo-album");
		const chosenFile = photoInput && photoInput.files && photoInput.files[0] || albumInput && albumInput.files && albumInput.files[0];
		let photoMsg = "";
		if (chosenFile) try {
			const fd = new FormData();
			fd.append("file", chosenFile);
			await apiFetch(`/api/items/${newItemId}/photo`, {
				method: "POST",
				body: fd
			});
			photoMsg = "（含照片）";
		} catch {}
		toast(`✅ 已新增「${name}」${photoMsg}`, "success");
		closeModalForce("add-modal");
		[
			"f-brand",
			"f-code",
			"f-name"
		].forEach((id) => {
			document.getElementById(id).value = "";
		});
		resetAddStockRows();
		document.getElementById("f-category").value = "";
		fillUnitSelect(document.getElementById("f-unit"), "個");
		await loadData();
	} catch (e) {
		toast(e.status ? "⚠️ " + e.message : "新增失敗", "error");
	}
}
//#endregion
//#region static/js/features/kits/state.js
var state_exports$6 = /* @__PURE__ */ __exportAll({ kitsState: () => kitsState });
var kitsState = {
	kitModalCompRows: [],
	editingKitId: null,
	kitUpdatedAt: null,
	kitLocationRows: []
};
//#endregion
//#region static/js/features/kits/component-rows.js
var component_rows_exports = /* @__PURE__ */ __exportAll({
	filterKitSearch: () => filterKitSearch,
	kitCompQtyChanged: () => kitCompQtyChanged,
	openKitSearch: () => openKitSearch,
	pickKitItem: () => pickKitItem,
	renderKitCompRows: () => renderKitCompRows
});
function kitCompQtyChanged(idx, rawVal) {
	const row = kitsState.kitModalCompRows[idx];
	if (!row) return;
	const sel = row.item_id ? appState.ALL_ITEMS.find((i) => i.id == row.item_id) : null;
	const v = Qty.validFor(rawVal, sel ? Qty.inputTypeOf(sel.unit) : "fraction");
	if (!v.ok || v.value <= 0) {
		toast(v.error || "材料數量必須大於 0", "error");
		renderKitCompRows();
		return;
	}
	row.qty = v.value;
	renderKitCompRows();
}
function renderKitCompRows() {
	const wrap = document.getElementById("kit-comps");
	let html = "";
	if (!kitsState.kitModalCompRows.length) html = "<div class=\"kit-empty\">尚未加入材料</div>";
	else html = kitsState.kitModalCompRows.map((row, idx) => {
		const sel = row.item_id ? appState.ALL_ITEMS.find((i) => i.id == row.item_id) : null;
		return `<div class="selected-row">

        <div class="info">

          <div class="nm">${sel ? esc(sel.brand) + " " + esc(sel.name) : ""}</div>

          <div class="bd">${sel ? `${sel.code ? `型號 <span class="model">${esc(sel.code)}</span> ・ ` : ""}庫存 ${Qty.format(sel.qty, Qty.unitTypeOf(sel.unit))} ${esc(sel.unit || "個")}` : ""}</div>

        </div>

        <input type="text" inputmode="decimal" value="${row.qty || 1}" placeholder="例：1、0.5、1/4" onchange="Kits.kitCompQtyChanged(${idx}, this.value)">

        <button class="rm" onclick="Kits.removeKitCompRow(${idx})">✕</button>

      </div>`;
	}).join("");
	html += `<div class="mat-search" data-role="mat-search">

    <div class="input-wrap">

      <input type="text" id="kit-mat-input" placeholder="🔍 搜尋材料想加的（名稱/型號/廠牌）…" autocomplete="off"

        onfocus="Kits.openKitSearch()" oninput="Kits.filterKitSearch(this.value)">

      <span class="caret">▼</span>

    </div>

    <div class="kit-dropdown" data-role="kit-dropdown" id="kit-drop"></div>

  </div>`;
	wrap.innerHTML = html;
}
function openKitSearch() {
	filterKitSearch(document.getElementById("kit-mat-input").value);
}
function filterKitSearch(kw) {
	const drop = document.getElementById("kit-drop");
	const q = (kw || "").trim().toLowerCase();
	let list = appState.ALL_ITEMS.filter((i) => !i.is_kit);
	if (q) list = list.filter((i) => (i.brand + " " + i.name + " " + (i.code || "")).toLowerCase().includes(q));
	list = list.slice(0, 15);
	if (!list.length) drop.innerHTML = "<div class=\"kit-drop-empty\">找不到符合的材料</div>";
	else drop.innerHTML = list.map((it) => `

      <div class="kit-drop-opt" onclick="Kits.pickKitItem(${it.id})">

        <div><div class="nm">${esc(it.brand)} ${esc(it.name)}</div><div class="bd">${it.code ? `型號 <span class="model">${esc(it.code)}</span> ・ ` : ""}${esc(it.unit || "")}</div></div>

        <span class="stk">庫存 ${it.qty}</span>

      </div>`).join("");
	drop.classList.add("is-open");
}
function pickKitItem(itemId) {
	if (!appState.ALL_ITEMS.find((i) => i.id === itemId)) return;
	const exist = kitsState.kitModalCompRows.findIndex((r) => r.item_id == itemId);
	if (exist >= 0) kitsState.kitModalCompRows[exist].qty = (kitsState.kitModalCompRows[exist].qty || 1) + 1;
	else kitsState.kitModalCompRows.push({
		item_id: itemId,
		qty: 1
	});
	const input = document.getElementById("kit-mat-input");
	if (input) input.value = "";
	document.getElementById("kit-drop").classList.remove("is-open");
	renderKitCompRows();
	const ni = document.getElementById("kit-mat-input");
	if (ni) ni.focus();
}
//#endregion
//#region static/js/features/kits/kit-modal.js
var kit_modal_exports = /* @__PURE__ */ __exportAll({
	addKitCompRow: () => addKitCompRow,
	addKitLocationRow: () => addKitLocationRow,
	loadKitCabinetOptions: () => loadKitCabinetOptions,
	openKitModal: () => openKitModal,
	removeKitCompRow: () => removeKitCompRow,
	removeKitLocationRow: () => removeKitLocationRow,
	renderKitLocationRows: () => renderKitLocationRows,
	setKitSubmitBusy: () => setKitSubmitBusy,
	submitKit: () => submitKit,
	submitKitEdit: () => submitKitEdit
});
async function loadKitCabinetOptions() {
	try {
		appState.globalCabinetList = await apiFetch("/api/cabinets");
		syncKitLocationRowsFromDom();
		renderKitLocationRows();
	} catch (e) {
		console.warn("整組位置載入櫃子清單失敗", e);
	}
}
function openKitModal() {
	kitsState.editingKitId = null;
	kitsState.kitModalCompRows = [];
	kitsState.kitLocationRows = [];
	document.getElementById("k-name").value = "";
	document.getElementById("k-note").value = "";
	document.getElementById("k-brand").value = "";
	document.getElementById("k-code").value = "";
	document.getElementById("k-site").value = "office";
	document.querySelector("#kit-modal h3").textContent = "🔧 新增整組";
	const btn = document.getElementById("kit-submit");
	btn.textContent = "✅ 建立整組";
	btn.setAttribute("onclick", "Kits.submitKit()");
	renderKitCompRows();
	renderKitLocationRows();
	loadKitCabinetOptions();
	renderKitPhotoBox(null, null, false);
	openModal("kit-modal");
}
function addKitCompRow() {
	const input = document.getElementById("kit-mat-input");
	if (input) input.focus();
}
function removeKitCompRow(idx) {
	kitsState.kitModalCompRows.splice(idx, 1);
	renderKitCompRows();
}
function setKitSubmitBusy(isBusy) {
	const btn = document.getElementById("kit-submit");
	if (!btn) return;
	btn.disabled = isBusy;
	btn.setAttribute("aria-busy", String(isBusy));
}
async function submitKit() {
	if (document.getElementById("kit-submit")?.disabled) return;
	const name = document.getElementById("k-name").value.trim();
	const brand = document.getElementById("k-brand").value.trim();
	const code = document.getElementById("k-code").value.trim();
	if (!name) {
		toast("請輸入整組名稱", "error");
		return;
	}
	const items = kitsState.kitModalCompRows.filter((r) => r.item_id && r.qty > 0).map((r) => ({
		item_id: parseInt(r.item_id),
		qty: r.qty
	}));
	if (!items.length) {
		toast("請至少加入一個材料", "error");
		return;
	}
	const locations = getKitLocations();
	setKitSubmitBusy(true);
	try {
		const data = await apiFetch("/api/kits", {
			method: "POST",
			json: {
				name,
				brand,
				code,
				site: appState.currentSite,
				items,
				locations,
				note: document.getElementById("k-note").value.trim()
			},
			fallback: "新增失敗"
		});
		const kitId = data.id;
		closeModalForce("kit-modal");
		toast(`✅ 已新增整組「${data.name || name}」｜品牌：${data.brand || "未填寫"}｜型號：${data.code || "未填寫"}`, "success");
		_uploadKitPhotoAsync(kitId);
		await loadData();
	} catch (e) {
		toast("⚠️ " + e.message, "error");
	} finally {
		setKitSubmitBusy(false);
	}
}
function _uploadKitPhotoAsync(kitId) {
	const photoInput = document.getElementById("k-photo-input");
	const albumInput = document.getElementById("k-photo-album");
	const chosenFile = photoInput && photoInput.files && photoInput.files[0] || albumInput && albumInput.files && albumInput.files[0];
	if (!chosenFile) return;
	const fd = new FormData();
	fd.append("file", chosenFile);
	apiFetch(`/api/kits/${kitId}/photo`, {
		method: "POST",
		body: fd
	}).then(() => {
		toast("📷 整組照片已上傳", "info");
		setTimeout(() => loadData({ full: false }), 500);
	}).catch((e) => {
		console.warn("整組照片上傳失敗:", e.message);
		toast(e.status ? "⚠️ 照片上傳失敗，請重試" : "⚠️ 照片上傳出錯", "error");
	});
}
async function submitKitEdit() {
	if (document.getElementById("kit-submit")?.disabled) return;
	const name = document.getElementById("k-name").value.trim();
	const brand = document.getElementById("k-brand").value.trim();
	const code = document.getElementById("k-code").value.trim();
	if (!name) {
		toast("請輸入整組名稱", "error");
		return;
	}
	const items = kitsState.kitModalCompRows.filter((r) => r.item_id && r.qty > 0).map((r) => ({
		item_id: parseInt(r.item_id),
		qty: r.qty
	}));
	if (!items.length) {
		toast("請至少加入一個材料", "error");
		return;
	}
	if (!kitsState.editingKitId) {
		toast("編輯目標遺失，請重開", "error");
		return;
	}
	const locations = getKitLocations();
	setKitSubmitBusy(true);
	try {
		const saved = await apiFetch(`/api/kits/${kitsState.editingKitId}`, {
			method: "PUT",
			json: {
				name,
				brand,
				code,
				items,
				locations,
				note: document.getElementById("k-note").value.trim(),
				updated_at: kitsState.kitUpdatedAt
			},
			fallback: "儲存失敗"
		});
		closeModalForce("kit-modal");
		toast("✅ 已更新整組「" + saved.name + "」｜品牌：" + (saved.brand || "未填寫") + "｜型號：" + (saved.code || "未填寫"), "success");
		_uploadKitPhotoAsync(kitsState.editingKitId);
		setTimeout(() => {
			loadData({ full: true });
		}, 600);
	} catch (e) {
		toast("⚠️ " + e.message, "error");
	} finally {
		setKitSubmitBusy(false);
	}
}
/**
* Render the Kit location display-metadata rows.
* @returns {void} Updates the location-row container when it exists.
*/
function renderKitLocationRows() {
	const container = document.getElementById("kit-location-rows");
	if (!container) return;
	container.innerHTML = kitsState.kitLocationRows.map((row, idx) => `
    <div class="edit-stock-row" data-role="kit-location-row" data-idx="${idx}">
      <select class="kit-loc-cabinet" data-role="kit-loc-cabinet">${_cabinetOptions(row.cabinet || "")}</select>
      <input type="text" class="kit-loc-pos" data-role="kit-loc-pos" value="${esc(row.position || "")}" placeholder="1-1" list="location-list">
      <input type="text" class="kit-loc-note" data-role="kit-loc-note" value="${esc(row.note || "")}" placeholder="（可選）">
      <button type="button" class="btn-remove" onclick="Kits.removeKitLocationRow(${idx})">🗑</button>
    </div>
  `).join("");
}
/**
* Append one empty Kit location metadata row.
* @returns {void} Renders the updated row list.
*/
function addKitLocationRow() {
	syncKitLocationRowsFromDom();
	kitsState.kitLocationRows.push({
		cabinet: "",
		position: "",
		note: ""
	});
	renderKitLocationRows();
}
function removeKitLocationRow(idx) {
	syncKitLocationRowsFromDom();
	kitsState.kitLocationRows.splice(idx, 1);
	renderKitLocationRows();
}
/**
* Copy the currently rendered row values back into kitLocationRows (keeps blank rows).
* @returns {void}
*/
function syncKitLocationRowsFromDom() {
	const rows = document.querySelectorAll("#kit-location-rows [data-role=\"kit-location-row\"]");
	if (!rows.length) return;
	kitsState.kitLocationRows = Array.from(rows).map((row) => ({
		cabinet: row.querySelector("[data-role=\"kit-loc-cabinet\"]").value.trim(),
		position: row.querySelector("[data-role=\"kit-loc-pos\"]").value.trim(),
		note: row.querySelector("[data-role=\"kit-loc-note\"]").value.trim()
	}));
}
/**
* Collect Kit display metadata for the create/update request.
* @returns {Array<{cabinet: string, position: string, note: string}>} Non-empty metadata rows.
*/
function getKitLocations() {
	const rows = document.querySelectorAll("#kit-location-rows [data-role=\"kit-location-row\"]");
	return Array.from(rows).map((row) => ({
		cabinet: row.querySelector("[data-role=\"kit-loc-cabinet\"]").value.trim(),
		position: row.querySelector("[data-role=\"kit-loc-pos\"]").value.trim(),
		note: row.querySelector("[data-role=\"kit-loc-note\"]").value.trim()
	})).filter((r) => r.cabinet || r.position);
}
//#endregion
//#region static/js/features/inventory/filters.js
var filters_exports = /* @__PURE__ */ __exportAll({
	buildFilterPanel: () => buildFilterPanel,
	clearFilterPanel: () => clearFilterPanel,
	getFilteredInventoryItems: () => getFilteredInventoryItems,
	getInventoryFilterKeywords: () => getInventoryFilterKeywords,
	initInventoryFilters: () => initInventoryFilters,
	inventoryItemMatchesCurrentFilters: () => inventoryItemMatchesCurrentFilters,
	toggleFilterCollapse: () => toggleFilterCollapse,
	toggleInventoryBrand: () => toggleInventoryBrand,
	toggleInventoryCategory: () => toggleInventoryCategory
});
function getInventoryFilterKeywords() {
	const searchInput = document.getElementById("search-input");
	const raw = searchInput ? searchInput.value.trim().toLowerCase() : "";
	return raw ? raw.split(/\s+/).filter(function(w) {
		return w.length > 0;
	}) : [];
}
function inventoryItemMatchesCurrentFilters(item, keywords) {
	if (item.is_kit) return false;
	if (typeof appState.currentSite !== "undefined" && item.site && item.site !== appState.currentSite) return false;
	if (appState.currentBrands.length > 0 && appState.currentBrands.indexOf(item.brand || "無廠牌") < 0) return false;
	if (appState.currentCategories.length > 0 && appState.currentCategories.indexOf(item.category || "") < 0) return false;
	if (keywords.length > 0) {
		const stockStr = (item.stocks || []).map(function(s) {
			return s.location + " " + s.note;
		}).join(" ").toLowerCase();
		let hay = (item.name || "") + " " + (item.code || "") + " " + (item.brand || "") + " " + stockStr;
		hay = hay.toLowerCase();
		if (!keywords.every(function(keyword) {
			return hay.indexOf(keyword) >= 0;
		})) return false;
	}
	return true;
}
function getFilteredInventoryItems() {
	const keywords = getInventoryFilterKeywords();
	return appState.ALL_ITEMS.filter(function(item) {
		return inventoryItemMatchesCurrentFilters(item, keywords);
	});
}
var filterExpandedState = {
	brand: false,
	category: false
};
/**
* 根據容器寬度動態計算可顯示的 chips 個數（含「全部」）。
* 每個 chip 估算寬度 ~90px（含間距），根據容器實際寬度決定截斷。
* 如果容器寬度為 0（尚未渲染或隱藏），回傳一個合理的預設值。
*/
function calculateVisibleChipsCount(containerId) {
	var el = document.getElementById(containerId);
	if (!el) return 999;
	var containerWidth = el.offsetWidth;
	if (containerWidth <= 0) containerWidth = window.innerWidth * .8;
	return Math.max(1, Math.floor(containerWidth / 90));
}
function buildFilterPanel() {
	var brandChipsEl = document.getElementById("fp-brand-chips");
	var catChipsEl = document.getElementById("fp-cat-chips");
	if (!brandChipsEl || !catChipsEl) return;
	try {
		var brandCounts = appState.INVENTORY_FACETS && appState.INVENTORY_FACETS.brands && Object.keys(appState.INVENTORY_FACETS.brands).length ? appState.INVENTORY_FACETS.brands : {};
		if (!Object.keys(brandCounts).length) appState.ALL_ITEMS.filter(function(i) {
			return !i.is_kit;
		}).forEach(function(i) {
			var b = i.brand || "無廠牌";
			brandCounts[b] = (brandCounts[b] || 0) + 1;
		});
		var brands = Object.entries(brandCounts).sort(function(a, b) {
			return b[1] - a[1];
		});
		document.getElementById("fp-brand-count").textContent = "(" + brands.length + " 個品牌)";
		renderFilterChips("fp-brand-chips", brands, appState.currentBrands, "brand", "fp-brand-toggle");
		var catCounts = appState.INVENTORY_FACETS && appState.INVENTORY_FACETS.categories && Object.keys(appState.INVENTORY_FACETS.categories).length ? appState.INVENTORY_FACETS.categories : {};
		if (!Object.keys(catCounts).length) appState.ALL_ITEMS.filter(function(i) {
			return !i.is_kit;
		}).forEach(function(i) {
			var c = i.category || "";
			if (c) catCounts[c] = (catCounts[c] || 0) + 1;
		});
		var cats = Object.entries(catCounts).sort(function(a, b) {
			return b[1] - a[1];
		});
		document.getElementById("fp-cat-count").textContent = "(" + cats.length + " 類)";
		renderFilterChips("fp-cat-chips", cats, appState.currentCategories, "category", "fp-cat-toggle");
		var list = getFilteredItems();
		document.getElementById("fp-summary").textContent = "共 " + (appState.INVENTORY_META.total || list.length) + " 項";
	} catch (e) {
		console.warn("buildFilterPanel error:", e.message);
	}
}
/**
* 渲染篩選 chips，根據容器寬度動態決定是否截斷。
* @param {string} containerId - 容器元素 ID
* @param {Array} counts - [名稱, 計數] 的陣列
* @param {Array} selectedArr - 目前選中的值陣列
* @param {string} type - 篩選類型（'brand' 或 'category'）
* @param {string} toggleBtnId - 展開/收合按鈕 ID
*/
function renderFilterChips(containerId, counts, selectedArr, type, toggleBtnId) {
	var el = document.getElementById(containerId);
	if (!el) return;
	el.innerHTML = "";
	el.classList.toggle("is-collapsed", !filterExpandedState[type]);
	var allChip = document.createElement("span");
	allChip.className = "chip filter-chip" + (selectedArr.length === 0 ? " is-active" : "");
	allChip.textContent = "全部";
	allChip.onclick = function() {
		selectedArr.length = 0;
		loadInventoryPage(1);
	};
	el.appendChild(allChip);
	var isCollapsed = el.classList.contains("is-collapsed");
	var visibleCount = calculateVisibleChipsCount(containerId);
	var canDisplayAll = visibleCount >= counts.length + 1;
	var shouldDisplayAll = canDisplayAll || !isCollapsed;
	var chipsAdded = 1;
	counts.forEach(function(pair) {
		if (!shouldDisplayAll && chipsAdded >= visibleCount) return;
		var name = pair[0], count = pair[1];
		var chip = document.createElement("span");
		chip.className = "chip filter-chip" + (selectedArr.includes(name) ? " is-active" : "");
		chip.innerHTML = esc(name) + " <span class=\"badge\">" + count + "</span>";
		chip.onclick = function() {
			var idx = selectedArr.indexOf(name);
			if (idx >= 0) selectedArr.splice(idx, 1);
			else selectedArr.push(name);
			loadInventoryPage(1);
		};
		el.appendChild(chip);
		chipsAdded++;
	});
	if (toggleBtnId) {
		var btn = document.getElementById(toggleBtnId);
		if (btn) {
			if (canDisplayAll) btn.classList.add("hidden");
			else {
				btn.classList.remove("hidden");
				var hidden = counts.length - (visibleCount - 1);
				if (hidden > 0 && isCollapsed) btn.textContent = "還有 " + hidden + " 個" + (type === "brand" ? "品牌" : "分類") + " ▼";
				else btn.textContent = isCollapsed ? "展開 ▼" : "收合 ▲";
			}
		}
	}
}
function getFilteredItems() {
	var raw = document.getElementById("search-input").value.trim().toLowerCase();
	var kws = raw ? raw.split(/\s+/).filter(function(w) {
		return w.length > 0;
	}) : [];
	var list = appState.ALL_ITEMS.filter(function(i) {
		return !i.is_kit;
	});
	if (appState.currentBrands.length > 0) list = list.filter(function(i) {
		return appState.currentBrands.includes(i.brand || "無廠牌");
	});
	if (appState.currentCategories.length > 0) list = list.filter(function(i) {
		return appState.currentCategories.includes(i.category || "");
	});
	if (kws.length > 0) list = list.filter(function(i) {
		var stockStr = (i.stocks || []).map(function(s) {
			return s.location + " " + s.note;
		}).join(" ").toLowerCase();
		var hay = ((i.name || "") + " " + (i.code || "") + " " + (i.brand || "") + " " + stockStr).toLowerCase();
		return kws.every(function(kw) {
			return hay.indexOf(kw) >= 0;
		});
	});
	return list;
}
function toggleFilterCollapse(containerId, toggleBtnId) {
	var el = document.getElementById(containerId);
	document.getElementById(toggleBtnId);
	var isCollapsed = el.classList.toggle("is-collapsed");
	var filterType = containerId === "fp-brand-chips" ? "brand" : "category";
	filterExpandedState[filterType] = !isCollapsed;
	buildFilterPanel();
}
function clearFilterPanel() {
	appState.currentBrands.length = 0;
	appState.currentCategories.length = 0;
	document.getElementById("search-input").value = "";
	loadInventoryPage(1);
}
function toggleInventoryBrand(brand) {
	if (!brand) appState.currentBrands = [];
	else {
		var idx = appState.currentBrands.indexOf(brand);
		if (idx >= 0) appState.currentBrands.splice(idx, 1);
		else appState.currentBrands.push(brand);
	}
	loadInventoryPage(1);
}
function toggleInventoryCategory(cat) {
	if (!cat) appState.currentCategories = [];
	else {
		var idx = appState.currentCategories.indexOf(cat);
		if (idx >= 0) appState.currentCategories.splice(idx, 1);
		else appState.currentCategories.push(cat);
	}
	loadInventoryPage(1);
}
var filterPanelResizeTimer = null;
function initInventoryFilters() {
	if (typeof window !== "undefined") window.addEventListener("resize", function() {
		clearTimeout(filterPanelResizeTimer);
		filterPanelResizeTimer = setTimeout(function() {
			var brandEl = document.getElementById("fp-brand-chips");
			var catEl = document.getElementById("fp-cat-chips");
			if (brandEl || catEl) buildFilterPanel();
		}, 300);
	});
}
//#endregion
//#region static/js/components/status-list.js
var status_list_exports = /* @__PURE__ */ __exportAll({
	clearSharedStatusListModal: () => clearSharedStatusListModal,
	openSharedStatusListModal: () => openSharedStatusListModal,
	renderSharedProductStatusItem: () => renderSharedProductStatusItem,
	setSharedStatusListContext: () => setSharedStatusListContext,
	setSharedStatusListLocation: () => setSharedStatusListLocation,
	setSharedStatusListSearch: () => setSharedStatusListSearch,
	statusListFormatQuantity: () => statusListFormatQuantity,
	statusListLocations: () => statusListLocations
});
function statusListFormatQuantity(value, unit) {
	if (unit) return Qty.format(value, Qty.unitTypeOf(unit));
	const number = Number(value);
	if (!Number.isFinite(number)) return "0";
	return (Math.round(number * 1e3) / 1e3).toLocaleString("en-US");
}
function statusListLocations(item) {
	const locations = (Array.isArray(item && item.stocks) ? item.stocks : []).map(function(stock) {
		return stock.location || "未標示";
	}).filter(Boolean);
	if (locations.length) return [...new Set(locations)];
	return item && item.location ? [item.location] : ["未標示"];
}
function statusListFilteredItems() {
	const state = typeof appState.STATUS_LIST_CONTEXT !== "undefined" ? appState.STATUS_LIST_CONTEXT : null;
	if (!state) return [];
	const query = String(state.search || "").trim().toLowerCase();
	return state.items.filter(function(item) {
		const text = state.getSearchText ? state.getSearchText(item) : "";
		const matchesSearch = !query || String(text || "").toLowerCase().includes(query);
		const matchesLocation = !state.location || statusListLocations(item).includes(state.location);
		return matchesSearch && matchesLocation;
	});
}
function renderSharedStatusListModal() {
	const state = typeof appState.STATUS_LIST_CONTEXT !== "undefined" ? appState.STATUS_LIST_CONTEXT : null;
	const body = document.getElementById("inventory-status-modal-body");
	if (!state || !body) return;
	const items = statusListFilteredItems();
	const locations = [...new Set(state.items.reduce(function(all, item) {
		return all.concat(statusListLocations(item));
	}, []))].sort();
	const countText = items.length === state.items.length ? `共 ${items.length} 項` : `顯示 ${items.length} / ${state.items.length} 項`;
	const locationFilter = locations.length > 1 ? `<label class="status-list-location">位置
      <select onchange="Components.setSharedStatusListLocation(this.value)">
        <option value="">全部位置</option>
        ${locations.map(function(location) {
		const selected = state.location === location ? " selected" : "";
		return `<option value="${esc(location)}"${selected}>${esc(location)}</option>`;
	}).join("")}
      </select>
    </label>` : "";
	const rows = items.length ? items.map(function(item) {
		return state.renderItem(item);
	}).join("") : `<div class="inventory-status-empty status-list-empty"><span aria-hidden="true">✓</span><strong>${esc(state.emptyText)}</strong><p>${esc(state.emptyIntro)}</p></div>`;
	const columnHeadings = (state.columnLabels || [
		"照片",
		"品項名稱 / 型號",
		"位置",
		"庫存 / 狀態",
		"操作"
	]).map(function(label) {
		return `<span>${esc(label)}</span>`;
	}).join("");
	body.innerHTML = `<div class="inventory-status-header status-list-header ${esc(state.headerClass || "")}">
    <div><h2 id="inventory-status-modal-title">${esc(state.title)}</h2><p>${esc(state.intro)}</p></div>
    <div class="status-list-header-actions"><strong>${esc(countText)}</strong><button type="button" class="inventory-status-close" onclick="Inventory.closeInventoryStatusModal()" aria-label="關閉">✕</button></div>
  </div>
  <div class="status-list-toolbar">
    <label class="status-list-search">搜尋
      <input type="search" value="${esc(state.search || "")}" placeholder="${esc(state.searchPlaceholder || "搜尋品項名稱、型號或位置…")}" oninput="Components.setSharedStatusListSearch(this.value)">
    </label>
    ${locationFilter}
  </div>
  <div class="status-list-column-headings">${columnHeadings}</div>
  <div class="inventory-status-list status-list-table">${rows}</div>`;
}
function setSharedStatusListContext(config) {
	appState.STATUS_LIST_CONTEXT = Object.assign({
		items: [],
		search: "",
		location: "",
		emptyText: "目前沒有符合的品項",
		emptyIntro: "目前條件下沒有符合的清單項目。",
		searchPlaceholder: "搜尋品項名稱、型號或位置…",
		getSearchText: function(item) {
			return [
				item.name,
				item.brand,
				item.code,
				item.location
			].join(" ");
		},
		renderItem: function() {
			return "";
		}
	}, config, { items: Array.isArray(config.items) ? config.items.slice() : [] });
	renderSharedStatusListModal();
}
function openSharedStatusListModal(config) {
	const modal = document.getElementById("inventory-status-modal");
	if (!modal) return;
	setSharedStatusListContext(config);
	modal.classList.add("is-open");
	modal.setAttribute("aria-hidden", "false");
}
function setSharedStatusListSearch(value) {
	if (!appState.STATUS_LIST_CONTEXT) return;
	appState.STATUS_LIST_CONTEXT.search = value || "";
	renderSharedStatusListModal();
}
function setSharedStatusListLocation(value) {
	if (!appState.STATUS_LIST_CONTEXT) return;
	appState.STATUS_LIST_CONTEXT.location = value || "";
	renderSharedStatusListModal();
}
function clearSharedStatusListModal() {
	appState.STATUS_LIST_CONTEXT = null;
}
function renderSharedProductStatusItem(item, options) {
	const config = options || {};
	const status = config.status;
	const isOut = (config.statusType || (status.isOutOfStock ? "out" : "low")) === "out" || status.isOutOfStock;
	const badgeClass = isOut ? "status-out" : "status-low";
	const badgeText = isOut ? "⛔ 缺貨" : "⚠ 低庫存";
	const itemId = Number(item.id);
	const editAction = config.editable && Number.isInteger(itemId) && hasPerm("item-mgmt") ? `<button type="button" class="btn btn--secondary btn--sm inventory-status-edit" onclick="Inventory.closeInventoryStatusModal();Inventory.openEditModal(${itemId})">編輯</button>` : "";
	const locations = statusListLocations(item).join("、");
	const threshold = !isOut && item.low_stock > 0 ? `<span class="inventory-status-meta">警示值 ${esc(statusListFormatQuantity(item.low_stock, item.unit))}</span>` : "";
	return `<article class="inventory-status-item status-list-mobile-row ${esc(isOut ? "is-out" : "is-low")}">
    <div class="inventory-status-thumb">${buildThumb(item.id, item.has_photo, item.name, "📦", item.thumbnail_url)}</div>
    <div class="inventory-status-info">
      <div class="inventory-status-name">${esc(item.brand || "無廠牌")} ${esc(item.name || "未命名")}</div>
      <div class="inventory-status-sub">${esc(item.code ? "型號： " + item.code : "")}</div>
      ${config.extraHTML || ""}
    </div>
    <div class="inventory-status-location status-list-location-cell">📍 ${esc(locations)}</div>
    <div class="inventory-status-values">
      <span class="inventory-status-badge ${esc(badgeClass)}">${esc(badgeText)}</span>
      <strong>${esc(statusListFormatQuantity(status.qty, item.unit))} <small>${esc(item.unit || "")}</small></strong>
      ${threshold}
    </div>
    ${editAction}
  </article>`;
}
//#endregion
//#region static/js/features/inventory/state.js
var state_exports$5 = /* @__PURE__ */ __exportAll({ inventoryState: () => inventoryState });
var inventoryState = {
	stockLocationPickerState: null,
	inventoryStatusGuard: createRequestGuard(),
	inventoryStatusModalType: "",
	savingAll: false
};
//#endregion
//#region static/js/features/inventory/status.js
var status_exports$1 = /* @__PURE__ */ __exportAll({
	closeInventoryStatusModal: () => closeInventoryStatusModal,
	getInventoryDashboardStats: () => getInventoryDashboardStats,
	getInventoryStatus: () => getInventoryStatus,
	rememberInventoryAlertItem: () => rememberInventoryAlertItem,
	renderInventoryDashboard: () => renderInventoryDashboard,
	showInventoryStatusList: () => showInventoryStatusList
});
function getInventoryDisplayQty(item) {
	const delta = pending[item.id] || 0;
	return Math.round((Number(item.qty || 0) + Number(delta)) * 1e3) / 1e3;
}
function getInventoryStatusForQty(item, qty) {
	const normalizedQty = Math.round(Number(qty || 0) * 1e3) / 1e3;
	const isOutOfStock = !item.is_kit && normalizedQty <= 0;
	return {
		qty: normalizedQty,
		isOutOfStock,
		isLowStock: !isOutOfStock && item.low_stock > 0 && normalizedQty <= item.low_stock
	};
}
function getInventoryStatus(item) {
	return getInventoryStatusForQty(item, getInventoryDisplayQty(item));
}
function getInventoryDashboardStats(list, aggregateStats) {
	const items = Array.isArray(list) ? list : [];
	const fallbackZeroItems = items.filter(function(item) {
		return getInventoryStatus(item).isOutOfStock;
	});
	const fallbackLowItems = items.filter(function(item) {
		return getInventoryStatus(item).isLowStock;
	});
	const fallback = {
		itemCount: items.length,
		totalQty: items.reduce(function(sum, item) {
			return sum + getInventoryDisplayQty(item);
		}, 0),
		lowCount: fallbackLowItems.length,
		zeroCount: fallbackZeroItems.length,
		lowItems: fallbackLowItems,
		zeroItems: fallbackZeroItems
	};
	const aggregate = aggregateStats && typeof aggregateStats === "object" ? aggregateStats : null;
	if (!(aggregate && Number.isFinite(Number(aggregate.item_count)) && Number.isFinite(Number(aggregate.total_qty)) && Number.isFinite(Number(aggregate.low_stock)) && Number.isFinite(Number(aggregate.zero_stock)))) return fallback;
	const dashboard = {
		itemCount: Number(aggregate.item_count),
		totalQty: Number(aggregate.total_qty),
		lowCount: Number(aggregate.low_stock),
		zeroCount: Number(aggregate.zero_stock),
		lowItems: Array.isArray(aggregate.low_items) ? aggregate.low_items.slice() : fallbackLowItems.slice(),
		zeroItems: Array.isArray(aggregate.zero_items) ? aggregate.zero_items.slice() : fallbackZeroItems.slice()
	};
	const currentItems = new Map(items.map(function(item) {
		return [String(item.id), item];
	}));
	const savedPendingItems = INVENTORY_PENDING_ITEMS;
	const filterKeywords = getInventoryFilterKeywords();
	Object.keys(pending).forEach(function(id) {
		const item = currentItems.get(String(id)) || savedPendingItems[id];
		if (!item || !inventoryItemMatchesCurrentFilters(item, filterKeywords)) return;
		const before = getInventoryStatusForQty(item, item.qty);
		const after = getInventoryStatus(item);
		dashboard.totalQty += after.qty - before.qty;
		if (before.isLowStock !== after.isLowStock) dashboard.lowCount += after.isLowStock ? 1 : -1;
		if (before.isOutOfStock !== after.isOutOfStock) dashboard.zeroCount += after.isOutOfStock ? 1 : -1;
		const replaceCurrentItem = function(source, statusKey) {
			const next = source.filter(function(candidate) {
				return String(candidate.id) !== String(item.id);
			});
			if (after[statusKey]) next.push(item);
			return next;
		};
		dashboard.lowItems = replaceCurrentItem(dashboard.lowItems, "isLowStock");
		dashboard.zeroItems = replaceCurrentItem(dashboard.zeroItems, "isOutOfStock");
	});
	return dashboard;
}
function formatInventoryQuantity(value) {
	const n = Number(value);
	if (!isFinite(n)) return "0";
	return (Math.round(n * 1e3) / 1e3).toLocaleString("en-US");
}
function renderInventoryDashboard(list, aggregateStats) {
	const dashboard = getInventoryDashboardStats(list, aggregateStats);
	const totalQty = dashboard.totalQty;
	const lowCount = dashboard.lowCount;
	const zeroCount = dashboard.zeroCount;
	return `<section class="inventory-kpi-grid ui-kpi-grid" aria-label="庫存統計">
    <div class="inventory-kpi-card ui-kpi-card ui-kpi-card--blue">
      <span class="inventory-kpi-icon ui-kpi-icon" aria-hidden="true">📦</span>
      <div class="ui-kpi-body"><div class="inventory-kpi-label ui-kpi-label">篩選品項</div><div class="inventory-kpi-number ui-kpi-value">${esc(String(dashboard.itemCount))}</div><span class="ui-kpi-meta">目前篩選結果</span></div>
    </div>
    <div class="inventory-kpi-card ui-kpi-card ui-kpi-card--purple">
      <span class="inventory-kpi-icon ui-kpi-icon" aria-hidden="true">🗄️</span>
      <div class="ui-kpi-body"><div class="inventory-kpi-label ui-kpi-label">庫存總數</div><div class="inventory-kpi-number ui-kpi-value">${esc(formatInventoryQuantity(totalQty))}</div><span class="ui-kpi-meta">目前篩選結果合計</span></div>
    </div>
    <button type="button" class="inventory-kpi-card ui-kpi-card ui-kpi-card--amber inventory-kpi-low" onclick="Inventory.showInventoryStatusList('low')" aria-label="查看低庫存商品">
      <span class="inventory-kpi-icon ui-kpi-icon" aria-hidden="true">⚠</span>
      <div class="ui-kpi-body"><div class="inventory-kpi-label ui-kpi-label">低庫存</div><div class="inventory-kpi-number ui-kpi-value">${esc(String(lowCount))}</div><span class="ui-kpi-meta">低於警示值 · <span class="inventory-kpi-action">查看清單</span></span></div>
    </button>
    <button type="button" class="inventory-kpi-card ui-kpi-card ui-kpi-card--red inventory-kpi-out" onclick="Inventory.showInventoryStatusList('out')" aria-label="查看缺貨商品">
      <span class="inventory-kpi-icon ui-kpi-icon" aria-hidden="true">⛔</span>
      <div class="ui-kpi-body"><div class="inventory-kpi-label ui-kpi-label">缺貨</div><div class="inventory-kpi-number ui-kpi-value">${esc(String(zeroCount))}</div><span class="ui-kpi-meta">數量為 0 · <span class="inventory-kpi-action">查看清單</span></span></div>
    </button>
  </section>`;
}
function getInventoryStatusItems(type) {
	const isLow = type === "low";
	const dashboard = getInventoryDashboardStats(getFilteredInventoryItems(), typeof appState.INVENTORY_META !== "undefined" ? appState.INVENTORY_META.stats : null);
	return (isLow ? dashboard.lowItems : dashboard.zeroItems).slice().sort(function(a, b) {
		return getInventoryStatus(a).qty - getInventoryStatus(b).qty;
	});
}
function getInventoryFilterStateKey() {
	const search = document.getElementById("search-input");
	const brands = typeof appState.currentBrands !== "undefined" ? appState.currentBrands : [];
	const categories = typeof appState.currentCategories !== "undefined" ? appState.currentCategories : [];
	return JSON.stringify([
		typeof appState.currentSite !== "undefined" ? appState.currentSite : "",
		search ? search.value.trim() : "",
		brands,
		categories
	]);
}
function buildInventoryAlertParams() {
	const params = new URLSearchParams({
		site: appState.currentSite,
		page: "1",
		page_size: "1",
		sort: "brand",
		include_alert_items: "1"
	});
	const search = document.getElementById("search-input");
	if (search && search.value.trim()) params.set("search", search.value.trim());
	if (appState.currentBrands.length) params.set("brands", appState.currentBrands.join(","));
	if (appState.currentCategories.length) params.set("categories", appState.currentCategories.join(","));
	return params;
}
async function loadInventoryAlertItems(type, requestId) {
	const siteAtRequest = appState.currentSite;
	const filterKeyAtRequest = getInventoryFilterStateKey();
	const body = await apiFetch(`/api/items?${buildInventoryAlertParams()}`);
	if (siteAtRequest !== appState.currentSite || filterKeyAtRequest !== getInventoryFilterStateKey() || requestId !== void 0 && !inventoryState.inventoryStatusGuard.isCurrent(requestId)) return null;
	const stats = body.stats || {};
	if (!Array.isArray(stats.zero_items) || !Array.isArray(stats.low_items)) throw new Error("庫存警示清單回應格式錯誤");
	const mergedStats = Object.assign({}, stats, {
		zero_items: stats.zero_items,
		low_items: stats.low_items
	});
	const adjustedStats = getInventoryDashboardStats(getFilteredInventoryItems(), mergedStats);
	if (typeof appState.INVENTORY_META !== "undefined") appState.INVENTORY_META.stats = Object.assign({}, mergedStats, {
		zero_items: adjustedStats.zeroItems,
		low_items: adjustedStats.lowItems
	});
	return (type === "low" ? adjustedStats.lowItems : adjustedStats.zeroItems).slice();
}
function rememberInventoryAlertItem(item) {
	if (!item || item.id === void 0) return;
	INVENTORY_ALERT_ITEMS[String(item.id)] = item;
}
function renderInventoryStatusItem(item, type) {
	rememberInventoryAlertItem(item);
	return renderSharedProductStatusItem(item, {
		status: getInventoryStatus(item),
		statusType: type,
		editable: true
	});
}
function renderInventoryStatusModal(type, items) {
	const isLow = type === "low";
	setSharedStatusListContext({
		title: isLow ? "⚠ 低庫存商品" : "⛔ 缺貨商品",
		intro: isLow ? "庫存數量已低於或等於目前警示值。" : "目前庫存為 0 或以下的單一庫存品項。",
		headerClass: isLow ? "is-low" : "is-out",
		items,
		emptyText: isLow ? "目前沒有低庫存商品" : "目前沒有缺貨商品",
		emptyIntro: "目前篩選條件下沒有符合的品項。",
		getSearchText: function(item) {
			return [
				item.name,
				item.brand,
				item.code,
				statusListLocations(item).join(" ")
			].join(" ");
		},
		renderItem: function(item) {
			return renderInventoryStatusItem(item, type);
		}
	});
}
function isInventoryStatusRequestCurrent(requestId, modal, type) {
	const isOpen = modal && modal.classList && typeof modal.classList.contains === "function" ? modal.classList.contains("is-open") : true;
	return inventoryState.inventoryStatusGuard.isCurrent(requestId) && inventoryState.inventoryStatusModalType === type && isOpen;
}
async function showInventoryStatusList(type) {
	const modal = document.getElementById("inventory-status-modal");
	const body = document.getElementById("inventory-status-modal-body");
	if (!modal || !body) return;
	const requestId = inventoryState.inventoryStatusGuard.next();
	inventoryState.inventoryStatusModalType = type;
	let items = getInventoryStatusItems(type);
	const stats = typeof appState.INVENTORY_META !== "undefined" ? appState.INVENTORY_META.stats : null;
	const hasAlertItems = stats && Array.isArray(stats.zero_items) && Array.isArray(stats.low_items);
	modal.classList.add("is-open");
	modal.setAttribute("aria-hidden", "false");
	if (!hasAlertItems) {
		body.innerHTML = "<div class=\"inventory-status-loading\">載入完整警示清單…</div>";
		try {
			const loaded = await loadInventoryAlertItems(type, requestId);
			if (!loaded || !isInventoryStatusRequestCurrent(requestId, modal, type)) return;
			items = loaded.sort(function(a, b) {
				return getInventoryStatus(a).qty - getInventoryStatus(b).qty;
			});
		} catch (e) {
			if (!isInventoryStatusRequestCurrent(requestId, modal, type)) return;
			body.innerHTML = `<div class="inventory-status-empty"><span aria-hidden="true">⚠</span><strong>無法載入完整清單</strong><p>${esc(e.message || "請稍後再試")}</p></div>`;
			return;
		}
	}
	if (!isInventoryStatusRequestCurrent(requestId, modal, type)) return;
	renderInventoryStatusModal(type, items);
}
function closeInventoryStatusModal() {
	inventoryState.inventoryStatusGuard.invalidate();
	inventoryState.inventoryStatusModalType = "";
	clearSharedStatusListModal();
	const modal = document.getElementById("inventory-status-modal");
	if (!modal) return;
	modal.classList.remove("is-open");
	modal.setAttribute("aria-hidden", "true");
}
//#endregion
//#region static/js/features/kits/status.js
var status_exports = /* @__PURE__ */ __exportAll({
	getKitStatus: () => getKitStatus,
	showKitStatusList: () => showKitStatusList
});
function getKitStatus(kit) {
	const components = Array.isArray(kit.components) ? kit.components : [];
	const hasShortage = components.some(function(c) {
		return Number(c.need_qty || 0) > 0 && Number(c.stock || 0) <= 0;
	});
	const hasInsufficient = !hasShortage && components.some(function(c) {
		return Number(c.stock || 0) < Number(c.need_qty || 0) - 1e-9;
	});
	return {
		status: hasShortage ? "shortage" : hasInsufficient ? "insufficient" : "normal",
		canAssemble: !hasShortage && !hasInsufficient
	};
}
function renderKitStatusItem(kit, type) {
	const stock = Number(kit.stock_qty || 0);
	const source = Array.isArray(appState.ALL_ITEMS) ? appState.ALL_ITEMS.find(function(item) {
		return Number(item.id) === Number(kit.item_id);
	}) || {} : {};
	const location = kit.location || source.location || source.stocks && source.stocks[0] && source.stocks[0].location || "未標示";
	const isShortage = type === "shortage";
	const statusLabel = isShortage ? "缺料" : "庫存不足";
	const statusClass = isShortage ? "status-out" : "status-low";
	const missingLabel = isShortage ? "缺料" : "不足";
	const missing = (kit.components || []).filter(function(c) {
		return Number(c.need_qty || 0) > 0 && Number(c.stock || 0) < Number(c.need_qty || 0);
	});
	const missingHTML = missing.length ? `<div class="kit-status-missing">${esc(missingLabel)} ${missing.length} 項：${missing.map(function(c) {
		return `<span>${esc(c.name || "未命名材料")}</span>`;
	}).join("")}</div>` : "";
	const editAction = hasPerm("kit-mgmt") && Number.isInteger(Number(kit.id)) ? `<button type="button" class="btn btn--secondary btn--sm inventory-status-edit" onclick="Inventory.closeInventoryStatusModal();Kits.editKit(${esc(String(Number(kit.id)))})">編輯</button>` : "";
	return `<article class="inventory-status-item status-list-mobile-row kit-status-item ${esc(statusClass)}">
    <div class="inventory-status-thumb">${buildThumb(kit.item_id, !!kit.has_photo, kit.name, "🔧", kit.thumbnail_url)}</div>
    <div class="inventory-status-info">
      <div class="inventory-status-name">${esc(kit.name || "未命名整組")}</div>
      <div class="inventory-status-sub">${esc(source.brand || kit.brand || "整組")}${esc(kit.code ? " · 型號 " + kit.code : "")}</div>
      ${missingHTML}
    </div>
    <div class="inventory-status-location status-list-location-cell">📍 ${esc(location)}</div>
    <div class="inventory-status-values">
      <span class="inventory-status-badge ${esc(statusClass)}">${esc(statusLabel)}</span>
      <strong>${esc(statusListFormatQuantity(stock, "組"))} <small>組</small></strong>
    </div>
    ${editAction}
  </article>`;
}
function showKitStatusList(type) {
	const validType = type === "shortage" ? "shortage" : "insufficient";
	const items = appState.currentKitItems.filter(function(k) {
		return getKitStatus(k).status === validType;
	});
	const isShortage = validType === "shortage";
	openSharedStatusListModal({
		title: isShortage ? "⛔ 缺料的整組" : "⚠ 庫存不足的整組",
		intro: isShortage ? "以下整組因必要材料不足，目前無法正常組成。" : "目前仍有庫存，但庫存數量低於需求條件。",
		headerClass: isShortage ? "is-out" : "is-low",
		columnLabels: [
			"照片",
			"整組 / 缺料材料",
			"位置",
			"庫存 / 狀態",
			"操作"
		],
		items,
		emptyText: isShortage ? "✅ 目前沒有缺料的整組" : "✅ 目前沒有庫存不足的整組",
		emptyIntro: "目前整組庫存均符合條件。",
		searchPlaceholder: "搜尋整組名稱、材料或型號…",
		getSearchText: function(kit) {
			return [
				kit.name,
				kit.brand,
				kit.code,
				kit.note,
				(kit.components || []).map(function(c) {
					return [
						c.brand,
						c.name,
						c.code
					].join(" ");
				}).join(" ")
			].join(" ");
		},
		renderItem: function(kit) {
			return renderKitStatusItem(kit, validType);
		}
	});
}
//#endregion
//#region static/js/features/shell/navigation.js
var navigation_exports = /* @__PURE__ */ __exportAll({
	navigateToTab: () => navigateToTab,
	provideTabNavigator: () => provideTabNavigator
});
var tabNavigator = null;
function provideTabNavigator(navigate) {
	if (typeof navigate !== "function") throw new TypeError("provideTabNavigator 需要切頁函式");
	tabNavigator = navigate;
}
function navigateToTab(tab) {
	if (!tabNavigator) throw new Error("navigateToTab：尚未設定切頁實作（pages/main.js 需先呼叫 configureShell）");
	return tabNavigator(tab);
}
//#endregion
//#region static/js/core/search.js
var search_exports$1 = /* @__PURE__ */ __exportAll({ filterBySearch: () => filterBySearch });
function filterBySearch(items, matchFn) {
	var raw = document.getElementById("search-input").value.trim().toLowerCase();
	var kws = raw ? raw.split(/\s+/).filter(function(w) {
		return w.length > 0;
	}) : [];
	if (kws.length === 0) return items;
	return items.filter(function(item) {
		var hay = matchFn(item).toLowerCase();
		return kws.every(function(kw) {
			return hay.indexOf(kw) >= 0;
		});
	});
}
//#endregion
//#region static/js/features/stocktake/state.js
var state_exports$4 = /* @__PURE__ */ __exportAll({ stocktakeState: () => stocktakeState });
var stocktakeState = {
	stocktakeValues: {},
	stocktakeKits: []
};
//#endregion
//#region static/js/features/stocktake/page.js
var page_exports$7 = /* @__PURE__ */ __exportAll({
	calcDiff: () => calcDiff,
	markChanged: () => markChanged,
	renderStocktake: () => renderStocktake,
	setStocktakeValue: () => setStocktakeValue,
	showStocktakeList: () => showStocktakeList,
	submitStocktake: () => submitStocktake,
	switchStocktakeTab: () => switchStocktakeTab
});
var stocktakeRenderGuard = createRequestGuard();
async function renderStocktake() {
	const requestId = stocktakeRenderGuard.next();
	const siteAtRequest = appState.currentSite;
	const isCurrent = function() {
		return stocktakeRenderGuard.isCurrent(requestId) && appState.currentTab === "stocktake" && siteAtRequest === appState.currentSite;
	};
	const canStocktake = !!(currentUser && currentUser.permissions && currentUser.permissions["stocktake"]);
	const content = document.getElementById("content");
	if (!content) return;
	content.innerHTML = "<div class=\"stocktake-loading\">載入盤點資料…</div>";
	let takeDates = [];
	let loadError = false;
	try {
		takeDates = await apiFetch(`/api/stocktake/dates?site=${encodeURIComponent(siteAtRequest)}`);
		if (!isCurrent()) return;
	} catch (e) {
		if (!isCurrent()) return;
		loadError = true;
		console.error("[renderStocktake] 盤點日期載入失敗", e);
	}
	try {
		const kits = await apiFetch(`/api/kits?site=${encodeURIComponent(siteAtRequest)}`);
		if (!isCurrent()) return;
		stocktakeState.stocktakeKits = kits;
	} catch (e) {
		if (!isCurrent()) return;
		loadError = true;
		console.error("[renderStocktake] 整組材料載入失敗", e);
		stocktakeState.stocktakeKits = [];
	}
	if (!isCurrent()) return;
	const statusOf = getInventoryStatus;
	const zeroItems = appState.ALL_ITEMS.filter((i) => statusOf(i).isOutOfStock);
	const lowItems = appState.ALL_ITEMS.filter((i) => statusOf(i).isLowStock);
	const zero = zeroItems.length;
	const low = lowItems.length;
	const totalQty = appState.ALL_ITEMS.reduce((s, i) => s + i.qty, 0);
	const totalQtyStr = (Math.round(totalQty * 1e3) / 1e3).toLocaleString("en-US");
	let html = `<section class="stocktake-page-header">
    <div class="stocktake-heading-copy"><div class="stocktake-heading-icon" aria-hidden="true">📋</div><div><h1>盤點</h1><p>核對實際庫存與系統庫存，快速找出庫存差異。</p></div></div>
    <span class="stocktake-date">📅 ${esc(todayStr())}</span>
  </section>`;
	if (loadError) html += `<div class="stocktake-error-state"><h2>載入盤點資料失敗</h2><p>部分盤點資料無法載入，請重新載入。</p><button type="button" class="btn btn--secondary btn--md btn-cancel" onclick="Stocktake.renderStocktake()">重新載入</button></div>`;
	html += `<section class="stocktake-kpi-grid ui-kpi-grid">
    <div class="stocktake-kpi-card ui-kpi-card ui-kpi-card--blue"><div class="stocktake-kpi-icon ui-kpi-icon">📦</div><div class="ui-kpi-body"><div class="stocktake-kpi-label ui-kpi-label">品項總數</div><div class="stocktake-kpi-number ui-kpi-value">${esc(String(appState.ALL_ITEMS.length))}</div><span class="ui-kpi-meta">目前庫存品項</span></div></div>
    <div class="stocktake-kpi-card ui-kpi-card ui-kpi-card--purple"><div class="stocktake-kpi-icon ui-kpi-icon">🗄️</div><div class="ui-kpi-body"><div class="stocktake-kpi-label ui-kpi-label">庫存總數(件)</div><div class="stocktake-kpi-number ui-kpi-value">${totalQtyStr}</div><span class="ui-kpi-meta">全部品項合計</span></div></div>
    <button type="button" class="stocktake-kpi-card ui-kpi-card ui-kpi-card--amber clickable warn" onclick="Stocktake.showStocktakeList('low')" aria-label="查看低庫存品項"><div class="stocktake-kpi-icon ui-kpi-icon">⚠</div><div class="ui-kpi-body"><div class="stocktake-kpi-label ui-kpi-label">低庫存</div><div class="stocktake-kpi-number ui-kpi-value">${esc(String(low))}</div><span class="ui-kpi-meta">低於警示值 · 查看清單</span></div></button>
    <button type="button" class="stocktake-kpi-card ui-kpi-card ui-kpi-card--red clickable danger" onclick="Stocktake.showStocktakeList('zero')" aria-label="查看缺貨品項"><div class="stocktake-kpi-icon ui-kpi-icon">⛔</div><div class="ui-kpi-body"><div class="stocktake-kpi-label ui-kpi-label">缺貨</div><div class="stocktake-kpi-number ui-kpi-value">${esc(String(zero))}</div><span class="ui-kpi-meta">數量為 0 · 查看清單</span></div></button>
  </section>`;
	if (takeDates.length) {
		const last = takeDates[0];
		const lastDiff = Number(last.total_diff || 0);
		html += `<section class="stocktake-summary-card"><div class="stocktake-summary-heading"><span>📅 上次盤點</span><span class="stocktake-summary-date">${esc(last.take_date)}</span></div>
      <div class="stocktake-summary-metrics"><span>盤點 <b>${esc(String(last.item_count))}</b> 項</span><span>差異 <b class="${lastDiff > 0 ? "is-positive" : lastDiff < 0 ? "is-negative" : ""}">${esc(String(last.total_diff))}</b> 件</span><span>有差異品項 <b>${esc(String(last.diff_count))}</b> 項</span></div></section>`;
	}
	if (takeDates.length > 1) {
		html += `<section class="stocktake-history"><table><thead><tr><th>日期</th><th>盤點數</th><th>有差異</th><th>總差異</th></tr></thead><tbody>`;
		takeDates.slice(0, 5).forEach((d) => {
			html += `<tr><td>${esc(d.take_date)}</td><td>${esc(String(d.item_count))} 項</td><td>${esc(String(d.diff_count))} 項</td><td>${esc(String(d.total_diff))}</td></tr>`;
		});
		html += "</tbody></table></section>";
	}
	html += `<section class="stocktake-current-header"><div class="stocktake-current-heading"><span>✏️ 本次盤點</span><span class="stocktake-current-date">${esc(todayStr())}</span></div><span class="stocktake-current-date">共 ${esc(String(appState.ALL_ITEMS.length))} 項</span></section>`;
	if (!canStocktake) {
		html += `<div class="stocktake-readonly-panel">🔒 盤點作業僅限管理員 / 一般使用者操作<br><small>檢視者與工程師為唯讀，可瀏覽上方盤點歷史與統計</small></div>`;
		if (!isCurrent()) return;
		content.innerHTML = html;
		return;
	}
	html += `<section class="stocktake-info-panel"><div class="stocktake-info-title">ℹ️ 盤點操作說明</div>輸入實際清點數量後，系統會自動計算盤盈 / 盤虧。<br>未填寫的品項維持原數量不變；輸入 0 才代表實際庫存為 0。<br>「整組」盤點完整設備組數；「單一材料」盤點個別庫存品項。</section>`;
	const rows = [];
	appState.ALL_ITEMS.forEach((i) => {
		(i.stocks && i.stocks.length ? i.stocks : [{
			location: i.location || "",
			qty: i.qty
		}]).forEach((s) => rows.push({
			item: i,
			stock: s
		}));
	});
	const kitRows = rows.filter((r) => r.item.is_kit);
	const singleRows = rows.filter((r) => !r.item.is_kit);
	const searchFiltered = function(arr) {
		return filterBySearch(arr, function(r) {
			return [
				r.item.name,
				r.item.code,
				r.item.brand,
				r.stock.location
			].join(" ");
		});
	};
	const filteredKitRows = searchFiltered(kitRows);
	const filteredSingleRows = searchFiltered(singleRows);
	html += `<div class="stk-tabs stocktake-tabs"><button class="chip chip--seg stk-tab stocktake-tab is-active" data-role="stocktake-tab" onclick="Stocktake.switchStocktakeTab('kit')">🔧 整組<span>${esc(String(filteredKitRows.length))} 項</span></button><button class="chip chip--seg stk-tab stocktake-tab" data-role="stocktake-tab" onclick="Stocktake.switchStocktakeTab('single')">📦 單一材料<span>${esc(String(filteredSingleRows.length))} 項</span></button></div>`;
	html += `<div id="stk-pane-kit">${stkGroupByLoc(filteredKitRows)}</div><div id="stk-pane-single" style="display:none">${stkGroupByLoc(filteredSingleRows)}</div>`;
	html += `<button type="button" class="btn btn--primary btn--md stocktake-submit btn-save" onclick="Stocktake.submitStocktake()">📋 完成盤點並更新庫存</button>`;
	if (!isCurrent()) return;
	content.innerHTML = html;
}
function stocktakeInput(key, systemQty, unit) {
	const value = stocktakeState.stocktakeValues[key] !== void 0 ? stocktakeState.stocktakeValues[key] : "";
	return `<input class="stocktake-input" type="text" inputmode="decimal" value="${esc(String(value))}" placeholder="實際（可輸 1/4）" data-unit="${esc(unit || "")}" data-sysqty="${esc(String(systemQty))}" oninput="Stocktake.setStocktakeValue('${jsStr(key)}', this.value); Stocktake.calcDiff(this)" onchange="Stocktake.setStocktakeValue('${jsStr(key)}', this.value); Stocktake.markChanged(this, '${jsStr(key)}')" data-key="${esc(key)}">`;
}
/**
* Render one stocktake item row and any expanded kit component rows.
* @param {Object} item - Inventory item; single-material rows may include a model code.
* @param {Object} stock - Location-specific system stock being counted.
* @param {Object|null} kitDef - Kit definition for an assembly row, if available.
* @returns {string} Escaped table-row markup for the item and its kit components.
*/
function stocktakeRow(item, stock, kitDef) {
	const key = `${item.id}:${stock.location}`;
	const systemQty = Qty.format(stock.qty, Qty.unitTypeOf(item.unit));
	const materials = kitDef && kitDef.components && kitDef.components.length ? kitDef.components.map(function(c) {
		const material = appState.ALL_ITEMS.find((x) => x.id === c.item_id);
		const materialStock = material && material.stocks && material.stocks.length ? material.stocks.find((s) => s.location === stock.location) || material.stocks[0] : null;
		const materialLocation = materialStock ? materialStock.location : "";
		const materialKey = `${c.item_id}:${materialLocation}`;
		const materialSystemQty = Qty.format(materialStock ? materialStock.qty : c.stock, Qty.unitTypeOf(c.unit));
		const materialName = `${esc(c.brand || "")} ${esc(c.name || "未命名")}`.trim();
		return `<tr class="stocktake-material-row"><td><div class="stocktake-material-cell"><span class="stocktake-material-indent" aria-hidden="true">↳</span><span class="stocktake-material-photo cphoto">${c.has_photo ? `<img src="${photoSrc(c.item_id, "thumbnail")}" alt="" onclick="Inventory.openPhotoLightbox(${c.item_id})" title="點擊看大圖">` : "<span class=\"cphoto-empty\">📷</span>"}</span><span><b>${materialName}</b>${c.code ? `<small class="stocktake-model">型號 ${esc(c.code)}</small>` : ""}<small class="stocktake-material-need">需 ${esc(Qty.format(c.need_qty, Qty.unitTypeOf(c.unit)))} ${esc(c.unit || "")}／組</small></span></div></td><td class="stocktake-material-system-qty">${esc(String(materialSystemQty))} ${esc(c.unit || "")}</td><td>${stocktakeInput(materialKey, materialSystemQty, c.unit)}</td><td class="st-diff stocktake-material-diff pending" data-role="stocktake-diff">—</td></tr>`;
	}).join("") : "";
	const displayLoc = stock.location ? `位置：${esc(stock.location)}` : "未標示";
	const photo = item.has_photo ? `<img src="${photoSrc(item.id, "thumbnail")}" alt="" onclick="Inventory.openPhotoLightbox(${item.id})" title="點擊看大圖">` : "<span class=\"cphoto-empty\">📷</span>";
	return `<tr class="${item.is_kit ? "stocktake-assembly-row" : "stocktake-single-row"}"><td><div class="stocktake-item-cell"><span class="cphoto">${photo}</span><span><b>${esc(item.brand || "")} ${esc(item.name || "未命名")}</b>${!item.is_kit && item.code ? "<small class=\"stocktake-model\">型號 " + esc(item.code) + "</small>" : ""}<small>${displayLoc}${stock.note ? " · 📝 " + esc(stock.note) : ""}</small></span></div></td><td class="stocktake-system-qty">${esc(String(systemQty))} ${esc(item.unit || "")}</td><td>${stocktakeInput(key, systemQty, item.unit)}</td><td class="st-diff ${stocktakeState.stocktakeValues[key] === void 0 || stocktakeState.stocktakeValues[key] === "" ? "pending" : "zero"}" data-role="stocktake-diff">${stocktakeState.stocktakeValues[key] === void 0 || stocktakeState.stocktakeValues[key] === "" ? "—" : "0"}</td></tr>${materials}`;
}
function stkGroupByLoc(rows) {
	const byLoc = {};
	rows.forEach((r) => {
		const loc = r.stock.location || "未標示";
		(byLoc[loc] = byLoc[loc] || []).push(r);
	});
	let html = "";
	Object.keys(byLoc).sort().forEach((loc) => {
		const locRows = byLoc[loc];
		html += `<section class="stocktake-location-group"><div class="stocktake-location-header"><span>📍 位置：${esc(loc)}</span><span class="stocktake-location-count">${esc(String(locRows.length))} 項</span></div><div class="stocktake-table-wrap"><table class="data-table stocktake-table"><colgroup><col class="stocktake-col-item"><col class="stocktake-col-system"><col class="stocktake-col-actual"><col class="stocktake-col-diff"></colgroup><thead><tr><th>品項</th><th>系統數量</th><th>實際數量(選填)</th><th>差異</th></tr></thead><tbody>`;
		locRows.forEach((r) => {
			const kitDef = r.item.is_kit ? stocktakeState.stocktakeKits.find((k) => k.item_id === r.item.id) || null : null;
			html += stocktakeRow(r.item, r.stock, kitDef);
		});
		html += "</tbody></table></div></section>";
	});
	return html;
}
function switchStocktakeTab(tab) {
	document.getElementById("stk-pane-kit").style.display = tab === "kit" ? "" : "none";
	document.getElementById("stk-pane-single").style.display = tab === "single" ? "" : "none";
	document.querySelectorAll("[data-role=\"stocktake-tab\"]").forEach((b) => b.classList.remove("is-active"));
	const idx = tab === "kit" ? 0 : 1;
	document.querySelectorAll("[data-role=\"stocktake-tab\"]")[idx].classList.add("is-active");
}
function renderStocktakeStatusItem(item, isLow) {
	const status = getInventoryStatus(item);
	const extra = item.in_kits && item.in_kits.length ? `<div class="stocktake-status-extra">🔧 屬於整組：${esc(item.in_kits.join("、"))}</div>` : "";
	rememberInventoryAlertItem(item);
	return renderSharedProductStatusItem(item, {
		status,
		statusType: isLow ? "low" : "out",
		editable: true,
		extraHTML: extra
	});
}
function showStocktakeList(type) {
	const isLow = type === "low";
	const items = appState.ALL_ITEMS.filter(function(item) {
		const status = getInventoryStatus(item);
		return isLow ? status.isLowStock : status.isOutOfStock;
	}).sort(function(a, b) {
		return getInventoryStatus(a).qty - getInventoryStatus(b).qty;
	});
	openSharedStatusListModal({
		title: isLow ? "⚠ 低庫存商品" : "⛔ 缺貨商品",
		intro: isLow ? "庫存數量已低於或等於目前警示值。" : "目前庫存為 0 或以下的單一庫存品項。",
		headerClass: isLow ? "is-low" : "is-out",
		items,
		emptyText: isLow ? "目前沒有低庫存商品" : "目前沒有缺貨商品",
		emptyIntro: "目前篩選條件下沒有符合的品項。",
		getSearchText: function(item) {
			return [
				item.name,
				item.brand,
				item.code,
				statusListLocations(item).join(" ")
			].join(" ");
		},
		renderItem: function(item) {
			return renderStocktakeStatusItem(item, isLow);
		}
	});
}
function markChanged(input, key) {
	const parts = key.split(":");
	const item = appState.ALL_ITEMS.find((i) => i.id === parseInt(parts[0]));
	const stock = (item && item.stocks || []).find((s) => s.location === parts[1]);
	if (stock) {
		let _chg = true;
		const _p = Qty.parse(input.value);
		_chg = !!(_p.error || Math.abs(_p.value - stock.qty) > 1e-9);
		if (_chg) input.classList.add("is-changed");
		else input.classList.remove("is-changed");
	} else input.classList.remove("is-changed");
}
async function submitStocktake() {
	const items = [];
	const submittedKeys = new Set(Object.keys(stocktakeState.stocktakeValues));
	for (const key of submittedKeys) {
		const parts = key.split(":");
		const itemId = parseInt(parts[0]);
		const location = parts[1];
		const item = appState.ALL_ITEMS.find((i) => i.id === itemId);
		const stock = (item && item.stocks || []).find((s) => s.location === location);
		let v;
		const _raw = stocktakeState.stocktakeValues[key] !== void 0 && stocktakeState.stocktakeValues[key] !== null ? String(stocktakeState.stocktakeValues[key]).trim() : "";
		if (_raw === "") v = stock ? stock.qty : 0;
		else {
			const _unitType = typeof Qty.inputTypeOf === "function" ? Qty.inputTypeOf(item ? item.unit : "") : Qty.unitTypeOf(item ? item.unit : "");
			const _valid = Qty.validFor(_raw, _unitType);
			if (!_valid.ok) {
				toast("「" + (item ? item.name : "") + "」" + (_valid.error || "請輸入符合單位類型的數量"), "error");
				return;
			}
			v = _valid.value;
		}
		if (item && stock) items.push({
			item_id: item.id,
			location,
			actual_qty: v
		});
	}
	if (!items.length) {
		toast("沒有品項可盤點", "error");
		return;
	}
	if (!confirm(`盤點 ${items.length} 項，將更新庫存並記錄。\n確定送出？`)) return;
	try {
		const r = await apiFetch("/api/stocktake", {
			method: "POST",
			json: {
				take_date: todayStr(),
				site: appState.currentSite,
				items
			}
		});
		stocktakeState.stocktakeValues = {};
		const now = /* @__PURE__ */ new Date();
		if (now.getDate() >= 25) {
			localStorage.setItem("lastStocktakeMonth", `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
			const reminder = document.getElementById("reminder");
			if (reminder) reminder.style.display = "none";
		}
		toast(`✅ 盤點完成：${r.count} 項已更新`, "success");
		await loadData();
	} catch (e) {
		toast("盤點送出失敗", "error");
	}
}
function setStocktakeValue(key, value) {
	stocktakeState.stocktakeValues[key] = value;
}
function calcDiff(input) {
	const row = input.closest("tr");
	const diffEl = row ? row.querySelector("[data-role=\"stocktake-diff\"]") : null;
	if (!diffEl) return;
	if (input.value.trim() === "") {
		diffEl.textContent = "—";
		diffEl.className = "st-diff pending";
		return;
	}
	const _unit = input.dataset.unit || "";
	const _p = Qty.parse(input.value);
	if (_p.error) {
		diffEl.textContent = "!";
		diffEl.className = "st-diff neg";
		return;
	}
	const _d = Math.round((_p.value - Number(input.dataset.sysqty)) * 1e3) / 1e3;
	diffEl.textContent = (_d > 0 ? "+" : "") + Qty.format(_d, Qty.unitTypeOf(_unit)) + (_unit ? " " + _unit : "");
	diffEl.className = "st-diff " + (_d > 0 ? "pos" : _d < 0 ? "neg" : "zero");
}
//#endregion
//#region static/js/features/notifications/center.js
var center_exports = /* @__PURE__ */ __exportAll({
	closeNotif: () => closeNotif,
	getStocktakeReminderState: () => getStocktakeReminderState,
	initNotifications: () => initNotifications,
	toggleNotif: () => toggleNotif,
	updateNotifications: () => updateNotifications
});
var NOTIFICATION_OPEN = false;
function getStocktakeReminderState() {
	const user = currentUser;
	user && user.permissions && user.permissions;
	if (!canAccessPage("stocktake", "operate")) return {
		visible: false,
		count: 0
	};
	const now = /* @__PURE__ */ new Date();
	const month = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
	const lastMonth = localStorage.getItem("lastStocktakeMonth");
	return {
		visible: now.getDate() >= 25 && lastMonth !== month,
		count: now.getDate() >= 25 && lastMonth !== month ? 1 : 0,
		month,
		todayLabel: now.getMonth() + 1 + "月" + now.getDate() + "日"
	};
}
function getNotificationSingleCounts() {
	const stats = typeof appState.INVENTORY_META !== "undefined" ? appState.INVENTORY_META.stats : null;
	const hasStatsItems = stats && Array.isArray(stats.zero_items) && Array.isArray(stats.low_items);
	if (appState.currentTab === "inventory") {
		if (typeof appState.inventoryLoadedSite !== "undefined" && appState.inventoryLoadedSite !== appState.currentSite && !hasStatsItems) return {
			loading: true,
			out: 0,
			low: 0
		};
		const items = getFilteredInventoryItems();
		if (stats) {
			const dashboard = getInventoryDashboardStats(items, stats);
			return {
				loading: false,
				out: Math.max(0, Number(dashboard.zeroCount) || 0),
				low: Math.max(0, Number(dashboard.lowCount) || 0)
			};
		}
		return {
			loading: false,
			out: hasStatsItems ? stats.zero_items.length : 0,
			low: hasStatsItems ? stats.low_items.length : 0
		};
	}
	if (appState.currentTab === "stocktake") {
		if (typeof appState.fullItemsLoadedSite !== "undefined" && appState.fullItemsLoadedSite !== appState.currentSite && !(appState.ALL_ITEMS || []).length) return {
			loading: true,
			out: 0,
			low: 0
		};
		const items = Array.isArray(appState.ALL_ITEMS) ? appState.ALL_ITEMS : [];
		const statusOf = getInventoryStatus;
		return {
			loading: false,
			out: items.filter(function(item) {
				return statusOf(item).isOutOfStock;
			}).length,
			low: items.filter(function(item) {
				return statusOf(item).isLowStock;
			}).length
		};
	}
	return {
		loading: false,
		out: 0,
		low: 0
	};
}
function getNotificationSummary() {
	const categories = [];
	let loading = false;
	if (appState.currentTab === "inventory" || appState.currentTab === "stocktake") {
		const counts = getNotificationSingleCounts();
		loading = counts.loading;
		if (!loading) {
			if (counts.out > 0) categories.push({
				kind: "out",
				tone: "out",
				icon: "⛔",
				label: "缺貨商品",
				count: counts.out,
				unit: "項",
				description: "目前有 " + counts.out + " 個品項庫存為 0"
			});
			if (counts.low > 0) categories.push({
				kind: "low",
				tone: "low",
				icon: "⚠",
				label: "低庫存商品",
				count: counts.low,
				unit: "項",
				description: "有 " + counts.low + " 個品項低於安全庫存"
			});
		}
	} else if (appState.currentTab === "kit") {
		const kits = Array.isArray(appState.currentKitItems) ? appState.currentKitItems : [];
		if (typeof appState.fullItemsLoadedSite !== "undefined" && appState.fullItemsLoadedSite !== appState.currentSite && !kits.length) loading = true;
		else {
			const shortage = kits.filter(function(kit) {
				return getKitStatus(kit).status === "shortage";
			}).length;
			const insufficient = kits.filter(function(kit) {
				return getKitStatus(kit).status === "insufficient";
			}).length;
			if (shortage > 0) categories.push({
				kind: "shortage",
				tone: "kit",
				icon: "🟣",
				label: "整組缺料",
				count: shortage,
				unit: "組",
				description: "有 " + shortage + " 組設備因材料不足無法完整組裝"
			});
			if (insufficient > 0) categories.push({
				kind: "insufficient",
				tone: "kit-secondary",
				icon: "🟠",
				label: "整組庫存不足",
				count: insufficient,
				unit: "組",
				description: "有 " + insufficient + " 組設備的材料庫存不足"
			});
		}
	}
	const reminder = getStocktakeReminderState();
	if (reminder.visible) categories.push({
		kind: "reminder",
		tone: "reminder",
		icon: "📋",
		label: "月底盤點提醒",
		count: reminder.count,
		unit: "則",
		description: "本月盤點尚未完成"
	});
	return {
		loading,
		categories,
		total: categories.reduce(function(total, category) {
			return total + category.count;
		}, 0),
		relevantScope: appState.currentTab === "inventory" || appState.currentTab === "stocktake" || appState.currentTab === "kit"
	};
}
function updateNotifCount(total) {
	const count = Math.max(0, Number(total) || 0);
	const badge = document.getElementById("notif-badge") || document.querySelector("[data-role=\"notif\"] [data-role=\"notif-count\"]");
	const bell = document.getElementById("notif-bell");
	if (badge) {
		badge.textContent = count > 99 ? "99+" : String(count);
		badge.style.display = count > 0 ? "flex" : "none";
	}
	if (bell) bell.setAttribute("aria-label", count > 0 ? "通知，目前有 " + count + " 項需要注意" : "通知");
}
function renderNotificationCategory(category) {
	const countLabel = String(category.count) + " " + category.unit;
	return `<button type="button" class="notif-category is-${esc(category.tone)}" data-notification-kind="${esc(category.kind)}" aria-label="${esc(category.label + " " + countLabel)}">
    <span class="notif-category-icon" aria-hidden="true">${esc(category.icon)}</span>
    <span class="notif-category-copy"><strong>${esc(category.label)}</strong><small>${esc(category.description)}</small></span>
    <span class="notif-category-count">${esc(countLabel)}</span><span class="notif-category-arrow" aria-hidden="true">›</span>
  </button>`;
}
function renderNotificationSummary() {
	const list = document.getElementById("notif-list");
	const summaryText = document.getElementById("notif-summary");
	const summary = getNotificationSummary();
	updateNotifCount(summary.total);
	if (summary.loading) {
		if (summaryText) summaryText.textContent = "正在載入異常摘要…";
		if (list) list.innerHTML = "<div class=\"notif-skeleton\" aria-label=\"載入通知摘要\"><span></span><span></span><span></span></div>";
		return summary;
	}
	if (summaryText) summaryText.textContent = summary.total > 0 ? "目前有 " + summary.total + " 項需要注意的事項" : "目前沒有需要注意的事項";
	if (!list) return summary;
	list.innerHTML = summary.categories.length ? summary.categories.map(renderNotificationCategory).join("") : "<div class=\"notif-normal\"><span aria-hidden=\"true\">✓</span><strong>目前沒有庫存異常</strong><small>所有庫存狀態正常</small></div>";
	return summary;
}
function updateNotifications() {
	return renderNotificationSummary();
}
function openNotificationDetail(kind) {
	closeNotif();
	if (kind === "out") {
		if (appState.currentTab === "stocktake") showStocktakeList("zero");
		else showInventoryStatusList("out");
	} else if (kind === "low") {
		if (appState.currentTab === "stocktake") showStocktakeList("low");
		else showInventoryStatusList("low");
	} else if (kind === "shortage") showKitStatusList("shortage");
	else if (kind === "insufficient") showKitStatusList("insufficient");
	else if (kind === "reminder") navigateToTab("stocktake");
}
function closeNotif() {
	NOTIFICATION_OPEN = false;
	const panel = document.getElementById("notifPanel");
	const backdrop = document.getElementById("notifBackdrop");
	const bell = document.getElementById("notif-bell");
	if (panel) {
		panel.classList.remove("is-open");
		panel.setAttribute("aria-hidden", "true");
	}
	if (backdrop) {
		backdrop.classList.remove("is-open");
		backdrop.setAttribute("aria-hidden", "true");
	}
	if (bell) bell.setAttribute("aria-expanded", "false");
	if (document.body && document.body.classList) document.body.classList.remove("notification-sheet-open");
}
function openNotif() {
	renderNotificationSummary();
	NOTIFICATION_OPEN = true;
	const panel = document.getElementById("notifPanel");
	const backdrop = document.getElementById("notifBackdrop");
	const bell = document.getElementById("notif-bell");
	const mobile = typeof window !== "undefined" && window.innerWidth < 768;
	if (panel) {
		panel.classList.add("is-open");
		panel.setAttribute("aria-hidden", "false");
	}
	if (backdrop && mobile) {
		backdrop.classList.add("is-open");
		backdrop.setAttribute("aria-hidden", "false");
	}
	if (bell) bell.setAttribute("aria-expanded", "true");
	if (mobile && document.body && document.body.classList) document.body.classList.add("notification-sheet-open");
}
function toggleNotif() {
	if (NOTIFICATION_OPEN) closeNotif();
	else openNotif();
}
function handleNotificationKeydown(event) {
	if (event.key === "Escape" && NOTIFICATION_OPEN) closeNotif();
}
function initNotifications() {
	(function initializeNotificationCenter() {
		const list = document.getElementById("notif-list");
		const backdrop = document.getElementById("notifBackdrop");
		if (list) list.addEventListener("click", function(event) {
			const row = event.target.closest("[data-notification-kind]");
			if (row) openNotificationDetail(row.getAttribute("data-notification-kind"));
		});
		if (backdrop) backdrop.addEventListener("click", closeNotif);
		document.addEventListener("keydown", handleNotificationKeydown);
		document.addEventListener("click", function(event) {
			if (!NOTIFICATION_OPEN) return;
			if (!event.target.closest("[data-role=\"notif\"]") && !event.target.closest("[data-role=\"notif-panel\"]")) closeNotif();
		});
		if (typeof window !== "undefined") window.addEventListener("resize", function() {
			if (NOTIFICATION_OPEN && window.innerWidth >= 768) {
				const backdropEl = document.getElementById("notifBackdrop");
				if (backdropEl) backdropEl.classList.remove("is-open");
				if (document.body && document.body.classList) document.body.classList.remove("notification-sheet-open");
			}
		});
	})();
}
//#endregion
//#region static/js/features/kits/page.js
var page_exports$6 = /* @__PURE__ */ __exportAll({
	assembleKit: () => assembleKit,
	deleteKit: () => deleteKit,
	disassembleKit: () => disassembleKit,
	editKit: () => editKit,
	initKitsPage: () => initKitsPage,
	openKitSheet: () => openKitSheet,
	renderKits: () => renderKits
});
var kitRenderGuard = createRequestGuard();
async function renderKits() {
	var renderRequestId = kitRenderGuard.next();
	var siteAtRequest = appState.currentSite;
	const content = document.getElementById("content");
	content.innerHTML = "<div class=\"loading\"><div class=\"spin\"></div><div>載入整組清單…</div></div>";
	const isViewer = !hasPerm("kit-mgmt");
	try {
		const kits = await apiFetch(`/api/kits?site=${siteAtRequest}`);
		if (!kitRenderGuard.isCurrent(renderRequestId) || appState.currentTab !== "kit" || siteAtRequest !== appState.currentSite) return;
		appState.currentKitItems = filterBySearch(kits, function(k) {
			return [
				k.name,
				k.brand,
				k.code,
				k.note,
				(k.components || []).map(function(c) {
					return c.brand + " " + c.name + " " + (c.code || "");
				}).join(" ")
			].join(" ");
		});
		const filteredKits = appState.currentKitItems;
		updateNotifications();
		const isM = isMobileView();
		let html = renderKitPageHeader(isViewer);
		html += renderKitDashboard(getKitDashboardStats(filteredKits));
		html += renderKitToolbar(filteredKits.length);
		if (!filteredKits.length) {
			const hasSearch = !!(document.getElementById("search-input") && document.getElementById("search-input").value.trim());
			html += `<div class="kit-empty-state">
        <div class="kit-empty-icon" aria-hidden="true">🔧</div>
        <h2>${esc(hasSearch ? "沒有符合搜尋條件的整組" : "目前沒有整組資料")}</h2>
        <p>${esc(hasSearch ? "可以清除搜尋或調整關鍵字。" : "可以建立整組並加入組成材料。")}</p>
        ${hasSearch ? "<button class=\"btn btn--secondary btn--sm kit-action\" onclick=\"App.clearSearchAutofill();Kits.renderKits()\">清除搜尋</button>" : isViewer ? "" : "<button class=\"btn btn--primary btn--md kit-add-button\" onclick=\"Kits.openKitModal()\">＋ 新增整組</button>"}
      </div>`;
		} else html += filteredKits.map(function(k) {
			return renderKitCard(k, isViewer, isM);
		}).join("");
		content.innerHTML = html;
	} catch (e) {
		if (!kitRenderGuard.isCurrent(renderRequestId) || appState.currentTab !== "kit" || siteAtRequest !== appState.currentSite) return;
		content.innerHTML = `<div class="kit-empty-state"><div class="kit-empty-icon" aria-hidden="true">⚠️</div><h2>載入整組庫存失敗</h2><p>${esc(e.message || "請稍後再試")}</p><button class="btn btn--secondary btn--sm kit-action" onclick="Kits.renderKits()">重新載入</button></div>`;
	}
}
function formatKitNumber(value) {
	const n = Number(value || 0);
	return (Math.round(n * 1e3) / 1e3).toLocaleString("en-US");
}
function getKitDashboardStats(kits) {
	const materialIds = /* @__PURE__ */ new Set();
	let shortageCount = 0;
	let insufficientCount = 0;
	(kits || []).forEach(function(kit) {
		(kit.components || []).forEach(function(component) {
			const key = component.item_id !== void 0 && component.item_id !== null ? String(component.item_id) : [
				component.brand,
				component.name,
				component.code || ""
			].join("|");
			materialIds.add(key);
		});
		const status = getKitStatus(kit).status;
		if (status === "shortage") shortageCount += 1;
		else if (status === "insufficient") insufficientCount += 1;
	});
	return {
		kitCount: (kits || []).length,
		materialCount: materialIds.size,
		insufficientCount,
		shortageCount
	};
}
function renderKitPageHeader(isViewer) {
	return `<section class="kit-page-header">
    <div class="kit-heading-copy">
      <div class="kit-heading-icon" aria-hidden="true">🔧</div>
      <div><h1>整組庫存</h1><p>管理設備整組與其組成材料，查看庫存狀態與需求數量。</p></div>
    </div>
    ${isViewer ? "" : "<button class=\"btn btn--primary btn--md kit-add-button\" onclick=\"Kits.openKitModal()\">＋ 新增整組</button>"}
  </section>`;
}
function renderKitDashboard(stats) {
	return `<section class="kit-kpi-grid ui-kpi-grid" aria-label="整組庫存統計">${[
		[
			"📦",
			stats.kitCount,
			"整組總數",
			""
		],
		[
			"🧩",
			stats.materialCount,
			"組成材料",
			""
		],
		[
			"⚠️",
			stats.insufficientCount,
			"庫存不足(個)",
			"is-warning",
			"insufficient"
		],
		[
			"⛔",
			stats.shortageCount,
			"缺料(個)",
			"is-danger",
			"shortage"
		]
	].map(function(card) {
		const clickable = !!card[4];
		const attrs = clickable ? ` role="button" tabindex="0" aria-label="查看${esc(card[2])}清單" onclick="Kits.showKitStatusList('${card[4]}')" onkeydown="if(event.key === 'Enter' || event.key === ' ') { event.preventDefault(); Kits.showKitStatusList('${card[4]}'); }"` : "";
		const tone = card[4] === "insufficient" ? "amber" : card[4] === "shortage" ? "red" : card[0] === "🧩" ? "purple" : "blue";
		const meta = card[4] === "insufficient" ? "庫存不足 · 查看清單" : card[4] === "shortage" ? "缺料 · 查看清單" : card[0] === "🧩" ? "不重複材料" : "目前篩選結果";
		return `<div class="kit-kpi-card ui-kpi-card ui-kpi-card--${esc(tone)} ${esc(card[3])}${clickable ? " is-clickable" : ""}"${attrs}><span class="kit-kpi-icon ui-kpi-icon" aria-hidden="true">${esc(card[0])}</span><div class="ui-kpi-body"><div class="kit-kpi-label ui-kpi-label">${esc(card[2])}</div><div class="kit-kpi-number ui-kpi-value">${esc(formatKitNumber(card[1]))}</div><span class="ui-kpi-meta">${esc(meta)}</span></div>${clickable ? "<span class=\"kit-kpi-arrow\" aria-hidden=\"true\">›</span>" : ""}</div>`;
	}).join("")}</section>`;
}
function renderKitToolbar(count) {
	const search = document.getElementById("search-input");
	const query = search ? search.value.trim() : "";
	const searchText = query ? `目前搜尋：${query}` : "使用上方搜尋框搜尋整組、材料、型號";
	const now = /* @__PURE__ */ new Date();
	new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
	new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
	return `<div class="kit-toolbar"><span class="kit-toolbar-count">共 ${esc(formatKitNumber(count))} 組</span><span class="kit-toolbar-search">🔍 <b>${esc(searchText)}</b></span><button class="btn btn--export btn--md btn-export" onclick="Kits.openKitExportDialog()">📊 匯出報表</button></div>`;
}
function renderKitStatusBadge(status) {
	if (status === "shortage") return "<span class=\"kit-status-badge is-shortage\">缺料</span>";
	if (status === "insufficient") return "<span class=\"kit-status-badge is-insufficient\">庫存不足</span>";
	return "";
}
function renderKitActionButtons(k, isViewer, isM, status) {
	if (isViewer) return "";
	const transfer = hasPerm("stock-mgmt") ? `<button class="btn btn--secondary btn--sm kit-action" onclick="Inventory.openTransferModal(${k.item_id})">🔄 調撥</button>` : "";
	if (isM) return `<div class="kit-mobile-actions"><button class="btn btn--prepare btn--sm kit-action is-prepare" onclick="Stockout.openKitPrepareModal(${k.item_id}, '${esc(jsStr(k.name))}')">📤 待領出</button><button class="btn btn--out btn--sm kit-action is-out" onclick="Stockout.openOutModal(${k.item_id}, event)">🚚 已領出</button>${transfer}<button class="kit-more" type="button" onclick="Kits.openKitSheet(${k.id})" aria-label="整組操作">⋯</button></div>`;
	return `<div class="kit-assembly-actions">
    <button class="btn btn--prepare btn--sm kit-action is-prepare" onclick="Stockout.openKitPrepareModal(${k.item_id}, '${esc(jsStr(k.name))}')">📤 待領出</button>
    <button class="btn btn--out btn--sm kit-action is-out" onclick="Stockout.openOutModal(${k.item_id}, event)">🚚 已領出</button>
    <button class="btn btn--secondary btn--sm kit-action is-edit" onclick="Kits.editKit(${k.id})">✏️ 編輯</button>
    <button class="btn btn--danger btn--sm kit-action is-delete" onclick="Kits.deleteKit(${k.id})">🗑 刪除</button>
    <button class="btn btn--secondary btn--sm kit-action is-assemble" onclick="Kits.assembleKit(${k.id})" ${esc(status.canAssemble ? "" : "disabled title=\"材料不足\"")}>🛠️ 組裝</button>
    <button class="btn btn--secondary btn--sm kit-action is-disassemble" onclick="Kits.disassembleKit(${k.id})" ${Number(k.stock_qty || 0) > 0 ? "" : "disabled title=\"整組庫存為 0\""}>✂️ 拆解</button>
  </div>` + transfer;
}
function renderKitComponentRow(c) {
	const stock = Number(c.stock || 0);
	const need = Number(c.need_qty || 0);
	const state = stock <= 0 && need > 0 ? "shortage" : stock < need - 1e-9 ? "insufficient" : "normal";
	const stateLabel = state === "shortage" ? "缺料" : state === "insufficient" ? "庫存不足" : "正常";
	const stateClass = `kit-component-status is-${state}`;
	return `<tr>
    <td class="kit-component-photo"><span class="cphoto">${c.has_photo ? `<img src="${photoSrc(c.item_id, "thumbnail")}" alt="" onclick="Inventory.openPhotoLightbox(${c.item_id})" title="點擊看大圖">` : "<span class=\"cphoto-empty\">📷</span>"}</span></td>
    <td><div class="kit-component-info">
      <span class="kit-component-name">${esc(c.brand || "")} ${esc(c.name || "")}</span>${c.code ? `<span class="kit-component-model">型號 ${esc(c.code)}</span>` : ""}
    </div></td>
    <td class="kit-component-qty">${esc(Qty.format(need, Qty.unitTypeOf(c.unit)))} ${esc(c.unit || "")}</td>
    <td class="kit-component-qty">${esc(Qty.format(stock, Qty.unitTypeOf(c.unit)))} ${esc(c.unit || "")}</td>
    <td><span class="${esc(stateClass)}">${esc(stateLabel)}</span></td>
  </tr>`;
}
/**
* Collect Kit card locations with their notes, one entry per "櫃子 | 位置".
* Actual item_stocks positions come first; suggested storage rows saved in the Kit
* editor (kit_locations) follow. Same location → merged, notes de-duplicated.
* Blank-location stock rows are skipped (their note mirrors kits.note).
* Pure function for runtime tests.
* @param {Object} k Kit response with stock_positions and locations.
* @returns {Array<{label: string, notes: string[]}>} Unescaped entries.
*/
function kitLocationEntries(k) {
	const entries = [];
	const add = (label, note) => {
		if (!label) return;
		let entry = entries.find((e) => e.label === label);
		if (!entry) {
			entry = {
				label,
				notes: []
			};
			entries.push(entry);
		}
		if (note && !entry.notes.includes(note)) entry.notes.push(note);
	};
	(Array.isArray(k && k.stock_positions) ? k.stock_positions : []).forEach((position) => {
		add(String(position.location || "").trim(), String(position.note || "").trim());
	});
	(Array.isArray(k && k.locations) ? k.locations : []).forEach((loc) => {
		const cabinet = String(loc.cabinet || "").trim();
		const position = String(loc.position || "").trim();
		add(cabinet && position ? `${cabinet} | ${position}` : cabinet || position, String(loc.note || "").trim());
	});
	return entries;
}
/**
* Render the Kit card location list: one row per location, note beside it.
* @param {Array<{label: string, notes: string[]}>} entries From kitLocationEntries.
* @returns {string} Escaped HTML ('' when there are no locations).
*/
function renderKitLocationList(entries) {
	if (!entries.length) return "";
	return "<div class=\"kit-loc-block\"><div class=\"kit-loc-title\">📍 存放位置</div><ul class=\"kit-loc-list\">" + entries.map((e) => "<li class=\"kit-loc-item\"><span class=\"kit-loc-name\">" + esc(e.label) + "</span>" + (e.notes.length ? "<span class=\"kit-loc-note\">" + esc(e.notes.join("；")) + "</span>" : "") + "</li>").join("") + "</ul></div>";
}
/**
* Render a Kit card with its stock positions and suggested storage locations.
* @param {Object} k Kit response including stock_positions and components.
* @param {boolean} isViewer Whether controls should be read-only.
* @param {boolean} isM Whether the card is rendered in the mobile view.
* @returns {string} Escaped Kit card HTML.
*/
function renderKitCard(k, isViewer, isM) {
	const status = getKitStatus(k);
	const components = Array.isArray(k.components) ? k.components : [];
	const stockQty = Number(k.stock_qty || 0);
	const kitThumb = buildThumb(k.item_id, !!k.has_photo, k.name, "🔧", k.thumbnail_url);
	const detailLines = renderKitLocationList(kitLocationEntries(k)) + (k.note ? "<div class=\"kit-detail-line kit-note-tag\">📝 " + esc(k.note) + "</div>" : "");
	return `<article class="kit-assembly-card is-${esc(status.status)}">
    <header class="kit-assembly-header">
      <div class="kit-photo-slot">${kitThumb}</div>
      <div class="kit-info-slot">
        <div class="kit-name">${esc(k.brand || "") ? esc(k.brand) + " " : ""}${esc(k.name || "未命名整組")}</div>
        <div class="kit-meta">
          ${k.code ? `<span class="kit-code">型號 ${esc(k.code)}</span>` : ""}
          <span class="kit-stock-badge ${stockQty > 0 ? "" : "is-empty"}">庫存 ${esc(Qty.format(stockQty, "integer"))} ${esc(k.unit || "組")}</span>
          ${renderKitStatusBadge(status.status)}
          <span class="kit-comp-count">${components.length} 項組成材料</span>
        </div>
        ${detailLines ? `<div class="kit-detail-lines">${detailLines}</div>` : ""}
      </div>
      <div class="kit-actions-slot">
        ${renderKitActionButtons(k, isViewer, isM, status)}
      </div>
    </header>
    <div class="kit-component-wrap"><table class="kit-component-table"><colgroup><col class="kit-col-photo"><col class="kit-col-info"><col class="kit-col-need"><col class="kit-col-stock"><col class="kit-col-status"></colgroup><thead><tr><th>照片</th><th>材料</th><th>需求數量</th><th>目前庫存</th><th>狀態</th></tr></thead><tbody>
      ${components.map(renderKitComponentRow).join("")}</tbody></table></div>
  </article>`;
}
async function assembleKit(kitId) {
	const qty = prompt("要組裝幾組？", 1);
	if (qty === null) return;
	const _pa = Qty.parse(qty);
	const n = _pa && !_pa.error ? _pa.value : parseInt(qty);
	if (!n || n <= 0 || _pa && !_pa.error && _pa.den !== 1) {
		toast("組裝組數必須為正整數", "error");
		return;
	}
	try {
		await apiFetch(`/api/kits/${kitId}/assemble`, {
			method: "POST",
			json: { qty: n },
			fallback: "組裝失敗"
		});
		toast(`✅ 已組裝 ${n} 組（材料已扣）`, "success");
		await loadData();
	} catch (e) {
		toast("⚠️ " + e.message, "error");
	}
}
async function disassembleKit(kitId) {
	const qty = prompt("要拆解幾組？", 1);
	if (qty === null) return;
	const _pd = Qty.parse(qty);
	const n = _pd && !_pd.error ? _pd.value : parseInt(qty);
	if (!n || n <= 0 || _pd && !_pd.error && _pd.den !== 1) {
		toast("拆解組數必須為正整數", "error");
		return;
	}
	try {
		await apiFetch(`/api/kits/${kitId}/disassemble`, {
			method: "POST",
			json: { qty: n },
			fallback: "拆解失敗"
		});
		toast(`✅ 已拆解 ${n} 組（材料已加回）`, "success");
		await loadData();
	} catch (e) {
		toast("⚠️ " + e.message, "error");
	}
}
/**
* Load a Kit into the editor while retaining locations as display metadata only.
* @param {number} kitId Kit definition identifier.
* @returns {Promise<void>} Resolves after Kit details and modal state are loaded.
*/
async function editKit(kitId) {
	let kit = null;
	try {
		kit = (await apiFetch("/api/kits?site=all")).find((k) => k.id === kitId);
	} catch (e) {}
	if (!kit) {
		toast("找不到整組資料", "error");
		return;
	}
	kitsState.editingKitId = kitId;
	kitsState.kitUpdatedAt = kit.updated_at || null;
	kitsState.kitModalCompRows = kit.components.map((c) => ({
		item_id: c.item_id,
		qty: c.need_qty
	}));
	document.getElementById("k-name").value = kit.name;
	document.getElementById("k-note").value = kit.note || "";
	document.getElementById("k-brand").value = kit.brand || "";
	document.getElementById("k-code").value = kit.code || "";
	document.getElementById("k-site").value = kit.site || "office";
	kitsState.kitLocationRows = (kit.locations || []).map((loc) => ({
		cabinet: loc.cabinet || "",
		position: loc.position || "",
		note: loc.note || ""
	}));
	document.querySelector("#kit-modal h3").textContent = "🔧 編輯整組";
	const btn = document.getElementById("kit-submit");
	btn.textContent = "💾 儲存整組";
	btn.setAttribute("onclick", "Kits.submitKitEdit()");
	renderKitCompRows();
	renderKitLocationRows();
	loadKitCabinetOptions();
	renderKitPhotoBox(kit.id, kit.item_id, !!kit.has_photo);
	openModal("kit-modal");
}
async function deleteKit(kitId) {
	if (!confirm("確定刪除這個整組？它的定義、整組庫存與紀錄都會一起刪除，無法恢復。")) return;
	try {
		await apiFetch(`/api/kits/${kitId}`, {
			method: "DELETE",
			fallback: "刪除失敗"
		});
		toast("✅ 已刪除整組", "success");
		await loadData();
	} catch (e) {
		toast("⚠️ " + e.message, "error");
	}
}
function openKitSheet(kitId) {
	const isViewer = !hasPerm("kit-mgmt");
	const actions = [];
	if (!isViewer) {
		actions.push({
			icon: "🛠️",
			label: "組裝",
			cls: "out",
			fn: () => assembleKit(kitId)
		});
		actions.push({
			icon: "✂️",
			label: "拆解",
			cls: "back",
			fn: () => disassembleKit(kitId)
		});
		actions.push({
			icon: "✏️",
			label: "編輯",
			fn: () => editKit(kitId)
		});
		actions.push({
			icon: "🗑",
			label: "刪除",
			cls: "del",
			fn: () => deleteKit(kitId)
		});
	}
	openSheet("整組操作", actions);
}
function initKitsPage() {
	document.addEventListener("click", (e) => {
		const inSearch = e.target.closest("[data-role=\"mat-search\"]");
		document.querySelectorAll("[data-role=\"kit-dropdown\"].is-open").forEach((d) => {
			if (!inSearch || !inSearch.contains(d)) d.classList.remove("is-open");
		});
	});
}
//#endregion
//#region static/js/features/calendar/state.js
var state_exports$3 = /* @__PURE__ */ __exportAll({ calendarState: () => calendarState });
var calendarState = {
	calSelected: /* @__PURE__ */ new Date(),
	calEvents: [],
	calTodayEvents: [],
	calLoadError: "",
	calLoadGuard: createRequestGuard(),
	calSvc: [],
	calAssignable: [],
	calSearchMode: false,
	calSearchItems: [],
	calSearchMeta: {
		from: "",
		to: "",
		q: ""
	},
	calSearchGuard: createRequestGuard(),
	calSearchState: "idle"
};
//#endregion
//#region static/js/features/calendar/settings-modal.js
var settings_modal_exports = /* @__PURE__ */ __exportAll({
	calAddSvc: () => calAddSvc,
	calDelSvc: () => calDelSvc,
	calOpenSettings: () => calOpenSettings,
	calSetColor: () => calSetColor,
	calSetTab: () => calSetTab,
	calSettingsHtml: () => calSettingsHtml,
	calUpdSvc: () => calUpdSvc,
	calUpdSvcActive: () => calUpdSvcActive
});
function calSettingsHtml(isAdmin) {
	if (!isAdmin) return "";
	return `
  <div class="modal-overlay" data-role="modal" id="cal-set-modal" style="display:none">
    <div class="modal">
      <h3>⚙️ 行事曆設定</h3>
      <div class="cal-set-tabs">
        <button class="chip chip--seg is-active" id="cal-tab-svc" onclick="Calendar.calSetTab('svc')">服務項目</button>
        <button class="chip chip--seg" id="cal-tab-ppl" onclick="Calendar.calSetTab('ppl')">人員與顏色</button>
      </div>
      <div id="cal-tab-svc-panel">
        <table class="cal-set-table">
          <thead><tr><th>名稱</th><th>排序</th><th>啟用</th><th></th></tr></thead>
          <tbody id="cal-svc-rows"></tbody>
        </table>
        <div class="cal-add-row">
          <input type="text" id="cal-svc-new" placeholder="新服務項目名稱（例：報價勘查）">
          <button class="btn btn--primary btn--sm btn-sm btn-primary" onclick="Calendar.calAddSvc()">＋ 加入</button>
        </div>
        <div class="cal-hint">日報表勾選欄位固定：保養 / 維修 / 施工 / 場勘（其他服務匯出時附註於地點欄）</div>
      </div>
      <div id="cal-tab-ppl-panel" style="display:none">
        <table class="cal-set-table">
          <thead><tr><th>人員</th><th>角色</th><th>顏色</th></tr></thead>
          <tbody id="cal-ppl-rows"></tbody>
        </table>
        <div class="cal-hint">顏色只影響行事曆與日報表顯示；人員啟用/停用請到 👥 使用者管理</div>
      </div>
      <div class="modal-actions">
        <button class="btn btn--primary btn--md btn-confirm" onclick="Calendar.closeCalModal()">完成</button>
      </div>
    </div>
  </div>`;
}
function calSetTab(t) {
	["svc", "ppl"].forEach((x) => {
		document.getElementById("cal-tab-" + x + "-panel").style.display = x === t ? "block" : "none";
		document.getElementById("cal-tab-" + x).className = "chip chip--seg" + (x === t ? " is-active" : "");
	});
	if (t === "svc") calRenderSvcRows();
	else calRenderPplRows();
}
function calOpenSettings() {
	calRenderSvcRows();
	calRenderPplRows();
	document.getElementById("cal-set-modal").style.display = "flex";
}
function calRenderSvcRows() {
	const tb = document.getElementById("cal-svc-rows");
	tb.innerHTML = "";
	[...calendarState.calSvc].sort((a, b) => a.sort_order - b.sort_order).forEach((s) => {
		tb.innerHTML += `<tr>
      <td>${esc(s.name)}</td>
      <td><input type="number" value="${s.sort_order}" class="cal-set-sort-input" onchange="Calendar.calUpdSvc(${s.id},this.value)"></td>
      <td><button class="switch ${s.is_active ? "is-active" : ""}" onclick="Calendar.calUpdSvcActive(${s.id})"></button></td>
      <td>${s.is_active ? `<button class="btn btn--danger btn--sm btn-delete" onclick="Calendar.calDelSvc(${s.id})">停用</button>` : "<span class=\"cal-off\">已停用</span>"}</td>
    </tr>`;
	});
}
async function calUpdSvc(id, sort) {
	const s = calendarState.calSvc.find((x) => x.id === id);
	if (!s) return;
	try {
		await apiFetch(`/api/service-types/${id}`, {
			method: "PUT",
			json: {
				name: s.name,
				sort_order: Number(sort) || 0,
				is_active: s.is_active
			}
		});
	} catch (e) {
		toast("❌ 更新失敗");
		return;
	}
	s.sort_order = Number(sort) || 0;
	calRenderSvcRows();
	toast("✅ 已更新");
}
async function calUpdSvcActive(id) {
	const s = calendarState.calSvc.find((x) => x.id === id);
	if (!s) return;
	try {
		await apiFetch(`/api/service-types/${id}`, {
			method: "PUT",
			json: {
				name: s.name,
				sort_order: s.sort_order,
				is_active: s.is_active ? 0 : 1
			}
		});
	} catch (e) {
		toast("❌ 更新失敗");
		return;
	}
	s.is_active = s.is_active ? 0 : 1;
	calRenderSvcRows();
	toast(s.is_active ? "✅ 已啟用" : "已停用");
}
async function calAddSvc() {
	const v = document.getElementById("cal-svc-new").value.trim();
	if (!v) return;
	let data;
	try {
		data = await apiFetch("/api/service-types", {
			method: "POST",
			json: {
				name: v,
				sort_order: calendarState.calSvc.length + 1,
				is_active: 1
			},
			fallback: "新增失敗"
		});
	} catch (e) {
		toast("❌ " + e.message);
		return;
	}
	document.getElementById("cal-svc-new").value = "";
	calendarState.calSvc.push(data);
	calRenderSvcRows();
	toast(`✅ 已新增「${v}」`);
}
async function calDelSvc(id) {
	if (!confirm("確定停用此服務項目嗎？（舊行程不受影響）")) return;
	try {
		await apiFetch(`/api/service-types/${id}`, { method: "DELETE" });
	} catch (e) {
		toast("❌ 停用失敗");
		return;
	}
	const s = calendarState.calSvc.find((x) => x.id === id);
	if (s) s.is_active = 0;
	calRenderSvcRows();
	toast("已停用");
}
function calRenderPplRows() {
	const tb = document.getElementById("cal-ppl-rows");
	tb.innerHTML = "";
	const roleName = {
		admin: "管理員",
		user: "使用者",
		viewer: "檢視者"
	};
	calendarState.calAssignable.forEach((p) => {
		tb.innerHTML += `<tr>
      <td>${esc(p.display_name || p.username)}</td>
      <td>${esc(roleName[p.role] || p.role || "")}</td>
      <td><div class="cal-color-dots">${CAL_PALETTE.map((c) => `<span style="background:${c}" class="${(p.color || CAL_PALETTE[0]) === c ? "sel" : ""}" onclick="Calendar.calSetColor(${p.id},'${c}')"></span>`).join("")}</div></td>
    </tr>`;
	});
}
async function calSetColor(uid, color) {
	try {
		await apiFetch(`/api/users/${uid}`, {
			method: "PUT",
			json: { color }
		});
	} catch (e) {
		toast("❌ 顏色更新失敗");
		return;
	}
	const p = calendarState.calAssignable.find((x) => x.id === uid);
	if (p) p.color = color;
	calRenderPplRows();
	toast("✅ 顏色已更新");
}
//#endregion
//#region static/js/features/shell/page-scope.js
var page_scope_exports = /* @__PURE__ */ __exportAll({
	setPageScope: () => setPageScope,
	syncViewUrl: () => syncViewUrl
});
var PAGE_CONTENT_CLASS = {
	"signed-reports": "dsr-content",
	"calendar": "cal-content",
	"quotation": "quotation-content",
	"quotation-upload": "quotation-upload-content",
	"petty-cash": "pc-content",
	"inventory": "inventory-content",
	"prepared": "prepared-content",
	"kit": "kit-content",
	"stocktake": "stocktake-content",
	"stockout": "stockout-content",
	"work-progress": "wpr-content"
};
function setPageScope(page) {
	if (page) document.body.dataset.page = page;
	else delete document.body.dataset.page;
	var content = document.getElementById("content");
	if (!content) return;
	Object.keys(PAGE_CONTENT_CLASS).forEach(function(key) {
		content.classList.toggle(PAGE_CONTENT_CLASS[key], key === page);
	});
}
function syncViewUrl() {
	var p = new URLSearchParams();
	p.set("tab", appState.currentTab);
	p.set("site", appState.currentSite);
	var cm = typeof appState.calMonth !== "undefined" ? appState.calMonth : /* @__PURE__ */ new Date();
	p.set("month", cm.getFullYear() + "-" + String(cm.getMonth() + 1).padStart(2, "0"));
	history.replaceState(null, "", "?" + p.toString());
}
//#endregion
//#region static/js/features/calendar/format.js
var format_exports$1 = /* @__PURE__ */ __exportAll({
	_fmtTW: () => _fmtTW,
	_iso: () => _iso,
	_parseLocalDate: () => _parseLocalDate,
	_syncCalendarDateControls: () => _syncCalendarDateControls,
	calFmtCreatedAt: () => calFmtCreatedAt,
	calServiceTone: () => calServiceTone
});
function _iso(d) {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function _fmtTW(d) {
	return `${d.getMonth() + 1}月${d.getDate()}日 週${CAL_WEEK[d.getDay()]}`;
}
function _parseLocalDate(value) {
	if (value instanceof Date) return new Date(value.getFullYear(), value.getMonth(), value.getDate());
	const parts = String(value || "").split("-").map(Number);
	if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
	return new Date(parts[0], parts[1] - 1, parts[2]);
}
function _syncCalendarDateControls() {
	const selected = _iso(calendarState.calSelected);
	const searchFrom = document.getElementById("cal-search-from");
	const picker = document.getElementById("cal-picker");
	if (searchFrom) searchFrom.value = selected;
	if (picker) picker.value = selected;
}
function calFmtCreatedAt(s) {
	if (!s) return "";
	const d = /* @__PURE__ */ new Date(s.replace(" ", "T") + "Z");
	if (isNaN(d)) return String(s).slice(0, 16);
	const p = (n) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
var CAL_SERVICE_TONES = {
	"施工": "blue",
	"維修": "green",
	"場勘": "amber",
	"保養": "purple"
};
function calServiceTone(name) {
	return CAL_SERVICE_TONES[name] || "slate";
}
//#endregion
//#region static/js/features/calendar/search.js
var search_exports = /* @__PURE__ */ __exportAll({
	calApplyRightPanelMode: () => calApplyRightPanelMode,
	calBindSearchViewportListener: () => calBindSearchViewportListener,
	calIsDesktopViewport: () => calIsDesktopViewport,
	calMountSearchResults: () => calMountSearchResults,
	calRenderMobileSearchResults: () => calRenderMobileSearchResults,
	calRenderSearchResults: () => calRenderSearchResults,
	calSearch: () => calSearch
});
var calSearchViewportBound = false;
function calIsDesktopViewport() {
	return typeof window.matchMedia !== "function" || window.matchMedia("(min-width: 768px)").matches;
}
function calMountSearchResults() {
	const results = document.getElementById("cal-search-results");
	if (!results) return calIsDesktopViewport();
	const desktop = calIsDesktopViewport();
	const target = document.getElementById(desktop ? "cal-search-panel-slot" : "cal-search-top-slot");
	if (target && results.parentElement !== target) target.appendChild(results);
	return desktop;
}
function calBindSearchViewportListener() {
	if (calSearchViewportBound || typeof window.matchMedia !== "function") return;
	const media = window.matchMedia("(min-width: 768px)");
	if (typeof media.addEventListener === "function") media.addEventListener("change", calHandleSearchViewportChange);
	else if (typeof media.addListener === "function") media.addListener(calHandleSearchViewportChange);
	calSearchViewportBound = true;
}
function calHandleSearchViewportChange() {
	calMountSearchResults();
	if (!calendarState.calSearchMode) return;
	if (calendarState.calSearchState === "loading") calRenderSearchLoading();
	else if (calendarState.calSearchState === "error") calRenderSearchError();
	else if (calendarState.calSearchState === "ready") {
		if (calIsDesktopViewport()) calRenderSearchResults(calendarState.calSearchItems);
		else calRenderMobileSearchResults(calendarState.calSearchItems);
	} else calApplyRightPanelMode();
}
function calApplyRightPanelMode() {
	const desktop = calMountSearchResults();
	const panel = document.getElementById("cal-day-panel");
	const results = document.getElementById("cal-search-results");
	const list = document.getElementById("cal-day-list");
	const helper = document.getElementById("cal-helper-panel");
	if (!panel || !results) return;
	if (!desktop) {
		panel.classList.remove("cal-search-mode");
		results.style.display = calendarState.calSearchMode ? "block" : "none";
		if (list) list.style.display = "";
		return;
	}
	panel.classList.toggle("cal-search-mode", calendarState.calSearchMode);
	results.style.display = calendarState.calSearchMode ? "flex" : "none";
	if (list) list.style.display = calendarState.calSearchMode ? "none" : "";
	if (helper && calendarState.calSearchMode) helper.style.display = "none";
}
function calSearchDateLabel(dateStr) {
	const date = _parseLocalDate(dateStr);
	if (!date || isNaN(date.getTime())) return String(dateStr || "");
	const pad = (n) => String(n).padStart(2, "0");
	return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${CAL_WEEK[date.getDay()]}`;
}
function calSearchRangeLabel(meta) {
	if (meta.from && meta.to) return `${esc(meta.from)} ～ ${esc(meta.to)}`;
	if (meta.from) return `自 ${esc(meta.from)}`;
	if (meta.to) return `至 ${esc(meta.to)}`;
	return "全部日期";
}
function calRenderSearchLoading() {
	calendarState.calSearchMode = true;
	calendarState.calSearchState = "loading";
	calApplyRightPanelMode();
	const el = document.getElementById("cal-search-results");
	if (!el) return;
	el.innerHTML = "<div class=\"cal-search-panel-header\"><div class=\"cal-search-header-row\"><strong>🔍 搜尋結果</strong><span class=\"cal-search-count\">搜尋中...</span></div><div class=\"cal-search-meta\">正在載入符合條件的派工</div></div><div class=\"cal-search-list\"><div class=\"cal-search-skeleton\" aria-hidden=\"true\"><span></span><span></span><span></span></div></div>";
}
function calRenderSearchError() {
	calendarState.calSearchMode = true;
	calendarState.calSearchState = "error";
	calApplyRightPanelMode();
	const el = document.getElementById("cal-search-results");
	if (!el) return;
	el.innerHTML = "<div class=\"cal-search-panel-header\"><div class=\"cal-search-header-row\"><strong>🔍 搜尋結果</strong><button class=\"btn btn--secondary btn--sm cal-search-exit\" type=\"button\" onclick=\"Calendar.calClearSearch()\">× 結束搜尋</button></div><div class=\"cal-search-meta\">搜尋派工失敗</div></div><div class=\"cal-search-empty\"><div class=\"cal-empty-icon\" aria-hidden=\"true\">⚠️</div><strong>搜尋派工失敗</strong><p>請重新搜尋或調整條件。</p><button class=\"btn btn--secondary btn--sm btn-sm\" type=\"button\" onclick=\"Calendar.calSearch()\">重新搜尋</button></div>";
}
function calRenderSearchResults(items) {
	const el = document.getElementById("cal-search-results");
	if (!el) return;
	calendarState.calSearchMode = true;
	calendarState.calSearchState = "ready";
	calApplyRightPanelMode();
	const meta = calendarState.calSearchMeta || {
		from: "",
		to: "",
		q: ""
	};
	const keyword = meta.q ? `「${esc(meta.q)}」` : "全部條件";
	const range = calSearchRangeLabel(meta);
	const list = Array.isArray(items) ? items : [];
	const body = list.map((e) => {
		const service = e.service_name ? `<span class="cal-service-badge cal-service-${esc(calServiceTone(e.service_name))}">${esc(e.service_name)}</span>` : "";
		const assignees = (e.assignees || []).map((a) => esc(a.name || "")).filter(Boolean).join("、");
		const assigneeHtml = assignees ? `<span>👤 ${assignees}</span>` : "";
		const addressHtml = e.address ? `<span>📍 ${esc(e.address)}</span>` : "";
		const noteHtml = e.note ? `<span>📝 ${esc(e.note)}</span>` : "";
		return `<article class="cal-search-item" data-date="${esc(e.date || "")}" role="button" tabindex="0" onclick="Calendar.calJumpToDate(this.dataset.date)" onkeydown="if(event.key === 'Enter' || event.key === ' ') this.click()"><div class="cal-search-item-date"><span>${esc(calSearchDateLabel(e.date))}</span><strong>${esc(e.start_time || "未指定時間")}</strong></div><div class="cal-search-item-body"><div class="cal-search-item-title">${esc(e.client_name || "未命名派工")}</div><div class="cal-search-item-tags">${service}${assigneeHtml}</div><div class="cal-search-item-extra">${addressHtml}${noteHtml}</div></div></article>`;
	}).join("") || "<div class=\"cal-search-empty\"><div class=\"cal-empty-icon\" aria-hidden=\"true\">🔍</div><strong>沒有符合條件的派工</strong><p>請調整日期或關鍵字後重新搜尋。</p><button class=\"btn btn--secondary btn--sm btn-sm\" type=\"button\" onclick=\"Calendar.calClearSearch()\">清除搜尋</button></div>";
	el.innerHTML = `<div class="cal-search-panel-header"><div class="cal-search-header-row"><strong>🔍 搜尋結果</strong><span class="cal-search-count">共 ${list.length} 筆</span><button class="btn btn--secondary btn--sm cal-search-exit" type="button" onclick="Calendar.calClearSearch()">× 結束搜尋</button></div><div class="cal-search-meta">${keyword} · ${range}</div></div><div class="cal-search-list">${body}</div>`;
}
function calRenderMobileSearchResults(items) {
	const el = document.getElementById("cal-search-results");
	if (!el) return;
	calendarState.calSearchMode = true;
	calendarState.calSearchState = "ready";
	calApplyRightPanelMode();
	el.style.display = "block";
	if (!items.length) {
		el.innerHTML = "<div class=\"cal-msearch-empty\">找不到符合條件的行程</div>";
		return;
	}
	let html = "<div class=\"cal-msearch-summary\">找到 " + items.length + " 筆結果</div>";
	items.forEach(function(e) {
		const names = (e.assignees || []).map(function(a) {
			return esc(a.name);
		}).join("、");
		html += "<div class=\"cal-search-item cal-msearch-item\" data-date=\"" + esc(e.date) + "\" onclick=\"Calendar.calJumpToDate(this.dataset.date)\"><div class=\"cal-msearch-title\">" + esc(e.client_name) + "</div><div class=\"cal-msearch-time\">" + (esc(e.date) || "") + (e.start_time ? " " + esc(e.start_time) + (e.end_time ? "~" + esc(e.end_time) : "") : "") + (e.service_name ? " [" + esc(e.service_name) + "]" : "") + "</div>" + (names ? "<div class=\"cal-msearch-meta\">👤 " + names + "</div>" : "") + (e.address ? "<div class=\"cal-msearch-meta\">📍 " + esc(e.address) + "</div>" : "") + (e.note ? "<div class=\"cal-msearch-meta\">📝 " + esc(e.note) + "</div>" : "") + "</div>";
	});
	el.innerHTML = html;
}
async function calSearch() {
	const from = document.getElementById("cal-search-from").value;
	const to = document.getElementById("cal-search-to").value;
	const q = document.getElementById("cal-search-q").value.trim();
	const requestToken = calendarState.calSearchGuard.next();
	if (!from && !to && !q) {
		toast("請輸入搜尋條件", "error");
		return;
	}
	const desktop = calIsDesktopViewport();
	calendarState.calSearchMeta = {
		from,
		to,
		q
	};
	if (desktop) calRenderSearchLoading();
	const params = new URLSearchParams();
	if (from) params.set("date_from", from);
	if (to) params.set("date_to", to);
	if (q) params.set("q", q);
	try {
		const items = await apiFetch("/api/appointments/search?" + params);
		if (!calendarState.calSearchGuard.isCurrent(requestToken)) return;
		calendarState.calSearchItems = Array.isArray(items) ? items : [];
		if (calIsDesktopViewport()) calRenderSearchResults(calendarState.calSearchItems);
		else calRenderMobileSearchResults(calendarState.calSearchItems);
	} catch (err) {
		if (!calendarState.calSearchGuard.isCurrent(requestToken)) return;
		console.error("[calSearch]", err);
		if (calIsDesktopViewport()) calRenderSearchError();
		else toast("搜尋失敗", "error");
	}
}
//#endregion
//#region static/js/features/calendar/sync-status.js
var sync_status_exports = /* @__PURE__ */ __exportAll({
	calCanRetryPersonal: () => calCanRetryPersonal,
	calCanRetryTeamPerson: () => calCanRetryTeamPerson,
	calPersonalSync: () => calPersonalSync,
	calSyncStatusIcon: () => calSyncStatusIcon,
	calSyncStatusLabel: () => calSyncStatusLabel,
	calTeamHasRetryableTarget: () => calTeamHasRetryableTarget,
	calTeamSyncLabel: () => calTeamSyncLabel
});
function calSyncStatusLabel(status) {
	return status === "synced" ? "已同步至你的 Google 日曆" : status === "partial_failed" ? "部分同步失敗" : status === "partial_retrying" ? "部分同步重試中" : status === "retrying" ? "同步重試中" : status === "pending" ? "等待同步" : status === "failed" ? "同步失敗" : status === "not_assigned" ? "" : status === "not_bound" ? "未綁定同步 Key" : status === "paused" ? "同步 Key 已停用" : status === "not_targeted" ? "尚未同步至你的日曆" : "未綁定同步 Key";
}
function calSyncStatusIcon(status) {
	return status === "synced" ? "✅" : status === "partial_failed" ? "⚠️" : status === "partial_retrying" ? "🔄" : status === "retrying" ? "🔄" : status === "pending" ? "⏳" : status === "failed" ? "❌" : status === "paused" ? "⏸️" : "";
}
function calPersonalSync(e) {
	return e.my_sync_status || {
		status: e.sync_status || "none",
		key_name: e.sync_error_key || "",
		cal_id: e.sync_error_cal || "",
		error: e.sync_error || "",
		attempts: e.sync_error_attempts || 0
	};
}
function calCanRetryPersonal(personal) {
	return Boolean(personal && personal.can_retry === true);
}
function calCanRetryTeamPerson(person) {
	return Boolean(person && person.can_retry === true);
}
function calHasTeamSyncInfo(team) {
	if (!team) return false;
	return (team.eligible_people || 0) + (team.unbound_people || 0) + (team.paused_people || 0) + (team.inactive_people || 0) + (team.fallback_target_count || 0) > 0;
}
function calTeamHasRetryableTarget(team) {
	return Boolean(team && team.can_retry_all === true);
}
function calTeamSyncLabel(team) {
	if (!team) return "";
	if (team.fallback_target_count && !team.eligible_people) return `同步至全部有效 Google 行事曆（${team.fallback_target_count} 個）${team.can_retry_all ? " ⏳" : ""}`;
	if (!team.eligible_people && !team.fallback_target_count) return "目前沒有可用的 Google 行事曆，請先新增或啟用 Calendar Key";
	if (!calHasTeamSyncInfo(team)) return "";
	const icon = team.failed_people ? " ⚠️" : team.pending_people || team.retrying_people ? " ⏳" : "";
	return `團隊：${team.synced_people}/${team.eligible_people} 同步${icon}`;
}
//#endregion
//#region static/js/features/calendar/view.js
var view_exports = /* @__PURE__ */ __exportAll({
	calChangeMonth: () => calChangeMonth,
	calClearSearch: () => calClearSearch,
	calExport: () => calExport,
	calJumpToDate: () => calJumpToDate,
	calLoadData: () => calLoadData,
	calPickDate: () => calPickDate,
	calPickToday: () => calPickToday,
	calRenderDay: () => calRenderDay,
	calRenderKpi: () => calRenderKpi,
	calRenderLegend: () => calRenderLegend,
	calRenderMonth: () => calRenderMonth,
	calRenderReminder: () => calRenderReminder,
	calRetryLoad: () => calRetryLoad,
	calSetLoadState: () => calSetLoadState,
	calShiftDay: () => calShiftDay
});
function calRenderReminder() {
	const n = calendarState.calTodayEvents.length;
	const el = document.getElementById("cal-reminder");
	el.style.display = "flex";
	el.innerHTML = `<span aria-hidden="true">📅</span><span>今天 ${_fmtTW(/* @__PURE__ */ new Date())} 有 ${n} 筆派工</span>`;
}
async function calLoadData() {
	const requestToken = calendarState.calLoadGuard.next();
	const y = appState.calMonth.getFullYear(), m = appState.calMonth.getMonth() + 1;
	const today = /* @__PURE__ */ new Date();
	const todayStr = _iso(today);
	const monthEventsPromise = apiFetch(`/api/appointments?year=${y}&month=${m}`);
	const todayEventsPromise = y === today.getFullYear() && m === today.getMonth() + 1 ? monthEventsPromise : apiFetch(`/api/appointments?date=${todayStr}`);
	calendarState.calLoadError = "";
	try {
		const [ev, svc, ppl, todayEv] = await Promise.all([
			monthEventsPromise,
			apiFetch("/api/service-types"),
			apiFetch("/api/assignable-users"),
			todayEventsPromise
		]);
		if (!calendarState.calLoadGuard.isCurrent(requestToken)) return null;
		calendarState.calEvents = ev;
		calendarState.calTodayEvents = todayEv.filter((e) => e.date === todayStr);
		calendarState.calSvc = svc;
		calendarState.calAssignable = ppl;
		return true;
	} catch (e) {
		if (!calendarState.calLoadGuard.isCurrent(requestToken)) return null;
		calendarState.calLoadError = "行事曆資料載入失敗，請重新載入。";
		console.error("[calLoadData] 行事曆資料載入失敗", e);
		calendarState.calEvents = [];
		calendarState.calTodayEvents = [];
		calendarState.calSvc = [];
		calendarState.calAssignable = [];
		return false;
	}
}
function calRenderLoadingUi() {
	const kpi = document.getElementById("cal-kpi-grid");
	const grid = document.getElementById("cal-grid");
	const list = document.getElementById("cal-day-list");
	const legend = document.getElementById("cal-legend");
	const helper = document.getElementById("cal-helper-panel");
	if (legend) {
		legend.style.display = "none";
		legend.innerHTML = "";
	}
	if (helper) {
		helper.style.display = "none";
		helper.innerHTML = "";
	}
	if (kpi) kpi.innerHTML = Array.from({ length: 3 }, () => "<div class=\"cal-kpi-card ui-kpi-card ui-kpi-card--stacked cal-skeleton-card\" aria-hidden=\"true\"><span></span><strong></strong></div>").join("");
	if (grid) {
		const first = new Date(appState.calMonth.getFullYear(), appState.calMonth.getMonth(), 1).getDay();
		const total = new Date(appState.calMonth.getFullYear(), appState.calMonth.getMonth() + 1, 0).getDate();
		const weeks = Math.ceil((first + total) / 7);
		grid.style.setProperty("--cal-week-count", String(weeks));
		grid.innerHTML = CAL_WEEK.map((w, index) => "<div class=\"cal-weekday" + (index === 0 || index === 6 ? " cal-weekend" : "") + "\">" + esc(w) + "</div>").join("") + Array.from({ length: weeks * 7 }, () => "<div class=\"cal-cell cal-skeleton-cell\" aria-hidden=\"true\"></div>").join("");
	}
	if (list) list.innerHTML = "<div class=\"cal-skeleton-detail\" aria-hidden=\"true\"><span></span><span></span><span></span><span></span></div>";
}
function calRenderErrorUi(message) {
	const grid = document.getElementById("cal-grid");
	const list = document.getElementById("cal-day-list");
	const legend = document.getElementById("cal-legend");
	const helper = document.getElementById("cal-helper-panel");
	if (legend) {
		legend.style.display = "none";
		legend.innerHTML = "";
	}
	if (helper) {
		helper.style.display = "none";
		helper.innerHTML = "";
	}
	if (grid) grid.innerHTML = `<div class="cal-inline-error"><span>⚠️ ${esc(message || "載入失敗")}</span></div>`;
	if (list) list.innerHTML = "<div class=\"cal-empty-state cal-error-state\"><div class=\"cal-empty-icon\" aria-hidden=\"true\">⚠️</div><strong>載入派工資料失敗</strong><p>請按上方「重新載入」再試一次。</p></div>";
}
function calSetLoadState(state, message) {
	const el = document.getElementById("cal-load-state");
	if (!el) return;
	if (state === "loading") {
		el.className = "cal-load-state is-loading";
		el.innerHTML = "<span class=\"cal-spinner\" aria-hidden=\"true\"></span><span>載入派工資料中...</span>";
		calRenderLoadingUi();
	} else if (state === "error") {
		el.className = "cal-load-state is-error";
		el.innerHTML = `<span>⚠️ ${esc(message || "載入失敗")}</span><button class="btn btn--secondary btn--sm btn-sm" onclick="Calendar.calRetryLoad()">重新載入</button>`;
		calRenderErrorUi(message);
	} else {
		el.className = "cal-load-state";
		el.innerHTML = "";
	}
}
async function calRetryLoad() {
	calSetLoadState("loading");
	if (await calLoadData() === null) return;
	if (calendarState.calLoadError) return calSetLoadState("error", calendarState.calLoadError);
	calSetLoadState("ready");
	calRenderMonth();
	calRenderDay();
	calRenderKpi();
	calRenderLegend();
	calRenderReminder();
}
function calRenderKpi() {
	_iso(calendarState.calSelected);
	const cards = [{
		label: "今日派工",
		value: calendarState.calTodayEvents.length,
		meta: `今日共 ${calendarState.calTodayEvents.length} 筆派工`,
		tone: "blue"
	}, {
		label: "本月派工",
		value: calendarState.calEvents.length,
		meta: `${appState.calMonth.getFullYear()} 年 ${appState.calMonth.getMonth() + 1} 月（共 ${calendarState.calEvents.length} 筆）`,
		tone: "indigo"
	}];
	const el = document.getElementById("cal-kpi-grid");
	if (!el) return;
	el.innerHTML = cards.map((card) => {
		const meta = `<span class="cal-kpi-meta ui-kpi-meta">${esc(card.meta)}</span>`;
		return `<div class="cal-kpi-card ui-kpi-card ui-kpi-card--stacked ui-kpi-card--${esc(card.tone)} cal-kpi-${esc(card.tone)}"><span class="cal-kpi-label ui-kpi-label">${esc(card.label)}</span><strong class="ui-kpi-value">${esc(card.value)}</strong>${meta}</div>`;
	}).join("");
}
function calRenderLegend() {
	const el = document.getElementById("cal-legend");
	if (!el) return;
	const services = (calendarState.calSvc || []).filter((s) => s && s.name && s.is_active !== 0);
	if (!services.length) {
		el.style.display = "none";
		el.innerHTML = "";
		return;
	}
	el.style.display = "flex";
	el.innerHTML = services.map((s) => `<span class="cal-legend-item"><i class="cal-legend-dot cal-service-${esc(calServiceTone(s.name))}" aria-hidden="true"></i>${esc(s.name)}</span>`).join("");
}
function calRenderHelper(dayEvents) {
	const el = document.getElementById("cal-helper-panel");
	if (!el) return;
	if (dayEvents.length > 1) {
		el.style.display = "none";
		el.innerHTML = "";
		return;
	}
	el.style.display = "block";
	el.innerHTML = "<strong>💡 小提醒</strong><ul><li>點擊日期可查看當天派工</li><li>可從右上角匯出日報表</li></ul>";
}
/**
* 依月份實際需要的完整週數繪製月曆，避免固定六週多顯示隔月日期。
* @returns {void} 更新月曆格與桌面列數。
*/
function calRenderMonth() {
	if (calendarState.calLoadError) return;
	const y = appState.calMonth.getFullYear(), m = appState.calMonth.getMonth();
	document.getElementById("cal-month-title").innerText = `${y} 年 ${m + 1} 月`;
	const grid = document.getElementById("cal-grid");
	grid.innerHTML = "";
	CAL_WEEK.forEach((w, index) => {
		const l = document.createElement("div");
		l.className = "cal-weekday" + (index === 0 || index === 6 ? " cal-weekend" : "");
		l.innerText = w;
		grid.appendChild(l);
	});
	const first = new Date(y, m, 1).getDay();
	const total = new Date(y, m + 1, 0).getDate();
	const prevTotal = new Date(y, m, 0).getDate();
	for (let i = first; i > 0; i--) {
		const c = document.createElement("div");
		c.className = "cal-cell cal-other";
		c.innerHTML = `<span class="cal-day-num">${prevTotal - i + 1}</span>`;
		grid.appendChild(c);
	}
	const selStr = _iso(calendarState.calSelected);
	for (let d = 1; d <= total; d++) {
		const ds = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
		const c = document.createElement("div");
		const isToday = ds === _iso(/* @__PURE__ */ new Date());
		const dayOfWeek = new Date(y, m, d).getDay();
		c.className = "cal-cell" + (ds === selStr ? " cal-selected" : "") + (isToday ? " cal-today" : "") + (dayOfWeek === 0 || dayOfWeek === 6 ? " cal-weekend-cell" : "");
		c.innerHTML = `<span class="cal-day-num">${d}</span>`;
		c.onclick = () => {
			calendarState.calSelected = new Date(y, m, d);
			_syncCalendarDateControls();
			calRenderMonth();
			calRenderDay();
		};
		const evts = calendarState.calEvents.filter((e) => e.date === ds).sort((a, b) => (a.start_time || "99:99").localeCompare(b.start_time || "99:99"));
		evts.slice(0, 2).forEach((e) => {
			const t = document.createElement("span");
			t.className = "cal-evt cal-service-" + calServiceTone(e.service_name);
			if (e.start_time) {
				const timeEl = document.createElement("span");
				timeEl.className = "cal-evt-time";
				timeEl.textContent = e.start_time;
				t.appendChild(timeEl);
			}
			const bodyEl = document.createElement("span");
			bodyEl.className = "cal-evt-body";
			bodyEl.textContent = (e.service_name ? `${e.service_name} ` : "") + (e.client_name || "");
			t.appendChild(bodyEl);
			c.appendChild(t);
		});
		if (evts.length > 2) {
			const t = document.createElement("span");
			t.className = "cal-evt cal-evt-more";
			t.innerText = `+${evts.length - 2} 筆`;
			c.appendChild(t);
		}
		grid.appendChild(c);
	}
	const weeks = Math.ceil((first + total) / 7);
	grid.style.setProperty("--cal-week-count", String(weeks));
	const trailing = weeks * 7 - first - total;
	for (let i = 1; i <= trailing; i++) {
		const c = document.createElement("div");
		c.className = "cal-cell cal-other";
		c.innerHTML = `<span class="cal-day-num">${i}</span>`;
		grid.appendChild(c);
	}
}
function calRenderDay() {
	_syncCalendarDateControls();
	const selStr = _iso(calendarState.calSelected);
	const isViewer = !hasPerm("cal-mgmt");
	document.getElementById("cal-day-title").innerText = `${_fmtTW(calendarState.calSelected)} · 派工明細`;
	document.getElementById("cal-picker").value = selStr;
	const list = document.getElementById("cal-day-list");
	if (calendarState.calSearchMode) {
		calApplyRightPanelMode();
		if (calIsDesktopViewport()) calRenderSearchResults(calendarState.calSearchItems);
		else calRenderMobileSearchResults(calendarState.calSearchItems);
		return;
	}
	const dayEvents = calendarState.calEvents.filter((e) => e.date === selStr).sort((a, b) => (a.start_time || "99:99").localeCompare(b.start_time || "99:99"));
	const countEl = document.getElementById("cal-day-count");
	if (countEl) countEl.textContent = `${dayEvents.length} 筆派工`;
	calRenderKpi();
	calRenderHelper(dayEvents);
	if (!dayEvents.length) {
		list.className = "";
		list.innerHTML = `<div class="cal-empty-state"><div class="cal-empty-icon" aria-hidden="true">▣</div><strong>當天沒有其他派工</strong>${isViewer ? "" : "<p>點擊上方「＋ 新增派工」建立新的行程</p>"}</div>`;
		return;
	}
	list.className = "cal-timeline";
	list.innerHTML = dayEvents.map((e) => {
		const who = (e.assignees || []).map((p) => `<span class="cal-who"><span class="cal-who-dot" style="background:${esc(p.color) || CAL_PALETTE[0]}"></span>${esc(p.name || "")}</span>`).join(" ");
		const service = e.service_name ? `<span class="cal-service-badge cal-service-${esc(calServiceTone(e.service_name))}">${esc(e.service_name)}</span>` : "";
		const personal = calPersonalSync(e);
		const personalLabel = `${calSyncStatusLabel(personal.status)}${personal.migration_pending ? "（行事曆切換中）" : ""}`;
		const hasSyncErr = personal.error && [
			"failed",
			"partial_failed",
			"retrying",
			"partial_retrying"
		].includes(personal.status);
		const isAssigned = e.is_assigned_to_me !== false;
		const personalSync = isAssigned && personal.status && personal.status !== "none" ? hasSyncErr ? `<button type="button" class="cal-sync-status cal-sync-${esc(personal.status)} cal-sync-clickable" onclick="Calendar.calShowSyncError(${e.id})" title="點擊查看我的同步錯誤">${esc(calSyncStatusIcon(personal.status))}<span class="cal-sync-label">${esc(personalLabel)}</span></button>` : `<span class="cal-sync-status cal-sync-${esc(personal.status)}" title="${esc(personalLabel)}">${esc(calSyncStatusIcon(personal.status))}<span class="cal-sync-label">${esc(personalLabel)}</span></span>` : isAssigned ? "" : "";
		const myRetry = isAssigned && calCanRetryPersonal(personal) ? `<button type="button" class="btn btn--secondary btn--sm" onclick="Calendar.calRetryMySync(${e.id})">重試我的</button>` : "";
		const teamLabel = hasPerm("gcal-sync-team-view") ? calTeamSyncLabel(e.team_sync) : "";
		const teamSync = teamLabel ? `<button type="button" class="cal-sync-status cal-sync-team cal-sync-clickable" onclick="Calendar.calShowTeamSyncDetails(${e.id})" title="查看全員同步細節">${esc(teamLabel)}</button>` : "";
		const sync = personalSync || myRetry || teamSync ? `${personalSync}${myRetry}${teamSync}` : "";
		const updated = e.updated_by_name && e.updated_by_name !== (e.created_by_name || "系統") ? `<span>最後編輯：${esc(e.updated_by_name)}</span>` : "";
		return `
    <div class="cal-tl-row">
      <span class="cal-tl-dot"></span>
      <div class="cal-event-card">
        <div class="cal-event-top">
          <div class="cal-time"><span aria-hidden="true">⏰</span> ${esc(e.start_time || "未指定時間")}</div>
          <div class="cal-event-badges">${service}${sync}</div>
        </div>
        <div class="cal-client">${esc(e.client_name)}</div>
        ${who ? `<div class="cal-assignees">${who}</div>` : ""}
        ${e.address ? `<div class="cal-addr">📍 ${esc(e.address)}</div>` : ""}
        ${e.note ? `<div class="cal-note">${esc(e.note)}</div>` : ""}
        <div class="cal-event-footer">
          <div class="cal-created-meta"><span>建立：${esc(e.created_by_name || "系統")} · ${esc(calFmtCreatedAt(e.created_at))}</span>${updated}</div>
          ${isViewer ? "" : `<div class="cal-card-actions">
            <button class="btn btn--secondary btn--sm cal-icon-btn btn-edit" onclick="Calendar.calOpenAppt(${e.id})" aria-label="編輯派工" title="編輯派工"><span class="cal-action-icon">✏️</span><span class="cal-action-label">編輯</span></button>
            <button class="btn btn--danger btn--sm cal-icon-btn btn-delete" onclick="Calendar.calDeleteAppt(${e.id})" aria-label="刪除派工" title="刪除派工"><span class="cal-action-icon">🗑</span><span class="cal-action-label">刪除</span></button>
          </div>`}
        </div>
      </div>
    </div>`;
	}).join("");
}
function calChangeMonth(d) {
	appState.calMonth = new Date(appState.calMonth.getFullYear(), appState.calMonth.getMonth() + d, 1);
	calSetLoadState("loading");
	calLoadData().then((applied) => {
		if (applied === null) return;
		if (calendarState.calLoadError) return calSetLoadState("error", calendarState.calLoadError);
		calSetLoadState("ready");
		calRenderMonth();
		calRenderDay();
		calRenderKpi();
		calRenderLegend();
	});
	syncViewUrl();
}
function calPickToday() {
	calPickDate(_iso(/* @__PURE__ */ new Date()));
}
function calShiftDay(delta) {
	calPickDate(_iso(new Date(calendarState.calSelected.getFullYear(), calendarState.calSelected.getMonth(), calendarState.calSelected.getDate() + delta)));
}
function calPickDate(v) {
	const selected = _parseLocalDate(v);
	if (!selected || isNaN(selected.getTime())) return;
	calendarState.calSelected = selected;
	appState.calMonth = new Date(selected.getFullYear(), selected.getMonth(), 1);
	_syncCalendarDateControls();
	calSetLoadState("loading");
	calLoadData().then((applied) => {
		if (applied === null) return;
		if (calendarState.calLoadError) return calSetLoadState("error", calendarState.calLoadError);
		calSetLoadState("ready");
		calRenderMonth();
		calRenderDay();
		calRenderKpi();
		calRenderLegend();
	});
	syncViewUrl();
}
/**
* 匯出目前行事曆日期的 Excel；API 錯誤以可讀欄位訊息顯示。
* @returns {Promise<void>} 匯出成功後啟動下載，失敗時顯示提示。
*/
async function calExport() {
	const date = _iso(calendarState.calSelected);
	const mmdd = date.slice(5, 7) + date.slice(8, 10);
	try {
		await apiDownload(`/api/appointments/export?date=${date}`, {
			filename: `工程日報表${mmdd}.xlsx`,
			fallback: "匯出失敗"
		});
		toast(`📤 已匯出 工程日報表${mmdd}.xlsx`);
	} catch (e) {
		toast(e.status ? "❌ " + e.message : "⚠️ 匯出失敗：" + e.message);
	}
}
function calClearSearch() {
	document.getElementById("cal-search-to").value = "";
	document.getElementById("cal-search-q").value = "";
	calendarState.calSearchGuard.invalidate();
	calendarState.calSearchMode = false;
	calendarState.calSearchItems = [];
	calendarState.calSearchMeta = {
		from: "",
		to: "",
		q: ""
	};
	calendarState.calSearchState = "idle";
	calApplyRightPanelMode();
	_syncCalendarDateControls();
	calRenderDay();
}
function calJumpToDate(dateStr) {
	calendarState.calSearchGuard.invalidate();
	calendarState.calSearchMode = false;
	calendarState.calSearchItems = [];
	calendarState.calSearchMeta = {
		from: "",
		to: "",
		q: ""
	};
	calendarState.calSearchState = "idle";
	calApplyRightPanelMode();
	calPickDate(dateStr);
}
//#endregion
//#region static/js/features/calendar/appt-modal.js
var appt_modal_exports = /* @__PURE__ */ __exportAll({
	calDeleteAppt: () => calDeleteAppt,
	calModalHtml: () => calModalHtml,
	calOpenAppt: () => calOpenAppt,
	calRetryMySync: () => calRetryMySync,
	calRetryTeamMember: () => calRetryTeamMember,
	calRetryTeamSync: () => calRetryTeamSync,
	calShowSyncError: () => calShowSyncError,
	calShowTeamSyncDetails: () => calShowTeamSyncDetails,
	calSubmitAppt: () => calSubmitAppt,
	closeCalModal: () => closeCalModal
});
var calApptUpdatedAt = null;
function calModalHtml(isAdmin) {
	return `
  <div class="modal-overlay" data-role="modal" id="cal-appt-modal" style="display:none">
    <div class="modal">
      <h3 id="cal-appt-title">➕ 新增派工</h3>
      <div class="cal-conflict" id="cal-appt-conflict"></div>
      <input type="hidden" id="cal-f-id">
      <div class="form-row" style="display:none">  <!-- 負責人員已隱藏（2026-08-12 家豪指定：明細以新增者標示即可） -->
        <label>負責人員(選填)</label>
        <div class="cal-person-list" id="cal-f-users"></div>
      </div>
      <div class="form-row">
        <label>服務項目(選填)</label>
        <select id="cal-f-svc"></select>
      </div>
      <div class="form-row">
        <label>客戶姓名與戶號 / 案場*</label>
        <input type="text" id="cal-f-client" placeholder="例：林先生 (A棟 501號)">
      </div>
      <div class="form-row">
        <label>地址(選填)</label>
        <input type="text" id="cal-f-address" placeholder="例：新北市○○區○○路 ○○號">
      </div>
      <div class="form-row">
        <label>派工日期*</label><input type="date" id="cal-f-date">
      </div>
      <div class="form-row">
        <label>派工時間(選填)</label>
        <!-- 2026-08-13 Sarah：time input 在手機顯示 12 制（上午/下午）→ 改下拉式 24 制 -->
        <div class="cal-time-picker">
          <select id="cal-f-hour" aria-label="時"></select><span class="cal-time-colon">:</span>
          <select id="cal-f-minute" aria-label="分"></select>
        </div>
      </div>
      <div class="form-row">
        <label>備註(選填)</label>
        <textarea id="cal-f-note" rows="2" placeholder="例：車馬費 800 元"></textarea>
      </div>
      <div class="modal-actions">
        <button class="btn btn--secondary btn--md btn-cancel" onclick="Calendar.closeCalModal()">取消</button>
        <button class="btn btn--primary btn--md btn-confirm" onclick="Calendar.calSubmitAppt()">檢查並寫入</button>
      </div>
    </div>
  </div>
      <!-- 同步錯誤詳情 modal -->
  <div class="modal-overlay" data-role="modal" id="cal-sync-error-modal" onclick="if(event.target===this) UI.closeModal('cal-sync-error-modal')">
    <div class="modal">
      <h3>⚠️ 同步錯誤詳情</h3>
      <div class="cal-sync-err-detail">
        <div class="cal-sync-err-row"><span class="cal-sync-err-label">行程</span><span id="cal-sync-err-client"></span></div>
        <div class="cal-sync-err-row"><span class="cal-sync-err-label">日期</span><span id="cal-sync-err-date"></span></div>
        <div class="cal-sync-err-row"><span class="cal-sync-err-label">狀態</span><span id="cal-sync-err-status"></span></div>
        <div class="cal-sync-err-row"><span class="cal-sync-err-label">同步 Key</span><span id="cal-sync-err-key"></span></div>
        <div class="cal-sync-err-row"><span class="cal-sync-err-label">目標日曆</span><span id="cal-sync-err-cal"></span></div>
        <div class="cal-sync-err-row cal-sync-err-full"><span class="cal-sync-err-label">錯誤訊息</span><pre id="cal-sync-err-msg"></pre></div>
        <div class="cal-sync-err-suggestion" id="cal-sync-err-suggestion"></div>
      </div>
      <div class="modal-actions">
        <button class="btn btn--secondary btn--md btn-cancel" onclick="UI.closeModal('cal-sync-error-modal')">關閉</button>
      </div>
    </div>
  </div>
  <div class="modal-overlay" data-role="modal" id="cal-team-sync-modal" onclick="if(event.target===this) UI.closeModal('cal-team-sync-modal')">
    <div class="modal">
      <h3>👥 全員同步細節</h3>
      <div id="cal-team-sync-summary"></div>
      <div class="cal-sync-team-actions"><button id="cal-team-sync-retry-all" type="button" class="btn btn--primary btn--sm btn-sm btn-primary" onclick="Calendar.calRetryTeamSync()">重試全體</button></div>
      <div id="cal-team-sync-details" class="cal-sync-team-details"></div>
      <div class="modal-actions">
        <button class="btn btn--secondary btn--md btn-cancel" onclick="UI.closeModal('cal-team-sync-modal')">關閉</button>
      </div>
    </div>
  </div>`;
}
function calOpenAppt(id) {
	const f = id ? calendarState.calEvents.find((e) => e.id === id) : null;
	calApptUpdatedAt = f ? f.updated_at || null : null;
	document.getElementById("cal-appt-title").innerText = f ? "✏️ 編輯派工" : "➕ 新增派工";
	document.getElementById("cal-f-id").value = f ? f.id : "";
	document.getElementById("cal-appt-conflict").style.display = "none";
	const list = document.getElementById("cal-f-users");
	list.innerHTML = "";
	calendarState.calAssignable.forEach((p) => {
		const opt = document.createElement("label");
		opt.className = "cal-person-opt";
		opt.innerHTML = `<input type="checkbox" value="${p.id}" ${f && f.user_ids.includes(p.id) ? "checked" : ""}>
      <span class="cal-swatch" style="background:${esc(p.color) || CAL_PALETTE[0]}"></span><span>${esc(p.display_name || p.username)}</span>`;
		list.appendChild(opt);
	});
	const sel = document.getElementById("cal-f-svc");
	sel.innerHTML = "<option value=\"\">（未指定）</option>" + calendarState.calSvc.filter((s) => s.is_active).sort((a, b) => a.sort_order - b.sort_order).map((s) => `<option value="${s.id}" ${f && f.service_type_id === s.id ? "selected" : ""}>${esc(s.name)}</option>`).join("");
	document.getElementById("cal-f-client").value = f ? f.client_name : "";
	document.getElementById("cal-f-address").value = f ? f.address || "" : "";
	document.getElementById("cal-f-date").value = f ? f.date : _iso(calendarState.calSelected);
	const hSel = document.getElementById("cal-f-hour");
	hSel.innerHTML = "<option value=\"\">--</option>" + Array.from({ length: 24 }, (_, h) => {
		const hh = String(h).padStart(2, "0");
		return `<option value="${hh}">${hh}</option>`;
	}).join("");
	const mSel = document.getElementById("cal-f-minute");
	mSel.innerHTML = "<option value=\"\">--</option>" + Array.from({ length: 12 }, (_, i) => {
		const mm = String(i * 5).padStart(2, "0");
		return `<option value="${mm}">${mm}</option>`;
	}).join("");
	const t = f && f.start_time || "";
	hSel.value = t ? t.slice(0, 2) : "";
	mSel.value = t ? t.slice(3, 5) : "";
	document.getElementById("cal-f-note").value = f ? f.note || "" : "";
	document.getElementById("cal-appt-modal").style.display = "flex";
}
async function calSubmitAppt() {
	const id = document.getElementById("cal-f-id").value;
	const user_ids = id ? (calendarState.calEvents.find((e) => e.id === Number(id)) || {}).user_ids || [] : [];
	const hh = document.getElementById("cal-f-hour").value;
	const mm = document.getElementById("cal-f-minute").value;
	const timeVal = hh && mm ? hh + ":" + mm : "";
	const body = {
		client_name: document.getElementById("cal-f-client").value.trim(),
		address: document.getElementById("cal-f-address").value.trim(),
		service_type_id: document.getElementById("cal-f-svc").value ? Number(document.getElementById("cal-f-svc").value) : null,
		date: document.getElementById("cal-f-date").value,
		start_time: timeVal,
		end_time: timeVal,
		note: document.getElementById("cal-f-note").value.trim(),
		user_ids,
		updated_at: calApptUpdatedAt
	};
	const box = document.getElementById("cal-appt-conflict");
	const showErr = (msg) => {
		box.innerText = msg;
		box.style.display = "block";
	};
	if (!body.client_name) return showErr("⚠️ 請填客戶 / 案場");
	if (!body.date) return showErr("⚠️ 請選擇派工日期");
	try {
		await apiFetch(id ? `/api/appointments/${id}` : "/api/appointments", {
			method: id ? "PUT" : "POST",
			json: body,
			fallback: "儲存失敗"
		});
		closeCalModal();
		toast(id ? "✅ 行程已更新" : "✅ 行程已新增");
		calendarState.calSelected = new Date(body.date);
		appState.calMonth = new Date(body.date.slice(0, 4), Number(body.date.slice(5, 7)) - 1, 1);
		if (await calLoadData() === null) return;
		if (calendarState.calLoadError) {
			calSetLoadState("error", calendarState.calLoadError);
			return;
		}
		calRenderMonth();
		calRenderDay();
		syncViewUrl();
	} catch (e) {
		showErr(e.status ? e.message : "⚠️ 網路錯誤：" + e.message);
	}
}
async function calDeleteAppt(id) {
	if (!confirm("確定要刪除這筆派工紀錄嗎？")) return;
	try {
		await apiFetch(`/api/appointments/${id}`, { method: "DELETE" });
	} catch (e) {
		toast("❌ 刪除失敗");
		return;
	}
	toast("🗑 已刪除");
	if (await calLoadData() === null) return;
	if (calendarState.calLoadError) {
		calSetLoadState("error", calendarState.calLoadError);
		return;
	}
	calRenderMonth();
	calRenderDay();
}
function closeCalModal() {
	document.getElementById("cal-appt-modal").style.display = "none";
	const set = document.getElementById("cal-set-modal");
	if (set) set.style.display = "none";
}
function calShowSyncError(apptId) {
	const e = (typeof calendarState.calEvents !== "undefined" ? calendarState.calEvents : []).find((x) => x.id === apptId);
	if (!e) return;
	const personal = calPersonalSync(e);
	document.getElementById("cal-sync-err-client").textContent = e.client_name || "";
	document.getElementById("cal-sync-err-date").textContent = e.date || "";
	document.getElementById("cal-sync-err-status").textContent = `${calSyncStatusLabel(personal.status)}${personal.migration_pending ? "（行事曆切換中）" : ""}`;
	document.getElementById("cal-sync-err-key").textContent = personal.key_name || "（未知 Key）";
	document.getElementById("cal-sync-err-cal").textContent = personal.cal_id || "（未知日曆）";
	document.getElementById("cal-sync-err-msg").textContent = personal.error || "（無錯誤訊息）";
	let suggestion = "";
	if (personal.error && personal.error.includes("invalid_grant")) suggestion = "🔑 Service Account 金鑰已失效。請到 Google Cloud Console 重新產生 JSON 金鑰，再從系統設定 → Google 行事曆 Key 上傳新金鑰。";
	else if (personal.error && personal.error.includes("404")) suggestion = "📅 Calendar ID 可能不正確，或 Service Account 沒有該日曆的存取權限。請確認日曆已分享給 Service Account email。";
	else if (personal.error && personal.error.includes("network")) suggestion = "🌐 網路連線問題。請確認伺服器可連線到 Google API。";
	else suggestion = "請檢查 gcal_sync.log 取得完整錯誤資訊。";
	if (personal.migration_pending) suggestion = `📅 行事曆切換處理中，普通同步重試暫停。${suggestion ? ` ${suggestion}` : ""}`;
	document.getElementById("cal-sync-err-suggestion").textContent = suggestion;
	openModal("cal-sync-error-modal");
}
var calTeamSyncApptId = null;
function calShowTeamSyncDetails(apptId) {
	calTeamSyncApptId = apptId;
	const e = (typeof calendarState.calEvents !== "undefined" ? calendarState.calEvents : []).find((x) => x.id === apptId);
	const team = e && e.team_sync;
	if (!team) return;
	const summary = document.getElementById("cal-team-sync-summary");
	const details = document.getElementById("cal-team-sync-details");
	const retryAll = document.getElementById("cal-team-sync-retry-all");
	if (!summary || !details) return;
	summary.textContent = team.fallback_target_count && !team.eligible_people ? `同步至全部有效 Google 行事曆（${team.fallback_target_count} 個）` : team.eligible_people ? `有效同步人員：${team.synced_people}/${team.eligible_people} 已同步` : "目前沒有可用的 Google 行事曆，請先新增或啟用 Calendar Key";
	if (retryAll) retryAll.hidden = !hasPerm("gcal-sync-force") || !calTeamHasRetryableTarget(team);
	details.innerHTML = (team.details || []).map((person) => {
		const status = `${calSyncStatusLabel(person.status)}${person.migration_pending ? "（行事曆切換中）" : ""}`;
		const error = person.error ? `：${person.error}` : "";
		const retry = hasPerm("gcal-sync-force") && calCanRetryTeamPerson(person) ? `<button type="button" class="btn btn--secondary btn--sm btn-sm" onclick="Calendar.calRetryTeamMember(${esc(String(apptId))},${esc(String(person.user_id))})">重試</button>` : "";
		return `<div class="cal-sync-team-row"><strong>${esc(person.display_name)}</strong><span>${esc(status)}${esc(error)}</span>${retry}</div>`;
	}).join("") || "<div class=\"cal-sync-team-row\">目前沒有可用的 Google 行事曆，請先新增或啟用 Calendar Key</div>";
	const excluded = [];
	if (team.unbound_people) excluded.push(`未綁定 ${team.unbound_people} 人`);
	if (team.paused_people) excluded.push(`Key 已停用 ${team.paused_people} 人`);
	if (team.inactive_people) excluded.push(`帳號已停用 ${team.inactive_people} 人`);
	if (team.unknown_status_people) excluded.push(`未知狀態 ${team.unknown_status_people} 人`);
	if (excluded.length) {
		const extra = document.createElement("div");
		extra.className = "cal-sync-team-extra";
		extra.textContent = `${excluded.join("・")}（不計入比例）`;
		details.appendChild(extra);
	}
	openModal("cal-team-sync-modal");
}
async function calReloadAfterSyncAction() {
	if (await calLoadData() === null || calendarState.calLoadError) return;
	calRenderMonth();
	calRenderDay();
}
async function calRetryMySync(apptId) {
	try {
		await apiFetch(`/api/gcal-sync-queue/reset-mine?appt_id=${encodeURIComponent(apptId)}`, {
			method: "PUT",
			fallback: "重試我的同步失敗"
		});
	} catch (e) {
		toast("❌ " + e.message);
		return;
	}
	toast("🔄 已重設你的同步 Queue");
	await calReloadAfterSyncAction();
}
async function calRetryTeamMember(apptId, userId) {
	try {
		await apiFetch(`/api/gcal-sync-queue/reset-scope?appt_id=${encodeURIComponent(apptId)}&scope=user&target_user_id=${encodeURIComponent(userId)}`, {
			method: "PUT",
			fallback: "重試指定人員失敗"
		});
	} catch (e) {
		toast("❌ " + e.message);
		return;
	}
	toast("🔄 已重設指定人員的同步 Queue");
	closeModal("cal-team-sync-modal");
	await calReloadAfterSyncAction();
}
async function calRetryTeamSync() {
	if (!calTeamSyncApptId || !confirm("確定重試這筆行程的全部有效同步目標嗎？")) return;
	try {
		await apiFetch(`/api/gcal-sync-queue/reset-scope?appt_id=${encodeURIComponent(calTeamSyncApptId)}&scope=all`, {
			method: "PUT",
			fallback: "重試全體同步失敗"
		});
	} catch (e) {
		toast("❌ " + e.message);
		return;
	}
	toast("🔄 已重設這筆行程全部有效同步 Queue");
	closeModal("cal-team-sync-modal");
	await calReloadAfterSyncAction();
}
//#endregion
//#region static/js/features/inventory/batch-location.js
var batch_location_exports = /* @__PURE__ */ __exportAll({
	_allSelected: () => _allSelected,
	cancelBatch: () => cancelBatch,
	closeBatchConfirm: () => closeBatchConfirm,
	selectAllStocks: () => selectAllStocks,
	selectedStockIds: () => selectedStockIds,
	showBatchConfirm: () => showBatchConfirm,
	submitBatchLocation: () => submitBatchLocation,
	toggleBatchMode: () => toggleBatchMode,
	toggleStockSelect: () => toggleStockSelect
});
var selectedStockIds = /* @__PURE__ */ new Set();
function toggleBatchMode() {
	appState.batchMode = !appState.batchMode;
	selectedStockIds.clear();
	var bt = document.getElementById("batch-toggle");
	if (bt) bt.classList.toggle("is-active", appState.batchMode);
	document.getElementById("batch-num").textContent = 0;
	document.getElementById("batch-confirm").disabled = true;
	if (appState.batchMode) document.getElementById("batch-bar").classList.add("is-open");
	else document.getElementById("batch-bar").classList.remove("is-open");
	renderInventoryView();
}
function toggleStockSelect(stockId) {
	const numId = Number(stockId);
	if (String(stockId).startsWith("item-")) {
		const itemId = parseInt(String(stockId).replace("item-", ""));
		const item = appState.ALL_ITEMS.find((i) => i.id === itemId);
		if (item) {
			const allSelected = (item.stocks || []).every((s) => selectedStockIds.has(s.id));
			(item.stocks || []).forEach((s) => {
				if (allSelected) selectedStockIds.delete(s.id);
				else selectedStockIds.add(s.id);
			});
		}
	} else if (selectedStockIds.has(numId)) selectedStockIds.delete(numId);
	else selectedStockIds.add(numId);
	_syncBatchUI();
}
function selectAllStocks() {
	const allStocks = getFilteredInventoryItems().flatMap((i) => i.stocks || []);
	if (allStocks.length > 0 && allStocks.every((s) => selectedStockIds.has(s.id))) selectedStockIds.clear();
	else allStocks.forEach((s) => selectedStockIds.add(s.id));
	_syncBatchUI();
}
function _allSelected() {
	const allStocks = getFilteredInventoryItems().flatMap((i) => i.stocks || []);
	return allStocks.length > 0 && allStocks.every((s) => selectedStockIds.has(s.id));
}
function _syncBatchUI() {
	document.getElementById("batch-num").textContent = selectedStockIds.size;
	document.getElementById("batch-confirm").disabled = selectedStockIds.size === 0;
	document.getElementById("batch-bar").classList.toggle("is-open", selectedStockIds.size > 0);
	renderInventoryView();
}
function cancelBatch() {
	selectedStockIds.clear();
	document.getElementById("batch-bar").classList.remove("is-open");
	document.getElementById("batch-cabinet").value = "";
	document.getElementById("batch-sub").value = "";
	renderInventoryView();
}
function showBatchConfirm() {
	var cab = document.getElementById("batch-cabinet").value;
	if (!cab) {
		toast("⚠️ 請先選擇目標櫃子");
		return;
	}
	var sub = document.getElementById("batch-sub").value.trim();
	var target = sub ? cab + " | " + sub : cab;
	var targetDisplay = target;
	document.getElementById("batch-confirm-count").textContent = selectedStockIds.size;
	document.getElementById("batch-confirm-loc").textContent = targetDisplay;
	var details = [];
	appState.ALL_ITEMS.forEach(function(item) {
		(item.stocks || []).forEach(function(s) {
			if (selectedStockIds.has(s.id)) details.push("<div class=\"modal-item-row\"><span>" + esc(item.brand) + " " + esc(item.name) + "</span><span class=\"modal-item-from\">" + esc(s.location) + " → <b class=\"modal-item-to\">" + esc(target) + "</b></span></div>");
		});
	});
	document.getElementById("batch-confirm-items").innerHTML = details.join("");
	document.getElementById("batch-confirm-modal").classList.add("is-open");
}
function closeBatchConfirm() {
	document.getElementById("batch-confirm-modal").classList.remove("is-open");
}
async function submitBatchLocation() {
	var cab = document.getElementById("batch-cabinet").value;
	var sub = document.getElementById("batch-sub").value.trim();
	var target = sub ? cab + " | " + sub : cab;
	var targetDisplay = target;
	closeBatchConfirm();
	try {
		await apiFetch("/api/stocks/batch-location", {
			method: "POST",
			json: {
				stock_ids: Array.from(selectedStockIds),
				new_location: target
			},
			fallback: "批次更新失敗"
		});
		toast("✅ 已將 " + selectedStockIds.size + " 笌位置改為「" + targetDisplay + "」");
		cancelBatch();
		await loadData();
	} catch (e) {
		toast("⚠️ " + e.message, "error");
	}
}
//#endregion
//#region static/js/features/inventory/location-adjustments.js
var location_adjustments_exports = /* @__PURE__ */ __exportAll({
	cancelStockLocationPicker: () => cancelStockLocationPicker,
	openStockLocationPicker: () => openStockLocationPicker,
	queueInventoryAdjustment: () => queueInventoryAdjustment,
	queueStockLocationAdjustment: () => queueStockLocationAdjustment
});
/**
* Queue a quantity change with explicit multi-location targeting and save-in-flight protection.
* @param {Object} item - Inventory item with its persisted stock rows.
* @param {number} delta - Signed quantity change to queue.
* @returns {void}
*/
function queueInventoryAdjustment(item, delta) {
	if (inventoryState.savingAll) {
		toast("儲存中，請稍後再調整。", "info");
		return;
	}
	const amount = Math.round(Number(delta) * 1e3) / 1e3;
	if (!Number.isFinite(amount) || amount === 0) return;
	const stocks = Array.isArray(item.stocks) ? item.stocks : [];
	if (amount > 0 && stocks.length > 1) {
		openStockLocationPicker(item, amount);
		return;
	}
	if (applyPendingInventoryAdjustment(item, amount, null)) renderInventoryView();
}
/**
* Update the pending net delta and preserve selected stock allocations for saving.
* @param {Object} item - Inventory item whose aggregate quantity is changing.
* @param {number} delta - Signed quantity change.
* @param {number|null} stockId - Persisted target stock ID for a selected addition.
* @returns {boolean} Whether the pending change was accepted.
*/
function applyPendingInventoryAdjustment(item, delta, stockId) {
	const itemId = String(item.id);
	const next = Math.round(((Number(pending[itemId]) || 0) + delta) * 1e3) / 1e3;
	if (Number(item.qty) + next < 0) return false;
	if (delta < 0) {
		const stockIds = Object.keys(pendingByStock).filter(function(key) {
			return String(pendingByStock[key].itemId) === itemId;
		}).reverse();
		let remaining = -delta;
		for (const key of stockIds) {
			if (remaining <= 0) break;
			const entry = pendingByStock[key];
			const cancelled = Math.min(entry.delta, remaining);
			entry.delta = Math.round((entry.delta - cancelled) * 1e3) / 1e3;
			remaining = Math.round((remaining - cancelled) * 1e3) / 1e3;
			if (entry.delta <= 0) delete pendingByStock[key];
		}
	}
	if (stockId !== null && delta > 0) {
		const key = String(stockId);
		const entry = pendingByStock[key];
		if (entry && String(entry.itemId) !== itemId) {
			toast("位置資料已變更，請重新載入後再試", "error");
			return false;
		}
		pendingByStock[key] = {
			itemId: Number(item.id),
			delta: Math.round(((entry ? entry.delta : 0) + delta) * 1e3) / 1e3
		};
	}
	const hasSelectedStock = Object.keys(pendingByStock).some(function(key) {
		return String(pendingByStock[key].itemId) === itemId;
	});
	if (next === 0 && !hasSelectedStock) {
		delete pending[itemId];
		delete INVENTORY_PENDING_ITEMS[itemId];
	} else {
		pending[itemId] = next;
		INVENTORY_PENDING_ITEMS[itemId] = item;
	}
	return true;
}
/**
* Open a picker that lists each exact location before a positive multi-location adjustment.
* @param {Object} item - Item whose stock locations are offered.
* @param {number} delta - Positive amount to queue after selection.
* @returns {void}
*/
function openStockLocationPicker(item, delta) {
	const options = document.getElementById("stock-location-options");
	const title = document.getElementById("stock-location-title");
	const description = document.getElementById("stock-location-description");
	const stocks = (Array.isArray(item.stocks) ? item.stocks : []).filter(function(stock) {
		return Number.isSafeInteger(Number(stock.id));
	});
	if (!options || !title || !description || !stocks.length) {
		toast("找不到可選的位置，請重新載入品項", "error");
		return;
	}
	inventoryState.stockLocationPickerState = {
		itemId: Number(item.id),
		delta
	};
	const amount = Qty.format(delta, Qty.unitTypeOf(item.unit));
	title.textContent = "選擇入庫位置";
	description.textContent = "增加 " + amount + " " + (item.unit || "") + "，請選擇要放入的位置。";
	options.innerHTML = stocks.map(function(stock) {
		const location = stock.location || "未標示位置";
		const current = Qty.format(stock.qty || 0, Qty.unitTypeOf(item.unit));
		return "<button type=\"button\" class=\"stock-adjust-location-option\" onclick=\"Inventory.queueStockLocationAdjustment(" + Number(item.id) + "," + Number(stock.id) + ")\"><span class=\"stock-adjust-location-name\">" + esc(location) + "</span><span class=\"stock-adjust-location-qty\">目前 " + esc(current) + " " + esc(item.unit || "") + "</span></button>";
	}).join("");
	openModal("stock-location-modal");
}
/**
* Queue the selected location change and close the picker.
* @param {number} itemId - Inventory item ID.
* @param {number} stockId - Selected persisted stock ID.
* @returns {void}
*/
function queueStockLocationAdjustment(itemId, stockId) {
	if (inventoryState.savingAll) {
		toast("儲存中，請稍後再調整。", "info");
		return;
	}
	const state = inventoryState.stockLocationPickerState;
	const item = appState.ALL_ITEMS.find(function(candidate) {
		return Number(candidate.id) === Number(itemId);
	});
	const stock = item && Array.isArray(item.stocks) ? item.stocks.find(function(candidate) {
		return Number(candidate.id) === Number(stockId);
	}) : null;
	if (!state || Number(state.itemId) !== Number(itemId) || !stock) {
		toast("位置資料已變更，請重新載入後再試", "error");
		return;
	}
	if (!applyPendingInventoryAdjustment(item, state.delta, Number(stock.id))) return;
	inventoryState.stockLocationPickerState = null;
	closeModalForce("stock-location-modal");
	renderInventoryView();
}
/**
* Cancel location selection without changing the pending inventory quantity.
* @returns {void}
*/
function cancelStockLocationPicker() {
	inventoryState.stockLocationPickerState = null;
	closeModalForce("stock-location-modal");
}
//#endregion
//#region static/js/features/inventory/qty-dialog.js
var qty_dialog_exports = /* @__PURE__ */ __exportAll({
	openQtyDialog: () => openQtyDialog,
	qtydQuick: () => qtydQuick,
	setQtyDialogMode: () => setQtyDialogMode,
	submitQtyDialog: () => submitQtyDialog
});
var __qtyTargetId = null;
var __qtyMode = "add";
/**
* Open the quantity dialog, optionally exposing a direction choice for aggregate edits.
* @param {number} itemId - Inventory item identifier.
* @param {'add'|'sub'|'choose'} mode - Fixed direction or user-selected direction.
* @returns {void}
*/
function openQtyDialog(itemId, mode) {
	const item = (typeof appState.ALL_ITEMS !== "undefined" ? appState.ALL_ITEMS : []).find((i) => i.id === itemId);
	if (!item) return;
	__qtyTargetId = itemId;
	__qtyMode = mode === "sub" ? "sub" : "add";
	const direction = document.getElementById("qtyd-direction");
	if (direction) direction.hidden = mode !== "choose";
	const cur = item.qty + (pending[itemId] || 0);
	document.getElementById("qtyd-cur").value = Qty.formatWithUnit(Math.round(cur * 1e3) / 1e3, item.unit, Qty.unitTypeOf(item.unit));
	document.getElementById("qtyd-name").value = (item.brand ? item.brand + " " : "") + (item.name || "");
	const inp = document.getElementById("qtyd-input");
	inp.value = "";
	inp.placeholder = "例如 1/4、1/3、0.5、1";
	setQtyDialogMode(__qtyMode);
	openModal("qty-dialog");
	setTimeout(() => inp.focus(), 50);
}
/**
* Set the quantity dialog direction and synchronize its accessible controls.
* @param {'add'|'sub'} mode - Direction to select.
* @returns {void}
*/
function setQtyDialogMode(mode) {
	__qtyMode = mode === "sub" ? "sub" : "add";
	const title = document.getElementById("qtyd-title");
	if (title) title.textContent = __qtyMode === "add" ? "➕ 增加庫存" : "➖ 減少庫存";
	const addButton = document.getElementById("qtyd-mode-add");
	const subButton = document.getElementById("qtyd-mode-sub");
	if (addButton) {
		addButton.setAttribute("aria-pressed", String(__qtyMode === "add"));
		addButton.classList.toggle("is-active", __qtyMode === "add");
	}
	if (subButton) {
		subButton.setAttribute("aria-pressed", String(__qtyMode === "sub"));
		subButton.classList.toggle("is-active", __qtyMode === "sub");
	}
}
function qtydQuick(v) {
	document.getElementById("qtyd-input").value = v;
	document.getElementById("qtyd-input").focus();
}
/**
* Validate the entered amount, then queue it through the same location-aware adjustment flow.
* @returns {void}
*/
function submitQtyDialog() {
	if (inventoryState.savingAll) {
		toast("儲存中，請稍後再調整。", "info");
		return;
	}
	const item = (typeof appState.ALL_ITEMS !== "undefined" ? appState.ALL_ITEMS : []).find((i) => Number(i.id) === Number(__qtyTargetId));
	if (!item) {
		closeModalForce("qty-dialog");
		return;
	}
	const raw = document.getElementById("qtyd-input").value;
	const parsed = Qty.validFor(raw, Qty.inputTypeOf(item.unit));
	if (!parsed.ok) {
		toast(parsed.error, "error");
		return;
	}
	if (parsed.value <= 0) {
		toast("增減數量必須大於 0。", "error");
		return;
	}
	const signed = __qtyMode === "add" ? parsed.value : -parsed.value;
	const current = pending[item.id] || 0;
	if (item.qty + current + signed < 0) {
		toast("減少後庫存不可為負數。", "error");
		return;
	}
	closeModalForce("qty-dialog");
	queueInventoryAdjustment(item, signed);
}
//#endregion
//#region static/js/features/inventory/adjust.js
var adjust_exports = /* @__PURE__ */ __exportAll({
	changeQty: () => changeQty,
	quickSet: () => quickSet,
	saveAll: () => saveAll,
	updateSaveBar: () => updateSaveBar
});
/**
* Save aggregate and explicitly targeted stock adjustments without discarding partial successes.
* @returns {Promise<void>}
*/
async function saveAll() {
	if (inventoryState.savingAll) return;
	const ids = Object.keys(pending);
	if (!ids.length) return;
	inventoryState.savingAll = true;
	const button = document.getElementById("btn-save");
	if (button) button.disabled = true;
	let ok = 0;
	let fail = 0;
	try {
		for (const id of ids) {
			const changes = Object.entries(pendingByStock).filter(([, entry]) => String(entry.itemId) === String(id)).map(([stockId, entry]) => ({
				stockId,
				delta: entry.delta
			}));
			const selectedTotal = changes.reduce((sum, change) => sum + change.delta, 0);
			const globalDelta = Math.round(((Number(pending[id]) || 0) - selectedTotal) * 1e3) / 1e3;
			const operations = [];
			if (globalDelta !== 0) operations.push({
				url: `/api/items/${id}/adjust`,
				delta: globalDelta,
				stockId: null
			});
			changes.forEach((change) => operations.push({
				url: `/api/stocks/${change.stockId}/adjust`,
				delta: change.delta,
				stockId: change.stockId
			}));
			operations.sort((left, right) => Number(left.delta < 0) - Number(right.delta < 0));
			for (const operation of operations) try {
				await apiFetch(operation.url, {
					method: "POST",
					json: {
						delta: operation.delta,
						reason: "手動調整"
					}
				});
				ok++;
				pending[id] = Math.round(((Number(pending[id]) || 0) - operation.delta) * 1e3) / 1e3;
				if (operation.stockId !== null) {
					const current = pendingByStock[operation.stockId];
					if (current) {
						current.delta = Math.round((current.delta - operation.delta) * 1e3) / 1e3;
						if (current.delta <= 0) delete pendingByStock[operation.stockId];
					}
				}
			} catch (error) {
				fail++;
			}
		}
		Object.keys(pending).forEach(function(id) {
			const hasSelectedStock = Object.keys(pendingByStock).some(function(stockId) {
				return String(pendingByStock[stockId].itemId) === String(id);
			});
			if (Math.abs(Number(pending[id]) || 0) < 5e-4 && !hasSelectedStock) {
				delete pending[id];
				delete INVENTORY_PENDING_ITEMS[id];
			}
		});
		await loadData();
		if (fail === 0) toast(`✅ 已儲存 ${ok} 項庫存調整`, "success");
		else toast(`⚠️ ${ok} 成功，${fail} 失敗——失敗調整已保留，可修正後再儲存`, "error");
	} finally {
		inventoryState.savingAll = false;
		if (button) button.disabled = false;
	}
}
/**
* Queue a +/- adjustment while preventing new modal flows during a save batch.
* @param {number} id - Inventory item ID.
* @param {number} delta - Signed quantity change.
* @returns {void}
*/
function changeQty(id, delta) {
	if (inventoryState.savingAll) {
		toast("儲存中，請稍後再調整。", "info");
		return;
	}
	const item = appState.ALL_ITEMS.find(function(candidate) {
		return Number(candidate.id) === Number(id);
	});
	if (!item) return;
	if (Qty.inputTypeOf(item.unit) !== "integer") {
		openQtyDialog(id, delta > 0 ? "add" : "sub");
		return;
	}
	queueInventoryAdjustment(item, delta);
}
/**
* Open a direction dialog for multi-location items or set a single-location total.
* @param {number} id - Inventory item ID.
* @returns {void}
*/
function quickSet(id) {
	if (inventoryState.savingAll) {
		toast("儲存中，請稍後再調整。", "info");
		return;
	}
	const item = appState.ALL_ITEMS.find(function(candidate) {
		return Number(candidate.id) === Number(id);
	});
	if (!item) return;
	if (Array.isArray(item.stocks) && item.stocks.length > 1) {
		openQtyDialog(id, "choose");
		return;
	}
	const currentDelta = Number(pending[id] || 0);
	const current = Number(item.qty) + currentDelta;
	const input = prompt(`輸入「${item.name}」的新數量：`, current);
	if (input === null) return;
	let value;
	const parsed = Qty.validFor(input, Qty.inputTypeOf(item.unit));
	if (!parsed.ok) {
		toast(parsed.error, "error");
		return;
	}
	value = parsed.value;
	const desiredDelta = Math.round((value - item.qty) * 1e3) / 1e3;
	queueInventoryAdjustment(item, Math.round((desiredDelta - currentDelta) * 1e3) / 1e3);
}
function updateSaveBar() {
	const n = Object.keys(pending).length;
	const bar = document.getElementById("save-bar");
	if (n > 0 && appState.currentTab === "inventory") {
		bar.classList.add("is-open");
		document.getElementById("pending-count").textContent = n;
	} else bar.classList.remove("is-open");
}
//#endregion
//#region static/js/features/prepared/page.js
var page_exports$5 = /* @__PURE__ */ __exportAll({
	clearPrepared: () => clearPrepared,
	renderKitSubItemsMobile: () => renderKitSubItemsMobile,
	renderPrepared: () => renderPrepared,
	toggleKitSubItems: () => toggleKitSubItems,
	updatePreparedBadge: () => updatePreparedBadge
});
function renderPreparedPageHeader(itemCount, totalPrepared, isViewer) {
	const addButton = isViewer ? "" : "<button class=\"btn btn--primary btn--md btn-add-inv\" onclick=\"Stockout.openNonStockPrepareModal()\">＋ 新增待領出</button>";
	return `<section class="prepared-page-header">
    <div class="prepared-heading-copy">
      <div class="prepared-heading-icon" aria-hidden="true">📤</div>
      <div><h1>待領出 <span>（已拿出未出去）</span></h1><p>管理已拿出的品項，真正出去時按「已領出」才會扣庫存，也可以退回。</p></div>
    </div>
    <div class="prepared-header-actions">
      <div class="prepared-summary-card ui-kpi-card ui-kpi-card--inline ui-kpi-card--purple prepared-summary-purple"><span class="ui-kpi-icon" aria-hidden="true">📤</span><div class="ui-kpi-body"><span class="ui-kpi-label">待領出品項</span><strong class="ui-kpi-value">${esc(String(itemCount))}</strong><span class="ui-kpi-meta">目前篩選結果</span></div></div>
      <div class="prepared-summary-card ui-kpi-card ui-kpi-card--inline ui-kpi-card--blue prepared-summary-blue"><span class="ui-kpi-icon" aria-hidden="true">📦</span><div class="ui-kpi-body"><span class="ui-kpi-label">待領出總件數</span><strong class="ui-kpi-value">${esc(String(absNum(totalPrepared)))}</strong><span class="ui-kpi-meta">目前待領出合計</span></div></div>
      ${addButton}
    </div>
  </section>
  <div class="prepared-alert" role="note">💡 <b>待領出不會扣庫存</b>，請確認真正出去時再按「已領出」。</div>`;
}
function renderKitSubItems(item) {
	if (!item.is_kit || !item.components || !item.components.length) return "";
	let html = "<tr class=\"kit-subitems-row\"><td colspan=\"6\"><div class=\"kit-subitems-toggle\" onclick=\"Prepared.toggleKitSubItems(this)\">";
	html += "<span class=\"kit-subitems-arrow\" data-role=\"kit-subitems-arrow\">▶</span> 整組包含 " + item.components.length + " 個品項";
	html += "</div><div class=\"kit-subitems-list\" style=\"display:none\">";
	item.components.forEach((c) => {
		const photo = c.has_photo ? "<img src=\"" + photoSrc(c.item_id, "thumbnail") + "\" class=\"prepared-kit-thumb\" loading=\"lazy\" onclick=\"Inventory.openPhotoLightbox(" + c.item_id + ")\">" : "<div class=\"prepared-kit-thumb prepared-kit-thumb--empty\">📷</div>";
		html += "<div class=\"kit-subitem\">";
		html += photo;
		html += "<span class=\"kit-subitem-name\">" + esc(c.brand || "") + " " + esc(c.name) + "</span>";
		html += "<span class=\"kit-subitem-code\">" + (c.code ? esc(c.code) : "") + "</span>";
		html += "<span class=\"kit-subitem-qty\">×" + c.need_qty + " " + esc(c.unit || "個") + "</span>";
		html += "</div>";
	});
	html += "</div></td></tr>";
	return html;
}
function renderKitSubItemsMobile(item) {
	if (!item.is_kit || !item.components || !item.components.length) return "";
	let html = "<div class=\"kit-subitems-mobile-wrap\">";
	html += "<div class=\"kit-subitems-toggle\" onclick=\"Prepared.toggleKitSubItems(this)\">";
	html += "<span class=\"kit-subitems-arrow\" data-role=\"kit-subitems-arrow\">▶</span> 整組包含 " + item.components.length + " 個品項";
	html += "</div><div class=\"kit-subitems-list\" style=\"display:none\">";
	item.components.forEach((c) => {
		const photo = c.has_photo ? "<img src=\"" + photoSrc(c.item_id, "thumbnail") + "\" class=\"prepared-kit-thumb\" loading=\"lazy\" onclick=\"Inventory.openPhotoLightbox(" + c.item_id + ")\">" : "<div class=\"prepared-kit-thumb prepared-kit-thumb--empty\">📷</div>";
		html += "<div class=\"kit-subitem\">";
		html += photo;
		html += "<span class=\"kit-subitem-name\">" + esc(c.brand || "") + " " + esc(c.name) + "</span>";
		html += "<span class=\"kit-subitem-code\">" + (c.code ? esc(c.code) : "") + "</span>";
		html += "<span class=\"kit-subitem-qty\">×" + c.need_qty + " " + esc(c.unit || "個") + "</span>";
		html += "</div>";
	});
	html += "</div></div>";
	return html;
}
function toggleKitSubItems(el) {
	const list = el.nextElementSibling;
	const arrow = el.querySelector("[data-role=\"kit-subitems-arrow\"]");
	if (list.style.display === "none") {
		list.style.display = "block";
		arrow.textContent = "▼";
	} else {
		list.style.display = "none";
		arrow.textContent = "▶";
	}
}
function kitModelHTML(item) {
	if (item.is_kit && item.components && item.components.length) {
		if (item.code) return "型號： " + esc(item.code) + " · 整組 " + item.components.length + " 項";
		return "整組 · " + item.components.length + " 個品項";
	}
	return item.code ? "型號： " + esc(item.code) : "";
}
function renderPreparedDesktopRow(item, isViewer) {
	const photo = item.has_photo ? `<img class="prepared-photo" src="${photoSrc(item.id, "thumbnail")}" alt="" loading="lazy" onclick="Inventory.openPhotoLightbox(${item.id})" title="點擊看大圖">` : "<div class=\"prepared-photo prepared-photo-empty\" aria-hidden=\"true\">📷</div>";
	const nonStock = item.is_deleted ? "<span class=\"tag-nonstock\">非庫存</span>" : "";
	const location = item.location || "未標示";
	const actions = isViewer ? "" : `<td class="prepared-actions-cell"><div class="prepared-row-actions">
    <button class="btn btn--secondary btn--sm btn-prepare" onclick="Stockout.openPreparedEditModal(${item.id})">✏️ 編輯</button>
    <button class="btn btn--out btn--sm btn-out" onclick="Stockout.openPreparedOutModal(${item.id})">🚚 已領出</button>
    ${item.is_deleted ? "" : `<button class="btn btn--secondary btn--sm btn-prepare" onclick="Stockout.returnPrepared(${item.id})">↩ 退回</button>`}
    <button class="btn btn--danger btn--sm btn-del" onclick="Prepared.clearPrepared(${item.id}, ${item.prepared_qty})">🗑 刪除</button>
  </div></td>`;
	return `<tr class="prepared-row">
    <td class="prepared-photo-cell">${photo}</td>
    <td class="prepared-item-cell"><div class="prepared-item-name">${esc(item.brand || "無廠牌")} ${esc(item.name || "未命名")} ${nonStock}</div>
      <div class="prepared-item-model">${kitModelHTML(item)}</div>
      <div class="prepared-item-location">📍 ${esc(location)}</div>
      ${item.destination ? "<div class=\"prepared-item-dest\">📋 " + esc(item.destination) + "</div>" : ""}</td>
    <td class="prepared-quantity-cell"><span class="prepared-qty-badge">📦 ${Qty.disp(item.prepared_qty, item.unit)} <small>${esc(item.unit)}</small></span></td>
    <td class="prepared-stock-cell"><span class="prepared-stock-badge">目前庫存 ${Qty.disp(item.qty, item.unit)} <small>${esc(item.unit)}</small></span></td>
    ${actions}
  </tr>${renderKitSubItems(item)}`;
}
var preparedRenderGuard = createRequestGuard();
async function renderPrepared() {
	const renderRequestId = preparedRenderGuard.next();
	const siteAtRequest = appState.currentSite;
	const content = document.getElementById("content");
	const isViewer = !hasPerm("stockout");
	content.innerHTML = "<div class=\"loading\"><div class=\"spin\"></div><div>載入待領出清單…</div></div>";
	try {
		let items = await apiFetch(`/api/prepared?site=${siteAtRequest}`);
		if (!preparedRenderGuard.isCurrent(renderRequestId) || appState.currentTab !== "prepared" || siteAtRequest !== appState.currentSite) return;
		appState.preparedItems = items;
		items = filterBySearch(items, function(i) {
			return [
				i.name,
				i.code,
				i.brand,
				i.note,
				i.destination
			].join(" ");
		});
		const totalPrepared = items.reduce((s, i) => s + (Number(i.prepared_qty) || 0), 0);
		let html = renderPreparedPageHeader(items.length, totalPrepared, isViewer);
		if (!items.length) {
			html += `<section class="prepared-panel"><div class="prepared-empty-state">
        <div class="prepared-empty-icon" aria-hidden="true">📦</div>
        <h2>目前沒有待領出的品項</h2>
        <p>拿出商品後，可以在這裡管理尚未正式出庫的項目。</p>
        ${isViewer ? "" : "<button class=\"btn btn--primary btn--md btn-add-inv\" onclick=\"Stockout.openNonStockPrepareModal()\">＋ 新增待領出</button>"}
      </div></section>`;
			content.innerHTML = html;
			updatePreparedBadge(0);
			return;
		}
		const isM = isMobileView();
		html += `<section class="prepared-panel">
      <div class="prepared-toolbar"><div><strong>待領出清單</strong><span>共 ${items.length} 筆</span></div></div>`;
		if (isM) {
			html += "<div class=\"prepared-mobile-list\">";
			items.forEach(function(item) {
				const qtyText = String(Qty.disp(item.prepared_qty, item.unit));
				const stockText = String(Qty.disp(item.qty, item.unit));
				html += mobileCardShell({
					reverted: false,
					cardClass: "prepared-mobile-card",
					moreBtnHTML: "",
					thumb: buildThumb(item.id, item.has_photo, item.name, "📷"),
					nameHTML: `<span class="prepared-mobile-name">${esc(item.brand || "無廠牌")} ${esc(item.name || "未命名")}</span>${item.is_deleted ? "<span class=\"tag-nonstock\">非庫存</span>" : ""}`,
					subHTML: `<span class="prepared-mobile-model">${kitModelHTML(item)}</span>`,
					extraHTML: `<div class="prepared-mobile-location">📍 ${esc(item.location || "未標示")}</div>${item.destination ? "<div class=\"prepared-card-dest\">📋 " + esc(item.destination) + "</div>" : ""}`,
					qtyHTML: `<div class="prepared-mobile-qty"><b>${esc(qtyText)}</b><small>待領出 ${esc(item.unit)}</small></div>`,
					actionsHTML: renderKitSubItemsMobile(item) + `<div class="prepared-mobile-meta"><span class="prepared-mobile-stock">庫存 ${esc(stockText)} ${esc(item.unit)}</span>${isViewer ? "" : `<button class="btn btn--out btn--sm" onclick="Stockout.openPreparedOutModal(${item.id})">🚚 已領出</button><button class="btn btn--secondary btn--sm" onclick="Prepared.openPreparedSheet(${item.id})" aria-label="更多操作">⋯</button>`}</div>`
				});
			});
			html += "</div>";
		} else {
			html += `<div class="prepared-table-wrap"><table class="prepared-table"><thead><tr>
        <th class="prepared-col-photo">照片</th><th>品項資訊</th><th class="prepared-col-qty">待領出</th><th class="prepared-col-stock">庫存</th>${isViewer ? "" : "<th class=\"prepared-col-actions\">操作</th>"}
      </tr></thead><tbody>`;
			items.forEach(function(item) {
				html += renderPreparedDesktopRow(item, isViewer);
			});
			html += "</tbody></table></div>";
		}
		html += "</section>";
		content.innerHTML = html;
		updatePreparedBadge(items.length);
	} catch (e) {
		if (!preparedRenderGuard.isCurrent(renderRequestId) || appState.currentTab !== "prepared" || siteAtRequest !== appState.currentSite) return;
		content.innerHTML = `<div class="prepared-error-state"><div class="prepared-error-icon">⚠️</div><h2>載入待領出資料失敗</h2><p>${esc(e.message || "請稍後再試")}</p><button class="btn btn--secondary btn--md btn-cancel" onclick="Prepared.renderPrepared()">重新載入</button></div>`;
	}
}
function updatePreparedBadge(n) {
	var sbBadge = document.getElementById("sb-prepared-badge");
	if (n > 0) {
		if (sbBadge) {
			sbBadge.style.display = "";
			sbBadge.textContent = n;
		}
	} else if (sbBadge) sbBadge.style.display = "none";
}
async function clearPrepared(itemId, qty) {
	if (!confirm("確定刪除這筆待領出（" + qty + " 件）？不會影響庫存。")) return;
	try {
		await apiFetch(`/api/items/${itemId}/prepared-return`, {
			method: "POST",
			json: {
				qty,
				location: ""
			},
			fallback: "刪除失敗"
		});
		toast("✅ 已刪除待領出", "success");
		await loadData();
	} catch (e) {
		toast("⚠️ " + e.message, "error");
	}
}
//#endregion
//#region static/js/core/site-label.js
var site_label_exports = /* @__PURE__ */ __exportAll({ inventorySiteLabel: () => inventorySiteLabel });
/**
* 將內部庫存區識別值轉換為使用者介面顯示名稱。
* @param {string} site 內部庫存區識別值或使用者提供的位置文字。
* @returns {string} 顯示名稱；若無法識別，則原樣保留輸入文字。
*/
function inventorySiteLabel(site) {
	return {
		office: "公司",
		warehouse: "倉庫",
		van: "廂型車",
		truck: "貨車"
	}[site] || site || "";
}
//#endregion
//#region static/js/features/stockout/state.js
var state_exports$2 = /* @__PURE__ */ __exportAll({ stockoutState: () => stockoutState });
var stockoutState = {
	outItemId: null,
	prepareItemId: null,
	preparedOutItemId: null,
	stockoutRecords: [],
	stockoutDateFrom: "",
	stockoutDateTo: "",
	stockoutPageSearch: "",
	editStockoutId: null
};
//#endregion
//#region static/js/features/stockout/page.js
var page_exports$4 = /* @__PURE__ */ __exportAll({
	clearStockoutFilters: () => clearStockoutFilters,
	deleteStockoutRecord: () => deleteStockoutRecord,
	renderStockOuts: () => renderStockOuts,
	setStockoutFilter: () => setStockoutFilter
});
function filterStockoutRecords(records) {
	const searchInput = document.getElementById("search-input");
	const globalSearchQuery = searchInput ? String(searchInput.value || "").trim() : "";
	const query = String(stockoutState.stockoutPageSearch || globalSearchQuery).trim().toLowerCase();
	const keywords = query ? query.split(/\s+/).filter(function(word) {
		return word.length > 0;
	}) : [];
	return (keywords.length ? records.filter(function(o) {
		const haystack = [
			o.name,
			o.item_name,
			o.code,
			o.brand,
			o.destination,
			o.note,
			o.return_site,
			o.return_location
		].join(" ").toLowerCase();
		return keywords.every(function(keyword) {
			return haystack.includes(keyword);
		});
	}) : records).filter(function(o) {
		const date = String(o.created_at || "").slice(0, 10);
		return (!stockoutState.stockoutDateFrom || date >= stockoutState.stockoutDateFrom) && (!stockoutState.stockoutDateTo || date <= stockoutState.stockoutDateTo);
	});
}
function getStockoutKpis(records) {
	const active = records.filter(function(o) {
		return !o.reverted_at && o.reason !== "退回已領出";
	});
	return {
		recordCount: records.length,
		totalOutbound: active.reduce(function(sum, o) {
			return sum + Math.abs(o.delta);
		}, 0),
		dateGroupCount: new Set(records.map(function(o) {
			return String(o.created_at || "").slice(0, 10);
		})).size,
		uniqueItemCount: new Set(records.map(function(o) {
			return o.item_id;
		})).size
	};
}
function formatStockoutDate(dateValue) {
	const date = String(dateValue || "").slice(0, 10);
	const parts = date.split("-").map(Number);
	const weekday = parts.length === 3 && parts.every(Number.isFinite) ? [
		"日",
		"一",
		"二",
		"三",
		"四",
		"五",
		"六"
	][new Date(parts[0], parts[1] - 1, parts[2]).getDay()] : "";
	return weekday ? `${date}（星期${weekday}）` : date;
}
/**
* Build desktop actions with callbacks to the modal-layer handlers.
* @param {object} o Stockout record.
* @param {boolean} isViewer Whether mutation actions are forbidden.
* @returns {string} Escaped action-button HTML.
*/
function renderStockoutActions(o, isViewer) {
	if (isViewer) return "";
	const reverted = !!o.reverted_at;
	if (o.reason === "退回已領出") return reverted ? "" : `<button type="button" class="btn btn--secondary btn--sm" onclick="Stockout.openEditStockoutReturnModal(${o.id})">✏️ 編輯</button><button type="button" class="btn btn--danger btn--sm" onclick="Stockout.deleteStockoutReturn(${o.id})">撤銷退回</button>`;
	if (reverted) return `<button type="button" class="btn btn--danger btn--sm" onclick="Stockout.deleteStockoutRecord(${o.id})">刪除</button>`;
	return `<button type="button" class="btn btn--secondary btn--sm" onclick="Stockout.openEditStockoutModal(${o.id})">✏️ 編輯</button><button type="button" class="btn btn--secondary btn--sm" onclick="Stockout.returnStockout(${o.id})">↩️ 退回</button><button type="button" class="btn btn--danger btn--sm" onclick="Stockout.deleteStockoutRecord(${o.id})">刪除</button>`;
}
/**
* 以桌面列呈現一筆記錄，並顯示轉換後的退回庫存區名稱。
* @param {object} o 出庫記錄物件。
* @param {boolean} isViewer 是否為僅檢視者；若是，則不提供異動操作。
* @returns {string} 已跳脫 HTML 的記錄列字串。
*/
function renderStockoutDesktopRow(o, isViewer) {
	const reverted = !!o.reverted_at;
	const isReturn = o.reason === "退回已領出";
	const returnReverted = isReturn && reverted;
	const rowClass = returnReverted ? "is-reverted-return" : isReturn ? "is-return" : reverted ? "is-reverted" : "";
	const photo = o.has_photo ? `<img class="so-photo stockout-photo" src="${photoSrc(o.item_id, "thumbnail")}" alt="" loading="lazy" onclick="Inventory.openPhotoLightbox(${o.item_id})" title="點擊看大圖">` : "<div class=\"so-photo stockout-photo stockout-photo-empty\">📷</div>";
	const destination = o.destination ? `<span class="stockout-destination-badge">🏢 ${esc(o.destination)}</span>` : "";
	const returnSite = inventorySiteLabel(o.return_site || "");
	const returnSeparator = returnSite ? "／" : "";
	const returnLocation = isReturn && o.return_location ? `<span class="stockout-destination-badge return-location">📍 ${esc(returnSite)}${esc(returnSeparator)}${esc(o.return_location)}</span>` : "";
	const returned = returnReverted ? "<span class=\"stockout-returned-badge revoked\">↩️ 已撤銷退回</span>" : isReturn ? "<span class=\"stockout-returned-badge\">↩️ 已退回</span>" : reverted ? "<span class=\"stockout-returned-badge revoked\">已撤銷</span>" : "";
	const quantityClass = returnReverted ? "is-revoked" : isReturn ? "qty-pos" : "qty-neg";
	return `<tr class="stockout-record-row ${esc(rowClass)}"><td>${photo}</td><td><div class="stockout-item-name">${esc(o.brand)} ${esc(o.item_name)}${o.item_deleted ? "<span class=\"tag-nonstock\">非庫存</span>" : ""}${returned}</div>${o.code ? `<small class="stockout-item-meta">型號 ${esc(o.code)}</small>` : ""}${o.note ? `<small class="stockout-note">📝 ${esc(o.note)}</small>` : ""}</td><td class="stockout-qty ${esc(quantityClass)}">${isReturn ? "+" : "-"}${esc(Qty.disp(o.delta, o.unit))} ${esc(o.unit)}</td><td><div class="stockout-destination">${destination}${returnLocation}</div>${!destination && !returnLocation ? "<span class=\"muted\">—</span>" : ""}</td><td><div class="stockout-actions">${renderStockoutActions(o, isViewer)}</div></td></tr>`;
}
/**
* 以行動版卡片呈現一筆記錄，並顯示轉換後的退回庫存區名稱。
* @param {object} o 出庫記錄物件。
* @param {boolean} isViewer 是否為僅檢視者；若是，則不提供異動操作。
* @returns {string} 已跳脫 HTML 的記錄卡片字串。
*/
function renderStockoutMobileCard(o, isViewer) {
	const reverted = !!o.reverted_at;
	const isReturn = o.reason === "退回已領出";
	const returnReverted = isReturn && reverted;
	const returned = returnReverted ? "<span class=\"stockout-returned-badge revoked\">↩️ 已撤銷退回</span>" : isReturn ? "<span class=\"stockout-returned-badge\">↩️ 已退回</span>" : reverted ? "<span class=\"stockout-returned-badge revoked\">已撤銷</span>" : "";
	const returnSite = inventorySiteLabel(o.return_site || "");
	return mobileCardShell({
		reverted,
		moreBtnHTML: `<button class="more-btn" onclick="Stockout.openStockoutSheet(${o.id})">⋯</button>`,
		thumb: buildThumb(o.item_id, o.has_photo, o.item_name, "📷"),
		nameHTML: `${esc(o.brand)} ${esc(o.item_name)}${o.item_deleted ? "<span class=\"tag-nonstock\">非庫存</span>" : ""}${o.code ? `<small class="stockout-item-meta">型號 ${esc(o.code)}</small>` : ""}${returned}`,
		subHTML: esc(String(o.created_at || "").slice(5, 10)),
		extraHTML: `${o.destination ? `<div><span class="loc-tag">🏢 ${esc(o.destination)}</span></div>` : ""}${isReturn && o.return_location ? `<div><span class="loc-tag">📍 ${esc(returnSite)}${esc(returnSite ? "／" : "")}${esc(o.return_location)}</span></div>` : ""}`,
		noteHTML: o.note ? `<div class="item-note"><span class="item-note-label">📝 註解: </span><span class="item-note-text">${esc(o.note)}</span></div>` : "",
		qtyHTML: buildQtyNum((isReturn ? "+" : "-") + absNum(o.delta), o.unit, returnReverted ? "is-revoked" : isReturn ? "qty-pos" : "qty-neg"),
		actionsHTML: ""
	});
}
function renderStockoutGroup(date, records, isViewer, isMobile) {
	const totalOut = records.filter(function(o) {
		return !o.reverted_at && o.reason !== "退回已領出";
	}).reduce(function(sum, o) {
		return sum + Math.abs(o.delta);
	}, 0);
	const desktopRows = records.map(function(o) {
		return renderStockoutDesktopRow(o, isViewer);
	}).join("");
	const body = isMobile ? records.map(function(o) {
		return renderStockoutMobileCard(o, isViewer);
	}).join("") : `<div class="stockout-table-wrap"><table class="data-table stockout-table"><colgroup><col class="stockout-col-photo"><col class="stockout-col-item"><col class="stockout-col-qty"><col class="stockout-col-destination"><col class="stockout-col-actions"></colgroup><thead><tr><th>照片</th><th>品項資訊</th><th>數量</th><th>領用去向</th><th>操作</th></tr></thead><tbody>${desktopRows}</tbody></table></div>`;
	return `<section class="stockout-date-group"><header class="stockout-date-header"><span class="stockout-date-title">📅 ${esc(formatStockoutDate(date))}</span><span class="stockout-date-summary">${esc(String(records.length))} 筆 · 領出 ${esc(String(totalOut))} 件</span></header>${body}</section>`;
}
function renderStockoutPageHeader(isViewer, kpis) {
	const globalSearchInput = document.getElementById("search-input");
	const globalSearchValue = globalSearchInput ? String(globalSearchInput.value || "") : "";
	const searchValue = String(stockoutState.stockoutPageSearch || globalSearchValue);
	return `<section class="stockout-page-header"><div class="stockout-heading-copy"><div class="stockout-heading-icon" aria-hidden="true">🚚</div><div><h1>已領出</h1><p>查看所有已從庫存領出的品項紀錄。</p></div></div><div class="stockout-filter-bar"><label class="stockout-filter-field">開始日期<input type="date" value="${esc(stockoutState.stockoutDateFrom)}" onchange="Stockout.setStockoutFilter('from', this.value)"></label><label class="stockout-filter-field">結束日期<input type="date" value="${esc(stockoutState.stockoutDateTo)}" onchange="Stockout.setStockoutFilter('to', this.value)"></label><label class="stockout-filter-field search">關鍵字搜尋<input type="search" value="${esc(searchValue)}" placeholder="搜尋品項、型號、領用去向..." oninput="Stockout.setStockoutFilter('search', this.value)" onkeydown="if(event.key === 'Enter') Stockout.renderStockOuts()"></label><button type="button" class="btn btn--secondary btn--md stockout-filter-action" onclick="Stockout.renderStockOuts()">搜尋</button><button type="button" class="btn btn--secondary btn--md stockout-filter-action" onclick="Stockout.clearStockoutFilters()">清除</button>${isViewer ? "" : "<button type=\"button\" class=\"btn btn--primary btn--md stockout-filter-action primary\" onclick=\"Stockout.openNonStockOutModal()\">＋ 新增已領出</button>"}</div></section><section class="stockout-kpi-grid ui-kpi-grid"><div class="stockout-kpi-card ui-kpi-card ui-kpi-card--purple purple"><div class="stockout-kpi-icon ui-kpi-icon">📋</div><div class="ui-kpi-body"><div class="stockout-kpi-label ui-kpi-label">領出總筆數</div><div class="stockout-kpi-number ui-kpi-value">${esc(String(kpis.recordCount))}</div><span class="ui-kpi-meta">目前篩選結果</span></div></div><div class="stockout-kpi-card ui-kpi-card ui-kpi-card--green green"><div class="stockout-kpi-icon ui-kpi-icon">📦</div><div class="ui-kpi-body"><div class="stockout-kpi-label ui-kpi-label">總領出數量(個)</div><div class="stockout-kpi-number ui-kpi-value">${esc(String(kpis.totalOutbound))}</div><span class="ui-kpi-meta">有效領出合計</span></div></div><div class="stockout-kpi-card ui-kpi-card ui-kpi-card--blue blue"><div class="stockout-kpi-icon ui-kpi-icon">📅</div><div class="ui-kpi-body"><div class="stockout-kpi-label ui-kpi-label">領出日期 (天)</div><div class="stockout-kpi-number ui-kpi-value">${esc(String(kpis.dateGroupCount))}</div><span class="ui-kpi-meta">去重日期</span></div></div><div class="stockout-kpi-card ui-kpi-card ui-kpi-card--amber amber"><div class="stockout-kpi-icon ui-kpi-icon">🔧</div><div class="ui-kpi-body"><div class="stockout-kpi-label ui-kpi-label">品項種類</div><div class="stockout-kpi-number ui-kpi-value">${esc(String(kpis.uniqueItemCount))}</div><span class="ui-kpi-meta">去重品項</span></div></div></section>`;
}
function clearStockoutFilters() {
	stockoutState.stockoutDateFrom = "";
	stockoutState.stockoutDateTo = "";
	stockoutState.stockoutPageSearch = "";
	const globalSearch = document.getElementById("search-input");
	if (globalSearch) globalSearch.value = "";
	renderStockOuts();
}
function setStockoutFilter(field, value) {
	if (field === "search") {
		stockoutState.stockoutPageSearch = value;
		return;
	}
	if (field === "from") stockoutState.stockoutDateFrom = value;
	else stockoutState.stockoutDateTo = value;
	renderStockOuts();
}
var stockoutRenderGuard = createRequestGuard();
async function renderStockOuts() {
	const requestId = stockoutRenderGuard.next();
	const siteAtRequest = appState.currentSite;
	const isCurrent = function() {
		return stockoutRenderGuard.isCurrent(requestId) && appState.currentTab === "stockout" && siteAtRequest === appState.currentSite;
	};
	const isViewer = !hasPerm("stockout");
	const content = document.getElementById("content");
	if (!content) return;
	content.innerHTML = "<div class=\"stockout-loading\">載入已領出紀錄…</div>";
	try {
		const outs = await apiFetch(`/api/stockouts?limit=200&site=${encodeURIComponent(siteAtRequest)}`);
		if (!isCurrent()) return;
		stockoutState.stockoutRecords = outs;
		const filteredOuts = filterStockoutRecords(outs);
		const kpis = getStockoutKpis(filteredOuts);
		let html = renderStockoutPageHeader(isViewer, kpis);
		html += `<div class="stockout-toolbar"><span>共 <strong>${esc(String(kpis.recordCount))}</strong> 筆</span>${filteredOuts.length !== outs.length ? `<span>已篩選 ${esc(String(filteredOuts.length))} / ${esc(String(outs.length))} 筆</span>` : ""}<button class="btn btn--export btn--md btn-export" onclick="Stockout.openStockoutExportDialog()">📊 匯出報表</button></div>`;
		if (!filteredOuts.length) {
			const filtered = outs.length > 0;
			html += `<div class="stockout-empty-state"><span class="empty-icon">🚚</span><strong>${esc(filtered ? "沒有符合條件的已領出紀錄" : "目前沒有已領出的紀錄")}</strong><p>${esc(filtered ? "可以清除搜尋或日期篩選後再試一次。" : "當商品正式領出後，紀錄會顯示在這裡。")}</p>${filtered ? "<button type=\"button\" class=\"btn btn--secondary btn--md stockout-filter-action\" onclick=\"Stockout.clearStockoutFilters()\">清除篩選</button>" : ""}</div>`;
			if (!isCurrent()) return;
			content.innerHTML = html;
			return;
		}
		const byDate = {};
		filteredOuts.forEach(function(o) {
			const date = String(o.created_at || "").slice(0, 10);
			(byDate[date] = byDate[date] || []).push(o);
		});
		const isMobile = isMobileView();
		Object.keys(byDate).sort().reverse().forEach(function(date) {
			html += renderStockoutGroup(date, byDate[date], isViewer, isMobile);
		});
		if (!isCurrent()) return;
		content.innerHTML = html;
	} catch (e) {
		if (!isCurrent()) return;
		console.error("[renderStockOuts] 已領出紀錄載入失敗", e);
		content.innerHTML = `<div class="stockout-error-state"><h2>載入已領出紀錄失敗</h2><p>${esc(e.message || "請稍後再試")}</p><button type="button" class="btn btn--secondary btn--md stockout-filter-action" onclick="Stockout.renderStockOuts()">重新載入</button></div>`;
	}
}
async function deleteStockoutRecord(movementId) {
	if (!confirm("確定刪除這筆已領出紀錄？只刪紀錄、不會回補庫存。")) return;
	try {
		await apiFetch(`/api/stockouts/${movementId}`, {
			method: "DELETE",
			fallback: "刪除失敗"
		});
		toast("✅ 已刪除紀錄", "success");
		await refreshDestinationsAfterMutation();
		renderStockOuts();
	} catch (e) {
		toast("⚠️ " + e.message, "error");
	}
}
//#endregion
//#region static/js/features/stockout/modals.js
var modals_exports = /* @__PURE__ */ __exportAll({
	deleteStockoutReturn: () => deleteStockoutReturn,
	openEditStockoutModal: () => openEditStockoutModal,
	openEditStockoutReturnModal: () => openEditStockoutReturnModal,
	openKitPrepareModal: () => openKitPrepareModal,
	openNonStockOutModal: () => openNonStockOutModal,
	openNonStockPrepareModal: () => openNonStockPrepareModal,
	openOutModal: () => openOutModal,
	openPrepareModal: () => openPrepareModal,
	openPreparedEditModal: () => openPreparedEditModal,
	openPreparedOutModal: () => openPreparedOutModal,
	returnPrepared: () => returnPrepared,
	returnStockout: () => returnStockout,
	submitEditStockout: () => submitEditStockout,
	submitNonStockOut: () => submitNonStockOut,
	submitNonStockPrepare: () => submitNonStockPrepare,
	submitPrepare: () => submitPrepare,
	submitPreparedEdit: () => submitPreparedEdit,
	submitPreparedOut: () => submitPreparedOut,
	submitReturnStockout: () => submitReturnStockout,
	submitStockOut: () => submitStockOut
});
function openOutModal(id, ev) {
	if (ev) ev.stopPropagation();
	const item = appState.ALL_ITEMS.find((i) => i.id === id);
	if (!item) return;
	stockoutState.outItemId = id;
	document.getElementById("o-item-name").value = `${item.name}${item.brand ? " (" + item.brand + ")" : ""}`;
	document.getElementById("o-item-stock").value = `${Qty.disp(item.qty, item.unit)} ${item.unit}`;
	const sel = document.getElementById("o-location");
	sel.innerHTML = "<option value=\"\">全部位置（自動依序扣）</option>" + (item.stocks && item.stocks.length ? item.stocks : [{ location: item.location || "" }]).map((s) => `<option value="${esc(s.location || "")}">${esc(s.location || "未標示")}（剩 ${Qty.disp(s.qty, item.unit)}）</option>`).join("");
	document.getElementById("o-qty").value = "";
	document.getElementById("o-dest").value = "";
	document.getElementById("o-note").value = "";
	openModal("out-modal");
}
async function submitStockOut() {
	const item = appState.ALL_ITEMS.find((i) => i.id === stockoutState.outItemId);
	const qty = qtyInputOrToast("o-qty", item && item.unit);
	const dest = document.getElementById("o-dest").value.trim();
	const note = document.getElementById("o-note").value.trim();
	const location = document.getElementById("o-location").value;
	if (!qty || qty <= 0) {
		toast("請輸入領出數量", "error");
		return;
	}
	if (!dest) {
		toast("請填寫去哪裡（客戶/案場/工地）", "error");
		return;
	}
	if (location) {
		const st = (item.stocks || []).find((s) => s.location === location);
		if (st && qty > st.qty) {
			toast(`「${location}」庫存不足！只剩 ${Qty.disp(st.qty, item.unit)} ${item.unit}`, "error");
			return;
		}
	} else if (qty > item.qty) {
		toast(`庫存不足！只剩 ${Qty.disp(item.qty, item.unit)} ${item.unit}`, "error");
		return;
	}
	try {
		await apiFetch("/api/stockout", {
			method: "POST",
			json: {
				item_id: stockoutState.outItemId,
				qty,
				destination: dest,
				note,
				location
			},
			fallback: "領出失敗"
		});
		closeModalForce("out-modal");
		toast(`✅ 已領出 ${Qty.disp(qty, item.unit)} ${item.unit} → ${dest}`, "success");
		await loadData({ refreshDestinations: true });
	} catch (e) {
		toast("⚠️ " + e.message, "error");
	}
}
function openNonStockOutModal() {
	document.getElementById("ns-name").value = "";
	document.getElementById("ns-code").value = "";
	fillUnitSelect(document.getElementById("ns-unit"), "個");
	const nsUnitAdd = document.getElementById("ns-unit-add");
	if (nsUnitAdd) nsUnitAdd.style.display = hasPerm("item-mgmt") ? "" : "none";
	const nsUnitSearch = document.getElementById("ns-unit-search");
	if (nsUnitSearch) nsUnitSearch.value = "";
	document.getElementById("ns-qty").value = "";
	document.getElementById("ns-dest").value = "";
	document.getElementById("ns-note").value = "";
	openModal("nonstock-out-modal");
}
async function submitNonStockOut() {
	const name = document.getElementById("ns-name").value.trim();
	const code = document.getElementById("ns-code").value.trim();
	const unit = document.getElementById("ns-unit").value.trim() || "個";
	const qty = qtyInputOrToast("ns-qty", unit);
	const dest = document.getElementById("ns-dest").value.trim();
	const note = document.getElementById("ns-note").value.trim();
	if (!name) {
		toast("請輸入品項名稱", "error");
		return;
	}
	if (!qty || qty <= 0) {
		toast("請輸入領出數量", "error");
		return;
	}
	if (!dest) {
		toast("請填寫去哪裡（客戶/案場/工地）", "error");
		return;
	}
	try {
		await apiFetch("/api/stockout/nonstock", {
			method: "POST",
			json: {
				name,
				code,
				unit,
				qty,
				destination: dest,
				note
			},
			fallback: "領出失敗"
		});
		closeModalForce("nonstock-out-modal");
		toast(`✅ 已領出 ${qty} ${unit} → ${dest}`, "success");
		await loadData({ refreshDestinations: true });
	} catch (e) {
		toast("⚠️ " + e.message, "error");
	}
}
function openNonStockPrepareModal() {
	document.getElementById("nsp-name").value = "";
	document.getElementById("nsp-code").value = "";
	fillUnitSelect(document.getElementById("nsp-unit"), "個");
	const nspUnitAdd = document.getElementById("nsp-unit-add");
	if (nspUnitAdd) nspUnitAdd.style.display = hasPerm("item-mgmt") ? "" : "none";
	const nspUnitSearch = document.getElementById("nsp-unit-search");
	if (nspUnitSearch) nspUnitSearch.value = "";
	document.getElementById("nsp-qty").value = "";
	document.getElementById("nsp-note").value = "";
	openModal("nonstock-prepare-modal");
}
async function submitNonStockPrepare() {
	const name = document.getElementById("nsp-name").value.trim();
	const code = document.getElementById("nsp-code").value.trim();
	const unit = document.getElementById("nsp-unit").value.trim() || "個";
	const qty = qtyInputOrToast("nsp-qty", unit);
	const note = document.getElementById("nsp-note").value.trim();
	if (!name) {
		toast("請輸入品項名稱", "error");
		return;
	}
	if (!qty || qty <= 0) {
		toast("請輸入待領出數量", "error");
		return;
	}
	try {
		await apiFetch("/api/prepare/nonstock", {
			method: "POST",
			json: {
				name,
				code,
				unit,
				qty,
				destination: "",
				note
			},
			fallback: "新增失敗"
		});
		closeModalForce("nonstock-prepare-modal");
		toast(`✅ 已新增待領出 ${qty} ${unit}`, "success");
		await loadData();
	} catch (e) {
		toast("⚠️ " + e.message, "error");
	}
}
function openPrepareModal(id, ev) {
	if (ev) ev.stopPropagation();
	const item = appState.ALL_ITEMS.find((i) => i.id === id);
	if (!item) return;
	stockoutState.prepareItemId = id;
	document.getElementById("p-item-name").value = `${item.name}${item.brand ? " (" + item.brand + ")" : ""}`;
	document.getElementById("p-item-stock").value = `${Qty.disp(item.qty, item.unit)} ${item.unit}（可領 ${Qty.disp(item.qty - (item.prepared_qty || 0), item.unit)}）`;
	document.getElementById("p-qty").value = "";
	document.getElementById("p-note").value = "";
	openModal("prepare-modal");
}
async function submitPrepare() {
	const item = appState.ALL_ITEMS.find((i) => i.id === stockoutState.prepareItemId);
	const qty = qtyInputOrToast("p-qty", item && item.unit);
	const note = document.getElementById("p-note").value.trim();
	if (!qty || qty <= 0) {
		toast("請輸入領出數量", "error");
		return;
	}
	try {
		await apiFetch(`/api/items/${stockoutState.prepareItemId}/prepare`, {
			method: "POST",
			json: {
				qty,
				note,
				location: note
			},
			fallback: "領出失敗"
		});
		closeModalForce("prepare-modal");
		toast(`📤 已標記待領出 ${Qty.disp(qty, item.unit)} ${item.unit}（庫存未扣）`, "success");
		await loadData();
	} catch (e) {
		toast("⚠️ " + e.message, "error");
	}
}
function openPreparedOutModal(id) {
	const item = appState.ALL_ITEMS.find((i) => i.id === id) || appState.preparedItems.find((i) => i.id === id);
	if (!item) return;
	stockoutState.preparedOutItemId = id;
	document.getElementById("po-item-name").value = `${item.name}${item.brand ? " (" + item.brand + ")" : ""}`;
	document.getElementById("po-item-prepared").value = `${Qty.disp(item.prepared_qty, item.unit)} ${item.unit}`;
	document.getElementById("po-qty").value = "";
	document.getElementById("po-dest").value = "";
	openModal("prepared-out-modal");
}
/**
* Submit a prepared item, including non-stock rows that exist only in preparedItems.
* @returns {Promise<void>} Resolves after the mutation and data refresh finish.
*/
async function submitPreparedOut() {
	const item = appState.ALL_ITEMS.find((i) => i.id === stockoutState.preparedOutItemId) || (typeof appState.preparedItems !== "undefined" && appState.preparedItems ? appState.preparedItems.find((i) => i.id === stockoutState.preparedOutItemId) : null);
	const qty = qtyInputOrToast("po-qty", item && item.unit);
	const dest = document.getElementById("po-dest").value.trim();
	if (!qty || qty <= 0) {
		toast("請輸入領出數量", "error");
		return;
	}
	if (!dest) {
		toast("請填寫去哪裡（客戶/案場/工地）", "error");
		return;
	}
	try {
		await apiFetch(`/api/items/${stockoutState.preparedOutItemId}/prepared-out`, {
			method: "POST",
			json: {
				qty,
				note: dest
			},
			fallback: "領出失敗"
		});
		closeModalForce("prepared-out-modal");
		toast(`✅ 已領出 ${Qty.disp(qty, item.unit)} ${item.unit} → ${dest}（庫存已扣）`, "success");
		await loadData({ refreshDestinations: true });
	} catch (e) {
		toast("⚠️ " + e.message, "error");
	}
}
async function returnPrepared(id) {
	const item = appState.ALL_ITEMS.find((i) => i.id === id);
	if (!item) return;
	if (!confirm(`退回「${item.name}」全部 ${item.prepared_qty} ${item.unit}？`)) return;
	try {
		await apiFetch(`/api/items/${id}/prepared-return`, {
			method: "POST",
			json: { qty: item.prepared_qty }
		});
		toast("↩️ 已退回", "success");
		await loadData();
	} catch (e) {
		toast("退回失敗", "error");
	}
}
var returnStockoutId = null;
var editStockoutReturnId = null;
var repairStockoutReturnId = null;
/**
* 準備退回對話框，顯示使用者可讀的庫存區名稱與可用庫存。
* @param {number} movementId 原始出庫異動記錄識別碼。
* @returns {void}
*/
function openReturnStockoutModal(movementId) {
	editStockoutReturnId = null;
	repairStockoutReturnId = null;
	document.getElementById("rs-title").textContent = "↩️ 退回已領出";
	document.getElementById("rs-submit").textContent = "↩️ 退回";
	document.getElementById("rs-parent-row").style.display = "none";
	document.getElementById("rs-qty").disabled = false;
	const rec = (stockoutState.stockoutRecords || []).find((r) => r.id === movementId);
	if (!rec) return;
	returnStockoutId = movementId;
	const origQty = Math.abs(rec.delta);
	const returned = (stockoutState.stockoutRecords || []).filter((r) => r.source_movement_id === movementId && r.reason === "退回已領出" && !r.reverted_at).reduce((sum, r) => sum + Math.abs(r.delta), 0);
	const remaining = origQty - returned;
	document.getElementById("rs-item-name").value = `${rec.brand} ${rec.item_name}${rec.code ? " (" + rec.code + ")" : ""}`;
	document.getElementById("rs-original-qty").textContent = remaining > 0 ? `${origQty}（已退 ${returned}，剩 ${remaining}）` : `${origQty}（已全數退回）`;
	document.getElementById("rs-qty").value = remaining > 0 ? remaining : 0;
	document.getElementById("rs-qty").max = remaining;
	document.getElementById("rs-dest").value = "公司";
	const sourceSite = inventorySiteLabel(rec.source_site || "");
	const sourceLabel = rec.source_site || rec.source_location ? `${sourceSite}${sourceSite && rec.source_location ? "／" : ""}${rec.source_location || ""}` : "原始位置未記錄";
	document.getElementById("rs-source-location").value = sourceLabel;
	const item = (typeof appState.ALL_ITEMS !== "undefined" ? appState.ALL_ITEMS : []).find((i) => i.id === rec.item_id);
	const sel = document.getElementById("rs-location");
	sel.innerHTML = "<option value=\"\">— 請選擇 —</option>";
	(item && item.stocks || []).forEach((s) => {
		const label = `${inventorySiteLabel(item.site || "")}${item.site && s.location ? "／" : ""}${s.location || "未標示"}`;
		sel.insertAdjacentHTML("beforeend", `<option value="${esc(Number(s.id))}">${esc(label)}</option>`);
	});
	if (rec.source_stock_id && sel.querySelector(`option[value="${Number(rec.source_stock_id)}"]`)) sel.value = String(rec.source_stock_id);
	else if (sel.options.length === 2) sel.value = sel.options[1].value;
	const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
	document.getElementById("rs-datetime").value = today;
	if (remaining <= 0) {
		toast("此記錄已全數退回", "error");
		return;
	}
	openModal("return-stockout-modal");
}
async function submitReturnStockout() {
	const _rsRec = (typeof stockoutState.stockoutRecords !== "undefined" ? stockoutState.stockoutRecords : []).find((r) => r.id === returnStockoutId);
	const qty = qtyInputOrToast("rs-qty", _rsRec && _rsRec.unit);
	const dest = document.getElementById("rs-dest").value.trim();
	const dt = document.getElementById("rs-datetime").value;
	const returnStockId = Number(document.getElementById("rs-location").value);
	if (repairStockoutReturnId) {
		const parentId = Number(document.getElementById("rs-parent-movement").value);
		if (!parentId || !returnStockId) {
			toast("請選擇原始出庫與退回庫存位置", "error");
			return;
		}
		try {
			await apiFetch(`/api/stockout-returns/${repairStockoutReturnId}/repair`, {
				method: "POST",
				json: {
					source_movement_id: parentId,
					return_stock_id: returnStockId
				},
				fallback: "修復退回資料失敗"
			});
			repairStockoutReturnId = null;
			closeModalForce("return-stockout-modal");
			toast("✅ 已補齊退回資料，現在可以編輯或撤銷", "success");
			await loadData();
		} catch (e) {
			toast("⚠️ " + e.message, "error");
		}
		return;
	}
	if (editStockoutReturnId) {
		if (!qty || qty <= 0 || !returnStockId) {
			toast("請輸入有效數量並選擇退回庫存位置", "error");
			return;
		}
		const updateBody = {
			qty,
			return_stock_id: returnStockId
		};
		if (dest) updateBody.destination = dest;
		if (dt) updateBody.created_at = dt + " 00:00:00";
		try {
			await apiFetch(`/api/stockout-returns/${editStockoutReturnId}`, {
				method: "PATCH",
				json: updateBody,
				fallback: "儲存退回紀錄失敗"
			});
			editStockoutReturnId = null;
			closeModalForce("return-stockout-modal");
			toast("✅ 已更新退回紀錄", "success");
			await loadData({ refreshDestinations: true });
		} catch (e) {
			toast("⚠️ " + e.message, "error");
		}
		return;
	}
	if (!qty || qty <= 0) {
		toast("請輸入有效退回數量", "error");
		return;
	}
	if (!returnStockId) {
		toast("請選擇退回庫存位置", "error");
		return;
	}
	const rec = stockoutState.stockoutRecords.find((r) => r.id === returnStockoutId);
	const origQty = rec ? Math.abs(rec.delta) : 0;
	const returned = rec ? stockoutState.stockoutRecords.filter((r) => r.source_movement_id === returnStockoutId && r.reason === "退回已領出" && !r.reverted_at).reduce((s, r) => s + Math.abs(r.delta), 0) : 0;
	if (qty > origQty - returned) {
		toast(`退回數量不可超過剩餘可退數量 ${origQty - returned}`, "error");
		return;
	}
	const body = {
		qty,
		return_stock_id: returnStockId
	};
	if (dest) body.destination = dest;
	if (dt) body.created_at = dt + " 00:00:00";
	try {
		await apiFetch(`/api/stockouts/${returnStockoutId}/return`, {
			method: "POST",
			json: body,
			fallback: "退回失敗"
		});
		closeModalForce("return-stockout-modal");
		toast("↩️ 已退回，數量已加回庫存", "success");
		await loadData({ refreshDestinations: true });
	} catch (e) {
		toast("⚠️ " + e.message, "error");
	}
}
function returnStockout(movementId) {
	openReturnStockoutModal(movementId);
}
function openEditStockoutModal(movementId) {
	const rec = (stockoutState.stockoutRecords || []).find((r) => r.id === movementId);
	if (!rec) return;
	stockoutState.editStockoutId = movementId;
	document.getElementById("es-item-name").value = `${rec.brand} ${rec.item_name}${rec.code ? " (" + rec.code + ")" : ""}`;
	document.getElementById("es-qty").value = Math.abs(rec.delta);
	document.getElementById("es-dest").value = rec.destination || "";
	const dt = (rec.created_at || "").replace(" ", "T");
	document.getElementById("es-datetime").value = dt ? dt.slice(0, 10) : "";
	openModal("edit-stockout-modal");
}
async function submitEditStockout() {
	const _esRec = (typeof stockoutState.stockoutRecords !== "undefined" ? stockoutState.stockoutRecords : []).find((r) => r.id === stockoutState.editStockoutId);
	const qty = qtyInputOrToast("es-qty", _esRec && _esRec.unit);
	const dest = document.getElementById("es-dest").value.trim();
	const dt = document.getElementById("es-datetime").value;
	if (!qty || qty <= 0) {
		toast("請輸入有效數量", "error");
		return;
	}
	const rec = stockoutState.stockoutRecords.find((r) => r.id === stockoutState.editStockoutId);
	if (rec && qty > Math.abs(rec.delta) * 10) {
		toast("數量異常大，請確認", "error");
		return;
	}
	const body = { qty };
	if (dest) body.destination = dest;
	if (dt) body.created_at = dt + " 00:00:00";
	try {
		await apiFetch(`/api/stockouts/${stockoutState.editStockoutId}`, {
			method: "PATCH",
			json: body,
			fallback: "儲存失敗"
		});
		closeModalForce("edit-stockout-modal");
		toast("✅ 已更新已領出記錄", "success");
		await loadData({ refreshDestinations: true });
	} catch (e) {
		toast("⚠️ " + e.message, "error");
	}
}
/**
* 使用已儲存的回補庫存區，填入退回編輯器。
* @param {number} movementId 退回異動記錄識別碼。
* @returns {void}
*/
function openEditStockoutReturnModal(movementId) {
	repairStockoutReturnId = null;
	document.getElementById("rs-title").textContent = "↩️ 編輯退回已領出";
	document.getElementById("rs-submit").textContent = "💾 儲存";
	document.getElementById("rs-parent-row").style.display = "none";
	document.getElementById("rs-qty").disabled = false;
	const rec = (stockoutState.stockoutRecords || []).find((r) => r.id === movementId);
	if (!rec || rec.reason !== "退回已領出" || rec.reverted_at) return;
	editStockoutReturnId = movementId;
	document.getElementById("rs-item-name").value = `${rec.brand} ${rec.item_name}${rec.code ? " (" + rec.code + ")" : ""}`;
	document.getElementById("rs-source-location").value = rec.source_location || "原始位置未記錄";
	const item = (typeof appState.ALL_ITEMS !== "undefined" ? appState.ALL_ITEMS : []).find((i) => i.id === rec.item_id);
	const sel = document.getElementById("rs-location");
	sel.innerHTML = "<option value=\"\">— 請選擇 —</option>";
	(item && item.stocks || []).forEach((st) => {
		const label = `${inventorySiteLabel(item.site || "")}${item.site && st.location ? "／" : ""}${st.location || "未標示"}`;
		sel.insertAdjacentHTML("beforeend", `<option value="${esc(Number(st.id))}">${esc(label)}</option>`);
	});
	sel.value = String(rec.return_stock_id || "");
	document.getElementById("rs-qty").value = rec.delta;
	document.getElementById("rs-qty").max = rec.delta;
	document.getElementById("rs-dest").value = rec.destination || "";
	document.getElementById("rs-datetime").value = (rec.created_at || "").slice(0, 10);
	openModal("return-stockout-modal");
}
async function deleteStockoutReturn(movementId) {
	if (!confirm("確定刪除這筆退回紀錄？活動退回會扣回已補入庫存的數量。")) return;
	try {
		await apiFetch(`/api/stockout-returns/${movementId}`, {
			method: "DELETE",
			fallback: "刪除退回紀錄失敗"
		});
		toast("✅ 已刪除退回紀錄", "success");
		await refreshDestinationsAfterMutation();
		await renderStockOuts();
	} catch (e) {
		toast("⚠️ " + e.message, "error");
	}
}
function canEditPreparedMaster(item) {
	return !item.is_kit && (Boolean(item.is_deleted) || hasPerm("item-mgmt"));
}
function openPreparedEditModal(id) {
	const item = typeof appState.preparedItems !== "undefined" && appState.preparedItems ? appState.preparedItems.find((i) => i.id === id) : null;
	if (!item) return;
	appState.editItemId = id;
	const canEditMaster = canEditPreparedMaster(item);
	const nameLabel = document.getElementById("pe-name-label");
	if (nameLabel) nameLabel.textContent = canEditMaster ? "品項名稱*" : "品項名稱(唯讀)";
	[
		"pe-name",
		"pe-brand",
		"pe-code",
		"pe-unit"
	].forEach(function(fieldId) {
		const field = document.getElementById(fieldId);
		if (field) field.disabled = !canEditMaster;
	});
	document.getElementById("pe-name").value = item.name || "";
	document.getElementById("pe-brand").value = item.brand || "";
	document.getElementById("pe-code").value = item.code || "";
	fillUnitSelect(document.getElementById("pe-unit"), item.unit || "個");
	document.getElementById("pe-qty").value = item.prepared_qty || 0;
	document.getElementById("pe-dest").value = item.destination || "";
	openModal("prepared-edit-modal");
}
async function submitPreparedEdit() {
	const item = typeof appState.preparedItems !== "undefined" && appState.preparedItems ? appState.preparedItems.find((i) => i.id === appState.editItemId) : null;
	if (!item) {
		toast("找不到待領出品項", "error");
		return;
	}
	const canEditMaster = canEditPreparedMaster(item);
	const unit = document.getElementById("pe-unit").value;
	const qty = qtyInputOrToast("pe-qty", unit);
	if (!Number.isFinite(qty) || qty < 0) return;
	const payload = {
		prepared_qty: qty,
		destination: document.getElementById("pe-dest").value.trim(),
		updated_at: item.updated_at || null
	};
	if (canEditMaster) {
		const name = document.getElementById("pe-name").value.trim();
		if (!name) {
			toast("品項名稱為必填", "error");
			return;
		}
		payload.name = name;
		payload.brand = document.getElementById("pe-brand").value.trim();
		payload.code = document.getElementById("pe-code").value.trim();
		payload.unit = unit;
	}
	const btn = document.getElementById("prepared-edit-submit");
	if (btn && btn.disabled) return;
	if (btn) {
		btn.disabled = true;
		btn.setAttribute("aria-busy", "true");
	}
	try {
		await apiFetch(`/api/prepared/${appState.editItemId}`, {
			method: "PATCH",
			json: payload,
			fallback: "待領出修改失敗"
		});
		closeModalForce("prepared-edit-modal");
		toast("✅ 已儲存待領出修改", "success");
		await renderPrepared();
	} catch (e) {
		toast("⚠️ " + e.message, "error");
	} finally {
		if (btn) {
			btn.disabled = false;
			btn.setAttribute("aria-busy", "false");
		}
	}
}
function openKitPrepareModal(kitId, kitName) {
	const kit = typeof appState.currentKitItems !== "undefined" && appState.currentKitItems ? appState.currentKitItems.find((k) => k.item_id === kitId || k.id === kitId) : null;
	if (!kit) return;
	const comps = kit.components || [];
	document.getElementById("kit-prepare-title").textContent = "📤 整組待領出：" + kitName;
	document.getElementById("kit-prepare-desc").textContent = "整組包含 " + comps.length + " 個品項，按「確認領出」一次領出整組。";
	let listHtml = "";
	comps.forEach((c) => {
		const photo = c.has_photo ? "<img src=\"" + photoSrc(c.item_id, "thumbnail") + "\" alt=\"\" class=\"kit-prepare-thumb\" loading=\"lazy\" onclick=\"Inventory.openPhotoLightbox(" + c.item_id + ")\" title=\"點擊看大圖\">" : "<div class=\"kit-prepare-thumb kit-prepare-thumb--empty\">📷</div>";
		const stockOk = (c.stock || 0) >= c.need_qty;
		listHtml += "<div class=\"kit-prepare-row\">" + photo + "<div class=\"kit-prepare-info\"><div class=\"kit-prepare-name\">" + esc(c.brand || "") + " " + esc(c.name) + "</div><div class=\"kit-prepare-code\">" + (c.code ? "型號：" + esc(c.code) : "") + "</div></div><div class=\"kit-prepare-qty\"><div>需要 " + c.need_qty + " " + esc(c.unit || "個") + "</div><div class=\"kit-prepare-stock" + (stockOk ? "" : " is-short") + "\">庫存 " + (c.stock || 0) + "</div></div></div>";
	});
	document.getElementById("kit-prepare-list").innerHTML = listHtml;
	document.getElementById("kit-prepare-note").value = "";
	document.getElementById("kit-prepare-submit").onclick = function() {
		submitKitPrepare(kit.item_id);
	};
	openModal("kit-prepare-modal");
}
async function submitKitPrepare(kitItemId) {
	const item = appState.ALL_ITEMS.find((i) => i.id === kitItemId);
	if (!item) {
		toast("品項不存在", "error");
		return;
	}
	const note = document.getElementById("kit-prepare-note").value.trim();
	try {
		await apiFetch(`/api/items/${kitItemId}/prepare`, {
			method: "POST",
			json: {
				qty: 1,
				note,
				location: note
			},
			fallback: "領出失敗"
		});
		closeModalForce("kit-prepare-modal");
		toast("📤 已標記待領出 1 " + (item.unit || "組") + "（整組）", "success");
		await loadData();
	} catch (e) {
		toast("⚠️ " + e.message, "error");
	}
}
//#endregion
//#region static/js/features/prepared/sheet.js
var sheet_exports$1 = /* @__PURE__ */ __exportAll({ openPreparedSheet: () => openPreparedSheet });
function openPreparedSheet(itemId) {
	const item = appState.preparedItems.find((i) => i.id === itemId) || appState.ALL_ITEMS.find((i) => i.id === itemId);
	if (!item) return;
	const isViewer = !hasPerm("stockout");
	const actions = [];
	if (!isViewer) {
		actions.push({
			icon: "✏️",
			label: "編輯",
			cls: "back",
			fn: () => openPreparedEditModal(itemId)
		});
		actions.push({
			icon: "🚚",
			label: "已領出",
			cls: "out",
			fn: () => openPreparedOutModal(itemId)
		});
		if (!item.is_deleted) actions.push({
			icon: "↩️",
			label: "退回",
			cls: "back",
			fn: () => returnPrepared(itemId)
		});
		actions.push({
			icon: "🗑",
			label: "刪除",
			cls: "del",
			fn: () => clearPrepared(itemId, item.prepared_qty)
		});
	}
	openSheet(`${item.brand} ${item.name}`, actions);
}
//#endregion
//#region static/js/features/calendar/page.js
var page_exports$3 = /* @__PURE__ */ __exportAll({ renderCalendar: () => renderCalendar });
async function renderCalendar() {
	calendarState.calSearchMode = false;
	calendarState.calSearchItems = [];
	calendarState.calSearchMeta = {
		from: "",
		to: "",
		q: ""
	};
	calendarState.calSearchGuard.invalidate();
	calendarState.calSearchState = "idle";
	const el = document.getElementById("content");
	const isAdmin = hasPerm("svc-type-mgmt");
	const isViewer = !hasPerm("cal-mgmt");
	el.innerHTML = `
    <div class="cal-wrap">
      <section class="cal-page-header" aria-labelledby="cal-page-title">
        <div class="cal-page-heading">
          <div class="cal-page-icon" aria-hidden="true">📅</div>
          <div>
            <h1 class="cal-page-title" id="cal-page-title">行事曆派工</h1>
            <p class="cal-page-subtitle">查看與管理每日派工行程，提升現場作業效率。</p>
          </div>
        </div>
        <div class="cal-header-filters">
          <label class="cal-field"><span>開始日期</span><input type="date" id="cal-search-from" aria-label="開始日期" onchange="Calendar.calPickDate(this.value)"></label>
          <label class="cal-field"><span>結束日期</span><input type="date" id="cal-search-to" aria-label="結束日期"></label>
          <label class="cal-field cal-keyword-field"><span>關鍵字</span><input type="text" id="cal-search-q" placeholder="搜尋客戶、地址或備註..." aria-label="行事曆關鍵字搜尋" onkeydown="if(event.key === 'Enter') Calendar.calSearch()"></label>
          <div class="cal-header-actions">
            <button class="btn btn--secondary btn--md cal-header-btn" onclick="Calendar.calSearch()" aria-label="搜尋">搜尋</button>
            <button class="btn btn--secondary btn--md cal-header-btn" onclick="Calendar.calClearSearch()" aria-label="清除搜尋">清除</button>
            ${isViewer ? "" : "<button class=\"btn btn--primary btn--md cal-header-btn\" onclick=\"Calendar.calOpenAppt()\">＋ 新增派工</button>"}
          </div>
        </div>
      </section>
      <div class="cal-kpi-grid ui-kpi-grid" id="cal-kpi-grid" aria-label="派工統計"></div>
      <div id="cal-search-top-slot" class="cal-search-top-slot">
        <div id="cal-search-results" class="cal-search-results" style="display:none" aria-label="搜尋結果"></div>
      </div>
      <div class="cal-reminder" id="cal-reminder" style="display:none"></div>
      <div class="cal-main-grid">
        <section class="card cal-card cal-month-card" aria-label="月曆">
          <div class="cal-panel-toolbar">
            <div class="cal-month-header">
              <button class="btn btn--secondary btn--sm btn-sm" onclick="Calendar.calChangeMonth(-1)">◀ 上月</button>
              <button class="btn btn--secondary btn--sm btn-sm cal-today-inline" onclick="Calendar.calPickToday()">今天</button>
              <h3 id="cal-month-title"></h3>
              <button class="btn btn--secondary btn--sm btn-sm" onclick="Calendar.calChangeMonth(1)">下月 ▶</button>
            </div>
          </div>
          <div id="cal-load-state" class="cal-load-state" role="status" aria-live="polite"></div>
          <div class="cal-grid" id="cal-grid"></div>
          <div id="cal-legend" class="cal-legend" aria-label="派工類型圖例"></div>
        </section>
        <section class="card cal-card cal-day-card" id="cal-day-panel" aria-label="選取日期派工明細">
          <div class="cal-day-header">
            <div class="cal-day-heading">
              <span class="cal-detail-icon" aria-hidden="true">📅</span>
              <span id="cal-day-title"></span>
              <span class="cal-day-count" id="cal-day-count"></span>
            </div>
            <div class="cal-day-header-actions">
              <div class="cal-day-nav">
                <button class="btn btn--ghost btn--sm btn--icon cal-icon-btn" onclick="Calendar.calShiftDay(-1)" aria-label="前一天" title="前一天">◀</button>
                <input type="date" id="cal-picker" onchange="Calendar.calPickDate(this.value)">
                <button class="btn btn--ghost btn--sm btn--icon cal-icon-btn" onclick="Calendar.calShiftDay(1)" aria-label="後一天" title="後一天">▶</button>
              </div>
              ${isViewer ? "" : "<button class=\"btn btn--export btn--sm cal-export-btn\" onclick=\"Calendar.calExport()\">📤 匯出日報表</button>"}
            </div>
          </div>
          <div id="cal-search-panel-slot" class="cal-search-panel-slot"></div>
          <div id="cal-day-list"></div>
          <div id="cal-helper-panel" class="cal-helper-panel" style="display:none" aria-label="行事曆操作提示"></div>
        </section>
      </div>
    </div>
    ${calModalHtml(isAdmin)}
    ${calSettingsHtml(isAdmin)}`;
	calMountSearchResults();
	calBindSearchViewportListener();
	calSetLoadState("loading");
	if (await calLoadData() === null) return;
	if (appState.currentTab !== "calendar" || !document.getElementById("cal-grid")) return;
	if (calendarState.calLoadError) calSetLoadState("error", calendarState.calLoadError);
	else {
		calSetLoadState("ready");
		calRenderMonth();
		calRenderDay();
		calRenderKpi();
		calRenderLegend();
		calRenderReminder();
	}
}
//#endregion
//#region static/js/features/inventory/transfer-modal.js
var transfer_modal_exports = /* @__PURE__ */ __exportAll({
	closeTransferModal: () => closeTransferModal,
	openTransferModal: () => openTransferModal,
	submitTransfer: () => submitTransfer
});
var transferItemId = null;
var transferItemSnapshot = null;
var transferSubmitting = false;
/**
* 開啟指定品項的調撥對話框，並顯示使用者可讀的庫存區名稱。
* @param {number|string} itemId 庫存品項識別碼。
* @returns {void}
*/
function openTransferModal(itemId) {
	if (transferSubmitting) return;
	const item = (appState.ALL_ITEMS || []).find((i) => Number(i.id) === Number(itemId));
	if (!item) {
		toast("找不到要調撥的品項", "error");
		return;
	}
	transferItemId = item.id;
	transferItemSnapshot = item;
	const submitBtn = document.getElementById("transfer-submit");
	if (submitBtn) {
		submitBtn.disabled = false;
		submitBtn.textContent = "✅ 確認調撥";
	}
	const modal = document.getElementById("transfer-modal");
	document.getElementById("transfer-item-name").textContent = item.name || "";
	document.getElementById("transfer-item-meta").textContent = `${item.brand || ""} ${item.code || ""} · 目前 ${inventorySiteLabel(item.site || appState.currentSite)}`.trim();
	const target = document.getElementById("transfer-target-site");
	target.replaceChildren();
	INVENTORY_SITES.filter((site) => site !== (item.site || appState.currentSite)).forEach((site) => {
		const option = document.createElement("option");
		option.value = site;
		option.textContent = {
			office: "🏢 ",
			warehouse: "🏭 ",
			van: "🚐 ",
			truck: "🚚 "
		}[site] + inventorySiteLabel(site);
		target.appendChild(option);
	});
	const source = document.getElementById("transfer-source-location");
	source.replaceChildren();
	const allOption = document.createElement("option");
	allOption.value = "__ALL__";
	allOption.textContent = "全部位置";
	source.appendChild(allOption);
	(item.stocks || []).forEach((stock) => {
		const option = document.createElement("option");
		option.value = stock.location || "";
		option.textContent = `${stock.location || "未標示"}（可用 ${stock.qty || 0}）`;
		source.appendChild(option);
	});
	source.value = item.stocks && item.stocks.length ? item.stocks[0].location || "" : "__ALL__";
	document.getElementById("transfer-qty").value = "";
	document.getElementById("transfer-target-location").value = "";
	document.getElementById("transfer-error").textContent = "";
	modal.classList.add("is-open");
	modal.setAttribute("aria-hidden", "false");
}
function closeTransferModal(force) {
	if (transferSubmitting && !force) return;
	const modal = document.getElementById("transfer-modal");
	if (!modal) return;
	modal.classList.remove("is-open");
	modal.setAttribute("aria-hidden", "true");
	transferItemId = null;
	transferItemSnapshot = null;
}
function parseTransferQty(raw, unit) {
	const validation = Qty.validFor(raw, Qty.inputTypeOf(unit));
	if (!validation.ok) return {
		ok: false,
		error: validation.error || "請輸入有效的調撥數量"
	};
	if (validation.value <= 0) return {
		ok: false,
		error: "請輸入大於 0 的數量"
	};
	return {
		ok: true,
		value: validation.value
	};
}
async function submitTransfer() {
	if (!transferItemId || transferSubmitting) return;
	const error = document.getElementById("transfer-error");
	const submitBtn = document.getElementById("transfer-submit");
	const parsedQty = parseTransferQty(document.getElementById("transfer-qty").value.trim(), transferItemSnapshot ? transferItemSnapshot.unit : "");
	if (!parsedQty.ok) {
		error.textContent = parsedQty.error;
		return;
	}
	const qty = parsedQty.value;
	const payload = {
		item_id: transferItemId,
		target_site: document.getElementById("transfer-target-site").value,
		qty,
		source_location: (function() {
			const sourceLocationValue = document.getElementById("transfer-source-location").value;
			return sourceLocationValue === "__ALL__" ? null : sourceLocationValue;
		})(),
		target_location: document.getElementById("transfer-target-location").value.trim()
	};
	transferSubmitting = true;
	if (submitBtn) {
		submitBtn.disabled = true;
		submitBtn.textContent = "調撥中…";
	}
	try {
		await apiFetch("/api/inventory/transfers", {
			method: "POST",
			json: payload,
			fallback: "調撥失敗"
		});
		closeTransferModal(true);
		toast("庫存調撥完成", "success");
		if (appState.currentTab === "inventory") await loadInventoryPage(appState.INVENTORY_META.page || 1);
		else await loadData({ full: true });
	} catch (e) {
		error.textContent = e.message || "調撥失敗，請稍後再試";
	} finally {
		transferSubmitting = false;
		if (submitBtn) {
			submitBtn.disabled = false;
			submitBtn.textContent = "✅ 確認調撥";
		}
	}
}
//#endregion
//#region static/js/features/inventory/actions.js
var actions_exports = /* @__PURE__ */ __exportAll({
	buildInventoryItemActionMenu: () => buildInventoryItemActionMenu,
	closeInventoryActionMenus: () => closeInventoryActionMenus,
	closeMoreActions: () => closeMoreActions,
	deleteItem: () => deleteItem,
	initInventoryActions: () => initInventoryActions,
	openInventoryActionMenu: () => openInventoryActionMenu,
	openItemSheet: () => openItemSheet,
	toggleMoreActions: () => toggleMoreActions
});
function getInventoryItemActions(itemId, isViewer, includePhoto) {
	if (isViewer) return [];
	const actions = [{
		key: "edit",
		icon: "✏️",
		label: "編輯品項",
		fn: () => openEditModal(itemId)
	}];
	if (includePhoto !== false) actions.push({
		key: "photo",
		icon: "📷",
		label: "更換照片",
		fn: () => openEditModal(itemId)
	});
	if (hasPerm("stock-mgmt")) actions.push({
		key: "transfer",
		icon: "🔄",
		label: "調撥庫存",
		fn: () => openTransferModal(itemId)
	});
	actions.push({
		key: "delete",
		icon: "🗑",
		label: "刪除品項",
		cls: "del",
		fn: () => deleteItem(itemId)
	});
	return actions;
}
function buildInventoryItemActionMenu(itemId, isViewer) {
	const actions = getInventoryItemActions(itemId, isViewer, false);
	if (!actions.length) return "";
	return "<div class=\"inventory-action-menu\" data-role=\"inventory-action-menu\"><button type=\"button\" class=\"inventory-action-trigger\" aria-label=\"更多操作\" onclick=\"Inventory.openInventoryActionMenu(this, event)\">⋮</button><div class=\"inventory-action-dropdown\" data-role=\"inventory-action-dropdown\">" + actions.map((a) => {
		const command = a.key === "edit" ? "Inventory.openEditModal(" + itemId + ")" : a.key === "transfer" ? "Inventory.openTransferModal(" + itemId + ")" : "Inventory.deleteItem(" + itemId + ")";
		return "<button class=\"inventory-action-item" + (a.cls ? " " + a.cls : "") + "\" onclick=\"" + command + ";Inventory.closeInventoryActionMenus()\">" + a.icon + " " + a.label + "</button>";
	}).join("") + "</div></div>";
}
/**
* 刪除材料；失敗時將結構化驗證內容轉為可讀訊息。
* @param {number} itemId 材料識別碼。
* @returns {Promise<void>} 刪除與清單更新流程完成後解析。
*/
async function deleteItem(itemId) {
	if (!confirm("確定刪除這個材料？會一併刪除它的庫存、照片與異動紀錄，無法恢復。")) return;
	try {
		await apiFetch(`/api/items/${itemId}`, {
			method: "DELETE",
			fallback: "刪除失敗"
		});
		await loadData();
	} catch (e) {
		alert(e.status ? e.message : "刪除失敗：" + e.message);
	}
}
function openItemSheet(itemId) {
	const item = appState.ALL_ITEMS.find((i) => i.id === itemId);
	if (!item) return;
	const actions = getInventoryItemActions(itemId, !(hasPerm("item-mgmt") || hasPerm("stock-mgmt") || hasPerm("photo")));
	openSheet(`${item.brand} ${item.name}`, actions);
}
function toggleMoreActions() {
	var dd = document.getElementById("moreActionsDropdown");
	if (dd) dd.classList.toggle("is-open");
}
function closeMoreActions() {
	var dd = document.getElementById("moreActionsDropdown");
	if (dd) dd.classList.remove("is-open");
}
function openInventoryActionMenu(button, event) {
	if (event) event.stopPropagation();
	document.querySelectorAll("[data-role=\"inventory-action-dropdown\"].is-open").forEach(function(el) {
		el.classList.remove("is-open");
	});
	var menu = button && button.parentElement ? button.parentElement.querySelector("[data-role=\"inventory-action-dropdown\"]") : null;
	if (menu) menu.classList.toggle("is-open");
}
function closeInventoryActionMenus() {
	document.querySelectorAll("[data-role=\"inventory-action-dropdown\"].is-open").forEach(function(el) {
		el.classList.remove("is-open");
	});
}
function initInventoryActions() {
	document.addEventListener("click", function(e) {
		if (!e.target.closest("[data-role=\"more-actions\"]")) closeMoreActions();
		if (!e.target.closest("[data-role=\"inventory-action-menu\"]")) closeInventoryActionMenus();
	});
}
//#endregion
//#region static/js/features/inventory/list.js
var list_exports = /* @__PURE__ */ __exportAll({
	buildDatalists: () => buildDatalists,
	renderInventory: () => renderInventory,
	setInventoryView: () => setInventoryView,
	toggleLoc: () => toggleLoc
});
function buildDatalists(skipDestinationLoad) {
	const facetReady = appState.inventoryLoadedSite === appState.currentSite && appState.INVENTORY_FACETS;
	const brands = facetReady && Object.keys(appState.INVENTORY_FACETS.brands || {}).length ? Object.keys(appState.INVENTORY_FACETS.brands).sort() : [...new Set(appState.ALL_ITEMS.map((i) => i.brand))].sort();
	const locs = facetReady && (appState.INVENTORY_FACETS.locations || []).length ? appState.INVENTORY_FACETS.locations : [...new Set(appState.ALL_ITEMS.flatMap((i) => (i.stocks || []).map((s) => s.location)))].sort();
	document.getElementById("brand-list").innerHTML = brands.map((b) => `<option value="${esc(b)}">`).join("");
	document.getElementById("location-list").innerHTML = locs.map((l) => `<option value="${esc(l)}">`).join("");
	if (!skipDestinationLoad && appState.destinationsLoadedSite !== appState.currentSite) loadDestinations();
}
function renderInventory() {
	const isViewer = !(hasPerm("item-mgmt") || hasPerm("stock-mgmt") || hasPerm("photo"));
	const canStockout = hasPerm("stockout");
	const content = document.getElementById("content");
	const list = getFilteredInventoryItems();
	var filterPanel = document.getElementById("filter-panel");
	if (filterPanel) filterPanel.style.display = "";
	closeInventoryStatusModal();
	renderInventoryPageHeading();
	buildFilterPanel();
	if (!list.length) {
		content.innerHTML = renderInventoryEmptyState(isViewer);
		updateSaveBar();
		return;
	}
	const viewMode = localStorage.getItem("inventoryViewMode") || "card";
	const isM = isMobileView();
	let html = renderInventoryDashboard(list, typeof appState.INVENTORY_META !== "undefined" ? appState.INVENTORY_META.stats : null);
	html += renderInventoryToolbar(list, isViewer);
	if (viewMode === "table") html += renderInventoryTable(list, isViewer, canStockout);
	else html += renderInventoryCard(list, isViewer, canStockout, isM);
	html += renderInventoryPagination();
	content.innerHTML = html;
	updateSaveBar();
}
function renderInventoryPageHeading() {
	const heading = document.getElementById("inventory-page-heading");
	if (!heading) return;
	heading.innerHTML = `
    <div class="inventory-heading-icon" aria-hidden="true">📦</div>
    <div>
      <h1>單一庫存</h1>
      <p>管理單一材料的庫存、位置與出庫狀態，快速掌握目前可用數量。</p>
    </div>`;
}
function renderInventoryEmptyState(isViewer) {
	const search = document.getElementById("search-input");
	const hasFilter = appState.currentBrands.length > 0 || appState.currentCategories.length > 0 || search && search.value.trim();
	return `<div class="inventory-empty-state">
    <div class="inventory-empty-icon" aria-hidden="true">📦</div>
    <h2>${hasFilter ? "沒有符合條件的庫存品項" : "目前沒有庫存品項"}</h2>
    <p>${hasFilter ? "可以嘗試清除篩選或調整搜尋條件。" : "新增品項後，庫存與位置會在這裡集中管理。"}</p>
    <div class="inventory-empty-actions">${hasFilter ? "<button class=\"btn btn--secondary btn--md\" onclick=\"Inventory.clearFilterPanel()\">清除篩選</button>" : ""}${isViewer ? "" : "<button class=\"btn btn--primary btn--md btn-add-inv\" onclick=\"Inventory.openAddModal()\">＋ 新增品項</button>"}</div>
  </div>`;
}
function renderInventoryToolbar(list, isViewer) {
	const viewMode = localStorage.getItem("inventoryViewMode") || "card";
	const isM = isMobileView();
	let h = "<div class=\"loc-export-bar\">";
	if (appState.batchMode) h += "<button class=\"btn btn--secondary btn--md btn-select-all\" id=\"btn-select-toggle\" onclick=\"Inventory.selectAllStocks()\">" + (_allSelected() ? "☐ 取消全選" : "☑ 全選") + "</button>";
	h += "<span class=\"loc-export-count\">共 " + (appState.INVENTORY_META.total || list.length) + " 項</span>";
	h += "<div class=\"view-toggle\"><button onclick=\"Inventory.setInventoryView('table')\" class=\"chip chip--seg" + (viewMode === "table" ? " is-active" : "") + "\">📊 表格</button><button onclick=\"Inventory.setInventoryView('card')\" class=\"chip chip--seg" + (viewMode === "card" ? " is-active" : "") + "\">🃏 卡片</button></div>";
	if (!isViewer) h += "<button class=\"btn btn--primary btn--md btn-add-inv\" onclick=\"Inventory.openAddModal()\">＋ 新增</button>";
	if (isM) {
		h += "<div class=\"more-actions-wrap\" data-role=\"more-actions\"><button class=\"btn btn--secondary btn--md btn--icon\" onclick=\"Inventory.toggleMoreActions()\">⋮</button>";
		h += "<div class=\"more-actions-dropdown\" id=\"moreActionsDropdown\">";
		if (hasPerm("batch-loc-mgmt")) h += "<button onclick=\"Inventory.toggleBatchMode();Inventory.closeMoreActions()\">📦 批次改位置</button>";
		h += "<button onclick=\"Inventory.openInventoryExportDialog();Inventory.closeMoreActions()\">⬇️ 匯出庫存</button>";
		h += "</div></div>";
	} else {
		if (hasPerm("batch-loc-mgmt")) h += "<button class=\"btn btn--secondary btn--md btn-batch\" id=\"batch-toggle\" onclick=\"Inventory.toggleBatchMode()\">📦 批次改位置</button>";
		h += "<button class=\"btn btn--export btn--md btn-export\" onclick=\"Inventory.openInventoryExportDialog()\">⬇️ 匯出庫存</button>";
	}
	h += "</div>";
	return h;
}
function renderInventoryTable(list, isViewer, canStockout) {
	const byLoc = {};
	list.forEach((i) => {
		const mainLoc = i.stocks && i.stocks.length && i.stocks[0].location || "未標示";
		(byLoc[mainLoc] = byLoc[mainLoc] || []).push(i);
	});
	let h = "<div class=\"tbl-wrap\"><table class=\"data-table\"><thead><tr>";
	if (appState.batchMode && hasPerm("batch-loc-mgmt")) h += "<th class=\"col-check\"></th>";
	h += "<th class=\"col-thumb\"></th><th>品項名稱</th><th>品牌</th><th>庫存</th><th>單位</th><th>位置</th><th>狀態</th><th>操作</th>";
	h += "</tr></thead><tbody>";
	Object.keys(byLoc).sort().forEach((loc) => {
		byLoc[loc].forEach((i) => {
			const status = getInventoryStatus(i);
			const display = status.qty;
			const displayStr = Qty.format(display, Qty.unitTypeOf(i.unit));
			const isZero = status.isOutOfStock;
			const isLow = status.isLowStock;
			const rowClass = isZero ? "row-danger" : isLow ? "row-warn" : "";
			const statusHTML = isZero ? "<span class=\"status-danger\">⛔ 缺貨</span>" : isLow ? "<span class=\"status-warn\">⚠ 低庫存</span>" : "<span class=\"status-ok\">✓ 正常</span>";
			const locStr = (i.stocks && i.stocks.length ? i.stocks : [{
				location: i.location || "未標示",
				note: i.note || ""
			}]).map((s) => esc(s.location)).join(", ");
			const photoHTML = i.has_photo ? "<span class=\"cphoto\"><img src=\"" + (i.thumbnail_url || photoSrc(i.id, "thumbnail")) + "\" alt=\"\" onclick=\"Inventory.openPhotoLightbox(" + i.id + ")\" title=\"點擊看大圖\"></span>" : "<span class=\"cphoto\"><span class=\"cphoto-empty\">📷</span></span>";
			h += "<tr class=\"" + rowClass + "\">";
			if (appState.batchMode && hasPerm("batch-loc-mgmt")) h += "<td class=\"u-ta-center\"><input type=\"checkbox\" class=\"stock-checkbox\" " + (selectedStockIds.has(i.stocks && i.stocks.length ? i.stocks[0].id : 0) ? "checked" : "") + " onchange=\"Inventory.toggleStockSelect(" + i.id + ")\"></td>";
			h += "<td class=\"photo-cell\">" + photoHTML + "</td>";
			h += "<td class=\"col-name\">" + esc(i.name) + (i.code ? "<br><small class=\"col-name-code\">型號： " + esc(i.code) + "</small>" : "") + "</td>";
			h += "<td>" + esc(i.brand) + "</td>";
			h += "<td class=\"col-qty " + (isZero ? "is-out" : isLow ? "is-low" : "is-ok") + "\">" + displayStr + "</td>";
			h += "<td>" + esc(i.unit) + "</td>";
			h += "<td class=\"col-loc\">" + locStr + "</td>";
			h += "<td class=\"col-status\">" + statusHTML + "</td>";
			h += "<td class=\"col-actions\">";
			h += buildInventoryStockoutActions(i, canStockout, false);
			h += buildInventoryItemActionMenu(i.id, isViewer);
			h += "</td></tr>";
		});
	});
	h += "</tbody></table></div>";
	return h;
}
function buildInventoryStockoutActions(i, canStockout, mobile) {
	if (!canStockout) return "";
	const prepare = i.is_kit ? "" : "<button class=\"btn btn--prepare btn--sm btn-prepare\" onclick=\"Stockout.openPrepareModal(" + i.id + ", event)\">📤 待領出</button>";
	const out = "<button class=\"btn btn--out btn--sm btn-out\" onclick=\"Stockout.openOutModal(" + i.id + ", event)\">🚚 已領出</button>";
	return "<div class=\"" + (mobile ? "m-card-actions" : "inventory-stockout-actions") + "\">" + prepare + out + "</div>";
}
function renderInventoryCard(list, isViewer, canStockout, isM) {
	const collapsedKey = "hvac_collapsed_locs_" + (typeof appState.currentSite !== "undefined" ? appState.currentSite : "office");
	let collapsedLocs = [];
	try {
		collapsedLocs = JSON.parse(localStorage.getItem(collapsedKey) || "[]") || [];
	} catch (e) {
		collapsedLocs = [];
	}
	const byLoc = {};
	list.forEach((i) => {
		const mainLoc = i.stocks && i.stocks.length && i.stocks[0].location || "未標示";
		(byLoc[mainLoc] = byLoc[mainLoc] || []).push(i);
	});
	let h = "";
	Object.keys(byLoc).sort().forEach((loc) => {
		const locItems = byLoc[loc];
		const locCollapsed = collapsedLocs.indexOf(loc) >= 0;
		h += "<div class=\"section-title" + (locCollapsed ? " is-collapsed" : "") + "\" data-loc=\"" + esc(loc) + "\" onclick=\"Inventory.toggleLoc(this, '" + esc(jsStr(loc)) + "')\">";
		h += "<button class=\"collapse-btn\" type=\"button\" aria-label=\"折疊/展開\">▾</button>";
		h += "<span class=\"loc\">位置：" + esc(loc) + "</span><span>" + locItems.length + " 項</span>";
		h += "</div>";
		h += "<div class=\"loc-group" + (locCollapsed ? " is-collapsed" : "") + "\" data-role=\"loc-group\" data-loc=\"" + esc(loc) + "\">";
		locItems.forEach((i) => {
			const status = getInventoryStatus(i);
			const display = status.qty;
			const displayStr = Qty.format(display, Qty.unitTypeOf(i.unit));
			const isZero = status.isOutOfStock;
			const isLow = status.isLowStock;
			const delta = display - Number(i.qty || 0);
			const cardClass = isZero ? "item-card danger" : isLow ? "item-card warn" : "item-card";
			const prepared = i.prepared_qty || 0;
			const statusBadge = isZero ? "<span class=\"inventory-card-status status-out\">⛔ 缺貨</span>" : isLow ? "<span class=\"inventory-card-status status-low\">⚠ 低庫存</span>" : "";
			if (isM) {
				const locs = i.stocks && i.stocks.length ? i.stocks : [{
					location: i.location || "未標示",
					note: i.note || ""
				}];
				const locStr = buildLocHTML(locs);
				const noteStr = buildNoteHTML(locs);
				h += mobileCardShell({
					reverted: false,
					cardClass: isZero ? "danger" : isLow ? "warn" : "",
					moreBtnHTML: isViewer ? "" : "<button class=\"more-btn\" onclick=\"Inventory.openItemSheet(" + i.id + ")\">⋯</button>",
					checkboxHTML: appState.batchMode ? "<input type=\"checkbox\" class=\"stock-checkbox\" " + (selectedStockIds.has(i.stocks && i.stocks.length ? i.stocks[0].id : 0) ? "checked" : "") + " onchange=\"Inventory.toggleStockSelect('item-" + i.id + "')\">" : "",
					thumb: buildThumb(i.id, i.has_photo, i.name, "📦", i.thumbnail_url),
					nameHTML: esc(i.brand || "無廠牌") + " " + esc(i.name || "未命名") + (i.site === "warehouse" ? " 🏭" : ""),
					subHTML: (prepared > 0 ? "<span class=\"m-tag green\">待領出 " + prepared + "</span> " : "") + (i.code ? "<span class=\"inventory-mobile-model\">型號： " + esc(i.code) + "</span>" : ""),
					extraHTML: locStr,
					noteHTML: noteStr,
					qtyHTML: buildQtyControl({
						id: i.id,
						display: displayStr,
						unit: i.unit,
						isZero,
						delta,
						viewer: isViewer
					}),
					actionsHTML: buildInventoryStockoutActions(i, canStockout, true)
				});
			} else {
				const stocks = i.stocks && i.stocks.length ? i.stocks : [{
					id: null,
					location: i.location || "",
					qty: i.qty,
					note: i.note || ""
				}];
				const locHtml = buildLocHTML(stocks);
				const noteHtml = buildNoteHTML(stocks);
				h += "<div class=\"" + cardClass + "\" id=\"card-" + i.id + "\"" + (appState.batchMode ? " data-batch=\"1\"" : "") + ">";
				if (appState.batchMode) h += "<input type=\"checkbox\" class=\"stock-checkbox\" " + (selectedStockIds.has(i.stocks && i.stocks.length ? i.stocks[0].id : 0) ? "checked" : "") + " onchange=\"Inventory.toggleStockSelect('item-" + i.id + "')\">";
				if (i.has_photo) h += "<img class=\"item-photo\" src=\"" + (i.thumbnail_url || photoSrc(i.id, "thumbnail")) + "\" alt=\"" + esc(i.name) + "\" loading=\"lazy\" onclick=\"Inventory.openPhotoLightbox(" + i.id + ")\" title=\"點擊看大圖\" onerror=\"this.style.display='none'\">";
				else h += "<span class=\"item-photo item-photo-empty\" aria-hidden=\"true\">📷</span>";
				h += "<div class=\"item-info\"" + (isViewer ? "" : " onclick=\"Inventory.openEditModal(" + i.id + ")\"") + ">";
				h += "<div class=\"item-name\">" + esc(i.brand || "無廠牌") + " " + (esc(i.name) || "—") + (i.site === "warehouse" ? "<span class=\"site-badge wh\">🏭 倉庫</span>" : "") + statusBadge + "</div>";
				h += "<div class=\"item-code\">" + (i.code ? "型號： " + esc(i.code) : "") + "</div>";
				h += locHtml;
				h += noteHtml;
				if (i.is_kit) h += "<div class=\"kit-tag\">🔧 整組</div>";
				if (prepared > 0) h += "<div class=\"prepared-tag\">📤 待領出 " + Qty.format(prepared, Qty.unitTypeOf(i.unit)) + " " + esc(i.unit) + "</div>";
				h += "</div>";
				h += buildInventoryStockoutActions(i, canStockout, false);
				if (!isViewer) h += "<div class=\"item-card-admin-actions\"><button class=\"btn btn--secondary btn--sm edit-btn\" onclick=\"Inventory.openEditModal(" + i.id + ")\" title=\"編輯品項\">編輯</button><button class=\"btn btn--danger btn--sm del-btn\" onclick=\"Inventory.deleteItem(" + i.id + ")\" title=\"刪除材料\">刪除</button></div>";
				if (isViewer) h += "<div class=\"qty-control\"><div class=\"qty-value is-readonly\" title=\"唯讀\">" + displayStr + "<span class=\"unit\"> " + esc(i.unit) + "</span></div></div>";
				else h += "<div class=\"qty-control\"><button class=\"qty-btn qty-minus\" onclick=\"Inventory.changeQty(" + i.id + ", -1)\"" + (isZero && delta <= 0 ? " disabled" : "") + ">−</button><div class=\"qty-value\" onclick=\"Inventory.quickSet(" + i.id + ")\" title=\"點數字可輸入\">" + displayStr + "<span class=\"unit\"> " + esc(i.unit) + "</span></div><button class=\"qty-btn qty-plus\" onclick=\"Inventory.changeQty(" + i.id + ", 1)\">+</button></div>";
				h += "</div>";
			}
		});
		h += "</div>";
	});
	return h;
}
function renderInventoryPagination() {
	const totalPages = Math.ceil((appState.INVENTORY_META.total || 0) / (appState.INVENTORY_META.page_size || 50));
	if (totalPages <= 1) return "";
	const current = appState.INVENTORY_META.page || 1;
	let h = "<div class=\"inventory-pagination\">";
	h += "<button type=\"button\" class=\"btn btn--secondary btn--sm\" onclick=\"Data.changeInventoryPage(" + (current - 1) + ")\"" + (current <= 1 ? " disabled" : "") + ">上一頁</button>";
	h += "<span>第 " + current + " / " + totalPages + " 頁</span>";
	h += "<button type=\"button\" class=\"btn btn--secondary btn--sm\" onclick=\"Data.changeInventoryPage(" + (current + 1) + ")\"" + (current >= totalPages ? " disabled" : "") + ">下一頁</button>";
	return h + "</div>";
}
function setInventoryView(mode) {
	localStorage.setItem("inventoryViewMode", mode);
	renderInventory();
}
function toggleLoc(titleEl, loc) {
	const collapsedKey = "hvac_collapsed_locs_" + (typeof appState.currentSite !== "undefined" ? appState.currentSite : "office");
	let arr = [];
	try {
		arr = JSON.parse(localStorage.getItem(collapsedKey) || "[]") || [];
	} catch (e) {
		arr = [];
	}
	const idx = arr.indexOf(loc);
	const nowCollapsed = idx < 0;
	if (nowCollapsed) arr.push(loc);
	else arr.splice(idx, 1);
	try {
		localStorage.setItem(collapsedKey, JSON.stringify(arr));
	} catch (e) {}
	if (titleEl) titleEl.classList.toggle("is-collapsed", nowCollapsed);
	try {
		document.querySelectorAll("[data-role=\"loc-group\"][data-loc=\"" + CSS.escape(loc) + "\"]").forEach((g) => g.classList.toggle("is-collapsed", nowCollapsed));
	} catch (e) {}
}
//#endregion
//#region static/js/features/petty-cash/state.js
var state_exports$1 = /* @__PURE__ */ __exportAll({ pettyCashState: () => pettyCashState });
var pettyCashState = {
	pcDetail: null,
	pcModalOpenSeq: 0,
	pcModalSessionType: "",
	pcSaveInFlight: false,
	pcSaveInFlightToken: 0
};
//#endregion
//#region static/js/features/petty-cash/page.js
var page_exports$2 = /* @__PURE__ */ __exportAll({
	_pcDate: () => _pcDate,
	_pcIsCurrentModal: () => _pcIsCurrentModal,
	_pcIso: () => _pcIso,
	_pcMD: () => _pcMD,
	_pcMoney: () => _pcMoney,
	engToggle: () => engToggle,
	pcChangePage: () => pcChangePage,
	pcCloseMoreMenuFromAction: () => pcCloseMoreMenuFromAction,
	pcDelete: () => pcDelete,
	pcExport: () => pcExport,
	pcLoadHistory: () => pcLoadHistory,
	pcOpenDetail: () => pcOpenDetail,
	pcPersons: () => pcPersons,
	pcQuickRange: () => pcQuickRange,
	pcResetFilter: () => pcResetFilter,
	pcSetSaveButtonsDisabled: () => pcSetSaveButtonsDisabled,
	pcSwitchModalStep: () => pcSwitchModalStep,
	renderPettyCash: () => renderPettyCash
});
var pcReports = [];
var pcPage = 1;
var pcPageSize = 20;
var pcTotal = 0;
var pcPersons = [];
var pcHistoryGuard = createRequestGuard();
var pcKpiGuard = createRequestGuard();
var pcDetailGuard = createRequestGuard();
function _pcFilterSnapshot() {
	const value = (id) => {
		const el = document.getElementById(id);
		return el ? String(el.value || "").trim() : "";
	};
	return {
		start_date: value("pc-f-from"),
		end_date: value("pc-f-to"),
		upload_person: value("pc-f-person"),
		status: value("pc-f-status"),
		report_type: value("pc-f-type"),
		search: value("pc-f-q")
	};
}
function _pcFilterKey(snapshot) {
	return [
		snapshot.start_date,
		snapshot.end_date,
		snapshot.upload_person,
		snapshot.status,
		snapshot.report_type,
		snapshot.search
	].join("");
}
function _pcIsCurrentModal(token, type) {
	return token === pettyCashState.pcModalOpenSeq && pettyCashState.pcModalSessionType === type;
}
function pcSetSaveButtonsDisabled(overlayId, disabled) {
	const overlay = document.getElementById(overlayId);
	if (!overlay) return;
	overlay.querySelectorAll("button[onclick*=\"pcModalSave\"], button[onclick*=\"engSave\"]").forEach((button) => {
		if (disabled) {
			if (button.dataset.pcOriginalLabel === void 0) button.dataset.pcOriginalLabel = button.textContent;
			button.disabled = true;
			button.textContent = "儲存中…";
		} else {
			button.disabled = false;
			if (button.dataset.pcOriginalLabel !== void 0) {
				button.textContent = button.dataset.pcOriginalLabel;
				delete button.dataset.pcOriginalLabel;
			}
		}
	});
}
function _pcIso(d) {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function _pcDate(s) {
	return String(s || "").replace(/-/g, "/");
}
function _pcMD(s) {
	var p = String(s || "").split("-");
	return p.length === 3 ? p[1] + "/" + p[2] : String(s || "");
}
function _pcMoney(v) {
	var n = Number(v);
	if (!isFinite(n)) return "0";
	return (Math.round(n * 100) / 100).toLocaleString("en-US");
}
function _pcPeriodText(r) {
	return esc(_pcDate(r.start_date)) + "～" + esc(_pcDate(r.end_date));
}
function _pcFileLabelRaw(r) {
	return r.filename || "零用金-" + (r.filename_text || "") + _pcMD(r.start_date) + "~" + _pcMD(r.end_date) + ".xlsx";
}
function _pcFileLabel(r) {
	return esc(_pcFileLabelRaw(r));
}
function pcStatusBadge(status) {
	return status === "completed" ? "<span class=\"pc-status pc-status--completed\">已完成</span>" : "<span class=\"pc-status pc-status--draft\">草稿</span>";
}
function pcSwitchModalStep(step, config) {
	if (step === 2 && config.validate && !config.validate()) return false;
	document.getElementById(config.stepIds[0]).style.display = step === 1 ? "" : "none";
	document.getElementById(config.stepIds[1]).style.display = step === 2 ? "" : "none";
	document.getElementById(config.tabIds[0]).classList.toggle("is-active", step === 1);
	document.getElementById(config.tabIds[1]).classList.toggle("is-active", step === 2);
	document.getElementById(config.opsIds[0]).style.display = step === 1 ? "" : "none";
	document.getElementById(config.opsIds[1]).style.display = step === 2 ? "" : "none";
	if (step === 2 && config.onDetail) config.onDetail();
	return true;
}
async function renderPettyCash() {
	pcCloseAllMoreMenus();
	pcDetailGuard.invalidate();
	pettyCashState.pcModalOpenSeq += 1;
	pettyCashState.pcModalSessionType = "";
	const el = document.getElementById("content");
	el.innerHTML = `
    <div class="pc-wrap">
      <div class="pc-page-header">
        <div class="pc-page-title">
          <h1>🪙 零用金月報</h1>
          <p>記錄每月零用金收支，可建立多人員報表並匯出 Excel 交付主管。</p>
        </div>
        <div class="pc-page-actions">
          <button class="btn btn--primary btn--md pc-btn" onclick="PettyCash.pcChooseReportType()">＋ 新增零用金月報</button>
        </div>
      </div>

      <section class="pc-card" aria-label="彙總">
        <div class="pc-card__bd">
          <div class="pc-kpi-row ui-kpi-grid">
            <div class="pc-kpi-card ui-kpi-card"><div class="pc-kpi-card__head"><span class="ui-kpi-icon" aria-hidden="true">🪙</span><span class="ui-kpi-label">報表總數</span></div><div class="pc-kpi-card__num ui-kpi-value pc-kpi-blue" id="pc-kpi-total">—</div><div class="pc-kpi-card__foot ui-kpi-meta">篩選全量</div></div>
            <div class="pc-kpi-card ui-kpi-card"><div class="pc-kpi-card__head"><span class="ui-kpi-icon" aria-hidden="true">✅</span><span class="ui-kpi-label">已完成</span></div><div class="pc-kpi-card__num ui-kpi-value pc-kpi-green" id="pc-kpi-done">—</div><div class="pc-kpi-card__foot ui-kpi-meta">篩選全量</div></div>
            <div class="pc-kpi-card ui-kpi-card"><div class="pc-kpi-card__head"><span class="ui-kpi-icon" aria-hidden="true">📝</span><span class="ui-kpi-label">草稿</span></div><div class="pc-kpi-card__num ui-kpi-value pc-kpi-amber" id="pc-kpi-draft">—</div><div class="pc-kpi-card__foot ui-kpi-meta">篩選全量</div></div>
          </div>
        </div>
      </section>

      <section class="pc-card" aria-label="篩選與列表">
        <div class="pc-card__hd">
          <h2>🔍 報表查詢</h2>
          <p>可依報表期間交集 / 上傳人 / 狀態 / 關鍵字篩選</p>
          <div class="pc-filter-bar">
            <div class="pc-field"><label>報表期間（起）</label><input id="pc-f-from" type="date"></div>
            <div class="pc-field"><label>報表期間（迄）</label><input id="pc-f-to" type="date"></div>
            <div class="pc-field"><label>報表歸屬人</label><select id="pc-f-person"><option value="">全部</option></select></div>
            <div class="pc-field"><label>報表類型</label><select id="pc-f-type"><option value="">全部</option><option value="general">一般零用金</option><option value="engineering">工程零用金</option></select></div><div class="pc-field"><label>狀態</label><select id="pc-f-status"><option value="">全部</option><option value="draft">草稿</option><option value="completed">已完成</option></select></div>
            <div class="pc-field pc-field--search"><label>檔名關鍵字</label><input id="pc-f-q" type="text" placeholder="檔名 / 歸屬人 / 製表人"></div>
            <div class="pc-filter-actions">
              <button class="btn btn--primary btn--md pc-btn" onclick="PettyCash.pcLoadHistory(true)">搜尋</button>
              <button class="btn btn--secondary btn--md pc-btn" onclick="PettyCash.pcResetFilter()">清除</button>
            </div>
          </div>
          <div class="pc-chips">
            <button class="chip pc-chip" data-role="pc-range" data-range="month" onclick="PettyCash.pcQuickRange('month',this)">本月</button>
            <button class="chip pc-chip" data-role="pc-range" data-range="prev" onclick="PettyCash.pcQuickRange('prev',this)">上月</button>
            <button class="chip pc-chip" data-role="pc-range" data-range="year" onclick="PettyCash.pcQuickRange('year',this)">今年</button>
            <button class="chip pc-chip is-active" data-role="pc-range" data-range="all" onclick="PettyCash.pcQuickRange('all',this)">全部</button>
            <span class="pc-result-count"><span id="pc-result-count">0 筆</span></span>
          </div>
        </div>
        <div class="pc-card__bd u-pt-0">
          <div class="pc-table-wrap pc-report-list-table-wrap"><table class="pc-table pc-report-list-table">
            <thead><tr><th>#</th><th>報表期間</th><th>報表類型</th><th>檔名</th><th>報表歸屬人</th><th>製表人</th><th>金額摘要</th><th>狀態</th><th>操作</th></tr></thead>
            <tbody id="pc-tbody"></tbody>
          </table></div>
          <div class="pc-cards" id="pc-cards"></div>
          <div id="pc-empty" class="pc-empty" style="display:none">
            <div class="pc-empty__icon">🪙</div>
            <div>沒有符合條件的月報</div>
            <div class="pc-hint">試試放寬期間或關鍵字，或切換「全部」</div>
          </div>
        </div>
        <div class="pc-pagination">
          <span id="pc-page-info"></span>
          <span class="u-d-flex u-gap-6">
            <button class="btn btn--secondary btn--sm" onclick="PettyCash.pcChangePage(-1)">‹ 上一頁</button>
            <button class="btn btn--secondary btn--sm" onclick="PettyCash.pcChangePage(1)">下一頁 ›</button>
          </span>
        </div>
      </section>
    </div>`;
	pcBindMoreMenuEvents();
	pcLoadPersons();
	pcLoadHistory();
}
async function pcLoadPersons() {
	try {
		pcPersons = (await apiFetch("/api/petty-cash-persons")).persons || [];
		const sel = document.getElementById("pc-f-person");
		if (!sel) return;
		const cur = sel.value;
		sel.innerHTML = "<option value=\"\">全部</option>" + pcPersons.map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join("");
		sel.value = cur;
	} catch (e) {}
}
async function pcLoadHistory(resetPage) {
	pcCloseAllMoreMenus();
	if (resetPage) pcPage = 1;
	if (!document.getElementById("pc-f-from")) return;
	const filters = _pcFilterSnapshot();
	const filterKey = _pcFilterKey(filters);
	const requestPage = pcPage;
	const requestSeq = pcHistoryGuard.next();
	const p = new URLSearchParams({
		...filters,
		page: requestPage,
		page_size: pcPageSize
	});
	try {
		const data = await apiFetch("/api/petty-cash-reports?" + p);
		if (!pcHistoryGuard.isCurrent(requestSeq) || _pcFilterKey(_pcFilterSnapshot()) !== filterKey) return;
		pcReports = data.items || [];
		pcTotal = data.total || 0;
		pcPage = data.page || requestPage;
		document.getElementById("pc-result-count").textContent = pcTotal + " 筆";
		pcRenderTable();
		pcUpdateKPI(filters);
	} catch (e) {}
}
function pcRenderTable() {
	const tb = document.getElementById("pc-tbody");
	const cards = document.getElementById("pc-cards");
	const empty = document.getElementById("pc-empty");
	if (!tb) return;
	if (!pcReports.length) {
		tb.innerHTML = "";
		cards.innerHTML = "";
		empty.style.display = "block";
	} else {
		empty.style.display = "none";
		tb.innerHTML = pcReports.map(pcDesktopRowHtml).join("");
		cards.innerHTML = pcReports.map(pcCardHtml).join("");
	}
	const max = Math.max(1, Math.ceil(pcTotal / pcPageSize));
	document.getElementById("pc-page-info").textContent = `第 ${esc(pcPage)} / ${esc(max)} 頁 · 共 ${esc(pcTotal)} 筆`;
}
function pcDesktopRowHtml(r, idx) {
	if (r.report_type === "engineering") return engDesktopRowHtml(r, idx);
	const ops = pcRowOpsHtml(r);
	return `<tr>
    <td>${esc(pcPageSize * (pcPage - 1) + idx + 1)}</td>
    <td>${_pcPeriodText(r)}</td>
    <td><span class="pc-status pc-status--general">一般零用金</span></td>
    <td>${_pcFileLabel(r)}</td>
    <td>${esc(r.upload_person)}</td>
    <td>${esc(r.prepared_by)}</td>
    <td class="pc-num"><strong>本期餘額 $${esc(_pcMoney(r.closing_balance))}</strong></td>
    <td>${pcStatusBadge(r.status)}</td>
    <td><div class="pc-row-actions">${ops}</div></td>
  </tr>`;
}
function pcReportCardHtml(r, typeLabel, typeClass, summaryLabel, summaryValue, fileLabel, engineering) {
	const ops = pcMobileOpsHtml(r, engineering);
	return `<div class="pc-report-card" onclick="PettyCash.pcOpenDetail(${r.id})">
    <div class="pc-report-card__top"><span class="pc-report-card__period">${_pcPeriodText(r)}</span><span class="pc-report-type ${esc(typeClass)}">${esc(typeLabel)}</span>${pcStatusBadge(r.status)}</div>
    <div class="pc-report-card__file">${esc(fileLabel)}</div>
    <div class="pc-report-card__meta">報表歸屬人：${esc(r.upload_person)} · 製表人：${esc(r.prepared_by)}</div>
    <div class="pc-report-card__balance"><span>${esc(summaryLabel)}</span> $${esc(_pcMoney(summaryValue))}</div>
    <div class="pc-row-actions pc-row-actions--mobile u-mt-10">${ops}</div>
  </div>`;
}
function pcCardHtml(r) {
	if (r.report_type === "engineering") return engCardHtml(r);
	return pcReportCardHtml(r, "一般零用金", "pc-report-type--general", "本期餘額", r.closing_balance, _pcFileLabelRaw(r), false);
}
function pcReportActionEntries(r, engineering) {
	const edit = engineering ? `PettyCash.pcOpenEngineeringModal(${r.id})` : `PettyCash.pcOpenReportModal(${r.id})`;
	const actions = [{
		label: "👁 檢視",
		action: `PettyCash.pcOpenDetail(${r.id})`
	}, {
		label: "⬇️ 匯出",
		action: `PettyCash.pcExport(${r.id})`
	}];
	if (r.can_edit) actions.splice(1, 0, {
		label: "✏️ 編輯",
		action: edit
	});
	if (r.can_delete) actions.push({
		label: "🗑 刪除",
		action: `PettyCash.pcDelete(${r.id}${engineering ? ", true" : ""})`,
		danger: true
	});
	return actions;
}
function pcMoreMenuHtml(r, engineering) {
	return `<span class="pc-report-actions"><details class="pc-more-menu" data-role="pc-more-menu" onclick="event.stopPropagation()"><summary aria-label="更多操作">⋯</summary><div class="pc-more-menu__list" data-role="pc-more-menu-list">${pcReportActionEntries(r, engineering).map((action) => `<button type="button" class="${action.danger ? "pc-more-menu__danger" : ""}" onclick="event.stopPropagation();PettyCash.pcCloseMoreMenuFromAction(this);${esc(action.action)}">${esc(action.label)}</button>`).join("")}</div></details></span>`;
}
var pcMoreMenuEventsBound = false;
function pcPositionMoreMenu(menu, list) {
	const rect = menu.getBoundingClientRect();
	const gap = 5;
	const top = window.innerHeight - rect.bottom < list.offsetHeight + 8 ? Math.max(8, rect.top - list.offsetHeight - gap) : rect.bottom + gap;
	const left = Math.min(Math.max(8, rect.right - list.offsetWidth), Math.max(8, window.innerWidth - list.offsetWidth - 8));
	list.style.top = `${top}px`;
	list.style.left = `${left}px`;
}
function pcCloseMoreMenu(menu) {
	if (!menu) return;
	const list = menu._pcMoreMenuList;
	if (list) {
		if (list.parentNode !== menu) menu.appendChild(list);
		list.classList.remove("pc-more-menu__list--portal");
		list.style.position = "";
		list.style.top = "";
		list.style.left = "";
		list.style.right = "";
		list.style.zIndex = "";
		delete list._pcMoreMenuOwner;
		delete menu._pcMoreMenuList;
	}
	menu.removeAttribute("open");
	const row = menu.closest("tr");
	if (row) row.classList.remove("pc-more-menu-row--open");
}
function pcCloseMoreMenuFromAction(element) {
	const list = element && element.closest("[data-role=\"pc-more-menu-list\"]");
	pcCloseMoreMenu(list && list._pcMoreMenuOwner || element && element.closest("[data-role=\"pc-more-menu\"]"));
}
function pcCloseAllMoreMenus() {
	document.querySelectorAll("[data-role=\"pc-more-menu\"]").forEach(pcCloseMoreMenu);
	document.querySelectorAll("[data-role=\"pc-more-menu-list\"][data-portal]").forEach((list) => {
		if (!list._pcMoreMenuOwner) list.remove();
	});
}
function pcPortalMoreMenu(menu) {
	const list = menu.querySelector("[data-role=\"pc-more-menu-list\"]");
	if (!list || list.parentNode === document.body) return;
	menu._pcMoreMenuList = list;
	list._pcMoreMenuOwner = menu;
	list.classList.add("pc-more-menu__list--portal");
	list.dataset.portal = "true";
	document.body.appendChild(list);
	list.style.position = "fixed";
	list.style.right = "auto";
	list.style.zIndex = "1000";
	pcPositionMoreMenu(menu, list);
}
function pcBindMoreMenuEvents() {
	if (pcMoreMenuEventsBound) return;
	pcMoreMenuEventsBound = true;
	document.addEventListener("toggle", (event) => {
		const menu = event.target;
		if (!menu.matches || !menu.matches("[data-role=\"pc-more-menu\"]")) return;
		const row = menu.closest("tr");
		if (!menu.open) {
			pcCloseMoreMenu(menu);
			return;
		}
		document.querySelectorAll("[data-role=\"pc-more-menu\"][open]").forEach((other) => {
			if (other !== menu) pcCloseMoreMenu(other);
		});
		pcPortalMoreMenu(menu);
		if (row) row.classList.add("pc-more-menu-row--open");
	}, true);
	document.addEventListener("scroll", () => {
		const menu = document.querySelector("[data-role=\"pc-more-menu\"][open]");
		if (menu && menu._pcMoreMenuList) pcPositionMoreMenu(menu, menu._pcMoreMenuList);
	}, true);
	window.addEventListener("resize", () => {
		const menu = document.querySelector("[data-role=\"pc-more-menu\"][open]");
		if (menu && menu._pcMoreMenuList) pcPositionMoreMenu(menu, menu._pcMoreMenuList);
	});
	document.addEventListener("click", (event) => {
		if (event.target.closest && event.target.closest("[data-role=\"pc-more-menu\"], [data-role=\"pc-more-menu-list\"]")) return;
		pcCloseAllMoreMenus();
	}, true);
}
function pcMobileOpsHtml(r, engineering) {
	return `<span class="pc-report-actions pc-report-actions--mobile" onclick="event.stopPropagation()">${pcReportActionEntries(r, engineering).map((action) => `<button type="button" class="pc-mobile-action${action.danger ? " pc-mobile-action--danger" : ""}" onclick="${esc(action.action)}">${esc(action.label)}</button>`).join("")}</span>`;
}
function pcRowOpsHtml(r) {
	return pcMoreMenuHtml(r, false);
}
async function pcUpdateKPI(filterSnapshot) {
	const snapshot = filterSnapshot || _pcFilterSnapshot();
	const filterKey = _pcFilterKey(snapshot);
	const requestSeq = pcKpiGuard.next();
	const p = new URLSearchParams(snapshot);
	try {
		const k = await apiFetch("/api/petty-cash/kpi?" + p);
		if (!pcKpiGuard.isCurrent(requestSeq) || _pcFilterKey(_pcFilterSnapshot()) !== filterKey) return;
		document.getElementById("pc-kpi-total").textContent = k.total;
		document.getElementById("pc-kpi-done").textContent = k.completed;
		document.getElementById("pc-kpi-draft").textContent = k.draft;
	} catch (e) {}
}
function pcResetFilter() {
	document.getElementById("pc-f-from").value = "";
	document.getElementById("pc-f-to").value = "";
	document.getElementById("pc-f-person").value = "";
	document.getElementById("pc-f-status").value = "";
	document.getElementById("pc-f-type").value = "";
	document.getElementById("pc-f-q").value = "";
	document.querySelectorAll("[data-role=\"pc-range\"]").forEach((c) => c.classList.toggle("is-active", c.dataset.range === "all"));
	pcPage = 1;
	pcLoadHistory();
}
function pcQuickRange(k, btn) {
	document.querySelectorAll("[data-role=\"pc-range\"]").forEach((c) => c.classList.remove("is-active"));
	btn.classList.add("is-active");
	const now = /* @__PURE__ */ new Date();
	const f = document.getElementById("pc-f-from");
	const t = document.getElementById("pc-f-to");
	if (k === "month") {
		f.value = _pcIso(new Date(now.getFullYear(), now.getMonth(), 1));
		t.value = _pcIso(new Date(now.getFullYear(), now.getMonth() + 1, 0));
	} else if (k === "prev") {
		f.value = _pcIso(new Date(now.getFullYear(), now.getMonth() - 1, 1));
		t.value = _pcIso(new Date(now.getFullYear(), now.getMonth(), 0));
	} else if (k === "year") {
		f.value = _pcIso(new Date(now.getFullYear(), 0, 1));
		t.value = _pcIso(new Date(now.getFullYear(), 11, 31));
	} else {
		f.value = "";
		t.value = "";
	}
	pcPage = 1;
	pcLoadHistory();
}
function pcChangePage(d) {
	const max = Math.max(1, Math.ceil(pcTotal / pcPageSize));
	const next = Math.min(max, Math.max(1, pcPage + d));
	if (next === pcPage) return;
	pcPage = next;
	pcLoadHistory();
}
async function pcOpenDetail(id) {
	pcCloseAllMoreMenus();
	const requestSeq = pcDetailGuard.next();
	try {
		const detail = await apiFetch("/api/petty-cash-reports/" + id);
		if (!pcDetailGuard.isCurrent(requestSeq)) return;
		pettyCashState.pcDetail = detail;
		pcDetailExpanded = /* @__PURE__ */ new Set();
		engExpandedCategories = /* @__PURE__ */ new Set();
		engExpandedGroups = /* @__PURE__ */ new Set();
		engExpandedReceipts = /* @__PURE__ */ new Set();
		engUiInitialized = false;
		pcRenderDetail();
	} catch (e) {
		if (pcDetailGuard.isCurrent(requestSeq)) toast(e.status ? "⚠️ 讀取失敗" : "⚠️ 網路錯誤：" + e.message);
	}
}
function pcDetailHeaderHtml(r, engineering) {
	const canEdit = !!r.can_edit;
	const canDelete = !!r.can_delete;
	const titleBadge = engineering ? "<span class=\"pc-status pc-status--engineering\">工程零用金</span>" : pcStatusBadge(r.status);
	const fileLabel = engineering ? r.filename || "" : r.filename || "零用金-" + (r.filename_text || "") + _pcMD(r.start_date) + "~" + _pcMD(r.end_date) + ".xlsx";
	const ownerMeta = `報表歸屬人：${esc(r.upload_person)} · 製表人：${esc(r.prepared_by)}`;
	const edit = engineering ? `PettyCash.pcOpenEngineeringModal(${r.id})` : `PettyCash.pcOpenReportModal(${r.id})`;
	const remove = `PettyCash.pcDelete(${r.id}, true)`;
	return `<div class="pc-page-header"><div class="pc-page-title"><h1>🪙 ${esc(_pcPeriodText(r))} ${titleBadge}</h1>${engineering ? `<p>${ownerMeta}</p><p class="eng-file-label">${esc(fileLabel)}</p>` : `<p>${esc(fileLabel)} · ${ownerMeta}</p>`}</div><div class="pc-page-actions"><button class="btn btn--secondary btn--md pc-btn" onclick="PettyCash.renderPettyCash()">← 返回列表</button>${canEdit ? `<button class="btn btn--secondary btn--md pc-btn" onclick="${esc(edit)}">✏️ 編輯</button>` : ""}<button class="btn btn--primary btn--md pc-btn" onclick="PettyCash.pcExport(${esc(r.id)})">⬇️ ${engineering ? "匯出" : "匯出 Excel"}</button>${canDelete ? `<button class="btn btn--danger btn--md pc-btn" onclick="${esc(remove)}">🗑 刪除</button>` : ""}</div></div>`;
}
function pcDetailKpiCardHtml(card) {
	return `<div class="pc-kpi-card ui-kpi-card"><div class="pc-kpi-card__head">${card.icon ? `<span class="ui-kpi-icon ${esc(card.iconClass || "")}">${esc(card.icon)}</span>` : ""}<span class="ui-kpi-label">${esc(card.label)}</span></div><div class="pc-kpi-card__num ui-kpi-value ${esc(card.colorClass || "")}">${esc(card.value)}</div>${card.foot ? `<div class="pc-kpi-card__foot ui-kpi-meta">${esc(card.foot)}</div>` : ""}</div>`;
}
function pcDetailKpiRowHtml(cards) {
	return `<div class="pc-kpi-row ui-kpi-grid">${cards.map(pcDetailKpiCardHtml).join("")}</div>`;
}
var pcDetailExpanded = /* @__PURE__ */ new Set();
function pcToggleGeneralEntry(index) {
	if (pcDetailExpanded.has(index)) pcDetailExpanded.delete(index);
	else pcDetailExpanded.add(index);
	pcRenderDetail();
}
var pcGeneralDetailEventsBound = false;
function pcBindGeneralDetailEvents() {
	if (pcGeneralDetailEventsBound) return;
	pcGeneralDetailEventsBound = true;
	document.addEventListener("click", (event) => {
		const element = event.target.closest("[data-action=\"pc-toggle-entry\"]");
		if (!element) return;
		event.preventDefault();
		event.stopPropagation();
		pcToggleGeneralEntry(Number(element.dataset.entryIndex));
	}, true);
}
/**
* 明細金額未全部填妥時仍顯示正常，避免拿不完整合計與帳務金額比較。
* @param {Object} e 收支紀錄及其明細資料。
* @returns {string} 狀態徽章 HTML；僅完整填寫後才可能顯示差異警示。
*/
function pcEntryStatus(e) {
	const items = Array.isArray(e.items) ? e.items : [];
	const allItemsPriced = items.length > 0 && items.every((item) => Number(item.amount) > 0);
	if (items.length && !allItemsPriced) return "<span class=\"pc-entry-status\">● 正常</span>";
	return e.amount_warning ? "<span class=\"pc-entry-status pc-entry-status--warn\">⚠ 金額不一致</span>" : "<span class=\"pc-entry-status\">● 正常</span>";
}
function pcItemText(it) {
	return (it.item_name || it.description || "—") + (it.qty == null || it.qty === "" ? "" : ` ×${it.qty}${it.unit || ""}`);
}
function pcDetailSubtableHtml(rows) {
	return `<div class="pc-general-detail-list"><div class="pc-general-detail-head"><span>項次</span><span>細項</span></div>${rows.map((row, i) => `<div class="pc-general-detail-item"><span class="pc-general-detail-index">${esc(String(i + 1).padStart(2, "0"))}</span><span class="pc-general-detail-description">${esc(row.description)}</span></div>`).join("")}</div>`;
}
/**
* 呈現一般零用金明細；僅在所有明細金額完整填寫後顯示合計與差額。
* @param {Object} e 收支紀錄與商品明細。
* @returns {string} 已跳脫使用者資料的明細 HTML。
*/
function pcGeneralDetailsHtml(e) {
	if (!e.items || !e.items.length) return "";
	const allItemsPriced = e.items.every((item) => Number(item.amount) > 0);
	const detailTotal = e.detail_total == null ? null : "$" + _pcMoney(e.detail_total);
	const difference = e.difference == null ? null : (e.difference >= 0 ? "+$" : "-$") + _pcMoney(Math.abs(e.difference));
	const rows = e.items.map((it) => ({ description: pcItemText(it) }));
	return `<div class="pc-general-detail-panel"><div class="pc-general-detail-title">單據明細（${esc(e.items.length)} 項）</div>${pcDetailSubtableHtml(rows)}${allItemsPriced ? `<div class="pc-general-discrepancy"><span>帳務支出 <b>$${esc(_pcMoney(e.amount))}</b></span><span>明細合計 <b>${esc(detailTotal || "—")}</b></span><span>差額 <b>${esc(difference || "—")}</b></span></div>` : ""}</div>`;
}
function pcGeneralEntryRowsHtml(entries) {
	let seq = 0;
	return (entries || []).map((e, i) => {
		seq += 1;
		const expanded = pcDetailExpanded.has(i);
		const hasItems = !!(e.items && e.items.length);
		const summary = e.description || (hasItems ? `${e.items.length} 項明細` : "—");
		const incomeText = e.entry_type === "income" ? "+" + esc(_pcMoney(e.amount)) : "—";
		const expenseText = e.entry_type !== "income" ? "-" + esc(_pcMoney(e.amount)) : "—";
		const toggle = hasItems ? `<button type="button" class="pc-inline-expand" aria-expanded="${expanded}" data-action="pc-toggle-entry" data-entry-index="${i}">${expanded ? "▼" : "▶"}</button>` : "";
		return `<tr class="${hasItems ? "pc-general-entry-row pc-general-entry-row--expandable" : "pc-general-entry-row"}"${hasItems ? ` data-action="pc-toggle-entry" data-entry-index="${i}"` : ""}><td>${esc(seq)}</td><td class="pc-nowrap">${esc(_pcDate(e.entry_date))}</td><td>${toggle}<span>${esc(summary)}</span>${hasItems ? ` <small>（${esc(e.items.length)} 項）</small>` : ""}</td><td class="pc-money pc-money--income">${incomeText}</td><td class="pc-money pc-money--expense">${expenseText}</td><td>${esc(e.category || "—")}</td><td>${pcEntryStatus(e)}</td><td>—</td></tr>` + (expanded ? `<tr class="pc-general-detail-row"><td></td><td colspan="7">${pcGeneralDetailsHtml(e)}</td></tr>` : "");
	}).join("");
}
function pcGeneralMobileCardsHtml(entries) {
	return (entries || []).map((e, i) => {
		const expanded = pcDetailExpanded.has(i);
		const isIncome = e.entry_type === "income";
		const hasItems = !!(e.items && e.items.length);
		return `<article class="pc-general-tx-card"><div class="pc-general-tx-main"><div class="pc-general-tx-top"><span class="pc-nowrap">${esc(_pcDate(e.entry_date))}</span>${e.category ? `<span class="pc-entry-card__cat">${esc(e.category)}</span>` : ""}</div><div class="pc-general-tx-desc">${esc(e.description || (hasItems ? `${e.items.length} 項明細` : "—"))}</div><div class="pc-general-tx-bottom"><span class="${isIncome ? "pc-money--income" : "pc-money--expense"}">${isIncome ? "收入 +" : "支出 -"}$${esc(_pcMoney(e.amount))}</span>${pcEntryStatus(e)}</div>${hasItems ? `<button type="button" class="pc-general-detail-toggle" data-action="pc-toggle-entry" data-entry-index="${i}">${expanded ? "收合明細 ▲" : `查看 ${e.items.length} 項明細 ▼`}</button>` : ""}</div>${expanded ? pcGeneralDetailsHtml(e) : ""}</article>`;
	}).join("");
}
function pcRenderDetail() {
	if (pettyCashState.pcDetail.report_type === "engineering") return engRenderDetail();
	const el = document.getElementById("content");
	const r = pettyCashState.pcDetail, t = r.totals;
	const kpis = [
		{
			label: "上期餘額",
			value: "$" + _pcMoney(t.opening_balance),
			colorClass: "pc-kpi-opening"
		},
		{
			label: "本期收入",
			value: "+$" + _pcMoney(t.income),
			colorClass: "pc-kpi-income"
		},
		{
			label: "本期支出",
			value: "-$" + _pcMoney(t.expense),
			colorClass: "pc-kpi-expense"
		},
		{
			label: "本期餘額",
			value: "$" + _pcMoney(t.closing_balance),
			colorClass: "pc-kpi-balance"
		}
	];
	el.innerHTML = `<div class="pc-wrap">${pcDetailHeaderHtml(r, false)}<section class="pc-card pc-general-detail-kpi"><div class="pc-card__bd">${pcDetailKpiRowHtml(kpis)}</div></section><section class="pc-card"><div class="pc-card__hd"><h2>📝 收支明細</h2></div><div class="pc-card__bd"><div class="pc-table-wrap pc-general-detail-table-wrap"><table class="pc-detail-table pc-general-detail-table"><thead><tr><th>項次</th><th>日期</th><th>摘要／明細</th><th>收入</th><th>支出</th><th>科目</th><th>狀態</th><th>操作</th></tr></thead><tbody>${pcGeneralEntryRowsHtml(r.entries)}</tbody></table></div><div class="pc-general-mobile-list">${pcGeneralMobileCardsHtml(r.entries)}</div></div></section></div>`;
	pcBindGeneralDetailEvents();
}
function pcExport(id) {
	pcCloseAllMoreMenus();
	window.open("/api/petty-cash-reports/" + id + "/export.xlsx", "_blank");
}
async function pcDelete(id, backToList) {
	pcCloseAllMoreMenus();
	if (!confirm("確定刪除這份零用金月報？底下收支紀錄會一併刪除。")) return;
	try {
		await apiFetch("/api/petty-cash-reports/" + id, {
			method: "DELETE",
			fallback: "刪除失敗"
		});
	} catch (e) {
		toast("⚠️ " + e.message);
		return;
	}
	toast("🗑 已刪除");
	if (backToList) renderPettyCash();
	else pcLoadHistory();
}
function engDesktopRowHtml(r, idx) {
	const ops = pcMoreMenuHtml(r, true);
	return `<tr><td>${esc(pcPageSize * (pcPage - 1) + idx + 1)}</td><td>${_pcPeriodText(r)}</td><td><span class="pc-status pc-status--engineering">工程零用金</span></td><td>${esc(r.filename || r.filename_text || "")}</td><td>${esc(r.upload_person)}</td><td>${esc(r.prepared_by)}</td><td class="pc-num"><strong>總計 $${esc(_pcMoney(r.total_amount))}</strong></td><td>${pcStatusBadge(r.status)}</td><td><div class="pc-row-actions">${ops}</div></td></tr>`;
}
function engCardHtml(r) {
	return pcReportCardHtml(r, "工程零用金", "pc-report-type--engineering", "總計", r.total_amount, r.filename || r.filename_text || "", true);
}
var engExpandedCategories = /* @__PURE__ */ new Set();
var engExpandedGroups = /* @__PURE__ */ new Set();
var engExpandedReceipts = /* @__PURE__ */ new Set();
var engUiInitialized = false;
function engToggle(kind, key) {
	const set = {
		categories: engExpandedCategories,
		groups: engExpandedGroups,
		receipts: engExpandedReceipts
	}[kind];
	if (set.has(key)) set.delete(key);
	else set.add(key);
	engRenderDetail();
}
function engReceiptDetailsHtml(q) {
	const details = q.details || [];
	if (!details.length) return "<div class=\"pc-empty-cell\">此單據尚無細項</div>";
	const rows = details.map((d) => ({ description: d }));
	return `<div class="pc-general-detail-panel eng-receipt-details"><div class="pc-general-detail-title"><span>單據明細（${esc(details.length)} 項）</span><span class="eng-detail-total">單據金額 $${esc(_pcMoney(q.amount))}</span></div>${pcDetailSubtableHtml(rows)}</div>`;
}
function engReceiptHtml(q, ri, groupKey) {
	const receiptKey = groupKey + ":" + ri;
	const details = q.details || [];
	const expanded = engExpandedReceipts.has(receiptKey);
	const toggle = ` type="button" aria-expanded="${expanded}" onclick="PettyCash.engToggle('receipts','${jsStr(receiptKey)}')"`;
	const detailRow = expanded ? `<tr class="eng-receipt-detail-row"><td colspan="4">${engReceiptDetailsHtml(q)}</td></tr>` : "";
	return `<tr class="eng-receipt-row"><td><button class="eng-receipt-toggle"${toggle}><span class="eng-receipt-chevron">${expanded ? "▼" : "▶"}</span><span class="eng-receipt-no">${esc(q.receipt_number || "未填寫單據")}</span></button></td><td><span class="eng-tax-mark">${esc(q.tax_id_mark || "—")}</span></td><td class="eng-detail-count">${details.length ? `${esc(details.length)} 項明細` : "無細項"}</td><td class="pc-num"><strong>$${esc(_pcMoney(q.amount))}</strong></td></tr>${detailRow}`;
}
function engGroupHtml(g, ci, gi) {
	const groupKey = ci + ":" + gi;
	const expanded = engExpandedGroups.has(groupKey);
	const receipts = (g.receipts || []).map((q, ri) => engReceiptHtml(q, ri, groupKey)).join("");
	return `<section class="eng-group-block"><button class="eng-group-head${expanded ? " is-open" : ""}" aria-expanded="${expanded}" onclick="PettyCash.engToggle('groups','${jsStr(groupKey)}')"><span><span class="eng-chevron">${expanded ? "▼" : "▶"}</span><b>${esc(g.name)}</b></span><strong>項目小計 $${esc(_pcMoney(g.subtotal))}</strong></button>${expanded ? `<div class="eng-group-body"><div class="eng-detail-table-wrap"><table class="eng-detail-table"><thead><tr><th>單據</th><th>統編</th><th>明細</th><th>金額</th></tr></thead><tbody>${receipts || "<tr><td colspan=\"4\" class=\"pc-empty-cell\">尚無單據</td></tr>"}</tbody></table></div></div>` : ""}</section>`;
}
function engRenderDetail() {
	const r = pettyCashState.pcDetail, cats = r.categories || [];
	if (!engUiInitialized) {
		engUiInitialized = true;
		if (cats[0]) {
			engExpandedCategories.add(String(cats[0].id));
			if (cats[0].groups && cats[0].groups[0]) engExpandedGroups.add("0:0");
		}
	}
	const totalReceipts = cats.reduce((n, c) => n + (c.groups || []).reduce((m, g) => m + (g.receipts || []).length, 0), 0);
	const categoryHtml = cats.map((c, ci) => {
		const key = String(c.id || ci), expanded = engExpandedCategories.has(key);
		return `<section class="pc-card eng-category-card"><button class="eng-category-head" aria-expanded="${expanded}" onclick="PettyCash.engToggle('categories','${jsStr(key)}')"><span><span class="eng-chevron">${expanded ? "▼" : "▶"}</span><span class="eng-section-kicker">分類</span><h2>${esc(c.name)}</h2></span><strong class="eng-subtotal">分類小計 $${esc(_pcMoney(c.subtotal))}</strong></button>${expanded ? `<div class="pc-card__bd">${(c.groups || []).map((g, gi) => engGroupHtml(g, ci, gi)).join("") || "<div class=\"pc-empty-cell\">此分類尚無項目</div>"}</div>` : ""}</section>`;
	}).join("");
	const kpis = [
		{
			label: "總分類數",
			value: String(cats.length),
			colorClass: "pc-kpi-blue",
			icon: "▦",
			iconClass: "ui-kpi-icon--blue"
		},
		{
			label: "總單據數",
			value: String(totalReceipts),
			colorClass: "pc-kpi-green",
			icon: "▤",
			iconClass: "ui-kpi-icon--green"
		},
		{
			label: "工程零用金總計",
			value: "$" + _pcMoney(r.total_amount),
			colorClass: "pc-kpi-balance",
			icon: "$",
			iconClass: "ui-kpi-icon--amber"
		}
	];
	document.getElementById("content").innerHTML = `<div class="pc-wrap eng-detail-view">${pcDetailHeaderHtml(r, true)}<section class="pc-card eng-guide-card"><div class="pc-card__bd"><strong>ⓘ 如何閱讀這份工程零用金？</strong><span>分類是費用大類；項目是分類下的用途；一張單據可包含多個明細項目，單據金額只計算一次。</span></div></section><section class="pc-card"><div class="pc-card__bd">${pcDetailKpiRowHtml(kpis)}</div></section>${categoryHtml || "<div class=\"pc-empty\">尚未建立任何分類<br><small>請按「編輯」新增第一個分類</small></div>"}</div>`;
}
//#endregion
//#region static/js/features/quotation/page.js
var page_exports$1 = /* @__PURE__ */ __exportAll({
	initQuotationPage: () => initQuotationPage,
	quoteAddItem: () => quoteAddItem,
	quoteCloseInventory: () => quoteCloseInventory,
	quoteDelete: () => quoteDelete,
	quoteDownload: () => quoteDownload,
	quoteEdit: () => quoteEdit,
	quoteLoadHistory: () => quoteLoadHistory,
	quoteOpenInventory: () => quoteOpenInventory,
	quoteReset: () => quoteReset,
	quoteSave: () => quoteSave,
	quoteSearchInventory: () => quoteSearchInventory,
	quoteSwitchMode: () => quoteSwitchMode,
	quoteUseInventory: () => quoteUseInventory,
	renderQuotation: () => renderQuotation
});
var quotationItems = [];
var quotationEditingId = null;
var quotationHistory = [];
var quotationInventoryResults = [];
var quotationForm = {};
function quoteMoney(value) {
	return Number(value || 0).toLocaleString("zh-TW", {
		minimumFractionDigits: 0,
		maximumFractionDigits: 2
	});
}
function quoteNumber(value) {
	var number = Number(value);
	return Number.isFinite(number) && number >= 0 ? number : 0;
}
function quoteToday() {
	return (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
}
function quoteBlankForm() {
	return {
		quote_number: "",
		quote_date: quoteToday(),
		customer_name: "",
		contact: "",
		address: "",
		valid_days: 30,
		tax_type: "included",
		note: ""
	};
}
function quoteCanManage() {
	return hasPerm("item-mgmt");
}
function quoteReadForm() {
	return {
		quote_number: document.getElementById("quote-number")?.value.trim() || "",
		quote_date: document.getElementById("quote-date")?.value || "",
		customer_name: document.getElementById("quote-customer")?.value.trim() || "",
		contact: document.getElementById("quote-contact")?.value.trim() || "",
		address: document.getElementById("quote-address")?.value.trim() || "",
		valid_days: Math.max(1, Number(document.getElementById("quote-valid-days")?.value || 30)),
		tax_type: document.getElementById("quote-tax")?.value || "included",
		note: document.getElementById("quote-note")?.value.trim() || ""
	};
}
function quoteFillForm(form) {
	Object.entries({
		"quote-number": form.quote_number,
		"quote-date": form.quote_date,
		"quote-customer": form.customer_name,
		"quote-contact": form.contact,
		"quote-address": form.address,
		"quote-valid-days": form.valid_days,
		"quote-tax": form.tax_type,
		"quote-note": form.note
	}).forEach(function(pair) {
		var el = document.getElementById(pair[0]);
		if (el) el.value = pair[1] ?? "";
	});
}
function quoteSwitchMode(mode) {
	setPageScope(mode === "upload" ? "quotation-upload" : "quotation");
	if (mode === "upload") renderQuotationUploads();
	else renderQuotation();
}
function renderQuotation() {
	var el = document.getElementById("content");
	if (!el) return;
	if (!quotationForm.quote_date) quotationForm = quoteBlankForm();
	if (!quotationItems.length) quotationItems = [{
		inventory_item_id: null,
		item_name: "",
		specification: "",
		qty: 1,
		unit: "式",
		unit_price: 0
	}];
	var pageTitle = quotationEditingId ? "編輯報價單" : "報價單";
	var saveLabel = quotationEditingId ? "更新報價單" : "儲存報價單";
	var canManage = quoteCanManage();
	el.innerHTML = `
    <div class="quote-wrap">
      ${quoteModeTabs("quotation")}
      <div class="dsr-page-header quote-page-header">
        <div class="dsr-page-title"><h1>🧾 ${esc(pageTitle)} <span class="dsr-new-badge">NEW</span></h1><p>建立冷凍空調工程報價單，整理客戶資料與報價明細。</p></div>
        <div class="dsr-page-actions">${canManage ? `<button class="btn btn--secondary btn--md dsr-btn" onclick="Quotation.quoteReset()">清除表單</button><button class="btn btn--primary btn--md dsr-btn dsr-btn--primary" onclick="Quotation.quoteSave()">💾 ${esc(saveLabel)}</button>` : ""}</div>
      </div>
      <div class="quote-layout">
        <section class="dsr-card quote-card" aria-labelledby="quote-basic-title"><div class="dsr-card__hd"><h2 id="quote-basic-title">📋 報價單資料</h2><p>建立日期與有效期限</p></div><div class="dsr-card__bd">
          <div class="dsr-form-grid dsr-form-grid--two">
            <div class="dsr-field"><label for="quote-number">報價單號(選填)</label><input id="quote-number" type="text" placeholder="留白自動編號"></div>
            <div class="dsr-field"><label for="quote-date">報價日期<span class="dsr-required">*</span></label><input id="quote-date" type="date"></div>
            <div class="dsr-field"><label for="quote-customer">客戶名稱<span class="dsr-required">*</span></label><input id="quote-customer" type="text" placeholder="例：振佳空調工程行"></div>
            <div class="dsr-field"><label for="quote-contact">聯絡人／電話(選填)</label><input id="quote-contact" type="text" placeholder="例：王先生／02-1234-5678"></div>
            <div class="dsr-field"><label for="quote-valid-days">報價有效天數(選填)</label><input id="quote-valid-days" type="number" min="1" max="3650" value="30"></div>
            <div class="dsr-field"><label for="quote-tax">稅別(選填)</label><select id="quote-tax"><option value="included">含稅</option><option value="excluded">未稅</option></select></div>
          </div>
          <div class="dsr-field quote-field-gap"><label for="quote-address">工程地址(選填)</label><input id="quote-address" type="text" placeholder="例：台北市○○區○○路 100 號"></div>
          <div class="dsr-field quote-field-gap"><label for="quote-note">備註／付款條件(選填)</label><textarea id="quote-note" rows="3" placeholder="例：訂金 30%，完工驗收後付清"></textarea></div>
        </div></section>
        <aside class="quote-side"><div class="dsr-info"><h3>💡 報價流程</h3><ul><li><span class="dsr-badge">1</span>填寫客戶與工程基本資料</li><li><span class="dsr-badge">2</span>從庫存帶入或新增報價明細</li><li><span class="dsr-badge">3</span>確認數量、單價與合計金額</li><li><span class="dsr-badge">4</span>儲存後可編輯、刪除、列印或匯出</li></ul><div class="dsr-info-badges"><span class="dsr-badge">🧾 可保存歷史</span><span class="dsr-badge">📱 手機可編輯</span></div></div>
          <div class="dsr-card quote-summary-card"><div class="dsr-card__hd"><h2>📊 金額摘要</h2><p>即時試算</p></div><div class="dsr-card__bd"><div class="quote-summary-row"><span>明細項目</span><strong id="quote-summary-count">0 項</strong></div><div class="quote-summary-row"><span>未稅小計</span><strong id="quote-summary-subtotal">$0</strong></div><div class="quote-summary-row"><span>稅額</span><strong id="quote-summary-tax">$0</strong></div><div class="quote-summary-total"><span>報價總額</span><strong id="quote-summary-total">$0</strong></div></div></div></aside>
        <section class="dsr-card quote-card quote-items-card"><div class="dsr-card__hd"><div class="quote-items-heading"><h2>🛠️ 報價明細</h2><p>材料、設備、人工與其他費用</p></div><div class="quote-items-actions">${canManage ? `<button class="btn btn--secondary btn--md dsr-btn" onclick="Quotation.quoteOpenInventory()">📦 從庫存帶入</button><button class="btn btn--primary btn--md dsr-btn dsr-btn--primary" onclick="Quotation.quoteAddItem()">＋ 新增明細</button>` : ""}</div></div><div class="u-pt-0 dsr-card__bd"><div class="quote-items-table-wrap"><table class="quote-items-table"><thead><tr><th>品項名稱*</th><th>規格／說明(選填)</th><th>數量*</th><th>單位(選填)</th><th>單價*</th><th>小計</th><th>操作</th></tr></thead><tbody id="quote-items-body"></tbody></table></div></div></section>
        <section class="dsr-card quote-card quote-history-card"><div class="dsr-card__hd"><div class="quote-items-heading"><h2>🗂️ 歷史報價單</h2><p>可搜尋、編輯、刪除與匯出</p></div><div class="quote-history-filter"><input id="quote-history-q" type="search" placeholder="搜尋報價單號／客戶"><button class="btn btn--secondary btn--md dsr-btn" onclick="Quotation.quoteLoadHistory()">搜尋</button></div></div><div class="u-pt-0 dsr-card__bd"><div id="quote-history-list" class="quote-history-list"></div><div id="quote-history-empty" class="dsr-empty" style="display:none"><div class="dsr-empty__icon">🗂</div><div>目前沒有歷史報價單</div></div></div></section>
      </div>
    </div>
    <div id="quote-inventory-overlay" class="quote-overlay" onclick="if(event.target===this)Quotation.quoteCloseInventory()"><div class="quote-inventory-modal"><div class="dsr-modal__hd"><h3>📦 從庫存帶入品項</h3><button class="btn btn--secondary btn--sm" onclick="Quotation.quoteCloseInventory()">✕ 關閉</button></div><div class="quote-inventory-search"><input id="quote-inventory-q" type="search" placeholder="搜尋品項、品牌或型號"><button class="btn btn--primary btn--md dsr-btn dsr-btn--primary" onclick="Quotation.quoteSearchInventory()">搜尋</button></div><div id="quote-inventory-list" class="quote-inventory-list"></div></div></div>`;
	quoteFillForm(quotationForm);
	quoteRenderItems();
	quoteLoadHistory();
}
function quoteRenderItems() {
	var body = document.getElementById("quote-items-body");
	if (!body) return;
	body.innerHTML = quotationItems.map(function(item, index) {
		return `<tr data-index="${esc(String(index))}"><td data-label="品項名稱"><input class="quote-line-input" data-role="quote-line-input" data-field="item_name" type="text" value="${esc(item.item_name)}" placeholder="例：分離式冷氣安裝"></td><td data-label="規格／說明"><input class="quote-line-input" data-role="quote-line-input" data-field="specification" type="text" value="${esc(item.specification)}" placeholder="例：3.6kW，含基本安裝"></td><td data-label="數量"><input class="quote-line-input quote-number-input" data-role="quote-line-input" data-field="qty" type="number" min="0.01" step="any" value="${esc(String(item.qty))}"></td><td data-label="單位"><input class="quote-line-input quote-unit-input" data-role="quote-line-input" data-field="unit" type="text" value="${esc(item.unit)}"></td><td data-label="單價"><input class="quote-line-input quote-number-input" data-role="quote-line-input" data-field="unit_price" type="number" min="0" step="any" value="${esc(String(item.unit_price))}"></td><td data-label="小計" class="quote-line-total" data-role="quote-line-total">$${esc(String(quoteMoney(quoteNumber(item.qty) * quoteNumber(item.unit_price))))}</td><td data-label="操作">${quoteCanManage() ? `<button class="btn btn--danger btn--sm dsr-action-btn dsr-action-btn--danger" type="button" data-remove-index="${esc(String(index))}">刪除</button>` : ""}</td></tr>`;
	}).join("");
	body.querySelectorAll("[data-role=\"quote-line-input\"]").forEach(function(input) {
		input.addEventListener("input", function() {
			var item = quotationItems[Number(input.closest("tr").dataset.index)];
			var field = input.dataset.field;
			item[field] = ["qty", "unit_price"].includes(field) ? quoteNumber(input.value) : input.value;
			quoteUpdateTotals();
		});
	});
	body.querySelectorAll("[data-remove-index]").forEach(function(button) {
		button.addEventListener("click", function() {
			quotationItems.splice(Number(button.dataset.removeIndex), 1);
			if (!quotationItems.length) quoteAddItem();
			else quoteRenderItems();
		});
	});
	quoteUpdateTotals();
}
function quoteUpdateTotals() {
	var lineTotal = quotationItems.reduce(function(sum, item) {
		return sum + quoteNumber(item.qty) * quoteNumber(item.unit_price);
	}, 0);
	var included = document.getElementById("quote-tax")?.value === "included";
	var tax = included ? lineTotal * 5 / 105 : lineTotal * .05;
	var subtotal = included ? lineTotal - tax : lineTotal;
	var total = included ? lineTotal : lineTotal + tax;
	[
		["quote-summary-count", quotationItems.length + " 項"],
		["quote-summary-subtotal", "$" + quoteMoney(subtotal)],
		["quote-summary-tax", "$" + quoteMoney(tax)],
		["quote-summary-total", "$" + quoteMoney(total)]
	].forEach(function(pair) {
		var el = document.getElementById(pair[0]);
		if (el) el.textContent = pair[1];
	});
	document.querySelectorAll("[data-role=\"quote-line-total\"]").forEach(function(cell, index) {
		var item = quotationItems[index];
		if (item) cell.textContent = "$" + quoteMoney(quoteNumber(item.qty) * quoteNumber(item.unit_price));
	});
}
function quoteAddItem() {
	quotationItems.push({
		inventory_item_id: null,
		item_name: "",
		specification: "",
		qty: 1,
		unit: "式",
		unit_price: 0
	});
	quoteRenderItems();
}
function quoteReset() {
	quotationEditingId = null;
	quotationForm = quoteBlankForm();
	quotationItems = [];
	renderQuotation();
}
function quotePayload() {
	var form = quoteReadForm();
	if (!form.quote_date || !form.customer_name) {
		toast("⚠️ 請填寫報價日期與客戶名稱");
		return null;
	}
	if (quotationItems.some(function(item) {
		return !item.item_name.trim() || item.qty <= 0 || item.unit_price < 0;
	})) {
		toast("⚠️ 請確認每筆明細的品項、數量與單價");
		return null;
	}
	return Object.assign(form, { items: quotationItems });
}
async function quoteSave() {
	var payload = quotePayload();
	if (!payload) return;
	try {
		var url = quotationEditingId ? "/api/quotations/" + quotationEditingId : "/api/quotations";
		var data = await apiFetch(url, {
			method: quotationEditingId ? "PUT" : "POST",
			json: payload,
			fallback: "儲存失敗"
		});
		quotationEditingId = data.id;
		quotationForm = data;
		quotationItems = data.items;
		toast("✅ 報價單已儲存");
		renderQuotation();
	} catch (e) {
		toast("⚠️ " + e.message, "error");
	}
}
async function quoteLoadHistory() {
	var list = document.getElementById("quote-history-list");
	if (!list) return;
	var q = document.getElementById("quote-history-q")?.value.trim() || "";
	try {
		quotationHistory = [];
		var page = 1;
		var total = Infinity;
		while (quotationHistory.length < total && page <= 100) {
			var data = await apiFetch("/api/quotations?q=" + encodeURIComponent(q) + "&page=" + page + "&page_size=100", { fallback: "歷史報價單載入失敗" });
			quotationHistory = quotationHistory.concat(data.items || []);
			total = Number(data.total || 0);
			if (!(data.items || []).length) break;
			page += 1;
		}
		list.innerHTML = quotationHistory.map(function(item) {
			return `<div class="quote-history-row"><div><strong>${esc(item.quote_number)}</strong><span>${esc(item.customer_name)}</span><small>${esc(item.quote_date)} · ${esc(item.tax_type === "included" ? "含稅" : "未稅")}</small></div><strong class="quote-history-total">$${esc(String(quoteMoney(item.total)))}</strong><div class="quote-history-actions">${quoteCanManage() ? `<button class="btn btn--secondary btn--sm dsr-action-btn" onclick="Quotation.quoteEdit(${esc(String(item.id))})">編輯</button>` : ""}<button class="btn btn--secondary btn--sm dsr-action-btn" onclick="Quotation.quoteDownload(${esc(String(item.id))}, 'xlsx')">Excel</button><button class="btn btn--secondary btn--sm dsr-action-btn" onclick="Quotation.quoteDownload(${esc(String(item.id))}, 'pdf')">PDF</button>${quoteCanManage() ? `<button class="btn btn--danger btn--sm dsr-action-btn dsr-action-btn--danger" onclick="Quotation.quoteDelete(${esc(String(item.id))})">刪除</button>` : ""}</div></div>`;
		}).join("");
		var empty = document.getElementById("quote-history-empty");
		if (empty) empty.style.display = quotationHistory.length ? "none" : "block";
	} catch (e) {
		list.innerHTML = `<div class="dsr-empty">⚠️ ${esc(e.message)}</div>`;
	}
}
async function quoteEdit(id) {
	try {
		var data = await apiFetch("/api/quotations/" + id, { fallback: "讀取失敗" });
		quotationEditingId = id;
		quotationForm = data;
		quotationItems = data.items;
		renderQuotation();
		window.scrollTo({
			top: 0,
			behavior: "smooth"
		});
	} catch (e) {
		toast("⚠️ " + e.message, "error");
	}
}
async function quoteDelete(id) {
	if (!confirm("確定要刪除此報價單？刪除後無法復原。")) return;
	try {
		await apiFetch("/api/quotations/" + id, {
			method: "DELETE",
			fallback: "刪除失敗"
		});
		if (quotationEditingId === id) quoteReset();
		else quoteLoadHistory();
		toast("✅ 報價單已刪除");
	} catch (e) {
		toast("⚠️ " + e.message, "error");
	}
}
function quoteDownload(id, ext) {
	window.open("/api/quotations/" + id + "/export." + ext, "_blank");
}
function quoteOpenInventory() {
	var overlay = document.getElementById("quote-inventory-overlay");
	if (overlay) {
		overlay.classList.add("is-open");
		document.getElementById("quote-inventory-q")?.focus();
		quoteSearchInventory();
	}
}
function quoteCloseInventory() {
	document.getElementById("quote-inventory-overlay")?.classList.remove("is-open");
}
/**
* 搜尋可加入報價的庫存品項，並顯示易讀的庫存區名稱。
* @returns {Promise<void>} 結果或錯誤狀態完成呈現後結束。
*/
async function quoteSearchInventory() {
	var list = document.getElementById("quote-inventory-list");
	if (!list) return;
	var q = document.getElementById("quote-inventory-q")?.value.trim() || "";
	try {
		var data = await apiFetch("/api/quotations/inventory-items?q=" + encodeURIComponent(q), { fallback: "庫存載入失敗" });
		quotationInventoryResults = data;
		list.innerHTML = data.map(function(item) {
			return `<button class="quote-inventory-row" type="button" onclick="Quotation.quoteUseInventory(${esc(String(item.id))})"><span><strong>${esc(item.brand || "無品牌")} ${esc(item.name)}</strong><small>${esc(item.code || "無型號")} · ${esc(inventorySiteLabel(item.site))} · 庫存 ${esc(Qty.disp(item.total_qty, item.unit))} ${esc(item.unit)}</small></span><b>帶入</b></button>`;
		}).join("") || "<div class=\"dsr-empty\">沒有符合的庫存品項</div>";
	} catch (e) {
		list.innerHTML = `<div class="dsr-empty">⚠️ ${esc(e.message)}</div>`;
	}
}
function quoteUseInventory(id) {
	try {
		var item = quotationInventoryResults.find(function(row) {
			return row.id === id;
		});
		if (!item) throw new Error("找不到庫存品項");
		var empty = quotationItems.find(function(row) {
			return !row.item_name.trim();
		});
		var target = empty || {
			inventory_item_id: null,
			item_name: "",
			specification: "",
			qty: 1,
			unit: "式",
			unit_price: 0
		};
		target.inventory_item_id = item.id;
		target.item_name = item.name;
		target.unit = item.unit || "式";
		if (!empty) quotationItems.push(target);
		quoteRenderItems();
		quoteCloseInventory();
		toast("✅ 已帶入「" + item.name + "」");
	} catch (e) {
		toast("⚠️ " + e.message, "error");
	}
}
function initQuotationPage() {
	document.addEventListener("change", function(event) {
		if (event.target?.id === "quote-tax") quoteUpdateTotals();
	});
}
//#endregion
//#region static/js/features/work-progress/state.js
var state_exports = /* @__PURE__ */ __exportAll({
	workProgressState: () => workProgressState,
	wprClearPhotoManageStates: () => wprClearPhotoManageStates
});
var workProgressState = {
	wprSelectedFiles: [],
	wprAppointments: [],
	wprReportsByAppointment: {},
	wprCurrentReport: null,
	wprHistoryPage: 1,
	wprHistoryTotal: 0,
	wprDayGuard: createRequestGuard(),
	wprHistoryGuard: createRequestGuard(),
	wprKpiGuard: createRequestGuard(),
	wprDetailRequestTokens: {},
	wprSelectGuard: createRequestGuard(),
	wprPhotoManageStates: {},
	wprPhotoManageReports: {},
	wprSuppressHistoryToggle: {},
	wprInitialUploaderName: "",
	wprPendingSubmit: null,
	wprLastDetailReport: null,
	wprCurrentDateValue: ""
};
/**
* Drop management state for detail surfaces that no longer exist.
* @param {function(string): boolean} predicate - State-key matcher.
* @returns {void} Function result.
*/
function wprClearPhotoManageStates(predicate) {
	Object.keys(workProgressState.wprPhotoManageStates).forEach(function(key) {
		if (predicate(key.slice(key.indexOf(":") + 1))) {
			delete workProgressState.wprPhotoManageStates[key];
			delete workProgressState.wprPhotoManageReports[key];
		}
	});
}
//#endregion
//#region static/js/features/work-progress/gallery.js
var gallery_exports = /* @__PURE__ */ __exportAll({
	initWorkProgressGallery: () => initWorkProgressGallery,
	wprCloseGallery: () => wprCloseGallery,
	wprClosePendingGallery: () => wprClosePendingGallery,
	wprGalleryMove: () => wprGalleryMove,
	wprOpenGallery: () => wprOpenGallery,
	wprOpenPendingGallery: () => wprOpenPendingGallery,
	wprPendingGalleryMove: () => wprPendingGalleryMove
});
var wprGallery = {
	report: null,
	index: 0
};
var wprGalleryGuard = createRequestGuard();
var wprGalleryPreloadState = wprCreateGalleryPreloadState();
var wprPendingGallery = { index: -1 };
/**
* Open a full-size gallery for one pending upload without creating another object URL.
* @param {number} index - Pending photo index.
* @returns {void} Function result.
*/
function wprOpenPendingGallery(index) {
	if (!workProgressState.wprSelectedFiles[index]) return;
	wprPendingGallery.index = index;
	var old = document.getElementById("wpr-pending-gallery-overlay");
	if (old) old.remove();
	var overlay = document.createElement("div");
	overlay.className = "wpr-pending-gallery-overlay";
	overlay.id = "wpr-pending-gallery-overlay";
	overlay.innerHTML = "<div class=\"wpr-pending-gallery-dialog\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"wpr-pending-gallery-title\"><button type=\"button\" class=\"wpr-pending-gallery-close\" onclick=\"WorkProgress.wprClosePendingGallery()\" aria-label=\"關閉待上傳照片預覽\">✕</button><div id=\"wpr-pending-gallery-title\" class=\"wpr-pending-gallery-count\"></div><img id=\"wpr-pending-gallery-image\" alt=\"待上傳照片預覽\"><div id=\"wpr-pending-gallery-name\" class=\"wpr-pending-gallery-name\"></div><div class=\"wpr-pending-gallery-nav\"><button type=\"button\" onclick=\"WorkProgress.wprPendingGalleryMove(-1)\">← 上一張</button><button type=\"button\" onclick=\"WorkProgress.wprPendingGalleryMove(1)\">下一張 →</button></div></div>";
	document.body.appendChild(overlay);
	wprRenderPendingGallery();
}
/**
* Render the current pending photo using its existing preview URL.
* @returns {void} Function result.
*/
function wprRenderPendingGallery() {
	var item = workProgressState.wprSelectedFiles[wprPendingGallery.index];
	if (!item) {
		wprClosePendingGallery();
		return;
	}
	var count = document.getElementById("wpr-pending-gallery-title");
	var image = document.getElementById("wpr-pending-gallery-image");
	var name = document.getElementById("wpr-pending-gallery-name");
	if (count) count.textContent = wprPendingGallery.index + 1 + " / " + workProgressState.wprSelectedFiles.length;
	if (image) image.src = item.previewUrl;
	if (name) name.textContent = item.file.name;
}
/**
* Move through pending photos with wraparound navigation.
* @param {number} delta - Relative gallery movement.
* @returns {void} Function result.
*/
function wprPendingGalleryMove(delta) {
	if (!workProgressState.wprSelectedFiles.length) return;
	wprPendingGallery.index = (wprPendingGallery.index + delta + workProgressState.wprSelectedFiles.length) % workProgressState.wprSelectedFiles.length;
	wprRenderPendingGallery();
}
/**
* Close the pending gallery without revoking its still-live object URL.
* @returns {void} Function result.
*/
function wprClosePendingGallery() {
	var overlay = document.getElementById("wpr-pending-gallery-overlay");
	if (overlay) overlay.remove();
	wprPendingGallery.index = -1;
}
/**
* Create isolated preload state for one Gallery lifecycle.
* @returns {{completed: Object, inflight: Object}} Lifecycle-owned preload state.
*/
function wprCreateGalleryPreloadState() {
	return {
		completed: Object.create(null),
		inflight: Object.create(null)
	};
}
/**
* Start one background request for a preview URL and release the Image after settlement.
* @param {Object} photo - Gallery photo metadata.
* @returns {void} Nothing; failures fall back to normal image navigation.
*/
function wprPreloadGalleryPhoto(photo) {
	var url = photo && photo.preview_url;
	var state = wprGalleryPreloadState;
	if (!url || state.completed[url] || state.inflight[url] || typeof Image === "undefined") return;
	var image;
	var settled = false;
	var settle;
	try {
		image = new Image();
		state.inflight[url] = image;
		image.decoding = "async";
		settle = function(success) {
			if (settled) return;
			settled = true;
			if (success) state.completed[url] = true;
			delete state.inflight[url];
			image.onload = null;
			image.onerror = null;
		};
		image.onload = function() {
			settle(true);
		};
		image.onerror = function() {
			settle(false);
		};
		image.src = url;
		if (typeof image.decode === "function") Promise.resolve(image.decode()).then(function() {
			settle(true);
		}, function() {
			settle(false);
		});
	} catch (error) {
		if (settle) settle(false);
		else delete state.inflight[url];
	}
}
/**
* Return preload offsets around the current photo for the initial render or move direction.
* @param {number} [direction] - Positive for next, negative for previous, omitted initially.
* @returns {number[]} Relative photo offsets to preload.
*/
function wprGalleryPreloadOffsets(direction) {
	if (direction > 0) return [
		-1,
		1,
		2
	];
	if (direction < 0) return [
		1,
		-1,
		-2
	];
	return [-1, 1];
}
/**
* Preload bounded adjacent photos, optionally looking one extra step in the move direction.
* @param {Object} report - Work Progress report containing photos.
* @param {number} index - Current photo index.
* @param {number} [direction] - Relative navigation direction.
* @returns {void} Nothing.
*/
function wprPreloadGalleryAround(report, index, direction) {
	var photos = report && report.photos;
	if (!photos || photos.length < 2) return;
	var count = photos.length;
	var seenIndexes = Object.create(null);
	wprGalleryPreloadOffsets(direction).forEach(function(offset) {
		var targetIndex = (index + offset + count) % count;
		if (targetIndex === index || seenIndexes[targetIndex]) return;
		seenIndexes[targetIndex] = true;
		wprPreloadGalleryPhoto(photos[targetIndex]);
	});
}
/**
* Load a report and open its preview gallery.
* @param {number} id - Report identifier.
* @param {number} index - Initial photo index.
* @returns {void} Nothing; the gallery opens after the report is available.
*/
function wprOpenGallery(id, index) {
	var token = wprGalleryGuard.next();
	wprCloseGallery(false);
	(workProgressState.wprLastDetailReport && workProgressState.wprLastDetailReport.id === id ? Promise.resolve(workProgressState.wprLastDetailReport.report) : apiFetch("/api/work-progress/" + id)).then(function(report) {
		if (!wprGalleryGuard.isCurrent(token)) return;
		if (typeof appState.currentTab !== "undefined" && appState.currentTab !== "work-progress") return;
		wprGallery.report = report;
		wprGallery.index = index;
		var overlay = document.createElement("div");
		overlay.className = "wpr-gallery-overlay";
		overlay.id = "wpr-gallery-overlay";
		overlay.innerHTML = "<div class=\"wpr-gallery-dialog\"><button type=\"button\" class=\"wpr-gallery-close\" onclick=\"WorkProgress.wprCloseGallery()\">✕</button><div class=\"wpr-gallery-count\" id=\"wpr-gallery-count\"></div><div class=\"wpr-gallery-stage\"><img id=\"wpr-gallery-image\" alt=\"施工照片\"></div><div class=\"wpr-gallery-caption\" id=\"wpr-gallery-caption\"></div><div class=\"wpr-gallery-nav\"><button type=\"button\" onclick=\"WorkProgress.wprGalleryMove(-1)\">← 上一張</button><a id=\"wpr-gallery-download\" class=\"wpr-gallery-download\">原圖下載</a><button type=\"button\" onclick=\"WorkProgress.wprGalleryMove(1)\">下一張 →</button></div></div>";
		document.body.appendChild(overlay);
		wprRenderGallery();
	}).catch(function(error) {
		if (!wprGalleryGuard.isCurrent(token)) return;
		toast(error.message, "error");
	});
}
/**
* Render the current gallery photo and navigation controls.
* @param {number} [direction] - Relative navigation direction for lookahead preload.
* @returns {void} Nothing.
*/
function wprRenderGallery(direction) {
	var report = wprGallery.report, photo = report && report.photos[wprGallery.index];
	if (!photo) return;
	document.getElementById("wpr-gallery-count").textContent = wprGallery.index + 1 + " / " + report.photos.length;
	var image = document.getElementById("wpr-gallery-image");
	image.decoding = "async";
	image.src = photo.preview_url;
	document.getElementById("wpr-gallery-caption").textContent = report.client_name + " · " + report.service_name + " · " + report.report_date;
	document.getElementById("wpr-gallery-download").href = photo.download_url;
	document.getElementById("wpr-gallery-download").download = photo.original_name;
	wprPreloadGalleryAround(report, wprGallery.index, direction);
}
/**
* Move the gallery selection with wraparound navigation.
* @param {number} delta - Relative gallery movement.
* @returns {void} Nothing.
*/
function wprGalleryMove(delta) {
	if (!wprGallery.report || !wprGallery.report.photos.length) return;
	wprGallery.index = (wprGallery.index + delta + wprGallery.report.photos.length) % wprGallery.report.photos.length;
	wprRenderGallery(delta);
}
/**
* Close the gallery overlay and release its state.
* @param {boolean} [invalidateRequest=true] - Whether to invalidate pending gallery fetches.
* @returns {void} Nothing.
*/
function wprCloseGallery(invalidateRequest) {
	if (invalidateRequest !== false) wprGalleryGuard.invalidate();
	var overlay = document.getElementById("wpr-gallery-overlay");
	if (overlay) overlay.remove();
	wprGallery.report = null;
	wprGalleryPreloadState = wprCreateGalleryPreloadState();
}
function initWorkProgressGallery() {
	document.addEventListener("keydown", function(event) {
		if (wprPendingGallery.index >= 0) {
			if (event.key === "Escape") wprClosePendingGallery();
			if (event.key === "ArrowLeft") wprPendingGalleryMove(-1);
			if (event.key === "ArrowRight") wprPendingGalleryMove(1);
			return;
		}
		if (!wprGallery.report) return;
		if (event.key === "Escape") wprCloseGallery();
		if (event.key === "ArrowLeft") wprGalleryMove(-1);
		if (event.key === "ArrowRight") wprGalleryMove(1);
	});
}
//#endregion
//#region static/js/features/work-progress/photo-upload.js
var photo_upload_exports = /* @__PURE__ */ __exportAll({
	WPR_MAX_FILES: () => 20,
	wprUploadProgressText: () => wprUploadProgressText,
	wprUploadWithProgress: () => wprUploadWithProgress,
	wprValidatePhotoBatch: () => wprValidatePhotoBatch
});
/**
* Label for the upload phases shown on the submit button.
* @param {string} phase - 'upload' while bytes are sent, 'processing' after the server has them.
* @param {number} percent - Upload percentage (0-100), ignored for processing.
* @returns {string} Button label.
*/
function wprUploadProgressText(phase, percent) {
	if (phase === "processing") return "伺服器處理中…";
	return "上傳中 " + Math.max(0, Math.min(100, Math.floor(Number(percent) || 0))) + "%";
}
/**
* POST multipart data with upload progress (fetch cannot report request-body progress).
* Error messages match apiFetch (core/api-client.js); structured API validation details use the shared readable formatter.
* @param {string} url - Endpoint.
* @param {FormData} form - Multipart body.
* @param {function(string, number): void} onProgress - Receives ('upload', percent) then ('processing', 100).
* @returns {Promise<object>} Parsed JSON response.
*/
function wprUploadWithProgress(url, form, onProgress) {
	return new Promise(function(resolve, reject) {
		var xhr = new XMLHttpRequest();
		var report = function(phase, percent) {
			if (onProgress) onProgress(phase, percent);
		};
		xhr.open("POST", url);
		xhr.upload.onprogress = function(event) {
			if (event.lengthComputable && event.total > 0) report("upload", event.loaded * 100 / event.total);
		};
		xhr.upload.onload = function() {
			report("processing", 100);
		};
		xhr.onload = function() {
			var body = {};
			try {
				body = JSON.parse(xhr.responseText || "{}");
			} catch (error) {
				body = {};
			}
			if (xhr.status >= 200 && xhr.status < 300) resolve(body);
			else reject(new Error(apiErrorMessage(body.detail) || "API 錯誤：" + xhr.status));
		};
		xhr.onerror = function() {
			reject(/* @__PURE__ */ new Error("網路連線中斷，上傳失敗，請重試"));
		};
		xhr.onabort = function() {
			reject(/* @__PURE__ */ new Error("上傳已中止"));
		};
		report("upload", 0);
		xhr.send(form);
	});
}
var WPR_ALLOWED_MIME_TYPES = [
	"image/jpeg",
	"image/png",
	"image/webp"
];
var WPR_ALLOWED_EXTENSIONS = [
	".jpg",
	".jpeg",
	".png",
	".webp"
];
var WPR_MAX_FILE_BYTES = 20971520;
var WPR_MAX_BATCH_BYTES = 104857600;
/**
* Validate one photo batch before mutating pending state or sending an append request.
* @param {File[]|FileList} fileList - Candidate files.
* @param {number} currentCount - Existing report or pending-photo count.
* @returns {{ok: boolean, error?: string}} Validation result.
*/
function wprValidatePhotoBatch(fileList, currentCount) {
	var files = Array.from(fileList || []);
	var remaining = 20 - currentCount;
	if (!files.length) return {
		ok: false,
		error: "請選擇至少 1 張照片。"
	};
	if (files.length > remaining) return {
		ok: false,
		error: "目前已選 " + currentCount + " 張，最多還能新增 " + Math.max(remaining, 0) + " 張照片。請重新選擇不超過上限的照片。"
	};
	var totalBytes = 0;
	for (var i = 0; i < files.length; i += 1) {
		var file = files[i];
		var extension = (file.name || "").slice((file.name || "").lastIndexOf(".")).toLowerCase();
		if (WPR_ALLOWED_EXTENSIONS.indexOf(extension) < 0 || WPR_ALLOWED_MIME_TYPES.indexOf(file.type) < 0) return {
			ok: false,
			error: "不支援此圖片格式。目前僅支援 JPG、PNG、WebP。"
		};
		if (file.size > WPR_MAX_FILE_BYTES) return {
			ok: false,
			error: "單張圖片上限 20MB。"
		};
		totalBytes += file.size;
	}
	if (totalBytes > WPR_MAX_BATCH_BYTES) return {
		ok: false,
		error: "本次選擇圖片總大小不可超過 100MB。"
	};
	return { ok: true };
}
//#endregion
//#region static/js/features/work-progress/pending-photos.js
var pending_photos_exports = /* @__PURE__ */ __exportAll({
	wprAddPendingFiles: () => wprAddPendingFiles,
	wprBindDropZone: () => wprBindDropZone,
	wprClearPendingFiles: () => wprClearPendingFiles,
	wprRemovePending: () => wprRemovePending,
	wprRenderPendingPhotos: () => wprRenderPendingPhotos
});
/**
* Bind drag-and-drop handlers for pending photo selection.
* @returns {void} Function result.
*/
function wprBindDropZone() {
	var drop = document.getElementById("wpr-drop");
	if (!drop) return;
	["dragenter", "dragover"].forEach(function(eventName) {
		drop.addEventListener(eventName, function(event) {
			event.preventDefault();
			drop.classList.add("is-dragging");
		});
	});
	["dragleave", "drop"].forEach(function(eventName) {
		drop.addEventListener(eventName, function(event) {
			event.preventDefault();
			drop.classList.remove("is-dragging");
		});
	});
	drop.addEventListener("drop", function(event) {
		wprAddPendingFiles(event.dataTransfer.files);
	});
}
/**
* Update the create photo counter and disable controls at the report limit.
* @returns {void} Function result.
*/
function wprUpdatePendingPhotoControls() {
	var count = workProgressState.wprSelectedFiles.length;
	var counter = document.getElementById("wpr-photo-counter");
	if (counter) counter.textContent = "已選 " + count + " / 20 張" + (count >= 20 ? " · 已達照片上限" : "");
	["wpr-album-button", "wpr-camera-button"].forEach(function(id) {
		var button = document.getElementById(id);
		if (button) button.disabled = count >= 20;
	});
}
/**
* Validate and append a complete supported image batch without replacing earlier photos.
* @param {FileList|File[]} fileList - Candidate files.
* @returns {void} Function result.
*/
function wprAddPendingFiles(fileList) {
	var files = Array.from(fileList || []);
	var validation = wprValidatePhotoBatch(files, workProgressState.wprSelectedFiles.length);
	if (!validation.ok) {
		toast(validation.error, "error");
		return;
	}
	files.forEach(function(file) {
		workProgressState.wprSelectedFiles.push({
			file,
			previewUrl: URL.createObjectURL(file)
		});
	});
	wprRenderPendingPhotos();
}
/**
* Render pending photo thumbnails with separate preview and remove actions.
* @returns {void} Function result.
*/
function wprRenderPendingPhotos() {
	var grid = document.getElementById("wpr-pending-photos");
	if (!grid) return;
	var addDisabled = workProgressState.wprSelectedFiles.length >= 20 ? " disabled" : "";
	grid.innerHTML = workProgressState.wprSelectedFiles.map(function(item, index) {
		return "<div class=\"wpr-photo-tile\"><button type=\"button\" class=\"wpr-pending-preview\" onclick=\"WorkProgress.wprOpenPendingGallery(" + index + ")\" aria-label=\"預覽第 " + (index + 1) + " 張待上傳照片\"><img src=\"" + esc(item.previewUrl) + "\" alt=\"待上傳照片 " + (index + 1) + "\"></button><button type=\"button\" class=\"wpr-photo-remove\" onclick=\"event.stopPropagation();WorkProgress.wprRemovePending(" + index + ")\" aria-label=\"移除第 " + (index + 1) + " 張照片\">✕</button></div>";
	}).join("") + "<button type=\"button\" id=\"wpr-add-pending-button\" class=\"wpr-add-tile\" onclick=\"document.getElementById('wpr-album').click()\"" + addDisabled + ">＋新增</button>";
	wprUpdatePendingPhotoControls();
}
/**
* Remove one pending photo and release only its object URL.
* @param {number} index - Pending photo index.
* @returns {void} Function result.
*/
function wprRemovePending(index) {
	var item = workProgressState.wprSelectedFiles[index];
	if (!item) return;
	wprClosePendingGallery();
	if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
	workProgressState.wprSelectedFiles.splice(index, 1);
	wprRenderPendingPhotos();
	var save = document.getElementById("wpr-save");
	if (save && (!workProgressState.wprCurrentReport || !workProgressState.wprCurrentReport.appointment_id || !workProgressState.wprReportsByAppointment[workProgressState.wprCurrentReport.appointment_id])) save.disabled = false;
}
/**
* Clear the pending create draft and release every owned object URL.
* @returns {void} Function result.
*/
function wprClearPendingFiles() {
	wprClosePendingGallery();
	workProgressState.wprSelectedFiles.forEach(function(item) {
		if (item && item.previewUrl) URL.revokeObjectURL(item.previewUrl);
	});
	workProgressState.wprSelectedFiles = [];
	wprRenderPendingPhotos();
}
//#endregion
//#region static/js/features/work-progress/draft.js
var draft_exports = /* @__PURE__ */ __exportAll({
	wprCloseLeaveConfirmation: () => wprCloseLeaveConfirmation,
	wprCloseSubmitConfirmation: () => wprCloseSubmitConfirmation,
	wprDiscardAndLeave: () => wprDiscardAndLeave,
	wprHasUnsavedChanges: () => wprHasUnsavedChanges,
	wprInstallBeforeUnload: () => wprInstallBeforeUnload,
	wprRequestDraftReset: () => wprRequestDraftReset,
	wprRequestLeave: () => wprRequestLeave,
	wprUpdateNoteCount: () => wprUpdateNoteCount
});
var wprBeforeUnloadInstalled = false;
var wprLeaveRequest = null;
/**
* Return whether the create form contains content that would be lost.
* @returns {boolean} Whether an unsaved appointment, field value, or photo exists.
*/
function wprHasUnsavedChanges() {
	var uploader = document.getElementById("wpr-uploader");
	var note = document.getElementById("wpr-note");
	return !!(workProgressState.wprCurrentReport && !workProgressState.wprCurrentReport.id && workProgressState.wprCurrentReport.appointment_id || note && note.value.trim() || uploader && uploader.value.trim() !== workProgressState.wprInitialUploaderName || workProgressState.wprSelectedFiles.length);
}
/**
* Install the browser unload guard once for the Work Progress page.
* @returns {void} Function result.
*/
function wprInstallBeforeUnload() {
	if (wprBeforeUnloadInstalled) return;
	window.addEventListener("beforeunload", wprBeforeUnload);
	wprBeforeUnloadInstalled = true;
}
/**
* Block browser reload/close only while the create form is dirty.
* @param {BeforeUnloadEvent} event - Browser unload event.
* @returns {void} Function result.
*/
function wprBeforeUnload(event) {
	if (!wprHasUnsavedChanges()) return;
	event.preventDefault();
	event.returnValue = "";
}
/**
* Open the discard confirmation before switching away from Work Progress.
* @param {string} nextTab - Requested destination tab.
* @returns {void} Function result.
*/
function wprRequestLeave(nextTab) {
	wprOpenUnsavedConfirmation({
		tab: nextTab,
		action: null
	});
}
/**
* Open the discard confirmation before replacing the current create draft.
* @param {Function} action - Action to run after the draft is discarded.
* @returns {void} Function result.
*/
function wprRequestDraftReset(action, restoreDate) {
	wprOpenUnsavedConfirmation({
		tab: null,
		action,
		restoreDate
	});
}
/**
* Render the shared unsaved-draft confirmation for navigation or replacement.
* @param {{tab: (string|null), action: (Function|null)}} request - Pending action.
* @returns {void} Function result.
*/
function wprOpenUnsavedConfirmation(request) {
	if (workProgressState.wprPendingSubmit) return;
	wprLeaveRequest = request;
	var old = document.getElementById("wpr-unsaved-overlay");
	if (old) old.remove();
	var overlay = document.createElement("div");
	overlay.className = "wpr-unsaved-overlay";
	overlay.id = "wpr-unsaved-overlay";
	overlay.innerHTML = "<div class=\"wpr-unsaved-dialog\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"wpr-unsaved-title\"><h3 id=\"wpr-unsaved-title\">尚未儲存工作進度</h3><p>目前輸入內容與待上傳照片尚未儲存。<br>離開後這些內容將會遺失。</p><div class=\"wpr-unsaved-actions\"><button type=\"button\" class=\"btn btn--secondary btn--md\" onclick=\"WorkProgress.wprCloseLeaveConfirmation()\">繼續編輯</button><button type=\"button\" class=\"btn btn--danger btn--md\" onclick=\"WorkProgress.wprDiscardAndLeave()\">放棄並離開</button></div></div>";
	document.body.appendChild(overlay);
}
/**
* Close the unsaved-draft confirmation and keep the form intact.
* @returns {void} Function result.
*/
function wprCloseLeaveConfirmation() {
	var request = wprLeaveRequest;
	var overlay = document.getElementById("wpr-unsaved-overlay");
	if (overlay) overlay.remove();
	if (request && request.restoreDate) {
		var dateInput = document.getElementById("wpr-date");
		if (dateInput) dateInput.value = request.restoreDate;
	}
	wprLeaveRequest = null;
}
/**
* Reset the create draft without leaving the Work Progress tab.
* @returns {void} Function result.
*/
function wprResetCreateDraft() {
	wprClosePendingGallery();
	wprClearPendingFiles();
	var note = document.getElementById("wpr-note");
	var uploader = document.getElementById("wpr-uploader");
	if (note) {
		note.value = "";
		wprUpdateNoteCount();
	}
	if (uploader) uploader.value = workProgressState.wprInitialUploaderName;
	workProgressState.wprCurrentReport = null;
	var area = document.getElementById("wpr-selected-area");
	if (area) {
		area.hidden = true;
		area.innerHTML = "";
	}
	var save = document.getElementById("wpr-save");
	if (save) save.disabled = true;
}
/**
* Discard the draft, release URLs, and continue the requested action.
* @returns {void} Function result.
*/
function wprDiscardAndLeave() {
	var request = wprLeaveRequest;
	wprCloseLeaveConfirmation();
	wprCloseSubmitConfirmation();
	wprResetCreateDraft();
	if (request && request.action) request.action();
	else if (request && request.tab) navigateToTab(request.tab);
}
/**
* Synchronize the progress-note character counter.
* @returns {void} Function result.
*/
function wprUpdateNoteCount() {
	var note = document.getElementById("wpr-note");
	var counter = document.getElementById("wpr-note-count");
	if (note && counter) counter.textContent = note.value.length + " / 1000";
}
/**
* Close the save confirmation without changing the draft.
* @returns {void} Function result.
*/
function wprCloseSubmitConfirmation() {
	var overlay = document.getElementById("wpr-confirm-overlay");
	if (overlay) overlay.remove();
	workProgressState.wprPendingSubmit = null;
}
//#endregion
//#region static/js/features/work-progress/format.js
var format_exports = /* @__PURE__ */ __exportAll({
	wprCreatedByText: () => wprCreatedByText,
	wprCurrentUserName: () => wprCurrentUserName,
	wprIsoDate: () => wprIsoDate,
	wprMonth: () => wprMonth,
	wprOptionalNoteHtml: () => wprOptionalNoteHtml,
	wprTimeText: () => wprTimeText
});
/**
* Format a local Date as the date value used by the Work Progress API.
* @param {Date} date - Function input.
* @returns {void} Function result.
*/
function wprIsoDate(date) {
	var d = date || /* @__PURE__ */ new Date();
	return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
/**
* Extract the YYYY-MM month used by KPI requests.
* @param {string} dateValue - Function input.
* @returns {void} Function result.
*/
function wprMonth(dateValue) {
	return (dateValue || wprIsoDate()).slice(0, 7);
}
/**
* Render a job time range without inventing a midnight time.
* @param {Object} job - Function input.
* @returns {void} Function result.
*/
function wprTimeText(job) {
	return job.start_time && job.end_time ? esc(job.start_time) + "–" + esc(job.end_time) : "未指定時間";
}
/**
* Resolve the read-only display name shown on the create form.
* @returns {void} Function result.
*/
function wprCurrentUserName() {
	return currentUser && (currentUser.display_name || currentUser.username) || "目前登入者";
}
/**
* Format the immutable creator identity shown in history.
* @param {Object} report - Function input.
* @returns {void} Function result.
*/
function wprCreatedByText(report) {
	return report.created_by_display_name || report.created_by_username || "未知帳號";
}
/**
* Render an optional escaped note row only when the source has content.
* @param {string} label - Visible label for the note.
* @param {string} value - User-authored note text.
* @returns {string} Empty string or escaped note markup.
*/
function wprOptionalNoteHtml(label, value) {
	return value ? "<div class=\"wpr-calendar-note\"><span>" + esc(label) + "</span><strong>" + esc(value) + "</strong></div>" : "";
}
//#endregion
//#region static/js/features/work-progress/history.js
var history_exports = /* @__PURE__ */ __exportAll({
	wprLoadHistory: () => wprLoadHistory,
	wprLoadKpi: () => wprLoadKpi,
	wprQuickRange: () => wprQuickRange,
	wprResetFilter: () => wprResetFilter,
	wprSetHistoryMonth: () => wprSetHistoryMonth
});
/**
* Load and render the appointment-based monthly KPI summary.
* @returns {void} Function result.
*/
async function wprLoadKpi() {
	var el = document.getElementById("wpr-kpi");
	if (!el) return;
	var token = workProgressState.wprKpiGuard.next();
	try {
		var data = await apiFetch("/api/work-progress/kpi?month=" + encodeURIComponent(wprMonth()));
		if (!workProgressState.wprKpiGuard.isCurrent(token)) return;
		el.innerHTML = [
			{
				label: "已回報",
				value: data.reported
			},
			{
				label: "待回報",
				value: data.missing
			},
			{
				label: "回報率",
				value: data.rate === null ? "—" : data.rate + "%"
			}
		].map(function(item) {
			return "<div class=\"wpr-kpi\"><span>" + item.label + "</span><strong>" + item.value + "</strong></div>";
		}).join("") + "<div class=\"wpr-kpi-meta\">本月目前 " + data.total + " 筆行事曆工作 · " + data.photo_count + " 張照片</div>";
	} catch (error) {
		if (workProgressState.wprKpiGuard.isCurrent(token)) el.innerHTML = "";
	}
}
/**
* Initialize history filters to the current calendar month.
* @returns {void} Function result.
*/
function wprSetHistoryMonth() {
	var now = /* @__PURE__ */ new Date();
	var from = document.getElementById("wpr-from");
	var to = document.getElementById("wpr-to");
	if (from) from.value = wprIsoDate(new Date(now.getFullYear(), now.getMonth(), 1));
	if (to) to.value = wprIsoDate(new Date(now.getFullYear(), now.getMonth() + 1, 0));
	document.querySelectorAll("[data-role=\"wpr-range\"]").forEach(function(button) {
		button.classList.toggle("is-active", button.dataset.range === "month");
	});
}
/**
* Clear history filters and reload the default month.
* @returns {void} Function result.
*/
function wprResetFilter() {
	var query = document.getElementById("wpr-query");
	if (query) query.value = "";
	wprSetHistoryMonth();
	wprLoadHistory(1);
}
/**
* Apply a quick date range and reload history.
* @param {string} type - Function input.
* @param {HTMLElement} button - Function input.
* @returns {void} Function result.
*/
function wprQuickRange(type, button) {
	var today = /* @__PURE__ */ new Date(), from = "", to = "";
	if (type === "today") from = to = wprIsoDate(today);
	if (type === "month") {
		from = wprIsoDate(new Date(today.getFullYear(), today.getMonth(), 1));
		to = wprIsoDate(new Date(today.getFullYear(), today.getMonth() + 1, 0));
	}
	if (type === "week") {
		var day = today.getDay() || 7;
		var start = new Date(today);
		start.setDate(today.getDate() - day + 1);
		from = wprIsoDate(start);
		to = wprIsoDate(today);
	}
	if (button) document.querySelectorAll("[data-role=\"wpr-range\"]").forEach(function(item) {
		item.classList.toggle("is-active", item === button);
	});
	var fromInput = document.getElementById("wpr-from");
	var toInput = document.getElementById("wpr-to");
	if (fromInput) fromInput.value = from;
	if (toInput) toInput.value = to;
	wprLoadHistory(1);
}
/**
* Build pagination controls for the current history result set.
* @returns {void} Function result.
*/
function wprRenderHistoryPagination() {
	var lastPage = Math.max(1, Math.ceil(workProgressState.wprHistoryTotal / 20));
	if (lastPage <= 1) return "";
	return "<nav class=\"wpr-pagination\" aria-label=\"工作進度歷史分頁\"><button type=\"button\" class=\"btn btn--secondary btn--sm\" onclick=\"WorkProgress.wprLoadHistory(" + (workProgressState.wprHistoryPage - 1) + ")\"" + (workProgressState.wprHistoryPage <= 1 ? " disabled" : "") + ">上一頁</button><span>第 " + workProgressState.wprHistoryPage + " / " + lastPage + " 頁 · 共 " + workProgressState.wprHistoryTotal + " 筆</span><button type=\"button\" class=\"btn btn--secondary btn--sm\" onclick=\"WorkProgress.wprLoadHistory(" + (workProgressState.wprHistoryPage + 1) + ")\"" + (workProgressState.wprHistoryPage >= lastPage ? " disabled" : "") + ">下一頁</button></nav>";
}
/**
* Load the paginated history list and discard replaced history detail state.
* @param {number} page - Requested history page.
* @returns {Promise<void>} Completion promise.
*/
async function wprLoadHistory(page) {
	var list = document.getElementById("wpr-history-list");
	if (!list) return;
	page = Number.isInteger(page) && page > 0 ? page : 1;
	var token = workProgressState.wprHistoryGuard.next();
	var p = new URLSearchParams({
		page: String(page),
		page_size: String(20)
	});
	var from = document.getElementById("wpr-from").value;
	var to = document.getElementById("wpr-to").value;
	var q = document.getElementById("wpr-query").value.trim();
	if (from) p.set("from_date", from);
	if (to) p.set("to_date", to);
	if (q) p.set("q", q);
	try {
		var data = await apiFetch("/api/work-progress?" + p);
		if (!workProgressState.wprHistoryGuard.isCurrent(token)) return;
		workProgressState.wprHistoryTotal = Number(data.total) || 0;
		var resultCount = document.getElementById("wpr-result-count");
		if (resultCount) resultCount.textContent = workProgressState.wprHistoryTotal + " 筆";
		var lastPage = Math.max(1, Math.ceil(workProgressState.wprHistoryTotal / 20));
		if (page > lastPage) {
			wprLoadHistory(lastPage);
			return;
		}
		workProgressState.wprHistoryPage = Number(data.page) || page;
		wprClearPhotoManageStates(function(targetId) {
			return targetId.indexOf("wpr-detail-") === 0;
		});
		if (!data.items.length) {
			list.innerHTML = "<div class=\"wpr-empty wpr-history-empty\">📸 尚無工作進度<br><small>目前沒有符合條件的工作進度回報。</small></div>";
			return;
		}
		list.innerHTML = data.items.map(wprHistoryCard).join("") + wprRenderHistoryPagination();
	} catch (error) {
		if (workProgressState.wprHistoryGuard.isCurrent(token)) list.innerHTML = "<div class=\"wpr-empty\">⚠️ " + esc(error.message) + "</div>";
	}
}
function wprHistoryCard(report) {
	return "<details class=\"wpr-history-item\" ontoggle=\"WorkProgress.wprHistoryToggled(this, " + report.id + ")\"><summary><span class=\"wpr-history-date\">" + esc(report.report_date) + "</span><span><b>" + esc(report.service_name || "未指定服務") + " · " + esc(report.client_name) + "</b><small>" + wprTimeText(report) + " · 回報人：" + esc(report.uploader_name) + " · 建立帳號：" + esc(wprCreatedByText(report)) + "</small></span><span class=\"wpr-history-photo-count\">📷 " + report.photo_count + "</span></summary><div class=\"wpr-history-detail\" id=\"wpr-detail-" + report.id + "\">載入詳情中…</div></details>";
}
//#endregion
//#region static/js/features/work-progress/day.js
var day_exports = /* @__PURE__ */ __exportAll({
	wprLoadDay: () => wprLoadDay,
	wprRenderJobs: () => wprRenderJobs
});
/**
* Load appointments and existing reports for the selected work date.
* @returns {void} Function result.
*/
async function wprLoadDay() {
	var dateInput = document.getElementById("wpr-date");
	if (!dateInput) return;
	var dateValue = dateInput.value;
	var token = workProgressState.wprDayGuard.next();
	try {
		var jobs = await apiFetch("/api/appointments?date=" + encodeURIComponent(dateValue));
		if (!workProgressState.wprDayGuard.isCurrent(token)) return;
		var reports = await apiFetch("/api/work-progress?from_date=" + encodeURIComponent(dateValue) + "&to_date=" + encodeURIComponent(dateValue) + "&page_size=100");
		if (!workProgressState.wprDayGuard.isCurrent(token)) return;
		workProgressState.wprAppointments = jobs || [];
		workProgressState.wprCurrentDateValue = dateValue;
		workProgressState.wprReportsByAppointment = {};
		(reports.items || []).forEach(function(report) {
			if (report.appointment_id !== null) workProgressState.wprReportsByAppointment[report.appointment_id] = report;
		});
		wprRenderJobs();
	} catch (error) {
		if (!workProgressState.wprDayGuard.isCurrent(token)) return;
		workProgressState.wprAppointments = [];
		var list = document.getElementById("wpr-job-list");
		if (list) list.innerHTML = "<div class=\"wpr-empty\">⚠️ 無法載入當日工作：" + esc(error.message) + "</div>";
	}
}
/**
* Render appointment cards with their reported status.
* @returns {void} Function result.
*/
function wprRenderJobs() {
	var list = document.getElementById("wpr-job-list");
	if (!list) return;
	if (!workProgressState.wprAppointments.length) {
		list.innerHTML = "<div class=\"wpr-empty\">📅 此日期尚無工作安排<br><a href=\"/\">前往行事曆</a></div>";
		return;
	}
	list.innerHTML = workProgressState.wprAppointments.map(function(job) {
		var existing = workProgressState.wprReportsByAppointment[job.id];
		var selected = workProgressState.wprCurrentReport && workProgressState.wprCurrentReport.appointment_id === job.id;
		return "<button type=\"button\" class=\"wpr-job-card " + (selected ? "is-selected" : "") + "\" onclick=\"WorkProgress.wprSelectJob(" + job.id + ")\"><span class=\"wpr-job-radio\">" + (selected ? "●" : "○") + "</span><span class=\"wpr-job-body\"><strong>" + wprTimeText(job) + "</strong><b>" + esc(job.service_name || "未指定服務") + "</b><span>👤 " + esc(job.client_name || "") + "</span>" + (job.address ? "<span>📍 " + esc(job.address) + "</span>" : "") + "</span><span class=\"wpr-job-status\">" + (existing ? "✅ 已回報" : "尚未回報") + "</span></button>";
	}).join("");
}
//#endregion
//#region static/js/features/work-progress/detail.js
var detail_exports = /* @__PURE__ */ __exportAll({
	wprAddExistingPhotos: () => wprAddExistingPhotos,
	wprBatchDeletePhotos: () => wprBatchDeletePhotos,
	wprClearPhotoSelection: () => wprClearPhotoSelection,
	wprDeleteReport: () => wprDeleteReport,
	wprEditReport: () => wprEditReport,
	wprOpenHistoryDetail: () => wprOpenHistoryDetail,
	wprSelectAllPhotoSelection: () => wprSelectAllPhotoSelection,
	wprTogglePhotoManage: () => wprTogglePhotoManage,
	wprTogglePhotoSelection: () => wprTogglePhotoSelection
});
/**
* Resolve the DOM id used by one report detail surface.
* @param {number} id - Report identifier.
* @param {string} [targetId] - Internal detail container id.
* @returns {string} Detail container id.
*/
function wprDetailTargetId(id, targetId) {
	return targetId || "wpr-detail-" + id;
}
/**
* Reload history and reopen a detail element after a change.
* @param {number} id - Report identifier.
* @param {number} page - History page to reload.
* @param {string} [targetId] - Internal detail container id to refresh.
* @returns {Promise<void>} Completion promise.
*/
async function wprReloadAndReopenDetail(id, page, targetId) {
	await wprLoadHistory(page);
	var resolvedTargetId = wprDetailTargetId(id, targetId);
	var selectedTarget = targetId && resolvedTargetId !== "wpr-detail-" + id;
	var detail = document.getElementById(resolvedTargetId);
	if (selectedTarget) {
		if (detail) await wprOpenHistoryDetail(id, resolvedTargetId);
		return;
	}
	if (!detail) return;
	var item = detail.closest("details");
	if (item) {
		workProgressState.wprSuppressHistoryToggle[id] = true;
		item.open = true;
	}
	await wprOpenHistoryDetail(id, resolvedTargetId);
}
/**
* Build the stable key used to isolate photo management per detail surface.
* @param {number} id - Report identifier.
* @param {string} [targetId] - Detail surface identifier.
* @returns {string} Report and target state key.
*/
function wprPhotoManageKey(id, targetId) {
	return String(id) + ":" + wprDetailTargetId(id, targetId);
}
/**
* Return target-scoped selection state without sharing it across detail surfaces.
* @param {number} id - Report identifier.
* @param {string} [targetId] - Detail surface identifier.
* @returns {{manage: boolean, selected: Object, deleting: boolean}} Mutable state.
*/
function wprPhotoManageState(id, targetId) {
	var key = wprPhotoManageKey(id, targetId);
	if (!workProgressState.wprPhotoManageStates[key]) workProgressState.wprPhotoManageStates[key] = {
		manage: false,
		selected: Object.create(null),
		deleting: false
	};
	return workProgressState.wprPhotoManageStates[key];
}
/**
* Build report-scoped thumbnails; management mode changes clicks into selection.
* @param {Object} report - Work progress report payload.
* @param {number} id - Report identifier.
* @param {string} [targetId] - Detail surface identifier.
* @returns {string} Thumbnail markup.
*/
function wprPhotoGalleryHtml(report, id, targetId) {
	var actionTargetId = wprDetailTargetId(id, targetId);
	var state = wprPhotoManageState(id, actionTargetId);
	return (report.photos || []).map(function(photo, index) {
		var selected = !!state.selected[photo.asset_id];
		var handler = state.manage ? "WorkProgress.wprTogglePhotoSelection(" + id + "," + index + ",'" + esc(jsStr(actionTargetId)) + "')" : "WorkProgress.wprOpenGallery(" + id + "," + index + ")";
		return "<div class=\"wpr-photo-manage-tile " + (selected ? "is-selected" : "") + "\"><button type=\"button\" onclick=\"" + handler + "\" aria-pressed=\"" + (selected ? "true" : "false") + "\" aria-label=\"" + (state.manage ? "選取" : "開啟") + "施工照片 " + (index + 1) + "\">" + (state.manage ? "<span class=\"wpr-photo-selection-badge\" aria-hidden=\"true\">" + (selected ? "✓" : "") + "</span>" : "") + "<img src=\"" + esc(photo.thumbnail_url) + "\" alt=\"施工照片 " + (index + 1) + "\" loading=\"lazy\" decoding=\"async\"></button></div>";
	}).join("");
}
/**
* Build the explicit multi-select toolbar for one report/detail target.
* @param {Object} report - Work progress report payload.
* @param {number} id - Report identifier.
* @param {string} targetId - Detail surface identifier.
* @returns {string} Management toolbar markup.
*/
function wprPhotoManagementToolbarHtml(id, targetId) {
	var state = wprPhotoManageState(id, targetId);
	var selectedCount = Object.keys(state.selected).length;
	var disabled = state.deleting ? " disabled" : "";
	return "<div class=\"wpr-photo-management-toolbar\" role=\"toolbar\" aria-label=\"施工照片管理\"><span class=\"wpr-photo-selected-count\">已選 " + selectedCount + " 張</span><div class=\"wpr-photo-management-actions\"><button type=\"button\" class=\"btn btn--secondary btn--sm\" onclick=\"WorkProgress.wprSelectAllPhotoSelection(" + id + ",'" + esc(jsStr(targetId)) + "')\"" + disabled + ">全選</button><button type=\"button\" class=\"btn btn--secondary btn--sm wpr-photo-clear-selection\" onclick=\"WorkProgress.wprClearPhotoSelection(" + id + ",'" + esc(jsStr(targetId)) + "')\"" + (disabled || selectedCount === 0 ? " disabled" : "") + ">取消選取</button><button type=\"button\" class=\"btn btn--danger btn--sm wpr-photo-batch-delete\" onclick=\"WorkProgress.wprBatchDeletePhotos(" + id + ",'" + esc(jsStr(targetId)) + "')\" aria-label=\"刪除選取的 " + selectedCount + " 張照片\"" + (selectedCount === 0 || state.deleting ? " disabled" : "") + ">" + (state.deleting ? "刪除中…" : "刪除選取") + "</button><button type=\"button\" class=\"btn btn--secondary btn--sm wpr-photo-finish\" onclick=\"WorkProgress.wprTogglePhotoManage(" + id + ",'" + esc(jsStr(targetId)) + "')\"" + disabled + ">完成選取</button></div></div>";
}
/**
* Load and render the full detail body for one report.
* @param {number} id - Report identifier.
* @param {string} [targetId] - Optional detail container id for non-history callers.
* @returns {Promise<void>} Completion promise.
*/
async function wprOpenHistoryDetail(id, targetId, cachedReport) {
	var detailTargetId = wprDetailTargetId(id, targetId);
	var detail = document.getElementById(detailTargetId);
	if (!detail) return;
	var tokenKey = id + ":" + detailTargetId;
	var token = (workProgressState.wprDetailRequestTokens[tokenKey] || 0) + 1;
	workProgressState.wprDetailRequestTokens[tokenKey] = token;
	var cacheKey = wprPhotoManageKey(id, detailTargetId);
	if (cachedReport) workProgressState.wprPhotoManageReports[cacheKey] = cachedReport;
	if (workProgressState.wprLastDetailReport && workProgressState.wprLastDetailReport.id === id && !cachedReport) workProgressState.wprLastDetailReport = null;
	try {
		var report = cachedReport || await apiFetch("/api/work-progress/" + id);
		if (token !== workProgressState.wprDetailRequestTokens[tokenKey]) return;
		workProgressState.wprPhotoManageReports[cacheKey] = report;
		workProgressState.wprLastDetailReport = {
			id,
			report
		};
		var actionTargetId = esc(jsStr(detailTargetId));
		detail.innerHTML = "<div class=\"wpr-detail-grid\"><span>工作日期<b>" + esc(report.report_date) + "</b></span><span>服務項目<b>" + esc(report.service_name || "未指定服務") + "</b></span><span>客戶 / 案場<b>" + esc(report.client_name) + "</b></span><span>時間<b>" + wprTimeText(report) + "</b></span><span>地址<b>" + esc(report.address || "—") + "</b></span><span>回報人<b>" + esc(report.uploader_name) + "</b></span><span>建立帳號<b>" + esc(wprCreatedByText(report)) + "</b></span></div>" + wprOptionalNoteHtml("行事曆備註", report.appointment_note) + wprOptionalNoteHtml("工作進度", report.note) + "<div class=\"wpr-detail-photo-section\"><h4 class=\"wpr-detail-photo-title\">施工照片</h4>" + (wprPhotoManageState(id, detailTargetId).manage ? wprPhotoManagementToolbarHtml(id, detailTargetId) : "") + "<div class=\"wpr-gallery-grid\">" + wprPhotoGalleryHtml(report, id, detailTargetId) + "</div></div><div class=\"wpr-detail-actions\">" + (report.can_edit ? "<button type=\"button\" class=\"btn btn--secondary btn--sm wpr-detail-action-edit\" onclick=\"WorkProgress.wprEditReport(" + id + ",'" + actionTargetId + "')\">✏️ 編輯回報</button><button type=\"button\" class=\"btn btn--secondary btn--sm wpr-detail-action-manage\" onclick=\"WorkProgress.wprTogglePhotoManage(" + id + ",'" + actionTargetId + "')\">" + (wprPhotoManageState(id, detailTargetId).manage ? "結束照片管理" : "📷 管理照片") + "</button><span class=\"wpr-photo-limit\">目前 " + report.photo_count + " / 20 張照片" + (report.photo_count >= 20 ? " · 已達照片上限" : " · 最多還可新增 " + (20 - report.photo_count) + " 張") + "</span><button type=\"button\" class=\"btn btn--secondary btn--sm wpr-detail-action-add\" onclick=\"WorkProgress.wprAddExistingPhotos(" + id + ",'" + actionTargetId + "')\"" + (report.photo_count >= 20 ? " disabled" : "") + ">📷 新增照片</button>" : "") + (report.can_delete ? "<button type=\"button\" class=\"btn btn--danger btn--sm wpr-detail-action-delete\" onclick=\"WorkProgress.wprDeleteReport(" + id + ")\">🗑 刪除</button>" : "") + "</div>";
	} catch (error) {
		if (token === workProgressState.wprDetailRequestTokens[tokenKey]) detail.textContent = error.message;
	}
}
/**
* Toggle destructive photo controls for one report.
* @param {number} id - Report identifier.
* @param {string} [targetId] - Internal detail container id to refresh.
* @returns {Promise<void>} Completion promise.
*/
function wprTogglePhotoManage(id, targetId) {
	var state = wprPhotoManageState(id, targetId);
	state.manage = !state.manage;
	if (!state.manage) state.selected = Object.create(null);
	wprOpenHistoryDetail(id, targetId);
}
/**
* Toggle one photo in a target-scoped management selection.
* @param {number} id - Report identifier.
* @param {number} index - Photo index in the current authoritative report.
* @param {string} targetId - Detail surface identifier.
* @returns {Promise<void>} Completion promise.
*/
async function wprTogglePhotoSelection(id, index, targetId) {
	var state = wprPhotoManageState(id, targetId);
	var report = workProgressState.wprPhotoManageReports[wprPhotoManageKey(id, targetId)] || null;
	var photo = report && report.photos && report.photos[index];
	if (!state.manage || !photo) return;
	if (state.selected[photo.asset_id]) delete state.selected[photo.asset_id];
	else state.selected[photo.asset_id] = true;
	await wprOpenHistoryDetail(id, targetId, report);
}
/**
* Select every photo in the current report only.
* @param {number} id - Report identifier.
* @param {string} targetId - Detail surface identifier.
* @returns {Promise<void>} Completion promise.
*/
async function wprSelectAllPhotoSelection(id, targetId) {
	var state = wprPhotoManageState(id, targetId);
	var report = workProgressState.wprPhotoManageReports[wprPhotoManageKey(id, targetId)] || null;
	if (!state.manage || !report) return;
	state.selected = Object.create(null);
	(report.photos || []).forEach(function(photo) {
		state.selected[photo.asset_id] = true;
	});
	await wprOpenHistoryDetail(id, targetId, report);
}
/**
* Clear the selection without leaving management mode.
* @param {number} id - Report identifier.
* @param {string} targetId - Detail surface identifier.
* @returns {Promise<void>} Completion promise.
*/
async function wprClearPhotoSelection(id, targetId) {
	var state = wprPhotoManageState(id, targetId);
	var report = workProgressState.wprPhotoManageReports[wprPhotoManageKey(id, targetId)] || null;
	state.selected = Object.create(null);
	await wprOpenHistoryDetail(id, targetId, report);
}
/**
* Delete all selected photos through one report-scoped API mutation.
* @param {number} id - Report identifier.
* @param {string} targetId - Detail surface identifier.
* @returns {Promise<void>} Completion promise.
*/
async function wprBatchDeletePhotos(id, targetId) {
	var state = wprPhotoManageState(id, targetId);
	var report = workProgressState.wprPhotoManageReports[wprPhotoManageKey(id, targetId)] || null;
	var assetIds = Object.keys(state.selected);
	if (!state.manage || !assetIds.length || state.deleting) return;
	if (!window.confirm("確定刪除選取的 " + assetIds.length + " 張施工照片？\\n此動作無法復原。")) return;
	state.deleting = true;
	try {
		await apiFetch("/api/work-progress/" + id + "/photos/batch-delete", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ asset_ids: assetIds })
		});
		state.selected = Object.create(null);
		state.manage = false;
		state.deleting = false;
		toast("選取照片已刪除", "success");
		await wprReloadAndReopenDetail(id, workProgressState.wprHistoryPage, targetId);
	} catch (error) {
		state.deleting = false;
		toast(error.message, "error");
		await wprOpenHistoryDetail(id, targetId, report);
	}
}
/**
* Persist report-owned note and display-name changes.
* @param {number} id - Report identifier.
* @param {string} [targetId] - Internal detail container id to refresh after save.
* @returns {Promise<void>} Completion promise.
*/
async function wprEditReport(id, targetId) {
	try {
		var report = await apiFetch("/api/work-progress/" + id);
		var overlay = document.createElement("div");
		overlay.className = "wpr-edit-overlay";
		overlay.innerHTML = `
      <div class="wpr-edit-dialog" role="dialog" aria-modal="true" aria-labelledby="wpr-edit-title">
        <div class="wpr-edit-header"><h3 id="wpr-edit-title">✏️ 編輯工作進度回報</h3><button type="button" class="wpr-edit-close" data-wpr-edit-close aria-label="關閉">✕</button></div>
        <div class="wpr-edit-body">
          <section class="wpr-edit-readonly-section" aria-labelledby="wpr-edit-calendar-title">
            <h4 id="wpr-edit-calendar-title">行事曆資料</h4>
            <div class="wpr-edit-readonly-grid">
              <div class="wpr-edit-readonly-row"><span>工作日期</span><strong>${esc(report.report_date || "—")}</strong></div>
              <div class="wpr-edit-readonly-row"><span>時間</span><strong>${esc(wprTimeText(report))}</strong></div>
              <div class="wpr-edit-readonly-row"><span>客戶 / 案場</span><strong>${esc(report.client_name || "—")}</strong></div>
              <div class="wpr-edit-readonly-row"><span>地址</span><strong>${esc(report.address || "—")}</strong></div>
              <div class="wpr-edit-readonly-row"><span>指定服務</span><strong>${esc(report.service_name || "未指定服務")}</strong></div>
              ${report.appointment_note ? "<div class=\"wpr-edit-readonly-row\"><span>行事曆備註</span><strong>" + esc(report.appointment_note) + "</strong></div>" : ""}
            </div>
            <p class="wpr-edit-source-hint">以上內容來源自行事曆，如需修改請至行事曆調整；更新後會自動同步至工作進度回報。</p>
          </section>
          <section class="wpr-edit-form-section" aria-labelledby="wpr-edit-progress-title">
            <h4 id="wpr-edit-progress-title">工作進度資料</h4>
            <label for="wpr-edit-uploader">回報人顯示名稱*</label>
            <input id="wpr-edit-uploader" type="text" maxlength="50" value="${esc(report.uploader_name || "")}">
            <div class="wpr-edit-creator">建立帳號：${esc(wprCreatedByText(report))}</div>
            <div class="wpr-edit-hint">修改回報人顯示名稱不會變更原始建立帳號與 ownership（權限）。</div>
            <label for="wpr-edit-note">工作進度(選填)</label>
            <textarea id="wpr-edit-note" maxlength="1000" rows="6">${esc(report.note || "")}</textarea>
          </section>
        </div>
        <div class="wpr-edit-footer"><button type="button" class="btn btn--secondary btn--md" data-wpr-edit-close>取消</button><button type="button" class="btn btn--primary btn--md" data-wpr-edit-save>儲存</button></div>
      </div>`;
		document.body.appendChild(overlay);
		var close = function() {
			overlay.remove();
		};
		overlay.querySelectorAll("[data-wpr-edit-close]").forEach(function(button) {
			button.addEventListener("click", close);
		});
		overlay.addEventListener("click", function(event) {
			if (event.target === overlay) close();
		});
		overlay.querySelector("[data-wpr-edit-save]").addEventListener("click", async function() {
			var uploader = overlay.querySelector("#wpr-edit-uploader").value.trim();
			var note = overlay.querySelector("#wpr-edit-note").value.trim();
			if (!uploader) {
				toast("請填寫回報人");
				return;
			}
			if (uploader.length > 50) {
				toast("回報人最多 50 字");
				return;
			}
			if (note.length > 1e3) {
				toast("工作進度最多 1000 字");
				return;
			}
			var save = overlay.querySelector("[data-wpr-edit-save]");
			save.disabled = true;
			try {
				await apiFetch("/api/work-progress/" + id, {
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						uploader_name: uploader,
						note
					})
				});
				close();
				await wprReloadAndReopenDetail(id, workProgressState.wprHistoryPage, targetId);
				toast("工作進度已更新", "success");
			} catch (error) {
				toast(error.message, "error");
				save.disabled = false;
			}
		});
	} catch (error) {
		toast(error.message, "error");
	}
}
/**
* Open a multi-file picker and append photos to an existing report.
* @param {number} id - Report identifier.
* @param {string} [targetId] - Internal detail container id to refresh after upload.
* @returns {void} Function result.
*/
function wprAddExistingPhotos(id, targetId) {
	var input = document.createElement("input");
	input.type = "file";
	input.accept = "image/jpeg,image/png,image/webp";
	input.multiple = true;
	input.onchange = async function() {
		try {
			var files = Array.from(input.files || []);
			var report = await apiFetch("/api/work-progress/" + id);
			var validation = wprValidatePhotoBatch(files, Number(report.photo_count) || 0);
			if (!validation.ok) {
				toast(validation.error, "error");
				return;
			}
			var form = new FormData();
			files.forEach(function(file) {
				form.append("files", file, file.name);
			});
			await wprUploadWithProgress("/api/work-progress/" + id + "/photos", form, function(phase, percent) {
				toast(wprUploadProgressText(phase, percent));
			});
			toast("照片已新增", "success");
			await wprReloadAndReopenDetail(id, 1, targetId);
		} catch (error) {
			toast(error.message, "error");
		}
	};
	input.click();
}
/**
* Confirm and delete a report with its managed photos.
* @param {number} id - Function input.
* @returns {void} Function result.
*/
async function wprDeleteReport(id) {
	if (!window.confirm("確定刪除此工作進度？\n將一併刪除備註與所有施工照片，此動作無法復原。")) return;
	try {
		await apiFetch("/api/work-progress/" + id, { method: "DELETE" });
		wprClearPhotoManageStates(function(targetId) {
			return targetId === "wpr-detail-" + id || targetId === "wpr-selected-report-detail-" + id;
		});
		toast("工作進度已刪除", "success");
		wprLoadHistory(1);
		wprLoadDay();
		wprLoadKpi();
	} catch (error) {
		toast(error.message, "error");
	}
}
//#endregion
//#region static/js/features/work-progress/page.js
var page_exports = /* @__PURE__ */ __exportAll({
	renderWorkProgress: () => renderWorkProgress,
	wprCanCreate: () => wprCanCreate,
	wprHandleDateChange: () => wprHandleDateChange,
	wprHistoryToggled: () => wprHistoryToggled,
	wprRenderCreate: () => wprRenderCreate,
	wprSelectJob: () => wprSelectJob
});
/**
* Mount the Work Progress page and start its initial data loads.
* @returns {void} Function result.
*/
async function renderWorkProgress() {
	var el = document.getElementById("content");
	if (!el) return;
	wprClearPendingFiles();
	workProgressState.wprDayGuard.invalidate();
	workProgressState.wprHistoryGuard.invalidate();
	workProgressState.wprKpiGuard.invalidate();
	workProgressState.wprDetailRequestTokens = {};
	workProgressState.wprPhotoManageStates = {};
	workProgressState.wprPhotoManageReports = {};
	workProgressState.wprSuppressHistoryToggle = {};
	workProgressState.wprSelectGuard.invalidate();
	workProgressState.wprAppointments = [];
	workProgressState.wprReportsByAppointment = {};
	workProgressState.wprCurrentReport = null;
	el.innerHTML = `
    <div class="wpr-wrap">
      <section class="wpr-page-header">
        <div><div class="wpr-eyebrow">📸 現場紀錄</div><h1>每日工作進度回報</h1><p>記錄每日工作進度、備註及施工現場照片。</p></div>
        <button class="btn btn--secondary btn--md wpr-history-jump" type="button" onclick="document.getElementById('wpr-history').scrollIntoView({behavior:'smooth'})">查看歷史 ↓</button>
      </section>
      <div class="wpr-layout">
        <section class="wpr-card wpr-create-card" id="wpr-create"></section>
        <aside class="wpr-side">
          <div class="wpr-info">
            <h3>💡 使用流程</h3>
            <ul>
              <li><span class="wpr-badge">1</span>選擇工作日期，載入當日行事曆工作</li>
              <li><span class="wpr-badge">2</span>選擇一筆工作，確認工作摘要與行事曆備註</li>
              <li><span class="wpr-badge">3</span>填寫進度備註，拍照或從相簿加入施工照片</li>
              <li><span class="wpr-badge">4</span>儲存回報，之後可在歷史區查看、編輯或管理照片</li>
            </ul>
            <div class="wpr-info-badges">
              <span class="wpr-badge">📅 工作來源：行事曆</span>
              <span class="wpr-badge">📸 施工照片可選填</span>
              <span class="wpr-badge">🔒 依權限管理本人或全部資料</span>
            </div>
          </div>
          <div class="wpr-card wpr-kpi-card">
            <div class="wpr-section-heading"><div><h2>📊 本月概況</h2><p>依目前存在的行事曆工作計算。</p></div></div>
            <div class="wpr-kpi-grid" id="wpr-kpi"></div>
            <div class="wpr-hint">待回報 = 本月仍沒有工作進度回報的行事曆工作。</div>
          </div>
        </aside>
        <section class="wpr-card wpr-history-card" id="wpr-history">
          <div class="wpr-section-heading">
            <div><h2>歷史工作進度</h2><p>可查單日／週／本月／全部，並搜尋客戶、服務、地址、備註或回報人。</p></div>
          </div>
          <div class="wpr-history-filters">
            <div class="wpr-filter-field"><label for="wpr-from">起始日</label><input type="date" id="wpr-from" aria-label="起始日期"></div>
            <div class="wpr-filter-field"><label for="wpr-to">迄止日</label><input type="date" id="wpr-to" aria-label="迄止日期"></div>
            <div class="wpr-filter-field wpr-filter-field--search"><label for="wpr-query">關鍵字（客戶／服務／地址／備註／回報人）</label><input type="search" id="wpr-query" placeholder="例：王先生、安裝、配管" aria-label="搜尋工作進度" onkeydown="if(event.key==='Enter') WorkProgress.wprLoadHistory(1)"></div>
            <div class="wpr-filter-actions"><button type="button" class="btn btn--primary btn--md" onclick="WorkProgress.wprLoadHistory(1)">搜尋</button><button type="button" class="btn btn--secondary btn--md" onclick="WorkProgress.wprResetFilter()">清除</button></div>
          </div>
          <div class="wpr-quick-filters">
            <button type="button" class="chip wpr-chip" data-role="wpr-range" data-range="today" onclick="WorkProgress.wprQuickRange('today', this)">今天</button>
            <button type="button" class="chip wpr-chip" data-role="wpr-range" data-range="week" onclick="WorkProgress.wprQuickRange('week', this)">本週</button>
            <button type="button" class="chip wpr-chip is-active" data-role="wpr-range" data-range="month" onclick="WorkProgress.wprQuickRange('month', this)">本月</button>
            <button type="button" class="chip wpr-chip" data-role="wpr-range" data-range="all" onclick="WorkProgress.wprQuickRange('all', this)">全部</button>
            <span class="wpr-result-count"><span id="wpr-result-count">0 筆</span></span>
          </div>
          <div id="wpr-history-list"></div>
        </section>
      </div>
    </div>`;
	wprSetHistoryMonth();
	wprRenderCreate();
	await Promise.all([
		wprLoadDay(),
		wprLoadHistory(),
		wprLoadKpi()
	]);
}
/**
* Check the permission used to render and submit the create form.
* @returns {void} Function result.
*/
function wprCanCreate() {
	return hasPerm("work-progress-create");
}
/**
* Render the create form or the view-only permission message.
* @returns {void} Function result.
*/
function wprRenderCreate() {
	var create = document.getElementById("wpr-create");
	if (!create) return;
	if (!wprCanCreate()) {
		create.innerHTML = `
      <div class="wpr-readonly-permission">
        <div class="wpr-readonly-permission-icon">🔒</div>
        <h2>目前只有檢視權限</h2>
        <p>你可以查看歷史工作進度與照片，但沒有新增工作進度回報的權限。</p>
      </div>`;
		return;
	}
	create.innerHTML = `
    <div class="wpr-section-heading"><div><h2>建立工作進度</h2><p>選擇行事曆工作後填寫現場回報。</p></div></div>
    <div class="wpr-field"><label for="wpr-date">工作日期<b>*</b></label><input type="date" id="wpr-date" value="${esc(wprIsoDate())}" onchange="WorkProgress.wprHandleDateChange()"></div>
    <div class="wpr-field"><label>選擇工作內容<b>*</b></label><div id="wpr-job-list" class="wpr-job-list"></div></div>
    <div id="wpr-selected-area" hidden></div>
    <section class="wpr-create-progress-section" aria-labelledby="wpr-create-progress-title">
      <h3 id="wpr-create-progress-title">工作進度資料</h3>
      <div class="wpr-field"><label for="wpr-uploader">回報人顯示名稱<b>*</b></label><input id="wpr-uploader" type="text" maxlength="50"><div class="wpr-create-creator" id="wpr-create-creator"></div><div class="wpr-hint">修改回報人顯示名稱不會變更原始建立帳號與 ownership（權限）。</div></div>
      <div class="wpr-field"><label for="wpr-note">工作進度(選填)</label><textarea id="wpr-note" maxlength="1000" rows="5" placeholder="記錄今日完成內容、未完成項目或明日安排" oninput="WorkProgress.wprUpdateNoteCount()"></textarea><div class="wpr-counter" id="wpr-note-count">0 / 1000</div></div>
      <div class="wpr-field"><label>施工照片（選填）</label>
        <div class="wpr-photo-limit-copy">JPG、PNG、WebP · 單張最多 20MB · 每份最多 20 張</div>
        <div id="wpr-drop" class="wpr-drop">
          <div class="wpr-drop-icon">📸</div><div class="wpr-drop-title">拖曳多張圖片到此</div><div class="wpr-drop-sub">支援 JPG、PNG、WebP；也可以使用相簿或手機相機連續新增</div>
          <div class="wpr-photo-actions"><button id="wpr-album-button" type="button" class="btn btn--secondary btn--md" onclick="document.getElementById('wpr-album').click()">🖼 從相簿選擇</button><button id="wpr-camera-button" type="button" class="btn btn--secondary btn--md" onclick="document.getElementById('wpr-camera').click()">📷 拍照新增</button></div>
          <input id="wpr-album" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onchange="WorkProgress.wprAddPendingFiles(this.files);this.value=''"><input id="wpr-camera" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden onchange="WorkProgress.wprAddPendingFiles(this.files);this.value=''">
        </div>
        <div class="wpr-photo-counter" id="wpr-photo-counter">已選 0 / 20 張</div>
        <div id="wpr-pending-photos" class="wpr-photo-grid"></div>
      </div>
    </section>
    <button id="wpr-save" type="button" class="btn btn--primary btn--md wpr-save-button" disabled onclick="WorkProgress.wprSubmit()">儲存工作進度回報</button>`;
	var uploaderInput = document.getElementById("wpr-uploader");
	var creatorIdentity = document.getElementById("wpr-create-creator");
	var currentUserName = wprCurrentUserName();
	if (uploaderInput) uploaderInput.value = currentUserName;
	workProgressState.wprInitialUploaderName = currentUserName;
	var dateInput = document.getElementById("wpr-date");
	workProgressState.wprCurrentDateValue = dateInput ? dateInput.value : "";
	if (creatorIdentity) creatorIdentity.textContent = "建立帳號：" + currentUserName;
	wprInstallBeforeUnload();
	wprBindDropZone();
	wprUpdateNoteCount();
	wprRenderPendingPhotos();
}
/**
* Render the appointment-owned fields as a read-only create summary.
* @param {Object} job - Selected calendar appointment.
* @param {string} dateValue - Selected work date.
* @returns {string} Escaped read-only calendar markup.
*/
function wprCalendarReadonlyHtml(job, dateValue) {
	return "<section class=\"wpr-create-calendar-section\" aria-labelledby=\"wpr-create-calendar-title\"><h3 id=\"wpr-create-calendar-title\">行事曆資料</h3><div class=\"wpr-create-calendar-grid\"><div><span>工作日期</span><strong>" + esc(dateValue || "—") + "</strong></div><div><span>時間</span><strong>" + wprTimeText(job) + "</strong></div><div><span>客戶 / 案場</span><strong>" + esc(job.client_name || "—") + "</strong></div><div><span>地址</span><strong>" + esc(job.address || "—") + "</strong></div><div><span>指定服務</span><strong>" + esc(job.service_name || "未指定服務") + "</strong></div></div>" + wprOptionalNoteHtml("行事曆備註", job.note) + "<p class=\"wpr-create-source-hint\">以上內容來源自行事曆，如需修改請至行事曆調整。</p></section>";
}
/**
* Select an appointment and render its snapshot or existing report summary.
* @param {number} id - Function input.
* @returns {void} Function result.
*/
async function wprSelectJob(id) {
	var token = workProgressState.wprSelectGuard.next();
	var job = workProgressState.wprAppointments.find(function(item) {
		return item.id === id;
	});
	if (!job) return;
	if (workProgressState.wprCurrentReport && workProgressState.wprCurrentReport.appointment_id !== id && wprHasUnsavedChanges()) {
		wprRequestDraftReset(function() {
			wprSelectJob(id);
		});
		return;
	}
	var previousReportId = workProgressState.wprCurrentReport && Number.isInteger(workProgressState.wprCurrentReport.id) ? workProgressState.wprCurrentReport.id : null;
	var existing = workProgressState.wprReportsByAppointment[id];
	if (existing) try {
		var report = await apiFetch("/api/work-progress/" + existing.id);
		if (!workProgressState.wprSelectGuard.isCurrent(token)) return;
		workProgressState.wprCurrentReport = report;
	} catch (error) {
		if (!workProgressState.wprSelectGuard.isCurrent(token)) return;
		toast(error.message, "error");
		return;
	}
	else workProgressState.wprCurrentReport = {
		appointment_id: id,
		appointment: job
	};
	var nextReportId = existing ? report.id : null;
	if (previousReportId && previousReportId !== nextReportId) wprClearPhotoManageStates(function(targetId) {
		return targetId === "wpr-selected-report-detail-" + previousReportId;
	});
	wprRenderJobs();
	var area = document.getElementById("wpr-selected-area");
	var save = document.getElementById("wpr-save");
	if (existing) {
		area.hidden = false;
		area.innerHTML = "<div class=\"wpr-selected-summary\"><strong>✓ 此工作已有工作進度回報</strong>" + wprOptionalNoteHtml("工作進度", existing.note) + "<button type=\"button\" class=\"btn btn--secondary btn--sm\" onclick=\"WorkProgress.wprOpenHistoryDetail(" + existing.id + ",'wpr-selected-report-detail-" + existing.id + "')\">查看工作進度</button><div id=\"wpr-selected-report-detail-" + existing.id + "\" class=\"wpr-selected-report-detail\"></div></div>" + wprCalendarReadonlyHtml(job, document.getElementById("wpr-date").value);
		save.disabled = true;
	} else {
		area.hidden = false;
		area.innerHTML = "<div class=\"wpr-selected-summary\"><strong>✓ 已選工作</strong></div>" + wprCalendarReadonlyHtml(job, document.getElementById("wpr-date").value);
		save.disabled = false;
	}
}
/**
* Build one expandable history card summary.
* @param {Object} report - Function input.
* @returns {void} Function result.
*/
function wprHistoryToggled(el, id) {
	if (el.open && !workProgressState.wprSuppressHistoryToggle[id]) wprOpenHistoryDetail(id);
	workProgressState.wprSuppressHistoryToggle[id] = false;
}
/**
* Handle date changes without silently moving an unsaved draft.
* @returns {void} Function result.
*/
function wprHandleDateChange() {
	var dateInput = document.getElementById("wpr-date");
	var nextDate = dateInput ? dateInput.value : "";
	if (wprHasUnsavedChanges()) {
		var previousDate = workProgressState.wprCurrentDateValue;
		wprRequestDraftReset(function() {
			if (dateInput) dateInput.value = nextDate;
			workProgressState.wprCurrentDateValue = nextDate;
			wprLoadDay();
		}, previousDate);
		return;
	}
	workProgressState.wprCurrentDateValue = nextDate;
	wprLoadDay();
}
//#endregion
//#region static/js/features/shell/app.js
var app_exports = /* @__PURE__ */ __exportAll({
	checkReminder: () => checkReminder,
	clearSearchAutofill: () => clearSearchAutofill,
	closeSidebar: () => closeSidebar,
	configureShell: () => configureShell,
	initShellApp: () => initShellApp,
	openSidebar: () => openSidebar,
	switchSite: () => switchSite,
	switchTab: () => switchTab,
	toggleAvatarMenu: () => toggleAvatarMenu,
	toggleSidebar: () => toggleSidebar
});
function renderUserMenu(user) {
	var header = document.getElementById("avatarMenuHeader");
	if (header && user) header.textContent = "👤 " + (user.display_name || user.username);
	renderSidebarUser(user);
}
function applyPageVisibility(user) {
	var visible = Array.isArray(user.visible_pages) ? user.visible_pages : null;
	document.querySelectorAll("[data-page-key]").forEach(function(el) {
		var pageKey = el.dataset.pageKey;
		el.style.display = !visible || canAccessPage(pageKey) ? "" : "none";
	});
	if (typeof appState.currentTab !== "undefined" && !canAccessPage(appState.currentTab)) appState.currentTab = firstAccessiblePageTab() || "";
}
function applyRoleView(user) {
	if (!user) return;
	applyPageVisibility(user);
	var canAdjust = !!(user.permissions || {})["stock-mgmt"];
	var sbNavStocktake = document.getElementById("sb-nav-stocktake");
	var sbNavWorkProgress = document.getElementById("sb-nav-work-progress");
	var saveBar = document.getElementById("save-bar");
	if (sbNavStocktake) sbNavStocktake.style.display = canAccessPage("stocktake") ? "" : "none";
	if (sbNavWorkProgress) sbNavWorkProgress.style.display = canAccessPage("work-progress") ? "" : "none";
	checkReminder();
	if (saveBar) saveBar.style.display = canAdjust ? "" : "none";
	if (!canAccessPage("work-progress") && typeof appState.currentTab !== "undefined" && appState.currentTab === "work-progress") switchTab("calendar");
	if (!canAccessPage("stocktake") && typeof appState.currentTab !== "undefined" && appState.currentTab === "stocktake") switchTab("inventory");
}
function hasPending() {
	return Object.keys(pending).length > 0;
}
function switchSite(site) {
	if (INVENTORY_SITES.indexOf(site) < 0) return;
	if (site === appState.currentSite) return;
	if (hasPending() && !confirm("⚠️ 有未儲存的數量調整，切換分片將遺失。確定要切換嗎？")) return;
	appState.currentSite = site;
	appState.inventoryLoadedSite = "";
	appState.fullItemsLoadedSite = "";
	appState.INVENTORY_META.page = 1;
	appState.INVENTORY_META.stats = null;
	appState.INVENTORY_FACETS = {
		brands: {},
		categories: {},
		locations: []
	};
	appState.inventoryFacetsLoadedSite = "";
	appState.ALL_ITEMS = [];
	appState.ALERTS_BY_SITE = {};
	updateNotifications();
	document.querySelectorAll("[data-role=\"header-site\"] button").forEach(function(t) {
		t.classList.remove("is-active");
	});
	var el = document.getElementById("site-" + site);
	if (el) el.classList.add("is-active");
	loadData();
	syncViewUrl();
}
function openSidebar() {
	document.getElementById("sidebar").classList.add("mob-open");
	document.getElementById("sbOverlay").classList.add("is-open");
}
function closeSidebar() {
	document.getElementById("sidebar").classList.remove("mob-open");
	document.getElementById("sbOverlay").classList.remove("is-open");
}
function toggleSidebar() {
	var sb = document.getElementById("sidebar");
	var mn = document.querySelector("[data-role=\"app-main\"]");
	if (!(window.innerWidth >= 768)) {
		if (sb.classList.contains("mob-open")) closeSidebar();
		else openSidebar();
		return;
	}
	var expanded = sb.classList.toggle("is-expanded");
	mn.classList.toggle("sidebar-expanded", expanded);
}
function toggleAvatarMenu() {
	document.getElementById("avatarMenu").classList.toggle("is-open");
}
function closeAvatarMenu() {
	var m = document.getElementById("avatarMenu");
	if (m) m.classList.remove("is-open");
}
function renderSidebarUser(user) {
	if (!user) return;
	var sbUser = document.getElementById("sb-user");
	var sbName = document.getElementById("sb-user-name");
	var sbRole = document.getElementById("sb-user-role");
	var sbAv = document.getElementById("sb-user-av");
	var hAv = document.getElementById("h-av");
	if (sbUser) sbUser.style.display = "";
	if (sbName) sbName.textContent = user.display_name || user.username;
	if (sbRole) sbRole.textContent = user.role === "admin" ? "管理員" : user.role === "viewer" ? "檢視者" : "使用者";
	if (sbAv) sbAv.textContent = (user.display_name || user.username || "—").charAt(0);
	if (hAv) hAv.textContent = (user.display_name || user.username || "—").charAt(0);
}
var _TAB_LABEL = {
	calendar: "行事曆",
	"work-progress": "每日工作進度回報",
	inventory: "單一庫存",
	prepared: "待領出",
	stockout: "已領出",
	stocktake: "盤點",
	kit: "整組庫存",
	"signed-reports": "每日簽名日報表",
	quotation: "報價單",
	"petty-cash": "零用金月報"
};
var _TAB_ICON = {
	calendar: "📅",
	"work-progress": "📸",
	inventory: "📦",
	prepared: "📤",
	stockout: "🚚",
	stocktake: "📋",
	kit: "🔧",
	"signed-reports": "🗂",
	quotation: "🧾",
	"petty-cash": "🪙"
};
function updateBreadcrumb(tab) {
	var el = document.getElementById("breadcrumb");
	if (el) el.innerHTML = (_TAB_ICON[tab] || "📦") + " <b>" + (_TAB_LABEL[tab] || tab) + "</b>";
}
function renderNoAccessiblePage() {
	appState.currentTab = "";
	setPageScope("");
	var content = document.getElementById("content");
	if (content) content.innerHTML = "<div class=\"empty\">目前沒有可用的頁面</div>";
	updateBreadcrumb("");
	syncViewUrl();
}
function switchTab(tab) {
	tab = resolveAccessiblePageTab(tab);
	if (!tab) {
		renderNoAccessiblePage();
		return;
	}
	var previousTab = appState.currentTab;
	if (previousTab === "work-progress" && tab !== "work-progress" && wprHasUnsavedChanges()) {
		wprRequestLeave(tab);
		return;
	}
	if (previousTab === "work-progress" && tab !== "work-progress") {
		wprClearPendingFiles();
		wprCloseGallery();
	}
	closeInventoryStatusModal();
	appState.currentTab = tab;
	syncViewUrl();
	checkReminder();
	updateNotifications();
	setPageScope(tab);
	document.querySelectorAll("[data-role=\"sidebar-nav-link\"]").forEach(function(n) {
		n.classList.remove("is-active");
	});
	var nav = document.getElementById("nav-" + tab);
	if (nav) nav.classList.add("is-active");
	var sbNav = document.getElementById("sb-nav-" + tab);
	if (sbNav) sbNav.classList.add("is-active");
	updateBreadcrumb(tab);
	closeSidebar();
	var isCal = tab === "calendar" || tab === "work-progress" || tab === "signed-reports" || tab === "quotation" || tab === "petty-cash";
	var isInventory = tab === "inventory";
	var sb = document.querySelector("[data-role=\"header-search\"]");
	var st = document.querySelector("[data-role=\"header-site\"]");
	if (sb) sb.style.display = isCal ? "none" : "";
	if (st) st.style.display = isCal ? "none" : "";
	var fp = document.getElementById("filter-panel");
	if (fp) fp.style.display = isInventory ? "" : "none";
	if (!isInventory) {
		if (typeof appState.batchMode !== "undefined" && appState.batchMode) {
			appState.batchMode = false;
			var bt = document.getElementById("batch-toggle");
			if (bt) bt.classList.remove("is-active");
		}
		selectedStockIds.clear();
		var bn = document.getElementById("batch-num");
		if (bn) bn.textContent = "0";
		var bc = document.getElementById("batch-confirm");
		if (bc) bc.disabled = true;
		var bb = document.getElementById("batch-bar");
		if (bb) bb.classList.remove("is-open");
		var cab = document.getElementById("batch-cabinet");
		if (cab) cab.value = "";
		var sub = document.getElementById("batch-sub");
		if (sub) sub.value = "";
	}
	if (tab === "inventory") {
		if (appState.inventoryLoadedSite !== appState.currentSite) {
			loadInventoryPage(1);
			return;
		}
		renderInventory();
	} else if ([
		"prepared",
		"stockout",
		"stocktake",
		"kit"
	].indexOf(tab) >= 0 && appState.fullItemsLoadedSite !== appState.currentSite) {
		loadData({ full: true });
		return;
	} else if (tab === "prepared") renderPrepared();
	else if (tab === "stockout") renderStockOuts();
	else if (tab === "stocktake") renderStocktake();
	else if (tab === "kit") renderKits();
	else if (tab === "calendar") renderCalendar();
	else if (tab === "work-progress") renderWorkProgress();
	else if (tab === "signed-reports") renderSignedReports();
	else if (tab === "quotation") renderQuotation();
	else if (tab === "petty-cash") renderPettyCash();
	syncViewUrl();
}
function checkReminder() {
	var el = document.getElementById("reminder");
	if (!el) return;
	if (!canAccessPage("stocktake", "operate")) {
		el.style.display = "none";
		return;
	}
	var state = getStocktakeReminderState();
	if (state.visible) {
		el.style.display = "flex";
		var today = document.getElementById("today-str");
		if (today) today.textContent = state.todayLabel;
	} else el.style.display = "none";
}
var _searchTimer;
function clearSearchAutofill() {
	var si = document.getElementById("search-input");
	if (si) si.value = "";
}
var _TABS = [
	"inventory",
	"prepared",
	"stockout",
	"stocktake",
	"kit",
	"calendar",
	"work-progress",
	"signed-reports",
	"quotation",
	"petty-cash"
];
var _focusReloadTimer = null;
var _lastVisibilityReloadAt = 0;
function autoReloadOnFocus() {
	if (hasPending()) return;
	if (document.querySelector("[data-role=\"modal\"].is-open")) return;
	if (document.visibilityState !== "visible") return;
	if (Date.now() - _lastVisibilityReloadAt < 1500) return;
	if (_focusReloadTimer) return;
	_focusReloadTimer = setTimeout(function() {
		_focusReloadTimer = null;
		if (document.visibilityState !== "visible" || hasPending() || document.querySelector("[data-role=\"modal\"].is-open")) return;
		_lastVisibilityReloadAt = Date.now();
		loadData();
	}, 300);
}
function mountPreservedTabAfterBootstrap() {
	if (DATA_REFRESH_PRESERVE_MOUNT_TABS.has(appState.currentTab)) switchTab(appState.currentTab);
}
function configureShell() {
	provideTabNavigator(switchTab);
	configureDataRefresh({
		buildDatalists,
		buildFilterPanel,
		checkReminder,
		updateNotifications,
		remountTab: switchTab,
		renderInventory,
		updatePreparedBadge
	});
}
function initShellApp() {
	window.addEventListener("beforeunload", function(e) {
		if (!hasPending()) return;
		e.preventDefault();
		e.returnValue = "";
	});
	document.addEventListener("click", function(e) {
		if (!e.target.closest("#avatarDropdown")) closeAvatarMenu();
	});
	document.getElementById("search-input").addEventListener("input", function() {
		clearTimeout(_searchTimer);
		_searchTimer = setTimeout(function() {
			if (appState.currentTab === "inventory") loadInventoryPage(1);
			else if (appState.currentTab === "prepared") renderPrepared();
			else if (appState.currentTab === "stockout") renderStockOuts();
			else if (appState.currentTab === "stocktake") renderStocktake();
			else if (appState.currentTab === "kit") renderKits();
		}, 200);
	});
	window.addEventListener("load", function() {
		clearSearchAutofill();
		setTimeout(clearSearchAutofill, 500);
	});
	document.addEventListener("visibilitychange", autoReloadOnFocus);
	(async function() {
		var user = await checkAuth();
		if (user) {
			var _p = new URLSearchParams(location.search);
			var _t = _p.get("tab");
			var _s = _p.get("site");
			if (_TABS.indexOf(_t) >= 0) appState.currentTab = _t;
			if (INVENTORY_SITES.indexOf(_s) >= 0) appState.currentSite = _s;
			renderUserMenu(user);
			renderSidebarUser(user);
			applyRoleView(user);
			if (!appState.currentTab) {
				renderNoAccessiblePage();
				return;
			}
			if (user.password_expired) openExpiryModal();
			var bootTab = appState.currentTab;
			await loadUnits();
			var tabChangedDuringBoot = appState.currentTab !== bootTab;
			updateBreadcrumb(appState.currentTab);
			document.querySelectorAll("[data-role=\"header-site\"] button").forEach(function(t) {
				t.classList.remove("is-active");
			});
			var siteEl = document.getElementById("site-" + appState.currentSite);
			if (siteEl) siteEl.classList.add("is-active");
			var sbNav = document.getElementById("sb-nav-" + appState.currentTab);
			document.querySelectorAll("[data-role=\"sidebar-nav-link\"]").forEach(function(n) {
				n.classList.remove("is-active");
			});
			if (sbNav) sbNav.classList.add("is-active");
			if (!tabChangedDuringBoot) setPageScope(appState.currentTab);
			loadData();
			if (!tabChangedDuringBoot) mountPreservedTabAfterBootstrap();
		} else {
			var content = document.getElementById("content");
			if (content) content.innerHTML = "<div class=\"empty\">⚠️ 無法連線伺服器，請重新整理頁面<br><small>若持續發生請聯絡管理員</small></div>";
		}
	})();
}
//#endregion
//#region static/js/features/stockout/sheet.js
var sheet_exports = /* @__PURE__ */ __exportAll({ openStockoutSheet: () => openStockoutSheet });
function openStockoutSheet(movementId) {
	const rec = (typeof stockoutState.stockoutRecords !== "undefined" ? stockoutState.stockoutRecords : []).find((r) => r.id === movementId);
	if (!rec) return;
	const isViewer = !hasPerm("stockout");
	const reverted = !!rec.reverted_at;
	const isReturn = rec.reason === "退回已領出";
	const actions = [];
	if (!isViewer) {
		if (isReturn && !reverted) {
			actions.push({
				icon: "✏️",
				label: "編輯",
				cls: "out",
				fn: () => openEditStockoutReturnModal(movementId)
			});
			actions.push({
				icon: "↩️",
				label: "撤銷退回",
				cls: "del",
				fn: () => deleteStockoutReturn(movementId)
			});
		} else if (!isReturn && !reverted) {
			actions.push({
				icon: "✏️",
				label: "編輯",
				cls: "out",
				fn: () => openEditStockoutModal(movementId)
			});
			actions.push({
				icon: "↩️",
				label: "退回",
				cls: "back",
				fn: () => returnStockout(movementId)
			});
		}
		if (!isReturn) actions.push({
			icon: "🗑",
			label: "刪除",
			cls: "del",
			fn: () => deleteStockoutRecord(movementId)
		});
	}
	openSheet(`${rec.brand} ${rec.item_name}`, actions);
}
//#endregion
//#region static/js/features/inventory/export-dialog.js
var export_dialog_exports$2 = /* @__PURE__ */ __exportAll({
	closeInventoryExportDialog: () => closeInventoryExportDialog,
	initInventoryExportDialog: () => initInventoryExportDialog,
	openInventoryExportDialog: () => openInventoryExportDialog,
	submitInventoryExport: () => submitInventoryExport,
	syncInventoryExportAllSites: () => syncInventoryExportAllSites,
	toggleInventoryExportSites: () => toggleInventoryExportSites
});
var exportInFlight = false;
function exportPad(value) {
	return String(value).padStart(2, "0");
}
/**
* 將匯出對話框重設為標準的期間、庫存區與工作表預設值。
* @returns {void}
*/
function openInventoryExportDialog() {
	const modal = document.getElementById("inventory-export-dialog");
	if (!modal) return;
	const now = /* @__PURE__ */ new Date();
	const monthSelect = document.getElementById("inventory-export-month");
	if (!monthSelect.options.length) for (let month = 1; month <= 12; month += 1) {
		const option = document.createElement("option");
		option.value = exportPad(month);
		option.textContent = `${exportPad(month)} 月`;
		monthSelect.appendChild(option);
	}
	document.getElementById("inventory-export-year").value = now.getFullYear();
	monthSelect.value = exportPad(now.getMonth() + 1);
	document.getElementById("inventory-export-start").value = `${now.getFullYear()}-${exportPad(now.getMonth() + 1)}-01`;
	document.getElementById("inventory-export-end").value = `${now.getFullYear()}-${exportPad(now.getMonth() + 1)}-${exportPad(now.getDate())}`;
	document.getElementById("inventory-export-month-mode").checked = true;
	document.getElementById("inventory-export-custom-mode").checked = false;
	syncInventoryExportPeriodMode();
	document.getElementById("inventory-export-all-sites").checked = true;
	document.querySelectorAll("#inventory-export-sites input[data-site]").forEach((input) => {
		input.checked = true;
	});
	const defaultSections = [
		"inventory",
		"positions",
		"movements"
	];
	document.querySelectorAll("#inventory-export-content input[data-section]").forEach((input) => {
		input.checked = defaultSections.includes(input.dataset.section);
	});
	modal.classList.add("is-open");
	modal.setAttribute("aria-hidden", "false");
}
function closeInventoryExportDialog() {
	const modal = document.getElementById("inventory-export-dialog");
	if (!modal) return;
	modal.classList.remove("is-open");
	modal.setAttribute("aria-hidden", "true");
}
function syncInventoryExportPeriodMode() {
	const custom = document.getElementById("inventory-export-custom-mode").checked;
	document.getElementById("inventory-export-month-fields").hidden = custom;
	document.getElementById("inventory-export-custom-fields").hidden = !custom;
}
function toggleInventoryExportSites(source) {
	document.querySelectorAll("#inventory-export-sites input[data-site]").forEach((input) => {
		input.checked = source.checked;
	});
}
function syncInventoryExportAllSites() {
	const inputs = [...document.querySelectorAll("#inventory-export-sites input[data-site]")];
	document.getElementById("inventory-export-all-sites").checked = inputs.every((input) => input.checked);
}
/**
* 驗證所選篩選條件，並下載指定的活頁簿工作表。
* @returns {Promise<void>} 完成請求並清理介面後結束。
*/
async function submitInventoryExport() {
	if (exportInFlight) return;
	const button = document.getElementById("inventory-export-submit");
	const custom = document.getElementById("inventory-export-custom-mode").checked;
	const params = new URLSearchParams();
	if (custom) {
		const start = document.getElementById("inventory-export-start").value;
		const end = document.getElementById("inventory-export-end").value;
		if (!start || !end || start > end) {
			toast("匯出失敗：日期範圍無效", "error");
			return;
		}
		params.set("start_date", start);
		params.set("end_date", end);
	} else params.set("month", `${document.getElementById("inventory-export-year").value}-${document.getElementById("inventory-export-month").value}`);
	const sites = [...document.querySelectorAll("#inventory-export-sites input[data-site]:checked")].map((input) => input.dataset.site);
	if (!sites.length) {
		toast("匯出失敗：至少選擇一個庫存區", "error");
		return;
	}
	params.set("sites", sites.join(","));
	const sections = [...document.querySelectorAll("#inventory-export-content input[data-section]:checked")].map((input) => input.dataset.section);
	if (!sections.length) {
		toast("匯出失敗：至少選擇一種匯出內容", "error");
		return;
	}
	params.set("sections", sections.join(","));
	exportInFlight = true;
	if (button) {
		button.disabled = true;
		button.textContent = "產生報表中…";
	}
	try {
		await apiDownload(`/api/export?${params.toString()}`, {
			filename: "庫存報表.xlsx",
			fallback: "請稍後再試"
		});
		closeInventoryExportDialog();
		toast("✅ 報表已下載", "success");
	} catch (error) {
		toast(`匯出失敗：${esc(error.message || "請稍後再試")}`, "error");
	} finally {
		exportInFlight = false;
		if (button) {
			button.disabled = false;
			button.textContent = "匯出報表";
		}
	}
}
function initInventoryExportDialog() {
	document.getElementById("inventory-export-month-mode").addEventListener("change", syncInventoryExportPeriodMode);
	document.getElementById("inventory-export-custom-mode").addEventListener("change", syncInventoryExportPeriodMode);
}
//#endregion
//#region static/js/features/kits/export-dialog.js
var export_dialog_exports$1 = /* @__PURE__ */ __exportAll({
	closeKitExportDialog: () => closeKitExportDialog,
	initKitsExportDialog: () => initKitsExportDialog,
	openKitExportDialog: () => openKitExportDialog,
	submitKitExport: () => submitKitExport
});
var kitExportInFlight = false;
function exportPadKit(value) {
	return String(value).padStart(2, "0");
}
/**
* 開啟整組匯出對話框，重設預設值
* @returns {void}
*/
function openKitExportDialog() {
	const modal = document.getElementById("kit-export-dialog");
	if (!modal) return;
	const now = /* @__PURE__ */ new Date();
	const monthSelect = document.getElementById("kit-export-month");
	if (!monthSelect.options.length) for (let month = 1; month <= 12; month += 1) {
		const option = document.createElement("option");
		option.value = exportPadKit(month);
		option.textContent = `${exportPadKit(month)} 月`;
		monthSelect.appendChild(option);
	}
	document.getElementById("kit-export-year").value = now.getFullYear();
	monthSelect.value = exportPadKit(now.getMonth() + 1);
	document.getElementById("kit-export-start").value = `${now.getFullYear()}-${exportPadKit(now.getMonth() + 1)}-01`;
	document.getElementById("kit-export-end").value = `${now.getFullYear()}-${exportPadKit(now.getMonth() + 1)}-${exportPadKit(now.getDate())}`;
	document.getElementById("kit-export-month-mode").checked = true;
	document.getElementById("kit-export-custom-mode").checked = false;
	syncKitExportPeriodMode();
	const defaultSections = [
		"inventory",
		"positions",
		"movements"
	];
	document.querySelectorAll("#kit-export-content input[data-section]").forEach((input) => {
		input.checked = defaultSections.includes(input.dataset.section);
	});
	modal.classList.add("is-open");
	modal.setAttribute("aria-hidden", "false");
}
function closeKitExportDialog() {
	const modal = document.getElementById("kit-export-dialog");
	if (!modal) return;
	modal.classList.remove("is-open");
	modal.setAttribute("aria-hidden", "true");
}
function syncKitExportPeriodMode() {
	const custom = document.getElementById("kit-export-custom-mode").checked;
	document.getElementById("kit-export-month-fields").hidden = custom;
	document.getElementById("kit-export-custom-fields").hidden = !custom;
}
/**
* 提交整組匯出，驗證參數並下載報表
* @returns {Promise<void>}
*/
async function submitKitExport() {
	if (kitExportInFlight) return;
	const button = document.getElementById("kit-export-submit");
	const custom = document.getElementById("kit-export-custom-mode").checked;
	const params = new URLSearchParams();
	if (custom) {
		const start = document.getElementById("kit-export-start").value;
		const end = document.getElementById("kit-export-end").value;
		if (!start || !end || start > end) {
			toast("匯出失敗：日期範圍無效", "error");
			return;
		}
		params.set("start_date", start);
		params.set("end_date", end);
	} else params.set("month", `${document.getElementById("kit-export-year").value}-${document.getElementById("kit-export-month").value}`);
	const sections = [...document.querySelectorAll("#kit-export-content input[data-section]:checked")].map((input) => input.dataset.section);
	if (!sections.length) {
		toast("匯出失敗：至少選擇一種匯出內容", "error");
		return;
	}
	params.set("sections", sections.join(","));
	kitExportInFlight = true;
	if (button) {
		button.disabled = true;
		button.textContent = "產生報表中…";
	}
	try {
		await apiDownload(`/api/kit-export?${params.toString()}`, {
			filename: "整組報表.xlsx",
			fallback: "請稍後再試"
		});
		toast("✅ 整組報表已下載", "success");
		closeKitExportDialog();
	} catch (e) {
		toast("⚠️ 匯出失敗：" + e.message, "error");
	} finally {
		kitExportInFlight = false;
		if (button) {
			button.disabled = false;
			button.textContent = "匯出報表";
		}
	}
}
function initKitsExportDialog() {
	document.getElementById("kit-export-month-mode")?.addEventListener("change", syncKitExportPeriodMode);
	document.getElementById("kit-export-custom-mode")?.addEventListener("change", syncKitExportPeriodMode);
}
//#endregion
//#region static/js/features/stockout/export-dialog.js
var export_dialog_exports = /* @__PURE__ */ __exportAll({
	closeStockoutExportDialog: () => closeStockoutExportDialog,
	initStockoutExportDialog: () => initStockoutExportDialog,
	openStockoutExportDialog: () => openStockoutExportDialog,
	submitStockoutExport: () => submitStockoutExport
});
var stockoutExportInFlight = false;
function exportPadStockout(value) {
	return String(value).padStart(2, "0");
}
/**
* 開啟已領出匯出對話框，重設預設值
* @returns {void}
*/
function openStockoutExportDialog() {
	const modal = document.getElementById("stockout-export-dialog");
	if (!modal) return;
	const now = /* @__PURE__ */ new Date();
	const monthSelect = document.getElementById("stockout-export-month");
	if (!monthSelect.options.length) for (let month = 1; month <= 12; month += 1) {
		const option = document.createElement("option");
		option.value = exportPadStockout(month);
		option.textContent = `${exportPadStockout(month)} 月`;
		monthSelect.appendChild(option);
	}
	document.getElementById("stockout-export-year").value = now.getFullYear();
	monthSelect.value = exportPadStockout(now.getMonth() + 1);
	document.getElementById("stockout-export-start").value = `${now.getFullYear()}-${exportPadStockout(now.getMonth() + 1)}-01`;
	document.getElementById("stockout-export-end").value = `${now.getFullYear()}-${exportPadStockout(now.getMonth() + 1)}-${exportPadStockout(now.getDate())}`;
	document.getElementById("stockout-export-month-mode").checked = true;
	document.getElementById("stockout-export-custom-mode").checked = false;
	syncStockoutExportPeriodMode();
	modal.classList.add("is-open");
	modal.setAttribute("aria-hidden", "false");
}
function closeStockoutExportDialog() {
	const modal = document.getElementById("stockout-export-dialog");
	if (!modal) return;
	modal.classList.remove("is-open");
	modal.setAttribute("aria-hidden", "true");
}
function syncStockoutExportPeriodMode() {
	const custom = document.getElementById("stockout-export-custom-mode").checked;
	document.getElementById("stockout-export-month-fields").hidden = custom;
	document.getElementById("stockout-export-custom-fields").hidden = !custom;
}
/**
* 提交已領出匯出，驗證參數並下載報表
* @returns {Promise<void>}
*/
async function submitStockoutExport() {
	if (stockoutExportInFlight) return;
	const button = document.getElementById("stockout-export-submit");
	const custom = document.getElementById("stockout-export-custom-mode").checked;
	const params = new URLSearchParams();
	if (custom) {
		const start = document.getElementById("stockout-export-start").value;
		const end = document.getElementById("stockout-export-end").value;
		if (!start || !end || start > end) {
			toast("匯出失敗：日期範圍無效", "error");
			return;
		}
		params.set("start_date", start);
		params.set("end_date", end);
	} else params.set("month", `${document.getElementById("stockout-export-year").value}-${document.getElementById("stockout-export-month").value}`);
	params.set("sections", "movements");
	stockoutExportInFlight = true;
	if (button) {
		button.disabled = true;
		button.textContent = "產生報表中…";
	}
	try {
		await apiDownload(`/api/stockout-export?${params.toString()}`, {
			filename: "已領出報表.xlsx",
			fallback: "請稍後再試"
		});
		toast("✅ 已領出報表已下載", "success");
		closeStockoutExportDialog();
	} catch (e) {
		toast("⚠️ 匯出失敗：" + e.message, "error");
	} finally {
		stockoutExportInFlight = false;
		if (button) {
			button.disabled = false;
			button.textContent = "匯出報表";
		}
	}
}
function initStockoutExportDialog() {
	document.getElementById("stockout-export-month-mode")?.addEventListener("change", syncStockoutExportPeriodMode);
	document.getElementById("stockout-export-custom-mode")?.addEventListener("change", syncStockoutExportPeriodMode);
}
//#endregion
//#region static/js/features/petty-cash/engineering-modal.js
var engineering_modal_exports = /* @__PURE__ */ __exportAll({
	engAddCategory: () => engAddCategory,
	engAddDetail: () => engAddDetail,
	engAddReceipt: () => engAddReceipt,
	engCloseModal: () => engCloseModal,
	engDeleteCategory: () => engDeleteCategory,
	engDeleteDetail: () => engDeleteDetail,
	engDeleteGroup: () => engDeleteGroup,
	engDeleteReceipt: () => engDeleteReceipt,
	engFilenamePreview: () => engFilenamePreview,
	engGotoStep: () => engGotoStep,
	engSave: () => engSave,
	engSelectCategory: () => engSelectCategory,
	engSetNameFromSelect: () => engSetNameFromSelect,
	engToggleEditorReceipt: () => engToggleEditorReceipt,
	pcChooseReportType: () => pcChooseReportType,
	pcOpenEngineeringModal: () => pcOpenEngineeringModal
});
var engEditingId = null;
var engData = {};
var engActiveCategory = 0;
var engOptions = {
	category: [],
	group: []
};
function pcChooseReportType() {
	document.getElementById("content").insertAdjacentHTML("beforeend", `<div id="eng-type-overlay" class="pc-overlay is-open"><div class="pc-modal" role="dialog" aria-label="新增零用金月報"><div class="pc-modal__hd"><h3>新增零用金月報</h3><button class="btn btn--secondary btn--sm btn--icon" onclick="document.getElementById('eng-type-overlay').remove()">✕</button></div><div class="pc-modal__bd"><p>請選擇報表類型</p><div class="pc-form-grid pc-form-grid--two"><button class="btn btn--secondary btn--md pc-btn" onclick="document.getElementById('eng-type-overlay').remove();PettyCash.pcOpenReportModal()">一般零用金<br><small>收入／支出月報</small></button><button class="btn btn--primary btn--md pc-btn" onclick="document.getElementById('eng-type-overlay').remove();PettyCash.pcOpenEngineeringModal()">工程零用金<br><small>發票、收據與工程費用</small></button></div></div></div></div>`);
}
async function pcOpenEngineeringModal(id) {
	const modalToken = ++pettyCashState.pcModalOpenSeq;
	pettyCashState.pcModalSessionType = "engineering";
	document.getElementById("pc-report-overlay")?.remove();
	document.getElementById("eng-report-overlay")?.remove();
	engEditingId = id || null;
	engActiveCategory = 0;
	engData = {
		start_date: _pcIso(/* @__PURE__ */ new Date()),
		end_date: _pcIso(/* @__PURE__ */ new Date()),
		upload_person: "",
		prepared_by: "",
		filename_text: "",
		status: "draft",
		categories: []
	};
	try {
		await Promise.all(["category", "group"].map((kind) => apiFetch("/api/petty-cash-options?report_type=engineering&option_type=" + kind).catch((e) => e.status ? { items: [] } : Promise.reject(e)).then((d) => {
			if (_pcIsCurrentModal(modalToken, "engineering")) engOptions[kind] = d.items || [];
		})));
		if (!_pcIsCurrentModal(modalToken, "engineering")) return;
		if (id) {
			let d;
			try {
				d = await apiFetch("/api/petty-cash-reports/" + id);
			} catch (e) {
				if (!e.status) throw e;
				if (_pcIsCurrentModal(modalToken, "engineering")) toast("⚠️ 讀取失敗");
				return;
			}
			if (!_pcIsCurrentModal(modalToken, "engineering")) return;
			engData = JSON.parse(JSON.stringify(d));
		}
		if (_pcIsCurrentModal(modalToken, "engineering")) engRenderModal();
	} catch (e) {
		if (_pcIsCurrentModal(modalToken, "engineering")) toast("⚠️ 工程選單載入失敗");
	}
}
function engRenderModal() {
	const title = engEditingId ? "編輯工程零用金" : "新增工程零用金";
	document.getElementById("content").insertAdjacentHTML("beforeend", `<div id="eng-report-overlay" class="pc-overlay is-open" onclick="if(event.target===this)PettyCash.engCloseModal()"><div class="pc-modal" role="dialog" aria-label="工程零用金"><div class="pc-modal__hd"><h3>${esc(title)}</h3><button class="btn btn--secondary btn--sm btn--icon" onclick="PettyCash.engCloseModal()">✕</button></div><div class="pc-modal__bd"><div class="pc-steps"><button class="chip chip--seg pc-step is-active" id="eng-step-1-tab" onclick="PettyCash.engGotoStep(1)">① 基本資料</button><button class="chip chip--seg pc-step" id="eng-step-2-tab" onclick="PettyCash.engGotoStep(2)">② 分類與明細</button></div><div id="eng-step-1"><div class="pc-form-grid pc-form-grid--two"><div class="pc-field"><label>報表期間（起）<span class="pc-required">*</span></label><input id="eng-start" type="date" value="${esc(engData.start_date || "")}"></div><div class="pc-field"><label>報表期間（迄）<span class="pc-required">*</span></label><input id="eng-end" type="date" value="${esc(engData.end_date || "")}"></div><div class="pc-field"><label>報表歸屬人<span class="pc-required">*</span></label><input id="eng-owner" type="text" value="${esc(engData.upload_person || "")}" oninput="PettyCash.engFilenamePreview()"></div><div class="pc-field"><label>製表人<span class="pc-required">*</span></label><input id="eng-prepared" type="text" value="${esc(engData.prepared_by || "")}"></div><div class="pc-field"><label>檔名備註(選填)</label><input id="eng-note" type="text" value="${esc(engData.filename_text || "")}" oninput="PettyCash.engFilenamePreview()"></div></div><div id="eng-filename" class="pc-filename-preview"></div></div><div id="eng-step-2" style="display:none"><div id="eng-editor" class="eng-editor"></div></div></div><div class="pc-modal__ft"><span id="eng-ops-1"><button class="btn btn--secondary btn--md pc-btn" onclick="PettyCash.engCloseModal()">取消</button><button class="btn btn--primary btn--md pc-btn" onclick="PettyCash.engGotoStep(2)">下一步：填寫明細 →</button></span><span id="eng-ops-2" style="display:none"><button class="btn btn--secondary btn--md pc-btn" onclick="PettyCash.engGotoStep(1)">← 上一步</button><button class="btn btn--secondary btn--md pc-btn" onclick="PettyCash.engCloseModal()">取消</button><button class="btn btn--secondary btn--md pc-btn" onclick="PettyCash.engSave('draft')">儲存草稿</button><button class="btn btn--primary btn--md pc-btn" onclick="PettyCash.engSave('completed')">儲存完成</button></span></div></div></div>`);
	document.getElementById("eng-start").addEventListener("change", engFilenamePreview);
	document.getElementById("eng-end").addEventListener("change", engFilenamePreview);
	engFilenamePreview();
}
function _engFilenamePeriod(start, end) {
	const s = String(start || ""), e = String(end || "");
	const compact = (v) => {
		const p = v.split("-");
		return p.length === 3 ? p.join("") : "";
	};
	if (s === e) {
		const value = compact(s);
		return value ? value.slice(4) : "？";
	}
	const sc = compact(s) || "？", ec = compact(e) || "？";
	if (sc !== "？" && ec !== "？" && s.slice(0, 4) === e.slice(0, 4)) return `${sc.slice(4)}-${ec.slice(4)}`;
	return `${sc}-${ec}`;
}
function engFilenamePreview() {
	const s = document.getElementById("eng-start")?.value, e = document.getElementById("eng-end")?.value, n = document.getElementById("eng-note")?.value.trim() || "", o = document.getElementById("eng-owner")?.value.trim() || "？";
	const period = _engFilenamePeriod(s, e);
	const el = document.getElementById("eng-filename");
	if (el) el.textContent = `預覽檔名：(${period}${n ? " " + n : ""})${o} 工程零用金.xlsx`;
}
function engValidateBasic() {
	const s = document.getElementById("eng-start").value, e = document.getElementById("eng-end").value, o = document.getElementById("eng-owner").value.trim(), p = document.getElementById("eng-prepared").value.trim();
	if (!s || !e || s > e || !o || !p) {
		toast("⚠️ 請完整填寫期間、報表歸屬人與製表人");
		return false;
	}
	return true;
}
function engGotoStep(n) {
	return pcSwitchModalStep(n, {
		validate: engValidateBasic,
		stepIds: ["eng-step-1", "eng-step-2"],
		tabIds: ["eng-step-1-tab", "eng-step-2-tab"],
		opsIds: ["eng-ops-1", "eng-ops-2"],
		onDetail: engRenderEditor
	});
}
function engAddCategory() {
	engData.categories.push({
		name: "",
		groups: [{
			name: "",
			receipts: []
		}]
	});
	engActiveCategory = engData.categories.length - 1;
	engRenderEditor();
}
function engSelectCategory(i) {
	engActiveCategory = i;
	engRenderEditor();
}
function engDeleteDetail(ci, gi, ri, di) {
	engData.categories[ci].groups[gi].receipts[ri].details.splice(di, 1);
	engRenderEditor();
}
var engEditorExpandedReceipts = /* @__PURE__ */ new Set();
function engEditorReceiptKey(ci, gi, ri) {
	return `${ci}:${gi}:${ri}`;
}
function engToggleEditorReceipt(ci, gi, ri) {
	const key = engEditorReceiptKey(ci, gi, ri);
	if (engEditorExpandedReceipts.has(key)) engEditorExpandedReceipts.delete(key);
	else engEditorExpandedReceipts.add(key);
	engRenderEditor();
}
function engAddReceipt(ci, gi) {
	engData.categories[ci].groups[gi].receipts.push({
		tax_id_mark: "",
		receipt_number: "",
		amount: "",
		details: [""]
	});
	engEditorExpandedReceipts.add(engEditorReceiptKey(ci, gi, engData.categories[ci].groups[gi].receipts.length - 1));
	engRenderEditor();
}
function engAddDetail(ci, gi, ri) {
	engData.categories[ci].groups[gi].receipts[ri].details.push("");
	engEditorExpandedReceipts.add(engEditorReceiptKey(ci, gi, ri));
	engRenderEditor();
}
function engDeleteCategory(ci) {
	if (!confirm("確定刪除分類及其底下所有資料？")) return;
	engData.categories.splice(ci, 1);
	engEditorExpandedReceipts.clear();
	engActiveCategory = Math.max(0, Math.min(engActiveCategory, engData.categories.length - 1));
	engRenderEditor();
}
function engDeleteGroup(ci, gi) {
	if (!confirm("確定刪除項目及其底下所有單據？")) return;
	engData.categories[ci].groups.splice(gi, 1);
	engEditorExpandedReceipts.clear();
	engRenderEditor();
}
function engDeleteReceipt(ci, gi, ri) {
	if (!confirm("確定刪除這張單據及細項？")) return;
	engData.categories[ci].groups[gi].receipts.splice(ri, 1);
	engEditorExpandedReceipts.clear();
	engRenderEditor();
}
function engCategoryHtml(ci) {
	const c = engData.categories[ci];
	return `<div class="eng-category-title"><select class="eng-name" data-c="${esc(ci)}" onchange="PettyCash.engSetNameFromSelect(this,'category',${esc(ci)})">${engOptionSelect("category", c.name)}</select><span>分類小計 $${esc(_pcMoney((c.groups || []).reduce((n, g) => n + (g.receipts || []).reduce((m, r) => m + (Number(r.amount) || 0), 0), 0)))}</span><button class="btn btn--danger btn--sm pc-btn-sm--danger" onclick="PettyCash.engDeleteCategory(${esc(ci)})">刪除分類</button></div>${(c.groups || []).map((g, gi) => `<div class="eng-group-block"><div class="eng-group-head"><select class="eng-group" data-c="${esc(ci)}" data-g="${esc(gi)}" onchange="PettyCash.engSetNameFromSelect(this,'group',${esc(ci)},${esc(gi)})">${engOptionSelect("group", g.name)}</select><span>小計 $${esc(_pcMoney((g.receipts || []).reduce((n, r) => n + (Number(r.amount) || 0), 0)))} </span><button class="btn btn--secondary btn--sm" onclick="PettyCash.engAddReceipt(${esc(ci)},${esc(gi)})">＋ 新增單據</button><button class="btn btn--danger btn--sm pc-btn-sm--danger" onclick="PettyCash.engDeleteGroup(${esc(ci)},${esc(gi)})">刪除項目</button></div><div class="eng-receipts">${(g.receipts || []).map((r, ri) => {
		const key = engEditorReceiptKey(ci, gi, ri), expanded = engEditorExpandedReceipts.has(key), details = r.details || [], receiptClass = expanded ? " is-expanded" : "", receiptChevron = expanded ? "▼" : "▶";
		return `<article class="eng-receipt${esc(receiptClass)}"><button type="button" class="eng-editor-receipt-toggle" aria-expanded="${expanded}" onclick="PettyCash.engToggleEditorReceipt(${esc(ci)},${esc(gi)},${esc(ri)})"><span><span class="eng-receipt-chevron">${esc(receiptChevron)}</span><b>單據 ${esc(ri + 1)}</b><span class="eng-editor-receipt-no">${esc(r.receipt_number || "未填寫單據")}</span></span><strong>$${esc(_pcMoney(r.amount || 0))}</strong></button>${expanded ? `<div class="eng-editor-receipt-body"><div class="eng-receipt-grid"><div class="pc-field"><label>統編(選填)</label><input class="eng-tax" data-c="${esc(ci)}" data-g="${esc(gi)}" data-r="${esc(ri)}" value="${esc(r.tax_id_mark || "")}" placeholder="V／實際統編"></div><div class="pc-field"><label>發票號碼／收據(選填)</label><input class="eng-no" data-c="${esc(ci)}" data-g="${esc(gi)}" data-r="${esc(ri)}" value="${esc(r.receipt_number || "")}"></div><div class="pc-field"><label>金額<span class="pc-required">*</span></label><input class="eng-amount" data-c="${esc(ci)}" data-g="${esc(gi)}" data-r="${esc(ri)}" type="number" min="0" step="0.01" value="${esc(r.amount ?? "")}"></div></div>${details.map((d, di) => `<div class="eng-detail-row"><label>細項 ${esc(di + 1)}(選填)</label><input class="eng-detail" data-c="${esc(ci)}" data-g="${esc(gi)}" data-r="${esc(ri)}" data-d="${esc(di)}" value="${esc(d || "")}"><button class="btn btn--danger btn--sm pc-btn-sm--danger" onclick="PettyCash.engDeleteDetail(${esc(ci)},${esc(gi)},${esc(ri)},${esc(di)})">刪除</button></div>`).join("")}<div class="eng-editor-receipt-actions"><button class="btn btn--secondary btn--sm" onclick="PettyCash.engAddDetail(${esc(ci)},${esc(gi)},${esc(ri)})">＋ 新增細項</button><button class="btn btn--danger btn--sm pc-btn-sm--danger" onclick="PettyCash.engDeleteReceipt(${esc(ci)},${esc(gi)},${esc(ri)})">刪除單據</button></div></div>` : ""}</article>`;
	}).join("")}</div></div>`).join("")}</div>`;
}
function engRenderEditor() {
	const box = document.getElementById("eng-editor");
	if (!box) return;
	const cats = engData.categories || [];
	box.innerHTML = `<aside class="eng-category-nav"><strong>分類</strong>${cats.map((c, i) => `<button class="chip chip--seg eng-category-tab${i === engActiveCategory ? " is-active" : ""}" onclick="PettyCash.engSelectCategory(${esc(i)})">${esc(c.name || "未命名分類")}</button>`).join("")}<button class="btn btn--secondary btn--sm" onclick="PettyCash.engAddCategory()">＋ 新增分類</button></aside><section class="eng-detail-pane">${cats.length ? engCategoryHtml(engActiveCategory) : "<div class=\"pc-empty\">尚未建立任何分類<br><button class=\"btn btn--secondary btn--sm\" onclick=\"PettyCash.engAddCategory()\">＋ 新增第一個分類</button></div>"}</section>`;
	box.querySelectorAll("input,select").forEach((x) => x.addEventListener("input", engSyncInput));
}
function engOptionSelect(kind, value) {
	const current = String(value || "");
	const known = engOptions[kind] || [];
	const extra = current && !known.some((o) => o.name === current) ? `<option value="${esc(current)}" selected>${esc(current)}（歷史／自訂）</option>` : "";
	return `<option value="">— 請選擇或輸入自訂名稱 —</option>${known.map((o) => `<option value="${esc(o.name)}"${o.name === current ? " selected" : ""}>${esc(o.name)}</option>`).join("")}${extra}<option value="__custom__">＋ 自訂名稱…</option>`;
}
function engSetNameFromSelect(select, kind, ci, gi) {
	let value = select.value;
	if (value === "__custom__") {
		value = prompt(kind === "category" ? "請輸入自訂分類名稱" : "請輸入自訂項目名稱", "") || "";
		if (!value.trim()) return engRenderEditor();
		value = value.trim();
	}
	if (kind === "category") engData.categories[ci].name = value;
	else engData.categories[ci].groups[gi].name = value;
	engRenderEditor();
}
function engSyncInput(e) {
	const x = e.target, d = engData.categories[+x.dataset.c], g = d?.groups?.[+x.dataset.g], r = g?.receipts?.[+x.dataset.r];
	if (x.classList.contains("eng-name")) d.name = x.value;
	if (x.classList.contains("eng-group")) g.name = x.value;
	if (r) {
		if (x.classList.contains("eng-tax")) r.tax_id_mark = x.value;
		if (x.classList.contains("eng-no")) r.receipt_number = x.value;
		if (x.classList.contains("eng-amount")) r.amount = x.value;
		if (x.classList.contains("eng-detail")) r.details[+x.dataset.d] = x.value;
	}
	engFilenamePreview();
}
function engCloseModal() {
	if (pettyCashState.pcModalSessionType === "engineering") {
		pettyCashState.pcModalOpenSeq += 1;
		pettyCashState.pcModalSessionType = "";
	}
	document.getElementById("eng-report-overlay")?.remove();
}
async function engSave(status) {
	if (pettyCashState.pcSaveInFlight) {
		toast("⚠️ 目前已有儲存作業進行中");
		return;
	}
	if (!engValidateBasic()) return;
	engSyncAll();
	const body = {
		report_type: "engineering",
		start_date: document.getElementById("eng-start").value,
		end_date: document.getElementById("eng-end").value,
		upload_person: document.getElementById("eng-owner").value.trim(),
		prepared_by: document.getElementById("eng-prepared").value.trim(),
		filename_text: document.getElementById("eng-note").value.trim(),
		status,
		categories: engData.categories.map((c, ci) => ({
			...c,
			sort_order: ci,
			groups: (c.groups || []).map((g, gi) => ({
				...g,
				sort_order: gi,
				receipts: (g.receipts || []).map((r, ri) => ({
					...r,
					sort_order: ri,
					amount: Number(r.amount) || 0,
					details: (r.details || []).filter(Boolean)
				}))
			}))
		}))
	};
	const url = engEditingId ? "/api/petty-cash-reports/" + engEditingId : "/api/petty-cash-reports";
	const saveToken = pettyCashState.pcModalOpenSeq;
	pettyCashState.pcSaveInFlight = true;
	pettyCashState.pcSaveInFlightToken = saveToken;
	pcSetSaveButtonsDisabled("eng-report-overlay", true);
	try {
		await apiFetch(url, {
			method: engEditingId ? "PUT" : "POST",
			json: body,
			fallback: "儲存失敗"
		});
		if (saveToken !== pettyCashState.pcModalOpenSeq) return;
		toast(status === "completed" ? "✅ 已儲存完成" : "✅ 草稿已儲存");
		engCloseModal();
		renderPettyCash();
	} catch (e) {
		if (saveToken === pettyCashState.pcModalOpenSeq) toast(e.status ? "⚠️ " + e.message : "⚠️ 網路錯誤：" + e.message);
	} finally {
		if (pettyCashState.pcSaveInFlightToken === saveToken) {
			pettyCashState.pcSaveInFlight = false;
			pettyCashState.pcSaveInFlightToken = 0;
			if (saveToken === pettyCashState.pcModalOpenSeq) pcSetSaveButtonsDisabled("eng-report-overlay", false);
		}
	}
}
function engSyncAll() {
	document.querySelectorAll("#eng-editor input").forEach((x) => engSyncInput({ target: x }));
}
//#endregion
//#region static/js/features/petty-cash/report-modal.js
var report_modal_exports = /* @__PURE__ */ __exportAll({
	pcCloseEntryModal: () => pcCloseEntryModal,
	pcCloseReportModal: () => pcCloseReportModal,
	pcEntryAddItemRow: () => pcEntryAddItemRow,
	pcEntryAmountHint: () => pcEntryAmountHint,
	pcEntryDelete: () => pcEntryDelete,
	pcEntryRemoveItem: () => pcEntryRemoveItem,
	pcEntrySave: () => pcEntrySave,
	pcEntrySetType: () => pcEntrySetType,
	pcFetchPreviousBalance: () => pcFetchPreviousBalance,
	pcGeneralCategoryChanged: () => pcGeneralCategoryChanged,
	pcModalGotoStep: () => pcModalGotoStep,
	pcModalSave: () => pcModalSave,
	pcOpenEntryModal: () => pcOpenEntryModal,
	pcOpenReportModal: () => pcOpenReportModal,
	pcOpeningEdited: () => pcOpeningEdited,
	pcUpdateFilenamePreview: () => pcUpdateFilenamePreview,
	pcUploaderChanged: () => pcUploaderChanged
});
var pcModalEditingId = null;
var pcModalEntries = [];
var pcModalReturnToDetail = false;
var pcOpeningSource = "manual";
var pcEntryEditIndex = -1;
var pcEntryType = "expense";
var pcEntryItemDraft = [];
var pcGeneralOptions = { category: [] };
function pcGeneralCategoryOptions(value) {
	const current = String(value || "");
	const known = pcGeneralOptions.category || [];
	const extra = current && !known.some((o) => o.name === current) ? `<option value="${esc(current)}" selected>${esc(current)}（歷史／自訂）</option>` : "";
	return `<option value="">— 請選擇或輸入自訂科目 —</option>${known.map((o) => `<option value="${esc(o.name)}"${o.name === current ? " selected" : ""}>${esc(o.name)}</option>`).join("")}${extra}<option value="__custom__">＋ 自訂科目…</option>`;
}
function pcGeneralCategoryChanged(select) {
	if (select.value !== "__custom__") return;
	const value = prompt("請輸入自訂科目名稱", "") || "";
	if (!value.trim()) {
		select.selectedIndex = 0;
		return;
	}
	const option = document.createElement("option");
	option.value = value.trim();
	option.textContent = value.trim() + "（自訂）";
	option.selected = true;
	select.insertBefore(option, select.lastElementChild);
}
async function pcOpenReportModal(id) {
	const modalToken = ++pettyCashState.pcModalOpenSeq;
	pettyCashState.pcModalSessionType = "general";
	document.getElementById("pc-report-overlay")?.remove();
	document.getElementById("eng-report-overlay")?.remove();
	pcModalEditingId = id || null;
	pcModalEntries = [];
	pcModalReturnToDetail = !!pettyCashState.pcDetail && pettyCashState.pcDetail.id === id;
	pcOpeningSource = "manual";
	const today = _pcIso(/* @__PURE__ */ new Date());
	let d = {
		start_date: today,
		end_date: today,
		filename_text: "",
		upload_person: "",
		prepared_by: "",
		opening_balance: 0,
		opening_balance_source: "manual",
		status: "draft",
		entries: []
	};
	try {
		const options = await apiFetch("/api/petty-cash-options?report_type=general&option_type=category");
		if (!_pcIsCurrentModal(modalToken, "general")) return;
		pcGeneralOptions.category = options.items || [];
	} catch (e) {}
	if (!_pcIsCurrentModal(modalToken, "general")) return;
	if (id) try {
		d = await apiFetch("/api/petty-cash-reports/" + id);
		if (!_pcIsCurrentModal(modalToken, "general")) return;
	} catch (e) {
		if (_pcIsCurrentModal(modalToken, "general")) toast(e.status ? "⚠️ 讀取失敗" : "⚠️ 網路錯誤：" + e.message);
		return;
	}
	if (!_pcIsCurrentModal(modalToken, "general")) return;
	pcModalEntries = (d.entries || []).map((e, i) => ({
		_key: "e" + Date.now() + "_" + i,
		entry_date: e.entry_date,
		entry_type: e.entry_type,
		description: e.description,
		amount: e.amount,
		category: e.category || "",
		sort_order: e.sort_order || i,
		items: (e.items || []).map((it, j) => ({
			_key: "t" + Date.now() + "_" + i + "_" + j,
			item_name: it.item_name,
			qty: it.qty,
			unit: it.unit || "",
			amount: it.amount || ""
		}))
	}));
	pcOpeningSource = d.opening_balance_source || "manual";
	document.getElementById("content").insertAdjacentHTML("beforeend", `
    <div id="pc-report-overlay" class="pc-overlay is-open" onclick="if(event.target===this)PettyCash.pcCloseReportModal()">
      <div class="pc-modal" role="dialog" aria-label="零用金月報">
        <div class="pc-modal__hd"><h3 id="pc-modal-title">${id ? "✏️ 編輯零用金月報" : "＋ 新增零用金月報"}</h3><button class="btn btn--secondary btn--sm btn--icon" onclick="PettyCash.pcCloseReportModal()">✕</button></div>
        <div class="pc-modal__bd">
          <div class="pc-steps">
            <button type="button" class="chip chip--seg pc-step is-active" id="pc-step-1-tab" onclick="PettyCash.pcModalGotoStep(1)">① 基本資料</button>
            <button type="button" class="chip chip--seg pc-step" id="pc-step-2-tab" onclick="PettyCash.pcModalGotoStep(2)">② 收支明細</button>
          </div>
          <div id="pc-step-1">
            <div class="pc-form-grid pc-form-grid--two">
              <div class="pc-field"><label>報表期間（起）<span class="pc-required">*</span></label><input id="pc-m-start" type="date" value="${esc(d.start_date)}"></div>
              <div class="pc-field"><label>報表期間（迄）<span class="pc-required">*</span></label><input id="pc-m-end" type="date" value="${esc(d.end_date)}"></div>
              <div class="pc-field"><label>檔名文字<span class="pc-required">*</span></label><input id="pc-m-filetext" type="text" placeholder="例：資材" value="${esc(d.filename_text)}" oninput="PettyCash.pcUpdateFilenamePreview()"></div>
              <div class="pc-field"><label>上傳人姓名<span class="pc-required">*</span></label><input id="pc-m-uploader" type="text" list="pc-persons-list" placeholder="例：王小明" value="${esc(d.upload_person)}" oninput="PettyCash.pcUploaderChanged()"></div>
              <div class="pc-field"><label>製表人<span class="pc-required">*</span></label><input id="pc-m-prepared" type="text" maxlength="50" placeholder="預設同上傳人，可修改" value="${esc(d.prepared_by)}"></div>
              <div class="pc-field"><label>上期餘額(選填)</label><input id="pc-m-opening" type="number" min="0" step="0.01" value="${esc(d.opening_balance)}" oninput="PettyCash.pcOpeningEdited()"></div>
            </div>
            <datalist id="pc-persons-list">${pcPersons.map((p) => `<option value="${esc(p)}">`).join("")}</datalist>
            <div class="pc-filename-preview" id="pc-filename-preview"></div>
            <div class="pc-balance-hint" id="pc-opening-hint"></div>
            <div class="pc-inline-actions u-mt-10">
              <button class="btn btn--secondary btn--sm" onclick="PettyCash.pcFetchPreviousBalance()">🔍 帶入上一期餘額</button>
            </div>
          </div>
          <div id="pc-step-2" style="display:none">
            <div class="pc-inline-actions pc-inline-actions--head">
              <button class="btn btn--primary btn--sm" onclick="PettyCash.pcOpenEntryModal()">＋ 新增紀錄</button>
            </div>
            <div id="pc-modal-entries"></div>
            <div class="pc-summary-bar">
              <span>收入 <strong class="pc-kpi-income" id="pc-sum-income">$0</strong></span>
              <span>支出 <strong class="pc-kpi-expense" id="pc-sum-expense">$0</strong></span>
              <span>餘額 <strong class="pc-kpi-balance" id="pc-sum-closing">$0</strong></span>
            </div>
          </div>
        </div>
        <div class="pc-modal__ft">
          <span id="pc-modal-step-ops-1">
            <button class="btn btn--secondary btn--md pc-btn" onclick="PettyCash.pcCloseReportModal()">取消</button>
            <button class="btn btn--primary btn--md pc-btn" onclick="PettyCash.pcModalGotoStep(2)">下一步：填寫明細 →</button>
          </span>
          <span id="pc-modal-step-ops-2" style="display:none">
            <button class="btn btn--secondary btn--md pc-btn" onclick="PettyCash.pcModalGotoStep(1)">← 上一步</button>
            <button class="btn btn--secondary btn--md pc-btn" onclick="PettyCash.pcCloseReportModal()">取消</button>
            <button class="btn btn--secondary btn--md pc-btn" onclick="PettyCash.pcModalSave('draft')">儲存草稿</button>
            <button class="btn btn--primary btn--md pc-btn" onclick="PettyCash.pcModalSave('completed')">儲存完成</button>
          </span>
        </div>
      </div>
    </div>`);
	document.getElementById("pc-m-start").addEventListener("change", pcUpdateFilenamePreview);
	document.getElementById("pc-m-end").addEventListener("change", pcUpdateFilenamePreview);
	pcUpdateFilenamePreview();
	pcUpdateOpeningHint();
	pcModalRenderEntries();
}
function pcUploaderChanged() {
	const u = document.getElementById("pc-m-uploader").value.trim();
	const p = document.getElementById("pc-m-prepared");
	if (p && !p.value.trim() && u) p.value = u;
}
function pcUpdateFilenamePreview() {
	const ft = (document.getElementById("pc-m-filetext").value || "").trim() || "？";
	const s = document.getElementById("pc-m-start").value;
	const e = document.getElementById("pc-m-end").value;
	document.getElementById("pc-filename-preview").textContent = `預覽檔名：零用金-${ft}${_pcMD(s) || "？"}~${_pcMD(e) || "？"}.xlsx`;
}
function pcUpdateOpeningHint() {
	const hint = document.getElementById("pc-opening-hint");
	if (!hint) return;
	if (pcOpeningSource === "auto") {
		hint.className = "pc-balance-hint pc-balance-hint--auto";
		hint.textContent = "✓ 已從上一期自動帶入，可手動修改（修改後不再自動覆蓋）。";
	} else {
		hint.className = "pc-balance-hint pc-balance-hint--manual";
		hint.textContent = "⚠ 未找到上一期資料或已手動輸入，請確認上期餘額。";
	}
}
function pcOpeningEdited() {
	pcOpeningSource = "manual";
	pcUpdateOpeningHint();
}
async function pcFetchPreviousBalance() {
	const uploader = document.getElementById("pc-m-uploader").value.trim();
	const start = document.getElementById("pc-m-start").value;
	if (!uploader) return toast("⚠️ 請先填上傳人姓名");
	if (!start) return toast("⚠️ 請先選報表開始日期");
	try {
		const p = new URLSearchParams({
			upload_person: uploader,
			before: start
		});
		const data = await apiFetch("/api/petty-cash-reports/previous-balance?" + p);
		if (!data.found) {
			pcOpeningSource = "manual";
			pcUpdateOpeningHint();
			return toast("⚠️ " + (data.message || "未找到上一期"));
		}
		document.getElementById("pc-m-opening").value = data.opening_balance;
		pcOpeningSource = "auto";
		pcUpdateOpeningHint();
		toast(`✅ 已帶入上一期餘額 $${data.opening_balance}（${data.previous_period}）`);
	} catch (e) {
		toast(e.status ? "⚠️ 查詢失敗" : "⚠️ 網路錯誤：" + e.message);
	}
}
/**
* 切換一般零用金表單步驟；驗證失敗時明確提示欄位原因。
* @param {number} n 目標步驟編號。
* @returns {boolean} 驗證成功並完成切換時為 true。
*/
function pcModalGotoStep(n) {
	return pcSwitchModalStep(n, {
		validate: () => pcValidateBasic(false),
		stepIds: ["pc-step-1", "pc-step-2"],
		tabIds: ["pc-step-1-tab", "pc-step-2-tab"],
		opsIds: ["pc-modal-step-ops-1", "pc-modal-step-ops-2"],
		onDetail: pcModalRenderEntries
	});
}
/**
* 驗證一般零用金報表基本欄位，並在非靜默模式下指出第一個錯誤。
* @param {boolean} quiet 是否只回傳結果而不顯示提示。
* @returns {boolean} 所有必填欄位與長度限制皆通過時為 true。
*/
function pcValidateBasic(quiet) {
	const fail = (m) => {
		if (!quiet) toast("⚠️ " + m);
		return false;
	};
	const s = document.getElementById("pc-m-start").value;
	const e = document.getElementById("pc-m-end").value;
	if (!s || !e) return fail("請選擇報表期間");
	if (s > e) return fail("開始日期不可晚於結束日期");
	if (!document.getElementById("pc-m-filetext").value.trim()) return fail("請填檔名文字");
	if (!document.getElementById("pc-m-uploader").value.trim()) return fail("請填上傳人姓名");
	const preparedBy = document.getElementById("pc-m-prepared").value.trim();
	if (!preparedBy) return fail("請填製表人");
	if (preparedBy.length > 50) return fail("製表人不可超過 50 個字");
	const opening = Number(document.getElementById("pc-m-opening").value);
	if (!isFinite(opening) || opening < 0) return fail("上期餘額需為 ≥0 的數字");
	return true;
}
function pcModalRenderEntries() {
	const box = document.getElementById("pc-modal-entries");
	if (!box) return;
	if (!pcModalEntries.length) {
		box.innerHTML = "<div class=\"pc-empty\"><div>尚未新增收支紀錄</div><div class=\"pc-hint\">按「＋ 新增紀錄」開始記帳</div></div>";
		let income = 0, expense = 0;
		const opening = Number(document.getElementById("pc-m-opening").value) || 0;
		document.getElementById("pc-sum-income").textContent = "$" + _pcMoney(income);
		document.getElementById("pc-sum-expense").textContent = "$" + _pcMoney(expense);
		document.getElementById("pc-sum-closing").textContent = "$" + _pcMoney(opening + income - expense);
		return;
	}
	const sorted = pcModalEntries.map((e, i) => ({
		...e,
		_origIdx: i
	})).sort((a, b) => a.entry_date !== b.entry_date ? a.entry_date < b.entry_date ? -1 : 1 : a._origIdx - b._origIdx);
	const groups = {};
	const groupOrder = [];
	sorted.forEach((e) => {
		if (!groups[e.entry_date]) {
			groups[e.entry_date] = [];
			groupOrder.push(e.entry_date);
		}
		groups[e.entry_date].push(e);
	});
	let html = "";
	groupOrder.forEach((date) => {
		const entries = groups[date];
		const collapsible = entries.length > 1;
		html += "<div class=\"pc-entry-date-group\">";
		html += "<div class=\"pc-entry-date-header" + (collapsible ? " collapsible" : "") + "\"" + (collapsible ? " onclick=\"this.parentElement.classList.toggle('is-collapsed')\"" : "") + ">";
		html += "<span class=\"pc-entry-date-label\">" + esc(_pcDate(date)) + "</span>";
		html += "<span class=\"pc-entry-date-count\">" + entries.length + " 筆</span>";
		if (collapsible) html += "<span class=\"pc-entry-date-toggle\">▼</span>";
		html += "</div>";
		html += "<div class=\"pc-entry-date-body\">";
		entries.forEach((e) => {
			html += pcModalEntryCardHtml(e, e._origIdx);
		});
		html += "</div></div>";
	});
	box.innerHTML = html;
	let income = 0, expense = 0;
	pcModalEntries.forEach((e) => {
		const a = Number(e.amount) || 0;
		if (e.entry_type === "income") income += a;
		else expense += a;
	});
	const opening = Number(document.getElementById("pc-m-opening").value) || 0;
	document.getElementById("pc-sum-income").textContent = "$" + _pcMoney(income);
	document.getElementById("pc-sum-expense").textContent = "$" + _pcMoney(expense);
	document.getElementById("pc-sum-closing").textContent = "$" + _pcMoney(opening + income - expense);
}
/**
* Build one entry summary card and omit currency text when an optional detail amount is unset.
* @param {{entry_type: string, amount: number, items: Array<{item_name: string, qty: number, unit?: string, amount?: number|null}>, category?: string, entry_date: string, description: string}} e - Entry and child item values.
* @param {number} i - Entry index used by the edit handlers.
* @returns {string} Escaped summary-card markup.
*/
function pcModalEntryCardHtml(e, i) {
	const amt = e.entry_type === "income" ? `<span class="pc-entry-card__amt pc-kpi-income">+$${esc(_pcMoney(e.amount))}</span>` : `<span class="pc-entry-card__amt pc-kpi-expense">-$${esc(_pcMoney(e.amount))}</span>`;
	const itemsHtml = e.items && e.items.length ? `<ul class="pc-entry-card__items">${e.items.map((it) => `<li>${esc(it.item_name)} ${esc(Number(it.qty))}${esc(it.unit || "")}${it.amount == null || Number(it.amount) === 0 ? "" : " $" + esc(it.amount)}</li>`).join("")}</ul>` : "";
	return `<div class="pc-entry-card pc-entry-card--clickable" role="button" tabindex="0" onclick="PettyCash.pcOpenEntryModal(${i})" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){PettyCash.pcOpenEntryModal(${i})}">
    <div class="pc-entry-card__top">
      <span class="pc-entry-card__date">${esc(_pcDate(e.entry_date))}</span>
      <span class="pc-entry-card__desc">${esc(e.description)}</span>
      ${amt}
      ${e.category ? `<span class="pc-entry-card__cat">${esc(e.category)}</span>` : ""}
    </div>
    ${itemsHtml}
    <div class="pc-entry-card__ops">
      <button class="btn btn--secondary btn--sm" onclick="event.stopPropagation();PettyCash.pcOpenEntryModal(${i})">✏️ 編輯</button>
      <button class="btn btn--danger btn--sm pc-btn-sm--danger" onclick="event.stopPropagation();PettyCash.pcEntryDelete(${i})">🗑 刪除</button>
    </div>
  </div>`;
}
function pcOpenEntryModal(idx) {
	pcEntryEditIndex = typeof idx === "number" ? idx : -1;
	const src = pcEntryEditIndex >= 0 ? pcModalEntries[pcEntryEditIndex] : {
		entry_date: _pcIso(/* @__PURE__ */ new Date()),
		entry_type: "expense",
		description: "",
		amount: "",
		category: "",
		items: []
	};
	pcEntryType = src.entry_type || "expense";
	pcEntryItemDraft = (src.items || []).map((it, j) => ({
		_key: "x" + Date.now() + "_" + j,
		item_name: it.item_name,
		qty: it.qty,
		unit: it.unit || "",
		amount: it.amount
	}));
	document.getElementById("content").insertAdjacentHTML("beforeend", `
    <div id="pc-entry-overlay" class="pc-overlay is-open" onclick="if(event.target===this)PettyCash.pcCloseEntryModal()">
      <div class="pc-modal pc-modal--entry" role="dialog" aria-label="收支紀錄">
        <div class="pc-modal__hd"><h3>${pcEntryEditIndex >= 0 ? "✏️ 編輯紀錄" : "＋ 新增紀錄"}</h3><button class="btn btn--secondary btn--sm btn--icon" onclick="PettyCash.pcCloseEntryModal()">✕</button></div>
        <div class="pc-modal__bd">
          <div class="pc-steps">
            <button class="chip chip--seg chip--success pc-step pc-step--income${pcEntryType === "income" ? " is-active" : ""}" id="pc-type-income" onclick="PettyCash.pcEntrySetType('income')">💰 收入</button>
            <button class="chip chip--seg chip--danger pc-step pc-step--expense${pcEntryType === "expense" ? " is-active" : ""}" id="pc-type-expense" onclick="PettyCash.pcEntrySetType('expense')">💸 支出</button>
          </div>
          <div class="pc-form-grid pc-form-grid--two">
            <div class="pc-field"><label>日期<span class="pc-required">*</span></label><input id="pc-e-date" type="date" value="${esc(src.entry_date)}"></div>
            <div class="pc-field"><label>科目(選填)</label><select id="pc-e-category" onchange="PettyCash.pcGeneralCategoryChanged(this)">${pcGeneralCategoryOptions(src.category || "")}</select></div>
          </div>
          <div class="pc-field u-mt-10"><label>摘要 <span class="pc-required" id="pc-e-desc-req">*</span></label><input id="pc-e-desc" type="text" placeholder="例：零用金 / 畚箕 ×1" value="${esc(src.description || "")}"></div>
          <div class="pc-field u-mt-10"><label>總金額<span class="pc-required">*</span></label><input id="pc-e-amount" type="number" min="0.01" step="0.01" placeholder="例：1334" value="${esc(src.amount)}" oninput="PettyCash.pcEntryAmountHint()"></div>
          <div id="pc-entry-items-wrap" class="u-mt-10" style="${pcEntryType === "income" ? "display:none" : ""}">
            <div class="pc-entry-items-head">
              <strong>明細項目</strong>
              <button class="btn btn--secondary btn--sm" onclick="PettyCash.pcEntryAddItemRow()">＋ 新增項目</button>
            </div>
            <div class="pc-items-header"><span>項目名稱</span><span>數量</span><span>單位</span><span>金額<span class="pc-required pc-item-amount-required">*</span><span class="pc-item-amount-optional">（選填）</span></span><span>刪除</span></div>
            <div id="pc-entry-items"></div>
            <div class="pc-balance-hint" id="pc-entry-amount-hint"></div>
          </div>
        </div>
        <div class="pc-modal__ft">
          <button class="btn btn--secondary btn--md pc-btn" onclick="PettyCash.pcCloseEntryModal()">取消</button>
          <button class="btn btn--primary btn--md pc-btn" onclick="PettyCash.pcEntrySave()">確定</button>
        </div>
      </div>
    </div>`);
	pcEntryRenderItems();
	pcEntryAmountHint();
	pcUpdateDescRequired();
}
function pcEntrySetType(t) {
	pcEntryType = t;
	document.getElementById("pc-type-income").classList.toggle("is-active", t === "income");
	document.getElementById("pc-type-expense").classList.toggle("is-active", t === "expense");
	document.getElementById("pc-entry-items-wrap").style.display = t === "income" ? "none" : "";
	if (t === "income") pcEntryItemDraft = [];
	pcEntryAmountHint();
	pcUpdateDescRequired();
}
function pcEntryRenderItems() {
	const box = document.getElementById("pc-entry-items");
	box.innerHTML = pcEntryItemDraft.map((it, i) => `
    <div class="pc-item-row">
      <input data-k="item_name" data-i="${i}" placeholder="品項名稱" value="${esc(it.item_name || "")}">
      <input data-k="qty" data-i="${i}" type="number" min="0.01" step="0.01" placeholder="數量" value="${esc(it.qty ?? "")}">
      <input data-k="unit" data-i="${i}" placeholder="單位" value="${esc(it.unit || "")}">
      <input data-k="amount" data-i="${i}" type="number" min="0.01" step="0.01" placeholder="金額" value="${esc(it.amount ?? "")}">
      <button class="btn btn--danger btn--sm btn--icon pc-btn-sm--danger" onclick="PettyCash.pcEntryRemoveItem(${i})">✕</button>
    </div>`).join("");
	box.querySelectorAll("input").forEach((inp) => inp.addEventListener("input", () => {
		const row = pcEntryItemDraft[Number(inp.dataset.i)];
		if (row) row[inp.dataset.k] = inp.value;
		pcEntryAmountHint();
	}));
	pcEntryAmountHint();
	pcUpdateDescRequired();
}
function pcEntryAddItemRow() {
	pcEntryItemDraft.push({
		_key: "x" + Date.now(),
		item_name: "",
		qty: "",
		unit: "",
		amount: ""
	});
	pcEntryRenderItems();
}
function pcEntryRemoveItem(i) {
	pcEntryItemDraft.splice(i, 1);
	pcEntryRenderItems();
}
function pcUpdateDescRequired() {
	const req = document.getElementById("pc-e-desc-req");
	if (!req) return;
	const hasItems = pcEntryType === "expense" && pcEntryItemDraft.length > 0;
	req.style.display = hasItems ? "none" : "";
}
/**
* 只有所有明細金額皆填妥時才顯示合計與差額；部分填寫不作比較。
* @returns {void} 更新提示文字。
*/
function pcEntryAmountHint() {
	const hint = document.getElementById("pc-entry-amount-hint");
	if (!hint) return;
	if (pcEntryType !== "expense" || !pcEntryItemDraft.length) {
		hint.textContent = "";
		return;
	}
	if (!pcEntryItemDraft.every((it) => Number(it.amount) > 0)) {
		hint.className = "pc-balance-hint";
		hint.textContent = "";
		return;
	}
	const total = pcEntryItemDraft.reduce((s, it) => s + (Number(it.amount) || 0), 0);
	const amt = Number(document.getElementById("pc-e-amount").value) || 0;
	hint.className = "pc-balance-hint " + (Math.abs(total - amt) > .005 ? "pc-balance-hint--manual" : "pc-balance-hint--auto");
	hint.textContent = Math.abs(total - amt) > .005 ? `⚠️ 明細合計 $${_pcMoney(total)} 與支出總額 $${_pcMoney(amt)} 不一致，請確認。` : `✓ 明細合計 $${_pcMoney(total)} 與支出總額一致。`;
}
/**
* 驗證並儲存收支草稿；細項金額在所有裝置皆可留空，空值傳為 null。
* @returns {void} 驗證失敗時顯示提示，成功時更新暫存紀錄。
*/
function pcEntrySave() {
	const date = document.getElementById("pc-e-date").value;
	const desc = document.getElementById("pc-e-desc").value.trim();
	const amount = Number(document.getElementById("pc-e-amount").value);
	const category = document.getElementById("pc-e-category").value.trim();
	if (!date) return toast("⚠️ 請選日期");
	const ps = document.getElementById("pc-m-start").value;
	const pe = document.getElementById("pc-m-end").value;
	if (ps && date < ps || pe && date > pe) return toast("⚠️ 收支日期必須落在報表期間內");
	const hasItems = pcEntryType === "expense" && pcEntryItemDraft.length > 0;
	if (!desc && !hasItems) return toast("⚠️ 請填摘要（或新增明細項目以取代摘要）");
	if (!isFinite(amount) || amount <= 0) return toast("⚠️ 金額需 > 0");
	let items = [];
	if (pcEntryType === "expense") for (const it of pcEntryItemDraft) {
		const nm = (it.item_name || "").trim();
		const q = Number(it.qty);
		const rawAmount = it.amount;
		const a = rawAmount === "" || rawAmount == null ? null : Number(rawAmount);
		if (!nm) return toast("⚠️ 明細品項名稱不可空白");
		if (!isFinite(q) || q <= 0) return toast("⚠️ 明細數量需 > 0");
		if (a !== null && (!isFinite(a) || a <= 0)) return toast("⚠️ 明細金額需 > 0，或留空");
		items.push({
			_key: it._key,
			item_name: nm,
			qty: q,
			unit: (it.unit || "").trim(),
			amount: a
		});
	}
	const rec = {
		_key: pcEntryEditIndex >= 0 ? pcModalEntries[pcEntryEditIndex]._key : "e" + Date.now(),
		entry_date: date,
		entry_type: pcEntryType,
		description: desc,
		amount,
		category,
		sort_order: pcEntryEditIndex >= 0 ? pcModalEntries[pcEntryEditIndex].sort_order : pcModalEntries.length,
		items
	};
	if (pcEntryEditIndex >= 0) pcModalEntries[pcEntryEditIndex] = rec;
	else pcModalEntries.push(rec);
	pcCloseEntryModal();
	pcModalRenderEntries();
}
function pcEntryDelete(i) {
	if (!confirm("確定刪除這筆收支紀錄？")) return;
	pcModalEntries.splice(i, 1);
	pcModalRenderEntries();
}
function pcCloseEntryModal() {
	document.getElementById("pc-entry-overlay")?.remove();
}
/**
* 儲存一般零用金報表時明確送出類型，並將空白選填明細金額轉為 null。
* @param {string} status 報表狀態（草稿或完成）。
* @returns {Promise<void>} 儲存流程完成後解析。
*/
async function pcModalSave(status) {
	if (pettyCashState.pcSaveInFlight) {
		toast("⚠️ 目前已有儲存作業進行中");
		return;
	}
	if (!pcValidateBasic(false)) {
		pcModalGotoStep(1);
		return;
	}
	const saveToken = pettyCashState.pcModalOpenSeq;
	const editingId = pcModalEditingId;
	const body = {
		report_type: "general",
		start_date: document.getElementById("pc-m-start").value,
		end_date: document.getElementById("pc-m-end").value,
		filename_text: document.getElementById("pc-m-filetext").value.trim(),
		upload_person: document.getElementById("pc-m-uploader").value.trim(),
		prepared_by: document.getElementById("pc-m-prepared").value.trim(),
		opening_balance: Number(document.getElementById("pc-m-opening").value) || 0,
		opening_balance_source: pcOpeningSource,
		status,
		entries: pcModalEntries.map((e, i) => ({
			entry_date: e.entry_date,
			entry_type: e.entry_type,
			description: e.description,
			amount: e.amount,
			category: e.category || "",
			sort_order: i,
			items: (e.items || []).map((it, j) => ({
				item_name: it.item_name,
				qty: it.qty,
				unit: it.unit || "",
				amount: it.amount === "" || it.amount == null ? null : it.amount,
				sort_order: j
			}))
		}))
	};
	const url = editingId ? "/api/petty-cash-reports/" + editingId : "/api/petty-cash-reports";
	pettyCashState.pcSaveInFlight = true;
	pettyCashState.pcSaveInFlightToken = saveToken;
	pcSetSaveButtonsDisabled("pc-report-overlay", true);
	try {
		const data = await apiFetch(url, {
			method: editingId ? "PUT" : "POST",
			json: body,
			fallback: "儲存失敗"
		}) || {};
		if (saveToken !== pettyCashState.pcModalOpenSeq) return;
		toast(status === "completed" ? "✅ 已儲存完成" : "✅ 草稿已儲存");
		const savedId = data.id || editingId;
		pcCloseReportModal();
		if (pcModalReturnToDetail && savedId) pcOpenDetail(savedId);
		else {
			pettyCashState.pcDetail = null;
			renderPettyCash();
		}
	} catch (e) {
		if (saveToken === pettyCashState.pcModalOpenSeq) toast(e.status ? "⚠️ " + e.message : "⚠️ 網路錯誤：" + e.message);
	} finally {
		if (pettyCashState.pcSaveInFlightToken === saveToken) {
			pettyCashState.pcSaveInFlight = false;
			pettyCashState.pcSaveInFlightToken = 0;
			if (saveToken === pettyCashState.pcModalOpenSeq) pcSetSaveButtonsDisabled("pc-report-overlay", false);
		}
	}
}
function pcCloseReportModal() {
	if (pettyCashState.pcModalSessionType === "general") {
		pettyCashState.pcModalOpenSeq += 1;
		pettyCashState.pcModalSessionType = "";
	}
	document.getElementById("pc-report-overlay")?.remove();
}
//#endregion
//#region static/js/features/work-progress/upload.js
var upload_exports = /* @__PURE__ */ __exportAll({ wprSubmit: () => wprSubmit });
/**
* Build an immutable snapshot for the save confirmation modal.
* @returns {Object|null} Snapshot containing file references but not copied file bytes.
*/
function wprBuildSubmitSnapshot() {
	var uploader = document.getElementById("wpr-uploader");
	var note = document.getElementById("wpr-note");
	var appointment = workProgressState.wprCurrentReport && workProgressState.wprCurrentReport.appointment;
	if (!uploader || !note || !workProgressState.wprCurrentReport || !appointment) return null;
	return {
		appointmentId: workProgressState.wprCurrentReport.appointment_id,
		uploaderName: uploader.value.trim(),
		note: note.value.trim(),
		files: workProgressState.wprSelectedFiles.slice(),
		date: document.getElementById("wpr-date").value,
		time: wprTimeText(appointment),
		clientName: appointment.client_name || "—",
		serviceName: appointment.service_name || "未指定服務"
	};
}
/**
* Open a Work Progress-scoped final save confirmation dialog.
* @param {Object} snapshot - Immutable content to display and submit.
* @returns {void} Function result.
*/
function wprOpenSubmitConfirmation(snapshot) {
	workProgressState.wprPendingSubmit = snapshot;
	var old = document.getElementById("wpr-confirm-overlay");
	if (old) old.remove();
	var overlay = document.createElement("div");
	overlay.className = "wpr-confirm-overlay";
	overlay.id = "wpr-confirm-overlay";
	overlay.innerHTML = "<div class=\"wpr-confirm-dialog\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"wpr-confirm-title\"><div class=\"wpr-confirm-header\"><h3 id=\"wpr-confirm-title\">確認儲存工作進度？</h3><button type=\"button\" class=\"wpr-confirm-close\" data-wpr-confirm-cancel aria-label=\"返回修改\">✕</button></div><div class=\"wpr-confirm-body\"><p>請確認以下工作進度內容無誤。</p><dl><dt>行事曆工作</dt><dd>" + esc(snapshot.date) + " " + snapshot.time + "<br>" + esc(snapshot.clientName) + " · " + esc(snapshot.serviceName) + "</dd><dt>回報人</dt><dd>" + esc(snapshot.uploaderName) + "</dd>" + (snapshot.note ? "<dt>工作進度</dt><dd>" + esc(snapshot.note) + "</dd>" : "") + "<dt>待上傳照片</dt><dd>" + snapshot.files.length + " 張</dd></dl></div><div class=\"wpr-confirm-footer\"><button type=\"button\" class=\"btn btn--secondary btn--md\" data-wpr-confirm-cancel>返回修改</button><button type=\"button\" class=\"btn btn--primary btn--md\" data-wpr-confirm-submit>確認儲存</button></div></div>";
	document.body.appendChild(overlay);
	overlay.querySelectorAll("[data-wpr-confirm-cancel]").forEach(function(button) {
		button.addEventListener("click", wprCloseSubmitConfirmation);
	});
	overlay.querySelector("[data-wpr-confirm-submit]").addEventListener("click", wprConfirmSubmit);
}
/**
* Submit the exact snapshot after the user confirms the save dialog.
* @returns {Promise<void>} Completion promise.
*/
async function wprConfirmSubmit() {
	var snapshot = workProgressState.wprPendingSubmit;
	var button = document.querySelector("[data-wpr-confirm-submit]");
	if (!snapshot || !button) return;
	button.disabled = true;
	button.textContent = "儲存中…";
	var form = new FormData();
	form.append("appointment_id", snapshot.appointmentId);
	form.append("uploader_name", snapshot.uploaderName);
	form.append("note", snapshot.note);
	snapshot.files.forEach(function(item) {
		form.append("files", item.file, item.file.name);
	});
	try {
		await wprUploadWithProgress("/api/work-progress", form, function(phase, percent) {
			button.textContent = wprUploadProgressText(phase, percent);
		});
		wprCloseSubmitConfirmation();
		wprClearPendingFiles();
		workProgressState.wprCurrentReport = null;
		wprRenderCreate();
		await Promise.all([
			wprLoadDay(),
			wprLoadHistory(1),
			wprLoadKpi()
		]);
		toast("工作進度已儲存", "success");
	} catch (error) {
		button.disabled = false;
		button.textContent = "確認儲存";
		toast(error.message, "error");
	}
}
/**
* Validate the draft and open confirmation instead of posting immediately.
* @returns {void} Function result.
*/
async function wprSubmit() {
	if (!wprCanCreate()) {
		toast("沒有新增工作進度回報的權限", "error");
		return;
	}
	if (workProgressState.wprPendingSubmit || !workProgressState.wprCurrentReport || !workProgressState.wprCurrentReport.appointment_id || workProgressState.wprReportsByAppointment[workProgressState.wprCurrentReport.appointment_id]) return;
	var uploader = document.getElementById("wpr-uploader");
	var uploaderName = uploader ? uploader.value.trim() : "";
	var note = document.getElementById("wpr-note");
	if (!uploaderName) {
		toast("請填寫回報人顯示名稱", "error");
		return;
	}
	if (uploaderName.length > 50) {
		toast("回報人顯示名稱最多 50 字", "error");
		return;
	}
	if (note && note.value.length > 1e3) {
		toast("工作進度最多 1000 字", "error");
		return;
	}
	var snapshot = wprBuildSubmitSnapshot();
	if (snapshot) wprOpenSubmitConfirmation(snapshot);
}
//#endregion
//#region static/js/pages/main.js
window.Account = {
	ackPasswordExpiry,
	cpwCheckMatch,
	cpwCheckStrength,
	expiryGoChangePw,
	openChangePwModal,
	submitChangePw
};
window.App = {
	clearSearchAutofill,
	closeSidebar,
	switchSite,
	switchTab,
	toggleAvatarMenu,
	toggleSidebar
};
window.Auth = { logout };
window.Calendar = {
	calAddSvc,
	calChangeMonth,
	calClearSearch,
	calDelSvc,
	calDeleteAppt,
	calExport,
	calJumpToDate,
	calOpenAppt,
	calPickDate,
	calPickToday,
	calRetryLoad,
	calRetryMySync,
	calRetryTeamMember,
	calRetryTeamSync,
	calSearch,
	calSetColor,
	calSetTab,
	calShiftDay,
	calShowSyncError,
	calShowTeamSyncDetails,
	calSubmitAppt,
	calUpdSvc,
	calUpdSvcActive,
	closeCalModal
};
window.Components = {
	setSharedStatusListLocation,
	setSharedStatusListSearch
};
window.Core = {
	filterUnitSelect,
	openUnitQuickAdd
};
window.Data = { changeInventoryPage };
window.Inventory = {
	_previewKitPhoto,
	addAddStockRow,
	addEditStockRow,
	cancelBatch,
	cancelStockLocationPicker,
	changeQty,
	clearFilterPanel,
	closeBatchConfirm,
	closeInventoryActionMenus,
	closeInventoryExportDialog,
	closeInventoryStatusModal,
	closeMoreActions,
	closePhotoLightbox,
	closeTransferModal,
	deleteEditStockRow,
	deleteItem,
	deleteItemPhoto,
	deleteKitPhoto,
	goEditSimilar,
	openAddModal,
	openEditModal,
	openInventoryActionMenu,
	openInventoryExportDialog,
	openItemSheet,
	openPhotoLightbox,
	openTransferModal,
	qtydQuick,
	queueStockLocationAdjustment,
	quickSet,
	removeAddStockRow,
	saveAll,
	selectAllStocks,
	setInventoryView,
	setQtyDialogMode,
	showBatchConfirm,
	showInventoryStatusList,
	submitAdd,
	submitBatchLocation,
	submitEdit,
	submitInventoryExport,
	submitQtyDialog,
	submitTransfer,
	syncInventoryExportAllSites,
	toggleBatchMode,
	toggleFilterCollapse,
	toggleInventoryBrand,
	toggleInventoryCategory,
	toggleInventoryExportSites,
	toggleLoc,
	toggleMoreActions,
	toggleStockSelect,
	uploadItemPhoto
};
window.Kits = {
	addKitCompRow,
	addKitLocationRow,
	assembleKit,
	closeKitExportDialog,
	deleteKit,
	disassembleKit,
	editKit,
	filterKitSearch,
	kitCompQtyChanged,
	openKitExportDialog,
	openKitModal,
	openKitSearch,
	openKitSheet,
	pickKitItem,
	removeKitCompRow,
	removeKitLocationRow,
	renderKits,
	showKitStatusList,
	submitKit,
	submitKitEdit,
	submitKitExport
};
window.Notifications = {
	closeNotif,
	toggleNotif
};
window.PettyCash = {
	engAddCategory,
	engAddDetail,
	engAddReceipt,
	engCloseModal,
	engDeleteCategory,
	engDeleteDetail,
	engDeleteGroup,
	engDeleteReceipt,
	engFilenamePreview,
	engGotoStep,
	engSave,
	engSelectCategory,
	engSetNameFromSelect,
	engToggle,
	engToggleEditorReceipt,
	pcChangePage,
	pcChooseReportType,
	pcCloseEntryModal,
	pcCloseMoreMenuFromAction,
	pcCloseReportModal,
	pcDelete,
	pcEntryAddItemRow,
	pcEntryAmountHint,
	pcEntryDelete,
	pcEntryRemoveItem,
	pcEntrySave,
	pcEntrySetType,
	pcExport,
	pcFetchPreviousBalance,
	pcGeneralCategoryChanged,
	pcLoadHistory,
	pcModalGotoStep,
	pcModalSave,
	pcOpenDetail,
	pcOpenEngineeringModal,
	pcOpenEntryModal,
	pcOpenReportModal,
	pcOpeningEdited,
	pcQuickRange,
	pcResetFilter,
	pcUpdateFilenamePreview,
	pcUploaderChanged,
	renderPettyCash
};
window.Prepared = {
	clearPrepared,
	openPreparedSheet,
	renderPrepared,
	toggleKitSubItems
};
window.Quotation = {
	quoteAddItem,
	quoteCloseInventory,
	quoteDelete,
	quoteDownload,
	quoteEdit,
	quoteLoadHistory,
	quoteOpenInventory,
	quoteReset,
	quoteSave,
	quoteSearchInventory,
	quoteSwitchMode,
	quoteUseInventory
};
window.Stockout = {
	clearStockoutFilters,
	closeStockoutExportDialog,
	deleteStockoutRecord,
	deleteStockoutReturn,
	openEditStockoutModal,
	openEditStockoutReturnModal,
	openKitPrepareModal,
	openNonStockOutModal,
	openNonStockPrepareModal,
	openOutModal,
	openPrepareModal,
	openPreparedEditModal,
	openPreparedOutModal,
	openStockoutExportDialog,
	openStockoutSheet,
	renderStockOuts,
	returnPrepared,
	returnStockout,
	setStockoutFilter,
	submitEditStockout,
	submitNonStockOut,
	submitNonStockPrepare,
	submitPrepare,
	submitPreparedEdit,
	submitPreparedOut,
	submitReturnStockout,
	submitStockOut,
	submitStockoutExport
};
window.Stocktake = {
	calcDiff,
	markChanged,
	renderStocktake,
	setStocktakeValue,
	showStocktakeList,
	submitStocktake,
	switchStocktakeTab
};
window.UI = { closeModal };
window.WorkProgress = {
	wprAddExistingPhotos,
	wprAddPendingFiles,
	wprBatchDeletePhotos,
	wprClearPhotoSelection,
	wprCloseGallery,
	wprCloseLeaveConfirmation,
	wprClosePendingGallery,
	wprDeleteReport,
	wprDiscardAndLeave,
	wprEditReport,
	wprGalleryMove,
	wprHandleDateChange,
	wprHistoryToggled,
	wprLoadHistory,
	wprOpenGallery,
	wprOpenHistoryDetail,
	wprOpenPendingGallery,
	wprPendingGalleryMove,
	wprQuickRange,
	wprRemovePending,
	wprResetFilter,
	wprSelectAllPhotoSelection,
	wprSelectJob,
	wprSubmit,
	wprTogglePhotoManage,
	wprTogglePhotoSelection,
	wprUpdateNoteCount
};
window.SignedReports = SignedReports;
window.QuotationUploads = QuotationUploads;
window.__hvac = Object.freeze({
	"components/card.js": card_exports,
	"components/status-list.js": status_list_exports,
	"core/api-client.js": api_client_exports,
	"core/bottomsheet.js": bottomsheet_exports,
	"core/data.js": data_exports,
	"core/qty.js": qty_exports,
	"core/search.js": search_exports$1,
	"core/session.js": session_exports,
	"core/site-label.js": site_label_exports,
	"core/state.js": state_exports$7,
	"core/units.js": units_exports,
	"core/utils.js": utils_exports,
	"features/account/change-password.js": change_password_exports,
	"features/account/password-expiry.js": password_expiry_exports,
	"features/calendar/appt-modal.js": appt_modal_exports,
	"features/calendar/format.js": format_exports$1,
	"features/calendar/page.js": page_exports$3,
	"features/calendar/search.js": search_exports,
	"features/calendar/settings-modal.js": settings_modal_exports,
	"features/calendar/state.js": state_exports$3,
	"features/calendar/sync-status.js": sync_status_exports,
	"features/calendar/view.js": view_exports,
	"features/inventory/actions.js": actions_exports,
	"features/inventory/add-modal.js": add_modal_exports,
	"features/inventory/adjust.js": adjust_exports,
	"features/inventory/batch-location.js": batch_location_exports,
	"features/inventory/edit-modal.js": edit_modal_exports,
	"features/inventory/export-dialog.js": export_dialog_exports$2,
	"features/inventory/filters.js": filters_exports,
	"features/inventory/list.js": list_exports,
	"features/inventory/location-adjustments.js": location_adjustments_exports,
	"features/inventory/photo.js": photo_exports,
	"features/inventory/qty-dialog.js": qty_dialog_exports,
	"features/inventory/state.js": state_exports$5,
	"features/inventory/status.js": status_exports$1,
	"features/inventory/transfer-modal.js": transfer_modal_exports,
	"features/kits/component-rows.js": component_rows_exports,
	"features/kits/export-dialog.js": export_dialog_exports$1,
	"features/kits/kit-modal.js": kit_modal_exports,
	"features/kits/page.js": page_exports$6,
	"features/kits/state.js": state_exports$6,
	"features/kits/status.js": status_exports,
	"features/notifications/center.js": center_exports,
	"features/petty-cash/engineering-modal.js": engineering_modal_exports,
	"features/petty-cash/page.js": page_exports$2,
	"features/petty-cash/report-modal.js": report_modal_exports,
	"features/petty-cash/state.js": state_exports$1,
	"features/prepared/page.js": page_exports$5,
	"features/prepared/sheet.js": sheet_exports$1,
	"features/quotation/mode-tabs.js": mode_tabs_exports,
	"features/quotation/page.js": page_exports$1,
	"features/shell/app.js": app_exports,
	"features/shell/data-refresh.js": data_refresh_exports,
	"features/shell/navigation.js": navigation_exports,
	"features/shell/page-scope.js": page_scope_exports,
	"features/stockout/export-dialog.js": export_dialog_exports,
	"features/stockout/modals.js": modals_exports,
	"features/stockout/page.js": page_exports$4,
	"features/stockout/sheet.js": sheet_exports,
	"features/stockout/state.js": state_exports$2,
	"features/stocktake/page.js": page_exports$7,
	"features/stocktake/state.js": state_exports$4,
	"features/upload-list/quotation-upload.js": quotation_upload_exports,
	"features/upload-list/signed-reports.js": signed_reports_exports,
	"features/upload-list/upload-list.js": upload_list_exports,
	"features/work-progress/day.js": day_exports,
	"features/work-progress/detail.js": detail_exports,
	"features/work-progress/draft.js": draft_exports,
	"features/work-progress/format.js": format_exports,
	"features/work-progress/gallery.js": gallery_exports,
	"features/work-progress/history.js": history_exports,
	"features/work-progress/page.js": page_exports,
	"features/work-progress/pending-photos.js": pending_photos_exports,
	"features/work-progress/photo-upload.js": photo_upload_exports,
	"features/work-progress/state.js": state_exports,
	"features/work-progress/upload.js": upload_exports
});
configureShell();
setUnauthorizedHandler(handleUnauthorized);
initUtils();
initInventoryExportDialog();
initKitsExportDialog();
initStockoutExportDialog();
initInventoryActions();
initInventoryFilters();
initKitsPage();
initWorkProgressGallery();
initQuotationPage();
initInventoryPhoto();
initBottomsheet(() => switchTab(appState.currentTab));
initNotifications();
initShellApp();
//#endregion
