"""統一檔案與圖片儲存服務。

所有新媒體都透過本模組建立 original / preview / thumbnail 的 metadata。
正式文件保留原始 bytes；只有可預覽圖片會額外產生 JPEG preview 與 thumbnail。
路徑一律以 uploads 根目錄為基準保存，DB 不儲存可控的絕對路徑。
"""

from __future__ import annotations

import hashlib
import io
import os
import re
import shutil
import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from PIL import Image, ImageOps

import app.config as app_config

MAX_IMAGE_PIXELS = 40_000_000
PREVIEW_WIDTH = 800
THUMBNAIL_WIDTH = 320
COMPRESSION_VERSION = "image-jpeg-v1"
_CATEGORY_RE = re.compile(r"^[a-z][a-z0-9_-]{0,63}$")
_MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tif", ".tiff"}
_MIME_BY_EXT = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
    ".pdf": "application/pdf",
}


@dataclass(frozen=True)
class Asset:
    asset_id: str
    original_path: str
    preview_path: str | None
    thumbnail_path: str | None
    original_size: int
    preview_size: int | None
    thumbnail_size: int | None
    sha256: str
    mime_type: str
    is_image: bool
    backup_paths: tuple[tuple[str, str], ...] = ()


def _uploads_root(upload_dir: str | Path | None = None) -> Path:
    root = Path(upload_dir or app_config.UPLOAD_DIR).resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def _safe_relative_path(relative: str, upload_dir: str | Path | None = None) -> Path:
    """將 DB 相對路徑解析到指定 uploads 內，拒絕 traversal。"""
    root = _uploads_root(upload_dir)
    path = (root / relative).resolve()
    if path != root and root not in path.parents:
        raise ValueError("檔案路徑超出 uploads 根目錄")
    return path


def _safe_ext(original_name: str) -> str:
    ext = Path(original_name or "").suffix.lower()
    if not re.fullmatch(r"\.[a-z0-9]{1,8}", ext):
        return ".bin"
    return ext


def _mime_for_name(original_name: str) -> str:
    """Use the allowlisted extension as the safe response MIME type."""
    return _MIME_BY_EXT.get(_safe_ext(original_name), "application/octet-stream")


def _validate_file_signature(ext: str, data: bytes) -> None:
    """Reject a non-PDF payload before it can be served as application/pdf."""
    if ext == ".pdf" and not data.startswith(b"%PDF-"):
        raise ValueError("無法解析 PDF")


def _validate_category(category: str) -> str:
    if not _CATEGORY_RE.fullmatch(category or ""):
        raise ValueError("不合法的媒體類別")
    return category


def _validate_month(year_month: str) -> str:
    if not _MONTH_RE.fullmatch(year_month or ""):
        raise ValueError("不合法的年月")
    return year_month


def _atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f".{path.name}.tmp-{uuid.uuid4().hex}")
    try:
        temp.write_bytes(data)
        os.replace(temp, path)
    except Exception:
        try:
            temp.unlink(missing_ok=True)
        except OSError:
            pass
        raise


def _write_with_backup(
    path: Path,
    data: bytes,
    backups: list[tuple[Path, Path]],
    written: list[Path],
) -> None:
    """Atomically write a path while retaining an existing target for rollback."""
    if path.exists():
        backup = path.with_name(f".{path.name}.bak-{uuid.uuid4().hex}")
        shutil.copy2(path, backup)
        backups.append((path, backup))
    _atomic_write(path, data)
    written.append(path)


def _restore_backups(backups: list[tuple[Path, Path]]) -> None:
    for target, backup in reversed(backups):
        try:
            if backup.exists():
                target.unlink(missing_ok=True)
                os.replace(backup, target)
        except OSError:
            pass


def _image_variants(data: bytes) -> tuple[bytes, bytes, int, int]:
    try:
        with Image.open(io.BytesIO(data)) as opened:
            if opened.width * opened.height > MAX_IMAGE_PIXELS:
                raise ValueError("圖片解析度過高")
            opened.load()
            image = ImageOps.exif_transpose(opened).convert("RGB")
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError("無法解析圖片") from exc

    preview = image.copy()
    if preview.width > PREVIEW_WIDTH:
        preview = preview.resize(
            (PREVIEW_WIDTH, int(preview.height * PREVIEW_WIDTH / preview.width)),
            Image.Resampling.LANCZOS,
        )
    thumbnail = image.copy()
    if thumbnail.width > THUMBNAIL_WIDTH:
        thumbnail = thumbnail.resize(
            (THUMBNAIL_WIDTH, int(thumbnail.height * THUMBNAIL_WIDTH / thumbnail.width)),
            Image.Resampling.LANCZOS,
        )

    preview_buf = io.BytesIO()
    thumbnail_buf = io.BytesIO()
    preview.save(preview_buf, "JPEG", quality=80, optimize=True)
    thumbnail.save(thumbnail_buf, "JPEG", quality=70, optimize=True)
    return preview_buf.getvalue(), thumbnail_buf.getvalue(), image.width, image.height


def store_asset(
    conn: Any,
    *,
    category: str,
    owner_type: str,
    owner_id: str | int,
    data: bytes,
    original_name: str,
    mime_type: str,
    year_month: str | None = None,
    legacy_original_path: str | None = None,
    legacy_preview_path: str | None = None,
    upload_dir: str | Path | None = None,
) -> Asset:
    """原子保存一個 asset 並在同一個 DB transaction 建立 metadata。

    `legacy_*_path` 僅供既有 URL/資料夾相容；新呼叫端不應依賴它。
    呼叫端應在 commit 失敗時呼叫 :func:`cleanup_asset_paths`。
    """
    category = _validate_category(category)
    year_month = _validate_month(year_month or datetime.now().strftime("%Y-%m"))
    if not data:
        raise ValueError("空檔案不可儲存")

    asset_id = uuid.uuid4().hex
    ext = _safe_ext(original_name)
    safe_mime = _mime_for_name(original_name)
    _validate_file_signature(ext, data)
    base = Path("assets") / category / year_month / asset_id
    original_rel = legacy_original_path or str(base / f"original{ext}").replace("\\", "/")
    preview_rel = legacy_preview_path
    thumbnail_rel = str(base / "thumbnail.jpg").replace("\\", "/")
    is_image = ext in _IMAGE_EXTS
    preview_data: bytes | None = None
    thumbnail_data: bytes | None = None
    width = height = None
    if is_image:
        preview_data, thumbnail_data, width, height = _image_variants(data)
        preview_rel = preview_rel or str(base / "preview.jpg").replace("\\", "/")
    else:
        thumbnail_rel = None

    written: list[Path] = []
    backups: list[tuple[Path, Path]] = []
    try:
        original_path = _safe_relative_path(original_rel, upload_dir)
        _write_with_backup(original_path, data, backups, written)
        preview_size = thumbnail_size = None
        if preview_data is not None and preview_rel is not None:
            preview_path = _safe_relative_path(preview_rel, upload_dir)
            _write_with_backup(preview_path, preview_data, backups, written)
            preview_size = len(preview_data)
        else:
            preview_path = None
        if thumbnail_data is not None and thumbnail_rel is not None:
            thumbnail_path = _safe_relative_path(thumbnail_rel, upload_dir)
            _write_with_backup(thumbnail_path, thumbnail_data, backups, written)
            thumbnail_size = len(thumbnail_data)
        else:
            thumbnail_path = None

        conn.execute(
            """INSERT INTO file_assets(
                asset_id, category, owner_type, owner_id, original_name,
                mime_type, original_path, preview_path, thumbnail_path,
                original_size, preview_size, thumbnail_size, width, height,
                compression_method, compression_version, sha256
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                asset_id,
                category,
                owner_type,
                str(owner_id),
                original_name,
                safe_mime,
                original_rel,
                preview_rel,
                thumbnail_rel,
                len(data),
                preview_size,
                thumbnail_size,
                width,
                height,
                "jpeg-preview" if is_image else "none",
                COMPRESSION_VERSION if is_image else "original-v1",
                hashlib.sha256(data).hexdigest(),
            ),
        )
    except Exception:
        for path in reversed(written):
            try:
                path.unlink(missing_ok=True)
            except OSError:
                pass
        _restore_backups(backups)
        raise

    root = _uploads_root(upload_dir)
    backup_paths = tuple(
        (
            str(target.relative_to(root)).replace("\\", "/"),
            str(backup.relative_to(root)).replace("\\", "/"),
        )
        for target, backup in backups
    )
    return Asset(
        asset_id=asset_id,
        original_path=original_rel,
        preview_path=preview_rel,
        thumbnail_path=thumbnail_rel,
        original_size=len(data),
        preview_size=preview_size,
        thumbnail_size=thumbnail_size,
        sha256=hashlib.sha256(data).hexdigest(),
        mime_type=safe_mime,
        is_image=is_image,
        backup_paths=backup_paths,
    )


def _restore_asset_backups(
    backup_paths: tuple[tuple[str, str], ...], upload_dir: str | Path | None = None
) -> None:
    backups = []
    for target_rel, backup_rel in backup_paths:
        try:
            backups.append(
                (
                    _safe_relative_path(target_rel, upload_dir),
                    _safe_relative_path(backup_rel, upload_dir),
                )
            )
        except ValueError:
            continue
    _restore_backups(backups)


def cleanup_asset_paths(asset: Asset, upload_dir: str | Path | None = None) -> None:
    """清理尚未 commit 的 asset，並復原被覆寫的既有檔案。"""
    for relative in (asset.original_path, asset.preview_path, asset.thumbnail_path):
        if not relative:
            continue
        try:
            _safe_relative_path(relative, upload_dir).unlink(missing_ok=True)
        except (OSError, ValueError):
            continue
    _restore_asset_backups(asset.backup_paths, upload_dir)


def finalize_asset_paths(asset: Asset, upload_dir: str | Path | None = None) -> None:
    """DB commit 成功後刪除 rollback backup。"""
    for _target_rel, backup_rel in asset.backup_paths:
        try:
            _safe_relative_path(backup_rel, upload_dir).unlink(missing_ok=True)
        except (OSError, ValueError):
            continue


def get_asset(conn: Any, asset_id: str):
    return conn.execute("SELECT * FROM file_assets WHERE asset_id=?", (asset_id,)).fetchone()


def get_owner_asset(conn: Any, category: str, owner_type: str, owner_id: str | int):
    return conn.execute(
        "SELECT * FROM file_assets WHERE category=? AND owner_type=? AND owner_id=? ORDER BY created_at DESC, asset_id DESC LIMIT 1",
        (category, owner_type, str(owner_id)),
    ).fetchone()


def asset_variant_path(row: Any, variant: str, upload_dir: str | Path | None = None) -> Path:
    if variant == "original":
        relative = row["original_path"]
    elif variant == "preview":
        relative = row["preview_path"]
    elif variant == "thumbnail":
        relative = row["thumbnail_path"]
    else:
        raise ValueError("不支援的媒體變體")
    if not relative:
        raise FileNotFoundError("媒體變體不存在")
    return _safe_relative_path(relative, upload_dir)


def safe_upload_path(relative: str, upload_dir: str | Path | None = None) -> Path:
    """Resolve a stored upload path without allowing traversal."""
    if not isinstance(relative, str) or not relative:
        raise ValueError("檔案路徑不存在")
    return _safe_relative_path(relative, upload_dir)


def asset_media_type(row: Any, variant: str) -> str:
    """Return a safe MIME based on stored variant semantics, never client input."""
    if variant in ("preview", "thumbnail"):
        return "image/jpeg"
    original = Path(row["original_path"] or "")
    return _MIME_BY_EXT.get(original.suffix.lower(), "application/octet-stream")


def delete_asset_files(row: Any, exclude_paths: set[str] | None = None, upload_dir: str | Path | None = None) -> None:
    excluded = exclude_paths or set()
    for column in ("original_path", "preview_path", "thumbnail_path"):
        relative = row[column]
        if not relative or relative in excluded:
            continue
        try:
            path = _safe_relative_path(relative, upload_dir)
            path.unlink(missing_ok=True)
            parent = path.parent
            root = _uploads_root(upload_dir)
            while parent != root and parent.exists():
                try:
                    parent.rmdir()
                except OSError:
                    break
                parent = parent.parent
        except (OSError, ValueError):
            continue
