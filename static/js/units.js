// units.js — 單位動態清單共用元件（2026-08-16）
// 依賴：utils.js（esc/toast/hasPerm——hasPerm 在 utils.js:4）、api.js（fetch）
var unitList = [];          // 全量（含停用）——var：跨檔慣例（globals.js）
var unitListActive = [];    // 啟用中（select 用）

async function loadUnits() {
  try {
    const res = await fetch('/api/units');
    if (!res.ok) { console.error('[loadUnits] /api/units 失敗', res.status); return; }
    unitList = await res.json();
    unitListActive = unitList.filter(u => u.is_active);
  } catch (e) { console.error('[loadUnits] 網路錯誤', e); }
}

// 填充 select：active 單位 + 若 current 不在清單（歷史值）→ 補「（歷史）xxx」並選中
function fillUnitSelect(sel, current) {
  if (!sel) { console.error('[fillUnitSelect] select 元素不存在（id 打錯或 DOM 未建立）'); return; }
  sel.innerHTML = '';
  unitListActive.forEach(u => {
    const o = document.createElement('option');
    o.value = u.name; o.textContent = u.name;
    sel.appendChild(o);
  });
  const cur = (current || '').trim();
  if (cur && !unitListActive.some(u => u.name === cur)) {
    const o = document.createElement('option');
    o.value = cur; o.textContent = `（歷史）${cur}`;
    sel.appendChild(o);
  }
  if (cur) sel.value = cur;
  return sel;
}

// ＋ 快速新增：select 換 inline input → POST → 本地更新 → 重填並選中
// 顯示條件由呼叫端以 hasPerm('item-mgmt') 控制（add/edit/stockout.js）
function openUnitQuickAdd(sel, addBtn) {
  if (!sel) { console.error('[openUnitQuickAdd] select 不存在'); return; }
  const wrap = sel.parentElement;
  const input = document.createElement('input');
  input.placeholder = '新單位，例如：顆';
  input.maxLength = 20;
  const ok = document.createElement('button');
  ok.textContent = '新增';
  ok.className = 'btn-save';
  const cancel = document.createElement('button');
  cancel.textContent = '取消';
  cancel.className = 'btn-ghost';
  sel.style.display = 'none'; if (addBtn) addBtn.style.display = 'none';
  const box = document.createElement('div');
  box.className = 'unit-quick-add';
  box.style.cssText = 'display:flex;gap:6px;margin-top:6px;width:100%';
  box.append(input, ok, cancel);
  wrap.appendChild(box);
  input.focus();
  ok.onclick = async () => {
    const name = input.value.trim();
    if (!name) return;
    try {
      const res = await fetch('/api/units', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      const data = await res.json();
      if (!res.ok) { toast(data.detail || '新增失敗', 'error'); return; }
      unitList.push(data);
      unitListActive = unitList.filter(u => u.is_active);
      box.remove(); sel.style.display = ''; if (addBtn) addBtn.style.display = '';
      fillUnitSelect(sel, name);
      toast(`✅ 單位「${name}」已新增`, 'success');
    } catch (e) { console.error('[openUnitQuickAdd] 新增單位失敗', e); toast('新增失敗', 'error'); }
  };
  cancel.onclick = () => { box.remove(); sel.style.display = ''; if (addBtn) addBtn.style.display = ''; };
}
