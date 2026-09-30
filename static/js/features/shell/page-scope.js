// 主頁的頁面範圍與網址狀態（issue #39 自 shell/app.js 抽出）：body[data-page]、#content 的頁面 class、?tab/site/month。
// 只依賴 core，任何 feature 都可以使用而不必 import shell 的組裝層。

import { appState } from '../../core/state.js';

// 頁面範圍（CSS 架構重構 P1）：body[data-page] 是頁面樣式的唯一範圍，modal 也在 body 內。
// 過渡期同時維護 #content 上的舊 *-content class；每次都先全部移除，避免上一頁的 class 殘留
// （例：報價單上傳的 quotation-upload-content 曾在切回庫存後殘留，改掉庫存頁內距）。
var PAGE_CONTENT_CLASS = {
  'signed-reports': 'dsr-content',
  'calendar': 'cal-content',
  'quotation': 'quotation-content',
  'quotation-upload': 'quotation-upload-content',
  'petty-cash': 'pc-content',
  'inventory': 'inventory-content',
  'prepared': 'prepared-content',
  'kit': 'kit-content',
  'stocktake': 'stocktake-content',
  'stockout': 'stockout-content',
  'work-progress': 'wpr-content'
};

export function setPageScope(page) {
  if (page) document.body.dataset.page = page;
  else delete document.body.dataset.page;
  var content = document.getElementById('content');
  if (!content) return;
  Object.keys(PAGE_CONTENT_CLASS).forEach(function(key) {
    content.classList.toggle(PAGE_CONTENT_CLASS[key], key === page);
  });
}

export function syncViewUrl() {
  var p = new URLSearchParams();
  p.set('tab', appState.currentTab);
  p.set('site', appState.currentSite);
  var cm = (typeof appState.calMonth !== 'undefined') ? appState.calMonth : new Date();
  p.set('month', cm.getFullYear() + '-' + String(cm.getMonth() + 1).padStart(2, '0'));
  history.replaceState(null, '', '?' + p.toString());
}
