"""Calendar and Google Calendar frontend contract tests."""

from pathlib import Path
import os
import re
import subprocess
from frontend_test_support import (
    API_JS,
    APP_JS,
    AUTH_JS,
    BASE_DIR,
    CALENDAR_MODAL_JS,
    CALENDAR_RENDER_JS,
    CALENDAR_RUNTIME_JS,
    CALENDAR_SETTINGS_JS,
    CSS_CAL,
    CSS_CORE,
    GLOBALS_JS,
    INDEX,
    SETTINGS_HTML,
    SETTINGS_JS,
    STATIC,
    read,
    read_calendar_js_all,
    read_css_all,
)

# ---------- Google 行事曆同步 panel ----------

GCAL_KEY_JS = os.path.join(STATIC, "js", "modals", "gcal-key.js")
GCAL_KEYS_PY = os.path.join(BASE_DIR, "app", "routes", "gcal_keys.py")
DATABASE_PY = os.path.join(BASE_DIR, "app", "database.py")


# ---------- Calendar and GCal contracts ----------

def test_calendar_runtime():
    """Calendar production handlers cover load, create, edit, delete, and sync error paths."""
    result = subprocess.run(
        ["node", CALENDAR_RUNTIME_JS],
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=120,
    )
    assert result.returncode == 0, (
        f"calendar runtime failed:\n{result.stdout}\n{result.stderr}"
    )

def test_gcal_key_reminder_cards_contract():
    """每把 Key 顯示統一卡片，可新增/移除，最多五筆 Popup 通知。"""
    js = read(SETTINGS_JS)
    html = read(SETTINGS_HTML)
    assert "gcal-reminder-row" in js
    assert "gcal-reminders-list" in js
    assert "addGcalReminderRow" in js
    assert "removeGcalReminderRow" in js
    assert "最多 5 個" in js
    assert "method: 'popup'" in js
    assert "method: 'email'" not in js
    assert "deleteGcalKey(' + key.id + '," not in js
    assert ".gcal-reminder-row {" in html
    assert "grid-template-columns: minmax(120px, 1fr) auto auto" in html

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

def test_app_boot_clears_default_calendar_active_before_selected_tab():
    """Regression: F5 on ?tab=inventory must not leave default calendar active in sidebar."""
    js = read(os.path.join(STATIC, "js", "app.js"))
    boot_start = js.index("var _p = new URLSearchParams(location.search);")
    boot_end = js.index("loadData();", boot_start) + len("loadData();")
    boot = js[boot_start:boot_end]
    assert "querySelectorAll('.sb-nav-link').forEach" in boot
    assert boot.index("querySelectorAll('.sb-nav-link').forEach") < boot.index("sbNav.classList.add('active')")
    assert "content.classList.toggle('inventory-content', currentTab === 'inventory')" in boot
    assert boot.index("content.classList.toggle('inventory-content', currentTab === 'inventory')") < boot.index("loadData();")

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
    # 2026-09-08：桌面版操作按鈕改為 icon + aria-label（手機版保留可辨識文字）
    assert "cal-icon-btn btn-edit" in js and "aria-label=\"編輯派工\"" in js
    assert "cal-icon-btn btn-delete" in js and "aria-label=\"刪除派工\"" in js
    assert "calOpenAppt(${e.id})" in js and "calDeleteAppt(${e.id})" in js
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

def test_calendar_desktop_dispatch_layout():
    """2026-09-08：桌面版行事曆 65/35、動態高度與組合搜尋列守護。"""
    css = read_css_all()
    js = read_calendar_js_all()
    assert "grid-template-columns: minmax(0, 1.65fr) minmax(380px, 1fr)" in css
    assert "height: calc(100vh - 118px)" in css
    assert "grid-template-rows: auto repeat(6, minmax(100px, 1fr))" in css
    assert ".cal-month-card { overflow-y: auto; scrollbar-width: thin; }" in css
    assert "flex: 0 0 auto" in css
    assert "min-height: 22px; height: 22px" in css
    assert ".cal-month-card" in css and ".cal-day-card" in css
    assert "cal-page-header" in js
    assert "cal-header-filters" in js
    assert "cal-kpi-grid" in js
    assert "calRenderKpi" in js
    assert "calTodayEvents" in js
    assert "cal-legend" in js
    assert "cal-helper-panel" in js
    assert "cal-detail-icon" in js
    assert "calRenderLoadingUi" in js
    assert "calRenderErrorUi" in js
    assert "cal-load-state" in js
    assert "calSetLoadState('error'" in js
    assert "cal-combined-search" not in js  # 舊深色工具列已移除
    assert '<button class="cal-quick-filter"' not in js
    assert "cal-today-inline" in js
    assert "calLoadRequestToken" in js
    assert "if (requestToken !== calLoadRequestToken) return null;" in js
    assert "const trailing = 42 - first - total;" in js
    modal = read(CALENDAR_MODAL_JS)
    assert "const applied = await calLoadData();" in modal
    assert "if (applied === null) return;" in modal
    assert modal.count("if (applied === null) return;") >= 2
    assert modal.count("calSetLoadState('error', calLoadError)") >= 2
    assert js.count("if (applied === null) return;") >= 6
    assert js.count("calSetLoadState('error', calLoadError)") >= 6
    load_start = js.index("async function calLoadData()")
    load_end = js.index("function calRenderLoadingUi", load_start)
    load_fn = js[load_start:load_end]
    assert "return true;" in load_fn
    assert "return false;" in load_fn
    assert "return null;" in load_fn

def test_calendar_desktop_cells_keep_room_for_events():
    """Regression: desktop month cells must not shrink below event content."""
    css = read_css_all()
    assert "grid-template-rows: auto repeat(6, minmax(100px, 1fr))" in css
    assert ".cal-month-card { overflow-y: auto; scrollbar-width: thin; }" in css
    assert "flex: 0 0 auto" in css
    assert "min-height: 22px; height: 22px" in css

def test_calendar_design_spec_hooks():
    """2026-09-09：設計文件新增的 Legend、Helper、skeleton/error 與 card hierarchy hooks。"""
    js = read_calendar_js_all()
    css = read_css_all()
    for marker in ("calServiceTone", "calRenderLegend", "calRenderHelper", "cal-service-badge", "cal-event-footer", "cal-created-meta"):
        assert marker in js or marker in css, f"缺 {marker}"
    assert ".cal-skeleton-cell" in css
    assert ".cal-empty-state" in css
    assert ".cal-search-panel-header" in css
    assert ".cal-search-item" in css
    assert "width: min(100%, 1600px)" in css
    assert "grid-template-columns: repeat(2, minmax(0, 1fr))" in css
    assert "@media (max-width: 767px)" in css and "overflow-x: hidden" in css

def test_calendar_kpi_uses_existing_appointment_data():
    """KPI 只能由既有行程資料動態計算，不得寫死完成/進行中等不存在的狀態。"""
    js = read_calendar_js_all()
    assert "calTodayEvents.length" in js
    assert "calEvents.length" in js
    assert "calTodayEvents = todayEv.filter(e => e.date === todayStr)" in js
    assert "cal-kpi-meta" in js
    assert "今日共 ${calTodayEvents.length} 筆派工" in js
    assert "${calMonth.getFullYear()} 年 ${calMonth.getMonth() + 1} 月（共 ${calEvents.length} 筆）" in js

    assert "已完成" not in js
    assert "進行中" not in js
    assert "待處理" not in js

def test_calendar_kpi_meta_is_visible_on_mobile():
    """手機版仍需顯示 KPI 右下小標，不得因 viewport 判斷而完全省略。"""
    js = read_calendar_js_all()
    css = read_css_all()
    assert "showMeta" not in js
    assert "cal-kpi-meta" in js
    assert ".cal-kpi-meta" in css
    assert "white-space: normal" in css
    assert "overflow: visible" in css

def test_calendar_search_uses_right_panel_mode():
    """搜尋結果不得插入 KPI/Calendar 之間，必須切換右側同一個 Content Panel。"""
    js = read_calendar_js_all()
    css = read_css_all()
    kpi = js.index('id="cal-kpi-grid"')
    top_slot = js.index('id="cal-search-top-slot"')
    main = js.index('class="cal-main-grid"')
    header = js.index('id="cal-day-title"')
    panel_slot = js.index('id="cal-search-panel-slot"')
    day_list = js.index('id="cal-day-list"')
    assert kpi < top_slot < main < header < panel_slot < day_list
    assert "calIsDesktopViewport" in js
    assert "calMountSearchResults" in js
    assert "calSearchMode" in js
    assert "calSearchRequestToken" in js
    assert "requestToken !== calSearchRequestToken" in js
    assert "calSearchState" in js
    assert "calBindSearchViewportListener" in js
    assert "calHandleSearchViewportChange" in js
    assert "addEventListener('change', calHandleSearchViewportChange)" in js
    assert "addListener(calHandleSearchViewportChange)" in js
    assert "calRenderSearchLoading" in js
    assert "calRenderSearchError" in js
    assert "function calClearSearch()" in js
    assert "calRenderSearchResults" in js
    assert "calRenderMobileSearchResults" in js
    mobile_start = js.index("function calRenderMobileSearchResults")
    mobile_end = js.index("async function calSearch", mobile_start)
    mobile_renderer = js[mobile_start:mobile_end]
    assert "calSearchMode = true;" in mobile_renderer
    assert "calApplyRightPanelMode();" in mobile_renderer
    day_start = js.index("function calRenderDay")
    day_end = js.index("// ========== 行事曆搜尋 ==========", day_start)
    day_renderer = js[day_start:day_end]
    assert "if (calIsDesktopViewport()) calRenderSearchResults(calSearchItems);" in day_renderer
    assert "else calRenderMobileSearchResults(calSearchItems);" in day_renderer
    assert "calJumpToDate" in js
    assert 'data-date="${esc(e.date || \'\')}"' in js
    assert ".cal-day-card.cal-search-mode" in css
    assert ".cal-top-slot" not in css
    assert ".cal-search-top-slot { display: none; }" in css
    assert "overflow-y: auto" in css
    assert "cal-search-panel-header" in css
    assert "cal-search-item" in css

def test_calendar_mobile_event_keeps_service_type_visible():
    """手機月曆事件改成兩行，避免窄欄只剩時間而看不到施工/保養。"""
    css = read_css_all()
    assert "@media (max-width: 767px)" in css
    assert ".cal-evt {\n    min-height: 30px;" in css
    assert "flex-direction: column;" in css
    assert ".cal-evt .cal-evt-body" in css
    assert "white-space: nowrap" in css

def test_calendar_cell_shows_service_client():
    """2026-08-13 Sarah + 08-14 家豪 B 方案：月曆格子內派工標籤顯示「時間」+「[服務] 客戶」
    - compact event：時間與服務/客戶同列，維持獨立節點供樣式控制
    - 用 textContent 安全設定（非 innerHTML）"""
    js = read_calendar_js_all()
    assert "evts.slice(0, 2)" in js                     # 每格最多 2 筆派工
    assert "className = 'cal-evt-time'" in js           # 時間仍可獨立樣式控制
    assert "className = 'cal-evt-body'" in js           # 服務/客戶一行
    assert "e.client_name || ''" in js                   # 客戶名
    assert "textContent" in js                           # 用 textContent 安全設定（非 innerHTML）
    assert "innerText = `${e.start_time" not in js       # 舊單行 innerText 已移除（B 方案取代）

def test_service_type_optional_ui():
    """2026-08-17 Sarah：服務項目改非必填——前端不再擋必填（原「請選擇服務項目」檢查已移除）、
    月曆格/明細卡無服務項目時不顯示「[] 」空括號前綴（比照 08-14 時間選填「無時間不顯示前綴」）"""
    js = read_calendar_js_all()
    assert "⚠️ 請選擇服務項目" not in js                                        # 必填檢查已移除（bug 版必紅）
    assert "bodyEl.textContent = (e.service_name ? `${e.service_name} ` : '')" in js  # 月曆格服務名稱與客戶
    assert "cal-service-badge" in js and "esc(e.service_name)" in js                  # 明細卡使用服務 badge

def test_calendar_cell_selected_highlight_js():
    """2026-08-14 家豪：月曆格「選中」機制——點擊設定 calSelected + 渲染 cal-selected class
    - 08-14 變體 A：今天完全不標記（不再產生 cal-today class，避免今天與選中同時有框）"""
    js = read_calendar_js_all()
    assert "cal-selected" in js                          # 渲染時加選中 class
    assert "calSelected = new Date(y, m, d)" in js       # 點擊格子設定選中日期
    assert "_syncCalendarDateControls()" in js            # 月曆與頂部/右側日期同步
    assert "function _parseLocalDate(value)" in js       # input date 字串先正規化成 Date
    assert "cal-today" in js                             # 今天要有 Blue Circle/Badge
    assert "const isToday = ds === _iso(new Date())" in js

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
    # 明細卡：時間使用新的 hierarchy header；未指定時間仍有明確 fallback
    assert '<div class=\"cal-time\"><span aria-hidden=\"true\">⏰</span>' in js
    assert "esc(e.start_time || '未指定時間')" in js

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
    assert "if (e.start_time) {" in js                   # 月曆格無時間不顯示時間行
    assert "esc(e.start_time || '未指定時間')" in js       # 明細卡無時間顯示 fallback
    assert "(a.start_time || '99:99')" in js                # 空時間排最後
    assert "'09:00'" not in js.split("const t =")[1].split("const timeVal")[0]  # 新增不再預設 09:00

def test_shell_v2_calendar_no_settings_button():
    """Shell v2：行事曆工具列已移除設定按鈕"""
    cal = read(CALENDAR_RENDER_JS)
    # Settings button should NOT be in the toolbar
    assert "calOpenSettings" not in cal, "行事曆工具列仍含 calOpenSettings（應已移除）"
    # But the function should still exist in calendar-settings.js (for future use)
    cs = read(CALENDAR_SETTINGS_JS)
    assert "function calOpenSettings()" in cs, "calOpenSettings 函式應仍定義於 calendar-settings.js"

def test_calendar_js_optimistic_lock_snapshot():
    """calendar.js：編輯派工帶 updated_at 快照（calSubmitAppt body）"""
    js = read_calendar_js_all()
    assert "calApptUpdatedAt" in js, "calendar.js 缺 calApptUpdatedAt 快照變數"
    assert "updated_at: calApptUpdatedAt" in js, "calendar.js calSubmitAppt 未帶 updated_at"

def test_calendar_js_month_url():
    """calendar.js：行事曆月份從 URL 讀（F5 停在原本月份）"""
    js = read_calendar_js_all()
    assert "new URLSearchParams(location.search).get('month')" in js, "calendar.js 未從 URL 讀 month"
    assert "syncViewUrl" in js, "calendar.js 切月後未同步 URL"

def test_calendar_date_required_validation():
    """B3：行事曆派工日期必填"""
    js = read(CALENDAR_MODAL_JS)
    assert "!body.date" in js and "請選擇派工日期" in js, "calendar.js 缺 date 必填檢查"

def test_settings_html_has_gcal_panel():
    """settings.html 包含行事曆同步 panel"""
    html = read(SETTINGS_HTML)
    assert 'data-panel="gcal"' in html, "settings.html 左清單缺 gcal panel"
    assert 'id="panel-gcal"' in html, "settings.html 缺 panel-gcal div"
    assert 'gcalKeyModal' in html, "settings.html 缺 gcalKeyModal modal"

def test_settings_html_has_gcal_modal_fields():
    """settings.html modal 包含三個欄位"""
    html = read(SETTINGS_HTML)
    assert 'id="gk-name"' in html, "modal 缺 Key 名稱欄位"
    assert 'id="gk-cred"' in html, "modal 缺 JSON 路徑欄位"
    assert 'id="gk-cal"' in html, "modal 缺 Calendar ID 欄位"

def test_settings_js_has_gcal_functions():
    """settings.js 包含 gcal panel 函式"""
    js = read(SETTINGS_JS)
    assert "renderGcalPanel" in js, "settings.js 缺 renderGcalPanel"
    assert "toggleGcalKey" in js, "settings.js 缺 toggleGcalKey"
    assert "deleteGcalKey" in js, "settings.js 缺 deleteGcalKey"
    assert "bindGcalUser" in js, "settings.js 缺 bindGcalUser"
    assert "loadGcalKeys" in js, "settings.js 缺 loadGcalKeys"

def test_settings_js_switch_handles_gcal():
    """settingsSwitch 正確切換 gcal panel"""
    js = read(SETTINGS_JS)
    assert "showGcal" in js, "settingsSwitch 缺 showGcal 判斷"
    assert "panel-gcal" in js, "settingsSwitch 缺 panel-gcal 顯示控制"

def test_gcal_key_js_has_modal_functions():
    """gcal-key.js 包含 modal 操作函式"""
    js = read(GCAL_KEY_JS)
    assert "openGcalKeyModal" in js, "gcal-key.js 缺 openGcalKeyModal"
    assert "closeGcalKeyModal" in js, "gcal-key.js 缺 closeGcalKeyModal"
    assert "submitGcalKey" in js, "gcal-key.js 缺 submitGcalKey"

def test_delete_gcal_key_uses_data_attrs():
    """A3 防回歸：deleteGcalKey 必須用 data-* 傳遞或直接傳 id+name，不可在 onclick 裡 inline esc() 名稱"""
    js = read(SETTINGS_JS)
    # 新版直接傳 id+name：deleteGcalKey(id, name)
    # 舊版用 data-id + data-name：deleteGcalKey(this) 或 deleteGcalKey(btn)
    has_data_attrs = "data-id=" in js and "data-name=" in js
    has_direct_args = "deleteGcalKey(" in js
    assert has_data_attrs or has_direct_args,         "deleteGcalKey 需用 data-* 或直接傳 id+name"

def test_load_gcal_users_extracts_users_array():
    """A1 防回歸：loadGcalUsers 必須拆 .users，不可直接存 dict"""
    js = read(SETTINGS_JS)
    assert "d.users" in js or ".users" in js,         "loadGcalUsers 須從回傳中取 .users 陣列（API 回 {users:[...]}）"
    # 不應有直接存 dict 的模式
    assert "gcalUsers = await res.json()" not in js,         "loadGcalUsers 不可直接存 res.json()（API 回傳是 {users:[...]} 不是陣列）"

def test_gcal_keys_route_has_crud():
    """gcal_keys.py 有完整 CRUD"""
    code = read(GCAL_KEYS_PY)
    assert '"/api/gcal-keys"' in code
    assert '"/api/gcal-keys/options"' in code

def test_database_has_gcal_keys_table():
    """database.py 建立 gcal_keys 表"""
    code = read(DATABASE_PY)
    assert "CREATE TABLE IF NOT EXISTS gcal_keys" in code, "database.py 缺 gcal_keys 表"

def test_database_has_users_gcal_key():
    """database.py migration 加 users.gcal_key"""
    code = read(DATABASE_PY)
    assert "gcal_key" in code, "database.py 缺 users.gcal_key migration"

def test_settings_panel_script_includes_gcal_key_js():
    """settings.html 引入 gcal-key.js"""
    html = read(SETTINGS_HTML)
    assert "gcal-key.js" in html, "settings.html 未引入 gcal-key.js"

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

def test_delete_gcal_key_has_toast():
    """deleteGcalKey 包含 toast 反饋"""
    js = read(os.path.join(STATIC, "js/settings.js"))
    assert "function deleteGcalKey" in js, "deleteGcalKey 缺失"
    assert "toast(msg," in js or "toast(" in js, "deleteGcalKey 缺少 toast"
    assert "data.google_deleted" in js, "deleteGcalKey 未回傳 Google 刪除結果"

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

def test_calendar_btn_edit_is_feature_owned():
    """Regression: Calendar must own the feature-only edit button contract."""
    core = read(CSS_CORE)
    calendar = read(CSS_CAL)
    index = read(INDEX)
    calendar_js = read(CALENDAR_RENDER_JS)

    assert not re.search(r"(?m)^\s*\.btn-edit\s*\{", core), (
        "Core must not own the Calendar-only .btn-edit base"
    )
    assert not re.search(r"(?m)^\s*\.btn-edit:hover\s*\{", core), (
        "Core must not own the Calendar-only .btn-edit hover"
    )
    assert (
        ".cal-card-actions .cal-icon-btn.btn-edit "
        "{ margin-top: 5px; transition: background 0.15s; }"
    ) in calendar, "Calendar must preserve the former effective edit-button contract"
    assert 'class=\"cal-icon-btn btn-edit\"' in calendar_js, (
        "Calendar edit-button producer must remain"
    )
    assert index.index("style.core.css") < index.index("style.calendar.css"), (
        "Core must load before Calendar CSS"
    )

    token = re.compile(r"(?<![A-Za-z0-9_-])btn-edit(?![A-Za-z0-9_-])")
    js_root = os.path.join(STATIC, "js")
    for directory, _, names in os.walk(js_root):
        for name in names:
            if not name.endswith(".js"):
                continue
            js_path = os.path.join(directory, name)
            if os.path.normcase(js_path) == os.path.normcase(CALENDAR_RENDER_JS):
                continue
            assert not token.search(read(js_path)), (
                f"non-Calendar JS must not produce exact .btn-edit: {js_path}"
            )

def test_gcal_sync_health_and_queue_ui_contract():
    """設定頁必須接上 health、queue、指定列 retry，且不把錯誤只留在 calendar card。"""
    js = read(SETTINGS_JS)
    html = read(SETTINGS_HTML)
    assert "/api/gcal-sync-status" in js
    assert "/api/gcal-sync-queue" in js
    assert "retrySyncQueue" in js
    assert "gcal-sync-health" in js
    assert "gcal-sync-issues" in js
    assert "data-sync-appt" in js
    assert "Key 已停用，等待重新啟用" in js
    assert "paused_count" in js
    assert "gcal-sync-health" in html
    assert "gcal-sync-issues" in html

def test_gcal_sync_health_mobile_cards_contract():
    """設定頁新增同步資訊在手機要使用 card stack，不得固定 table 寬度。"""
    html = read(SETTINGS_HTML)
    assert ".gcal-sync-issue" in html
    assert "@media (max-width: 768px)" in html
    assert ".gcal-sync-issue-actions" in html

def test_calendar_sync_status_semantic_css_contract():
    """Calendar badge 對 retrying/partial 狀態有低干擾的個別顏色。"""
    js = read_calendar_js_all()
    css = read(CSS_CAL)
    for token in ("retrying", "partial_retrying", "partial_failed", "failed"):
        assert token in js
        assert f".cal-sync-{token}" in css

def test_calendar_sync_status_labels_distinguish_retry_and_exhausted():
    """Keep retrying, partial retry, and exhausted sync labels distinct."""
    js = read_calendar_js_all()
    assert "同步重試中" in js
    assert "部分同步重試中" in js
    assert "同步失敗" in js
    assert "status === 'partial_retrying' ? '🔄'" in js
    assert "status === 'retrying' ? '🔄'" in js

def test_calendar_sync_status_uses_personal_and_admin_team_contract():
    """卡片狀態使用登入者視角，Admin 團隊 Badge 使用人員統計。"""
    js = read_calendar_js_all()
    modal = read(Path(STATIC) / "js" / "modals" / "calendar.js")
    assert "my_sync_status" in js
    assert "team_sync" in js
    assert "未指派給你" not in js  # 2026-09-17: 已移除「未指派給你」顯示
    assert "calShowTeamSyncDetails" in js
    assert "重試我的" in js
    assert "重試全體" in modal
    assert "/api/gcal-sync-queue/reset-mine" in modal
    assert "scope=user" in modal
    assert "scope=all" in modal
    assert "function calCanRetryPersonal" in js
    assert "function calCanRetryTeamPerson" in js
    assert "can_retry_all" in js
    assert "fallback_target_count" in js
    assert "migration_pending" in js
    assert "personal.can_retry === true" in js
    assert "person.can_retry === true" in js
    assert "function calTeamHasRetryableTarget(team)" in js
    assert "calTeamHasRetryableTarget(team)" in modal
    assert "isAssigned && calCanRetryPersonal(personal)" in js
    assert "const retry = hasPerm('gcal-sync-force') && calCanRetryTeamPerson(person)" in modal
    assert "retryAll.hidden = !hasPerm('gcal-sync-force') || !calTeamHasRetryableTarget(team)" in modal
    assert "fallback_target_count" in modal
    assert "同步至全部有效 Google 行事曆" in js
    assert "目前沒有可用的 Google 行事曆，請先新增或啟用 Calendar Key" in js
    assert "目前沒有有效同步人員" not in js
    assert "目前沒有有效同步人員" not in modal

def test_gcal_sync_interval_explains_debounce_semantics():
    """Explain queue scanning, edit debounce, and immediate-sync behavior."""
    js = read(SETTINGS_JS)
    assert "掃描待同步隊列" in js
    assert "5 分鐘編輯防抖等待" in js
    assert "立即同步會略過防抖" in js

def test_gcal_key_modal_does_not_render_server_credentials_path():
    """前端編輯 key 不得把 server-side credential path 回填到 input。"""
    source = (Path(STATIC) / "js" / "modals" / "gcal-key.js").read_text(encoding="utf-8")
    assert "k.credentials_path" not in source
    assert "server path is intentionally not exposed" in source

def test_gcal_sync_wording_describes_all_keys_and_trigger_semantics():
    """Settings 文案必須反映 force sync 是全部 Key 且為背景觸發。"""
    source = Path(SETTINGS_JS).read_text(encoding="utf-8")
    assert "立即同步全部 Key" in source
    assert "全部 Key 同步掃描間隔" in source
    assert "所有啟用中的 Google Calendar Key 共用此掃描間隔" in source
    assert "已觸發全部 Key 立即同步" in source
    assert "立即處理待同步" not in source

def test_gcal_key_list_shows_status_label():
    """Key 列表顯示「帳號啟用」/「帳號停用」狀態文字"""
    js = read(SETTINGS_JS)
    assert "帳號啟用" in js
    assert "帳號停用" in js

def test_gcal_key_list_shows_full_client_email():
    """Key 列表完整顯示 client_email（不截斷）"""
    js = read(SETTINGS_JS)
    # 必須顯示完整 email（esc(k.client_email || '—')）
    assert "esc(k.client_email || '—')" in js
    # 不得截斷 email 為 username-only（移除 emailShort 邏輯）
    assert "emailShort" not in js

def test_gcal_key_list_has_toggle_button():
    """Key 列表有停用/啟用 toggle 按鈕（event.stopPropagation）"""
    js = read(SETTINGS_JS)
    assert "event.stopPropagation()" in js
    assert "toggleGcalKey(" in js
    # 按鈕文字
    assert "停用" in js
    assert "啟用" in js

def test_gcal_settings_row_has_class():
    """同步設定行有 gcal-settings-row class（手機版 CSS hook）"""
    js = read(SETTINGS_JS)
    assert 'class="gcal-settings-row' in js

def test_gcal_detail_head_has_class():
    """Detail header 有 gcal-detail-head / gcal-detail-info / gcal-detail-actions class"""
    js = read(SETTINGS_JS)
    assert 'class="gcal-detail-head"' in js
    assert 'class="gcal-detail-info"' in js
    assert 'class="gcal-detail-actions"' in js

def test_settings_html_gcal_mobile_css():
    """settings.html 手機版 CSS 包含 GCal 優化規則"""
    html = read(SETTINGS_HTML)
    assert ".gcal-key-item" in html
    assert ".gcal-key-add" in html
    assert ".gcal-detail-head" in html
    assert ".gcal-settings-row" in html
    assert ".gcal-sync-interval-hint" in html
