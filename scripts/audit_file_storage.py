#!/usr/bin/env python3
"""檢查 file_assets metadata、原始檔 SHA-256 與 uploads 孤兒檔。"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import app.config as app_config
from app.database import get_db, init_db


def audit() -> dict:
    init_db()
    root = Path(app_config.UPLOAD_DIR).resolve()
    conn = get_db()
    missing = []
    checksum_mismatch = []
    referenced = set()
    try:
        rows = conn.execute("SELECT * FROM file_assets ORDER BY created_at, asset_id").fetchall()
        for row in rows:
            for column in ("original_path", "preview_path", "thumbnail_path"):
                relative = row[column]
                if not relative:
                    continue
                path = (root / relative).resolve()
                if root != path and root not in path.parents:
                    missing.append({"asset_id": row["asset_id"], "path": relative, "reason": "outside_root"})
                    continue
                referenced.add(path)
                if not path.exists():
                    missing.append({"asset_id": row["asset_id"], "path": relative, "reason": "missing"})
            original = (root / row["original_path"]).resolve()
            if original.exists():
                digest = hashlib.sha256(original.read_bytes()).hexdigest()
                if digest != row["sha256"]:
                    checksum_mismatch.append({"asset_id": row["asset_id"], "path": row["original_path"]})
        actual = {path.resolve() for path in root.rglob("*") if path.is_file()}
        orphan_files = sorted(str(path.relative_to(root)).replace("\\", "/") for path in actual - referenced)
        return {
            "assets": len(rows),
            "missing": missing,
            "checksum_mismatch": checksum_mismatch,
            "orphan_files": orphan_files,
            "ok": not missing and not checksum_mismatch and not orphan_files,
        }
    finally:
        conn.close()


if __name__ == "__main__":
    print(json.dumps(audit(), ensure_ascii=False, indent=2))
