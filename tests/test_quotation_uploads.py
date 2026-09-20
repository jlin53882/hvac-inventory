# -*- coding: utf-8 -*-
"""報價單上傳 API 防回歸測試。

涵蓋：安全上傳、查詢/預覽、上傳者刪除自己的檔案、管理員全域刪除，
以及輸入驗證。所有檔案與資料庫均使用 pytest tmp_path，絕不碰正式上傳目錄。
"""

import app.database as app_db
import app.routes.quotation_uploads as quotation_uploads
import inspect
import main as app_main
import pytest
from app.services.auth import SESSION_COOKIE, create_session, init_admin_if_missing
from fastapi.testclient import TestClient


@pytest.fixture()
def signed_env(tmp_path, monkeypatch):
    """隔離 DB 與上傳目錄，回傳可建立已登入 client 的工廠。"""
    monkeypatch.setattr(app_db, "DB_PATH", str(tmp_path / "quotation_uploads.db"))
    monkeypatch.setattr(quotation_uploads, "STATIC_DIR", str(tmp_path / "static"))
    app_db.init_db()
    conn = app_db.get_db()
    try:
        init_admin_if_missing(conn)
    finally:
        conn.close()

    def make_client(username="admin", role="admin"):
        conn = app_db.get_db()
        try:
            if username == "admin":
                user_id = conn.execute(
                    "SELECT id FROM users WHERE username='admin'"
                ).fetchone()["id"]
            else:
                conn.execute(
                    "INSERT INTO users (username, password_hash, display_name, role) VALUES (?, 'x', ?, ?)",
                    (username, username, role),
                )
                conn.commit()
                user_id = conn.execute(
                    "SELECT id FROM users WHERE username=?", (username,)
                ).fetchone()["id"]
            token = create_session(conn, user_id)
        finally:
            conn.close()
        client = TestClient(app_main.app)
        client.cookies.set(SESSION_COOKIE, token)
        return client

    yield make_client, tmp_path / "static"


def test_shared_safety_helpers_are_the_only_quotation_helpers():
    source = inspect.getsource(quotation_uploads)
    assert "def _safe_name" not in source
    assert "def _can_delete_all" not in source
    assert "safe_download_name" in source
    assert "has_perm" in source


def _upload(client, *, report_date="2026-09-07", filename="daily.pdf", content=b"%PDF-signed"):
    return client.post(
        "/api/quotation-uploads",
        data={"report_date": report_date, "uploader_name": "王小明", "note": "已簽回"},
        files={"file": (filename, content, "application/pdf")},
    )

def _set_user_permission(username, permission_key, value):
    conn = app_db.get_db()
    try:
        user_id = conn.execute(
            "SELECT id FROM users WHERE username=?", (username,)
        ).fetchone()["id"]
        permission_id = conn.execute(
            "SELECT id FROM permissions WHERE key=?", (permission_key,)
        ).fetchone()["id"]
        conn.execute(
            "INSERT INTO user_permissions (user_id, permission_id, value) VALUES (?, ?, ?) "
            "ON CONFLICT(user_id, permission_id) DO UPDATE SET value=excluded.value",
            (user_id, permission_id, value),
        )
        conn.commit()
    finally:
        conn.close()


def test_api_requires_login():
    """列表與 KPI API 均需登入，不能因全域 router 掛載遺漏而公開。"""
    client = TestClient(app_main.app)
    assert client.get("/api/quotation-uploads").status_code == 401
    assert client.get("/api/quotation-uploads/kpi").status_code == 401


def test_kpi_returns_month_shape(signed_env):
    """KPI endpoint 維持每日簽名日報表相同的月份統計回傳 shape。"""
    make_client, _ = signed_env
    response = make_client().get("/api/quotation-uploads/kpi", params={"month": "2026-09"})
    assert response.status_code == 200
    assert set(response.json()) == {"month", "archived", "missing", "rate", "total"}
    assert response.json()["month"] == "2026-09"


def test_upload_list_preview_and_safe_storage(signed_env):
    """上傳後可查詢/預覽，原始檔名不會成為實際路徑控制字元。"""
    make_client, static_dir = signed_env
    client = make_client()

    response = _upload(client, filename="../../=daily report.pdf", content=b"%PDF-demo")
    assert response.status_code == 200, response.text
    item = response.json()
    assert item["file_name"] == "_daily_report.pdf"
    assert item["can_delete"] is True

    stored = list((static_dir / "uploads" / "quotation_uploads" / "2026-09").iterdir())
    assert len(stored) == 1
    assert stored[0].read_bytes() == b"%PDF-demo"
    assert stored[0].name.startswith(f"{item['id']}_")
    assert ".." not in stored[0].name

    listed = client.get("/api/quotation-uploads", params={"q": "王小明"})
    assert listed.status_code == 200
    assert listed.json()["total"] == 1
    assert listed.json()["items"][0]["id"] == item["id"]

    preview = client.get(f"/api/quotation-uploads/{item['id']}/preview")
    assert preview.status_code == 200
    assert preview.content == b"%PDF-demo"
    assert preview.headers["content-disposition"].startswith("inline;")
    assert preview.headers["x-frame-options"] == "SAMEORIGIN"
    assert "frame-ancestors 'self'" in preview.headers["content-security-policy"]

    download = client.get(f"/api/quotation-uploads/{item['id']}/download")
    assert download.status_code == 200
    assert download.content == b"%PDF-demo"
    assert download.headers["content-disposition"].startswith("attachment;")


def test_download_supports_non_ascii_filename(signed_env):
    """下載含中文原始檔名的 PDF 不得因 Content-Disposition 編碼回 500。"""
    make_client, _ = signed_env
    client = make_client()
    report = _upload(client, filename="簽名日報表.pdf", content=b"%PDF-unicode").json()

    response = client.get(f"/api/quotation-uploads/{report['id']}/download")

    assert response.status_code == 200
    assert response.content == b"%PDF-unicode"
    assert response.headers["content-disposition"].startswith("attachment;")
    assert "filename*=utf-8''" in response.headers["content-disposition"]


def test_upload_rejects_invalid_date_empty_file_and_overlong_note(signed_env):
    """輸入錯誤必回 400，不能留下上傳檔或資料列。"""
    make_client, static_dir = signed_env
    client = make_client()

    invalid_date = _upload(client, report_date="2026/09/07")
    assert invalid_date.status_code == 400
    assert "YYYY-MM-DD" in invalid_date.json()["detail"]

    empty = _upload(client, content=b"")
    assert empty.status_code == 400
    assert empty.json()["detail"] == "空檔案不可上傳"

    long_note = client.post(
        "/api/quotation-uploads",
        data={"report_date": "2026-09-07", "uploader_name": "王小明", "note": "x" * 501},
        files={"file": ("daily.pdf", b"x", "application/pdf")},
    )
    assert long_note.status_code == 400
    assert long_note.json()["detail"] == "備註最多 500 字"
    assert not (static_dir / "uploads").exists()


def test_quotation_upload_capability_requires_own_permission_and_scope(signed_env):
    """Owner capability and global scope are independent from Signed Report permissions."""
    make_client, _ = signed_env
    owner = make_client("owner", "user")
    other = make_client("other", "user")
    report = _upload(owner).json()

    item = other.get("/api/quotation-uploads").json()["items"][0]
    assert item["can_edit"] is False
    assert item["can_delete"] is False
    assert other.patch(f"/api/quotation-uploads/{report['id']}", json={"note": "blocked"}).status_code == 403
    assert other.delete(f"/api/quotation-uploads/{report['id']}").status_code == 403

    _set_user_permission("other", "quotation-upload-manage-all", 1)
    item = other.get("/api/quotation-uploads").json()["items"][0]
    assert item["can_edit"] is True
    assert item["can_delete"] is True
    assert other.patch(f"/api/quotation-uploads/{report['id']}", json={"note": "allowed"}).status_code == 200
    assert other.delete(f"/api/quotation-uploads/{report['id']}").status_code == 200


def test_quotation_upload_scope_cannot_replace_manage_capability(signed_env):
    """Global scope without manage capability cannot mutate another owner's upload."""
    make_client, _ = signed_env
    owner = make_client("owner", "user")
    other = make_client("other", "user")
    report = _upload(owner).json()
    _set_user_permission("other", "quotation-upload-manage", 0)
    _set_user_permission("other", "quotation-upload-manage-all", 1)

    item = other.get("/api/quotation-uploads").json()["items"][0]
    assert item["can_edit"] is False
    assert item["can_delete"] is False
    assert other.patch(f"/api/quotation-uploads/{report['id']}", json={"note": "blocked"}).status_code == 403
    assert other.delete(f"/api/quotation-uploads/{report['id']}").status_code == 403


def test_quotation_upload_manage_and_scope_allow_cross_owner_mutations(signed_env):
    """Both capability and global scope are required for cross-owner mutations."""
    make_client, _ = signed_env
    owner = make_client("owner", "user")
    other = make_client("other", "user")
    report = _upload(owner).json()
    _set_user_permission("other", "quotation-upload-manage", 1)
    _set_user_permission("other", "quotation-upload-manage-all", 1)

    item = other.get("/api/quotation-uploads").json()["items"][0]
    assert item["can_edit"] is True
    assert item["can_delete"] is True
    assert other.patch(f"/api/quotation-uploads/{report['id']}", json={"note": "allowed"}).status_code == 200
    assert other.delete(f"/api/quotation-uploads/{report['id']}").status_code == 200


def test_quotation_upload_owner_without_manage_capability_is_denied(signed_env):
    """Ownership supplies scope only; it cannot replace the manage capability."""
    make_client, _ = signed_env
    owner = make_client("owner", "user")
    report = _upload(owner).json()
    _set_user_permission("owner", "quotation-upload-manage", 0)
    _set_user_permission("owner", "quotation-upload-manage-all", 0)

    item = owner.get("/api/quotation-uploads").json()["items"][0]
    assert item["can_edit"] is False
    assert item["can_delete"] is False
    assert owner.patch(f"/api/quotation-uploads/{report['id']}", json={"note": "blocked"}).status_code == 403
    assert owner.delete(f"/api/quotation-uploads/{report['id']}").status_code == 403


def test_quotation_upload_global_scope_does_not_use_signed_report_permission(signed_env):
    """Signed Report global permission alone cannot manage quotation uploads."""
    make_client, _ = signed_env
    owner = make_client("owner", "user")
    other = make_client("other", "user")
    report = _upload(owner).json()
    _set_user_permission("other", "signed-report-delete-all", 1)

    item = other.get("/api/quotation-uploads").json()["items"][0]
    assert item["can_edit"] is False
    assert item["can_delete"] is False
    assert other.patch(f"/api/quotation-uploads/{report['id']}", json={"note": "blocked"}).status_code == 403
    assert other.delete(f"/api/quotation-uploads/{report['id']}").status_code == 403


def test_delete_is_limited_to_owner_or_global_permission(signed_env):
    """一般使用者僅可刪自己的檔；管理員可刪所有檔且清除實體檔。"""
    make_client, static_dir = signed_env
    owner = make_client("owner", "user")
    other = make_client("other", "user")
    admin = make_client()

    first = _upload(owner, filename="owner.pdf").json()
    second = _upload(owner, filename="admin-delete.pdf").json()
    files_before = list((static_dir / "uploads" / "quotation_uploads" / "2026-09").iterdir())
    assert len(files_before) == 2

    forbidden = other.delete(f"/api/quotation-uploads/{first['id']}")
    assert forbidden.status_code == 403

    owner_delete = owner.delete(f"/api/quotation-uploads/{first['id']}")
    assert owner_delete.status_code == 200
    assert owner_delete.json() == {"ok": True}

    admin_delete = admin.delete(f"/api/quotation-uploads/{second['id']}")
    assert admin_delete.status_code == 200
    assert not (static_dir / "uploads" / "quotation_uploads" / "2026-09").exists()
    assert admin.get("/api/quotation-uploads").json()["total"] == 0


def test_owner_can_edit_note_and_other_user_cannot(signed_env):
    """報表日期、上傳人與備註可編輯，但只有上傳者或全域權限者可修改。"""
    make_client, _ = signed_env
    owner = make_client("owner", "user")
    other = make_client("other", "user")
    admin = make_client()
    report = _upload(owner).json()

    forbidden = other.patch(
        f"/api/quotation-uploads/{report['id']}", json={"note": "不應被修改"}
    )
    assert forbidden.status_code == 403

    updated = owner.patch(
        f"/api/quotation-uploads/{report['id']}",
        json={
            "report_date": "2026-09-08",
            "uploader_name": "王大明",
            "note": "已更新備註",
        },
    )
    assert updated.status_code == 200
    assert updated.json()["report_date"] == "2026-09-08"
    assert updated.json()["uploader_name"] == "王大明"
    assert updated.json()["note"] == "已更新備註"
    listed_item = owner.get("/api/quotation-uploads").json()["items"][0]
    assert listed_item["report_date"] == "2026-09-08"
    assert listed_item["uploader_name"] == "王大明"
    assert listed_item["note"] == "已更新備註"

    admin_updated = admin.patch(
        f"/api/quotation-uploads/{report['id']}", json={"note": "管理員補充"}
    )
    assert admin_updated.status_code == 200
    assert admin_updated.json()["note"] == "管理員補充"


def test_edit_note_rejects_overlong_value(signed_env):
    """編輯資料仍限制備註最多 500 字，非法輸入回 422/400 而非 500。"""
    make_client, _ = signed_env
    owner = make_client("owner", "user")
    report = _upload(owner).json()
    response = owner.patch(
        f"/api/quotation-uploads/{report['id']}", json={"note": "x" * 501}
    )
    assert response.status_code in (400, 422)


def test_owner_can_edit_all_fields_and_replace_file(signed_env):
    """日期/檔案/上傳人/備註可在同一 PATCH 換檔；舊檔刪、新檔留、單檔殘留。"""
    make_client, static_dir = signed_env
    owner = make_client("owner", "user")
    other = make_client("other", "user")
    admin = make_client()
    report = _upload(owner).json()
    upload_dir = static_dir / "uploads" / "quotation_uploads" / "2026-09"
    old_path = next(upload_dir.iterdir())
    assert old_path.read_bytes() == b"%PDF-signed"

    forbidden = other.patch(
        f"/api/quotation-uploads/{report['id']}",
        data={"note": "不應被修改"},
    )
    assert forbidden.status_code == 403

    updated = owner.patch(
        f"/api/quotation-uploads/{report['id']}",
        data={
            "report_date": "2026-09-08",
            "uploader_name": "王大明",
            "note": "已更新備註",
        },
        files={"file": ("updated.pdf", b"%PDF-updated", "application/pdf")},
    )
    assert updated.status_code == 200
    assert updated.json()["report_date"] == "2026-09-08"
    assert updated.json()["uploader_name"] == "王大明"
    assert updated.json()["note"] == "已更新備註"
    assert updated.json()["file_name"] == "updated.pdf"
    assert updated.json()["file_size"] == len(b"%PDF-updated")
    assert owner.get(f"/api/quotation-uploads/{report['id']}/download").content == b"%PDF-updated"
    stored_files = list(upload_dir.iterdir())
    assert len(stored_files) == 1
    assert stored_files[0].read_bytes() == b"%PDF-updated"
    assert not old_path.exists()

    admin_updated = admin.patch(
        f"/api/quotation-uploads/{report['id']}", json={"note": "管理員補充"}
    )
    assert admin_updated.status_code == 200
    assert admin_updated.json()["note"] == "管理員補充"
    assert admin_updated.json()["file_name"] == "updated.pdf"


def test_edit_rejects_invalid_date_and_extension(signed_env):
    """編輯替換檔案沿用日期格式與副檔名白名單驗證，失敗不動舊檔。"""
    make_client, static_dir = signed_env
    owner = make_client("owner", "user")
    report = _upload(owner).json()
    upload_dir = static_dir / "uploads" / "quotation_uploads" / "2026-09"
    old_path = next(upload_dir.iterdir())

    invalid_date = owner.patch(
        f"/api/quotation-uploads/{report['id']}",
        data={"report_date": "2026/09/08", "uploader_name": "王小明", "note": ""},
    )
    assert invalid_date.status_code == 400
    assert old_path.read_bytes() == b"%PDF-signed"

    invalid_extension = owner.patch(
        f"/api/quotation-uploads/{report['id']}",
        data={"report_date": "2026-09-07", "uploader_name": "王小明", "note": ""},
        files={"file": ("payload.html", b"<script>x</script>", "text/html")},
    )
    assert invalid_extension.status_code == 400
    assert old_path.exists()
    assert len(list(upload_dir.iterdir())) == 1


def test_edit_without_file_keeps_existing_asset(signed_env):
    """只改文字不選新檔，既有實體檔與 metadata 保持不變。"""
    make_client, static_dir = signed_env
    owner = make_client("owner", "user")
    report = _upload(owner).json()
    upload_dir = static_dir / "uploads" / "quotation_uploads" / "2026-09"
    old_path = next(upload_dir.iterdir())

    updated = owner.patch(
        f"/api/quotation-uploads/{report['id']}",
        data={"note": "只改備註"},
    )

    assert updated.status_code == 200
    assert updated.json()["file_name"] == "daily.pdf"
    assert old_path.exists()
    assert old_path.read_bytes() == b"%PDF-signed"
    assert len(list(upload_dir.iterdir())) == 1


def test_edit_keeps_committed_replacement_when_old_cleanup_fails(signed_env, monkeypatch):
    """舊檔清理失敗不可回滾已提交的新檔（只記警告）。"""
    make_client, static_dir = signed_env
    owner = make_client("owner", "user")
    report = _upload(owner).json()

    def fail_cleanup(*args, **kwargs):
        raise OSError("simulated cleanup failure")

    monkeypatch.setattr(quotation_uploads, "delete_asset_files", fail_cleanup)
    updated = owner.patch(
        f"/api/quotation-uploads/{report['id']}",
        data={"note": "新版本"},
        files={"file": ("replacement.pdf", b"%PDF-replacement", "application/pdf")},
    )

    assert updated.status_code == 200
    assert updated.json()["file_name"] == "replacement.pdf"
    assert owner.get(f"/api/quotation-uploads/{report['id']}/download").content == b"%PDF-replacement"
    assert len(list((static_dir / "uploads" / "quotation_uploads" / "2026-09").iterdir())) == 2
