# -*- coding: utf-8 -*-
"""前端 ES module 依賴方向的架構守衛（issue #39 / PR #42 收尾）。

依賴方向：pages → features → components → core。
- core 只放跨頁、不認識任何業務 feature 的基礎能力；不可 import components / features / pages。
- components 是可重用的呈現元件；不可 import features / pages（業務行為由呼叫端以設定 / callback 傳入）。
- features 不可 import pages（page entry 只負責組裝與掛 window 命名空間）。
（window.__hvac 只能由 pages/*.js 建立的守衛在 test_frontend_assets.py::test_debug_module_registry_is_only_defined_by_page_entries。）

以正式檔案實際解析 import（含 export-from、side-effect import、動態 import()），不設白名單。
"""
import os
import re

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JS_ROOT = os.path.join(ROOT, "static", "js")
LAYERS = ("core", "components", "features", "pages")
# 每一層不可依賴的上層
FORBIDDEN = {
    "core": {"components", "features", "pages"},
    "components": {"features", "pages"},
    "features": {"pages"},
}
_IMPORT_RE = re.compile(
    r"""(?:^|[;\s])(?:import|export)\s+(?:[\w*{}\s,$]+?\s+from\s+)?['"]([^'"]+)['"]"""
    r"""|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)""",
    re.M,
)


def _modules():
    """回傳 static/js 下所有 .js 模組的相對路徑（posix）。"""
    found = []
    for base, _dirs, files in os.walk(JS_ROOT):
        for name in files:
            if name.endswith(".js"):
                found.append(os.path.relpath(os.path.join(base, name), JS_ROOT).replace(os.sep, "/"))
    return sorted(found)


def _imports(module):
    """解析單一模組的相對 import，回傳解析後的模組路徑。"""
    with open(os.path.join(JS_ROOT, module), encoding="utf-8") as fh:
        source = fh.read()
    targets = []
    for match in _IMPORT_RE.finditer(source):
        spec = match.group(1) or match.group(2)
        if not spec.startswith("."):
            continue
        resolved = os.path.normpath(os.path.join(os.path.dirname(module), spec)).replace(os.sep, "/")
        targets.append(resolved)
    return targets


def _layer(module):
    return module.split("/", 1)[0]


def _graph():
    return {module: _imports(module) for module in _modules()}


def test_import_parser_sees_every_static_import_form():
    """解析器本身的保護：若 regex 漏抓，下面的邊界測試會變成假綠燈。"""
    graph = _graph()
    assert "core/api-client.js" in graph["core/utils.js"] or "core/utils.js" in graph["core/api-client.js"]
    assert "features/shell/app.js" in graph["pages/main.js"]
    total = sum(len(targets) for targets in graph.values())
    raw = 0
    for module in graph:
        with open(os.path.join(JS_ROOT, module), encoding="utf-8") as fh:
            raw += len(re.findall(r"^import\b.*\bfrom\s+'\.", fh.read(), re.M))
    assert total >= raw > 100


def test_every_module_belongs_to_a_layer():
    """static/js 只能有四層；新目錄必須先決定依賴方向再加入本守衛。"""
    stray = [m for m in _modules() if _layer(m) not in LAYERS]
    assert stray == [], f"static/js 出現不屬於 {LAYERS} 的模組：{stray}"


@pytest.mark.parametrize("layer", sorted(FORBIDDEN))
def test_layer_does_not_import_upper_layers(layer):
    """core / components / features 不可反向依賴上層（不設例外）。"""
    violations = [
        f"{module} → {target}"
        for module, targets in _graph().items()
        if _layer(module) == layer
        for target in targets
        if _layer(target) in FORBIDDEN[layer]
    ]
    assert violations == [], f"{layer} 反向依賴上層：\n" + "\n".join(violations)


def _import_cycles(graph):
    """Tarjan SCC：回傳所有多模組強連通分量（與自我 import 的模組），每個分量已排序。"""
    index, low, stack, on_stack, cycles = {}, {}, [], set(), []
    counter = [0]

    def visit(node):
        index[node] = low[node] = counter[0]
        counter[0] += 1
        stack.append(node)
        on_stack.add(node)
        for target in graph.get(node, ()):
            if target not in index:
                visit(target)
                low[node] = min(low[node], low[target])
            elif target in on_stack:
                low[node] = min(low[node], index[target])
        if low[node] == index[node]:
            component = []
            while True:
                item = stack.pop()
                on_stack.discard(item)
                component.append(item)
                if item == node:
                    break
            if len(component) > 1 or node in graph.get(node, ()):
                cycles.append(sorted(component))

    for node in graph:
        if node not in index:
            visit(node)
    return sorted(cycles, key=len, reverse=True)


def _cycle_report(graph, cycles):
    """每個循環列出模組數、成員，以及分量內被最多成員 import 的 hub（除錯用）。"""
    lines = []
    for cycle in cycles:
        members = set(cycle)
        fan_in = {m: sum(1 for src in cycle if m in graph.get(src, ())) for m in cycle}
        hubs = sorted(cycle, key=lambda m: -fan_in[m])[:3]
        lines.append(f"{len(cycle)} modules, hubs {[(h, fan_in[h]) for h in hubs]}: {sorted(members)}")
    return "\n".join(lines)


def test_core_and_components_are_outside_every_import_cycle():
    """core / components 不可落在任何 import 循環中（循環會讓 evaluation 順序依賴入口，易出現 TDZ）。"""
    offenders = [
        [m for m in cycle if _layer(m) in ("core", "components")]
        for cycle in _import_cycles(_graph())
    ]
    offenders = [o for o in offenders if o]
    assert offenders == [], f"core / components 仍在 import 循環內：{offenders}"


def test_import_graph_has_no_cycles():
    """整個 static/js（含 features 之間與 feature 內部）不得有任何 import 循環（無白名單）。

    feature 需要「切頁」「重新整理資料」時，改用 shell 的 port（features/shell/navigation.js、data-refresh.js），
    實作由頁面進入點組裝注入；modal 需要重繪頁面時，由呼叫端傳入 callback 或把共用 helper 抽成葉節點模組。"""
    graph = _graph()
    cycles = _import_cycles(graph)
    assert cycles == [], f"import 循環 {len(cycles)} 個：\n" + _cycle_report(graph, cycles)


def test_only_page_entries_import_shell_composition():
    """features/shell/app.js 是主頁的組裝層（import 所有頁籤 renderer）：只有 pages/*.js 可以 import 它，
    其他 feature 需要切頁時用 features/shell/navigation.js 的 navigateToTab。"""
    importers = sorted(m for m, targets in _graph().items() if "features/shell/app.js" in targets and _layer(m) != "pages")
    assert importers == [], f"只有頁面進入點可以 import features/shell/app.js：{importers}"
