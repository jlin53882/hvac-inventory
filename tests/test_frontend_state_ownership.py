# -*- coding: utf-8 -*-
"""前端 shared state 的所有權守衛（appState ratchet）。

`core/state.js` 的 `appState` 只放「真正跨 feature 共用」的值。這裡把兩件事寫成測試：

1. **欄位清單只准縮小**：新增 appState 欄位會紅燈。單一 feature 才用的狀態，放該 feature 的 `state.js`
   （例如 `calendarState`、`inventoryState`）或模組私有變數，不要往 core 塞。
2. **誰能寫誰**：每個欄位「允許被哪些目錄直接指派（`appState.X = …`）」是明確的名單；
   有新的寫入者（尤其是其他 feature 直接改別人的狀態）會紅燈。名單縮小（寫入者減少）時要求同步更新，避免名單腐爛。

追蹤兩種寫入：
- 直接指派 / 複合指派 / 遞增（`appState.X = …`、`+=`、`++`）→ `ALLOWED_WRITERS`
- 原地修改（`appState.X.push(...)`、`.splice/.sort/...`、`appState.X[k] = …`、`appState.X.prop = …`、
  `Object.assign(appState.X, …)`、`delete appState.X`）→ `ALLOWED_MUTATORS`（目前只有 3 個欄位有原地修改，其他欄位一律不准）

另外 `shellState`（`features/shell/state.js`）是 shell 內部狀態，只有 `features/shell/*` 可以使用。
新增欄位或寫入者時，請先想能不能改成該欄位的 owner 提供函式，確實需要再更新下面兩個表並註明原因。
"""
import glob
import os
import re
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JS_ROOT = os.path.join(ROOT, "static", "js")
STATE_JS = os.path.join(JS_ROOT, "core", "state.js")

# appState 目前的欄位（只准縮小）
APP_STATE_FIELDS = frozenset({
    "ALL_ITEMS", "INVENTORY_META", "INVENTORY_FACETS",
    "inventoryLoadedSite", "fullItemsLoadedSite",
    "preparedItems", "currentBrands", "currentCategories",
    "currentTab", "currentSite",
    "currentKitItems",
    "DESTINATIONS", "destinationsLoadedSite",
    "unitListActive",
    "globalCabinetList",   # inventory 與 kits 都會重新載入櫃子清單
})

# 欄位 → 允許直接指派它的目錄（static/js 下的第一或前兩層：core / components / pages / features/<name>）
ALLOWED_WRITERS = {
    "ALL_ITEMS": {"features/shell"},
    "INVENTORY_META": {"features/shell"},
    "INVENTORY_FACETS": {"features/shell"},
    "inventoryLoadedSite": {"features/shell"},
    "fullItemsLoadedSite": {"features/shell"},
    "preparedItems": {"features/prepared"},
    "currentBrands": {"features/inventory"},
    "currentCategories": {"features/inventory"},
    "currentTab": {"features/shell"},
    "currentSite": {"features/shell"},
    "currentKitItems": {"features/kits"},
    "DESTINATIONS": {"core"},
    "destinationsLoadedSite": {"core"},
    "unitListActive": {"core", "features/settings"},
    "globalCabinetList": {"features/inventory", "features/kits"},
}

# 原地修改（不是重新指派整個欄位）：目前只有這 3 個欄位有，寫入者也是現況；新增請先想能不能由 owner 提供函式
# （INVENTORY_META 已收進 core/inventory-read-model.js 的 setter，其他 feature 只能呼叫 setter）
ALLOWED_MUTATORS = {
    "INVENTORY_META": {"core"},   # core/inventory-read-model.js 的 setInventoryPage / setInventoryStats（feature 不再直接改）
    "currentBrands": {"features/inventory", "features/shell"},
    "currentCategories": {"features/inventory", "features/shell"},
}

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


def _declared_fields():
    source = open(STATE_JS, encoding="utf-8").read().split("export const appState", 1)[1]
    body = source.split("\n};", 1)[0]
    return set(re.findall(r"^  (\w+):", body, re.M))


def _owner_dir(path):
    rel = os.path.relpath(path, JS_ROOT).replace(os.sep, "/")
    parts = rel.split("/")
    return "/".join(parts[:2]) if parts[0] == "features" else parts[0]


def _scan(regex):
    found = {}
    for path in glob.glob(os.path.join(JS_ROOT, "**", "*.js"), recursive=True):
        if path == STATE_JS or os.sep + "dist" + os.sep in path:
            continue
        for match in regex.finditer(open(path, encoding="utf-8").read()):
            field = next(group for group in match.groups() if group)
            found.setdefault(field, set()).add(_owner_dir(path))
    return found


def _actual_writers():
    return _scan(_WRITE_RE)


def test_app_state_fields_only_shrink():
    declared = _declared_fields()
    added = declared - APP_STATE_FIELDS
    removed = APP_STATE_FIELDS - declared
    assert not added, (
        f"core/state.js 的 appState 新增了欄位 {sorted(added)}：單一 feature 才用的狀態請放該 feature 的 state.js "
        "或模組私有變數；真的跨 feature 共用才加，並同步更新 APP_STATE_FIELDS 與 ALLOWED_WRITERS。"
    )
    assert not removed, f"appState 欄位已移除，請從 APP_STATE_FIELDS / ALLOWED_WRITERS 同步移除：{sorted(removed)}"
    assert set(ALLOWED_WRITERS) == set(APP_STATE_FIELDS), "ALLOWED_WRITERS 與 APP_STATE_FIELDS 必須是同一組欄位"


def test_app_state_direct_writes_stay_with_their_owners():
    actual = _actual_writers()
    unknown = set(actual) - set(APP_STATE_FIELDS)
    assert not unknown, f"寫入了 appState 上不存在的欄位（拼字錯誤，或漏在 state.js 宣告）：{sorted(unknown)}"
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


def test_feature_specific_state_lives_with_its_feature():
    """已搬出 appState 的單一 feature 狀態不得再回到 core/state.js。"""
    core = open(STATE_JS, encoding="utf-8").read()
    for moved in ("calMonth", "CAL_PALETTE", "CAL_WEEK", "parseCalendarMonth", "wprHistoryPageSize",
                  "batchMode", "toastTimer", "STATUS_LIST_CONTEXT", "editItemId",
                  "inventoryAbortController", "dataAbortController", "statsAbortController",
                  "ALERTS_BY_SITE", "inventoryFacetsLoadedSite"):
        assert moved not in core, f"{moved} 是單一 feature / 模組專用，不應回到 core/state.js"


def test_app_state_in_place_mutations_stay_with_known_owners():
    """原地修改（push / splice / obj[k] = … / obj.prop = … / Object.assign / delete）也要受管：只有名單內的欄位、目錄可以。"""
    actual = _scan(_MUTATE_RE)
    unknown = {field: sorted(dirs) for field, dirs in actual.items() if field not in ALLOWED_MUTATORS}
    assert not unknown, f"新增了對 appState 欄位的原地修改（請改由 owner 提供函式，或註明原因後加入 ALLOWED_MUTATORS）：{unknown}"
    violations = {f: sorted(d - ALLOWED_MUTATORS[f]) for f, d in actual.items() if d - ALLOWED_MUTATORS[f]}
    assert not violations, f"有新的模組在原地修改 appState 欄位：{violations}"
    stale = {f: sorted(ALLOWED_MUTATORS[f] - actual.get(f, set())) for f in ALLOWED_MUTATORS if ALLOWED_MUTATORS[f] - actual.get(f, set())}
    assert not stale, f"這些原地修改已不存在，請從 ALLOWED_MUTATORS 移除：{stale}"


def test_shell_state_is_private_to_shell():
    """shellState 只給 features/shell/* 使用；其他 feature 要讀 shell 的資料請走 appState 的共用欄位。"""
    offenders = []
    for path in glob.glob(os.path.join(JS_ROOT, "**", "*.js"), recursive=True):
        if os.sep + "dist" + os.sep in path or _owner_dir(path) == "features/shell":
            continue
        if re.search(r"\bshellState\b", open(path, encoding="utf-8").read()):
            offenders.append(os.path.relpath(path, JS_ROOT).replace(os.sep, "/"))
    assert not offenders, f"shellState 是 shell 內部狀態，這些模組不該使用：{offenders}"


# ---- 讀取棘輪（direct reader ratchet）----
# 已 accessor 化的欄位：consumer 一律經 core/inventory-read-model.js 的 getter 讀取，不得直接 `appState.X`。
# 寫入（appState.X = …）仍由 ALLOWED_WRITERS 管；這裡只管「讀」。下一個 phase 再把其他欄位加進來。
ACCESSOR_FIELDS = {
    "ALL_ITEMS": "getAllItems",
    "INVENTORY_META": "getInventoryMeta",
    "INVENTORY_FACETS": "getInventoryFacets",
}
READ_MODEL_JS = os.path.join(JS_ROOT, "core", "inventory-read-model.js")
# 目前仍直接讀 appState.X 的模組數（只准減少）；已清零的欄位不得再出現
DIRECT_READER_BASELINE = {"ALL_ITEMS": 0, "INVENTORY_META": 0, "INVENTORY_FACETS": 0}

_DIRECT_READ_RE = re.compile(r"\bappState\.(" + "|".join(ACCESSOR_FIELDS) + r")\b(?!\s*[+\-*/]?=(?!=))")
# 透過 accessor 拿到 reference 後原地修改（繞過 owner）
_ACCESSOR_MUTATE_RE = re.compile(
    r"\b(?:" + "|".join(ACCESSOR_FIELDS.values()) + r")\(\)\s*(?:"
    r"\.(?:push|pop|shift|unshift|splice|sort|reverse|fill|copyWithin)\s*\("
    r"|\.length\s*=(?!=)"
    r"|\[[^\]\n]+\]\s*[+\-*/]?=(?!=)"
    r"|\.\w+\s*[+\-*/]?=(?!=)"
    r")"
    r"|\bObject\.assign\(\s*(?:" + "|".join(ACCESSOR_FIELDS.values()) + r")\(\)"
)


def _js_sources():
    for path in glob.glob(os.path.join(JS_ROOT, "**", "*.js"), recursive=True):
        if path in (STATE_JS, READ_MODEL_JS) or os.sep + "dist" + os.sep in path:
            continue
        yield path, open(path, encoding="utf-8").read()


def test_inventory_read_model_is_read_through_accessors():
    """ALL_ITEMS / INVENTORY_META / INVENTORY_FACETS 的讀取一律走 accessor，direct reader 只准減少。"""
    readers = {field: set() for field in ACCESSOR_FIELDS}
    for path, source in _js_sources():
        for match in _DIRECT_READ_RE.finditer(source):
            readers[match.group(1)].add(os.path.relpath(path, JS_ROOT).replace(os.sep, "/"))
    grew = {f: sorted(files) for f, files in readers.items() if len(files) > DIRECT_READER_BASELINE[f]}
    assert not grew, f"這些模組直接讀 appState 欄位，請改用 core/inventory-read-model.js 的 accessor：{grew}"
    stale = {f: len(files) for f, files in readers.items() if len(files) < DIRECT_READER_BASELINE[f]}
    assert not stale, f"direct reader 已減少，請調降 DIRECT_READER_BASELINE：{stale}"


def test_inventory_read_model_accessors_are_not_mutated_by_consumers():
    """accessor 回傳的是 live reference：不得 getAllItems().push(...) / getInventoryMeta().x = … 這類繞過 owner 的修改。"""
    offenders = {}
    for path, source in _js_sources():
        hits = [m.group(0) for m in _ACCESSOR_MUTATE_RE.finditer(source)]
        if hits:
            offenders[os.path.relpath(path, JS_ROOT).replace(os.sep, "/")] = hits
    assert not offenders, f"透過 accessor 原地修改共用狀態（請改由 owner 提供 setter）：{offenders}"


def test_inventory_read_model_exposes_the_agreed_contract():
    """accessor 與 setter 的名稱是 consumer 的契約；backing storage 仍在 appState，換掉時 consumer 不用改。"""
    source = open(READ_MODEL_JS, encoding="utf-8").read()
    for name in (*ACCESSOR_FIELDS.values(), "setInventoryPage", "setInventoryStats"):
        assert re.search(rf"export function {name}\(", source), f"inventory-read-model.js 缺少 {name}"
    assert "import { appState } from './state.js';" in source


def test_inventory_read_model_runtime():
    """accessor / setter 的 runtime 行為：預設值、owner 重新指派後 reader 讀到最新值、setter 只改指定欄位。"""
    result = subprocess.run(
        ["node", os.path.join(ROOT, "tests", "inventory_read_model_runtime.test.js")],
        capture_output=True, text=True, encoding="utf-8", timeout=120,
    )
    assert result.returncode == 0, f"inventory read model runtime 失敗：\n{result.stdout}\n{result.stderr}"
