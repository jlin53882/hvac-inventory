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

// ========== 頁面載入 ==========
async function renderCalendar() {
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
      <div class="cal-kpi-grid" id="cal-kpi-grid" aria-label="派工統計"></div>
      <div id="cal-search-results" class="cal-search-results" style="display:none"></div>
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
        </section>
        <section class="card cal-card cal-day-card" aria-label="選取日期派工明細">
          <div class="cal-day-header">
            <div>
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
          <div id="cal-day-list"></div>
        </section>
      </div>
    </div>
    ${calModalHtml(isAdmin)}
    ${calSettingsHtml(isAdmin)}`;
  calSetLoadState('loading');
  await calLoadData();
  if (calLoadError) {
    calSetLoadState('error', calLoadError);
  } else {
    calSetLoadState('ready');
    calRenderMonth();
    calRenderDay();
    calRenderKpi();
    calRenderReminder();
  }
}

// 今日提醒條（2026-08-13 Sarah：只留左邊文字＋框，移除「看今天行程」按鈕）
function calRenderReminder() {
  const todayStr = _iso(new Date());
  const n = calTodayEvents.length;
  const el = document.getElementById('cal-reminder');
  el.style.display = 'flex';
  el.innerHTML = `今天 ${_fmtTW(new Date())} 有 ${n} 筆派工`;
}

async function calLoadData() {
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
    calEvents = ev;
    calTodayEvents = todayEv;
    calSvc = svc;
    calAssignable = ppl;
  } catch (e) {
    calLoadError = '行事曆資料載入失敗，請重新載入。';
    console.error('[calLoadData] 行事曆資料載入失敗', e);
    calEvents = [];
    calTodayEvents = [];
    calSvc = [];
    calAssignable = [];
  }
}

function calSetLoadState(state, message) {
  const el = document.getElementById('cal-load-state');
  if (!el) return;
  if (state === 'loading') {
    el.className = 'cal-load-state is-loading';
    el.innerHTML = '<span class="cal-spinner" aria-hidden="true"></span><span>載入派工資料中...</span>';
  } else if (state === 'error') {
    el.className = 'cal-load-state is-error';
    el.innerHTML = `<span>⚠️ ${esc(message || '載入失敗')}</span><button class="btn-sm" onclick="calRetryLoad()">重新載入</button>`;
  } else {
    el.className = 'cal-load-state';
    el.innerHTML = '';
  }
}

async function calRetryLoad() {
  calSetLoadState('loading');
  await calLoadData();
  if (calLoadError) return calSetLoadState('error', calLoadError);
  calSetLoadState('ready');
  calRenderMonth();
  calRenderDay();
  calRenderKpi();
  calRenderReminder();
}

function calRenderKpi() {
  const selectedStr = _iso(calSelected);
  const selectedCount = calEvents.filter(e => e.date === selectedStr).length;
  const cards = [
    { label: '今日派工', value: calTodayEvents.length, tone: 'blue' },
    { label: '本月派工', value: calEvents.length, tone: 'indigo' },
    { label: '目前日期', value: selectedCount, tone: 'slate' },
  ];
  const el = document.getElementById('cal-kpi-grid');
  if (!el) return;
  el.innerHTML = cards.map(card => `<div class="cal-kpi-card cal-kpi-${esc(card.tone)}"><span class="cal-kpi-label">${esc(card.label)}</span><strong>${esc(card.value)}</strong></div>`).join('');
}

// ========== 月曆 ==========
function calRenderMonth() {
  if (calLoadError) return;
  const y = calMonth.getFullYear(), m = calMonth.getMonth();
  document.getElementById('cal-month-title').innerText = `${y} 年 ${m + 1} 月`;
  const grid = document.getElementById('cal-grid');
  grid.innerHTML = '';
  CAL_WEEK.forEach(w => {
    const l = document.createElement('div');
    l.className = 'cal-weekday';
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
    // 2026-08-14 家豪：今天完全不標記（變體 A）——不再產生「今天」class，只有選中的日期有框
    c.className = 'cal-cell' + (ds === selStr ? ' cal-selected' : '');
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
    // 2026-08-13 Sarah：月曆格顯示「時間 [服務] 客戶」（原只顯示時間+人員；右邊明細內容寫進左邊格子）
    evts.slice(0, 2).forEach(e => {
      const t = document.createElement('span');
      t.className = 'cal-evt';
      t.style.background = ((e.assignees || [])[0] && (e.assignees[0].color)) || '#1a73e8';
      // 2026-08-14 家豪 B 方案：時間獨立一行（粗體）＋ 服務/客戶一行截斷（cell 內不換行不溢出）
      if (e.start_time) {
        const timeEl = document.createElement('span');
        timeEl.className = 'cal-evt-time';
        timeEl.textContent = e.start_time;
        t.appendChild(timeEl);
      }
      const bodyEl = document.createElement('span');
      bodyEl.className = 'cal-evt-body';
      bodyEl.textContent = (e.service_name ? `[${e.service_name}] ` : '') + (e.client_name || '');
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
  const dayEvents = calEvents.filter(e => e.date === selStr).sort((a, b) => (a.start_time || '99:99').localeCompare(b.start_time || '99:99'));
  const countEl = document.getElementById('cal-day-count');
  if (countEl) countEl.textContent = `${dayEvents.length} 筆派工`;
  calRenderKpi();
  if (!dayEvents.length) {
    list.className = '';
    list.innerHTML = '<div class="empty">這天沒有派工行程' + (isViewer ? '' : '<br>點右上「＋ 新增派工」排一筆') + '</div>';
    return;
  }
  list.className = 'cal-timeline';
  list.innerHTML = dayEvents.map(e => {
    const who = (e.assignees || []).map(p =>
      `<span class="cal-who"><span class="cal-who-dot" style="background:${esc(p.color) || '#1a73e8'}"></span>${esc(p.name || '')}</span>`).join(' ');
    return `
    <div class="cal-tl-row">
      <span class="cal-tl-dot"></span>
      <div class="cal-event-card">
        <div class="cal-creator">
          <span>📝 由 ${esc(e.created_by_name || '系統')} 新增</span>
          ${(e.updated_by_name && e.updated_by_name !== (e.created_by_name || '系統')) ? `<span>✏️ 由 ${esc(e.updated_by_name)} 編輯</span>` : ''}
          <span>${calFmtCreatedAt(e.created_at)}</span>
          <span class="cal-sync-status" title="${e.sync_status === 'synced' ? '已同步到 Google 行事曆' : e.sync_status === 'partial_failed' ? '部分同步失敗' : e.sync_status === 'pending' ? '等待同步' : e.sync_status === 'failed' ? '同步失敗' : '未綁定同步 Key'}">${e.sync_status === 'synced' ? '✅' : e.sync_status === 'partial_failed' ? '⚠️' : e.sync_status === 'pending' ? '⏳' : e.sync_status === 'failed' ? '❌' : ''}</span>
        </div>
        <div class="cal-head">
          <div class="cal-head-col">
            <div class="cal-time">${e.start_time ? `⏰ ${esc(e.start_time)}　` : ''}${who}</div>
            <div class="cal-client">${e.service_name ? `[${esc(e.service_name)}] ` : ''}${esc(e.client_name)}</div>
          </div>
          ${isViewer ? '' : `<div class="cal-card-actions">
            <button class="cal-icon-btn btn-edit" onclick="calOpenAppt(${e.id})" aria-label="編輯派工" title="編輯派工"><span class="cal-action-icon">✎</span><span class="cal-action-label">編輯</span></button>
            <button class="cal-icon-btn btn-delete" onclick="calDeleteAppt(${e.id})" aria-label="刪除派工" title="刪除派工"><span class="cal-action-icon">🗑</span><span class="cal-action-label">刪除</span></button>
          </div>`}
        </div>
        ${e.address ? `<div class="cal-addr">📍 ${esc(e.address)}</div>` : ''}
        <div class="cal-note">${esc(e.note || '無備註')}</div>
      </div>
    </div>`;
  }).join('');
}

function calChangeMonth(d) {
  calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + d, 1);
  calSetLoadState('loading');
  calLoadData().then(() => {
    if (calLoadError) return calSetLoadState('error', calLoadError);
    calSetLoadState('ready');
    calRenderMonth();
    calRenderDay();
    calRenderKpi();
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
  calLoadData().then(() => {
    if (calLoadError) return calSetLoadState('error', calLoadError);
    calSetLoadState('ready');
    calRenderMonth();
    calRenderDay();
    calRenderKpi();
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
async function calSearch() {
  var from = document.getElementById('cal-search-from').value;
  var to = document.getElementById('cal-search-to').value;
  var q = document.getElementById('cal-search-q').value.trim();
  if (!from && !to && !q) { toast('請輸入搜尋條件', 'error'); return; }
  var params = new URLSearchParams();
  if (from) params.set('date_from', from);
  if (to) params.set('date_to', to);
  if (q) params.set('q', q);
  try {
    var res = await fetch('/api/appointments/search?' + params);
    if (!res.ok) { toast('搜尋失敗', 'error'); return; }
    var items = await res.json();
    var el = document.getElementById('cal-search-results');
    el.style.display = 'block';
    if (!items.length) {
      el.innerHTML = '<div style="padding:16px;text-align:center;color:#888;font-size:13px">找不到符合條件的行程</div>';
      return;
    }
    var html = '<div style="padding:8px 0;font-size:12px;color:#666">找到 ' + items.length + ' 筆結果</div>';
    items.forEach(function(e) {
      var names = (e.assignees || []).map(function(a){ return esc(a.name); }).join('、');
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
  } catch (err) {
    console.error('[calSearch]', err);
    toast('搜尋失敗', 'error');
  }
}

function calQuickFilter(label, button) {
  document.getElementById('cal-search-q').value = label;
  document.querySelectorAll('.cal-quick-filter').forEach(function(el) { el.classList.remove('active'); });
  if (button) button.classList.add('active');
  calSearch();
}

function calClearSearch() {
  document.getElementById('cal-search-to').value = '';
  document.getElementById('cal-search-q').value = '';
  document.querySelectorAll('.cal-quick-filter').forEach(function(el) { el.classList.remove('active'); });
  document.getElementById('cal-search-results').style.display = 'none';
  _syncCalendarDateControls();
}

function calJumpToDate(dateStr) {
  calPickDate(dateStr);
  setTimeout(function() {
    var card = document.querySelector('.cal-month-card');
    if (card) card.scrollIntoView({behavior:'smooth'});
  }, 0);
}
