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

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC = os.path.join(BASE_DIR, "static")

INDEX = os.path.join(STATIC, "index.html")
LOGIN = os.path.join(STATIC, "login.html")
CSS = os.path.join(STATIC, "css", "style.css")
AUTH_JS = os.path.join(STATIC, "js", "auth.js")
USERS_JS = os.path.join(STATIC, "js", "modals", "users.js")


def read(p):
    with open(p, encoding="utf-8") as fh:
        return fh.read()


# ---------- index.html ----------

def test_index_has_viewport():
    assert 'name="viewport"' in read(INDEX)


def test_index_has_cache_busters():
    """靜態檔都掛版本號，避免手機/電腦吃到舊快取"""
    html = read(INDEX)
    assert "style.css?v=" in html
    assert "users.js?v=" in html


# ---------- style.css ----------

def test_css_mobile_media_query():
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
    css = read(CSS)
    assert ".logout-text, .users-text { display: none; }" in css


def test_css_table_card_layout():
    """手機版使用者表格卡片化"""
    css = read(CSS)
    assert ".users-table thead { display: none; }" in css
    assert ".users-table tr {" in css


# ---------- auth.js ----------

def test_auth_js_wraps_button_text_in_span():
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


# ---------- login.html（登入頁 v11.1 響應式） ----------

def test_login_has_viewport():
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

@pytest.mark.parametrize("js_path", [AUTH_JS, USERS_JS])
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


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
