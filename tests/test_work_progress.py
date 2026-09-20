"""每日工作進度回報 API / storage / RBAC regression tests."""
from concurrent.futures import ThreadPoolExecutor
import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image

import app.config as app_config
import app.database as app_db
import app.routes.appointments as appointments_route
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
        for username, role in (("owner", "user"), ("other", "user"), ("viewer", "viewer"), ("tech", "tech")):
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


def _create(client, appointment_id, *, filename="site.png", data=None, note="完成室內機"):
    return client.post(
        "/api/work-progress",
        data={"appointment_id": str(appointment_id), "note": note},
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
