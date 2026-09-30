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
    "patchItem": {"features/inventory"},                  # 照片上傳 / 刪除後同步品項縮圖狀態（不可自己 find() 後改欄位）
    "patchCurrentKit": {"features/inventory"},            # 刪除整組照片後同步整組縮圖狀態
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
# getter 回傳資料中的「單筆元素」被指派給區域變數（getAllItems().find(…) / getCurrentKitItems()[i]，含放在條件運算式裡）
_GETTER_ELEMENT_ALIAS_DECL_RE = re.compile(
    r"\b(?:const|let|var)\s+(\w+)\s*=[^;]*?\b(?:" + "|".join(sorted(GETTERS)) + r")\(\)\s*(?:\.find\(|\[)[^;]*;", re.S
)
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


# ---- getter 回傳值被指派給區域變數（alias）後再原地修改 ----
_GETTER_ALIAS_DECL_RE = re.compile(
    r"\b(?:const|let|var)\s+(\w+)\s*=\s*(?:" + "|".join(sorted(GETTERS)) + r")\(\)\s*(?=;|\n|\|\||&&|\?|,)"
)
_MUTATING_METHODS = r"(?:push|pop|shift|unshift|splice|sort|reverse|fill|copyWithin)"
_ACCESS_CHAIN = r"(?:\.\w+|\[[^\]\n]*\])"


def _alias_mutation_re(alias):
    """alias 的原地修改：alias.push(…) / alias[k] = … / alias.a.b = … / alias.n++ / Object.assign(alias, …) / delete alias.x。"""
    name = re.escape(alias)
    return re.compile(
        rf"\b{name}{_ACCESS_CHAIN}*\.{_MUTATING_METHODS}\s*\("
        rf"|\b{name}{_ACCESS_CHAIN}+\s*(?:[+\-*/%]?=(?![=>])|\+\+|--)"
        rf"|\bObject\.(?:assign|defineProperty|defineProperties|setPrototypeOf)\(\s*{name}\b"
        rf"|\bdelete\s+{name}\b"
    )


def _enclosing_scope_end(source, pos):
    """從 pos 往後找到「包住它的區塊」結尾（大括號配對；找不到就到檔尾）。"""
    depth = 0
    for index in range(pos, len(source)):
        char = source[index]
        if char == "{":
            depth += 1
        elif char == "}":
            if depth == 0:
                return index
            depth -= 1
    return len(source)


def find_getter_alias_mutations(source):
    """找出「const x = getXxx(); … x.push(…)」這類經由區域變數 alias 原地修改 read-model 的寫法。

    只看 getter 回傳值「直接」指派的變數（含 `getXxx() && …` / `getXxx() ? … : …` 這種可能回傳 live reference 的運算式），
    以及取出單筆元素的變數（`const item = getAllItems().find(…)`、`getXxx()[i]`，含放在條件運算式裡；`.filter` / `.map` 等
    產生新陣列的用法不算），並且只在該變數宣告所在的區塊內找修改，避免把同名的其他變數誤判。回傳 [(alias, 修改片段)]。
    """
    found = []
    decls = list(_GETTER_ALIAS_DECL_RE.finditer(source)) + list(_GETTER_ELEMENT_ALIAS_DECL_RE.finditer(source))
    for decl in decls:
        alias = decl.group(1)
        scope = source[decl.end():_enclosing_scope_end(source, decl.end())]
        for hit in _alias_mutation_re(alias).finditer(scope):
            found.append((alias, hit.group(0)))
    return found


_FUNCTION_DECL_RE = re.compile(r"\bfunction\s+(\w+)\s*\(([^)]*)\)\s*\{")
_GETTER_CALL_RE = re.compile(r"\b(?:" + "|".join(sorted(GETTERS)) + r")\(\)")


def _split_top_level_args(text):
    """把呼叫的引數文字依「最外層逗號」切開（略過巢狀括號 / 陣列 / 物件內的逗號）。"""
    args, depth, current = [], 0, []
    for char in text:
        if char in "([{":
            depth += 1
        elif char in ")]}":
            depth -= 1
        if char == "," and depth == 0:
            args.append("".join(current))
            current = []
        else:
            current.append(char)
    args.append("".join(current))
    return args


def _call_argument_text(source, open_paren):
    """open_paren 是 '(' 的位置；回傳到對應 ')' 之前的引數文字（找不到回傳 None）。"""
    depth = 0
    for index in range(open_paren, len(source)):
        char = source[index]
        if char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
            if depth == 0:
                return source[open_paren + 1:index]
    return None


def find_getter_argument_mutations(source):
    """找出「把 getter 回傳的 live reference 直接當引數傳給同檔函式，而該函式又原地修改這個參數」。

    例：`renderFilterChips(id, counts, getCurrentBrands(), …)`，函式裡 `selectedArr.push(name)` / `selectedArr.length = 0`。
    只做同一檔案內、函式宣告可直接對應的檢查（不做跨檔 data-flow）；回傳 [(函式名, 參數名, 修改片段)]。
    """
    definitions = {}
    for match in _FUNCTION_DECL_RE.finditer(source):
        body_start = match.end()
        definitions.setdefault(match.group(1), []).append((
            [param.strip().split("=")[0].strip() for param in match.group(2).split(",") if param.strip()],
            source[body_start:_enclosing_scope_end(source, body_start)],
        ))
    found = []
    for name, overloads in definitions.items():
        for call in re.finditer(rf"(?<![\w.]){re.escape(name)}\s*\(", source):
            if source[max(0, call.start() - len("function ")):call.start()] == "function ":
                continue   # 這是函式宣告本身，不是呼叫
            args_text = _call_argument_text(source, call.end() - 1)
            if args_text is None:
                continue
            for index, arg in enumerate(_split_top_level_args(args_text)):
                if not _GETTER_CALL_RE.fullmatch(arg.strip()):
                    continue
                for params, body in overloads:
                    if index < len(params):
                        for hit in _alias_mutation_re(params[index]).finditer(body):
                            found.append((name, params[index], hit.group(0)))
    return found


def test_read_model_getters_are_not_mutated_by_consumers():
    """getter 回傳的是 live reference：不得 getAllItems().push(...)，也不得 `const x = getAllItems(); x.push(...)`（alias）。"""
    offenders = {}
    for path, source in _js_sources():
        hits = [m.group(0) for m in _GETTER_MUTATE_RE.finditer(source)]
        hits += [f"{alias}: {snippet}" for alias, snippet in find_getter_alias_mutations(source)]
        if hits:
            offenders[os.path.relpath(path, JS_ROOT).replace(os.sep, "/")] = hits
    assert not offenders, f"透過 getter（含區域變數 alias）原地修改共用狀態（請改由 owner 提供 setter）：{offenders}"


def test_getter_results_passed_to_helpers_are_not_mutated_there():
    """getter 回傳值當引數傳給同檔函式時，函式不得原地修改該參數（filters.js 的 renderFilterChips 曾經這樣改 live array）。"""
    offenders = {}
    for path, source in _js_sources():
        hits = find_getter_argument_mutations(source)
        if hits:
            offenders[os.path.relpath(path, JS_ROOT).replace(os.sep, "/")] = hits
    assert not offenders, f"函式原地修改了傳入的 read-model 資料（請改由 owner setter / data-action 委派寫入）：{offenders}"


def test_getter_argument_scanner_catches_parameter_mutations():
    """scanner 自身的 regression：參數 alias 的原地修改要抓到，唯讀 / 已有其他來源的用法不誤判。"""
    must_fail = [
        "function draw(list, selected) { selected.push(1); }\ndraw(items, getCurrentBrands());",
        "function draw(selected) {\n  el.onclick = function() { selected.length = 0; };\n}\ndraw(getCurrentBrands());",
        "function draw(a, b, sel) { if (x) sel.splice(0, 1); }\ndraw(1, [1, 2], getCurrentCategories());",
        "function patch(meta) { meta.page = 3; }\npatch(getInventoryMeta());",
    ]
    for source in must_fail:
        assert find_getter_argument_mutations(source), f"參數 mutation 沒被抓到：{source!r}"
    must_pass = [
        "function draw(list, selected) { return selected.includes(list[0]); }\ndraw(items, getCurrentBrands());",
        "function draw(selected) { selected.push(1); }\ndraw(localCopy);",
        "function draw(selected) { const next = selected.concat(1); return next; }\ndraw(getCurrentBrands());",
        "function draw(a, selected) { a.push(1); }\ndraw(list, getCurrentBrands());",
    ]
    for source in must_pass:
        assert not find_getter_argument_mutations(source), f"合法用法被誤判：{source!r}"
    old_filters = (
        "function renderFilterChips(containerId, counts, selectedArr, type) {\n"
        "  allChip.onclick = function() { selectedArr.length = 0; };\n"
        "  chip.onclick = function() { if (i >= 0) selectedArr.splice(i, 1); else selectedArr.push(name); };\n"
        "}\nrenderFilterChips('fp-brand-chips', brands, getCurrentBrands(), 'brand');"
    )
    assert find_getter_argument_mutations(old_filters), "filters.js 舊寫法（renderFilterChips 改傳入的 live array）必須被抓到"


def test_getter_alias_scanner_catches_alias_mutations():
    """scanner 自身的 regression：舊 guard（只看 getXxx().push）漏掉的 alias 寫法，新 scanner 必須抓到。"""
    must_fail = [
        "const items = getAllItems();\nitems.push(newItem);",
        "let items = getPreparedItems();\nitems.splice(0, 1);",
        "const meta = getInventoryMeta();\nmeta.page = 2;",
        "const facets = getInventoryFacets();\nfacets.locations = [];",
        "const brands = getCurrentBrands();\nbrands.splice(0);",
        "const brands = getCurrentBrands();\nbrands[0] = 'x';",
        "const items = getAllItems();\nObject.assign(items, extra);",
        "const meta = getInventoryMeta();\ndelete meta.stats;",
        "const meta = getInventoryMeta();\nmeta.stats.zero_items = [];",
        "const meta = getInventoryMeta();\nmeta.total += 1;",
        "const meta = getInventoryMeta();\nmeta.page++;",
        # 條件運算式仍可能回傳 live reference（filters.js 曾經的寫法）
        "var counts = getInventoryFacets() && getInventoryFacets().brands ? getInventoryFacets().brands : {};\ncounts[b] = 1;",
        "function render() {\n  const list = getAllItems();\n  if (x) { list.sort(cmp); }\n}",
        # 從 getter 資料取出的單筆元素（photo.js 曾經的寫法）：直接改欄位也是改 read-model
        "const item = getAllItems().find(i => i.id === id);\nif (item) { item.has_photo = true; }",
        "const kit = Array.isArray(getCurrentKitItems())\n  ? getCurrentKitItems().find(k => k.id === id)\n  : null;\nif (kit) {\n  kit.thumbnail_url = null;\n}",
        "const first = getAllItems()[0];\nfirst.qty += 1;",
        "const item = getAllItems().find(i => i.id === id);\nObject.assign(item, patch);",
    ]
    for source in must_fail:
        assert find_getter_alias_mutations(source), f"alias mutation 沒被抓到：{source!r}"
    # 舊 guard 對這些 alias 寫法確實是漏的（證明新 scanner 補的是真缺口）
    assert not any(_GETTER_MUTATE_RE.search(source) for source in must_fail[:10])

    must_pass = [
        "const items = getAllItems();\nreturn items.filter(i => i.qty > 0);",
        "const meta = getInventoryMeta();\nconst page = meta.page;",
        "const meta = getInventoryMeta();\nif (meta.page === 2 && meta.total >= 1) render(meta.stats);",
        "const brands = getCurrentBrands();\nconst next = brands.concat('x');\nsetCurrentBrands(next);",
        "setCurrentBrands(nextBrands);",
        "const items = getAllItems();\nconst copy = items.slice();\ncopy.push(x);",
        # 同名但不是 getter alias 的變數，或在別的區塊：不得誤判
        "function a() { const items = getAllItems(); return items.length; }\nfunction b() { const items = []; items.push(1); return items; }",
        "const items = getAllItems();\nconst rows = items.map(i => i.id);\nrows.push(0);",
        "const item = getAllItems().find(i => i.id === id);\nreturn item ? item.qty : 0;",
        "const item = getAllItems().find(i => i.id === id);\nconst copy = Object.assign({}, item);\ncopy.qty = 1;",
        "const hits = getAllItems().filter(i => i.qty > 0);\nhits.push(extra);",
        "if (patchItem(itemId, { has_photo: false })) renderInventoryView();",
    ]
    for source in must_pass:
        assert not find_getter_alias_mutations(source), f"合法的 read-only 用法被誤判：{source!r}"


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
