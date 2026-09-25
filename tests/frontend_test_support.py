"""Shared paths and readers for frontend contract tests."""

import os

# 專案根目錄
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# 靜態資源目錄
STATIC = os.path.join(BASE_DIR, "static")

# 待測：index.html
INDEX = os.path.join(STATIC, "index.html")
# 待測：login.html
LOGIN = os.path.join(STATIC, "login.html")
# 待測：style.css
CSS_CORE = os.path.join(STATIC, "css", "style.core.css")
CSS_CAL = os.path.join(STATIC, "css", "style.calendar.css")
CSS_INVENTORY = os.path.join(STATIC, "css", "style.inventory.css")
CSS_KIT = os.path.join(STATIC, "css", "style.kit.css")
CSS_STOCKTAKE = os.path.join(STATIC, "css", "style.stocktake.css")
CSS_STOCKOUT = os.path.join(STATIC, "css", "style.stockout.css")
CSS_INVENTORY_LOCATIONS = os.path.join(STATIC, "css", "style.inventory-locations.css")
# 待測：auth.js
AUTH_JS = os.path.join(STATIC, "js", "auth.js")
# 待測：render/kits.js
KITS_RENDER_JS = os.path.join(STATIC, "js", "render", "kits.js")
# 待測：modals/kit.js
KIT_MODAL_JS = os.path.join(STATIC, "js", "modals", "kit.js")
# 待測：render/inventory.js
INVENTORY_RENDER_JS = os.path.join(STATIC, "js", "render", "inventory.js")
# 待測：render/prepared.js
PREPARED_RENDER_JS = os.path.join(STATIC, "js", "render", "prepared.js")
# 待測：render/stockout.js
STOCKOUT_RENDER_JS = os.path.join(STATIC, "js", "render", "stockout.js")
# 待測：render/stocktake.js
STOCKTAKE_JS = os.path.join(STATIC, "js", "render", "stocktake.js")
# 待測：utils.js
UTILS_JS = os.path.join(STATIC, "js", "utils.js")
# 待測：api.js / app.js / bottomsheet.js / globals.js（2026-08-12 全專案 JS 完整性補強）
API_JS = os.path.join(STATIC, "js", "api.js")
APP_JS = os.path.join(STATIC, "js", "app.js")
BOTTOMSHEET_JS = os.path.join(STATIC, "js", "bottomsheet.js")
GLOBALS_JS = os.path.join(STATIC, "js", "globals.js")
NOTIFICATIONS_JS = os.path.join(STATIC, "js", "notifications.js")
# 待測：modals/*（2026-08-12 全專案 JS 完整性補強）
ADD_JS = os.path.join(STATIC, "js", "modals", "add.js")
CHANGEPW_JS = os.path.join(STATIC, "js", "modals", "changepw.js")
EDIT_JS = os.path.join(STATIC, "js", "modals", "edit.js")
EXPIRY_JS = os.path.join(STATIC, "js", "modals", "expiry.js")
PHOTO_JS = os.path.join(STATIC, "js", "modals", "photo.js")
STOCKOUT_MODAL_JS = os.path.join(STATIC, "js", "modals", "stockout.js")
# 待測：render/card.js
CARD_JS = os.path.join(STATIC, "js", "render", "card.js")
# 待測：render/calendar.js（2026-08-13）
CALENDAR_RENDER_JS = os.path.join(STATIC, "js", "render", "calendar.js")
# 待測：每日簽名報表（2026-09-07；demo 版面責任分層防回歸）
SIGNED_REPORTS_RENDER_JS = os.path.join(STATIC, "js", "render", "signed-reports.js")
SIGNED_REPORTS_CSS = os.path.join(STATIC, "css", "style.signed-reports.css")
QUOTATION_UPLOAD_RENDER_JS = os.path.join(STATIC, "js", "render", "quotation-upload.js")
QUOTATION_UPLOAD_CSS = os.path.join(STATIC, "css", "style.quotation-upload.css")
# 待測：報價單歷史清單（2026-09-15；電腦版全展開不分頁防回歸）
QUOTATION_RENDER_JS = os.path.join(STATIC, "js", "render", "quotation.js")
QUOTATION_HISTORY_PAGINATION_JS = os.path.join(BASE_DIR, "tests", "quotation_history_pagination.test.js")
QUOTATION_PERMISSION_RUNTIME_JS = os.path.join(BASE_DIR, "tests", "quotation_permission_runtime.test.js")
PDF_PREVIEW_BUTTON_JS = os.path.join(BASE_DIR, "tests", "pdf_preview_button.test.js")
# 待測：零用金月報（2026-09-12）
PETTY_CASH_RENDER_JS = os.path.join(STATIC, "js", "render", "petty-cash.js")
PETTY_CASH_CAPABILITY_RUNTIME_JS = os.path.join(BASE_DIR, "tests", "petty_cash_capability_runtime.test.js")
PETTY_CASH_UNPRICED_RUNTIME_JS = os.path.join(BASE_DIR, "tests", "petty_cash_unpriced_runtime.test.js")
SIGNED_REPORT_CAPABILITY_RUNTIME_JS = os.path.join(BASE_DIR, "tests", "signed_report_capability_runtime.test.js")
WORK_PROGRESS_PAGE_VISIBILITY_RUNTIME_JS = os.path.join(BASE_DIR, "tests", "work_progress_page_visibility_runtime.test.js")
TAB_LIFECYCLE_RUNTIME_JS = os.path.join(BASE_DIR, "tests", "tab_lifecycle_runtime.test.js")
TAB_ASYNC_LIFECYCLE_RUNTIME_JS = os.path.join(BASE_DIR, "tests", "tab_async_lifecycle.test.js")
CALENDAR_RUNTIME_JS = os.path.join(BASE_DIR, "tests", "calendar_runtime.test.js")
QUOTATION_UPLOAD_CAPABILITY_RUNTIME_JS = os.path.join(BASE_DIR, "tests", "quotation_upload_capability_runtime.test.js")
PETTY_CASH_MODAL_JS = os.path.join(STATIC, "js", "modals", "petty-cash.js")
PETTY_CASH_CSS = os.path.join(STATIC, "css", "style.petty-cash.css")
PETTY_CASH_REPORTS_CSS = os.path.join(STATIC, "css", "style.petty-cash-reports.css")
PETTY_CASH_ENGINEERING_CSS = os.path.join(STATIC, "css", "style.petty-cash-engineering.css")
PETTY_CASH_ENGINEERING_MODAL_JS = os.path.join(STATIC, "js", "modals", "engineering-petty-cash.js")
SETTINGS_HTML = os.path.join(STATIC, "settings.html")
SETTINGS_JS = os.path.join(STATIC, "js", "settings.js")
# 待測：modals/calendar.js + calendar-settings.js（2026-08-16 拆檔）
CALENDAR_MODAL_JS = os.path.join(STATIC, "js", "modals", "calendar.js")
CALENDAR_SETTINGS_JS = os.path.join(STATIC, "js", "modals", "calendar-settings.js")


def read(p: str) -> str:
    """讀檔 helper（UTF-8）"""
    with open(p, encoding="utf-8") as fh:
        return fh.read()

def read_petty_cash_css() -> str:
    """零用金三層 CSS 合併內容（僅供既有行為測試）。"""
    return read(PETTY_CASH_CSS) + read(PETTY_CASH_REPORTS_CSS) + read(PETTY_CASH_ENGINEERING_CSS)


def read_css_all() -> str:
    """style.css 拆檔後（2026-08-16）：core + calendar 合併讀，合併順序 = 原檔順序（內容 == 原 style.css）"""
    return read(CSS_CORE) + read(CSS_CAL)
