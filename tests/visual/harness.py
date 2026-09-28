# -*- coding: utf-8 -*-
"""Visual / 瀏覽器測試共用 harness（Playwright）。

提供：
  - playwright_available()：沒裝 Playwright 套件時回傳 False，讓測試自動略過
  - start_server()：以子行程啟動隔離的伺服器（暫存 DB + uploads），回傳 LiveServer
  - seed()：建立固定的示範資料（品項 / 整組 / 待領出 / 已領出 / 派工 / 報價單）
  - launch_browser()：啟動 Chromium；找不到 Playwright 自帶瀏覽器時改用
    PLAYWRIGHT_CHROMIUM_EXECUTABLE 或 /opt/pw-browsers/chromium，仍找不到回傳 None
  - new_page()：已登入、凍結時間、關閉動畫的頁面

安裝：uv sync --group dev --group visual && uv run playwright install chromium
"""
import json
import os
import shutil
import socket
import sqlite3
import subprocess
import sys
import time
import urllib.request
from dataclasses import dataclass
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVE_SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "serve.py")

# 截圖與 computed-style 測試使用固定時間，避免「今天」高亮與月份切換造成差異
FROZEN_NOW = datetime(2026, 9, 15, 10, 0, 0)
DESKTOP = {"width": 1440, "height": 900}
MOBILE = {"width": 390, "height": 844}

# 關閉動畫 / 游標閃爍，讓截圖穩定
_STABILIZE_CSS = (
    "*,*::before,*::after{transition:none!important;animation:none!important;"
    "caret-color:transparent!important;scroll-behavior:auto!important}"
)
_FALLBACK_EXECUTABLES = ("/opt/pw-browsers/chromium",)
# 本機伺服器一律直連，不走環境變數設定的 HTTP proxy
_NO_PROXY = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def playwright_available() -> bool:
    """Playwright Python 套件是否已安裝（visual 群組）。"""
    try:
        import playwright.sync_api  # noqa: F401
    except ImportError:
        return False
    return True


@dataclass
class LiveServer:
    """執行中的隔離伺服器。"""

    base_url: str
    cookie: str
    token: str
    db_path: str
    proc: subprocess.Popen

    def api(self, method: str, path: str, payload=None):
        """以 admin session 呼叫 API，回傳解析後的 JSON；非 2xx 直接拋錯。"""
        data = None if payload is None else json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(self.base_url + path, data=data, method=method)
        req.add_header("Cookie", f"{self.cookie}={self.token}")
        if data is not None:
            req.add_header("Content-Type", "application/json")
        with _NO_PROXY.open(req, timeout=15) as resp:
            body = resp.read()
        return json.loads(body) if body else None

    def snapshot_db(self, dest: str) -> None:
        """以 SQLite backup API 複製目前 DB（伺服器執行中也安全）。"""
        src = sqlite3.connect(self.db_path)
        dst = sqlite3.connect(dest)
        try:
            src.backup(dst)
        finally:
            dst.close()
            src.close()

    def stop(self) -> None:
        """終止伺服器子行程。"""
        self.proc.terminate()
        try:
            self.proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.proc.kill()


def _free_port() -> int:
    """向 OS 要一個可用的本機 port。"""
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def start_server(workdir: str, db_template: str | None = None) -> LiveServer:
    """在 workdir 內建立隔離 DB 並啟動伺服器；db_template 存在時先複製它（重現同一份資料）。"""
    os.makedirs(workdir, exist_ok=True)
    db_path = os.path.join(workdir, "visual.db")
    uploads = os.path.join(workdir, "uploads")
    token_file = os.path.join(workdir, "token.txt")
    for path in (db_path, token_file):
        if os.path.exists(path):
            os.remove(path)
    if db_template and os.path.exists(db_template):
        shutil.copyfile(db_template, db_path)
    port = _free_port()
    env = {k: v for k, v in os.environ.items() if k != "PYTHONPATH"}
    proc = subprocess.Popen(
        [sys.executable, SERVE_SCRIPT, "--db", db_path, "--uploads", uploads,
         "--port", str(port), "--token-file", token_file],
        cwd=ROOT, env=env,
    )
    base_url = f"http://127.0.0.1:{port}"
    deadline = time.time() + 60
    while time.time() < deadline:
        if proc.poll() is not None:
            raise RuntimeError(f"visual server exited early (code {proc.returncode})")
        try:
            with _NO_PROXY.open(base_url + "/health", timeout=2):
                break
        except OSError:
            time.sleep(0.2)
    else:
        proc.kill()
        raise RuntimeError("visual server did not become healthy within 60s")
    with open(token_file, encoding="utf-8") as fh:
        auth = json.load(fh)
    return LiveServer(base_url=base_url, cookie=auth["cookie"], token=auth["token"],
                      db_path=db_path, proc=proc)


def seed(server: LiveServer) -> dict:
    """建立固定示範資料；回傳後續情境需要的 id。"""
    def item(name, brand, code, site, category, stocks, low_stock=0, unit="個"):
        return server.api("POST", "/api/items", {
            "name": name, "brand": brand, "code": code, "site": site, "unit": unit,
            "category": category, "low_stock": low_stock, "stocks": stocks,
        })["id"]

    ids = {}
    ids["item_a"] = item("分離式冷氣遙控器", "大金", "ARC-480", "office", "遙控器",
                         [{"location": "A櫃-1", "qty": 12, "note": "原廠"},
                          {"location": "B櫃-3", "qty": 4, "note": ""}], low_stock=5)
    ids["item_b"] = item("銅管 2分3分", "國產", "CU-23", "office", "管材",
                         [{"location": "C櫃-2", "qty": 2, "note": "剩餘料"}], low_stock=5, unit="支")
    ids["item_c"] = item("排水泵浦", "日立", "DP-110", "office", "電子零件",
                         [{"location": "A櫃-4", "qty": 0, "note": ""}], low_stock=1)
    ids["item_d"] = item("保溫棉", "國產", "INS-9", "warehouse", "耗材",
                         [{"location": "倉庫-後排", "qty": 40, "note": "整箱"}], unit="捲")
    ids["kit"] = server.api("POST", "/api/kits", {
        "name": "標準安裝包", "brand": "自組", "code": "KIT-01", "site": "office",
        "items": [{"item_id": ids["item_a"], "qty": 1}, {"item_id": ids["item_b"], "qty": 2}],
        "locations": [{"cabinet": "A櫃", "position": "上層", "note": "常用"}],
        "note": "",
    })["id"]
    server.api("POST", f"/api/items/{ids['item_a']}/prepare", {"qty": 2, "note": "王先生案場"})
    server.api("POST", "/api/stockout", {"item_id": ids["item_d"], "qty": 3,
                                         "destination": "台北信義案場", "note": ""})
    for date, client, start, end in (("2026-09-15", "陳小姐", "09:00", "11:00"),
                                     ("2026-09-16", "林先生", "13:30", "15:00"),
                                     ("2026-09-22", "大安社區", "", "")):
        server.api("POST", "/api/appointments", {"client_name": client, "address": "台北市",
                                                 "date": date, "start_time": start, "end_time": end})
    server.api("POST", "/api/quotations", {
        "quote_date": "2026-09-15", "customer_name": "範例客戶", "items": [
            {"item_name": "分離式冷氣安裝", "qty": 1, "unit": "式", "unit_price": 3500},
            {"item_name": "銅管", "specification": "2分3分", "qty": 5, "unit": "米", "unit_price": 450},
        ]})
    return ids


def launch_browser(playwright):
    """啟動 headless Chromium；都找不到時回傳 None（呼叫端決定 skip）。"""
    try:
        return playwright.chromium.launch()
    except Exception:  # noqa: BLE001 — Playwright 自帶瀏覽器未安裝
        pass
    candidates = [os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE", ""), *_FALLBACK_EXECUTABLES]
    for exe in candidates:
        if exe and os.path.exists(exe):
            return playwright.chromium.launch(executable_path=exe)
    return None


def new_page(browser, server: LiveServer, viewport: dict):
    """建立已登入（session cookie）、時間凍結、動畫關閉的頁面。"""
    context = browser.new_context(viewport=viewport, locale="zh-TW", timezone_id="Asia/Taipei",
                                  device_scale_factor=1)
    context.add_cookies([{"name": server.cookie, "value": server.token, "url": server.base_url}])
    page = context.new_page()
    page.clock.set_fixed_time(FROZEN_NOW)
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded',()=>{const s=document.createElement('style');"
        f"s.textContent={json.dumps(_STABILIZE_CSS)};document.head.appendChild(s);}});"
    )
    return page


def open_tab(page, server: LiveServer, tab: str) -> None:
    """開主頁並切到指定頁籤，等資料載入完成。"""
    page.goto(f"{server.base_url}/?tab={tab}&site=office&month=2026-09")
    page.wait_for_load_state("networkidle")
    page.evaluate("t => { if (window.currentTab !== t) switchTab(t); }", tab)
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(150)


# ---------- CSS 檔案歸屬（外洩偵測用） ----------
# 值為允許使用該檔規則的頁面集合；None 代表全域檔（base / layout / components）。
# 重構期間檔名會變動，新結構一律以目錄判斷：4-pages/<page>.css 屬於 <page>。
LEGACY_CSS_OWNERS = {
    "style.core.css": None,
    "style.performance.css": None,
    "style.calendar.css": ["calendar"],
    "style.signed-reports.css": ["signed-reports"],
    "style.work-progress.css": ["work-progress"],
    "style.quotation.css": ["quotation", "quotation-upload"],
    "style.quotation-upload.css": ["quotation-upload"],
    "style.petty-cash.css": ["petty-cash"],
    "style.petty-cash-reports.css": ["petty-cash"],
    "style.petty-cash-engineering.css": ["petty-cash"],
    "style.inventory.css": ["inventory"],
    "style.inventory-locations.css": ["inventory"],
    "style.kit.css": ["kit"],
    "style.stocktake.css": ["stocktake"],
    "style.stockout.css": ["stockout"],
}


def css_owners(css_files):
    """把 /static/css/ 下的相對路徑對應到允許頁面清單（None = 全域）。"""
    owners = {}
    for rel in css_files:
        if rel in LEGACY_CSS_OWNERS:
            owners[rel] = LEGACY_CSS_OWNERS[rel]
        elif rel.startswith("4-pages/"):
            owners[rel] = [os.path.basename(rel)[: -len(".css")]]
        else:
            owners[rel] = None
    return owners


def find_css_leaks(page, page_name: str) -> list[dict]:
    """在目前頁面執行 leak_probe.js，回傳被別頁 CSS 命中的可見元素規則。"""
    files = page.evaluate(
        "() => [...document.styleSheets].map(s => s.href || '').filter(h => h.includes('/static/css/'))"
        ".map(h => h.split('?')[0].split('/static/css/')[1])"
    )
    owners = css_owners(files)
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "leak_probe.js"), encoding="utf-8") as fh:
        script = fh.read()
    return page.evaluate(script, {"ownerMap": owners, "page": page_name})


# ---------- 外洩偵測情境 ----------
# (情境 id, 頁面歸屬, 頁籤, 開啟後執行的 JS)。頁面歸屬 = 這個畫面屬於哪一頁（決定哪些 CSS 檔可用）。
LEAK_SCENARIOS = [
    ("inventory", "inventory", "inventory", None),
    ("inventory-table", "inventory", "inventory", "setInventoryView('table')"),
    ("prepared", "prepared", "prepared", None),
    ("stockout", "stockout", "stockout", None),
    ("stocktake", "stocktake", "stocktake", None),
    ("kit", "kit", "kit", None),
    ("calendar", "calendar", "calendar", None),
    ("work-progress", "work-progress", "work-progress", None),
    ("signed-reports", "signed-reports", "signed-reports", None),
    ("quotation", "quotation", "quotation", None),
    ("quotation-upload", "quotation-upload", "quotation", "quoteSwitchMode('upload')"),
    ("petty-cash", "petty-cash", "petty-cash", None),
    ("modal-add-item", "inventory", "inventory", "openAddModal()"),
    ("modal-edit-item", "inventory", "inventory", "openEditModal(1)"),
    ("modal-out", "inventory", "inventory", "openOutModal(1)"),
    ("modal-prepare", "inventory", "inventory", "openPrepareModal(1)"),
    ("modal-transfer", "inventory", "inventory", "openTransferModal(1)"),
    ("modal-kit", "kit", "kit", "openKitModal()"),
    ("modal-kit-prepare", "kit", "kit", "openKitPrepareModal(1, '標準安裝包')"),
    ("modal-petty-cash", "petty-cash", "petty-cash", "pcOpenReportModal()"),
    ("modal-petty-cash-engineering", "petty-cash", "petty-cash", "pcOpenEngineeringModal()"),
]
KNOWN_LEAKS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "known_css_leaks.json")


def run_action(page, action: str | None) -> None:
    """在頁面執行情境 JS（可為 async），並等待畫面穩定。"""
    if not action:
        return
    page.evaluate(f"async () => {{ await ({action}); }}")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(200)


def scenario_leaks(page, server: LiveServer, owner: str, tab: str, action: str | None) -> list[str]:
    """開啟情境並回傳 'css 檔 | selector' 形式的外洩清單（已排序）。"""
    open_tab(page, server, tab)
    run_action(page, action)
    return sorted(f"{x['file']} | {x['selector']}" for x in find_css_leaks(page, owner))
