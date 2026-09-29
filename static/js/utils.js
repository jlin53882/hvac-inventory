// 庫存管理系統 - 工具函式（v8 拆分）
// esc / jsStr / absNum / todayStr / Modal 開關 / toast
// RBAC（2026-08-13）：前端權限判斷 helper——currentUser.permissions 由 /api/auth/me 回傳
function hasPerm(key) {
  return typeof currentUser !== 'undefined' && !!currentUser && !!(currentUser.permissions || {})[key];
}

// 密碼 policy（2026-08-16 補：對齊後端 _check_pw——至少 8 碼 + 大寫 + 小寫 + 數字）
// 通過回傳 null，否則回傳錯誤訊息（changepw.js submitChangePw 依賴此函式）
function pwPolicyMsg(pw) {
  if (!pw || pw.length < 8) return '密碼至少 8 碼';
  if (!/[A-Z]/.test(pw)) return '密碼需包含至少一個大寫字母';
  if (!/[a-z]/.test(pw)) return '密碼需包含至少一個小寫字母';
  if (!/\d/.test(pw)) return '密碼需包含至少一個數字';
  return null;
}

function esc(s) {
  return (s === null || s === undefined) ? '' :
    String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// JS 字串 literal escape（用在 inline handler 的 '...' 內，防單引號/反斜線注入 XSS）
function jsStr(s) {
  return String(s == null ? '' : s)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

// 取絕對值、四捨五入到小數 3 位並去掉結尾的 .0（例如 -3.0 → 3、0.30000000000000004 → 0.3），回傳字串
function absNum(v) {
  const n = Math.abs(Number(v));
  if (!isFinite(n)) return '';
  const r = Math.round(n * 1000) / 1000;
  return String(r).replace(/\.0$/, '');
}

// 回傳今天日期字串 YYYY-MM-DD（月份/日期自動補零）
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ========== Modal ==========
function openModal(id) {
  const el = document.getElementById(id);
  if (!el) { console.error('[openModal] modal 不存在:', id); return; }
  el.classList.add('is-open');
  // 移到 DOM 最後：所有 modal 同 z-index（200），後開的必須蓋過先開的（DOM 順序決定覆蓋）
  document.body.appendChild(el);
  _snapshotModal(id);  // M15：開啟時快照初始值（未存變更保護用）
}

// ---------- 未存變更保護（M15）：開啟快照 → 關閉前比對，有變更先確認 ----------
var __modalSnapshots = {};
function _snapshotModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const vals = [];
  el.querySelectorAll('input, select, textarea').forEach(f => vals.push(f.value));
  __modalSnapshots[id] = vals.join('\u0001');
}
function _modalDirty(id) {
  const el = document.getElementById(id);
  if (!el || !(id in __modalSnapshots)) return false;
  const vals = [];
  el.querySelectorAll('input, select, textarea').forEach(f => vals.push(f.value));
  return vals.join('\u0001') !== __modalSnapshots[id];
}
// 關閉指定 id 的 Modal（移除 show class）；有未存變更先確認
function closeModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  if (_modalDirty(id) && !confirm('有未儲存的變更，確定要離開嗎？')) return;
  el.classList.remove('is-open');
  delete __modalSnapshots[id];
}
function closeModalForce(id) {  // 儲存成功等明確動作：跳過未存變更確認
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('is-open');
  delete __modalSnapshots[id];
}
document.querySelectorAll('.modal-overlay').forEach(m => {
  m.addEventListener('click', e => { if (e.target === m) closeModal(m.id); });
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') document.querySelectorAll('.modal-overlay.is-open').forEach(m => closeModal(m.id));
});

// ========== API 錯誤與 toast ==========
/**
 * 將 FastAPI 結構化驗證錯誤轉成可直接閱讀的繁體中文訊息。
 * @param {unknown} value API detail、錯誤物件或一般訊息。
 * @returns {string} 可顯示的純文字錯誤訊息。
 */
function apiErrorMessage(value) {
  const labels = { prepared_by: '製表人', upload_person: '上傳人', filename_text: '檔名文字', start_date: '開始日期', end_date: '結束日期', opening_balance: '上期餘額', report_type: '報表類型', name: '名稱', brand: '品牌', code: '料號', unit: '單位', category: '分類', low_stock: '低庫存警示', qty: '數量', amount: '金額', item_name: '品項', description: '說明', entry_date: '日期', customer_name: '客戶名稱', quote_date: '報價日期', unit_price: '單價', note: '備註' };
  /**
   * 將單筆驗證錯誤的位置與限制轉成易讀欄位訊息。
   * @param {unknown} error FastAPI/Pydantic 回傳的驗證錯誤項目。
   * @returns {string} 單筆錯誤的繁體中文文字。
   */
  const describe = error => {
    if (typeof error === 'string') return error;
    if (!error || typeof error !== 'object') return String(error == null ? '' : error);
    const loc = Array.isArray(error.loc) ? error.loc : [];
    // 欄位取最後一個具名位置；略過 body/query 與陣列索引，避免顯示「12」「body」等無意義名稱
    const key = String([...loc].reverse().find(part => typeof part === 'string' && !['body', 'query', 'path'].includes(part)) || '');
    const field = labels[key] || key;
    const ctx = error.ctx || {};
    const messages = {
      string_too_long: `不可超過 ${ctx.max_length || '限制'} 個字`,
      string_too_short: `至少需要 ${ctx.min_length || '指定'} 個字`,
      missing: '為必填欄位',
      greater_than_equal: `不可小於 ${ctx.ge}`,
      greater_than: `必須大於 ${ctx.gt}`,
      less_than_equal: `不可大於 ${ctx.le}`,
      less_than: `必須小於 ${ctx.lt}`,
      value_error: String(error.msg || '格式不正確').replace(/^Value error,?\s*/i, ''),
      json_invalid: '資料格式錯誤，請重新整理後再試',
      union_tag_invalid: '類型不正確',
    };
    const reason = messages[error.type] || '格式不正確或不符合限制';
    return field ? `「${field}」${reason}` : reason;
  };
  if (Array.isArray(value)) return value.map(describe).filter(Boolean).join('；') || '輸入資料不符合規定';
  if (value && typeof value === 'object') return describe(value);
  return String(value == null ? '' : value);
}
/**
 * 顯示一般或結構化 API 錯誤；一律以文字呈現以避免 HTML 注入。
 * @param {unknown} msg 一般訊息或 API detail。
 * @param {string} [type] Toast 樣式類型。
 * @returns {void} 更新 toast 元素並啟動自動關閉計時。
 */
function toast(msg, type) {
  const t = document.getElementById('toast');
  t.textContent = apiErrorMessage(msg);
  t.className = 'toast is-open ' + (type || '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.className = 'toast', 3500);
}

// ========== 共用 API 呼叫 ==========
/**
 * 呼叫後端 API 並解析回應；錯誤一律丟出已格式化、可直接顯示的訊息。
 * - 經 window.fetch 送出，保留 auth.js 的 401 轉登入攔截；不處理頁面狀態、不 toast（由呼叫端決定）。
 * - 成功：204 / 205 / 空內容回傳 null，其餘回傳解析後的 JSON；成功但 JSON 格式錯誤視為失敗。
 * - 失敗：丟出 name 為 'ApiError' 的 Error：message 經 apiErrorMessage 格式化（沒有可讀訊息時用 fallback）、
 *   status 為 HTTP 狀態（網路錯誤為 0）、detail 保留後端原始 detail 供呼叫端判斷。
 * - AbortError 原樣丟出，讓呼叫端可以忽略被取消的請求。
 * - 檔案下載（blob）不適用，請直接用 fetch + res.blob()。
 * @param {string} url API 路徑。
 * @param {RequestInit & {fallback?: string}} [options] fetch 參數；fallback 為後端沒有可讀訊息時顯示的文字。
 * @returns {Promise<any>} 解析後的 JSON，沒有內容時為 null。
 */
async function apiFetch(url, options = {}) {
  const { fallback, ...init } = options;
  const fail = (message, status, detail) => Object.assign(new Error(message), { name: 'ApiError', status, detail });
  let res, text;
  try {
    res = await fetch(url, init);
    text = res.status === 204 || res.status === 205 ? '' : await res.text();
  } catch (e) {
    if (e && e.name === 'AbortError') throw e;
    throw fail(fallback || '網路連線失敗，請稍後再試', res ? res.status : 0);
  }
  let body = null, parsed = true;
  if (text) {
    try { body = JSON.parse(text); } catch (e) { parsed = false; }
  }
  if (!res.ok) {
    const detail = body && typeof body === 'object' ? body.detail : undefined;
    throw fail(apiErrorMessage(detail) || fallback || res.statusText || '操作失敗', res.status, detail);
  }
  if (!parsed) throw fail(fallback || '伺服器回應格式錯誤', res.status);
  return body;
}
