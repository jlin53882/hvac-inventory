# -*- coding: utf-8 -*-
"""原始 ES modules 的真實瀏覽器 smoke test（HVAC_FRONTEND_SOURCE=1，issue #39 / PR #42）。

其他 visual 測試載入的是 Vite 建置結果（static/dist）；esm_link.test.js 只做 link、不 evaluate。
這裡另起一台 HVAC_FRONTEND_SOURCE=1 的伺服器，讓 Chromium 直接載入 /static/js/pages/*.js 與其 import 的
所有原始模組並實際執行，抓 module 解析失敗、循環 import 的 TDZ（Cannot access … before initialization）、
頂層副作用錯誤與 bootstrap 例外。每頁都驗證：
- 送出的 HTML 用原始進入點、沒有任何 /static/dist 資源
- 所有 /static/js 模組回應 200，沒有 request 失敗
- 沒有 pageerror、沒有 console.error
- 頁面命名空間存在，且畫面已由 JS 掛載（不只 HTML 200）
"""
import pytest

import harness

_MAIN_TABS = ["inventory", "prepared", "stockout", "stocktake", "kit", "calendar",
              "work-progress", "signed-reports", "quotation", "petty-cash"]


@pytest.fixture(scope="module")
def source_server(tmp_path_factory, live_server):
    """HVAC_FRONTEND_SOURCE=1 的隔離伺服器（沿用 live_server 的種子資料）。"""
    workdir = tmp_path_factory.mktemp("visual-source-server")
    template = str(workdir / "template.db")
    live_server.snapshot_db(template)
    server = harness.start_server(str(workdir / "run"), db_template=template,
                                  extra_env={"HVAC_FRONTEND_SOURCE": "1"})
    try:
        yield server
    finally:
        server.stop()


class _Watch:
    """收集頁面上的 JS 錯誤、console.error 與模組載入失敗。"""

    def __init__(self, page, allowed_console=()):
        self.errors = []
        self.js_responses = []
        # 瀏覽器自動要 /favicon.ico（專案沒有提供）與 JS 無關
        self.allowed_console = ("/favicon.ico", *allowed_console)
        page.on("pageerror", lambda e: self.errors.append(f"pageerror: {e}"))
        page.on("console", self._console)
        page.on("requestfailed", self._request_failed)
        page.on("response", self._response)

    def _request_failed(self, request):
        # app 以 AbortController 取消被新請求取代的 API 呼叫（切頁後立即重新整理資料）是預期行為；
        # 模組、樣式等其他資源失敗一律算錯
        if "/api/" in request.url and "ERR_ABORTED" in str(request.failure):
            return
        self.errors.append(f"requestfailed: {request.url} {request.failure}")

    def _console(self, msg):
        if msg.type != "error":
            return
        where = (msg.location or {}).get("url", "")
        if any(allowed in where for allowed in self.allowed_console):
            return
        self.errors.append(f"console.error: {msg.text} @ {where}")

    def _response(self, response):
        url = response.url
        if "/static/js/" in url or "/static/dist/" in url:
            self.js_responses.append((url, response.status))

    def assert_clean(self, label):
        assert not self.errors, f"{label}: {self.errors}"
        assert self.js_responses, f"{label}: 沒有載入任何 JS"
        dist = [url for url, _ in self.js_responses if "/static/dist/" in url]
        assert not dist, f"{label}: HVAC_FRONTEND_SOURCE=1 卻載入建置檔 {dist}"
        bad = [(url, status) for url, status in self.js_responses if status != 200]
        assert not bad, f"{label}: 模組載入失敗 {bad}"


def _open(browser, server, path, *, logged_in=True, allowed_console=()):
    if logged_in:
        page = harness.new_page(browser, server, harness.DESKTOP)
    else:
        context = browser.new_context(viewport=harness.DESKTOP, locale="zh-TW")
        page = context.new_page()
        page.add_init_script(harness._HVAC_HELPER)
    watch = _Watch(page, allowed_console)
    response = page.goto(server.base_url + path)
    assert response.status == 200, f"{path}: HTTP {response.status}"
    page.wait_for_load_state("networkidle")
    return page, watch


def _entry(page, name):
    html = page.content()
    assert f'src="/static/js/pages/{name}.js' in html, f"{name}: HTML 沒有改用原始進入點"
    assert "/static/dist/" not in html


def test_source_main_page_boots_and_mounts_every_tab(browser, source_server):
    page, watch = _open(browser, source_server, "/?tab=inventory&site=office&month=2026-09")
    try:
        _entry(page, "main")
        # 主頁載入的原始模組數（import closure）要和 ESM linker 看到的一致：少載代表某條 import 沒被瀏覽器解析到
        loaded = {url.split("/static/js/", 1)[1].split("?", 1)[0] for url, _ in watch.js_responses if "/static/js/" in url}
        assert len(loaded) == len(page.evaluate("Object.keys(window.__hvac)")) + 1, sorted(loaded)
        for ns, fn in (("Inventory", "openAddModal"), ("Calendar", "calChangeMonth"),
                       ("WorkProgress", "wprSubmit"), ("App", "switchTab")):
            assert page.evaluate(f"typeof window.{ns}.{fn}") == "function", ns
        state = "hvac('core/state.js').appState"
        assert page.evaluate(f"{state}.currentTab") == "inventory"
        assert page.evaluate(f"{state}.ALL_ITEMS.length") > 0, "庫存頁沒有載入資料"
        assert page.evaluate("document.getElementById('content').children.length") > 0, "庫存頁沒有掛載"
        for tab in _MAIN_TABS:
            page.evaluate("t => App.switchTab(t)", tab)
            page.wait_for_load_state("networkidle")
            page.wait_for_timeout(100)
            assert page.evaluate(f"{state}.currentTab") == tab
            assert page.evaluate("document.getElementById('content').children.length") > 0, f"{tab} 沒有掛載"

        # 來回切頁：切頁 port 與組裝層在多次往返後仍掛載正確頁面與頁面範圍
        for tab in ("inventory", "calendar", "prepared", "inventory"):
            page.evaluate("t => App.switchTab(t)", tab)
            page.wait_for_load_state("networkidle")
            page.wait_for_timeout(100)
            assert page.evaluate(f"{state}.currentTab") == tab
            assert page.evaluate("document.body.dataset.page") == tab
            assert page.evaluate("document.getElementById('content').children.length") > 0, f"{tab} 往返後沒有掛載"

        # feature 經 features/shell/navigation.js 的 port 切頁（通知中心、工作進度離開確認使用的路徑）
        page.evaluate("() => hvac('features/shell/navigation.js').navigateToTab('stocktake')")
        page.wait_for_load_state("networkidle")
        assert page.evaluate(f"{state}.currentTab") == "stocktake"
        assert page.evaluate("document.body.dataset.page") == "stocktake"

        # 資料重新整理：loadData 經 data-refresh 注入的畫面 hook 重建並重新掛載目前頁籤
        page.evaluate("t => App.switchTab(t)", "inventory")
        page.wait_for_load_state("networkidle")
        page.evaluate("() => hvac('features/shell/data-refresh.js').loadData()")
        page.wait_for_load_state("networkidle")
        assert page.evaluate(f"{state}.currentTab") == "inventory"
        assert page.evaluate(f"{state}.ALL_ITEMS.length") > 0
        assert page.evaluate("document.getElementById('content').children.length") > 0

        # 保留掛載的頁籤（DATA_REFRESH_PRESERVE_MOUNT_TABS）重新整理資料時不可重新掛載
        page.evaluate("t => App.switchTab(t)", "quotation")
        page.wait_for_load_state("networkidle")
        page.evaluate("() => { window.__mountedBefore = document.getElementById('content').firstElementChild; }")
        page.evaluate("() => hvac('features/shell/data-refresh.js').loadData()")
        page.wait_for_load_state("networkidle")
        assert page.evaluate("() => document.getElementById('content').firstElementChild === window.__mountedBefore"), \
            "報價單在資料重新整理後被重新掛載"
        watch.assert_clean("/")
    finally:
        page.context.close()


def test_source_settings_page_boots(browser, source_server):
    page, watch = _open(browser, source_server, "/settings.html")
    try:
        _entry(page, "settings")
        for ns, fn in (("Settings", "addCabinet"), ("Account", "cpwCheckStrength"), ("Auth", "logout")):
            assert page.evaluate(f"typeof window.{ns}.{fn}") == "function", ns
        assert page.evaluate("typeof window.__hvac") == "object"
        assert page.evaluate("document.getElementById('settingsChipBar').children.length") > 0, "設定頁分類沒有掛載"
        # 面板切換（settings/page.js 的啟動流程與各面板模組之間已無循環 import）
        for panel in ("cabinets", "gcal", "petty-cash", "pw", "units"):
            page.evaluate("p => Settings.settingsSwitch(p)", panel)
            page.wait_for_load_state("networkidle")
            shown = page.evaluate("""() => ['units', 'cabinets', 'gcal', 'petty-cash', 'pw']
                .filter(p => document.getElementById('panel-' + p).style.display !== 'none')""")
            assert shown == [panel], (panel, shown)
        assert page.evaluate("document.getElementById('panel-gcal').textContent.trim().length") > 0, "行事曆同步面板沒有內容"
        watch.assert_clean("/settings.html")
    finally:
        page.context.close()


def test_source_permissions_page_boots(browser, source_server):
    page, watch = _open(browser, source_server, "/permissions.html")
    try:
        _entry(page, "permissions")
        assert page.evaluate("typeof window.Perms.submitAddUser") == "function"
        assert page.evaluate("typeof window.__hvac") == "object"
        page.wait_for_function("document.getElementById('userList').children.length > 0")
        assert page.evaluate("document.getElementById('chipBar').children.length") > 0, "權限頁角色篩選沒有掛載"
        watch.assert_clean("/permissions.html")
    finally:
        page.context.close()


def test_source_login_page_boots(browser, source_server):
    # 未登入時頁面會先打 /api/auth/me 確認 session：401 是預期回應（瀏覽器會記成資源載入失敗），其餘 console.error 一律不允許
    page, watch = _open(browser, source_server, "/login.html", logged_in=False, allowed_console=("/api/auth/me",))
    try:
        _entry(page, "login")
        page.click("#loginBtn")
        assert page.evaluate("document.getElementById('errorMsg').textContent") == "請輸入帳號"
        assert page.evaluate("document.getElementById('errorBox').classList.contains('is-open')")
        watch.assert_clean("/login.html")
    finally:
        page.context.close()
