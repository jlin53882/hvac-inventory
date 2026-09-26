"""統一媒體儲存與圖片預覽效能測試。"""

import hashlib
from concurrent.futures import ThreadPoolExecutor
import io
import json
import os
import sqlite3
from pathlib import Path

import pytest
from fastapi import HTTPException
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
    css_dir = static_dir / "css"
    css_dir.mkdir()
    (css_dir / "style.core.css").write_text(
        "/* fixture-css-marker */\n" + "a" * 2048,
        encoding="utf-8",
    )
    monkeypatch.setattr(app_config, "STATIC_DIR", str(static_dir))
    monkeypatch.setattr(app_main, "STATIC_DIR", str(static_dir))
    static_mount = next(
        route.app for route in app_main.app.routes if getattr(route, "path", "") == "/static"
    )
    monkeypatch.setattr(static_mount, "directory", str(static_dir))
    monkeypatch.setattr(static_mount, "all_directories", [str(static_dir)])
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
    assert "fixture-css-marker" in response.text
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


def test_item_photo_rejects_image_extension_content_mismatch(media_env):
    client, _static_dir, _upload_dir = media_env
    item = _new_photo_item(client, "MEDIA-MISMATCH")
    response = client.post(
        f"/api/items/{item['id']}/photo",
        files={"file": ("photo.jpg", _png(), "image/jpeg")},
    )
    assert response.status_code == 400, response.text


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



def test_paged_items_and_facets_exclude_kit_rows(media_env):
    client, _static_dir, _upload_dir = media_env
    kit = _new_photo_item(client, "PAGED-KIT")
    conn = app_db.get_db()
    try:
        conn.execute("UPDATE items SET is_kit=1, category='整組' WHERE id=?", (kit["id"],))
        conn.commit()
    finally:
        conn.close()
    normal = _new_photo_item(client, "PAGED-NORMAL")

    page = client.get("/api/items", params={"site": "office", "page": 1, "page_size": 50})
    assert page.status_code == 200, page.text
    body = page.json()
    assert body["total"] == 1
    assert [item["id"] for item in body["items"]] == [normal["id"]]
    assert body["stats"]["item_count"] == 1
    assert body["stats"]["zero_stock"] == 0

    facets = client.get("/api/items/facets", params={"site": "office"})
    assert facets.status_code == 200, facets.text
    facet_body = facets.json()
    assert "測試牌" in facet_body["brands"]
    assert facet_body["categories"].get("整組") is None


def test_paged_items_include_full_filter_stats_for_inventory_kpi(media_env):
    """分頁列表的 KPI/缺貨清單不可只計當頁，必須涵蓋同一篩選條件的全量品項。"""
    client, _static_dir, _upload_dir = media_env
    cases = (
        ("PAGED-KPI-ZERO-A", 0, 0),
        ("PAGED-KPI-ZERO-B", 0, 0),
        ("PAGED-KPI-LOW", 2, 5),
        ("PAGED-KPI-NORMAL", 8, 0),
    )
    created = []
    for name, qty, low_stock in cases:
        response = client.post(
            "/api/items",
            json={
                "brand": "KPI測試牌",
                "code": name,
                "name": name,
                "unit": "個",
                "low_stock": low_stock,
                "site": "office",
                "stocks": [{"location": "A", "qty": qty, "note": ""}],
            },
        )
        assert response.status_code == 201, response.text
        created.append(response.json())

    conn = app_db.get_db()
    try:
        conn.execute("INSERT INTO item_stocks (item_id, location, qty, note) VALUES (?, ?, ?, ?)", (created[0]["id"], "B", 0, ""))
        conn.commit()
    finally:
        conn.close()

    photo_response = client.post(
        f"/api/items/{created[0]['id']}/photo",
        files={"file": ("alert.png", _png(), "image/png")},
    )
    assert photo_response.status_code == 200, photo_response.text
    photo_asset_id = photo_response.json()["asset_id"]

    page = client.get(
        "/api/items",
        params={"site": "office", "page": 1, "page_size": 2, "search": "PAGED-KPI"},
    )
    assert page.status_code == 200, page.text
    body = page.json()
    assert body["total"] == 4
    assert len(body["items"]) == 2
    assert body["stats"]["total_qty"] == 10
    assert body["stats"]["low_stock"] == 1
    assert body["stats"]["zero_stock"] == 2
    assert body["stats"]["item_count"] == 4
    assert "zero_items" not in body["stats"]
    assert "low_items" not in body["stats"]
    alerts_page = client.get(
        "/api/items",
        params={
            "site": "office",
            "page": 1,
            "page_size": 1,
            "search": "PAGED-KPI",
            "include_alert_items": "1",
        },
    )
    assert alerts_page.status_code == 200, alerts_page.text
    alert_body = alerts_page.json()
    assert alert_body["stats"]["item_count"] == 4
    assert {item["id"] for item in alert_body["stats"]["zero_items"]} == {
        created[0]["id"], created[1]["id"]
    }
    assert [item["id"] for item in alert_body["stats"]["low_items"]] == [created[2]["id"]]
    zero_locations = {item["id"]: item["location"] for item in alert_body["stats"]["zero_items"]}
    assert set(zero_locations[created[0]["id"]].split("、")) == {"A", "B"}
    zero_with_photo = next(item for item in alert_body["stats"]["zero_items"] if item["id"] == created[0]["id"])
    assert [stock["location"] for stock in zero_with_photo["stocks"]] == ["A", "B"]
    assert zero_with_photo["has_photo"] is True
    assert zero_with_photo["thumbnail_url"] == f"/media/{photo_asset_id}/thumbnail"
    assert zero_with_photo["preview_url"] == f"/media/{photo_asset_id}/preview"

    summary = client.get("/api/stats/summary")
    assert summary.status_code == 200, summary.text
    office_alerts = summary.json()["office"]
    assert {item["id"] for item in office_alerts["zero_items"]} == {
        item["id"] for item in alert_body["stats"]["zero_items"]
    }
    assert {item["id"] for item in office_alerts["low_items"]} == {
        item["id"] for item in alert_body["stats"]["low_items"]
    }

    filtered = client.get(
        "/api/items",
        params={"site": "office", "page": 1, "page_size": 2, "search": "PAGED-KPI-LOW"},
    )
    assert filtered.status_code == 200, filtered.text
    filtered_stats = filtered.json()["stats"]
    assert filtered_stats["total_qty"] == 2
    assert filtered_stats["low_stock"] == 1
    assert filtered_stats["zero_stock"] == 0


def test_inventory_stock_status_rounds_fractional_quantities_consistently(media_env):
    """前後端狀態判定都先取到小數 3 位，避免 0.0004 同時被算成低庫存與缺貨。"""
    client, _static_dir, _upload_dir = media_env
    response = client.post(
        "/api/items",
        json={
            "brand": "小數測試牌",
            "code": "FRACTIONAL-KPI",
            "name": "FRACTIONAL-KPI",
            "unit": "個",
            "low_stock": 1,
            "site": "office",
            "stocks": [{"location": "A", "qty": 0.0004, "note": ""}],
        },
    )
    assert response.status_code == 201, response.text
    item_id = response.json()["id"]

    page = client.get(
        "/api/items",
        params={"site": "office", "page": 1, "page_size": 1, "search": "FRACTIONAL-KPI"},
    )
    assert page.status_code == 200, page.text
    stats = page.json()["stats"]
    assert stats["total_qty"] == 0
    assert stats["low_stock"] == 0
    assert stats["zero_stock"] == 1

    alerts = client.get(
        "/api/items",
        params={
            "site": "office",
            "page": 1,
            "page_size": 1,
            "search": "FRACTIONAL-KPI",
            "include_alert_items": "1",
        },
    )
    assert alerts.status_code == 200, alerts.text
    alert_stats = alerts.json()["stats"]
    assert [row["id"] for row in alert_stats["zero_items"]] == [item_id]
    assert alert_stats["low_items"] == []

    summary = client.get("/api/stats/summary")
    assert summary.status_code == 200, summary.text
    office = summary.json()["office"]
    assert any(row["id"] == item_id for row in office["zero_items"])
    assert all(row["id"] != item_id for row in office["low_items"])


def test_stats_summary_exposes_alert_items_for_paged_notifications(media_env):
    client, _static_dir, _upload_dir = media_env
    zero = _new_photo_item(client, "ALERT-ZERO")
    low = _new_photo_item(client, "ALERT-LOW")
    conn = app_db.get_db()
    try:
        conn.execute("UPDATE items SET low_stock=0 WHERE id=?", (zero["id"],))
        conn.execute("UPDATE item_stocks SET qty=0 WHERE item_id=?", (zero["id"],))
        conn.execute("UPDATE items SET low_stock=5 WHERE id=?", (low["id"],))
        conn.execute("UPDATE item_stocks SET qty=2 WHERE item_id=?", (low["id"],))
        conn.commit()
    finally:
        conn.close()

    summary = client.get("/api/stats/summary")
    assert summary.status_code == 200, summary.text
    office = summary.json()["office"]
    assert any(item["name"] == zero["name"] for item in office["zero_items"])
    assert any(item["name"] == low["name"] for item in office["low_items"])



def test_binary_media_is_not_gzipped(media_env):
    client, _static_dir, _upload_dir = media_env
    item = _new_photo_item(client, "MEDIA-NO-GZIP")
    uploaded = client.post(
        f"/api/items/{item['id']}/photo",
        files={"file": ("photo.png", _png(), "image/png")},
    )
    assert uploaded.status_code == 200, uploaded.text
    image_response = client.get(
        f"/media/{uploaded.json()['asset_id']}/original",
        headers={"Accept-Encoding": "gzip"},
    )
    assert image_response.status_code == 200
    assert image_response.headers.get("content-encoding") is None

    pdf = b"%PDF-1.7\n" + b"0" * 2048
    report = client.post(
        "/api/signed-reports",
        data={"report_date": "2026-09-10", "uploader_name": "測試", "note": ""},
        files={"file": ("report.pdf", pdf, "application/pdf")},
    )
    assert report.status_code == 200, report.text
    download = client.get(
        f"/api/signed-reports/{report.json()['id']}/download",
        headers={"Accept-Encoding": "gzip"},
    )
    assert download.status_code == 200
    assert download.headers.get("content-encoding") is None


def test_document_routes_reject_stored_path_traversal(media_env):
    client, static_dir, _upload_dir = media_env
    outside = static_dir / "outside.pdf"
    outside.write_bytes(b"%PDF-1.7\nnot-for-this-route")
    conn = app_db.get_db()
    try:
        user_id = conn.execute("SELECT id FROM users WHERE username='admin'").fetchone()["id"]
        records = []
        for table, prefix in (
            ("daily_signed_reports", "signed-reports"),
            ("quotation_uploads", "quotation-uploads"),
        ):
            cursor = conn.execute(
                f"INSERT INTO {table}(report_date, uploader_user_id, uploader_name, file_name, stored_path, file_size, mime_type, note) "
                "VALUES(?,?,?,?,?,?,?,?)",
                ("2026-09-10", user_id, "測試", "outside.pdf", "../outside.pdf", 10, "application/pdf", ""),
            )
            records.append((prefix, cursor.lastrowid))
        conn.commit()
    finally:
        conn.close()

    for prefix, rid in records:
        assert client.get(f"/api/{prefix}/{rid}/preview").status_code == 404
        assert client.get(f"/api/{prefix}/{rid}/download").status_code == 404
        assert client.delete(f"/api/{prefix}/{rid}").status_code == 200
        assert outside.exists()


def test_versioned_static_url_uses_subsecond_mtime(media_env):
    _client, static_dir, _upload_dir = media_env
    js = static_dir / "js" / "app.js"
    js.parent.mkdir(parents=True)
    js.write_text("console.log('fixture');", encoding="utf-8")
    index = static_dir / "index.html"
    index.write_text('<script src="/static/js/app.js"></script>', encoding="utf-8")
    timestamp_ns = 1700000000123456789
    os.utime(js, ns=(timestamp_ns, timestamp_ns))

    response = app_main._versioned_html(str(index))
    assert f"/static/js/app.js?v={js.stat().st_mtime_ns}" in response.body.decode("utf-8")


def test_appointment_batch_formatter_chunks_large_id_lists(media_env):
    _client, _static_dir, _upload_dir = media_env
    conn = app_db.get_db()
    try:
        conn.executemany(
            "INSERT INTO appointments(client_name, address, service_type_id, date, start_time, end_time, note) "
            "VALUES(?,?,?,?,?,?,?)",
            [
                (f"批次-{index}", "", None, "2026-09-10", "", "", "")
                for index in range(1001)
            ],
        )
        conn.commit()
        ids = [row["id"] for row in conn.execute("SELECT id FROM appointments ORDER BY id")]
        conn.setlimit(sqlite3.SQLITE_LIMIT_VARIABLE_NUMBER, 500)
        from app.routes.appointments import _appt_rows

        result = _appt_rows(conn, ids)
    finally:
        conn.close()
    assert len(result) == 1001



@pytest.mark.parametrize("endpoint", ["/api/signed-reports", "/api/quotation-uploads"])
def test_pdf_upload_rejects_non_pdf_bytes(media_env, endpoint):
    client, _static_dir, _upload_dir = media_env
    response = client.post(
        endpoint,
        data={"report_date": "2026-09-10", "uploader_name": "測試", "note": ""},
        files={"file": ("fake.pdf", b"<html>not a pdf</html>", "application/pdf")},
    )
    assert response.status_code == 400, response.text


def test_concurrent_item_photo_replacement_keeps_single_asset(media_env):
    _client, _static_dir, _upload_dir = media_env
    item = _new_photo_item(_client, "MEDIA-CONCURRENT")
    from app.routes.photos import upload_photo

    def upload(index):
        class IncomingFile:
            filename = f"concurrent-{index}.png"
            content_type = "image/png"
            file = io.BytesIO(_png(400 + index, 200))

        return upload_photo(item["id"], IncomingFile())

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(upload, (1, 2)))
    assert all(result["ok"] for result in results)

    conn = app_db.get_db()
    try:
        rows = conn.execute(
            "SELECT asset_id FROM file_assets WHERE category='item_photo' AND owner_type='item' AND owner_id=?",
            (str(item["id"]),),
        ).fetchall()
    finally:
        conn.close()
    assert len(rows) == 1


@pytest.mark.parametrize("filter_name", ["brands", "categories"])
def test_items_rejects_excessive_csv_filter_values(media_env, filter_name):
    client, _static_dir, _upload_dir = media_env
    values = ",".join(f"filter-{index}" for index in range(401))
    response = client.get(
        "/api/items",
        params={"site": "office", "page": 1, filter_name: values},
    )
    assert response.status_code == 400, response.text



def test_items_rejects_page_number_that_would_overflow_sqlite_offset(media_env):
    client, _static_dir, _upload_dir = media_env
    response = client.get(
        "/api/items",
        params={"site": "office", "page": 10**12, "page_size": 100},
    )
    assert response.status_code == 400



def test_unpaged_items_chunks_photo_metadata_ids(media_env, monkeypatch):
    """Regression: unpaged compatibility reads must respect SQLite bind limits."""
    _client, _static_dir, _upload_dir = media_env
    conn = app_db.get_db()
    conn.execute("DELETE FROM item_stocks")
    conn.execute("DELETE FROM items")
    conn.executemany(
        "INSERT INTO items (brand, code, name, unit, low_stock, site, category) VALUES (?,?,?,?,?,?,?)",
        [
            ("Batch", f"BATCH-{index}", f"Batch item {index}", "個", 0, "office", "test")
            for index in range(501)
        ],
    )
    conn.commit()
    conn.setlimit(sqlite3.SQLITE_LIMIT_VARIABLE_NUMBER, 500)

    import app.routes.items as item_routes

    monkeypatch.setattr(item_routes, "get_db", lambda: conn)
    monkeypatch.setattr(item_routes, "list_photo_ids", lambda: set())
    result = json.loads(item_routes.list_items(site="office").body)
    assert len(result) == 501



def test_list_items_thumbnail_url_from_photo_map(media_env):
    """list_items 上傳照片後 thumbnail_url 正確回傳（非 None）。"""
    client, _static_dir, _upload_dir = media_env
    item = client.post(
        "/api/items",
        json={
            "brand": "縮圖測", "code": "THUMB-1", "name": "縮圖品項",
            "unit": "個", "low_stock": 0, "site": "office",
            "stocks": [{"location": "X", "qty": 1, "note": ""}],
        },
    ).json()
    source = _png(200, 200)
    resp = client.post(
        f"/api/items/{item['id']}/photo",
        files={"file": ("photo.png", source, "image/png")},
    )
    assert resp.status_code == 200

    items = client.get("/api/items").json()
    found = next(x for x in items if x["id"] == item["id"])
    assert found["has_photo"] is True
    assert found["thumbnail_url"] is not None, "thumbnail_url 不應為 None（photo_map int key lookup）"
    assert "/thumbnail" in found["thumbnail_url"]


def test_items_rejects_combined_csv_filters_over_bind_budget(media_env, monkeypatch):
    conn = app_db.get_db()
    conn.setlimit(sqlite3.SQLITE_LIMIT_VARIABLE_NUMBER, 500)
    import app.routes.items as item_routes

    monkeypatch.setattr(item_routes, "get_db", lambda: conn)
    brands = ",".join(f"brand-{index}" for index in range(400))
    categories = ",".join(f"category-{index}" for index in range(400))
    with pytest.raises(HTTPException) as error:
        item_routes.list_items(site="office", brands=brands, categories=categories)
    assert error.value.status_code == 400


def test_store_asset_custom_base_relative_dir_isolated_layout(media_env):
    """新功能可指定 base dir；未指定時的 assets layout 由既有測試守護。"""
    _client, _static_dir, upload_dir = media_env
    from app.services.file_storage import store_asset

    conn = app_db.get_db()
    try:
        asset = store_asset(
            conn,
            category="work_progress",
            owner_type="work_progress_report",
            owner_id=41,
            data=_png(100, 50),
            original_name="現場.png",
            mime_type="image/png",
            year_month="2026-09",
            base_relative_dir="work_progress/2026-09/41",
        )
        conn.commit()
    finally:
        conn.close()

    assert asset.original_path.startswith("work_progress/2026-09/41/")
    assert (upload_dir / asset.original_path).exists()
    assert (upload_dir / asset.preview_path).exists()
    assert (upload_dir / asset.thumbnail_path).exists()
