# -*- coding: utf-8 -*-
"""
v10.1 照片 + 相似品項提示 + 位置補全 的單元測試
================================================
- POST/DELETE /api/items/{id}/photo    上傳/刪除照片（壓縮、格式擋、404）
- GET  /api/items/similar              相似品項查詢（code 相等必中 / 名稱相似 / 誤判防護）
- GET  /api/locations                  位置清單（site 篩選）
- list 回應含 has_photo 欄位
"""
import io
import os
import sys

import pytest
from fastapi.testclient import TestClient

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE_DIR)

import app.database as app_db  # noqa: E402
import main as app_main  # noqa: E402
import app.config as app_config  # noqa: E402


@pytest.fixture()
def client(tmp_path, monkeypatch):
    """每個測試獨立 DB + 獨立 uploads 目錄（不污染正式 static/uploads/）"""
    test_db = tmp_path / "test_v101.db"
    monkeypatch.setattr(app_db, "DB_PATH", str(test_db))
    test_upload = tmp_path / "uploads"
    test_upload.mkdir()
    monkeypatch.setattr("app.config.UPLOAD_DIR", str(test_upload))
    app_db.init_db()
    with TestClient(app_main.app) as c:
        yield c


def _add_item(client, **kw):
    """新增品項 helper"""
    payload = {
        "brand": kw.get("brand", "測試牌"),
        "code": kw.get("code", ""),
        "name": kw.get("name", "測試品"),
        "unit": kw.get("unit", "個"),
        "low_stock": kw.get("low_stock", 0),
        "site": kw.get("site", "office"),
        "stocks": [{"location": kw.get("location", "測試位置"),
                    "qty": kw.get("qty", 10), "note": kw.get("note", "")}],
    }
    r = client.post("/api/items", json=payload)
    assert r.status_code == 201, r.text
    return r.json()


def _tiny_png():
    import struct
    import zlib
    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)
    ihdr = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    idat = zlib.compress(b"\x00\xff\x00\x00")
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


class TestPhotoUpload:
    def test_upload_photo(self, client, tmp_path):
        """上傳照片 → 檔案存在 + 回應帶 photo URL + item 有 has_photo"""
        item = _add_item(client, name="有圖品")
        r = client.post(
            f"/api/items/{item['id']}/photo",
            files={"file": ("photo.png", _tiny_png(), "image/png")},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True
        assert body["photo"] == f"/uploads/{item['id']}.jpg"

        # 檔案真的存在（壓縮後 jpg）
        dest = os.path.join(app_config.UPLOAD_DIR, f"{item['id']}.jpg")
        assert os.path.exists(dest)
        assert os.path.getsize(dest) > 0

        # list 回應帶 has_photo=True
        items = client.get("/api/items").json()
        assert items[0]["has_photo"] is True

    def test_upload_photo_item_not_found(self, client):
        """上傳到不存在的品項 → 404"""
        r = client.post("/api/items/99999/photo",
                        files={"file": ("p.png", _tiny_png(), "image/png")})
        assert r.status_code == 404

    def test_upload_photo_bad_extension(self, client):
        """副檔名不是圖片 → 400"""
        item = _add_item(client, name="壞檔品")
        r = client.post(f"/api/items/{item['id']}/photo",
                        files={"file": ("p.txt", b"hello", "text/plain")})
        assert r.status_code == 400

    def test_upload_photo_corrupt_image(self, client):
        """內容不是圖片（即使是 png 副檔名）→ 400"""
        item = _add_item(client, name="壞圖品")
        r = client.post(f"/api/items/{item['id']}/photo",
                        files={"file": ("fake.png", b"not a real image", "image/png")})
        assert r.status_code == 400

    def test_delete_photo(self, client):
        """刪除照片 → 檔案消失 + has_photo 變 False；重複刪仍 200（冪等）"""
        item = _add_item(client, name="刪圖品")
        client.post(f"/api/items/{item['id']}/photo",
                    files={"file": ("p.png", _tiny_png(), "image/png")})
        r = client.delete(f"/api/items/{item['id']}/photo")
        assert r.status_code == 200
        assert not os.path.exists(os.path.join(app_config.UPLOAD_DIR, f"{item['id']}.jpg"))

        # 冪等：再刪一次也 200
        assert client.delete(f"/api/items/{item['id']}/photo").status_code == 200
        # list 的 has_photo 已更新為 False
        items = client.get("/api/items").json()
        assert items[0]["has_photo"] is False

    def test_delete_item_removes_photo_file(self, client):
        """刪除品項時照片檔一併清除（不留孤兒檔）"""
        item = _add_item(client, name="有照片要刪")
        r = client.post(f"/api/items/{item['id']}/photo",
                        files={"file": ("p.png", _tiny_png(), "image/png")})
        assert r.status_code == 200
        assert os.path.exists(os.path.join(app_config.UPLOAD_DIR, f"{item['id']}.jpg"))

        r2 = client.delete(f"/api/items/{item['id']}")
        assert r2.status_code == 200
        assert not os.path.exists(os.path.join(app_config.UPLOAD_DIR, f"{item['id']}.jpg"))

    def test_photo_gets_compressed(self, client):
        """大圖（1000px 寬）上傳後壓縮到 300px 寬"""
        # 用 Pillow 直接生一張 1000x500 PNG
        from PIL import Image
        buf = io.BytesIO()
        Image.new("RGB", (1000, 500), (200, 100, 50)).save(buf, "PNG")
        item = _add_item(client, name="大型圖品")
        r = client.post(f"/api/items/{item['id']}/photo",
                        files={"file": ("big.png", buf.getvalue(), "image/png")})
        assert r.status_code == 200
        dest = os.path.join(app_config.UPLOAD_DIR, f"{item['id']}.jpg")
        img = Image.open(dest)
        assert img.width == 800
        assert img.height == 400  # 等比例


class TestSimilarLookup:
    def test_similar_by_code(self, client):
        """型號完全相等 → 一定命中"""
        _add_item(client, brand="大金", code="ARC433A59", name="遙控器原版")
        hits = client.get("/api/items/similar", params={
            "name": "遙控器", "code": "ARC433A59"}).json()
        assert len(hits) == 1
        assert hits[0]["code"] == "ARC433A59"
        assert "stocks" in hits[0] and "total_qty" in hits[0]

    def test_similar_by_name_contains(self, client):
        """名稱包含（去除符號後）→ 命中"""
        _add_item(client, name="遙控器 (無外面紙盒)")
        hits = client.get("/api/items/similar", params={"name": "遙控器"}).json()
        assert len(hits) == 1
        assert hits[0]["name"] == "遙控器 (無外面紙盒)"

    def test_similar_short_name_no_false_positive(self, client):
        """短名「銅管」不啟用模糊 → 只命中自己，不會誤抓「銅管接頭組」"""
        _add_item(client, name="銅管")
        _add_item(client, name="銅管接頭組")
        hits = client.get("/api/items/similar", params={"name": "銅管"}).json()
        # 「銅管」vs「銅管」（自己）→ 相同必中；vs「銅管接頭組」→ 太短不模糊 → 不誤抓
        assert len(hits) == 1
        assert hits[0]["name"] == "銅管"


class TestLocations:
    def test_list_locations(self, client):
        """回傳去重後的位置清單（含 site 篩選）"""
        a = _add_item(client, name="一", location="編號A")
        _add_item(client, name="二", location="編號A")  # 重複位置去重
        _add_item(client, name="三", location="編號B", site="warehouse")
        locs = client.get("/api/locations").json()
        assert "編號A" in locs and "編號B" in locs
        assert locs.count("編號A") == 1

        office = client.get("/api/locations", params={"site": "office"}).json()
        assert office == ["編號A"]