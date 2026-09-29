# -*- coding: utf-8 -*-
"""CSS 跨頁隔離與關鍵版面契約（Playwright，需 visual 群組）。

1. 外洩偵測：每個畫面上「可見」元素被「別頁 CSS 檔」命中的規則，必須與
   known_css_leaks.json 完全一致——
   - 出現新外洩 → 有人寫了會影響別頁的樣式（改 A 壞 B 的來源），請加上頁面範圍；
   - 清單中的外洩消失 → 重構已修好，請執行
     `uv run --group visual python tests/visual/snapshot.py leaks` 更新清單（只能縮小）。
2. 版面契約：用 getComputedStyle 鎖住實際套用的結果，不比對 CSS 原文。
"""
import json

import pytest

import harness

with open(harness.KNOWN_LEAKS_PATH, encoding="utf-8") as _fh:
    KNOWN_LEAKS = json.load(_fh)


@pytest.mark.parametrize("sid,owner,tab,action", harness.LEAK_SCENARIOS, ids=[s[0] for s in harness.LEAK_SCENARIOS])
def test_no_cross_page_css_leaks(page, live_server, viewport, sid, owner, tab, action):
    """畫面上的元素只能被全域樣式或本頁樣式命中（既有外洩列在 known_css_leaks.json 逐步清除）。"""
    actual = set(harness.scenario_leaks(page, live_server, owner, tab, action))
    expected = set(KNOWN_LEAKS.get(f"{sid}@{viewport[0]}", []))
    new = sorted(actual - expected)
    fixed = sorted(expected - actual)
    assert not new, "新的跨頁樣式外洩（請改用頁面範圍或共用元件）：\n" + "\n".join(new)
    assert not fixed, "外洩已修好，請執行 snapshot.py leaks 更新 known_css_leaks.json：\n" + "\n".join(fixed)


def _computed(page, selector: str, prop: str) -> str:
    """回傳第一個符合 selector 的元素的 computed style 值。"""
    return page.eval_on_selector(selector, "(el, p) => getComputedStyle(el).getPropertyValue(p)", prop)


@pytest.mark.parametrize("tab", ["inventory", "kit"])
@pytest.mark.parametrize("modal,opener", [("#add-modal", "openAddModal()"), ("#edit-modal", "openEditModal(1)")])
def test_item_modal_location_headers_grid(page, live_server, viewport, tab, modal, opener):
    """新增 / 編輯品項 modal 的位置欄標頭：桌機 5 欄 grid、手機隱藏；不論從哪一頁開啟都一樣。"""
    harness.open_tab(page, live_server, tab)
    harness.run_action(page, opener)
    headers = f"{modal} .edit-stock-headers"
    if viewport[0] == "mobile":
        assert _computed(page, headers, "display") == "none"
        return
    assert _computed(page, headers, "display") == "grid"
    for column, cls in enumerate(("ch-cabinet", "ch-pos", "ch-qty", "ch-note", "ch-remove"), start=1):
        assert _computed(page, f"{headers} .{cls}", "grid-column-start") == str(column)


def test_kit_modal_location_headers_flex(page, live_server):
    """整組 modal 的建議存放位置標頭維持 flex 比例欄寬。"""
    harness.open_tab(page, live_server, "kit")
    harness.run_action(page, "openKitModal()")
    headers = "#kit-modal .col-headers"
    assert _computed(page, headers, "display") == "flex"
    assert _computed(page, f"{headers} .ch-cabinet", "flex-basis") == "25%"
    assert _computed(page, f"{headers} .ch-pos", "flex-basis") == "25%"
    assert _computed(page, f"{headers} .ch-note", "min-width") == "120px"


@pytest.mark.parametrize("tab,dialog,opener", [
    ("inventory", "#inventory-export-dialog", "openInventoryExportDialog()"),
    ("kit", "#kit-export-dialog", "openKitExportDialog()"),
    ("stockout", "#stockout-export-dialog", "openStockoutExportDialog()"),
])
def test_export_dialog_styled_on_every_page(page, live_server, viewport, tab, dialog, opener):
    """匯出報表對話框三頁共用：每一頁開啟都要有同一套版面
    （回歸：P5 曾把樣式誤限定在庫存頁，整組 / 已領出頁的對話框變成未排版的原生表單）。"""
    harness.open_tab(page, live_server, tab)
    harness.run_action(page, opener)
    assert _computed(page, f"{dialog} .inventory-export-dialog__header", "display") == "flex"
    assert _computed(page, f"{dialog} .inventory-export-dialog__footer", "display") == "flex"
    assert _computed(page, f"{dialog} .inventory-export-dialog__close", "border-top-width") == "0px"
    assert _computed(page, f"{dialog} .inventory-export-period-fields", "display") == "flex"
    width = page.eval_on_selector(f"{dialog} .inventory-export-dialog__panel", "el => el.getBoundingClientRect().width")
    assert width <= (560 if viewport[0] == "desktop" else 390 - 24 + 1)


def _goto_settings(page, live_server, action):
    page.goto(live_server.base_url + "/settings.html")
    page.wait_for_load_state("networkidle")
    page.evaluate(f"async () => {{ {action} }}")
    page.wait_for_timeout(200)


def test_gcal_key_panel_layout(page, live_server, viewport):
    """設定頁行事曆同步：桌機 Key 列表 220px + 右側詳情並排；手機改為上下排列、滿版
    （回歸：inline style 蓋過手機規則，手機版被擠成左右兩欄、文字一字一行）。"""
    _goto_settings(page, live_server, "settingsSwitch('gcal'); selectGcalKey(1);")
    layout, keys, panel = "#panel-gcal .gcal-layout", "#panel-gcal .gcal-key-list", "#panel-gcal .gcal-detail-panel"
    if viewport[0] == "desktop":
        assert _computed(page, layout, "display") == "flex"
        assert _computed(page, keys, "width") == "220px"
    else:
        assert _computed(page, layout, "display") == "block"
        vw = page.evaluate("window.innerWidth")
        for sel in (keys, panel):
            width = page.eval_on_selector(sel, "el => el.getBoundingClientRect().width")
            assert width > vw * 0.8, f"{sel} 手機版應接近滿版，實際 {width}px"
        assert _computed(page, "#panel-gcal .gcal-detail-head", "flex-wrap") == "wrap"


def test_cabinet_actions_stay_inline(page, live_server, viewport):
    """櫃子設定的「編輯 / 刪除」在桌機與手機都維持同一列靠右（回歸：改 class 後被 .u-table td 蓋過）。"""
    _goto_settings(page, live_server, "settingsSwitch('cabinets');")
    cell = "#cabinetList td.cabinet-actions"
    assert _computed(page, cell, "display") == "flex"
    assert _computed(page, cell, "justify-content") == "flex-end"


def test_stock_location_picker_keeps_its_width(page, live_server):
    """入庫位置選擇視窗維持 420px 寬（回歸：與 .modal 同層同特異度，被較晚載入的 modal.css 蓋成 520px）。"""
    harness.open_tab(page, live_server, "inventory")
    harness.run_action(page, "openStockLocationPicker(ALL_ITEMS.find(i => i.id === 1), 1)")
    width = page.eval_on_selector(".modal.stock-adjust-modal", "el => el.getBoundingClientRect().width")
    assert width <= 420, width


def test_kit_prepare_component_list_layout(page, live_server):
    """整組待領出視窗的材料清單：縮圖、名稱、需要 / 庫存同一列（回歸：樣式誤限定在待領出頁）。"""
    harness.open_tab(page, live_server, "kit")
    harness.run_action(page, "openKitPrepareModal(1, '標準安裝包')")
    assert _computed(page, "#kit-prepare-list .kit-prepare-row", "display") == "flex"
    assert _computed(page, "#kit-prepare-list .kit-prepare-qty", "text-align") == "right"


def test_mobile_calendar_event_names_fit(page, live_server, viewport):
    """手機月曆格的客戶名最多兩行：6 字以內完整顯示（如「大安社區」），更長才以 … 截斷
    （回歸：字級統一曾把 9px 放大到 11px，連 3 字名稱都變成「陳…」）。"""
    if viewport[0] == "desktop":
        pytest.skip("桌機月曆格有足夠寬度")
    harness.open_tab(page, live_server, "calendar")
    result = page.evaluate("""() => [...document.querySelectorAll('.cal-evt-body')]
        .filter(el => el.getClientRects().length)
        .map(el => ({text: el.textContent.trim(),
                     cut: el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1}))""")
    assert any(r["text"] == "大安社區" for r in result), result
    clipped = [r["text"] for r in result if r["cut"] and len(r["text"]) <= 6]
    assert not clipped, f"月曆格名稱被截斷：{clipped}"


def test_mobile_calendar_busy_day(page, live_server, viewport):
    """一天多筆派工：格內最多 2 筆 + 「+N 筆」，名稱兩行也不會超出格子、不把整週撐得過高。"""
    if viewport[0] == "desktop":
        pytest.skip("桌機月曆格固定列高，另由截圖涵蓋")
    types = live_server.api("GET", "/api/service-types")
    types = types if isinstance(types, list) else types.get("items", [])
    created = []
    try:
        for start, name in (("09:00", "台北信義區管理委員會"), ("10:30", "王大明"), ("13:00", "陳小姐"),
                            ("15:00", "林先生"), ("", "大安社區")):
            created.append(live_server.api("POST", "/api/appointments", {
                "client_name": name, "address": "台北市", "date": "2026-09-29", "start_time": start,
                "end_time": "" if not start else start[:2] + ":50", "service_type_id": types[0]["id"]})["id"])
        harness.open_tab(page, live_server, "calendar")
        cell = page.evaluate("""() => {
            const c = [...document.querySelectorAll('.cal-cell')].find(el => el.querySelector('.cal-day-num')?.textContent.trim() === '29'
                      && !el.classList.contains('cal-other'));
            const r = c.getBoundingClientRect();
            const chips = [...c.querySelectorAll('.cal-evt')];
            return {chips: chips.length, more: c.querySelector('.cal-evt-more')?.textContent || '', height: r.height,
                    overflow: chips.some(e => e.getBoundingClientRect().bottom > r.bottom + 1)};
        }""")
        assert cell["chips"] == 3 and "+3" in cell["more"], cell
        assert not cell["overflow"], cell
        assert cell["height"] <= 140, cell
    finally:
        for appt_id in created:
            live_server.api("DELETE", f"/api/appointments/{appt_id}")


def test_modal_overlay_stacks_above_shell(page, live_server):
    """modal 疊層高於 header / sidebar。"""
    harness.open_tab(page, live_server, "inventory")
    harness.run_action(page, "openAddModal()")
    overlay = int(_computed(page, "#add-modal", "z-index"))
    assert overlay > int(_computed(page, ".header", "z-index"))
    assert overlay > int(_computed(page, ".sidebar", "z-index"))


_SCOPE_JS = """() => {
  const c = document.getElementById('content'); const cs = getComputedStyle(c);
  return {page: document.body.dataset.page || '', cls: [...c.classList].sort().join(' '),
          padding: cs.padding, maxWidth: cs.maxWidth, background: cs.backgroundColor};
}"""
_TABS = ["inventory", "prepared", "stockout", "stocktake", "kit", "calendar",
         "work-progress", "signed-reports", "quotation", "petty-cash"]


@pytest.mark.parametrize("tab", _TABS)
def test_tab_switch_leaves_no_page_scope_behind(page, live_server, tab):
    """切到每一頁（含報價單上傳模式）再切回來，頁面範圍與 #content 樣式必須和直接開啟時相同。"""
    harness.open_tab(page, live_server, tab)
    direct = page.evaluate(_SCOPE_JS)
    assert direct["page"] == tab
    for other in _TABS:
        page.evaluate("t => switchTab(t)", other)
        page.wait_for_load_state("networkidle")
        if other == "quotation":
            harness.run_action(page, "quoteSwitchMode('upload')")
            assert page.evaluate(_SCOPE_JS)["page"] == "quotation-upload"
    page.evaluate("t => switchTab(t)", tab)
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(200)
    assert page.evaluate(_SCOPE_JS) == direct


# ---------- issue #37：手機標頭（公司 / 倉庫 chip 單行 + 頁面標題可見） ----------
def test_mobile_header_site_chips_single_row(page, live_server, viewport):
    """手機：四顆站點 chip 同一列、高 28px，標題「單一庫存」可見，標頭高度不超過改前的 133px；桌機 chip 維持 32px。"""
    harness.open_tab(page, live_server, "inventory")
    ids = ("office", "warehouse", "van", "truck")
    boxes = [page.eval_on_selector(f"#site-{i}", "el => { const r = el.getBoundingClientRect(); return [r.top, r.height]; }") for i in ids]
    if viewport[0] != "mobile":
        assert {round(h) for _, h in boxes} == {32}
        return
    assert len({round(top) for top, _ in boxes}) == 1, f"站點 chip 沒排在同一列：{boxes}"
    assert {round(h) for _, h in boxes} == {28}
    assert page.eval_on_selector(".breadcrumb", "el => el.getBoundingClientRect().width") > 40, "頁面標題被擠掉"
    assert page.eval_on_selector(".header", "el => el.getBoundingClientRect().height") <= 133
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "標頭造成橫向捲動"


# ---------- 待領出頁手機卡片（issue #37 後續：方案 A） ----------
def test_prepared_mobile_card_layout(page, live_server, viewport):
    """待領出手機卡片（方案 A）：數量徽章在右上且完整可見，「已領出」與 ⋯ 在底部同一列、不與數量重疊。"""
    if viewport[0] != "mobile":
        pytest.skip("只適用手機卡片")
    harness.open_tab(page, live_server, "prepared")
    box = page.evaluate("""() => {
      const card = document.querySelector('.prepared-mobile-card');
      const rect = s => card.querySelector(s).getBoundingClientRect();
      const c = card.getBoundingClientRect(), q = rect('.prepared-mobile-qty');
      const btns = [...card.querySelectorAll('.prepared-mobile-meta .btn')].map(b => b.getBoundingClientRect());
      return {
        inside: q.left >= c.left && q.right <= c.right && q.top >= c.top,
        oldMore: !!card.querySelector('.more-btn'),
        btnCount: btns.length,
        sameRow: new Set(btns.map(r => Math.round(r.top))).size === 1,
        below: btns.every(r => r.top >= q.bottom),
      };
    }""")
    assert box["inside"], "待領出數量徽章超出卡片"
    assert not box["oldMore"], "右上角不應再有 ⋯ 浮動按鈕"
    assert box["btnCount"] == 2 and box["sameRow"] and box["below"], f"底部動作列異常：{box}"


def test_prepared_kit_subitems_are_styled(page, live_server):
    """整組子品項清單屬於待領出頁，樣式必須限定在 [data-page=prepared]（曾誤留在庫存頁 CSS，導致縮圖與文字失去樣式）。"""
    harness.open_tab(page, live_server, "prepared")
    page.evaluate("""() => {
      const wrap = document.createElement('div');
      wrap.innerHTML = '<div class="kit-subitem" id="t-sub"><div class="prepared-kit-thumb"></div><span class="kit-subitem-name">x</span></div>';
      document.getElementById('content').appendChild(wrap);
    }""")
    assert _computed(page, "#t-sub", "display") == "flex"
    assert _computed(page, "#t-sub", "font-size") == "12px"
