// gcal-key.js — Google 行事曆同步 Key 新增/編輯 Modal
// 依賴：utils.js（esc/toast）、settings.js（gcalKeys/loadGcalKeys/renderGcalPanel）

var _gcalEditingId = null;  // null=新增, 數字=編輯

function gcalFileSelected(input) {
  const file = input && input.files && input.files[0];
  const meta = document.getElementById('gk-file-meta');
  const name = document.getElementById('gk-file-name');
  const hint = document.getElementById('gk-file-hint');
  const path = document.getElementById('gk-cred');
  if (file) {
    if (path) path.value = '';
    if (name) name.textContent = file.name;
    if (meta) meta.style.display = 'flex';
    if (hint) hint.textContent = '已選擇上傳檔案，不需要再輸入 JSON 路徑。';
  } else {
    clearGcalFile();
  }
}

function clearGcalFile() {
  const file = document.getElementById('gk-file');
  const meta = document.getElementById('gk-file-meta');
  const name = document.getElementById('gk-file-name');
  const hint = document.getElementById('gk-file-hint');
  if (file) file.value = '';
  if (meta) meta.style.display = 'none';
  if (name) name.textContent = '';
  if (hint) hint.textContent = '上傳後由伺服器固定儲存檔名；只會顯示 client_email，不會顯示 private_key。';
}

function openGcalKeyModal(id) {
  _gcalEditingId = id || null;
  const modal = document.getElementById('gcalKeyModal');
  if (!modal) return;

  if (_gcalEditingId) {
    // 編輯模式：填入現有值
    const k = gcalKeys.find(x => x.id === _gcalEditingId);
    document.getElementById('gk-name').value = k ? k.name : '';
    document.getElementById('gk-cred').value = k ? k.credentials_path : '';
    clearGcalFile();
    document.getElementById('gk-cal').value = k ? k.calendar_id : '';
    document.querySelector('#gcalKeyModal h4').textContent = '✏️ 編輯 Service Account Key';
  } else {
    // 新增模式
    document.getElementById('gk-name').value = '';
    document.getElementById('gk-cred').value = '';
    clearGcalFile();
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
  const file = document.getElementById('gk-file').files[0];
  if (!_gcalEditingId && !cred && !file) { toast('請上傳 JSON 或輸入 JSON 檔路徑', 'error'); return; }
  if (!cal) { toast('請輸入 Calendar ID', 'error'); return; }

  const url = _gcalEditingId ? '/api/gcal-keys/' + _gcalEditingId : '/api/gcal-keys';
  const method = _gcalEditingId ? 'PUT' : 'POST';
  const options = { method: method };
  if (_gcalEditingId) {
    if (!cred) { toast('請輸入 JSON 檔路徑', 'error'); return; }
    options.headers = { 'Content-Type': 'application/json' };
    options.body = JSON.stringify({ name: name, credentials_path: cred, calendar_id: cal });
  } else {
    const form = new FormData();
    form.append('name', name);
    form.append('calendar_id', cal);
    if (file) form.append('credentials_file', file);
    else form.append('credentials_path', cred);
    options.body = form;
  }

  try {
    const res = await fetch(url, options);
    const data = await res.json();
    if (!res.ok) { toast(data.detail || '儲存失敗', 'error'); return; }
    await loadGcalKeys();
    renderGcalPanel();
    closeGcalKeyModal();
    toast(_gcalEditingId ? '✅ 已更新' : '✅ 已新增', 'success');
  } catch (e) { toast('儲存失敗', 'error'); }
}
