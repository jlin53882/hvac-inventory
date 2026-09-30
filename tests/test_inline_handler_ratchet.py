# -*- coding: utf-8 -*-
"""inline event handler（onclick= 等）守衛。

歷史：畫面的按鈕事件曾大量寫成 inline handler（HTML 與 JS 模板字串），需要把函式掛到 window 命名空間才能呼叫，
每新增一個按鈕要改「HTML、模組 export、window.X = {…}」三處，漏一處只有點擊時才會發現。
現在全部改成 data-action + 事件委派（core/actions.js 的 createActionDelegate）；本守衛確保不再長回來：

- 任何 .html / .js 都不得有 inline handler（onclick / onchange / oninput / onsubmit / onkeydown / onerror / onload / ontoggle …）
- 不得用 setAttribute('onclick', …) 動態塞 inline handler（改設 data-action）
- BASELINE 保留為空表：萬一有暫時無法移除的例外，必須在這裡逐檔登記數量並註明原因（只准減少）
"""
import os
import re

from frontend_test_support import STATIC

INLINE_HANDLER = re.compile(r"(?<![\w-])on(?:click|change|input|submit|keydown|keyup|blur|focus|toggle|error|load|dblclick|mouse\w+|touch\w+|drag\w+|drop)=")

# 例外基準：檔案 → inline handler 數量（目前沒有例外）
BASELINE = {}


def _current_counts() -> dict:
    counts = {}
    for base, _dirs, files in os.walk(STATIC):
        parts = base.split(os.sep)
        if "dist" in parts or "vendor" in parts:
            continue
        for name in files:
            if not name.endswith((".html", ".js")):
                continue
            path = os.path.join(base, name)
            with open(path, encoding="utf-8") as handle:
                count = len(INLINE_HANDLER.findall(handle.read()))
            if count:
                counts[os.path.relpath(path, os.path.dirname(STATIC)).replace(os.sep, "/")] = count
    return counts


def test_inline_handlers_never_increase():
    current = _current_counts()
    grew = {f: (BASELINE.get(f, 0), n) for f, n in current.items() if n > BASELINE.get(f, 0)}
    assert not grew, (
        "inline handler 只准減少、不准新增（新按鈕請用 data-action / addEventListener）：\n"
        + "\n".join(f"{f}: 基準 {old} → 現在 {new}" for f, (old, new) in sorted(grew.items()))
    )


def test_inline_handler_baseline_is_not_stale():
    """遷移掉的 handler 要同步調降基準，避免之後又被悄悄加回來。"""
    current = _current_counts()
    stale = {f: (n, current.get(f, 0)) for f, n in BASELINE.items() if current.get(f, 0) < n}
    assert not stale, (
        "已減少 inline handler，請調降 BASELINE：\n"
        + "\n".join(f"{f}: 基準 {old} → 現在 {new}" for f, (old, new) in sorted(stale.items()))
    )


def test_no_dynamic_inline_handler_attributes():
    """setAttribute('onclick', …) 等於動態寫 inline handler，一樣要靠 window 命名空間；改設 data-action。"""
    pattern = re.compile(r"setAttribute\(\s*['\"]on\w+['\"]")
    offenders = []
    for base, _dirs, files in os.walk(STATIC):
        if "dist" in base.split(os.sep) or "vendor" in base.split(os.sep):
            continue
        for name in files:
            if name.endswith(".js") and pattern.search(open(os.path.join(base, name), encoding="utf-8").read()):
                offenders.append(name)
    assert not offenders, f"這些檔案用 setAttribute('on…') 動態寫 inline handler：{offenders}"
