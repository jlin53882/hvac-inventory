# -*- coding: utf-8 -*-
"""Visual / 瀏覽器測試 fixtures。

沒裝 visual 群組（Playwright）或找不到 Chromium 時，整個目錄的測試自動略過，
不影響一般 `pytest tests/`。安裝：uv sync --group dev --group visual && uv run playwright install chromium
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import harness  # noqa: E402


@pytest.fixture(scope="session")
def live_server(tmp_path_factory):
    """整個 session 共用一台隔離伺服器與固定種子資料。"""
    if not harness.playwright_available():
        pytest.skip("Playwright 未安裝（uv sync --group visual）")
    server = harness.start_server(str(tmp_path_factory.mktemp("visual-server")))
    try:
        harness.seed(server)
        yield server
    finally:
        server.stop()


@pytest.fixture(scope="session")
def browser(live_server):
    """整個 session 共用一個 headless Chromium。"""
    from playwright.sync_api import sync_playwright

    with sync_playwright() as pw:
        instance = harness.launch_browser(pw)
        if instance is None:
            pytest.skip("找不到 Chromium（uv run playwright install chromium）")
        yield instance
        instance.close()


@pytest.fixture(params=["desktop", "mobile"])
def viewport(request):
    """桌機與手機各跑一次。"""
    return request.param, {"desktop": harness.DESKTOP, "mobile": harness.MOBILE}[request.param]


@pytest.fixture()
def page(browser, live_server, viewport):
    """已登入、時間凍結、動畫關閉的頁面；測試結束時關閉 context，並確認沒有 JS 錯誤。"""
    pg = harness.new_page(browser, live_server, viewport[1])
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    yield pg
    pg.context.close()
    assert not errors, f"頁面 JS 錯誤：{errors}"
