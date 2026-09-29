# -*- coding: utf-8 -*-
"""檔案上傳清單（每日簽名報表 / 報價單上傳共用 render/upload-list.js；issue #39 第 2 項）。

用真實瀏覽器走完兩頁的使用流程：選檔 → 上傳 → 歷史出現 → 展開 → 編輯備註 → 預覽 → 刪除，
確認合併成共用元件後兩頁行為一致、且各自打自己的 API。
"""
import os

import pytest

import harness

LOGO = os.path.join(harness.ROOT, "static", "img", "logo-topbar.png")
PAGES = [
    ("signed-reports", None, "/api/signed-reports", "🗂 每日簽名報表"),
    ("quotation", "quoteSwitchMode('upload')", "/api/quotation-uploads", "🗂 報價單上傳"),
]


def _wait_toast(page, text: str) -> None:
    """等到 toast 顯示指定訊息（前一個 toast 可能還沒消失）。"""
    page.wait_for_function(
        "t => { const el = document.getElementById('toast'); return el.className.includes('is-open') && el.textContent === t; }",
        arg=text)


@pytest.mark.parametrize("tab,action,api,title", PAGES, ids=["signed-reports", "quotation-upload"])
def test_upload_list_flow(page, live_server, tab, action, api, title):
    """上傳 → 列表 → 編輯 → 預覽 → 刪除；每一步只打本頁 API（桌機 + 手機）。"""
    harness.open_tab(page, live_server, tab)
    harness.run_action(page, action)
    assert page.locator("h1").first.inner_text().startswith(title)
    requests = []
    page.on("request", lambda req: requests.append((req.method, req.url.split(live_server.base_url)[-1].split("?")[0])))
    page.on("dialog", lambda dialog: dialog.accept())

    # 上傳人已帶入登入者；選檔後出現檔案預覽
    assert page.locator("#upl-uploader").input_value()
    page.locator("#upl-file-input").set_input_files(LOGO)
    assert page.locator("#upl-file-preview").is_visible() and not page.locator("#upl-drop").is_visible()
    page.locator("#upl-note").fill("視覺測試備註")
    page.get_by_role("button", name="⬆️ 確認上傳").click()
    _wait_toast(page, "✅ 上傳成功")
    page.wait_for_function("() => document.querySelectorAll('.upl-report-card').length > 0")
    assert ("POST", api) in requests
    assert page.locator("#upl-note").input_value() == ""
    assert page.locator("#upl-drop").is_visible()
    card = page.locator(".upl-report-card", has_text="logo-topbar.png").first
    card.locator("summary").click()
    assert card.locator(".upl-note-cell").inner_text() == "視覺測試備註"

    # 編輯備註（同窗 modal）
    card.get_by_role("button", name="✏️ 編輯").click()
    page.locator("#upl-edit-note").fill("改過的備註")
    page.locator("[data-upl-edit-save]").click()
    _wait_toast(page, "✅ 報表已更新")
    assert ("PATCH", api + "/" + card.locator("img").get_attribute("src").split("/")[-2]) in requests
    card = page.locator(".upl-report-card", has_text="logo-topbar.png").first
    card.locator("summary").click()
    assert card.locator(".upl-note-cell").inner_text() == "改過的備註"

    # 圖片縮圖直接開預覽
    card.locator("img.upl-report-thumb").click()
    assert page.locator("#upl-overlay").is_visible()
    assert page.locator("#upl-preview-body img").get_attribute("src").startswith(api + "/")
    page.locator("#upl-overlay").get_by_role("button", name="關閉").first.click()
    assert not page.locator("#upl-overlay").is_visible()

    # 刪除（二次確認）
    count = page.locator(".upl-report-card").count()
    card.get_by_role("button", name="🗑 刪除").click()
    _wait_toast(page, "🗑 已刪除")
    page.wait_for_function("n => document.querySelectorAll('.upl-report-card').length === n", arg=count - 1)
    assert all(url.startswith(api) or url.startswith("/api/auth") for _m, url in requests if url.startswith("/api/")), requests
