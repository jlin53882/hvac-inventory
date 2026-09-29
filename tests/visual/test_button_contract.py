# -*- coding: utf-8 -*-
"""按鈕 / chip 外觀契約（CSS 架構重構 P7.5，需 visual 群組）。

每個截圖情境中可見的 .btn / .chip，computed style 必須等於其變體與尺寸的規格
（顏色、框線、圓角、字級、字重、高度）。任何頁面 CSS 蓋掉標準按鈕外觀都會在這裡失敗，
所以調整按鈕只要改 3-components/button.css / chip.css，全站同步。
"""
import os

import pytest

import harness
import snapshot

with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "button_probe.js"), encoding="utf-8") as _fh:
    PROBE = _fh.read()


@pytest.mark.parametrize("name,target,action", snapshot.SCENARIOS, ids=[s[0] for s in snapshot.SCENARIOS])
def test_buttons_match_design_system(page, live_server, name, target, action):
    """畫面上的標準按鈕與 chip 都符合規格。"""
    if target.startswith("/"):
        if target == "/login.html":
            page.context.clear_cookies()
        page.goto(live_server.base_url + target)
        page.wait_for_load_state("networkidle")
    else:
        harness.open_tab(page, live_server, target)
    harness.run_action(page, action)
    problems = page.evaluate(PROBE)["problems"]
    assert not problems, "按鈕 / chip 外觀不符合設計系統規格：\n" + "\n".join(problems)
