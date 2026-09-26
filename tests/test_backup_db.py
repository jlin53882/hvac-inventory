# -*- coding: utf-8 -*-
"""scripts/backup_db.py 每日資料庫備份回歸測試（2026-09 B10）。"""
import os
import sqlite3
import sys
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import backup_db  # noqa: E402

MONITOR_PS1 = ROOT / "scripts" / "monitor.ps1"


def _wal_db(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("CREATE TABLE t (v TEXT)")
    conn.execute("INSERT INTO t VALUES ('committed')")
    conn.commit()
    return conn


def test_backup_copies_committed_data_while_server_connection_open(tmp_path):
    live = _wal_db(tmp_path / "inventory.db")
    try:
        live.execute("INSERT INTO t VALUES ('uncommitted')")   # 模擬 server 交易進行中
        target = backup_db.backup_database(tmp_path / "inventory.db", tmp_path / "backups")
    finally:
        live.rollback()
        live.close()
    copy = sqlite3.connect(target)
    try:
        assert [r[0] for r in copy.execute("SELECT v FROM t")] == ["committed"]
    finally:
        copy.close()
    assert sorted(p.name for p in (tmp_path / "backups").iterdir()) == ["inventory.db"]   # 只保留 1 份、無暫存殘留


def test_backup_replaces_previous_copy_atomically(tmp_path):
    _wal_db(tmp_path / "inventory.db").close()
    backup_dir = tmp_path / "backups"
    backup_db.backup_database(tmp_path / "inventory.db", backup_dir)
    conn = sqlite3.connect(tmp_path / "inventory.db")
    conn.execute("INSERT INTO t VALUES ('second')")
    conn.commit()
    conn.close()
    target = backup_db.backup_database(tmp_path / "inventory.db", backup_dir)
    copy = sqlite3.connect(target)
    try:
        assert copy.execute("SELECT COUNT(*) FROM t").fetchone()[0] == 2
    finally:
        copy.close()


def test_failed_backup_keeps_previous_copy(tmp_path, monkeypatch):
    _wal_db(tmp_path / "inventory.db").close()
    backup_dir = tmp_path / "backups"
    target = backup_db.backup_database(tmp_path / "inventory.db", backup_dir)
    before = target.read_bytes()

    def broken_replace(src, dst):
        raise OSError("disk full")

    monkeypatch.setattr(backup_db.os, "replace", broken_replace)
    with pytest.raises(OSError):
        backup_db.backup_database(tmp_path / "inventory.db", backup_dir)
    assert target.read_bytes() == before
    assert sorted(p.name for p in backup_dir.iterdir()) == ["inventory.db"]


def test_main_skips_fresh_backup_and_reports_failure(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(backup_db, "BACKUP_DIR", tmp_path / "backups")
    monkeypatch.setattr(backup_db.app_config, "DB_PATH", str(tmp_path / "missing.db"))
    assert backup_db.main([]) == 1
    assert "資料庫備份失敗" in capsys.readouterr().err

    _wal_db(tmp_path / "inventory.db").close()
    monkeypatch.setattr(backup_db.app_config, "DB_PATH", str(tmp_path / "inventory.db"))
    assert backup_db.main(["--if-older-than-hours", "24"]) == 0
    assert "備份完成" in capsys.readouterr().out
    assert backup_db.main(["--if-older-than-hours", "24"]) == 0
    assert "略過" in capsys.readouterr().out
    old = time.time() - 25 * 3600
    os.utime(tmp_path / "backups" / "inventory.db", (old, old))
    assert backup_db.main(["--if-older-than-hours", "24"]) == 0
    assert "備份完成" in capsys.readouterr().out


def test_monitor_runs_daily_backup_and_notifies_once_on_failure():
    source = MONITOR_PS1.read_text(encoding="utf-8-sig")
    assert "backup_db.py" in source
    assert "--if-older-than-hours $BACKUP_EVERY_HOURS" in source
    assert "$BACKUP_EVERY_HOURS = 24" in source
    assert "Invoke-DailyBackup $s $now" in source
    assert "backup_notified" in source
    assert "資料庫備份失敗" in source
