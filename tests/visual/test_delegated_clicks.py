# -*- coding: utf-8 -*-
"""事件委派（data-action）的真實點擊契約。

inline handler 全部改成 data-action + document 層委派後，「有沒有接線」只有真的點擊才驗得到：
這裡在 Chromium 對標記上的 data-action 元素送出真正的 click / change / input / keydown 事件（DOM 事件會冒泡到 document 的 delegate），
檢查使用者看得到的結果。函式層的分派與參數由 tests/*.test.js（action_tables_runtime 等）覆蓋，這裡專門抓「page entry 忘了 init…Actions()」
「標記的 data-action 名稱和 handler 表對不上」這類只有整頁跑起來才會出現的問題。
"""
import harness


def _click(page, selector: str) -> None:
    """對元素送出真正的 click 事件（不受版面遮擋 / 手機側欄收合影響）。"""
    assert page.evaluate("s => { const el = document.querySelector(s); if (!el) return false; el.click(); return true; }", selector), f"找不到 {selector}"


def _visible(page, selector: str) -> bool:
    return page.evaluate(
        """sel => { const el = document.querySelector(sel); if (!el) return false;
        const cs = getComputedStyle(el);
        return el.getClientRects().length > 0 && cs.visibility !== 'hidden' && cs.opacity !== '0'; }""",
        selector,
    )


def _state(page, field: str):
    return page.evaluate(f"hvac('core/state.js').appState.{field}")


def test_sidebar_tab_and_site_buttons(page, live_server):
    """側欄頁籤與庫存區按鈕（app-tab / app-site）：點下去會切頁、切庫存區。"""
    harness.open_tab(page, live_server, "inventory")
    _click(page, '#sb-nav-stockout[data-action="app-tab"]')
    page.wait_for_load_state("networkidle")
    assert _state(page, "currentTab") == "stockout"
    page.wait_for_selector(".stockout-page-header")
    _click(page, '#site-warehouse[data-action="app-site"]')
    page.wait_for_load_state("networkidle")
    assert _state(page, "currentSite") == "warehouse"


def test_modal_buttons_open_and_close_through_delegation(page, live_server):
    """新增品項 modal：開啟鈕（inventory-add-open）與關閉鈕（ui-close-modal）都走委派。"""
    harness.open_tab(page, live_server, "inventory")
    page.on("dialog", lambda dialog: dialog.accept())   # 開啟後櫃子清單非同步載入會改動表單，closeModal 的「未存變更」確認一律按確定
    assert not _visible(page, "#add-modal")
    _click(page, '[data-action="inventory-add-open"]')
    page.wait_for_timeout(150)
    assert _visible(page, "#add-modal")
    _click(page, '#add-modal [data-action="ui-close-modal"][data-modal="add-modal"]')
    page.wait_for_timeout(150)
    assert not _visible(page, "#add-modal")


def test_avatar_menu_and_notification_buttons(page, live_server):
    """頭像選單與通知鈴鐺（app-avatar-menu / notif-toggle）。"""
    harness.open_tab(page, live_server, "inventory")
    _click(page, '[data-action="app-avatar-menu"]')
    assert _visible(page, "#avatarMenu")
    _click(page, '[data-action="app-avatar-menu"]')
    assert not _visible(page, "#avatarMenu")
    _click(page, '[data-action="notif-toggle"]')
    page.wait_for_timeout(150)
    assert _visible(page, ".notif-panel")
    _click(page, '[data-action="notif-toggle"]')
    page.wait_for_timeout(150)
    assert not _visible(page, ".notif-panel")


def test_kit_modal_and_stockout_filter_controls(page, live_server):
    """整組頁「新增整組」（kits-open-modal）與已領出頁篩選列（change / input / keydown / click 四種事件）。"""
    harness.open_tab(page, live_server, "kit")
    page.wait_for_selector('[data-action="kits-open-modal"]')
    _click(page, '[data-action="kits-open-modal"]')
    page.wait_for_timeout(150)
    assert _visible(page, "#kit-modal")
    _click(page, '#kit-modal [data-action="ui-close-modal"][data-modal="kit-modal"]')
    page.wait_for_timeout(150)
    assert not _visible(page, "#kit-modal")

    harness.open_tab(page, live_server, "stockout")
    page.wait_for_selector('[data-action="stockout-filter"][data-filter="search"]')
    search = page.locator('[data-action="stockout-filter"][data-filter="search"]')
    search.fill("不存在的關鍵字")           # input 事件：只記錄
    search.press("Enter")                   # keydown Enter：才查詢
    page.wait_for_load_state("networkidle")
    assert page.evaluate("hvac('features/stockout/state.js').stockoutState.stockoutPageSearch") == "不存在的關鍵字"
    page.wait_for_selector('[data-action="stockout-clear-filters"]')   # 重新查詢期間內容會先換成「載入中」
    _click(page, '[data-action="stockout-clear-filters"]')
    page.wait_for_load_state("networkidle")
    assert page.evaluate("hvac('features/stockout/state.js').stockoutState.stockoutPageSearch") == ""
    assert page.locator('[data-action="stockout-filter"][data-filter="search"]').input_value() == ""


def test_settings_page_side_items(page, live_server):
    """設定頁：側欄項目（settings-switch）切換面板；登出 / 返回鈕在標頭。"""
    page.goto(live_server.base_url + "/settings.html")
    page.wait_for_load_state("networkidle")
    assert page.evaluate("document.querySelectorAll('[onclick], [onchange], [oninput]').length") == 0
    _click(page, '[data-role="settings-side-item"][data-panel="cabinets"]')
    page.wait_for_timeout(200)
    assert _visible(page, "#panel-cabinets")
    _click(page, '[data-role="settings-side-item"][data-panel="gcal"]')
    page.wait_for_timeout(200)
    assert _visible(page, "#panel-gcal")
    assert not _visible(page, "#panel-cabinets")


def test_permissions_page_tabs(page, live_server):
    """權限頁：分頁切換（perms-switch-tab）與新增帳號 modal（perms-add-user-open / close）。"""
    page.goto(live_server.base_url + "/permissions.html")
    page.wait_for_load_state("networkidle")
    assert page.evaluate("document.querySelectorAll('[onclick], [onchange], [oninput]').length") == 0
    _click(page, '[data-action="perms-switch-tab"][data-tab="account"]')
    page.wait_for_timeout(200)
    _click(page, '[data-action="perms-add-user-open"]')
    page.wait_for_timeout(200)
    assert _visible(page, "#addUserModal, #add-user-modal, [data-role='modal'].is-open")
    _click(page, '[data-action="perms-add-user-close"]')
    page.wait_for_timeout(200)
    assert not page.evaluate("!!document.querySelector('[data-role=\"modal\"].is-open')")
