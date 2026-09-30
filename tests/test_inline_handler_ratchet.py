# -*- coding: utf-8 -*-
"""inline event handler（onclick= 等）棘輪守衛。

現況：畫面的按鈕事件大量寫成 inline handler（HTML 與 JS 模板字串），需要把函式掛到 window 命名空間才能呼叫，
每新增一個按鈕要改「HTML、模組 export、window.X = {…}」三處，漏一處只有點擊時才會發現。
長期方向是改成 data-action + 事件委派；整批遷移風險高，所以先用棘輪鎖住：

- 每個檔案的 inline handler 數量只准減少、不准增加
- 新檔案一律不得使用 inline handler
- 遷移完某個檔案後，請把 BASELINE 裡的數字改小（或刪掉該行）——測試會要求同步，避免基準腐爛
"""
import os
import re

from frontend_test_support import STATIC

INLINE_HANDLER = re.compile(r"\son(?:click|change|input|submit|keydown|keyup|blur|focus)=")

# 現況基準（2026-09-30 量測）：檔案 → inline handler 數量
BASELINE = {
    "static/index.html": 106,
    "static/js/components/card.js": 4,
    "static/js/components/status-list.js": 4,
    "static/js/features/calendar/appt-modal.js": 8,
    "static/js/features/calendar/page.js": 12,
    "static/js/features/calendar/search.js": 7,
    "static/js/features/calendar/settings-modal.js": 8,
    "static/js/features/calendar/view.js": 6,
    "static/js/features/inventory/actions.js": 2,
    "static/js/features/inventory/add-modal.js": 1,
    "static/js/features/inventory/edit-modal.js": 2,
    "static/js/features/inventory/filters.js": 4,
    "static/js/features/inventory/list.js": 28,
    "static/js/features/inventory/location-adjustments.js": 1,
    "static/js/features/inventory/photo.js": 17,
    "static/js/features/inventory/status.js": 2,
    "static/js/features/kits/component-rows.js": 5,
    "static/js/features/kits/kit-modal.js": 1,
    "static/js/features/kits/page.js": 18,
    "static/js/features/kits/status.js": 1,
    "static/js/features/permissions/page.js": 17,
    "static/js/features/petty-cash/engineering-modal.js": 27,
    "static/js/features/petty-cash/page.js": 21,
    "static/js/features/petty-cash/report-modal.js": 30,
    "static/js/features/prepared/page.js": 14,
    "static/js/features/quotation/mode-tabs.js": 2,
    "static/js/features/quotation/page.js": 13,
    "static/js/features/settings/cabinets.js": 2,
    "static/js/features/settings/gcal.js": 17,
    "static/js/features/settings/page.js": 1,
    "static/js/features/settings/petty-options.js": 2,
    "static/js/features/settings/units.js": 9,
    "static/js/features/stockout/modals.js": 1,
    "static/js/features/stockout/page.js": 1,
    "static/js/features/stocktake/page.js": 10,
    "static/js/features/upload-list/upload-list.js": 24,
    "static/js/features/work-progress/day.js": 1,
    "static/js/features/work-progress/detail.js": 9,
    "static/js/features/work-progress/draft.js": 2,
    "static/js/features/work-progress/gallery.js": 6,
    "static/js/features/work-progress/history.js": 2,
    "static/js/features/work-progress/page.js": 16,
    "static/js/features/work-progress/pending-photos.js": 3,
    "static/permissions.html": 15,
    "static/settings.html": 20,
}


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
