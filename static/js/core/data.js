// 庫存管理系統 - 共用資料 primitive：出庫去向建議清單（DESTINATIONS）的載入與失效
// 只做 request / 站點新鮮度 / state 更新；分頁重繪等 UI 流程在 features/shell/data-refresh.js。

import { apiFetch } from './api-client.js';
import { appState } from './state.js';
import { esc } from './utils.js';

// 載入最近 100 筆出庫紀錄的去向 → 建立 destination 下拉建議清單（DESTINATIONS）
export async function loadDestinations() {
  const siteAtRequest = appState.currentSite;
  try {
    const outs = await apiFetch(`/api/stockouts?limit=100&site=${encodeURIComponent(siteAtRequest)}`);
    if (siteAtRequest !== appState.currentSite) return;
    appState.DESTINATIONS = [...new Set(outs.map(o => o.destination).filter(Boolean))];
    appState.destinationsLoadedSite = siteAtRequest;
    document.getElementById('dest-list').innerHTML =
      appState.DESTINATIONS.map(d => `<option value="${esc(d)}">`).join('');
  } catch (e) { if (e.name !== 'AbortError') console.error('[loadDestinations] 去向清單載入失敗', e); }
}

// Mutation-triggered item reloads must discard the per-site suggestion cache before rendering forms again.
export async function refreshDestinationsAfterMutation() {
  appState.destinationsLoadedSite = '';
  appState.DESTINATIONS = [];
  const list = document.getElementById('dest-list');
  if (list) list.innerHTML = '';
  await loadDestinations();
}
