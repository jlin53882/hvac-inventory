# 單位動態清單 + 設定中心（C-3 / B-1）Implementation Plan

> **For Hermes:** 依本 plan 逐 Task 實作；每 phase 完成 → 送 v4 pro 審查 → 修正 → commit → 回報家豪 → 才進下一 phase。
> **家豪 2026-08-16 定案：** 單位動態清單採用 C-3 分層權限（＋ 快速新增 = item-mgmt；停用/排序/收編 = unit-mgmt admin）；設定入口採用 B-1 全頁 settings.html（麵包屑式 topbar + 左右清單，同帳號與權限頁）；topbar 改為 chip + 帳號與權限 + ⚙️ 設定 + 登出（改密碼收進設定頁）。

**Goal:** 單位欄位從「寫死 select + 自由輸入框」改為全站動態清單（UI 可新增、自動同步），並新增「⚙️ 設定中心」頁（左右清單）統一管理單位與修改密碼。

**Architecture:** 新增 `units` 字典表（複製 service_types 成熟模式）+ 獨立 `app/routes/units.py` API + 前端共用 `static/js/units.js`（4 個 modal 動態 select 與「＋」快速新增）+ 新頁 `static/settings.html`（麵包屑 topbar + 左右清單，修改密碼複用 changepw.js）+ RBAC 新權限 `unit-mgmt`（admin 預設 1）+ 歷史打錯值收編端點。items.unit 維持 TEXT（零遷移相容，清單外舊值自動補「（歷史）」選項）。

**Tech Stack:** FastAPI + SQLite + 原生 JS（無框架）/ pytest 靜態資產檢查

---

## 前置查證結論（2026-08-16 實測，勿再推測）

| 項目 | 實測結果 |
|---|---|
| 新增/編輯 modal 單位欄 | `static/index.html:135` `f-unit`、`:185` `e-unit` — `<select>` 寫死 10 option（個/罐/瓶/包/組/米/條/捲/盤/套） |
| 非庫存 modal 單位欄 | `static/index.html:271` `ns-unit`、`:307` `nsp-unit` — `<input type="text">` 自由輸入 |
| 活庫單位分佈 | 個 215、'' 11、包 10、組 7、條 1、**破碎 8 筆**（/4罐×2、罐 + 1/4罐、/4罐 + 1/2罐、/3 包、/2(兩罐) + 1/4(一罐)、+ 1/4、罐 + 1/4罐 已含上） |
| items.unit schema | `TEXT NOT NULL DEFAULT '個'`（database.py:52），unique key (brand,code,name,unit,site) 含 unit |
| service_types 先例 | database.py:125 CREATE TABLE、:247-258 種子（INSERT OR IGNORE）、appointments.py:329-395 CRUD 端點、權限 key `svc-type-mgmt`（auth.py:240 非 admin 強制 False）、前端管理 UI 在 calendar.js（calSetTab/calRenderSvcRows/calAddSvc） |
| RBAC 權限定義 | database.py:265-283 `permissions` 種子（key,label,module）；:285-308 `_RBAC_DEFAULT` 角色矩陣；權限頁 module 分組：`view`/`stock`(📦 庫存管理)/`calendar`(📅 行事曆與派工)/`system`(⚙️ 系統設定) |
| 權限頁樣式 | permissions.html：`.user-list` 250px 左清單 + `.chip-bar` 手機版橫列 + `.perm-row` 開關列（perms.js 渲染，GROUP_LABELS 在 perms.js:10-12） |
| topbar 現況 | index.html:20-31 `.top-actions` > `#userMenu`；auth.js:54-80 renderUserMenu：admin = chip + 🔑 改密碼(canChangePw) + 👥 帳號與權限(canManageUsers) + 🚪 登出（4 元件）；user = chip + 登出；手機版 `.user-menu` grid 2×2（style.css:852） |
| changepw modal | index.html:429-457 `changepw-modal`（openChangePwModal 開）；modals/changepw.js 函式：cpwCheckStrength/cpwCheckMatch/submitChangePw，依賴 index.html modal DOM |
| expiry 流程 | modals/expiry.js「立即改密碼」→ expiryGoChangePw() → openChangePwModal()（保留，不破壞） |
| 後端結構 | main.py 薄殼（L117-119 for 迴圈掛 router 含 require_login）；app/routes/ 11 檔已模組化；最大檔 items.py 502 行 |
| 前端結構 | static/js/ 已分 render/ + modals/ + 核心 7 檔；前端測試 = test_frontend_assets.py 靜態字串斷言 + test_js_syntax node --check（ALL_JS_FILES 全量動態收集，新 JS 自動納入） |
| docs/ 現況 | 7 檔：外網維護/安全性維護指南/行事曆維護/使用者與權限維護說明/前端資料更新機制/庫存操作維護/單元測試維護；另有 README.md、專案架構.md |
| 測試基準 | 553 passed（2026-08-14）；跑法 `./scripts/run-tests.sh [core|frontend|auth|rbac|regression|all]` |

## v4 pro 審查修正（2026-08-16，4A+5B+7C 已全數併入對應 Task）

> 審查結論「需修正後開工」。標記 (A1)~(C7) 對應審查 finding，各 Task 內已含修正後做法。
> **A1** settings.html 需 main.py 路由（static mount 是 /static 前綴，直連 `/settings.html` 會 404）；**A2** `pwPolicyMsg` 全 repo 無定義（既有 bug：changepw.js:55 送出即 ReferenceError）→ utils.js 補定義；**A3** consolidate 撞 unique index（items 唯一鍵含 unit）→ 衝突偵測 + IntegrityError 409；**A4** test_rbac.py/test_rbac_perms.py 手抄 16 項權限 → 需同步 17；**B1** test_frontend_assets.py:691 `openChangePwModal() in au` 需翻轉；**B2** settings.html 需 #toast + checkAuth；**B3** 單位管理面板依 unit-mgmt gating；**B4** consolidate 涵蓋 is_deleted=1 幽靈品項；**B5** consolidate 需 bump updated_at；**C1** hasPerm 在 utils.js；**C2** unitList 用 var；**C3** 強度容器 id 是 cpw-checks 非 pw-strength；**C4** add.js 開 modal 即 fillUnitSelect；**C5** 行號 ±3 漂移無害；**C6** 內嵌改密碼送出後清空欄位；**C7** closeModalForce('expiry-modal') 缺元素安全。

## 時間估算拆解

| 構成 | 時數 |
|---|---|
| Phase 0 前置盤點 + 既有 bug 修正（pwPolicyMsg） | 1h |
| Phase 1 DB（units 表+種子+收編 SQL） | 1h |
| Phase 2 API（units.py + main.py + models） | 1.5h |
| Phase 3 前端 modal 改造（units.js + 4 modal） | 2h |
| Phase 4 設定中心（settings.html/js） | 2.5h |
| Phase 5 topbar 改造（auth.js + index.html） | 0.5h |
| Phase 6 權限（unit-mgmt + RBAC + 權限頁） | 0.5h |
| Phase 7 測試補齊（test_units.py + frontend 斷言） | 1.5h |
| Phase 8 docs 更新 + 結構確認 | 1h |
| 審查 ×5（v4 pro）+ 修正 + 緩衝 | 3h |
| **合計** | **~14.5h** |

---

## Phase 0：前置盤點（0.5h，純分析不動 code）

### Task 0.2: 修既有 bug — utils.js 補 pwPolicyMsg 定義（A2）

**Objective:** `pwPolicyMsg` 全 repo 無定義（僅 changepw.js:55 呼叫）→ 改密碼一送出就 ReferenceError。補上定義（規則對齊後端 `_check_pw` auth.py:94-103）。

**Files:**
- Modify: `static/js/utils.js`（hasPerm 定義處附近——**hasPerm 實際在 utils.js:4，非 auth.js**，C1）

**Step 1:** utils.js 追加：
```javascript
// 密碼 policy（對齊後端 _check_pw：≥8 碼 + 大寫 + 小寫 + 數字）；通過回傳 null，否則回傳錯誤訊息
function pwPolicyMsg(pw) {
  if (!pw || pw.length < 8) return '密碼至少 8 碼';
  if (!/[A-Z]/.test(pw)) return '密碼需包含至少一個大寫字母';
  if (!/[a-z]/.test(pw)) return '密碼需包含至少一個小寫字母';
  if (!/\d/.test(pw)) return '密碼需包含至少一個數字';
  return null;
}
```
**Step 2: 驗證**
```bash
node --check static/js/utils.js
./scripts/run-tests.sh frontend
```
**Step 3: 防回歸斷言**（test_frontend_assets.py）：`assert "function pwPolicyMsg" in utils_js`（Phase 7.2 一併加）。
**Step 4: Commit**
```bash
git add static/js/utils.js
git commit -m "fix(auth): 補 pwPolicyMsg 定義（既有 bug：改密碼送出即 ReferenceError）"
```

### Task 0.1: docs/ 與結構盤點報告

**Objective:** 產出 docs/ 與資料夾結構盤點報告，決定「需更新/需新增」清單。

**Files:** 只讀：`docs/*.md`、`README.md`、`專案架構.md`、`app/`、`static/`

**Step 1:** 讀 docs/ 7 檔的目錄與段落（grep 標題），確認各自維護範圍。
**Step 2:** 盤點 app/routes/ 職責（已知：11 檔已模組化，無需大重構；本功能新增獨立檔 units.py）。
**Step 3:** 產出報告（放 plan 附錄，不 commit）：
- 需**新增**：`docs/單位與設定中心維護文件.md`
- 需**更新**：`docs/使用者與權限維護說明.md`（+unit-mgmt 權限行）、`docs/單元測試維護文件.md`（測試數）、`docs/庫存操作維護文件.md`（modal 單位欄行為變更）、`README.md`（功能總覽 + 專案結構）、`專案架構.md`（目錄/API/前端結構）
- **結構決策**：新功能一律獨立檔（`app/routes/units.py`、`static/js/units.js`、`static/settings.html`、`static/js/settings.js`、`tests/test_units.py`）——不併入既有檔，符合「不同內容不混同一檔」

**Step 4: Commit**
```bash
# 本 Task 純分析，無 code 變更——不 commit（報告內容併入 Phase 8 docs 更新）
```

---

## Phase 1：DB — units 表（1h）

### Task 1.1: database.py 新增 units 表 + 種子

**Objective:** 建立 units 字典表與種子資料（INSERT OR IGNORE，活庫不受影響）。

**Files:**
- Modify: `app/database.py`（CREATE TABLE 區 ~L125 附近 service_types 之後；種子區 ~L247 service_types 種子之後）

**Step 1: CREATE TABLE**（加在 service_types CREATE 之後）：
```python
CREATE TABLE IF NOT EXISTS units (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL UNIQUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active  INTEGER NOT NULL DEFAULT 1
);
```

**Step 2: 種子**（加在 service_types 種子 executescript 之後，同一個 init_db 流程）：
```python
conn.executescript("""
INSERT OR IGNORE INTO units (name, sort_order, is_active) VALUES
    ('個', 1, 1), ('罐', 2, 1), ('瓶', 3, 1), ('包', 4, 1),
    ('組', 5, 1), ('米', 6, 1), ('條', 7, 1), ('捲', 8, 1),
    ('盤', 9, 1), ('套', 10, 1),
    ('箱', 11, 1), ('台', 12, 1), ('支', 13, 1), ('顆', 14, 1), ('桶', 15, 1);
""")
```
（種子 = 既有 10 種 + 常見補 5 種；活庫已有資料不受影響；破碎值不種子——由收編功能處理）

**Step 3: 驗證**
```bash
./scripts/run-tests.sh all
# 預期：553 passed 全綠（新表不影響既有測試）
```

**Step 4: 活庫驗證（不 commit DB）**
```bash
python -c "import sqlite3; c=sqlite3.connect('inventory.db'); print(c.execute('SELECT COUNT(*) FROM units').fetchone())"
# 預期：15（重啟 server 後 init_db 執行種子）
```
⚠️ 正式 server 啟動時 init_db 才會建表種子；本地驗證用 TestClient 或重啟 server。

**Step 5: Commit**
```bash
git add app/database.py
git commit -m "feat(units): units 字典表 + 15 筆種子（既有 10 + 常見補 5）"
```

---

## Phase 2：後端 API — units CRUD + 收編（1.5h）

### Task 2.1: app/routes/units.py 新建（GET/POST/PUT/DELETE + consolidate + usage）

**Objective:** 單位字典 CRUD + 歷史收編 + 使用分佈端點；權限分層（POST=item-mgmt、PUT/DELETE/consolidate=unit-mgmt）。

**Files:**
- Create: `app/routes/units.py`
- Modify: `app/models.py`（+UnitIn/UnitUpdate/UnitConsolidate）
- Modify: `main.py`（router 迴圈加入 units.router）

**Step 1: models.py 追加：**
```python
class UnitIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=20)

class UnitUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=20)
    sort_order: int | None = Field(None, ge=0, le=9999)
    is_active: bool | None = None

class UnitConsolidate(BaseModel):
    from_unit: str = Field(..., min_length=1, max_length=20)
    to_unit: str = Field(..., min_length=1, max_length=20)
```

**Step 2: app/routes/units.py 完整內容（依 service_types 模式，注意寫入端點 try/finally 鐵則）：**
```python
"""單位字典 CRUD + 歷史收編（2026-08-16 單位動態清單）"""
import sqlite3
from fastapi import APIRouter, Depends, HTTPException
from app.database import get_db
from app.models import UnitIn, UnitUpdate, UnitConsolidate
from app.services.auth import require_perm

router = APIRouter()

def _row_to_dict(r):
    return {"id": r["id"], "name": r["name"], "sort_order": r["sort_order"], "is_active": bool(r["is_active"])}

@router.get("/api/units")
def list_units():
    """全角色（登入即可）：回傳全部（含停用），前端自行過濾 active。"""
    conn = get_db()
    try:
        rows = conn.execute("SELECT * FROM units ORDER BY sort_order, id").fetchall()
        return [_row_to_dict(r) for r in rows]
    finally:
        conn.close()

@router.post("/api/units", status_code=201, dependencies=[Depends(require_perm("item-mgmt"))])
def create_unit(u: UnitIn):
    """＋ 快速新增（item-mgmt：admin/user）。名稱重複（含停用）→ 400。"""
    name = u.name.strip()
    if not name:
        raise HTTPException(400, "單位名稱不可為空白")
    conn = get_db()
    try:
        if conn.execute("SELECT id FROM units WHERE name=?", (name,)).fetchone():
            raise HTTPException(400, f"單位「{name}」已存在")
        cur = conn.execute("INSERT INTO units (name, sort_order) VALUES (?, ?)",
                           (name, conn.execute("SELECT COALESCE(MAX(sort_order),0)+1 FROM units").fetchone()[0]))
        conn.commit()
        return _row_to_dict(conn.execute("SELECT * FROM units WHERE id=?", (cur.lastrowid,)).fetchone())
    finally:
        conn.close()

@router.put("/api/units/{unit_id}", dependencies=[Depends(require_perm("unit-mgmt"))])
def update_unit(unit_id: int, u: UnitUpdate):
    """改名/排序/啟停（unit-mgmt：admin）。改名重複 → 400。"""
    conn = get_db()
    try:
        row = conn.execute("SELECT * FROM units WHERE id=?", (unit_id,)).fetchone()
        if not row:
            raise HTTPException(404, "單位不存在")
        if u.name is not None:
            name = u.name.strip()
            if not name:
                raise HTTPException(400, "單位名稱不可為空白")
            dup = conn.execute("SELECT id FROM units WHERE name=? AND id!=?", (name, unit_id)).fetchone()
            if dup:
                raise HTTPException(400, f"單位「{name}」已存在")
            conn.execute("UPDATE units SET name=? WHERE id=?", (name, unit_id))
        if u.sort_order is not None:
            conn.execute("UPDATE units SET sort_order=? WHERE id=?", (u.sort_order, unit_id))
        if u.is_active is not None:
            conn.execute("UPDATE units SET is_active=? WHERE id=?", (1 if u.is_active else 0, unit_id))
        conn.commit()
        return _row_to_dict(conn.execute("SELECT * FROM units WHERE id=?", (unit_id,)).fetchone())
    finally:
        conn.close()

@router.delete("/api/units/{unit_id}", dependencies=[Depends(require_perm("unit-mgmt"))])
def deactivate_unit(unit_id: int):
    """停用（soft delete，歷史引用保留）→ is_active=0。"""
    conn = get_db()
    try:
        row = conn.execute("SELECT id FROM units WHERE id=?", (unit_id,)).fetchone()
        if not row:
            raise HTTPException(404, "單位不存在")
        conn.execute("UPDATE units SET is_active=0 WHERE id=?", (unit_id,))
        conn.commit()
        return {"ok": True}
    finally:
        conn.close()

@router.get("/api/units/usage")
def unit_usage():
    """items 實際使用分佈（全角色）：前端比對出「不在清單的歷史值」列收編建議。
    (B4 決策) 只統計 is_deleted=0（現行品項）；幽靈品項（is_deleted=1 非庫存）由 consolidate 收編時一併處理，不列建議——docs 註明此為刻意決策。"""
    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT unit, COUNT(*) AS cnt FROM items WHERE is_deleted=0 GROUP BY unit ORDER BY cnt DESC"
        ).fetchall()
        return [{"unit": r["unit"], "count": r["cnt"]} for r in rows]
    finally:
        conn.close()

@router.post("/api/units/consolidate", dependencies=[Depends(require_perm("unit-mgmt"))])
def consolidate_units(req: UnitConsolidate):
    """收編：items.unit from→to（含 is_deleted=1 幽靈品項，B4）；來源單位若在 units 表 → 停用。
    (A3) items 唯一鍵 (brand,code,name,unit,site) 含 unit——收編前先偵測衝突：同 (brand,code,name,site)
    已有 to_unit 活品項 → 409 列出，避免 IntegrityError 500。(B5) UPDATE bump updated_at（樂觀鎖）。"""
    frm, to = req.from_unit.strip(), req.to_unit.strip()
    if not frm or not to:
        raise HTTPException(400, "來源與目標單位不可為空白")
    if frm == to:
        raise HTTPException(400, "來源與目標單位相同")
    conn = get_db()
    try:
        # A3 衝突偵測：同 (brand,code,name,site) 已存在 to_unit 的「活」品項，且該鍵也有 from_unit 品項
        conflicts = conn.execute(
            """SELECT t.brand, t.code, t.name, t.site, COUNT(*) AS n
                FROM items t
                JOIN items f ON f.brand IS t.brand AND f.code IS t.code
                             AND f.name IS t.name AND f.site IS t.site
                WHERE t.unit=? AND t.is_deleted=0 AND f.unit=? AND f.is_deleted=0
                GROUP BY t.brand, t.code, t.name, t.site LIMIT 10""",
            (to, frm)).fetchall()
        if conflicts:
            detail = "；".join(
                f"{r['brand']} {r['name']}（{r['site']}）已存在「{to}」{r['n']} 筆" for r in conflicts[:3])
            raise HTTPException(409, f"收編會與既有品項重複：{detail}。請先編輯合併再收編")
        cur = conn.execute(
            "UPDATE items SET unit=?, updated_at=CURRENT_TIMESTAMP WHERE unit=?",
            (to, frm))  # B4：不排除 is_deleted（非庫存幽靈品項的單位也收編）
        affected = cur.rowcount
        conn.execute("UPDATE units SET is_active=0 WHERE name=? AND is_active=1", (frm,))
        conn.commit()
        return {"affected": affected, "from_unit": frm, "to_unit": to}
    except sqlite3.IntegrityError:
        conn.rollback()
        raise HTTPException(409, "收編造成品項重複（唯一鍵衝突），請先合併品項再收編")
    finally:
        conn.close()
```

**Step 3: main.py 掛載**（L117-119 迴圈 tuple 加入 `units.router`）：
```python
for _r in (items.router, stockout.router, kits.router, stocktake.router,
           stats.router, export.router, photos.router, lookup.router, users.router,
           appointments.router, units.router):
```

**Step 4: 驗證**（重啟 server 後，Python urllib + CookieJar 登入探測——勿用 curl cookie jar，MSYS 坑）：
- GET /api/units → 15 筆（未登入 401/302）
- POST /api/units（admin）{"name":"顆"} → 201；重複 → 400「已存在」
- POST /api/units（user 帳號 sarah）→ 201（item-mgmt 有）；POST（tech/viewer）→ 403
- PUT/DELETE/consolidate（sarah）→ 403（無 unit-mgmt）
- POST /api/units/consolidate {"from_unit":"/4罐","to_unit":"罐"} → affected≥1（is_deleted=1 幽靈品項也收編）
- 衝突情境：先建同 (brand,code,name,site) 的「罐」品項 + 另一筆「/4罐」→ consolidate → 409 + 衝突清單（非 500）
- ⚠️ 探針即建即清：consolidate 用真資料前先備份 DB（`cp inventory.db inventory.db.bak-<日期>-units`）；測試完把破碎值還原或確認收編符合預期再決定保留

**Step 5: Commit**
```bash
git add app/routes/units.py app/models.py main.py
git commit -m "feat(units): units CRUD + usage + consolidate API（POST=item-mgmt / 管理=unit-mgmt）"
```

---

## Phase 3：前端 modal 改造 — units.js + 4 個 modal（2h）

### Task 3.1: static/js/units.js 新建（全域清單 + select 填充 + ＋ 快速新增）

**Objective:** 單位清單全站共用元件：載入、填充 select（含歷史值相容）、＋ 快速新增。

**Files:**
- Create: `static/js/units.js`

**Step 1: 完整內容：**
```javascript
// units.js — 單位動態清單共用元件（2026-08-16）
// 依賴：api.js（fetchJSON）、utils.js（esc/toast/hasPerm——hasPerm 在 utils.js:4，非 auth.js）
var unitList = [];          // 全量（含停用）——var：跨檔慣例（globals.js:3-4）
var unitListActive = [];    // 啟用中（select 用）

async function loadUnits() {
  try {
    const res = await fetch('/api/units');
    if (!res.ok) return;
    unitList = await res.json();
    unitListActive = unitList.filter(u => u.is_active);
  } catch (e) { /* 登入頁/離線忽略 */ }
}

// 填充 select：active 單位 + 若 current 不在清單（歷史值）→ 補「（歷史）xxx」並選中
function fillUnitSelect(sel, current) {
  sel.innerHTML = '';
  unitListActive.forEach(u => {
    const o = document.createElement('option');
    o.value = u.name; o.textContent = u.name;
    sel.appendChild(o);
  });
  const cur = (current || '').trim();
  if (cur && !unitListActive.some(u => u.name === cur)) {
    const o = document.createElement('option');
    o.value = cur; o.textContent = `（歷史）${cur}`;
    sel.appendChild(o);
  }
  if (cur) sel.value = cur;
  return sel;
}

// ＋ 快速新增：select 換 inline input → POST → 本地更新 → 重填並選中
function openUnitQuickAdd(sel, addBtn, wrap) {
  const input = document.createElement('input');
  input.placeholder = '新單位，例如：顆';
  input.maxLength = 20;
  const ok = document.createElement('button');
  ok.textContent = '新增';
  ok.className = 'btn-save';
  const cancel = document.createElement('button');
  cancel.textContent = '取消';
  cancel.className = 'btn-ghost';
  sel.style.display = 'none'; addBtn.style.display = 'none';
  const box = document.createElement('div');
  box.className = 'unit-quick-add';
  box.append(input, ok, cancel);
  wrap.insertBefore(box, addBtn.nextSibling);
  input.focus();
  ok.onclick = async () => {
    const name = input.value.trim();
    if (!name) return;
    try {
      const res = await fetch('/api/units', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      const data = await res.json();
      if (!res.ok) { toast(data.detail || '新增失敗', 'error'); return; }
      unitList.push(data); unitListActive = unitList.filter(u => u.is_active);  // C2 var 可跨檔讀（settings.js）
      box.remove(); sel.style.display = ''; addBtn.style.display = '';
      fillUnitSelect(sel, name);
      toast(`✅ 單位「${name}」已新增`, 'success');
    } catch (e) { toast('新增失敗', 'error'); }
  };
  cancel.onclick = () => { box.remove(); sel.style.display = ''; addBtn.style.display = ''; };
}
```
⚠️ 「＋」按鈕顯示條件：`hasPerm('item-mgmt')`（utils.js 全域函式）——add.js/edit.js/stockout.js 各自判斷。

**Step 2: 語法驗證**
```bash
node --check static/js/units.js
```

**Step 3: Commit**
```bash
git add static/js/units.js
git commit -m "feat(units): units.js 共用元件（載入/填充 select/＋ 快速新增）"
```
（commit 前 node --check 全量由 test_js_syntax 自動覆蓋——units.js 會被 ALL_JS_FILES 自動納入）

### Task 3.2: 4 個 modal 改動態 select

**Objective:** f-unit / e-unit / ns-unit / nsp-unit 全部改動態 select；index.html 移除寫死 options、input 改 select；script 載入順序加 units.js。

**Files:**
- Modify: `static/index.html`（L135-139 f-unit、L185-189 e-unit、L271 ns-unit、L307 nsp-unit；script 區加 units.js）
- Modify: `static/js/app.js`（啟動 loadUnits()）
- Modify: `static/js/modals/add.js`、`static/js/modals/edit.js`、`static/js/modals/stockout.js`

**Step 1: index.html 四處改造：**
```html
<!-- f-unit：<select id="f-unit"><option>個</option>…</select> → -->
<select id="f-unit"></select>
<!-- 相同改法：e-unit（保留既有 value 設定邏輯）、ns-unit、nsp-unit -->
```
- ns-unit / nsp-unit：`<input type="text" id="ns-unit" value="個">` → `<select id="ns-unit"></select>`（移除 value="個"，改 JS 填充）

**Step 2: script 載入順序**（units.js 在 api.js/utils.js/auth.js 之後、modals 之前——add/edit/stockout 會呼叫 loadUnits/fillUnitSelect）：
```html
<script src="/static/js/utils.js"></script>
<script src="/static/js/api.js"></script>
<script src="/static/js/auth.js"></script>
<script src="/static/js/units.js"></script>   <!-- 新增 -->
<script src="/static/js/modals/add.js"></script>
...
```

**Step 3: app.js 啟動時 loadUnits()**（與 loadData 平行，catch 不阻擋主流程）：
```javascript
loadUnits();
```

**Step 4: add.js**（C4：在 openAddModal 重置欄位後**立即**呼叫——add.js:49-50 原本 `f-unit.value='個'` 在空 select 是 no-op）：
```javascript
fillUnitSelect(document.getElementById('f-unit'), '個');   // openAddModal 重置後立即填充（替代原 f-unit.value='個'）
```
（submit 邏輯不變——`document.getElementById('f-unit').value` 照舊讀 select value）

**Step 5: edit.js**（L12 `document.getElementById('e-unit').value = item.unit || '個'` →）：
```javascript
fillUnitSelect(document.getElementById('e-unit'), item.unit || '個');
```

**Step 6: stockout.js**（openNonStockOutModal L58 `ns-unit` value='個'、openNonStockPrepareModal L99 `nsp-unit`）：
```javascript
fillUnitSelect(document.getElementById('ns-unit'), '個');
fillUnitSelect(document.getElementById('nsp-unit'), '個');
```
（submit L68/L108 讀 value 邏輯不變）

**Step 7: 驗證**
```bash
node --check static/js/units.js static/js/app.js static/js/modals/add.js static/js/modals/edit.js static/js/modals/stockout.js
./scripts/run-tests.sh frontend   # 既有斷言若斷「<option>個」需同步更新（見 Phase 7）
```
⚠️ 既有 test_frontend_assets.py 若斷言 index.html 含 `<option>個</option>` 會紅——Phase 7 統一更新斷言，本 Task 若跑 frontend 紅屬預期（下 Task 先過 core）。

**Step 8: Commit**
```bash
git add static/index.html static/js/app.js static/js/modals/add.js static/js/modals/edit.js static/js/modals/stockout.js static/js/units.js
git commit -m "feat(units): 4 個 modal 單位欄改動態 select（含非庫存輸入框→select）"
```

---

## Phase 4：設定中心 — settings.html + settings.js（2.5h）

### Task 4.1: static/settings.html 新建（麵包屑 topbar + 左右清單）

**Objective:** 設定中心全頁：麵包屑式 topbar（複製 permissions.html 變體 B 樣式值）+ 左側清單（單位管理/修改密碼）+ 右側內容；手機版 chip-bar + 內容。

**Files:**
- Create: `static/settings.html`

**Step 1: 頁面骨架**（樣式值對齊 permissions.html 2026-08-15 變體 B）：
- (B2) 底部補 `<div class="toast" id="toast"></div>`（toast() 依賴此元素，缺了單位新增/密碼變更失敗時直接 throw）
- topbar：`<div class="vb-crumb">← <a href="/">庫存</a><span class="sep">›</span><span class="vb-crumb-current">⚙️ 設定</span></div>`（左）+ 🚪 登出（右）
- `.vb-crumb` 樣式：font-size 13px、color rgba(255,255,255,.85)；手機版隱藏 a/.sep、內容大標題隱藏
- 左右清單：`.side-list`（220-250px，複製 permissions.html `.user-list` 樣式：白底、圓角 12px、item hover #f7fbff、active #e6f4ff + border-left 3px #1890ff）
- 手機版：`.side-list { display:none }` + `.chip-bar`（overflow-x:auto + 隱藏 scrollbar，chip active #1890ff 白字）
- 右側內容容器：`.side-main`（白底圓角 12px）

**Step 2: 左側清單兩項**（YAGNI：不做「行事曆設定」預留項目）：
```html
<div class="side-list" id="settingsSideList">
  <div class="side-item active" data-panel="units" onclick="settingsSwitch('units')">📦 單位管理</div>
  <div class="side-item" data-panel="pw" onclick="settingsSwitch('pw')">🔑 修改密碼</div>
</div>
```

**Step 3: 右側兩面板：**
- `#panel-units`：單位管理內容（列表表格 + 新增輸入 + 歷史收編區，骨架由 settings.js 渲染）
- `#panel-pw`：**修改密碼——內嵌 changepw-modal 的完整 DOM（id 不變），並載入 modals/changepw.js** → 零重寫、邏輯單一來源

```html
<div id="panel-pw" style="display:none">
  <!-- 複製 index.html changepw-modal 內部結構（form：old/new/confirm + 強度打勾 + 錯誤提示）-->
  <div class="changepw-box" id="changepw-modal" style="position:static;max-width:480px;margin:0 auto;box-shadow:none">
    ...（changepw-modal 原內容，style 覆寫成內嵌顯示）...
  </div>
</div>
```
⚠️ 檢查 changepw.js 依賴的 DOM id 與 index.html 完全一致——**強度容器是 `cpw-checks`（index.html:440）+ `cpw-len`/`cpw-up`/`cpw-low`/`cpw-digit`（441-444），不是 pw-strength**（C3）；欄位 id：`cpw-old`/`cpw-new`/`cpw-confirm`。changepw.js 的 openChangePwModal 在 settings 頁不需要（不呼叫），submitChangePw/cpwCheckStrength/cpwCheckMatch 直接可用（A2 修正後不再 ReferenceError）。

**Step 4: script 載入**：`utils.js → api.js → auth.js → units.js → changepw.js → settings.js`（settings.js 最後，因依賴前者）

**Step 5: main.py 新增路由（A1——static mount 是 /static 前綴，直連 /settings.html 會 404）**：
比照 permissions_page（main.py:167-173）：
```python
@app.get("/settings.html")
def settings_page():
    """設定中心頁（2026-08-16；static 資源版本號自動化）"""
    idx = os.path.join(STATIC_DIR, "settings.html")
    if os.path.exists(idx):
        return _versioned_html(idx)
    return Response("<h1>設定頁不存在</h1>", media_type="text/html")
```
同時把 `"/settings.html"` 加入 no-cache 白名單（main.py:57 tuple `("/", "/login.html")` → `("/", "/login.html", "/permissions.html", "/settings.html")`——permissions.html 順手補上，修 2026-08-14 實戰踩過的內嵌 CSS 快取坑；這是同 tuple 一行修改，不另開 commit）

**Step 5: Commit**
```bash
git add static/settings.html
git commit -m "feat(settings): 設定中心頁骨架（麵包屑 topbar + 左右清單 + 修改密碼嵌入 changepw.js）"
```

### Task 4.2: static/js/settings.js 新建（左右清單切換 + 單位管理渲染 + 收編）

**Objective:** settings 頁邏輯：清單切換、單位管理（列表/新增/開關/排序）、歷史收編（usage 比對 + consolidate）。

**Files:**
- Create: `static/js/settings.js`

**Step 1: 完整內容（結構如下）：**
```javascript
// settings.js — 設定中心（2026-08-16）
let unitUsage = [];

function settingsSwitch(panel) {
  document.querySelectorAll('#settingsSideList .side-item').forEach(el =>
    el.classList.toggle('active', el.dataset.panel === panel));
  document.getElementById('panel-units').style.display = panel === 'units' ? '' : 'none';
  document.getElementById('panel-pw').style.display = panel === 'pw' ? '' : 'none';
  if (panel === 'units') renderUnitsPanel();
}

async function loadUnitUsage() {
  try {
    const res = await fetch('/api/units/usage');
    if (res.ok) unitUsage = await res.json();
  } catch (e) {}
}

function renderUnitsPanel() {
  // 1. 列表：unitList 全量，每列 = name + sort_order（↑↓ 按鈕）+ is_active switch
  //    ↑↓ 點擊 → PUT /api/units/{id} {sort_order: n±1} → 重渲染
  //    switch 切換 → PUT /api/units/{id} {is_active: !v} → 重渲染
  // 2. 新增輸入（頂部）→ POST /api/units → unitList.push → 重渲染
  // 3. 歷史收編區：unitUsage 比對 unitListActive——
  //    不在 active 清單且 count>0 的 unit（含空字串顯示「（空白）」）→ 每筆一行：
  //    「『/4罐』× 2 筆」+ [收編為 select: active 單位] + [收編] 按鈕
  //    點收編 → POST /api/units/consolidate {from_unit, to_unit} → 重載 usage + toast
}

// 初始化（loadUnits 來自 units.js）
(async function initSettings() {
  await Promise.all([loadUnits(), loadUnitUsage()]);
  settingsSwitch('units');
})();
```
**Step 2: 安全要求**：所有 name/count/unit 內插一律 `esc()`（utils.js）——security 掃描器會檢查。
**Step 3: 手機 chip-bar 對應**：手機版切換元件（chip active class 同步）。

**Step 4: 權限 gating（B3——前端隱藏=UX 防呆，後端仍會 403）**：
- 左清單「📦 單位管理」項：僅 `hasPerm('unit-mgmt')` 顯示（settings 入口條件是 unit-mgmt || change-own-password，非 admin 若被開 change-own-password 進得來，看不到單位管理項）
- 單位管理面板內：停用 switch / 排序 ↑↓ / 收編按鈕 → `hasPerm('unit-mgmt')`；「＋ 新增單位」→ `hasPerm('item-mgmt')`
- `settingsSwitch('units')` 預設只開 panel 給有權限者；無權限直接切 'pw'
**Step 5: 內嵌改密碼送出成功後清空欄位（C6）**：settings.js 內 submit 成功後清 `cpw-old/cpw-new/cpw-confirm` 三欄（openChangePwModal 的清空只在 index.html 流程會跑，settings 頁不經它）。

**Step 4: 驗證**
```bash
node --check static/js/settings.js
# browser 實測：登入 admin → /settings.html → 左清單切換 → 單位管理操作 → 修改密碼嵌入可用
```

**Step 5: Commit**
```bash
git add static/js/settings.js
git commit -m "feat(settings): 設定中心邏輯（單位管理渲染 + 歷史收編 + 修改密碼嵌入）"
```

---

## Phase 5：topbar 改造（0.5h）

### Task 5.1: auth.js renderUserMenu — ⚙️ 設定按鈕、移除改密碼

**Objective:** admin topbar = chip + 👥 帳號與權限 + ⚙️ 設定 + 🚪 登出（4 元件）；改密碼按鈕移除。

**Files:**
- Modify: `static/js/auth.js`（renderUserMenu L54-80）

**Step 1: 改 renderUserMenu：**
```javascript
const perms = user.permissions || {};
const canManageUsers = !!perms['user-mgmt'];
const canManageUnits = !!perms['unit-mgmt'];        // 新增
const canChangePw = !!perms['change-own-password']; // 保留判斷（settings 入口條件用）
// 移除：canChangePw 的「🔑 改密碼」按鈕（改密碼收進設定中心）
menu.innerHTML =
  `<span class="user-chip" title="${esc(user.username)}">👤 ${esc(user.display_name || user.username)}` +
  roleChip + `</span>` +
  (canManageUsers ? `<button class="btn-ghost" onclick="location.href='/permissions.html'">👥<span class="users-text"> 帳號與權限</span></button>` : '') +
  (canManageUnits || canChangePw ? `<button class="btn-ghost" onclick="location.href='/settings.html'">⚙️<span class="users-text"> 設定</span></button>` : '') +
  `<button class="btn-ghost btn-logout-direct" onclick="logout()">🚪<span class="logout-direct-text"> 登出</span></button>`;
```
- user 角色分支（L61-64）不動（chip + 登出）
- ⚠️ settings.html 需 main.py 路由（A1：Task 4.1 Step 5 已補 @app.get("/settings.html")；此按鈕才不會 404）

**Step 2: 驗證**
```bash
node --check static/js/auth.js
./scripts/run-tests.sh frontend   # 既有「🔑 改密碼」斷言會紅 → Phase 7 更新
```

**Step 3: Commit**
```bash
git add static/js/auth.js
git commit -m "feat(settings): topbar 改 ⚙️ 設定按鈕（改密碼收進設定中心），admin 維持 4 元件"
```

---

## Phase 6：權限 — unit-mgmt（0.5h）

### Task 6.1: RBAC 新增 unit-mgmt 權限

**Objective:** permissions 種子 + _RBAC_DEFAULT + auth.py（若需硬規則）；權限頁自動出現新列（perms.js 依 module 分組渲染，無需改）。

**Files:**
- Modify: `app/database.py`（permissions 種子 L265-283、_RBAC_DEFAULT L285-308）
- Modify: `app/services/auth.py`（檢查是否需要「非 admin 不可開」規則——C-3 定案：**開放可開**，比照 item-mgmt 一般權限，auth.py 零改動）

**Step 1: permissions 種子加一行：**
```python
('unit-mgmt',            '單位整理（停用/排序/收編）', 'stock'),
```

**Step 2: _RBAC_DEFAULT 加一項：**
```python
'unit-mgmt':          {'admin': 1, 'user': 0, 'tech': 0, 'viewer': 0},
```

**Step 3: 驗證**
```bash
./scripts/run-tests.sh rbac   # test_rbac_perms 矩陣測試；若測試有完整權限清單斷言需同步（Phase 7）
```
⚠️ 權限頁自動渲染：perms.js 從 /api/permissions 拉權限清單分組 → unit-mgmt 自動出現在「📦 庫存管理」群組，零前端改動。

**Step 4: Commit**
```bash
git add app/database.py
git commit -m "feat(rbac): 新增 unit-mgmt 權限（admin 預設 1，權限頁自動出現）"
```

---

## Phase 7：測試補齊（1.5h）

### Task 7.1: tests/test_units.py 新建（CRUD/權限/收編/種子）

**Objective:** units 功能單元測試（fixture 比照 test_main.py：tmp DB + 自動登入）。

**Files:**
- Create: `tests/test_units.py`

**Step 1: 測試清單（約 14 條）：**
1. `test_units_seeded` — GET /api/units 含「個」「罐」「箱」，15 筆以上
2. `test_units_create` — admin POST {"name":"顆"} → 201
3. `test_units_create_duplicate` — 重複名稱 → 400
4. `test_units_create_blank` — 空白名稱 → 400
5. `test_units_create_user_ok` — sarah（user）POST → 201（item-mgmt）
6. `test_units_create_tech_forbidden` — tech → 403
7. `test_units_update_name` — admin PUT 改名 → 200；重複 → 400
8. `test_units_update_sort` — PUT sort_order → 200 排序變更
9. `test_units_toggle_active` — PUT is_active=false → GET 仍回傳但 is_active=false
10. `test_units_delete_deactivates` — DELETE → is_active=0（soft）
11. `test_units_update_requires_unit_mgmt` — user PUT/DELETE/consolidate → 403
12. `test_units_consolidate` — 建兩品項 unit 分別「/4罐」「罐」→ consolidate → items.unit 更新 + affected=1 + 來源停用
13. `test_units_usage` — GET /api/units/usage 回傳分佈
14. `test_units_consolidate_same` — from==to → 400

**Step 2: 跑測試**
```bash
./scripts/run-tests.sh core   # core=test_main——test_units 是獨立檔，改跑 pytest tests/test_units.py 或併入 all
pytest tests/test_units.py -v   # 預期 14 passed
```

**Step 3: Commit**
```bash
git add tests/test_units.py
git commit -m "test(units): units CRUD/權限/收編/種子 14 條"
```

### Task 7.2: test_frontend_assets.py 斷言更新 + 新增

**Objective:** 前端防回歸斷言：寫死 option 移除、動態 select、settings 頁、topbar ⚙️、units.js。

**Files:**
- Modify: `tests/test_frontend_assets.py`

**Step 1: 更新既有（若有）斷「<option>個</option>」的測試 → 改斷 `id="f-unit"` select 存在。
**Step 2: 新增防回歸斷言（精準 pattern，勿裸字串——skill 教訓）：**
```python
# units.js 元件存在 + select 填充
assert "fillUnitSelect" in units_js
assert "loadUnits" in units_js
# index.html 4 個單位欄皆為 select（無 input id=ns-unit）
assert 'id="f-unit"' in idx and 'id="e-unit"' in idx
assert 'id="ns-unit"' in idx and 'id="nsp-unit"' in idx
assert '<input type="text" id="ns-unit"' not in idx
# settings 頁存在 + 左右清單
assert 'data-panel="units"' in settings_html
assert 'changepw-modal' in settings_html   # 修改密碼嵌入
# auth.js：⚙️ 設定按鈕 + 改密碼按鈕移除
assert "location.href='/settings.html'" in auth_js
assert "openChangePwModal()" not in auth_js   # ⚠️ 精準 pattern 確認 modal 標題不含此字串
# (B1) 既有 L691 `assert "openChangePwModal()" in au` 必須「翻轉」為 not in（不能兩條並存矛盾）；
#      openChangePwModal 仍在 changepw.js/expiry.js/index.html onclick 出現——斷言對象是 auth_js（topbar 按鈕）
# index.html 仍保留 changepw-modal（expiry 流程用）
assert 'id="changepw-modal"' in idx
```
**Step 3: 全量測試**
```bash
./scripts/run-tests.sh all   # 預期全綠（基準 553 + 新增）
```

**Step 4: Commit**
```bash
git add tests/test_frontend_assets.py
git commit -m "test(frontend): 單位動態 select + 設定中心 + topbar ⚙️ 防回歸斷言"
```

### Task 7.3: test_rbac.py + test_rbac_perms.py 同步 unit-mgmt（A4——兩檔手抄 16 項權限清單，新增後必紅）

**Objective:** 兩檔 EXPECTED 清單 16→17 項，`./scripts/run-tests.sh rbac` 全綠。

**Files:**
- Modify: `tests/test_rbac.py`、`tests/test_rbac_perms.py`

**Step 1: test_rbac.py 同步：**
- `EXPECTED_MATRIX`（L21）加 `'unit-mgmt': {'admin': 1, 'user': 0, 'tech': 0, 'viewer': 0}`
- `len(perms) == 16`（L51）→ `17`
- `EXPECTED_LABELS_MODULES` 相關斷言（L98）加 `('unit-mgmt', '單位整理（停用/排序/收編）', 'stock')`
- 計數斷言（L142-144）→ 17 對應總和

**Step 2: test_rbac_perms.py 同步：**
- `EXPECTED_KEYS`（L18-20）加 `'unit-mgmt'`
- `len(data["permissions"]) == 16`（L208）→ `17`

**Step 3: 驗證**
```bash
./scripts/run-tests.sh rbac   # 預期全綠
```

**Step 4: Commit**
```bash
git add tests/test_rbac.py tests/test_rbac_perms.py
git commit -m "test(rbac): 權限清單 16→17 同步 unit-mgmt"
```

---

## Phase 8：docs 更新 + 結構確認（1h）

### Task 8.1: docs/ 新增與更新

**Objective:** 依 Phase 0 盤點清單更新全部 docs。

**Files:**
- Create: `docs/單位與設定中心維護文件.md`
- Modify: `docs/使用者與權限維護說明.md`（+unit-mgmt 行、改密碼入口移至設定中心）
- Modify: `docs/單元測試維護文件.md`（測試總覽：+test_units.py 14 條、test_frontend_assets 新增斷言；數字實測後填）
- Modify: `docs/庫存操作維護文件.md`（4 個 modal 單位欄行為：動態 select + ＋ 快速新增 + 歷史值「（歷史）」）
- Modify: `README.md`（功能總覽 + 專案結構 + API 一覽 +units）
- Modify: `專案架構.md`（目錄結構、API 一覽 units.py、前端結構 settings.html/settings.js/units.js、資料庫結構 units 表）

**Step 1:** 依 Phase 0 盤點逐檔更新；docs/ 內不用絕對路徑（相對）；測試數字 pytest --collect-only 實測後填。
**Step 2: Commit**
```bash
git add docs/ README.md 專案架構.md
git commit -m "docs: 單位與設定中心維護文件 + 既有 6 檔同步"
```

### Task 8.2: 結構最終確認（收尾檢查）

**Objective:** 確認「不同內容不混同一檔」原則落實。

**Step 1:** 檢查本功能所有新增檔是否獨立：units.py / units.js / settings.html / settings.js / test_units.py ✓（Phase 內已各自獨立）。
**Step 2:** dead code 4 步自查（家豪規則）：新定義零引用檢查、取代即刪（renderUserMenu 改密碼按鈕已刪）、搬移清理、算好顯示。
**Step 3:** gitnexus detect_changes 驗證（若 MCP 掛 → pytest 全綠 + 人工 blast radius 代替）。
**Step 4: Commit（若有收尾改動）**
```bash
git commit -m "chore: 收尾 dead code 清理（若有）"
```

---

## 驗證總表（全部 phase 完成後）

| 驗證 | 指令 | 預期 |
|---|---|---|
| 全量測試 | `./scripts/run-tests.sh all` | 全綠（553 + 新增） |
| JS 語法 | test_js_syntax 自動 | 全過 |
| API 探測 | urllib 登入 GET /api/units | 15+ 筆 |
| 手機實測 | browser 375px：4 modal select＋＋、設定頁 chip-bar | 不破版 |
| 收編實測 | consolidate 破碎值 → affected 正確 | 符合預期 |
| git 狀態 | `git log --oneline` | 每 phase 一 commit |

## 風險與決策紀錄

| 風險/決策 | 處置 |
|---|---|
| 既有 test_frontend_assets.py 斷「寫死 option」 | Phase 7.2 統一更新（phase 內先紅屬預期） |
| changepw.js 兩處使用（index.html modal + settings 內嵌） | DOM id 一致 → 邏輯單一來源零重寫；expiry 流程保留 index.html modal 不動 |
| 活庫破碎值 8 筆 + 空字串 11 筆 | 收編功能處理（admin 操作）；收編前備份 DB |
| settings 頁權限 | 入口 = unit-mgmt \|\| change-own-password（皆 admin）；viewer/tech/user 看不到 ⚙️ |
| 手機 topbar 元件數 | admin 維持 4（2×2 grid 不破）；user 維持 2 |
| 「行事曆設定（預留）」左清單項目 | **不做**（YAGNI + dead code 規則），plan 與 demo 標註差異 |
| (A1) /settings.html 404 | Task 4.1 Step 5 已補 main.py 路由 + no-cache 白名單（順手補 permissions.html） |
| (A2) pwPolicyMsg 未定義 | Task 0.2 補 utils.js 定義（對齊後端 _check_pw）——既有 bug 修正 |
| (A3) 收編撞 unique index | Task 2.1 衝突偵測 409 + IntegrityError 捕獲——不會 500 |
| (A4) rbac 測試紅 | Task 7.3 兩檔 EXPECTED 16→17 |
| (B1) frontend L691 矛盾 | Task 7.2 翻轉 in → not in |
| (B2) settings 缺 toast/登入守衛 | Task 4.1 補 #toast + settings.js init checkAuth |
| (B3) 面板未 gating | Task 4.2 Step 4 依 unit-mgmt/item-mgmt 分層顯示 |
| (B4) 幽靈品項收編漏網 | consolidate 全 items；usage 維持 is_deleted=0（docs 註明） |
| (B5) 收編不 bump updated_at | Task 2.1 UPDATE 加 updated_at=CURRENT_TIMESTAMP |
| (C1-C7) 筆誤/細節 | 已併入對應 Task（hasPerm 位置/var/cpw-checks id/add.js 時機/清空欄位） |

## 附錄：Phase 0 docs 盤點摘要

- docs/ 現有 7 檔（外網/安全性/行事曆/使用者與權限/前端資料更新/庫存操作/單元測試）
- 本次變動面：單位字典（新增）、設定中心頁（新增）、RBAC +1 權限、topbar 改版 → 對應 docs：新增 1 檔、更新 6 檔（7 檔中的 6 檔，外網維護文件不受影響）
- 結構：無需大重構；新功能獨立檔符合既有 routes/ 拆分慣例
