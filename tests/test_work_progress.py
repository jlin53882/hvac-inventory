"""每日工作進度回報 API / storage / RBAC regression tests."""
from concurrent.futures import ThreadPoolExecutor
import io
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

import app.config as app_config
import app.database as app_db
import app.routes.appointments as appointments_route
import app.routes.service_types as service_types_route
import app.routes.work_progress as work_progress
import main as app_main
from app.services.auth import SESSION_COOKIE, create_session


def _png(width=1200, height=600, color=(40, 120, 220)):
    buf = io.BytesIO()
    Image.new("RGB", (width, height), color).save(buf, "PNG")
    return buf.getvalue()


@pytest.fixture()
def wpr_env(tmp_path, monkeypatch):
    db_path = tmp_path / "work_progress.db"
    static_dir = tmp_path / "static"
    upload_dir = static_dir / "uploads"
    upload_dir.mkdir(parents=True)
    monkeypatch.setattr(app_db, "DB_PATH", str(db_path))
    monkeypatch.setattr(app_config, "STATIC_DIR", str(static_dir))
    monkeypatch.setattr(app_config, "UPLOAD_DIR", str(upload_dir))
    monkeypatch.setattr(app_main, "STATIC_DIR", str(static_dir))
    monkeypatch.setattr(work_progress, "STATIC_DIR", str(static_dir))
    app_db.init_db()
    conn = app_db.get_db()
    users = {}
    try:
        for username, role in (("owner", "user"), ("other", "user"), ("viewer", "viewer"), ("tech", "tech"), ("admin", "admin")):
            cur = conn.execute(
                "INSERT INTO users(username,password_hash,display_name,role) VALUES(?,?,?,?)",
                (username, "x", username.title(), role),
            )
            users[username] = cur.lastrowid
        conn.commit()
    finally:
        conn.close()

    def make_client(username="owner"):
        conn = app_db.get_db()
        try:
            token = create_session(conn, users[username])
        finally:
            conn.close()
        client = TestClient(app_main.app, raise_server_exceptions=False)
        client.cookies.set(SESSION_COOKIE, token)
        return client

    yield make_client, users, static_dir, upload_dir


def _appointment(client, *, date="2026-09-18", note="行事曆原備註", assignees=None):
    response = client.post("/api/appointments", json={
        "client_name": "王先生",
        "address": "板橋區文化路 100 號",
        "service_type_id": 1,
        "date": date,
        "start_time": "09:00",
        "end_time": "12:00",
        "note": note,
        "user_ids": assignees or [],
    })
    assert response.status_code == 200, response.text
    return response.json()


def _create(client, appointment_id, *, filename="site.png", data=None, note="完成室內機", uploader_name=None):
    form_data = {"appointment_id": str(appointment_id), "note": note}
    if uploader_name is not None:
        form_data["uploader_name"] = uploader_name
    return client.post(
        "/api/work-progress",
        data=form_data,
        files={"files": (filename, data if data is not None else _png(), "image/png")},
    )


def test_unauthenticated_and_viewer_permissions(wpr_env):
    make_client, _users, _static, _uploads = wpr_env
    public = TestClient(app_main.app, raise_server_exceptions=False)
    assert public.get("/api/work-progress").status_code == 401
    viewer = make_client("viewer")
    assert viewer.get("/api/work-progress").status_code == 200
    assert viewer.post("/api/work-progress", data={"appointment_id": "1"}, files={"files": ("x.png", _png(), "image/png")}).status_code == 403


def test_create_snapshots_without_assignee_and_scoped_photos(wpr_env):
    make_client, _users, _static, uploads = wpr_env
    owner = make_client("owner")
    appointment = _appointment(owner, assignees=[])
    response = _create(owner, appointment["id"], filename="現場照片.png")
    assert response.status_code == 201, response.text
    report = response.json()
    assert report["appointment_id"] == appointment["id"]
    assert report["service_name"] == "保養"
    assert report["appointment_note"] == "行事曆原備註"
    assert report["uploader_name"] == "Owner"
    assert len(report["photos"]) == 1
    asset_id = report["photos"][0]["asset_id"]
    asset_dir = uploads / "work_progress" / "2026-09" / str(report["id"]) / asset_id
    assert (asset_dir / "original.png").exists()
    assert (asset_dir / "preview.jpg").exists()
    assert (asset_dir / "thumbnail.jpg").exists()
    assert asset_dir.parent.parent.name == "2026-09"
    assert owner.get(report["photos"][0]["thumbnail_url"]).status_code == 200
    assert owner.get(report["photos"][0]["preview_url"]).status_code == 200
    download = owner.get(report["photos"][0]["download_url"])
    assert download.status_code == 200
    assert download.headers["content-disposition"].startswith("attachment;")


def test_create_work_progress_without_photos_is_allowed(wpr_env):
    """A report can be created without image uploads."""
    make_client, _users, _static, uploads = wpr_env
    client = make_client("owner")
    appointment = _appointment(client)

    response = client.post(
        "/api/work-progress",
        data={"appointment_id": str(appointment["id"]), "note": "已完成，無照片"},
    )

    assert response.status_code == 201, response.text
    report = response.json()
    assert report["note"] == "已完成，無照片"
    assert report["photos"] == []
    assert report["photo_count"] == 0
    assert not (uploads / "work_progress").exists()


def test_duplicate_appointment_is_conflict_and_only_one_row(wpr_env):
    make_client, _users, _static, _uploads = wpr_env
    client = make_client("owner")
    appointment = _appointment(client)
    assert _create(client, appointment["id"]).status_code == 201
    duplicate = _create(client, appointment["id"], filename="second.png")
    assert duplicate.status_code == 409
    conn = app_db.get_db()
    try:
        assert conn.execute("SELECT COUNT(*) FROM daily_work_progress_reports").fetchone()[0] == 1
    finally:
        conn.close()


def test_create_validation_rejects_note_empty_bad_extension_and_spoof(wpr_env):
    make_client, _users, _static, uploads = wpr_env
    client = make_client("owner")
    appointment = _appointment(client)
    assert _create(client, appointment["id"], filename="bad.pdf").status_code == 400
    assert _create(client, appointment["id"], filename="empty.png", data=b"").status_code == 400
    assert _create(client, appointment["id"], filename="fake.png", data=b"not-an-image").status_code == 400
    assert _create(client, appointment["id"], note="x" * 1001).status_code == 400
    assert not (uploads / "work_progress").exists()


def test_create_and_photo_batch_limits_are_server_enforced(wpr_env, monkeypatch):
    make_client, _users, _static, _uploads = wpr_env
    client = make_client("owner")
    appointment = _appointment(client)
    monkeypatch.setattr(work_progress, "MAX_FILE_BYTES", 4)
    assert _create(client, appointment["id"], data=_png()).status_code == 400
    monkeypatch.setattr(work_progress, "MAX_FILE_BYTES", 10 * 1024 * 1024)
    files = [("files", (f"{i}.png", _png(10, 10), "image/png")) for i in range(21)]
    assert client.post("/api/work-progress", data={"appointment_id": str(appointment["id"])}, files=files).status_code == 400


def test_batch_failure_rolls_back_report_assets_and_directory(wpr_env):
    make_client, _users, _static, uploads = wpr_env
    client = make_client("owner")
    appointment = _appointment(client)
    response = client.post(
        "/api/work-progress",
        data={"appointment_id": str(appointment["id"])},
        files=[
            ("files", ("ok.png", _png(10, 10), "image/png")),
            ("files", ("spoof.jpg", b"not-an-image", "image/jpeg")),
        ],
    )
    assert response.status_code == 400
    conn = app_db.get_db()
    try:
        assert conn.execute("SELECT COUNT(*) FROM daily_work_progress_reports").fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM file_assets").fetchone()[0] == 0
    finally:
        conn.close()
    assert not (uploads / "work_progress").exists()


def test_list_filters_pagination_detail_and_empty_kpi(wpr_env):
    make_client, _users, _static, _uploads = wpr_env
    client = make_client("owner")
    first = _appointment(client, date="2026-09-01", note="第一筆")
    second = _appointment(client, date="2026-09-02", note="第二筆")
    assert _create(client, first["id"], note="管路完成").status_code == 201
    assert _create(client, second["id"], filename="two.png", note="室外機完成").status_code == 201
    listed = client.get("/api/work-progress", params={"q": "室外機", "page": 1, "page_size": 1})
    assert listed.status_code == 200
    assert listed.json()["total"] == 1
    assert listed.json()["items"][0]["report_date"] == "2026-09-02"
    assert client.get("/api/work-progress/1").status_code == 200
    filtered = client.get("/api/work-progress", params={"from_date": "2026-09-01", "to_date": "2026-09-01"})
    assert filtered.json()["total"] == 1
    assert client.get("/api/work-progress", params={"from_date": "bad"}).status_code == 400
    kpi = client.get("/api/work-progress/kpi", params={"month": "2026-09"})
    assert kpi.json()["total"] == 2
    assert kpi.json()["reported"] == 2
    assert kpi.json()["missing"] == 0
    assert kpi.json()["rate"] == 100
    assert client.get("/api/work-progress/kpi", params={"month": "2026-13"}).status_code == 400


def test_report_attribution_includes_created_by_for_list_and_detail(wpr_env):
    make_client, users, _static, _uploads = wpr_env
    owner = make_client("owner")
    appointment = _appointment(owner)
    report = _create(owner, appointment["id"]).json()

    assert report["uploader_user_id"] == users["owner"]
    assert report["uploader_name"] == "Owner"
    assert report["created_by_username"] == "owner"
    assert report["created_by_display_name"] == "Owner"

    listed = owner.get("/api/work-progress").json()["items"][0]
    assert listed["created_by_username"] == "owner"
    assert listed["created_by_display_name"] == "Owner"

    updated = owner.patch(
        f"/api/work-progress/{report['id']}",
        json={"uploader_name": "現場王先生"},
    )
    assert updated.status_code == 200
    assert updated.json()["uploader_name"] == "現場王先生"
    assert updated.json()["uploader_user_id"] == users["owner"]
    assert updated.json()["created_by_username"] == "owner"
    assert updated.json()["created_by_display_name"] == "Owner"


def test_create_uploader_name_contract_and_ownership_protection(wpr_env):
    make_client, users, _static, _uploads = wpr_env
    owner = make_client("owner")
    appointment = _appointment(owner)

    custom = _create(owner, appointment["id"], uploader_name="現場王先生").json()
    assert custom["uploader_name"] == "現場王先生"
    assert custom["uploader_user_id"] == users["owner"]
    assert custom["created_by_username"] == "owner"

    second_appointment = _appointment(owner, date="2026-09-19")
    fallback = _create(owner, second_appointment["id"])
    assert fallback.status_code == 201
    assert fallback.json()["uploader_name"] == "Owner"

    third_appointment = _appointment(owner, date="2026-09-20")
    assert _create(owner, third_appointment["id"], uploader_name="   ").status_code == 400
    fourth_appointment = _appointment(owner, date="2026-09-21")
    assert _create(owner, fourth_appointment["id"], uploader_name="x" * 51).status_code == 400

    fifth_appointment = _appointment(owner, date="2026-09-22")
    spoofed = owner.post(
        "/api/work-progress",
        data={
            "appointment_id": str(fifth_appointment["id"]),
            "uploader_name": "現場王先生",
            "uploader_user_id": "999999",
        },
        files={"files": ("spoofed.png", _png(), "image/png")},
    )
    assert spoofed.status_code == 201
    assert spoofed.json()["uploader_user_id"] == users["owner"]


def test_patch_ignores_calendar_and_owner_fields(wpr_env):
    make_client, users, _static, _uploads = wpr_env
    owner = make_client("owner")
    appointment = _appointment(owner, date="2026-09-20", note="原始行事曆備註")
    report = _create(owner, appointment["id"], note="原始進度").json()

    response = owner.patch(
        f"/api/work-progress/{report['id']}",
        json={
            "uploader_name": "現場王先生",
            "note": "已完成配管",
            "report_date": "2030-01-01",
            "start_time": "00:00",
            "end_time": "23:59",
            "client_name": "假客戶",
            "address": "假地址",
            "service_name": "假服務",
            "appointment_note": "假備註",
            "uploader_user_id": 999999,
        },
    )
    assert response.status_code == 200
    updated = response.json()
    assert updated["report_date"] == "2026-09-20"
    assert updated["start_time"] == report["start_time"]
    assert updated["end_time"] == report["end_time"]
    assert updated["client_name"] == report["client_name"]
    assert updated["address"] == report["address"]
    assert updated["service_name"] == report["service_name"]
    assert updated["appointment_note"] == "原始行事曆備註"
    assert updated["uploader_user_id"] == users["owner"]
    assert updated["uploader_name"] == "現場王先生"
    assert updated["note"] == "已完成配管"


def test_owner_edit_and_photo_lifecycle_non_owner_forbidden(wpr_env):
    make_client, _users, _static, uploads = wpr_env
    owner = make_client("owner")
    other = make_client("other")
    appointment = _appointment(owner)
    report = _create(owner, appointment["id"]).json()
    rid = report["id"]
    asset_id = report["photos"][0]["asset_id"]
    assert other.patch(f"/api/work-progress/{rid}", json={"note": "冒充"}).status_code == 403
    updated = owner.patch(f"/api/work-progress/{rid}", json={"uploader_name": "現場家豪", "note": "已更新"})
    assert updated.status_code == 200
    assert updated.json()["uploader_name"] == "現場家豪"
    assert updated.json()["uploader_user_id"] == report["uploader_user_id"]
    assert updated.json()["note"] == "已更新"
    assert owner.patch(f"/api/work-progress/{rid}", json={"uploader_name": "   "}).status_code == 400
    assert owner.post(f"/api/work-progress/{rid}/photos").status_code == 400
    assert owner.post(f"/api/work-progress/{rid}/photos", files={"files": ("extra.png", _png(10, 10), "image/png")}).status_code == 200
    assert other.delete(f"/api/work-progress/{rid}/photos/{asset_id}").status_code == 403
    assert owner.delete(f"/api/work-progress/{rid}/photos/{asset_id}").status_code == 200
    assert not (uploads / "work_progress" / "2026-09" / str(rid) / asset_id).exists()
    assert owner.get(f"/api/work-progress/{rid}/photos/{asset_id}/thumbnail").status_code == 404


def test_work_progress_batch_delete_is_scoped_and_atomic(wpr_env):
    """A mixed-report batch must reject every asset and preserve all files/rows."""
    make_client, _users, _static, uploads = wpr_env
    client = make_client("owner")
    first = _appointment(client, date="2026-09-10")
    second = _appointment(client, date="2026-09-11")
    report_a = _create(client, first["id"]).json()
    report_b = _create(client, second["id"], filename="two.png").json()
    asset_a = report_a["photos"][0]["asset_id"]
    asset_b = report_b["photos"][0]["asset_id"]
    before = sorted(path.relative_to(uploads).as_posix() for path in uploads.rglob("*"))

    response = client.post(
        f"/api/work-progress/{report_a['id']}/photos/batch-delete",
        json={"asset_ids": [asset_a, asset_b]},
    )

    assert response.status_code == 404
    assert client.get(f"/api/work-progress/{report_a['id']}").json()["photos"][0]["asset_id"] == asset_a
    assert client.get(f"/api/work-progress/{report_b['id']}").json()["photos"][0]["asset_id"] == asset_b
    assert sorted(path.relative_to(uploads).as_posix() for path in uploads.rglob("*")) == before


def test_work_progress_batch_delete_removes_multiple_assets_with_one_request(wpr_env):
    """A valid batch deletes all selected variants and reports authoritative counts."""
    make_client, _users, _static, uploads = wpr_env
    client = make_client("owner")
    appointment = _appointment(client)
    created = client.post(
        "/api/work-progress", data={"appointment_id": str(appointment["id"])},
        files=[("files", (f"photo-{index}.png", _png(10, 10), "image/png")) for index in range(3)],
    ).json()
    selected = [photo["asset_id"] for photo in created["photos"][:2]]

    response = client.post(
        f"/api/work-progress/{created['id']}/photos/batch-delete",
        json={"asset_ids": selected},
    )

    assert response.status_code == 200
    assert response.json() == {"ok": True, "deleted_count": 2, "remaining_count": 1}
    remaining = client.get(f"/api/work-progress/{created['id']}").json()
    assert len(remaining["photos"]) == 1
    for asset_id in selected:
        assert not (uploads / "work_progress" / "2026-09" / str(created["id"]) / asset_id).exists()


def test_work_progress_batch_delete_rejects_duplicates_and_permission(wpr_env):
    """Duplicate IDs and non-owner mutation attempts cannot alter photo rows."""
    make_client, _users, _static, _uploads = wpr_env
    owner = make_client("owner")
    other = make_client("other")
    appointment = _appointment(owner)
    report = _create(owner, appointment["id"]).json()
    asset_id = report["photos"][0]["asset_id"]
    path = f"/api/work-progress/{report['id']}/photos/batch-delete"

    assert owner.post(path, json={"asset_ids": [asset_id, asset_id]}).status_code == 422
    assert other.post(path, json={"asset_ids": [asset_id]}).status_code == 403
    assert owner.get(f"/api/work-progress/{report['id']}").json()["photo_count"] == 1


def test_work_progress_batch_delete_restores_files_when_staging_fails(wpr_env, monkeypatch):
    """A filesystem staging failure leaves both DB rows and files unchanged."""
    make_client, _users, _static, uploads = wpr_env
    client = make_client("owner")
    appointment = _appointment(client)
    report = client.post(
        "/api/work-progress", data={"appointment_id": str(appointment["id"])},
        files=[("files", (f"photo-{index}.png", _png(10, 10), "image/png")) for index in range(2)],
    ).json()
    asset_ids = [photo["asset_id"] for photo in report["photos"]]
    before = sorted(path.relative_to(uploads).as_posix() for path in uploads.rglob("*"))
    original_replace = work_progress.os.replace
    calls = {"count": 0}

    def fail_on_second(source, destination):
        calls["count"] += 1
        if calls["count"] == 2:
            raise OSError("simulated storage failure")
        return original_replace(source, destination)

    monkeypatch.setattr(work_progress.os, "replace", fail_on_second)
    response = client.post(
        f"/api/work-progress/{report['id']}/photos/batch-delete",
        json={"asset_ids": asset_ids},
    )

    assert response.status_code == 500
    assert client.get(f"/api/work-progress/{report['id']}").json()["photo_count"] == 2
    assert sorted(path.relative_to(uploads).as_posix() for path in uploads.rglob("*")) == before



def test_restore_staged_deletions_attempts_all_and_preserves_failed_backup(tmp_path, monkeypatch):
    """A restore failure must not prevent later files and must retain recovery material."""
    source_failed = tmp_path / "failed.jpg"
    source_later = tmp_path / "later.jpg"
    backup_failed = tmp_path / "staging" / "failed.jpg"
    backup_later = tmp_path / "staging" / "later.jpg"
    backup_failed.parent.mkdir()
    backup_failed.write_bytes(b"failed")
    backup_later.write_bytes(b"later")
    calls = []
    original_replace = work_progress.os.replace

    def fail_one(source, destination):
        calls.append((Path(source), Path(destination)))
        if Path(source) == backup_failed:
            raise OSError("simulated restore failure")
        return original_replace(source, destination)

    monkeypatch.setattr(work_progress.os, "replace", fail_one)
    with pytest.raises(OSError, match="failed to restore 1 staged"):
        work_progress._restore_staged_deletions([
            (source_failed, backup_failed),
            (source_later, backup_later),
        ])

    assert source_later.read_bytes() == b"later"
    assert backup_failed.read_bytes() == b"failed"
    assert len(calls) == 2


def test_unrelated_asset_cannot_be_read_or_deleted(wpr_env):
    make_client, _users, _static, _uploads = wpr_env
    client = make_client("owner")
    first = _appointment(client, date="2026-09-10")
    second = _appointment(client, date="2026-09-11")
    one = _create(client, first["id"]).json()
    two = _create(client, second["id"], filename="two.png").json()
    asset_id = one["photos"][0]["asset_id"]
    other_report_id = two["id"]
    assert client.get(f"/api/work-progress/{other_report_id}/photos/{asset_id}/thumbnail").status_code == 404
    assert client.delete(f"/api/work-progress/{other_report_id}/photos/{asset_id}").status_code == 404


def test_edit_all_and_delete_all_permissions(wpr_env):
    make_client, _users, _static, _uploads = wpr_env
    owner = make_client("owner")
    admin = TestClient(app_main.app, raise_server_exceptions=False)
    conn = app_db.get_db()
    try:
        admin_id = conn.execute("INSERT INTO users(username,password_hash,display_name,role) VALUES('admin2','x','Admin 2','admin')").lastrowid
        conn.commit()
        token = create_session(conn, admin_id)
    finally:
        conn.close()
    admin.cookies.set(SESSION_COOKIE, token)
    appointment = _appointment(owner)
    report = _create(owner, appointment["id"]).json()
    assert admin.patch(f"/api/work-progress/{report['id']}", json={"note": "管理員補充"}).status_code == 200
    assert admin.delete(f"/api/work-progress/{report['id']}").status_code == 200


def test_work_progress_per_user_create_override_is_immediate(wpr_env):
    """同一 viewer session 的 create override 開關必須立即影響 POST。"""
    make_client, users, _static, _uploads = wpr_env
    admin = make_client("admin")
    owner = make_client("owner")
    viewer = make_client("viewer")
    first = _appointment(owner, date="2026-09-18")
    assert viewer.post(
        "/api/work-progress", data={"appointment_id": str(first["id"])},
        files={"files": ("viewer.png", _png(10, 10), "image/png")},
    ).status_code == 403
    assert admin.put(
        f"/api/users/{users['viewer']}/permissions",
        json={"permissions": {"work-progress-create": 1}},
    ).status_code == 200
    assert viewer.post(
        "/api/work-progress", data={"appointment_id": str(first["id"])},
        files={"files": ("viewer.png", _png(10, 10), "image/png")},
    ).status_code == 201
    second = _appointment(owner, date="2026-09-19")
    assert admin.put(
        f"/api/users/{users['viewer']}/permissions",
        json={"permissions": {"work-progress-create": 0}},
    ).status_code == 200
    assert viewer.post(
        "/api/work-progress", data={"appointment_id": str(second["id"])},
        files={"files": ("viewer2.png", _png(10, 10), "image/png")},
    ).status_code == 403


def test_work_progress_edit_delete_overrides_update_flags_and_mutations(wpr_env):
    """本人與全域 edit/delete override 同步影響 response flags 和 mutation。"""
    make_client, users, _static, _uploads = wpr_env
    admin = make_client("admin")
    owner = make_client("owner")
    other = make_client("other")
    appointment = _appointment(owner)
    report = _create(owner, appointment["id"]).json()
    assert owner.get(f"/api/work-progress/{report['id']}").json()["can_edit"] is True
    assert owner.get(f"/api/work-progress/{report['id']}").json()["can_delete"] is True
    assert admin.put(
        f"/api/users/{users['owner']}/permissions",
        json={"permissions": {"work-progress-edit": 0, "work-progress-delete": 0}},
    ).status_code == 200
    flags = owner.get(f"/api/work-progress/{report['id']}").json()
    assert flags["can_edit"] is False and flags["can_delete"] is False
    assert owner.patch(f"/api/work-progress/{report['id']}", json={"note": "拒絕"}).status_code == 403
    assert owner.delete(f"/api/work-progress/{report['id']}").status_code == 403
    assert other.get(f"/api/work-progress/{report['id']}").json()["can_edit"] is False
    assert admin.put(
        f"/api/users/{users['other']}/permissions",
        json={"permissions": {"work-progress-edit-all": 1}},
    ).status_code == 200
    assert other.get(f"/api/work-progress/{report['id']}").json()["can_edit"] is True
    assert other.patch(f"/api/work-progress/{report['id']}", json={"note": "全域編輯"}).status_code == 200
    assert admin.put(
        f"/api/users/{users['other']}/permissions",
        json={"permissions": {"work-progress-delete-all": 1}},
    ).status_code == 200
    assert other.get(f"/api/work-progress/{report['id']}").json()["can_delete"] is True
    assert other.delete(f"/api/work-progress/{report['id']}").status_code == 200


def test_work_progress_non_owner_photo_append_follows_edit_semantics(wpr_env):
    """非本人不可新增照片；edit-all 可新增照片。"""
    make_client, users, _static, _uploads = wpr_env
    owner = make_client("owner")
    other = make_client("other")
    admin = make_client("admin")
    appointment = _appointment(owner)
    report = _create(owner, appointment["id"]).json()
    path = f"/api/work-progress/{report['id']}/photos"
    assert other.post(path, files={"files": ("blocked.png", _png(10, 10), "image/png")}).status_code == 403
    assert admin.put(
        f"/api/users/{users['other']}/permissions",
        json={"permissions": {"work-progress-edit-all": 1}},
    ).status_code == 200
    assert other.post(path, files={"files": ("allowed.png", _png(10, 10), "image/png")}).status_code == 200


def test_work_progress_calendar_sync_crosses_month_and_recomputes_kpi(wpr_env):
    """工作日期跨月同步後，history range 與 KPI 以新月份為準。"""
    make_client, _users, _static, _uploads = wpr_env
    owner = make_client("owner")
    moved = _appointment(owner, date="2026-09-30")
    stays = _appointment(owner, date="2026-09-29")
    report = _create(owner, moved["id"]).json()
    assert owner.put(f"/api/appointments/{moved['id']}", json={
        "client_name": "王先生", "address": "板橋區文化路 100 號", "service_type_id": 1,
        "date": "2026-10-01", "start_time": "09:00", "end_time": "12:00",
        "note": "跨月後備註", "user_ids": [], "updated_at": moved["updated_at"],
    }).status_code == 200
    assert owner.get("/api/work-progress", params={"from_date": "2026-09-01", "to_date": "2026-09-30"}).json()["total"] == 0
    assert owner.get("/api/work-progress", params={"from_date": "2026-10-01", "to_date": "2026-10-31"}).json()["total"] == 1
    september = owner.get("/api/work-progress/kpi", params={"month": "2026-09"}).json()
    october = owner.get("/api/work-progress/kpi", params={"month": "2026-10"}).json()
    assert september == {"month": "2026-09", "total": 1, "reported": 0, "missing": 1, "rate": 0, "photo_count": 0}
    assert october == {"month": "2026-10", "total": 1, "reported": 1, "missing": 0, "rate": 100, "photo_count": 1}
    assert owner.get(f"/api/work-progress/{report['id']}").json()["report_date"] == "2026-10-01"
    assert stays["date"] == "2026-09-29"


def test_work_progress_service_clear_removes_old_snapshot(wpr_env):
    """行事曆清空服務後，snapshot 不保留舊服務名稱。"""
    make_client, _users, _static, _uploads = wpr_env
    owner = make_client("owner")
    appointment = _appointment(owner)
    report = _create(owner, appointment["id"]).json()
    updated = owner.put(f"/api/appointments/{appointment['id']}", json={
        "client_name": "王先生", "address": "板橋區文化路 100 號", "service_type_id": None,
        "date": appointment["date"], "start_time": "09:00", "end_time": "12:00",
        "note": appointment["note"], "user_ids": [], "updated_at": appointment["updated_at"],
    })
    assert updated.status_code == 200, updated.text
    assert owner.get(f"/api/work-progress/{report['id']}").json()["service_name"] == ""


def test_delete_report_cleans_db_assets_and_report_folder(wpr_env):
    make_client, _users, _static, uploads = wpr_env
    client = make_client("owner")
    appointment = _appointment(client)
    report = _create(client, appointment["id"]).json()
    report_dir = uploads / "work_progress" / "2026-09" / str(report["id"])
    assert report_dir.exists()
    assert client.delete(f"/api/work-progress/{report['id']}").status_code == 200
    assert not report_dir.exists()
    conn = app_db.get_db()
    try:
        assert conn.execute("SELECT 1 FROM daily_work_progress_reports WHERE id=?", (report["id"],)).fetchone() is None
        assert conn.execute("SELECT 1 FROM file_assets WHERE owner_id=?", (str(report["id"],))).fetchone() is None
    finally:
        conn.close()


def test_appointment_update_syncs_calendar_snapshot_and_preserves_report_data(wpr_env):
    make_client, users, _static, uploads = wpr_env
    owner = make_client("owner")
    appointment = _appointment(owner, date="2026-09-20", note="原始行事曆備註")
    report = _create(owner, appointment["id"], note="已完成安裝").json()
    report_created_at = report["created_at"]
    report_updated_at = report["updated_at"]

    conn = app_db.get_db()
    try:
        service_id = conn.execute(
            "INSERT INTO service_types(name, sort_order, is_active) VALUES(?,?,?)",
            ("新服務 B", 99, 1),
        ).lastrowid
        conn.commit()
    finally:
        conn.close()

    updated = owner.put(f"/api/appointments/{appointment['id']}", json={
        "client_name": "新客戶",
        "address": "新地址",
        "service_type_id": service_id,
        "date": "2026-09-21",
        "start_time": "13:00",
        "end_time": "15:00",
        "note": "更新後行事曆備註",
        "user_ids": [],
        "updated_at": appointment["updated_at"],
    })
    assert updated.status_code == 200, updated.text

    detail = owner.get(f"/api/work-progress/{report['id']}").json()
    assert detail["report_date"] == "2026-09-21"
    assert detail["client_name"] == "新客戶"
    assert detail["address"] == "新地址"
    assert detail["service_name"] == "新服務 B"
    assert detail["start_time"] == "13:00"
    assert detail["end_time"] == "15:00"
    assert detail["appointment_note"] == "更新後行事曆備註"
    assert detail["note"] == "已完成安裝"
    assert detail["uploader_name"] == "Owner"
    assert detail["uploader_user_id"] == users["owner"]
    assert detail["created_at"] == report_created_at
    assert detail["updated_at"] == report_updated_at

    conn = app_db.get_db()
    try:
        assert conn.execute(
            "SELECT COUNT(*) FROM file_assets WHERE owner_id=?", (str(report["id"]),)
        ).fetchone()[0] == 1
    finally:
        conn.close()


def test_appointment_update_snapshot_sync_rolls_back_atomically(wpr_env, monkeypatch):
    make_client, _users, _static, _uploads = wpr_env
    owner = make_client("owner")
    appointment = _appointment(owner, date="2026-09-20", note="原始備註")
    report = _create(owner, appointment["id"]).json()

    def fail_sync(conn, appointment_id):
        raise RuntimeError("snapshot sync failure")

    monkeypatch.setattr(
        appointments_route,
        "sync_work_progress_snapshot_for_appointment",
        fail_sync,
    )
    response = owner.put(f"/api/appointments/{appointment['id']}", json={
        "client_name": "不應提交",
        "address": "不應提交地址",
        "service_type_id": 1,
        "date": "2026-09-22",
        "start_time": "16:00",
        "end_time": "18:00",
        "note": "不應提交備註",
        "user_ids": [],
    })
    assert response.status_code == 500

    current = owner.get(f"/api/appointments?date=2026-09-20").json()
    assert current[0]["client_name"] == "王先生"
    assert current[0]["address"] == "板橋區文化路 100 號"
    detail = owner.get(f"/api/work-progress/{report['id']}").json()
    assert detail["report_date"] == "2026-09-20"
    assert detail["client_name"] == "王先生"
    assert detail["appointment_note"] == "原始備註"
    assert detail["note"] == "完成室內機"


def test_service_type_rename_syncs_existing_snapshots_and_preserves_report_fields(wpr_env):
    """服務項目改名同步 Calendar snapshot，但不碰 Work Progress-owned 欄位。"""
    make_client, _users, _static, _uploads = wpr_env
    owner = make_client("owner")
    admin = make_client("admin")
    appointment_a = _appointment(owner, date="2026-09-24")
    appointment_b = _appointment(owner, date="2026-09-25")
    appointment_without_report = _appointment(owner, date="2026-09-26")
    report_a = _create(
        owner,
        appointment_a["id"],
        uploader_name="現場王先生",
        note="已完成室內機",
    ).json()
    report_b = _create(owner, appointment_b["id"], note="已完成配管").json()
    before_a = owner.get(f"/api/work-progress/{report_a['id']}").json()
    before_b = owner.get(f"/api/work-progress/{report_b['id']}").json()

    renamed = admin.put("/api/service-types/1", json={
        "name": "冷氣保養", "sort_order": 1, "is_active": 1,
    })
    assert renamed.status_code == 200, renamed.text
    assert owner.get(f"/api/appointments?date=2026-09-24").json()[0]["service_name"] == "冷氣保養"

    after_a = owner.get(f"/api/work-progress/{report_a['id']}").json()
    after_b = owner.get(f"/api/work-progress/{report_b['id']}").json()
    for before, after in ((before_a, after_a), (before_b, after_b)):
        assert after["service_name"] == "冷氣保養"
        for field in ("uploader_name", "uploader_user_id", "note", "report_date", "created_at", "updated_at"):
            assert after[field] == before[field]
        assert [photo["asset_id"] for photo in after["photos"]] == [
            photo["asset_id"] for photo in before["photos"]
        ]
    conn = app_db.get_db()
    try:
        assert conn.execute(
            "SELECT COUNT(*) FROM daily_work_progress_reports WHERE appointment_id=?",
            (appointment_without_report["id"],),
        ).fetchone()[0] == 0
    finally:
        conn.close()


def test_service_type_rename_rolls_back_when_snapshot_sync_fails(wpr_env, monkeypatch):
    """服務項目改名的 snapshot 同步失敗時，整個 service rename 必須 rollback。"""
    make_client, _users, _static, _uploads = wpr_env
    owner = make_client("owner")
    admin = make_client("admin")
    appointment = _appointment(owner, date="2026-09-27")
    report = _create(owner, appointment["id"]).json()

    def fail_sync(conn, appointment_id):
        raise RuntimeError("snapshot sync failure")

    monkeypatch.setattr(service_types_route, "sync_work_progress_snapshot_for_appointment", fail_sync)
    response = admin.put("/api/service-types/1", json={
        "name": "不應提交", "sort_order": 1, "is_active": 1,
    })
    assert response.status_code == 500
    assert admin.get("/api/service-types").json()[0]["name"] == "保養"
    assert owner.get(f"/api/work-progress/{report['id']}").json()["service_name"] == "保養"


def test_service_type_rename_does_not_update_detached_work_progress_snapshot(wpr_env):
    """已刪除 appointment 的 frozen snapshot 不受服務項目改名影響。"""
    make_client, _users, _static, _uploads = wpr_env
    owner = make_client("owner")
    admin = make_client("admin")
    appointment = _appointment(owner, date="2026-09-28")
    report = _create(owner, appointment["id"]).json()
    assert owner.delete(f"/api/appointments/{appointment['id']}").status_code == 200

    renamed = admin.put("/api/service-types/1", json={
        "name": "冷氣保養", "sort_order": 1, "is_active": 1,
    })
    assert renamed.status_code == 200
    detail = owner.get(f"/api/work-progress/{report['id']}").json()
    assert detail["appointment_id"] is None
    assert detail["service_name"] == "保養"


def test_appointment_delete_preserves_snapshot_history(wpr_env):
    make_client, _users, _static, _uploads = wpr_env
    client = make_client("owner")
    appointment = _appointment(client)
    report = _create(client, appointment["id"]).json()
    updated = client.put(f"/api/appointments/{appointment['id']}", json={
        "client_name": "刪除前最後客戶",
        "address": "刪除前最後地址",
        "service_type_id": 1,
        "date": "2026-09-23",
        "start_time": "11:00",
        "end_time": "12:00",
        "note": "刪除前最後備註",
        "user_ids": [],
    })
    assert updated.status_code == 200, updated.text
    assert client.delete(f"/api/appointments/{appointment['id']}").status_code == 200
    detail = client.get(f"/api/work-progress/{report['id']}")
    assert detail.status_code == 200
    assert detail.json()["appointment_id"] is None
    assert detail.json()["appointment_deleted"] is True
    assert detail.json()["client_name"] == "刪除前最後客戶"
    assert detail.json()["address"] == "刪除前最後地址"
    assert detail.json()["report_date"] == "2026-09-23"
    assert detail.json()["appointment_note"] == "刪除前最後備註"
    assert detail.json()["note"] == "完成室內機"
    assert len(detail.json()["photos"]) == 1
    assert detail.json()["uploader_user_id"] is not None
    assert detail.json()["uploader_name"] == "Owner"
    assert client.get("/api/work-progress/kpi", params={"month": "2026-09"}).json()["total"] == 0


def test_tech_can_create_edit_delete_own_report(wpr_env):
    make_client, _users, _static, _uploads = wpr_env
    tech = make_client("tech")
    appointment = _appointment(tech)
    report = _create(tech, appointment["id"]).json()
    assert report["can_edit"] is True
    assert tech.patch(f"/api/work-progress/{report['id']}", json={"note": "技師更新"}).status_code == 200
    assert tech.delete(f"/api/work-progress/{report['id']}").status_code == 200


def test_report_total_photo_limit_is_enforced_under_concurrent_append(wpr_env):
    make_client, _users, _static, _uploads = wpr_env
    client = make_client("owner")
    appointment = _appointment(client)
    initial_files = [
        ("files", (f"initial-{i}.png", _png(10, 10), "image/png"))
        for i in range(19)
    ]
    created = client.post(
        "/api/work-progress",
        data={"appointment_id": str(appointment["id"])},
        files=initial_files,
    )
    assert created.status_code == 201, created.text
    report = created.json()
    assert len(report["photos"]) == 19

    def append_once(index):
        other_client = make_client("owner")
        return other_client.post(
            f"/api/work-progress/{report['id']}/photos",
            files={"files": (f"append-{index}.png", _png(10, 10), "image/png")},
        ).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = list(pool.map(append_once, (1, 2)))
    assert sorted(statuses) == [200, 400]
    detail = client.get(f"/api/work-progress/{report['id']}")
    assert detail.status_code == 200
    assert len(detail.json()["photos"]) == work_progress.MAX_FILES


def test_report_and_appointment_ids_are_distinct_and_detail_uses_report_id(wpr_env):
    make_client, _users, _static, _uploads = wpr_env
    client = make_client("owner")
    appointments = [_appointment(client) for _ in range(10)]
    appointment = appointments[-1]
    created = _create(client, appointment["id"])
    assert created.status_code == 201, created.text
    report = created.json()
    assert report["id"] != appointment["id"]
    assert report["appointment_id"] == appointment["id"]
    detail = client.get(f"/api/work-progress/{report['id']}")
    assert detail.status_code == 200
    assert detail.json()["id"] == report["id"]
    assert detail.json()["appointment_id"] == appointment["id"]
    assert client.get(f"/api/work-progress/{appointment['id']}").status_code == 404


def test_duplicate_concurrent_create_has_one_success_and_one_conflict(wpr_env):
    make_client, _users, _static, _uploads = wpr_env
    setup = make_client("owner")
    appointment = _appointment(setup)

    def post_once(index):
        client = make_client("owner")
        return _create(client, appointment["id"], filename=f"race{index}.png").status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = list(pool.map(post_once, (1, 2)))
    assert sorted(statuses) == [201, 409]
    conn = app_db.get_db()
    try:
        assert conn.execute("SELECT COUNT(*) FROM daily_work_progress_reports WHERE appointment_id=?", (appointment["id"],)).fetchone()[0] == 1
        assert conn.execute("SELECT COUNT(*) FROM file_assets WHERE category='work_progress'").fetchone()[0] == 1
    finally:
        conn.close()


def test_work_progress_view_revocation_is_immediate_for_existing_session(wpr_env):
    make_client, users, _static, _uploads = wpr_env
    owner = make_client("owner")
    appointment = _appointment(owner)
    report = _create(owner, appointment["id"]).json()
    asset_id = report["photos"][0]["asset_id"]

    conn = app_db.get_db()
    try:
        perm_id = conn.execute(
            "SELECT id FROM permissions WHERE key='work-progress-view'"
        ).fetchone()["id"]
        conn.execute(
            "INSERT INTO user_permissions(user_id, permission_id, value) VALUES(?,?,0)",
            (users["owner"], perm_id),
        )
        conn.commit()
    finally:
        conn.close()

    # Same cookie/session must not retain the permission from authentication time.
    assert owner.get("/api/work-progress").status_code == 403
    assert owner.get(f"/api/work-progress/{report['id']}").status_code == 403
    assert owner.get(
        f"/api/work-progress/{report['id']}/photos/{asset_id}/thumbnail"
    ).status_code == 403


def test_work_progress_batch_append_limit_is_atomic(wpr_env):
    """既有 19 張時一次追加 2 張必須整批拒絕且不留檔案。"""
    make_client, _users, _static, uploads = wpr_env
    client = make_client("owner")
    appointment = _appointment(client)
    created = client.post(
        "/api/work-progress", data={"appointment_id": str(appointment["id"])},
        files=[("files", (f"initial-{i}.png", _png(10, 10), "image/png")) for i in range(19)],
    ).json()
    report_dir = uploads / "work_progress" / "2026-09" / str(created["id"])
    before = sorted(path.relative_to(report_dir).as_posix() for path in report_dir.rglob("*"))
    response = client.post(
        f"/api/work-progress/{created['id']}/photos",
        files=[
            ("files", ("extra-a.png", _png(10, 10), "image/png")),
            ("files", ("extra-b.png", _png(10, 10), "image/png")),
        ],
    )
    assert response.status_code == 400
    assert len(client.get(f"/api/work-progress/{created['id']}").json()["photos"]) == 19
    assert sorted(path.relative_to(report_dir).as_posix() for path in report_dir.rglob("*")) == before


def test_work_progress_append_partial_failure_rolls_back_files_and_rows(wpr_env):
    """既有 report 追加 batch 中有壞檔時，DB 與 filesystem 都維持原狀。"""
    make_client, _users, _static, uploads = wpr_env
    client = make_client("owner")
    appointment = _appointment(client)
    created = _create(client, appointment["id"]).json()
    report_dir = uploads / "work_progress" / "2026-09" / str(created["id"])
    before_assets = len(created["photos"])
    before_paths = sorted(path.relative_to(report_dir).as_posix() for path in report_dir.rglob("*"))
    response = client.post(
        f"/api/work-progress/{created['id']}/photos",
        files=[
            ("files", ("valid.png", _png(10, 10), "image/png")),
            ("files", ("spoof.jpg", b"not-an-image", "image/jpeg")),
        ],
    )
    assert response.status_code == 400
    assert len(client.get(f"/api/work-progress/{created['id']}").json()["photos"]) == before_assets
    after_paths = sorted(path.relative_to(report_dir).as_posix() for path in report_dir.rglob("*"))
    assert after_paths == before_paths
    conn = app_db.get_db()
    try:
        asset_count = conn.execute(
            "SELECT COUNT(*) FROM file_assets WHERE category='work_progress' AND owner_id=?",
            (str(created["id"]),),
        ).fetchone()[0]
    finally:
        conn.close()
    assert asset_count == before_assets


def test_work_progress_creator_display_name_is_live_but_reporter_name_is_snapshot(wpr_env):
    """帳號顯示名稱 live 更新；工作回報人顯示名稱仍由 report 自己管理。"""
    make_client, users, _static, _uploads = wpr_env
    admin = make_client("admin")
    owner = make_client("owner")
    appointment = _appointment(owner)
    report = _create(owner, appointment["id"]).json()
    assert owner.patch(f"/api/work-progress/{report['id']}", json={"uploader_name": "現場王先生"}).status_code == 200
    renamed = admin.put(f"/api/users/{users['owner']}", json={"display_name": "新家豪"})
    assert renamed.status_code == 200, renamed.text
    detail = owner.get(f"/api/work-progress/{report['id']}").json()
    assert detail["created_by_display_name"] == "新家豪"
    assert detail["created_by_username"] == "owner"
    assert detail["uploader_user_id"] == users["owner"]
    assert detail["uploader_name"] == "現場王先生"


def test_generic_media_endpoint_cannot_bypass_work_progress_owner_scope(wpr_env):
    make_client, _users, _static, _uploads = wpr_env
    owner = make_client("owner")
    viewer = make_client("viewer")
    appointment = _appointment(owner)
    report = _create(owner, appointment["id"]).json()
    asset_id = report["photos"][0]["asset_id"]

    # Even a viewer with work-progress-view cannot use the generic asset route;
    # only the report-scoped endpoint may validate work-progress ownership.
    assert viewer.get(f"/media/{asset_id}/thumbnail").status_code == 404
    assert owner.get(f"/api/work-progress/{report['id']}/photos/{asset_id}/thumbnail").status_code == 200


def test_work_progress_photo_variants_are_private_cached(wpr_env):
    make_client, _users, _static, _uploads = wpr_env
    owner = make_client("owner")
    appointment = _appointment(owner)
    report = _create(owner, appointment["id"]).json()
    asset_id = report["photos"][0]["asset_id"]

    for variant in ("thumbnail", "preview"):
        response = owner.get(
            f"/api/work-progress/{report['id']}/photos/{asset_id}/{variant}"
        )
        assert response.status_code == 200
        assert response.headers["cache-control"] == "private, max-age=86400"


def test_export_work_progress_one_sheet_per_report_with_photos_and_multiline_notes(wpr_env):
    """匯出：每筆回報一個工作表、標楷體、備註換行留在同一格、照片依張數嵌入。"""
    from openpyxl import load_workbook

    make_client, _users, _static, _uploads = wpr_env
    client = make_client("owner")
    first = _appointment(client, date="2026-11-03", note="裝出風口_蘇\n下午 冰水主機_藍")
    second = _appointment(client, date="2026-11-03")
    r1 = client.post(
        "/api/work-progress",
        data={"appointment_id": str(first["id"]), "note": "測試A\r\n測試B"},
        files=[("files", (f"p{i}.png", _png(600, 800) if i % 2 else _png(), "image/png")) for i in range(5)],
    )
    assert r1.status_code == 201, r1.text
    r2 = client.post("/api/work-progress", data={"appointment_id": str(second["id"]), "note": "無照片"})
    assert r2.status_code == 201, r2.text

    response = client.get("/api/work-progress/export", params={"date": "2026-11-03"})
    assert response.status_code == 200, response.text
    assert "spreadsheetml" in response.headers["content-type"]
    wb = load_workbook(io.BytesIO(response.content))
    assert len(wb.sheetnames) == 2
    assert len(set(wb.sheetnames)) == 2  # 同客戶名稱也不會重名
    ws = wb[wb.sheetnames[0]]
    assert ws["A1"].value == "保養．王先生"  # 標題不含日期
    assert ws["A8"].value == "工作進度回報" and ws["C6"].value == "行事曆備註"
    assert ws["A9"].value == "測試A\n測試B"
    assert ws["C7"].value == "裝出風口_蘇\n下午 冰水主機_藍"
    assert ws["C5"].value == "09:00"
    assert ws["A9"].alignment.wrap_text and ws["C7"].alignment.wrap_text
    assert {"A9:A10", "C7:C8"} <= {str(r) for r in ws.merged_cells.ranges}
    assert len(ws._images) == 5
    assert len({(i.width, i.height) for i in ws._images}) == 1  # 橫、直式照片都裁成相同大小
    assert all(i.width == i.height for i in ws._images)
    assert ws["A1"].font.name == "標楷體" and ws["C7"].font.name == "標楷體" and ws["C6"].font.name == "標楷體"
    assert ws.oddHeader.center.text == "工程進度回報"
    assert len(wb[wb.sheetnames[1]]._images) == 0


def _wait_job(client, job_id, timeout=20):
    import time
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        job = client.get(f"/api/work-progress/export/jobs/{job_id}").json()
        if job["status"] != "running":
            return job
        time.sleep(0.05)
    raise AssertionError("export job did not finish")


def test_export_single_report_full_layout_and_filename(wpr_env):
    """單筆匯出：完整版、只含該筆、檔名 工程進度回報{日期}_{客戶}。"""
    from urllib.parse import unquote

    from openpyxl import load_workbook

    make_client, *_ = wpr_env
    owner = make_client("owner")
    appt = _appointment(owner, date="2026-11-16", note="行事曆備註")
    other = _appointment(owner, date="2026-11-16")
    report = _create(owner, appt["id"], note="拉風管").json()
    assert _create(owner, other["id"]).status_code == 201

    response = make_client("viewer").get(f"/api/work-progress/{report['id']}/export")
    assert response.status_code == 200, response.text
    assert unquote(response.headers["content-disposition"]).endswith("工程進度回報2026-11-16_王先生.xlsx")
    wb = load_workbook(io.BytesIO(response.content))
    assert len(wb.sheetnames) == 1
    ws = wb[wb.sheetnames[0]]
    assert ws["A1"].value == "保養．王先生"
    assert ws["A4"].value == "客戶案場" and ws["A6"].value == "地址" and ws["A9"].value == "拉風管"
    assert ws["C7"].value == "行事曆備註" and len(ws._images) == 1
    assert make_client("viewer").get("/api/work-progress/999999/export").status_code == 404


def test_export_condition_validation_and_preview_paging(wpr_env):
    """條件匯出：起迄日需同時填寫、至少一項條件；預覽依日期由舊到新分頁並回傳檔名與照片總數。"""
    make_client, *_ = wpr_env
    owner = make_client("owner")
    for day in ("2026-11-03", "2026-11-01", "2026-11-02"):
        assert _create(owner, _appointment(owner, date=day)["id"], note=f"範例客戶 {day}").status_code == 201
    preview = "/api/work-progress/export/preview"
    assert owner.get(preview, params={"from_date": "2026-11-01"}).json()["detail"] == "起始日與迄止日需同時填寫"
    assert owner.get(preview, params={"to_date": "2026-11-01", "q": "x"}).status_code == 400
    assert owner.get(preview).json()["detail"] == "請輸入關鍵字或日期區間"
    assert owner.get(preview, params={"from_date": "2026-11-05", "to_date": "2026-11-01"}).status_code == 400

    cond = {"from_date": "2026-11-01", "to_date": "2026-11-30", "q": "範例客戶"}
    data = owner.get(preview, params={**cond, "page_size": 2}).json()
    assert data["total"] == 3 and data["photo_total"] == 3
    assert data["filename"] == "工程進度回報2026-11-01~2026-11-30_範例客戶.xlsx"
    assert [i["report_date"] for i in data["items"]] == ["2026-11-01", "2026-11-02"]
    assert data["items"][0]["title"] == "保養．王先生" and data["items"][0]["photo_count"] == 1
    page2 = owner.get(preview, params={**cond, "page": 2, "page_size": 2}).json()
    assert [i["report_date"] for i in page2["items"]] == ["2026-11-03"]
    assert owner.get(preview, params={"q": "王先生"}).json()["filename"] == "工程進度回報王先生.xlsx"
    only_dates = owner.get(preview, params={"from_date": "2026-11-01", "to_date": "2026-11-02"}).json()
    assert only_dates["filename"] == "工程進度回報2026-11-01~2026-11-02.xlsx" and only_dates["total"] == 2


def test_export_condition_job_compact_layout_progress_download_and_cleanup(wpr_env):
    """條件匯出背景工作：精簡版、進度計數、只有本人可查詢下載、下載後暫存檔刪除。"""
    from openpyxl import load_workbook

    from app.services import work_progress_export_jobs as jobs

    make_client, *_ = wpr_env
    owner = make_client("owner")
    for day in ("2026-11-02", "2026-11-01"):
        assert _create(owner, _appointment(owner, date=day, note="備註" + day)["id"], note="拉風管").status_code == 201
    params = {"from_date": "2026-11-01", "to_date": "2026-11-30"}
    started = owner.post("/api/work-progress/export/jobs", params=params)
    assert started.status_code == 202, started.text
    job_id = started.json()["job_id"]
    assert make_client("other").get(f"/api/work-progress/export/jobs/{job_id}").status_code == 404
    job = _wait_job(owner, job_id)
    assert job["status"] == "done", job
    assert (job["done_reports"], job["total_reports"], job["done_photos"], job["total_photos"]) == (2, 2, 2, 2)
    path = jobs._jobs[job_id].path
    assert path.exists()

    response = owner.get(f"/api/work-progress/export/jobs/{job_id}/download")
    assert response.status_code == 200, response.text
    wb = load_workbook(io.BytesIO(response.content))
    assert wb.sheetnames == ["王先生"]  # 同客戶合併成一個工作表，無關鍵字時用客戶名稱
    ws = wb["王先生"]
    assert ws["A1"].value == "王先生"  # 標題只放客戶，不含服務
    assert ws["A3"].value.date().isoformat() == "2026-11-01"  # 日期由舊到新
    assert ws["A4"].value == "客戶案場" and ws["A8"].value == "工作進度回報" and ws["A11"].value == "施工照片"  # 第一區塊：完整版
    assert ws["A9"].value == "拉風管" and ws["C7"].value == "備註2026-11-01"
    # 第二個日期區塊：精簡版，接在第一區塊（含 1 排照片，第 12 列）之後
    assert ws["A13"].value == "工作日期" and ws["A14"].value.date().isoformat() == "2026-11-02"
    assert (ws["A15"].value, ws["C15"].value, ws["A16"].value, ws["C16"].value, ws["A18"].value) == (
        "工作進度回報", "行事曆備註", "拉風管", "備註2026-11-02", "施工照片")
    assert {"A16:A17", "C16:C17"} <= {str(r) for r in ws.merged_cells.ranges}
    assert 12 in {b.id for b in ws.row_breaks.brk}  # 兩區塊放不進同一頁（含分隔列）→ 換頁，不加分隔列
    assert sorted(img.anchor._from.row for img in ws._images) == [11, 18]  # 兩個區塊的照片
    assert not path.exists() and job_id not in jobs._jobs
    assert owner.get(f"/api/work-progress/export/jobs/{job_id}").status_code == 404
    assert owner.post("/api/work-progress/export/jobs", params={"q": "不存在的客戶"}).status_code == 404


def test_export_condition_job_cancel_and_single_running_job_per_user(wpr_env, monkeypatch):
    """取消：進行中的工作被取消後狀態為 cancelled；同一使用者同時只能有一個進行中的匯出。"""
    import threading
    import time

    from app.services import work_progress_export_jobs as jobs

    make_client, *_ = wpr_env
    owner = make_client("owner")
    assert _create(owner, _appointment(owner, date="2026-11-01")["id"]).status_code == 201
    gate = threading.Event()
    real_build = work_progress.build_work_progress_workbook

    def slow_build(reports, **kwargs):
        gate.wait(5)
        return real_build(reports, **kwargs)

    monkeypatch.setattr(work_progress, "build_work_progress_workbook", slow_build)
    params = {"from_date": "2026-11-01", "to_date": "2026-11-01"}
    job_id = owner.post("/api/work-progress/export/jobs", params=params).json()["job_id"]
    assert owner.post("/api/work-progress/export/jobs", params=params).status_code == 409
    job = jobs._jobs[job_id]
    assert owner.delete(f"/api/work-progress/export/jobs/{job_id}").status_code == 200
    gate.set()
    deadline = time.monotonic() + 10
    while job.status == "running" and time.monotonic() < deadline:
        time.sleep(0.05)
    assert job.status == "cancelled" and job.path is None
    assert owner.get(f"/api/work-progress/export/jobs/{job_id}").status_code == 404
    assert owner.get(f"/api/work-progress/export/jobs/{job_id}/download").status_code == 404


def test_export_jobs_purge_expired_removes_files(tmp_path):
    from app.services import work_progress_export_jobs as jobs

    out = tmp_path / "d" / "export.xlsx"
    out.parent.mkdir()
    out.write_bytes(b"x")
    job = jobs.ExportJob(id="old", user_id=1, filename="f.xlsx", total_reports=0, total_photos=0,
                         status="done", path=out, created=0.0)
    jobs._jobs["old"] = job
    jobs.purge_expired(now=jobs.JOB_TTL_SECONDS + 1)
    assert "old" not in jobs._jobs and not out.exists()


def test_export_filename_and_title_helpers():
    from app.services.work_progress_export import export_filename, report_title

    assert export_filename("2026-11-01~2026-11-16", "範例客戶") == "工程進度回報2026-11-01~2026-11-16_範例客戶.xlsx"
    assert export_filename("", "a/b:c*?") == "工程進度回報a_b_c__.xlsx"
    assert export_filename("2026-11-16") == "工程進度回報2026-11-16.xlsx"
    assert len(export_filename("x" * 300)) <= 120
    assert report_title({"service_name": "施工", "client_name": "王先生"}) == "施工．王先生"
    assert report_title({"service_name": "", "client_name": "王先生"}) == "王先生"


def test_export_work_progress_requires_login_valid_date_and_data(wpr_env):
    make_client, *_ = wpr_env
    assert TestClient(app_main.app, raise_server_exceptions=False).get(
        "/api/work-progress/export", params={"date": "2026-11-03"}).status_code == 401
    client = make_client("viewer")
    assert client.get("/api/work-progress/export", params={"date": "bad"}).status_code == 400
    assert client.get("/api/work-progress/export", params={"date": "2026-11-03"}).status_code == 404


def test_export_sheet_title_sanitizes_truncates_and_dedupes():
    from app.services.work_progress_export import estimate_lines, sheet_title

    used: set[str] = set()
    name = "範例客戶 甲店 王小姐/PJ0000000"
    first = sheet_title(name, used)
    assert "/" not in first and len(first) <= 31
    second = sheet_title(name, used)
    assert second != first and second.endswith("(2)") and len(second) <= 31
    assert sheet_title("a" * 80, set()) == "a" * 31
    assert estimate_lines("A\nB\r\nC", 360) == 3


def test_export_sheet_title_uses_only_ascii_replacement_for_invalid_chars():
    """全形 ／ 會讓 Excel 要求修復活頁簿；非法字元一律換成半形 -。"""
    from app.services.work_progress_export import sheet_title

    title = sheet_title("A/B:C?D*E[F]G\H", set())
    assert title == "A-B-C-D-E-F-G-H"
    assert "／" not in sheet_title("範例客戶 王小姐/PJ0000000", set())


def test_export_builder_layout_long_note_row_height_photo_rows_and_page_breaks(tmp_path):
    """純服務層：長備註加高列、照片每排 5 張、15 張分頁、遺漏的照片檔不會讓匯出失敗。"""
    from openpyxl import load_workbook

    from app.services.work_progress_export import PHOTO_SLOT_PT, PHOTOS_PER_ROW, build_work_progress_workbook

    photo = tmp_path / "p.jpg"
    Image.new("RGB", (1477, 1108), (10, 90, 160)).save(photo, "JPEG")
    base = {"report_date": "2026-11-03", "client_name": "範例客戶 王小姐 某某公司/PJ0000000", "service_name": "施工",
            "start_time": "", "address": "範例市範例區範例路1號4樓", "appointment_note": "", "note": ""}
    long_note = "\n".join(f"{i}*8.3下吹*{i}" for i in range(1, 9))
    buf = build_work_progress_workbook([
        {**base, "note": long_note, "photo_paths": [photo] * 15},
        {**base, "photo_paths": []},
    ])
    wb = load_workbook(buf)
    full, empty = wb[wb.sheetnames[0]], wb[wb.sheetnames[1]]

    assert full["A9"].value == long_note and full["C5"].value == "未指定時間"
    assert full.row_dimensions[9].height + full.row_dimensions[10].height >= 8 * 22   # 8 行都放得下
    assert PHOTOS_PER_ROW == 5 and len(full._images) == 15
    assert [full.row_dimensions[r].height for r in (12, 13, 14)] == [PHOTO_SLOT_PT] * 3  # 15 張 = 3 排
    assert full.print_area.endswith("$C$14")
    assert {(i.width, i.height) for i in full._images} == {(i.width, i.width) for i in full._images[:1]}
    assert empty.print_area.endswith("$C$11") and not empty._images and not empty.row_breaks.brk

    many = build_work_progress_workbook([{**base, "photo_paths": [photo] * 40}])
    ws = load_workbook(many).active
    assert len(ws.row_breaks.brk) >= 1   # 8 排放不下一頁，必須有分頁線


def test_compact_workbook_sheet_name_follows_keyword_and_groups_by_client():
    """精簡版工作表名稱依匯出關鍵字（不含日期）；單一客戶用關鍵字，多位客戶為「關鍵字-客戶」；無關鍵字用客戶名稱。"""
    from openpyxl import load_workbook

    from app.services.work_progress_export import build_work_progress_workbook

    def rpt(day, client):
        return {"report_date": day, "service_name": "施工", "client_name": client, "note": "n", "photo_paths": []}

    def names(reports, keyword):
        return load_workbook(build_work_progress_workbook(reports, compact=True, keyword=keyword)).sheetnames

    one = [rpt("2026-11-02", "範例客戶A"), rpt("2026-11-01", "範例客戶A")]
    assert names(one, "範例客戶") == ["範例客戶"]
    assert names(one, "") == ["範例客戶A"]
    assert names(one + [rpt("2026-11-01", "範例客戶B")], "範例客戶") == ["範例客戶-範例客戶A", "範例客戶-範例客戶B"]


def test_compact_workbook_packs_blocks_into_a4_pages_without_splitting(tmp_path):
    """A4 分頁：一頁盡量放滿多個日期區塊，放不下的整塊換頁（分頁線落在區塊之間）。"""
    from openpyxl import load_workbook

    from app.services.work_progress_export import PAGE_BUDGET_PT, build_work_progress_workbook

    photo = tmp_path / "p.jpg"
    Image.new("RGB", (40, 40), (10, 20, 30)).save(photo)

    def rpt(day, n):
        return {"report_date": day, "service_name": "施工", "client_name": "王先生", "note": "n",
                "photo_paths": [photo] * n}

    def breaks(counts):
        reports = [rpt(f"2026-11-{i + 1:02d}", n) for i, n in enumerate(counts)]
        ws = load_workbook(build_work_progress_workbook(reports, compact=True)).worksheets[0]
        starts = [r for r in range(1, ws.max_row + 1) if ws[f"A{r}"].value == "工作日期"]
        return sorted(b.id for b in ws.row_breaks.brk), starts, ws
    # 區塊很小：全部同一頁，不分頁
    brks, starts, ws = breaks([0, 0, 0])
    assert brks == [] and len(starts) == 3
    # 區塊大（每塊 2 排照片）：放不下就換頁，且分頁線一定緊接在某個區塊開始列之前
    brks, starts, ws = breaks([10, 10, 10, 10])
    assert brks and all(b + 1 in starts for b in brks)
    # 每頁高度不超過預算（相鄰分頁線之間）
    edges = [0] + brks + [ws.max_row]
    for lo, hi in zip(edges, edges[1:]):
        assert sum(ws.row_dimensions[r].height or 15 for r in range(lo + 1, hi + 1)) <= PAGE_BUDGET_PT + 1


def test_compact_workbook_hides_photo_title_when_no_photos(tmp_path):
    """精簡版：沒有照片的日期區塊不顯示「施工照片」標題；有照片的照常顯示。"""
    from openpyxl import load_workbook

    from app.services.work_progress_export import build_work_progress_workbook

    photo = tmp_path / "p.jpg"
    Image.new("RGB", (40, 40), (10, 20, 30)).save(photo)

    def rpt(day, n):
        return {"report_date": day, "service_name": "施工", "client_name": "王先生", "note": "n",
                "photo_paths": [photo] * n}

    ws = load_workbook(build_work_progress_workbook(
        [rpt("2026-11-01", 0), rpt("2026-11-02", 0), rpt("2026-11-03", 1)], compact=True)).worksheets[0]
    titles = [r for r in range(1, ws.max_row + 1) if ws[f"A{r}"].value == "施工照片"]
    starts = [r for r in range(1, ws.max_row + 1) if ws[f"A{r}"].value == "工作日期"]
    assert len(starts) == 3 and len(titles) == 1 and titles[0] > starts[2]  # 只有第三個區塊（有照片）有標題


def test_compact_separator_line_only_for_blocks_sharing_a_page_and_full_version_hides_empty_photo_title(tmp_path):
    """精簡版：同頁第二個起的區塊「工作日期」上方有分隔線，換頁後的第一個區塊沒有；完整版無照片也隱藏「施工照片」。"""
    from openpyxl import load_workbook

    from app.services.work_progress_export import build_work_progress_workbook

    photo = tmp_path / "p.jpg"
    Image.new("RGB", (40, 40), (10, 20, 30)).save(photo)

    def rpt(day, n):
        return {"report_date": day, "service_name": "施工", "client_name": "王先生", "note": "n",
                "photo_paths": [photo] * n}

    ws = load_workbook(build_work_progress_workbook([rpt("2026-11-01", 0), rpt("2026-11-02", 0)], compact=True)).worksheets[0]
    starts = [r for r in range(1, ws.max_row + 1) if ws[f"A{r}"].value == "工作日期"]
    # 同頁第二個區塊：「工作日期」上一列是分隔列（底線），其上方為前一區塊，不貼著照片
    assert ws[f"A{starts[1] - 1}"].border.bottom.style == "medium" and ws[f"C{starts[1] - 1}"].border.bottom.style == "medium"
    assert ws[f"A{starts[1]}"].border.top.style is None and ws.row_dimensions[starts[1] - 1].height == 16
    big = [rpt(f"2026-11-{i + 1:02d}", 10) for i in range(4)]
    ws = load_workbook(build_work_progress_workbook(big, compact=True)).worksheets[0]
    brks = {b.id for b in ws.row_breaks.brk}
    starts = [r for r in range(1, ws.max_row + 1) if ws[f"A{r}"].value == "工作日期"]
    for st in starts[1:]:
        assert (ws[f"A{st - 1}"].border.bottom.style == "medium") == ((st - 1) not in brks)
    full = load_workbook(build_work_progress_workbook([rpt("2026-11-01", 0)])).worksheets[0]
    assert all(full[f"A{r}"].value != "施工照片" for r in range(1, full.max_row + 1))
