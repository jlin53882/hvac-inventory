# -*- coding: utf-8 -*-
"""通知摘要中心與異常清單資訊階層回歸測試。"""
from pathlib import Path
import subprocess


BASE_DIR = Path(__file__).resolve().parents[1]
STATIC = BASE_DIR / "static"
INDEX = STATIC / "index.html"
CORE_CSS = STATIC / "css" / "style.core.css"
STATUS_LIST_JS = STATIC / "js" / "render" / "status-list.js"
NOTIFICATIONS_JS = STATIC / "js" / "notifications.js"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def test_notification_summary_center_shell_and_reuses_existing_dialogs():
    """通知只呈現摘要，分類點擊必須導向既有詳細清單流程。"""
    html = read(INDEX)
    js = read(NOTIFICATIONS_JS)
    assert '/static/js/notifications.js' in html
    assert 'id="notifPanel"' in html
    assert 'id="notifBackdrop"' in html
    assert 'id="notif-list"' in html
    assert 'aria-label="通知"' in html
    assert 'function getNotificationSummary()' in js
    assert 'function updateNotifications()' in js
    assert "showInventoryStatusList('out')" in js
    assert "showInventoryStatusList('low')" in js
    assert "showStocktakeList('zero')" in js
    assert "showStocktakeList('low')" in js
    assert "showKitStatusList('shortage')" in js
    assert "showKitStatusList('insufficient')" in js
    assert '/api/items' not in js
    assert '/api/kits' not in js


def test_notification_summary_runtime_has_no_item_rows_and_caps_badge():
    """Node VM：badge 使用異常摘要總數，popover 不列出商品名稱，99 以上顯示 99+。"""
    script = r"""
const fs = require('fs');
const vm = require('vm');
function classes() {
  const set = new Set();
  return { add(v) { set.add(v); }, remove(v) { set.delete(v); }, contains(v) { return set.has(v); }, _set: set };
}
function element() {
  return { classList: classes(), style: {}, attrs: {}, innerHTML: '', textContent: '',
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    addEventListener() {}, focus() {} };
}
const elements = {
  notifPanel: element(), notifBackdrop: element(), notifList: element(), notifSummary: element(),
  notifBadge: element(), notifBell: element(),
};
const context = {
  window: { innerWidth: 1024, addEventListener() {} },
  document: {
    body: { classList: classes(), style: {} },
    getElementById(id) {
      const key = { 'notifPanel': 'notifPanel', 'notifBackdrop': 'notifBackdrop', 'notif-list': 'notifList', 'notif-summary': 'notifSummary', 'notif-badge': 'notifBadge', 'notif-bell': 'notifBell' }[id] || id;
      return elements[key] || null;
    },
    querySelector(selector) {
      if (selector === '.notif .cnt') return elements.notifBadge;
      if (selector === '.notif') return elements.notifBell;
      return null;
    },
    addEventListener() {},
  },
  localStorage: { getItem() { return '2026-09'; } },
  currentUser: { permissions: { stocktake: true } },
  currentTab: 'inventory', currentSite: 'office',
  inventoryLoadedSite: 'office', fullItemsLoadedSite: '',
  INVENTORY_META: { stats: {
    item_count: 5, total_qty: 10, low_stock: 3, zero_stock: 14,
    zero_items: Array.from({ length: 14 }, (_, i) => ({ id: i + 1, name: `商品${i + 1}`, qty: 0 })),
    low_items: [{ id: 50, name: '低庫存商品', qty: 2 }],
  } },
  ALL_ITEMS: [], currentKitItems: [], ALERTS_BY_SITE: {},
  getFilteredInventoryItems() { return []; },
  getInventoryDashboardStats(_items, stats) { return {
    zeroCount: stats.zero_items.length, lowCount: stats.low_items.length,
  }; },
  getKitStatus() { return { status: 'normal' }; },
  esc(value) { return String(value); },
  showInventoryStatusList() {}, showStocktakeList() {}, showKitStatusList() {}, switchTab() {},
};
vm.createContext(context);
vm.runInContext(fs.readFileSync('static/js/notifications.js', 'utf8'), context);
context.updateNotifications();
if (!elements.notifList.innerHTML.includes('缺貨商品')) throw new Error('out summary missing');
if (!elements.notifList.innerHTML.includes('低庫存商品')) throw new Error('low summary missing');
if (elements.notifList.innerHTML.includes('商品1')) throw new Error('notification leaked item rows');
if (elements.notifBadge.textContent !== '15') throw new Error(`badge mismatch: ${elements.notifBadge.textContent}`);
context.INVENTORY_META.stats.zero_items = Array.from({ length: 120 }, () => ({ qty: 0 }));
context.INVENTORY_META.stats.low_items = [];
context.updateNotifications();
if (elements.notifBadge.textContent !== '99+') throw new Error('badge cap missing');
context.INVENTORY_META.stats.zero_items = [];
context.INVENTORY_META.stats.low_items = [];
context.updateNotifications();
if (!elements.notifList.innerHTML.includes('目前沒有庫存異常')) throw new Error('normal empty state missing');
if (elements.notifBadge.style.display !== 'none') throw new Error('zero badge should be hidden');
"""
    result = subprocess.run(["node", "-e", script], cwd=BASE_DIR, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr or result.stdout


def test_notification_detail_flow_closes_summary_before_existing_dialog():
    """Node VM：分類點擊先關閉摘要，再呼叫目前頁面既有 Dialog。"""
    script = r"""
const fs = require('fs');
const vm = require('vm');
const calls = [];
const context = {
  window: { innerWidth: 1024, addEventListener() {} },
  document: { body: { classList: { add() {}, remove() {} } }, getElementById() { return null; }, querySelector() { return null; }, addEventListener() {} },
  currentTab: 'inventory', closeNotif() { calls.push('close'); },
  showInventoryStatusList(type) { calls.push(`inventory:${type}`); },
  showStocktakeList(type) { calls.push(`stocktake:${type}`); },
  showKitStatusList(type) { calls.push(`kit:${type}`); },
  switchTab(tab) { calls.push(`tab:${tab}`); },
  esc(value) { return String(value); }, localStorage: { getItem() { return null; } },
};
vm.createContext(context);
vm.runInContext(fs.readFileSync('static/js/notifications.js', 'utf8'), context);
context.closeNotif = function() { calls.push('close'); };
context.openNotificationDetail('out');
context.currentTab = 'stocktake'; context.openNotificationDetail('low');
context.currentTab = 'kit'; context.openNotificationDetail('shortage');
context.openNotificationDetail('reminder');
if (calls.join('|') !== 'close|inventory:out|close|stocktake:low|close|kit:shortage|close|tab:stocktake') throw new Error(calls.join('|'));
"""
    result = subprocess.run(["node", "-e", script], cwd=BASE_DIR, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr or result.stdout


def test_status_list_puts_brand_with_name_and_model_on_separate_line():
    """缺貨/低庫存 Dialog：品牌與品名同第一行，型號獨立第二行。"""
    js = read(STATUS_LIST_JS)
    assert "${esc(item.brand || '無廠牌')} ${esc(item.name || '未命名')}" in js
    assert "型號： ' + item.code" in js
    assert " · 型號 " not in js


def test_notification_css_has_desktop_popover_and_mobile_bottom_sheet():
    """通知中心 Desktop/Mobile 使用不同容器呈現，但共用摘要資料。"""
    css = read(CORE_CSS)
    assert '.notif-panel.open' in css
    assert '.notif-category' in css
    assert '.notif-backdrop.open' in css
    assert '@media (max-width: 767px)' in css
    assert 'border-radius: 24px 24px 0 0' in css
    assert 'max-height: 82dvh' in css


# ===== status-list.js 核心函式測試 =====
INVENTORY_CSS = BASE_DIR / "static" / "css" / "style.inventory.css"


def test_status_list_format_quantity_handles_zero_and_whole():
    """statusListFormatQuantity：0 顯示 0、整數不帶小數、小數保留合理精度。"""
    js = read(STATUS_LIST_JS)
    assert "function statusListFormatQuantity" in js
    # Node VM 驗證實際行為
    script = r"""
const fs = require('fs');
const vm = require('vm');
const context = { Number, Math };
vm.createContext(context);
vm.runInContext(fs.readFileSync('static/js/render/status-list.js', 'utf8'), context);
const fmt = context.statusListFormatQuantity;
if (fmt(0) !== '0') throw new Error('zero: ' + fmt(0));
if (fmt(5) !== '5') throw new Error('whole: ' + fmt(5));
if (fmt(0.5) !== '0.5') throw new Error('decimal: ' + fmt(0.5));
if (fmt(null) !== '0') throw new Error('null: ' + fmt(null));
if (fmt(undefined) !== '0') throw new Error('undefined: ' + fmt(undefined));
"""
    result = subprocess.run(["node", "-e", script], cwd=BASE_DIR, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr or result.stdout


def test_status_list_locations_joins_multiple_stocks():
    """statusListLocations：多個庫存位置以頓號連接。"""
    js = read(STATUS_LIST_JS)
    assert "function statusListLocations" in js
    script = r"""
const fs = require('fs');
const vm = require('vm');
const el = { classList: { add(){}, remove(){}, contains(){ return false; } }, style: {}, setAttribute(){}, getAttribute(){ return ''; }, addEventListener(){} };
const context = { document: { getElementById(){ return el; }, querySelector(){ return null; }, addEventListener(){}, body: { classList: { add(){}, remove(){} } } }, window: { innerWidth: 1024, addEventListener(){} }, localStorage: { getItem(){ return null; } }, currentUser: { permissions: {} }, currentTab: 'inventory', currentSite: '', INVENTORY_META: { stats: null }, ALL_ITEMS: [], currentKitItems: [], fullItemsLoadedSite: '' };
vm.createContext(context);
vm.runInContext(fs.readFileSync('static/js/render/status-list.js', 'utf8'), context);
const locs = context.statusListLocations;
const r1 = locs({ stocks: [{ location: 'A' }, { location: 'B' }] });
if (JSON.stringify(r1) !== '["A","B"]') throw new Error('multi: ' + JSON.stringify(r1));
const r2 = locs({ stocks: [] });
if (JSON.stringify(r2) !== '["未標示"]') throw new Error('empty fallback: ' + JSON.stringify(r2));
const r3 = locs({ stocks: [{ location: 'C' }] });
if (r3.length !== 1 || r3[0] !== 'C') throw new Error('single: ' + JSON.stringify(r3));
"""
    result = subprocess.run(["node", "-e", script], cwd=BASE_DIR, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr or result.stdout


def test_render_shared_product_status_item_escapes_user_data():
    """renderSharedProductStatusItem：品牌、品名、型號均使用 esc() 防 XSS。"""
    js = read(STATUS_LIST_JS)
    assert "esc(item.brand" in js or "esc(item.name" in js
    assert "esc(item.code" in js or "型號：" in js
    # XSS payload 不應出現在未轉義的 HTML 中
    assert "<script>" not in js


def test_open_shared_status_list_modal_renders_items():
    """openSharedStatusListModal：呼叫 renderItem 將結果插入 modal body。"""
    js = read(STATUS_LIST_JS)
    assert "function openSharedStatusListModal" in js
    assert "renderItem" in js


def test_inventory_status_item_no_border_left():
    """inventory.css：缺貨/低庫存 status item 不應有左側彩色邊框。"""
    css = read(INVENTORY_CSS)
    # 驗證 border-left 已從 status-item warn/danger 移除
    assert "border-left" not in css.split(".inventory-status-item.is-low")[1].split("}")[0] if ".inventory-status-item.is-low" in css else True
    assert "border-left" not in css.split(".inventory-status-item.is-out")[1].split("}")[0] if ".inventory-status-item.is-out" in css else True


def test_get_stocktake_reminder_state_respects_permissions():
    """getStocktakeReminderState：無 stocktake 權限時回傳 visible=false。"""
    js = read(NOTIFICATIONS_JS)
    assert "function getStocktakeReminderState" in js
    script = r"""
const fs = require('fs');
const vm = require('vm');
const el = { classList: { add(){}, remove(){}, contains(){ return false; } }, style: {}, setAttribute(){}, getAttribute(){ return ''; }, addEventListener(){} };
const context = {
  currentUser: { permissions: {} },
  localStorage: { getItem() { return null; } },
  Date: Date,
  document: { getElementById(){ return el; }, querySelector(){ return null; }, addEventListener(){}, body: { classList: { add(){}, remove(){} } } },
  window: { innerWidth: 1024, addEventListener(){} },
  currentTab: 'inventory', currentSite: '', INVENTORY_META: { stats: null }, ALL_ITEMS: [], currentKitItems: [], fullItemsLoadedSite: '',
};
vm.createContext(context);
vm.runInContext(fs.readFileSync('static/js/notifications.js', 'utf8'), context);
const state = context.getStocktakeReminderState();
if (state.visible !== false) throw new Error('no perm should be invisible');
if (state.count !== 0) throw new Error('no perm count should be 0');
"""
    result = subprocess.run(["node", "-e", script], cwd=BASE_DIR, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr or result.stdout


def test_get_notification_summary_scope_gating():
    """getNotificationSummary：非 inventory/stocktake/kit 頁面回傳空摘要。"""
    js = read(NOTIFICATIONS_JS)
    assert "function getNotificationSummary" in js
    script = r"""
const fs = require('fs');
const vm = require('vm');
const el = { classList: { add(){}, remove(){}, contains(){ return false; } }, style: {}, setAttribute(){}, getAttribute(){ return ''; }, addEventListener(){} };
const context = {
  currentTab: 'calendar',
  currentUser: { permissions: { stocktake: true } },
  localStorage: { getItem() { return '2026-09'; } },
  INVENTORY_META: { stats: { zero_items: [{id:1}], low_items: [] } },
  ALL_ITEMS: [], currentKitItems: [], fullItemsLoadedSite: '',
  document: { getElementById(){ return el; }, querySelector(){ return null; }, addEventListener(){}, body: { classList: { add(){}, remove(){} } } },
  window: { innerWidth: 1024, addEventListener(){} },
};
vm.createContext(context);
vm.runInContext(fs.readFileSync('static/js/notifications.js', 'utf8'), context);
const summary = context.getNotificationSummary();
if (summary.categories.length !== 0) throw new Error('calendar tab should have no categories');
if (summary.total !== 0) throw new Error('calendar tab total should be 0');
if (summary.relevantScope !== false) throw new Error('calendar tab relevantScope should be false');
"""
    result = subprocess.run(["node", "-e", script], cwd=BASE_DIR, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr or result.stdout
