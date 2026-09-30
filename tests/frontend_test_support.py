"""Shared paths and readers for frontend contract tests."""

import os
import re

# 專案根目錄
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# 靜態資源目錄
STATIC = os.path.join(BASE_DIR, "static")


def js_modules(*rels: str) -> tuple:
    """多個 ES module（static/js 之下的相對路徑）；read() 會依序串接。
    issue #39：原本一個大檔拆成多個模組後，原檔的原始碼契約改讀這組模組。"""
    return tuple(os.path.join(STATIC, "js", *rel.split("/")) for rel in rels)


# 待測：index.html
INDEX = os.path.join(STATIC, "index.html")
# 待測：login.html
LOGIN = os.path.join(STATIC, "login.html")
# 待測：共用樣式（CSS 架構重構 P3：原 style.core.css 拆成 1-base / 2-layout / 3-components）
SHARED_CSS_DIRS = ("1-base", "2-layout", "3-components")
CSS_CAL = os.path.join(STATIC, "css", "4-pages", "calendar.css")
CSS_INVENTORY = os.path.join(STATIC, "css", "4-pages", "inventory.css")
CSS_KIT = os.path.join(STATIC, "css", "4-pages", "kit.css")
CSS_STOCKTAKE = os.path.join(STATIC, "css", "4-pages", "stocktake.css")
CSS_STOCKOUT = os.path.join(STATIC, "css", "4-pages", "stockout.css")
CSS_INVENTORY_LOCATIONS = os.path.join(STATIC, "css", "3-components", "location-editor.css")  # P5：跨頁共用的位置編輯器
# CSS 架構重構 P4：待領出頁、異常清單 Dialog、簽名報表 / 報價單共用外殼自原檔抽出
CSS_PREPARED = os.path.join(STATIC, "css", "4-pages", "prepared.css")
CSS_STATUS_LIST = os.path.join(STATIC, "css", "3-components", "status-list.css")
CSS_PANEL = os.path.join(STATIC, "css", "3-components", "panel.css")
# 待測：登入狀態 / 頁面可用性（原 auth.js → core/session.js；使用者選單與角色畫面控制在 features/shell/app.js）
AUTH_JS = js_modules("core/session.js", "features/shell/app.js", "features/shell/page-scope.js")
# 待測：整組頁（原 render/kits.js）
KITS_RENDER_JS = js_modules("features/kits/page.js", "features/kits/status.js", "features/kits/component-rows.js")
# 待測：整組 modal（原 modals/kit.js）
KIT_MODAL_JS = js_modules("features/kits/kit-modal.js", "features/kits/component-rows.js", "features/kits/state.js")
# 待測：庫存頁（原 render/inventory.js，issue #39 依職責拆成多個模組）
INVENTORY_RENDER_JS = js_modules("features/inventory/filters.js", "core/search.js", "features/inventory/list.js", "features/inventory/status.js", "features/inventory/actions.js", "features/inventory/adjust.js", "features/inventory/batch-location.js", "core/state.js")
# 待測：待領出頁（原 render/prepared.js）
PREPARED_RENDER_JS = js_modules("features/prepared/page.js", "features/prepared/sheet.js")
# 待測：已領出頁（原 render/stockout.js）
STOCKOUT_RENDER_JS = js_modules("features/stockout/page.js", "features/stockout/sheet.js")
# 待測：盤點頁（原 render/stocktake.js）
STOCKTAKE_JS = os.path.join(STATIC, "js", "features", "stocktake", "page.js")
# 待測：core/utils.js
UTILS_JS = os.path.join(STATIC, "js", "core", "utils.js")
# 待測：原 api.js / app.js / bottomsheet.js / globals.js（2026-08-12 全專案 JS 完整性補強；issue #39 後為下列模組）
API_JS = js_modules("features/shell/data-refresh.js", "core/data.js", "features/inventory/adjust.js")
APP_JS = js_modules("features/shell/app.js", "features/shell/page-scope.js", "features/shell/navigation.js")
BOTTOMSHEET_JS = os.path.join(STATIC, "js", "core", "bottomsheet.js")
GLOBALS_JS = js_modules("core/state.js", "features/inventory/state.js", "features/stockout/state.js", "features/stocktake/state.js", "features/kits/state.js", "features/calendar/state.js", "features/work-progress/state.js")
NOTIFICATIONS_JS = os.path.join(STATIC, "js", "features", "notifications", "center.js")
# 待測：modals/*（2026-08-12 全專案 JS 完整性補強）
ADD_JS = os.path.join(STATIC, "js", "features", "inventory", "add-modal.js")
CHANGEPW_JS = os.path.join(STATIC, "js", "features", "account", "change-password.js")
EDIT_JS = js_modules("features/inventory/edit-modal.js", "core/state.js")
EXPIRY_JS = os.path.join(STATIC, "js", "features", "account", "password-expiry.js")
PHOTO_JS = js_modules("features/inventory/photo.js", "features/inventory/edit-modal.js")
STOCKOUT_MODAL_JS = os.path.join(STATIC, "js", "features", "stockout", "modals.js")
# 待測：components/card.js
CARD_JS = os.path.join(STATIC, "js", "components", "card.js")
# 待測：行事曆畫面（原 render/calendar.js，2026-08-13）
CALENDAR_RENDER_JS = js_modules("features/calendar/format.js", "features/calendar/search.js", "features/calendar/page.js", "features/calendar/view.js", "features/calendar/sync-status.js", "features/calendar/state.js")
# 待測：每日簽名報表（2026-09-07；demo 版面責任分層防回歸）
SIGNED_REPORTS_RENDER_JS = os.path.join(STATIC, "js", "features", "upload-list", "signed-reports.js")
SIGNED_REPORTS_CSS = os.path.join(STATIC, "css", "4-pages", "signed-reports.css")
QUOTATION_UPLOAD_RENDER_JS = os.path.join(STATIC, "js", "features", "upload-list", "quotation-upload.js")
QUOTATION_UPLOAD_CSS = os.path.join(STATIC, "css", "4-pages", "quotation-upload.css")
# 待測：兩頁共用的檔案上傳清單元件（issue #39 第 2 項合併）
UPLOAD_LIST_RENDER_JS = os.path.join(STATIC, "js", "features", "upload-list", "upload-list.js")
UPLOAD_LIST_CSS = os.path.join(STATIC, "css", "3-components", "upload-list.css")
UPLOAD_LIST_RUNTIME_JS = os.path.join(BASE_DIR, "tests", "upload_list_runtime.test.js")
# 待測：報價單歷史清單（2026-09-15；電腦版全展開不分頁防回歸）
QUOTATION_RENDER_JS = js_modules("features/quotation/page.js", "features/quotation/mode-tabs.js")
QUOTATION_HISTORY_PAGINATION_JS = os.path.join(BASE_DIR, "tests", "quotation_history_pagination.test.js")
QUOTATION_PERMISSION_RUNTIME_JS = os.path.join(BASE_DIR, "tests", "quotation_permission_runtime.test.js")
PDF_PREVIEW_BUTTON_JS = os.path.join(BASE_DIR, "tests", "pdf_preview_button.test.js")
# 待測：零用金月報（2026-09-12）
PETTY_CASH_RENDER_JS = js_modules("features/petty-cash/page.js", "features/petty-cash/state.js")
PETTY_CASH_CAPABILITY_RUNTIME_JS = os.path.join(BASE_DIR, "tests", "petty_cash_capability_runtime.test.js")
PETTY_CASH_UNPRICED_RUNTIME_JS = os.path.join(BASE_DIR, "tests", "petty_cash_unpriced_runtime.test.js")
SIGNED_REPORT_CAPABILITY_RUNTIME_JS = os.path.join(BASE_DIR, "tests", "signed_report_capability_runtime.test.js")
WORK_PROGRESS_PAGE_VISIBILITY_RUNTIME_JS = os.path.join(BASE_DIR, "tests", "work_progress_page_visibility_runtime.test.js")
TAB_LIFECYCLE_RUNTIME_JS = os.path.join(BASE_DIR, "tests", "tab_lifecycle_runtime.test.js")
TAB_ASYNC_LIFECYCLE_RUNTIME_JS = os.path.join(BASE_DIR, "tests", "tab_async_lifecycle.test.js")
CALENDAR_RUNTIME_JS = os.path.join(BASE_DIR, "tests", "calendar_runtime.test.js")
QUOTATION_UPLOAD_CAPABILITY_RUNTIME_JS = os.path.join(BASE_DIR, "tests", "quotation_upload_capability_runtime.test.js")
PETTY_CASH_MODAL_JS = os.path.join(STATIC, "js", "features", "petty-cash", "report-modal.js")
PETTY_CASH_CSS = os.path.join(STATIC, "css", "4-pages", "petty-cash.css")
PETTY_CASH_REPORTS_CSS = os.path.join(STATIC, "css", "4-pages", "petty-cash-reports.css")
PETTY_CASH_ENGINEERING_CSS = os.path.join(STATIC, "css", "4-pages", "petty-cash-engineering.css")
PETTY_CASH_ENGINEERING_MODAL_JS = os.path.join(STATIC, "js", "features", "petty-cash", "engineering-modal.js")
SETTINGS_HTML = os.path.join(STATIC, "settings.html")
SETTINGS_JS = js_modules("features/settings/units.js", "features/settings/petty-options.js", "features/settings/gcal.js", "features/settings/page.js", "features/settings/cabinets.js")
# 待測：行事曆派工 / 設定 modal（2026-08-16 拆檔）
CALENDAR_MODAL_JS = os.path.join(STATIC, "js", "features", "calendar", "appt-modal.js")
CALENDAR_SETTINGS_JS = os.path.join(STATIC, "js", "features", "calendar", "settings-modal.js")


_PAGE_SCOPE_RE = re.compile(r'(body)?(?:\[data-page="[\w-]+"\]|:is\((?:\[data-page="[\w-]+"\],?)+\)) ?')


def unscope_css(css: str) -> str:
    """去掉頁面範圍前綴（[data-page="x"] / :is(...) / body[data-page="x"]），讓舊測試只比對宣告內容。
    範圍本身由 tests/test_css_architecture.py 嚴格檢查。"""
    return _PAGE_SCOPE_RE.sub(lambda m: m.group(1) or "", css)


def read(p) -> str:
    """讀檔 helper（UTF-8）；CSS 會先去掉頁面範圍前綴（見 unscope_css）；js_modules() 的多個檔依序串接"""
    if isinstance(p, tuple):
        return "\n".join(read(part) for part in p)
    with open(p, encoding="utf-8") as fh:
        text = fh.read()
    return unscope_css(text) if str(p).endswith(".css") else text


_IMPORT_RE = re.compile(r"^import .* from '([^']+)';$", re.M)
_ENTRY_RE = re.compile(r'<script type="module" src="/static/js/([^"?]+)')


def page_modules(html_path) -> set:
    """HTML 的 <script type="module"> 進入點與它 import 到的所有模組（static/js 之下的相對路徑）。
    issue #39：頁面改成單一 ES module 進入點後，「頁面有載入某支 JS」改由 import 關係判斷。"""
    pending = _ENTRY_RE.findall(read(html_path))
    seen = set()
    while pending:
        rel = pending.pop()
        if rel in seen:
            continue
        seen.add(rel)
        base = os.path.dirname(rel)
        for spec in _IMPORT_RE.findall(read(os.path.join(STATIC, "js", *rel.split("/")))):
            pending.append(os.path.normpath(os.path.join(base, spec)).replace(os.sep, "/"))
    return seen


def read_page_served(html_path: str) -> str:
    """HTML 原文並展開 <!-- include: name -->（直接呼叫 production 的 main._expand_includes，不在測試裡再寫一份）；
    檢查「頁面實際載入了哪些 CSS」時用這個，不要直接讀磁碟上的頁面檔（共用 <link> 在 partial 裡）。"""
    import main as app_main  # 延後匯入：只有這個 helper 需要，其餘純檔案讀取的測試不必載入 app
    return app_main._expand_includes(read(html_path))


def read_shared_css() -> str:
    """全部共用樣式（base / layout / components）依檔名順序串接。"""
    parts = []
    for directory in SHARED_CSS_DIRS:
        folder = os.path.join(STATIC, "css", directory)
        for name in sorted(os.listdir(folder)) if os.path.isdir(folder) else []:
            if name.endswith(".css"):
                parts.append(read(os.path.join(folder, name)))
    return "\n".join(parts)


def read_page_with_css(html_path: str) -> str:
    """HTML 原文 + 它載入的頁面樣式檔（CSS 架構重構 P2：settings / permissions / login 內嵌 <style> 已搬到 css/4-pages/）"""
    html = read(html_path)
    css = [read(os.path.join(STATIC, "css", rel)) for rel in re.findall(r'href="/static/css/(4-pages/[^"?]+\.css)', html)]
    return "\n".join([html, *css])

def read_petty_cash_css() -> str:
    """零用金三層 CSS 合併內容（僅供既有行為測試）。"""
    return read(PETTY_CASH_CSS) + read(PETTY_CASH_REPORTS_CSS) + read(PETTY_CASH_ENGINEERING_CSS)


def read_css_all() -> str:
    """全部 CSS（原 style.css 內容已分散到共用樣式與各頁檔案；CSS 架構重構 P3）"""
    parts = [read_shared_css()]
    for directory in ("4-pages", "5-utilities"):
        folder = os.path.join(STATIC, "css", directory)
        # git 不追蹤空目錄：某層暫時沒有檔案時目錄可能不存在（P5 曾因此在 CI 失敗）
        for name in sorted(os.listdir(folder)) if os.path.isdir(folder) else []:
            if name.endswith(".css"):
                parts.append(read(os.path.join(folder, name)))
    return "\n".join(parts)
