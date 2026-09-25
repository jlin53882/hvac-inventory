# -*- coding: utf-8 -*-
"""2026-09 效能/穩定性優化回歸測試。

涵蓋：新增索引、stats summary 批次查詢與逐分片結果一致、legacy 照片 id 目錄快取失效、
套件/待領出列表批次查詢後的回傳內容。
"""
import os

import pytest
from fastapi.testclient import TestClient

import app.config as app_config
import app.database as app_db
import main as app_main
from app.routes import photos, stats


@pytest.fixture()
def client(tmp_path, monkeypatch):
    """獨立 DB + uploads + admin session。"""
    monkeypatch.setattr(app_db, "DB_PATH", str(tmp_path / "perf.db"))
    upload = tmp_path / "uploads"
    upload.mkdir()
    monkeypatch.setattr(app_config, "UPLOAD_DIR", str(upload))
    photos.invalidate_photo_ids_cache()
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
    photos.invalidate_photo_ids_cache()


def _seed(conn):
    """各分片品項（含缺貨/低庫存/軟刪除/整組），回傳 {name: id}。"""
    ids = {}
    rows = [
        ("A", "office", "零庫存", 0, 5, 0), ("A", "office", "低庫存", 2, 5, 0),
        ("B", "warehouse", "正常", 50, 5, 0), ("", "van", "無廠牌缺貨", 0, 0, 0),
        ("C", "truck", "軟刪除", 0, 5, 0), ("K", "office", "整組", 1, 0, 1),
    ]
    for brand, site, name, qty, low, is_kit in rows:
        cur = conn.execute(
            "INSERT INTO items (brand, name, site, low_stock, is_kit) VALUES (?,?,?,?,?)",
            (brand, name, site, low, is_kit),
        )
        ids[name] = cur.lastrowid
        conn.execute("INSERT INTO item_stocks (item_id, location, qty) VALUES (?, 'L1', ?)", (cur.lastrowid, qty))
    conn.execute("UPDATE items SET is_deleted=1 WHERE id=?", (ids["軟刪除"],))
    conn.commit()
    return ids


def test_performance_indexes_exist(client):
    conn = app_db.get_db()
    try:
        names = {r["name"] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='index'")}
    finally:
        conn.close()
    assert {
        "idx_movements_created", "idx_movements_item_reason", "idx_kit_items_kit",
        "idx_kit_items_item", "idx_kits_item", "idx_stocktakes_date", "idx_stocktakes_item",
    } <= names


def test_stats_summary_matches_per_site_stats(client):
    conn = app_db.get_db()
    try:
        _seed(conn)
    finally:
        conn.close()
    summary = client.get("/api/stats/summary").json()
    assert set(summary) == set(stats.SUMMARY_SITES)
    for site in stats.SUMMARY_SITES:
        single = client.get("/api/stats" + ("" if site == "all" else f"?site={site}")).json()
        assert summary[site] == single, site
    assert summary["all"]["total_items"] == 5          # 排除軟刪除
    assert summary["all"]["kit_items"] == 1
    assert summary["office"]["zero_stock"] == 1 and summary["office"]["low_stock"] == 1
    assert [i["name"] for i in summary["van"]["zero_items"]] == ["無廠牌缺貨"]
    assert summary["truck"]["total_items"] == 0


def test_photo_id_cache_invalidates_on_new_file(client):
    upload = app_config.UPLOAD_DIR
    assert photos.list_photo_ids() == set()
    with open(os.path.join(upload, "7.jpg"), "wb") as fh:
        fh.write(b"x")
    photos.invalidate_photo_ids_cache()
    assert photos.has_photo(7)
    os.remove(os.path.join(upload, "7.jpg"))
    photos.invalidate_photo_ids_cache()
    assert not photos.has_photo(7)


def test_photo_id_cache_reuses_scan_when_directory_unchanged(client, monkeypatch):
    photos.list_photo_ids()
    calls = []
    real_listdir = os.listdir
    monkeypatch.setattr(photos.os, "listdir", lambda p: calls.append(p) or real_listdir(p))
    for _ in range(3):
        photos.list_photo_ids()
    assert calls == []


def test_list_kits_and_prepared_batch_payloads(client):
    conn = app_db.get_db()
    try:
        ids = _seed(conn)
        kit_item = ids["整組"]
        kit_id = conn.execute("INSERT INTO kits (item_id, name) VALUES (?, '整組')", (kit_item,)).lastrowid
        conn.execute("INSERT INTO kit_items (kit_id, item_id, qty) VALUES (?,?,2)", (kit_id, ids["正常"]))
        conn.execute("INSERT INTO kit_items (kit_id, item_id, qty) VALUES (?,?,1)", (kit_id, ids["低庫存"]))
        conn.execute("UPDATE items SET prepared_qty=1 WHERE id IN (?,?)", (ids["低庫存"], ids["正常"]))
        for dest in ("舊說明", "新說明"):
            conn.execute(
                "INSERT INTO movements (item_id, delta, reason, destination) VALUES (?, 0, '領出準備', ?)",
                (ids["低庫存"], dest),
            )
        conn.commit()
    finally:
        conn.close()
    kits = client.get("/api/kits?site=all").json()
    assert len(kits) == 1
    comps = kits[0]["components"]
    assert [(c["name"], c["need_qty"], c["stock"]) for c in comps] == [("正常", 2, 50), ("低庫存", 1, 2)]
    assert "kit_id" not in comps[0]
    prepared = {p["name"]: p for p in client.get("/api/prepared?site=all").json()}
    assert prepared["低庫存"]["destination"] == "新說明"
    assert prepared["正常"]["destination"] == ""
    assert prepared["正常"]["total_qty"] == 50 and prepared["正常"]["location"] == "L1"


# ========== 上傳：影像處理不佔 SQLite 寫鎖、async 端點不阻塞 event loop ==========

import io
import threading
import time

from PIL import Image

from app.routes import signed_reports, work_progress
from app.services import file_storage

SLOW_VARIANT_SECONDS = 0.8


def _png(color="red") -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (64, 48), color).save(buf, "PNG")
    return buf.getvalue()


@pytest.fixture()
def slow_media(client, tmp_path, monkeypatch):
    """讓每張圖的縮圖處理慢 SLOW_VARIANT_SECONDS 秒，放大「處理期間是否卡住別人」的差異。"""
    static_dir = tmp_path / "static"
    (static_dir / "uploads").mkdir(parents=True)
    monkeypatch.setattr(app_config, "STATIC_DIR", str(static_dir))
    monkeypatch.setattr(work_progress, "STATIC_DIR", str(static_dir))
    monkeypatch.setattr(signed_reports, "STATIC_DIR", str(static_dir))
    real = file_storage._image_variants

    def slow(*args, **kwargs):
        time.sleep(SLOW_VARIANT_SECONDS)
        return real(*args, **kwargs)

    monkeypatch.setattr(file_storage, "_image_variants", slow)
    conn = app_db.get_db()
    try:
        conn.execute(
            "INSERT INTO appointments(client_name,date,start_time,end_time,service_type_id) "
            "VALUES('王先生','2026-09-18','09:00','10:00',1)"
        )
        item_id = conn.execute("INSERT INTO items(name) VALUES('銅管')").lastrowid
        conn.execute("INSERT INTO item_stocks(item_id,location,qty) VALUES(?, 'L1', 10)", (item_id,))
        conn.commit()
    finally:
        conn.close()
    return item_id


def _run_in_background(fn):
    result = {}
    thread = threading.Thread(target=lambda: result.setdefault("response", fn()))
    thread.start()
    time.sleep(0.2)
    return thread, result


def test_multi_photo_upload_does_not_block_other_writers(client, slow_media):
    """多張照片處理期間，其他人的庫存調整不可被 SQLite 寫鎖卡住（原本會等到整批處理完，超過 10 秒回 500）。"""
    files = [("files", (f"p{i}.png", _png(), "image/png")) for i in range(2)]
    thread, result = _run_in_background(
        lambda: client.post("/api/work-progress", data={"appointment_id": "1", "note": "x"}, files=files)
    )
    started = time.perf_counter()
    adjust = client.post(f"/api/items/{slow_media}/adjust", json={"delta": 1})
    elapsed = time.perf_counter() - started
    thread.join()
    assert adjust.status_code == 200
    assert result["response"].status_code == 201, result["response"].text
    assert len(result["response"].json()["photos"]) == 2
    assert elapsed < SLOW_VARIANT_SECONDS * 0.5, f"庫存調整被上傳卡住 {elapsed:.2f}s"


def test_signed_report_file_replace_does_not_block_event_loop(client, slow_media):
    """async 編輯端點替換檔案時，其他請求（/health）不可被卡住。"""
    created = client.post(
        "/api/signed-reports",
        data={"report_date": "2026-09-18", "uploader_name": "王", "note": ""},
        files={"file": ("a.png", _png(), "image/png")},
    )
    assert created.status_code == 200, created.text
    rid = created.json()["id"]
    thread, result = _run_in_background(
        lambda: client.patch(f"/api/signed-reports/{rid}", data={"note": "換檔"},
                             files={"file": ("b.png", _png("blue"), "image/png")})
    )
    started = time.perf_counter()
    health = client.get("/health")
    elapsed = time.perf_counter() - started
    thread.join()
    assert health.status_code == 200
    assert result["response"].status_code == 200, result["response"].text
    assert elapsed < SLOW_VARIANT_SECONDS * 0.5, f"event loop 被卡住 {elapsed:.2f}s"


def test_prepare_media_batch_keeps_order_and_reports_errors():
    ok = file_storage.prepare_media_batch([(_png("red"), "a.png"), (_png("blue"), "b.png")])
    assert [m.original_name for m in ok] == ["a.png", "b.png"]
    assert all(m.is_image and m.width == 64 and m.height == 48 for m in ok)
    with pytest.raises(ValueError, match="副檔名不一致"):
        file_storage.prepare_media_batch([(_png(), "a.png"), (_png(), "b.jpg")])
