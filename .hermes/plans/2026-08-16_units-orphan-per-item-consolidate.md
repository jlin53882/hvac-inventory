# 單位歷史值「逐筆收編」— 方案 B 分組展開式 Implementation Plan

> **狀態**：**v1.1（2026-08-16 v4 pro 審查後修正版）**— 家豪選定方案 B（分組展開式）後設計；審查 finding 已全數併入（A1/A2/B1/B2/C1-C5 標記於對應 Task）。**定案後才開工**。
> **對應 mockup**：`sketches/units-consolidate-variants/B-grouped-accordion.html`（家豪已確認）。
> **執行鐵則（家豪 2026-08-14）**：每 phase 完成 → 送審查（Tier A/B/C）→ 修正併入 → commit → 回報 → 才進下一 phase。

**Goal**：把設定中心「不在清單的歷史單位」從「單位層級整批收編」改為「分組展開、逐筆指定目標單位」，並把下拉預設從「第一個單位」改為「— 請選擇 —」，消滅收編後的二次檢查。

**Architecture**：後端新增 2 端點（orphans 明細 + 單筆收編），前端 settings.js 的收編區改為手風琴分組（組內逐筆 select+按鈕，組底保留整批快速套用）。既有 `consolidate` 整批端點**保留**（組底「套用全部」直接複用它）。

**Tech Stack**：FastAPI + SQLite（items 表）+ vanilla JS（settings.js）+ pytest 靜態資產斷言。

---

## 背景與現況（已工具驗證）

- 活庫：**18 筆品項 / 7 種問題單位**（`（空白）`×11、`/4罐`×2、`罐 + 1/4罐`×1、`/4罐 + 1/2罐`×1、`/3 包`×1、`/2(兩罐) + 1/4(一罐)`×1、`+ 1/4`×1）——全部 is_deleted=0。
- 現行 UI（settings.js `renderUnitsPanel` L44-56）：每種歷史單位一行 = `「（空白）」× 11 筆` + `<select>`（**預設第一個 active 單位「個」**）+ 收編按鈕 → `POST /api/units/consolidate` 整批改。痛點＝空白 11 筆被迫共用同一目標單位，收完必二次檢查。
- 現行 orphans 判定：`unitUsage.filter(u => u.count > 0 && !unitListActive.some(x => x.name === u.unit))`——**語意＝「不在啟用單位清單」**（含停用字典單位），非「不在字典」。新 orphans 端點必須保持此語意（LEFT JOIN units ON unit=name AND is_active=1 → u.id IS NULL）。
- `GET /api/units/usage` 只統計 is_deleted=0；`consolidate` 收編含幽靈品項（B4 決策）。新 orphans 端點**直接列明細（含幽靈）**，根治「顯示 N 筆 vs 實際收編數不一致」。
- 並行 agent 正在改（未 commit）：`static/js/globals.js`、`static/js/render/stocktake.js`、`tests/test_frontend_assets.py`、`tests/test_security_regression.py`——**開工前 `git status --short` 重查**，只 commit 自己的檔（家豪 08-13 規則）。**Phase 2 開工前重讀 test_security_regression.py 最新內容（B2 白名單要 patch 的正是此檔）**。
- **items schema 事實（C2 修正）**：`brand TEXT NOT NULL DEFAULT ''`（database.py:48）、`name NOT NULL`（:50）、`site NOT NULL DEFAULT 'office'`（:55）——**只有 `code` 可 NULL**。衝突 SQL 的 `IS ?`/`COALESCE` 屬防禦性寫法，仍正確。
- HEAD=`881376a`；行尾：settings.js / units.py / models.py / settings.html 全 **LF**（2026-08-16 實測 `git show HEAD:` 無 CRLF）。
- `test_units.py` 現有 17 條；`tests/test_frontend_assets.py` 目前**對 settings.js 零斷言**（L714 斷的是 **auth.js** 的「⚙️ 設定」按鈕 `location.href='/settings.html'`，非 settings.html 內容，C4），無需翻轉舊斷言；SETTINGS_HTML 常數在 L302。

---

## Phase 1 — 後端（models + 2 端點 + 測試）

> 改動檔：`app/models.py`（L115 後）、`app/routes/units.py`、`tests/test_units.py`。models.py 屬「改到 = 跑 all」觸發檔，Phase 1 驗證跑 `./scripts/run-tests.sh all`。

### Task 1.1：models.py 新增 UnitConsolidateItem

**File**：Modify `app/models.py`（L115 `UnitConsolidate` 之後、L118 `# ---------- 使用者` 之前）

```python
class UnitConsolidateItem(BaseModel):
    """單筆收編：指定某一筆品項改為目標單位（2026-08-16 方案 B 逐筆收編）"""
    item_id: int
    to_unit: str = Field(..., min_length=1, max_length=20)
```

**Verify**：`grep -n "UnitConsolidateItem" app/models.py` 命中。

### Task 1.2：units.py 新增 GET /api/units/orphans

**File**：Modify `app/routes/units.py`（插在 `unit_usage` 函式之後；landmark 以函式名為準，勿用行號——先插 orphans 會讓後續行號漂移，C5）

**Objective**：回傳「unit 不在啟用字典」的每筆品項明細（含幽靈），前端分組用。

```python
@router.get("/api/units/orphans")
def unit_orphans():
    """unit 不在啟用單位清單的品項明細（全角色）：
    (B 方案) 逐筆收編的資料源——含 is_deleted=1 幽靈品項與 total_qty。
    語意對齊前端舊判定：LEFT JOIN units ON unit=name AND is_active=1 → u.id IS NULL。"""
    conn = get_db()
    try:
        rows = conn.execute(
            """SELECT i.id AS item_id, i.name, i.code, i.site, i.unit, i.is_deleted,
                      COALESCE((SELECT SUM(s.qty) FROM item_stocks s WHERE s.item_id = i.id), 0) AS total_qty
               FROM items i
               LEFT JOIN units u ON i.unit = u.name AND u.is_active = 1
               WHERE u.id IS NULL
               ORDER BY i.unit, i.site, i.name"""
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()
```

**Verify**：`python -c` 以正式 DB 試跑 SQL，回傳 18 筆（活庫現值）；「停用字典單位」情境用測試驗證。

### Task 1.3：units.py 新增 POST /api/units/consolidate-item

**File**：Modify `app/routes/units.py`（`consolidate_units` 函式之後即檔尾；landmark 以函式名為準）

**⚠️ A1（審查 Tier A）**：**先改 import 行**——`units.py:5` `from app.models import UnitIn, UnitUpdate, UnitConsolidate` 必須加 `UnitConsolidateItem`：
`from app.models import UnitIn, UnitUpdate, UnitConsolidate, UnitConsolidateItem`
（漏改 = FastAPI import 期求值函式簽名 type annotation → `NameError` → **整個 units router 掛，既有 /api/units 全部 404/500**，不只新端點。）

**Objective**：單筆收編（unit-mgmt）。防護：item 存在 404 / 目標在字典 400 / 同單位 400 / 單筆版 A3 衝突 409 / IntegrityError 兜底 409 / bump updated_at。

```python
@router.post("/api/units/consolidate-item", dependencies=[Depends(require_perm("unit-mgmt"))])
def consolidate_item(req: UnitConsolidateItem):
    """單筆收編：items.unit → to_unit（含幽靈品項）。不處理來源停用——
    來源若非字典值即無從停用；若為停用字典單位則早已停用（收編前即 is_active=0）。"""
    to = req.to_unit.strip()
    if not to:
        raise HTTPException(400, "目標單位不可為空白")
    conn = get_db()
    try:
        item = conn.execute("SELECT * FROM items WHERE id=?", (req.item_id,)).fetchone()
        if not item:
            raise HTTPException(404, "品項不存在")
        if conn.execute("SELECT id FROM units WHERE name=?", (to,)).fetchone() is None:
            raise HTTPException(400, f"目標單位「{to}」不在單位清單中，請先在清單新增")
        if item["unit"] == to:
            raise HTTPException(400, "該品項已是此單位")
        # 單筆版 A3 衝突：同 (brand,code,name,site) 已有 to_unit 活品項（排除自己）
        conflict = conn.execute(
            """SELECT id FROM items
               WHERE brand IS ? AND COALESCE(code,'') = COALESCE(?,'')
                 AND name IS ? AND site IS ? AND unit = ? AND is_deleted = 0 AND id != ?
               LIMIT 1""",
            (item["brand"], item["code"], item["name"], item["site"], to, req.item_id)).fetchone()
        if conflict:
            raise HTTPException(409, f"已存在同品名「{item['name']}」單位為「{to}」的品項，請先編輯合併再改")
        conn.execute("UPDATE items SET unit=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
                     (to, req.item_id))
        conn.commit()
        return {"ok": True, "item_id": req.item_id, "to_unit": to}
    except sqlite3.IntegrityError:
        conn.rollback()
        raise HTTPException(409, "改單位造成品項重複（唯一鍵衝突），請先合併品項再改")
    finally:
        conn.close()
```

**Verify**：unit-mgmt 三層強制（seed/auth.py 合成/users.py 守衛）已於 08-16 落地，端點掛 `require_perm("unit-mgmt")` 即自動生效——不新增權限 key，**test_rbac.py / test_rbac_perms.py 不需動**（16→17 是 08-16 已做過的，勿重複）。

### Task 1.4：test_units.py 新增 9 條（C1：實際 9 條——orphans×3 + consolidate_item×6，非標題舊寫的 8）

**File**：Modify `tests/test_units.py`（`test_units_consolidate_conflict_409` 之後）

先讀既有 fixture/client 用法（test_units.py L10-34 `client` fixture、L37-50 `_add_role_user`、L53-64 `_add_item` helper 都存在）。

**⚠️ B1（審查 Tier B）幽靈品項建立方式明示**：`_add_item` 只會 POST /api/items 建**活品項**（is_deleted=0）。建幽靈品項用以下方式（避免非庫存端點的 movement 副作用）：

```python
# 建幽靈品項（is_deleted=1）——比照 test 既有 import app_db 的方式
def _ghostify(client, item_id):
    from app import database as app_db
    conn = app_db.get_db()
    try:
        conn.execute("UPDATE items SET is_deleted=1 WHERE id=?", (item_id,))
        conn.commit()
    finally:
        conn.close()
```

```python
# ---------- 2026-08-16 方案 B：orphans 明細 + 單筆收編 ----------
def test_units_orphans_lists_items(client):
    """破碎值與停用字典單位的品項都列出（含幽靈與 total_qty）"""
    # 建 1 筆 unit='/4罐' 活品項 + 1 筆 unit='' 幽靈品項（is_deleted=1，非庫存模式）
    # 停用字典單位「條」→ 建 1 筆 unit='條' 品項
    # GET /api/units/orphans → 3 筆皆在，欄位齊全

def test_units_orphans_excludes_active_dict(client):
    """unit 在啟用字典的品項不出現在 orphans"""

def test_units_orphans_requires_login(client):
    """未登入 401/302"""

def test_units_consolidate_item_ok(client):
    """單筆收編成功（含幽靈品項 is_deleted=1），updated_at 被 bump"""

def test_units_consolidate_item_not_found(client):
    """item_id 不存在 → 404"""

def test_units_consolidate_item_target_not_in_dict(client):
    """to_unit 不在字典 → 400"""

def test_units_consolidate_item_same_unit(client):
    """已同單位 → 400"""

def test_units_consolidate_item_conflict_409(client):
    """同 (brand,code,name,site) 已有 to_unit 活品項 → 409（bug 版必紅：拿掉衝突檢查直接 UPDATE 會 IntegrityError 500）"""

def test_units_consolidate_item_requires_unit_mgmt(client):
    """user 角色 403"""
```

**Verify（TDD 三態）**：每條先寫 → 跑 `python .venv/Scripts/python.exe -m pytest tests/test_units.py -q` 確認紅 → 實作 → 綠；`conflict_409` 條目故意還原 bug 版（無衝突檢查）確認紅、再還原修復版確認綠（家豪 08-14 防回歸有效性規則）。

### Task 1.5：Phase 1 驗證 + commit

```bash
./scripts/run-tests.sh all        # models.py 觸發 all（-n auto ~60s），預期 591+9=600 passed
node --check 不需（無 JS 改動）
git add app/models.py app/routes/units.py tests/test_units.py
git commit -m "feat(units): 逐筆收編——GET /api/units/orphans 明細 + POST /api/units/consolidate-item 單筆收編"
```

**⚠️ 只 add 自己改的 3 檔**；commit 前 `git status --short` 確認並行 agent 的 4 檔未混入。
**→ 送審查（v4 pro）→ 修正併入 → 回報家豪 → 進 Phase 2。**

---

## Phase 2 — 前端（settings.js 分組手風琴 + CSS + 斷言）

> 改動檔：`static/js/settings.js`、`static/settings.html`（僅內嵌 CSS）、`tests/test_frontend_assets.py`。

### Task 2.1：settings.js 改收編區為分組手風琴

**File**：Modify `static/js/settings.js`

**改動點**：
1. 新增全域 `var orphanItems = [];`（settings.js 頂部 unitUsage 旁）。
2. 新增 `async function loadOrphans()`：`fetch('/api/units/orphans')` → 存 `orphanItems`（失敗靜默，比照 loadUnitUsage）。
3. `renderUnitsPanel()` 的 orphans 區塊（L44-56）**整段替換**為：
   - `orphanItems` 依 unit 分組（JS `Map`，key=unit 原值，`''` 顯示「（空白）」）
   - 每組渲染 `.grp`：`.grp-head`（組名 + 「N 筆」+ 展開箭頭，onclick toggle `.open`）→ `.grp-body`（組內每筆 `.g-table` 列：`esc(品名)` + `×數量` + `<select class="placeholder">`「— 請選擇 —」+ active 單位 + 「改為」按鈕 `onclick="consolidateItem(${item_id}, this)"`）
   - 組底 `.grp-fast`：整組快速套用 `<select>`（預設「個」？**不——預設「— 請選擇 —」**，選了才可按「套用全部」）→ 呼叫**既有** `POST /api/units/consolidate`（from_unit=組 unit、to_unit=選的，`confirm()` 二次確認）
   - **⚠️ 使用者可控資料（品名/組名）一律 `esc()`**（XSS 守則；test_security_regression 掃描器會檢查）
   - 空狀態：`orphanItems.length === 0` → 顯示「✅ 所有品項單位皆在清單中」（取代整個區塊）
4. 新增 `async function consolidateItem(itemId, btn)`：POST `/api/units/consolidate-item` `{item_id, to_unit}` → 成功：`await Promise.all([loadUnits(), loadOrphans()])` + `renderUnitsPanel()`（**該列自動消失＝即時回饋，免二次檢查**）+ toast；409/400 → toast detail（該列保留）。
5. 組底「套用全部」成功後同 `loadOrphans()+renderUnitsPanel()`。
6. `initSettings`（L153-174）：`await Promise.all([loadUnits(), loadOrphans()])`——**⚠️ A2（審查 Tier A）**：`loadUnitUsage` 改版後確定零使用（grep 全 repo 僅 settings.js L4/17/20/45/119/129/172 自引用），**Step 7 刪除 loadUnitUsage/unitUsage 時，必須一併把 initSettings 與 consolidateUnit（L129）Promise.all 裡的 `loadUnitUsage()` 移除**——兩處同步，否則 initSettings 啟動即 ReferenceError → 設定頁白屏。
7. `loadUnitUsage`/`unitUsage`：renderUnitsPanel 改版後零使用 → **同一 commit 刪除**（dead code 4 步自查 Rule 2；刪除 = settings.js 全域宣告 L4 + loadUnitUsage 函式 L17-22 + 所有呼叫點，含 initSettings L172 與 consolidateUnit L129——見 Step 6）。

**⚠️ 行尾**：settings.js 為 LF（實測），寫回維持 LF。

### Task 2.2：settings.html 新增分組 CSS

**File**：Modify `static/settings.html`（內嵌 `<style>`，`.hist-clean` L37-41 附近）

對齊 mockup B 樣式值（家豪會逐項比對 demo）：

```css
/* 方案 B 分組手風琴（2026-08-16 mockup B 定案值） */
.grp { border: 1px solid #f0d48a; border-radius: 8px; margin-bottom: 8px; overflow: hidden; background: #fffdf2; }
.grp-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 10px; cursor: pointer; flex-wrap: wrap; font-weight: 700; font-size: 12.5px; color: #8a6d1a; }
.grp-head:hover { background: #fff8e6; }
.grp-count { font-size: 11px; color: #b0893a; font-weight: 400; }
.grp-body { display: none; border-top: 1px dashed #eedaab; }
.grp.open .grp-body { display: block; }
.g-table { width: 100%; border-collapse: collapse; background: #fff; }
.g-table td { padding: 5px 10px; border-bottom: 1px solid #f7edcd; font-size: 12px; vertical-align: middle; }
.g-table tr:last-child td { border-bottom: none; }
.g-table .p-name { font-weight: 600; color: #333; }
.g-table .qty { color: #999; }
.g-table select { padding: 3px 4px; border: 1px solid #cfd6df; border-radius: 6px; font-size: 12px; width: 84px; }
.g-table select.placeholder { color: #aaa; }
.grp-fast { display: flex; align-items: center; gap: 6px; padding: 7px 10px; background: #fdf6e0; font-size: 11.5px; color: #8a6d1a; flex-wrap: wrap; }
.grp-fast select { padding: 3px 4px; border: 1px solid #cfd6df; border-radius: 6px; font-size: 12px; }
```

### Task 2.3：test_frontend_assets.py 新增防回歸斷言

**File**：Modify `tests/test_frontend_assets.py`（SETTINGS_HTML 常數已存在 L302；**讀 settings.js 的常數 JS_SETTINGS 目前不存在，需新增**（比照 SETTINGS_HTML 模式：`JS_SETTINGS = os.path.join(STATIC, "js", "settings.js")`））

新增 1 個 test class（或併入既有）。**⚠️ C3（審查 Tier C）：斷言要用「新 code 才存在」的精準 pattern**——`"esc("` 與 `"（空白）"` 是現行 settings.js 已存在的字串（L35/L50、L49），對舊 code 也通過、零鑑別力，不可用：

```python
def test_settings_js_orphan_group_ui():
    """方案 B：settings.js 有 loadOrphans / consolidateItem / 分組結構（防回歸退回整批模式）"""
    js = read(JS_SETTINGS)
    assert "loadOrphans" in js
    assert "function consolidateItem" in js or "consolidateItem(" in js
    assert "consolidate-item" in js            # 新端點呼叫（舊 code 無）
    assert "grp-head" in js or ".grp" in js    # 分組結構 class（舊 code 無）

def test_settings_js_unit_select_placeholder():
    """下拉預設「— 請選擇 —」（防回歸：預設第一個單位「個」的誤收編模式）"""
    js = read(JS_SETTINGS)
    assert "— 請選擇 —" in js
```

**Verify**：`assert "consolidate-item" not in <git show HEAD:settings.js>` 確認對舊 code 必紅（防回歸有效性，家豪 08-14 規則）。

### Task 2.4：Phase 2 驗證 + commit

**⚠️ B2（審查 Tier B）`${item_id}` 內插白名單**：Task 2.1 Step 3 的 `onclick="consolidateItem(${item_id}, this)"`——`test_security_regression.py` 掃描器只自動放行 `\w+.id`（如 `e.id`），**裸 `item_id` 不匹配** → `test_js_html_templates_interpolations_escaped` 會 flag。需在 `tests/test_security_regression.py` 的 `REVIEWED_SAFE_BODIES` 加一條（比照 `c.item_id`/`k.item_id`/`o.item_id` 先例）：

```python
"consolidateItem(${item_id}, this)",  # 數字 PK 內插（settings.js 逐筆收編，2026-08-16）
```

**⚠️ 該檔正被並行 agent 修改——開工前重讀最新內容再 patch**，避免衝突。

```bash
./scripts/run-tests.sh frontend    # frontend_assets + security + structure（node --check 由 test_js_syntax 自動全量）
node --check static/js/settings.js # 單檔保險（test_js_syntax 已含，雙保險）
# 瀏覽器實測：登入 → /settings.html → 單位管理 → 展開「（空白）」組 → 逐筆改為 → 該列消失；
# 組底套用全部 → confirm → 整批改 → 重拉後組消失；409 情境 toast
git add static/js/settings.js static/settings.html tests/test_frontend_assets.py tests/test_security_regression.py
git commit -m "feat(settings): 歷史單位改分組展開逐筆收編（方案 B）——預設請選擇、處理即時消失"
```

**→ 送審查（v4 pro）→ 修正併入 → commit → 回報家豪 → 進 Phase 3。**

---

## Phase 3 — docs + 全量 + 收尾

### Task 3.1：docs 同步

**File**：Modify `docs/單位與設定中心維護文件.md`

- 二、架構 API 表：加 `GET /api/units/orphans`、`POST /api/units/consolidate-item`（unit-mgmt）
- 四、收編語意：補「單筆收編」段（不處理來源停用的理由；單筆版衝突 409；逐筆不會互相拖累）
- 五、設定中心：收編區改為「分組展開、逐筆指定；組底整組快速套用（confirm 二次確認）；下拉預設請選擇」
- docs 與 code 同一 commit（08-16 規則）

### Task 3.2：全量 + 收尾

```bash
./scripts/run-tests.sh all   # 預期 600 + Phase 2 新增斷言數 → 全綠
git commit -m "docs: 單位與設定中心維護文件同步逐筆收編"
```

- 收尾紀錄 → Obsidian `00-專案文件/hvac-inventory-歷史單位逐筆收編-收尾紀錄-2026-08-16.md`（frontmatter + 需求脈絡（方案 B mockup 決策）+ 最終實作 + 測試表 + 驗證紀錄）
- commit/push：**12 commits（39d0cbd→82ea396 單位批次）若仍未 push，與本次分開確認**；push 前查 `git ls-remote origin`（家豪 08-13 規則）
- skill references 過時檢查：hvac-inventory-maintenance SKILL.md「2026-08-16 單位動態清單」段補一句逐筆收編

---

## 執行檢查清單（10 步，每 phase commit 前對照）

1. 位置：新端點在 units.py（勿塞他檔）；新 model 在 models.py ✅
2. 掛載：無新 router——units.py 已掛載；**無新 HTML 頁**，不需 main.py 路由；**⚠️ A1：units.py:5 import 行補 `UnitConsolidateItem`（漏 = 整個 units router NameError 全掛）**
3. 權限：orphans 全角色、consolidate-item unit-mgmt（既有三層強制，**不加權限 key**）
4. 安全：品名/組名內插一律 `esc()`；write 端點 item_id FK 檢查 + to_unit 字典檢查 + 400 不 500
5. dead code：`unitUsage` 改版後零使用 → 同 commit 刪 loadUnitUsage/unitUsage（Rule 2）；新函式全接到 UI
6. 測試：行為改動同步補（Task 1.4/2.3）；conflict 409 條目做 bug 版必紅驗證
7. 行尾：全部 LF（已實測），寫回不轉換
8. docs：Phase 3 同步，docs 與 code 同 commit
9. 測試組別：Phase 1 改 models → all；Phase 2 改 static → frontend 組
10. 並行 agent：commit 前 `git status --short`，只 add 自己的檔

## 審查鐵則（家豪 2026-08-14，plan 內建）

- ✅ plan 定案前送審一次（本 plan 交付前完成，finding 併入升 v1.1）
- 每 phase 完成 → 送審（v4 pro）→ 修正 → commit → 回報 → 下一 phase
- 送審 context 附「特別要查證的點」清單（08-16 實戰有效）：
  ① orphans 語意（LEFT JOIN is_active=1）與舊前端判定是否一致（停用字典單位案例）——**已驗證等價（v4 pro 正面確認 1）**
  ② consolidate-item 不做來源停用是否合理（來源非字典/已停用兩案例）——**已驗證成立（正面確認 2）**
  ③ 衝突 SQL 的 `IS ?`/`COALESCE` 對 NULL 處理（**C2 修正：只有 code 可 NULL，brand/name/site 皆 NOT NULL**；SQL 為防禦性寫法，與既有 units.py:128-130 一致——已驗證，正面確認 3）
  ④ settings.js 改版後 unitUsage 殘留判斷——**已驗證零使用（正面確認 4），刪除時同步 initSettings/consolidateUnit 呼叫點（A2）**
  ⑤ 測試斷言 pattern 精準度（勿裸字串）——**C3 已改為新 code 專屬 pattern**

## 時間估算拆解

| 構成 | 估時 |
|---|---|
| 純 code：後端 2 端點 + model + 8 條測試 | ~50 min |
| 純 code：前端 settings.js 手風琴 + CSS + 3 條斷言 | ~45 min |
| 測試 + 手動驗證（全量 pytest、重啟 server、瀏覽器逐筆實測、bug 版必紅） | ~40 min |
| 審查 2 次（定案前 + Phase 2）+ 修正 | ~40 min |
| docs + 收尾紀錄 | ~20 min |
| **合計** | **~3.2 h** |

## 風險 / 邊界

- **409 逐筆不互相拖累**：整批 consolidate 一衝突全擋；逐筆模式單筆 409 其他筆照常——方案 B 的天然優勢（plan 已驗證設計）。
- **組底「套用全部」仍是整批語意**：家豪 mockup 已確認（非預設、confirm 二次確認）；若執行時家豪改主意要逐筆迴圈 POST，改 Task 2.1 Step 4（前端迴圈逐筆，後端零改動）。
- 停用字典單位的品項會出現在 orphans（語意保持）——收編後該單位維持停用，品項 unit 已改，屬正確行為。
- 並行 agent 改 test_frontend_assets.py 中——Phase 2 commit 前重讀該檔最新內容（08-14 教訓：sibling 改同檔）。
