// 庫存管理系統 - 設定頁：Google 行事曆同步（金鑰、人員綁定、同步佇列）

import { apiFetch } from '../../core/api-client.js';
import { esc, hasPerm, toast } from '../../core/utils.js';

export var gcalKeys = [];
var gcalUsers = [];
var gcalSettings = {};
var gcalHealth = {};
var gcalQueueItems = [];
var selectedKeyId = null;

// ========== 行事曆同步面板（左右佈局 v3）==========
export async function loadGcalKeys() {
  try {
    gcalKeys = await apiFetch('/api/gcal-keys');
  } catch (e) { console.error('[loadGcalKeys]', e); }
}

async function loadGcalUsers() {
  try {
    gcalUsers = (await apiFetch('/api/users')).users || [];
  } catch (e) { console.error('[loadGcalUsers]', e); }
}

async function loadGcalSettings() {
  try {
    gcalSettings = await apiFetch('/api/gcal-sync-settings');
  } catch (e) { console.error('[loadGcalSettings]', e); }
}

async function loadGcalSyncStatus() {
  try {
    gcalHealth = await apiFetch('/api/gcal-sync-status');
  } catch (e) { console.error('[loadGcalSyncStatus]', e); }
}

async function loadGcalQueue() {
  try {
    gcalQueueItems = (await apiFetch('/api/gcal-sync-queue')).items || [];
  } catch (e) { console.error('[loadGcalQueue]', e); }
}

async function refreshGcalSyncData(render = true) {
  await Promise.all([loadGcalSyncStatus(), loadGcalQueue()]);
  if (render && document.getElementById('panel-gcal')) renderGcalPanel();
}

function gcalQueueStatusLabel(status, keyActive = true) {
  if (!keyActive) return 'Key 已停用，等待重新啟用';
  return status === 'exhausted' ? '失敗／已達重試上限'
    : status === 'retrying' ? '同步重試中'
    : '等待同步';
}

function renderGcalHealth(canForce) {
  const h = gcalHealth || {};
  const running = h.thread_alive ? '● 排程器正常' : '○ 排程器未運作';
  const runningClass = h.thread_alive ? 'is-ok' : 'is-failed';
  const lastRun = h.last_run_at || '尚未執行';
  const lastSuccess = h.last_success_at || '尚未成功執行';
  const error = h.last_error ? '<div class="gcal-health-error">' + esc(String(h.last_error)) + '</div>' : '';
  const action = canForce
    ? '<button type="button" class="btn btn--primary btn--md btn-primary gcal-health-force" data-action="settings-gcal-force-sync">立即同步全部 Key</button>'
    : '';
  return '<section class="gcal-sync-health" aria-label="Google 行事曆同步健康狀態">' +
    '<div class="gcal-health-head"><div><strong>Google 行事曆同步</strong><span class="gcal-health-running ' + runningClass + '">' + running + '</span></div>' + action + '</div>' +
    '<div class="gcal-health-meta"><span>上次執行：' + esc(String(lastRun)) + '</span><span>上次成功：' + esc(String(lastSuccess)) + '</span></div>' +
    '<div class="gcal-health-counts"><span class="is-pending">待同步 <b>' + esc(String(h.pending_count || 0)) + '</b></span><span class="is-retrying">重試中 <b>' + esc(String(h.retrying_count || 0)) + '</b></span><span class="is-failed">失敗 <b>' + esc(String(h.exhausted_count || 0)) + '</b></span>' + (h.paused_count ? '<span class="is-paused">停用 Key 暫停 <b>' + esc(String(h.paused_count)) + '</b></span>' : '') + '</div>' +
    error + '</section>';
}

function renderGcalQueueIssues(canSync) {
  const items = Array.isArray(gcalQueueItems) ? gcalQueueItems : [];
  let html = '<section class="gcal-sync-issues" aria-label="需要處理的同步問題"><div class="gcal-sync-issues-head"><strong>需要處理的同步問題</strong><span>' + esc(String(items.length)) + ' 筆</span></div>';
  if (!items.length) return html + '<div class="gcal-sync-issues-empty">目前沒有待處理的同步問題</div></section>';
  html += '<div class="gcal-sync-issue-list">';
  items.forEach(item => {
    const apptId = String(item.appointment_id || '');
    const keyId = String(item.key_id || '');
    const title = item.is_deleted ? '已刪除行程 #' + apptId : (item.client_name || '未命名行程');
    const opLabel = item.op_type === 'D' ? '刪除 Google Event' : item.op_type === 'C' ? '建立' : '更新';
    const keyLabel = (item.key_name || ('#' + keyId)) + (item.key_active ? '' : '（已停用）');
    const error = item.last_error ? '<pre class="gcal-sync-issue-error">' + esc(String(item.last_error)) + '</pre>' : '';
    html += '<article class="gcal-sync-issue gcal-sync-issue--' + esc(item.status || 'pending') + '">' +
      '<div class="gcal-sync-issue-main"><strong>' + esc(title) + '</strong><span>' + esc(item.date || '本地行程已刪除') + '</span></div>' +
      '<div class="gcal-sync-issue-detail"><span>Key：' + esc(keyLabel) + '</span><span>操作：' + esc(opLabel) + '</span><span>嘗試：' + esc(String(item.attempts || 0)) + ' / ' + esc(String(item.max_attempts || 5)) + '</span><span class="gcal-sync-issue-status">' + esc(gcalQueueStatusLabel(item.status, item.key_active)) + '</span></div>' +
      error +
      '<div class="gcal-sync-issue-actions">' + (canSync ? '<button type="button" class="btn btn--secondary btn--sm btn-sm gcal-sync-retry" data-role="gcal-sync-retry" data-sync-appt="' + esc(apptId) + '" data-sync-key="' + esc(keyId) + '">重新嘗試</button>' : '') + '</div>' +
      '</article>';
  });
  return html + '</div></section>';
}

function bindGcalQueueActions() {
  document.querySelectorAll('#panel-gcal [data-role="gcal-sync-retry"]').forEach(button => {
    button.addEventListener('click', () => retrySyncQueue(Number(button.dataset.syncAppt), Number(button.dataset.syncKey)));
  });
}

export function renderGcalPanel() {
  const canManage = hasPerm('gcal-keys-manage');
  const canSync = hasPerm('gcal-sync-manage');
  const canForce = hasPerm('gcal-sync-force');

  let html = '<h4>📅 行事曆同步</h4>';
  if (canSync) html += renderGcalHealth(canForce);

  // 左側 Key 列表 + 右側面板（用 CSS flex 模擬）
  html += '<div class="gcal-layout">';

  // 左側 Key 列表
  html += '<div class="gcal-key-list">';
  gcalKeys.forEach(k => {
    const isActive = k.id === selectedKeyId;
    html += '<div class="gcal-key-item' + (isActive ? ' is-active' : '') + '" data-action="settings-gcal-key-select" data-id="' + k.id + '">' +
      '<div class="gcal-key-avatar' + (k.is_active ? '' : ' is-off') + '">📅</div>' +
      '<div class="gcal-key-body">' +
        '<div class="gcal-key-name">' + esc(k.name) + '</div>' +
        '<div class="gcal-key-status' + (k.is_active ? '' : ' is-off') + '">' + (k.is_active ? '帳號啟用' : '帳號停用') + '</div>' +
        '<div class="gcal-key-email" title="' + esc(k.client_email || '') + '">' + esc(k.client_email || '—') + '</div>' +
      '</div>' +
      '<button class="btn btn--sm ' + (k.is_active ? 'btn--danger' : 'btn--secondary') + ' u-shrink-0" data-action="settings-gcal-key-toggle-button" data-id="' + k.id + '" data-on="' + (!k.is_active) + '">' + (k.is_active ? '停用' : '啟用') + '</button>' +
      '</div>';
  });
  if (canManage) {
    html += '<div class="gcal-key-add" data-action="settings-gcal-key-open">＋ 新增 Key</div>';
  }
  html += '</div>';

  // 右側面板
  html += '<div class="gcal-detail-panel">';

  if (selectedKeyId) {
    const key = gcalKeys.find(k => k.id === selectedKeyId);
    if (key) {
      // Panel Head
      html += '<div class="gcal-detail-head">' +
        '<div class="gcal-detail-avatar">📅</div>' +
        '<div class="gcal-detail-info"><div class="gcal-detail-name">' + esc(key.name) + '</div>' +
        '<div class="gcal-detail-meta">' + esc(key.calendar_id) + ' · ' + (key.is_active ? '✅ 啟用中' : '⏸ 停用') + '</div>' +
        '<div class="gcal-detail-email">Client email：' + esc(key.client_email || '未讀取') + '</div></div>';
      // 操作按鈕
      if (canManage) {
        html += '<div class="gcal-detail-actions">' +
          '<label class="settings-switch" title="' + (key.is_active ? '點擊停用' : '點擊啟用') + '"><input type="checkbox" ' + (key.is_active ? 'checked' : '') + ' data-action="settings-gcal-key-toggle" data-id="' + key.id + '"><span class="slider"></span></label>' +
          '<button class="btn btn--secondary btn--sm" data-action="settings-gcal-key-open" data-id="' + key.id + '">✏️ 編輯</button>' +
          '<button type="button" class="btn btn--danger btn--sm" data-action="settings-gcal-key-delete" data-id="' + key.id + '">🗑️ 刪除</button>' +
          '</div>';
      }
      html += '</div>';

      // Tabs
      html += '<div class="gcal-tabs">' +
        '<button class="chip chip--seg gcal-tab is-active" data-role="gcal-tab" data-action="settings-gcal-tab" data-tab="sync">⚙️ 同步設定</button>' +
        '<button class="chip chip--seg gcal-tab" data-role="gcal-tab" data-action="settings-gcal-tab" data-tab="users">👤 使用者綁定</button>' +
        '</div>';

      // Tab 1: 同步設定
      html += '<div id="gcal-tab-sync">';
      if (canSync) {
        html += renderGcalSyncSettings(key);
      } else {
        html += '<p class="gcal-no-perm">無權限修改同步設定</p>';
      }
      html += '</div>';

      // Tab 2: 使用者綁定
      html += '<div id="gcal-tab-users" style="display:none">';
      html += renderGcalUserBind(key);
      html += '</div>';
    }
  } else {
    html += '<div class="gcal-detail-empty">' +
      '<div class="gcal-detail-empty-icon">📅</div>' +
      '<p>請選擇左側的 Key 查看設定</p></div>';
  }

  html += '</div>'; // 右側面板結束
  html += '</div>'; // flex 結束

  // 直接同步按鈕
  html += renderGcalQueueIssues(canSync);

  document.getElementById('panel-gcal').innerHTML = html;
  bindGcalQueueActions();
}

function renderGcalSyncSettings(key) {
  let html = '';

  // Event 內容區塊
  html += '<div class="gcal-section"><div class="gcal-section-title">📍 Event 內容</div>';

  // 地址→地點欄位
  html += '<div class="gcal-settings-row">' +
    '<label class="gcal-settings-label">地址同步到地點欄位</label>' +
    '<label class="settings-switch"><input type="checkbox" ' + (gcalSettings.gcal_use_location === '1' ? 'checked' : '') + ' data-action="settings-gcal-setting-checkbox" data-key="gcal_use_location"><span class="slider"></span></label>' +
    '<span class="gcal-settings-hint">客戶地址顯示在 Google Calendar 的「地點」欄位</span></div>';

  // 顯示為
  html += '<div class="gcal-settings-row">' +
    '<label class="gcal-settings-label">顯示為</label>' +
    '<select data-action="settings-gcal-setting" data-key="gcal_transparency" class="gcal-settings-control">' +
    '<option value="transparent"' + (gcalSettings.gcal_transparency === 'transparent' ? ' selected' : '') + '>🟢 空閒（不阻塞時段）</option>' +
    '<option value="opaque"' + (gcalSettings.gcal_transparency === 'opaque' ? ' selected' : '') + '>🔴 忙碌（阻塞時段）</option></select>' +
    '<span class="gcal-settings-hint">空閒 = 不會阻塞行事曆上的其他邀請</span></div>';
  html += '</div>';

  // 時間設定區塊
  html += '<div class="gcal-section"><div class="gcal-section-title">⏰ 時間設定</div>';

  // 預設截止時間
  html += '<div class="gcal-settings-row">' +
    '<label class="gcal-settings-label">預設截止時間</label>' +
    '<select data-action="settings-gcal-setting" data-key="gcal_default_duration_min" class="gcal-settings-control">' +
    ['15', '30', '45', '60', '90', '120'].map(v => {
      var label = v === '60' ? '60 分鐘（1 小時）' : v === '120' ? '120 分鐘（2 小時）' : v + ' 分鐘';
      return '<option value="' + v + '"' + (gcalSettings.gcal_default_duration_min === v ? ' selected' : '') + '>' + label + '</option>';
    }).join('') + '</select>' +
    '<span class="gcal-settings-hint">未填截止時間的行程，同步時使用此時長</span></div>';

  // 同步間隔
  html += '<div class="gcal-settings-row gcal-sync-interval-hint">' +
    '<label class="gcal-settings-label gcal-settings-label--wide">全部 Key 同步掃描間隔</label>' +
    '<input type="number" value="' + (gcalSettings.gcal_sync_interval_min || '5') + '" min="1" max="30" ' +
    'data-action="settings-gcal-setting" data-key="gcal_sync_interval_min" class="gcal-settings-control gcal-settings-control--num"> 分鐘' +
    '<span class="gcal-settings-hint">所有啟用中的 Google Calendar Key 共用此掃描間隔，背景排程器會掃描待同步隊列；行程修改後另有 5 分鐘編輯防抖等待，立即同步會略過防抖（立即同步全部 Key）</span></div>';
  html += '</div>';

  // Per-Key 提醒設定
  html += '<div class="gcal-section"><div class="gcal-section-title">🔔 事件提醒（此 Key 專用）</div>';
  html += '<p class="gcal-section-desc">同步到 Google Calendar 時附帶的提醒通知。</p>';

  var reminders = (key.reminders || []).filter(r => r.method === 'popup');
  if (!reminders.length) reminders = [{ method: 'popup', minutes: 30 }];
  reminders = reminders.slice(0, 5);
  var reminderDisplay = function(minutes) {
    var units = [['weeks', 10080], ['days', 1440], ['hours', 60], ['minutes', 1]];
    var total = Number(minutes) || 0;
    for (var i = 0; i < units.length; i += 1) {
      if (total === 0 || total % units[i][1] === 0) return { value: total / units[i][1], unit: units[i][0] };
    }
    return { value: total, unit: 'minutes' };
  };
  var reminderRow = function(reminder, index) {
    var display = reminderDisplay(reminder.minutes);
    return '<div class="gcal-reminder-row" data-reminder-index="' + index + '">' +
      '<div class="gcal-reminder-label" data-role="gcal-reminder-label">🔔 提前通知 ' + (index + 1) + '</div>' +
      '<div class="gcal-reminder-control">' +
      '<input type="number" id="gcal-reminder-val-' + key.id + '-' + index + '" value="' + display.value + '" min="0" max="40320">' +
      '<select id="gcal-reminder-unit-' + key.id + '-' + index + '">' +
      '<option value="minutes"' + (display.unit === 'minutes' ? ' selected' : '') + '>分鐘</option><option value="hours"' + (display.unit === 'hours' ? ' selected' : '') + '>小時</option><option value="days"' + (display.unit === 'days' ? ' selected' : '') + '>天</option><option value="weeks"' + (display.unit === 'weeks' ? ' selected' : '') + '>週</option></select></div>' +
      '<button type="button" class="btn btn--secondary btn--sm" data-action="settings-gcal-reminder-remove" data-key-id="' + key.id + '" data-index="' + index + '"' + (reminders.length <= 1 ? ' disabled' : '') + '>移除</button>' +
      '<span class="gcal-reminder-hint">Google Calendar Popup 提醒</span></div>';
  };
  html += '<div class="gcal-reminders-list" id="gcal-reminders-' + key.id + '">' + reminders.map(reminderRow).join('') + '</div>';
  html += '<button type="button" class="btn btn--ghost btn--sm gcal-add-reminder" id="gcal-add-reminder-' + key.id + '" data-action="settings-gcal-reminder-add" data-key-id="' + key.id + '"' + (reminders.length >= 5 ? ' disabled' : '') + '>＋ 新增通知（最多 5 個）</button>';
  html += '<div class="gcal-api-note">' +
    '💡 Google Calendar API 上限：最長 4 週（40320 分鐘）= 672 小時 = 28 天 = 4 週</div>';

  // 儲存提醒按鈕
  html += '<button class="btn btn--primary btn--md btn-primary u-mt-12" data-action="settings-gcal-reminders-save" data-key-id="' + key.id + '">💾 儲存提醒設定</button>';
  html += '</div>';

  return html;
}

function renderGcalUserBind(key) {
  let html = '<p class="gcal-bind-desc">指派人員綁定此 Key → 該人員的行程同步到這本行事曆。</p>';
  html += '<table class="gcal-bind-table"><thead><tr>' +
    '<th>使用者</th>' +
    '<th>綁定 Key</th></tr></thead><tbody>';
  gcalUsers.forEach(u => {
    html += '<tr><td>👤 ' + esc(u.display_name || u.username) + '</td><td>' +
      '<select data-action="settings-gcal-user-bind" data-id="' + u.id + '" class="gcal-bind-select">' +
      '<option value=""' + (!u.gcal_key ? ' selected' : '') + '>— 未綁定 —</option>';
    gcalKeys.filter(k => k.is_active).forEach(k => {
      html += '<option value="' + esc(k.name) + '"' + (u.gcal_key === k.name ? ' selected' : '') + '>' + esc(k.name) + '</option>';
    });
    html += '</select></td></tr>';
  });
  html += '</tbody></table>';
  html += '<p class="gcal-bind-note">未綁定 Key 的使用者，其指派的行程不會同步到任何行事曆。</p>';
  return html;
}

export function selectGcalKey(id) {
  selectedKeyId = id;
  renderGcalPanel();
}

export function switchGcalTab(tab) {
  document.querySelectorAll('[data-role="gcal-tab"]').forEach(t => t.classList.remove('is-active'));
  document.querySelector('[data-role="gcal-tab"][data-tab="' + tab + '"]').classList.add('is-active');
  document.getElementById('gcal-tab-sync').style.display = tab === 'sync' ? '' : 'none';
  document.getElementById('gcal-tab-users').style.display = tab === 'users' ? '' : 'none';
}

export async function saveGcalSetting(key, value) {
  try {
    await apiFetch('/api/gcal-sync-settings', {
      method: 'PUT', json: { [key]: value }, fallback: '儲存失敗'
    });
    gcalSettings[key] = value;
    await refreshGcalSyncData(false);
    renderGcalPanel();
    toast('✅ 已儲存，受影響事件已重新評估', 'success');
  } catch (e) { toast(e.message, 'error'); }
}

export async function saveKeyReminders(keyId) {
  const rows = Array.from(document.querySelectorAll('#gcal-reminders-' + keyId + ' [data-reminder-index]'));
  // 儲存時重新依目前 DOM 的列順序組合；index 不是永久識別碼，刪除後由 reindexGcalReminders() 重排。
  if (!rows.length || rows.length > 5) return toast('通知數量需為 1~5 個', 'error');
  const reminders = [];
  for (let i = 0; i < rows.length; i += 1) {
    const index = rows[i].dataset.reminderIndex;
    const value = Number(document.getElementById('gcal-reminder-val-' + keyId + '-' + index).value);
    const unit = document.getElementById('gcal-reminder-unit-' + keyId + '-' + index).value;
    const minutes = unit === 'weeks' ? value * 10080 : unit === 'days' ? value * 1440 : unit === 'hours' ? value * 60 : value;
    if (!Number.isInteger(value) || value < 0 || minutes > 40320) return toast('通知時間需介於 0 分鐘至 4 週', 'error');
    reminders.push({ method: 'popup', minutes: minutes });
  }
  try {
    await apiFetch('/api/gcal-keys/' + keyId + '/reminders', {
      method: 'PUT', json: { reminders: reminders }, fallback: '儲存失敗'
    });
    const key = gcalKeys.find(k => k.id === keyId);
    if (key) key.reminders = reminders;
    await refreshGcalSyncData(false);
    renderGcalPanel();
    toast('✅ 提醒設定已儲存，既有事件已重新評估', 'success');
  } catch (e) { toast(e.message, 'error'); }
}

export function addGcalReminderRow(keyId) {
  const container = document.getElementById('gcal-reminders-' + keyId);
  if (!container || container.children.length >= 5) return;
  const index = container.children.length;
  const row = document.createElement('div');
  row.className = 'gcal-reminder-row';
  row.dataset.reminderIndex = index;
  row.innerHTML = '<div class="gcal-reminder-label" data-role="gcal-reminder-label">🔔 提前通知 ' + (index + 1) + '</div><div class="gcal-reminder-control"><input type="number" id="gcal-reminder-val-' + keyId + '-' + index + '" value="30" min="0" max="40320"><select id="gcal-reminder-unit-' + keyId + '-' + index + '"><option value="minutes" selected>分鐘</option><option value="hours">小時</option><option value="days">天</option><option value="weeks">週</option></select></div><button type="button" class="btn btn--secondary btn--sm" data-action="settings-gcal-reminder-remove" data-key-id="' + keyId + '" data-index="' + index + '">移除</button><span class="gcal-reminder-hint">Google Calendar Popup 提醒</span>';
  container.appendChild(row);
  const add = document.getElementById('gcal-add-reminder-' + keyId);
  if (add && container.children.length >= 5) add.disabled = true;
}

export function removeGcalReminderRow(keyId, index) {
  const container = document.getElementById('gcal-reminders-' + keyId);
  if (!container || container.children.length <= 1) return;
  const row = container.querySelector('[data-reminder-index="' + index + '"]');
  if (row) row.remove();
  Array.from(container.children).forEach((item, i) => {
    item.dataset.reminderIndex = i;
    const value = item.querySelector('input[type="number"]');
    const unit = item.querySelector('select');
    if (value) value.id = 'gcal-reminder-val-' + keyId + '-' + i;
    if (unit) unit.id = 'gcal-reminder-unit-' + keyId + '-' + i;
    const label = item.querySelector('[data-role="gcal-reminder-label"]');
    if (label) label.textContent = '🔔 提前通知 ' + (i + 1);
  });
  const add = document.getElementById('gcal-add-reminder-' + keyId);
  if (add) add.disabled = container.children.length >= 5;
}


export async function forceSyncNow() {
  if (!confirm('確定要立即執行同步？')) return;
  try {
    await apiFetch('/api/gcal-sync-now', { method: 'POST', fallback: '同步失敗' });
    await refreshGcalSyncData(false);
    renderGcalPanel();
    toast('✅ 已觸發全部 Key 立即同步；已耗盡項目請按重新嘗試', 'success');
    setTimeout(async () => {
      await refreshGcalSyncData(false);
      renderGcalPanel();
    }, 3000);
  } catch (e) { toast(e.message, 'error'); }
}

async function retrySyncQueue(apptId, keyId) {
  if (!Number.isInteger(apptId) || !Number.isInteger(keyId)) return;
  try {
    await apiFetch('/api/gcal-sync-queue/reset?appt_id=' + apptId + '&key_id=' + keyId, { method: 'PUT', fallback: '重新嘗試失敗' });
    await refreshGcalSyncData(false);
    renderGcalPanel();
    toast('✅ 已重設指定同步項目', 'success');
  } catch (e) { toast(e.message, 'error'); }
}

export async function toggleGcalKey(id, on) {
  try {
    await apiFetch('/api/gcal-keys/' + id, {
      method: 'PUT', json: { is_active: on }, fallback: '操作失敗'
    });
    const k = gcalKeys.find(x => x.id === id);
    if (k) k.is_active = on;
    await refreshGcalSyncData(false);
    renderGcalPanel();
    toast(on ? '✅ 已啟用' : '已停用', on ? 'success' : '');
  } catch (e) { toast(e.message, 'error'); }
}

export async function deleteGcalKey(id) {
  const key = gcalKeys.find(k => k.id === id);
  const name = key ? key.name : '未知';
  if (!confirm('確定要刪除 Key「' + name + '」？\n\n此操作會同時刪除 Google 行事曆上已同步的事件。')) return;
  try {
    const data = await apiFetch('/api/gcal-keys/' + id, { method: 'DELETE' });
    gcalKeys = gcalKeys.filter(k => k.id !== id);
    if (selectedKeyId === id) selectedKeyId = gcalKeys.length ? gcalKeys[0].id : null;
    await refreshGcalSyncData(false);
    renderGcalPanel();
    var msg = '✅ Key「' + name + '」已刪除';
    if (data.google_deleted > 0) msg += '（Google 事件 ' + data.google_deleted + ' 筆已清除）';
    if (data.google_failed > 0) msg += '⚠️ Google 事件 ' + data.google_failed + ' 筆清除失敗';
    toast(msg, data.google_failed > 0 ? 'error' : 'success');
  } catch (e) {
    // HTTP 錯誤：字串 detail 原文顯示；Google 事件未刪完（409 物件 detail）或非 JSON 錯誤頁顯示專屬說明
    const httpError = e.name === 'ApiError' && e.status >= 400;
    const readable = httpError && typeof e.detail === 'string';
    if (readable) toast(e.message, 'error');
    else if (httpError) toast('Google 事件刪除未完成，Key 與同步問題已保留，請先處理同步清單', 'error');
    else toast('❌ 刪除失敗：' + e.message, 'error');
  }
}

export async function bindGcalUser(userId, keyName) {
  try {
    await apiFetch('/api/users/' + userId, {
      method: 'PUT', json: { gcal_key: keyName }, fallback: '綁定失敗'
    });
    const u = gcalUsers.find(x => x.id === userId);
    if (u) u.gcal_key = keyName;
    await refreshGcalSyncData(false);
    renderGcalPanel();
    toast('✅ 已綁定', 'success');
  } catch (e) { toast(e.message, 'error'); }
}

// 模組載入時要執行的副作用：由頁面 entry 依原本的載入順序呼叫（issue #39）
// 設定頁啟動時載入行事曆同步面板需要的資料，並預選第一個 Key（由 settings/page.js 的 initSettingsPage 呼叫）
export async function loadGcalPanelData() {
  await Promise.all([loadGcalKeys(), loadGcalUsers(), loadGcalSettings(), loadGcalSyncStatus(), loadGcalQueue()]);
  if (gcalKeys.length && !selectedKeyId) selectedKeyId = gcalKeys[0].id;
}
