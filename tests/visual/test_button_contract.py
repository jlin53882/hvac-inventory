# -*- coding: utf-8 -*-
"""按鈕 / chip 外觀契約（CSS 架構重構 P7.5，需 visual 群組）。

1. 每個截圖情境中可見的 .btn / .chip，computed style 必須等於其變體與尺寸的規格
   （顏色、框線、圓角、字級、字重、高度）。任何頁面 CSS 蓋掉標準按鈕外觀都會在這裡失敗。
2. 畫面上可見的 <button> 必須是 .btn / .chip，或已登記在 tests/button_contract.json 的專用控制項
   （與 tests/test_css_architecture.py 共用同一份清單）。新按鈕沒套設計系統會在這裡失敗。
"""
import json
import os

import pytest

import harness
import snapshot

_HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(_HERE, "button_probe.js"), encoding="utf-8") as _fh:
    PROBE = _fh.read()
with open(os.path.join(os.path.dirname(_HERE), "button_contract.json"), encoding="utf-8") as _fh:
    SPECIALIZED = json.load(_fh)["specialized_button_classes"]


def _open_scenario(page, live_server, target, action):
    if target.startswith("/"):
        if target == "/login.html":
            page.context.clear_cookies()
        page.goto(live_server.base_url + target)
        page.wait_for_load_state("networkidle")
    else:
        harness.open_tab(page, live_server, target)
    harness.run_action(page, action)


@pytest.mark.parametrize("name,target,action", snapshot.SCENARIOS, ids=[s[0] for s in snapshot.SCENARIOS])
def test_buttons_match_design_system(page, live_server, viewport, name, target, action):
    """畫面上的標準按鈕與 chip 都符合規格，且沒有未納管的一般按鈕。"""
    _open_scenario(page, live_server, target, action)
    result = page.evaluate(PROBE, SPECIALIZED)
    where = f"[{name} @ {viewport[0]}]"
    assert not result["problems"], f"{where} 按鈕 / chip 外觀不符合設計系統規格：\n" + "\n".join(result["problems"])
    assert not result["unstyled"], (
        f"{where} 可見按鈕沒有套 .btn / .chip，也不在 tests/button_contract.json 專用控制項清單（class «文字»）：\n"
        + "\n".join(result["unstyled"])
    )


def test_probe_flags_unmanaged_button(page, live_server):
    """探針自我檢查：插入一個普通 <button> 必須被抓到；登記過的專用控制項不算違規。"""
    harness.open_tab(page, live_server, "inventory")
    page.evaluate("""() => {
        const plain = document.createElement('button'); plain.className = 'probe-plain'; plain.textContent = '未納管';
        const special = document.createElement('button'); special.className = 'qty-btn'; special.textContent = '+';
        document.getElementById('content').prepend(plain, special);
    }""")
    unstyled = page.evaluate(PROBE, SPECIALIZED)["unstyled"]
    assert any(item.startswith("probe-plain") for item in unstyled), unstyled
    assert not any(item.startswith("qty-btn") for item in unstyled), unstyled
