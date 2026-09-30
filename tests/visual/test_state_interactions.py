# -*- coding: utf-8 -*-
"""狀態 class 互動契約（CSS 架構重構 P7：.active / .open / .show / .on … 統一改為 is-*）。

測試不依賴 class 名稱，只檢查使用者看得到的結果（是否可見、是否呈現「選取中」外觀），
因此改名前後都必須通過；任何一處漏改都會讓對應互動失效而被抓到。
"""
import pytest

import harness


def _visible(page, selector: str) -> bool:
    """元素存在、有排版盒且 visibility 不是 hidden。"""
    return page.evaluate(
        """sel => { const el = document.querySelector(sel); if (!el) return false;
        const cs = getComputedStyle(el);
        return el.getClientRects().length > 0 && cs.visibility !== 'hidden' && cs.opacity !== '0'; }""",
        selector,
    )


def _look(page, selector: str) -> tuple:
    """元素的外觀指紋（背景 / 文字 / 框線顏色 / 字重），用來判斷是否呈現「選取中」狀態。"""
    return tuple(page.evaluate(
        """sel => { const cs = getComputedStyle(document.querySelector(sel));
        return [cs.backgroundColor, cs.color, cs.borderTopColor, cs.fontWeight]; }""",
        selector,
    ))


def _selected_differs(page, selected: str, other: str) -> None:
    """選取中的元素外觀必須和未選取的同類元素不同。"""
    assert _look(page, selected) != _look(page, other), f"{selected} 沒有呈現選取外觀（與 {other} 相同）"


def test_sidebar_link_follows_current_tab(page, live_server):
    """切頁後側欄只有目前頁籤呈現選取外觀。"""
    harness.open_tab(page, live_server, "inventory")
    _selected_differs(page, "#sb-nav-inventory", "#sb-nav-kit")
    page.evaluate("hvac('features/shell/app.js').switchTab('kit')")
    page.wait_for_load_state("networkidle")
    _selected_differs(page, "#sb-nav-kit", "#sb-nav-inventory")


def test_site_switch_highlights_selected_site(page, live_server):
    """公司 / 倉庫分片切換後，選取中的按鈕外觀跟著移動。"""
    harness.open_tab(page, live_server, "inventory")
    _selected_differs(page, "#site-office", "#site-warehouse")
    page.evaluate("hvac('features/shell/app.js').switchSite('warehouse')")
    page.wait_for_load_state("networkidle")
    _selected_differs(page, "#site-warehouse", "#site-office")


def test_modal_opens_and_closes(page, live_server):
    """共用 modal 開啟後可見、關閉後隱藏；Escape 也能關閉。"""
    harness.open_tab(page, live_server, "inventory")
    assert not _visible(page, "#add-modal")
    harness.run_action(page, "hvac('features/inventory/add-modal.js').openAddModal()")
    assert _visible(page, "#add-modal")
    page.evaluate("hvac('core/utils.js').closeModalForce('add-modal')")
    assert not _visible(page, "#add-modal")
    harness.run_action(page, "hvac('features/inventory/add-modal.js').openAddModal()")
    page.keyboard.press("Escape")
    page.wait_for_timeout(150)
    assert not _visible(page, "#add-modal")


def test_avatar_menu_and_notification_panel_toggle(page, live_server):
    """頭像選單、通知中心可開可關。"""
    harness.open_tab(page, live_server, "inventory")
    assert not _visible(page, "#avatarMenu")
    page.evaluate("hvac('features/shell/app.js').toggleAvatarMenu()")
    assert _visible(page, "#avatarMenu")
    page.evaluate("hvac('features/shell/app.js').toggleAvatarMenu()")
    assert not _visible(page, "#avatarMenu")
    assert not _visible(page, ".notif-panel")
    page.evaluate("hvac('features/notifications/center.js').toggleNotif()")
    page.wait_for_timeout(150)
    assert _visible(page, ".notif-panel")
    page.evaluate("hvac('features/notifications/center.js').toggleNotif()")
    page.wait_for_timeout(150)
    assert not _visible(page, ".notif-panel")


def test_inventory_view_toggle_and_filter_chip(page, live_server, viewport):
    """表格 / 卡片切換鈕與品牌篩選 chip 都呈現選取外觀。"""
    harness.open_tab(page, live_server, "inventory")
    harness.run_action(page, "hvac('features/inventory/list.js').setInventoryView('table')")
    _selected_differs(page, ".view-toggle button:first-child", ".view-toggle button:last-child")
    harness.run_action(page, "hvac('features/inventory/list.js').setInventoryView('card')")
    _selected_differs(page, ".view-toggle button:last-child", ".view-toggle button:first-child")
    if viewport[0] == "desktop":
        chips = "#fp-brand-chips .filter-chip"
        _selected_differs(page, f"{chips}:first-child", f"{chips}:nth-child(2)")
        page.click(f"{chips}:nth-child(2)")
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(150)
        _selected_differs(page, f"{chips}:nth-child(2)", f"{chips}:first-child")


def test_location_group_collapses(page, live_server, viewport):
    """點位置標題可收合 / 展開該位置的品項。"""
    if viewport[0] == "mobile":
        pytest.skip("手機版不顯示位置分組標題")
    harness.open_tab(page, live_server, "inventory")
    assert _visible(page, ".loc-group")
    page.click(".section-title")
    page.wait_for_timeout(150)
    assert not _visible(page, ".loc-group")
    page.click(".section-title")
    page.wait_for_timeout(150)
    assert _visible(page, ".loc-group")


def test_stocktake_tabs_switch(page, live_server):
    """盤點「整組 / 單一材料」頁籤切換外觀。"""
    harness.open_tab(page, live_server, "stocktake")
    tabs = ".stk-tabs .stk-tab"
    _selected_differs(page, f"{tabs}:first-child", f"{tabs}:last-child")
    page.click(f"{tabs}:last-child")
    page.wait_for_timeout(150)
    _selected_differs(page, f"{tabs}:last-child", f"{tabs}:first-child")


def test_quotation_mode_tabs(page, live_server):
    """報價單 / 報價單上傳模式切換外觀。"""
    harness.open_tab(page, live_server, "quotation")
    tabs = ".quote-mode-tabs .quote-mode-tab"
    _selected_differs(page, f"{tabs}:first-child", f"{tabs}:last-child")
    harness.run_action(page, "hvac('features/quotation/page.js').quoteSwitchMode('upload')")
    _selected_differs(page, f"{tabs}:last-child", f"{tabs}:first-child")


def test_toast_shows(page, live_server):
    """toast 出現時可見。"""
    harness.open_tab(page, live_server, "inventory")
    page.evaluate("hvac('core/utils.js').toast('測試訊息', 'success')")
    page.wait_for_timeout(100)
    assert _visible(page, ".toast")


def test_petty_cash_overlay_opens(page, live_server):
    """零用金一般 / 工程報表 overlay 開啟後可見。"""
    harness.open_tab(page, live_server, "petty-cash")
    harness.run_action(page, "hvac('features/petty-cash/report-modal.js').pcOpenReportModal()")
    assert _visible(page, "#pc-report-overlay")
    page.evaluate("hvac('features/petty-cash/report-modal.js').pcCloseReportModal()")
    harness.run_action(page, "hvac('features/petty-cash/engineering-modal.js').pcOpenEngineeringModal()")
    assert _visible(page, "#eng-report-overlay")


def test_bottom_sheet_opens(page, live_server):
    """手機 ⋯ 動作選單開啟後可見、關閉後移除。"""
    harness.open_tab(page, live_server, "inventory")
    page.evaluate("hvac('core/bottomsheet.js').openSheet('動作', [{label: '測試', icon: '✏️', fn: function(){}}])")
    page.wait_for_timeout(350)
    assert _visible(page, "#sheet-overlay .sheet")
    page.evaluate("hvac('core/bottomsheet.js').closeSheet()")
    page.wait_for_timeout(350)
    assert not _visible(page, "#sheet-overlay .sheet")


def test_mobile_sidebar_drawer(page, live_server, viewport):
    """手機側欄抽屜：開啟時進入畫面、遮罩出現。"""
    if viewport[0] == "desktop":
        pytest.skip("桌機側欄固定顯示")
    harness.open_tab(page, live_server, "inventory")
    left_closed = page.evaluate("document.getElementById('sidebar').getBoundingClientRect().left")
    page.evaluate("hvac('features/shell/app.js').openSidebar()")
    page.wait_for_timeout(350)
    assert page.evaluate("document.getElementById('sidebar').getBoundingClientRect().left") > left_closed
    assert _visible(page, "#sbOverlay") and page.evaluate("getComputedStyle(document.getElementById('sbOverlay')).pointerEvents") == "auto"


def test_settings_and_permissions_tabs(page, live_server):
    """設定中心側欄 / 權限頁頁籤切換外觀。"""
    page.goto(live_server.base_url + "/settings.html")
    page.wait_for_load_state("networkidle")
    side = "#settingsSideList .side-item"
    if _visible(page, f"{side}[data-panel='units']"):
        _selected_differs(page, f"{side}[data-panel='units']", f"{side}[data-panel='cabinets']")
        page.evaluate("hvac('features/settings/page.js').settingsSwitch('cabinets')")
        _selected_differs(page, f"{side}[data-panel='cabinets']", f"{side}[data-panel='units']")
    page.goto(live_server.base_url + "/permissions.html")
    page.wait_for_load_state("networkidle")
    tabs = ".tab[data-tab]"
    _selected_differs(page, f"{tabs}[data-tab='perms']", f"{tabs}[data-tab='account']")
    page.evaluate("hvac('features/permissions/page.js').permSwitchTab('account')")
    _selected_differs(page, f"{tabs}[data-tab='account']", f"{tabs}[data-tab='perms']")
