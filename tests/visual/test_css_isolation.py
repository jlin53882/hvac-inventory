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
