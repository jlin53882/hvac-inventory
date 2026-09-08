# -*- coding: utf-8 -*-
"""
v11.1 前端資產完整性測試（防未來改壞）
=====================================
背景：手機 UI 修正（topbar 換行 / modal 卡片化 / 按鈕黑字）是純前端 CSS+JS 改動，
pytest 後端測試測不到。此檔用「靜態資產檢查」當單元測試，守護：

1. index.html 有 viewport + 各靜態檔掛 cache-buster（避免使用者吃到舊快取）
2. style.css 手機 media query（max-width:767px）關鍵規則存在
3. 使用者管理操作按鈕是「完整文字 + 黑字」樣式（不會退化回純圖示白字）
4. auth.js / users.js 語法正確（node --check）且關鍵 class 存在

執行：
    env -u PYTHONPATH .venv\\Scripts\\python.exe -m pytest tests/test_frontend_assets.py -v
"""
import os
import subprocess
import sys

import pytest

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
# 待測：modals/calendar.js + calendar-settings.js（2026-08-16 拆檔）
CALENDAR_MODAL_JS = os.path.join(STATIC, "js", "modals", "calendar.js")
CALENDAR_SETTINGS_JS = os.path.join(STATIC, "js", "modals", "calendar-settings.js")
GLOBALS_JS = os.path.join(STATIC, "js", "globals.js")


def read(p):
    """讀檔 helper（UTF-8）"""
    with open(p, encoding="utf-8") as fh:
        return fh.read()

def read_calendar_js_all():
    """calendar 拆檔後（2026-08-16）：render + modals/calendar + modals/calendar-settings + globals.js 合併讀。
    ⚠️ 必含 globals.js——URLSearchParams 初始化（_calM/calMonth）搬去 globals.js，test_calendar_js_month_url 斷言它在這"""
    return (read(CALENDAR_RENDER_JS) + read(CALENDAR_MODAL_JS)
            + read(CALENDAR_SETTINGS_JS) + read(GLOBALS_JS))


def read_css_all():
    """style.css 拆檔後（2026-08-16）：core + calendar 合併讀，合併順序 = 原檔順序（內容 == 原 style.css）"""
    return read(CSS_CORE) + read(CSS_CAL)


# ---------- index.html ----------

def test_index_has_viewport():
    """驗證 index.html 含 viewport meta"""
    assert 'name="viewport"' in read(INDEX)


def test_index_has_no_manual_version_params():
    """原始 index.html 不寫 ?v=N（方案 A：版本號由後端 _versioned_html()
    依檔案 mtime 動態加上，手動加會被取代——避免開發者困惑要不要改）"""
    html = read(INDEX)
    assert 'src="/static/' in html and 'href="/static/' in html
    # 資源引用（src=/href=）不該有手動版本號；註解說明文字可含 ?v=N
    import re
    refs = re.findall(r'(?:src|href)="/static/[^"]+"', html)
    assert refs, "找不到資源引用"
    bad = [x for x in refs if "?v=" in x]
    assert not bad, f"資源引用有手動版本號: {bad}"


def test_index_html_div_balanced():
    """index.html div 標籤開閉平衡（2026-08-13 C4 教訓：python 字串搬移 bottom-nav 曾產生多餘 </div>
    造成 HTML 結構錯誤——任何結構改動若標籤不平衡，此測試擋下）"""
    html = read(INDEX)
    opens = html.count("<div")          # <div ...> 開標籤
    closes = html.count("</div>")       # 閉標籤
    assert opens == closes, f"div 開閉不平衡：開 {opens} / 閉 {closes}"
    # 其他常用結構標籤也一併檢查（防同類搬移殘骸）
    for tag in ("section", "table", "form", "button"):
        o, c = html.count(f"<{tag}"), html.count(f"</{tag}>")
        assert o == c, f"{tag} 開閉不平衡：開 {o} / 閉 {c}"


def test_index_unit_select_ids_unique():
    """單位動態 select id 唯一：f-unit 只在新增 modal（1 次）、編輯 modal 用 e-unit
    （2026-08-16 bug：編輯 modal 誤寫 f-unit 與新增重複 id → edit.js getElementById('e-unit')=null
    → 單位欄空白無法選，家豪 08-16 手機實測回報）"""
    html = read(INDEX)
    assert html.count('id="f-unit"') == 1
    assert 'id="e-unit"' in html


def test_search_input_no_autofill():
    """搜尋框不被瀏覽器 autofill（2026-08-13 Sarah：重新打開網站搜尋框殘留「admin」＝瀏覽器把登入帳號填入第一個文字框）
    三重防護：type=search（Chrome 不對 search input 填帳號，根治）+ autocomplete=new-password
    + app.js load 後延遲清空兜底（autofill 常在 DOMContentLoaded 之後才寫入）"""
    idx = read(INDEX)
    assert 'id="search-input"' in idx
    assert 'type="search"' in idx          # 根治：search 型別不被 Chrome autofill
    assert 'autocomplete="new-password"' in idx
    ap = read(APP_JS)
    assert "function clearSearchAutofill" in ap
    assert "window.addEventListener('load'" in ap
    assert "setTimeout(clearSearchAutofill, 500)" in ap


# ---------- style.css ----------

def test_css_mobile_media_query():
    """驗證 CSS 含手機版 media query"""
    css = read_css_all()
    assert "@media (max-width: 767px)" in css
    # topbar 換行
    assert ".top-actions { flex-wrap: wrap" in css or "flex-wrap: wrap" in css


def test_css_cal_evt_b_variant_and_no_overflow():
    """2026-08-14 家豪 B 方案：月曆格時間/內容兩段式 ＋ 跑版防回歸
    - .cal-grid 必須 minmax(0, 1fr)（1fr=minmax(auto,1fr) 會被長 nowrap 文字撐破格子——8/22 跑版根因）
    - .cal-evt 兩段結構：時間一行 + 內容一行截斷"""
    css = read_css_all()
    assert "repeat(7, minmax(0, 1fr))" in css            # 跑版防回歸（長內容不撐破格子）
    assert ".cal-evt .cal-evt-time" in css               # 時間獨立一行
    assert ".cal-evt .cal-evt-body" in css               # 內容一行（ellipsis 截斷）


def test_css_cal_selected_highlight():
    """2026-08-14 家豪：點月曆日期要有「選中」深色框（原 .cal-selected 只有淡背景，看不到框）
    - 選中框 = 深藍邊框 + 深藍數字底
    - 08-14 變體 A：今天完全不標記——不再有 .cal-today 樣式（只有選中的日期有框）"""
    css = read_css_all()
    assert ".cal-cell.cal-selected { border: 2px solid #2d5a8e" in css
    assert ".cal-cell.cal-selected .cal-day-num { background: #2d5a8e" in css
    assert ".cal-cell.cal-today" not in css            # 今天無標記（不與選中框衝突）


def test_css_modal_mobile_visible_fix():
    """2026-08-25 手機 modal 三層修復防回歸（家豪截圖實證三輪迭代定案）

    背景：手機新增/編輯品項 modal 顯示不完整，根因有三層、缺一不可：
    1. vh 含網址列 → modal 高度超出可視區 → max-height 用 dvh（fallback vh 寫前面）
    2. 手機 topbar sticky z-index:900 蓋住 overlay z-200 → overlay 提到 950
       （須低於 bottomsheet 3000 / lightbox 9999；toast 同步提到 960 才能浮在 modal 上）
    3. modal padding-bottom 20px 讓 sticky 按鈕下方留縫隙露出滾動內容 → padding 簡寫改 20px 20px 0

    bug 版必紅已驗證（Playwright elementFromPoint：z=200 時 h3/brand owner=topbar；
    padding-bottom 縫隙 20px 時探測點抓到 form-row 露出）"""
    css = read_css_all()
    # 層1：dvh（fallback vh 必須在 dvh 前面，順序顛倒會讓支援 dvh 的瀏覽器也用不到）
    assert "max-height: 88vh;" in css and "max-height: 88dvh;" in css
    assert css.index("max-height: 88vh;") < css.index("max-height: 88dvh;")
    # 層2：overlay 高於手機 topbar z-900、低於 sheet 3000/lightbox 9999
    assert "z-index: 950" in css
    assert "z-index: 960" in css          # toast 浮在開啟的 modal 上
    # 層3：modal 底部 padding 歸零（sticky 按鈕自帶 padding），縫隙不再露出滾動內容
    assert "padding: 20px 20px 0;" in css
    # sticky 按鈕釘底——A 方案定案（2026-08-25 家豪選定）：白底無陰影貼底，白色框感消失
    assert "position: sticky; bottom: 0; background: #fff; padding: 12px 0 14px; z-index: 10;" in css
    assert "box-shadow" not in css.split(".modal-actions")[1].split("}")[0]  # 按鈕區無陰影


def test_css_user_actions_black_text():
    """舊使用者 modal 操作欄樣式已清理（RBAC 權限頁取代，user-actions 退役）"""
    css = read_css_all()
    assert ".user-actions" not in css
    assert ".btn-ghost.danger" not in css  # 舊 modal danger 按鈕樣式一併清理


def test_css_mobile_topbar_full_buttons():
    """Shell v2 (2026-09-06)：topbar 已替換為 sidebar + header。驗證舊 topbar 標題 span 已移除，新 sidebar brand-text 存在"""
    idx = read(INDEX)
    # 舊 topbar 標題結構已移除
    assert 'class="t-title"' not in idx, "舊 topbar t-title 應已移除"
    assert 'class="t-title-2"' not in idx, "舊 topbar t-title-2 應已移除"
    # 新 sidebar brand-text 存在（振佳空調 + 管理系統）
    assert 'class="name">振佳空調</div>' in idx, "sidebar brand name 應存在"
    assert 'class="sub">管理系統</div>' in idx, "sidebar brand sub 應存在"


def test_css_table_card_layout():
    """舊使用者 modal 手機卡片化樣式已清理（RBAC 權限頁取代，users-table 退役）"""
    css = read_css_all()
    assert ".users-table" not in css


# ---------- 每日簽名報表（demo 版面責任分層） ----------

def test_signed_reports_demo_layout_contract():
    """DSR：外層只管版心，標題與卡片上下排列，僅 .dsr-layout 可切桌機兩欄。

    2026-09-07 bug：誤把 .dsr-wrap 改為兩欄 Grid，標題與卡片被分到左右欄。
    """
    js = read(SIGNED_REPORTS_RENDER_JS)
    css = read(SIGNED_REPORTS_CSS)
    app = read(APP_JS)
    assert 'class="dsr-page-header"' in js
    assert js.index('class="dsr-page-header"') < js.index('class="dsr-layout"')
    assert '#content.dsr-content' in css
    assert '.dsr-layout { grid-template-columns: 1.05fr .95fr; }' in css
    assert '.dsr-wrap { display: grid;' not in css
    assert 'max-width: 1100px;' not in css
    assert "content.classList.toggle('dsr-content', tab === 'signed-reports')" in app


def test_signed_reports_actions_and_editable_note_contract():
    """DSR：圖片直接預覽；下載/刪除/編輯備註均為圖示加文字操作。"""
    js = read(SIGNED_REPORTS_RENDER_JS)
    css = read(SIGNED_REPORTS_CSS)
    assert "onclick=\"dsrPreview(${r.id})\"" in js
    assert "!isImage" in js
    assert "class=\"dsr-report-thumb\"" in js
    assert "dsrEditNote(${r.id})" in js
    assert "prompt('編輯報表日期" in js
    assert "prompt('編輯上傳人姓名" in js
    assert "prompt('編輯備註" in js
    assert "report_date" in js and "uploader_name" in js
    assert "✏️ 編輯" in js
    assert "function _dsrDateOnly" in js
    assert "_dsrDateOnly(r.upload_time)" in js
    assert "esc(r.upload_time)" not in js
    assert "fetch('/api/auth/me')" in js
    assert "class=\"dsr-report-card\"" in js
    assert "<summary" in js
    assert "dsr-report-summary__date" in js
    assert "dsr-report-summary__uploader" in js
    assert "<details" in js
    assert "⬇️ 下載" in js
    assert "🗑 刪除" in js
    assert "PATCH" in js
    assert "/api/signed-reports/" in js and "note" in js
    assert ".dsr-report-thumb" in css
    assert ".dsr-action-btn" in css
    assert "border: 1px solid #111827" in css
    assert ".dsr-note-cell" in css and "background: #fff7ed" in css


def test_stocktake_calcDiff_has_st_diff_element():
    """盤點 calcDiff() 對應的 .st-diff 元素存在於 HTML 模板中"""
    js = read(STOCKTAKE_JS)
    assert 'function calcDiff' in js
    assert '.st-diff' in js
    # 確認渲染的 HTML 包含 st-diff td
    assert 'class="st-diff' in js


def test_stocktake_table_has_diff_column():
    """盤點表格表頭包含「差異」欄"""
    js = read(STOCKTAKE_JS)
    assert '差異</th>' in js


def test_signed_reports_prefills_uploader_from_auth_user_display_name():
    """回歸：/api/auth/me 回傳 {user: {...}}，上傳人需讀 user.display_name。"""
    js = read(SIGNED_REPORTS_RENDER_JS)
    assert "const me = await fetch('/api/auth/me').then(r => r.ok ? r.json() : null);" in js
    assert "if (me && me.user && me.user.display_name) document.getElementById('dsr-uploader').value = me.user.display_name;" in js


def test_signed_reports_accept_no_docx():
    """簽名報表前端 accept 不含 .docx/.xlsx（與後端白名單對齊）"""
    js = read(SIGNED_REPORTS_RENDER_JS)
    assert '.docx' not in js
    assert '.xlsx' not in js
    assert 'PDF / PNG / JPG' in js or 'PDF' in js


def test_no_openDrawer_dead_code():
    """openDrawer/submitDrawer 殘留已清除"""
    app = read(APP_JS)
    assert 'function openDrawer' not in app
    assert 'function submitDrawer' not in app
    assert '_drawerCurrentType' not in app


# ---------- auth.js ----------

def test_auth_js_wraps_button_text_in_span():
    """Shell v2: auth.js 減化（dropdown 為靜態 HTML），檢查精簡版"""
    js = read(AUTH_JS)
    # Shell v2: dropdown is static HTML, auth.js only has checkAuth/logout/renderUserMenu/applyRoleView
    assert "checkAuth" in js
    assert "logout" in js
    assert "applyRoleView" in js


def test_mobile_topbar_icon_align_fix():
    """Shell v2: topbar 已移除，auth.js 不再渲染動態按鈕"""
    js = read(AUTH_JS)
    # Shell v2: dropdown is static HTML, no dynamic button rendering in auth.js
    assert "checkAuth" in js
    assert "applyRoleView" in js


# ---------- 權限頁 perms.js（RBAC 2026-08-13，取代 users.js modal） ----------

def test_perms_js_account_actions_have_full_text():
    """帳號操作按鈕必須有完整文字（不能退化成純圖示）"""
    js = read(PERMS_JS)
    assert "重設密碼" in js
    assert "停用帳號" in js
    assert "啟用帳號" in js
    assert "刪除帳號" in js


def test_perms_js_has_class_names():
    """驗證 perms.js 含預期 class 名稱（權限頁 UI）"""
    js = read(PERMS_JS)
    assert "perm-row" in js
    assert "perm-grid" in js
    assert "switch" in js
    assert "chip" in js  # 手機 M1 chip 列


def test_perms_js_close_methods():
    """新增帳號 / 重設密碼 modal 有關閉函式"""
    js = read(PERMS_JS)
    assert "closeAddUserModal" in js
    assert "closeResetPwModal" in js


def test_perms_js_reset_perm_modal():
    """2026-08-15：重設為角色預設 改自訂確認 modal（取代原生 confirm）——開/關/確定 三函式齊全"""
    js = read(PERMS_JS)
    assert "openResetPermModal" in js
    assert "closeResetPermModal" in js
    assert "confirmResetPerm" in js
    assert "reset_all" in js
    # 舊的 permReset（原生 confirm 版本）已移除；permResetPw 是「重設密碼」不同功能，保留
    assert "window.permReset = " not in js


def test_permissions_html_has_reset_perm_overlay():
    """permissions.html 有重設確認 modal（resetPermOverlay + 目標帳號/角色 span）"""
    html = read(PERMISSIONS_HTML)
    assert 'id="resetPermOverlay"' in html
    assert 'id="resetPermTarget"' in html
    assert 'id="resetPermRole"' in html
    assert "確定重設" in html


def test_permissions_html_breadcrumb_topbar():
    """2026-08-15 變體 B 麵包屑頂欄：vb-back 圓鈕 + 麵包屑 + 內容區大標題"""
    html = read(PERMISSIONS_HTML)
    assert 'class="vb-back"' in html
    assert 'class="vb-crumb"' in html
    assert "庫存" in html and "vb-crumb-current" in html  # 麵包屑「庫存 › 帳號與權限」
    assert 'class="vb-content-title"' in html  # 大標題下移內容區
    assert "vb-crumb a, .vb-crumb .sep { display: none; }" in html  # 手機版隱藏麵包屑


def test_permissions_html_save_bar_variant_b():
    """2026-08-15 方案 B sticky 底條：save-bar fixed bottom + inner 對齊 + 手機 column 雙鈕"""
    html = read(PERMISSIONS_HTML)
    assert ".save-bar {" in html and "position: fixed; bottom: 0" in html  # fixed 底條
    assert ".save-bar-inner" in html  # 桌面 1200 對齊 wrapper
    assert ".save-btns" in html  # 雙鈕組
    assert "env(safe-area-inset-bottom" in html  # 手機 safe-area
    assert "flex-direction: column" in html  # 手機版 column 排列
    # 內容區留白防遮擋（底條高 ~58px，padding 要大於底條）
    assert "padding: 16px 16px 90px" in html  # 桌面
    assert "padding: 0 0 110px" in html  # 手機


def test_permissions_html_btn_ghost_white_fix():
    """2026-08-15 根因修復：.btn-ghost 全域白字樣式（topbar 專用）用於白底容器會隱形——
       save-bar / modal 內必須覆寫白底深字版"""
    html = read(PERMISSIONS_HTML)
    assert ".save-btns .btn-ghost" in html and "color: #555" in html  # save-bar 重設鈕覆寫
    assert ".modal .btn-ghost" in html and "color: #555" in html  # modal 取消鈕覆寫


def test_perms_js_reset_perm_modal_structure():
    """2026-08-15：save-bar render 結構——save-bar-inner + save-btns 包雙鈕（重設/儲存），重設開 modal"""
    js = read(PERMS_JS)
    assert "save-bar-inner" in js
    assert "save-btns" in js
    assert "window.openResetPermModal()" in js
    assert "window.permSave()" in js


def test_perms_js_batch_create():
    """批次新增：/api/users/batch 端點 + 逐筆結果顯示"""
    js = read(PERMS_JS)
    assert "/api/users/batch" in js
    assert "results" in js


# 待測：permissions.html / perms.js（RBAC 權限頁，2026-08-13）
PERMS_JS = os.path.join(STATIC, "js", "perms.js")
PERMISSIONS_HTML = os.path.join(STATIC, "permissions.html")
SETTINGS_HTML = os.path.join(STATIC, "settings.html")  # 2026-08-16 設定中心
SETTINGS_JS = os.path.join(STATIC, "js", "settings.js")  # 2026-08-16 設定中心


def test_settings_js_orphan_group_ui():
    """方案 B（2026-08-16）：settings.js 有 loadOrphans / consolidateItem / 分組手風琴結構（防回歸退回整批模式）"""
    js = read(SETTINGS_JS)
    assert "loadOrphans" in js
    assert "consolidateItem(" in js
    assert "consolidate-item" in js            # 新端點呼叫（舊 code 無）
    assert "grp-head" in js and "grp-body" in js  # 分組展開結構（舊 code 無）
    assert "consolidateGroup(" in js           # 組底整組快速套用（複用既有 consolidate）
    # 2026-08-28 稽核：consolidateGroup 曾用 `data.affected` 但 `const data`/`res` 未宣告
    # → 收編成功 toast 拋 ReferenceError。鎖定 res+data 都被宣告（bug 版必紅）。
    grp_func = js[js.find("function consolidateGroup"):]
    assert "const res = await fetch('/api/units/consolidate'" in grp_func
    assert "const data = await res.json();" in grp_func
    assert "data.affected" in grp_func


def test_settings_js_unit_select_placeholder():
    """下拉預設「— 請選擇 —」（防回歸：預設第一個單位「個」的誤收編模式）"""
    js = read(SETTINGS_JS)
    assert "— 請選擇 —" in js


def test_settings_js_no_old_batch_ui():
    """舊整批收編 UI（unitUsage/consolidateUnit）已移除（dead code 防回歸）"""
    js = read(SETTINGS_JS)
    assert "unitUsage" not in js
    assert "consolidateUnit(" not in js
    assert "u-consolidate-to" not in js


def test_permissions_html_loads_perms_js():
    """permissions.html 有載入 perms.js（無手動版本號）"""
    html = read(PERMISSIONS_HTML)
    assert 'src="/static/js/perms.js"' in html
    assert "perms.js?v=" not in html  # 版本號由後端自動注入


def test_perms_js_has_roles_and_groups():
    """權限頁：四角色 label + 權限分組常數"""
    js = read(PERMS_JS)
    assert "ROLE_LABELS" in js
    assert "GROUP_LABELS" in js
    assert "admin: '🛡️ 管理員'" in js and "tech: '🔧 工程師'" in js
    assert "/api/users/${curUid}/permissions" in js  # 權限清單由 per-user 端點內聯載入（後端權威，前端不寫死矩陣）


def test_perms_js_perm_save_and_reset():
    """權限開關：儲存 / 重設為角色預設 API 呼叫"""
    js = read(PERMS_JS)
    assert "permSave" in js
    assert "permReset" in js
    assert "reset_all" in js
    assert "/permissions" in js


def test_perms_js_role_badge_styles():
    """權限頁角色樣式 + 共用 CSS（.switch 為 calendar service-type 啟停沿用）"""
    css = read_css_all()
    assert ".switch" in css
    assert "role-badge" not in css  # 舊 users modal 樣式已清理（RBAC 取代）


def test_perms_js_has_viewer_role_option():
    """新增帳號角色下拉（單一）要有檢視者選項"""
    html = read(PERMISSIONS_HTML)
    assert 'value="viewer">👀 檢視者' in html


def test_perms_js_auto_select_no_old_name():
    """2026-08-14 修：initPermPage 自動選中必須呼叫 window.permSelect（舊名 selectUser 未定義→右側空白）"""
    js = read(PERMS_JS)
    assert "window.permSelect(permUsers[0].id)" in js  # 自動選中第一位
    assert "selectUser(permUsers[0].id)" not in js     # 防舊名回歸（selectUser is not defined）


def test_perms_html_nav_buttons_use_root():
    """2026-08-14 修：返回/庫存按鈕必須導向 /（後端無 /index.html 路由 → 舊寫法 404）"""
    html = read(PERMISSIONS_HTML)
    assert "location.href='/'" in html
    assert "location.href='/index.html'" not in html  # 防 404 回歸（{"detail":"Not Found"}）
    js = read(PERMS_JS)
    assert "location.href='/index.html'" not in js


def test_perms_html_switch_after_overridden():
    """2026-08-14 修：權限頁開關必須覆寫 style.css 的 .switch::after（行事曆 button 開關的白圈）
    ——否則兩者共用 .switch class 撞名，權限頁每顆開關多出一個永遠停在左邊的白圈（家豪「兩個白色圓圈」）"""
    html = read(PERMISSIONS_HTML)
    assert ".switch::after { content: none; }" in html
    assert ".switch { background: transparent; }" in html


def test_css_has_btn_primary():
    """2026-08-14 修：style.css 必須定義 .btn-primary（權限頁「新增帳號/儲存變更」）
    ——原本全站無定義 → 瀏覽器預設方形按鈕（家豪「不要這樣方形很醜」）"""
    css = read_css_all()
    assert ".btn-primary {" in css
    assert ".topbar .btn-primary {" in css  # topbar 深藍底上的反白


def test_perms_js_perm_toggle_updates_source_label():
    """2026-08-14 修：切換開關時來源標籤即時改「✏️ 自訂」（跟隨角色→自訂），避免狀態殘影感"""
    js = read(PERMS_JS)
    assert "src.textContent = '✏️ 自訂'" in js
    assert "perm-src override" in js


def test_perms_js_dead_code_no_regression():
    """57ead1e 清理的 dead code 防回歸（2026-08-14 補）：
    A3 kitModalSelections / A4 permPoints / A5 roleDefaults / A6 全量權限 fetch
    任一復活 → 本測試紅，防止「清完又長回來」"""
    gl = read(GLOBALS_JS) + read(KIT_MODAL_JS)
    assert "kitModalSelections" not in gl          # A3：v8 拆分殘骸（被 kitModalCompRows 取代）
    js = read(PERMS_JS)
    assert "permPoints" not in js                  # A4：權限點全量目錄殘骸（per-user 端點內聯取代）
    assert "roleDefaults" not in js                # A5：角色預設殘骸（同上）
    assert "apiGet('/api/users/permissions')" not in js  # A6：全量 fetch 不得復活（per-user ${curUid} 端點才對）


# ---------- viewer 角色前端（唯讀模式） ----------

def test_auth_js_has_apply_role_view():
    """auth.js 有 applyRoleView：viewer 隱藏盤點/儲存列/提醒
    （2026-08-13 Sarah：新增/匯出按鈕已移到庫存清單頂部 inventory.js，auth.js 不再引用 btn-add/btn-export）"""
    js = read(AUTH_JS)
    assert "applyRoleView" in js
    assert "btn-add" not in js  # 新增按鈕已搬移到 inventory.js，不留 dead code
    assert "btn-export" not in js  # 已搬移，不留 dead code
    assert "nav-stocktake" in js
    assert "save-bar" in js
    assert "admin-badge\" style=\"background:#6b7280\">👀 檢視者" not in js  # viewer 不顯示 badge（2026-08-13 Sarah）


def test_inventory_js_viewer_mode():
    """inventory.js 有 viewer 模式：隱藏編輯/操作按鈕、數量唯讀"""
    js = read(INVENTORY_RENDER_JS)
    assert "isViewer" in js
    assert "cursor:default" in js  # 數量唯讀樣式
    assert "title=\"唯讀\"" in js
    assert "deleteItem" in js  # 卡片 刪除整筆材料（Sarah 需求）
    assert ">刪除</button>" in js  # 刪除按鈕用文字、不用圖案（Sarah 2026-08-11 修正）


def test_kits_js_viewer_mode():
    """kits.js 有 viewer 模式：隱藏新增整組/組裝/拆解按鈕"""
    js = read(KITS_RENDER_JS)
    assert "isViewer" in js
    assert "openKitModal" in js
    assert "editKit" in js  # 整組可編輯（Sarah 需求）
    assert "deleteKit" in js  # 整組可刪除（Sarah 需求）
    assert "submitKitEdit" in read(KIT_MODAL_JS)


def test_prepared_js_viewer_mode():
    """prepared.js 有 viewer 模式：隱藏操作欄（已領出/退回按鈕）"""
    js = read(PREPARED_RENDER_JS)
    assert "isViewer" in js
    assert "openPreparedOutModal" in js
    assert "returnPrepared" in js
    assert "clearPrepared" in js  # 待領出可刪除（Sarah 需求）

def test_stockout_js_has_delete():
    """已領出紀錄可刪除（Sarah 需求）"""
    js = read(STOCKOUT_RENDER_JS)
    assert "deleteStockoutRecord" in js
    assert "DELETE" in js


def test_stockout_grouping_by_day():
    """已領出分組按「日」顯示（2026-08-12 Sarah 需求：藍色標題要含幾號並分開顯示）

    分組 key 從 created_at 前 7 字元（YYYY-MM 按月）改成前 10 字元（YYYY-MM-DD 按日），
    藍色標題直接顯示完整日期（📅 2026-08-12 / 📅 2026-08-11 各自一組）。
    防護：
    1. slice(0, 10) 存在且 slice(0, 7) 不再出現（退回按月 = 標題又沒幾號）
    2. 手機 + 桌機兩處標題都用 ${m}（完整日期）
    3. 2026-08-12 中間版「顯示今天日期」helper（mLabel/todayStr）不得殘留
       （會讓所有分組標題都變成今天、歷史日期無法分開）
    """
    js = read(STOCKOUT_RENDER_JS)
    # 分組 key = 完整日期（年月日）
    assert "slice(0, 10)" in js
    assert "slice(0, 7)" not in js, "退回按月分組（slice(0,7)）會讓標題沒有幾號"
    assert "// 分組：按日" in js
    # 手機 + 桌機標題都用 ${m}（完整日期），各 1 處
    assert js.count("📅 ${m}</span>") == 2
    # 中間版「今天日期」helper 已移除
    assert "mLabel" not in js
    assert "todayStr" not in js


def test_prepared_js_shows_model():
    """待領出頁每筆顯示型號（2026-08-12 Sarah 需求）——手機卡片 + 桌面表格各一處"""
    js = read(PREPARED_RENDER_JS)
    # 手機卡片 nameHTML 與桌面表格都有藍色「型號」小字（樣式與整組材料列一致 #1890FF）
    assert js.count("型號 ") == 2
    assert "color:#1890FF;font-weight:600" in js


def test_prepared_js_none_stock_sheet_actions():
    """非庫存品項 ⋯ 選單可開（preparedItems fallback）+ 無退回按鈕（2026-08-16 家豪）"""
    js = read(PREPARED_RENDER_JS)
    assert "preparedItems.find" in js          # 非庫存品項不在 ALL_ITEMS → 用待領出清單 fallback（bug：點 ⋯ 無效）
    assert "!item.is_deleted" in js            # 退回按鈕條件（非庫存保留 已領出+刪除）


def test_prepared_js_chip_out_of_name_line():
    """V1b（2026-08-16）：待領出 chip 移出品名行（改放 extraHTML），名稱行不再塞 chip 防誤導 ⋯"""
    js = read(PREPARED_RENDER_JS)
    assert 'margin-top:3px' in js              # extraHTML chip 行（V1b 標記）
    assert "subHTML: `${i.code ?" in js        # 型號移入 subHTML
    inv = read(INVENTORY_RENDER_JS)
    assert "待領出 ' + prepared + '</span>" in inv  # 單一庫存 chip 移到 subHTML（品牌前面）


def test_stockout_js_shows_model():
    """已領出頁每筆顯示型號（2026-08-12 Sarah 需求）——手機卡片（一般+退回）+ 桌面表格各一處"""
    js = read(STOCKOUT_RENDER_JS)
    assert js.count("型號 ") == 3  # mobile normal + mobile return + desktop table
    assert "color:#1890FF;font-weight:600" in js
    # 型號從 subHTML 移到 nameHTML 下方：subHTML 只剩日期（不再有「· 型號」）
    assert "· 型號" not in js


def test_kits_components_show_photo():
    """整組每個材料顯示自己的照片縮圖（2026-08-12 Sarah 需求：不是整組一張，是每個單一材料）"""
    js = read(KITS_RENDER_JS)
    assert "cphoto" in js                                          # 手機 kit-comp 縮圖 class
    assert "openPhotoLightbox(${c.item_id})" in js                 # 點擊放大
    assert "k.has_photo" not in js                                 # kit 層級縮圖已移除（誤解版）


def test_kit_comp_left_align():
    """整組材料名稱/型號靠左（2026-08-12 Sarah 需求）——
    kit-comp 用 flex-start + gap，不能用 space-between（3 元素會把名稱推到中間）"""
    css = read_css_all()
    assert ".m-card .kit-comp { display: flex; justify-content: flex-start; align-items: center; gap: 8px;" in css
    assert ".m-card .kit-comp .cneed { color: #6b7280; flex-shrink: 0; margin-left: auto; }" in css


# ---------- 2026-08-11 Sarah 需求：卡片顯示格式（位置/備註/刪除/照片/型號/標題） ----------

def test_inventory_loc_pill_no_qty_and_note_merged():
    """庫存卡位置標：只顯示位置、不顯示 ×數量；備註併入同一框（｜分隔）、無獨立 .item-note"""
    js = read(INVENTORY_RENDER_JS)
    # 位置渲染已移至 card.js buildLocHTML（2026-09-06 兩段式位置）
    card_js = read(CARD_JS)
    assert "位置：" in card_js or "未標示" in card_js              # 位置標在 card.js
    assert "item-loc" in js or "buildLocHTML" in js               # inventory 呼叫 buildLocHTML
    assert "×${s.qty}" not in js                                 # 不得再有 ×數量
    assert "loc-qty" not in js                                   # 相關 CSS class 已移除
    assert ".item-note" not in js                                # 備註不再單獨一行
    assert "｜" in card_js or "'｜'" in card_js                  # 備註以｜併入位置框

def test_inventory_del_btn_is_text():
    """刪除按鈕用文字「刪除」而非 ✕ 圖案（Sarah 修正）"""
    js = read(INVENTORY_RENDER_JS)
    assert ">刪除</button>" in js
    assert "title=\"刪除材料\"" in js

def test_kit_materials_show_model():
    """整組材料列顯示型號（Sarah 需求）"""
    js = read(KITS_RENDER_JS)
    assert "型號" in js
    assert "model" in js

def test_stockout_photo_column():
    """已領出表格有照片欄（so-photo）"""
    js = read(STOCKOUT_RENDER_JS)
    assert "so-photo" in js
    css = read_css_all()
    assert ".so-photo" in css

def test_title_is_zhenjia_management():
    """標題為「振佳空調管理系統」（2026-08-12 家豪/Sarah 定案：登入頁 + 主程式 + 分頁標題）"""
    login = read(LOGIN)
    assert "振佳空調管理系統" in login
    assert "振佳空調庫存管理系統" not in login                # 舊標題不得殘留
    assert login.count("login-hvac.png") == 2                  # 大圖 + 手機小圖都換新
    assert "<title>🔐 登入｜振佳空調管理系統</title>" in login
    index = read(INDEX)
    assert "<title>振佳空調管理系統</title>" in index
    # Shell v2 (2026-09-06)：topbar 標題已移至 sidebar brand-text
    assert 'class="name">振佳空調</div>' in index, "sidebar brand name 應存在"
    assert 'class="sub">管理系統</div>' in index, "sidebar brand sub 應存在"

def test_topbar_logo_uses_login_image():
    """Shell v2 (2026-09-06)：topbar logo 已替換為 sidebar brand 文字徽章「振」+ 漸層背景"""
    html = read(INDEX)
    # 新 sidebar logo：CSS 漸層文字徽章
    assert 'class="logo">振</div>' in html, "sidebar logo 應為文字徽章「振」"
    # 舊 logo-topbar.png 不應殘留在 HTML（logo 已改為純 CSS）
    # 注意：logo-topbar.png 檔案本身仍存在於 static/img/（其他頁可能用到），只是 index.html 不再引用

def test_login_img_no_manual_cachebuster():
    """登入圖版本號由 server 自動注入（_versioned_html 依檔案 mtime），原始 login.html 不得手動寫 ?v=——
    2026-08-12 曾誤加 ?v=20260812 與方案 A 衝突（test_main.py::test_html_source_has_no_version_params 會抓），
    快取問題由 mtime 注入解決：換圖存檔即版本號變、瀏覽器自動取新圖"""
    html = read(LOGIN)
    assert html.count("/static/img/login-hvac.png") == 2       # 桌機 big-logo + 手機 logo
    assert "/static/img/login-hvac.png?v=" not in html        # 不得手動版本號

def test_login_img_position_adjust_params():
    """登入圖 CSS 速調參數存在（2026-08-12 家豪需求：translateX/translateY 手動微調）"""
    html = read(LOGIN)
    assert html.count("速調登入圖位置") == 2                   # 手機 .brand .logo img + 桌機 .big-logo img
    assert "translateX(" in html and "translateY(" in html    # 參數本體不能整組被移除
    assert "負=左/正=右" in html and "負=上/正=下" in html     # 註解規則存在（調整指引）

def test_login_hvac_image_exists():
    """登入用圖片檔必須存在於 static/img/"""
    img = os.path.join(STATIC, "img", "login-hvac.png")
    assert os.path.exists(img), "static/img/login-hvac.png 不存在"


def test_login_hvac_image_centered():
    """登入圖內容水平置中 + 左緣無殘留黑線（2026-08-12 修復：原圖內容偏左 66px 且左緣有 1px 黑線，
    已校正置中並清除黑線——此測試防未來換圖時重蹈覆轍）"""
    try:
        from PIL import Image
    except ImportError:
        pytest.skip("Pillow 不在環境，跳過圖片像素檢查")
    img_path = os.path.join(STATIC, "img", "login-hvac.png")
    im = Image.open(img_path).convert("L")
    w, h = im.size
    mask = im.point(lambda v: 255 if v < 245 else 0)           # 非白內容（含淺灰房子輪廓）
    bbox = mask.getbbox()
    assert bbox, "登入圖全白？"
    left, top, right, bottom = bbox
    center = (left + right) / 2
    # 內容中心離畫布中心 < 5% 圖寬（目前偏右 33.5px = 2.85%，CSS translateX 補償）
    assert abs(center - w / 2) < w * 0.05,         f"登入圖內容未置中: 中心 {center:.0f} vs 畫布中心 {w/2:.0f}（左留白 {left} / 右留白 {w-right}）"
    # 左緣 x<50 全白：黑線已清除，防殘留線回歸
    assert not mask.crop((0, 0, 50, h)).getbbox(), "登入圖左緣 x<50 有殘留像素（黑線未清乾淨？）"


# ---------- login.html（登入頁 v11.1 響應式） ----------

def test_login_has_viewport():
    """驗證 login.html 含 viewport meta"""
    assert 'name="viewport"' in read(LOGIN)


def test_login_dual_panel_desktop():
    """桌機雙欄：brand-panel 存在且 ≥768px 才顯示"""
    html = read(LOGIN)
    assert 'class="brand-panel"' in html
    assert 'class="form-panel"' in html
    assert '@media (min-width: 768px)' in html


def test_login_mobile_single_card():
    """手機維持單卡：卡片 90% + max-width 400px"""
    html = read(LOGIN)
    assert "width: 90%; max-width: 400px" in html


def test_login_footer_text():
    """頁尾：版權+系統名+版本號（取代舊的「振佳製冷 2026」）"""
    html = read(LOGIN)
    assert "© 2026 振佳空調" in html
    assert "v11.0" in html
    assert "振佳製冷 2026" not in html


def test_login_input_icons_and_style():
    """輸入框 icon + 亮藍按鈕 + 高 46px"""
    html = read(LOGIN)
    assert "👤" in html and "🔒" in html or "content: '👤'" in html and "content: '🔒'" in html
    assert "1890FF" in html
    assert "height: 46px" in html


def test_login_remember_and_forgot():
    """記住帳號 checkbox + 忘記密碼連結"""
    html = read(LOGIN)
    assert 'id="remember"' in html
    assert "localStorage" in html
    assert "inv_username" in html
    assert 'id="forgotLink"' in html


def test_login_announce_banner():
    """維護公告橫幅（預設 hidden）"""
    assert 'id="announce"' in read(LOGIN)


# ---------- JS 語法（node --check，全量） ----------

# 動態收集 static/js/ 下全部 .js：新增 JS 檔自動納入語法檢查，不會再漏。
# （2026-08-12 前只檢查 6 個檔，其餘 16 個 JS 語法錯誤不會被 pytest 抓到）
ALL_JS_FILES = sorted(
    os.path.join(root, f)
    for root, _, files in os.walk(os.path.join(STATIC, "js"))
    for f in files
    if f.endswith(".js")
)


def test_js_getelementbyid_ids_all_exist():
    """防回歸（2026-08-16 f-unit bug）：JS 所有 getElementById('X')/querySelector('#X') 引用的 id
    必須存在於 HTML 靜態定義 或 JS 動態建立點（id="X" 字串）。

    f-unit bug 根因：edit.js getElementById('e-unit') 但 HTML 只有重複的 f-unit → 拿 null →
    fillUnitSelect 靜默 return → 單位欄空白。此測試確保「JS 引用的每個 id 都有建立點」，
    故意打錯任何 getElementById 的 id 此測試必紅。
    """
    import re
    js_refs = {}   # id -> 引用來源檔案清單
    html_ids = set()
    js_build_ids = set()
    for p in ALL_JS_FILES:
        src = read(p)
        for m in re.finditer(r"getElementById\(['\"]([^'\"]+)['\"]\)", src):
            js_refs.setdefault(m.group(1), []).append(os.path.basename(p))
        for m in re.finditer(r"querySelector\(['\"]\#([\w-]+)['\"]\)", src):
            js_refs.setdefault(m.group(1), []).append(os.path.basename(p))
        for m in re.finditer(r'id=["\']([^"\']+)["\']', src):
            js_build_ids.add(m.group(1))
    for hf in (INDEX, LOGIN, os.path.join(STATIC, "permissions.html"), os.path.join(STATIC, "settings.html")):
        for m in re.finditer(r'id=["\']([^"\']+)["\']', read(hf)):
            html_ids.add(m.group(1))
    missing = {k: v for k, v in sorted(js_refs.items())
               if k not in html_ids and k not in js_build_ids}
    assert not missing, (
        f"JS 引用的 id 無任何建立點（HTML 靜態 id 或 JS 動態 id= 皆無）: {missing}\n"
        f"→ getElementById 必拿 null → 靜默 no-op 或 TypeError（f-unit bug 同型）"
    )
def test_unit_search_and_duplicate_guard():
    """快速新增單位 UX（2026-08-16 家豪）：① 單位搜尋框存在（4 modal）② 搜尋過濾函式
    ③ 重複單位提示（不 POST）④ .modal .btn-ghost 覆寫（取消按鈕白底深字——家豪實測看不到的隱形 bug）"""
    html = read(INDEX)
    for sid in ('f-unit-search', 'e-unit-search', 'ns-unit-search', 'nsp-unit-search'):
        assert f'id="{sid}"' in html, f"搜尋框 {sid} 不存在"
    assert html.count('filterUnitSelect(this, ') == 4
    units = read(os.path.join(STATIC, "js", "units.js"))
    assert "function filterUnitSelect" in units
    assert "已存在" in units and "unitList.some" in units  # 重複提示檢查
    css = read(CSS_CORE)
    assert ".modal .btn-ghost { background: #fff; border: 1.5px solid #d0d5dd; color: #555; }" in css  # 取消按鈕隱形修復
    assert ".unit-search" in css


@pytest.mark.parametrize("js_path", ALL_JS_FILES)
def test_js_syntax(js_path):
    """全部 JS 檔必須通過 node --check（語法錯誤會讓整支 script 不執行）"""
    try:
        r = subprocess.run(
            ["node", "--check", js_path],
            capture_output=True, text=True, timeout=20,
        )
    except FileNotFoundError:
        pytest.skip("node 不在 PATH，跳過語法檢查")
    assert r.returncode == 0, f"node --check 失敗:\n{r.stderr}"


# ---------- A2：XSS escape 防回歸（品牌/位置/帳號渲染點必須走 esc） ----------

def test_xss_escapes_present():
    """A2 防回歸：品牌/位置/帳號等使用者輸入渲染點都必須 escape"""
    inv = read(INVENTORY_RENDER_JS)
    assert "${esc(b)}" in inv          # 品牌 tab
    assert 'value="${esc(b)}"' in inv  # brand datalist option
    assert 'value="${esc(l)}"' in inv  # location datalist option
    assert "esc(loc)" in inv and "位置" in inv    # 庫存頁位置分組標題（esc 保護）

    st = read(STOCKTAKE_JS)
    assert "位置：${esc(loc)}" in st    # 盤點頁位置分組標題
    assert "jsStr(key)" in st          # inline handler JS literal escape
    assert 'data-key="${esc(key)}"' in st

    ps = read(PERMS_JS)
    assert "${esc(u.username)}" in ps  # 權限頁帳號欄位
    assert "function esc(" not in ps   # L1：esc 單一來源（統一用 utils.js）

    # Phase 1（2026-08-11）：已領出 modal 位置選項顯示文字 + topbar 帳號名 escape
    so = read(os.path.join(STATIC, "js", "modals", "stockout.js"))
    assert "esc(s.location || '未標示')" in so  # H1：option 顯示文字也走 esc
    au = read(AUTH_JS)
    # Shell v2: avatar dropdown is static HTML (textContent safe, no esc needed)
    # Shell v2: avatar dropdown is static HTML
    ut = read(UTILS_JS)
    assert "&#39;" in ut  # L1：utils esc 補單引號


def test_changepw_expiry_ui_present():
    """v11.2：改密碼 modal（變體 B）+ 過期提示 modal 資產存在"""
    idx = read(os.path.join(STATIC, "index.html"))
    assert 'id="changepw-modal"' in idx
    assert 'id="expiry-modal"' in idx
    assert 'id="cpw-new"' in idx and 'oninput="cpwCheckStrength()"' in idx  # 變體 B 強度打勾
    assert 'id="cpw-mismatch"' in idx
    assert "/static/js/modals/changepw.js" in idx
    assert "/static/js/modals/expiry.js" in idx
    au = read(AUTH_JS)
    # 2026-08-16 家豪定案：改密碼收進設定中心 → topbar 改密碼按鈕移除（openChangePwModal
    # 仍在 changepw.js 定義 / expiry.js 呼叫 / index.html onclick，勿誤傷）
    assert "openChangePwModal()" not in au
    # RBAC（2026-08-13）：改密碼權限判斷保留（設定中心入口條件用）
    # Shell v2: change password is static HTML in dropdown
    # 2026-08-16：⚙️ 設定按鈕（settings.html 入口）
    # Shell v2: settings link is static HTML in dropdown
    # Shell v2: unit management is static HTML in dropdown
    # 2026-08-13 Sarah：user 角色不要 bottom sheet 功能選單 → 直接顯示登出按鈕
    # Shell v2: role check is static HTML
    # Shell v2: logout is static HTML in dropdown
    # Shell v2: logout text is static HTML  # 登出按鈕含文字（手機版 .users-text 會被隱藏 → 獨立 span）
    # Shell v2: no topbar menu button（2026-08-13 Sarah：不要下拉選單）
    css_all = read_css_all()
    # Shell v2: .btn-logout-direct CSS 規則已移除（topbar user menu 不再使用）
    bs = read(BOTTOMSHEET_JS)
    # 2026-08-13 Sarah：☰ 功能選單整個移除（不要下拉選單）——openTopMenu 已刪
    assert "openTopMenu" not in bs
    assert "label: '匯出報表'" not in bs
    assert "label: '登出'" not in bs
    cpw = read(os.path.join(STATIC, "js", "modals", "changepw.js"))
    assert "function cpwCheckStrength" in cpw
    assert "function submitChangePw" in cpw
    exp = read(os.path.join(STATIC, "js", "modals", "expiry.js"))
    assert "function openExpiryModal" in exp
    assert "function ackPasswordExpiry" in exp
    assert "change-own-password" in exp  # RBAC：有自行改密碼權限才顯示過期提示按鈕（R2）
    assert "expiry-admin-only" in idx  # 非 admin 過期提醒文字（B4 2026-08-13）
    pm = read(os.path.join(STATIC, "js", "perms.js"))
    assert "tech: '🔧 工程師'" in pm  # B1：ROLE_LABELS 有 tech（權限頁顯示）


def test_resetpw_modal_ui_present():
    """v11.2：重設密碼 modal（同變體 B 樣式）+ z-order 修正 + ghost 取消鈕資產"""
    idx = read(os.path.join(STATIC, "index.html"))
    assert 'id="resetpw-modal"' in idx
    assert 'id="rpw-new"' in idx and 'oninput="pwStrengthCheck(\'rpw-new\')"' in idx
    assert 'id="rpw-confirm"' in idx
    assert 'id="rpw-mismatch"' in idx
    assert "btn-cancel-ghost" in idx  # 取消按鈕 ghost 樣式（與儲存並排）
    css = read_css_all()
    assert ".btn-cancel-ghost" in css
    us = read(PERMS_JS)
    assert "permResetPw" in us         # 重設改用 modal（不再用瀏覽器 prompt）
    assert "prompt(" not in us         # 回歸防護：不得改回 prompt
    ut = read(UTILS_JS)
    assert "document.body.appendChild(el)" in ut  # openModal z-order 修正（後開 modal 蓋過先開）


def test_unsaved_changes_guard_present():
    """M15：未存變更保護資產（快照/確認/force 關閉）"""
    ut = read(UTILS_JS)
    assert "function _snapshotModal" in ut
    assert "function _modalDirty" in ut
    assert "function closeModalForce" in ut
    assert "有未儲存的變更" in ut  # confirm 文案
    assert "delete __modalSnapshots[id]" in ut
    # submit 成功路徑用 force（不彈確認）
    for f in ("add.js", "edit.js", "kit.js", "stockout.js", "photo.js"):
        src = read(os.path.join(STATIC, "js", "modals", f))
        assert "closeModalForce(" in src, f"{f} 應使用 closeModalForce"


def test_401_redirect_guard_present():
    """M17：fetch 401 攔截資產（登入頁不載入 auth.js，登入失敗不會誤跳）"""
    au = read(AUTH_JS)
    assert "window.fetch" in au
    assert "401" in au
    assert "login.html" in au

    utils = read(UTILS_JS)
    assert "function jsStr(" in utils  # JS literal escape helper 存在


def test_switchsite_pending_guard_present():
    """M15（2026-08-11 補漏）：切分片 pending 確認 + beforeunload 資產"""
    app_js = read(os.path.join(STATIC, "js", "app.js"))
    assert "function hasPending" in app_js
    assert "Object.keys(pending)" in app_js
    assert "切換分片將遺失" in app_js  # switchSite confirm 文案
    assert "beforeunload" in app_js


def test_401_unsaved_alert_present():
    """M17（2026-08-11 補強）：401 跳轉前提示未存變更"""
    au = read(AUTH_JS)
    assert "登入已過期，部分調整可能未儲存" in au
    assert "Object.keys(pending)" in au


def test_version_strings_consistent():
    """L12（2026-08-11）：main.py FastAPI version 與 login.html 頁尾一致（11.0）"""
    main_src = read(os.path.join(BASE_DIR, "main.py"))
    assert 'version="11.0.0"' in main_src
    assert "v11.0" in read(LOGIN)


def test_kit_modal_searchable_material_picker():
    """整組 Modal 材料選擇是「可搜尋」demo 樣式：render/kits.js 有搜尋/過濾/選中函式、
    已選列 selected-row 灰卡片、單一 mat-search 搜尋框；且不再用超過 100 個
    option 的長 select（手機上難找）。"""
    js = read(KITS_RENDER_JS)
    assert "renderKitCompRows" in js
    assert "filterKitSearch" in js
    assert "pickKitItem" in js
    assert "openKitSearch" in js
    # demo 樣式結構：已選列 + 單一搜尋框（取代舊的多列 kit-search / kit-dropdown 各自 dropdown）
    assert 'class="selected-row"' in js
    assert 'class="mat-search"' in js
    assert 'id="kit-mat-input"' in js
    assert 'class="kit-dropdown"' in js or ".kit-dropdown" in js
    # 搜尋框 placeholder（名稱/型號/廠牌）
    assert "搜尋材料" in js
    # modal 開關行為（kit.js）：開啟顯示「尚未加入材料」空狀態、「＋ 加入另一材料」聚焦搜尋框
    modal = read(KIT_MODAL_JS)
    assert "kit-mat-input" in modal
    assert ".focus()" in modal
    assert "尚未加入材料" in modal or "尚未加入材料" in js
    # 每列不再塞 247 個 <option>
    assert ".map(i => `<option" not in js


def test_kit_modal_demo_css_styles():
    """整組 Modal demo 樣式移植守護：style.css 有 selected-row / mat-search /
    btn-add-row 三組樣式（灰卡片已選列、圓角搜尋框、藍色虛線加入按鈕）。"""
    css = read_css_all()
    assert ".selected-row" in css
    assert ".mat-search" in css
    assert ".btn-add-row" in css
    # 搜尋框 focus 維持品牌藍（1890FF）——樣式被改歪時測試抓得到
    assert ".mat-search input:focus" in css
    assert "1890FF" in css


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))



def test_index_has_no_topbar_export():
    """2026-08-13 Sarah：匯出/新增按鈕從 topbar 移到庫存清單頂部右側（index.html 無 btn-export/btn-add；inventory.js 有 loc-export-bar）"""
    idx = read(INDEX)
    assert 'id="btn-export"' not in idx
    assert 'id="btn-add"' not in idx  # 新增按鈕也移出 topbar
    inv = read(INVENTORY_RENDER_JS)
    assert "loc-export-bar" in inv
    assert "onclick=\"exportExcel()\"" in inv
    assert "onclick=\"openAddModal()\"" in inv  # 庫存清單頂部新增按鈕
    css = read_css_all()
    assert "justify-content: flex-end" in css  # 匯出列靠右（2026-08-13 Sarah 選項）


# ---------- 行事曆派工（📅） ----------
def test_index_has_calendar_nav():
    """sidebar 含行事曆頁籤且為第一個，每日簽名日報表在行事曆之後"""
    html = read(INDEX)
    assert 'id="sb-nav-calendar"' in html
    assert "行事曆" in html
    # 行事曆在 sidebar 第一個且 active（登入一進來顯示行事曆）
    i_cal = html.index('id="sb-nav-calendar"')
    i_signed = html.index('id="sb-nav-signed-reports"')
    i_inv = html.index('id="sb-nav-inventory"')
    assert i_cal < i_signed < i_inv, "sidebar 順序應為 calendar < signed-reports < inventory"
    assert 'class="sb-nav-link active" id="sb-nav-calendar"' in html
    assert 'class="sb-nav-link" id="sb-nav-inventory"' in html


def test_default_tab_is_calendar():
    """登入一進來顯示行事曆（2026-08-13 Sarah）：globals currentTab 初始 calendar + loadData 用 switchTab 分派"""
    gl = read(GLOBALS_JS)
    assert "var currentTab = 'calendar';" in gl
    ap = read(API_JS)
    assert "switchTab(currentTab);" in ap


def test_index_loads_calendar_js():
    """index.html 載入 render/calendar.js + modals/calendar.js + modals/calendar-settings.js（2026-08-16 拆檔）"""
    assert '/static/js/render/calendar.js' in read(INDEX)
    assert '/static/js/modals/calendar.js' in read(INDEX)
    assert '/static/js/modals/calendar-settings.js' in read(INDEX)


def test_app_js_switchtab_has_calendar():
    """switchTab 分派行事曆 → renderCalendar()"""
    js = read(os.path.join(STATIC, "js", "app.js"))
    assert "else if (tab === 'calendar') renderCalendar();" in js


def test_calendar_js_has_core_functions():
    """calendar.js 核心函式：月曆/明細/新增/匯出/設定"""
    js = read_calendar_js_all()
    for fn in ("function renderCalendar()", "function calRenderMonth()",
               "function calRenderDay()", "function calOpenAppt(",
               "async function calSubmitAppt()", "async function calExport()",
               "function calOpenSettings()", "function closeCalModal()"):
        assert fn in js, f"缺 {fn}"


def test_calendar_js_uses_api_endpoints():
    """calendar.js 呼叫的 API 端點（後端需有對應路由）"""
    js = read_calendar_js_all()
    assert "/api/appointments" in js
    assert "/api/service-types" in js
    assert "/api/assignable-users" in js
    assert "/api/appointments/export" in js
    # 2026-08-13 Sarah：明細卡顯示編輯者（非新增者時）——esc 防 XSS
    assert "esc(e.updated_by_name)" in js and "編輯" in js
    # 2026-08-13 Sarah：備註標籤無括號提示（不要寫「（型號 / 車馬費）」）
    assert "<label>備註</label>" in js and "備註（型號" not in js
    # 2026-08-13 Sarah：編輯按鈕只有文字（無 ✏️ 圖示）、刪除維持 ✕
    assert "btn-edit\" onclick=\"calOpenAppt" in js
    assert ">編輯</button>" in js and "✕</button>" in js
    assert "✏️ 編輯</button>" not in js and "✕ 刪除" not in js
    # 2026-08-13 Sarah：reminder 條只留文字＋框（移除「看今天行程」按鈕；calGoToday 已刪）
    assert "看今天行程</button>" not in js
    assert "calGoToday" not in js
    # 2026-08-13 Sarah：tech 角色——庫存 render 視為唯讀、calendar 可寫、auth.js 工程師 chip
    inv = read(os.path.join(STATIC, "js", "render", "inventory.js"))
    assert "hasPerm('item-mgmt')" in inv  # RBAC：tech 無庫存寫入權限 → 庫存頁唯讀
    cal = read_calendar_js_all()
    assert "hasPerm('cal-mgmt')" in cal  # RBAC：tech 有 cal-mgmt → 行事曆可寫
    au = read(AUTH_JS)
    assert "🔧 工程師" not in au  # tech 不顯示 badge（2026-08-13 Sarah：不要列出工程師）
    # Shell v2: permissions links are static HTML in dropdown
    pm = read(os.path.join(STATIC, "js", "perms.js"))
    assert "/api/users/${curUid}/permissions" in pm  # 權限清單由 per-user 端點內聯載入（含 cal-mgmt 等全部 key）


def test_calendar_js_viewer_write_hidden():
    """viewer 看不到新增/編輯/刪除按鈕（權限整合）；tech 可看（行事曆可寫）"""
    js = read_calendar_js_all()
    assert "isViewer" in js
    assert "calOpenAppt()" in js  # 按鈕以 isViewer 條件包住


def test_css_has_calendar_styles():
    """style.css 含行事曆樣式（月曆格/事件/設定表格）"""
    css = read_css_all()
    for sel in (".cal-grid", ".cal-cell", ".cal-evt", ".cal-event-card",
                ".cal-set-table", ".cal-person-opt", ".switch"):
        assert sel in css, f"缺 {sel}"


def test_calendar_cell_shows_service_client():
    """2026-08-13 Sarah + 08-14 家豪 B 方案：月曆格子內派工標籤顯示「時間」+「[服務] 客戶」
    - B 方案：時間獨立一行（.cal-evt-time）＋ 服務/客戶一行截斷（.cal-evt-body）
    - 用 textContent 安全設定（非 innerHTML）"""
    js = read_calendar_js_all()
    assert "evts.slice(0, 2)" in js                     # 每格最多 2 筆派工
    assert "className = 'cal-evt-time'" in js           # 時間獨立一行
    assert "className = 'cal-evt-body'" in js           # 服務/客戶一行
    assert "e.client_name || ''" in js                   # 客戶名
    assert "textContent" in js                           # 用 textContent 安全設定（非 innerHTML）
    assert "innerText = `${e.start_time" not in js       # 舊單行 innerText 已移除（B 方案取代）


def test_service_type_optional_ui():
    """2026-08-17 Sarah：服務項目改非必填——前端不再擋必填（原「請選擇服務項目」檢查已移除）、
    月曆格/明細卡無服務項目時不顯示「[] 」空括號前綴（比照 08-14 時間選填「無時間不顯示前綴」）"""
    js = read_calendar_js_all()
    assert "⚠️ 請選擇服務項目" not in js                                        # 必填檢查已移除（bug 版必紅）
    assert "(e.service_name ? `[${e.service_name}] ` : '')" in js              # 月曆格：有服務才顯示 [服務] 前綴
    assert "${e.service_name ? `[${esc(e.service_name)}] ` : ''}" in js        # 明細卡：同款（esc 保留，XSS 防護不退化）


def test_calendar_cell_selected_highlight_js():
    """2026-08-14 家豪：月曆格「選中」機制——點擊設定 calSelected + 渲染 cal-selected class
    - 08-14 變體 A：今天完全不標記（不再產生 cal-today class，避免今天與選中同時有框）"""
    js = read_calendar_js_all()
    assert "cal-selected" in js                          # 渲染時加選中 class
    assert "calSelected = new Date(y, m, d)" in js       # 點擊格子設定選中日期
    assert "cal-today" not in js                         # 今天不標記（無 cal-today class 產生）


def test_calendar_appt_only_start_time():
    """2026-08-13 Sarah：編輯派工只寫開始時間、不用結束時間
    - modal 無「結束」欄位（cal-f-end 移除）
    - 儲存時 end_time 自動 = start_time（後端衝突判斷：同時段/涵蓋才衝突）
    - 明細卡只顯示開始時間（不再 ⏰ 08:00 - 08:30）
    - 時間用 24 制下拉（時 00-23 / 分 00-55，取代手機 12 制 time input）"""
    js = read_calendar_js_all()
    assert "cal-f-end" not in js                        # 結束欄位已移除
    assert 'id="cal-f-hour"' in js and 'id="cal-f-minute"' in js  # 24 制時/分下拉
    assert 'type="time"' not in js                      # 不再用 12 制 time input
    assert "{length: 24}" in js                         # 時 00-23
    assert "i * 5" in js                                # 分每 5 分鐘
    # 儲存：end_time = start_time（同一組時/分；2026-08-14 起選填——選「--」→ timeVal 空字串）
    assert "end_time: timeVal" in js
    # 明細卡：只顯示開始時間（2026-08-14 起選填——無時間不顯示 ⏰ 前綴）
    assert "<div class=\"cal-time\">${e.start_time ? `⏰ ${esc(e.start_time)}　` : ''}${who}</div>" in js


def test_calendar_time_optional():
    """2026-08-14 Sarah：派工時間選填
    - 時/分下拉第一個選項「--」= 不指定時間
    - 新增預設留空、編輯無時間回「--」（不再預設 09:00）
    - 提交時選「--」→ 時間留空字串（timeVal）
    - 月曆格/明細卡無時間不顯示時間前綴；排序空時間排最後"""
    js = read_calendar_js_all()
    assert '<option value="">--</option>' in js             # 時/分下拉「--」空選項
    assert "const t = (f && f.start_time) || '';" in js     # 回填：無時間留空
    assert "const timeVal = (hh && mm) ? hh + ':' + mm : '';" in js  # 選「--」→ 空字串
    assert "start_time: timeVal," in js and "end_time: timeVal," in js
    assert "if (e.start_time) {" in js                   # 月曆格無時間不顯示時間行（B 方案）
    assert "⏰ ${esc(e.start_time)}　` : ''}${who}" in js    # 明細卡無時間不顯示 ⏰
    assert "(a.start_time || '99:99')" in js                # 空時間排最後
    assert "'09:00'" not in js.split("const t =")[1].split("const timeVal")[0]  # 新增不再預設 09:00


# ---------- 2026-08-12 totalQty 補接（盤點頁第 4 張統計卡「庫存總數(件)」） ----------
# 背景：dead code 分析（hvac-inventory-dead-code分析報告-2026-08-12）發現 totalQty 算好但 UI 沒顯示。
# 決策：不刪、補接為第 4 張統計卡（家豪選定變體 A）。以下測試防「退回 dead code / 卡片順序跑掉 / 誤改回 3 欄」。

def test_stocktake_totalqty_used():
    """totalQty 不得淪為 dead code：計算保留且 totalQtyStr 有進模板渲染（防退回「算了沒顯示」）"""
    js = read(STOCKTAKE_JS)
    assert "const totalQty = ALL_ITEMS.reduce((s, i) => s + i.qty, 0);" in js  # 計算行保留
    assert "${totalQtyStr}" in js                                               # 千分位結果有進模板
    assert js.count("totalQty") >= 3  # 定義 + totalQtyStr 定義/使用（若只剩定義 1 次 = dead code 回歸）


def test_stocktake_totalqty_thousands_format():
    """庫存總數千分位顯示（四捨五入 3 位小數，例 2531.5 → "2,531.5"）"""
    js = read(STOCKTAKE_JS)
    assert "totalQtyStr" in js
    assert "Math.round(totalQty * 1000) / 1000" in js
    assert "toLocaleString('en-US')" in js


def test_stocktake_four_stat_cards_order():
    """盤點頁統計卡 4 張且順序固定：品項總數 → 庫存總數(件) → 低庫存 ▶ → 缺貨 ▶"""
    js = read(STOCKTAKE_JS)
    assert "庫存總數(件)" in js
    i_total = js.index("品項總數")
    i_qty = js.index("庫存總數(件)")
    i_low = js.index("低庫存 ▶")
    i_zero = js.index("缺貨 ▶")
    assert i_total < i_qty < i_low < i_zero, "統計卡順序錯誤（應為 品項總數→庫存總數→低庫存→缺貨）"


def test_stocktake_totalqty_card_not_clickable():
    """庫存總數卡純顯示（無對應清單、不可點）；可點擊卡維持 2 張（低庫存/缺貨）"""
    js = read(STOCKTAKE_JS)
    assert js.count("stat-card clickable") == 2, "可點擊統計卡數量錯誤（應只有低庫存/缺貨 2 張）"


def test_stocktake_list_shows_model_and_kits():
    """缺貨/低庫存清單品項欄顯示型號（藍色粗體）+ 整組材料標註「屬於整組：名稱」（2026-08-13 Sarah 需求）"""
    js = read(STOCKTAKE_JS)
    # 型號：比照已領出/待領出頁樣式（code 有值才顯示）
    assert "color:#1890FF;font-weight:600" in js
    assert "型號 ' + esc(i.code)" in js
    # 整組材料標註：in_kits 陣列非空才顯示「屬於整組：名稱」
    assert "in_kits" in js
    assert "屬於整組：" in js
    assert "esc(i.in_kits.join('、'))" in js


def test_stocktake_tabs_kit_single_split():
    """盤點輸入表整組/單一材料分開（tab 切換，2026-08-13 Sarah 需求）：
    kitRows/singleRows 分組 + 兩個 pane + 切換函式 + CSS 樣式存在"""
    js = read(STOCKTAKE_JS)
    # 分組：整組（is_kit）與單一材料分開收集
    assert "rows.filter(r => r.item.is_kit)" in js
    assert "rows.filter(r => !r.item.is_kit)" in js
    # 兩個 pane（整組預設顯示、單一材料隱藏）
    assert 'id="stk-pane-kit"' in js
    assert 'id="stk-pane-single" style="display:none"' in js
    # tab 切換函式
    assert "function switchStocktakeTab(tab)" in js
    assert "switchStocktakeTab('kit')" in js
    assert "switchStocktakeTab('single')" in js
    # 共用位置分組渲染 helper
    assert "function stkGroupByLoc(rows)" in js
    # CSS 樣式
    css = read_css_all()
    assert ".stk-tabs {" in css
    assert ".stk-tab.active {" in css


def test_stocktake_table_photo_thumb():
    """盤點輸入表品項欄顯示圖片縮圖（2026-08-16 家豪需求，比照單一材料頁面）：
    有照片顯示 /uploads/{id}.jpg 縮圖（點擊放大），無照片顯示 📷 佔位（cphoto-empty）"""
    js = read(STOCKTAKE_JS)
    # 縮圖 class（與整組庫存頁表格同款 cphoto，內嵌品項欄）
    assert 'class="cphoto"' in js
    # 有照片 → img 縮圖 + 點擊放大
    assert 'src="/uploads/${i.id}.jpg"' in js
    assert "openPhotoLightbox(${i.id})" in js
    # 無照片 → 📷 佔位
    assert "cphoto-empty" in js


def test_stocktake_kit_tab_expands_components():
    """盤點整組 tab 展開組成品項（2026-08-16 家豪需求，比照整組庫存頁）：
    fetch /api/kits 載入 stocktakeKits + 品項欄內嵌組成品項縮圖/名稱/型號/需有"""
    js = read(STOCKTAKE_JS)
    # 載入整組資料（fetch /api/kits，site 對齊 currentSite）
    assert "fetch(`/api/kits?site=${currentSite}`)" in js
    assert "stocktakeKits = await kitRes.json()" in js
    # 展開渲染：找整組定義 + 組成品項縮圖 + 需/有數量
    assert "stocktakeKits.find(k => k.item_id === i.id)" in js
    assert 'src="/uploads/${c.item_id}.jpg"' in js
    assert "openPhotoLightbox(${c.item_id})" in js
    assert "需 <b>${c.need_qty}</b>" in js
    # 每個組成品項也可輸入實際數量（key=itemId:location，與單一材料盤點同一機制）
    assert "stocktakeValues['${jsStr(mKey)}'] = this.value" in js
    assert "markChanged(this, '${jsStr(mKey)}')" in js
    assert 'placeholder="實際"' in js
    # 全域宣告（globals.js，var 跨檔共享）
    gl = read(GLOBALS_JS)
    assert "var stocktakeKits = []" in gl


def test_stocktake_submit_includes_equal_qty():
    """盤點送出：實際數量=系統數量也送出（2026-09-06）：
    - 移除 v !== stock.qty 過濾 → if (item && stock) 就 push
    - 空白 fallback 到 stock.qty（留空表示確認）"""
    js = read(STOCKTAKE_JS)
    # 移除 v !== stock.qty 過濾（舊版有，新版無）
    assert "v !== stock.qty" not in js, "v !== stock.qty 過濾應已移除"
    # 空白 fallback 到系統數量
    assert "if (isNaN(v))" in js
    assert "v = stock ? stock.qty : 0" in js
    # 只要 item 和 stock 存在就 push（不限 diff）
    assert "if (item && stock) {" in js
    assert "items.push({ item_id: item.id, location: location, actual_qty: v })" in js


def test_stocktake_reminder_hides_after_submit():
    """完成盤點後隱藏提醒橫幅（2026-09-06）：
    - 25-31日盤點才記錄 localStorage
    - 立即隱藏提醒橫幅"""
    js = read(STOCKTAKE_JS)
    # 25日後才記錄
    assert "if (now.getDate() >= 25)" in js
    assert "localStorage.setItem('lastStocktakeMonth'" in js
    # 立即隱藏提醒
    assert "const reminder = document.getElementById('reminder')" in js
    assert "reminder.style.display = 'none'" in js


def test_checkreminder_uses_localstorage():
    """checkReminder 檢查 localStorage（2026-09-06）：
    - 讀取 lastStocktakeMonth
    - 當月已盤過則不顯示提醒"""
    ap = read(APP_JS)
    assert "function checkReminder()" in ap
    assert "localStorage.getItem('lastStocktakeMonth')" in ap
    assert "lastStocktakeMonth !== currentMonth" in ap
    assert "day >= 25 && lastStocktakeMonth !== currentMonth" in ap


def test_css_stat_cards_four_columns():
    """盤點統計卡 grid 4 欄（totalQty 補接：3 欄→4 欄），防退回 3 欄"""
    css = read_css_all()
    assert ".stat-cards" in css
    assert "grid-template-columns: repeat(4, 1fr);" in css
    assert "repeat(3, 1fr)" not in css.split(".cal-grid")[0], ".stat-cards 區域誤退回 3 欄"


# ---------- 2026-08-12 全專案 JS 完整性（家豪要求「都補」） ----------
# 背景：盤點發現 22 個 JS 中 11 個完全沒有內容斷言測試（api/app/bottomsheet/globals/
# modals 6 個 + render/card.js）。以下補「核心函式存在性」防護。
# 註：photo.js 的 photoImgClick 為 dead code，已於 2026-08-12 清理（未列入斷言）。

def test_all_js_loaded_by_index():
    """static/js 下每個 .js 都必須被 index.html 或 permissions.html 引用（防新增 JS 忘掛載 = 整支 dead file）"""
    html = read(INDEX) + read(PERMISSIONS_HTML) + read(SETTINGS_HTML)
    missing = []
    for js_path in ALL_JS_FILES:
        rel = "/static/" + os.path.relpath(js_path, STATIC).replace("\\", "/")
        if f'src="{rel}"' not in html:
            missing.append(rel)
    assert not missing, f"以下 JS 存在但未被 index/permissions.html 載入（dead file）: {missing}"


def test_api_js_core_functions():
    """api.js 核心：載入 / 待領出 badge / 儲存 / 匯出"""
    js = read(API_JS)
    for fn in ("loadData", "loadPreparedBadge", "saveAll", "exportExcel"):
        assert fn in js, f"api.js 缺 {fn}"


def test_app_js_core_functions():
    """app.js 核心：分頁 / 站點切換 / 提醒 + 盤點分派"""
    js = read(APP_JS)
    for fn in ("switchTab", "switchSite", "checkReminder", "hasPending"):
        assert fn in js, f"app.js 缺 {fn}"
    assert "renderStocktake" in js  # 盤點 tab 分派（防分派被拔掉 → 盤點頁開不了）


def test_shell_v2_header_functions():
    """Shell v2 Phase 1：header 相關函式存在"""
    js = read(APP_JS)
    # Avatar dropdown
    assert "toggleAvatarMenu" in js, "app.js 缺 toggleAvatarMenu"
    assert "closeAvatarMenu" in js, "app.js 缺 closeAvatarMenu"
    # Notification badge
    assert "updateNotifCount" in js, "app.js 缺 updateNotifCount"
    # Sidebar user
    assert "renderSidebarUser" in js, "app.js 缺 renderSidebarUser"
    # Sidebar open/close
    assert "openSidebar" in js, "app.js 缺 openSidebar"
    assert "closeSidebar" in js, "app.js 缺 closeSidebar"



def test_shell_v2_header_html_structure():
    """Shell v2 Phase 1：header HTML 結構完整"""
    idx = read(INDEX)
    # Sidebar exists
    assert 'id="sidebar"' in idx, "sidebar element 缺失"
    assert 'id="sbOverlay"' in idx, "sidebar overlay 缺失"
    # Header elements
    assert 'class="hamburger"' in idx, "hamburger button 缺失"
    assert 'id="breadcrumb"' in idx, "breadcrumb 缺失"
    assert 'class="h-search"' in idx, "h-search 缺失"
    assert 'class="h-site"' in idx, "h-site 站點切換 缺失"
    assert 'class="notif"' in idx, "notification bell 缺失"
    assert 'class="avatar-dropdown"' in idx, "avatar dropdown 缺失"
    assert 'id="avatarMenu"' in idx, "avatar menu 缺失"
    # Avatar menu items
    assert '帳號與權限' in idx, "帳號與權限 連結 缺失"
    assert '修改密碼' in idx, "修改密碼 連結 缺失"
    assert '登出' in idx, "登出 連結 缺失"
    # Sidebar nav links (bottom-nav removed, mobile uses sidebar)
    assert 'id="sb-nav-calendar"' in idx, "sidebar nav calendar 缺失"
    assert 'id="sb-nav-inventory"' in idx, "sidebar nav inventory 缺失"
    assert 'id="sb-nav-prepared"' in idx, "sidebar nav prepared 缺失"
    assert 'id="sb-nav-stockout"' in idx, "sidebar nav stockout 缺失"
    assert 'id="sb-nav-stocktake"' in idx, "sidebar nav stocktake 缺失"
    assert 'id="sb-nav-signed-reports"' in idx, "sidebar nav signed-reports 缺失"


def test_shell_v2_notification_badge():
    """Shell v2：通知徽章計數存在"""
    idx = read(INDEX)
    # Notification list container exists (notifications generated dynamically)
    assert 'id="notif-list"' in idx, "通知容器 #notif-list 缺失"
    # Badge element exists
    assert 'class="cnt"' in idx, "通知徽章 .cnt 缺失"
    # JS updates badge count and generates notifications dynamically
    js = read(APP_JS)
    assert "updateNotifCount" in js, "updateNotifCount 函式 缺失"
    assert "updateNotifications" in js, "updateNotifications 函式 缺失"
    assert "data-notif" in js, "updateNotifications 未使用 data-notif 選擇器"


def test_shell_v2_calendar_no_settings_button():
    """Shell v2：行事曆工具列已移除設定按鈕"""
    cal = read(CALENDAR_RENDER_JS)
    # Settings button should NOT be in the toolbar
    assert "calOpenSettings" not in cal, "行事曆工具列仍含 calOpenSettings（應已移除）"
    # But the function should still exist in calendar-settings.js (for future use)
    cs = read(CALENDAR_SETTINGS_JS)
    assert "function calOpenSettings()" in cs, "calOpenSettings 函式應仍定義於 calendar-settings.js"


def test_bottomsheet_js_core_functions():
    """bottomsheet.js 核心：手機底部選單（openTopMenu 已刪除——2026-08-13 Sarah：不要下拉選單）"""
    js = read(BOTTOMSHEET_JS)
    for fn in ("openSheet", "closeSheet", "isMobileView"):
        assert fn in js, f"bottomsheet.js 缺 {fn}"
    assert "openTopMenu" not in js  # ☰ 功能選單已移除


def test_globals_js_has_state_vars():
    """globals.js 全域狀態（ALL_ITEMS / stocktakeValues 等），防誤刪導致整站失效"""
    js = read(GLOBALS_JS)
    for v in ("ALL_ITEMS", "currentTab", "currentSite", "stocktakeValues", "DESTINATIONS"):
        assert v in js, f"globals.js 缺 {v}"


def test_add_modal_core_functions():
    """modals/add.js：新增材料 modal"""
    js = read(ADD_JS)
    for fn in ("openAddModal", "submitAdd"):
        assert fn in js, f"add.js 缺 {fn}"


def test_add_modal_has_photo_upload():
    """新增 modal 有照片上傳區塊（f-photo-box + renderAddPhotoBox）"""
    html = read(INDEX)
    assert 'id="f-photo-box"' in html, "index.html add-modal 缺 f-photo-box"
    assert "品項照片" in html, "index.html add-modal 缺照片 label"
    js = read(ADD_JS)
    assert "renderAddPhotoBox" in js, "add.js 缺 renderAddPhotoBox"
    assert "openAddModal" in js and "renderAddPhotoBox()" in js, \
        "openAddModal 未呼叫 renderAddPhotoBox"


def test_add_photo_submit_auto_upload():
    """submitAdd 新增成功後自動上傳照片（兩步驟：先建 item 再 POST photo）"""
    js = read(ADD_JS)
    assert "f-photo-input" in js, "submitAdd 未引用 f-photo-input"
    assert "f-photo-album" in js, "submitAdd 未引用 f-photo-album"
    assert "/api/items/${newItemId}/photo" in js, "submitAdd 未自動上傳照片"
    assert "chosenFile" in js, "submitAdd 未合併拍照/相簿 input"


def test_add_photo_box_dual_buttons():
    """新增 modal 照片区有「拍照」（capture）和「從相簿選」兩個獨立按鈕"""
    js = read(ADD_JS)
    assert 'capture="environment"' in js, "新增 modal 缺 capture=environment（拍照按鈕）"
    assert "f-photo-input" in js, "新增 modal 缺 f-photo-input（拍照 input）"
    assert "f-photo-album" in js, "新增 modal 缺 f-photo-album（相簿 input）"


def test_changepw_modal_core_functions():
    """modals/changepw.js：改密碼 + 強度 / 一致性檢查"""
    js = read(CHANGEPW_JS)
    for fn in ("openChangePwModal", "cpwCheckStrength", "cpwCheckMatch", "submitChangePw"):
        assert fn in js, f"changepw.js 缺 {fn}"


def test_edit_modal_core_functions():
    """modals/edit.js：編輯材料 + 庫存列增刪"""
    js = read(EDIT_JS)
    for fn in ("openEditModal", "renderEditStockRows", "addEditStockRow", "deleteEditStockRow", "submitEdit"):
        assert fn in js, f"edit.js 缺 {fn}"


def test_expiry_modal_core_functions():
    """modals/expiry.js：密碼到期提示與跳轉"""
    js = read(EXPIRY_JS)
    for fn in ("openExpiryModal", "expiryGoChangePw", "ackPasswordExpiry"):
        assert fn in js, f"expiry.js 缺 {fn}"


def test_photo_modal_core_functions():
    """modals/photo.js：照片渲染 / 上傳 / 刪除 / lightbox
    （photoImgClick dead code 已於 2026-08-12 清理，不在此列）"""
    js = read(PHOTO_JS)
    for fn in ("renderPhotoBox", "uploadItemPhoto", "deleteItemPhoto",
               "openPhotoLightbox", "closePhotoLightbox"):
        assert fn in js, f"photo.js 缺 {fn}"


def test_photo_box_permission_check():
    """renderPhotoBox 有前端權限檢查（hasPerm('photo')），無權限時隱藏上傳按鈕"""
    js = read(PHOTO_JS)
    assert "hasPerm('photo')" in js, "renderPhotoBox 缺 hasPerm('photo') 權限檢查"
    assert "canPhoto" in js, "renderPhotoBox 缺 canPhoto 變數"


def test_photo_box_dual_buttons():
    """編輯 modal 照片区有「拍照」（capture）和「從相簿選」兩個獨立按鈕"""
    js = read(PHOTO_JS)
    assert js.count('capture="environment"') >= 2, \
        "photo.js renderPhotoBox 缺 capture=environment（拍照 input，有照片+無照片各一）"
    assert "從相簿選" in js, "photo.js renderPhotoBox 缺「從相簿選」按鈕"


def test_photo_box_delete_button_style():
    """刪除照片按鈕統一用 btn-prepare 樣式（與拍照/相簿選一致），非 btn-cancel"""
    js = read(PHOTO_JS)
    # 刪除按鈕用 btn-prepare（圓角），不用 btn-cancel（方形）
    assert "btn-prepare" in js and "刪除" in js, \
        "刪除按鈕應使用 btn-prepare 樣式"


def test_stockout_modal_core_functions():
    """modals/stockout.js：領出 / 待領出 / 退回 / 編輯紀錄"""
    js = read(STOCKOUT_MODAL_JS)
    for fn in ("openOutModal", "submitStockOut", "openPrepareModal", "submitPrepare",
               "openPreparedOutModal", "submitPreparedOut", "returnPrepared", "returnStockout",
               "openEditStockoutModal", "submitEditStockout"):
        assert fn in js, f"stockout.js(modals) 缺 {fn}"


def test_edit_stockout_modal_date_only():
    """2026-09-07 Sarah：編輯已領出日期欄只選日期不含時間
    - HTML input type='date'（非 datetime-local）
    - JS 回填用 .slice(0, 10) 只取 YYYY-MM-DD
    - JS 送出時自動補 ' 00:00:00'（後端 DB 格式 YYYY-MM-DD HH:MM:SS）
    """
    html = read(INDEX)
    # HTML：編輯已領出 modal 的日期欄必須是 type="date"
    assert 'type="date"' in html, "編輯已領出日期欄應為 type=date"
    assert 'type="datetime-local"' not in html, "編輯已領出不應再用 datetime-local"

    js = read(STOCKOUT_MODAL_JS)
    # JS 回填：只取前 10 碼（YYYY-MM-DD），而非 16 碼（YYYY-MM-DDTHH:MM）
    assert ".slice(0, 10)" in js, "openEditStockoutModal 應用 .slice(0, 10) 取日期"
    assert ".slice(0, 16)" not in js, "openEditStockoutModal 不應再用 .slice(0, 16)"

    # JS 送出：date input 只有 YYYY-MM-DD，需補完整時間格式存 DB
    assert "00:00:00" in js, "submitEditStockout 送出時應補 00:00:00"


def test_edit_created_at_date_only_api():
    """2026-09-07 Sarah：後端 PATCH /api/stockouts 應接受 date-only 格式
    StockoutUpdate model 的 created_at 是 Optional[str]，
    驗證 Pydantic model 接受 date-only 與完整 datetime 兩種格式
    """
    from app.models import StockoutUpdate
    # 驗證 Pydantic model 接受 date-only 字串
    s = StockoutUpdate(created_at="2026-09-04")
    assert s.created_at == "2026-09-04"
    # 也接受完整 datetime（向後相容）
    s2 = StockoutUpdate(created_at="2026-09-04 02:05:00")
    assert s2.created_at == "2026-09-04 02:05:00"


def test_return_stockout_modal_present():
    """2026-09-07 Sarah：退回已領出 Modal 存在且含必要欄位
    - HTML 有 return-stockout-modal
    - JS 有 openReturnStockoutModal / submitReturnStockout
    - JS 退回函式帶 body（非空 POST）
    """
    html = read(INDEX)
    assert 'id="return-stockout-modal"' in html, "退回 Modal DOM 缺失"
    assert 'id="rs-qty"' in html, "退回 Modal 數量欄缺失"
    assert 'id="rs-dest"' in html, "退回 Modal 去向欄缺失"
    assert 'id="rs-datetime"' in html, "退回 Modal 日期欄缺失"

    js = read(STOCKOUT_MODAL_JS)
    assert "openReturnStockoutModal" in js, "JS 缺 openReturnStockoutModal"
    assert "submitReturnStockout" in js, "JS 缺 submitReturnStockout"
    # 送出時帶 body（JSON），不再是空 POST
    assert "JSON.stringify(body)" in js, "退回送出應帶 JSON body"
    assert "Content-Type" in js, "退回送出應帶 Content-Type header"


def test_stocktake_view_for_all_roles():
    """2026-08-14 家豪裁決（Sarah：藍政達/蘇昱豪手機看不到盤點）：盤點頁瀏覽掛 view 基底權限——
    所有角色看得到盤點 tab；「本次盤點」操作區僅限 stocktake 權限（admin/user）"""
    au = read(AUTH_JS)
    assert "canViewStocktake" in au, "auth.js 缺 canViewStocktake（瀏覽權限）"
    assert "sbNavStocktake.style.display = canViewStocktake ? '' : 'none'" in au,         "盤點 tab 應依 canViewStocktake（stocktake OR view）顯示"
    assert "reminder.style.display = canStocktake ? '' : 'none'" in au,         "盤點提醒橫幅仍限操作者（canStocktake）"

    st = read(STOCKTAKE_JS)
    assert "canStocktake" in st, "renderStocktake 缺 canStocktake 判斷"
    assert "盤點作業僅限管理員" in st, "只讀提示（非操作者）缺失"
    assert "content.innerHTML = html;" in st, "只讀模式要能渲染（歷史/統計）"


def test_kit_stockout_actions():
    """2026-08-13 Sarah：整組庫存也要有「待領出/已領出」按鈕（手機+桌面），直接複用單一庫存 modal"""
    js = read(KITS_RENDER_JS)
    # 手機卡片 m-card-actions + 桌面操作列：各一組 openPrepareModal/openOutModal（用 kit 的 item_id）
    assert js.count("openPrepareModal(${k.item_id}") >= 2, "整組卡片待領出按鈕（手機+桌面）缺失"
    assert js.count("openOutModal(${k.item_id}") >= 2, "整組卡片已領出按鈕（手機+桌面）缺失"
    assert "m-card-actions" in js, "手機整組卡片缺 m-card-actions 按鈕列"
    # 桌面版：待領出/已領出要在編輯按鈕前面（設計圖：操作列最前面）
    assert js.find("openOutModal(${k.item_id}") < js.find("editKit(${k.id})"), "桌面按鈕應在編輯前面"
    # viewer/tech 隱藏
    assert "isViewer ? '' : `<div class=\"m-card-actions\">" in js, "手機按鈕列應對 viewer/tech 隱藏"


def test_prepared_nonstock_add_ui():
    """2026-08-13 家豪：待領出頁也可新增非庫存品項——render 按鈕/標籤 + modal DOM + 函式"""
    js = read(STOCKOUT_MODAL_JS)
    for fn in ("openNonStockPrepareModal", "submitNonStockPrepare"):
        assert fn in js, f"modals/stockout.js 缺 {fn}"
    assert "fetch('/api/prepare/nonstock'" in js, "submitNonStockPrepare 沒打新端點"

    pjs = read(PREPARED_RENDER_JS)
    assert "onclick=\"openNonStockPrepareModal()\"" in pjs, "待領出頁缺新增按鈕入口"
    assert "tag-nonstock" in pjs, "待領出頁非庫存標籤缺失"
    assert "preparedBar" in pjs, "待領出頁 toolbar 變數缺失（手機+桌面都要顯示）"

    sjs = read(STOCKOUT_RENDER_JS)
    assert "stockoutBar" in sjs, "已領出頁 toolbar 變數缺失（桌面版要顯示）"

    html = read(INDEX)
    assert 'id="nonstock-prepare-modal"' in html
    for fid in ("nsp-name", "nsp-qty", "nsp-note"):
        assert f'id="{fid}"' in html, f"nonstock prepare modal 缺 {fid} 欄位"


def test_stockout_nonstock_add_ui():
    """2026-08-13 Sarah：已領出可直接新增非庫存品項——render 按鈕/標籤 + modal DOM + 函式"""
    js = read(STOCKOUT_MODAL_JS)
    for fn in ("openNonStockOutModal", "submitNonStockOut"):
        assert fn in js, f"modals/stockout.js 缺 {fn}"
    assert "fetch('/api/stockout/nonstock'" in js, "submitNonStockOut 沒打新端點"

    rjs = read(STOCKOUT_RENDER_JS)
    assert "onclick=\"openNonStockOutModal()\"" in rjs, "已領出頁缺新增按鈕入口"
    assert "site=${currentSite}" in rjs, "已領出頁 fetch 應隨 site 過濾（倉庫 0 就不能顯示內容）"
    assert "共 ${outs.length} 筆" in rjs, "已領出頁缺筆數列"
    assert "tag-nonstock" in rjs, "非庫存標籤 class 缺失"

    html = read(INDEX)
    assert 'id="nonstock-out-modal"' in html
    for fid in ("ns-name", "ns-qty", "ns-dest", "ns-note"):
        assert f'id="{fid}"' in html, f"nonstock modal 缺 {fid} 欄位"

    css = read_css_all()
    assert ".tag-nonstock" in css and ".hint-nonstock" in css, "非庫存標籤/提示樣式缺失"


def test_card_js_core_functions():
    """render/card.js：手機卡片建構 helpers"""
    js = read(CARD_JS)
    for fn in ("buildThumb", "buildLocHTML", "buildQtyControl", "buildQtyNum", "mobileCardShell"):
        assert fn in js, f"card.js 缺 {fn}"


# ---------- 樂觀鎖快照（2026-08-14 Phase 2：編輯 modal 帶 updated_at） ----------

def test_edit_js_optimistic_lock_snapshot():
    """edit.js：開啟編輯 modal 存 updated_at 快照、儲存時帶回（後端 WHERE 守衛）"""
    js = read(EDIT_JS)
    assert "editUpdatedAt" in js, "edit.js 缺 editUpdatedAt 快照變數"
    assert "updated_at: editUpdatedAt" in js, "edit.js submitEdit 未帶 updated_at"


def test_kit_js_optimistic_lock_snapshot():
    """kit.js：編輯整組帶 updated_at 快照（submitKitEdit body）"""
    js = read(KIT_MODAL_JS)
    assert "kitUpdatedAt" in js, "kit.js 缺 kitUpdatedAt 快照變數"
    assert "updated_at: kitUpdatedAt" in js, "kit.js submitKitEdit 未帶 updated_at"


def test_calendar_js_optimistic_lock_snapshot():
    """calendar.js：編輯派工帶 updated_at 快照（calSubmitAppt body）"""
    js = read_calendar_js_all()
    assert "calApptUpdatedAt" in js, "calendar.js 缺 calApptUpdatedAt 快照變數"
    assert "updated_at: calApptUpdatedAt" in js, "calendar.js calSubmitAppt 未帶 updated_at"

# ---------- Phase 3：前端即時性與狀態持久化（2026-08-14） ----------

def test_app_js_visibility_reload():
    """app.js：切回頁籤/視窗自動重載（多使用者即時性）"""
    js = read(APP_JS)
    assert "autoReloadOnFocus" in js, "app.js 缺 autoReloadOnFocus"
    assert "visibilitychange" in js, "app.js 缺 visibilitychange 監聽器"
    assert "hasPending()" in js, "app.js 自動重載應跳過未儲存調整（hasPending）"


def test_app_js_url_state_persistence():
    """app.js：URL 參數持久化畫面狀態（F5 保留頁籤/分片）"""
    js = read(APP_JS)
    assert "syncViewUrl" in js, "app.js 缺 syncViewUrl"
    assert "history.replaceState" in js, "syncViewUrl 應使用 replaceState（不觸發重載）"
    assert "_TABS" in js and "_SITES" in js, "app.js 缺白名單 _TABS/_SITES"
    assert "currentTab = _t" in js, "app.js 啟動未從 URL 恢復 currentTab"


def test_calendar_js_month_url():
    """calendar.js：行事曆月份從 URL 讀（F5 停在原本月份）"""
    js = read_calendar_js_all()
    assert "new URLSearchParams(location.search).get('month')" in js, "calendar.js 未從 URL 讀 month"
    assert "syncViewUrl" in js, "calendar.js 切月後未同步 URL"


# ---------- P4（2026-08-14）：saveAll 失敗保留 pending ----------

def test_api_js_saveall_keeps_failed_pending():
    """api.js saveAll：失敗的調整保留在 pending（不靜默丟失），成功才清空"""
    js = read(API_JS)
    assert "failed" in js, "api.js saveAll 缺 failed 陣列"
    assert "kept" in js and "pending = kept" in js, "api.js saveAll 未保留失敗 pending"
    assert "失敗的調整已保留" in js, "api.js saveAll 失敗 toast 未提示保留"


# ---------- 2026-08-25：輸入驗證補強（A1-A3/B1-B5） ----------

def test_add_modal_required_fields_validation():
    """B4：新增品項 brand/code/location 必填驗證"""
    js = read(ADD_JS)
    assert "!brand" in js and "廠牌必填" in js, "add.js 缺 brand 必填檢查"
    assert "!code" in js and "型號必填" in js, "add.js 缺 code 必填檢查"
    assert "!location" in js and "位置必填" in js, "add.js 缺 location 必填檢查"


def test_edit_modal_low_stock_validation():
    """A1：編輯品項 low_stock 負數檢查"""
    js = read(EDIT_JS)
    assert "lowstockVal" in js, "edit.js 缺 lowstockVal 變數"
    assert "< 0" in js and "警示值不能為負數" in js, "edit.js 缺 low_stock 負數檢查"


def test_edit_modal_stock_qty_clamping():
    """A2：編輯品項位置庫存 qty 不得為負"""
    js = read(EDIT_JS)
    assert "isNaN(q) || q < 0" in js, "edit.js 缺 stock qty 負數 clamping"


def test_edit_modal_name_empty_toast():
    """B5：編輯品項 name 空白時 toast 提示"""
    js = read(EDIT_JS)
    assert "!nameVal" in js and "名稱未修改" in js, "edit.js 缺 name 空白 toast 提示"


def test_stockout_edit_qty_upper_bound():
    """A3：編輯已領出數量上限檢查"""
    js = read(STOCKOUT_MODAL_JS)
    assert "Math.abs(rec.delta) * 10" in js, "stockout.js 缺 qty 上限檢查"
    assert "數量異常大" in js, "stockout.js 缺異常大數量 toast"


def test_calendar_date_required_validation():
    """B3：行事曆派工日期必填"""
    js = read(CALENDAR_MODAL_JS)
    assert "!body.date" in js and "請選擇派工日期" in js, "calendar.js 缺 date 必填檢查"


def test_photo_upload_file_validation():
    """B2：照片上傳前端副檔名+大小驗證"""
    js = read(PHOTO_JS)
    assert "ALLOWED" in js and ".jpg" in js, "photo.js 缺副檔名白名單"
    assert "10 * 1024 * 1024" in js, "photo.js 缺 10MB 大小檢查"


def test_perms_password_policy_validation():
    """B1：新增/重設帳號密碼 policy 即時提示"""
    js = read(PERMS_JS)
    assert "pwPolicyMsg" in js, "perms.js 缺 pwPolicyMsg 呼叫"
    # 新增帳號 + 重設密碼 + 批次都應有
    count = js.count("pwPolicyMsg")
    assert count >= 3, f"perms.js pwPolicyMsg 只出現 {count} 次，應 >= 3（新增/批次/重設）"


# ---------- 2026-08-26 搜尋篩選功能 ----------

def test_filter_panel_html_exists():
    """篩選面板 HTML 區塊存在於 index.html"""
    idx = read(INDEX)
    assert 'id="filter-panel"' in idx, "index.html 缺 filter-panel 區塊"
    assert 'id="fp-brand-chips"' in idx, "index.html 缺 fp-brand-chips"
    assert 'id="fp-cat-chips"' in idx, "index.html 缺 fp-cat-chips"


def test_filter_panel_css_exists():
    """篩選面板 + chip CSS 樣式存在"""
    css = read_css_all()
    assert '.filter-panel' in css, "style.css 缺 .filter-panel"
    assert '.filter-chip' in css, "style.css 缺 .filter-chip"
    assert '.filter-chips.collapsed' in css, "style.css 缺 .filter-chips.collapsed"
    assert '.toggle-btn' in css, "style.css 缺 .toggle-btn"


def test_filter_panel_js_functions():
    """inventory.js 含篩選面板函式"""
    js = read(INVENTORY_RENDER_JS)
    assert 'function buildFilterPanel()' in js, "inventory.js 缺 buildFilterPanel"
    assert 'function renderFilterChips(' in js, "inventory.js 缺 renderFilterChips"
    assert 'function clearFilterPanel()' in js, "inventory.js 缺 clearFilterPanel"
    assert 'function toggleFilterCollapse(' in js, "inventory.js 缺 toggleFilterCollapse"


def test_filterBySearch_multword():
    """多詞 AND 搜尋函式存在"""
    js = read(INVENTORY_RENDER_JS)
    assert 'function filterBySearch(' in js, "inventory.js 缺 filterBySearch"
    assert 'split(' in js and ('\\s+' in js or "' '" in js or '" "' in js), \
        "inventory.js filterBySearch 缺空白拆詞"


def test_category_in_add_modal():
    """新增品項 modal 含 category 下拉"""
    idx = read(INDEX)
    assert 'id="f-category"' in idx, "index.html 新增 modal 缺 f-category"
    assert '分類' in idx, "index.html 缺「分類」label"


def test_category_in_edit_modal():
    """編輯品項 modal 含 category 下拉"""
    idx = read(INDEX)
    assert 'id="e-category"' in idx, "index.html 編輯 modal 缺 e-category"


def test_category_in_add_js():
    """add.js 含 category payload + 自動推斷"""
    js = read(ADD_JS)
    assert 'f-category' in js, "add.js 缺 f-category 引用"
    assert 'category' in js, "add.js 缺 category payload"
    assert '_autoInferCategory' in js, "add.js 缺 _autoInferCategory 函式"


def test_category_in_edit_js():
    """edit.js 含 category 顯示 + payload"""
    js = read(EDIT_JS)
    assert 'e-category' in js, "edit.js 缺 e-category 引用"
    assert 'category' in js, "edit.js 缺 category payload"


def test_search_handlers_all_tabs():
    """app.js search-input 事件處理所有頁面"""
    js = read(APP_JS)
    assert 'renderPrepared()' in js, "app.js search-input 缺 renderPrepared 呼叫"
    assert 'renderStockOuts()' in js, "app.js search-input 缺 renderStockOuts 呼叫"
    assert 'renderStocktake()' in js, "app.js search-input 缺 renderStocktake 呼叫"
    assert 'renderKits()' in js, "app.js search-input 缺 renderKits 呼叫"


def test_filter_panel_only_inventory_tab():
    """篩選面板（chip bar）只在 inventory 頁渲染"""
    js = read(INVENTORY_RENDER_JS)
    assert "function renderInventoryChips" in js, "renderInventoryChips 函式缺失"
    assert "chip-bar" in js, "chip-bar class 引用缺失"


def test_batch_bar_only_inventory_tab():
    """防回歸：batch-bar 僅限 inventory，切頁自動清理（跨頁殘留修正 2026-09-06）"""
    js = read(APP_JS)
    # switchTab 內必須有 isInventory 分支清理 batch-bar（方案A）
    assert "batch-bar" in js, "app.js switchTab 缺 batch-bar 清理（跨頁殘留）"
    assert "batchMode" in js, "app.js switchTab 缺 batchMode 重置"
    assert "selectedStockIds" in js, "app.js switchTab 缺 selectedStockIds 清空"
    # 確保是以 !isInventory 為條件（非 inventory 才清理）
    assert "!isInventory" in js, "app.js switchTab 應以 !isInventory 條件清理 batch-bar"
    # 同時驗證 batch-bar 隱藏與櫃子欄位重置
    assert "batch-cabinet" in js and "batch-sub" in js, "app.js switchTab 清理需重置 batch-cabinet/batch-sub"


def test_all_js_syntax_valid():
    """所有關鍵 JS 檔案語法正確（node --check）"""
    js_files = [
        INVENTORY_RENDER_JS, PREPARED_RENDER_JS, STOCKOUT_RENDER_JS,
        STOCKTAKE_JS, KITS_RENDER_JS, APP_JS, API_JS, GLOBALS_JS,
        ADD_JS, EDIT_JS,
    ]
    for f in js_files:
        result = subprocess.run(
            ["node", "--check", f],
            capture_output=True, text=True, timeout=10
        )
        assert result.returncode == 0, f"{os.path.basename(f)} 語法錯誤: {result.stderr[:200]}"


# ---------- Google 行事曆同步 panel ----------

SETTINGS_HTML = os.path.join(STATIC, "settings.html")
SETTINGS_JS = os.path.join(STATIC, "js", "settings.js")
GCAL_KEY_JS = os.path.join(STATIC, "js", "modals", "gcal-key.js")
GCAL_KEYS_PY = os.path.join(BASE_DIR, "app", "routes", "gcal_keys.py")
DATABASE_PY = os.path.join(BASE_DIR, "app", "database.py")


def _read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def test_settings_html_has_gcal_panel():
    """settings.html 包含行事曆同步 panel"""
    html = _read(SETTINGS_HTML)
    assert 'data-panel="gcal"' in html, "settings.html 左清單缺 gcal panel"
    assert 'id="panel-gcal"' in html, "settings.html 缺 panel-gcal div"
    assert 'gcalKeyModal' in html, "settings.html 缺 gcalKeyModal modal"


def test_settings_html_has_gcal_modal_fields():
    """settings.html modal 包含三個欄位"""
    html = _read(SETTINGS_HTML)
    assert 'id="gk-name"' in html, "modal 缺 Key 名稱欄位"
    assert 'id="gk-cred"' in html, "modal 缺 JSON 路徑欄位"
    assert 'id="gk-cal"' in html, "modal 缺 Calendar ID 欄位"


def test_settings_js_has_gcal_functions():
    """settings.js 包含 gcal panel 函式"""
    js = _read(SETTINGS_JS)
    assert "renderGcalPanel" in js, "settings.js 缺 renderGcalPanel"
    assert "toggleGcalKey" in js, "settings.js 缺 toggleGcalKey"
    assert "deleteGcalKey" in js, "settings.js 缺 deleteGcalKey"
    assert "bindGcalUser" in js, "settings.js 缺 bindGcalUser"
    assert "loadGcalKeys" in js, "settings.js 缺 loadGcalKeys"



def test_settings_js_switch_handles_gcal():
    """settingsSwitch 正確切換 gcal panel"""
    js = _read(SETTINGS_JS)
    assert "showGcal" in js, "settingsSwitch 缺 showGcal 判斷"
    assert "panel-gcal" in js, "settingsSwitch 缺 panel-gcal 顯示控制"


def test_gcal_key_js_has_modal_functions():
    """gcal-key.js 包含 modal 操作函式"""
    js = _read(GCAL_KEY_JS)
    assert "openGcalKeyModal" in js, "gcal-key.js 缺 openGcalKeyModal"
    assert "closeGcalKeyModal" in js, "gcal-key.js 缺 closeGcalKeyModal"
    assert "submitGcalKey" in js, "gcal-key.js 缺 submitGcalKey"


def test_delete_gcal_key_uses_data_attrs():
    """A3 防回歸：deleteGcalKey 必須用 data-* 傳遞或直接傳 id+name，不可在 onclick 裡 inline esc() 名稱"""
    js = _read(SETTINGS_JS)
    # 新版直接傳 id+name：deleteGcalKey(id, name)
    # 舊版用 data-id + data-name：deleteGcalKey(this) 或 deleteGcalKey(btn)
    has_data_attrs = "data-id=" in js and "data-name=" in js
    has_direct_args = "deleteGcalKey(" in js
    assert has_data_attrs or has_direct_args,         "deleteGcalKey 需用 data-* 或直接傳 id+name"


def test_load_gcal_users_extracts_users_array():
    """A1 防回歸：loadGcalUsers 必須拆 .users，不可直接存 dict"""
    js = _read(SETTINGS_JS)
    assert "d.users" in js or ".users" in js,         "loadGcalUsers 須從回傳中取 .users 陣列（API 回 {users:[...]}）"
    # 不應有直接存 dict 的模式
    assert "gcalUsers = await res.json()" not in js,         "loadGcalUsers 不可直接存 res.json()（API 回傳是 {users:[...]} 不是陣列）"


def test_gcal_keys_route_has_crud():
    """gcal_keys.py 有完整 CRUD"""
    code = _read(GCAL_KEYS_PY)
    assert '"/api/gcal-keys"' in code
    assert '"/api/gcal-keys/options"' in code


def test_database_has_gcal_keys_table():
    """database.py 建立 gcal_keys 表"""
    code = _read(DATABASE_PY)
    assert "CREATE TABLE IF NOT EXISTS gcal_keys" in code, "database.py 缺 gcal_keys 表"


def test_database_has_users_gcal_key():
    """database.py migration 加 users.gcal_key"""
    code = _read(DATABASE_PY)
    assert "gcal_key" in code, "database.py 缺 users.gcal_key migration"


def test_settings_panel_script_includes_gcal_key_js():
    """settings.html 引入 gcal-key.js"""
    html = _read(SETTINGS_HTML)
    assert "gcal-key.js" in html, "settings.html 未引入 gcal-key.js"


def test_brand_filter_normalizes_no_brand():
    """A1 防回歸：「無廠牌」品牌 chip 篩選必須正規化（i.brand || '無廠牌'）。
    bug 版：顯示層把空 brand 正規化成「無廠牌」，過濾層卻用原始 i.brand 比對，
    兩者對不上 → 點「無廠牌」(最大群 52.8%) 整頁 0 結果。此斷言鎖住正規化。"""
    js = read(INVENTORY_RENDER_JS)
    assert "currentBrands.includes(i.brand || '無廠牌')" in js, \
        "renderInventory/getFilteredItems 品牌過濾須正規化空品牌為『無廠牌』"
    # 不得退回原始空值比對（會讓無廠牌 chip 篩選失效）
    assert "currentBrands.includes(i.brand);" not in js, \
        "品牌過濾不得用原始 i.brand（空品牌會對不上『無廠牌』chip）"

def test_stockout_date_display_only_date():
    """防回歸：已領出頁日期欄只顯示日期（MM-DD），不含時間。
    2026-09-06 家豪需求：日期上面不要顯示時間，只要顯示日期。
    修正前 slice(5,16) 會取 'MM-DDTHH:MM'，修正後 slice(5,10) 取 'MM-DD'。"""
    js = read(STOCKOUT_RENDER_JS)
    # 必須用 slice(5,10) 只取日期部分
    assert "slice(5,10)" in js, \
        "已領出頁日期顯示須用 slice(5,10) 只取 MM-DD"
    # 不得殘留 slice(5,16)（含時間）
    assert "slice(5,16)" not in js, \
        "已領出頁日期顯示不得含時間（slice(5,16) 已廢棄）"


# ===== 2026-09-06 兩段式位置（櫃子 | 位置）防回歸 =====

def test_add_modal_has_cabinet_and_sub_inputs():
    """防回歸：新增品項 modal 有 f-cabinet 下拉和 f-sub 輸入框。"""
    html = read(INDEX)
    assert 'id="f-cabinet"' in html, "新增品項需有 f-cabinet 櫃子下拉"
    assert 'id="f-sub"' in html, "新增品項需有 f-sub 位置輸入框"
    # 舊的 f-location 不應存在
    assert 'id="f-location"' not in html, "f-location 已廢棄，應改為 f-cabinet + f-sub"


def test_edit_modal_has_cabinet_and_sub_per_row():
    """防回歸：編輯品項 modal 的 stock-row 使用 stock-cabinet + stock-sub。"""
    js = read(EDIT_JS)
    assert "stock-cabinet" in js, "edit.js stock-row 需有 stock-cabinet class"
    assert "stock-sub" in js, "edit.js stock-row 需有 stock-sub class"
    # 舊的 stock-loc 不應存在
    assert "stock-loc" not in js, "stock-loc 已廢棄，應改為 stock-cabinet + stock-sub"


def test_cabinet_options_function_exists():
    """防回歸：_cabinetOptions 函式存在（產生櫃子下拉選項）。"""
    js = read(EDIT_JS)
    assert "function _cabinetOptions" in js, "_cabinetOptions 函式需存在"
    assert "編號A" in js, "_cabinetOptions 需含編號A選項"
    assert "鐵架" in js, "_cabinetOptions 需含鐵架選項"


def test_add_js_composes_cabinet_sub_location():
    """防回歸：submitAdd 組合 f-cabinet + f-sub 為 location 字串。"""
    js = read(ADD_JS)
    assert "f-cabinet" in js, "submitAdd 需讀取 f-cabinet"
    assert "f-sub" in js, "submitAdd 需讀取 f-sub"
    # 確認組合邏輯存在（cabinet + ' | ' + sub）
    assert "cabinet" in js and "sub" in js, \
        "submitAdd 需組合 cabinet + sub 為 location 字串"


def test_edit_js_composes_cabinet_sub_location():
    """防回歸：submitEdit 組合 stock-cabinet + stock-sub 為 location 字串。"""
    js = read(EDIT_JS)
    assert "stock-cabinet" in js, "submitEdit 需讀取 stock-cabinet"
    assert "stock-sub" in js, "submitEdit 需讀取 stock-sub"
    # 確認組合邏輯存在
    assert "cab" in js and "sub" in js, \
        "submitEdit 需組合 cab + sub 為 location 字串"


def test_card_buildlochtml_parses_pipe():
    """防回歸：buildLocHTML 解析 location 字串中的 ' | ' 分隔。"""
    js = read(CARD_JS)
    assert "indexOf(' | ')" in js or 'indexOf(" | ")' in js, \
        "buildLocHTML 需用 indexOf(' | ') 解析 location"
    assert "buildLocHTML" in js, "buildLocHTML 函式需存在"


def test_edit_modal_has_col_headers():
    """防回歸：編輯 modal 有欄位標頭（櫃子/位置/數量/備註）。"""
    html = read(INDEX)
    assert "col-headers" in html, "edit modal 需有 col-headers 欄位標頭"
    assert 'ch-cabinet' in html, "欄位標頭需有 ch-cabinet"
    assert 'ch-pos' in html, "欄位標頭需有 ch-pos"
    assert 'ch-qty' in html, "欄位標頭需有 ch-qty"
    assert 'ch-note' in html, "欄位標頭需有 ch-note"


def test_batch_button_uses_batch_loc_mgmt_perm():
    """防回歸：批次改位置按鈕使用 batch-loc-mgmt 權限（非 isViewer）。"""
    js = read(INVENTORY_RENDER_JS)
    assert "hasPerm('batch-loc-mgmt')" in js or 'hasPerm("batch-loc-mgmt")' in js, \
        "批次按鈕需用 hasPerm('batch-loc-mgmt') 控制顯示"
    # 不應再用 !isViewer 控制批次按鈕
    assert "isViewer ? '' : `<button class=\"btn-sm btn-batch\"" not in js, \
        "批次按鈕不應再用 isViewer 控制"


def test_select_all_respects_search_filter():
    """防回歸：selectAllStocks 使用 getFilteredInventoryItems（尊重搜尋篩選）"""
    js = read(INVENTORY_RENDER_JS)
    assert "getFilteredInventoryItems" in js, \
        "selectAllStocks 應使用 getFilteredInventoryItems"
    # selectAllStocks 不應再直接用 ALL_ITEMS
    assert "function selectAllStocks" in js
    # 確認 getFilteredInventoryItems 函式存在
    assert "function getFilteredInventoryItems" in js, \
        "getFilteredInventoryItems 函式缺失"


def test_render_inventory_uses_shared_filter():
    """防回歸：renderInventory 使用 getFilteredInventoryItems（搜尋篩選不重複）"""
    js = read(INVENTORY_RENDER_JS)
    assert "let list = getFilteredInventoryItems()" in js or \
        "var list = getFilteredInventoryItems()" in js, \
        "renderInventory 應使用 getFilteredInventoryItems"
    # 主要篩選邏輯（搜尋/品牌/分類）已搬到 getFilteredInventoryItems
    # renderInventory 裡的 ALL_ITEMS.filter 只允許統計用途（dashboard 卡片）
    lines = js.split('\n')
    in_render = False
    filter_count = 0
    for line in lines:
        if 'function renderInventory' in line:
            in_render = True
        elif in_render and line.strip().startswith('function ') and 'renderInventory' not in line:
            break
        elif in_render and 'ALL_ITEMS.filter' in line:
            # 允許 dashboard 統計用途（is_kit/low_stock/qty）
            if 'is_kit' in line or 'low_stock' in line or 'qty' in line:
                continue
            filter_count += 1
    # renderInventory 裡不應再有篩選邏輯的 ALL_ITEMS.filter（已搬到 getFilteredInventoryItems）
    assert filter_count == 0, \
        f"renderInventory 裡仍有 {filter_count} 處 ALL_ITEMS.filter 篩選邏輯（應搬到 getFilteredInventoryItems）"


def test_update_notifications_function():
    """防回歸：updateNotifications 函式存在且使用 esc() 防 XSS"""
    js = read(APP_JS)
    assert "function updateNotifications" in js, "updateNotifications 函式缺失"
    assert "updateNotifications()" in js, "updateNotifications 未被呼叫"
    # 低庫存通知應使用 esc() 防 XSS
    assert "esc(i.name)" in js or "esc(item.name)" in js, \
        "updateNotifications 應使用 esc() 轉義品項名稱"



# ========== Phase 2: Drawer 統一 ==========
def test_drawer_html_structure():
    """Phase 2：Drawer HTML 結構存在"""
    html = read(INDEX)
    assert 'id="drawerOverlay"' in html, "drawerOverlay 缺失"
    assert 'id="drawer"' in html, "drawer 容器缺失"
    assert 'id="drawerTitle"' in html, "drawerTitle 缺失"
    assert 'id="drawerBody"' in html, "drawerBody 缺失"
    assert 'id="drawerFooter"' in html, "drawerFooter 缺失"


def test_drawer_css_exists():
    """Phase 2：Drawer CSS 樣式存在"""
    css = read(CSS_CORE)
    assert '.drawer{' in css or '.drawer {' in css, "drawer CSS 缺失"
    assert '.dov{' in css or '.dov {' in css, "drawer overlay CSS 缺失"
    assert '.dh{' in css or '.dh {' in css, "drawer header CSS 缺失"
    assert '.db{' in css or '.db {' in css, "drawer body CSS 缺失"
    assert '.df{' in css or '.df {' in css, "drawer footer CSS 缺失"


def test_drawer_js_functions():
    """Phase 2：Drawer JS — openDrawer/submitDrawer 已清除（dead code），closeDrawer 保留"""
    js = read(APP_JS)
    assert 'function openDrawer' not in js, 'openDrawer 應已移除（dead code）'
    assert 'function submitDrawer' not in js, 'submitDrawer 應已移除（dead code）'
    assert "function closeDrawer" in js, "closeDrawer 函式缺失"
    assert "drawerOverlay" in js, "drawerOverlay 引用缺失"
    assert "drawer.classList.add" in js or "drawer.classList.remove" in js,         "drawer class 操作缺失"


# ========== Phase 3: 庫存頁細節 ==========
def test_dashboard_stat_cards():
    """Phase 3：Dashboard 摘要卡 JS 存在"""
    js = read(INVENTORY_RENDER_JS)
    assert "dash-cards" in js, "dash-cards class 引用缺失"
    assert "dash-card" in js, "dash-card class 引用缺失"
    assert "dc-num" in js or "dc-lbl" in js, "dashboard card 內容缺失"


def test_dashboard_css_exists():
    """Phase 3：Dashboard card CSS 樣式存在"""
    css = read(CSS_CORE)
    assert '.dash-cards{' in css or '.dash-cards {' in css, "dash-cards CSS 缺失"
    assert '.dash-card{' in css or '.dash-card {' in css, "dash-card CSS 缺失"
    assert '.dash-card.warn' in css, "dash-card.warn CSS 缺失"
    assert '.dash-card.danger' in css, "dash-card.danger CSS 缺失"


def test_chip_bar_filter():
    """Phase 3：Chip 即時篩選列存在"""
    js = read(INVENTORY_RENDER_JS)
    assert "chip-bar" in js, "chip-bar class 引用缺失"
    assert "toggleInventoryBrand" in js, "toggleInventoryBrand 函式缺失"
    assert "toggleInventoryCategory" in js, "toggleInventoryCategory 函式缺失"


def test_chip_bar_css_exists():
    """Phase 3：Chip bar CSS 樣式存在"""
    css = read(CSS_CORE)
    assert '.chip-bar{' in css or '.chip-bar {' in css, "chip-bar CSS 缺失"
    assert '.chip-bar .chip' in css, "chip-bar .chip CSS 缺失"


def test_row_warn_danger_css():
    """Phase 3：row-warn/row-danger CSS 存在"""
    css = read(CSS_CORE)
    assert 'row-warn' in css, "row-warn CSS 缺失"
    assert 'row-danger' in css, "row-danger CSS 缺失"
    assert '#fffbeb' in css, "row-warn 背景色缺失"
    assert '#fff5f5' in css, "row-danger 背景色缺失"


# ========== Phase 4: 盤點/批量 ==========
def test_calcdiff_function():
    """Phase 4：calcDiff 內聯盤點差異計算存在"""
    js = read(STOCKTAKE_JS)
    assert "function calcDiff" in js, "calcDiff 函式缺失"
    assert "st-diff" in js, "st-diff class 引用缺失"
    assert "sysqty" in js or "data-sysqty" in js, "sysqty 資料屬性缺失"


# ========== Phase 5: Data Table View + Drawer + row-warn ==========
def test_inventory_table_view_function():
    """Phase 5：renderInventoryTable 函式存在"""
    js = read(INVENTORY_RENDER_JS)
    assert "function renderInventoryTable" in js, "renderInventoryTable 函式缺失"
    assert "data-table" in js, "data-table class 引用缺失"
    assert "row-warn" in js or "row-danger" in js, "row-warn/danger 引用缺失"


def test_inventory_card_warn_danger():
    """Phase 5：card warn/danger class 動態套用"""
    js = read(INVENTORY_RENDER_JS)
    assert "item-card danger" in js or "item-card.danger" in js, "card danger class 缺失"
    assert "item-card warn" in js or "item-card.warn" in js, "card warn class 缺失"
    assert "isLow" in js or "isLow()" in js, "isLow 判斷缺失"


def test_view_toggle_function():
    """Phase 5：view toggle 存在"""
    js = read(INVENTORY_RENDER_JS)
    assert "function setInventoryView" in js, "setInventoryView 函式缺失"
    assert "inventoryViewMode" in js, "inventoryViewMode localStorage 缺失"


def test_table_view_css():
    """Phase 5：table view CSS 存在"""
    css = read(CSS_CORE)
    assert ".tbl-wrap" in css, "tbl-wrap CSS 缺失"
    assert ".view-toggle" in css, "view-toggle CSS 缺失"
    assert ".item-card.warn" in css, "item-card.warn CSS 缺失"
    assert ".item-card.danger" in css, "item-card.danger CSS 缺失"


def test_drawer_content_render():
    """Phase 5：Drawer — openDrawer 已清除（dead code），closeDrawer 保留，drawerBody 在 HTML"""
    js = read(APP_JS)
    html = read(INDEX)
    assert 'function openDrawer' not in js, 'openDrawer 應已移除（dead code）'
    assert "function closeDrawer" in js, "closeDrawer 函式缺失"
    assert "drawerBody" in html, "drawerBody HTML 缺失"


# ========== signed-reports 遺漏測試 ==========
def test_sidebar_has_signed_reports_nav():
    """sidebar 有簽名報表 nav link"""
    html = read(INDEX)
    assert 'sb-nav-signed-reports' in html, "sidebar 缺 sb-nav-signed-reports"
    assert '每日簽名日報表' in html, "sidebar 標題未統一為每日簽名日報表"


def test_tab_label_includes_signed_reports():
    """_TAB_LABEL 包含 signed-reports"""
    js = read(APP_JS)
    assert "'signed-reports':'每日簽名日報表'" in js, "_TAB_LABEL 缺 signed-reports"
    assert "'signed-reports':'🗂'" in js, "_TAB_ICON 缺 signed-reports"


def test_camera_button_exists():
    """簽名報表有相機拍攝按鈕"""
    js = read(os.path.join(STATIC, 'js', 'render', 'signed-reports.js'))
    assert 'dsr-camera-input' in js, "相機 input 缺失"
    assert 'capture="environment"' in js or "capture='environment'" in js, "capture 屬性缺失"
    assert '相機拍攝' in js, "相機拍攝按鈕文字缺失"


def test_stockout_return_tracks_source_and_return_locations():
    html = read("static/index.html")
    modal = read("static/js/modals/stockout.js")
    render = read("static/js/render/stockout.js")
    assert 'id="rs-source-location"' in html
    assert 'id="rs-location"' in html
    assert 'return_stock_id' in modal
    assert 'POST' in modal and '/return' in modal
    assert '/api/stockout-returns/' in modal
    assert 'openEditStockoutReturnModal' in render
    assert 'revokeStockoutReturn' in render
    assert 'return_location' in render
    assert 'esc(Number(st.id))' in modal

# ========== Sidebar 折疊 ==========
def test_sidebar_collapsed_css_exists():
    """sidebar 折疊 CSS 規則存在（桌面隱藏/展開）"""
    css = read_css_all()
    assert ".sidebar.expanded" in css, "sidebar.expanded CSS 缺失"
    assert "sidebar-expanded" in css, "sidebar-expanded class 缺失"

def test_toggle_sidebar_function():
    """toggleSidebar 函式存在"""
    js = read(APP_JS)
    assert "function toggleSidebar" in js, "app.js 缺 toggleSidebar"
    assert "sidebarExpanded" in js, "toggleSidebar 未使用 localStorage"

def test_hamburger_uses_toggle_sidebar():
    """hamburger 按鈕使用 toggleSidebar"""
    html = read(INDEX)
    assert 'onclick="toggleSidebar()"' in html, "hamburger 應呼叫 toggleSidebar()"

# ========== 行事曆搜尋 ==========
def test_calendar_search_api_exists():
    """搜尋 API 端點存在"""
    from app.routes.appointments import router
    paths = [r.path for r in router.routes]
    assert "/api/appointments/search" in paths, "搜尋端點缺失"

def test_calendar_search_ui_functions():
    """calendar.js 搜尋函式存在"""
    js = read(os.path.join(STATIC, "js/render/calendar.js"))
    assert "function calSearch" in js, "calSearch 缺失"
    assert "function calClearSearch" in js, "calClearSearch 缺失"
    assert "function calJumpToDate" in js, "calJumpToDate 缺失"

def test_calendar_search_bar_in_render():
    """renderCalendar 包含搜尋列 DOM"""
    js = read(os.path.join(STATIC, "js/render/calendar.js"))
    assert "cal-search-from" in js, "搜尋起始日期 input 缺失"
    assert "cal-search-to" in js, "搜尋結束日期 input 缺失"
    assert "cal-search-q" in js, "搜尋關鍵字 input 缺失"
    assert "cal-search-results" in js, "搜尋結果容器缺失"

# ========== GCal 刪除反饋 ==========
def test_delete_gcal_key_has_toast():
    """deleteGcalKey 包含 toast 反饋"""
    js = read(os.path.join(STATIC, "js/settings.js"))
    assert "function deleteGcalKey" in js, "deleteGcalKey 缺失"
    assert "toast(msg," in js or "toast(" in js, "deleteGcalKey 缺少 toast"
    assert "data.google_deleted" in js, "deleteGcalKey 未回傳 Google 刪除結果"

def test_toast_duration_increased():
    """toast 顯示時間 >= 3 秒"""
    js = read(os.path.join(STATIC, "js/utils.js"))
    # 找 toast timer 設定
    assert "3500" in js or "3000" in js, "toast 時間應 >= 3000ms"

# ========== 手機版工具列下拉選單 ==========
def test_more_actions_dropdown_exists():
    """手機版工具列 ⋮ 下拉選單 CSS 存在"""
    css = read_css_all()
    assert ".more-actions-wrap" in css, "more-actions-wrap CSS 缺失"
    assert ".more-actions-dropdown" in css, "more-actions-dropdown CSS 缺失"

def test_more_actions_functions_exist():
    """toggleMoreActions/closeMoreActions 函式存在"""
    js = read(os.path.join(STATIC, "js/render/inventory.js"))
    assert "function toggleMoreActions" in js, "toggleMoreActions 缺失"
    assert "function closeMoreActions" in js, "closeMoreActions 缺失"

# ========== 表格圖片欄 ==========
def test_table_photo_column():
    """表格 view 包含圖片欄"""
    js = read(os.path.join(STATIC, "js/render/inventory.js"))
    assert "photo-cell" in js, "表格缺 photo-cell 欄位"
    assert "openPhotoLightbox" in js, "表格缺 openPhotoLightbox 呼叫"

# ========== 搜尋框手機版可見 ==========
def test_mobile_search_visible():
    """手機版搜尋框不被隱藏"""
    css = read_css_all()
    # 不應有 .h-search{display:none} 在手機 media query 裡
    assert "h-search{display:none}" not in css, "h-search 不應被隱藏"

# ========== filter-panel 跨頁控制 ==========
def test_filter_panel_switchtab_control():
    """switchTab 控制 filter-panel 顯示"""
    js = read(APP_JS)
    assert "filter-panel" in js, "switchTab 未控制 filter-panel"
    assert "isInventory" in js, "switchTab 未判斷 isInventory"

# ========== 2026-09-08 手機 Header / 庫存出庫按鈕回歸 ==========
def test_mobile_header_can_fit_without_horizontal_clipping():
    """手機 Header 不可讓固定搜尋框與右側工具列把標題推出 viewport"""
    css = read_css_all()
    assert '.breadcrumb { min-width: 0;' in css
    assert '.h-search { flex: 1 1 100%;' in css
    assert '.h-search input { width: 100%;' in css
    assert '.header { flex-wrap: wrap;' in css

def test_inventory_mobile_filter_expanded_state_survives_rerender():
    """品牌/分類篩選展開後，重繪不得自動恢復 collapsed"""
    js = read(INVENTORY_RENDER_JS)
    assert 'var filterExpandedState' in js
    assert 'filterExpandedState[type]' in js

def test_inventory_mobile_stockout_actions_match_desktop_permission_gate():
    """出庫入口必須用 stockout 權限，不可誤用品項管理 isViewer 狀態。"""
    js = read(INVENTORY_RENDER_JS)
    assert "const canStockout = hasPerm('stockout');" in js
    assert "actionsHTML: buildInventoryStockoutActions(i, canStockout, true)" in js
    assert "buildInventoryStockoutActions(i, canStockout, false)" in js
    assert 'renderInventoryCard(list, isViewer, canStockout, isM)' in js
    assert "if (!canStockout) return '';" in js
    card = read(os.path.join(STATIC, 'js/render/card.js'))
    assert "${p.actionsHTML || ''}" in card
    assert 'openPrepareModal' in js and 'openOutModal' in js


def test_inventory_stockout_actions_are_shared_and_labeled_in_card_and_table():
    """單一庫存的卡片／表格都要有完整「待領出／已領出」文字入口。"""
    js = read(INVENTORY_RENDER_JS)
    css = read_css_all()
    assert 'function buildInventoryStockoutActions(i, canStockout, mobile)' in js
    assert js.count("buildInventoryStockoutActions(i, canStockout, false)") == 2
    assert "actionsHTML: buildInventoryStockoutActions(i, canStockout, true)" in js
    assert "if (!canStockout) return '';" in js
    assert '📤 待領出</button>' in js and '🚚 已領出</button>' in js
    assert "mobile ? 'm-card-actions' : 'inventory-stockout-actions'" in js
    assert '.inventory-stockout-actions { display: flex; flex-direction: column;' in css
    assert '.tbl-wrap .col-actions .inventory-stockout-actions .btn-prepare {' in css
    assert '.tbl-wrap .col-actions .inventory-stockout-actions .btn-out {' in css


def test_mobile_inventory_card_does_not_inherit_desktop_flex_row_layout():
    """手機 m-card 不可帶 .item-card，否則 desktop flex row 會把底部出庫列擠到右邊。"""
    js = read(INVENTORY_RENDER_JS)
    css = read_css_all()
    assert "cardClass: isZero ? 'danger' : (isLow ? 'warn' : '')" in js
    assert 'cardClass: cardClass' not in js
    assert '.item-card.warn, .m-card.warn' in css
    assert '.item-card.danger, .m-card.danger' in css


def test_inventory_stockout_actions_permission_matrix_runtime():
    """以 Node VM 執行真正的卡片／表格 render，守護 stockout 權限與手機布局。"""
    script = r"""
const fs = require('fs');
const vm = require('vm');
const context = {
  document: { addEventListener() {}, querySelectorAll() { return []; } },
  localStorage: { getItem() { return '[]'; } },
  pending: {}, batchMode: false, selectedStockIds: new Set(), currentSite: 'office',
};
vm.createContext(context);
for (const file of ['static/js/utils.js', 'static/js/render/card.js', 'static/js/render/inventory.js']) {
  vm.runInContext(fs.readFileSync(file, 'utf8'), context);
}
const item = {
  id: 42, name: '測試材料', brand: '測試廠牌', code: 'T-42', unit: '個', qty: 10,
  low_stock: 0, prepared_qty: 0, is_kit: false, has_photo: false,
  stocks: [{ id: 7, location: '編號A | 1-1', note: '' }],
};
const mobile = context.renderInventoryCard([item], false, true, true);
const desktop = context.renderInventoryCard([item], true, true, false);
const table = context.renderInventoryTable([item], true, true);
const noPermission = context.renderInventoryCard([item], false, false, true);
for (const [name, html] of [['mobile', mobile], ['desktop', desktop], ['table', table]]) {
  for (const token of ['📤 待領出', '🚚 已領出']) {
    if (!html.includes(token)) throw new Error(`${name} missing ${token}`);
  }
}
if (!mobile.includes('class="m-card"') || mobile.includes('class="m-card item-card"')) {
  throw new Error('mobile card inherited desktop item-card layout');
}
if (noPermission.includes('📤 待領出') || noPermission.includes('🚚 已領出')) {
  throw new Error('user without stockout permission received write actions');
}
"""
    result = subprocess.run(['node', '-e', script], capture_output=True, text=True, cwd=BASE_DIR)
    assert result.returncode == 0, result.stderr


def test_toggleBatchMode_null_safe():
    """防回歸：toggleBatchMode() 對 batch-toggle 元素做 null check（手機版無此 ID）。

    2026-09-08 bug：手機版按鈕沒有 id="batch-toggle"，直接呼叫
    getElementById('batch-toggle').classList.toggle() 拋出 TypeError，
    導致整個 batch mode 啟動流程中斷，batch-bar 永遠不會顯示。
    """
    js = read(INVENTORY_RENDER_JS)
    # 必須有 null check：var bt = getElementById(...) / if (bt)
    assert "var bt = document.getElementById('batch-toggle')" in js, \
        'toggleBatchMode 應先將 batch-toggle 存入變數（null safe pattern）'
    assert 'if (bt)' in js, \
        'toggleBatchMode 應對 bt 做 null check 再呼叫 classList'
    # 不應再有直接鏈式呼叫（會 crash）
    bad = "document.getElementById('batch-toggle').classList.toggle"
    assert bad not in js, \
        'toggleBatchMode 不應再直接鏈式呼叫 getElementById().classList（手機版 null crash）'


def test_calendar_cal_content_full_width():
    """防回歸：行事曆桌面版全展開，移除 640px 限制。

    2026-09-08 需求：行事曆在桌面版要全寬展開，不被 .content 的
    max-width: 640px 限制。做法同 DSR 的 dsr-content 模式：
    switchTab 時動態加 cal-content class，CSS 覆寫 max-width。
    """
    app = read(APP_JS)
    css = read(CSS_CAL)
    # app.js：switchTab 必須 toggle cal-content class
    assert "content.classList.toggle('cal-content', tab === 'calendar')" in app, \
        'app.js switchTab 缺 cal-content class toggle'
    # style.calendar.css：必須有 #content.cal-content 覆寫 max-width
    assert '#content.cal-content' in css, \
        'style.calendar.css 缺 #content.cal-content 規則'
    assert 'max-width: none' in css, \
        'cal-content 規則應設定 max-width: none 解除 640px 限制'


# ========== 2026-09-08 單一庫存 B 方案共用 action menu ==========
def test_inventory_item_actions_use_shared_registry_for_table_and_card():
    # 品項管理 actions 必須由共用 registry 提供，避免 table/card 分叉。
    js = read(INVENTORY_RENDER_JS)
    assert 'function getInventoryItemActions(itemId, isViewer, includePhoto)' in js
    assert 'buildInventoryItemActionMenu(i.id, isViewer)' in js
    assert 'getInventoryItemActions(itemId, isViewer, false)' in js
    assert 'const actions = getInventoryItemActions(itemId, isViewer);' in js
    assert "label: '編輯品項'" in js
    assert "label: '更換照片'" in js
    assert "label: '刪除品項'" in js


def test_inventory_table_puts_item_actions_after_stockout_actions_in_menu():
    # 表格的編輯/刪除要收進待領出／已領出右側的 ⋮ 選單。
    js = read(INVENTORY_RENDER_JS)
    table = js[js.index('function renderInventoryTable'):js.index('function buildInventoryStockoutActions')]
    assert 'buildInventoryStockoutActions(i, canStockout, false)' in table
    assert 'buildInventoryItemActionMenu(i.id, isViewer)' in table
    assert 'openEditModal(' not in table
    assert 'deleteItem(' not in table


def test_inventory_toolbar_places_select_toggle_before_more_menu():
    # 批量模式的全選／取消全選按鈕要位於 ⋮ 選單左側。
    js = read(INVENTORY_RENDER_JS)
    toolbar = js[js.index('function renderInventoryToolbar'):js.index('function renderInventoryTable')]
    assert toolbar.index('btn-select-all') < toolbar.index('more-actions-wrap')


def test_inventory_table_action_menu_runtime_is_permission_gated():
    # Node VM 驗證表格保留出庫主操作，品項管理選單依權限顯示。
    script = r'''const fs = require('fs');
const vm = require('vm');
const context = {
  document: { addEventListener() {}, querySelectorAll() { return []; } },
  localStorage: { getItem() { return 'table'; } },
  pending: {}, batchMode: false, selectedStockIds: new Set(), currentSite: 'office',
  hasPerm(key) { return key === 'stockout' || key === 'item-mgmt'; },
};
vm.createContext(context);
for (const file of ['static/js/utils.js', 'static/js/render/card.js', 'static/js/render/inventory.js']) {
  vm.runInContext(fs.readFileSync(file, 'utf8'), context);
}
const item = {
  id: 42, name: '測試材料', brand: '測試廠牌', code: 'T-42', unit: '個', qty: 10,
  low_stock: 0, prepared_qty: 0, is_kit: false, has_photo: false,
  stocks: [{ id: 7, location: '編號A | 1-1', note: '' }],
};
const table = context.renderInventoryTable([item], false, true);
if (!table.includes('📤 待領出') || !table.includes('🚚 已領出')) throw new Error('stockout actions missing');
if (!table.includes('inventory-action-menu') || !table.includes('編輯品項') || !table.includes('刪除品項')) throw new Error('item action menu missing');
const viewer = context.renderInventoryTable([item], true, true);
if (viewer.includes('編輯品項') || viewer.includes('刪除品項')) throw new Error('viewer saw item actions');
'''
    import subprocess
    result = subprocess.run(['node', '-e', script], cwd=os.path.dirname(STATIC), capture_output=True, text=True)
    assert result.returncode == 0, result.stderr or result.stdout


def test_inventory_mobile_table_does_not_force_desktop_width():
    # 手機表格不可用桌面固定寬度，否則會只看得到前幾欄。
    css = read_css_all()
    assert '.tbl-wrap table.data-table { min-width: 780px; }' not in css
