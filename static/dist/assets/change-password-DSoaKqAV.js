import { F as __exportAll, c as closeModalForce, h as toast, j as appState, m as pwPolicyMsg, n as apiFetch, p as openModal } from "./api-client-VLQpIKT7.js";
//#region static/js/core/units.js
var units_exports = /* @__PURE__ */ __exportAll({
	fillUnitSelect: () => fillUnitSelect,
	filterUnitSelect: () => filterUnitSelect,
	loadUnits: () => loadUnits,
	openUnitQuickAdd: () => openUnitQuickAdd,
	unitList: () => unitList
});
var unitList = [];
async function loadUnits() {
	try {
		unitList = await apiFetch("/api/units");
		appState.unitListActive = unitList.filter((u) => u.is_active);
	} catch (e) {
		console.error("[loadUnits] /api/units 失敗", e.status, e.message);
	}
}
function fillUnitSelect(sel, current) {
	if (!sel) {
		console.error("[fillUnitSelect] select 元素不存在（id 打錯或 DOM 未建立）");
		return;
	}
	sel.innerHTML = "";
	appState.unitListActive.forEach((u) => {
		const o = document.createElement("option");
		o.value = u.name;
		o.textContent = u.name;
		sel.appendChild(o);
	});
	const cur = (current || "").trim();
	if (cur && !appState.unitListActive.some((u) => u.name === cur)) {
		const o = document.createElement("option");
		o.value = cur;
		o.textContent = `（歷史）${cur}`;
		sel.appendChild(o);
	}
	if (cur) sel.value = cur;
	return sel;
}
function filterUnitSelect(input, selId) {
	const sel = document.getElementById(selId);
	if (!sel) {
		console.error("[filterUnitSelect] select 不存在:", selId);
		return;
	}
	const kw = (input.value || "").trim();
	if (!kw) {
		fillUnitSelect(sel, sel.value);
		return;
	}
	const cur = sel.value;
	sel.innerHTML = "";
	appState.unitListActive.filter((u) => u.name.includes(kw)).forEach((u) => {
		const o = document.createElement("option");
		o.value = u.name;
		o.textContent = u.name;
		sel.appendChild(o);
	});
	if (cur && [...sel.options].some((o) => o.value === cur)) sel.value = cur;
}
function openUnitQuickAdd(sel, addBtn) {
	if (!sel) {
		console.error("[openUnitQuickAdd] select 不存在");
		return;
	}
	const wrap = sel.parentElement;
	const input = document.createElement("input");
	input.placeholder = "新單位，例如：顆";
	input.maxLength = 20;
	const ok = document.createElement("button");
	ok.textContent = "新增";
	ok.className = "btn btn--primary btn--sm";
	const cancel = document.createElement("button");
	cancel.textContent = "取消";
	cancel.className = "btn btn--secondary btn--sm";
	sel.style.display = "none";
	if (addBtn) addBtn.style.display = "none";
	const box = document.createElement("div");
	box.className = "unit-quick-add";
	box.append(input, ok, cancel);
	wrap.appendChild(box);
	input.focus();
	ok.onclick = async () => {
		const name = input.value.trim();
		if (!name) return;
		if (unitList.some((u) => u.name === name)) {
			toast(`⚠️ 單位「${name}」已存在`, "error");
			return;
		}
		try {
			const data = await apiFetch("/api/units", {
				method: "POST",
				json: { name },
				fallback: "新增失敗"
			});
			unitList.push(data);
			appState.unitListActive = unitList.filter((u) => u.is_active);
			box.remove();
			sel.style.display = "";
			if (addBtn) addBtn.style.display = "";
			fillUnitSelect(sel, name);
			toast(`✅ 單位「${name}」已新增`, "success");
		} catch (e) {
			console.error("[openUnitQuickAdd] 新增單位失敗", e);
			toast(e.message, "error");
		}
	};
	cancel.onclick = () => {
		box.remove();
		sel.style.display = "";
		if (addBtn) addBtn.style.display = "";
	};
}
//#endregion
//#region static/js/core/qty.js
var qty_exports = /* @__PURE__ */ __exportAll({
	Qty: () => Qty,
	qtyInputOrToast: () => qtyInputOrToast,
	unitKnownQty: () => unitKnownQty
});
var Qty = (function() {
	"use strict";
	var ERR_MSG = "請輸入有效數量，例如 1、0.5、1/4 或 1 1/2。";
	var MAX_DEN = 8;
	var ROUND_EPS = 1e-9;
	function gcd(a, b) {
		a = Math.abs(a);
		b = Math.abs(b);
		while (b) {
			const t = a % b;
			a = b;
			b = t;
		}
		return a || 1;
	}
	function parse(s) {
		if (s === null || s === void 0) return { error: ERR_MSG };
		const t = String(s).trim();
		if (!t) return { error: ERR_MSG };
		if (/^(NaN|Infinity|[-+]?Infinity)$/i.test(t)) return { error: ERR_MSG };
		let m;
		if (m = /^(\d+)\s+(\d+)\s*\/\s*(\d+)$/.exec(t)) {
			const w = +m[1], n = +m[2], d = +m[3];
			if (d === 0) return { error: ERR_MSG };
			const num = w * d + n, g = gcd(num, d);
			return {
				num: num / g,
				den: d / g,
				value: num / d
			};
		}
		if (m = /^(\d+)\s*\/\s*(\d+)$/.exec(t)) {
			const n = +m[1], d = +m[2];
			if (d === 0) return { error: ERR_MSG };
			const g = gcd(n, d);
			return {
				num: n / g,
				den: d / g,
				value: n / d
			};
		}
		if (/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(t)) {
			const v = Number(t);
			if (!isFinite(v)) return { error: ERR_MSG };
			if (t.indexOf(".") === -1) return {
				num: v,
				den: 1,
				value: v
			};
			const dec = t.split(".")[1].length;
			const den = Math.pow(10, dec), num = Math.round(v * den);
			const g = gcd(num, den);
			return {
				num: num / g,
				den: den / g,
				value: v
			};
		}
		return { error: ERR_MSG };
	}
	function ratToStr(num, den) {
		if (den === 1) return String(num);
		if (num > den) {
			const w = Math.floor(num / den), r = num % den;
			return r === 0 ? String(w) : w + " " + r + "/" + den;
		}
		return num + "/" + den;
	}
	function add(a, b) {
		const pa = parse(a), pb = parse(b);
		if (pa.error || pb.error) return "";
		const num = pa.num * pb.den + pb.num * pa.den, den = pa.den * pb.den;
		const g = gcd(num, den);
		return ratToStr(num / g, den / g);
	}
	function sub(a, b) {
		const pa = parse(a), pb = parse(b);
		if (pa.error || pb.error) return "";
		const num = pa.num * pb.den - pb.num * pa.den, den = pa.den * pb.den;
		if (num < 0) return "-" + ratToStr(-num / den >= 0 ? -num : 0, den);
		const g = gcd(num, den);
		return ratToStr(num / g, den / g);
	}
	function matchFrac(av, eps, maxDen) {
		let best = null;
		const denMax = maxDen || MAX_DEN;
		for (let d = 1; d <= denMax; d++) {
			const n = Math.round(av * d);
			if (Math.abs(n / d - av) < (eps || ROUND_EPS)) {
				if (!best || d < best.den) best = {
					num: n,
					den: d
				};
			}
		}
		return best;
	}
	function fracStr(best, neg) {
		const g = gcd(best.num, best.den);
		return neg + ratToStr(best.num / g, best.den / g);
	}
	function decPlaces(r3) {
		const s = String(r3);
		const i = s.indexOf(".");
		return i < 0 ? 0 : s.length - i - 1;
	}
	function autoFormat(v) {
		if (!isFinite(v)) return "0";
		const num = Number(v);
		if (num === 0) return "0";
		const neg = num < 0 ? "-" : "", av = Math.abs(num);
		const r3 = Math.round(av * 1e3) / 1e3;
		if (r3 === 0) return "0";
		if (av === r3) {
			const simple = matchFrac(av, ROUND_EPS, 8);
			if (simple) return fracStr(simple, neg);
			if (decPlaces(r3) <= 2) return neg + String(r3);
			const trunc = matchFrac(r3, 5e-4);
			if (trunc) return fracStr(trunc, neg);
			return neg + String(r3);
		}
		if (Math.abs(av - r3) < 1e-12) return neg + String(r3);
		const best = matchFrac(r3, 5e-4);
		if (!best) return neg + String(r3);
		return fracStr(best, neg);
	}
	function format(v, qtyType) {
		if (!isFinite(Number(v))) return "0";
		const n = Number(v);
		if (qtyType === "integer" && Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n));
		if (qtyType === "decimal") {
			const r = Math.round(n * 1e3) / 1e3;
			return String(r === 0 ? 0 : r);
		}
		return autoFormat(v);
	}
	function formatWithUnit(v, unit, qtyType) {
		const q = format(v, qtyType || unitTypeOf(unit));
		return unit ? q + " " + unit : q;
	}
	function unitTypeOf(unitName) {
		try {
			if (Array.isArray(unitList)) {
				const u = unitList.find((u) => u.name === unitName);
				if (u && (u.qty_type === "decimal" || u.qty_type === "fraction")) return u.qty_type;
			}
		} catch (e) {}
		return "integer";
	}
	function inputTypeOf(unitName) {
		const t = unitTypeOf(unitName);
		if (t !== "integer" || !unitName) return t;
		try {
			if (Array.isArray(unitList) && unitList.some((u) => u.name === unitName)) return t;
		} catch (e) {}
		return "fraction";
	}
	function validFor(s, qtyType) {
		const p = parse(s);
		if (p.error) return {
			ok: false,
			error: p.error
		};
		if (p.value < 0) return {
			ok: false,
			error: "數量不可為負數。"
		};
		if (qtyType === "integer" && Math.abs(p.value - Math.round(p.value)) > ROUND_EPS) return {
			ok: false,
			error: "此單位僅接受整數。"
		};
		if (qtyType === "decimal" && !/^\d+(\.\d+)?$/.test(String(s).trim())) return {
			ok: false,
			error: "此單位僅接受小數（不接受分數）。"
		};
		return {
			ok: true,
			num: p.num,
			den: p.den,
			value: p.value
		};
	}
	function disp(v, unit) {
		return format(v, unitTypeOf(unit));
	}
	function signed(v, unit) {
		const s = String(v);
		const m = /^([+-])(.*)$/.exec(s);
		if (m) return m[1] + disp(m[2], unit);
		return disp(v, unit);
	}
	return {
		ERR_MSG,
		parse,
		add,
		sub,
		format,
		formatWithUnit,
		disp,
		signed,
		unitTypeOf,
		inputTypeOf,
		validFor
	};
})();
function unitKnownQty(name) {
	try {
		return Array.isArray(unitList) && unitList.some(function(u) {
			return u.name === name;
		});
	} catch (e) {
		return false;
	}
}
function qtyInputOrToast(idOrEl, unit) {
	const el = typeof idOrEl === "string" ? document.getElementById(idOrEl) : idOrEl;
	const raw = el ? el.value : "";
	let t = unit ? Qty.inputTypeOf(unit) : "fraction";
	if (t === "integer" && unit && !unitKnownQty(unit)) t = "fraction";
	const v = Qty.validFor(raw, t);
	if (!v.ok) {
		toast(v.error, "error");
		return NaN;
	}
	return v.value;
}
//#endregion
//#region static/js/features/account/change-password.js
var change_password_exports = /* @__PURE__ */ __exportAll({
	cpwCheckMatch: () => cpwCheckMatch,
	cpwCheckStrength: () => cpwCheckStrength,
	cpwResetChecks: () => cpwResetChecks,
	openChangePwModal: () => openChangePwModal,
	submitChangePw: () => submitChangePw
});
function openChangePwModal() {
	document.getElementById("cpw-old").value = "";
	document.getElementById("cpw-new").value = "";
	document.getElementById("cpw-confirm").value = "";
	cpwResetChecks();
	document.getElementById("cpw-mismatch").style.display = "none";
	openModal("changepw-modal");
	document.getElementById("cpw-old").focus();
}
function cpwResetChecks() {
	[
		"cpw-len",
		"cpw-up",
		"cpw-low",
		"cpw-digit"
	].forEach((id) => {
		const el = document.getElementById(id);
		el.classList.remove("ok");
		el.innerHTML = "⬜ " + el.textContent.replace(/^[✅⬜]\s*/, "").trim();
	});
}
function cpwCheckStrength() {
	pwStrengthCheck("cpw-new");
}
function pwStrengthCheck(inputId) {
	const v = document.getElementById(inputId).value;
	const prefix = inputId.replace(/-new$/, "");
	const set = (suffix, ok) => {
		const el = document.getElementById(prefix + "-" + suffix);
		if (!el) return;
		const label = el.textContent.replace(/^[✅⬜]\s*/, "").trim();
		el.classList.toggle("ok", ok);
		el.innerHTML = (ok ? "✅ " : "⬜ ") + label;
	};
	set("len", v.length >= 8);
	set("up", /[A-Z]/.test(v));
	set("low", /[a-z]/.test(v));
	set("digit", /\d/.test(v));
}
function cpwCheckMatch() {
	pwMatchCheck("cpw-new", "cpw-confirm", "cpw-mismatch");
}
function pwMatchCheck(newId, confirmId, warnId) {
	const a = document.getElementById(newId).value;
	const b = document.getElementById(confirmId).value;
	document.getElementById(warnId).style.display = a && b && a !== b ? "block" : "none";
}
async function submitChangePw() {
	const oldPw = document.getElementById("cpw-old").value;
	const newPw = document.getElementById("cpw-new").value;
	const confirmPw = document.getElementById("cpw-confirm").value;
	if (!oldPw) {
		toast("請輸入目前密碼", "error");
		return;
	}
	const pwErr = pwPolicyMsg(newPw);
	if (pwErr) {
		toast(pwErr, "error");
		return;
	}
	if (newPw !== confirmPw) {
		toast("兩次輸入的新密碼不一致", "error");
		return;
	}
	if (newPw === oldPw) {
		toast("新密碼不能與原密碼相同", "error");
		return;
	}
	try {
		await apiFetch("/api/auth/password", {
			method: "PUT",
			json: {
				old_password: oldPw,
				new_password: newPw
			},
			fallback: "修改失敗"
		});
		closeModalForce("changepw-modal");
		closeModalForce("expiry-modal");
		toast("✅ 密碼已更新", "success");
	} catch (e) {
		toast(e.status ? "⚠️ " + e.message : "⚠️ 修改失敗，請稍後再試", "error");
	}
}
//#endregion
export { openChangePwModal as a, qtyInputOrToast as c, filterUnitSelect as d, loadUnits as f, units_exports as h, cpwResetChecks as i, qty_exports as l, unitList as m, cpwCheckMatch as n, submitChangePw as o, openUnitQuickAdd as p, cpwCheckStrength as r, Qty as s, change_password_exports as t, fillUnitSelect as u };
