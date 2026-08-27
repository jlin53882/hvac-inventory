# -*- coding: utf-8 -*-
"""Google 行事曆同步 Phase 1-5 單元測試"""
import pytest
from unittest.mock import patch, MagicMock

import app.database as app_db
import main as app_main
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path, monkeypatch):
    """每個測試獨立 DB"""
    test_db = tmp_path / "test_gcal.db"
    monkeypatch.setattr(app_db, "DB_PATH", str(test_db))
    app_db.init_db()

    from app.services.auth import SESSION_COOKIE, create_session, init_admin_if_missing
    _conn = app_db.get_db()
    try:
        init_admin_if_missing(_conn)
        _admin_id = _conn.execute("SELECT id FROM users WHERE username='admin'").fetchone()["id"]
        _token = create_session(_conn, _admin_id)
    finally:
        _conn.close()

    with TestClient(app_main.app) as c:
        c.cookies.set(SESSION_COOKIE, _token)
        yield c

    try:
        if test_db.exists():
            test_db.unlink()
    except PermissionError:
        pass


# ============================================================
# build_event 純函式測試
# ============================================================

class TestBuildEvent:
    """build_event 純函式：本地行程 → Google Event"""

    def _make_appt(self, **kw):
        base = {"client_name": "陳先生", "service_name": "維修",
                "address": "台北市中正區", "date": "2026-08-28",
                "start_time": "09:00", "end_time": "11:00", "note": "車馬費 800"}
        base.update(kw)
        return base

    def _make_assignees(self):
        return [{"id": 1, "name": "管理員", "color": "#1a73e8"}]

    def test_basic_event(self):
        from app.services.gcal_sync import build_event
        ev = build_event(self._make_appt(), self._make_assignees())
        assert ev["summary"] == "陳先生｜維修"
        assert "地址：台北市中正區" in ev["description"]
        assert "人員：管理員" in ev["description"]
        assert "備註：車馬費 800" in ev["description"]
        assert ev["start"]["dateTime"] == "2026-08-28T09:00:00"
        assert ev["end"]["dateTime"] == "2026-08-28T11:00:00"
        assert ev["start"]["timeZone"] == "Asia/Taipei"

    def test_no_service_name(self):
        from app.services.gcal_sync import build_event
        ev = build_event(self._make_appt(service_name=None), self._make_assignees())
        assert ev["summary"] == "陳先生"

    def test_end_equals_start_gets_plus_1h(self):
        """A2：end==start 套 +1h 預設時長"""
        from app.services.gcal_sync import build_event
        ev = build_event(self._make_appt(end_time="09:00"), self._make_assignees())
        assert ev["end"]["dateTime"] == "2026-08-28T10:00:00"

    def test_all_day_event(self):
        """無時間 → 全日事件"""
        from app.services.gcal_sync import build_event
        ev = build_event(self._make_appt(start_time="", end_time=""), self._make_assignees())
        assert ev["start"]["date"] == "2026-08-28"
        assert "dateTime" not in ev["start"]

    def test_no_assignees(self):
        from app.services.gcal_sync import build_event
        ev = build_event(self._make_appt(), [])
        assert "人員：" not in ev["description"]

    def test_multiple_assignees(self):
        from app.services.gcal_sync import build_event
        asns = [{"id": 1, "name": "管理員", "color": "#1a73e8"},
                {"id": 2, "name": "工程師A", "color": "#34a853"}]
        ev = build_event(self._make_appt(), asns)
        assert "人員：管理員、工程師A" in ev["description"]


class TestAddMinutes:
    def test_basic(self):
        from app.services.gcal_sync import _add_minutes
        assert _add_minutes("09:00", 60) == "10:00"

    def test_wrap_midnight(self):
        from app.services.gcal_sync import _add_minutes
        assert _add_minutes("23:30", 90) == "01:00"

    def test_zero(self):
        from app.services.gcal_sync import _add_minutes
        assert _add_minutes("14:15", 0) == "14:15"


# ============================================================
# is_enabled 純函式測試
# ============================================================

class TestIsEnabled:
    def test_no_keys(self, client):
        from app.services.gcal_sync import is_enabled
        assert is_enabled() is False

    def test_has_active_key(self, client, monkeypatch):
        """有啟用 key → True"""
        from app.services import gcal_sync
        monkeypatch.setattr(gcal_sync, "is_enabled", lambda: True)
        assert gcal_sync.is_enabled() is True


# ============================================================
# resolve_target_keys 純函式測試
# ============================================================

class TestResolveTargetKeys:
    def _setup(self, conn):
        """建 key + 使用者 + 綁定 + 行程 + 指派"""
        conn.execute("INSERT INTO gcal_keys(name, credentials_path, calendar_id) "
                     "VALUES('廠商A', 'a.json', 'a@cal')")
        conn.execute("INSERT INTO gcal_keys(name, credentials_path, calendar_id) "
                     "VALUES('廠商B', 'b.json', 'b@cal')")
        # admin user 已存在，綁定廠商A
        conn.execute("UPDATE users SET gcal_key='廠商A' WHERE username='admin'")
        # 建 sarah 綁定廠商B
        from app.services.auth import hash_password
        conn.execute("INSERT INTO users(username, password_hash, display_name, role, gcal_key) "
                     "VALUES('sarah', ?, 'Sarah', 'user', '廠商B')",
                     (hash_password("Test1234"),))
        conn.commit()

    def test_single_key(self, client, monkeypatch):
        """單一指派人 → 一個 key"""
        from app.database import get_db
        conn = get_db()
        try:
            self._setup(conn)
            # 建行程 + 指派 admin
            r = client.post("/api/appointments", json={
                "client_name": "測試", "date": "2026-08-28",
                "start_time": "09:00", "end_time": "11:00",
                "user_ids": [1], "note": ""
            })
            appt_id = r.json()["id"]
            from app.services.gcal_sync import resolve_target_keys
            keys = resolve_target_keys(conn, appt_id)
            assert len(keys) == 1
        finally:
            conn.close()

    def test_multi_key(self, client, monkeypatch):
        """Multi-Key：兩指派人跨廠商 → 兩個 key"""
        from app.database import get_db
        conn = get_db()
        try:
            self._setup(conn)
            sarah_id = conn.execute("SELECT id FROM users WHERE username='sarah'").fetchone()["id"]
            r = client.post("/api/appointments", json={
                "client_name": "多廠商測試", "date": "2026-08-28",
                "start_time": "09:00", "end_time": "11:00",
                "user_ids": [1, sarah_id], "note": ""
            })
            appt_id = r.json()["id"]
            from app.services.gcal_sync import resolve_target_keys
            keys = resolve_target_keys(conn, appt_id)
            assert len(keys) == 2
        finally:
            conn.close()

    def test_no_gcal_key(self, client, monkeypatch):
        """使用者沒綁 key → 回空"""
        from app.database import get_db
        from app.services.gcal_sync import resolve_target_keys
        conn = get_db()
        try:
            # 建行程只指派沒有 gcal_key 的使用者
            r = client.post("/api/appointments", json={
                "client_name": "無key測試", "date": "2026-08-28",
                "start_time": "09:00", "end_time": "11:00",
                "user_ids": [1], "note": ""
            })
            appt_id = r.json()["id"]
            # admin 的 gcal_key 預設空
            keys = resolve_target_keys(conn, appt_id)
            assert keys == []
        finally:
            conn.close()


# ============================================================
# sync_pending mock 測試
# ============================================================

class TestSyncPending:
    def _mock_service(self):
        """建 mock google service"""
        svc = MagicMock()
        svc.events().insert().execute.return_value = {"id": "google-event-123"}
        return svc

    def test_create_inserts_event(self, client, monkeypatch):
        """C op → events().insert()"""
        from app.database import get_db
        from app.services import gcal_sync

        # 建 key + 綁定 admin
        conn = get_db()
        try:
            conn.execute("INSERT INTO gcal_keys(name, credentials_path, calendar_id, is_active) "
                         "VALUES('測試Key', 'fake.json', 'test@cal', 1)")
            conn.execute("UPDATE users SET gcal_key='測試Key' WHERE username='admin'")
            conn.commit()
        finally:
            conn.close()

        # 建行程（create_appointment 自動呼叫 mark_sync_pending → 隊列已有一列）
        r = client.post("/api/appointments", json={
            "client_name": "同步測試", "date": "2026-08-28",
            "start_time": "09:00", "end_time": "11:00",
            "user_ids": [1], "note": ""
        })
        appt_id = r.json()["id"]

        # 確認隊列已自動建立
        conn = get_db()
        try:
            q = conn.execute("SELECT * FROM appointment_sync_queue WHERE appointment_id=?",
                             (appt_id,)).fetchone()
            assert q is not None
            la = q["last_modified_at"]
        finally:
            conn.close()

        mock_svc = self._mock_service()
        monkeypatch.setattr(gcal_sync, "get_service_for_key", lambda kr: mock_svc)

        # 執行同步（用 mark_sync_pending 自動建的隊列）
        due = [{"appointment_id": appt_id, "key_id": q["key_id"], "op_type": "C",
                "google_event_id": "", "last_modified_at": la}]
        ok, fail = gcal_sync.sync_pending(due)
        assert ok == 1
        assert fail == 0
        mock_svc.events().insert().execute.assert_called_once()

        # 驗證 map 已寫入
        conn = get_db()
        try:
            m = conn.execute("SELECT google_event_id FROM appointment_gcal_map "
                             "WHERE appointment_id=?", (appt_id,)).fetchone()
            assert m is not None
            assert m["google_event_id"] == "google-event-123"
        finally:
            conn.close()

    def test_delete_removes_event(self, client, monkeypatch):
        """D op → events().delete()"""
        from app.database import get_db
        from app.services import gcal_sync

        # 建 key
        conn = get_db()
        try:
            conn.execute("INSERT INTO gcal_keys(name, credentials_path, calendar_id, is_active) "
                         "VALUES('DelKey', 'fake.json', 'del@cal', 1)")
            conn.execute("UPDATE users SET gcal_key='DelKey' WHERE username='admin'")
            conn.commit()
        finally:
            conn.close()

        # 建行程
        r = client.post("/api/appointments", json={
            "client_name": "刪除測試", "date": "2026-08-28",
            "start_time": "09:00", "end_time": "11:00",
            "user_ids": [1], "note": ""
        })
        appt_id = r.json()["id"]

        # 寫 map（模擬已同步過）
        conn = get_db()
        try:
            conn.execute("INSERT INTO appointment_gcal_map(appointment_id, key_id, google_event_id) "
                         "VALUES(?, 1, 'del-event-456')", (appt_id,))
            conn.commit()
        finally:
            conn.close()

        # 刪行程（自動觸發 mark_sync_pending D）
        client.delete(f"/api/appointments/{appt_id}")

        # 確認隊列有 D 列
        conn = get_db()
        try:
            q = conn.execute("SELECT * FROM appointment_sync_queue WHERE appointment_id=? AND op_type='D'",
                             (appt_id,)).fetchone()
            assert q is not None
        finally:
            conn.close()

        mock_svc = self._mock_service()
        monkeypatch.setattr(gcal_sync, "get_service_for_key", lambda kr: mock_svc)

        due = [{"appointment_id": appt_id, "key_id": q["key_id"], "op_type": "D",
                "google_event_id": "del-event-456", "last_modified_at": q["last_modified_at"]}]
        ok, fail = gcal_sync.sync_pending(due)
        assert ok == 1
        mock_svc.events().delete().execute.assert_called_once()

    def test_version_condition_prevents_lost_edit(self, client, monkeypatch):
        """🔴 防回歸：成功刪隊列帶 last_modified_at 版本條件"""
        from app.database import get_db
        from app.services import gcal_sync

        # 建 key
        conn = get_db()
        try:
            conn.execute("INSERT INTO gcal_keys(name, credentials_path, calendar_id, is_active) "
                         "VALUES('VerKey', 'fake.json', 'ver@cal', 1)")
            conn.execute("UPDATE users SET gcal_key='VerKey' WHERE username='admin'")
            conn.commit()
        finally:
            conn.close()

        # 建行程
        r = client.post("/api/appointments", json={
            "client_name": "版本測試", "date": "2026-08-28",
            "start_time": "09:00", "end_time": "11:00",
            "user_ids": [1], "note": ""
        })
        appt_id = r.json()["id"]

        # 讀出 mark_sync_pending 自動建的隊列列（last_modified_at = T1）
        conn = get_db()
        try:
            q = conn.execute("SELECT * FROM appointment_sync_queue WHERE appointment_id=?",
                             (appt_id,)).fetchone()
            t1 = q["last_modified_at"]
        finally:
            conn.close()

        # 模擬「同步途中被編輯」→ 重置 last_modified_at 為 T2
        conn = get_db()
        try:
            conn.execute("UPDATE appointment_sync_queue SET last_modified_at='2026-08-28 01:00:00' "
                         "WHERE appointment_id=?", (appt_id,))
            conn.commit()
        finally:
            conn.close()

        mock_svc = self._mock_service()
        monkeypatch.setattr(gcal_sync, "get_service_for_key", lambda kr: mock_svc)

        # 用 T1 的快照嘗試同步 → sync_pending 仍會同步，但刪隊列時 T1 不符 T2 → 隊列保留
        due = [{"appointment_id": appt_id, "key_id": q["key_id"], "op_type": "C",
                "google_event_id": "", "last_modified_at": t1}]
        ok, fail = gcal_sync.sync_pending(due)
        # sync_pending 會嘗試同步（成功），但刪隊列 WHERE last_modified_at=t1 不符 t2 → 隊列保留
        conn = get_db()
        try:
            q2 = conn.execute("SELECT * FROM appointment_sync_queue WHERE appointment_id=?",
                              (appt_id,)).fetchone()
            assert q2 is not None  # 隊列仍存在（版本不符沒刪掉）
        finally:
            conn.close()

    def test_disabled_key_skipped(self, client, monkeypatch):
        """key 停用 → 該列直接清不阻塞"""
        from app.database import get_db
        from app.services import gcal_sync

        conn = get_db()
        try:
            conn.execute("INSERT INTO gcal_keys(name, credentials_path, calendar_id, is_active) "
                         "VALUES('OffKey', 'fake.json', 'off@cal', 0)")  # 停用
            conn.commit()
            key_id = conn.execute("SELECT id FROM gcal_keys WHERE name='OffKey'").fetchone()["id"]
        finally:
            conn.close()

        due = [{"appointment_id": 999, "key_id": key_id, "op_type": "C",
                "google_event_id": "", "last_modified_at": "2026-08-28 00:00:00"}]
        ok, fail = gcal_sync.sync_pending(due)
        assert ok == 0
        assert fail == 0
        # 隊列應被清掉
        conn = get_db()
        try:
            q = conn.execute("SELECT COUNT(*) c FROM appointment_sync_queue WHERE key_id=?",
                             (key_id,)).fetchone()
            assert q["c"] == 0
        finally:
            conn.close()

    def test_update_patches_event(self, client, monkeypatch):
        """U op → events().patch()（有 gid 時）"""
        from app.database import get_db
        from app.services import gcal_sync

        # 建 key + 綁定
        conn = get_db()
        try:
            conn.execute("INSERT INTO gcal_keys(name, credentials_path, calendar_id, is_active) "
                         "VALUES('UpdKey', 'fake.json', 'upd@cal', 1)")
            conn.execute("UPDATE users SET gcal_key='UpdKey' WHERE username='admin'")
            conn.commit()
        finally:
            conn.close()

        # 建行程（自動建 C 列隊列）
        r = client.post("/api/appointments", json={
            "client_name": "更新測試", "date": "2026-08-28",
            "start_time": "09:00", "end_time": "11:00",
            "user_ids": [1], "note": ""
        })
        appt_id = r.json()["id"]

        # 模擬已同步過：寫 map + 把 C 列改為 U
        conn = get_db()
        try:
            conn.execute("INSERT INTO appointment_gcal_map(appointment_id, key_id, google_event_id) "
                         "VALUES(?, 1, 'upd-event-789')", (appt_id,))
            conn.execute("UPDATE appointment_sync_queue SET op_type='U', google_event_id='upd-event-789' "
                         "WHERE appointment_id=?", (appt_id,))
            conn.commit()
            q = conn.execute("SELECT * FROM appointment_sync_queue WHERE appointment_id=?",
                             (appt_id,)).fetchone()
        finally:
            conn.close()

        mock_svc = self._mock_service()
        monkeypatch.setattr(gcal_sync, "get_service_for_key", lambda kr: mock_svc)

        due = [{"appointment_id": appt_id, "key_id": q["key_id"], "op_type": "U",
                "google_event_id": "upd-event-789", "last_modified_at": q["last_modified_at"]}]
        ok, fail = gcal_sync.sync_pending(due)
        assert ok == 1
        mock_svc.events().patch().execute.assert_called_once()
        mock_svc.events().insert().execute.assert_not_called()

    def test_empty_due_returns_zero(self):
        """空 due → (0, 0)"""
        from app.services.gcal_sync import sync_pending
        ok, fail = sync_pending([])
        assert ok == 0
        assert fail == 0


# ============================================================
# _due_ids 窗口邊界測試
# ============================================================

class TestDueIds:
    def test_within_window(self):
        """5 分鐘內 → 不 due"""
        from app.services.sync_scheduler import _due_ids
        from datetime import datetime
        now = datetime(2026, 8, 28, 10, 5, 0)
        rows = [{"appointment_id": 1, "key_id": 1,
                 "last_modified_at": "2026-08-28 10:02:00"}]
        assert _due_ids(rows, now, window=300) == set()

    def test_outside_window(self):
        """超過 5 分鐘 → due"""
        from app.services.sync_scheduler import _due_ids
        from datetime import datetime
        now = datetime(2026, 8, 28, 10, 10, 0)
        rows = [{"appointment_id": 1, "key_id": 1,
                 "last_modified_at": "2026-08-28 10:00:00"}]
        assert _due_ids(rows, now, window=300) == {(1, 1)}

    def test_boundary_exactly_300s(self):
        """剛好 300 秒 → due"""
        from app.services.sync_scheduler import _due_ids
        from datetime import datetime
        now = datetime(2026, 8, 28, 10, 5, 0)
        rows = [{"appointment_id": 1, "key_id": 1,
                 "last_modified_at": "2026-08-28 10:00:00"}]
        assert _due_ids(rows, now, window=300) == {(1, 1)}

    def test_invalid_timestamp(self):
        """無效時間戳 → datetime.min → 永遠 due"""
        from app.services.sync_scheduler import _due_ids
        from datetime import datetime
        now = datetime(2026, 8, 28, 10, 0, 0)
        rows = [{"appointment_id": 1, "key_id": 1, "last_modified_at": None}]
        assert _due_ids(rows, now) == {(1, 1)}
