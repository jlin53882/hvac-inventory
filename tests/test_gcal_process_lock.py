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


# ========== Hardening：DB lock namespace 以 canonical physical path 計算 ==========


def _lock_dir_for(monkeypatch, db_path) -> str:
    monkeypatch.setattr(app_db, "DB_PATH", str(db_path))
    return str(gcal_sync._lock_dir())


def test_lock_namespace_same_for_symlink_alias_of_same_db(tmp_path, monkeypatch):
    """同一實體 DB 經 symlink/junction 別名存取時，必須落在同一個跨 process 鎖域。"""
    real_dir = tmp_path / "real"
    real_dir.mkdir()
    (real_dir / "inventory.db").write_bytes(b"")
    alias_dir = tmp_path / "alias"
    try:
        os.symlink(real_dir, alias_dir, target_is_directory=True)
    except (OSError, NotImplementedError) as exc:
        pytest.skip(f"此環境無法建立目錄 symlink（{exc}）；由 monkeypatch 測試涵蓋 realpath contract")
    assert _lock_dir_for(monkeypatch, alias_dir / "inventory.db") == _lock_dir_for(monkeypatch, real_dir / "inventory.db")
    assert _lock_dir_for(monkeypatch, alias_dir / ".." / "real" / "inventory.db") == _lock_dir_for(monkeypatch, real_dir / "inventory.db")


def test_lock_namespace_resolves_realpath_contract(tmp_path, monkeypatch):
    """平台無關：_lock_dir 必須經過 os.path.realpath（模擬 junction 等無法在 CI 建立的別名）。"""
    real = str(tmp_path / "real" / "inventory.db")
    alias = str(tmp_path / "junction" / "inventory.db")
    real_realpath = os.path.realpath

    def fake_realpath(path, *args, **kwargs):
        if os.path.normcase(os.path.abspath(path)) == os.path.normcase(os.path.abspath(alias)):
            return real
        return real_realpath(path, *args, **kwargs)

    monkeypatch.setattr(gcal_sync.os.path, "realpath", fake_realpath)
    assert _lock_dir_for(monkeypatch, alias) == _lock_dir_for(monkeypatch, real)


def test_lock_namespace_differs_for_different_physical_dbs(tmp_path, monkeypatch):
    first = _lock_dir_for(monkeypatch, tmp_path / "a" / "inventory.db")
    second = _lock_dir_for(monkeypatch, tmp_path / "b" / "inventory.db")
    assert first != second
    assert os.path.dirname(first) == os.path.dirname(second)   # 同一個上層目錄，只以 DB 雜湊區分


# ========== Hardening：真正的跨 process 互斥 contract（subprocess，非 thread） ==========

import queue
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HANDSHAKE_TIMEOUT = 60   # 單次等待上限；只在失敗時才會等滿，避免 CI 永久卡住

# 子 process：設定 DB_PATH 與取鎖上限 → 取鎖 → 以 stdout 回報 → 等 parent 從 stdin 送 RELEASE 才釋放。
_CHILD_CODE = r"""
import sys
import app.database as app_database
from app.services import gcal_sync

db_path, lock_name, timeout = sys.argv[1], sys.argv[2], float(sys.argv[3])
app_database.DB_PATH = db_path
gcal_sync.LOCK_WAIT_TIMEOUT_SECONDS = timeout
print("ATTEMPTING", flush=True)
try:
    with gcal_sync._named_process_lock(lock_name):
        print("LOCK_ACQUIRED", flush=True)
        sys.stdin.readline()
    print("RELEASED", flush=True)
except gcal_sync.GcalLockTimeout:
    print("TIMEOUT", flush=True)
"""


class _LockChild:
    """包裝一個持鎖子 process；stdout 由背景執行緒讀入 queue，stderr 寫入 tmp 檔避免 pipe 塞滿。"""

    def __init__(self, db_path, stderr_path, lock_name="key-1", timeout=60.0):
        env = dict(os.environ)
        env["PYTHONPATH"] = str(ROOT) + os.pathsep + env.get("PYTHONPATH", "")
        self._stderr = open(stderr_path, "w", encoding="utf-8")
        self.proc = subprocess.Popen(
            [sys.executable, "-c", _CHILD_CODE, str(db_path), lock_name, str(timeout)],
            cwd=str(ROOT), env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=self._stderr, text=True, encoding="utf-8",
        )
        self.stderr_path = stderr_path
        self.lines: "queue.Queue[str | None]" = queue.Queue()
        self.seen: list[str] = []
        threading.Thread(target=self._pump, daemon=True).start()

    def _pump(self):
        for line in self.proc.stdout:
            self.lines.put(line.strip())
        self.lines.put(None)

    def _take(self, block, timeout=None):
        line = self.lines.get(block=block, timeout=timeout)
        if line is not None:
            self.seen.append(line)
        return line

    def expect(self, token, timeout=HANDSHAKE_TIMEOUT):
        deadline = time.monotonic() + timeout
        while token not in self.seen:
            remaining = deadline - time.monotonic()
            try:
                line = self._take(True, max(remaining, 0.01)) if remaining > 0 else None
            except queue.Empty:
                line = None
            if line is None and (remaining <= 0 or self.proc.poll() is not None):
                raise AssertionError(
                    f"等不到 {token}；目前輸出 {self.seen}；stderr：\n"
                    + Path(self.stderr_path).read_text(encoding="utf-8")[-2000:]
                )

    def drain(self):
        while True:
            try:
                if self._take(False) is None:
                    break
            except queue.Empty:
                break
        return list(self.seen)

    def release(self):
        self.proc.stdin.write("RELEASE\n")
        self.proc.stdin.flush()

    def close(self):
        if self.proc.poll() is None:
            self.proc.kill()
        try:
            self.proc.wait(timeout=10)
        finally:
            for stream in (self.proc.stdin, self.proc.stdout):
                try:
                    stream.close()
                except OSError:
                    pass
            self._stderr.close()


@pytest.fixture
def spawn_lock_child(tmp_path):
    children = []

    def spawn(db_path, **kwargs):
        child = _LockChild(db_path, tmp_path / f"child-{len(children)}.stderr", **kwargs)
        children.append(child)
        return child

    yield spawn
    for child in children:
        child.close()


def test_subprocess_same_db_same_lock_is_mutually_exclusive(tmp_path, spawn_lock_child):
    """A 持有 db_a/key-1 時，另一個 OS process 的 B 不能取得；A 釋放後 B 必須取得。"""
    db = tmp_path / "db_a" / "inventory.db"
    holder = spawn_lock_child(db)
    holder.expect("LOCK_ACQUIRED")

    contender = spawn_lock_child(db)
    contender.expect("ATTEMPTING")
    # 第三個 process 以短上限探測：拿不到（TIMEOUT）即證明鎖在跨 process 間確實被持有；
    # 探測期間 contender 一直在輪詢，若互斥失效它必然已回報 LOCK_ACQUIRED。
    probe = spawn_lock_child(db, timeout=0.5)
    probe.expect("TIMEOUT")
    assert "LOCK_ACQUIRED" not in contender.drain(), "A 尚未釋放時 B 就取得了鎖"

    holder.release()
    holder.expect("RELEASED")
    contender.expect("LOCK_ACQUIRED")
    contender.release()
    contender.expect("RELEASED")


def test_subprocess_different_db_same_lock_do_not_block(tmp_path, spawn_lock_child):
    """db_a/key-1 與 db_b/key-1 是獨立同步域：A 持有期間，另一個 process 的 B 仍可立即取得。"""
    holder = spawn_lock_child(tmp_path / "db_a" / "inventory.db")
    holder.expect("LOCK_ACQUIRED")
    other = spawn_lock_child(tmp_path / "db_b" / "inventory.db", timeout=30)
    other.expect("LOCK_ACQUIRED")
    assert holder.proc.poll() is None and "RELEASED" not in holder.drain()   # A 仍持有
    other.release()
    other.expect("RELEASED")
    holder.release()
    holder.expect("RELEASED")
