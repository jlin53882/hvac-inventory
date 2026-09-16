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
  </div>
      <!-- 同步錯誤詳情 modal -->
  <div class="modal-overlay" id="cal-sync-error-modal" onclick="if(event.target===this) closeModal('cal-sync-error-modal')">
    <div class="modal">
      <h3>⚠️ 同步錯誤詳情</h3>
      <div class="cal-sync-err-detail">
        <div class="cal-sync-err-row"><span class="cal-sync-err-label">行程</span><span id="cal-sync-err-client"></span></div>
        <div class="cal-sync-err-row"><span class="cal-sync-err-label">日期</span><span id="cal-sync-err-date"></span></div>
        <div class="cal-sync-err-row"><span class="cal-sync-err-label">狀態</span><span id="cal-sync-err-status"></span></div>
        <div class="cal-sync-err-row"><span class="cal-sync-err-label">同步 Key</span><span id="cal-sync-err-key"></span></div>
        <div class="cal-sync-err-row"><span class="cal-sync-err-label">目標日曆</span><span id="cal-sync-err-cal"></span></div>
        <div class="cal-sync-err-row cal-sync-err-full"><span class="cal-sync-err-label">錯誤訊息</span><pre id="cal-sync-err-msg"></pre></div>
        <div class="cal-sync-err-suggestion" id="cal-sync-err-suggestion"></div>
      </div>
      <div class="modal-actions">
        <button class="btn-cancel" onclick="closeModal('cal-sync-error-modal')">關閉</button>
      </div>
    </div>
  </div>
  <div class="modal-overlay" id="cal-team-sync-modal" onclick="if(event.target===this) closeModal('cal-team-sync-modal')">
    <div class="modal">
      <h3>👥 全員同步細節</h3>
      <div id="cal-team-sync-summary"></div>
      <div class="cal-sync-team-actions"><button type="button" class="btn-sm btn-primary" onclick="calRetryTeamSync()">重試全體</button></div>
      <div id="cal-team-sync-details" class="cal-sync-team-details"></div>
      <div class="modal-actions">
        <button class="btn-cancel" onclick="closeModal('cal-team-sync-modal')">關閉</button>
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
    const applied = await calLoadData();
    if (applied === null) return;
    if (calLoadError) {
      calSetLoadState('error', calLoadError);
      return;
    }
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
  const applied = await calLoadData();
  if (applied === null) return;
  if (calLoadError) {
    calSetLoadState('error', calLoadError);
    return;
  }
  calRenderMonth();
  calRenderDay();
}

// ========== 匯出日報表（mmdd）==========
function closeCalModal() {
  document.getElementById('cal-appt-modal').style.display = 'none';
  const set = document.getElementById('cal-set-modal');
  if (set) set.style.display = 'none';
}

// ========== 同步錯誤詳情 ==========
function calShowSyncError(apptId) {
  const e = (typeof calEvents !== 'undefined' ? calEvents : []).find(x => x.id === apptId);
  if (!e) return;
  document.getElementById('cal-sync-err-client').textContent = e.client_name || '';
  document.getElementById('cal-sync-err-date').textContent = e.date || '';
  const statusMap = { failed: '❌ 同步失敗', partial_failed: '⚠️ 部分同步失敗', partial_retrying: '🔄 部分同步重試中', retrying: '🔄 同步重試中', pending: '⏳ 等待同步' };
  document.getElementById('cal-sync-err-status').textContent = statusMap[e.sync_status] || e.sync_status;
  document.getElementById('cal-sync-err-key').textContent = e.sync_error_key || '（未知 Key）';
  document.getElementById('cal-sync-err-cal').textContent = e.sync_error_cal || '（未知日曆）';
  document.getElementById('cal-sync-err-msg').textContent = e.sync_error || '（無錯誤訊息）';
  // 建議
  let suggestion = '';
  if (e.sync_error && e.sync_error.includes('invalid_grant')) {
    suggestion = '🔑 Service Account 金鑰已失效。請到 Google Cloud Console 重新產生 JSON 金鑰，再從系統設定 → Google 行事曆 Key 上傳新金鑰。';
  } else if (e.sync_error && e.sync_error.includes('404')) {
    suggestion = '📅 Calendar ID 可能不正確，或 Service Account 沒有該日曆的存取權限。請確認日曆已分享給 Service Account email。';
  } else if (e.sync_error && e.sync_error.includes('network')) {
    suggestion = '🌐 網路連線問題。請確認伺服器可連線到 Google API。';
  } else {
    suggestion = '請檢查 gcal_sync.log 取得完整錯誤資訊。';
  }
  document.getElementById('cal-sync-err-suggestion').textContent = suggestion;
  openModal('cal-sync-error-modal');
}

let calTeamSyncApptId = null;
function calShowTeamSyncDetails(apptId) {
  calTeamSyncApptId = apptId;
  const e = (typeof calEvents !== 'undefined' ? calEvents : []).find(x => x.id === apptId);
  const team = e && e.team_sync;
  if (!team) return;
  const summary = document.getElementById('cal-team-sync-summary');
  const details = document.getElementById('cal-team-sync-details');
  if (!summary || !details) return;
  summary.textContent = `有效同步人員：${team.synced_people}/${team.eligible_people} 已同步`;
  details.innerHTML = (team.details || []).map(person => {
    const status = calSyncStatusLabel(person.status);
    const error = person.error ? `：${person.error}` : '';
    return `<div class="cal-sync-team-row"><strong>${esc(person.display_name)}</strong><span>${esc(status)}${esc(error)}</span><button type="button" class="btn-sm" onclick="calRetryTeamMember(${esc(String(apptId))},${esc(String(person.user_id))})">重試</button></div>`;
  }).join('') || '<div class="cal-sync-team-row">目前沒有有效同步人員</div>';
  if (team.unbound_people || team.paused_people) {
    const extra = document.createElement('div');
    extra.className = 'cal-sync-team-extra';
    extra.textContent = `未綁定 ${team.unbound_people || 0} 人・Key 已停用 ${team.paused_people || 0} 人（不計入比例）`;
    details.appendChild(extra);
  }
  openModal('cal-team-sync-modal');
}

async function calReloadAfterSyncAction() {
  const applied = await calLoadData();
  if (applied === null || calLoadError) return;
  calRenderMonth();
  calRenderDay();
}

async function calRetryMySync(apptId) {
  const res = await fetch(`/api/gcal-sync-queue/reset-mine?appt_id=${encodeURIComponent(apptId)}`, { method: 'PUT' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    toast('❌ ' + (data.detail || '重試我的同步失敗'));
    return;
  }
  toast('🔄 已重設你的同步 Queue');
  await calReloadAfterSyncAction();
}

async function calRetryTeamMember(apptId, userId) {
  const res = await fetch(`/api/gcal-sync-queue/reset-scope?appt_id=${encodeURIComponent(apptId)}&scope=user&target_user_id=${encodeURIComponent(userId)}`, { method: 'PUT' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    toast('❌ ' + (data.detail || '重試指定人員失敗'));
    return;
  }
  toast('🔄 已重設指定人員的同步 Queue');
  closeModal('cal-team-sync-modal');
  await calReloadAfterSyncAction();
}

async function calRetryTeamSync() {
  if (!calTeamSyncApptId || !confirm('確定重試這筆行程的全部有效同步目標嗎？')) return;
  const res = await fetch(`/api/gcal-sync-queue/reset-scope?appt_id=${encodeURIComponent(calTeamSyncApptId)}&scope=all`, { method: 'PUT' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    toast('❌ ' + (data.detail || '重試全體同步失敗'));
    return;
  }
  toast('🔄 已重設這筆行程全部有效同步 Queue');
  closeModal('cal-team-sync-modal');
  await calReloadAfterSyncAction();
}
