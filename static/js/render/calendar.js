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

// ========== 頁面載入 ==========
async function renderCalendar() {
  const el = document.getElementById('content');
  const isAdmin = hasPerm('svc-type-mgmt');
  const isViewer = !hasPerm('cal-mgmt');
  el.innerHTML = `
    <div class="cal-wrap">
      <div class="cal-toolbar">
        ${isAdmin ? '<button class="cal-tb-btn" onclick="calOpenSettings()">⚙️ 設定</button>' : ''}
        <div class="cal-toolbar-mid">
          <div class="cal-title">📅 行事曆派工</div>
        </div>
        ${isViewer ? '' : '<button class="cal-tb-btn cal-tb-btn-primary" onclick="calOpenAppt()">＋ 新增派工</button>'}
      </div>
      <div class="cal-reminder" id="cal-reminder" style="display:none"></div>
      <div class="card cal-card">
        <div class="cal-month-header">
          <button class="btn-sm" onclick="calChangeMonth(-1)">◀ 上月</button>
          <h3 id="cal-month-title"></h3>
          <button class="btn-sm" onclick="calChangeMonth(1)">下月 ▶</button>
        </div>
        <div class="cal-grid" id="cal-grid"></div>
      </div>
      <div class="card cal-card">
        <div class="cal-day-header">
          <span id="cal-day-title"></span>
          <div style="display:flex;gap:6px;align-items:center">
            ${isViewer ? '' : '<button class="btn-sm btn-primary" onclick="calExport()">📤 匯出日報表</button>'}
            <input type="date" id="cal-picker" onchange="calPickDate(this.value)">
          </div>
        </div>
        <div id="cal-day-list"></div>
      </div>
    </div>
    ${calModalHtml(isAdmin)}
    ${calSettingsHtml(isAdmin)}`;
  await calLoadData();
  calRenderMonth();
  calRenderDay();
  calRenderReminder();
}

// 今日提醒條（2026-08-13 Sarah：只留左邊文字＋框，移除「看今天行程」按鈕）
function calRenderReminder() {
  const todayStr = _iso(new Date());
  const n = calEvents.filter(e => e.date === todayStr).length;
  const el = document.getElementById('cal-reminder');
  el.style.display = 'flex';
  el.innerHTML = `今天 ${_fmtTW(new Date())} 有 ${n} 筆派工`;
}

async function calLoadData() {
  const y = calMonth.getFullYear(), m = calMonth.getMonth() + 1;
  const [ev, svc, ppl] = await Promise.all([
    fetch(`/api/appointments?year=${y}&month=${m}`).then(r => r.ok ? r.json() : Promise.reject(new Error('appointments ' + r.status))),
    fetch('/api/service-types').then(r => r.ok ? r.json() : Promise.reject(new Error('service-types ' + r.status))),
    fetch('/api/assignable-users').then(r => r.ok ? r.json() : Promise.reject(new Error('assignable-users ' + r.status))),
  ]).catch(e => { console.error('[calLoadData] 行事曆資料載入失敗', e); return [[], [], []]; });
  calEvents = ev;
  calSvc = svc;
  calAssignable = ppl;
}

// ========== 月曆 ==========
function calRenderMonth() {
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
    c.onclick = () => { calSelected = new Date(y, m, d); calRenderMonth(); calRenderDay(); };
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
  const selStr = _iso(calSelected);
  const isViewer = !hasPerm('cal-mgmt');
  document.getElementById('cal-day-title').innerText = `${_fmtTW(calSelected)} · 派工明細`;
  document.getElementById('cal-picker').value = selStr;
  const list = document.getElementById('cal-day-list');
  const dayEvents = calEvents.filter(e => e.date === selStr).sort((a, b) => (a.start_time || '99:99').localeCompare(b.start_time || '99:99'));
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
        </div>
        ${isViewer ? '' : `<div class="cal-card-actions">
          <button class="btn-card btn-edit" onclick="calOpenAppt(${e.id})">編輯</button>
          <button class="btn-card btn-delete" onclick="calDeleteAppt(${e.id})">✕</button>
        </div>`}
        <div class="cal-time">${e.start_time ? `⏰ ${esc(e.start_time)}　` : ''}${who}</div>
        <div class="cal-client">${e.service_name ? `[${esc(e.service_name)}] ` : ''}${esc(e.client_name)}</div>
        ${e.address ? `<div class="cal-addr">📍 ${esc(e.address)}</div>` : ''}
        <div class="cal-note">${esc(e.note || '無備註')}</div>
      </div>
    </div>`;
  }).join('');
}

function calChangeMonth(d) {
  calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + d, 1);
  calLoadData().then(() => { calRenderMonth(); calRenderDay(); });
  if (typeof syncViewUrl === 'function') syncViewUrl();  // 2026-08-14：月份寫入 URL（F5 保留）
}

function calPickDate(v) {
  if (!v) return;
  calSelected = new Date(v);
  calMonth = new Date(v.getFullYear(), v.getMonth(), 1);
  calLoadData().then(() => { calRenderMonth(); calRenderDay(); });
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
