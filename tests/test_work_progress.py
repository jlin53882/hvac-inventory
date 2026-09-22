"""每日工作進度回報 API / storage / RBAC regression tests."""
from concurrent.futures import ThreadPoolExecutor
import io

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
