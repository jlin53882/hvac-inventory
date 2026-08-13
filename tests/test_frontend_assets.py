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
CSS = os.path.join(STATIC, "css", "style.css")
# 待測：auth.js
AUTH_JS = os.path.join(STATIC, "js", "auth.js")
# 待測：modals/users.js
USERS_JS = os.path.join(STATIC, "js", "modals", "users.js")
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


def read(p):
    """讀檔 helper（UTF-8）"""
    with open(p, encoding="utf-8") as fh:
        return fh.read()


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
    css = read(CSS)
    assert "@media (max-width: 767px)" in css
    # topbar 換行
    assert ".top-actions { flex-wrap: wrap" in css or "flex-wrap: wrap" in css


def test_css_user_actions_black_text():
    """操作按鈕黑字白底（白底 modal 上看得到）"""
    css = read(CSS)
    assert ".user-actions .btn-ghost" in css
    assert "color: #1a1a1a" in css
    assert ".btn-ghost.danger { color: #dc2626" in css


def test_css_mobile_icon_only():
    """驗證手機版 CSS 為圖示模式"""
    css = read(CSS)
    assert ".logout-text, .users-text { display: none; }" in css


def test_css_table_card_layout():
    """手機版使用者表格卡片化"""
    css = read(CSS)
    assert ".users-table thead { display: none; }" in css
    assert ".users-table tr {" in css


# ---------- auth.js ----------

def test_auth_js_wraps_button_text_in_span():
    """驗證 auth.js 按鈕文字以 span 包覆"""
    js = read(AUTH_JS)
    assert 'class="users-text"' in js
    assert 'class="logout-text"' in js


# ---------- users.js ----------

def test_users_js_action_buttons_have_full_text():
    """操作按鈕必須有完整文字（不能退化成純圖示）"""
    js = read(USERS_JS)
    assert "🔑 修改密碼" in js
    assert "⏸ 帳號停用" in js
    assert "▶️ 帳號啟用" in js
    assert "🗑 刪除帳號" in js


def test_users_js_has_class_names():
    """驗證 users.js 含預期 class 名稱"""
    js = read(USERS_JS)
    assert "class=\"users-table\"" in js
    assert "class=\"user-actions\"" in js
    assert "class=\"create-row\"" in js
    assert "class=\"cr-input\"" in js


def test_users_js_close_button_has_text():
    """關閉按鈕必須是「✕ 關閉」文字（不能退化成純 ✕ 符號）"""
    js = read(USERS_JS)
    assert "✕ 關閉" in js


def test_users_js_close_methods():
    """三種關閉方式：按鈕 / 背景點擊 / Esc"""
    js = read(USERS_JS)
    assert "closeUsersModal()" in js
    assert "e.target === overlay" in js
    assert "Escape" in js


def test_users_js_batch_table():
    """批次新增表格：加列/刪列/批次建立函式 + 表格容器存在"""
    js = read(USERS_JS)
    assert "batchTableBody" in js
    assert "addBatchRow()" in js
    assert "createUsersBatch()" in js
    assert "/api/users/batch" in js
    assert "batch-username" in js
    assert "batch-password" in js
    assert "batch-role" in js


# 待測：permissions.js
PERMS_JS = os.path.join(STATIC, "js", "permissions.js")


def test_index_loads_permissions_js():
    """index.html 有載入 permissions.js（權限一覽資料來源，無手動版本號）"""
    html = read(INDEX)
    assert 'src="/static/js/permissions.js"' in html
    assert "permissions.js?v=" not in html  # 版本號由後端自動注入


def test_permissions_js_matrix_has_three_roles():
    """權限矩陣：13 項權限 × 三角色，viewer 唯讀、admin 全權"""
    js = read(PERMS_JS)
    assert "PERMISSION_MATRIX" in js
    assert "ROLE_LABELS" in js
    assert "getRolePerms" in js
    # 三角色都在矩陣內
    assert "admin:" in js and "user:" in js and "viewer:" in js
    # viewer 不能寫入（品項管理/盤點/使用者管理為 false）
    assert "item-mgmt" in js
    assert "user-mgmt" in js
    # viewer 可匯出
    assert "export" in js
    assert "viewer: true" in js


def test_users_js_perm_toggle():
    """使用者表格有「📋 權限」展開按鈕 + toggleUserPerms 函式"""
    js = read(USERS_JS)
    assert "toggleUserPerms" in js
    assert "📋 權限" in js
    assert "getRolePerms" in js
    assert "perm-detail-row" in js


def test_users_js_role_badge_styles():
    """角色 badge 樣式（方案 C：角色欄下方權限按鈕）"""
    js = read(USERS_JS)
    assert "role-badge" in js
    assert "role-badge-admin" in js
    assert "role-badge-viewer" in js
    assert "perm-btn" in js
    css = read(CSS)
    assert ".role-badge-admin" in css
    assert ".role-badge-viewer" in css
    assert ".perm-btn" in css
    assert ".perm-grid" in css


def test_users_js_has_viewer_role_option():
    """角色下拉（單筆 + 批次）都要有檢視者選項"""
    js = read(USERS_JS)
    assert 'value="viewer">檢視者</option>' in js
    assert js.count('value="viewer"') >= 2  # 單筆 select + 批次 select


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
    assert "檢視者" in js  # viewer chip 文字


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
    css = read(CSS)
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
    css = read(CSS)
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
    assert "> 振佳空調管理系統</h1>" in index              # topbar 標題

def test_topbar_logo_uses_login_image():
    """topbar 左上角 logo 換成登入照片 login-hvac.png（2026-08-13 Sarah 指定變體 A：24px 圓形直接換圖，
    與登入頁同款圖；所有頁籤共用同一 topbar）——舊 logo-zhenjia.png 不得殘留"""
    html = read(INDEX)
    assert "/static/img/login-hvac.png" in html
    assert "logo-zhenjia.png" not in html

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

    us = read(USERS_JS)
    assert "${esc(u.username)}" in us  # 帳號欄位
    assert "function esc(" not in us   # L1：esc 單一來源（users.js 不再自行定義，統一用 utils.js）

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
    assert "openChangePwModal()" in au  # topbar 改密碼按鈕
    # 2026-08-13 Sarah：user 角色不可自行改密碼 → topbar/功能選單/過期提示都按角色隱藏
    assert "const canChangePw = user.role !== 'user';" in au
    # 2026-08-13 Sarah：user 角色不要 bottom sheet 功能選單 → 直接顯示登出按鈕（☰ 隱藏）
    assert "user.role === 'user'" in au
    assert "btn-logout-direct" in au
    assert "logout-direct-text" in au  # 登出按鈕含文字（手機版 .users-text 會被隱藏 → 獨立 span）
    assert "btn-menu" in au and "style.display = 'none'" in au
    css_all = read(CSS)
    assert ".btn-logout-direct" in css_all  # 手機版覆蓋 .user-menu .btn-ghost 隱藏
    bs = read(BOTTOMSHEET_JS)
    assert "u.role !== 'viewer' && u.role !== 'user'" in bs
    # 2026-08-13 Sarah：功能選單移除「匯出報表」action（user/admin 相繼要求）——匯出口統一在庫存清單頂部
    assert "label: '匯出報表'" not in bs
    cpw = read(os.path.join(STATIC, "js", "modals", "changepw.js"))
    assert "function cpwCheckStrength" in cpw
    assert "function submitChangePw" in cpw
    exp = read(os.path.join(STATIC, "js", "modals", "expiry.js"))
    assert "function openExpiryModal" in exp
    assert "function ackPasswordExpiry" in exp
    assert "u.role === 'user'" in exp  # user 過期提示隱藏「立即改密碼」按鈕


def test_resetpw_modal_ui_present():
    """v11.2：重設密碼 modal（同變體 B 樣式）+ z-order 修正 + ghost 取消鈕資產"""
    idx = read(os.path.join(STATIC, "index.html"))
    assert 'id="resetpw-modal"' in idx
    assert 'id="rpw-new"' in idx and 'oninput="pwStrengthCheck(\'rpw-new\')"' in idx
    assert 'id="rpw-confirm"' in idx
    assert 'id="rpw-mismatch"' in idx
    assert "btn-cancel-ghost" in idx  # 取消按鈕 ghost 樣式（與儲存並排）
    css = read(os.path.join(STATIC, "css", "style.css"))
    assert ".btn-cancel-ghost" in css
    us = read(USERS_JS)
    assert "openResetPwModal(" in us   # 重設改用 modal（不再用瀏覽器 prompt）
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
    for f in ("add.js", "edit.js", "kit.js", "stockout.js", "users.js", "photo.js"):
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
    css = read(CSS)
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
    css = read(CSS)
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
    """index.html 載入 render/calendar.js"""
    assert '/static/js/render/calendar.js' in read(INDEX)


def test_app_js_switchtab_has_calendar():
    """switchTab 分派行事曆 → renderCalendar()"""
    js = read(os.path.join(STATIC, "js", "app.js"))
    assert "else if (tab === 'calendar') renderCalendar();" in js


def test_calendar_js_has_core_functions():
    """calendar.js 核心函式：月曆/明細/新增/匯出/設定"""
    js = read(os.path.join(STATIC, "js", "render", "calendar.js"))
    for fn in ("function renderCalendar()", "function calRenderMonth()",
               "function calRenderDay()", "function calOpenAppt(",
               "async function calSubmitAppt()", "async function calExport()",
               "function calOpenSettings()", "function closeCalModal()"):
        assert fn in js, f"缺 {fn}"


def test_calendar_js_uses_api_endpoints():
    """calendar.js 呼叫的 API 端點（後端需有對應路由）"""
    js = read(os.path.join(STATIC, "js", "render", "calendar.js"))
    assert "/api/appointments" in js
    assert "/api/service-types" in js
    assert "/api/assignable-users" in js
    assert "/api/appointments/export" in js


def test_calendar_js_viewer_write_hidden():
    """viewer 看不到新增/編輯/刪除按鈕（權限整合）"""
    js = read(os.path.join(STATIC, "js", "render", "calendar.js"))
    assert "isViewer" in js
    assert "calOpenAppt()" in js  # 按鈕以 isViewer 條件包住


def test_css_has_calendar_styles():
    """style.css 含行事曆樣式（月曆格/事件/設定表格）"""
    css = read(CSS)
    for sel in (".cal-grid", ".cal-cell", ".cal-evt", ".cal-event-card",
                ".cal-set-table", ".cal-person-opt", ".switch"):
        assert sel in css, f"缺 {sel}"


def test_calendar_cell_shows_service_client():
    """2026-08-13 Sarah：月曆格子內派工標籤顯示「時間 [服務] 客戶」（右邊明細內容寫進左邊格子）"""
    js = read(CALENDAR_RENDER_JS)
    assert "evts.slice(0, 2)" in js                     # 每格最多 2 筆派工
    assert "e.start_time} [${e.service_name" in js       # 時間 + [服務]
    assert "e.client_name || ''" in js                   # 客戶名
    assert "t.innerText = `${e.start_time}" in js        # 用 innerText 安全設定（非 innerHTML）


def test_calendar_appt_only_start_time():
    """2026-08-13 Sarah：編輯派工只寫開始時間、不用結束時間
    - modal 無「結束」欄位（cal-f-end 移除）
    - 儲存時 end_time 自動 = start_time（後端衝突判斷：同時段/涵蓋才衝突）
    - 明細卡只顯示開始時間（不再 ⏰ 08:00 - 08:30）
    - 時間用 24 制下拉（時 00-23 / 分 00-55，取代手機 12 制 time input）"""
    js = read(CALENDAR_RENDER_JS)
    assert "cal-f-end" not in js                        # 結束欄位已移除
    assert 'id="cal-f-hour"' in js and 'id="cal-f-minute"' in js  # 24 制時/分下拉
    assert 'type="time"' not in js                      # 不再用 12 制 time input
    assert "{length: 24}" in js                         # 時 00-23
    assert "i * 5" in js                                # 分每 5 分鐘
    # 儲存：end_time = start_time（同一組時/分）
    assert "end_time: document.getElementById('cal-f-hour').value" in js
    # 明細卡：只顯示開始時間
    assert "<div class=\"cal-time\">⏰ ${esc(e.start_time)}　${who}</div>" in js


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
    css = read(CSS)
    assert ".stk-tabs {" in css
    assert ".stk-tab.active {" in css


def test_css_stat_cards_four_columns():
    """盤點統計卡 grid 4 欄（totalQty 補接：3 欄→4 欄），防退回 3 欄"""
    css = read(CSS)
    assert ".stat-cards" in css
    assert "grid-template-columns: repeat(4, 1fr);" in css
    assert "repeat(3, 1fr)" not in css.split(".cal-grid")[0], ".stat-cards 區域誤退回 3 欄"


# ---------- 2026-08-12 全專案 JS 完整性（家豪要求「都補」） ----------
# 背景：盤點發現 22 個 JS 中 11 個完全沒有內容斷言測試（api/app/bottomsheet/globals/
# modals 6 個 + render/card.js）。以下補「核心函式存在性」防護。
# 註：photo.js 的 photoImgClick 為 dead code，已於 2026-08-12 清理（未列入斷言）。

def test_all_js_loaded_by_index():
    """static/js 下每個 .js 都必須被 index.html 引用（防新增 JS 忘掛載 = 整支 dead file）"""
    html = read(INDEX)
    missing = []
    for js_path in ALL_JS_FILES:
        rel = "/static/" + os.path.relpath(js_path, STATIC).replace("\\", "/")
        if f'src="{rel}"' not in html:
            missing.append(rel)
    assert not missing, f"以下 JS 存在但未被 index.html 載入（dead file）: {missing}"


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
    """bottomsheet.js 核心：手機底部選單"""
    js = read(BOTTOMSHEET_JS)
    for fn in ("openSheet", "closeSheet", "openTopMenu", "isMobileView"):
        assert fn in js, f"bottomsheet.js 缺 {fn}"


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


def test_card_js_core_functions():
    """render/card.js：手機卡片建構 helpers"""
    js = read(CARD_JS)
    for fn in ("buildThumb", "buildLocHTML", "buildQtyControl", "buildQtyNum", "mobileCardShell"):
        assert fn in js, f"card.js 缺 {fn}"
