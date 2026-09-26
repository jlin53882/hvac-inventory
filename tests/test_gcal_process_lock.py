# -*- coding: utf-8 -*-
"""GCal 跨 process 鎖（_named_process_lock）回歸測試。

背景：master e7a716b 的 Windows CI 偶發
``OSError: [Errno 36] Resource deadlock avoided``：
1. msvcrt.locking(LK_LOCK) 拿不到鎖時只重試 10 次（約 10 秒）就放棄；
2. 鎖檔放在 %TEMP%/hvac-gcal-sync-locks，所有資料庫（含平行測試 worker）共用同一個 key-1.lock。
"""
import os
import threading
import time

import pytest
from fastapi.testclient import TestClient

import app.database as app_db
import main as app_main
from app.services import gcal_sync


def _hold_lock_in_thread(name: str, release: threading.Event):
    """在背景執行緒以目前的 app.database.DB_PATH 取得鎖，持有到 release 被設定。"""
    acquired = threading.Event()
    errors = []

    def worker():
        try:
            with gcal_sync._named_process_lock(name):
                acquired.set()
                release.wait(30)
        except Exception as exc:  # pragma: no cover - 失敗時由 assert errors 呈現
            errors.append(exc)
            acquired.set()

    thread = threading.Thread(target=worker, daemon=True)
    thread.start()
    assert acquired.wait(10)
    assert not errors
    return thread


def _acquire_in_thread(name: str):
    """背景嘗試取得鎖，回傳 (thread, result)；result['ok'] 表示取得後已釋放。"""
    result = {}

    def worker():
        try:
            with gcal_sync._named_process_lock(name):
                result["ok"] = True
        except Exception as exc:
            result["error"] = exc

    thread = threading.Thread(target=worker, daemon=True)
    thread.start()
    return thread, result


def test_locks_for_different_databases_do_not_contend(tmp_path, monkeypatch):
    """不同資料庫的同名鎖（例如平行測試 worker 都有 key 1）不可互相等待。"""
    release = threading.Event()
    monkeypatch.setattr(app_db, "DB_PATH", str(tmp_path / "a" / "inventory.db"))
    holder = _hold_lock_in_thread("key-1", release)
    try:
        monkeypatch.setattr(app_db, "DB_PATH", str(tmp_path / "b" / "inventory.db"))
        thread, result = _acquire_in_thread("key-1")
        thread.join(2)
        assert result.get("ok"), "另一個資料庫的 key-1 鎖被擋住了（鎖檔被不同資料庫共用）"
    finally:
        release.set()
        holder.join(10)
        thread.join(10)


def test_same_database_lock_still_excludes_and_times_out_clearly(tmp_path, monkeypatch):
    """同一資料庫仍互斥；等超過上限時拋 GcalLockTimeout（明確錯誤，而非 OSError）。"""
    monkeypatch.setattr(app_db, "DB_PATH", str(tmp_path / "inventory.db"))
    monkeypatch.setattr(gcal_sync, "LOCK_WAIT_TIMEOUT_SECONDS", 0.3)
    release = threading.Event()
    holder = _hold_lock_in_thread("key-7", release)
    try:
        with pytest.raises(gcal_sync.GcalLockTimeout):
            with gcal_sync._named_process_lock("key-7"):
                pass
    finally:
        release.set()
        holder.join(10)
    with gcal_sync._named_process_lock("key-7"):
        pass   # 持有者釋放後即可取得


def test_waits_beyond_windows_ten_second_limit(tmp_path, monkeypatch):
    """模擬鎖被佔用 15 秒（超過舊版 Windows 約 10 秒上限）：應持續等待後成功，而非拋錯。"""
    clock = {"now": 0.0}
    attempts = []
    monkeypatch.setattr(gcal_sync.time, "monotonic", lambda: clock["now"])
    monkeypatch.setattr(gcal_sync.time, "sleep", lambda seconds: clock.__setitem__("now", clock["now"] + seconds))

    def busy_for_15_seconds(handle):
        attempts.append(clock["now"])
        return clock["now"] >= 15

    monkeypatch.setattr(gcal_sync, "_try_lock_file", busy_for_15_seconds)
    monkeypatch.setattr(gcal_sync, "_unlock_file", lambda handle: None)
    monkeypatch.setattr(app_db, "DB_PATH", str(tmp_path / "inventory.db"))
    with gcal_sync._named_process_lock("key-1"):
        pass
    assert clock["now"] >= 15 and len(attempts) > 2
    assert clock["now"] < gcal_sync.LOCK_WAIT_TIMEOUT_SECONDS


def test_gives_up_with_timeout_error_after_limit(tmp_path, monkeypatch):
    clock = {"now": 0.0}
    monkeypatch.setattr(gcal_sync.time, "monotonic", lambda: clock["now"])
    monkeypatch.setattr(gcal_sync.time, "sleep", lambda seconds: clock.__setitem__("now", clock["now"] + seconds))
    monkeypatch.setattr(gcal_sync, "_try_lock_file", lambda handle: False)
    monkeypatch.setattr(app_db, "DB_PATH", str(tmp_path / "inventory.db"))
    with pytest.raises(gcal_sync.GcalLockTimeout, match="key-9"):
        with gcal_sync._named_process_lock("key-9"):
            pass
    assert gcal_sync.LOCK_WAIT_TIMEOUT_SECONDS <= clock["now"] < gcal_sync.LOCK_WAIT_TIMEOUT_SECONDS + 1


@pytest.mark.skipif(os.name != "nt", reason="msvcrt 鎖行為只存在於 Windows；其他平台由 fake clock 測試涵蓋")
def test_windows_real_lock_held_longer_than_ten_seconds(tmp_path, monkeypatch):
    """Windows 實機：鎖被持有約 11 秒，另一個取鎖者不可因 Errno 36 失敗。"""
    monkeypatch.setattr(app_db, "DB_PATH", str(tmp_path / "inventory.db"))
    release = threading.Event()
    holder = _hold_lock_in_thread("key-1", release)
    thread, result = _acquire_in_thread("key-1")
    time.sleep(11)
    release.set()
    holder.join(10)
    thread.join(30)
    assert "error" not in result, result.get("error")
    assert result.get("ok")


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(app_db, "DB_PATH", str(tmp_path / "gcal_lock.db"))
    app_db.init_db()
    from app.services.auth import SESSION_COOKIE, create_session, init_admin_if_missing
    conn = app_db.get_db()
    try:
        init_admin_if_missing(conn)
        token = create_session(conn, conn.execute("SELECT id FROM users WHERE username='admin'").fetchone()["id"])
    finally:
        conn.close()
    with TestClient(app_main.app) as c:
        c.cookies.set(SESSION_COOKIE, token)
        yield c


def test_key_routes_return_503_when_sync_holds_lock_too_long(client, monkeypatch):
    """背景同步長時間持有 key 鎖時，更新/刪除 key 回 503 與明確訊息，而不是 500。"""
    from contextlib import contextmanager

    @contextmanager
    def busy_lock(key_id):
        raise gcal_sync.GcalLockTimeout(f"key-{key_id}")
        yield  # pragma: no cover

    monkeypatch.setattr(gcal_sync, "_key_process_lock", busy_lock)
    for response in (
        client.put("/api/gcal-keys/1", json={"name": "x"}),
        client.delete("/api/gcal-keys/1"),
    ):
        assert response.status_code == 503, response.text
        assert "稍後再試" in response.json()["detail"]
