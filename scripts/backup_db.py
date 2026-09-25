#!/usr/bin/env python3
"""每日備份 inventory.db（SQLite online backup API，server 運作中也可安全執行）。

只保留 1 份：backups/inventory.db。先寫暫存檔並通過 quick_check，才以 os.replace
原子替換舊備份，備份中途失敗不會毀掉前一份可用備份。

用法：
    python scripts/backup_db.py                          # 立即備份
    python scripts/backup_db.py --if-older-than-hours 24 # 既有備份未滿 24 小時則略過（monitor.ps1 每輪呼叫）

結束碼：0 = 已備份或略過；1 = 失敗。
"""

from __future__ import annotations

import argparse
import os
import sqlite3
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import app.config as app_config

BACKUP_DIR = ROOT / "backups"
BACKUP_NAME = "inventory.db"


def backup_is_fresh(target: Path, max_age_hours: float, now: float | None = None) -> bool:
    """既有備份是否仍在 max_age_hours 內。"""
    try:
        age = (time.time() if now is None else now) - target.stat().st_mtime
    except OSError:
        return False
    return age < max_age_hours * 3600


def backup_database(source: str | Path, backup_dir: str | Path) -> Path:
    """把 source 備份到 backup_dir/inventory.db（原子替換），回傳備份路徑。

    Raises:
        FileNotFoundError: 來源資料庫不存在。
        RuntimeError: 備份檔完整性檢查失敗。
        sqlite3.Error: 讀寫資料庫失敗。
    """
    source = Path(source)
    if not source.is_file():
        raise FileNotFoundError(f"找不到資料庫：{source}")
    backup_dir = Path(backup_dir)
    backup_dir.mkdir(parents=True, exist_ok=True)
    target = backup_dir / BACKUP_NAME
    temp = backup_dir / f".{BACKUP_NAME}.tmp-{os.getpid()}"
    try:
        # 一般連線即可（backup 只讀來源）；WAL 模式下唯讀 URI 在缺 -shm 時可能開不了。
        src = sqlite3.connect(source, timeout=30)
        try:
            dst = sqlite3.connect(temp)
            try:
                src.backup(dst)
                result = dst.execute("PRAGMA quick_check").fetchone()[0]
                if result != "ok":
                    raise RuntimeError(f"備份完整性檢查失敗：{result}")
            finally:
                dst.close()
        finally:
            src.close()
        os.replace(temp, target)
    finally:
        temp.unlink(missing_ok=True)
    return target


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="備份 inventory.db（只保留 1 份）")
    parser.add_argument("--if-older-than-hours", type=float, default=None,
                        help="既有備份未超過此時數則略過")
    args = parser.parse_args(argv)
    target = BACKUP_DIR / BACKUP_NAME
    if args.if_older_than_hours is not None and backup_is_fresh(target, args.if_older_than_hours):
        print(f"備份仍在 {args.if_older_than_hours:g} 小時內，略過：{target}")
        return 0
    try:
        path = backup_database(app_config.DB_PATH, BACKUP_DIR)
    except Exception as exc:  # noqa: BLE001 - CLI 需把任何失敗轉成結束碼給 monitor.ps1
        print(f"資料庫備份失敗：{type(exc).__name__}: {exc}", file=sys.stderr)
        return 1
    print(f"資料庫備份完成：{path}（{path.stat().st_size / 1024:.0f} KB）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
