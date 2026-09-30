// core/units.js — 單位動態清單共用元件（2026-08-16）

import { createActionDelegate } from './actions.js';
import { apiFetch } from './api-client.js';
import { getActiveUnitList, setActiveUnitList } from './shared-read-model.js';
import { toast } from './utils.js';

export var unitList = [];          // 全量（含停用）

export async function loadUnits() {
  try {
    unitList = await apiFetch('/api/units');
    setActiveUnitList(unitList.filter(u => u.is_active));
  } catch (e) { console.error('[loadUnits] /api/units 失敗', e.status, e.message); }
}

// 填充 select：active 單位 + 若 current 不在清單（歷史值）→ 補「（歷史）xxx」並選中
export function fillUnitSelect(sel, current) {
  if (!sel) { console.error('[fillUnitSelect] select 元素不存在（id 打錯或 DOM 未建立）'); return; }
  sel.innerHTML = '';
  getActiveUnitList().forEach(u => {
    const o = document.createElement('option');
    o.value = u.name; o.textContent = u.name;
    sel.appendChild(o);
  });
  const cur = (current || '').trim();
  if (cur && !getActiveUnitList().some(u => u.name === cur)) {
    const o = document.createElement('option');
    o.value = cur; o.textContent = `（歷史）${cur}`;
    sel.appendChild(o);
  }
  if (cur) sel.value = cur;
  return sel;
}

// 搜尋過濾單位（2026-08-16：單位多時用搜尋較快）——input 輸入 → 下拉只留「包含」該文字的單位
export function filterUnitSelect(input, selId) {
  const sel = document.getElementById(selId);
  if (!sel) { console.error('[filterUnitSelect] select 不存在:', selId); return; }
  const kw = (input.value || '').trim();
  if (!kw) { fillUnitSelect(sel, sel.value); return; }  // 清空 → 還原全部
  const cur = sel.value;
  sel.innerHTML = '';
  getActiveUnitList().filter(u => u.name.includes(kw)).forEach(u => {
    const o = document.createElement('option');
    o.value = u.name; o.textContent = u.name;
    sel.appendChild(o);
  });
  if (cur && [...sel.options].some(o => o.value === cur)) sel.value = cur;
}

// ＋ 快速新增：select 換 inline input → POST → 本地更新 → 重填並選中
// 顯示條件由呼叫端以 hasPerm('item-mgmt') 控制（add/edit/stockout.js）
export function openUnitQuickAdd(sel, addBtn) {
  if (!sel) { console.error('[openUnitQuickAdd] select 不存在'); return; }
  const wrap = sel.parentElement;
  const input = document.createElement('input');
  input.placeholder = '新單位，例如：顆';
  input.maxLength = 20;
  const ok = document.createElement('button');
  ok.textContent = '新增';
  ok.className = 'btn btn--primary btn--sm';
  const cancel = document.createElement('button');
  cancel.textContent = '取消';
  cancel.className = 'btn btn--secondary btn--sm';
  sel.style.display = 'none'; if (addBtn) addBtn.style.display = 'none';
  const box = document.createElement('div');
  box.className = 'unit-quick-add';
  box.append(input, ok, cancel);
  wrap.appendChild(box);
  input.focus();
  ok.onclick = async () => {
    const name = input.value.trim();
    if (!name) return;
    // 2026-08-16：已在清單（含停用）→ 提示不新增
    if (unitList.some(u => u.name === name)) {
      toast(`⚠️ 單位「${name}」已存在`, 'error');
      return;
    }
    try {
      const data = await apiFetch('/api/units', {
        method: 'POST',
        json: { name },
        fallback: '新增失敗'
      });
      unitList.push(data);
      setActiveUnitList(unitList.filter(u => u.is_active));
      box.remove(); sel.style.display = ''; if (addBtn) addBtn.style.display = '';
      fillUnitSelect(sel, name);
      toast(`✅ 單位「${name}」已新增`, 'success');
    } catch (e) { console.error('[openUnitQuickAdd] 新增單位失敗', e); toast(e.message, 'error'); }
  };
  cancel.onclick = () => { box.remove(); sel.style.display = ''; if (addBtn) addBtn.style.display = ''; };
}

// 單位下拉的事件委派（data-action="core-unit-*"；data-target 是目標 <select> 的 id）
const UNIT_ACTIONS = {
  'core-unit-filter': { input: function(el) { filterUnitSelect(el, el.dataset.target); } },
  'core-unit-quick-add': { click: function(el) { openUnitQuickAdd(document.getElementById(el.dataset.target), el); } },
};

const unitDelegate = createActionDelegate('core-unit-', UNIT_ACTIONS);

export const handleUnitEvent = unitDelegate.handle;

export const initUnitActions = unitDelegate.init;
