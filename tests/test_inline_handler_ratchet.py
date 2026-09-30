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


# ---- DOM property handler（`el.onclick = …`）----
# 不是 HTML 屬性，上面的 inline handler 守衛看不到；但事件架構已統一為 data-action + createActionDelegate，
# 所以新的 property handler 一律不准，現有的只准減少。下列是尚未遷移、且各有用途的舊寫法（動態建立的一次性 DOM 節點 /
# 只綁在單一元素上的事件），遷移後請從這裡刪掉。
PROPERTY_HANDLER = re.compile(r"\.on(?:click|change|input|submit|keydown|keyup)\s*=(?!=)")
PROPERTY_HANDLER_BASELINE = {
    "static/js/core/units.js": 2,                        # 單位快速新增的臨時輸入框（確定 / 取消）
    "static/js/features/calendar/view.js": 1,
    "static/js/features/inventory/photo.js": 1,          # 照片大圖 overlay：點照片本身不關閉
    "static/js/features/stockout/modals.js": 1,          # kit-prepare 送出鈕綁定當下的整組 id
    "static/js/features/upload-list/upload-list.js": 1,  # 預覽 modal 的下載鈕
    "static/js/features/work-progress/detail.js": 1,     # 動態 file input 的 change
}


def _property_handler_counts() -> dict:
    counts = {}
    for base, _dirs, files in os.walk(STATIC):
        if "dist" in base.split(os.sep) or "vendor" in base.split(os.sep):
            continue
        for name in files:
            if not name.endswith(".js"):
                continue
            path = os.path.join(base, name)
            with open(path, encoding="utf-8") as handle:
                count = len(PROPERTY_HANDLER.findall(handle.read()))
            if count:
                counts[os.path.relpath(path, os.path.dirname(STATIC)).replace(os.sep, "/")] = count
    return counts


def test_property_handlers_never_increase():
    """`el.onclick = …` 只准減少；filters.js 的 filter chips 已改走 inventory-brand/category-toggle 委派，基準為 0。"""
    current = _property_handler_counts()
    grew = {f: (PROPERTY_HANDLER_BASELINE.get(f, 0), n) for f, n in current.items() if n > PROPERTY_HANDLER_BASELINE.get(f, 0)}
    assert not grew, (
        "不要用 el.onclick = … 綁事件（請用 data-action + createActionDelegate）：\n"
        + "\n".join(f"{f}: 基準 {old} → 現在 {new}" for f, (old, new) in sorted(grew.items()))
    )
    stale = {f: (n, current.get(f, 0)) for f, n in PROPERTY_HANDLER_BASELINE.items() if current.get(f, 0) < n}
    assert not stale, (
        "已減少 property handler，請調降 PROPERTY_HANDLER_BASELINE：\n"
        + "\n".join(f"{f}: 基準 {old} → 現在 {new}" for f, (old, new) in sorted(stale.items()))
    )
