# -*- coding: utf-8 -*-
"""CSS 重構用截圖比對工具（不是 pytest 測試；截圖不進 repo）。

用法：
    # 1) 改 CSS 前建立基準（同時保存種子 DB，之後每次都用同一份資料）
    uv run --group visual python tests/visual/snapshot.py capture tests/visual/_baseline
    # 2) 每次修改後擷取並比對
    uv run --group visual python tests/visual/snapshot.py capture tests/visual/_current \\
        --db-template tests/visual/_baseline/seed.db
    uv run --group visual python tests/visual/snapshot.py compare tests/visual/_baseline tests/visual/_current

外洩清單（CSS 重構每縮小一次就要更新）：
    uv run --group visual python tests/visual/snapshot.py leaks

compare 會把有差異的情境列出並在 tests/visual/_diff/ 輸出紅色標示差異圖；
全部一致時 exit code 0，有差異時 exit code 1。

截圖跟作業系統字型有關，只能在同一台機器上比對。
"""
import argparse
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import harness  # noqa: E402

# (情境名稱, 頁籤 / 頁面, 開啟後要執行的 JS)；頁籤名稱以 "/" 開頭代表獨立 HTML 頁。
# 外洩偵測的情境全部沿用，再加上只需要截圖的畫面。
SCENARIOS = [(sid, tab, action) for sid, _owner, tab, action in harness.LEAK_SCENARIOS] + [
    ("modal-add-item-from-kit-tab", "kit", "openAddModal()"),
    ("modal-changepw", "inventory", "openChangePwModal()"),
    ("menu-avatar", "inventory", "toggleAvatarMenu()"),
    ("menu-notifications", "inventory", "toggleNotif()"),
    ("menu-sidebar", "inventory", "openSidebar()"),
    ("page-settings", "/settings.html", None),
    ("page-permissions", "/permissions.html", None),
    ("page-login", "/login.html", None),
    # P7.5 按鈕 / chip 統一：多開幾個 modal / 設定面板，讓截圖涵蓋更多按鈕
    ("modal-qty", "inventory", "openQtyDialog(1, 'add')"),
    ("modal-expiry", "inventory", "openExpiryModal()"),
    ("modal-inventory-export", "inventory", "openInventoryExportDialog()"),
    ("modal-prepared-nonstock", "prepared", "openNonStockPrepareModal()"),
    ("modal-stockout-nonstock", "stockout", "openNonStockOutModal()"),
    ("modal-calendar-appt", "calendar", "calOpenAppt()"),
    ("modal-calendar-settings", "calendar", "calOpenSettings()"),
    ("modal-petty-cash-entry", "petty-cash", "pcOpenReportModal().then(() => pcOpenEntryModal())"),
    ("page-settings-cabinets", "/settings.html", "settingsSwitch('cabinets')"),
    ("page-settings-gcal", "/settings.html", "settingsSwitch('gcal')"),
    ("page-settings-petty-cash", "/settings.html", "settingsSwitch('petty-cash')"),
    ("page-settings-pw", "/settings.html", "settingsSwitch('pw')"),
    ("page-permissions-add-user", "/permissions.html", "openAddUserModal()"),
    ("page-permissions-account", "/permissions.html", "switchTab('account')"),
]
VIEWPORTS = {"desktop": harness.DESKTOP, "mobile": harness.MOBILE}


def capture(out_dir: str, db_template: str | None) -> int:
    """啟動隔離伺服器，依 SCENARIOS × VIEWPORTS 截圖到 out_dir。"""
    from playwright.sync_api import sync_playwright

    os.makedirs(out_dir, exist_ok=True)
    work = tempfile.mkdtemp(prefix="hvac-visual-")
    server = harness.start_server(work, db_template)
    failures = []
    try:
        if not (db_template and os.path.exists(db_template)):
            harness.seed(server)
            server.snapshot_db(os.path.join(out_dir, "seed.db"))
        with sync_playwright() as pw:
            browser = harness.launch_browser(pw)
            if browser is None:
                print("找不到 Chromium：請執行 uv run playwright install chromium")
                return 2
            for vp_name, vp in VIEWPORTS.items():
                for name, target, action in SCENARIOS:
                    page = harness.new_page(browser, server, vp)
                    errors = []
                    page.on("pageerror", lambda e, errors=errors: errors.append(str(e)))
                    try:
                        if target.startswith("/"):
                            if target == "/login.html":
                                page.context.clear_cookies()
                            page.goto(server.base_url + target)
                            page.wait_for_load_state("networkidle")
                        else:
                            harness.open_tab(page, server, target)
                        harness.run_action(page, action)
                        # 頁籤截整頁；modal / 選單是 fixed 疊層，只截可視範圍
                        full = not name.startswith(("modal-", "menu-"))
                        page.screenshot(path=os.path.join(out_dir, f"{name}--{vp_name}.png"), full_page=full)
                    except Exception as exc:  # noqa: BLE001 — 一個情境失敗不影響其他情境
                        failures.append(f"{name}--{vp_name}: {exc}")
                    if errors:
                        failures.append(f"{name}--{vp_name}: JS error {errors}")
                    page.context.close()
            browser.close()
    finally:
        server.stop()
    for line in failures:
        print("FAIL", line)
    print(f"captured {len(SCENARIOS) * len(VIEWPORTS)} scenarios → {out_dir}")
    return 1 if failures else 0


def compare(base_dir: str, cur_dir: str, diff_dir: str, tolerance: float) -> int:
    """逐張比對；差異像素比例超過 tolerance 視為不同，輸出差異圖。"""
    from PIL import Image, ImageChops

    os.makedirs(diff_dir, exist_ok=True)
    names = sorted(n for n in os.listdir(base_dir) if n.endswith(".png"))
    changed = []
    for name in names:
        cur_path = os.path.join(cur_dir, name)
        if not os.path.exists(cur_path):
            changed.append((name, "missing"))
            continue
        a = Image.open(os.path.join(base_dir, name)).convert("RGB")
        b = Image.open(cur_path).convert("RGB")
        if a.size != b.size:
            changed.append((name, f"size {a.size} → {b.size}"))
            continue
        diff = ImageChops.difference(a, b).convert("L").point(lambda v: 255 if v > 16 else 0)
        ratio = diff.histogram()[255] / (a.size[0] * a.size[1])
        if ratio > tolerance:
            overlay = b.copy()
            overlay.paste((255, 0, 0), mask=diff)
            overlay.save(os.path.join(diff_dir, name))
            changed.append((name, f"{ratio:.3%} pixels"))
    for name, why in changed:
        print("DIFF", name, why)
    print(f"{len(names) - len(changed)}/{len(names)} identical")
    return 1 if changed else 0


def update_leaks(db_template: str | None) -> int:
    """重新產生 known_css_leaks.json（外洩清單只能縮小；新增外洩代表有新的跨頁樣式衝突）。"""
    import json

    from playwright.sync_api import sync_playwright

    work = tempfile.mkdtemp(prefix="hvac-visual-")
    server = harness.start_server(work, db_template)
    result = {}
    try:
        if not (db_template and os.path.exists(db_template)):
            harness.seed(server)
        with sync_playwright() as pw:
            browser = harness.launch_browser(pw)
            if browser is None:
                print("找不到 Chromium：請執行 uv run playwright install chromium")
                return 2
            for vp_name, vp in VIEWPORTS.items():
                for sid, owner, tab, action in harness.LEAK_SCENARIOS:
                    page = harness.new_page(browser, server, vp)
                    leaks = harness.scenario_leaks(page, server, owner, tab, action)
                    if leaks:
                        result[f"{sid}@{vp_name}"] = leaks
                    page.context.close()
            browser.close()
    finally:
        server.stop()
    with open(harness.KNOWN_LEAKS_PATH, "w", encoding="utf-8") as fh:
        json.dump(result, fh, ensure_ascii=False, indent=2, sort_keys=True)
        fh.write("\n")
    total = sum(len(v) for v in result.values())
    print(f"{total} leak entries in {len(result)} scenarios → {harness.KNOWN_LEAKS_PATH}")
    return 0


def main() -> int:
    """CLI 入口。"""
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)
    cap = sub.add_parser("capture")
    cap.add_argument("out_dir")
    cap.add_argument("--db-template")
    cmp_ = sub.add_parser("compare")
    cmp_.add_argument("base_dir")
    cmp_.add_argument("cur_dir")
    cmp_.add_argument("--diff-dir", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "_diff"))
    cmp_.add_argument("--tolerance", type=float, default=0.001)
    leaks = sub.add_parser("leaks", help="重新產生 known_css_leaks.json")
    leaks.add_argument("--db-template")
    args = parser.parse_args()
    if args.cmd == "leaks":
        return update_leaks(args.db_template)
    if args.cmd == "capture":
        return capture(args.out_dir, args.db_template)
    return compare(args.base_dir, args.cur_dir, args.diff_dir, args.tolerance)


if __name__ == "__main__":
    sys.exit(main())
