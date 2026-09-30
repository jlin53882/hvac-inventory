// 庫存管理系統 - 登入守衛（v11 → Shell v2 2026-09-06）
// =====================================
// 1) 攔截 window.fetch：任何 API 回 401 → 跳轉登入頁
// 2) 載入時檢查 /api/auth/me：未登入 → 進登入頁；已登入 → 頭像下拉選單顯示
// 3) 提供登出 / 使用者管理入口

import { pending } from './state.js';

// ---------- 登入狀態 ----------
export var currentUser = null;

export async function checkAuth() {
  try {
    var res = await fetch('/api/auth/me');
    if (!res.ok) {
      window.location.href = '/login.html';
      return null;
    }
    var data = await res.json();
    currentUser = data.user;
    return currentUser;
  } catch (e) {
    return null;
  }
}

// 登出
export async function logout() {
  try { await fetch('/api/auth/logout', { method: 'POST' }); } catch (e) {}
  try {
    Object.keys(localStorage).filter(function(k){ return k.indexOf('hvac_collapsed_locs_') === 0; })
      .forEach(function(k){ localStorage.removeItem(k); });
  } catch (e) {}
  window.location.href = '/login.html';
}

// ---------- 頁面可用性（Visibility ∩ RBAC） ----------
var PAGE_VISIBILITY_TABS = ['calendar', 'work-progress', 'signed-reports', 'quotation', 'petty-cash', 'inventory', 'prepared', 'stockout', 'stocktake', 'kit'];

function isPageVisible(pageKey) {
  if (!currentUser || !Array.isArray(currentUser.visible_pages)) return true;
  return currentUser.visible_pages.indexOf(pageKey) >= 0;
}

function hasPageCapability(pageKey, mode) {
  var perms = currentUser && currentUser.permissions ? currentUser.permissions : {};
  var any = function(keys) { return keys.some(function(key) { return !!perms[key]; }); };
  if (pageKey === 'petty-cash') return !!perms['petty-cash-view'];
  if (pageKey === 'prepared' || pageKey === 'stockout') return !!perms.prepared;
  if (pageKey === 'stocktake') return mode === 'operate' ? !!perms.stocktake : !!(perms.view || perms.stocktake);
  if (pageKey === 'kit') return !!perms['kit-view'];
  if (pageKey === 'calendar') return !!(perms.view || perms['cal-mgmt']);
  if (pageKey === 'work-progress') return !!perms['work-progress-view'];
  if (pageKey === 'perms') return !!perms['user-mgmt'];
  if (pageKey === 'settings') return any(['unit-mgmt', 'gcal-sync-manage', 'gcal-keys-manage', 'petty-cash-config', 'change-own-password']);
  if (pageKey === 'change-password') return !!perms['change-own-password'];
  return !!perms.view;
}

export function canAccessPage(pageKey, mode) {
  return isPageVisible(pageKey) && hasPageCapability(pageKey, mode);
}

export function firstAccessiblePageTab() {
  for (var i = 0; i < PAGE_VISIBILITY_TABS.length; i += 1) {
    if (canAccessPage(PAGE_VISIBILITY_TABS[i])) return PAGE_VISIBILITY_TABS[i];
  }
  return null;
}

export function resolveAccessiblePageTab(requestedTab) {
  return canAccessPage(requestedTab) ? requestedTab : firstAccessiblePageTab();
}

// 模組載入時要執行的副作用：由頁面 entry 依原本的載入順序呼叫（issue #39）
export function initSession() {
  // ---------- 攔截 fetch：401 一律跳登入 ----------
  (function () {
    var _origFetch = window.fetch;
    window.fetch = async function (url, opts) {
      var res = await _origFetch(url, opts);
      if (res.status === 401 && !window.__authRedirecting) {
        var hasUnsaved = Object.keys(pending).length > 0;
        if (hasUnsaved) alert('⚠️ 登入已過期，部分調整可能未儲存。請重新登入。');
        window.__authRedirecting = true;
        window.location.href = '/login.html';
      }
      return res;
    };
  })();
}
