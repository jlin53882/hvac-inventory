// gcal-key.js — Google 行事曆同步 Key 新增/編輯 Modal
// 依賴：utils.js（esc/toast）、settings.js（gcalKeys/loadGcalKeys/renderGcalPanel）

var _gcalEditingId = null;  // null=新增, 數字=編輯

function openGcalKeyModal(id) {
  _gcalEditingId = id || null;
  const modal = document.getElementById('gcalKeyModal');
  if (!modal) return;

  if (_gcalEditingId) {
    // 編輯模式：填入現有值
    const k = gcalKeys.find(x => x.id === _gcalEditingId);
    document.getElementById('gk-name').value = k ? k.name : '';
    document.getElementById('gk-cred').value = k ? k.credentials_path : '';
    document.getElementById('gk-cal').value = k ? k.calendar_id : '';
    document.querySelector('#gcalKeyModal h4').textContent = '✏️ 編輯 Service Account Key';
  } else {
    // 新增模式
    document.getElementById('gk-name').value = '';
    document.getElementById('gk-cred').value = '';
    document.getElementById('gk-cal').value = '';
    document.querySelector('#gcalKeyModal h4').textContent = '＋ 新增 Service Account Key';
  }
  modal.classList.add('show');
}

function closeGcalKeyModal() {
  const modal = document.getElementById('gcalKeyModal');
  if (modal) modal.classList.remove('show');
  _gcalEditingId = null;
}

async function submitGcalKey() {
  const name = (document.getElementById('gk-name').value || '').trim();
  const cred = (document.getElementById('gk-cred').value || '').trim();
  const cal = (document.getElementById('gk-cal').value || '').trim();

  if (!name) { toast('請輸入 Key 名稱', 'error'); return; }
  if (!cred) { toast('請輸入 JSON 檔路徑', 'error'); return; }
  if (!cal) { toast('請輸入 Calendar ID', 'error'); return; }

  const body = { name: name, credentials_path: cred, calendar_id: cal };
  const url = _gcalEditingId ? '/api/gcal-keys/' + _gcalEditingId : '/api/gcal-keys';
  const method = _gcalEditingId ? 'PUT' : 'POST';

  try {
    const res = await fetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) { toast(data.detail || '儲存失敗', 'error'); return; }
    await loadGcalKeys();
    renderGcalPanel();
    closeGcalKeyModal();
    toast(_gcalEditingId ? '✅ 已更新' : '✅ 已新增', 'success');
  } catch (e) { toast('儲存失敗', 'error'); }
}
