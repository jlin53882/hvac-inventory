// 庫存管理系統 - 行事曆派工 modal（2026-08-16 從 render/calendar.js 拆出）
// 依賴：globals.js 的 calEvents/calSvc/calAssignable/calSelected/calMonth（var 全域）；render/calendar.js 的 calLoadData/calRenderMonth/calRenderDay

// ========== 新增 / 編輯 ==========
let calApptUpdatedAt = null;  // 2026-08-14 樂觀鎖：開啟編輯派工 modal 時的 updated_at 快照
function calModalHtml(isAdmin) {
  return `
  <div class="modal-overlay" id="cal-appt-modal" style="display:none">
    <div class="modal">
      <h3 id="cal-appt-title">➕ 新增派工</h3>
      <div class="cal-conflict" id="cal-appt-conflict"></div>
      <input type="hidden" id="cal-f-id">
      <div class="form-row" style="display:none">  <!-- 負責人員已隱藏（2026-08-12 家豪指定：明細以新增者標示即可） -->
        <label>負責人員（可不選，可勾多位＝一起出勤）</label>
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
      <div class="form-row">
        <label>派工時間</label>
        <!-- 2026-08-13 Sarah：time input 在手機顯示 12 制（上午/下午）→ 改下拉式 24 制 -->
        <div class="cal-time-picker">
          <select id="cal-f-hour" aria-label="時"></select><span class="cal-time-colon">:</span>
          <select id="cal-f-minute" aria-label="分"></select>
        </div>
      </div>
      <div class="form-row">
        <label>備註</label>
        <textarea id="cal-f-note" rows="2" placeholder="例：車馬費 800 元"></textarea>
      </div>
      <div class="modal-actions">
        <button class="btn-cancel" onclick="closeCalModal()">取消</button>
        <button class="btn-confirm" onclick="calSubmitAppt()">檢查並寫入</button>
      </div>
    </div>
  </div>`;
}

function calOpenAppt(id) {
  const f = id ? calEvents.find(e => e.id === id) : null;
  calApptUpdatedAt = f ? (f.updated_at || null) : null;  // 快照：儲存時帶回做 WHERE 守衛
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
      <span class="cal-swatch" style="background:${esc(p.color) || '#1a73e8'}"></span><span>${esc(p.display_name || p.username)}</span>`;
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
  // 2026-08-13：24 制下拉（時 00-23、分 00-59，每 5 分鐘）
  const hSel = document.getElementById('cal-f-hour');
  // 2026-08-14 Sarah：派工時間選填——第一個選項「--」= 不指定時間
  hSel.innerHTML = '<option value="">--</option>' + Array.from({length: 24}, (_, h) => {
    const hh = String(h).padStart(2, '0');
    return `<option value="${hh}">${hh}</option>`;
  }).join('');
  const mSel = document.getElementById('cal-f-minute');
  mSel.innerHTML = '<option value="">--</option>' + Array.from({length: 12}, (_, i) => {
    const mm = String(i * 5).padStart(2, '0');
    return `<option value="${mm}">${mm}</option>`;
  }).join('');
  // 2026-08-14 Sarah：派工時間選填——新增預設「--」（不填）、編輯未指定時間也回「--」
  const t = (f && f.start_time) || '';
  hSel.value = t ? t.slice(0, 2) : '';
  mSel.value = t ? t.slice(3, 5) : '';
  document.getElementById('cal-f-note').value = f ? (f.note || '') : '';
  document.getElementById('cal-appt-modal').style.display = 'flex';
}

async function calSubmitAppt() {
  const id = document.getElementById('cal-f-id').value;
  // 負責人員欄位已隱藏：新增傳空、編輯保留原指派（避免清除舊資料）
  const orig = id ? ((calEvents.find(e => e.id === Number(id)) || {}).user_ids || []) : [];
  const user_ids = orig;
  // 2026-08-14 Sarah：派工時間選填——時或分選「--」→ 時間留空字串（後端接受空時間）
  const hh = document.getElementById('cal-f-hour').value;
  const mm = document.getElementById('cal-f-minute').value;
  const timeVal = (hh && mm) ? hh + ':' + mm : '';
  const body = {
    client_name: document.getElementById('cal-f-client').value.trim(),
    address: document.getElementById('cal-f-address').value.trim(),
    service_type_id: document.getElementById('cal-f-svc').value ? Number(document.getElementById('cal-f-svc').value) : null,
    date: document.getElementById('cal-f-date').value,
    start_time: timeVal,
    // 2026-08-13 Sarah：只寫開始時間，不用結束時間 → end 自動 = start（後端衝突判斷變「同時段才衝突」）
    end_time: timeVal,
    note: document.getElementById('cal-f-note').value.trim(),
    user_ids,
    updated_at: calApptUpdatedAt,  // 2026-08-14 樂觀鎖（新增時 null，編輯時帶快照）
  };
  const box = document.getElementById('cal-appt-conflict');
  const showErr = (msg) => { box.innerText = msg; box.style.display = 'block'; };
  if (!body.client_name) return showErr('⚠️ 請填客戶 / 案場');
  if (!body.date) return showErr('⚠️ 請選擇派工日期');
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
    if (typeof syncViewUrl === 'function') syncViewUrl();  // 2026-08-14 審查補：跳月後同步 URL（F5 停在該月）
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
function closeCalModal() {
  document.getElementById('cal-appt-modal').style.display = 'none';
  const set = document.getElementById('cal-set-modal');
  if (set) set.style.display = 'none';
}
