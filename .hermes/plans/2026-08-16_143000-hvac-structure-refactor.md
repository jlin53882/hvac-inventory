# hvac-inventory 結構重整 plan（A1–A3 + B2–B4）— v1.3（v4 pro 複審後修正版）

> **For Hermes:** 執行時用 subagent-driven-development 依 phase 逐個執行；**每 phase 完成 → 送 v4 pro 審查 → 修正併入 → commit → 回報家豪 → 才進下一 phase**（2026-08-14 家豪定案審查鐵則，不得跳過/合併）。
>
> **v1.1 修正（2026-08-16，v4 pro 初審 641s）**：Tier A×2 + Tier B×7 + Tier C×9 已併入。
> **v1.2 修正（2026-08-16，對齊 units/設定中心批次）**：C1-C7 對齊 HEAD adc86b6；測試基準實跑 **591 passed**。
> **v1.3 修正（2026-08-16，v4 pro 複審 342s）**：Tier A×2（A-1 漏 `test_calendar_appt_only_start_time` L954 拆檔必紅；A-2 L732 硬編碼 read(style.css) git rm 後 FileNotFoundError）+ Tier B×1（完整 10 條測試清單）+ Tier C×3（globals 8 var/非 contiguous 切片/ settings 無 calendar 區依賴）全數併入本版。

**Goal:** 消除「改一個地方影響其他地方」的維護風險——CSS 撞名、calendar.js 一檔多職責、model 分散定義、main.py 職責混雜、movements/service-types 職責偏位。全部是**純搬移重構**，API 路徑、DB schema、前端行為**零改變**。

**現況基準（2026-08-16 HEAD adc86b6 實測，`wc -l`/`grep`）：**
| 檔案 | 行數 | 問題 |
|---|---|---|
| `static/css/style.css` | 971 | 單一檔混庫存+行事曆+權限+設定覆寫，已 3 次 class 撞名事故（.switch/.btn-primary/.btn-ghost） |
| `static/js/render/calendar.js` | 531 | 6 職責一檔（渲染/modal/設定/字典/人員/匯出） |
| `app/routes/users.py` 等 3 檔 | — | **9 個** Pydantic model 內嵌（users.py 5 + auth.py 2 + appointments.py 2；models.py 已有 **15 個**（12 原 + UnitIn/UnitUpdate/UnitConsolidate）） |
| `main.py` | ~230 | 3 個 middleware + lifespan + 頁面路由（**含 settings.html**）+ 照片保護 |
| `app/routes/items.py` | 502 | `/api/movements`（跨領域流水）放品項檔 |
| `app/routes/appointments.py` | 402 | service-types 字典管理混行事曆檔 |

**測試基準：591 passed**（2026-08-16 實跑 `pytest --collect-only` 定案；553 基準 +38：test_units 17 + rbac 2 + test_main 15 + users/v101/frontend）。

**執行鐵則（家豪規則，AGENTS.md）：**
1. 每 phase 一個 commit；commit 前跑 `./scripts/run-tests.sh` 對應組別 + gitnexus detect_changes（staged scope, repo=hvac-inventory）
2. 搬移後 dead code 自查：搬走函式的殘留 import（Query/BaseModel/Optional）同 commit 刪除
3. 純搬移禁止「順手改邏輯」；CRLF/LF 以 `git show HEAD:<file>` 實測對齊（**實測值：calendar.js LF、globals.js CRLF、index.html CRLF、style.css CRLF、test_frontend_assets.py LF**）
4. 測試總數維持 591；Phase 5 新增 2 條 index.html script 斷言 → 完成後 **593**

---

## Phase 1：A3 — Pydantic model 收攏到 `app/models.py`

**Objective:** 9 個內嵌 model 集中管理，消除「改 model 要去找定義在哪」的擴散。

**Files:**
- Modify: `app/models.py`（現有 15 個之後 +9 class）
- Modify: `app/routes/users.py`、`app/routes/auth.py`、`app/routes/appointments.py`（移除內嵌 + 改 import）

**搬移清單（來源 → models.py 分區）：**
| model | 來源 | 目標分區 |
|---|---|---|
| UserCreate / UserUpdate / UserPassword / UserBatch / UserPermissionsUpdate | users.py:31-53 | `# ---------- 使用者 ----------` |
| LoginRequest / ChangePasswordRequest | auth.py:71-76 | `# ---------- 認證 ----------` |
| AppointmentIn / ServiceTypeIn | appointments.py:36-55 | `# ---------- 行事曆 ----------` |

**Steps:**
1. `app/models.py` 新增 9 個 class（**內容逐字搬移，一個欄位不變**），加 `# ---------- 使用者 / 認證 / 行事曆 ----------` 分區註解。⚠️ **搬移順序**：models.py 無 `from __future__ import annotations`，`UserBatch.users: list[UserCreate]` 在 class 定義時求值——**UserCreate 必須保持在 UserBatch 之前**（依 users.py 原順序搬即可）。⚠️ **C3 對齊**：models.py 現已 15 個（含 units 的 UnitIn L102 / UnitUpdate L106 / UnitConsolidate L112）——新增 9 個加在其後，命名無衝突。
2. 三個 route 檔：刪除內嵌 class 定義，改為 `from app.models import ...`：
   - users.py: `from app.models import UserBatch, UserCreate, UserPermissionsUpdate, UserPassword, UserUpdate`
   - auth.py: `from app.models import ChangePasswordRequest, LoginRequest`
   - appointments.py: `from app.models import AppointmentIn, ServiceTypeIn`
3. **dead import 清理（同 commit）**：三個 route 檔搬走全部 model 後，一律移除 `from pydantic import BaseModel`（grep 確認零殘留）；appointments.py 的 `from typing import List, Optional` 改為 `from typing import List`（**Optional 僅 AppointmentIn 使用，List 仍被 `_validate_users` 用**）。
4. 驗證：`python -c "import ast; ast.parse(open('app/models.py',encoding='utf-8').read())"` + `./scripts/run-tests.sh core`（預期全綠，591 基準）。

**風險:** 無（純搬移；tests 走 HTTP 層不 import model 符號）。✅ v1.1 審查確認：搬走後三檔 `from pydantic import BaseModel` 零殘留、`UserBatch` 同檔搬移成立、users.py 5 model 原位未被 12 commit 動過。

---

## Phase 2：B3 — `/api/movements` 抽到 `app/routes/movements.py`

**Objective:** 流水帳查詢（跨出庫/退回/盤點/調整）不再寄生 items.py。

**Files:**
- Create: `app/routes/movements.py`
- Modify: `app/routes/items.py`（刪 L492-**503** + docstring L11 + Query import；⚠️ return 在 L503 且為檔末無尾 newline，`wc -l` 報 502 是陷阱）
- Modify: `main.py`（**L29 import 行** + L115-120 tuple）

**Steps:**
1. 新檔 `app/routes/movements.py`（LF，仿 lookup.py 薄檔模式）：
```python
# -*- coding: utf-8 -*-
"""異動紀錄路由（跨領域流水：出庫/退回/盤點/調整皆寫入 movements）。"""
from fastapi import APIRouter, Query

from app.database import get_db

router = APIRouter()


@router.get("/api/movements")
def list_movements(limit: int = Query(50, ge=1, le=500)):
    """異動紀錄（含品項名稱/品牌），依 id 倒序回傳最近 limit 筆"""
    conn = get_db()
    rows = conn.execute(
        """SELECT m.*, i.name, i.brand FROM movements m
           JOIN items i ON i.id = m.item_id
           ORDER BY m.id DESC LIMIT ?""",
        (limit,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]
```
2. items.py：刪除 list_movements（L492-503 整段）；docstring 的 `- GET /api/movements 異動紀錄`（L11）移除；**Query 只有 L493 用 → 從 `from fastapi import Depends, APIRouter, Body, HTTPException, Query` 移除 Query**（dead import）。
3. main.py **兩處改動（v1.1 審查 Tier A-1）**：① **L29 import 行**現況 = `from app.routes import appointments, auth, export, items, kits, lookup, photos, stats, stockout, stocktake, users, units`（**已含 units，v1.2 對齊 C1**）——**加 `movements`** → `..., users, units, movements` ② L115-120 tuple 現況已含 `units.router`——加入 `movements.router`（在 items 旁）。⚠️ 改前先 `sed -n '28,31p' main.py` 確認當前行。
4. 驗證：`pytest tests/test_main.py -k movement -q`（HTTP 層 ~15 處）+ `./scripts/run-tests.sh core`。

**風險:** 無（API 路徑、SQL、回傳結構逐字相同）。✅ v1.1 審查確認：list_movements 內容逐字相符、Query 僅 L493 用、movement 測試全走 HTTP 層。items.py 未被 12 commit 動過（git log 驗證）。

---

## Phase 3：B4 — service-types 抽到 `app/routes/service_types.py`

**Objective:** 服務項目字典管理（svc-type-mgmt 權限）獨立成檔，行事曆檔專注行程 CRUD。

**Files:**
- Create: `app/routes/service_types.py`
- Modify: `app/routes/appointments.py`（刪 4 端點 + docstring 段落 + `import sqlite3`）
- Modify: `main.py`（**L29 import 行** + tuple）

**Steps:**
1. 新檔 `app/routes/service_types.py`：`ServiceTypeIn`（`from app.models import ServiceTypeIn`，Phase 1 已收攏）+ 4 個端點（list L330 / create L341 / update L363 / deactivate L388）**逐字搬移**（含 try/except rollback/finally 鎖洩漏防護、`sqlite3.IntegrityError` 精準捕捉 400、404 檢查）。imports：`sqlite3`、`APIRouter/Depends/HTTPException`、`get_db`、`require_perm`。
2. appointments.py：刪除 4 端點 + docstring 內 service-types 3 行說明；**`import sqlite3`（L21）搬走後 dead——sqlite3 僅 create L351 / update L376 的 `except sqlite3.IntegrityError` 使用** → 移除。`_validate_service_type`（L78-84）只做 `SELECT id FROM service_types`，保留。
3. main.py **兩處改動（v1.1 審查 Tier A-1）**：① L29 import 行（現況已含 units，v1.2 C1）**加 `service_types`** ② tuple（現況已含 units.router）加 `service_types.router`。
4. 驗證：`pytest tests/test_appointments.py -k service_type -q`（3 條 HTTP 層）+ `./scripts/run-tests.sh regression`。

**風險:** 低。✅ v1.1 審查確認：4 端點行號正確、sqlite3 殘留為 dead、測試走 HTTP 層。appointments.py 未被 12 commit 動過（git log 驗證）。

---

## Phase 4：B2 — 3 個 middleware 抽到 `app/middleware.py`

**Objective:** main.py 專注「組裝 + 頁面路由」，安全/快取 middleware 集中管理。

**Files:**
- Create: `app/middleware.py`
- Modify: `main.py`（刪 3 函式，改 import + 註冊）

**Steps:**
1. 新檔 `app/middleware.py`：`cache_control_middleware` / `csrf_origin_middleware` / `security_headers_middleware` **逐字搬移**（含函式內 `from urllib.parse import urlparse`、Response 使用）。保留 duck-typing `(request, call_next)` 簽名（行為零改變，不加 type hints）。middleware.py 只依賴 `fastapi.responses.Response` + `urllib.parse` → 無循環 import ✅。
   ⚠️ **C2 對齊（v1.2）**：`cache_control_middleware` 的 no-cache 清單**現況已含 `/settings.html`**（daadf73 加）：
```python
if path in ("/", "/login.html", "/permissions.html", "/settings.html"):
```
   搬移時**含此路徑**（逐字搬即可，勿用 v1.1 舊範例的 3 路徑清單）。
2. main.py：
   - 刪除 3 個 `@app.middleware("http")` 函式定義
   - `from app.middleware import cache_control_middleware, csrf_origin_middleware, security_headers_middleware`
   - 在 app 實例後保留**原註冊順序**（cache → csrf → security，三行 `app.middleware("http")(fn)`）——Starlette `build_middleware_stack` 用 `reversed()`，**後註冊者（security）最內層、最先處理 request**；保持定義順序即執行序不變（✅ v1.1 審查確認）
   - `Response`/`FileResponse` import 保留（`_versioned_html` / `read_photo` 仍用）
3. 驗證：`./scripts/run-tests.sh frontend`（含 test_security_headers / CSRF）+ curl 實測：
   - `curl -si http://127.0.0.1:8000/ | grep -i x-frame-options`（DENY）
   - `curl -si http://127.0.0.1:8000/settings.html | grep -i cache-control`（no-cache, must-revalidate——**驗證 settings.html 路徑有搬過去**）
   - `curl -si -X POST http://127.0.0.1:8000/api/auth/login -H "Origin: http://evil.com" | head -1`（403）

**風險:** 低。唯一注意 middleware 註冊順序不變 + settings.html 路徑。✅ v1.1 審查判定 Phase 4 可行無誤。

---

## Phase 5：A2 — `calendar.js` 拆 3 檔

**Objective:** 行事曆 6 職責分離：渲染 / 派工 modal / 設定管理。

**⚠️ 核心技術決策：`let`/`const` 不跨 `<script>` 標籤——共享狀態必須搬 `globals.js` 用 `var`**（既有先例：ALL_ITEMS/currentTab 全在 globals.js）。✅ v1.1 審查確認：7 個 var 名全 static/js 無撞名（app.js L102 用 `typeof calMonth !== 'undefined'` 守衛）。

**Files:**
- Modify: `static/js/globals.js`（**+8 個 var**：_calM/calMonth/calSelected/calEvents/calSvc/calAssignable/CAL_PALETTE/CAL_WEEK；⚠️ CRLF）
- Modify: `static/js/render/calendar.js`（瘦身；⚠️ LF）
- Create: `static/js/modals/calendar.js`（派工 modal）
- Create: `static/js/modals/calendar-settings.js`（⚙️ 設定）
- Modify: `static/index.html`（script 標籤；⚠️ CRLF）
- Modify: `tests/test_frontend_assets.py`（讀檔 helper + 斷言路徑；⚠️ LF）

**Steps:**
1. **globals.js 新增行事曆狀態區塊（var）**：
```javascript
// 行事曆（render/calendar.js + modals/* 共享；let/const 不跨檔，2026-08-16 拆檔搬入）
var _calM = new URLSearchParams(location.search).get('month');   // 原 calendar.js L6（無 DOM 依賴，可在此執行）
var calMonth = _calM && /^\d{4}-\d{2}$/.test(_calM) && Number(_calM.slice(5,7)) >= 1 && Number(_calM.slice(5,7)) <= 12 ? new Date(parseInt(_calM.slice(0,4)), parseInt(_calM.slice(5,7))-1, 1) : new Date();
var calSelected = new Date();
var calEvents = [];
var calSvc = [];
var calAssignable = [];
var CAL_PALETTE = ['#1a73e8', '#e91e63', '#9c27b0', '#2e7d32', '#f57c00', '#00838f', '#c62828', '#5d4037'];
var CAL_WEEK = ['日', '一', '二', '三', '四', '五', '六'];
```
2. **render/calendar.js 保留**：`_iso`/`_fmtTW`/`renderCalendar`/`calRenderReminder`/`calLoadData`/`calRenderMonth`/`calFmtCreatedAt`/`calRenderDay`/`calChangeMonth`/`calPickDate`/`calExport`（~330 行）。刪除 modal/設定段落。**⚠️ v1.3 複審註記：函式 render/modal/settings 交錯非 contiguous（calExport L393 夾在 calDeleteAppt L382 與 calSetTab L417 之間）——以函式清單為搬移依據，勿按行號切片**。
3. **modals/calendar.js（新）**：`calModalHtml`/`calOpenAppt`/`calSubmitAppt`/`calDeleteAppt`/`closeCalModal` + `let calApptUpdatedAt = null`（modal 內部狀態留 let，僅此檔使用）。
4. **modals/calendar-settings.js（新）**：`calSettingsHtml`/`calSetTab`/`calOpenSettings`/`calRenderSvcRows`/`calUpdSvc`/`calUpdSvcActive`/`calAddSvc`/`calDelSvc`/`calRenderPplRows`/`calSetColor`。
5. **index.html script 標籤（v1.2 C5 對齊——現況 L496-516，calendar.js 在 L507，units.js 在 L500）**：`render/calendar.js` 保留原位（L507）；modals 群組（L508 edit.js 前）插入 `<script src="/static/js/modals/calendar.js" defer>` + `<script src="/static/js/modals/calendar-settings.js" defer>`。**順序：render → modals/calendar → calendar-settings → 其他 modals → app.js**。⚠️ 改前 grep `script src` 確認當前行號（可能又漂移）。
6. **test_frontend_assets.py（v1.2 C4 對齊——8 條 calendar 斷言現況行號）**：
   - 新增 helper：
```python
CALENDAR_MODAL_JS = os.path.join(STATIC, "js", "modals", "calendar.js")
CALENDAR_SETTINGS_JS = os.path.join(STATIC, "js", "modals", "calendar-settings.js")
GLOBALS_JS = os.path.join(STATIC, "js", "globals.js")

def read_calendar_js_all():
    # ⚠️ 必含 globals.js：URLSearchParams 初始化（_calM/calMonth）搬去 globals.js，test_calendar_js_month_url 斷言它在這
    return read(CALENDAR_RENDER_JS) + read(CALENDAR_MODAL_JS) + read(CALENDAR_SETTINGS_JS) + read(GLOBALS_JS)
```
   - 現有讀 `render/calendar.js` 的斷言**全部**改呼叫 `read_calendar_js_all()`——**斷言內容與語意不變**。**完整 10 條清單（v1.3 複審實測，2026-08-16）**——執行前一律 `grep -n "def test_calendar\|read(CALENDAR_RENDER_JS)" tests/test_frontend_assets.py` 重定位：
     - test_index_loads_calendar_js（L866）：**加**斷言 `'/static/js/modals/calendar.js' in index` + `'/static/js/modals/calendar-settings.js' in index`
     - test_calendar_js_has_core_functions（L877）、test_calendar_js_uses_api_endpoints（L887）、test_calendar_js_viewer_write_hidden（L917）、test_calendar_cell_selected_highlight_js（L945）、**test_calendar_cell_shows_service_client（L932，v1.3 B-1——斷言 evts.slice(0,2)/cal-evt-time/cal-evt-body 在 render 區不會壞，但為一致性也走 helper）** → helper
     - **test_calendar_appt_only_start_time（L954，v1.3 複審 Tier A-1）**：斷言 `id="cal-f-hour"`/`id="cal-f-minute"`/`cal-f-end` not in/`type="time"` not in/`{length: 24}`/`i * 5`/`end_time: timeVal`——**全在 calModalHtml/calSubmitAppt（搬去 modals/calendar.js）→ 拆檔後正向斷言必 FAIL**，必走 helper
     - **test_calendar_time_optional（L972）**：內含 `js.split("const t =")[1].split("const timeVal")[0]` 順序斷言——`const t =`/`const timeVal` 同在 modals/calendar.js，helper 成立
     - **test_calendar_js_optimistic_lock_snapshot（L1253）**：`calApptUpdatedAt` 在 modals/calendar.js → helper
     - **test_calendar_js_month_url（L1278，v1.1 審查 Tier A-2）**：斷言 `"new URLSearchParams(location.search).get('month')"` ——字串在 **globals.js**，helper 含 globals.js 才過
7. 驗證：`node --check`（test_js_syntax 全量自動涵蓋新檔）+ `./scripts/run-tests.sh frontend` + browser 實測：行事曆頁（月曆渲染/新增派工 modal/⚙️ 設定開關服務項目/人員顏色）+ F5 URL ?month 保留。

**風險:** 中。① `let`→`var` 語意變化（審查確認無撞名）② `calMonth` 初始化在 globals.js 於 DOMContentLoaded 前執行（`location.search` 無 DOM 依賴 ✅）③ **render↔modals 雙向執行期依賴（v1.1 審查 B5）**：`renderCalendar` 直接呼叫 `calModalHtml`/`calSettingsHtml`——靠 defer 全載後執行期解析安全 ✅。✅ v1.1 審查確認：test_js_syntax（os.walk 全量，**units.js/settings.js 已自動涵蓋**）／test_all_js_loaded_by_index／XSS 掃描三者拆檔後不會壞。

---

## Phase 6：A1 — `style.css` 拆 2 檔（core + calendar）

**Objective:** 行事曆樣式獨立，斷開「加行事曆樣式撞到庫存/權限/設定全域 class」的污染鏈。

**Files:**
- Create: `static/css/style.core.css`（原 L1-876）
- Create: `static/css/style.calendar.css`（原 L877-971）
- Modify: `static/index.html`（link 2 檔）、`static/permissions.html`（link core）、**`static/settings.html`（v1.2 C6 新增——link core）**
- Modify: `tests/test_frontend_assets.py`（CSS 讀檔 helper）
- 保留 `style.css` 原地刪除（git rm）

**Steps:**
1. 用 Python 腳本按行號切片（**逐字搬移，不改任何規則內容**）：`L1-876 → style.core.css`、`L877-971 → style.calendar.css`。行號以當次 `grep -n "^/\* ========== 行事曆派工"` 實測為準（✅ v1.1 審查確認 L877 切點正確）。**⚠️ style.css 是 CRLF**——切片腳本 `newline=''` 讀寫保 CRLF，寫回後 `git diff --stat` 確認非整檔假變動。**⚠️ 共享樣式警告（v1.1 審查 B7）：calendar.css 內含 `.btn-sm`(L893)/`.btn-sm.btn-primary`(L894)/`.btn-card`(L919-921)，inventory.js 的「＋ 新增」「⬇️ 匯出庫存」按鈕依賴它們——calendar.css 不是「純行事曆樣式」，未來不可單獨移除**（收尾紀錄同步註記）。
2. index.html L16：`<link rel="stylesheet" href="/static/css/style.core.css">` + `<link rel="stylesheet" href="/static/css/style.calendar.css">`（**順序 = 原檔順序，core 前 calendar 後**——calendar 若有覆寫 core 的規則，後載入勝，行為不變）。
3. permissions.html L7：`href="/static/css/style.core.css"`（內嵌 `.switch` 是自足定義 L74-80，core-only 反而根除與行事曆 `.switch` 撞名 ✅ v1.1 審查確認）。
4. **settings.html（v1.2 C6 新增）**：L7 現況 `href="/static/css/style.css"` → `href="/static/css/style.core.css"`。**✅ v1.2 實測修正：settings.html 的開關是 `.settings-switch`（自足 class，L43-48 完整定義，非 `.switch`）——註解雖寫「複用 style.css .switch 結構」但實際不依賴 style.css 的 .switch，無覆寫衝突**；只需確認 `.topbar` 內嵌覆寫（L11 `padding: 10px 20px`）在 link 之後（覆寫優先序不變，比照 permissions.html 先例）。**✅ v1.3 複審補證：settings.html + settings.js 對 calendar 區（L877+）類別（.btn-sm/.btn-card/.switch/cal-*）零命中，唯一外部依賴是 core 的 `.btn-primary`（L41）→ 只掛 core 正確**。
5. 確認無其他引用：`grep -rn "style.css" static/ tests/ scripts/`——預期 = test helper + **3 處 link（index/permissions/settings）** + permissions.html L69/L71 與 settings.html 註解文字 + **`tests/test_frontend_assets.py:732` 硬編碼 read（v1.3 A-2）**；test_security_regression / test_v101 的 `"css/style.css"` 是路徑 predicate 輸入（拆分後仍過，可選擇性更新）。
6. **test_frontend_assets.py**：
   - `CSS = ...` 改為：
```python
CSS_CORE = os.path.join(STATIC, "css", "style.core.css")
CSS_CAL = os.path.join(STATIC, "css", "style.calendar.css")

def read_css_all():
    return read(CSS_CORE) + read(CSS_CAL)   # 合併順序 = 原檔順序，內容 == 原 style.css
```
   - 所有 CSS 斷言（test_css_calendar_styles / test_css_cal_selected_highlight / test_css_cal_evt_b_variant / test_css_permissions_switch_override / test_css_btn_primary_defined 等，含 `.stat-cards` 的 `css.split(".cal-grid")[0]` 邊界斷言）全部改呼叫 `read_css_all()`——**斷言字串與語意零改變**（合併後內容 == 原 style.css，v1.1 審查確認）。
   - ⚠️ **L732 `test_resetpw_modal_ui_present` 是硬編碼 `css = read(os.path.join(STATIC, "css", "style.css"))`（不走 CSS 常數，全檔唯一——v1.3 複審 Tier A-2）**：`git rm style.css` 後直接 FileNotFoundError。**改 `read_css_all()`**（斷言 `.btn-cancel-ghost` 在 L724=core 區，合併讀仍含，語意不變）。
7. 驗證：`./scripts/run-tests.sh frontend` + browser 實測**四頁**（庫存首頁桌面+手機 390px、行事曆月曆格/明細卡、permissions.html 開關/按鈕、**settings.html 設定中心**）——**逐項對照拆檔前截圖**。

**風險:** 中高（撞名歷史區域）。防護：
- 純切片不重寫 → 規則內容零改變
- 合併讀 helper 讓測試語意不變
- permissions/settings 內嵌覆寫在 link 後 → 覆寫優先序不變
- 若 browser 實測發現樣式差 → 回滾該 phase（git checkout，其他 phase 已各自 commit）

---

## 驗證總表（每 phase 執行）

| Phase | 測試組 | 額外驗證 |
|---|---|---|
| 1 models | core | ast.parse models.py + 三 route 檔 |
| 2 movements | core | pytest -k movement |
| 3 service_types | regression | pytest -k service_type |
| 4 middleware | frontend | curl X-Frame-Options / **settings.html no-cache** / CSRF 403 |
| 5 calendar.js | frontend | node --check 全量 + browser 行事曆 3 功能 + F5 URL |
| 6 style.css | frontend | browser **四頁**桌面/手機 + 前後對比 |

全量基準：**591 passed**（2026-08-16 實跑定案）；每 phase 跑對應組別，全部完成後跑全量 `all` 定案。完成後預期 **593**（Phase 5 新增 2 條 index.html script 斷言）。

## 風險與開放問題

1. **CSS 拆分是唯一有視覺風險的 phase**（A1）——其餘 5 phase 零 UI 改變。若 Phase 6 實測發現不可接受的樣式差，可單獨回滾 Phase 6 commit，不影響其他 phase。
2. **calendar.js 拆檔的 `let→var`**：globals.js 新增 **8 個 var**（含 `_calM`）會成為 window 全域——v1.1 審查確認 7 個無撞名，v1.3 複審補證 `_calM` 亦無撞名（units.js 用 unitList/unitListActive、settings.js 用 unitUsage，互不干擾）。
3. **Phase 順序依賴**：Phase 1（models 收攏）是 Phase 3（service_types 用 ServiceTypeIn）前置；其餘 phase 互相獨立。不可重排 1/3。
4. **測試數**：搬移不改行為 → 測試總數維持 591；僅新增 2 條 index.html script 標籤斷言（Phase 5）→ 完成後 593。
5. **不做**：B1（雜物清掃）、B5（AGENTS.md 進版控）不在本次範圍（另案處理）。
6. **gitnexus detect_changes**：搬移會報 critical（高扇出符號如 router 註冊觸碰）——屬預期「觸碰面廣」非「會壞」，以 pytest 全綠 + 人工 blast radius 判讀（AGENTS.md 既有規則）。
7. **並行 commit 對齊（v1.2）**：本版基準 = HEAD `adc86b6`。執行前若 HEAD 又推進，先 `git log --oneline -5` + `git status --short` 檢查是否動到 plan 關鍵檔（main.py / models.py / index.html / test_frontend_assets.py / style.css / calendar.js / globals.js / items.py / appointments.py / auth.py / users.py）——動到就重定位行號，沒動直接沿用。
8. **settings.html 是 v1.2 新增處理對象**（C6）：Phase 6 前先 `grep -n "stylesheet" static/settings.html` 確認當前行號與 .switch 覆寫結構（v1.2 未逐行驗證內嵌覆寫——複審待確認）。

## 時間估算拆解

| 構成 | 時間 |
|---|---|
| 純搬移 code（6 phase × ~25-30 min） | ~3h |
| 測試 + browser 實測（含 CSS 前後對比） | ~1.5h |
| 每 phase v4 pro 審查 × 6 + 修正 | ~1.5h |
| 全量 pytest + gitnexus + 收尾 | ~0.5h |
| **總計** | **~6.5h** |
