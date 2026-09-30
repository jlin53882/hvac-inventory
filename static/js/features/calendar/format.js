// 庫存管理系統 - 行事曆日期格式與日期控制項同步

import { CAL_WEEK } from './state.js';
import { calendarState } from './state.js';

export function _iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function _fmtTW(d) {
  return `${d.getMonth() + 1}月${d.getDate()}日 週${CAL_WEEK[d.getDay()]}`;
}

export function _parseLocalDate(value) {
  if (value instanceof Date) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  const parts = String(value || '').split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

export function _syncCalendarDateControls() {
  const selected = _iso(calendarState.calSelected);
  const searchFrom = document.getElementById('cal-search-from');
  const picker = document.getElementById('cal-picker');
  if (searchFrom) searchFrom.value = selected;
  if (picker) picker.value = selected;
}

function calFormatKpiDate(date) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} · 週${CAL_WEEK[date.getDay()]}`;
}

// ========== 當日明細 ==========
export function calFmtCreatedAt(s) {
  // created_at 為 UTC（sqlite CURRENT_TIMESTAMP）→ 轉本地顯示
  if (!s) return '';
  const d = new Date(s.replace(' ', 'T') + 'Z');
  if (isNaN(d)) return String(s).slice(0, 16);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const CAL_SERVICE_TONES = {
  '施工': 'blue',
  '維修': 'green',
  '場勘': 'amber',
  '保養': 'purple',
};

export function calServiceTone(name) {
  return CAL_SERVICE_TONES[name] || 'slate';
}
