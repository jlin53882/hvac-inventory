// 「最新請求優先」守衛（防舊回應覆蓋新畫面）
// 原本每個頁面各自手寫 `var xxxSeq = 0; const id = ++xxxSeq; ... if (id !== xxxSeq) return;`，
// 計數器散落成十幾個模組層變數；集中成一個小工具，命名與用法一致。
//
// 用法：
//   const listGuard = createRequestGuard();
//   async function load() {
//     const token = listGuard.next();          // 開新一輪，舊的 token 立即失效
//     const data = await apiFetch(...);
//     if (!listGuard.isCurrent(token)) return; // 期間又有新請求 / 被 invalidate → 丟棄
//   }
//   listGuard.invalidate();                    // 不開新請求，只讓進行中的請求作廢（例如離開頁面）

/** 建立一個獨立的請求守衛；每個守衛各自計數，互不影響。 */
export function createRequestGuard() {
  let current = 0;
  return {
    /** 開新一輪並回傳 token；先前發出的 token 全部失效。 */
    next() { return ++current; },
    /** token 是否仍是最新一輪。 */
    isCurrent(token) { return token === current; },
    /** 讓進行中的請求全部作廢，但不開新一輪。 */
    invalidate() { current += 1; },
  };
}

/**
 * 依 key 分開計數的請求守衛：同一頁有多個獨立區塊（例如每份報告的詳情面板）各自「最新請求優先」時使用。
 * 用法：
 *   const detailGuard = createKeyedRequestGuard();
 *   const token = detailGuard.next(key);        // 該 key 開新一輪，只讓同一 key 舊的 token 失效
 *   if (!detailGuard.isCurrent(key, token)) return;
 *   detailGuard.invalidateAll();                // 離開頁面：所有 key 進行中的請求全部作廢
 */
export function createKeyedRequestGuard() {
  let epoch = 0;              // invalidateAll 會換世代，之前發出的 token 一律失效（不會和清空後重新計數的 token 撞號）
  const counters = new Map();
  return {
    /** 該 key 開新一輪並回傳 token。 */
    next(key) {
      const count = (counters.get(key) || 0) + 1;
      counters.set(key, count);
      return epoch + ':' + count;
    },
    /** token 是否仍是該 key 最新一輪。 */
    isCurrent(key, token) { return token === epoch + ':' + (counters.get(key) || 0); },
    /** 所有 key 進行中的請求全部作廢。 */
    invalidateAll() { epoch += 1; counters.clear(); },
  };
}
