import { F as state_exports, I as __exportAll, M as appState, S as logout, _ as canAccessPage, c as esc, f as openModal, g as utils_exports, i as absNum, l as hasPerm, m as toast, n as apiFetch, r as api_client_exports, s as closeModalForce, u as initUtils, v as checkAuth, w as session_exports, x as initSession } from "./api-client-C08BjMsR.js";
import { f as loadUnits, h as units_exports$1, i as cpwResetChecks, l as qty_exports, m as unitList, n as cpwCheckMatch, o as submitChangePw, r as cpwCheckStrength, s as Qty, t as change_password_exports } from "./change-password-BjZb_heP.js";
//#region static/js/features/settings/cabinets.js
var cabinets_exports = /* @__PURE__ */ __exportAll({
	addCabinet: () => addCabinet,
	deleteCabinet: () => deleteCabinet,
	editCabinet: () => editCabinet,
	initCabinetsTab: () => initCabinetsTab,
	loadCabinets: () => loadCabinets,
	submitCabinetEdit: () => submitCabinetEdit
});
var cabinetList = [];
async function loadCabinets() {
	try {
		cabinetList = await apiFetch("/api/cabinets", { fallback: "查詢櫃子清單失敗" });
		renderCabinetTable();
	} catch (e) {
		toast("⚠️ " + e.message, "error");
	}
}
function renderCabinetTable() {
	const tbody = document.getElementById("cabinetList");
	if (!tbody) return;
	if (!cabinetList.length) {
		tbody.innerHTML = "<tr><td colspan=\"3\" class=\"cabinet-empty\">尚未新增任何櫃子</td></tr>";
		return;
	}
	tbody.innerHTML = cabinetList.map((c) => `
    <tr>
      <td><strong>${esc(c.name)}</strong></td>
      <td>${esc(c.note || "（無備註）")}</td>
      <td class="cabinet-actions">
        <button class="btn btn--secondary btn--sm btn-save u-shrink-0" onclick="Settings.editCabinet(${c.id})">✎ 編輯</button>
        <button class="btn btn--danger btn--sm btn-cancel-ghost u-shrink-0" onclick="Settings.deleteCabinet(${c.id})">🗑 刪除</button>
      </td>
    </tr>
  `).join("");
}
async function addCabinet() {
	const name = document.getElementById("cabinet-name").value.trim();
	const note = document.getElementById("cabinet-note").value.trim();
	if (!name) {
		toast("請輸入櫃子編號或名稱", "error");
		return;
	}
	try {
		const data = await apiFetch("/api/cabinets", {
			method: "POST",
			json: {
				name,
				note
			},
			fallback: "新增失敗"
		});
		cabinetList.push(data);
		renderCabinetTable();
		document.getElementById("cabinet-name").value = "";
		document.getElementById("cabinet-note").value = "";
		toast("✅ 已新增櫃子「" + name + "」", "success");
	} catch (e) {
		toast("⚠️ " + e.message, "error");
	}
}
async function deleteCabinet(cabinetId) {
	const cab = cabinetList.find((c) => c.id === cabinetId);
	if (!cab || !confirm("確定刪除櫃子「" + cab.name + "」？")) return;
	try {
		await apiFetch(`/api/cabinets/${cabinetId}`, {
			method: "DELETE",
			fallback: "刪除失敗"
		});
		cabinetList = cabinetList.filter((c) => c.id !== cabinetId);
		renderCabinetTable();
		toast("✅ 已刪除櫃子", "success");
	} catch (e) {
		toast("⚠️ " + e.message, "error");
	}
}
async function initCabinetsTab() {
	await loadCabinets();
}
var currentEditCabinetId = null;
function editCabinet(id) {
	const cabinet = cabinetList.find((c) => c.id === id);
	if (!cabinet) return;
	currentEditCabinetId = id;
	document.getElementById("edit-cabinet-name").value = cabinet.name || "";
	document.getElementById("edit-cabinet-note").value = cabinet.note || "";
	openModal("edit-cabinet-modal");
}
async function submitCabinetEdit() {
	const name = document.getElementById("edit-cabinet-name").value.trim();
	if (!name) {
		toast("請輸入櫃子編號或名稱", "error");
		return;
	}
	const note = document.getElementById("edit-cabinet-note").value.trim();
	try {
		const data = await apiFetch(`/api/cabinets/${currentEditCabinetId}`, {
			method: "PUT",
			json: {
				name,
				note
			},
			fallback: "編輯失敗"
		});
		const idx = cabinetList.findIndex((c) => c.id === currentEditCabinetId);
		if (idx >= 0) cabinetList[idx] = data;
		renderCabinetTable();
		closeModalForce("edit-cabinet-modal");
		toast("✅ 已編輯櫃子「" + name + "」", "success");
	} catch (e) {
		toast("⚠️ " + e.message, "error");
	}
}
//#endregion
//#region static/js/features/settings/gcal.js
var gcal_exports = /* @__PURE__ */ __exportAll({
	addGcalReminderRow: () => addGcalReminderRow,
	bindGcalUser: () => bindGcalUser,
	deleteGcalKey: () => deleteGcalKey,
	forceSyncNow: () => forceSyncNow,
	gcalKeys: () => gcalKeys,
	loadGcalKeys: () => loadGcalKeys,
	loadGcalPanelData: () => loadGcalPanelData,
	removeGcalReminderRow: () => removeGcalReminderRow,
	renderGcalPanel: () => renderGcalPanel,
	saveGcalSetting: () => saveGcalSetting,
	saveKeyReminders: () => saveKeyReminders,
	selectGcalKey: () => selectGcalKey,
	switchGcalTab: () => switchGcalTab,
	toggleGcalKey: () => toggleGcalKey
});
var gcalKeys = [];
var gcalUsers = [];
var gcalSettings = {};
var gcalHealth = {};
var gcalQueueItems = [];
var selectedKeyId = null;
async function loadGcalKeys() {
	try {
		gcalKeys = await apiFetch("/api/gcal-keys");
	} catch (e) {
		console.error("[loadGcalKeys]", e);
	}
}
async function loadGcalUsers() {
	try {
		gcalUsers = (await apiFetch("/api/users")).users || [];
	} catch (e) {
		console.error("[loadGcalUsers]", e);
	}
}
async function loadGcalSettings() {
	try {
		gcalSettings = await apiFetch("/api/gcal-sync-settings");
	} catch (e) {
		console.error("[loadGcalSettings]", e);
	}
}
async function loadGcalSyncStatus() {
	try {
		gcalHealth = await apiFetch("/api/gcal-sync-status");
	} catch (e) {
		console.error("[loadGcalSyncStatus]", e);
	}
}
async function loadGcalQueue() {
	try {
		gcalQueueItems = (await apiFetch("/api/gcal-sync-queue")).items || [];
	} catch (e) {
		console.error("[loadGcalQueue]", e);
	}
}
async function refreshGcalSyncData(render = true) {
	await Promise.all([loadGcalSyncStatus(), loadGcalQueue()]);
	if (render && document.getElementById("panel-gcal")) renderGcalPanel();
}
function gcalQueueStatusLabel(status, keyActive = true) {
	if (!keyActive) return "Key 已停用，等待重新啟用";
	return status === "exhausted" ? "失敗／已達重試上限" : status === "retrying" ? "同步重試中" : "等待同步";
}
function renderGcalHealth(canForce) {
	const h = gcalHealth || {};
	const running = h.thread_alive ? "● 排程器正常" : "○ 排程器未運作";
	const runningClass = h.thread_alive ? "is-ok" : "is-failed";
	const lastRun = h.last_run_at || "尚未執行";
	const lastSuccess = h.last_success_at || "尚未成功執行";
	const error = h.last_error ? "<div class=\"gcal-health-error\">" + esc(String(h.last_error)) + "</div>" : "";
	const action = canForce ? "<button type=\"button\" class=\"btn btn--primary btn--md btn-primary gcal-health-force\" onclick=\"Settings.forceSyncNow()\">立即同步全部 Key</button>" : "";
	return "<section class=\"gcal-sync-health\" aria-label=\"Google 行事曆同步健康狀態\"><div class=\"gcal-health-head\"><div><strong>Google 行事曆同步</strong><span class=\"gcal-health-running " + runningClass + "\">" + running + "</span></div>" + action + "</div><div class=\"gcal-health-meta\"><span>上次執行：" + esc(String(lastRun)) + "</span><span>上次成功：" + esc(String(lastSuccess)) + "</span></div><div class=\"gcal-health-counts\"><span class=\"is-pending\">待同步 <b>" + esc(String(h.pending_count || 0)) + "</b></span><span class=\"is-retrying\">重試中 <b>" + esc(String(h.retrying_count || 0)) + "</b></span><span class=\"is-failed\">失敗 <b>" + esc(String(h.exhausted_count || 0)) + "</b></span>" + (h.paused_count ? "<span class=\"is-paused\">停用 Key 暫停 <b>" + esc(String(h.paused_count)) + "</b></span>" : "") + "</div>" + error + "</section>";
}
function renderGcalQueueIssues(canSync) {
	const items = Array.isArray(gcalQueueItems) ? gcalQueueItems : [];
	let html = "<section class=\"gcal-sync-issues\" aria-label=\"需要處理的同步問題\"><div class=\"gcal-sync-issues-head\"><strong>需要處理的同步問題</strong><span>" + esc(String(items.length)) + " 筆</span></div>";
	if (!items.length) return html + "<div class=\"gcal-sync-issues-empty\">目前沒有待處理的同步問題</div></section>";
	html += "<div class=\"gcal-sync-issue-list\">";
	items.forEach((item) => {
		const apptId = String(item.appointment_id || "");
		const keyId = String(item.key_id || "");
		const title = item.is_deleted ? "已刪除行程 #" + apptId : item.client_name || "未命名行程";
		const opLabel = item.op_type === "D" ? "刪除 Google Event" : item.op_type === "C" ? "建立" : "更新";
		const keyLabel = (item.key_name || "#" + keyId) + (item.key_active ? "" : "（已停用）");
		const error = item.last_error ? "<pre class=\"gcal-sync-issue-error\">" + esc(String(item.last_error)) + "</pre>" : "";
		html += "<article class=\"gcal-sync-issue gcal-sync-issue--" + esc(item.status || "pending") + "\"><div class=\"gcal-sync-issue-main\"><strong>" + esc(title) + "</strong><span>" + esc(item.date || "本地行程已刪除") + "</span></div><div class=\"gcal-sync-issue-detail\"><span>Key：" + esc(keyLabel) + "</span><span>操作：" + esc(opLabel) + "</span><span>嘗試：" + esc(String(item.attempts || 0)) + " / " + esc(String(item.max_attempts || 5)) + "</span><span class=\"gcal-sync-issue-status\">" + esc(gcalQueueStatusLabel(item.status, item.key_active)) + "</span></div>" + error + "<div class=\"gcal-sync-issue-actions\">" + (canSync ? "<button type=\"button\" class=\"btn btn--secondary btn--sm btn-sm gcal-sync-retry\" data-role=\"gcal-sync-retry\" data-sync-appt=\"" + esc(apptId) + "\" data-sync-key=\"" + esc(keyId) + "\">重新嘗試</button>" : "") + "</div></article>";
	});
	return html + "</div></section>";
}
function bindGcalQueueActions() {
	document.querySelectorAll("#panel-gcal [data-role=\"gcal-sync-retry\"]").forEach((button) => {
		button.addEventListener("click", () => retrySyncQueue(Number(button.dataset.syncAppt), Number(button.dataset.syncKey)));
	});
}
function renderGcalPanel() {
	const canManage = hasPerm("gcal-keys-manage");
	const canSync = hasPerm("gcal-sync-manage");
	const canForce = hasPerm("gcal-sync-force");
	let html = "<h4>📅 行事曆同步</h4>";
	if (canSync) html += renderGcalHealth(canForce);
	html += "<div class=\"gcal-layout\">";
	html += "<div class=\"gcal-key-list\">";
	gcalKeys.forEach((k) => {
		const isActive = k.id === selectedKeyId;
		html += "<div class=\"gcal-key-item" + (isActive ? " is-active" : "") + "\" onclick=\"Settings.selectGcalKey(" + k.id + ")\"><div class=\"gcal-key-avatar" + (k.is_active ? "" : " is-off") + "\">📅</div><div class=\"gcal-key-body\"><div class=\"gcal-key-name\">" + esc(k.name) + "</div><div class=\"gcal-key-status" + (k.is_active ? "" : " is-off") + "\">" + (k.is_active ? "帳號啟用" : "帳號停用") + "</div><div class=\"gcal-key-email\" title=\"" + esc(k.client_email || "") + "\">" + esc(k.client_email || "—") + "</div></div><button class=\"btn btn--sm " + (k.is_active ? "btn--danger" : "btn--secondary") + " u-shrink-0\" onclick=\"event.stopPropagation();Settings.toggleGcalKey(" + k.id + "," + !k.is_active + ")\">" + (k.is_active ? "停用" : "啟用") + "</button></div>";
	});
	if (canManage) html += "<div class=\"gcal-key-add\" onclick=\"Settings.openGcalKeyModal()\">＋ 新增 Key</div>";
	html += "</div>";
	html += "<div class=\"gcal-detail-panel\">";
	if (selectedKeyId) {
		const key = gcalKeys.find((k) => k.id === selectedKeyId);
		if (key) {
			html += "<div class=\"gcal-detail-head\"><div class=\"gcal-detail-avatar\">📅</div><div class=\"gcal-detail-info\"><div class=\"gcal-detail-name\">" + esc(key.name) + "</div><div class=\"gcal-detail-meta\">" + esc(key.calendar_id) + " · " + (key.is_active ? "✅ 啟用中" : "⏸ 停用") + "</div><div class=\"gcal-detail-email\">Client email：" + esc(key.client_email || "未讀取") + "</div></div>";
			if (canManage) html += "<div class=\"gcal-detail-actions\"><label class=\"settings-switch\" title=\"" + (key.is_active ? "點擊停用" : "點擊啟用") + "\"><input type=\"checkbox\" " + (key.is_active ? "checked" : "") + " onchange=\"Settings.toggleGcalKey(" + key.id + ", this.checked)\"><span class=\"slider\"></span></label><button class=\"btn btn--secondary btn--sm\" onclick=\"Settings.openGcalKeyModal(" + key.id + ")\">✏️ 編輯</button><button type=\"button\" class=\"btn btn--danger btn--sm\" onclick=\"Settings.deleteGcalKey(" + key.id + ")\">🗑️ 刪除</button></div>";
			html += "</div>";
			html += "<div class=\"gcal-tabs\"><button class=\"chip chip--seg gcal-tab is-active\" data-role=\"gcal-tab\" onclick=\"Settings.switchGcalTab('sync')\" data-tab=\"sync\">⚙️ 同步設定</button><button class=\"chip chip--seg gcal-tab\" data-role=\"gcal-tab\" onclick=\"Settings.switchGcalTab('users')\" data-tab=\"users\">👤 使用者綁定</button></div>";
			html += "<div id=\"gcal-tab-sync\">";
			if (canSync) html += renderGcalSyncSettings(key);
			else html += "<p class=\"gcal-no-perm\">無權限修改同步設定</p>";
			html += "</div>";
			html += "<div id=\"gcal-tab-users\" style=\"display:none\">";
			html += renderGcalUserBind(key);
			html += "</div>";
		}
	} else html += "<div class=\"gcal-detail-empty\"><div class=\"gcal-detail-empty-icon\">📅</div><p>請選擇左側的 Key 查看設定</p></div>";
	html += "</div>";
	html += "</div>";
	html += renderGcalQueueIssues(canSync);
	document.getElementById("panel-gcal").innerHTML = html;
	bindGcalQueueActions();
}
function renderGcalSyncSettings(key) {
	let html = "";
	html += "<div class=\"gcal-section\"><div class=\"gcal-section-title\">📍 Event 內容</div>";
	html += "<div class=\"gcal-settings-row\"><label class=\"gcal-settings-label\">地址同步到地點欄位</label><label class=\"settings-switch\"><input type=\"checkbox\" " + (gcalSettings.gcal_use_location === "1" ? "checked" : "") + " onchange=\"Settings.saveGcalSetting('gcal_use_location', this.checked ? '1' : '0')\"><span class=\"slider\"></span></label><span class=\"gcal-settings-hint\">客戶地址顯示在 Google Calendar 的「地點」欄位</span></div>";
	html += "<div class=\"gcal-settings-row\"><label class=\"gcal-settings-label\">顯示為</label><select onchange=\"Settings.saveGcalSetting('gcal_transparency', this.value)\" class=\"gcal-settings-control\"><option value=\"transparent\"" + (gcalSettings.gcal_transparency === "transparent" ? " selected" : "") + ">🟢 空閒（不阻塞時段）</option><option value=\"opaque\"" + (gcalSettings.gcal_transparency === "opaque" ? " selected" : "") + ">🔴 忙碌（阻塞時段）</option></select><span class=\"gcal-settings-hint\">空閒 = 不會阻塞行事曆上的其他邀請</span></div>";
	html += "</div>";
	html += "<div class=\"gcal-section\"><div class=\"gcal-section-title\">⏰ 時間設定</div>";
	html += "<div class=\"gcal-settings-row\"><label class=\"gcal-settings-label\">預設截止時間</label><select onchange=\"Settings.saveGcalSetting('gcal_default_duration_min', this.value)\" class=\"gcal-settings-control\">" + [
		"15",
		"30",
		"45",
		"60",
		"90",
		"120"
	].map((v) => {
		var label = v === "60" ? "60 分鐘（1 小時）" : v === "120" ? "120 分鐘（2 小時）" : v + " 分鐘";
		return "<option value=\"" + v + "\"" + (gcalSettings.gcal_default_duration_min === v ? " selected" : "") + ">" + label + "</option>";
	}).join("") + "</select><span class=\"gcal-settings-hint\">未填截止時間的行程，同步時使用此時長</span></div>";
	html += "<div class=\"gcal-settings-row gcal-sync-interval-hint\"><label class=\"gcal-settings-label gcal-settings-label--wide\">全部 Key 同步掃描間隔</label><input type=\"number\" value=\"" + (gcalSettings.gcal_sync_interval_min || "5") + "\" min=\"1\" max=\"30\" onchange=\"Settings.saveGcalSetting('gcal_sync_interval_min', this.value)\" class=\"gcal-settings-control gcal-settings-control--num\"> 分鐘<span class=\"gcal-settings-hint\">所有啟用中的 Google Calendar Key 共用此掃描間隔，背景排程器會掃描待同步隊列；行程修改後另有 5 分鐘編輯防抖等待，立即同步會略過防抖（立即同步全部 Key）</span></div>";
	html += "</div>";
	html += "<div class=\"gcal-section\"><div class=\"gcal-section-title\">🔔 事件提醒（此 Key 專用）</div>";
	html += "<p class=\"gcal-section-desc\">同步到 Google Calendar 時附帶的提醒通知。</p>";
	var reminders = (key.reminders || []).filter((r) => r.method === "popup");
	if (!reminders.length) reminders = [{
		method: "popup",
		minutes: 30
	}];
	reminders = reminders.slice(0, 5);
	var reminderDisplay = function(minutes) {
		var units = [
			["weeks", 10080],
			["days", 1440],
			["hours", 60],
			["minutes", 1]
		];
		var total = Number(minutes) || 0;
		for (var i = 0; i < units.length; i += 1) if (total === 0 || total % units[i][1] === 0) return {
			value: total / units[i][1],
			unit: units[i][0]
		};
		return {
			value: total,
			unit: "minutes"
		};
	};
	var reminderRow = function(reminder, index) {
		var display = reminderDisplay(reminder.minutes);
		return "<div class=\"gcal-reminder-row\" data-reminder-index=\"" + index + "\"><div class=\"gcal-reminder-label\" data-role=\"gcal-reminder-label\">🔔 提前通知 " + (index + 1) + "</div><div class=\"gcal-reminder-control\"><input type=\"number\" id=\"gcal-reminder-val-" + key.id + "-" + index + "\" value=\"" + display.value + "\" min=\"0\" max=\"40320\"><select id=\"gcal-reminder-unit-" + key.id + "-" + index + "\"><option value=\"minutes\"" + (display.unit === "minutes" ? " selected" : "") + ">分鐘</option><option value=\"hours\"" + (display.unit === "hours" ? " selected" : "") + ">小時</option><option value=\"days\"" + (display.unit === "days" ? " selected" : "") + ">天</option><option value=\"weeks\"" + (display.unit === "weeks" ? " selected" : "") + ">週</option></select></div><button type=\"button\" class=\"btn btn--secondary btn--sm\" onclick=\"Settings.removeGcalReminderRow(" + key.id + "," + index + ")\"" + (reminders.length <= 1 ? " disabled" : "") + ">移除</button><span class=\"gcal-reminder-hint\">Google Calendar Popup 提醒</span></div>";
	};
	html += "<div class=\"gcal-reminders-list\" id=\"gcal-reminders-" + key.id + "\">" + reminders.map(reminderRow).join("") + "</div>";
	html += "<button type=\"button\" class=\"btn btn--ghost btn--sm gcal-add-reminder\" id=\"gcal-add-reminder-" + key.id + "\" onclick=\"Settings.addGcalReminderRow(" + key.id + ")\"" + (reminders.length >= 5 ? " disabled" : "") + ">＋ 新增通知（最多 5 個）</button>";
	html += "<div class=\"gcal-api-note\">💡 Google Calendar API 上限：最長 4 週（40320 分鐘）= 672 小時 = 28 天 = 4 週</div>";
	html += "<button class=\"btn btn--primary btn--md btn-primary u-mt-12\" onclick=\"Settings.saveKeyReminders(" + key.id + ")\">💾 儲存提醒設定</button>";
	html += "</div>";
	return html;
}
function renderGcalUserBind(key) {
	let html = "<p class=\"gcal-bind-desc\">指派人員綁定此 Key → 該人員的行程同步到這本行事曆。</p>";
	html += "<table class=\"gcal-bind-table\"><thead><tr><th>使用者</th><th>綁定 Key</th></tr></thead><tbody>";
	gcalUsers.forEach((u) => {
		html += "<tr><td>👤 " + esc(u.display_name || u.username) + "</td><td><select onchange=\"Settings.bindGcalUser(" + u.id + ", this.value)\" class=\"gcal-bind-select\"><option value=\"\"" + (!u.gcal_key ? " selected" : "") + ">— 未綁定 —</option>";
		gcalKeys.filter((k) => k.is_active).forEach((k) => {
			html += "<option value=\"" + esc(k.name) + "\"" + (u.gcal_key === k.name ? " selected" : "") + ">" + esc(k.name) + "</option>";
		});
		html += "</select></td></tr>";
	});
	html += "</tbody></table>";
	html += "<p class=\"gcal-bind-note\">未綁定 Key 的使用者，其指派的行程不會同步到任何行事曆。</p>";
	return html;
}
function selectGcalKey(id) {
	selectedKeyId = id;
	renderGcalPanel();
}
function switchGcalTab(tab) {
	document.querySelectorAll("[data-role=\"gcal-tab\"]").forEach((t) => t.classList.remove("is-active"));
	document.querySelector("[data-role=\"gcal-tab\"][data-tab=\"" + tab + "\"]").classList.add("is-active");
	document.getElementById("gcal-tab-sync").style.display = tab === "sync" ? "" : "none";
	document.getElementById("gcal-tab-users").style.display = tab === "users" ? "" : "none";
}
async function saveGcalSetting(key, value) {
	try {
		await apiFetch("/api/gcal-sync-settings", {
			method: "PUT",
			json: { [key]: value },
			fallback: "儲存失敗"
		});
		gcalSettings[key] = value;
		await refreshGcalSyncData(false);
		renderGcalPanel();
		toast("✅ 已儲存，受影響事件已重新評估", "success");
	} catch (e) {
		toast(e.message, "error");
	}
}
async function saveKeyReminders(keyId) {
	const rows = Array.from(document.querySelectorAll("#gcal-reminders-" + keyId + " [data-reminder-index]"));
	if (!rows.length || rows.length > 5) return toast("通知數量需為 1~5 個", "error");
	const reminders = [];
	for (let i = 0; i < rows.length; i += 1) {
		const index = rows[i].dataset.reminderIndex;
		const value = Number(document.getElementById("gcal-reminder-val-" + keyId + "-" + index).value);
		const unit = document.getElementById("gcal-reminder-unit-" + keyId + "-" + index).value;
		const minutes = unit === "weeks" ? value * 10080 : unit === "days" ? value * 1440 : unit === "hours" ? value * 60 : value;
		if (!Number.isInteger(value) || value < 0 || minutes > 40320) return toast("通知時間需介於 0 分鐘至 4 週", "error");
		reminders.push({
			method: "popup",
			minutes
		});
	}
	try {
		await apiFetch("/api/gcal-keys/" + keyId + "/reminders", {
			method: "PUT",
			json: { reminders },
			fallback: "儲存失敗"
		});
		const key = gcalKeys.find((k) => k.id === keyId);
		if (key) key.reminders = reminders;
		await refreshGcalSyncData(false);
		renderGcalPanel();
		toast("✅ 提醒設定已儲存，既有事件已重新評估", "success");
	} catch (e) {
		toast(e.message, "error");
	}
}
function addGcalReminderRow(keyId) {
	const container = document.getElementById("gcal-reminders-" + keyId);
	if (!container || container.children.length >= 5) return;
	const index = container.children.length;
	const row = document.createElement("div");
	row.className = "gcal-reminder-row";
	row.dataset.reminderIndex = index;
	row.innerHTML = "<div class=\"gcal-reminder-label\" data-role=\"gcal-reminder-label\">🔔 提前通知 " + (index + 1) + "</div><div class=\"gcal-reminder-control\"><input type=\"number\" id=\"gcal-reminder-val-" + keyId + "-" + index + "\" value=\"30\" min=\"0\" max=\"40320\"><select id=\"gcal-reminder-unit-" + keyId + "-" + index + "\"><option value=\"minutes\" selected>分鐘</option><option value=\"hours\">小時</option><option value=\"days\">天</option><option value=\"weeks\">週</option></select></div><button type=\"button\" class=\"btn btn--secondary btn--sm\" onclick=\"Settings.removeGcalReminderRow(" + keyId + "," + index + ")\">移除</button><span class=\"gcal-reminder-hint\">Google Calendar Popup 提醒</span>";
	container.appendChild(row);
	const add = document.getElementById("gcal-add-reminder-" + keyId);
	if (add && container.children.length >= 5) add.disabled = true;
}
function removeGcalReminderRow(keyId, index) {
	const container = document.getElementById("gcal-reminders-" + keyId);
	if (!container || container.children.length <= 1) return;
	const row = container.querySelector("[data-reminder-index=\"" + index + "\"]");
	if (row) row.remove();
	Array.from(container.children).forEach((item, i) => {
		item.dataset.reminderIndex = i;
		const value = item.querySelector("input[type=\"number\"]");
		const unit = item.querySelector("select");
		if (value) value.id = "gcal-reminder-val-" + keyId + "-" + i;
		if (unit) unit.id = "gcal-reminder-unit-" + keyId + "-" + i;
		const label = item.querySelector("[data-role=\"gcal-reminder-label\"]");
		if (label) label.textContent = "🔔 提前通知 " + (i + 1);
	});
	const add = document.getElementById("gcal-add-reminder-" + keyId);
	if (add) add.disabled = container.children.length >= 5;
}
async function forceSyncNow() {
	if (!confirm("確定要立即執行同步？")) return;
	try {
		await apiFetch("/api/gcal-sync-now", {
			method: "POST",
			fallback: "同步失敗"
		});
		await refreshGcalSyncData(false);
		renderGcalPanel();
		toast("✅ 已觸發全部 Key 立即同步；已耗盡項目請按重新嘗試", "success");
		setTimeout(async () => {
			await refreshGcalSyncData(false);
			renderGcalPanel();
		}, 3e3);
	} catch (e) {
		toast(e.message, "error");
	}
}
async function retrySyncQueue(apptId, keyId) {
	if (!Number.isInteger(apptId) || !Number.isInteger(keyId)) return;
	try {
		await apiFetch("/api/gcal-sync-queue/reset?appt_id=" + apptId + "&key_id=" + keyId, {
			method: "PUT",
			fallback: "重新嘗試失敗"
		});
		await refreshGcalSyncData(false);
		renderGcalPanel();
		toast("✅ 已重設指定同步項目", "success");
	} catch (e) {
		toast(e.message, "error");
	}
}
async function toggleGcalKey(id, on) {
	try {
		await apiFetch("/api/gcal-keys/" + id, {
			method: "PUT",
			json: { is_active: on },
			fallback: "操作失敗"
		});
		const k = gcalKeys.find((x) => x.id === id);
		if (k) k.is_active = on;
		await refreshGcalSyncData(false);
		renderGcalPanel();
		toast(on ? "✅ 已啟用" : "已停用", on ? "success" : "");
	} catch (e) {
		toast(e.message, "error");
	}
}
async function deleteGcalKey(id) {
	const key = gcalKeys.find((k) => k.id === id);
	const name = key ? key.name : "未知";
	if (!confirm("確定要刪除 Key「" + name + "」？\n\n此操作會同時刪除 Google 行事曆上已同步的事件。")) return;
	try {
		const data = await apiFetch("/api/gcal-keys/" + id, { method: "DELETE" });
		gcalKeys = gcalKeys.filter((k) => k.id !== id);
		if (selectedKeyId === id) selectedKeyId = gcalKeys.length ? gcalKeys[0].id : null;
		await refreshGcalSyncData(false);
		renderGcalPanel();
		var msg = "✅ Key「" + name + "」已刪除";
		if (data.google_deleted > 0) msg += "（Google 事件 " + data.google_deleted + " 筆已清除）";
		if (data.google_failed > 0) msg += "⚠️ Google 事件 " + data.google_failed + " 筆清除失敗";
		toast(msg, data.google_failed > 0 ? "error" : "success");
	} catch (e) {
		const httpError = e.name === "ApiError" && e.status >= 400;
		if (httpError && typeof e.detail === "string") toast(e.message, "error");
		else if (httpError) toast("Google 事件刪除未完成，Key 與同步問題已保留，請先處理同步清單", "error");
		else toast("❌ 刪除失敗：" + e.message, "error");
	}
}
async function bindGcalUser(userId, keyName) {
	try {
		await apiFetch("/api/users/" + userId, {
			method: "PUT",
			json: { gcal_key: keyName },
			fallback: "綁定失敗"
		});
		const u = gcalUsers.find((x) => x.id === userId);
		if (u) u.gcal_key = keyName;
		await refreshGcalSyncData(false);
		renderGcalPanel();
		toast("✅ 已綁定", "success");
	} catch (e) {
		toast(e.message, "error");
	}
}
async function loadGcalPanelData() {
	await Promise.all([
		loadGcalKeys(),
		loadGcalUsers(),
		loadGcalSettings(),
		loadGcalSyncStatus(),
		loadGcalQueue()
	]);
	if (gcalKeys.length && !selectedKeyId) selectedKeyId = gcalKeys[0].id;
}
//#endregion
//#region static/js/features/settings/units.js
var units_exports = /* @__PURE__ */ __exportAll({
	addUnitFromSettings: () => addUnitFromSettings,
	applyQtySuggest: () => applyQtySuggest,
	consolidateGroup: () => consolidateGroup,
	consolidateItem: () => consolidateItem,
	initSettingsUnits: () => initSettingsUnits,
	loadOrphans: () => loadOrphans,
	moveUnit: () => moveUnit,
	renderUnitsPanel: () => renderUnitsPanel,
	setUnitQtyType: () => setUnitQtyType,
	toggleUnit: () => toggleUnit
});
var orphanItems = [];
var orphanLoadFailed = false;
async function loadOrphans() {
	try {
		orphanItems = await apiFetch("/api/units/orphans");
		orphanLoadFailed = false;
	} catch (e) {
		orphanLoadFailed = true;
	}
}
var QTY_TYPE_LABELS = {
	integer: "整數",
	decimal: "小數",
	fraction: "分數/小數"
};
function qtyTypeLabel(t) {
	return QTY_TYPE_LABELS[t] || "整數";
}
function suggestQtyConvert(unitStr, totalQty) {
	const m = /^\/(\d+)([^\/\+\(\)\s]+)$/.exec(String(unitStr || "").trim());
	if (!m) return null;
	const d = parseInt(m[1]);
	if (!d || d <= 0) return null;
	const total = Number(totalQty || 0);
	if (!isFinite(total) || total < 0) return null;
	return {
		qty: Math.round(total / d * 1e3) / 1e3,
		unit: m[2]
	};
}
function groupOrphans(items) {
	const map = /* @__PURE__ */ new Map();
	items.forEach((it) => {
		if (!map.has(it.unit)) map.set(it.unit, []);
		map.get(it.unit).push(it);
	});
	return Array.from(map.entries()).map(([unit, arr]) => ({
		unit,
		label: unit === "" ? "（空白）" : unit,
		items: arr
	}));
}
function renderUnitsPanel() {
	const canManage = hasPerm("unit-mgmt");
	const canAdd = hasPerm("item-mgmt");
	let html = "<h4>📦 單位管理</h4>";
	if (canAdd) html += "<div class=\"u-add-row\"><input id=\"u-new-name\" placeholder=\"新單位名稱（例：顆）\" maxlength=\"20\"><select id=\"u-new-type\" title=\"數量輸入類型\"><option value=\"integer\">整數</option><option value=\"decimal\">小數</option><option value=\"fraction\">分數/小數</option></select><button class=\"btn btn--primary btn--md btn-primary\" onclick=\"Settings.addUnitFromSettings()\">＋ 新增</button></div>";
	html += "<table class=\"u-table\"><thead><tr><th>單位名稱</th><th>數量類型</th><th class=\"u-ta-right\">操作</th></tr></thead>";
	unitList.forEach((u) => {
		const _tl = qtyTypeLabel(u.qty_type);
		const _typeCell = canManage ? "<select class=\"u-qty-type\" onchange=\"Settings.setUnitQtyType(" + u.id + ", this.value)\" title=\"數量輸入類型\">" + [
			"integer",
			"decimal",
			"fraction"
		].map((t) => "<option value=\"" + t + "\"" + ((u.qty_type || "integer") === t ? " selected" : "") + ">" + qtyTypeLabel(t) + "</option>").join("") + "</select>" : "<span class=\"u-qty-label\">" + esc(_tl) + "</span>";
		html += "<tr data-unit-row=\"" + u.id + "\"><td class=\"u-name " + (u.is_active ? "" : "is-inactive") + "\">" + esc(u.name) + (u.is_active ? "" : " <small>（停用）</small>") + "</td><td>" + _typeCell + "</td><td class=\"u-ta-right\">";
		if (canManage) html += "<a class=\"updown\" onclick=\"Settings.moveUnit(" + u.id + ", -1)\" title=\"上移\">↑</a><a class=\"updown\" onclick=\"Settings.moveUnit(" + u.id + ", 1)\" title=\"下移\">↓</a> <label class=\"settings-switch\"><input type=\"checkbox\" " + (u.is_active ? "checked" : "") + " onchange=\"Settings.toggleUnit(" + u.id + ", this.checked)\"><span class=\"slider\"></span></label>";
		html += "</td></tr>";
	});
	html += "</table>";
	if (canManage) {
		const groups = groupOrphans(orphanItems);
		if (groups.length) {
			html += "<div class=\"hist-clean\"><b>⚠️ 歷史單位待處理（點開逐筆處理）</b>";
			html += "<div class=\"hist-clean-desc\">這些資料可能包含舊式「數量 + 單位」混合格式，需要轉換成標準數量與正式單位。有轉換建議的可一鍵套用；判斷不出的請手填確認，處理完自動消失。</div>";
			groups.forEach((g) => {
				html += "<div class=\"grp\"><div class=\"grp-head\" onclick=\"this.parentElement.classList.toggle('is-open')\"><span class=\"grp-title\"><span class=\"arrow\">▶</span> " + esc(g.label) + "</span><span class=\"grp-count\">" + g.items.length + " 筆</span></div><div class=\"grp-body\"><table class=\"g-table\">";
				g.items.forEach((it) => {
					const _sg = suggestQtyConvert(it.unit, it.total_qty);
					const _sgHtml = _sg ? "<div class=\"u-suggest\">建議：" + esc(String(_sg.qty)) + " " + esc(_sg.unit) + " <button class=\"btn btn--primary btn--sm btn-primary\" onclick=\"Settings.applyQtySuggest(" + it.item_id + ", this)\" data-qty=\"" + esc(String(_sg.qty)) + "\" data-to=\"" + esc(_sg.unit) + "\">套用建議</button></div>" : "<div class=\"u-suggest u-ambiguous\">⚠ 需人工確認（無法自動判讀）</div>";
					html += "<tr><td class=\"p-name\" data-role=\"item-name\">" + esc(it.name) + (it.is_deleted ? " <small>（非庫存）</small>" : "") + "</td><td class=\"qty\">×" + absNum(it.total_qty) + "</td><td>" + _sgHtml + "<div class=\"u-manual\"><select class=\"u-ci-to\" data-role=\"unit-consolidate-to\" required><option value=\"\">— 請選擇 —</option>";
					appState.unitListActive.forEach((u) => {
						html += "<option>" + esc(u.name) + "</option>";
					});
					html += "</select><input class=\"u-ci-qty\" data-role=\"unit-consolidate-qty\" inputmode=\"decimal\" placeholder=\"新總量（選填）\" title=\"轉換後總量，例：0.75\"> <button class=\"btn btn--primary btn--sm btn-primary\" onclick=\"Settings.consolidateItem(" + it.item_id + ", this)\">改為</button></div></td></tr>";
				});
				html += "</table><div class=\"grp-fast\" data-role=\"unit-group-fast\">整組快速套用：<select class=\"u-ci-fast\" data-role=\"unit-consolidate-fast\" required><option value=\"\">— 請選擇 —</option>";
				appState.unitListActive.forEach((u) => {
					html += "<option>" + esc(u.name) + "</option>";
				});
				html += "</select><button class=\"btn btn--primary btn--sm btn-primary\" data-from=\"" + esc(g.unit) + "\" onclick=\"Settings.consolidateGroup(this)\">套用全部</button></div></div></div>";
			});
			html += "</div>";
		} else if (orphanLoadFailed) html += "<div class=\"hist-clean--error hist-clean\">⚠️ 歷史單位載入失敗</div>";
		else html += "<div class=\"hist-clean--ok hist-clean\">✅ 所有品項單位皆在清單中</div>";
	}
	document.getElementById("panel-units").innerHTML = html;
}
async function addUnitFromSettings() {
	const inp = document.getElementById("u-new-name");
	const name = inp ? inp.value.trim() : "";
	const typeSel = document.getElementById("u-new-type");
	const qtyType = typeSel ? typeSel.value : "integer";
	if (!name) {
		toast("請輸入單位名稱", "error");
		return;
	}
	try {
		const data = await apiFetch("/api/units", {
			method: "POST",
			json: {
				name,
				qty_type: qtyType
			},
			fallback: "新增失敗"
		});
		unitList.push(data);
		appState.unitListActive = unitList.filter((u) => u.is_active);
		if (inp) inp.value = "";
		renderUnitsPanel();
		toast("✅ 單位「" + name + "」已新增", "success");
	} catch (e) {
		toast(e.message, "error");
	}
}
async function setUnitQtyType(id, qtyType) {
	try {
		await apiFetch("/api/units/" + id, {
			method: "PUT",
			json: { qty_type: qtyType },
			fallback: "操作失敗"
		});
		const u = unitList.find((x) => x.id === id);
		if (u) u.qty_type = qtyType;
		renderUnitsPanel();
		toast("✅ 數量類型已更新", "success");
	} catch (e) {
		toast(e.message, "error");
		renderUnitsPanel();
	}
}
async function toggleUnit(id, on) {
	try {
		await apiFetch("/api/units/" + id, {
			method: "PUT",
			json: { is_active: on },
			fallback: "操作失敗"
		});
		const u = unitList.find((x) => x.id === id);
		if (u) u.is_active = on;
		appState.unitListActive = unitList.filter((x) => x.is_active);
		renderUnitsPanel();
		toast(on ? "✅ 已啟用" : "已停用", on ? "success" : "");
	} catch (e) {
		toast(e.message, "error");
		renderUnitsPanel();
	}
}
async function moveUnit(id, dir) {
	const u = unitList.find((x) => x.id === id);
	if (!u) return;
	try {
		await apiFetch("/api/units/" + id, {
			method: "PUT",
			json: { sort_order: u.sort_order + dir },
			fallback: "排序失敗"
		});
		await loadUnits();
		renderUnitsPanel();
	} catch (e) {
		toast(e.message, "error");
	}
}
async function consolidateItem(itemId, btn) {
	const tr = btn.closest("tr");
	const sel = tr ? tr.querySelector("[data-role=\"unit-consolidate-to\"]") : null;
	const to = sel ? sel.value : "";
	if (!to) {
		toast("請先選擇目標單位", "error");
		return;
	}
	const qInp = tr ? tr.querySelector("[data-role=\"unit-consolidate-qty\"]") : null;
	const qRaw = qInp ? qInp.value.trim() : "";
	let newQty = null;
	if (qRaw !== "") {
		const _p = Qty.parse(qRaw);
		if (_p.error || _p.value < 0) {
			toast(_p.error || "數量不可為負數。", "error");
			return;
		}
		newQty = _p.value;
	}
	const nameEl = tr ? tr.querySelector("[data-role=\"item-name\"]") : null;
	const qtyNote = newQty === null ? "" : "，總量改為 " + newQty;
	if (!confirm("將「" + (nameEl ? nameEl.textContent : "") + "」的單位改為「" + to + "」" + qtyNote + "？")) return;
	try {
		await apiFetch("/api/units/consolidate-item", {
			method: "POST",
			json: newQty === null ? {
				item_id: itemId,
				to_unit: to
			} : {
				item_id: itemId,
				to_unit: to,
				new_qty: newQty
			},
			fallback: "改單位失敗"
		});
		await Promise.all([loadUnits(), loadOrphans()]);
		renderUnitsPanel();
		toast("✅ 已改為「" + to + "」", "success");
	} catch (e) {
		toast(e.message, "error");
	}
}
async function applyQtySuggest(itemId, btn) {
	const qty = parseFloat(btn.dataset.qty);
	const to = btn.dataset.to || "";
	if (!to || !isFinite(qty) || qty < 0) {
		toast("建議值無效，請手填確認", "error");
		return;
	}
	const tr = btn.closest("tr");
	const nameEl = tr ? tr.querySelector("[data-role=\"item-name\"]") : null;
	if (!confirm("套用建議：將「" + (nameEl ? nameEl.textContent : "") + "」改為 " + qty + " " + to + "？")) return;
	try {
		await apiFetch("/api/units/consolidate-item", {
			method: "POST",
			json: {
				item_id: itemId,
				to_unit: to,
				new_qty: qty
			},
			fallback: "轉換失敗"
		});
		await Promise.all([loadUnits(), loadOrphans()]);
		renderUnitsPanel();
		toast("✅ 已轉換為 " + qty + " " + to, "success");
	} catch (e) {
		toast(e.message, "error");
	}
}
async function consolidateGroup(btn) {
	const from = btn.dataset.from;
	const sel = btn.closest("[data-role=\"unit-group-fast\"]").querySelector("[data-role=\"unit-consolidate-fast\"]");
	const to = sel ? sel.value : "";
	if (!to) {
		toast("請先選擇目標單位", "error");
		return;
	}
	const label = from === "" ? "（空白）" : from;
	const n = orphanItems.filter((o) => o.unit === from).length;
	if (!confirm("將「" + label + "」全部 " + n + " 筆的單位改為「" + to + "」？")) return;
	try {
		const data = await apiFetch("/api/units/consolidate", {
			method: "POST",
			json: {
				from_unit: from,
				to_unit: to
			},
			fallback: "收編失敗"
		});
		await Promise.all([loadUnits(), loadOrphans()]);
		renderUnitsPanel();
		toast("✅ 已收編 " + data.affected + " 筆為「" + to + "」", "success");
	} catch (e) {
		toast(e.message, "error");
	}
}
function initSettingsUnits() {
	window.addEventListener("load", async () => {
		await loadUnits();
		renderUnitsPanel();
		await loadCabinets();
	});
}
//#endregion
//#region static/js/features/settings/gcal-key-modal.js
var gcal_key_modal_exports = /* @__PURE__ */ __exportAll({
	clearGcalFile: () => clearGcalFile,
	closeGcalKeyModal: () => closeGcalKeyModal,
	gcalFileSelected: () => gcalFileSelected,
	gcalKeySaveErrorMessage: () => gcalKeySaveErrorMessage,
	openGcalKeyModal: () => openGcalKeyModal,
	submitGcalKey: () => submitGcalKey
});
var _gcalEditingId = null;
function gcalFileSelected(input) {
	const file = input && input.files && input.files[0];
	const meta = document.getElementById("gk-file-meta");
	const name = document.getElementById("gk-file-name");
	const hint = document.getElementById("gk-file-hint");
	const path = document.getElementById("gk-cred");
	if (file) {
		if (path) path.value = "";
		if (name) name.textContent = file.name;
		if (meta) meta.style.display = "flex";
		if (hint) hint.textContent = "已選擇上傳檔案，不需要再輸入 JSON 路徑。";
	} else clearGcalFile();
}
function clearGcalFile() {
	const file = document.getElementById("gk-file");
	const meta = document.getElementById("gk-file-meta");
	const name = document.getElementById("gk-file-name");
	const hint = document.getElementById("gk-file-hint");
	if (file) file.value = "";
	if (meta) meta.style.display = "none";
	if (name) name.textContent = "";
	if (hint) hint.textContent = "上傳後由伺服器固定儲存檔名；只會顯示 client_email，不會顯示 private_key。";
}
function openGcalKeyModal(id) {
	_gcalEditingId = id || null;
	const modal = document.getElementById("gcalKeyModal");
	if (!modal) return;
	if (_gcalEditingId) {
		const k = gcalKeys.find((x) => x.id === _gcalEditingId);
		document.getElementById("gk-name").value = k ? k.name : "";
		document.getElementById("gk-cred").value = "";
		clearGcalFile();
		document.getElementById("gk-cal").value = k ? k.calendar_id : "";
		document.querySelector("#gcalKeyModal h4").textContent = "✏️ 編輯 Service Account Key";
	} else {
		document.getElementById("gk-name").value = "";
		document.getElementById("gk-cred").value = "";
		clearGcalFile();
		document.getElementById("gk-cal").value = "";
		document.querySelector("#gcalKeyModal h4").textContent = "＋ 新增 Service Account Key";
	}
	modal.classList.add("is-open");
}
function closeGcalKeyModal() {
	const modal = document.getElementById("gcalKeyModal");
	if (modal) modal.classList.remove("is-open");
	_gcalEditingId = null;
}
async function submitGcalKey() {
	const name = (document.getElementById("gk-name").value || "").trim();
	const cred = (document.getElementById("gk-cred").value || "").trim();
	const cal = (document.getElementById("gk-cal").value || "").trim();
	if (!name) {
		toast("請輸入 Key 名稱", "error");
		return;
	}
	const file = document.getElementById("gk-file").files[0];
	if (!_gcalEditingId && !cred && !file) {
		toast("請上傳 JSON 或輸入 JSON 檔路徑", "error");
		return;
	}
	if (!cal) {
		toast("請輸入 Calendar ID", "error");
		return;
	}
	const url = _gcalEditingId ? "/api/gcal-keys/" + _gcalEditingId : "/api/gcal-keys";
	const method = _gcalEditingId ? "PUT" : "POST";
	let options;
	if (file) {
		const form = new FormData();
		form.append("name", name);
		form.append("calendar_id", cal);
		form.append("credentials_file", file);
		options = {
			method,
			body: form,
			fallback: "儲存失敗"
		};
	} else if (_gcalEditingId) options = {
		method,
		json: {
			name,
			credentials_path: cred || void 0,
			calendar_id: cal
		},
		fallback: "儲存失敗"
	};
	else {
		if (!cred) {
			toast("請上傳 JSON 或輸入 JSON 檔路徑", "error");
			return;
		}
		const form = new FormData();
		form.append("name", name);
		form.append("calendar_id", cal);
		form.append("credentials_path", cred);
		options = {
			method,
			body: form,
			fallback: "儲存失敗"
		};
	}
	try {
		await apiFetch(url, options);
		await loadGcalKeys();
		renderGcalPanel();
		closeGcalKeyModal();
		toast(_gcalEditingId ? "✅ 已更新" : "✅ 已新增", "success");
	} catch (e) {
		toast(gcalKeySaveErrorMessage(e), "error");
	}
}
/**
* 儲存 Key 失敗的顯示文字：更換 Calendar ID 時舊行事曆事件未刪完（409 物件 detail）顯示專屬說明，其餘沿用 apiFetch 訊息。
* @param {Error & {status?: number, detail?: unknown}} e apiFetch 丟出的錯誤。
* @returns {string} 可顯示的錯誤訊息。
*/
function gcalKeySaveErrorMessage(e) {
	const d = e && e.detail;
	if (e && e.status === 409 && d && typeof d === "object" && d.key_updated === false) return "舊行事曆的 Google 事件刪除未完成（已刪除 " + (Number(d.google_deleted) || 0) + " 筆、失敗 " + (Number(d.google_failed) || 0) + " 筆），Key 未更新；請先處理同步清單後再更換 Calendar ID";
	return e && e.message ? e.message : "儲存失敗";
}
//#endregion
//#region static/js/features/settings/petty-options.js
var petty_options_exports = /* @__PURE__ */ __exportAll({
	createPettyOptionKind: () => createPettyOptionKind,
	loadPettyOptions: () => loadPettyOptions,
	renderPettyOptionsPanel: () => renderPettyOptionsPanel
});
var pettyOptionCache = {
	general: {
		category: [],
		group: []
	},
	engineering: {
		category: [],
		group: []
	}
};
async function loadPettyOptions() {
	for (const type of ["general", "engineering"]) for (const kind of ["category", "group"]) {
		const data = await apiFetch("/api/petty-cash-options?report_type=" + type + "&option_type=" + kind).catch(() => null);
		if (data) pettyOptionCache[type][kind] = data.items || [];
	}
}
function pettyOptionRows(type, kind, can) {
	const items = pettyOptionCache[type][kind] || [];
	if (!items.length) return "<div class=\"pc-option-empty\">尚未設定選項</div>";
	return items.map((o, i) => "<div class=\"pc-option-row\"><div><span class=\"pc-option-index\">" + (i + 1) + "</span><strong>" + esc(o.name) + "</strong><small class=\"pc-option-status " + (o.is_active ? "is-active" : "is-off") + "\">" + (o.is_active ? "● 使用中" : "○ 已停用") + "</small></div>" + (can ? "<span class=\"pc-option-actions\"><button type=\"button\" class=\"btn btn--secondary btn--sm pc-icon-action\" data-petty-action=\"rename\" data-id=\"" + o.id + "\" data-type=\"" + esc(type) + "\" data-kind=\"" + esc(kind) + "\">✎ 編輯</button><button type=\"button\" class=\"btn btn--danger btn--sm pc-icon-action\" data-petty-action=\"delete\" data-id=\"" + o.id + "\" data-type=\"" + esc(type) + "\" data-kind=\"" + esc(kind) + "\">🗑 刪除</button></span>" : "") + "</div>").join("");
}
function renderPettyOptionsPanel() {
	const can = hasPerm("petty-cash-config");
	const panel = document.getElementById("panel-petty-cash");
	if (!panel) return;
	let html = "<div class=\"pc-settings-title\"><div><h4>🪙 零用金選單</h4><p>管理零用金報表使用的科目、分類與項目，資料不與其他報表類型共用。</p></div></div>";
	html += "<section class=\"pc-option-settings pc-option-settings--general\"><div class=\"pc-settings-card-head\"><div><span class=\"pc-settings-icon\">💳</span><div><h5>一般零用金</h5><p>管理一般零用金使用的科目</p></div></div><span class=\"pc-settings-note\">ⓘ 僅需設定科目</span></div>";
	if (can) html += "<div class=\"pc-option-add\"><label for=\"pc-opt-name-general-category\">新增科目</label><div class=\"pc-option-add-row\"><input id=\"pc-opt-name-general-category\" maxlength=\"100\" placeholder=\"輸入科目名稱（例如：文具費）\"><button class=\"btn btn--primary btn--md btn-primary\" onclick=\"Settings.createPettyOptionKind('general','category')\">＋ 新增科目</button></div></div>";
	html += "<div class=\"pc-option-list-head\"><span>#　科目名稱</span><span>操作</span></div><div class=\"pc-option-list\">" + pettyOptionRows("general", "category", can) + "</div></section>";
	html += "<section class=\"pc-option-settings pc-option-settings--engineering\"><div class=\"pc-settings-card-head\"><div><span class=\"pc-settings-icon\">👷</span><div><h5>工程零用金</h5><p>管理工程零用金使用的分類與項目</p></div></div></div><div class=\"pc-option-engineering-grid\">";
	for (const kind of ["category", "group"]) {
		const label = kind === "category" ? "📁 分類選項" : "📦 項目選項";
		const placeholder = kind === "category" ? "輸入分類名稱（例如：交通費）" : "輸入項目名稱（例如：油資）";
		html += "<div class=\"pc-option-column\"><div class=\"pc-option-column-head\"><div><h6>" + label + "</h6><p>工程零用金" + (kind === "category" ? "分類" : "項目") + "</p></div><b>" + (pettyOptionCache.engineering[kind] || []).length + " 筆</b></div>";
		if (can) html += "<div class=\"pc-option-add\"><label for=\"pc-opt-name-engineering-" + kind + "\">新增" + (kind === "category" ? "分類" : "項目") + "</label><div class=\"pc-option-add-row\"><input id=\"pc-opt-name-engineering-" + kind + "\" maxlength=\"100\" placeholder=\"" + placeholder + "\"><button class=\"btn btn--primary btn--md btn-primary\" onclick=\"Settings.createPettyOptionKind('engineering','" + kind + "')\">＋ 新增</button></div></div>";
		html += "<div class=\"pc-option-list\">" + pettyOptionRows("engineering", kind, can) + "</div></div>";
	}
	html += "</div></section>";
	panel.innerHTML = html;
	panel.querySelectorAll("[data-petty-action]").forEach((button) => button.addEventListener("click", () => {
		const id = Number(button.dataset.id), type = button.dataset.type, kind = button.dataset.kind;
		if (button.dataset.pettyAction === "rename") renamePettyOption(id, type, kind);
		else deletePettyOption(id, type, kind);
	}));
}
async function createPettyOptionKind(type, kind) {
	const name = document.getElementById("pc-opt-name-" + type + "-" + kind).value.trim();
	if (!name) return toast("請輸入選單名稱", "error");
	try {
		await apiFetch("/api/petty-cash-options", {
			method: "POST",
			json: {
				report_type: type,
				option_type: kind,
				name,
				sort_order: pettyOptionCache[type][kind].length
			},
			fallback: "新增失敗"
		});
	} catch (e) {
		return toast(e.message, "error");
	}
	await loadPettyOptions();
	renderPettyOptionsPanel();
	toast("✅ 已新增", "success");
}
async function renamePettyOption(id, type, kind) {
	const old = (pettyOptionCache[type][kind].find((o) => o.id === id) || {}).name || "";
	const name = prompt("請輸入新的選單名稱", old);
	if (name === null || !name.trim()) return;
	try {
		await apiFetch("/api/petty-cash-options/" + id, {
			method: "PUT",
			json: { name: name.trim() },
			fallback: "修改失敗"
		});
	} catch (e) {
		return toast(e.message, "error");
	}
	await loadPettyOptions();
	renderPettyOptionsPanel();
}
async function deletePettyOption(id, type, kind) {
	if (!confirm("確定刪除此下拉選單項目？")) return;
	try {
		await apiFetch("/api/petty-cash-options/" + id, {
			method: "DELETE",
			fallback: "刪除失敗"
		});
	} catch (e) {
		return toast(e.message, "error");
	}
	await loadPettyOptions();
	renderPettyOptionsPanel();
}
//#endregion
//#region static/js/features/settings/page.js
var page_exports = /* @__PURE__ */ __exportAll({
	clearPwForm: () => clearPwForm,
	initSettingsPage: () => initSettingsPage,
	settingsSubmitPw: () => settingsSubmitPw,
	settingsSwitch: () => settingsSwitch
});
function settingsSwitch(panel) {
	document.querySelectorAll("#settingsSideList [data-role=\"settings-side-item\"]").forEach((el) => el.classList.toggle("is-active", el.dataset.panel === panel));
	document.querySelectorAll("#settingsChipBar [data-panel]").forEach((el) => el.classList.toggle("is-active", el.dataset.panel === panel));
	const showUnits = panel === "units";
	const showCabinets = panel === "cabinets";
	const showGcal = panel === "gcal";
	const showPetty = panel === "petty-cash";
	document.getElementById("panel-units").style.display = showUnits ? "" : "none";
	document.getElementById("panel-cabinets").style.display = showCabinets ? "" : "none";
	document.getElementById("panel-gcal").style.display = showGcal ? "" : "none";
	document.getElementById("panel-petty-cash").style.display = showPetty ? "" : "none";
	document.getElementById("panel-pw").style.display = !showUnits && !showCabinets && !showGcal && !showPetty ? "" : "none";
	if (showUnits) renderUnitsPanel();
	if (showCabinets) initCabinetsTab();
	if (showGcal) renderGcalPanel();
	if (showPetty) renderPettyOptionsPanel();
}
async function settingsSubmitPw() {
	await submitChangePw();
	setTimeout(clearPwForm, 500);
}
function clearPwForm() {
	[
		"cpw-old",
		"cpw-new",
		"cpw-confirm"
	].forEach((id) => {
		const el = document.getElementById(id);
		if (el) el.value = "";
	});
	cpwResetChecks();
}
function initSettingsPage() {
	(async function initSettings() {
		if (!await checkAuth()) return;
		if (!canAccessPage("settings")) {
			location.href = "/";
			return;
		}
		const canUnits = hasPerm("unit-mgmt");
		const canPettyOptions = hasPerm("petty-cash-config");
		const canChangePassword = canAccessPage("change-password");
		if (!canUnits) {
			const item = document.querySelector("#settingsSideList [data-role=\"settings-side-item\"][data-panel=\"units\"]");
			if (item) item.style.display = "none";
		}
		if (!canPettyOptions) {
			const item = document.querySelector("#settingsSideList [data-role=\"settings-side-item\"][data-panel=\"petty-cash\"]");
			if (item) item.style.display = "none";
		}
		const chipBar = document.getElementById("settingsChipBar");
		if (chipBar) chipBar.innerHTML = [
			["units", "📦 單位管理"],
			["cabinets", "📦 櫃子"],
			["gcal", "📅 行事曆同步"],
			["petty-cash", "🪙 零用金選單"],
			["pw", "🔑 修改密碼"]
		].filter(([p]) => (p !== "units" || canUnits) && (p !== "petty-cash" || canPettyOptions) && (p !== "pw" || canChangePassword)).map(([p, label]) => "<span class=\"chip" + (p === "units" ? " is-active" : "") + "\" data-panel=\"" + p + "\" onclick=\"Settings.settingsSwitch('" + p + "')\">" + label + "</span>").join("");
		await Promise.all([
			loadUnits(),
			loadOrphans(),
			loadGcalPanelData(),
			loadPettyOptions()
		]);
		settingsSwitch(canUnits ? "units" : canPettyOptions ? "petty-cash" : canChangePassword ? "pw" : "gcal");
	})();
}
//#endregion
//#region static/js/pages/settings.js
window.Account = {
	cpwCheckMatch,
	cpwCheckStrength
};
window.Auth = { logout };
window.Settings = {
	addCabinet,
	addGcalReminderRow,
	addUnitFromSettings,
	applyQtySuggest,
	bindGcalUser,
	clearGcalFile,
	clearPwForm,
	closeGcalKeyModal,
	consolidateGroup,
	consolidateItem,
	createPettyOptionKind,
	deleteCabinet,
	deleteGcalKey,
	editCabinet,
	forceSyncNow,
	gcalFileSelected,
	moveUnit,
	openGcalKeyModal,
	removeGcalReminderRow,
	saveGcalSetting,
	saveKeyReminders,
	selectGcalKey,
	setUnitQtyType,
	settingsSubmitPw,
	settingsSwitch,
	submitCabinetEdit,
	submitGcalKey,
	switchGcalTab,
	toggleGcalKey,
	toggleUnit
};
window.UI = { closeModalForce };
window.__hvac = Object.freeze({
	"core/api-client.js": api_client_exports,
	"core/qty.js": qty_exports,
	"core/session.js": session_exports,
	"core/state.js": state_exports,
	"core/units.js": units_exports$1,
	"core/utils.js": utils_exports,
	"features/account/change-password.js": change_password_exports,
	"features/settings/cabinets.js": cabinets_exports,
	"features/settings/gcal-key-modal.js": gcal_key_modal_exports,
	"features/settings/gcal.js": gcal_exports,
	"features/settings/page.js": page_exports,
	"features/settings/petty-options.js": petty_options_exports,
	"features/settings/units.js": units_exports
});
initSession();
initUtils();
initSettingsPage();
initSettingsUnits();
//#endregion
