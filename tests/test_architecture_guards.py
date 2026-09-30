# -*- coding: utf-8 -*-
"""後端架構守衛（維護性重構的防線）。

規則寫成測試，而不是只寫在文件裡：以後有人（或 agent）違反就會在 CI 立刻紅燈，
不必等到下一次大重構才發現。

1. 模組層 ALL_CAPS 常數必須是不可變型別（frozenset / tuple / MappingProxyType）
2. 依賴方向 routes → services → database：services 不得 import routes（含函式內 lazy import）
3. routes 之間不得互相 import（共用邏輯放 services）
4. 上傳副檔名 / 大小上限只在 services/upload_policy.py 定義

若確實遇到「暫時無法修正」的違規，才加進下面的白名單，並註明原因；
白名單項目修好後測試會要求同步移除（避免白名單腐爛）。
"""
import ast
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "app"

# 已知違規（技術債）：目前全部清零，新增前請先想能不能把共用邏輯移到 services
KNOWN_SERVICE_IMPORTS_ROUTE: set[str] = set()
KNOWN_ROUTE_IMPORTS_ROUTE: set[str] = set()


def _py_files(base: Path):
    return sorted(p for p in base.rglob("*.py") if "__pycache__" not in p.parts)


def _rel(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def _parse(path: Path) -> ast.Module:
    return ast.parse(path.read_text(encoding="utf-8"), filename=str(path))


# ---------- 1. 不可變常數 ----------

def _is_all_caps(name: str) -> bool:
    core = name.lstrip("_")
    return bool(core) and core.upper() == core and any(c.isalpha() for c in core)


def test_module_level_constants_are_immutable():
    """ALL_CAPS 模組常數不得是 list / dict / set 字面量或推導式（改用 tuple / frozenset / MappingProxyType）。"""
    mutable = (ast.List, ast.Dict, ast.Set, ast.ListComp, ast.DictComp, ast.SetComp)
    offenders = []
    for path in _py_files(APP) + [ROOT / "main.py"]:
        for node in _parse(path).body:
            targets = []
            value = None
            if isinstance(node, ast.Assign):
                targets, value = node.targets, node.value
            elif isinstance(node, ast.AnnAssign) and node.value is not None:
                targets, value = [node.target], node.value
            if not isinstance(value, mutable):
                continue
            for t in targets:
                if isinstance(t, ast.Name) and _is_all_caps(t.id):
                    offenders.append(f"{_rel(path)}:{node.lineno} {t.id}")
    assert not offenders, "模組層常數不可為可變容器：\n" + "\n".join(offenders)


# ---------- 2 / 3. 依賴方向 ----------

def _imports_routes(tree: ast.AST) -> bool:
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module and (
            node.module == "app.routes" or node.module.startswith("app.routes.")
        ):
            return True
        if isinstance(node, ast.Import) and any(
            a.name == "app.routes" or a.name.startswith("app.routes.") for a in node.names
        ):
            return True
    return False


def _check_no_route_imports(base: Path, known: set[str], label: str):
    violators = {_rel(p) for p in _py_files(base) if _imports_routes(_parse(p))}
    new = violators - known
    fixed = known - violators
    assert not new, f"{label} 不得 import app.routes（共用邏輯請放 services）：{sorted(new)}"
    assert not fixed, f"已修好，請從白名單移除：{sorted(fixed)}"


def test_services_do_not_import_routes():
    """services 是被 routes 呼叫的下層；反向 import 會形成循環依賴（含函式內 lazy import）。"""
    _check_no_route_imports(APP / "services", KNOWN_SERVICE_IMPORTS_ROUTE, "services")


def test_routes_do_not_import_other_routes():
    """routes 是平行的 HTTP 入口，彼此不該依賴（會讓拆檔/改名牽一髮動全身）。"""
    _check_no_route_imports(APP / "routes", KNOWN_ROUTE_IMPORTS_ROUTE, "routes")


# ---------- 4. 上傳政策單一來源 ----------

def test_upload_policy_is_single_source_and_immutable():
    from app.services import upload_policy

    assert isinstance(upload_policy.IMAGE_UPLOAD_EXTS, frozenset)
    assert isinstance(upload_policy.DOCUMENT_UPLOAD_EXTS, frozenset)
    assert upload_policy.IMAGE_UPLOAD_EXTS < upload_policy.DOCUMENT_UPLOAD_EXTS  # 圖片白名單是文件白名單的真子集
    assert ".pdf" in upload_policy.DOCUMENT_UPLOAD_EXTS and ".pdf" not in upload_policy.IMAGE_UPLOAD_EXTS

    forbidden = {"ALLOWED_EXT", "ALLOWED_EXTS", "MAX_UPLOAD_BYTES"}
    offenders = []
    for path in _py_files(APP / "routes"):
        for node in _parse(path).body:
            if isinstance(node, ast.Assign):
                for t in node.targets:
                    if isinstance(t, ast.Name) and t.id in forbidden:
                        offenders.append(f"{_rel(path)}:{node.lineno} {t.id}")
    assert not offenders, "上傳副檔名/大小請只在 services/upload_policy.py 定義：\n" + "\n".join(offenders)


# ---------- 全域狀態行為 ----------

def test_ip_rate_limit_is_consistent_under_concurrency():
    """登入失敗計數在多 thread 下不得少算（threadpool 內同步路由會並行）。"""
    from app.services import auth

    ip = "203.0.113.77"
    auth.clear_ip_fail(ip)
    workers, per_worker = 8, 25

    def hammer():
        for _ in range(per_worker):
            auth.record_ip_fail(ip)
            auth.check_ip_rate_limit(ip)

    threads = [threading.Thread(target=hammer) for _ in range(workers)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    try:
        assert len(auth._ip_fail_times[ip]) == workers * per_worker
        assert auth.check_ip_rate_limit(ip) is True
    finally:
        auth.clear_ip_fail(ip)


# ---------- 5. 模組層 import 不得循環 ----------

def _module_name(path: Path) -> str:
    rel = path.relative_to(ROOT).with_suffix("")
    parts = list(rel.parts)
    if parts[-1] == "__init__":
        parts.pop()
    return ".".join(parts)


def _top_level_imports(path: Path, known: set[str]) -> set[str]:
    """只看模組最上層的 import（函式內的延後 import 是刻意打斷循環的手段，不算）。"""
    edges: set[str] = set()
    for node in _parse(path).body:
        if isinstance(node, ast.Import):
            edges.update(a.name for a in node.names if a.name in known)
        elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            if node.module in known:
                edges.add(node.module)
            for alias in node.names:
                if f"{node.module}.{alias.name}" in known:      # from app.services import gcal_sync
                    edges.add(f"{node.module}.{alias.name}")
    return edges


def test_python_module_level_imports_have_no_cycles():
    """app/ 內的模組層 import 圖必須是 DAG。

    已知的雙向依賴 gcal_sync ↔ sync_scheduler 以「gcal_sync 內延後 import」處理，不出現在模組層；
    若有人把它改成模組層 import，或新增其他循環，這裡會紅燈。
    """
    files = _py_files(APP) + [ROOT / "main.py"]
    known = {_module_name(p) for p in files}
    graph = {_module_name(p): _top_level_imports(p, known) - {_module_name(p)} for p in files}

    visiting: list[str] = []
    done: set[str] = set()
    cycles: list[list[str]] = []

    def visit(node: str) -> None:
        if node in done:
            return
        if node in visiting:
            cycles.append(visiting[visiting.index(node):] + [node])
            return
        visiting.append(node)
        for dep in sorted(graph[node]):
            visit(dep)
        visiting.pop()
        done.add(node)

    for name in sorted(graph):
        visit(name)
    assert not cycles, "模組層 import 循環：\n" + "\n".join(" → ".join(c) for c in cycles)
