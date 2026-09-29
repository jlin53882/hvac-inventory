// 庫存管理系統 - 整組頁渲染（v8 拆分）

import { buildThumb, photoSrc } from '../../components/card.js';
import { openSharedStatusListModal, statusListFormatQuantity } from '../../components/status-list.js';
import { apiFetch } from '../../core/api-client.js';
import { isMobileView, openSheet } from '../../core/bottomsheet.js';
import { loadData } from '../../core/data.js';
import { updateNotifications } from '../../core/notifications.js';
import { Qty } from '../../core/qty.js';
import { filterBySearch } from '../../core/search.js';
import { appState } from '../../core/state.js';
import { esc, hasPerm, jsStr, openModal, toast } from '../../core/utils.js';
import { renderKitPhotoBox } from '../inventory/photo.js';
import { loadKitCabinetOptions, renderKitLocationRows } from './kit-modal.js';
import { kitsState } from './state.js';

// ========== 整組（套件）頁籤 ==========
var kitRenderRequestSeq = 0;

export async function renderKits() {
  var renderRequestId = ++kitRenderRequestSeq;
  var siteAtRequest = appState.currentSite;
  const content = document.getElementById('content');
  content.innerHTML = '<div class="loading"><div class="spin"></div><div>載入整組清單…</div></div>';
  const isViewer = !hasPerm('kit-mgmt');

  try {
    const kits = await apiFetch(`/api/kits?site=${siteAtRequest}`);
    if (renderRequestId !== kitRenderRequestSeq || appState.currentTab !== 'kit' || siteAtRequest !== appState.currentSite) return;
    appState.currentKitItems = filterBySearch(kits, function(k) {
      return [k.name, k.brand, k.code, k.note, (k.components || []).map(function(c) {
        return c.brand + ' ' + c.name + ' ' + (c.code || '');
      }).join(' ')].join(' ');
    });
    const filteredKits = appState.currentKitItems;
    updateNotifications();
    const isM = isMobileView();
    let html = renderKitPageHeader(isViewer);
    html += renderKitDashboard(getKitDashboardStats(filteredKits));
    html += renderKitToolbar(filteredKits.length);

    if (!filteredKits.length) {
      const hasSearch = !!(document.getElementById('search-input') && document.getElementById('search-input').value.trim());
      html += `<div class="kit-empty-state">
        <div class="kit-empty-icon" aria-hidden="true">🔧</div>
        <h2>${esc(hasSearch ? '沒有符合搜尋條件的整組' : '目前沒有整組資料') }</h2>
        <p>${esc(hasSearch ? '可以清除搜尋或調整關鍵字。' : '可以建立整組並加入組成材料。') }</p>
        ${hasSearch ? '<button class="btn btn--secondary btn--sm kit-action" onclick="App.clearSearchAutofill();Kits.renderKits()">清除搜尋</button>' : (isViewer ? '' : '<button class="btn btn--primary btn--md kit-add-button" onclick="Kits.openKitModal()">＋ 新增整組</button>')}
      </div>`;
    } else {
      html += filteredKits.map(function(k) { return renderKitCard(k, isViewer, isM); }).join('');
    }
    content.innerHTML = html;
  } catch (e) {
    if (renderRequestId !== kitRenderRequestSeq || appState.currentTab !== 'kit' || siteAtRequest !== appState.currentSite) return;
    content.innerHTML = `<div class="kit-empty-state"><div class="kit-empty-icon" aria-hidden="true">⚠️</div><h2>載入整組庫存失敗</h2><p>${esc(e.message || '請稍後再試')}</p><button class="btn btn--secondary btn--sm kit-action" onclick="Kits.renderKits()">重新載入</button></div>`;
  }
}

function formatKitNumber(value) {
  const n = Number(value || 0);
  return (Math.round(n * 1000) / 1000).toLocaleString('en-US');
}

export function getKitStatus(kit) {
  const components = Array.isArray(kit.components) ? kit.components : [];
  const hasShortage = components.some(function(c) {
    return Number(c.need_qty || 0) > 0 && Number(c.stock || 0) <= 0;
  });
  const hasInsufficient = !hasShortage && components.some(function(c) {
    // 2026-09-12：容差 1e-9（0.3 vs 0.1+0.2 塵不得誤判不足）
    return Number(c.stock || 0) < Number(c.need_qty || 0) - 1e-9;
  });
  return {
    status: hasShortage ? 'shortage' : (hasInsufficient ? 'insufficient' : 'normal'),
    canAssemble: !hasShortage && !hasInsufficient,
  };
}

function getKitDashboardStats(kits) {
  const materialIds = new Set();
  let shortageCount = 0;
  let insufficientCount = 0;
  (kits || []).forEach(function(kit) {
    (kit.components || []).forEach(function(component) {
      const key = component.item_id !== undefined && component.item_id !== null
        ? String(component.item_id)
        : [component.brand, component.name, component.code || ''].join('|');
      materialIds.add(key);
    });
    const status = getKitStatus(kit).status;
    if (status === 'shortage') shortageCount += 1;
    else if (status === 'insufficient') insufficientCount += 1;
  });
  return {
    kitCount: (kits || []).length,
    materialCount: materialIds.size,
    insufficientCount: insufficientCount,
    shortageCount: shortageCount,
  };
}

function renderKitPageHeader(isViewer) {
  return `<section class="kit-page-header">
    <div class="kit-heading-copy">
      <div class="kit-heading-icon" aria-hidden="true">🔧</div>
      <div><h1>整組庫存</h1><p>管理設備整組與其組成材料，查看庫存狀態與需求數量。</p></div>
    </div>
    ${isViewer ? '' : '<button class="btn btn--primary btn--md kit-add-button" onclick="Kits.openKitModal()">＋ 新增整組</button>'}
  </section>`;
}

function renderKitDashboard(stats) {
  const cards = [
    ['📦', stats.kitCount, '整組總數', ''],
    ['🧩', stats.materialCount, '組成材料', ''],
    ['⚠️', stats.insufficientCount, '庫存不足(個)', 'is-warning', 'insufficient'],
    ['⛔', stats.shortageCount, '缺料(個)', 'is-danger', 'shortage'],
  ];
  return `<section class="kit-kpi-grid ui-kpi-grid" aria-label="整組庫存統計">${cards.map(function(card) { const clickable = !!card[4]; const attrs = clickable ? ` role="button" tabindex="0" aria-label="查看${esc(card[2])}清單" onclick="Kits.showKitStatusList('${card[4]}')" onkeydown="if(event.key === 'Enter' || event.key === ' ') { event.preventDefault(); Kits.showKitStatusList('${card[4]}'); }"` : ''; const tone = card[4] === 'insufficient' ? 'amber' : card[4] === 'shortage' ? 'red' : card[0] === '🧩' ? 'purple' : 'blue'; const meta = card[4] === 'insufficient' ? '庫存不足 · 查看清單' : card[4] === 'shortage' ? '缺料 · 查看清單' : card[0] === '🧩' ? '不重複材料' : '目前篩選結果'; return `<div class="kit-kpi-card ui-kpi-card ui-kpi-card--${esc(tone)} ${esc(card[3])}${clickable ? ' is-clickable' : ''}"${attrs}><span class="kit-kpi-icon ui-kpi-icon" aria-hidden="true">${esc(card[0])}</span><div class="ui-kpi-body"><div class="kit-kpi-label ui-kpi-label">${esc(card[2])}</div><div class="kit-kpi-number ui-kpi-value">${esc(formatKitNumber(card[1]))}</div><span class="ui-kpi-meta">${esc(meta)}</span></div>${clickable ? '<span class="kit-kpi-arrow" aria-hidden="true">›</span>' : ''}</div>`; }).join('')}</section>`
}

function renderKitToolbar(count) {
  const search = document.getElementById('search-input');
  const query = search ? search.value.trim() : '';
  const searchText = query ? `目前搜尋：${query}` : '使用上方搜尋框搜尋整組、材料、型號';
  // 2026-09-27 整組庫存匯出（預設本月）
  const now = new Date();
  const month_start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const month_end = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
  return `<div class="kit-toolbar"><span class="kit-toolbar-count">共 ${esc(formatKitNumber(count))} 組</span><span class="kit-toolbar-search">🔍 <b>${esc(searchText)}</b></span><button class="btn btn--export btn--md btn-export" onclick="Kits.openKitExportDialog()">📊 匯出報表</button></div>`;
}

function renderKitStatusBadge(status) {
  if (status === 'shortage') return '<span class="kit-status-badge is-shortage">缺料</span>';
  if (status === 'insufficient') return '<span class="kit-status-badge is-insufficient">庫存不足</span>';
  return '';
}

function renderKitActionButtons(k, isViewer, isM, status) {
  if (isViewer) return '';
  const transfer = hasPerm('stock-mgmt') ? `<button class="btn btn--secondary btn--sm kit-action" onclick="Inventory.openTransferModal(${k.item_id})">🔄 調撥</button>` : '';
  if (isM) return `<div class="kit-mobile-actions"><button class="btn btn--prepare btn--sm kit-action is-prepare" onclick="Stockout.openKitPrepareModal(${k.item_id}, '${esc(jsStr(k.name))}')">📤 待領出</button><button class="btn btn--out btn--sm kit-action is-out" onclick="Stockout.openOutModal(${k.item_id}, event)">🚚 已領出</button>${transfer}<button class="kit-more" type="button" onclick="Kits.openKitSheet(${k.id})" aria-label="整組操作">⋯</button></div>`;
  return `<div class="kit-assembly-actions">
    <button class="btn btn--prepare btn--sm kit-action is-prepare" onclick="Stockout.openKitPrepareModal(${k.item_id}, '${esc(jsStr(k.name))}')">📤 待領出</button>
    <button class="btn btn--out btn--sm kit-action is-out" onclick="Stockout.openOutModal(${k.item_id}, event)">🚚 已領出</button>
    <button class="btn btn--secondary btn--sm kit-action is-edit" onclick="Kits.editKit(${k.id})">✏️ 編輯</button>
    <button class="btn btn--danger btn--sm kit-action is-delete" onclick="Kits.deleteKit(${k.id})">🗑 刪除</button>
    <button class="btn btn--secondary btn--sm kit-action is-assemble" onclick="Kits.assembleKit(${k.id})" ${esc(status.canAssemble ? '' : 'disabled title="材料不足"')}>🛠️ 組裝</button>
    <button class="btn btn--secondary btn--sm kit-action is-disassemble" onclick="Kits.disassembleKit(${k.id})" ${Number(k.stock_qty || 0) > 0 ? '' : 'disabled title="整組庫存為 0"'}>✂️ 拆解</button>
  </div>` + transfer;
}

function renderKitComponentRow(c) {
  const stock = Number(c.stock || 0);
  const need = Number(c.need_qty || 0);
  const state = stock <= 0 && need > 0 ? 'shortage' : (stock < need - 1e-9 ? 'insufficient' : 'normal'); // 2026-09-12 塵容差
  const stateLabel = state === 'shortage' ? '缺料' : (state === 'insufficient' ? '庫存不足' : '正常');
  const stateClass = `kit-component-status is-${state}`;
  const photo = c.has_photo ? `<img src="${photoSrc(c.item_id, 'thumbnail')}" alt="" onclick="Inventory.openPhotoLightbox(${c.item_id})" title="點擊看大圖">` : '<span class="cphoto-empty">📷</span>';
  return `<tr>
    <td class="kit-component-photo"><span class="cphoto">${photo}</span></td>
    <td><div class="kit-component-info">
      <span class="kit-component-name">${esc(c.brand || '')} ${esc(c.name || '')}</span>${c.code ? `<span class="kit-component-model">型號 ${esc(c.code)}</span>` : ''}
    </div></td>
    <td class="kit-component-qty">${esc(Qty.format(need, Qty.unitTypeOf(c.unit)))} ${esc(c.unit || '')}</td>
    <td class="kit-component-qty">${esc(Qty.format(stock, Qty.unitTypeOf(c.unit)))} ${esc(c.unit || '')}</td>
    <td><span class="${esc(stateClass)}">${esc(stateLabel)}</span></td>
  </tr>`;
}

/**
 * Collect Kit card locations with their notes, one entry per "櫃子 | 位置".
 * Actual item_stocks positions come first; suggested storage rows saved in the Kit
 * editor (kit_locations) follow. Same location → merged, notes de-duplicated.
 * Blank-location stock rows are skipped (their note mirrors kits.note).
 * Pure function for runtime tests.
 * @param {Object} k Kit response with stock_positions and locations.
 * @returns {Array<{label: string, notes: string[]}>} Unescaped entries.
 */
function kitLocationEntries(k) {
  const entries = [];
  const add = (label, note) => {
    if (!label) return;
    let entry = entries.find(e => e.label === label);
    if (!entry) {
      entry = { label: label, notes: [] };
      entries.push(entry);
    }
    if (note && !entry.notes.includes(note)) entry.notes.push(note);
  };
  (Array.isArray(k && k.stock_positions) ? k.stock_positions : []).forEach(position => {
    add(String(position.location || '').trim(), String(position.note || '').trim());
  });
  (Array.isArray(k && k.locations) ? k.locations : []).forEach(loc => {
    const cabinet = String(loc.cabinet || '').trim();
    const position = String(loc.position || '').trim();
    add(cabinet && position ? `${cabinet} | ${position}` : (cabinet || position), String(loc.note || '').trim());
  });
  return entries;
}

/**
 * Render the Kit card location list: one row per location, note beside it.
 * @param {Array<{label: string, notes: string[]}>} entries From kitLocationEntries.
 * @returns {string} Escaped HTML ('' when there are no locations).
 */
function renderKitLocationList(entries) {
  if (!entries.length) return '';
  const rows = entries.map(e =>
    '<li class="kit-loc-item"><span class="kit-loc-name">' + esc(e.label) + '</span>' +
    (e.notes.length ? '<span class="kit-loc-note">' + esc(e.notes.join('；')) + '</span>' : '') +
    '</li>').join('');
  return '<div class="kit-loc-block"><div class="kit-loc-title">📍 存放位置</div><ul class="kit-loc-list">' + rows + '</ul></div>';
}

/**
 * Render a Kit card with its stock positions and suggested storage locations.
 * @param {Object} k Kit response including stock_positions and components.
 * @param {boolean} isViewer Whether controls should be read-only.
 * @param {boolean} isM Whether the card is rendered in the mobile view.
 * @returns {string} Escaped Kit card HTML.
 */
function renderKitCard(k, isViewer, isM) {
  const status = getKitStatus(k);
  const components = Array.isArray(k.components) ? k.components : [];
  const stockQty = Number(k.stock_qty || 0);
  // 整組照片（表格與卡片共用 buildThumb 顯示）
  const kitThumb = buildThumb(k.item_id, !!k.has_photo, k.name, '🔧', k.thumbnail_url);
  // 位置顯示：實際庫存位置（item_stocks）+ 編輯整組填的建議存放位置（kit_locations）
  // 每個位置一行、備註接在該位置後面；整組備註另起一行
  const detailLines = renderKitLocationList(kitLocationEntries(k)) +
    (k.note ? '<div class="kit-detail-line kit-note-tag">📝 ' + esc(k.note) + '</div>' : '');
  return `<article class="kit-assembly-card is-${esc(status.status)}">
    <header class="kit-assembly-header">
      <div class="kit-photo-slot">${kitThumb}</div>
      <div class="kit-info-slot">
        <div class="kit-name">${esc(k.brand || '') ? esc(k.brand) + ' ' : ''}${esc(k.name || '未命名整組')}</div>
        <div class="kit-meta">
          ${k.code ? `<span class="kit-code">型號 ${esc(k.code)}</span>` : ''}
          <span class="kit-stock-badge ${stockQty > 0 ? '' : 'is-empty'}">庫存 ${esc(Qty.format(stockQty, 'integer'))} ${esc(k.unit || '組')}</span>
          ${renderKitStatusBadge(status.status)}
          <span class="kit-comp-count">${components.length} 項組成材料</span>
        </div>
        ${detailLines ? `<div class="kit-detail-lines">${detailLines}</div>` : ''}
      </div>
      <div class="kit-actions-slot">
        ${renderKitActionButtons(k, isViewer, isM, status)}
      </div>
    </header>
    <div class="kit-component-wrap"><table class="kit-component-table"><colgroup><col class="kit-col-photo"><col class="kit-col-info"><col class="kit-col-need"><col class="kit-col-stock"><col class="kit-col-status"></colgroup><thead><tr><th>照片</th><th>材料</th><th>需求數量</th><th>目前庫存</th><th>狀態</th></tr></thead><tbody>
      ${components.map(renderKitComponentRow).join('')}</tbody></table></div>
  </article>`;
}

// 渲染整組 Modal 的材料選擇（demo 樣式：已選灰卡片列 + 單一可搜尋輸入框）

// 資料存 kitModalCompRows：[{item_id, qty}...]；選中材料自動 push 新列

// 2026-09-12：材料需求量支援分數（Qty.parse；非法 toast 並還原舊值；數量>0 由後端驗證）
export function kitCompQtyChanged(idx, rawVal) {
  const row = kitsState.kitModalCompRows[idx];
  if (!row) return;
  const sel = row.item_id ? appState.ALL_ITEMS.find(i => i.id == row.item_id) : null;
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

      const sel = row.item_id ? appState.ALL_ITEMS.find(i => i.id == row.item_id) : null;

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

  let list = appState.ALL_ITEMS.filter(i => !i.is_kit);

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

  const it = appState.ALL_ITEMS.find(i => i.id === itemId);

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



// 組裝整組：輸入組數 → POST /api/kits/{id}/assemble 扣材料、加整組庫存

export async function assembleKit(kitId) {
  const qty = prompt('要組裝幾組？', 1);
  if (qty === null) return;
  // 2026-09-12：組數必須整數；Qty.parse 拒絕 "1.5"→1、"1/2"→1 的截斷
  const _pa = Qty.parse(qty);
  const n = _pa && !_pa.error ? _pa.value : parseInt(qty);
  if (!n || n <= 0 || (_pa && !_pa.error && _pa.den !== 1)) { toast('組裝組數必須為正整數', 'error'); return; }
  try {
    await apiFetch(`/api/kits/${kitId}/assemble`, { method: 'POST', json: { qty: n }, fallback: '組裝失敗' });
    toast(`✅ 已組裝 ${n} 組（材料已扣）`, 'success');
    await loadData();
  } catch (e) {
    toast('⚠️ ' + e.message, 'error');
  }
}



// 拆解整組：輸入組數 → POST /api/kits/{id}/disassemble 還材料、扣整組庫存

export async function disassembleKit(kitId) {
  const qty = prompt('要拆解幾組？', 1);
  if (qty === null) return;
  // 2026-09-12：組數必須整數；Qty.parse 拒絕 "1.5"→1、"1/2"→1 的截斷
  const _pd = Qty.parse(qty);
  const n = _pd && !_pd.error ? _pd.value : parseInt(qty);
  if (!n || n <= 0 || (_pd && !_pd.error && _pd.den !== 1)) { toast('拆解組數必須為正整數', 'error'); return; }
  try {
    await apiFetch(`/api/kits/${kitId}/disassemble`, { method: 'POST', json: { qty: n }, fallback: '拆解失敗' });
    toast(`✅ 已拆解 ${n} 組（材料已加回）`, 'success');
    await loadData();
  } catch (e) {
    toast('⚠️ ' + e.message, 'error');
  }
}



// 編輯整組（2026-08-11 Sarah 需求：整組也要能編輯/刪除，與單一庫存一致）

/**
 * Load a Kit into the editor while retaining locations as display metadata only.
 * @param {number} kitId Kit definition identifier.
 * @returns {Promise<void>} Resolves after Kit details and modal state are loaded.
 */
export async function editKit(kitId) {

  let kit = null;

  try {

    kit = (await apiFetch('/api/kits?site=all')).find(k => k.id === kitId);

  } catch (e) { /* fallthrough */ }

  if (!kit) { toast('找不到整組資料', 'error'); return; }

  kitsState.editingKitId = kitId;

  kitsState.kitUpdatedAt = kit.updated_at || null;  // 2026-08-14 樂觀鎖快照

  kitsState.kitModalCompRows = kit.components.map(c => ({ item_id: c.item_id, qty: c.need_qty }));

  document.getElementById('k-name').value = kit.name;

  document.getElementById('k-note').value = kit.note || '';
  document.getElementById('k-brand').value = kit.brand || '';
  document.getElementById('k-code').value = kit.code || '';
  document.getElementById('k-site').value = kit.site || 'office';
  // 填入位置清單
  kitsState.kitLocationRows = (kit.locations || []).map(loc => ({
    cabinet: loc.cabinet || '',
    position: loc.position || '',
    note: loc.note || ''
  }));

  document.querySelector('#kit-modal h3').textContent = '🔧 編輯整組';

  const btn = document.getElementById('kit-submit');

  btn.textContent = '💾 儲存整組';

  btn.setAttribute('onclick', 'Kits.submitKitEdit()');

  renderKitCompRows();
  renderKitLocationRows();  // 渲染位置清單
  loadKitCabinetOptions();  // F5 後直接編輯時櫃子清單可能尚未載入；載入後重繪並保留已存/已輸入的值
  renderKitPhotoBox(kit.id, kit.item_id, !!kit.has_photo);  // Kit ID 用於路由，item ID 用於照片媒體查詢

  openModal('kit-modal');

}



// 刪除整組（含定義、材料關聯、整組品項與紀錄）

export async function deleteKit(kitId) {
  if (!confirm('確定刪除這個整組？它的定義、整組庫存與紀錄都會一起刪除，無法恢復。')) return;
  try {
    await apiFetch(`/api/kits/${kitId}`, { method: 'DELETE', fallback: '刪除失敗' });
    toast('✅ 已刪除整組', 'success');
    await loadData();
  } catch (e) {
    toast('⚠️ ' + e.message, 'error');
  }
}





// ========== 手機版 ⋯ 動作選單（整組卡） ==========

export function openKitSheet(kitId) {

  const isViewer = !hasPerm('kit-mgmt');

  const actions = [];

  if (!isViewer) {

    actions.push({ icon: '🛠️', label: '組裝', cls: 'out', fn: () => assembleKit(kitId) });

    actions.push({ icon: '✂️', label: '拆解', cls: 'back', fn: () => disassembleKit(kitId) });

    actions.push({ icon: '✏️', label: '編輯', fn: () => editKit(kitId) });

    actions.push({ icon: '🗑', label: '刪除', cls: 'del', fn: () => deleteKit(kitId) });

  }

  openSheet('整組操作', actions);

}


function renderKitStatusItem(kit, type) {
  const stock = Number(kit.stock_qty || 0);
  const source = Array.isArray(appState.ALL_ITEMS) ? appState.ALL_ITEMS.find(function(item) { return Number(item.id) === Number(kit.item_id); }) || {} : {};
  const location = kit.location || source.location || (source.stocks && source.stocks[0] && source.stocks[0].location) || '未標示';
  const isShortage = type === 'shortage';
  const statusLabel = isShortage ? '缺料' : '庫存不足';
  const statusClass = isShortage ? 'status-out' : 'status-low';
  const missingLabel = isShortage ? '缺料' : '不足';
  const missing = (kit.components || []).filter(function(c) { return Number(c.need_qty || 0) > 0 && Number(c.stock || 0) < Number(c.need_qty || 0); });
  const missingHTML = missing.length
    ? `<div class="kit-status-missing">${esc(missingLabel)} ${missing.length} 項：${missing.map(function(c) { return `<span>${esc(c.name || '未命名材料')}</span>`; }).join('')}</div>`
    : '';
  const editAction = hasPerm('kit-mgmt') && Number.isInteger(Number(kit.id))
    ? `<button type="button" class="btn btn--secondary btn--sm inventory-status-edit" onclick="Inventory.closeInventoryStatusModal();Kits.editKit(${esc(String(Number(kit.id)))})">編輯</button>`
    : '';
  return `<article class="inventory-status-item status-list-mobile-row kit-status-item ${esc(statusClass)}">
    <div class="inventory-status-thumb">${buildThumb(kit.item_id, !!kit.has_photo, kit.name, '🔧', kit.thumbnail_url)}</div>
    <div class="inventory-status-info">
      <div class="inventory-status-name">${esc(kit.name || '未命名整組')}</div>
      <div class="inventory-status-sub">${esc(source.brand || kit.brand || '整組')}${esc(kit.code ? ' · 型號 ' + kit.code : '')}</div>
      ${missingHTML}
    </div>
    <div class="inventory-status-location status-list-location-cell">📍 ${esc(location)}</div>
    <div class="inventory-status-values">
      <span class="inventory-status-badge ${esc(statusClass)}">${esc(statusLabel)}</span>
      <strong>${esc(statusListFormatQuantity(stock, '組'))} <small>組</small></strong>
    </div>
    ${editAction}
  </article>`;
}
export function showKitStatusList(type) {
  const validType = type === 'shortage' ? 'shortage' : 'insufficient';
  const items = appState.currentKitItems.filter(function(k) { return getKitStatus(k).status === validType; });
  const isShortage = validType === 'shortage';
  openSharedStatusListModal({
    title: isShortage ? '⛔ 缺料的整組' : '⚠ 庫存不足的整組',
    intro: isShortage ? '以下整組因必要材料不足，目前無法正常組成。' : '目前仍有庫存，但庫存數量低於需求條件。',
    headerClass: isShortage ? 'is-out' : 'is-low',
    columnLabels: ['照片', '整組 / 缺料材料', '位置', '庫存 / 狀態', '操作'],
    items: items,
    emptyText: isShortage ? '✅ 目前沒有缺料的整組' : '✅ 目前沒有庫存不足的整組',
    emptyIntro: '目前整組庫存均符合條件。',
    searchPlaceholder: '搜尋整組名稱、材料或型號…',
    getSearchText: function(kit) {
      return [kit.name, kit.brand, kit.code, kit.note, (kit.components || []).map(function(c) {
        return [c.brand, c.name, c.code].join(' ');
      }).join(' ')].join(' ');
    },
    renderItem: function(kit) { return renderKitStatusItem(kit, validType); },
  });
}

// 模組載入時要執行的副作用：由頁面 entry 依原本的載入順序呼叫（issue #39）
export function initKitsPage() {
  document.addEventListener('click', (e) => {

    const inSearch = e.target.closest('[data-role="mat-search"]');

    document.querySelectorAll('[data-role="kit-dropdown"].is-open').forEach(d => {

      if (!inSearch || !inSearch.contains(d)) d.classList.remove('is-open');

    });

  });
}
