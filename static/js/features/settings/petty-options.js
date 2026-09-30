// 庫存管理系統 - 設定頁：零用金選項

import { apiFetch } from '../../core/api-client.js';
import { esc, hasPerm, toast } from '../../core/utils.js';

// ========== 零用金下拉選單管理（general / engineering 分離） ==========
var pettyOptionCache = { general: { category: [], group: [] }, engineering: { category: [], group: [] } };
export async function loadPettyOptions() {
  for (const type of ['general', 'engineering']) {
    for (const kind of ['category', 'group']) {
      const data = await apiFetch('/api/petty-cash-options?report_type=' + type + '&option_type=' + kind).catch(() => null);
      if (data) pettyOptionCache[type][kind] = data.items || [];
    }
  }
}
function pettyOptionRows(type, kind, can) {
  const items = pettyOptionCache[type][kind] || [];
  if (!items.length) return '<div class="pc-option-empty">尚未設定選項</div>';
  return items.map((o, i) => '<div class="pc-option-row"><div><span class="pc-option-index">' + (i + 1) + '</span><strong>' + esc(o.name) + '</strong><small class="pc-option-status ' + (o.is_active ? 'is-active' : 'is-off') + '">' + (o.is_active ? '● 使用中' : '○ 已停用') + '</small></div>' + (can ? '<span class="pc-option-actions"><button type="button" class="btn btn--secondary btn--sm pc-icon-action" data-petty-action="rename" data-id="' + o.id + '" data-type="' + esc(type) + '" data-kind="' + esc(kind) + '">✎ 編輯</button><button type="button" class="btn btn--danger btn--sm pc-icon-action" data-petty-action="delete" data-id="' + o.id + '" data-type="' + esc(type) + '" data-kind="' + esc(kind) + '">🗑 刪除</button></span>' : '') + '</div>').join('');
}
export function renderPettyOptionsPanel() {
  const can = hasPerm('petty-cash-config');
  const panel = document.getElementById('panel-petty-cash');
  if (!panel) return;
  let html = '<div class="pc-settings-title"><div><h4>🪙 零用金選單</h4><p>管理零用金報表使用的科目、分類與項目，資料不與其他報表類型共用。</p></div></div>';
  html += '<section class="pc-option-settings pc-option-settings--general"><div class="pc-settings-card-head"><div><span class="pc-settings-icon">💳</span><div><h5>一般零用金</h5><p>管理一般零用金使用的科目</p></div></div><span class="pc-settings-note">ⓘ 僅需設定科目</span></div>';
  if (can) html += '<div class="pc-option-add"><label for="pc-opt-name-general-category">新增科目</label><div class="pc-option-add-row"><input id="pc-opt-name-general-category" maxlength="100" placeholder="輸入科目名稱（例如：文具費）"><button class="btn btn--primary btn--md btn-primary" data-action="settings-petty-option-create" data-scope="general" data-kind="category">＋ 新增科目</button></div></div>';
  html += '<div class="pc-option-list-head"><span>#　科目名稱</span><span>操作</span></div><div class="pc-option-list">' + pettyOptionRows('general', 'category', can) + '</div></section>';
  html += '<section class="pc-option-settings pc-option-settings--engineering"><div class="pc-settings-card-head"><div><span class="pc-settings-icon">👷</span><div><h5>工程零用金</h5><p>管理工程零用金使用的分類與項目</p></div></div></div><div class="pc-option-engineering-grid">';
  for (const kind of ['category', 'group']) {
    const label = kind === 'category' ? '📁 分類選項' : '📦 項目選項';
    const placeholder = kind === 'category' ? '輸入分類名稱（例如：交通費）' : '輸入項目名稱（例如：油資）';
    html += '<div class="pc-option-column"><div class="pc-option-column-head"><div><h6>' + label + '</h6><p>工程零用金' + (kind === 'category' ? '分類' : '項目') + '</p></div><b>' + (pettyOptionCache.engineering[kind] || []).length + ' 筆</b></div>';
    if (can) html += '<div class="pc-option-add"><label for="pc-opt-name-engineering-' + kind + '">新增' + (kind === 'category' ? '分類' : '項目') + '</label><div class="pc-option-add-row"><input id="pc-opt-name-engineering-' + kind + '" maxlength="100" placeholder="' + placeholder + '"><button class="btn btn--primary btn--md btn-primary" data-action="settings-petty-option-create" data-scope="engineering" data-kind="' + kind + '">＋ 新增</button></div></div>';
    html += '<div class="pc-option-list">' + pettyOptionRows('engineering', kind, can) + '</div></div>';
  }
  html += '</div></section>';
  panel.innerHTML = html;
  panel.querySelectorAll('[data-petty-action]').forEach(button => button.addEventListener('click', () => {
    const id = Number(button.dataset.id), type = button.dataset.type, kind = button.dataset.kind;
    if (button.dataset.pettyAction === 'rename') renamePettyOption(id, type, kind);
    else deletePettyOption(id, type, kind);
  }));
}
export async function createPettyOptionKind(type, kind) {
  const input = document.getElementById('pc-opt-name-' + type + '-' + kind);
  const name = input.value.trim();
  if (!name) return toast('請輸入選單名稱', 'error');
  try { await apiFetch('/api/petty-cash-options', { method:'POST', json: {report_type:type, option_type:kind, name:name, sort_order:pettyOptionCache[type][kind].length}, fallback:'新增失敗' }); }
  catch (e) { return toast(e.message, 'error'); }
  await loadPettyOptions(); renderPettyOptionsPanel(); toast('✅ 已新增', 'success');
}

async function renamePettyOption(id, type, kind) {
  const old = (pettyOptionCache[type][kind].find(o => o.id === id) || {}).name || '';
  const name = prompt('請輸入新的選單名稱', old);
  if (name === null || !name.trim()) return;
  try { await apiFetch('/api/petty-cash-options/' + id, { method:'PUT', json: {name:name.trim()}, fallback:'修改失敗' }); }
  catch (e) { return toast(e.message, 'error'); }
  await loadPettyOptions(); renderPettyOptionsPanel();
}
async function deletePettyOption(id, type, kind) {
  if (!confirm('確定刪除此下拉選單項目？')) return;
  try { await apiFetch('/api/petty-cash-options/' + id, { method:'DELETE', fallback:'刪除失敗' }); }
  catch (e) { return toast(e.message, 'error'); }
  await loadPettyOptions(); renderPettyOptionsPanel();
}
