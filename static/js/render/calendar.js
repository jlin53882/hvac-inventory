// 庫存管理系統 - 行事曆派工頁（v1：月曆 + 當日明細 + 防衝突 + 匯出日報表 + 設定）
// 資料來源：/api/appointments、/api/service-types、/api/assignable-users

// ========== 行事曆狀態 ==========
let calMonth = new Date();       // 目前顯示的月份
let calSelected = new Date();    // 選取的日期
let calEvents = [];              // 當月/當日行程
let calSvc = [];                 // 服務項目字典（全部，含停用）
let calAssignable = [];          // 可指派人員

const CAL_PALETTE = ['#1a73e8', '#e91e63', '#9c27b0', '#2e7d32', '#f57c00', '#00838f', '#c62828', '#5d4037'];
const CAL_WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const CAL_SVC_FIELDS = { '保養': 'D', '維修': 'F', '安裝': 'H', '配管': 'J' };  // 日報表欄位名位置（匯出提示用）

function _iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function _fmtTW(d) {
  return `${d.getMonth() + 1}月${d.getDate()}日 週${CAL_WEEK[d.getDay()]}`;
}
function _calPerson(id) {
  return calAssignable.find(p => p.id === id);
}
function _calSvcName(id) {
  const s = calSvc.find(x => x.id === id);
  return s ? s.name : '?';
}

// ========== 頁面載入 ==========
async function renderCalendar() {
  const el = document.getElementById('content');
  const isAdmin = currentUser && currentUser.role === 'admin';
  const isViewer = currentUser && currentUser.role === 'viewer';
  el.innerHTML = `
    <div class="cal-wrap">
      <div class="cal-toolbar">
        <div>
          <div class="cal-title">📅 行事曆派工</div>
          <div class="cal-sub" id="cal-today-str"></div>
        </div>
        <div class="cal-toolbar-btns">
          ${isAdmin ? '<button class="btn-sm btn-primary" onclick="calOpenSettings()">⚙️ 設定</button>' : ''}
          ${isViewer ? '' : '<button class="btn-sm btn-primary" onclick="calOpenAppt()">＋ 新增派工</button>'}
        </div>
      </div>
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
}

function calModalHtml(isAdmin) {
  return `
  <div class="modal-overlay" id="cal-appt-modal" style="display:none">
    <div class="modal">
      <h3 id="cal-appt-title">➕ 新增派工</h3>
      <div class="cal-conflict" id="cal-appt-conflict"></div>
      <input type="hidden" id="cal-f-id">
      <div class="form-row">
        <label>負責人員（可勾多位＝一起出勤）</label>
        <div class="cal-person-list" id="cal-f-users"></div>
      </div>
      <div class="form-row">
        <label>服務項目</label>
        <select id="cal-f-svc"></select>
      </div>
      <div class="form-row">
        <label>客戶姓名與戶號 / 案場</label>
        <input type="text" id="cal-f-client" placeholder="例：林先生 (A棟 501號)">
      </div>
      <div class="form-row">
        <label>地址（選填）</label>
        <input type="text" id="cal-f-address" placeholder="例：新北市○○區○○路 ○○號">
      </div>
      <div class="form-row">
        <label>派工日期</label><input type="date" id="cal-f-date">
      </div>
      <div class="form-2col">
        <div class="form-row"><label>開始</label><input type="time" id="cal-f-start"></div>
        <div class="form-row"><label>結束</label><input type="time" id="cal-f-end"></div>
      </div>
      <div class="form-row">
        <label>備註（型號 / 車馬費）</label>
        <textarea id="cal-f-note" rows="2" placeholder="例：車馬費 800 元"></textarea>
      </div>
      <div class="modal-actions">
        <button class="btn-cancel" onclick="closeCalModal()">取消</button>
        <button class="btn-confirm" onclick="calSubmitAppt()">檢查並寫入</button>
      </div>
    </div>
  </div>`;
}

function calSettingsHtml(isAdmin) {
  if (!isAdmin) return '';
  return `
  <div class="modal-overlay" id="cal-set-modal" style="display:none">
    <div class="modal">
      <h3>⚙️ 行事曆設定</h3>
      <div class="cal-set-tabs">
        <button class="cal-set-tab active" id="cal-tab-svc" onclick="calSetTab('svc')">服務項目</button>
        <button class="cal-set-tab" id="cal-tab-ppl" onclick="calSetTab('ppl')">人員與顏色</button>
      </div>
      <div id="cal-tab-svc-panel">
        <table class="cal-set-table">
          <thead><tr><th>名稱</th><th>排序</th><th>啟用</th><th></th></tr></thead>
          <tbody id="cal-svc-rows"></tbody>
        </table>
        <div class="cal-add-row">
          <input type="text" id="cal-svc-new" placeholder="新服務項目名稱（例：報價勘查）">
          <button class="btn-sm btn-primary" onclick="calAddSvc()">＋ 加入</button>
        </div>
        <div class="cal-hint">日報表勾選欄位固定：保養 / 維修 / 安裝 / 配管（其他服務匯出時附註於地點欄）</div>
      </div>
      <div id="cal-tab-ppl-panel" style="display:none">
        <table class="cal-set-table">
          <thead><tr><th>人員</th><th>角色</th><th>顏色</th></tr></thead>
          <tbody id="cal-ppl-rows"></tbody>
        </table>
        <div class="cal-hint">顏色只影響行事曆與日報表顯示；人員啟用/停用請到 👥 使用者管理</div>
      </div>
      <div class="modal-actions">
        <button class="btn-confirm" onclick="closeCalModal()">完成</button>
      </div>
    </div>
  </div>`;
}

// ========== 資料載入 ==========
async function calLoadData() {
  const y = calMonth.getFullYear(), m = calMonth.getMonth() + 1;
  const [ev, svc, ppl] = await Promise.all([
    fetch(`/api/appointments?year=${y}&month=${m}`).then(r => r.ok ? r.json() : []),
    fetch('/api/service-types').then(r => r.ok ? r.json() : []),
    fetch('/api/assignable-users').then(r => r.ok ? r.json() : []),
  ]);
  calEvents = ev;
  calSvc = svc;
  calAssignable = ppl;
  document.getElementById('cal-today-str').textContent =
    `${_fmtTW(new Date())} · 今日 ${calEvents.filter(e => e.date === _iso(new Date())).length} 筆派工`;
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
  const tStr = _iso(new Date()), selStr = _iso(calSelected);
  for (let d = 1; d <= total; d++) {
    const ds = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const c = document.createElement('div');
    c.className = 'cal-cell' + (ds === tStr ? ' cal-today' : '') + (ds === selStr ? ' cal-selected' : '');
    c.innerHTML = `<span class="cal-day-num">${d}</span>`;
    c.onclick = () => { calSelected = new Date(y, m, d); calRenderMonth(); calRenderDay(); };
    calEvents.filter(e => e.date === ds).sort((a, b) => a.start_time.localeCompare(b.start_time))
      .forEach(e => {
        const shown = (e.assignees || []).slice(0, 2);
        shown.forEach(p => {
          const t = document.createElement('span');
          t.className = 'cal-evt';
          t.style.background = p.color || '#1a73e8';
          t.innerText = `${e.start_time} ${p.name || ''}`;
          c.appendChild(t);
        });
        if ((e.assignees || []).length > 2) {
          const t = document.createElement('span');
          t.className = 'cal-evt cal-evt-more';
          t.innerText = `+${e.assignees.length - 2} 人`;
          c.appendChild(t);
        }
      });
    grid.appendChild(c);
  }
}

// ========== 當日明細 ==========
function calRenderDay() {
  const selStr = _iso(calSelected);
  const isViewer = currentUser && currentUser.role === 'viewer';
  document.getElementById('cal-day-title').innerText = `${_fmtTW(calSelected)} · 派工明細`;
  document.getElementById('cal-picker').value = selStr;
  const list = document.getElementById('cal-day-list');
  const dayEvents = calEvents.filter(e => e.date === selStr).sort((a, b) => a.start_time.localeCompare(b.start_time));
  if (!dayEvents.length) {
    list.innerHTML = '<div class="empty">這天沒有派工行程' + (isViewer ? '' : '<br>點右上「＋ 新增派工」排一筆') + '</div>';
    return;
  }
  list.innerHTML = dayEvents.map(e => {
    const who = (e.assignees || []).map(p =>
      `<span class="cal-who"><span class="cal-who-dot" style="background:${p.color || '#1a73e8'}"></span>${esc(p.name || '')}</span>`).join(' ');
    return `
    <div class="cal-day-card">
      ${isViewer ? '' : `<div class="cal-card-actions">
        <button class="btn-card btn-edit" onclick="calOpenAppt(${e.id})">✏️</button>
        <button class="btn-card btn-delete" onclick="calDeleteAppt(${e.id})">✕</button>
      </div>`}
      <div class="cal-time">⏰ ${e.start_time} - ${e.end_time}　${who}</div>
      <div class="cal-client">[${esc(e.service_name || '')}] ${esc(e.client_name)}</div>
      ${e.address ? `<div class="cal-addr">📍 ${esc(e.address)}</div>` : ''}
      <div class="cal-note">${esc(e.note || '無備註')}</div>
    </div>`;
  }).join('');
}

function calChangeMonth(d) {
  calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + d, 1);
  calLoadData().then(() => { calRenderMonth(); calRenderDay(); });
}

function calPickDate(v) {
  if (!v) return;
  calSelected = new Date(v);
  calMonth = new Date(v.getFullYear(), v.getMonth(), 1);
  calLoadData().then(() => { calRenderMonth(); calRenderDay(); });
}

// ========== 新增 / 編輯 ==========
function calOpenAppt(id) {
  const f = id ? calEvents.find(e => e.id === id) : null;
  document.getElementById('cal-appt-title').innerText = f ? '✏️ 編輯派工' : '➕ 新增派工';
  document.getElementById('cal-f-id').value = f ? f.id : '';
  document.getElementById('cal-appt-conflict').style.display = 'none';
  // 人員勾選（可指派清單）
  const list = document.getElementById('cal-f-users');
  list.innerHTML = '';
  calAssignable.forEach(p => {
    const opt = document.createElement('label');
    opt.className = 'cal-person-opt';
    opt.innerHTML = `<input type="checkbox" value="${p.id}" ${f && f.user_ids.includes(p.id) ? 'checked' : ''}>
      <span class="cal-swatch" style="background:${p.color || '#1a73e8'}"></span><span>${esc(p.display_name || p.username)}</span>`;
    list.appendChild(opt);
  });
  // 服務下拉（啟用中）
  const sel = document.getElementById('cal-f-svc');
  sel.innerHTML = '<option value="">（未指定）</option>' +
    calSvc.filter(s => s.is_active).sort((a, b) => a.sort_order - b.sort_order)
      .map(s => `<option value="${s.id}" ${f && f.service_type_id === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
  document.getElementById('cal-f-client').value = f ? f.client_name : '';
  document.getElementById('cal-f-address').value = f ? (f.address || '') : '';
  document.getElementById('cal-f-date').value = f ? f.date : _iso(calSelected);
  document.getElementById('cal-f-start').value = f ? f.start_time : '09:00';
  document.getElementById('cal-f-end').value = f ? f.end_time : '11:00';
  document.getElementById('cal-f-note').value = f ? (f.note || '') : '';
  document.getElementById('cal-appt-modal').style.display = 'flex';
}

async function calSubmitAppt() {
  const id = document.getElementById('cal-f-id').value;
  const user_ids = [...document.querySelectorAll('#cal-f-users input:checked')].map(i => Number(i.value));
  const body = {
    client_name: document.getElementById('cal-f-client').value.trim(),
    address: document.getElementById('cal-f-address').value.trim(),
    service_type_id: document.getElementById('cal-f-svc').value ? Number(document.getElementById('cal-f-svc').value) : null,
    date: document.getElementById('cal-f-date').value,
    start_time: document.getElementById('cal-f-start').value,
    end_time: document.getElementById('cal-f-end').value,
    note: document.getElementById('cal-f-note').value.trim(),
    user_ids,
  };
  const box = document.getElementById('cal-appt-conflict');
  const showErr = (msg) => { box.innerText = msg; box.style.display = 'block'; };
  if (!user_ids.length) return showErr('⚠️ 請至少勾選一位負責人員');
  if (!body.client_name) return showErr('⚠️ 請填客戶 / 案場');
  try {
    const res = await fetch(id ? `/api/appointments/${id}` : '/api/appointments', {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return showErr(data.detail || `錯誤 ${res.status}`);
    closeCalModal();
    toast(id ? '✅ 行程已更新' : '✅ 行程已新增');
    calSelected = new Date(body.date);
    calMonth = new Date(body.date.slice(0, 4), Number(body.date.slice(5, 7)) - 1, 1);
    await calLoadData();
    calRenderMonth();
    calRenderDay();
  } catch (e) {
    showErr('⚠️ 網路錯誤：' + e.message);
  }
}

async function calDeleteAppt(id) {
  if (!confirm('確定要刪除這筆派工紀錄嗎？')) return;
  const res = await fetch(`/api/appointments/${id}`, { method: 'DELETE' });
  if (!res.ok) { toast('❌ 刪除失敗'); return; }
  toast('🗑 已刪除');
  await calLoadData();
  calRenderMonth();
  calRenderDay();
}

// ========== 匯出日報表（mmdd）==========
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
function calSetTab(t) {
  ['svc', 'ppl'].forEach(x => {
    document.getElementById('cal-tab-' + x).style.display = x === t ? 'block' : 'none';
    document.getElementById('cal-tab-' + x + '-panel').style.display = x === t ? 'block' : 'none';
    document.getElementById('cal-tab-' + x).className = 'cal-set-tab' + (x === t ? ' active' : '');
  });
  if (t === 'svc') calRenderSvcRows();
  else calRenderPplRows();
}

function calOpenSettings() {
  calRenderSvcRows();
  calRenderPplRows();
  document.getElementById('cal-set-modal').style.display = 'flex';
}

function calRenderSvcRows() {
  const tb = document.getElementById('cal-svc-rows');
  tb.innerHTML = '';
  [...calSvc].sort((a, b) => a.sort_order - b.sort_order).forEach(s => {
    tb.innerHTML += `<tr>
      <td>${esc(s.name)}</td>
      <td><input type="number" value="${s.sort_order}" style="width:56px" onchange="calUpdSvc(${s.id},this.value)"></td>
      <td><button class="switch ${s.is_active ? 'on' : ''}" onclick="calUpdSvcActive(${s.id})"></button></td>
      <td>${s.is_active ? `<button class="btn-card btn-delete" onclick="calDelSvc(${s.id})">停用</button>` : '<span class="cal-off">已停用</span>'}</td>
    </tr>`;
  });
}

async function calUpdSvc(id, sort) {
  const s = calSvc.find(x => x.id === id);
  if (!s) return;
  const res = await fetch(`/api/service-types/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: s.name, sort_order: Number(sort) || 0, is_active: s.is_active }),
  });
  if (!res.ok) { toast('❌ 更新失敗'); return; }
  s.sort_order = Number(sort) || 0;
  calRenderSvcRows();
  toast('✅ 已更新');
}

async function calUpdSvcActive(id) {
  const s = calSvc.find(x => x.id === id);
  if (!s) return;
  const res = await fetch(`/api/service-types/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: s.name, sort_order: s.sort_order, is_active: s.is_active ? 0 : 1 }),
  });
  if (!res.ok) { toast('❌ 更新失敗'); return; }
  s.is_active = s.is_active ? 0 : 1;
  calRenderSvcRows();
  toast(s.is_active ? '✅ 已啟用' : '已停用');
}

async function calAddSvc() {
  const v = document.getElementById('cal-svc-new').value.trim();
  if (!v) return;
  const res = await fetch('/api/service-types', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: v, sort_order: calSvc.length + 1, is_active: 1 }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { toast('❌ ' + (data.detail || '新增失敗')); return; }
  document.getElementById('cal-svc-new').value = '';
  calSvc.push(data);
  calRenderSvcRows();
  toast(`✅ 已新增「${v}」`);
}

async function calDelSvc(id) {
  if (!confirm('確定停用此服務項目嗎？（舊行程不受影響）')) return;
  const res = await fetch(`/api/service-types/${id}`, { method: 'DELETE' });
  if (!res.ok) { toast('❌ 停用失敗'); return; }
  const s = calSvc.find(x => x.id === id);
  if (s) s.is_active = 0;
  calRenderSvcRows();
  toast('已停用');
}

function calRenderPplRows() {
  const tb = document.getElementById('cal-ppl-rows');
  tb.innerHTML = '';
  calAssignable.forEach(p => {
    tb.innerHTML += `<tr>
      <td>${esc(p.display_name || p.username)}</td>
      <td>${esc(p.role || '')}</td>
      <td><div class="cal-color-dots">${CAL_PALETTE.map(c =>
        `<span style="background:${c}" class="${(p.color || '#1a73e8') === c ? 'sel' : ''}" onclick="calSetColor(${p.id},'${c}')"></span>`).join('')}</div></td>
    </tr>`;
  });
}

async function calSetColor(uid, color) {
  const res = await fetch(`/api/users/${uid}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ color }),
  });
  if (!res.ok) { toast('❌ 顏色更新失敗'); return; }
  const p = calAssignable.find(x => x.id === uid);
  if (p) p.color = color;
  calRenderPplRows();
  toast('✅ 顏色已更新');
}

function closeCalModal() {
  document.getElementById('cal-appt-modal').style.display = 'none';
  const set = document.getElementById('cal-set-modal');
  if (set) set.style.display = 'none';
}
