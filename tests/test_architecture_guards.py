# -*- coding: utf-8 -*-
"""後端架構守衛（維護性重構的防線）。

規則寫成測試，而不是只寫在文件裡：以後有人（或 agent）違反就會在 CI 立刻紅燈，
不必等到下一次大重構才發現。

1. 模組層 ALL_CAPS 常數必須是不可變型別（frozenset / tuple / MappingProxyType）
2. services 不得 import routes（依賴方向：routes → services → database）
3. routes 之間不得 import 對方的私有名稱（底線開頭）
4. 上傳副檔名 / 大小上限只在 services/upload_policy.py 定義

規則 2、3 目前有「已知違規」白名單：這是待清理的技術債，只准減少、不准新增。
白名單項目一旦修掉，測試會要求同步從白名單移除（避免白名單腐爛）。
"""
import ast
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "app"

# 已知違規（技術債）：修掉後必須從這裡刪除
KNOWN_SERVICE_IMPORTS_ROUTE = {
    "app/services/gcal_sync.py",
}
KNOWN_ROUTE_PRIVATE_IMPORTS = {
    ("app/routes/items.py", "_photo_path"),
    ("app/routes/kits.py", "_photo_path"),
}


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


# ---------- 2. 依賴方向 ----------

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


def test_services_do_not_import_routes():
    """services 是被 routes 呼叫的下層；反向 import 會形成循環依賴（含函式內 lazy import）。"""
    violators = {_rel(p) for p in _py_files(APP / "services") if _imports_routes(_parse(p))}
    new = violators - KNOWN_SERVICE_IMPORTS_ROUTE
    fixed = KNOWN_SERVICE_IMPORTS_ROUTE - violators
    assert not new, f"services 不得 import app.routes：{sorted(new)}"
    assert not fixed, f"已修好，請從 KNOWN_SERVICE_IMPORTS_ROUTE 移除：{sorted(fixed)}"


# ---------- 3. routes 之間不碰私有名稱 ----------

def test_routes_do_not_import_private_names_from_other_routes():
    violators = set()
    for path in _py_files(APP / "routes"):
        for node in ast.walk(_parse(path)):
            if isinstance(node, ast.ImportFrom) and node.module and node.module.startswith("app.routes."):
                for alias in node.names:
                    if alias.name.startswith("_"):
                        violators.add((_rel(path), alias.name))
    new = violators - KNOWN_ROUTE_PRIVATE_IMPORTS
    fixed = KNOWN_ROUTE_PRIVATE_IMPORTS - violators
    assert not new, f"routes 不得 import 其他 route 的私有名稱：{sorted(new)}"
    assert not fixed, f"已修好，請從 KNOWN_ROUTE_PRIVATE_IMPORTS 移除：{sorted(fixed)}"


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
