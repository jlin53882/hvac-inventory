#!/usr/bin/env python3
"""將既有 uploads/<item_id>.jpg 導入 file_assets metadata。

預設只列出待處理數量；加 --apply 才會寫入 DB 與產生 thumbnail/original。
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import app.config as app_config
from app.database import get_db, init_db
from app.services.file_storage import cleanup_asset_paths, get_owner_asset, store_asset


def find_legacy_photos(upload_dir: Path) -> list[tuple[int, Path]]:
    result = []
    for path in sorted(upload_dir.glob("*.jpg")):
        if path.stem.isdigit() and path.is_file():
            result.append((int(path.stem), path))
    return result


def backfill(apply: bool = False, limit: int | None = None) -> dict:
    init_db()
    candidates = find_legacy_photos(Path(app_config.UPLOAD_DIR))
    conn = get_db()
    processed = skipped = failed = 0
    errors = []
    try:
        for item_id, path in candidates[:limit] if limit else candidates:
            existing = get_owner_asset(conn, "item_photo", "item", item_id)
            if existing:
                skipped += 1
                continue
            row = conn.execute(
                "SELECT id FROM items WHERE id=? AND is_deleted=0", (item_id,)
            ).fetchone()
            if row is None:
                skipped += 1
                continue
            if not apply:
                processed += 1
                continue
            asset = None
            try:
                asset = store_asset(
                    conn,
                    category="item_photo",
                    owner_type="item",
                    owner_id=item_id,
                    data=path.read_bytes(),
                    original_name=path.name,
                    mime_type="image/jpeg",
                    legacy_preview_path=path.name,
                )
                conn.commit()
                processed += 1
            except Exception as exc:
                conn.rollback()
                if asset:
                    cleanup_asset_paths(asset)
                failed += 1
                errors.append({"item_id": item_id, "error": str(exc)})
        if not apply:
            conn.rollback()
    finally:
        conn.close()
    return {
        "apply": apply,
        "candidates": len(candidates),
        "processed": processed,
        "skipped": skipped,
        "failed": failed,
        "errors": errors,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="實際寫入 metadata 與變體檔案")
    parser.add_argument("--limit", type=int, default=None, help="最多處理幾張")
    args = parser.parse_args()
    print(json.dumps(backfill(apply=args.apply, limit=args.limit), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
