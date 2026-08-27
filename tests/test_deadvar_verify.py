# -*- coding: utf-8 -*-
"""
防回歸測試（2026-08-28 稽核修復後）：確認已刪除的 dead variable 不再復活。

背景：稽核發現 D1 `added`（gcal_keys.py）、D2 `old_map_keys`（appointments.py）
為 assigned-but-never-read 死變數，已於 2026-08-28 刪除。此檔改為「不存在」
防回歸斷言——若未來有人又加回死計數器/死集，測試立即紅。

（原稽核驗證測試 test_deadvar_verify.py 斷言「bug 存在」，完成使命後改寫為
  防回歸版本，避免殘留「斷言已修復 bug 存在」的矛盾測試。）
"""
import os
import re
import subprocess

import pytest

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _git_show_head(rel_path: str) -> str:
    """讀取 current HEAD 的檔內容（防回歸與 working tree 是否 commit 無關，以 HEAD 為準）。"""
    r = subprocess.run(
        ["git", "show", f"HEAD:{rel_path}"],
        cwd=REPO, capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    assert r.returncode == 0, f"git show HEAD:{rel_path} 失敗: {r.stderr}"
    return r.stdout


@pytest.fixture(scope="module")
def head_gcal_keys():
    return _git_show_head("app/routes/gcal_keys.py")


@pytest.fixture(scope="module")
def head_appointments():
    return _git_show_head("app/routes/appointments.py")


def test_d1_added_removed_no_dead_counter(head_gcal_keys):
    """D1 防回歸：_backfill_all_appointments 不得再有 `added` 死計數器。

    此函式只做 INSERT … ON CONFLICT 回填 sync_queue，不需計數器。
    若有人加回 `added = 0`/`added += 1`（寫了沒用）→ 測試紅。
    """
    assert "added = 0" not in head_gcal_keys, "gcal_keys.py 又出現 added=0 死計數器！"
    assert "added += 1" not in head_gcal_keys, "gcal_keys.py 又出現 added 累加死碼！"


def test_d2_old_map_keys_removed_no_dead_set(head_appointments):
    """D2 防回歸：update_appointment 不得再有 `old_map_keys` 死集。

    孤兒偵測直接迭代 map_rows_all（`for mr in map_rows_all`），不需另外建集合。
    """
    assert "old_map_keys" not in head_appointments, "appointments.py 又出現 old_map_keys 死變數！"
    # 既有迭代邏輯應保留（證明刪 set 不影響孤兒偵測）
    assert re.search(r"for mr in map_rows_all", head_appointments)