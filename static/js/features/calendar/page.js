// 庫存管理系統 - 行事曆頁外殼（issue #39 自 view.js 抽出）：組出月曆 / 當日明細 / 搜尋 / 派工與設定 modal 的版面後載入資料。
// 月曆與當日明細的繪製在 view.js；本模組是行事曆的組裝層，view / search / appt-modal 都不 import 本模組。

import { appState } from '../../core/state.js';
import { hasPerm } from '../../core/utils.js';
import { calModalHtml } from './appt-modal.js';
import { calBindSearchViewportListener, calMountSearchResults } from './search.js';
import { calSettingsHtml } from './settings-modal.js';
import { calendarState } from './state.js';
import { calLoadData, calRenderDay, calRenderKpi, calRenderLegend, calRenderMonth, calRenderReminder, calSetLoadState } from './view.js';

// ========== 頁面載入 ==========
export async function renderCalendar() {
  calendarState.calSearchMode = false;
  calendarState.calSearchItems = [];
  calendarState.calSearchMeta = { from: '', to: '', q: '' };
  calendarState.calSearchGuard.invalidate();
  calendarState.calSearchState = 'idle';
  const el = document.getElementById('content');
  const isAdmin = hasPerm('svc-type-mgmt');
  const isViewer = !hasPerm('cal-mgmt');
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
            ${isViewer ? '' : '<button class="btn btn--primary btn--md cal-header-btn" onclick="Calendar.calOpenAppt()">＋ 新增派工</button>'}
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
              ${isViewer ? '' : '<button class="btn btn--export btn--sm cal-export-btn" onclick="Calendar.calExport()">📤 匯出日報表</button>'}
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
  calSetLoadState('loading');
  const applied = await calLoadData();
  if (applied === null) return;
  // 載入期間已切到別的頁籤：月曆 DOM 已被取代，不可再寫入（否則 cal-month-title 為 null 拋錯）
  if (appState.currentTab !== 'calendar' || !document.getElementById('cal-grid')) return;
  if (calendarState.calLoadError) {
    calSetLoadState('error', calendarState.calLoadError);
  } else {
    calSetLoadState('ready');
    calRenderMonth();
    calRenderDay();
    calRenderKpi();
    calRenderLegend();
    calRenderReminder();
  }
}

// 今日提醒條（2026-08-13 Sarah：只留左邊文字＋框，移除「看今天行程」按鈕）
