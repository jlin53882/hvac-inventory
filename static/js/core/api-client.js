// 共用 API 呼叫（issue #39）：所有頁面的 fetch 都經這裡，錯誤訊息只在一個地方處理
// 401 轉登入：主頁與設定頁的 pages/*.js 入口用 setUnauthorizedHandler 註冊處理函式（登入頁、權限頁不註冊）；
// 這裡不再覆寫 window.fetch，全域 fetch 維持原樣。
// 呼叫端負責畫面：本檔不 toast、不碰 currentTab / requestSeq 等頁面狀態

import { apiErrorMessage } from './utils.js';

let _onUnauthorized = null;

/** 註冊「任何 API 回 401」時的處理函式（例如跳登入頁）；傳 null 取消。處理後仍會照常丟出 ApiError。 */
export function setUnauthorizedHandler(handler) {
  _onUnauthorized = typeof handler === 'function' ? handler : null;
}

/** 建立 ApiError：message 已格式化可直接顯示；status 為 HTTP 狀態（網路錯誤 0）；detail 為後端原始 detail。 */
function _apiError(message, status, detail) {
  return Object.assign(new Error(message), { name: 'ApiError', status, detail });
}

/** 拆出本檔專用參數（fallback / json），其餘原樣交給 fetch；json 會帶上 JSON header 並序列化。 */
function _apiInit(options) {
  const { fallback, json, ...init } = options;
  if (json !== undefined) {
    init.headers = { 'Content-Type': 'application/json', ...(init.headers || {}) };
    init.body = JSON.stringify(json);
  }
  return { fallback, init };
}

/** 讀取回應內容；AbortError 原樣丟出，其餘讀取失敗視為網路錯誤。 */
async function _apiRead(res, read, fallback) {
  try {
    return await read();
  } catch (e) {
    if (e && e.name === 'AbortError') throw e;
    throw _apiError(fallback || '網路連線失敗，請稍後再試', res ? res.status : 0);
  }
}

/** 送出請求；非 2xx 時讀出 detail 並丟出 ApiError。 */
async function _apiSend(url, options) {
  const { fallback, init } = _apiInit(options);
  const res = await _apiRead(null, () => fetch(url, init), fallback);
  if (res.status === 401 && _onUnauthorized) _onUnauthorized(res);
  if (!res.ok) {
    const text = await _apiRead(res, () => res.text(), fallback);
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch (e) { body = null; }
    const detail = body && typeof body === 'object' ? body.detail : undefined;
    throw _apiError(apiErrorMessage(detail) || fallback || res.statusText || '操作失敗', res.status, detail);
  }
  return { res, fallback };
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
export async function apiFetch(url, options = {}) {
  const { res, fallback } = await _apiSend(url, options);
  const text = res.status === 204 || res.status === 205 ? '' : await _apiRead(res, () => res.text(), fallback);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    throw _apiError(fallback || '伺服器回應格式錯誤', res.status);
  }
}

/**
 * 下載檔案（匯出報表）：錯誤處理同 apiFetch；檔名優先用伺服器 Content-Disposition，沒有時用 filename。
 * @param {string} url API 路徑。
 * @param {RequestInit & {fallback?: string, filename: string}} options fetch 參數與預設檔名。
 * @returns {Promise<string>} 實際下載的檔名。
 */
export async function apiDownload(url, options) {
  const { filename, ...rest } = options;
  const { res, fallback } = await _apiSend(url, rest);
  const blob = await _apiRead(res, () => res.blob(), fallback);
  const disposition = res.headers.get('Content-Disposition') || '';
  const utf8Name = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  const plainName = disposition.match(/filename="?([^";]+)"?/i);
  const name = utf8Name ? decodeURIComponent(utf8Name[1]) : (plainName ? plainName[1] : filename);
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
  return name;
}
