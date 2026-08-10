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
    """每個測試獨立 DB + 獨立 uploads 目錄（不污染正式 static/uploads/）+ 登入 admin"""
    test_db = tmp_path / "test_v101.db"
    monkeypatch.setattr(app_db, "DB_PATH", str(test_db))
    test_upload = tmp_path / "uploads"
    test_upload.mkdir()
    monkeypatch.setattr("app.config.UPLOAD_DIR", str(test_upload))
    app_db.init_db()

    # v11：全 API 需登入 → 建 admin + 登入
    from app.services.auth import init_admin_if_missing
    _conn = app_db.get_db()
    try:
        init_admin_if_missing(_conn)
    finally:
        _conn.close()

    with TestClient(app_main.app) as c:
        r = c.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
        assert r.status_code == 200, f"測試 admin 登入失敗: {r.status_code} {r.text}"
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
        """大圖（1000px 寬）上傳後壓縮到 800px 寬（lightbox 大圖需求）"""
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

    def test_photo_small_not_upscaled(self, client):
        """小圖（400px 寬）不放大 → 保持 原尺寸（不模糊）"""
        from PIL import Image
        buf = io.BytesIO()
        Image.new("RGB", (400, 300), (10, 120, 200)).save(buf, "PNG")
        item = _add_item(client, name="小圖品")
        r = client.post(f"/api/items/{item['id']}/photo",
                        files={"file": ("small.png", buf.getvalue(), "image/png")})
        assert r.status_code == 200
        dest = os.path.join(app_config.UPLOAD_DIR, f"{item['id']}.jpg")
        img = Image.open(dest)
        assert img.width == 400   # 沒被放大
        assert img.height == 300

    def test_photo_tall_proportional(self, client):
        """直立長圖（500x1500）壓縮後仍等比例（寬不超過 800 維持原尺寸）"""
        from PIL import Image
        buf = io.BytesIO()
        Image.new("RGB", (500, 1500), (30, 180, 90)).save(buf, "PNG")
        item = _add_item(client, name="直立長圖品")
        r = client.post(f"/api/items/{item['id']}/photo",
                        files={"file": ("tall.png", buf.getvalue(), "image/png")})
        assert r.status_code == 200
        dest = os.path.join(app_config.UPLOAD_DIR, f"{item['id']}.jpg")
        img = Image.open(dest)
        # 寬 500 < 800 → 不縮放，維持 500x1500
        assert img.width == 500
        assert img.height == 1500


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


# ========== B1：/uploads 需登入才可讀（照片不再公開） ==========

class TestPhotoAccessControl:
    def test_photo_requires_login(self, client, tmp_path):
        """未登入 GET /uploads/<id>.jpg → 401；登入後 → 200"""
        item = _add_item(client, name="受保護照片品")
        r = client.post(
            f"/api/items/{item['id']}/photo",
            files={"file": ("photo.png", _tiny_png(), "image/png")},
        )
        assert r.status_code == 200

        with TestClient(app_main.app) as anon:
            assert anon.get(f"/uploads/{item['id']}.jpg").status_code == 401
        # 登入後可讀
        assert client.get(f"/uploads/{item['id']}.jpg").status_code == 200

    def test_photo_path_traversal_blocked(self, client):
        """非 <數字>.jpg 的檔名（路徑穿越嘗試）→ 404"""
        for evil in ("../inventory.db", "..%2Fsecret.jpg", "abc.jpg", "1.png", "1.jpg/../../x"):
            assert client.get(f"/uploads/{evil}").status_code == 404

    def test_photo_upload_dir_stays_in_static(self):
        """照片維持在 static/uploads（家豪定案：不遷移位置，只封鎖公開讀取）"""
        # 不帶 client fixture（其 monkeypatch 會換 UPLOAD_DIR），直接讀原始設定
        import app.config as cfg
        upload = os.path.abspath(cfg.UPLOAD_DIR)
        static = os.path.abspath(cfg.STATIC_DIR)
        assert upload.startswith(static + os.sep), "UPLOAD_DIR 必須維持在 static/ 內"

    def test_public_static_uploads_blocked(self, client):
        """/static/uploads 公開讀取被擋（即使照片存在也 404；class 層級驗證）"""
        # 1) 內部邏輯：uploads/ 開頭路徑一律判定為封鎖（與檔案是否存在無關）
        from main import _is_upload_path
        assert _is_upload_path("/uploads/1.jpg") is True
        assert _is_upload_path("uploads/1.jpg") is True
        assert _is_upload_path("uploads\\1.jpg") is True        # Windows 檔案系統路徑（反斜線）
        assert _is_upload_path("/static/uploads/1.jpg") is True
        assert _is_upload_path("static/uploads/1.jpg") is True
        assert _is_upload_path("/js/app.js") is False
        assert _is_upload_path("/css/style.css") is False

        # 2) HTTP 層：即使照片真實存在於 static/uploads，/static/uploads/ 仍 404
        item = _add_item(client, name="封鎖驗證品")
        r = client.post(
            f"/api/items/{item['id']}/photo",
            files={"file": ("photo.png", _tiny_png(), "image/png")},
        )
        assert r.status_code == 200
        # 照片真實存在於 static/uploads
        dest = os.path.join(app_config.UPLOAD_DIR, f"{item['id']}.jpg")
        assert os.path.exists(dest)
        # 但公開路徑讀不到 → 404
        assert client.get(f"/static/uploads/{item['id']}.jpg").status_code == 404
        # 靜態其他資源不受影響
        assert client.get("/static/js/utils.js").status_code == 200
        # 登入走 /uploads/ 可讀
        assert client.get(f"/uploads/{item['id']}.jpg").status_code == 200

    def test_upload_dir_gitignored(self, client):
        """防回歸：照片位置 static/uploads/ 必須被 .gitignore 涵蓋（避免照片 push 上 GitHub）"""
        import subprocess
        r = subprocess.run(
            ["git", "check-ignore", "-v", "static/uploads/1.jpg"],
            capture_output=True, text=True, cwd=BASE_DIR,
        )
        assert r.returncode == 0, f"static/uploads/ 未被 .gitignore 涵蓋！stdout={r.stdout}"
        assert "uploads/" in r.stdout