// 庫存管理系統 - 行事曆派工頁（v1：月曆 + 當日明細 + 防衝突 + 匯出日報表 + 設定）
// 資料來源：/api/appointments、/api/service-types、/api/assignable-users
// 行事曆狀態在 core/state.js（calMonth、CAL_*）與 features/calendar/state.js（calendarState）
// renderCalendar 會呼叫 calModalHtml / calSettingsHtml（features/calendar/appt-modal.js、settings-modal.js）

import { apiDownload, apiFetch } from '../../core/api-client.js';
import { CAL_PALETTE, CAL_WEEK, appState } from '../../core/state.js';
import { esc, hasPerm, toast } from '../../core/utils.js';
import { calModalHtml } from './appt-modal.js';
import { _fmtTW, _iso, _parseLocalDate, _syncCalendarDateControls, calFmtCreatedAt } from './format.js';
import { calApplyRightPanelMode, calBindSearchViewportListener, calIsDesktopViewport, calMountSearchResults, calRenderMobileSearchResults, calRenderSearchResults } from './search.js';
import { calSettingsHtml } from './settings-modal.js';
import { calendarState } from './state.js';
import { calCanRetryPersonal, calPersonalSync, calSyncStatusIcon, calSyncStatusLabel, calTeamSyncLabel } from './sync-status.js';
import { syncViewUrl } from '../shell/app.js';

const CAL_SERVICE_TONES = {
  '施工': 'blue',
  '維修': 'green',
  '場勘': 'amber',
  '保養': 'purple',
};

export function calServiceTone(name) {
  return CAL_SERVICE_TONES[name] || 'slate';
}

// ========== 頁面載入 ==========
export async function renderCalendar() {
  calendarState.calSearchMode = false;
  calendarState.calSearchItems = [];
  calendarState.calSearchMeta = { from: '', to: '', q: '' };
  calendarState.calSearchRequestToken += 1;
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
function calRenderReminder() {
  const n = calendarState.calTodayEvents.length;
  const el = document.getElementById('cal-reminder');
  el.style.display = 'flex';
  el.innerHTML = `<span aria-hidden="true">📅</span><span>今天 ${_fmtTW(new Date())} 有 ${n} 筆派工</span>`;
}

export async function calLoadData() {
  const requestToken = ++calendarState.calLoadRequestToken;
  const y = appState.calMonth.getFullYear(), m = appState.calMonth.getMonth() + 1;
  const today = new Date();
  const todayStr = _iso(today);
  const monthEventsPromise = apiFetch(`/api/appointments?year=${y}&month=${m}`);
  const todayEventsPromise = y === today.getFullYear() && m === today.getMonth() + 1
    ? monthEventsPromise
    : apiFetch(`/api/appointments?date=${todayStr}`);
  calendarState.calLoadError = '';
  try {
    const [ev, svc, ppl, todayEv] = await Promise.all([
      monthEventsPromise,
      apiFetch('/api/service-types'),
      apiFetch('/api/assignable-users'),
      todayEventsPromise,
    ]);
    if (requestToken !== calendarState.calLoadRequestToken) return null;
    calendarState.calEvents = ev;
    calendarState.calTodayEvents = todayEv.filter(e => e.date === todayStr);
    calendarState.calSvc = svc;
    calendarState.calAssignable = ppl;
    return true;
  } catch (e) {
    if (requestToken !== calendarState.calLoadRequestToken) return null;
    calendarState.calLoadError = '行事曆資料載入失敗，請重新載入。';
    console.error('[calLoadData] 行事曆資料載入失敗', e);
    calendarState.calEvents = [];
    calendarState.calTodayEvents = [];
    calendarState.calSvc = [];
    calendarState.calAssignable = [];
    return false;
  }
}

function calRenderLoadingUi() {
  const kpi = document.getElementById('cal-kpi-grid');
  const grid = document.getElementById('cal-grid');
  const list = document.getElementById('cal-day-list');
  const legend = document.getElementById('cal-legend');
  const helper = document.getElementById('cal-helper-panel');
  if (legend) { legend.style.display = 'none'; legend.innerHTML = ''; }
  if (helper) { helper.style.display = 'none'; helper.innerHTML = ''; }
  if (kpi) kpi.innerHTML = Array.from({length: 3}, () => '<div class="cal-kpi-card ui-kpi-card ui-kpi-card--stacked cal-skeleton-card" aria-hidden="true"><span></span><strong></strong></div>').join('');
  if (grid) {
    // 骨架列數跟著要載入的月份，避免沿用上個月的 --cal-week-count 讓格子擠在一起或留白
    const first = new Date(appState.calMonth.getFullYear(), appState.calMonth.getMonth(), 1).getDay();
    const total = new Date(appState.calMonth.getFullYear(), appState.calMonth.getMonth() + 1, 0).getDate();
    const weeks = Math.ceil((first + total) / 7);
    grid.style.setProperty('--cal-week-count', String(weeks));
    grid.innerHTML = CAL_WEEK.map((w, index) => '<div class="cal-weekday' + (index === 0 || index === 6 ? ' cal-weekend' : '') + '">' + esc(w) + '</div>').join('')
      + Array.from({length: weeks * 7}, () => '<div class="cal-cell cal-skeleton-cell" aria-hidden="true"></div>').join('');
  }
  if (list) list.innerHTML = '<div class="cal-skeleton-detail" aria-hidden="true"><span></span><span></span><span></span><span></span></div>';
}

function calRenderErrorUi(message) {
  const grid = document.getElementById('cal-grid');
  const list = document.getElementById('cal-day-list');
  const legend = document.getElementById('cal-legend');
  const helper = document.getElementById('cal-helper-panel');
  if (legend) { legend.style.display = 'none'; legend.innerHTML = ''; }
  if (helper) { helper.style.display = 'none'; helper.innerHTML = ''; }
  if (grid) grid.innerHTML = `<div class="cal-inline-error"><span>⚠️ ${esc(message || '載入失敗')}</span></div>`;
  if (list) list.innerHTML = '<div class="cal-empty-state cal-error-state"><div class="cal-empty-icon" aria-hidden="true">⚠️</div><strong>載入派工資料失敗</strong><p>請按上方「重新載入」再試一次。</p></div>';
}

export function calSetLoadState(state, message) {
  const el = document.getElementById('cal-load-state');
  if (!el) return;
  if (state === 'loading') {
    el.className = 'cal-load-state is-loading';
    el.innerHTML = '<span class="cal-spinner" aria-hidden="true"></span><span>載入派工資料中...</span>';
    calRenderLoadingUi();
  } else if (state === 'error') {
    el.className = 'cal-load-state is-error';
    el.innerHTML = `<span>⚠️ ${esc(message || '載入失敗')}</span><button class="btn btn--secondary btn--sm btn-sm" onclick="Calendar.calRetryLoad()">重新載入</button>`;
    calRenderErrorUi(message);
  } else {
    el.className = 'cal-load-state';
    el.innerHTML = '';
  }
}

export async function calRetryLoad() {
  calSetLoadState('loading');
  const applied = await calLoadData();
  if (applied === null) return;
  if (calendarState.calLoadError) return calSetLoadState('error', calendarState.calLoadError);
  calSetLoadState('ready');
  calRenderMonth();
  calRenderDay();
  calRenderKpi();
  calRenderLegend();
  calRenderReminder();
}

function calRenderKpi() {
  const selectedStr = _iso(calendarState.calSelected);
  const cards = [
    { label: '今日派工', value: calendarState.calTodayEvents.length, meta: `今日共 ${calendarState.calTodayEvents.length} 筆派工`, tone: 'blue' },
    { label: '本月派工', value: calendarState.calEvents.length, meta: `${appState.calMonth.getFullYear()} 年 ${appState.calMonth.getMonth() + 1} 月（共 ${calendarState.calEvents.length} 筆）`, tone: 'indigo' },
  ];
  const el = document.getElementById('cal-kpi-grid');
  if (!el) return;
  el.innerHTML = cards.map(card => {
    const meta = `<span class="cal-kpi-meta ui-kpi-meta">${esc(card.meta)}</span>`;
    return `<div class="cal-kpi-card ui-kpi-card ui-kpi-card--stacked ui-kpi-card--${esc(card.tone)} cal-kpi-${esc(card.tone)}"><span class="cal-kpi-label ui-kpi-label">${esc(card.label)}</span><strong class="ui-kpi-value">${esc(card.value)}</strong>${meta}</div>`;
  }).join('');
}

function calRenderLegend() {
  const el = document.getElementById('cal-legend');
  if (!el) return;
  const services = (calendarState.calSvc || []).filter(s => s && s.name && s.is_active !== 0);
  if (!services.length) {
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }
  el.style.display = 'flex';
  el.innerHTML = services.map(s => `<span class="cal-legend-item"><i class="cal-legend-dot cal-service-${esc(calServiceTone(s.name))}" aria-hidden="true"></i>${esc(s.name)}</span>`).join('');
}

function calRenderHelper(dayEvents) {
  const el = document.getElementById('cal-helper-panel');
  if (!el) return;
  if (dayEvents.length > 1) {
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }
  el.style.display = 'block';
  el.innerHTML = '<strong>💡 小提醒</strong><ul><li>點擊日期可查看當天派工</li><li>可從右上角匯出日報表</li></ul>';
}

// ========== 月曆 ==========
/**
 * 依月份實際需要的完整週數繪製月曆，避免固定六週多顯示隔月日期。
 * @returns {void} 更新月曆格與桌面列數。
 */
export function calRenderMonth() {
  if (calendarState.calLoadError) return;
  const y = appState.calMonth.getFullYear(), m = appState.calMonth.getMonth();
  document.getElementById('cal-month-title').innerText = `${y} 年 ${m + 1} 月`;
  const grid = document.getElementById('cal-grid');
  grid.innerHTML = '';
  CAL_WEEK.forEach((w, index) => {
    const l = document.createElement('div');
    l.className = 'cal-weekday' + (index === 0 || index === 6 ? ' cal-weekend' : '');
    l.innerText = w;
    grid.appendChild(l);
  });
  const first = new Date(y, m, 1).getDay();
  const total = new Date(y, m + 1, 0).getDate();
  const prevTotal = new Date(y, m, 0).getDate();
  for (let i = first; i > 0; i--) {
    const c = document.createElement('div');
    c.className = 'cal-cell cal-other';
    c.innerHTML = `<span class="cal-day-num">${prevTotal - i + 1}</span>`;
    grid.appendChild(c);
  }
  const selStr = _iso(calendarState.calSelected);
  for (let d = 1; d <= total; d++) {
    const ds = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const c = document.createElement('div');
    const isToday = ds === _iso(new Date());
    const dayOfWeek = new Date(y, m, d).getDay();
    c.className = 'cal-cell'
      + (ds === selStr ? ' cal-selected' : '')
      + (isToday ? ' cal-today' : '')
      + (dayOfWeek === 0 || dayOfWeek === 6 ? ' cal-weekend-cell' : '');
    c.innerHTML = `<span class="cal-day-num">${d}</span>`;
    c.onclick = () => {
      calendarState.calSelected = new Date(y, m, d);
      _syncCalendarDateControls();
      calRenderMonth();
      calRenderDay();
    };
    const evts = calendarState.calEvents.filter(e => e.date === ds)
      // 2026-08-14：空時間排最後（未指定時間的派工排在當天行程尾）
      .sort((a, b) => (a.start_time || '99:99').localeCompare(b.start_time || '99:99'));
    // 月曆格以時間、服務類型與客戶摘要呈現，沿用既有事件資料。
    evts.slice(0, 2).forEach(e => {
      const t = document.createElement('span');
      t.className = 'cal-evt cal-service-' + calServiceTone(e.service_name);
      // Desktop compact event：時間、服務與客戶同列，cell 內不換行不溢出。
      if (e.start_time) {
        const timeEl = document.createElement('span');
        timeEl.className = 'cal-evt-time';
        timeEl.textContent = e.start_time;
        t.appendChild(timeEl);
      }
      const bodyEl = document.createElement('span');
      bodyEl.className = 'cal-evt-body';
      bodyEl.textContent = (e.service_name ? `${e.service_name} ` : '') + (e.client_name || '');
      t.appendChild(bodyEl);
      c.appendChild(t);
    });
    if (evts.length > 2) {
      const t = document.createElement('span');
      t.className = 'cal-evt cal-evt-more';
      t.innerText = `+${evts.length - 2} 筆`;
      c.appendChild(t);
    }
    grid.appendChild(c);
  }
  const weeks = Math.ceil((first + total) / 7);
  grid.style.setProperty('--cal-week-count', String(weeks));
  const trailing = weeks * 7 - first - total;
  for (let i = 1; i <= trailing; i++) {
    const c = document.createElement('div');
    c.className = 'cal-cell cal-other';
    c.innerHTML = `<span class="cal-day-num">${i}</span>`;
    grid.appendChild(c);
  }
}

export function calRenderDay() {
  _syncCalendarDateControls();
  const selStr = _iso(calendarState.calSelected);
  const isViewer = !hasPerm('cal-mgmt');
  document.getElementById('cal-day-title').innerText = `${_fmtTW(calendarState.calSelected)} · 派工明細`;
  document.getElementById('cal-picker').value = selStr;
  const list = document.getElementById('cal-day-list');
  if (calendarState.calSearchMode) {
    calApplyRightPanelMode();
    if (calIsDesktopViewport()) calRenderSearchResults(calendarState.calSearchItems);
    else calRenderMobileSearchResults(calendarState.calSearchItems);
    return;
  }
  const dayEvents = calendarState.calEvents.filter(e => e.date === selStr)
    .sort((a, b) => (a.start_time || '99:99').localeCompare(b.start_time || '99:99'));
  const countEl = document.getElementById('cal-day-count');
  if (countEl) countEl.textContent = `${dayEvents.length} 筆派工`;
  calRenderKpi();
  calRenderHelper(dayEvents);
  if (!dayEvents.length) {
    list.className = '';
    list.innerHTML = `<div class="cal-empty-state"><div class="cal-empty-icon" aria-hidden="true">▣</div><strong>當天沒有其他派工</strong>${isViewer ? '' : '<p>點擊上方「＋ 新增派工」建立新的行程</p>'}</div>`;
    return;
  }
  list.className = 'cal-timeline';
  list.innerHTML = dayEvents.map(e => {
    const who = (e.assignees || []).map(p =>
      `<span class="cal-who"><span class="cal-who-dot" style="background:${esc(p.color) || CAL_PALETTE[0]}"></span>${esc(p.name || '')}</span>`).join(' ');
    const service = e.service_name
      ? `<span class="cal-service-badge cal-service-${esc(calServiceTone(e.service_name))}">${esc(e.service_name)}</span>` : '';
    const personal = calPersonalSync(e);
    const personalLabel = `${calSyncStatusLabel(personal.status)}${personal.migration_pending ? '（行事曆切換中）' : ''}`;
    const hasSyncErr = personal.error && ['failed', 'partial_failed', 'retrying', 'partial_retrying'].includes(personal.status);
    const isAssigned = e.is_assigned_to_me !== false;
    const personalSync = isAssigned && personal.status && personal.status !== 'none'
      ? (hasSyncErr
        ? `<button type="button" class="cal-sync-status cal-sync-${esc(personal.status)} cal-sync-clickable" onclick="Calendar.calShowSyncError(${e.id})" title="點擊查看我的同步錯誤">${esc(calSyncStatusIcon(personal.status))}<span class="cal-sync-label">${esc(personalLabel)}</span></button>`
        : `<span class="cal-sync-status cal-sync-${esc(personal.status)}" title="${esc(personalLabel)}">${esc(calSyncStatusIcon(personal.status))}<span class="cal-sync-label">${esc(personalLabel)}</span></span>`)
      : (isAssigned ? '' : '');
    const myRetry = isAssigned && calCanRetryPersonal(personal)
      ? `<button type="button" class="btn btn--secondary btn--sm" onclick="Calendar.calRetryMySync(${e.id})">重試我的</button>` : '';
    const canViewTeamSync = hasPerm('gcal-sync-team-view');
    const teamLabel = canViewTeamSync ? calTeamSyncLabel(e.team_sync) : '';
    const teamSync = teamLabel
      ? `<button type="button" class="cal-sync-status cal-sync-team cal-sync-clickable" onclick="Calendar.calShowTeamSyncDetails(${e.id})" title="查看全員同步細節">${esc(teamLabel)}</button>` : '';
    const sync = personalSync || myRetry || teamSync ? `${personalSync}${myRetry}${teamSync}` : '';

    const updated = e.updated_by_name && e.updated_by_name !== (e.created_by_name || '系統')
      ? `<span>最後編輯：${esc(e.updated_by_name)}</span>` : '';
    return `
    <div class="cal-tl-row">
      <span class="cal-tl-dot"></span>
      <div class="cal-event-card">
        <div class="cal-event-top">
          <div class="cal-time"><span aria-hidden="true">⏰</span> ${esc(e.start_time || '未指定時間')}</div>
          <div class="cal-event-badges">${service}${sync}</div>
        </div>
        <div class="cal-client">${esc(e.client_name)}</div>
        ${who ? `<div class="cal-assignees">${who}</div>` : ''}
        ${e.address ? `<div class="cal-addr">📍 ${esc(e.address)}</div>` : ''}
        ${e.note ? `<div class="cal-note">${esc(e.note)}</div>` : ''}
        <div class="cal-event-footer">
          <div class="cal-created-meta"><span>建立：${esc(e.created_by_name || '系統')} · ${esc(calFmtCreatedAt(e.created_at))}</span>${updated}</div>
          ${isViewer ? '' : `<div class="cal-card-actions">
            <button class="btn btn--secondary btn--sm cal-icon-btn btn-edit" onclick="Calendar.calOpenAppt(${e.id})" aria-label="編輯派工" title="編輯派工"><span class="cal-action-icon">✎</span><span class="cal-action-label">編輯</span></button>
            <button class="btn btn--danger btn--sm cal-icon-btn btn-delete" onclick="Calendar.calDeleteAppt(${e.id})" aria-label="刪除派工" title="刪除派工"><span class="cal-action-icon">🗑</span><span class="cal-action-label">刪除</span></button>
          </div>`}
        </div>
      </div>
    </div>`;
  }).join('');
}

export function calChangeMonth(d) {
  appState.calMonth = new Date(appState.calMonth.getFullYear(), appState.calMonth.getMonth() + d, 1);
  calSetLoadState('loading');
  calLoadData().then(applied => {
    if (applied === null) return;
    if (calendarState.calLoadError) return calSetLoadState('error', calendarState.calLoadError);
    calSetLoadState('ready');
    calRenderMonth();
    calRenderDay();
    calRenderKpi();
    calRenderLegend();
  });
  syncViewUrl();  // 2026-08-14：月份寫入 URL（F5 保留）
}

export function calPickToday() {
  calPickDate(_iso(new Date()));
}

// 日檢視「前一天／後一天」
export function calShiftDay(delta) {
  calPickDate(_iso(new Date(calendarState.calSelected.getFullYear(), calendarState.calSelected.getMonth(), calendarState.calSelected.getDate() + delta)));
}

export function calPickDate(v) {
  const selected = _parseLocalDate(v);
  if (!selected || isNaN(selected.getTime())) return;
  calendarState.calSelected = selected;
  appState.calMonth = new Date(selected.getFullYear(), selected.getMonth(), 1);
  _syncCalendarDateControls();
  calSetLoadState('loading');
  calLoadData().then(applied => {
    if (applied === null) return;
    if (calendarState.calLoadError) return calSetLoadState('error', calendarState.calLoadError);
    calSetLoadState('ready');
    calRenderMonth();
    calRenderDay();
    calRenderKpi();
    calRenderLegend();
  });
  syncViewUrl();  // 2026-08-14：月份寫入 URL（F5 保留）
}

/**
 * 匯出目前行事曆日期的 Excel；API 錯誤以可讀欄位訊息顯示。
 * @returns {Promise<void>} 匯出成功後啟動下載，失敗時顯示提示。
 */
export async function calExport() {
  const date = _iso(calendarState.calSelected);
  const mmdd = date.slice(5, 7) + date.slice(8, 10);
  try {
    await apiDownload(`/api/appointments/export?date=${date}`, { filename: `工程日報表${mmdd}.xlsx`, fallback: '匯出失敗' });
    toast(`📤 已匯出 工程日報表${mmdd}.xlsx`);
  } catch (e) {
    toast(e.status ? '❌ ' + e.message : '⚠️ 匯出失敗：' + e.message);
  }
}
