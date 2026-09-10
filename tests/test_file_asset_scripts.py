"""file_assets 維護腳本的 dry-run、導入與完整性稽核測試。"""

import io

import pytest
from PIL import Image

import app.config as app_config
import app.database as app_db
import scripts.audit_file_storage as audit_script
import scripts.backfill_file_assets as backfill_script


@pytest.fixture()
def asset_script_env(tmp_path, monkeypatch):
    """建立只供維護腳本使用的隔離 DB 與 uploads。"""
    db_path = tmp_path / "asset-scripts.db"
    upload_dir = tmp_path / "uploads"
    upload_dir.mkdir()
    monkeypatch.setattr(app_db, "DB_PATH", str(db_path))
    monkeypatch.setattr(app_config, "UPLOAD_DIR", str(upload_dir))
    app_db.init_db()
    return upload_dir


def _jpeg(width=1200, height=600):
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), (40, 120, 220)).save(buffer, "JPEG")
    return buffer.getvalue()


def _insert_item(item_id, *, is_deleted=0):
    conn = app_db.get_db()
    try:
        conn.execute(
            """
            INSERT INTO items (id, brand, code, name, unit, low_stock, site, is_deleted)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (item_id, "測試牌", f"ASSET-{item_id}", f"媒體品項{item_id}", "個", 0, "office", is_deleted),
        )
        conn.commit()
    finally:
        conn.close()


def test_find_legacy_photos_ignores_non_numeric_jpgs_and_directories(tmp_path):
    upload_dir = tmp_path / "uploads"
    upload_dir.mkdir()
    (upload_dir / "2.jpg").write_bytes(b"valid-candidate")
    (upload_dir / "not-an-id.jpg").write_bytes(b"ignored")
    (upload_dir / "3.png").write_bytes(b"ignored")
    (upload_dir / "4.jpg").mkdir()

    result = backfill_script.find_legacy_photos(upload_dir)

    assert [(item_id, path.name) for item_id, path in result] == [(2, "2.jpg")]


def test_backfill_dry_run_apply_and_repeat_are_safe(asset_script_env):
    _insert_item(1)
    _insert_item(2, is_deleted=1)
    (asset_script_env / "1.jpg").write_bytes(_jpeg())
    (asset_script_env / "2.jpg").write_bytes(_jpeg(400, 200))
    (asset_script_env / "3.jpg").write_bytes(_jpeg(300, 150))
    legacy_bytes = (asset_script_env / "1.jpg").read_bytes()

    dry_run = backfill_script.backfill()

    assert dry_run == {
        "apply": False,
        "candidates": 3,
        "processed": 1,
        "skipped": 2,
        "failed": 0,
        "errors": [],
    }
    conn = app_db.get_db()
    try:
        assert conn.execute("SELECT COUNT(*) FROM file_assets").fetchone()[0] == 0
    finally:
        conn.close()
    assert (asset_script_env / "1.jpg").read_bytes() == legacy_bytes

    applied = backfill_script.backfill(apply=True)

    assert applied["apply"] is True
    assert applied["candidates"] == 3
    assert applied["processed"] == 1
    assert applied["skipped"] == 2
    assert applied["failed"] == 0
    assert applied["errors"] == []
    conn = app_db.get_db()
    try:
        row = conn.execute(
            "SELECT * FROM file_assets WHERE category='item_photo' AND owner_id='1'"
        ).fetchone()
    finally:
        conn.close()
    assert row is not None
    original_path = asset_script_env / row["original_path"]
    preview_path = asset_script_env / row["preview_path"]
    thumbnail_path = asset_script_env / row["thumbnail_path"]
    assert original_path.exists()
    assert preview_path.exists()
    assert thumbnail_path.exists()
    assert original_path.read_bytes() == legacy_bytes
    assert row["thumbnail_path"] != "1.jpg"
    with Image.open(thumbnail_path) as thumbnail:
        assert thumbnail.format == "JPEG"
        assert thumbnail.width == 320
    audit_after_apply = audit_script.audit()
    assert audit_after_apply["ok"] is False
    assert {"2.jpg", "3.jpg"}.issubset(set(audit_after_apply["orphan_files"]))
    (asset_script_env / "2.jpg").unlink()
    (asset_script_env / "3.jpg").unlink()
    assert audit_script.audit()["ok"] is True

    repeated = backfill_script.backfill(apply=True)
    assert repeated["processed"] == 0
    assert repeated["skipped"] == 1
    assert repeated["failed"] == 0


def test_audit_reports_checksum_mismatch_and_orphan_file(asset_script_env):
    _insert_item(1)
    (asset_script_env / "1.jpg").write_bytes(_jpeg())
    assert backfill_script.backfill(apply=True)["failed"] == 0

    conn = app_db.get_db()
    try:
        row = conn.execute(
            "SELECT original_path FROM file_assets WHERE owner_id='1'"
        ).fetchone()
    finally:
        conn.close()
    (asset_script_env / row["original_path"]).write_bytes(b"tampered")
    (asset_script_env / "orphan.bin").write_bytes(b"orphan")

    result = audit_script.audit()

    assert result["ok"] is False
    assert len(result["checksum_mismatch"]) == 1
    assert result["checksum_mismatch"][0]["path"] == row["original_path"]
    assert "orphan.bin" in result["orphan_files"]


def test_audit_reports_missing_file_and_outside_root_metadata(asset_script_env):
    _insert_item(1)
    (asset_script_env / "1.jpg").write_bytes(_jpeg())
    assert backfill_script.backfill(apply=True)["failed"] == 0

    conn = app_db.get_db()
    try:
        row = conn.execute(
            "SELECT asset_id, original_path FROM file_assets WHERE owner_id='1'"
        ).fetchone()
        (asset_script_env / row["original_path"]).unlink()
        outside_original = asset_script_env.parent / "outside-original.jpg"
        outside_original.write_bytes(b"outside-original")
        conn.execute(
            """
            UPDATE file_assets
            SET original_path='../outside-original.jpg',
                preview_path='../outside-preview.jpg',
                thumbnail_path='missing-thumbnail.jpg'
            WHERE asset_id=?
            """,
            (row["asset_id"],),
        )
        conn.commit()
    finally:
        conn.close()

    result = audit_script.audit()

    assert result["ok"] is False
    assert result["checksum_mismatch"] == []
    assert any(entry["reason"] == "missing" for entry in result["missing"])
    assert any(entry["reason"] == "outside_root" for entry in result["missing"])
