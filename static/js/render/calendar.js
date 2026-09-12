// 庫存管理系統 - 行事曆派工頁（v1：月曆 + 當日明細 + 防衝突 + 匯出日報表 + 設定）
// 資料來源：/api/appointments、/api/service-types、/api/assignable-users
// 行事曆狀態（calMonth/calSelected/calEvents/calSvc/calAssignable/CAL_PALETTE/CAL_WEEK）已移至 globals.js（2026-08-16 拆檔）
// renderCalendar 執行期呼叫 calModalHtml/calSettingsHtml（modals/calendar.js + modals/calendar-settings.js，defer 全載後解析）

function _iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function _fmtTW(d) {
  return `${d.getMonth() + 1}月${d.getDate()}日 週${CAL_WEEK[d.getDay()]}`;
}

function _parseLocalDate(value) {
  if (value instanceof Date) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  const parts = String(value || '').split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function _syncCalendarDateControls() {
  const selected = _iso(calSelected);
  const searchFrom = document.getElementById('cal-search-from');
  const picker = document.getElementById('cal-picker');
  if (searchFrom) searchFrom.value = selected;
  if (picker) picker.value = selected;
}

// Search is a right-panel mode, not a new page-level section.
var calSearchMode = false;
var calSearchItems = [];
var calSearchMeta = { from: '', to: '', q: '' };
var calSearchRequestToken = 0;
var calSearchState = 'idle';
var calSearchViewportBound = false;

const CAL_SERVICE_TONES = {
  '施工': 'blue',
  '維修': 'green',
  '場勘': 'amber',
  '保養': 'purple',
};

function calServiceTone(name) {
  return CAL_SERVICE_TONES[name] || 'slate';
}

function calSyncStatusLabel(status) {
  return status === 'synced' ? '已同步到 Google 行事曆'
    : status === 'partial_failed' ? '部分同步失敗'
    : status === 'pending' ? '等待同步'
    : status === 'failed' ? '同步失敗'
    : '未綁定同步 Key';
}

function calSyncStatusIcon(status) {
  return status === 'synced' ? '✅'
    : status === 'partial_failed' ? '⚠️'
    : status === 'pending' ? '⏳'
    : status === 'failed' ? '❌' : '';
}

// ========== 頁面載入 ==========
async function renderCalendar() {
  calSearchMode = false;
  calSearchItems = [];
  calSearchMeta = { from: '', to: '', q: '' };
  calSearchRequestToken += 1;
  calSearchState = 'idle';
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
          <label class="cal-field"><span>開始日期</span><input type="date" id="cal-search-from" aria-label="開始日期" onchange="calPickDate(this.value)"></label>
          <label class="cal-field"><span>結束日期</span><input type="date" id="cal-search-to" aria-label="結束日期"></label>
          <label class="cal-field cal-keyword-field"><span>關鍵字</span><input type="text" id="cal-search-q" placeholder="搜尋客戶、地址或備註..." aria-label="行事曆關鍵字搜尋" onkeydown="if(event.key === 'Enter') calSearch()"></label>
          <div class="cal-header-actions">
            <button class="cal-header-btn cal-search-submit" onclick="calSearch()" aria-label="搜尋">搜尋</button>
            <button class="cal-header-btn cal-clear-btn" onclick="calClearSearch()" aria-label="清除搜尋">清除</button>
            ${isViewer ? '' : '<button class="cal-header-btn cal-primary-action" onclick="calOpenAppt()">＋ 新增派工</button>'}
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
              <button class="btn-sm" onclick="calChangeMonth(-1)">◀ 上月</button>
              <button class="btn-sm cal-today-inline" onclick="calPickDate(_iso(new Date()))">今天</button>
              <h3 id="cal-month-title"></h3>
              <button class="btn-sm" onclick="calChangeMonth(1)">下月 ▶</button>
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
                <button class="cal-icon-btn" onclick="calPickDate(_iso(new Date(calSelected.getFullYear(), calSelected.getMonth(), calSelected.getDate() - 1)))" aria-label="前一天" title="前一天">◀</button>
                <input type="date" id="cal-picker" onchange="calPickDate(this.value)">
                <button class="cal-icon-btn" onclick="calPickDate(_iso(new Date(calSelected.getFullYear(), calSelected.getMonth(), calSelected.getDate() + 1)))" aria-label="後一天" title="後一天">▶</button>
              </div>
              ${isViewer ? '' : '<button class="btn-sm btn-primary cal-export-btn" onclick="calExport()">📤 匯出日報表</button>'}
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
  if (calLoadError) {
    calSetLoadState('error', calLoadError);
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
  const n = calTodayEvents.length;
  const el = document.getElementById('cal-reminder');
  el.style.display = 'flex';
  el.innerHTML = `<span aria-hidden="true">📅</span><span>今天 ${_fmtTW(new Date())} 有 ${n} 筆派工</span>`;
}

async function calLoadData() {
  const requestToken = ++calLoadRequestToken;
  const y = calMonth.getFullYear(), m = calMonth.getMonth() + 1;
  const today = new Date();
  const todayStr = _iso(today);
  const monthEventsPromise = fetch(`/api/appointments?year=${y}&month=${m}`).then(r => r.ok ? r.json() : Promise.reject(new Error('appointments ' + r.status)));
  const todayEventsPromise = y === today.getFullYear() && m === today.getMonth() + 1
    ? monthEventsPromise
    : fetch(`/api/appointments?date=${todayStr}`).then(r => r.ok ? r.json() : Promise.reject(new Error('today appointments ' + r.status)));
  calLoadError = '';
  try {
    const [ev, svc, ppl, todayEv] = await Promise.all([
      monthEventsPromise,
      fetch('/api/service-types').then(r => r.ok ? r.json() : Promise.reject(new Error('service-types ' + r.status))),
      fetch('/api/assignable-users').then(r => r.ok ? r.json() : Promise.reject(new Error('assignable-users ' + r.status))),
      todayEventsPromise,
    ]);
    if (requestToken !== calLoadRequestToken) return null;
    calEvents = ev;
    calTodayEvents = todayEv.filter(e => e.date === todayStr);
    calSvc = svc;
    calAssignable = ppl;
    return true;
  } catch (e) {
    if (requestToken !== calLoadRequestToken) return null;
    calLoadError = '行事曆資料載入失敗，請重新載入。';
    console.error('[calLoadData] 行事曆資料載入失敗', e);
    calEvents = [];
    calTodayEvents = [];
    calSvc = [];
    calAssignable = [];
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
  if (grid) grid.innerHTML = Array.from({length: 42}, () => '<div class="cal-cell cal-skeleton-cell" aria-hidden="true"></div>').join('');
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

function calSetLoadState(state, message) {
  const el = document.getElementById('cal-load-state');
  if (!el) return;
  if (state === 'loading') {
    el.className = 'cal-load-state is-loading';
    el.innerHTML = '<span class="cal-spinner" aria-hidden="true"></span><span>載入派工資料中...</span>';
    calRenderLoadingUi();
  } else if (state === 'error') {
    el.className = 'cal-load-state is-error';
    el.innerHTML = `<span>⚠️ ${esc(message || '載入失敗')}</span><button class="btn-sm" onclick="calRetryLoad()">重新載入</button>`;
    calRenderErrorUi(message);
  } else {
    el.className = 'cal-load-state';
    el.innerHTML = '';
  }
}

async function calRetryLoad() {
  calSetLoadState('loading');
  const applied = await calLoadData();
  if (applied === null) return;
  if (calLoadError) return calSetLoadState('error', calLoadError);
  calSetLoadState('ready');
  calRenderMonth();
  calRenderDay();
  calRenderKpi();
  calRenderLegend();
  calRenderReminder();
}

function calFormatKpiDate(date) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} · 週${CAL_WEEK[date.getDay()]}`;
}

function calRenderKpi() {
  const selectedStr = _iso(calSelected);
  const cards = [
    { label: '今日派工', value: calTodayEvents.length, meta: `今日共 ${calTodayEvents.length} 筆派工`, tone: 'blue' },
    { label: '本月派工', value: calEvents.length, meta: `${calMonth.getFullYear()} 年 ${calMonth.getMonth() + 1} 月（共 ${calEvents.length} 筆）`, tone: 'indigo' },
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
  const services = (calSvc || []).filter(s => s && s.name && s.is_active !== 0);
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
function calRenderMonth() {
  if (calLoadError) return;
  const y = calMonth.getFullYear(), m = calMonth.getMonth();
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
  const selStr = _iso(calSelected);
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
      calSelected = new Date(y, m, d);
      _syncCalendarDateControls();
      calRenderMonth();
      calRenderDay();
    };
    const evts = calEvents.filter(e => e.date === ds)
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
  // Desktop grid keeps six complete week rows so month height never jumps.
  const trailing = 42 - first - total;
  for (let i = 1; i <= trailing; i++) {
    const c = document.createElement('div');
    c.className = 'cal-cell cal-other';
    c.innerHTML = `<span class="cal-day-num">${i}</span>`;
    grid.appendChild(c);
  }
}

// ========== 當日明細 ==========
function calFmtCreatedAt(s) {
  // created_at 為 UTC（sqlite CURRENT_TIMESTAMP）→ 轉本地顯示
  if (!s) return '';
  const d = new Date(s.replace(' ', 'T') + 'Z');
  if (isNaN(d)) return String(s).slice(0, 16);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function calRenderDay() {
  _syncCalendarDateControls();
  const selStr = _iso(calSelected);
  const isViewer = !hasPerm('cal-mgmt');
  document.getElementById('cal-day-title').innerText = `${_fmtTW(calSelected)} · 派工明細`;
  document.getElementById('cal-picker').value = selStr;
  const list = document.getElementById('cal-day-list');
  if (calSearchMode) {
    calApplyRightPanelMode();
    if (calIsDesktopViewport()) calRenderSearchResults(calSearchItems);
    else calRenderMobileSearchResults(calSearchItems);
    return;
  }
  const dayEvents = calEvents.filter(e => e.date === selStr)
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
      `<span class="cal-who"><span class="cal-who-dot" style="background:${esc(p.color) || '#1a73e8'}"></span>${esc(p.name || '')}</span>`).join(' ');
    const service = e.service_name
      ? `<span class="cal-service-badge cal-service-${esc(calServiceTone(e.service_name))}">${esc(e.service_name)}</span>` : '';
    const sync = e.sync_status && e.sync_status !== 'none'
      ? `<span class="cal-sync-status cal-sync-${esc(e.sync_status)}" title="${esc(calSyncStatusLabel(e.sync_status))}">${esc(calSyncStatusIcon(e.sync_status))}<span class="cal-sync-label">${esc(calSyncStatusLabel(e.sync_status).replace('到 Google 行事曆', ''))}</span></span>` : '';
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
        <div class="cal-note">${esc(e.note || '無備註')}</div>
        <div class="cal-event-footer">
          <div class="cal-created-meta"><span>建立：${esc(e.created_by_name || '系統')} · ${esc(calFmtCreatedAt(e.created_at))}</span>${updated}</div>
          ${isViewer ? '' : `<div class="cal-card-actions">
            <button class="cal-icon-btn btn-edit" onclick="calOpenAppt(${e.id})" aria-label="編輯派工" title="編輯派工"><span class="cal-action-icon">✎</span><span class="cal-action-label">編輯</span></button>
            <button class="cal-icon-btn btn-delete" onclick="calDeleteAppt(${e.id})" aria-label="刪除派工" title="刪除派工"><span class="cal-action-icon">🗑</span><span class="cal-action-label">刪除</span></button>
          </div>`}
        </div>
      </div>
    </div>`;
  }).join('');
}

function calChangeMonth(d) {
  calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + d, 1);
  calSetLoadState('loading');
  calLoadData().then(applied => {
    if (applied === null) return;
    if (calLoadError) return calSetLoadState('error', calLoadError);
    calSetLoadState('ready');
    calRenderMonth();
    calRenderDay();
    calRenderKpi();
    calRenderLegend();
  });
  if (typeof syncViewUrl === 'function') syncViewUrl();  // 2026-08-14：月份寫入 URL（F5 保留）
}

function calPickDate(v) {
  const selected = _parseLocalDate(v);
  if (!selected || isNaN(selected.getTime())) return;
  calSelected = selected;
  calMonth = new Date(selected.getFullYear(), selected.getMonth(), 1);
  _syncCalendarDateControls();
  calSetLoadState('loading');
  calLoadData().then(applied => {
    if (applied === null) return;
    if (calLoadError) return calSetLoadState('error', calLoadError);
    calSetLoadState('ready');
    calRenderMonth();
    calRenderDay();
    calRenderKpi();
    calRenderLegend();
  });
  if (typeof syncViewUrl === 'function') syncViewUrl();  // 2026-08-14：月份寫入 URL（F5 保留）
}

async function calExport() {
  const date = _iso(calSelected);
  try {
    const res = await fetch(`/api/appointments/export?date=${date}`);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      toast('❌ ' + (d.detail || '匯出失敗'));
      return;
    }
    const blob = await res.blob();
    const mmdd = date.slice(5, 7) + date.slice(8, 10);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `工程日報表${mmdd}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast(`📤 已匯出 工程日報表${mmdd}.xlsx`);
  } catch (e) {
    toast('⚠️ 匯出失敗：' + e.message);
  }
}

// ========== 設定（admin）==========

// ========== 行事曆搜尋 ==========
function calIsDesktopViewport() {
  return typeof window.matchMedia !== 'function'
    || window.matchMedia('(min-width: 768px)').matches;
}

function calMountSearchResults() {
  const results = document.getElementById('cal-search-results');
  if (!results) return calIsDesktopViewport();
  const desktop = calIsDesktopViewport();
  const target = document.getElementById(desktop ? 'cal-search-panel-slot' : 'cal-search-top-slot');
  if (target && results.parentElement !== target) target.appendChild(results);
  return desktop;
}

function calBindSearchViewportListener() {
  if (calSearchViewportBound || typeof window.matchMedia !== 'function') return;
  const media = window.matchMedia('(min-width: 768px)');
  if (typeof media.addEventListener === 'function') {
    media.addEventListener('change', calHandleSearchViewportChange);
  } else if (typeof media.addListener === 'function') {
    media.addListener(calHandleSearchViewportChange);
  }
  calSearchViewportBound = true;
}

function calHandleSearchViewportChange() {
  calMountSearchResults();
  if (!calSearchMode) return;
  if (calSearchState === 'loading') {
    calRenderSearchLoading();
  } else if (calSearchState === 'error') {
    calRenderSearchError();
  } else if (calSearchState === 'ready') {
    if (calIsDesktopViewport()) calRenderSearchResults(calSearchItems);
    else calRenderMobileSearchResults(calSearchItems);
  } else {
    calApplyRightPanelMode();
  }
}

function calApplyRightPanelMode() {
  const desktop = calMountSearchResults();
  const panel = document.getElementById('cal-day-panel');
  const results = document.getElementById('cal-search-results');
  const list = document.getElementById('cal-day-list');
  const helper = document.getElementById('cal-helper-panel');
  if (!panel || !results) return;
  if (!desktop) {
    panel.classList.remove('cal-search-mode');
    results.style.display = calSearchMode ? 'block' : 'none';
    if (list) list.style.display = '';
    return;
  }
  panel.classList.toggle('cal-search-mode', calSearchMode);
  results.style.display = calSearchMode ? 'flex' : 'none';
  if (list) list.style.display = calSearchMode ? 'none' : '';
  if (helper && calSearchMode) helper.style.display = 'none';
}

function calSearchDateLabel(dateStr) {
  const date = _parseLocalDate(dateStr);
  if (!date || isNaN(date.getTime())) return String(dateStr || '');
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${CAL_WEEK[date.getDay()]}`;
}

function calSearchRangeLabel(meta) {
  if (meta.from && meta.to) return `${esc(meta.from)} ～ ${esc(meta.to)}`;
  if (meta.from) return `自 ${esc(meta.from)}`;
  if (meta.to) return `至 ${esc(meta.to)}`;
  return '全部日期';
}

function calRenderSearchLoading() {
  calSearchMode = true;
  calSearchState = 'loading';
  calApplyRightPanelMode();
  const el = document.getElementById('cal-search-results');
  if (!el) return;
  el.innerHTML = '<div class="cal-search-panel-header"><div class="cal-search-header-row"><strong>🔍 搜尋結果</strong><span class="cal-search-count">搜尋中...</span></div><div class="cal-search-meta">正在載入符合條件的派工</div></div><div class="cal-search-list"><div class="cal-search-skeleton" aria-hidden="true"><span></span><span></span><span></span></div></div>';
}

function calRenderSearchError() {
  calSearchMode = true;
  calSearchState = 'error';
  calApplyRightPanelMode();
  const el = document.getElementById('cal-search-results');
  if (!el) return;
  el.innerHTML = '<div class="cal-search-panel-header"><div class="cal-search-header-row"><strong>🔍 搜尋結果</strong><button class="cal-search-exit" type="button" onclick="calClearSearch()">× 結束搜尋</button></div><div class="cal-search-meta">搜尋派工失敗</div></div><div class="cal-search-empty"><div class="cal-empty-icon" aria-hidden="true">⚠️</div><strong>搜尋派工失敗</strong><p>請重新搜尋或調整條件。</p><button class="btn-sm" type="button" onclick="calSearch()">重新搜尋</button></div>';
}

function calRenderSearchResults(items) {
  const el = document.getElementById('cal-search-results');
  if (!el) return;
  calSearchMode = true;
  calSearchState = 'ready';
  calApplyRightPanelMode();
  const meta = calSearchMeta || { from: '', to: '', q: '' };
  const keyword = meta.q ? `「${esc(meta.q)}」` : '全部條件';
  const range = calSearchRangeLabel(meta);
  const list = Array.isArray(items) ? items : [];
  const itemHtml = list.map(e => {
    const service = e.service_name
      ? `<span class="cal-service-badge cal-service-${esc(calServiceTone(e.service_name))}">${esc(e.service_name)}</span>` : '';
    const assignees = (e.assignees || []).map(a => esc(a.name || '')).filter(Boolean).join('、');
    const assigneeHtml = assignees ? `<span>👤 ${assignees}</span>` : '';
    const addressHtml = e.address ? `<span>📍 ${esc(e.address)}</span>` : '';
    const noteHtml = e.note ? `<span>📝 ${esc(e.note)}</span>` : '';
    return `<article class="cal-search-item" data-date="${esc(e.date || '')}" role="button" tabindex="0" onclick="calJumpToDate(this.dataset.date)" onkeydown="if(event.key === 'Enter' || event.key === ' ') this.click()"><div class="cal-search-item-date"><span>${esc(calSearchDateLabel(e.date))}</span><strong>${esc(e.start_time || '未指定時間')}</strong></div><div class="cal-search-item-body"><div class="cal-search-item-title">${esc(e.client_name || '未命名派工')}</div><div class="cal-search-item-tags">${service}${assigneeHtml}</div><div class="cal-search-item-extra">${addressHtml}${noteHtml}</div></div></article>`;
  }).join('');
  const body = itemHtml || '<div class="cal-search-empty"><div class="cal-empty-icon" aria-hidden="true">🔍</div><strong>沒有符合條件的派工</strong><p>請調整日期或關鍵字後重新搜尋。</p><button class="btn-sm" type="button" onclick="calClearSearch()">清除搜尋</button></div>';
  el.innerHTML = `<div class="cal-search-panel-header"><div class="cal-search-header-row"><strong>🔍 搜尋結果</strong><span class="cal-search-count">共 ${list.length} 筆</span><button class="cal-search-exit" type="button" onclick="calClearSearch()">× 結束搜尋</button></div><div class="cal-search-meta">${keyword} · ${range}</div></div><div class="cal-search-list">${body}</div>`;
}

// Mobile keeps the previous page-level result presentation; Desktop uses the right-panel mode above.
function calRenderMobileSearchResults(items) {
  const el = document.getElementById('cal-search-results');
  if (!el) return;
  calSearchMode = true;
  calSearchState = 'ready';
  calApplyRightPanelMode();
  el.style.display = 'block';
  if (!items.length) {
    el.innerHTML = '<div style="padding:16px;text-align:center;color:#888;font-size:13px">找不到符合條件的行程</div>';
    return;
  }
  let html = '<div style="padding:8px 0;font-size:12px;color:#666">找到 ' + items.length + ' 筆結果</div>';
  items.forEach(function(e) {
    const names = (e.assignees || []).map(function(a) { return esc(a.name); }).join('、');
    html += '<div class="cal-search-item" style="padding:10px 12px;border-bottom:1px solid #f0f0f0;cursor:pointer" data-date="' + esc(e.date) + '" onclick="calJumpToDate(this.dataset.date)">' +
      '<div style="font-weight:600;font-size:13px">' + esc(e.client_name) + '</div>' +
      '<div style="font-size:12px;color:#666;margin-top:2px">' +
      (esc(e.date) || '') + (e.start_time ? ' ' + esc(e.start_time) + (e.end_time ? '~' + esc(e.end_time) : '') : '') +
      (e.service_name ? ' [' + esc(e.service_name) + ']' : '') +
      '</div>' +
      (names ? '<div style="font-size:11px;color:#888;margin-top:2px">👤 ' + names + '</div>' : '') +
      (e.address ? '<div style="font-size:11px;color:#888">📍 ' + esc(e.address) + '</div>' : '') +
      (e.note ? '<div style="font-size:11px;color:#888">📝 ' + esc(e.note) + '</div>' : '') +
      '</div>';
  });
  el.innerHTML = html;
}

async function calSearch() {
  const from = document.getElementById('cal-search-from').value;
  const to = document.getElementById('cal-search-to').value;
  const q = document.getElementById('cal-search-q').value.trim();
  const requestToken = ++calSearchRequestToken;
  if (!from && !to && !q) { toast('請輸入搜尋條件', 'error'); return; }
  const desktop = calIsDesktopViewport();
  calSearchMeta = { from, to, q };
  if (desktop) calRenderSearchLoading();
  const params = new URLSearchParams();
  if (from) params.set('date_from', from);
  if (to) params.set('date_to', to);
  if (q) params.set('q', q);
  try {
    const res = await fetch('/api/appointments/search?' + params);
    if (requestToken !== calSearchRequestToken) return;
    if (!res.ok) {
      if (calIsDesktopViewport()) calRenderSearchError();
      else toast('搜尋失敗', 'error');
      return;
    }
    const items = await res.json();
    if (requestToken !== calSearchRequestToken) return;
    calSearchItems = Array.isArray(items) ? items : [];
    if (calIsDesktopViewport()) calRenderSearchResults(calSearchItems);
    else calRenderMobileSearchResults(calSearchItems);
  } catch (err) {
    if (requestToken !== calSearchRequestToken) return;
    console.error('[calSearch]', err);
    if (calIsDesktopViewport()) calRenderSearchError();
    else toast('搜尋失敗', 'error');
  }
}

function calClearSearch() {
  document.getElementById('cal-search-to').value = '';
  document.getElementById('cal-search-q').value = '';
  // Preserve existing semantics: the start date defaults to calSelected via sync below.
  calSearchRequestToken += 1;
  calSearchMode = false;
  calSearchItems = [];
  calSearchMeta = { from: '', to: '', q: '' };
  calSearchState = 'idle';
  calApplyRightPanelMode();
  _syncCalendarDateControls();
  calRenderDay();
}

function calJumpToDate(dateStr) {
  calSearchRequestToken += 1;
  calSearchMode = false;
  calSearchItems = [];
  calSearchMeta = { from: '', to: '', q: '' };
  calSearchState = 'idle';
  calApplyRightPanelMode();
  calPickDate(dateStr);
}
