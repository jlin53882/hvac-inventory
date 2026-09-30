# -*- coding: utf-8 -*-
"""前端 shared state 的所有權守衛。

共用狀態分三處，各有 owner：

1. `core/state.js` 的 `appState`：只剩導覽層的全域狀態 `currentTab` / `currentSite`（多數 feature 讀取、只有 `features/shell` 寫入）。
   - 欄位清單只准縮小；新增欄位會紅燈（單一 feature 才用的狀態放該 feature 的 `state.js` 或模組私有變數）。
   - 只有 `ALLOWED_WRITERS` 列出的目錄可以直接指派；不得原地修改。
2. `core/inventory-read-model.js`：庫存清單 / meta / facets 的資料與 setter。
3. `core/shared-read-model.js`：其他跨 feature 共用資料（待領出清單、整組清單、櫃子、去向、單位、篩選、各 loaded-site）與 setter。

兩個 read-model 的規則（本檔的測試）：
- **讀取只能走 getter**：資料已不在 appState，consumer 沒有別的路；`getXxx()` 回傳 live reference，
  不得 `getAllItems().push(…)` / `getInventoryMeta().page = …` 這類繞過 owner 的原地修改。
- **誰能寫誰**：每個 setter 允許被哪些目錄呼叫是明確的名單（`ALLOWED_SETTERS`）；有新的呼叫者（尤其是其他 feature 改別人的資料）
  會紅燈，名單裡的呼叫者已不存在時要求同步縮小，避免名單腐爛。
- `currentTab` / `currentSite` 的直接讀取（`appState.currentTab`）是刻意保留的導覽層 shared state，只鎖「讀取的模組數只准減少」。

另外 `shellState`（`features/shell/state.js`）是 shell 內部狀態，只有 `features/shell/*` 可以使用。
"""
import glob
import os
import re
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JS_ROOT = os.path.join(ROOT, "static", "js")
STATE_JS = os.path.join(JS_ROOT, "core", "state.js")
INVENTORY_MODEL_JS = os.path.join(JS_ROOT, "core", "inventory-read-model.js")
SHARED_MODEL_JS = os.path.join(JS_ROOT, "core", "shared-read-model.js")
READ_MODEL_FILES = (INVENTORY_MODEL_JS, SHARED_MODEL_JS)

# appState 目前的欄位（只准縮小）
APP_STATE_FIELDS = frozenset({"currentTab", "currentSite"})

# 欄位 → 允許直接指派它的目錄（static/js 下的第一或前兩層：core / components / pages / features/<name>）
ALLOWED_WRITERS = {
    "currentTab": {"features/shell"},
    "currentSite": {"features/shell"},
}

# 導覽層欄位目前仍直接讀 appState.X 的模組數（只准減少；2026-09-30 量測）
NAVIGATION_READER_BASELINE = {"currentTab": 15, "currentSite": 16}

_WRITE_RE = re.compile(r"\bappState\.(\w+)\s*(?:[+\-*/]?=(?!=)|\+\+|--)")
_MUTATE_RE = re.compile(
    r"\bappState\.(\w+)\s*(?:"
    r"\.(?:push|pop|shift|unshift|splice|sort|reverse|fill|copyWithin)\s*\("
    r"|\.length\s*=(?!=)"
    r"|\[[^\]\n]+\]\s*[+\-*/]?=(?!=)"
    r"|\.\w+\s*[+\-*/]?=(?!=)"
    r")"
    r"|\bObject\.assign\(\s*appState\.(\w+)"
    r"|\bdelete\s+appState\.(\w+)"
)
_READ_RE = re.compile(r"\bappState\.(currentTab|currentSite)\b(?!\s*[+\-*/]?=(?!=))")

# ---- read model：getter / setter ----
GETTERS = {
    "getAllItems", "getInventoryMeta", "getInventoryFacets",
    "getPreparedItems", "getCurrentKitItems", "getGlobalCabinetList", "getDestinations", "getActiveUnitList",
    "getInventoryLoadedSite", "getFullItemsLoadedSite", "getDestinationsLoadedSite",
    "getCurrentBrands", "getCurrentCategories",
}

# setter → 允許呼叫它的目錄
ALLOWED_SETTERS = {
    "setAllItems": {"features/shell"},
    "setInventoryMeta": {"features/shell"},
    "setInventoryFacets": {"features/shell"},
    "setInventoryPage": {"features/shell"},               # 切換分片時回到第 1 頁
    "setInventoryStats": {"features/inventory", "features/shell"},   # inventory：待存調整後重算 KPI；shell：切換分片清空
    "setInventoryLoadedSite": {"features/shell"},
    "setFullItemsLoadedSite": {"features/shell"},
    "setPreparedItems": {"features/prepared"},
    "setCurrentKitItems": {"features/kits"},
    "setGlobalCabinetList": {"features/inventory", "features/kits"},   # inventory 與 kits 都會重新載入櫃子清單
    "setDestinations": {"core"},
    "setDestinationsLoadedSite": {"core"},
    "setActiveUnitList": {"core", "features/settings"},
    "setCurrentBrands": {"features/inventory", "features/shell"},      # shell：facets 更新後移除失效的篩選
    "setCurrentCategories": {"features/inventory", "features/shell"},
}

_SETTER_CALL_RE = re.compile(r"\b(" + "|".join(ALLOWED_SETTERS) + r")\(")
# 透過 getter 拿到 reference 後原地修改（繞過 owner）
_GETTER_MUTATE_RE = re.compile(
    r"\b(?:" + "|".join(sorted(GETTERS)) + r")\(\)\s*(?:"
    r"\.(?:push|pop|shift|unshift|splice|sort|reverse|fill|copyWithin)\s*\("
    r"|\.length\s*=(?!=)"
    r"|\[[^\]\n]+\]\s*[+\-*/]?=(?!=)"
    r"|\.\w+\s*[+\-*/]?=(?!=)"
    r")"
    r"|\bObject\.assign\(\s*(?:" + "|".join(sorted(GETTERS)) + r")\(\)"
)
# 已搬出 appState 的欄位不得再出現在 appState 上
_MOVED_FIELDS = (
    "ALL_ITEMS", "INVENTORY_META", "INVENTORY_FACETS", "inventoryLoadedSite", "fullItemsLoadedSite", "preparedItems",
    "currentBrands", "currentCategories", "currentKitItems", "DESTINATIONS", "destinationsLoadedSite",
    "unitListActive", "globalCabinetList",
)


def _declared_fields():
    source = open(STATE_JS, encoding="utf-8").read().split("export const appState", 1)[1]
    body = source.split("\n};", 1)[0]
    return set(re.findall(r"^  (\w+):", body, re.M))


def _owner_dir(path):
    rel = os.path.relpath(path, JS_ROOT).replace(os.sep, "/")
    parts = rel.split("/")
    return "/".join(parts[:2]) if parts[0] == "features" else parts[0]


def _js_sources(skip_models=False):
    for path in glob.glob(os.path.join(JS_ROOT, "**", "*.js"), recursive=True):
        if path == STATE_JS or os.sep + "dist" + os.sep in path:
            continue
        if skip_models and path in READ_MODEL_FILES:
            continue
        yield path, open(path, encoding="utf-8").read()


def _scan(regex):
    found = {}
    for path, source in _js_sources():
        for match in regex.finditer(source):
            field = next(group for group in match.groups() if group)
            found.setdefault(field, set()).add(_owner_dir(path))
    return found


def test_app_state_fields_only_shrink():
    declared = _declared_fields()
    added = declared - APP_STATE_FIELDS
    removed = APP_STATE_FIELDS - declared
    assert not added, (
        f"core/state.js 的 appState 新增了欄位 {sorted(added)}：單一 feature 才用的狀態請放該 feature 的 state.js "
        "或模組私有變數；跨 feature 共用的資料請放 core/shared-read-model.js 並提供 getter / setter。"
    )
    assert not removed, f"appState 欄位已移除，請從 APP_STATE_FIELDS / ALLOWED_WRITERS 同步移除：{sorted(removed)}"
    assert set(ALLOWED_WRITERS) == set(APP_STATE_FIELDS), "ALLOWED_WRITERS 與 APP_STATE_FIELDS 必須是同一組欄位"


def test_app_state_direct_writes_stay_with_their_owners():
    actual = _scan(_WRITE_RE)
    unknown = set(actual) - set(APP_STATE_FIELDS)
    assert not unknown, f"寫入了 appState 上不存在的欄位（拼字錯誤，或資料已搬到 read-model 要改用 setter）：{sorted(unknown)}"
    violations = {
        field: sorted(dirs - ALLOWED_WRITERS[field])
        for field, dirs in actual.items()
        if dirs - ALLOWED_WRITERS[field]
    }
    assert not violations, (
        f"有模組直接改了不屬於它的 appState 欄位：{violations}。請改由 owner 提供函式，"
        "或（確有必要時）在 ALLOWED_WRITERS 註明原因後加入。"
    )
    stale = {
        field: sorted(ALLOWED_WRITERS[field] - actual.get(field, set()))
        for field in ALLOWED_WRITERS
        if ALLOWED_WRITERS[field] - actual.get(field, set())
    }
    assert not stale, f"這些寫入者已不存在，請從 ALLOWED_WRITERS 移除：{stale}"


def test_app_state_is_never_mutated_in_place():
    """appState 的值都是字串：不得有 push / splice / obj[k] = … / obj.prop = … / Object.assign / delete。"""
    actual = _scan(_MUTATE_RE)
    assert not actual, f"新增了對 appState 欄位的原地修改（請改由 owner 提供 setter）：{actual}"


def test_feature_specific_state_lives_with_its_feature():
    """已搬出 appState 的單一 feature 狀態不得再回到 core/state.js。"""
    core = open(STATE_JS, encoding="utf-8").read()
    for moved in ("calMonth", "CAL_PALETTE", "CAL_WEEK", "parseCalendarMonth", "wprHistoryPageSize",
                  "batchMode", "toastTimer", "STATUS_LIST_CONTEXT", "editItemId",
                  "inventoryAbortController", "dataAbortController", "statsAbortController",
                  "ALERTS_BY_SITE", "inventoryFacetsLoadedSite", *_MOVED_FIELDS):
        assert moved not in core.split("export const appState", 1)[1], f"{moved} 不應回到 core/state.js 的 appState"


def test_shell_state_is_private_to_shell():
    """shellState 只給 features/shell/* 使用；其他 feature 要讀 shell 的資料請走 read-model 的 getter。"""
    offenders = []
    for path, source in _js_sources():
        if _owner_dir(path) == "features/shell":
            continue
        if re.search(r"\bshellState\b", source):
            offenders.append(os.path.relpath(path, JS_ROOT).replace(os.sep, "/"))
    assert not offenders, f"shellState 是 shell 內部狀態，這些模組不該使用：{offenders}"


def test_navigation_state_readers_only_shrink():
    """currentTab / currentSite 刻意保留 shared：不 accessor 化，但直接讀取的模組數只准減少。"""
    readers = {}
    for path, source in _js_sources():
        for match in _READ_RE.finditer(source):
            readers.setdefault(match.group(1), set()).add(os.path.relpath(path, JS_ROOT).replace(os.sep, "/"))
    grew = {f: sorted(readers.get(f, ())) for f in NAVIGATION_READER_BASELINE if len(readers.get(f, ())) > NAVIGATION_READER_BASELINE[f]}
    assert not grew, f"這些模組新增了對導覽欄位的直接讀取：{grew}"
    stale = {f: len(readers.get(f, ())) for f in NAVIGATION_READER_BASELINE if len(readers.get(f, ())) < NAVIGATION_READER_BASELINE[f]}
    assert not stale, f"導覽欄位的 direct reader 已減少，請調降 NAVIGATION_READER_BASELINE：{stale}"


def test_read_model_getters_are_not_mutated_by_consumers():
    """getter 回傳的是 live reference：不得 getAllItems().push(...) / getInventoryMeta().x = … 這類繞過 owner 的修改。"""
    offenders = {}
    for path, source in _js_sources():
        hits = [m.group(0) for m in _GETTER_MUTATE_RE.finditer(source)]
        if hits:
            offenders[os.path.relpath(path, JS_ROOT).replace(os.sep, "/")] = hits
    assert not offenders, f"透過 getter 原地修改共用狀態（請改由 owner 提供 setter）：{offenders}"


def test_read_model_setters_stay_with_their_owners():
    """每個 setter 只有名單內的目錄可以呼叫；名單裡已不存在的呼叫者要同步移除。"""
    actual = {}
    for path, source in _js_sources(skip_models=True):
        for match in _SETTER_CALL_RE.finditer(source):
            actual.setdefault(match.group(1), set()).add(_owner_dir(path))
    violations = {s: sorted(d - ALLOWED_SETTERS[s]) for s, d in actual.items() if d - ALLOWED_SETTERS[s]}
    assert not violations, f"有模組呼叫了不屬於它的 setter：{violations}。請改由 owner 提供函式，或註明原因後加入 ALLOWED_SETTERS。"
    stale = {s: sorted(ALLOWED_SETTERS[s] - actual.get(s, set())) for s in ALLOWED_SETTERS if ALLOWED_SETTERS[s] - actual.get(s, set())}
    assert not stale, f"這些 setter 呼叫者已不存在，請從 ALLOWED_SETTERS 移除：{stale}"


def test_read_model_exposes_the_agreed_contract():
    """getter / setter 的名稱是 consumer 的契約；資料存在 read-model 自己的模組私有物件，不再放 appState。"""
    source = "".join(open(path, encoding="utf-8").read() for path in READ_MODEL_FILES)
    for name in (*GETTERS, *ALLOWED_SETTERS):
        assert re.search(rf"export function {name}\(", source), f"read-model 缺少 {name}"
    for path in READ_MODEL_FILES:
        text = open(path, encoding="utf-8").read()
        code = "\n".join(line for line in text.splitlines() if not line.lstrip().startswith("//"))
        assert "appState" not in code and "from './state.js'" not in code, f"{os.path.basename(path)} 不得依賴 appState"


def test_read_model_runtime():
    """getter / setter 的 runtime 行為：預設值、setter 後 reader 讀到最新值（含切換分片清空）、setter 只改指定欄位。"""
    for name in ("inventory_read_model_runtime", "shared_read_model_runtime"):
        result = subprocess.run(
            ["node", os.path.join(ROOT, "tests", f"{name}.test.js")],
            capture_output=True, text=True, encoding="utf-8", timeout=120,
        )
        assert result.returncode == 0, f"{name} 失敗：\n{result.stdout}\n{result.stderr}"
