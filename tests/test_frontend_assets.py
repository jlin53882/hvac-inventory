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


def test_css_user_actions_black_text():
    """舊使用者 modal 操作欄樣式已清理（RBAC 權限頁取代，user-actions 退役）"""
    css = read_css_all()
    assert ".user-actions" not in css
    assert ".btn-ghost.danger" not in css  # 舊 modal danger 按鈕樣式一併清理


def test_css_mobile_topbar_full_buttons():
    """手機版 topbar：右邊四個按鈕 2×2（管理員/改密碼 上排、使用者/登出 下排）+ 左邊標題兩行（2026-08-13 Sarah）"""
    css = read_css_all()
    # icon-only 規則已移除（改為顯示文字）
    assert ".logout-text, .users-text { display: none; }" not in css
    # 右邊四個 2×2 grid
    assert ".user-menu { display: grid !important; grid-template-columns: auto auto;" in css
    # 左邊標題兩行（logo 左、兩行字右，左緣對齊）——手機版 flex column
    assert ".topbar h1 .t-wrap { display: flex; flex-direction: column;" in css
    # 桌面版兩字連在一起（inline-flex 無間距；2026-08-13 Sarah：電腦版的不要空一格）
    assert ".topbar h1 .t-wrap { display: inline-flex; }" in css
    # 標題 span 存在（index.html）
    idx = read(INDEX)
    assert 'class="t-title"' in idx and 'class="t-title-2"' in idx
    assert 'class="t-wrap"' in idx


def test_css_table_card_layout():
    """舊使用者 modal 手機卡片化樣式已清理（RBAC 權限頁取代，users-table 退役）"""
    css = read_css_all()
    assert ".users-table" not in css


# ---------- auth.js ----------

def test_auth_js_wraps_button_text_in_span():
    """驗證 auth.js 按鈕文字以 span 包覆（2026-08-13：登出改用 logout-direct-text 避免手機版隱藏）"""
    js = read(AUTH_JS)
    assert 'class="users-text"' in js
    assert 'class="logout-direct-text"' in js


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


def test_stockout_js_shows_model():
    """已領出頁每筆顯示型號（2026-08-12 Sarah 需求）——手機卡片 + 桌面表格各一處"""
    js = read(STOCKOUT_RENDER_JS)
    assert js.count("型號 ") == 2
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
    assert "位置：${esc(s.location" in js                      # 位置標存在
    assert "item-loc" in js
    assert "×${s.qty}" not in js                               # 不得再有 ×數量
    assert "loc-qty" not in js                                 # 相關 CSS class 已移除
    assert ".item-note" not in js                              # 備註不再單獨一行
    assert "'｜'" in js or "｜" in js or "｜" in js         # 備註以｜併入位置框

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
    # topbar 標題（2026-08-13 Sarah：手機兩行＝振佳空調＋管理系統，拆兩個 span）
    assert 'class="t-title">振佳空調</span>' in index and 'class="t-title-2">管理系統</span>' in index

def test_topbar_logo_uses_login_image():
    """topbar 左上角 logo：2026-08-13 換 login-hvac.png（變體 A：24px 圓形）；2026-08-14 再換 logo-topbar.png
    （Sarah 指定第一張圖，登入頁 login-hvac.png 保留）——所有頁籤共用同一 topbar"""
    html = read(INDEX)
    assert "/static/img/logo-topbar.png" in html, "topbar logo 應指向 logo-topbar.png"
    assert "logo-zhenjia.png" not in html, "舊 logo-zhenjia.png 不得殘留"
    assert "/static/img/logo-topbar.png" in html and os.path.exists(os.path.join(STATIC, "img", "logo-topbar.png")), \
        "logo-topbar.png 檔案必須存在"

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
    assert "位置：${esc(loc)}" in inv    # 庫存頁位置分組標題

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
    assert "esc(user.display_name || user.username)" in au  # M16：topbar 帳號名 escape
    assert 'title="${esc(user.username)}"' in au
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
    assert "perms['change-own-password']" in au
    # 2026-08-16：⚙️ 設定按鈕（settings.html 入口）
    assert "location.href='/settings.html'" in au
    assert "canManageUnits" in au
    # 2026-08-13 Sarah：user 角色不要 bottom sheet 功能選單 → 直接顯示登出按鈕
    assert "user.role === 'user'" in au
    assert "btn-logout-direct" in au
    assert "logout-direct-text" in au  # 登出按鈕含文字（手機版 .users-text 會被隱藏 → 獨立 span）
    assert "btn-menu" not in au  # ☰ 按鈕已移除（2026-08-13 Sarah：不要下拉選單）
    css_all = read_css_all()
    assert ".btn-logout-direct" in css_all  # 手機版覆蓋 .user-menu .btn-ghost 隱藏
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
    """bottom-nav 含行事曆頁籤（2026-08-13 Sarah：行事曆移到最前面且登入預設顯示行事曆）"""
    html = read(INDEX)
    assert 'id="nav-calendar"' in html
    assert "行事曆" in html
    # 2026-08-13：行事曆在 nav 第一個，且 active 在 nav-calendar（登入一進來顯示行事曆）
    i_cal = html.index('id="nav-calendar"')
    i_inv = html.index('id="nav-inventory"')
    assert i_cal < i_inv, "行事曆應在 nav 最前面"
    assert 'class="nav-item active" id="nav-calendar"' in html
    assert 'class="nav-item" id="nav-inventory"' in html


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
    assert "perms['user-mgmt']" in au  # RBAC：帳號與權限按鈕由 user-mgmt 驅動
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


def test_stockout_modal_core_functions():
    """modals/stockout.js：領出 / 待領出 / 退回 / 編輯紀錄"""
    js = read(STOCKOUT_MODAL_JS)
    for fn in ("openOutModal", "submitStockOut", "openPrepareModal", "submitPrepare",
               "openPreparedOutModal", "submitPreparedOut", "returnPrepared", "returnStockout",
               "openEditStockoutModal", "submitEditStockout"):
        assert fn in js, f"stockout.js(modals) 缺 {fn}"


def test_stocktake_view_for_all_roles():
    """2026-08-14 家豪裁決（Sarah：藍政達/蘇昱豪手機看不到盤點）：盤點頁瀏覽掛 view 基底權限——
    所有角色看得到盤點 tab；「本次盤點」操作區僅限 stocktake 權限（admin/user）"""
    au = read(AUTH_JS)
    assert "canViewStocktake" in au, "auth.js 缺 canViewStocktake（瀏覽權限）"
    assert "navStocktake.style.display = canViewStocktake ? '' : 'none'" in au,         "盤點 tab 應依 canViewStocktake（stocktake OR view）顯示"
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
