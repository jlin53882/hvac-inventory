# -*- coding: utf-8 -*-
"""
結構防回歸測試（2026-08-16 結構重整 6 phase 後建立）
====================================================
背景：6 phase 純搬移重構（models 收攏 / movements 抽取 / service_types 抽取 /
middleware 抽取 / calendar.js 拆 3 檔 / style.css 拆 2 檔）——現有測試全走 HTTP 層
驗證「行為不變」，但沒有測試保護「搬移結果」：若未來有人把函式搬回舊檔/舊 class 名稱
復活，行為測試不會紅。

本檔用「新檔存在 + 舊檔不殘留」雙向斷言鎖住搬移結果（bug 版必紅：搬回去任一函式 → 對應斷言 FAIL）。
"""
import os

STATIC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static")
APP = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "app")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(path):
    """讀檔 helper（UTF-8）"""
    with open(path, encoding="utf-8") as fh:
        return fh.read()


# ---------- 後端結構（Phase 1-4） ----------

def test_models_collected_to_models_py():
    """A3：9 個內嵌 model 已收攏至 app/models.py；route 檔不殘留 class 定義"""
    models = read(os.path.join(APP, "models.py"))
    for cls in ("class UserCreate", "class UserUpdate", "class UserPassword", "class UserBatch",
                "class UserPermissionsUpdate", "class LoginRequest", "class ChangePasswordRequest",
                "class AppointmentIn", "class ServiceTypeIn"):
        assert cls in models, f"models.py 缺 {cls}（A3 收攏回退？）"
    # 舊檔不殘留
    users = read(os.path.join(APP, "routes", "users.py"))
    assert "class UserCreate" not in users and "from app.models import" in users
    auth = read(os.path.join(APP, "routes", "auth.py"))
    assert "class LoginRequest" not in auth and "from app.models import" in auth
    appt = read(os.path.join(APP, "routes", "appointments.py"))
    assert "class AppointmentIn" not in appt and "from app.models import" in appt


def test_movements_extracted():
    """B3：list_movements 在 routes/movements.py，items.py 不殘留，main.py 有掛載"""
    mov = read(os.path.join(APP, "routes", "movements.py"))
    assert "def list_movements" in mov and "@router.get(\"/api/movements\")" in mov
    items = read(os.path.join(APP, "routes", "items.py"))
    assert "def list_movements" not in items and "Query" not in items.split("from fastapi import")[1].split("\n")[0]
    main = read(os.path.join(ROOT, "main.py"))
    assert "movements" in main and "movements.router" in main


def test_service_types_extracted():
    """B4：service-types 4 端點在 routes/service_types.py，appointments.py 不殘留"""
    st = read(os.path.join(APP, "routes", "service_types.py"))
    for fn in ("def list_service_types", "def create_service_type", "def update_service_type", "def deactivate_service_type"):
        assert fn in st, f"service_types.py 缺 {fn}"
    assert "svc-type-mgmt" in st
    appt = read(os.path.join(APP, "routes", "appointments.py"))
    assert "@router.get(\"/api/service-types\")" not in appt
    assert "import sqlite3" not in appt  # sqlite3 僅 service-types 端點用（dead import 清理）


def test_middleware_extracted():
    """B2：3 個 middleware 在 app/middleware.py，main.py 用註冊行而非函式定義"""
    mw = read(os.path.join(APP, "middleware.py"))
    for fn in ("async def cache_control_middleware", "async def csrf_origin_middleware", "async def security_headers_middleware"):
        assert fn in mw, f"middleware.py 缺 {fn}"
    assert "/settings.html" in mw  # 2026-08-16 settings 頁 no-cache 路徑（搬移時不可漏）
    main = read(os.path.join(ROOT, "main.py"))
    assert "async def cache_control_middleware" not in main          # 舊函式定義已移除
    assert 'app.middleware("http")(cache_control_middleware)' in main  # 改為註冊行
    assert 'app.middleware("http")(csrf_origin_middleware)' in main
    assert 'app.middleware("http")(security_headers_middleware)' in main


# ---------- 前端結構（Phase 5-6） ----------

def test_calendar_js_split_three_files():
    """A2：calendar.js 拆 3 檔——render 不殘留 modal/settings 函式，新檔各司其職"""
    render = read(os.path.join(STATIC, "js", "render", "calendar.js"))
    for gone in ("function calModalHtml", "function calOpenAppt", "function calSubmitAppt",
                 "function calDeleteAppt", "function closeCalModal",
                 "function calSettingsHtml", "function calOpenSettings", "function calRenderSvcRows",
                 "function calSetTab", "function calSetColor"):
        assert gone not in render, f"render/calendar.js 殘留 {gone}（拆檔回退？）"
    modal = read(os.path.join(STATIC, "js", "modals", "calendar.js"))
    for keep in ("function calModalHtml", "function calOpenAppt", "function calSubmitAppt",
                 "function closeCalModal", "let calApptUpdatedAt"):
        assert keep in modal, f"modals/calendar.js 缺 {keep}"
    settings = read(os.path.join(STATIC, "js", "modals", "calendar-settings.js"))
    for keep in ("function calSettingsHtml", "function calOpenSettings", "function calRenderSvcRows",
                 "function calRenderPplRows", "function calSetColor"):
        assert keep in settings, f"modals/calendar-settings.js 缺 {keep}"


def test_calendar_state_in_globals():
    """A2：行事曆狀態 8 var 在 globals.js（let/const 不跨檔）"""
    g = read(os.path.join(STATIC, "js", "globals.js"))
    for v in ("var _calM", "var calMonth", "var calSelected", "var calEvents",
              "var calSvc", "var calAssignable", "var CAL_PALETTE", "var CAL_WEEK"):
        assert v in g, f"globals.js 缺 {v}"
    render = read(os.path.join(STATIC, "js", "render", "calendar.js"))
    assert "let calMonth" not in render and "let calEvents" not in render  # 舊宣告不殘留


def test_style_css_split_two_files():
    """A1：style.css 拆 style.core.css + style.calendar.css；舊檔已刪除"""
    assert not os.path.exists(os.path.join(STATIC, "css", "style.css")), "style.css 應已刪除"
    core = read(os.path.join(STATIC, "css", "style.core.css"))
    cal = read(os.path.join(STATIC, "css", "style.calendar.css"))
    assert ".topbar" in core and ".btn-primary" in core
    assert "/* ========== 行事曆派工" in cal and ".cal-grid" in cal
    # 三頁 link 正確
    idx = read(os.path.join(STATIC, "index.html"))
    assert '/static/css/style.core.css' in idx and '/static/css/style.calendar.css' in idx
    assert '/static/css/style.css"' not in idx
    for page in ("permissions.html", "settings.html"):
        html = read(os.path.join(STATIC, page))
        assert '/static/css/style.core.css' in html, f"{page} 未改 link core"
