// 庫存管理系統 - 行事曆關鍵字搜尋（桌機右側面板 / 手機清單）

import { apiFetch } from '../../core/api-client.js';
import { CAL_WEEK } from '../../core/state.js';
import { esc, toast } from '../../core/utils.js';
import { _parseLocalDate, calServiceTone } from './format.js';
import { calendarState } from './state.js';

var calSearchViewportBound = false;

// ========== 設定（admin）==========

// ========== 行事曆搜尋 ==========
export function calIsDesktopViewport() {
  return typeof window.matchMedia !== 'function'
    || window.matchMedia('(min-width: 768px)').matches;
}

export function calMountSearchResults() {
  const results = document.getElementById('cal-search-results');
  if (!results) return calIsDesktopViewport();
  const desktop = calIsDesktopViewport();
  const target = document.getElementById(desktop ? 'cal-search-panel-slot' : 'cal-search-top-slot');
  if (target && results.parentElement !== target) target.appendChild(results);
  return desktop;
}

export function calBindSearchViewportListener() {
  if (calSearchViewportBound || typeof window.matchMedia !== 'function') return;
  const media = window.matchMedia('(min-width: 768px)');
  if (typeof media.addEventListener === 'function') {
    media.addEventListener('change', calHandleSearchViewportChange);
  } else if (typeof media.addListener === 'function') {
    media.addListener(calHandleSearchViewportChange);
  }
  calSearchViewportBound = true;
}

function calHandleSearchViewportChange() {
  calMountSearchResults();
  if (!calendarState.calSearchMode) return;
  if (calendarState.calSearchState === 'loading') {
    calRenderSearchLoading();
  } else if (calendarState.calSearchState === 'error') {
    calRenderSearchError();
  } else if (calendarState.calSearchState === 'ready') {
    if (calIsDesktopViewport()) calRenderSearchResults(calendarState.calSearchItems);
    else calRenderMobileSearchResults(calendarState.calSearchItems);
  } else {
    calApplyRightPanelMode();
  }
}

export function calApplyRightPanelMode() {
  const desktop = calMountSearchResults();
  const panel = document.getElementById('cal-day-panel');
  const results = document.getElementById('cal-search-results');
  const list = document.getElementById('cal-day-list');
  const helper = document.getElementById('cal-helper-panel');
  if (!panel || !results) return;
  if (!desktop) {
    panel.classList.remove('cal-search-mode');
    results.style.display = calendarState.calSearchMode ? 'block' : 'none';
    if (list) list.style.display = '';
    return;
  }
  panel.classList.toggle('cal-search-mode', calendarState.calSearchMode);
  results.style.display = calendarState.calSearchMode ? 'flex' : 'none';
  if (list) list.style.display = calendarState.calSearchMode ? 'none' : '';
  if (helper && calendarState.calSearchMode) helper.style.display = 'none';
}

function calSearchDateLabel(dateStr) {
  const date = _parseLocalDate(dateStr);
  if (!date || isNaN(date.getTime())) return String(dateStr || '');
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${CAL_WEEK[date.getDay()]}`;
}

function calSearchRangeLabel(meta) {
  if (meta.from && meta.to) return `${esc(meta.from)} ～ ${esc(meta.to)}`;
  if (meta.from) return `自 ${esc(meta.from)}`;
  if (meta.to) return `至 ${esc(meta.to)}`;
  return '全部日期';
}

function calRenderSearchLoading() {
  calendarState.calSearchMode = true;
  calendarState.calSearchState = 'loading';
  calApplyRightPanelMode();
  const el = document.getElementById('cal-search-results');
  if (!el) return;
  el.innerHTML = '<div class="cal-search-panel-header"><div class="cal-search-header-row"><strong>🔍 搜尋結果</strong><span class="cal-search-count">搜尋中...</span></div><div class="cal-search-meta">正在載入符合條件的派工</div></div><div class="cal-search-list"><div class="cal-search-skeleton" aria-hidden="true"><span></span><span></span><span></span></div></div>';
}

function calRenderSearchError() {
  calendarState.calSearchMode = true;
  calendarState.calSearchState = 'error';
  calApplyRightPanelMode();
  const el = document.getElementById('cal-search-results');
  if (!el) return;
  el.innerHTML = '<div class="cal-search-panel-header"><div class="cal-search-header-row"><strong>🔍 搜尋結果</strong><button class="btn btn--secondary btn--sm cal-search-exit" type="button" onclick="Calendar.calClearSearch()">× 結束搜尋</button></div><div class="cal-search-meta">搜尋派工失敗</div></div><div class="cal-search-empty"><div class="cal-empty-icon" aria-hidden="true">⚠️</div><strong>搜尋派工失敗</strong><p>請重新搜尋或調整條件。</p><button class="btn btn--secondary btn--sm btn-sm" type="button" onclick="Calendar.calSearch()">重新搜尋</button></div>';
}

export function calRenderSearchResults(items) {
  const el = document.getElementById('cal-search-results');
  if (!el) return;
  calendarState.calSearchMode = true;
  calendarState.calSearchState = 'ready';
  calApplyRightPanelMode();
  const meta = calendarState.calSearchMeta || { from: '', to: '', q: '' };
  const keyword = meta.q ? `「${esc(meta.q)}」` : '全部條件';
  const range = calSearchRangeLabel(meta);
  const list = Array.isArray(items) ? items : [];
  const itemHtml = list.map(e => {
    const service = e.service_name
      ? `<span class="cal-service-badge cal-service-${esc(calServiceTone(e.service_name))}">${esc(e.service_name)}</span>` : '';
    const assignees = (e.assignees || []).map(a => esc(a.name || '')).filter(Boolean).join('、');
    const assigneeHtml = assignees ? `<span>👤 ${assignees}</span>` : '';
    const addressHtml = e.address ? `<span>📍 ${esc(e.address)}</span>` : '';
    const noteHtml = e.note ? `<span>📝 ${esc(e.note)}</span>` : '';
    return `<article class="cal-search-item" data-date="${esc(e.date || '')}" role="button" tabindex="0" onclick="Calendar.calJumpToDate(this.dataset.date)" onkeydown="if(event.key === 'Enter' || event.key === ' ') this.click()"><div class="cal-search-item-date"><span>${esc(calSearchDateLabel(e.date))}</span><strong>${esc(e.start_time || '未指定時間')}</strong></div><div class="cal-search-item-body"><div class="cal-search-item-title">${esc(e.client_name || '未命名派工')}</div><div class="cal-search-item-tags">${service}${assigneeHtml}</div><div class="cal-search-item-extra">${addressHtml}${noteHtml}</div></div></article>`;
  }).join('');
  const body = itemHtml || '<div class="cal-search-empty"><div class="cal-empty-icon" aria-hidden="true">🔍</div><strong>沒有符合條件的派工</strong><p>請調整日期或關鍵字後重新搜尋。</p><button class="btn btn--secondary btn--sm btn-sm" type="button" onclick="Calendar.calClearSearch()">清除搜尋</button></div>';
  el.innerHTML = `<div class="cal-search-panel-header"><div class="cal-search-header-row"><strong>🔍 搜尋結果</strong><span class="cal-search-count">共 ${list.length} 筆</span><button class="btn btn--secondary btn--sm cal-search-exit" type="button" onclick="Calendar.calClearSearch()">× 結束搜尋</button></div><div class="cal-search-meta">${keyword} · ${range}</div></div><div class="cal-search-list">${body}</div>`;
}

// Mobile keeps the previous page-level result presentation; Desktop uses the right-panel mode above.
export function calRenderMobileSearchResults(items) {
  const el = document.getElementById('cal-search-results');
  if (!el) return;
  calendarState.calSearchMode = true;
  calendarState.calSearchState = 'ready';
  calApplyRightPanelMode();
  el.style.display = 'block';
  if (!items.length) {
    el.innerHTML = '<div class="cal-msearch-empty">找不到符合條件的行程</div>';
    return;
  }
  let html = '<div class="cal-msearch-summary">找到 ' + items.length + ' 筆結果</div>';
  items.forEach(function(e) {
    const names = (e.assignees || []).map(function(a) { return esc(a.name); }).join('、');
    html += '<div class="cal-search-item cal-msearch-item" data-date="' + esc(e.date) + '" onclick="Calendar.calJumpToDate(this.dataset.date)">' +
      '<div class="cal-msearch-title">' + esc(e.client_name) + '</div>' +
      '<div class="cal-msearch-time">' +
      (esc(e.date) || '') + (e.start_time ? ' ' + esc(e.start_time) + (e.end_time ? '~' + esc(e.end_time) : '') : '') +
      (e.service_name ? ' [' + esc(e.service_name) + ']' : '') +
      '</div>' +
      (names ? '<div class="cal-msearch-meta">👤 ' + names + '</div>' : '') +
      (e.address ? '<div class="cal-msearch-meta">📍 ' + esc(e.address) + '</div>' : '') +
      (e.note ? '<div class="cal-msearch-meta">📝 ' + esc(e.note) + '</div>' : '') +
      '</div>';
  });
  el.innerHTML = html;
}

export async function calSearch() {
  const from = document.getElementById('cal-search-from').value;
  const to = document.getElementById('cal-search-to').value;
  const q = document.getElementById('cal-search-q').value.trim();
  const requestToken = calendarState.calSearchGuard.next();
  if (!from && !to && !q) { toast('請輸入搜尋條件', 'error'); return; }
  const desktop = calIsDesktopViewport();
  calendarState.calSearchMeta = { from, to, q };
  if (desktop) calRenderSearchLoading();
  const params = new URLSearchParams();
  if (from) params.set('date_from', from);
  if (to) params.set('date_to', to);
  if (q) params.set('q', q);
  try {
    const items = await apiFetch('/api/appointments/search?' + params);
    if (!calendarState.calSearchGuard.isCurrent(requestToken)) return;
    calendarState.calSearchItems = Array.isArray(items) ? items : [];
    if (calIsDesktopViewport()) calRenderSearchResults(calendarState.calSearchItems);
    else calRenderMobileSearchResults(calendarState.calSearchItems);
  } catch (err) {
    if (!calendarState.calSearchGuard.isCurrent(requestToken)) return;
    console.error('[calSearch]', err);
    if (calIsDesktopViewport()) calRenderSearchError();
    else toast('搜尋失敗', 'error');
  }
}
