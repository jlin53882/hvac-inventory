// qty.js — 共用數量 domain（2026-09-12 單位管理 + 數量系統重設計）
// 整數 / 小數 / 自由分數：parse、精確有理數運算、依單位類型顯示、整組可組數。
// 依賴：無（純函式，可被 node 測試）。掛載：index.html / settings.html（utils.js 之後）。
// 呼叫端以 Qty.unitTypeOf(unitName) 查單位類型；未知/歷史單位回 'integer'（維持現行行為，不鎖死）。
var Qty = (function() {
  'use strict';

  var ERR_MSG = '請輸入有效數量，例如 1、0.5、1/4 或 1 1/2。';
  var MAX_DEN = 8;       // 分數還原用最大分母（1/8、5/8 可還原；1/9 以上維持小數）
  var ROUND_EPS = 1e-9;  // 有理數比對容差

  function gcd(a, b) {
    a = Math.abs(a); b = Math.abs(b);
    while (b) { const t = a % b; a = b; b = t; }
    return a || 1;
  }

  // 解析合法數量字串 → {num, den, value}；非法 → {error}
  // 接受：3 / 0.5 / 0.25 / 1/4 / 2/3 / 1 1/2 / 前後空白；拒絕：1/0、abc、1//4、NaN、Infinity、1abc
  function parse(s) {
    if (s === null || s === undefined) return { error: ERR_MSG };
    const t = String(s).trim();
    if (!t) return { error: ERR_MSG };
    if (/^(NaN|Infinity|[-+]?Infinity)$/i.test(t)) return { error: ERR_MSG };
    let m;
    // 帶分數：1 1/2（整數與分數間至少一空白）
    if ((m = /^(\d+)\s+(\d+)\s*\/\s*(\d+)$/.exec(t))) {
      const w = +m[1], n = +m[2], d = +m[3];
      if (d === 0) return { error: ERR_MSG };
      const num = w * d + n, g = gcd(num, d);
      return { num: num / g, den: d / g, value: num / d };
    }
    // 分數：1/4
    if ((m = /^(\d+)\s*\/\s*(\d+)$/.exec(t))) {
      const n = +m[1], d = +m[2];
      if (d === 0) return { error: ERR_MSG };
      const g = gcd(n, d);
      return { num: n / g, den: d / g, value: n / d };
    }
    // 整數 / 小數（整個字串必須是合法數字，防 "1abc" 被 parseFloat 吃成 1）
    if (/^\d+(\.\d+)?$/.test(t)) {
      const v = Number(t);
      if (!isFinite(v)) return { error: ERR_MSG };
      if (t.indexOf('.') === -1) return { num: v, den: 1, value: v };
      const dec = t.split('.')[1].length;
      const den = Math.pow(10, dec), num = Math.round(v * den);
      const g = gcd(num, den);
      return { num: num / g, den: den / g, value: v };
    }
    return { error: ERR_MSG };
  }

  function ratToStr(num, den) {
    if (den === 1) return String(num);
    if (num > den) {
      const w = Math.floor(num / den), r = num % den;
      return r === 0 ? String(w) : w + ' ' + r + '/' + den;
    }
    return num + '/' + den;
  }

  // 精確加減（整數分子運算，無浮點漂移）；輸入為字串或數字，回傳顯示字串
  function add(a, b) {
    const pa = parse(a), pb = parse(b);
    if (pa.error || pb.error) return '';
    const num = pa.num * pb.den + pb.num * pa.den, den = pa.den * pb.den;
    const g = gcd(num, den);
    return ratToStr(num / g, den / g);
  }
  function sub(a, b) {
    const pa = parse(a), pb = parse(b);
    if (pa.error || pb.error) return '';
    const num = pa.num * pb.den - pb.num * pa.den, den = pa.den * pb.den;
    if (num < 0) return '-' + ratToStr(-num / den >= 0 ? -num : 0, den);
    const g = gcd(num, den);
    return ratToStr(num / g, den / g);
  }

  // 自動顯示：先用原始值配分數（1/3 存 float 仍可還原），再 round-3 配分數
  // （0.1+0.2 殘留 → 0.3 → 3/10）；都配不上 → 小數（去尾零，最多 3 位，對齊現行 absNum）
  function matchFrac(av) {
    let best = null;
    for (let d = 1; d <= MAX_DEN; d++) {
      const n = Math.round(av * d);
      if (Math.abs(n / d - av) < ROUND_EPS) {
        if (!best || d < best.den) best = { num: n, den: d };
      }
    }
    return best;
  }
  function autoFormat(v) {
    if (!isFinite(v)) return '0';
    const num = Number(v);
    if (num === 0) return '0';
    const neg = num < 0 ? '-' : '', av = Math.abs(num);
    let best = matchFrac(av);
    if (!best) {
      const r3 = Math.round(av * 1000) / 1000;
      if (r3 === 0) return '0';
      best = matchFrac(r3);
      if (!best) return neg + String(r3);
    }
    const g = gcd(best.num, best.den);
    return neg + ratToStr(best.num / g, best.den / g);
  }

  // 依單位類型顯示：integer→整數；decimal→小數；fraction→分數還原；未知→auto
  function format(v, qtyType) {
    if (!isFinite(Number(v))) return '0';
    if (qtyType === 'integer') return String(Math.round(Number(v)));
    if (qtyType === 'decimal') {
      const r = Math.round(Number(v) * 1000) / 1000;
      return String(r);
    }
    return autoFormat(v);
  }

  function formatWithUnit(v, unit, qtyType) {
    const q = format(v, qtyType || unitTypeOf(unit));
    return unit ? q + ' ' + unit : q;
  }

  // 單位類型查詢：unitList（units.js）有載入則查表；未知/歷史單位回 integer（維持現行行為）
  function unitTypeOf(unitName) {
    try {
      if (typeof unitList !== 'undefined' && Array.isArray(unitList)) {
        const u = unitList.find(u => u.name === unitName);
        if (u && (u.qty_type === 'decimal' || u.qty_type === 'fraction')) return u.qty_type;
      }
    } catch (e) { /* 查表失敗 → integer */ }
    return 'integer';
  }

  // 輸入是否符合該單位類型（integer：值為整數；decimal：小數禁分數；fraction：三者皆可）
  function validFor(s, qtyType) {
    const p = parse(s);
    if (p.error) return { ok: false, error: p.error };
    if (p.value < 0) return { ok: false, error: '數量不可為負數。' };
    if (qtyType === 'integer' && Math.abs(p.value - Math.round(p.value)) > ROUND_EPS) {
      return { ok: false, error: '此單位僅接受整數。' };
    }
    if (qtyType === 'decimal' && !/^\d+(\.\d+)?$/.test(String(s).trim())) {
      return { ok: false, error: '此單位僅接受小數（不接受分數）。' };
    }
    return { ok: true, num: p.num, den: p.den, value: p.value };
  }


  // 顯示速記：依單位類型 format（Qty 未載入時回退舊 absNum 語意由呼叫端處理）
  function disp(v, unit) {
    return format(v, unitTypeOf(unit));
  }
  // 含正負號顯示（已領出 +/-delta 字串或數字皆可）
  function signed(v, unit) {
    const s = String(v);
    const m = /^([+-])(.*)$/.exec(s);
    if (m) return m[1] + disp(m[2], unit);
    return disp(v, unit);
  }

  return {
    ERR_MSG: ERR_MSG,
    parse: parse, add: add, sub: sub,
    format: format, formatWithUnit: formatWithUnit,
    disp: disp, signed: signed,
    unitTypeOf: unitTypeOf, validFor: validFor
  };
})();

// 表單數量取值共用（2026-09-12）：嚴格 parse，非法 toast 中文訊息並回 NaN（呼叫端既有 !qty 檢查接住）。
// 歷史/未知單位降級為 fraction（不鎖死既有出庫/待領出流程；units.js「歷史補 option」同哲學）。
function unitKnownQty(name) {
  try {
    return typeof unitList !== 'undefined' && Array.isArray(unitList) &&
      unitList.some(function(u) { return u.name === name; });
  } catch (e) { return false; }
}
function qtyInputOrToast(elId, unit) {
  const el = document.getElementById(elId);
  const raw = el ? el.value : '';
  if (typeof Qty === 'undefined') return parseFloat(raw);
  let t = unit ? Qty.unitTypeOf(unit) : 'fraction';
  if (t === 'integer' && unit && !unitKnownQty(unit)) t = 'fraction';
  const v = Qty.validFor(raw, t);
  if (!v.ok) { toast(v.error, 'error'); return NaN; }
  return v.value;
}
