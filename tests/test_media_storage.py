"""統一媒體儲存與圖片預覽效能測試。"""

import hashlib
import io
import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

import app.config as app_config
import app.database as app_db
import app.routes.quotation_uploads as quotation_uploads
import app.routes.signed_reports as signed_reports
import main as app_main
from app.services.auth import SESSION_COOKIE, create_session, init_admin_if_missing


@pytest.fixture()
def media_env(tmp_path, monkeypatch):
    """建立隔離 DB、uploads 與登入 client。"""
    monkeypatch.setattr(app_db, "DB_PATH", str(tmp_path / "media.db"))
    static_dir = tmp_path / "static"
    upload_dir = static_dir / "uploads"
    upload_dir.mkdir(parents=True)
    monkeypatch.setattr(app_config, "STATIC_DIR", str(static_dir))
    monkeypatch.setattr(app_config, "UPLOAD_DIR", str(upload_dir))
    monkeypatch.setattr(signed_reports, "STATIC_DIR", str(static_dir))
    monkeypatch.setattr(quotation_uploads, "STATIC_DIR", str(static_dir))
    app_db.init_db()

    conn = app_db.get_db()
    try:
        init_admin_if_missing(conn)
        user_id = conn.execute(
            "SELECT id FROM users WHERE username='admin'"
        ).fetchone()["id"]
        token = create_session(conn, user_id)
    finally:
        conn.close()

    with TestClient(app_main.app, raise_server_exceptions=False) as client:
        client.cookies.set(SESSION_COOKIE, token)
        yield client, static_dir, upload_dir


def _png(width=1200, height=600, color=(40, 120, 220)):
    buf = io.BytesIO()
    Image.new("RGB", (width, height), color).save(buf, "PNG")
    return buf.getvalue()


def test_store_image_asset_writes_original_preview_thumbnail_and_metadata(media_env):
    """統一服務要保留原始檔，並產生可供列表與 lightbox 使用的變體。"""
    from app.services.file_storage import store_asset

    _client, _static_dir, upload_dir = media_env
    source = _png()
    conn = app_db.get_db()
    try:
        asset = store_asset(
            conn,
            category="future_image",
            owner_type="test",
            owner_id="case-1",
            data=source,
            original_name="設備.png",
            mime_type="image/png",
            year_month="2026-09",
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM file_assets WHERE asset_id=?", (asset.asset_id,)
        ).fetchone()
    finally:
        conn.close()

    assert row is not None
    assert row["compression_version"]
    assert row["compression_method"] == "jpeg-preview"
    assert row["sha256"] == hashlib.sha256(source).hexdigest()
    assert row["preview_path"] and row["thumbnail_path"]
    original = upload_dir / row["original_path"]
    preview = upload_dir / row["preview_path"]
    thumbnail = upload_dir / row["thumbnail_path"]
    assert original.read_bytes() == source
    assert preview.exists() and thumbnail.exists()
    assert Image.open(preview).width == 800
    assert Image.open(thumbnail).width == 320


def test_item_photo_response_exposes_media_variants_and_protected_preview(media_env):
    """品項照片沿用舊 URL 相容性，同時回傳統一 media asset 變體。"""
    client, _static_dir, upload_dir = media_env
    item = client.post(
        "/api/items",
        json={
            "brand": "測試牌",
            "code": "MEDIA-1",
            "name": "媒體品項",
            "unit": "個",
            "low_stock": 0,
            "site": "office",
            "stocks": [{"location": "A", "qty": 1, "note": ""}],
        },
    ).json()
    source = _png()
    response = client.post(
        f"/api/items/{item['id']}/photo",
        files={"file": ("設備.png", source, "image/png")},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["asset_id"]
    assert body["preview_url"] == f"/media/{body['asset_id']}/preview"
    assert body["thumbnail_url"] == f"/media/{body['asset_id']}/thumbnail"
    assert body["photo"] == f"/uploads/{item['id']}.jpg"

    preview = client.get(body["preview_url"])
    thumbnail = client.get(body["thumbnail_url"])
    legacy = client.get(body["photo"])
    assert preview.status_code == thumbnail.status_code == legacy.status_code == 200
    assert Image.open(io.BytesIO(preview.content)).width == 800
    assert Image.open(io.BytesIO(thumbnail.content)).width == 320
    assert Image.open(io.BytesIO(legacy.content)).width == 800
    assert not (upload_dir / "assets" / "future_image").exists()


def test_signed_report_image_preview_is_compressed_but_download_is_original(media_env):
    """正式圖片預覽走 preview，下載仍回傳完整 original。"""
    client, _static_dir, upload_dir = media_env
    source = _png(1600, 800)
    uploaded = client.post(
        "/api/signed-reports",
        data={"report_date": "2026-09-10", "uploader_name": "王小明", "note": ""},
        files={"file": ("簽名.png", source, "image/png")},
    )
    assert uploaded.status_code == 200, uploaded.text
    item = uploaded.json()

    preview = client.get(f"/api/signed-reports/{item['id']}/preview")
    download = client.get(f"/api/signed-reports/{item['id']}/download")
    assert preview.status_code == download.status_code == 200
    assert Image.open(io.BytesIO(preview.content)).width == 800
    assert download.content == source

    conn = app_db.get_db()
    try:
        row = conn.execute(
            "SELECT * FROM file_assets WHERE category='signed_report' AND owner_id=?",
            (str(item["id"]),),
        ).fetchone()
    finally:
        conn.close()
    assert row is not None
    assert (upload_dir / row["original_path"]).read_bytes() == source


def test_items_paged_response_and_facets(media_env):
    """庫存列表可 server-side 分頁，且 facets 不需下載完整品項。"""
    client, _static_dir, _upload_dir = media_env
    for index in range(3):
        response = client.post(
            "/api/items",
            json={
                "brand": "品牌A" if index < 2 else "品牌B",
                "code": f"PAGE-{index}",
                "name": f"分頁品項{index}",
                "unit": "個",
                "low_stock": 0,
                "site": "office",
                "category": "耗材",
                "stocks": [{"location": f"A-{index}", "qty": index + 1, "note": ""}],
            },
        )
        assert response.status_code == 201, response.text

    page = client.get("/api/items", params={"site": "office", "page": 1, "page_size": 2})
    assert page.status_code == 200
    body = page.json()
    assert body["total"] == 3
    assert body["page"] == 1
    assert body["page_size"] == 2
    assert len(body["items"]) == 2
    assert all("stocks" in item and "has_photo" in item for item in body["items"])

    filtered = client.get(
        "/api/items",
        params={"site": "office", "page": 1, "page_size": 20, "search": "PAGE-2"},
    )
    assert filtered.json()["total"] == 1
    assert filtered.json()["items"][0]["code"] == "PAGE-2"

    facets = client.get("/api/items/facets", params={"site": "office"})
    assert facets.status_code == 200
    facet_body = facets.json()
    assert facet_body["brands"]["品牌A"] == 2
    assert facet_body["categories"]["耗材"] == 3
    assert "A-0" in facet_body["locations"]


def test_delete_item_cleans_all_photo_asset_variants(media_env):
    """刪除品項不得留下 original/thumbnail 等媒體孤兒檔。"""
    client, _static_dir, upload_dir = media_env
    item = client.post(
        "/api/items",
        json={
            "brand": "測試牌",
            "code": "DELETE-MEDIA",
            "name": "待刪媒體品項",
            "unit": "個",
            "low_stock": 0,
            "site": "office",
            "stocks": [{"location": "A", "qty": 1, "note": ""}],
        },
    ).json()
    uploaded = client.post(
        f"/api/items/{item['id']}/photo",
        files={"file": ("delete.png", _png(), "image/png")},
    ).json()
    conn = app_db.get_db()
    try:
        row = conn.execute(
            "SELECT * FROM file_assets WHERE asset_id=?", (uploaded["asset_id"],)
        ).fetchone()
    finally:
        conn.close()
    paths = [upload_dir / row[column] for column in ("original_path", "preview_path", "thumbnail_path") if row[column]]
    assert all(path.exists() for path in paths)

    deleted = client.delete(f"/api/items/{item['id']}")
    assert deleted.status_code == 200, deleted.text
    assert all(not path.exists() for path in paths)
    conn = app_db.get_db()
    try:
        assert conn.execute(
            "SELECT 1 FROM file_assets WHERE asset_id=?", (uploaded["asset_id"],)
        ).fetchone() is None
    finally:
        conn.close()




def test_calendar_month_list_uses_batch_row_queries(media_env, monkeypatch):
    """月曆列表不可每筆再查一次 appointment 主表。"""
    client, _static_dir, _upload_dir = media_env
    body = {
        "client_name": "批次客戶",
        "address": "地址",
        "service_type_id": 1,
        "date": "2026-09-10",
        "start_time": "09:00",
        "end_time": "10:00",
        "note": "",
        "user_ids": [],
    }
    assert client.post("/api/appointments", json=body).status_code == 200
    body["client_name"] = "批次客戶2"
    body["start_time"] = "11:00"
    body["end_time"] = "12:00"
    assert client.post("/api/appointments", json=body).status_code == 200

    import app.routes.appointments as appointments_route

    statements = []
    original_get_db = appointments_route.get_db

    def traced_get_db():
        conn = original_get_db()
        conn.set_trace_callback(statements.append)
        return conn

    monkeypatch.setattr(appointments_route, "get_db", traced_get_db)
    response = client.get("/api/appointments?year=2026&month=9")
    assert response.status_code == 200
    assert len(response.json()) == 2
    assert not any("SELECT * FROM appointments WHERE id=" in sql for sql in statements)


def test_stats_summary_combines_site_counts(media_env):
    """首頁統計一次取得辦公室/倉庫，避免三次獨立 stats request。"""
    client, _static_dir, _upload_dir = media_env
    for site in ("office", "warehouse"):
        response = client.post(
            "/api/items",
            json={
                "brand": "統計牌",
                "code": f"STATS-{site}",
                "name": f"統計{site}",
                "unit": "個",
                "low_stock": 0,
                "site": site,
                "stocks": [{"location": "A", "qty": 1, "note": ""}],
            },
        )
        assert response.status_code == 201, response.text
    summary = client.get("/api/stats/summary")
    assert summary.status_code == 200
    body = summary.json()
    assert body["office"]["total_items"] == 1
    assert body["warehouse"]["total_items"] == 1
    assert body["all"]["total_items"] == 2
    assert body["office"]["single_items"] == 1


def test_static_assets_use_versioned_cache_and_gzip(media_env):
    client, _static_dir, _upload_dir = media_env
    response = client.get(
        "/static/css/style.core.css?v=123",
        headers={"Accept-Encoding": "gzip"},
    )
    assert response.status_code == 200
    assert response.headers["cache-control"] == "public, max-age=31536000, immutable"
    assert response.headers.get("content-encoding") == "gzip"
    html = client.get("/")
    assert html.status_code == 200
    assert html.headers["cache-control"] == "no-cache, must-revalidate"


def test_replacing_item_photo_keeps_new_legacy_preview(media_env):
    client, _static_dir, upload_dir = media_env
    item = client.post(
        "/api/items",
        json={
            "brand": "測試牌",
            "code": "REPLACE-MEDIA",
            "name": "覆蓋照片品項",
            "unit": "個",
            "low_stock": 0,
            "site": "office",
            "stocks": [{"location": "A", "qty": 1, "note": ""}],
        },
    ).json()
    first = client.post(
        f"/api/items/{item['id']}/photo",
        files={"file": ("first.png", _png(1000, 500), "image/png")},
    ).json()
    conn = app_db.get_db()
    try:
        first_row = conn.execute(
            "SELECT * FROM file_assets WHERE asset_id=?", (first["asset_id"],)
        ).fetchone()
    finally:
        conn.close()
    old_original = upload_dir / first_row["original_path"]
    old_thumbnail = upload_dir / first_row["thumbnail_path"]
    second = client.post(
        f"/api/items/{item['id']}/photo",
        files={"file": ("second.png", _png(400, 200), "image/png")},
    ).json()
    assert second["asset_id"] != first["asset_id"]
    assert (upload_dir / f"{item['id']}.jpg").exists()
    assert not old_original.exists()
    assert not old_thumbnail.exists()
    conn = app_db.get_db()
    try:
        rows = conn.execute(
            "SELECT asset_id FROM file_assets WHERE category='item_photo' AND owner_id=?",
            (str(item["id"]),),
        ).fetchall()
    finally:
        conn.close()
    assert [row["asset_id"] for row in rows] == [second["asset_id"]]



def _new_photo_item(client, code):
    response = client.post(
        "/api/items",
        json={
            "brand": "測試牌",
            "code": code,
            "name": "媒體測試品項",
            "unit": "個",
            "low_stock": 0,
            "site": "office",
            "stocks": [{"location": "A", "qty": 1, "note": ""}],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_item_photo_rejects_html_bytes_with_image_extension(media_env):
    client, _static_dir, _upload_dir = media_env
    item = _new_photo_item(client, "MEDIA-SPOOF")
    response = client.post(
        f"/api/items/{item['id']}/photo",
        files={"file": ("evil.png", b"<script>document.body.dataset.xss=1</script>", "text/html")},
    )
    assert response.status_code == 400


def test_item_photo_uses_content_when_client_mime_is_generic(media_env):
    client, _static_dir, _upload_dir = media_env
    item = _new_photo_item(client, "MEDIA-MIME")
    source = io.BytesIO()
    Image.new("RGB", (1000, 500), "blue").save(source, "JPEG")
    response = client.post(
        f"/api/items/{item['id']}/photo",
        files={"file": ("photo.jpg", source.getvalue(), "application/octet-stream")},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert client.get(body["preview_url"]).status_code == 200
    assert client.get(body["thumbnail_url"]).status_code == 200


def test_media_original_is_forced_to_attachment(media_env):
    client, _static_dir, _upload_dir = media_env
    item = _new_photo_item(client, "MEDIA-ATTACH")
    uploaded = client.post(
        f"/api/items/{item['id']}/photo",
        files={"file": ("photo.png", _png(), "image/png")},
    )
    assert uploaded.status_code == 200, uploaded.text
    original = client.get(f"/media/{uploaded.json()['asset_id']}/original")
    assert original.status_code == 200
    assert original.headers["content-disposition"].startswith("attachment;")


@pytest.mark.parametrize("endpoint", ["/api/signed-reports", "/api/quotation-uploads"])
def test_invalid_report_image_returns_400_not_500(media_env, endpoint):
    client, _static_dir, _upload_dir = media_env
    response = client.post(
        endpoint,
        data={"report_date": "2026-09-10", "uploader_name": "測試", "note": ""},
        files={"file": ("bad.png", b"not-an-image", "image/png")},
    )
    assert response.status_code == 400, response.text


def test_store_asset_rollback_restores_existing_legacy_preview(media_env):
    _client, _static_dir, upload_dir = media_env
    legacy = upload_dir / "legacy.jpg"
    old_bytes = b"old-preview"
    legacy.write_bytes(old_bytes)

    class FailingConnection:
        def execute(self, *_args, **_kwargs):
            raise RuntimeError("simulated metadata failure")

    with pytest.raises(RuntimeError, match="simulated metadata failure"):
        from app.services.file_storage import store_asset

        store_asset(
            FailingConnection(),
            category="item_photo",
            owner_type="item",
            owner_id=7,
            data=_png(),
            original_name="new.png",
            mime_type="image/png",
            legacy_preview_path="legacy.jpg",
            upload_dir=upload_dir,
        )
    assert legacy.read_bytes() == old_bytes


def test_replacing_item_photo_removes_old_asset_across_timestamp_boundary(media_env):
    client, _static_dir, upload_dir = media_env
    item = _new_photo_item(client, "MEDIA-CROSS-SECOND")
    first = client.post(
        f"/api/items/{item['id']}/photo",
        files={"file": ("first.png", _png(1000, 500), "image/png")},
    ).json()
    conn = app_db.get_db()
    try:
        first_row = conn.execute(
            "SELECT * FROM file_assets WHERE asset_id=?", (first["asset_id"],)
        ).fetchone()
        conn.execute(
            "UPDATE file_assets SET created_at='2000-01-01 00:00:00' WHERE asset_id=?",
            (first["asset_id"],),
        )
        conn.commit()
    finally:
        conn.close()
    old_original = upload_dir / first_row["original_path"]
    second = client.post(
        f"/api/items/{item['id']}/photo",
        files={"file": ("second.png", _png(400, 200), "image/png")},
    ).json()
    conn = app_db.get_db()
    try:
        rows = conn.execute(
            "SELECT asset_id FROM file_assets WHERE category='item_photo' AND owner_id=?",
            (str(item["id"]),),
        ).fetchall()
    finally:
        conn.close()
    assert [row["asset_id"] for row in rows] == [second["asset_id"]]
    assert not old_original.exists()
