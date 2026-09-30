// 整組 Modal 的材料列編輯器：已選材料列、數量修改、材料搜尋候選清單（新增 / 編輯整組共用；issue #39 自 kits/page.js 抽出，
// 讓 kit-modal.js 不必 import 整組頁）

import { Qty } from '../../core/qty.js';
import { getAllItems } from '../../core/inventory-read-model.js';
import { esc, toast } from '../../core/utils.js';
import { kitsState } from './state.js';

// 渲染整組 Modal 的材料選擇（demo 樣式：已選灰卡片列 + 單一可搜尋輸入框）

// 資料存 kitModalCompRows：[{item_id, qty}...]；選中材料自動 push 新列

// 2026-09-12：材料需求量支援分數（Qty.parse；非法 toast 並還原舊值；數量>0 由後端驗證）
export function kitCompQtyChanged(idx, rawVal) {
  const row = kitsState.kitModalCompRows[idx];
  if (!row) return;
  const sel = row.item_id ? getAllItems().find(i => i.id == row.item_id) : null;
  const v = Qty.validFor(rawVal, sel ? Qty.inputTypeOf(sel.unit) : 'fraction');
  if (!v.ok || v.value <= 0) { toast(v.error || '材料數量必須大於 0', 'error'); renderKitCompRows(); return; }
  row.qty = v.value;
  renderKitCompRows();
}

export function renderKitCompRows() {

  const wrap = document.getElementById('kit-comps');

  let html = '';

  if (!kitsState.kitModalCompRows.length) {

    html = '<div class="kit-empty">尚未加入材料</div>';

  } else {

    html = kitsState.kitModalCompRows.map((row, idx) => {

      const sel = row.item_id ? getAllItems().find(i => i.id == row.item_id) : null;

      return `<div class="selected-row">

        <div class="info">

          <div class="nm">${sel ? esc(sel.brand) + ' ' + esc(sel.name) : ''}</div>

          <div class="bd">${sel ? `${sel.code ? `型號 <span class="model">${esc(sel.code)}</span> ・ ` : ''}庫存 ${Qty.format(sel.qty, Qty.unitTypeOf(sel.unit))} ${esc(sel.unit || '個')}` : ''}</div>

        </div>

        <input type="text" inputmode="decimal" value="${row.qty || 1}" placeholder="例：1、0.5、1/4" onchange="Kits.kitCompQtyChanged(${idx}, this.value)">

        <button class="rm" onclick="Kits.removeKitCompRow(${idx})">✕</button>

      </div>`;

    }).join('');

  }

  // 單一可搜尋輸入框（🔍 搜尋材料想加的…）

  html += `<div class="mat-search" data-role="mat-search">

    <div class="input-wrap">

      <input type="text" id="kit-mat-input" placeholder="🔍 搜尋材料想加的（名稱/型號/廠牌）…" autocomplete="off"

        onfocus="Kits.openKitSearch()" oninput="Kits.filterKitSearch(this.value)">

      <span class="caret">▼</span>

    </div>

    <div class="kit-dropdown" data-role="kit-dropdown" id="kit-drop"></div>

  </div>`;

  wrap.innerHTML = html;

}


// 開啟材料候選清單（顯示前 15 筆）

export function openKitSearch() {

  filterKitSearch(document.getElementById('kit-mat-input').value);

}


// 依關鍵字過濾材料（名稱/型號/廠牌）並渲染候選清單

export function filterKitSearch(kw) {

  const drop = document.getElementById('kit-drop');

  const q = (kw || '').trim().toLowerCase();

  let list = getAllItems().filter(i => !i.is_kit);

  if (q) list = list.filter(i => (i.brand + ' ' + i.name + ' ' + (i.code || '')).toLowerCase().includes(q));

  list = list.slice(0, 15);

  if (!list.length) {

    drop.innerHTML = '<div class="kit-drop-empty">找不到符合的材料</div>';

  } else {

    drop.innerHTML = list.map(it => `

      <div class="kit-drop-opt" onclick="Kits.pickKitItem(${it.id})">

        <div><div class="nm">${esc(it.brand)} ${esc(it.name)}</div><div class="bd">${it.code ? `型號 <span class="model">${esc(it.code)}</span> ・ ` : ''}${esc(it.unit || '')}</div></div>

        <span class="stk">庫存 ${it.qty}</span>

      </div>`).join('');

  }

  drop.classList.add('is-open');

}


// 選中候選材料：已加過同材料 → 數量 +1；否則新增一列；清空搜尋框、收合候選清單

export function pickKitItem(itemId) {

  const it = getAllItems().find(i => i.id === itemId);

  if (!it) return;

  const exist = kitsState.kitModalCompRows.findIndex(r => r.item_id == itemId);

  if (exist >= 0) {

    kitsState.kitModalCompRows[exist].qty = (kitsState.kitModalCompRows[exist].qty || 1) + 1;

  } else {

    kitsState.kitModalCompRows.push({ item_id: itemId, qty: 1 });

  }

  const input = document.getElementById('kit-mat-input');

  if (input) input.value = '';

  document.getElementById('kit-drop').classList.remove('is-open');

  renderKitCompRows();

  const ni = document.getElementById('kit-mat-input');

  if (ni) ni.focus();

}
