# -*- coding: utf-8 -*-
"""JS 行為掛鉤契約（issue #39 第 3 項：JS 不依賴樣式 class 找元素）。

JS 改用 id / data-role 找按鈕與 chip 後，用真實瀏覽器確認標記與 JS 對得上、行為與改前相同：
送出按鈕的文字 / 動作 / 忙碌鎖、密碼過期提示的按鈕顯示、快捷期間 chip 的選取狀態、設定頁 chip 與單位收編。
"""
import json

import harness


def _active_ranges(page, role: str) -> list:
    """同一組快捷期間 chip 中，呈現選取狀態的 data-range。"""
    return page.evaluate(
        "r => [...document.querySelectorAll(`[data-role=\"${r}\"]`)]"
        ".filter(b => b.classList.contains('is-active')).map(b => b.dataset.range)",
        role,
    )


def _click_range(page, role: str, value: str) -> None:
    page.locator(f'[data-role="{role}"][data-range="{value}"]').first.click()
    page.wait_for_load_state("networkidle")


def test_kit_submit_button_follows_create_and_edit_mode(page, live_server):
    """整組 modal 的送出按鈕：新增 / 編輯模式各自換文字與動作；忙碌時鎖住，避免重複送出。"""
    harness.open_tab(page, live_server, "kit")
    harness.run_action(page, "Kits.openKitModal()")
    button = page.locator("#kit-modal #kit-submit")
    assert button.inner_text().strip() == "✅ 建立整組"
    assert button.get_attribute("onclick") == "Kits.submitKit()"
    page.evaluate("hvac('features/kits/kit-modal.js').setKitSubmitBusy(true)")
    assert button.is_disabled() and button.get_attribute("aria-busy") == "true"
    page.evaluate("hvac('features/kits/kit-modal.js').setKitSubmitBusy(false)")
    assert button.is_enabled() and button.get_attribute("aria-busy") == "false"
    page.evaluate("hvac('core/utils.js').closeModalForce('kit-modal')")
    harness.run_action(page, "Kits.editKit(hvac('core/state.js').appState.currentKitItems[0].id)")
    assert button.inner_text().strip() == "💾 儲存整組"
    assert button.get_attribute("onclick") == "Kits.submitKitEdit()"


def test_expiry_modal_buttons_follow_self_service_permission(page, live_server):
    """密碼過期提示：可自行改密碼的帳號看到兩顆按鈕；其他帳號只看到「請聯絡管理員」。"""
    harness.open_tab(page, live_server, "inventory")
    page.evaluate("hvac('core/session.js').currentUser.permissions['change-own-password'] = false; hvac('features/account/password-expiry.js').openExpiryModal();")
    assert not page.locator("#expiry-change-pw").is_visible()
    assert not page.locator("#expiry-ack").is_visible()
    assert page.locator("#expiry-admin-only").is_visible()
    page.evaluate("hvac('core/utils.js').closeModalForce('expiry-modal'); hvac('core/session.js').currentUser.permissions['change-own-password'] = true; hvac('features/account/password-expiry.js').openExpiryModal();")
    assert page.locator("#expiry-change-pw").is_visible()
    assert page.locator("#expiry-ack").is_visible()
    assert not page.locator("#expiry-admin-only").is_visible()


def test_prepared_edit_submit_is_single_flight(page, live_server):
    """待領出修改：送出按鈕忙碌中再按不會送第二次；完成後解鎖並關閉 modal。"""
    harness.open_tab(page, live_server, "prepared")
    harness.run_action(page, "Stockout.openPreparedEditModal(hvac('core/state.js').appState.preparedItems[0].id)")
    patches = []
    page.on("request", lambda req: patches.append(req.url) if req.method == "PATCH" else None)
    page.evaluate("document.getElementById('prepared-edit-submit').disabled = true")
    harness.run_action(page, "Stockout.submitPreparedEdit()")
    assert patches == [], "忙碌中的送出按鈕不應再送出"
    page.evaluate("document.getElementById('prepared-edit-submit').disabled = false")
    harness.run_action(page, "Stockout.submitPreparedEdit()")
    assert len(patches) == 1 and "/api/prepared/" in patches[0]
    assert page.locator("#prepared-edit-submit").is_enabled()
    assert not page.locator("#prepared-edit-modal").is_visible()


def test_quick_range_chips_track_selection_and_reset(page, live_server):
    """各頁快捷期間 chip：點選後只有該 chip 選取；重設後回到預設期間。"""
    cases = [
        ("petty-cash", None, "pc-range", "all", "prev", "PettyCash.pcResetFilter()"),
        ("work-progress", None, "wpr-range", "month", "today", "WorkProgress.wprResetFilter()"),
        ("signed-reports", None, "upl-range", "month", "week", "SignedReports.resetFilter()"),
        ("quotation", "Quotation.quoteSwitchMode('upload')", "upl-range", "month", "all", "QuotationUploads.resetFilter()"),
    ]
    for tab, action, role, default, other, reset in cases:
        harness.open_tab(page, live_server, tab)
        harness.run_action(page, action)
        assert _active_ranges(page, role) == [default], tab
        _click_range(page, role, other)
        assert _active_ranges(page, role) == [other], tab
        harness.run_action(page, reset)
        assert _active_ranges(page, role) == [default], tab


def _wait_toast(page, prefix: str) -> None:
    """等到 toast 顯示指定開頭的訊息（動作完成、畫面已重繪）。"""
    page.wait_for_function(
        "p => { const el = document.getElementById('toast'); return el.className.includes('is-open') && el.textContent.startsWith(p); }",
        arg=prefix)


def _open_settings(page, live_server):
    page.goto(live_server.base_url + "/settings.html")
    page.wait_for_load_state("networkidle")


def test_settings_chip_bar_follows_panel(page, live_server):
    """設定頁（手機 chip 列）切換面板後，只有目前面板的 chip 呈現選取狀態。"""
    _open_settings(page, live_server)
    for panel in ("cabinets", "gcal", "units"):
        page.evaluate("p => Settings.settingsSwitch(p)", panel)
        page.wait_for_load_state("networkidle")
        active = page.evaluate(
            "() => [...document.querySelectorAll('#settingsChipBar [data-panel]')]"
            ".filter(c => c.classList.contains('is-active')).map(c => c.dataset.panel)")
        assert active == [panel]


def test_settings_unit_consolidation_reads_row_controls(page, live_server):
    """單位收編：逐筆「改為」讀同一列的目標單位與新總量；整組套用讀同一組的目標單位。"""
    # 孤兒單位清單由 /api/units/orphans 提供（issue #39：模組內狀態無法從外部改寫，改由 API 替身給資料）
    orphans = [{"item_id": 101, "name": "舊冷媒", "unit": "罐裝", "total_qty": 3, "is_deleted": 0},
               {"item_id": 102, "name": "新冷媒", "unit": "罐裝", "total_qty": 1, "is_deleted": 0}]
    page.route("**/api/units/orphans*", lambda route: route.fulfill(
        status=200, content_type="application/json", body=json.dumps(orphans)))
    _open_settings(page, live_server)
    bodies = []

    def capture(route):
        bodies.append((route.request.url, json.loads(route.request.post_data or "{}")))
        route.fulfill(status=200, content_type="application/json", body=json.dumps({"affected": 1}))

    page.route("**/api/units/consolidate*", capture)
    page.evaluate("""() => {
        window.confirm = () => true;
        Settings.settingsSwitch('units');
    }""")
    target = page.evaluate("() => hvac('core/state.js').appState.unitListActive[0].name")
    page.locator(".grp-head").first.click()
    row = page.locator("tr", has=page.locator("td.p-name", has_text="舊冷媒"))
    row.locator("select").select_option(target)
    row.locator("input").fill("0.75")
    row.get_by_role("button", name="改為").click()
    _wait_toast(page, "✅ 已改為")
    assert bodies[-1] == (live_server.base_url + "/api/units/consolidate-item",
                          {"item_id": 101, "to_unit": target, "new_qty": 0.75})
    del orphans[1:]
    page.evaluate("""async () => {
        const units = hvac('features/settings/units.js');
        await units.loadOrphans();
        units.renderUnitsPanel();
    }""")
    page.locator(".grp-head").first.click()
    group = page.locator(".grp-fast").first
    group.locator("select").select_option(target)
    group.get_by_role("button", name="套用全部").click()
    _wait_toast(page, "✅ 已收編")
    assert bodies[-1] == (live_server.base_url + "/api/units/consolidate", {"from_unit": "罐裝", "to_unit": target})
