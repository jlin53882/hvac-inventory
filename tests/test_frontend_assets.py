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
    """auth.js 有 applyRoleView：viewer 隱藏新增/盤點/儲存列/提醒；匯出保留"""
    js = read(AUTH_JS)
    assert "applyRoleView" in js
    assert "btn-add" in js
    assert "btn-export" in js
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


# ---------- JS 語法（node --check） ----------

@pytest.mark.parametrize("js_path", [AUTH_JS, USERS_JS, KITS_RENDER_JS, INVENTORY_RENDER_JS, STOCKTAKE_JS, UTILS_JS])
def test_js_syntax(js_path):
    """JS 檔必須通過 node --check（語法錯誤會讓整支 script 不執行）"""
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
    assert "openChangePwModal()" in au  # topbar 改密碼按鈕（所有角色）
    cpw = read(os.path.join(STATIC, "js", "modals", "changepw.js"))
    assert "function cpwCheckStrength" in cpw
    assert "function submitChangePw" in cpw
    exp = read(os.path.join(STATIC, "js", "modals", "expiry.js"))
    assert "function openExpiryModal" in exp
    assert "function ackPasswordExpiry" in exp


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


# ---------- 行事曆派工（📅） ----------

def test_index_has_calendar_nav():
    """bottom-nav 含行事曆頁籤"""
    html = read(INDEX)
    assert 'id="nav-calendar"' in html
    assert "行事曆" in html


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
