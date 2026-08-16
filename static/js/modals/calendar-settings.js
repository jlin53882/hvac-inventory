// 庫存管理系統 - 行事曆 ⚙️ 設定（admin；2026-08-16 從 render/calendar.js 拆出）
// 依賴：globals.js 的 calSvc/calAssignable/CAL_PALETTE（var 全域）

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
        <div class="cal-hint">日報表勾選欄位固定：保養 / 維修 / 施工 / 場勘（其他服務匯出時附註於地點欄）</div>
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
function calSetTab(t) {
  ['svc', 'ppl'].forEach(x => {
    // 只切 panel 顯示 + tab 按鈕 active class（按鈕本身不能隱藏，否則切不回來）
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
  const roleName = { admin: '管理員', user: '使用者', viewer: '檢視者' };
  calAssignable.forEach(p => {
    tb.innerHTML += `<tr>
      <td>${esc(p.display_name || p.username)}</td>
      <td>${esc(roleName[p.role] || p.role || '')}</td>
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
