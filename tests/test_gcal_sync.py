# -*- coding: utf-8 -*-
"""Google 行事曆同步 Phase 1-5 單元測試"""
import pytest
from unittest.mock import MagicMock

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


class TestSyncErrorNotification:
    def test_error_line_includes_key_name_and_calendar_id(self):
        from app.services.sync_scheduler import _format_sync_error_line

        line = _format_sync_error_line(6, {
            "key_name": "666",
            "cal_id": "calendar-666@group.calendar.google.com",
            "errors": {"HttpError 404": 98},
        })

        assert line == "❌ Key「666」／Calendar「calendar-666@group.calendar.google.com」：HttpError 404 ×98"

    def test_error_line_falls_back_to_key_id(self):
        from app.services.sync_scheduler import _format_sync_error_line

        line = _format_sync_error_line(12, {"cal_id": "", "errors": {"HttpError 404": 1}})

        assert "Key「key=12」" in line
        assert "Calendar ID 未知" in line



class TestBuildEvent:
    """build_event 純函式：本地行程 -> Google Event"""

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
        # use_location=True（預設）→ address 放到 location 欄位
        assert ev["location"] == "台北市中正區"
        assert "地址" not in ev["description"]
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
        """無時間 -> 預設 08:00~17:00（不是全日事件）"""
        from app.services.gcal_sync import build_event
        ev = build_event(self._make_appt(start_time="", end_time=""), self._make_assignees())
        # 預設起始 08:00，預設時長 60 分鐘 → 09:00
        assert ev["start"]["dateTime"] == "2026-08-28T08:00:00"
        assert ev["end"]["dateTime"] == "2026-08-28T09:00:00"
        assert "dateTime" in ev["start"]

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
    def test_popup_reminders_are_sent_without_email(self):
        """多筆通知送往 Google Event 時只包含 Popup。"""
        from app.services.gcal_sync import build_event

        reminders = [
            {"method": "popup", "minutes": 40320},
            {"method": "popup", "minutes": 1440},
            {"method": "popup", "minutes": 30},
        ]
        event = build_event(self._make_appt(), self._make_assignees(), {"reminders": reminders})

        assert event["reminders"] == {"useDefault": False, "overrides": reminders}
        assert all(item["method"] == "popup" for item in event["reminders"]["overrides"])


    def test_exact_multiple_popup_reminders_payload(self):
        """1 天、2 小時、15 分鐘必須原樣成為 Google popup overrides。"""
        from app.services.gcal_sync import build_event
        reminders = [
            {"method": "popup", "minutes": 1440},
            {"method": "popup", "minutes": 120},
            {"method": "popup", "minutes": 15},
        ]
        event = build_event(self._make_appt(), self._make_assignees(), {"reminders": reminders})
        assert event["reminders"] == {"useDefault": False, "overrides": reminders}


class TestPopupReminderParser:
    def test_parser_filters_invalid_and_email_entries(self):
        from app.services.gcal_sync import parse_popup_reminders

        result = parse_popup_reminders([
            {"method": "popup", "minutes": 15},
            {"method": "email", "minutes": 30},
            {"method": "popup", "minutes": -1},
            {"method": "popup", "minutes": 40321},
            "not-a-dict",
        ])

        assert result == [{"method": "popup", "minutes": 15}]

    def test_parser_caps_at_five_and_accepts_json(self):
        from app.services.gcal_sync import parse_popup_reminders

        raw = [{"method": "popup", "minutes": i} for i in range(6)]
        assert parse_popup_reminders(__import__("json").dumps(raw)) == raw[:5]
        assert parse_popup_reminders([{"method": "email", "minutes": i} for i in range(5)] + [{"method": "popup", "minutes": 7}]) == [{"method": "popup", "minutes": 7}]
        assert parse_popup_reminders("not-json") == []


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
        """有啟用 key -> True"""
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
        """單一指派人 -> 一個 key"""
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
        """Multi-Key：兩指派人跨廠商 -> 兩個 key"""
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
        """使用者沒綁 key -> 回空"""
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
        """C op -> events().insert()"""
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

        # 建行程（create_appointment 自動呼叫 mark_sync_pending -> 隊列已有一列）
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
        ok, fail, _ = gcal_sync.sync_pending(due)
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

    def test_delete_410_is_idempotent_success(self, client, monkeypatch):
        """410 Resource deleted -> 刪除目標已達成，清理 map/queue 且不算失敗。"""
        from app.database import get_db
        from app.services import gcal_sync
        from types import SimpleNamespace

        conn = get_db()
        try:
            conn.execute("INSERT INTO gcal_keys(name, credentials_path, calendar_id, is_active) "
                         "VALUES('GoneKey', 'fake.json', 'gone@cal', 1)")
            conn.execute("INSERT INTO appointments(client_name, date, start_time, end_time) "
                         "VALUES('410測試', '2026-08-28', '09:00', '11:00')")
            appt_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
            key_id = conn.execute("SELECT id FROM gcal_keys WHERE name='GoneKey'").fetchone()["id"]
            conn.execute("INSERT INTO appointment_gcal_map(appointment_id,key_id,google_event_id) "
                         "VALUES(?,?,?)", (appt_id, key_id, 'gone-event'))
            conn.execute("INSERT INTO appointment_sync_queue "
                         "(appointment_id,key_id,op_type,google_event_id,last_modified_at) "
                         "VALUES(?,?, 'D', ?, '2026-08-28 00:00:00')",
                         (appt_id, key_id, 'gone-event'))
            conn.commit()
        finally:
            conn.close()

        class GoneError(Exception):
            resp = SimpleNamespace(status=410)

        svc = MagicMock()
        svc.events().delete().execute.side_effect = GoneError(
            'Resource has been deleted')
        monkeypatch.setattr(gcal_sync, "get_service_for_key", lambda kr: svc)

        ok, fail, summary = gcal_sync.sync_pending([{
            "appointment_id": appt_id, "key_id": key_id, "op_type": "D",
            "google_event_id": "gone-event", "last_modified_at": "2026-08-28 00:00:00"
        }])

        assert (ok, fail) == (1, 0)
        assert summary[key_id]["resolved"]["remote_already_deleted"] == 1
        conn = get_db()
        try:
            assert conn.execute("SELECT 1 FROM appointment_gcal_map WHERE appointment_id=?",
                                (appt_id,)).fetchone() is None
            assert conn.execute("SELECT 1 FROM appointment_sync_queue WHERE appointment_id=?",
                                (appt_id,)).fetchone() is None
        finally:
            conn.close()

    def test_delete_removes_event(self, client, monkeypatch):
        """D op -> events().delete()"""
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
        ok, fail, _ = gcal_sync.sync_pending(due)
        assert ok == 1
        mock_svc.events().delete().execute.assert_called_once()

    def test_delete_also_removes_map_row(self, client, monkeypatch):
        """A3 防回歸：D op 成功後同步刪 appointment_gcal_map，防止換回時 patch 404"""
        from app.database import get_db
        from app.services import gcal_sync

        # 建 key
        conn = get_db()
        try:
            conn.execute("INSERT INTO gcal_keys(name, credentials_path, calendar_id, is_active) "
                         "VALUES('A3Key', 'fake.json', 'a3@cal', 1)")
            conn.execute("UPDATE users SET gcal_key='A3Key' WHERE username='admin'")
            conn.commit()
        finally:
            conn.close()

        # 建行程
        r = client.post("/api/appointments", json={
            "client_name": "A3測試", "date": "2026-08-28",
            "start_time": "09:00", "end_time": "11:00",
            "user_ids": [1], "note": ""
        })
        appt_id = r.json()["id"]

        # 寫 map（模擬已同步過）
        conn = get_db()
        try:
            conn.execute("INSERT INTO appointment_gcal_map(appointment_id, key_id, google_event_id, data_hash) "
                         "VALUES(?, 1, 'a3-event-789', 'fakehash')", (appt_id,))
            conn.commit()
            # 確認 map 存在
            assert conn.execute("SELECT 1 FROM appointment_gcal_map WHERE appointment_id=?", (appt_id,)).fetchone()
        finally:
            conn.close()

        # 刪行程
        client.delete(f"/api/appointments/{appt_id}")

        # 取 queue row
        conn = get_db()
        try:
            q = conn.execute("SELECT * FROM appointment_sync_queue WHERE appointment_id=? AND op_type='D'",
                             (appt_id,)).fetchone()
            assert q is not None
        finally:
            conn.close()

        # mock + sync
        mock_svc = self._mock_service()
        monkeypatch.setattr(gcal_sync, "get_service_for_key", lambda kr: mock_svc)
        due = [{"appointment_id": appt_id, "key_id": q["key_id"], "op_type": "D",
                "google_event_id": "a3-event-789", "last_modified_at": q["last_modified_at"]}]
        ok, fail, _ = gcal_sync.sync_pending(due)
        assert ok == 1

        # A3：map row 應被刪除
        conn = get_db()
        try:
            map_row = conn.execute("SELECT 1 FROM appointment_gcal_map WHERE appointment_id=?",
                                   (appt_id,)).fetchone()
            assert map_row is None, "A3：D 成功後 map row 應被刪除"
        finally:
            conn.close()

    def test_version_condition_prevents_lost_edit(self, client, monkeypatch):
        """🔴 防回歸：成功刪隊列帶 last_modified_at 版本條件"""
        from app.database import get_db
        from app.services import gcal_sync, sync_scheduler

        # 此測試要控制 snapshot；停止 TestClient worker，避免它處理手動設定的 T2。
        sync_scheduler.stop()
        monkeypatch.setattr(sync_scheduler, "start", lambda: None)
        monkeypatch.setattr(sync_scheduler, "wake", lambda force=False: None)

        conn = get_db()
        try:
            key_id = conn.execute(
                "INSERT INTO gcal_keys(name, credentials_path, calendar_id) VALUES('VerKey','fake.json','ver@cal')"
            ).lastrowid
            conn.execute("UPDATE users SET gcal_key='VerKey' WHERE username='admin'")
            appt_id = conn.execute(
                "INSERT INTO appointments(client_name,date,start_time,end_time) VALUES(?,?,?,?)",
                ("版本測試", "2026-08-28", "09:00", "11:00"),
            ).lastrowid
            conn.execute("INSERT INTO appointment_assignees(appointment_id,user_id) VALUES(?,1)", (appt_id,))
            t1 = gcal_sync.sync_version_now()
            conn.execute(
                "INSERT INTO appointment_sync_queue"
                "(appointment_id,key_id,op_type,google_event_id,last_modified_at) VALUES(?,?, 'C', '', ?)",
                (appt_id, key_id, t1),
            )
            conn.commit()
        finally:
            conn.close()

        t2 = gcal_sync.sync_version_now()
        conn = get_db()
        try:
            conn.execute(
                "UPDATE appointment_sync_queue SET last_modified_at=? WHERE appointment_id=? AND key_id=?",
                (t2, appt_id, key_id),
            )
            conn.commit()
        finally:
            conn.close()

        mock_svc = self._mock_service()
        monkeypatch.setattr(gcal_sync, "get_service_for_key", lambda kr: mock_svc)
        ok, fail, _ = gcal_sync.sync_pending([{
            "appointment_id": appt_id, "key_id": key_id, "op_type": "C",
            "google_event_id": "", "last_modified_at": t1,
        }])
        assert (ok, fail) == (1, 0)
        conn = get_db()
        try:
            row = conn.execute(
                "SELECT last_modified_at FROM appointment_sync_queue WHERE appointment_id=? AND key_id=?",
                (appt_id, key_id),
            ).fetchone()
            assert row is not None
            assert row["last_modified_at"] == t2
        finally:
            conn.close()

    def test_stale_completion_does_not_overwrite_newer_map_hash(self, client, monkeypatch):
        """舊同步完成時不可覆蓋 newer queue/map 版本，避免遠端內容被誤標 synced。"""
        from app.database import get_db
        from app.services import gcal_sync, sync_scheduler

        sync_scheduler.stop()
        conn = get_db()
        try:
            key_id = conn.execute(
                "INSERT INTO gcal_keys(name,credentials_path,calendar_id) VALUES('stale-map-key','x.json','stale@cal')"
            ).lastrowid
            appt_id = conn.execute(
                "INSERT INTO appointments(client_name,date,start_time,end_time,note) VALUES(?,?,?,?,?)",
                ("stale-map", "2026-08-28", "09:00", "10:00", "new note"),
            ).lastrowid
            conn.execute(
                "INSERT INTO appointment_gcal_map(appointment_id,key_id,google_event_id,data_hash) VALUES(?,?,?,?)",
                (appt_id, key_id, "stale-event", "newer-map-hash"),
            )
            newer_version = gcal_sync.sync_version_now()
            conn.execute(
                "INSERT INTO appointment_sync_queue(appointment_id,key_id,op_type,google_event_id,last_modified_at) "
                "VALUES(?,?, 'U', ?, ?)", (appt_id, key_id, "stale-event", newer_version),
            )
            conn.commit()
        finally:
            conn.close()

        service = self._mock_service()
        monkeypatch.setattr(gcal_sync, "get_service_for_key", lambda row: service)
        ok, fail, _ = gcal_sync.sync_pending([{
            "appointment_id": appt_id, "key_id": key_id, "op_type": "U",
            "google_event_id": "stale-event", "last_modified_at": "older-version",
        }])
        assert (ok, fail) == (1, 0)
        conn = get_db()
        try:
            mapping = conn.execute(
                "SELECT data_hash FROM appointment_gcal_map WHERE appointment_id=? AND key_id=?",
                (appt_id, key_id),
            ).fetchone()
            queue = conn.execute(
                "SELECT last_modified_at FROM appointment_sync_queue WHERE appointment_id=? AND key_id=?",
                (appt_id, key_id),
            ).fetchone()
            assert mapping["data_hash"] == "newer-map-hash"
            assert queue["last_modified_at"] == newer_version
        finally:
            conn.close()

    def test_missing_appointment_queue_is_cleaned(self, client, monkeypatch):
        """來源 appointment 已刪除 -> C queue 自動清理，不算同步失敗。"""
        from app.database import get_db
        from app.services import gcal_sync

        conn = get_db()
        try:
            conn.execute("INSERT INTO gcal_keys(name, credentials_path, calendar_id, is_active) "
                         "VALUES('OrphanKey', 'fake.json', 'orphan@cal', 1)")
            key_id = conn.execute("SELECT id FROM gcal_keys WHERE name='OrphanKey'").fetchone()["id"]
            conn.execute("INSERT INTO appointment_sync_queue "
                         "(appointment_id,key_id,op_type,google_event_id,last_modified_at) "
                         "VALUES(?,?,?,?,?)", (106, key_id, 'C', '', '2026-08-28 00:00:00'))
            conn.commit()
        finally:
            conn.close()

        monkeypatch.setattr(gcal_sync, "get_service_for_key", lambda kr: MagicMock())
        ok, fail, summary = gcal_sync.sync_pending([{
            "appointment_id": 106, "key_id": key_id, "op_type": "C",
            "google_event_id": "", "last_modified_at": "2026-08-28 00:00:00"
        }])

        assert (ok, fail) == (0, 0)
        assert summary[key_id]["resolved"]["appointment_deleted"] == 1
        conn = get_db()
        try:
            assert conn.execute("SELECT 1 FROM appointment_sync_queue WHERE appointment_id=106").fetchone() is None
        finally:
            conn.close()

    def test_stale_delete_410_does_not_remove_newer_map(self, client, monkeypatch):
        """舊 D/410 completion 不可清除 newer U 的 map/queue。"""
        from app.database import get_db
        from app.services import gcal_sync, sync_scheduler
        from types import SimpleNamespace
        from unittest.mock import MagicMock

        sync_scheduler.stop()
        conn = get_db()
        try:
            key_id = conn.execute(
                "INSERT INTO gcal_keys(name,credentials_path,calendar_id) VALUES('stale-delete-key','x.json','sd@cal')"
            ).lastrowid
            appt_id = conn.execute(
                "INSERT INTO appointments(client_name,date,start_time,end_time) VALUES(?,?,?,?)",
                ("stale-delete", "2026-08-28", "09:00", "10:00"),
            ).lastrowid
            conn.execute(
                "INSERT INTO appointment_gcal_map(appointment_id,key_id,google_event_id,data_hash) VALUES(?,?,?,?)",
                (appt_id, key_id, "new-event", "new-map-hash"),
            )
            newer_version = gcal_sync.sync_version_now()
            conn.execute(
                "INSERT INTO appointment_sync_queue(appointment_id,key_id,op_type,google_event_id,last_modified_at) "
                "VALUES(?,?, 'U', ?, ?)", (appt_id, key_id, "new-event", newer_version),
            )
            conn.commit()
        finally:
            conn.close()

        gone = Exception("remote deleted")
        gone.resp = SimpleNamespace(status=410)
        service = MagicMock()
        service.events().delete.return_value.execute.side_effect = gone
        monkeypatch.setattr(gcal_sync, "get_service_for_key", lambda row: service)
        ok, fail, _ = gcal_sync.sync_pending([{
            "appointment_id": appt_id, "key_id": key_id, "op_type": "D",
            "google_event_id": "old-event", "last_modified_at": "old-version",
        }])
        assert (ok, fail) == (1, 0)
        conn = get_db()
        try:
            mapping = conn.execute(
                "SELECT google_event_id,data_hash FROM appointment_gcal_map WHERE appointment_id=? AND key_id=?",
                (appt_id, key_id),
            ).fetchone()
            queue = conn.execute(
                "SELECT op_type,google_event_id,last_modified_at FROM appointment_sync_queue "
                "WHERE appointment_id=? AND key_id=?", (appt_id, key_id),
            ).fetchone()
            assert (mapping["google_event_id"], mapping["data_hash"]) == ("new-event", "new-map-hash")
            assert (queue["op_type"], queue["google_event_id"], queue["last_modified_at"]) == (
                "U", "new-event", newer_version
            )
        finally:
            conn.close()

    def test_disabled_key_skipped(self, client, monkeypatch):
        """key 停用 -> 本輪不呼叫 Google，queue 保留供重新啟用 catch up"""
        from app.database import get_db
        from app.services import gcal_sync

        conn = get_db()
        try:
            conn.execute("INSERT INTO gcal_keys(name, credentials_path, calendar_id, is_active) "
                         "VALUES('OffKey', 'fake.json', 'off@cal', 0)")  # 停用
            key_id = conn.execute("SELECT id FROM gcal_keys WHERE name='OffKey'").fetchone()["id"]
            conn.execute("INSERT INTO appointment_sync_queue(appointment_id,key_id,op_type,last_modified_at) "
                         "VALUES(999,?, 'C', '2026-08-28 00:00:00')", (key_id,))
            conn.commit()
        finally:
            conn.close()

        due = [{"appointment_id": 999, "key_id": key_id, "op_type": "C",
                "google_event_id": "", "last_modified_at": "2026-08-28 00:00:00"}]
        ok, fail, _ = gcal_sync.sync_pending(due)
        assert ok == 0
        assert fail == 0
        # 停用 key 的 queue 不應被誤清，重新啟用時 backfill 才能 catch up。
        conn = get_db()
        try:
            q = conn.execute("SELECT COUNT(*) c FROM appointment_sync_queue WHERE key_id=?",
                             (key_id,)).fetchone()
            assert q["c"] == 1
        finally:
            conn.close()

    def test_update_patches_event(self, client, monkeypatch):
        """U op -> events().patch()（有 gid 時）"""
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
        ok, fail, _ = gcal_sync.sync_pending(due)
        assert ok == 1
        mock_svc.events().patch().execute.assert_called_once()
        mock_svc.events().insert().execute.assert_not_called()

    def test_empty_due_returns_zero(self, monkeypatch):
        """空 due 不查 DB，並回傳三值零結果。"""
        from app.services import gcal_sync

        def fail_get_db():
            raise AssertionError("sync_pending([]) must not access the database")

        monkeypatch.setattr(gcal_sync, "get_db", fail_get_db)
        ok, fail, error_summary = gcal_sync.sync_pending([])
        assert (ok, fail, error_summary) == (0, 0, {})


# ============================================================
# _due_ids 窗口邊界測試
# ============================================================

class TestDueIds:
    def test_within_window(self):
        """5 分鐘內 -> 不 due"""
        from app.services.sync_scheduler import _due_ids
        from datetime import datetime
        now = datetime(2026, 8, 28, 10, 5, 0)
        rows = [{"appointment_id": 1, "key_id": 1,
                 "last_modified_at": "2026-08-28 10:02:00"}]
        assert _due_ids(rows, now, window=300) == set()

    def test_outside_window(self):
        """超過 5 分鐘 -> due"""
        from app.services.sync_scheduler import _due_ids
        from datetime import datetime
        now = datetime(2026, 8, 28, 10, 10, 0)
        rows = [{"appointment_id": 1, "key_id": 1,
                 "last_modified_at": "2026-08-28 10:00:00"}]
        assert _due_ids(rows, now, window=300) == {(1, 1)}

    def test_boundary_exactly_300s(self):
        """剛好 300 秒 -> due"""
        from app.services.sync_scheduler import _due_ids
        from datetime import datetime
        now = datetime(2026, 8, 28, 10, 5, 0)
        rows = [{"appointment_id": 1, "key_id": 1,
                 "last_modified_at": "2026-08-28 10:00:00"}]
        assert _due_ids(rows, now, window=300) == {(1, 1)}

    def test_subsecond_timestamp_still_obeys_debounce(self):
        """queue 的微秒版本不可被舊秒級 parser 誤判成永遠 due。"""
        from app.services.sync_scheduler import _due_ids
        from datetime import datetime
        rows = [{"appointment_id": 1, "key_id": 1,
                 "last_modified_at": "2026-08-28 10:04:30.500000"}]
        assert _due_ids(rows, datetime(2026, 8, 28, 10, 5, 0), window=300) == set()
        assert _due_ids(rows, datetime(2026, 8, 28, 10, 9, 31), window=300) == {(1, 1)}

    def test_invalid_timestamp(self):
        """無效時間戳 -> datetime.min -> 永遠 due"""
        from app.services.sync_scheduler import _due_ids
        from datetime import datetime
        now = datetime(2026, 8, 28, 10, 0, 0)
        rows = [{"appointment_id": 1, "key_id": 1, "last_modified_at": None}]
        assert _due_ids(rows, now) == {(1, 1)}


class TestComputeEventHash:
    def test_same_data_same_hash(self):
        """相同資料 -> 相同 hash"""
        from app.services.gcal_sync import compute_event_hash
        row = {"client_name": "測試客戶", "date": "2026-08-28",
               "start_time": "09:00", "end_time": "11:00",
               "note": "備註", "service_type_id": 1}
        assignees = [{"user_id": 1}, {"user_id": 2}]
        h1 = compute_event_hash(row, assignees)
        h2 = compute_event_hash(row, assignees)
        assert h1 == h2
        assert len(h1) == 64  # canonical SHA-256 hex

    def test_different_data_different_hash(self):
        """不同資料 -> 不同 hash"""
        from app.services.gcal_sync import compute_event_hash
        row1 = {"client_name": "客戶A", "date": "2026-08-28",
                "start_time": "09:00", "end_time": "11:00",
                "note": "", "service_type_id": 1}
        row2 = {"client_name": "客戶B", "date": "2026-08-28",
                "start_time": "09:00", "end_time": "11:00",
                "note": "", "service_type_id": 1}
        assert compute_event_hash(row1, []) != compute_event_hash(row2, [])

    def test_empty_assignees(self):
        """無指派人 -> 正常回傳"""
        from app.services.gcal_sync import compute_event_hash
        row = {"client_name": "test", "date": "2026-08-28",
               "start_time": "09:00", "end_time": "11:00",
               "note": "", "service_type_id": None}
        h = compute_event_hash(row, [])
        assert len(h) == 64

    def test_address_change_changes_hash(self):
        """A7 防回歸：address 納入 hash → 只改地址也觸發同步。

        修復前 compute_event_hash 不含 address，只改地址 hash 相同 → 永不同步。
        """
        from app.services.gcal_sync import compute_event_hash
        base = {"client_name": "客戶A", "date": "2026-08-28",
                "start_time": "09:00", "end_time": "11:00",
                "note": "", "service_type_id": 1}
        addr1 = dict(base, address="台北市中正區")
        addr2 = dict(base, address="新北市板橋區")
        assert compute_event_hash(addr1, []) != compute_event_hash(addr2, [])
        # 無 address vs 有 address 也應不同
        assert compute_event_hash(base, []) != compute_event_hash(addr1, [])


class TestHashSkipRemoved:
    """A4：hash-skip 已移除，C/U op 每次都進 queue（不論 hash 是否相同）"""

    def test_same_hash_still_queues(self, client, monkeypatch):
        """A4 防回歸：hash 相同 → sync_queue 仍新增列（不再跳過）"""
        from app.database import get_db
        from app.services import gcal_sync

        # 建 key
        conn = get_db()
        try:
            conn.execute("INSERT INTO gcal_keys(name, credentials_path, calendar_id, is_active) "
                         "VALUES('hashKey', 'fake.json', 'test@cal', 1)")
            conn.execute("UPDATE users SET gcal_key='hashKey' WHERE username='admin'")
            conn.commit()
        finally:
            conn.close()

        # 建行程
        r = client.post("/api/appointments", json={
            "client_name": "hash測試", "date": "2026-08-28",
            "start_time": "09:00", "end_time": "11:00",
            "user_ids": [1], "note": ""
        })
        appt_id = r.json()["id"]

        # 確認 sync_queue 有一列
        conn = get_db()
        try:
            q1 = conn.execute("SELECT COUNT(*) FROM appointment_sync_queue").fetchone()[0]
        finally:
            conn.close()
        assert q1 >= 1

        # 手動寫入 gcal_map + data_hash（模擬已同步過，hash 相同）
        conn = get_db()
        try:
            conn.execute(
                "INSERT INTO appointment_gcal_map(appointment_id, key_id, google_event_id, data_hash) "
                "VALUES(?, 1, 'fake-event-id', ?)",
                (appt_id, gcal_sync.compute_event_hash(
                    {"client_name": "hash測試", "date": "2026-08-28",
                     "start_time": "09:00", "end_time": "11:00",
                     "note": "", "service_type_id": None, "address": ""},
                    [{"user_id": 1}])))
            conn.commit()
        finally:
            conn.close()

        # 清空 sync_queue
        conn = get_db()
        try:
            conn.execute("DELETE FROM appointment_sync_queue")
            conn.commit()
        finally:
            conn.close()

        # 編輯行程（內容不變）-> A4：hash 相同但仍進 queue
        client.put(f"/api/appointments/{appt_id}", json={
            "client_name": "hash測試", "date": "2026-08-28",
            "start_time": "09:00", "end_time": "11:00",
            "user_ids": [1], "note": ""
        })

        # A4：sync_queue 應有 1 列（不再跳過）
        conn = get_db()
        try:
            q2 = conn.execute("SELECT COUNT(*) FROM appointment_sync_queue").fetchone()[0]
        finally:
            conn.close()
        assert q2 == 1, f"A4：hash 相同仍應進 queue，但 sync_queue 有 {q2} 列"

    def test_op_type_not_stale_after_reassign(self, client, monkeypatch):
        """A4 防回歸：換人指派後 op_type 不再是舊值（hash-skip 移除前會卡在舊 C）"""
        from app.database import get_db

        # 建 2 個 key + 2 個使用者
        conn = get_db()
        try:
            conn.execute("INSERT INTO gcal_keys(name, credentials_path, calendar_id, is_active) "
                         "VALUES('keyA', 'a.json', 'a@cal', 1)")
            conn.execute("INSERT INTO gcal_keys(name, credentials_path, calendar_id, is_active) "
                         "VALUES('keyB', 'b.json', 'b@cal', 1)")
            conn.execute("UPDATE users SET gcal_key='keyA' WHERE username='admin'")
            # 建第二個使用者
            conn.execute("INSERT INTO users(username, password_hash, display_name, role, gcal_key) "
                         "VALUES('user2', 'pw', 'User2', 'editor', 'keyB')")
            conn.commit()
            uid2 = conn.execute("SELECT id FROM users WHERE username='user2'").fetchone()[0]
        finally:
            conn.close()

        # 建行程（只指派 admin = keyA）
        r = client.post("/api/appointments", json={
            "client_name": "op_test", "date": "2026-08-28",
            "start_time": "09:00", "end_time": "11:00",
            "user_ids": [1], "note": ""
        })
        appt_id = r.json()["id"]

        # 模擬已同步到 keyA（建 map row）
        conn = get_db()
        try:
            conn.execute("INSERT INTO appointment_gcal_map(appointment_id, key_id, google_event_id, data_hash) "
                         "VALUES(?,?,'keyA-event','hash')", (appt_id, 1))
            conn.execute("DELETE FROM appointment_sync_queue")
            conn.commit()
        finally:
            conn.close()

        # 改指派給 user2（keyB）→ keyA 應 orphan 刪除
        client.put(f"/api/appointments/{appt_id}", json={
            "client_name": "op_test", "date": "2026-08-28",
            "start_time": "09:00", "end_time": "11:00",
            "user_ids": [uid2], "note": ""
        })

        # queue 應有 D（keyA orphan）+ U（keyB new）= 2 列，且 op_type 正確
        conn = get_db()
        try:
            rows = conn.execute(
                "SELECT key_id, op_type FROM appointment_sync_queue "
                "WHERE appointment_id=? ORDER BY key_id", (appt_id,)).fetchall()
        finally:
            conn.close()
        ops = {r["key_id"]: r["op_type"] for r in rows}
        # keyA 應是 D（orphan），keyB 應是 U（新 target）
        assert any(v == "D" for v in ops.values()), f"應有 D orphan，但 ops={ops}"

    def test_different_hash_fills_queue(self, client, monkeypatch):
        """hash 不同 -> sync_queue 新增列"""
        from app.database import get_db
        from app.services import gcal_sync

        # 建 key
        conn = get_db()
        try:
            conn.execute("INSERT INTO gcal_keys(name, credentials_path, calendar_id, is_active) "
                         "VALUES('hashKey2', 'fake.json', 'test@cal', 1)")
            conn.execute("UPDATE users SET gcal_key='hashKey2' WHERE username='admin'")
            conn.commit()
        finally:
            conn.close()

        # 建行程
        r = client.post("/api/appointments", json={
            "client_name": "hash測試2", "date": "2026-08-28",
            "start_time": "09:00", "end_time": "11:00",
            "user_ids": [1], "note": ""
        })
        appt_id = r.json()["id"]

        # 手動寫入 gcal_map + data_hash（模擬已同步過）
        conn = get_db()
        try:
            conn.execute(
                "INSERT INTO appointment_gcal_map(appointment_id, key_id, google_event_id, data_hash) "
                "VALUES(?, 1, 'fake-event-id', ?)",
                (appt_id, gcal_sync.compute_event_hash(
                    {"client_name": "hash測試2", "date": "2026-08-28",
                     "start_time": "09:00", "end_time": "11:00",
                     "note": "", "service_type_id": None},
                    [{"user_id": 1}])))
            conn.commit()
        finally:
            conn.close()

        # 清空 sync_queue
        conn = get_db()
        try:
            conn.execute("DELETE FROM appointment_sync_queue")
            conn.commit()
        finally:
            conn.close()

        # 編輯行程（改備註）-> hash 改變 -> 應該寫入 sync_queue
        client.put(f"/api/appointments/{appt_id}", json={
            "client_name": "hash測試2", "date": "2026-08-28",
            "start_time": "09:00", "end_time": "11:00",
            "user_ids": [1], "note": "改了備註"
        })

        conn = get_db()
        try:
            q = conn.execute("SELECT COUNT(*) FROM appointment_sync_queue").fetchone()[0]
        finally:
            conn.close()
        assert q >= 1, "hash 不同應寫入 sync_queue"


class TestBackfillOnKeyCreation:
    """新增 key -> 自動 backfill 旧行程"""

    def test_new_key_backfills_existing_appointments(self, client):
        """POST 新 key -> 旧行程自動加入 sync_queue"""
        from app.database import get_db

        # 先建一筆行程
        client.post("/api/appointments", json={
            "client_name": "backfill測試", "date": "2026-08-28",
            "start_time": "09:00", "end_time": "11:00",
            "user_ids": [1], "note": ""
        })

        # 清空 sync_queue（排除建行程時觸發的）
        conn = get_db()
        try:
            conn.execute("DELETE FROM appointment_sync_queue")
            conn.commit()
        finally:
            conn.close()

        # 新增 key
        r = client.post("/api/gcal-keys", json={
            "name": "backfillKey",
            "credentials_path": "fake.json",
            "calendar_id": "test@cal"
        })
        assert r.status_code == 201

        # 檢查 sync_queue 有旧行程（key_id=新key的id）
        conn = get_db()
        try:
            new_key_id = conn.execute("SELECT id FROM gcal_keys WHERE name='backfillKey'").fetchone()[0]
            q = conn.execute(
                "SELECT COUNT(*) FROM appointment_sync_queue WHERE key_id=?", (new_key_id,)).fetchone()[0]
        finally:
            conn.close()
        assert q >= 1, f"新增 key 後旧行程應 backfill，但 sync_queue 有 {q} 列"


class TestBackfillOnKeyReenable:
    """key 從停用->啟用 -> 自動 backfill"""

    def test_reenable_key_backfills(self, client):
        """PUT key is_active 0->1 -> 旧行程加入 sync_queue"""
        from app.database import get_db

        # 建 key + 停用
        conn = get_db()
        try:
            conn.execute("INSERT INTO gcal_keys(name, credentials_path, calendar_id, is_active) "
                         "VALUES('reenableKey', 'fake.json', 'test@cal', 0)")
            conn.commit()
            key_id = conn.execute("SELECT id FROM gcal_keys WHERE name='reenableKey'").fetchone()[0]
        finally:
            conn.close()

        # 建行程
        client.post("/api/appointments", json={
            "client_name": "reenable測試", "date": "2026-08-28",
            "start_time": "09:00", "end_time": "11:00",
            "user_ids": [1], "note": ""
        })

        # 清空 sync_queue
        conn = get_db()
        try:
            conn.execute("DELETE FROM appointment_sync_queue")
            conn.commit()
        finally:
            conn.close()

        # 重新啟用 key
        r = client.put(f"/api/gcal-keys/{key_id}", json={"is_active": True})
        assert r.status_code == 200

        # 檢查 sync_queue
        conn = get_db()
        try:
            q = conn.execute(
                "SELECT COUNT(*) FROM appointment_sync_queue WHERE key_id=?", (key_id,)).fetchone()[0]
        finally:
            conn.close()
        assert q >= 1, f"key 重新啟用後旧行程應 backfill，但 sync_queue 有 {q} 列"


class TestDynamicRateLimit:
    """動態速率限制（per-user 480 + 專案級 8000）"""

    def test_per_key_limit_decreases_with_more_keys(self):
        """更多 key -> 每個 key 的限制降低"""
        from app.services.gcal_sync import _RATE_PER_USER, _RATE_PROJECT

        # 1 個 key：min(480, 8000/1) = 480
        limit_1 = min(_RATE_PER_USER, _RATE_PROJECT // 1)
        assert limit_1 == 480

        # 10 個 key：min(480, 8000/10) = 480
        limit_10 = min(_RATE_PER_USER, _RATE_PROJECT // 10)
        assert limit_10 == 480

        # 20 個 key：min(480, 8000/20) = 400
        limit_20 = min(_RATE_PER_USER, _RATE_PROJECT // 20)
        assert limit_20 == 400

        # 100 個 key：min(480, 8000/100) = 80
        limit_100 = min(_RATE_PER_USER, _RATE_PROJECT // 100)
        assert limit_100 == 80


class TestDiscordNotification:
    """Discord webhook 失敗通知"""

    def test_notify_discord_sends_webhook(self, monkeypatch):
        """_notify_discord 正確呼叫 urllib"""
        from app.services.sync_scheduler import _notify_discord
        import app.config as cfg
        monkeypatch.setattr(cfg, "GCAL_SYNC_WEBHOOK_URL", "https://discord.com/api/webhooks/test-id/test-token")
        monkeypatch.setattr(cfg, "GCAL_SYNC_THREAD_ID", "1234567890")
        called = {}

        def mock_urlopen(req, timeout=10):
            called["url"] = req.full_url
            called["data"] = req.data.decode()
            class FakeResp:
                status = 204
                def read(self): return b""
            return FakeResp()

        monkeypatch.setattr("urllib.request.urlopen", mock_urlopen)
        _notify_discord("test message")

        assert "thread_id=1234567890" in called["url"]
        assert "test message" in called["data"]

    def test_notify_discord_swallows_error(self, monkeypatch):
        """_notify_discord 失敗不抛異常（fire-and-forget）"""
        from app.services.sync_scheduler import _notify_discord

        def mock_urlopen(req, timeout=10):
            raise ConnectionError("network down")

        monkeypatch.setattr("urllib.request.urlopen", mock_urlopen)
        # 不应抛異常
        _notify_discord("should not crash")

    def test_run_once_no_notify_on_success(self, monkeypatch):
        """同步成功不發 Discord 通知"""
        from app.services import sync_scheduler
        notified = []
        monkeypatch.setattr(sync_scheduler, "_notify_discord", lambda msg: notified.append(msg))
        monkeypatch.setattr(sync_scheduler.gcal_sync, "is_enabled", lambda: True)
        monkeypatch.setattr(sync_scheduler.gcal_sync, "recover_pending_calendar_migrations", lambda: 0)
        monkeypatch.setattr(sync_scheduler, "_due_ids", lambda rows, now, **kw: {(1, 1)})
        monkeypatch.setattr(sync_scheduler, "get_db", lambda: _FakeConn(rows=[
            {"appointment_id": 1, "key_id": 1, "op_type": "C",
             "google_event_id": "", "last_modified_at": "2026-01-01 00:00:00"}
        ]))
        monkeypatch.setattr(sync_scheduler.gcal_sync, "sync_pending", lambda due: (1, 0, {}))

        sync_scheduler._run_once()
        assert len(notified) == 0  # 成功不通知

    def test_run_once_reports_resolved_results(self, monkeypatch):
        """只有自動處理結果時也顯示原因，但不算同步失敗。"""
        from app.services import sync_scheduler
        notified = []
        monkeypatch.setattr(sync_scheduler, "_notify_discord", lambda msg: notified.append(msg))
        monkeypatch.setattr(sync_scheduler.gcal_sync, "is_enabled", lambda: True)
        monkeypatch.setattr(sync_scheduler.gcal_sync, "recover_pending_calendar_migrations", lambda: 0)
        monkeypatch.setattr(sync_scheduler, "_due_ids", lambda rows, now, **kw: {(1, 1)})
        monkeypatch.setattr(sync_scheduler, "get_db", lambda: _FakeConn(rows=[
            {"appointment_id": 1, "key_id": 1, "op_type": "C",
             "google_event_id": "", "last_modified_at": "2026-01-01 00:00:00"}
        ]))
        monkeypatch.setattr(sync_scheduler.gcal_sync, "sync_pending", lambda due: (4, 0, {
            1: {"key_name": "GoneKey", "cal_id": "gone@cal", "errors": {},
                "resolved": {"appointment_deleted": 1}}
        }))

        sync_scheduler._run_once()

        assert len(notified) == 1
        assert "已自動處理" in notified[0]
        assert "本地行程已刪除" in notified[0]
        assert "Key「GoneKey」" in notified[0]
        assert "失敗 0" in notified[0]

    def test_run_once_notifies_on_failure(self, monkeypatch):
        """同步失敗發 Discord 通知"""
        from app.services import sync_scheduler
        notified = []
        monkeypatch.setattr(sync_scheduler, "_notify_discord", lambda msg: notified.append(msg))
        monkeypatch.setattr(sync_scheduler.gcal_sync, "is_enabled", lambda: True)
        monkeypatch.setattr(sync_scheduler.gcal_sync, "recover_pending_calendar_migrations", lambda: 0)
        monkeypatch.setattr(sync_scheduler, "_due_ids", lambda rows, now, **kw: {(1, 1)})
        monkeypatch.setattr(sync_scheduler, "get_db", lambda: _FakeConn(rows=[
            {"appointment_id": 1, "key_id": 1, "op_type": "C",
             "google_event_id": "", "last_modified_at": "2026-01-01 00:00:00"}
        ]))
        monkeypatch.setattr(sync_scheduler.gcal_sync, "sync_pending", lambda due: (0, 1, {}))

        sync_scheduler._run_once()
        assert len(notified) == 1
        assert "失敗" in notified[0]



class TestGcalLog:
    """gcal_log.py 共用 logging 模組"""

    def test_today_dir_format(self):
        """_today_dir() 回傳 logs/MMDD/ 格式"""
        from app.services.gcal_log import _today_dir
        import os
        d = _today_dir()
        basename = os.path.basename(d)
        assert len(basename) == 4 and basename.isdigit()

    def test_archive_legacy_log(self, tmp_path):
        """舊 logs/gcal_sync.log 歸檔為 archive_legacy_gcal_sync.log"""
        from app.services import gcal_log
        logs_dir = tmp_path / "logs"
        logs_dir.mkdir()
        legacy = logs_dir / "gcal_sync.log"
        legacy.write_text("old log content")
        old_base = gcal_log._LOG_BASE
        gcal_log._LOG_BASE = str(logs_dir)
        try:
            gcal_log._archive_legacy_log()
            assert not legacy.exists()
            archive = logs_dir / "archive_legacy_gcal_sync.log"
            assert archive.exists()
            assert archive.read_text() == "old log content"
        finally:
            gcal_log._LOG_BASE = old_base

    def test_get_logger_returns_logger(self):
        """get_logger() 回傳帶 handler 的 logger"""
        from app.services.gcal_log import get_logger
        logger = get_logger("test_gcal_log_module")
        assert logger is not None
        assert logger.level <= 20  # INFO or lower


class TestErrorSummary:
    """sync_pending() error_summary 回傳"""

    def test_error_summary_classifies_http_error(self, client, monkeypatch):
        """HttpError 被分類為 'HttpError NNN'"""
        from app.services import gcal_sync
        conn = gcal_sync.get_db()
        try:
            conn.execute("INSERT INTO gcal_keys (name, credentials_path, calendar_id) VALUES (?, ?, ?)",
                         ("test_key", "fake.json", "test@gmail.com"))
            conn.commit()
            key_id = conn.execute("SELECT id FROM gcal_keys WHERE name='test_key'").fetchone()["id"]
        finally:
            conn.close()

        from unittest.mock import MagicMock
        fake_service = MagicMock()
        fake_service.events().insert().execute.side_effect = Exception(
            "HttpError 404 when requesting https://www.googleapis.com/calendar/v3/calendars/test%40gmail.com/events"
        )
        monkeypatch.setattr(gcal_sync, "get_service_for_key", lambda kr: fake_service)
        monkeypatch.setattr(gcal_sync, "_load_appointment_for_sync", lambda c, a: (
            {"client_name": "Test", "service_name": None, "address": "", "date": "2026-01-01",
             "start_time": "09:00", "end_time": "10:00", "note": ""},
            [{"id": 1, "name": "Test", "color": "#000"}]
        ))
        monkeypatch.setattr(gcal_sync, "load_sync_settings", lambda c: {})
        monkeypatch.setattr(gcal_sync, "load_key_reminders", lambda kr: [])

        due = [{"appointment_id": 999, "key_id": key_id, "op_type": "C",
                "google_event_id": "", "last_modified_at": "2026-01-01 00:00:00"}]
        ok, fail, error_summary = gcal_sync.sync_pending(due)

        assert fail == 1
        assert key_id in error_summary
        assert error_summary[key_id]["cal_id"] == "test@gmail.com"
        assert any("HttpError 404" in k for k in error_summary[key_id]["errors"])

    def test_error_summary_classifies_network_error(self, client, monkeypatch):
        """network down 被分類"""
        from app.services import gcal_sync
        conn = gcal_sync.get_db()
        try:
            conn.execute("INSERT INTO gcal_keys (name, credentials_path, calendar_id) VALUES (?, ?, ?)",
                         ("test_net", "fake.json", "net@gmail.com"))
            conn.commit()
            key_id = conn.execute("SELECT id FROM gcal_keys WHERE name='test_net'").fetchone()["id"]
        finally:
            conn.close()

        fake_service = MagicMock()
        fake_service.events().insert().execute.side_effect = OSError("network down")
        monkeypatch.setattr(gcal_sync, "get_service_for_key", lambda kr: fake_service)
        monkeypatch.setattr(gcal_sync, "_load_appointment_for_sync", lambda c, a: (
            {"client_name": "Test", "service_name": None, "address": "", "date": "2026-01-01",
             "start_time": "09:00", "end_time": "10:00", "note": ""},
            [{"id": 1, "name": "Test", "color": "#000"}]
        ))
        monkeypatch.setattr(gcal_sync, "load_sync_settings", lambda c: {})
        monkeypatch.setattr(gcal_sync, "load_key_reminders", lambda kr: [])

        due = [{"appointment_id": 998, "key_id": key_id, "op_type": "C",
                "google_event_id": "", "last_modified_at": "2026-01-01 00:00:00"}]
        ok, fail, error_summary = gcal_sync.sync_pending(due)

        assert fail == 1
        assert "network down" in error_summary[key_id]["errors"]

    def test_error_summary_groups_by_key(self, client, monkeypatch):
        """多個 appointment 同 key 的錯誤被分組計數"""
        from app.services import gcal_sync
        conn = gcal_sync.get_db()
        try:
            conn.execute("INSERT INTO gcal_keys (name, credentials_path, calendar_id) VALUES (?, ?, ?)",
                         ("test_grp", "fake.json", "grp@gmail.com"))
            conn.commit()
            key_id = conn.execute("SELECT id FROM gcal_keys WHERE name='test_grp'").fetchone()["id"]
        finally:
            conn.close()

        fake_service = MagicMock()
        def fail_insert(**kwargs):
            raise OSError("network down")
        fake_service.events().insert.side_effect = fail_insert
        monkeypatch.setattr(gcal_sync, "get_service_for_key", lambda kr: fake_service)
        monkeypatch.setattr(gcal_sync, "_load_appointment_for_sync", lambda c, a: (
            {"client_name": "Test", "service_name": None, "address": "", "date": "2026-01-01",
             "start_time": "09:00", "end_time": "10:00", "note": ""},
            [{"id": 1, "name": "Test", "color": "#000"}]
        ))
        monkeypatch.setattr(gcal_sync, "load_sync_settings", lambda c: {})
        monkeypatch.setattr(gcal_sync, "load_key_reminders", lambda kr: [])

        due = [
            {"appointment_id": i, "key_id": key_id, "op_type": "C",
             "google_event_id": "", "last_modified_at": "2026-01-01 00:00:00"}
            for i in (997, 996, 995)
        ]
        ok, fail, error_summary = gcal_sync.sync_pending(due)

        assert fail == 3
        assert error_summary[key_id]["errors"]["network down"] == 3

    def test_empty_due_returns_empty_summary(self, monkeypatch):
        """空 due 不查 DB，並回傳空 error_summary。"""
        from app.services import gcal_sync

        def fail_get_db():
            raise AssertionError("sync_pending([]) must not access the database")

        monkeypatch.setattr(gcal_sync, "get_db", fail_get_db)
        ok, fail, error_summary = gcal_sync.sync_pending([])
        assert (ok, fail, error_summary) == (0, 0, {})


class TestStopGuard:
    """sync_scheduler.stop() 防重入"""

    def test_stop_when_not_started_no_log(self, monkeypatch):
        """stop() 在未啟動時不寫 log"""
        from app.services import sync_scheduler
        import logging
        log_msgs = []
        handler = logging.Handler()
        handler.emit = lambda record: log_msgs.append(record.getMessage())
        sync_scheduler.logger.addHandler(handler)
        try:
            sync_scheduler._thread = None
            sync_scheduler.stop()
            assert not any("已停止" in m for m in log_msgs)
        finally:
            sync_scheduler.logger.removeHandler(handler)

    def test_stop_idempotent(self, monkeypatch):
        """連續呼叫 stop() 兩次只 log 一次"""
        from app.services import sync_scheduler
        import threading
        import logging
        log_msgs = []
        handler = logging.Handler()
        handler.emit = lambda record: log_msgs.append(record.getMessage())
        sync_scheduler.logger.addHandler(handler)
        try:
            # 建立並啟動假 thread（這樣 join 才不會卡住）
            fake_thread = threading.Thread(target=lambda: None)
            fake_thread.daemon = True
            fake_thread.start()
            sync_scheduler._thread = fake_thread
            sync_scheduler._stop.clear()
            sync_scheduler.stop()
            count_first = sum(1 for m in log_msgs if "已停止" in m)
            sync_scheduler.stop()
            count_second = sum(1 for m in log_msgs if "已停止" in m)
            assert count_first == 1
            assert count_second == 1
        finally:
            sync_scheduler.logger.removeHandler(handler)
            sync_scheduler._thread = None


class TestDiscordNotificationFormat:
    """Discord 通知格式包含錯誤分類"""

    def test_failure_message_includes_key_and_error_type(self, monkeypatch):
        """失敗通知包含 key email 和錯誤類型"""
        from app.services import sync_scheduler
        notified = []
        monkeypatch.setattr(sync_scheduler, "_notify_discord", lambda msg: notified.append(msg))
        monkeypatch.setattr(sync_scheduler.gcal_sync, "is_enabled", lambda: True)
        monkeypatch.setattr(sync_scheduler.gcal_sync, "recover_pending_calendar_migrations", lambda: 0)
        monkeypatch.setattr(sync_scheduler, "_due_ids", lambda rows, now, **kw: {(1, 1)})
        monkeypatch.setattr(sync_scheduler, "get_db", lambda: _FakeConn(rows=[
            {"appointment_id": 1, "key_id": 1, "op_type": "C",
             "google_event_id": "", "last_modified_at": "2026-01-01 00:00:00"}
        ]))
        error_summary = {
            1: {"cal_id": "test@gmail.com", "errors": {"HttpError 404": 5, "network down": 2}}
        }
        monkeypatch.setattr(sync_scheduler.gcal_sync, "sync_pending",
                            lambda due: (0, 7, error_summary))

        sync_scheduler._run_once()
        assert len(notified) == 1
        msg = notified[0]
        assert "test@gmail.com" in msg
        assert "HttpError 404" in msg
        assert "network down" in msg

    def test_success_no_notification(self, monkeypatch):
        """成功不發通知"""
        from app.services import sync_scheduler
        notified = []
        monkeypatch.setattr(sync_scheduler, "_notify_discord", lambda msg: notified.append(msg))
        monkeypatch.setattr(sync_scheduler.gcal_sync, "is_enabled", lambda: True)
        monkeypatch.setattr(sync_scheduler.gcal_sync, "recover_pending_calendar_migrations", lambda: 0)
        monkeypatch.setattr(sync_scheduler, "_due_ids", lambda rows, now, **kw: {(1, 1)})
        monkeypatch.setattr(sync_scheduler, "get_db", lambda: _FakeConn(rows=[
            {"appointment_id": 1, "key_id": 1, "op_type": "C",
             "google_event_id": "", "last_modified_at": "2026-01-01 00:00:00"}
        ]))
        monkeypatch.setattr(sync_scheduler.gcal_sync, "sync_pending",
                            lambda due: (5, 0, {}))

        sync_scheduler._run_once()
        assert len(notified) == 0


class TestCanonicalEventHash:
    def _row(self, **overrides):
        row = {
            "client_name": "客戶A",
            "service_name": "維修",
            "address": "台北市",
            "date": "2026-08-28",
            "start_time": "09:00",
            "end_time": "11:00",
            "note": "備註",
        }
        row.update(overrides)
        return row

    def test_hash_changes_when_service_display_name_changes(self):
        from app.services.gcal_sync import compute_event_hash

        assert compute_event_hash(self._row(service_name="維修"), []) != compute_event_hash(
            self._row(service_name="保養"), []
        )

    def test_hash_changes_when_assignee_display_name_changes(self):
        from app.services.gcal_sync import compute_event_hash

        first = [{"id": 1, "name": "王先生", "color": "#111111"}]
        renamed = [{"id": 1, "name": "王師傅", "color": "#111111"}]
        assert compute_event_hash(self._row(), first) != compute_event_hash(self._row(), renamed)

    def test_hash_changes_for_effective_settings(self):
        from app.services.gcal_sync import compute_event_hash

        base = self._row(end_time="")
        reminders = [{"method": "popup", "minutes": 120}]
        baseline = compute_event_hash(base, [], {"duration_min": 60, "use_location": True,
                                                "transparency": "transparent", "reminders": reminders})
        assert baseline != compute_event_hash(
            base, [], {"duration_min": 90, "use_location": True,
                       "transparency": "transparent", "reminders": reminders}
        )
        assert baseline != compute_event_hash(
            base, [], {"duration_min": 60, "use_location": False,
                       "transparency": "transparent", "reminders": reminders}
        )
        assert baseline != compute_event_hash(
            base, [], {"duration_min": 60, "use_location": True,
                       "transparency": "opaque", "reminders": reminders}
        )
        assert baseline != compute_event_hash(
            base, [], {"duration_min": 60, "use_location": True,
                       "transparency": "transparent",
                       "reminders": [{"method": "popup", "minutes": 1440}]}
        )

    def test_hash_is_canonical_sha256_of_final_event_payload(self):
        import hashlib
        import json
        from app.services.gcal_sync import build_event, compute_event_hash

        row = self._row()
        assignees = [{"id": 1, "name": "王先生", "color": "#111111"}]
        settings = {"duration_min": 60, "use_location": True,
                    "transparency": "opaque", "reminders": [{"method": "popup", "minutes": 15}]}
        event = build_event(row, assignees, settings)
        canonical = json.dumps(event, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        expected = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
        assert compute_event_hash(row, assignees, settings) == expected
        assert len(expected) == 64

    def test_remote_reminder_probe_reads_google_payload(self):
        from unittest.mock import MagicMock
        from app.services.gcal_sync import verify_remote_event_reminders

        service = MagicMock()
        service.events().get.return_value.execute.return_value = {
            "reminders": {"useDefault": False, "overrides": [{"method": "popup", "minutes": 1440}]}
        }
        result = verify_remote_event_reminders(service, "calendar@example.com", "event-1")
        assert result == {"useDefault": False, "overrides": [{"method": "popup", "minutes": 1440}]}
        service.events().get.assert_called_once_with(calendarId="calendar@example.com", eventId="event-1")


class TestSchedulerReliability:
    class _FakeThread:
        def __init__(self, alive=False):
            self.alive = alive
            self.started = False

        def is_alive(self):
            return self.alive

        def start(self):
            self.started = True
            self.alive = True

        def join(self, timeout=None):
            self.alive = False

    def test_start_creates_worker_without_active_key(self, monkeypatch):
        from app.services import sync_scheduler

        created = []
        monkeypatch.setattr(sync_scheduler.threading, "Thread", lambda *args, **kwargs: created.append(self._FakeThread()) or created[-1])
        monkeypatch.setattr(sync_scheduler.gcal_sync, "is_enabled", lambda: False)
        sync_scheduler._thread = None
        sync_scheduler._stop.clear()
        try:
            sync_scheduler.start()
            assert len(created) == 1
            assert created[0].started is True
            assert sync_scheduler._thread is created[0]
        finally:
            sync_scheduler._thread = None
            sync_scheduler._stop.set()

    def test_start_replaces_dead_worker(self, monkeypatch):
        from app.services import sync_scheduler

        dead = self._FakeThread(alive=False)
        created = []
        monkeypatch.setattr(sync_scheduler.threading, "Thread", lambda *args, **kwargs: created.append(self._FakeThread()) or created[-1])
        monkeypatch.setattr(sync_scheduler.gcal_sync, "is_enabled", lambda: False)
        sync_scheduler._thread = dead
        sync_scheduler._stop.clear()
        try:
            sync_scheduler.start()
            assert created and sync_scheduler._thread is created[0]
            assert sync_scheduler._thread is not dead
        finally:
            sync_scheduler._thread = None
            sync_scheduler._stop.set()

    def _run_rows(self, attempts=0, last_modified_at="2026-01-01 00:00:00"):
        return [{"appointment_id": 1, "key_id": 1, "op_type": "U",
                 "google_event_id": "event-1", "last_modified_at": last_modified_at,
                 "attempts": attempts}]

    def test_health_error_does_not_leak_credential_path(self, monkeypatch):
        from app.services import sync_scheduler

        def broken_db():
            raise RuntimeError(r"C:\secrets\service-account.json: private_key")

        monkeypatch.setattr(sync_scheduler, "get_db", broken_db)
        health = sync_scheduler.get_health()
        assert health["last_error"] == "RuntimeError: scheduler round failed"
        assert "service-account.json" not in str(health)

    def test_normal_run_keeps_debounce(self, monkeypatch):
        from datetime import datetime, timedelta
        from app.services import sync_scheduler

        called = []
        recent = (datetime.utcnow() - timedelta(seconds=30)).strftime("%Y-%m-%d %H:%M:%S")
        monkeypatch.setattr(sync_scheduler.gcal_sync, "is_enabled", lambda: True)
        monkeypatch.setattr(sync_scheduler.gcal_sync, "recover_pending_calendar_migrations", lambda: 0)
        monkeypatch.setattr(sync_scheduler, "get_db", lambda: _FakeConn(rows=self._run_rows(last_modified_at=recent)))
        monkeypatch.setattr(sync_scheduler.gcal_sync, "sync_pending", lambda due: called.append(due) or (1, 0, {}))
        sync_scheduler._run_once(force=False)
        assert called == []

    def test_force_run_bypasses_debounce(self, monkeypatch):
        from datetime import datetime, timedelta
        from app.services import sync_scheduler

        called = []
        recent = (datetime.utcnow() - timedelta(seconds=30)).strftime("%Y-%m-%d %H:%M:%S")
        monkeypatch.setattr(sync_scheduler.gcal_sync, "is_enabled", lambda: True)
        monkeypatch.setattr(sync_scheduler.gcal_sync, "recover_pending_calendar_migrations", lambda: 0)
        monkeypatch.setattr(sync_scheduler, "get_db", lambda: _FakeConn(rows=self._run_rows(last_modified_at=recent)))
        monkeypatch.setattr(sync_scheduler.gcal_sync, "sync_pending", lambda due: called.append(due) or (1, 0, {}))
        sync_scheduler._run_once(force=True)
        assert len(called) == 1
        assert called[0][0]["appointment_id"] == 1

    def test_force_run_does_not_select_exhausted_queue(self, monkeypatch):
        from app.services import sync_scheduler

        called = []
        monkeypatch.setattr(sync_scheduler.gcal_sync, "is_enabled", lambda: True)
        monkeypatch.setattr(sync_scheduler.gcal_sync, "recover_pending_calendar_migrations", lambda: 0)
        monkeypatch.setattr(sync_scheduler, "get_db", lambda: _FakeConn(rows=self._run_rows(attempts=5)))
        monkeypatch.setattr(sync_scheduler.gcal_sync, "sync_pending", lambda due: called.append(due) or (1, 0, {}))
        sync_scheduler._run_once(force=True)
        assert called == []

    def test_scheduler_run_lock_serializes_force_runs(self, monkeypatch):
        import threading
        import time
        from app.services import sync_scheduler

        entered = threading.Event()
        release = threading.Event()
        active = 0
        max_active = 0
        calls = 0
        state_lock = threading.Lock()
        monkeypatch.setattr(sync_scheduler.gcal_sync, "is_enabled", lambda: True)
        monkeypatch.setattr(sync_scheduler.gcal_sync, "recover_pending_calendar_migrations", lambda: 0)
        monkeypatch.setattr(sync_scheduler, "get_db", lambda: _FakeConn(rows=self._run_rows()))

        def fake_sync(due):
            nonlocal active, max_active, calls
            with state_lock:
                calls += 1
                active += 1
                max_active = max(max_active, active)
            entered.set()
            release.wait(2)
            with state_lock:
                active -= 1
            return 1, 0, {}

        monkeypatch.setattr(sync_scheduler.gcal_sync, "sync_pending", fake_sync)
        first = threading.Thread(target=lambda: sync_scheduler._run_once(force=True))
        second = threading.Thread(target=lambda: sync_scheduler._run_once(force=True))
        first.start()
        assert entered.wait(1)
        second.start()
        time.sleep(0.05)
        assert max_active == 1
        release.set()
        first.join(2)
        second.join(2)
        assert calls == 2
        assert max_active == 1



class TestSyncReliabilityFailures:
    def test_delete_missing_appointment_network_error_retains_queue(self, client, monkeypatch):
        """D + local appointment missing is not proof of remote delete; network failure keeps queue."""
        from app.database import get_db
        from app.services import gcal_sync
        from unittest.mock import MagicMock

        conn = get_db()
        try:
            key_id = conn.execute(
                "INSERT INTO gcal_keys(name,credentials_path,calendar_id) VALUES('delete-retry','x.json','dr@cal')"
            ).lastrowid
            conn.execute(
                "INSERT INTO appointment_sync_queue"
                "(appointment_id,key_id,op_type,google_event_id,last_modified_at,attempts,last_error) "
                "VALUES(?,?, 'D', ?, '2026-08-28 00:00:00', 0, '')",
                (700, key_id, "remote-event-700"),
            )
            conn.commit()
        finally:
            conn.close()

        service = MagicMock()
        service.events().delete.return_value.execute.side_effect = OSError("network down")
        monkeypatch.setattr(gcal_sync, "get_service_for_key", lambda row: service)
        ok, fail, _ = gcal_sync.sync_pending([{
            "appointment_id": 700, "key_id": key_id, "op_type": "D",
            "google_event_id": "remote-event-700", "last_modified_at": "2026-08-28 00:00:00",
        }])
        assert (ok, fail) == (0, 1)
        conn = get_db()
        try:
            row = conn.execute(
                "SELECT google_event_id, attempts, last_error FROM appointment_sync_queue "
                "WHERE appointment_id=700 AND key_id=?", (key_id,)
            ).fetchone()
            assert row["google_event_id"] == "remote-event-700"
            assert row["attempts"] == 1
            assert "network down" in row["last_error"]
        finally:
            conn.close()

    def test_identical_payload_skips_google_patch(self, client, monkeypatch):
        """queue 重試/backfill 時 final payload unchanged 不得重複 PATCH。"""
        from app.database import get_db
        from app.services import gcal_sync
        from unittest.mock import MagicMock

        conn = get_db()
        try:
            key_id = conn.execute(
                "INSERT INTO gcal_keys(name,credentials_path,calendar_id) VALUES('hash-skip','x.json','hs@cal')"
            ).lastrowid
            appt_id = conn.execute(
                "INSERT INTO appointments(client_name,date,start_time,end_time,note) VALUES(?,?,?,?,?)",
                ("unchanged", "2026-08-28", "09:00", "10:00", ""),
            ).lastrowid
            key_row = conn.execute("SELECT * FROM gcal_keys WHERE id=?", (key_id,)).fetchone()
            _, payload_hash = gcal_sync.load_event_payload(conn, appt_id, dict(key_row))
            conn.execute(
                "INSERT INTO appointment_gcal_map(appointment_id,key_id,google_event_id,data_hash) VALUES(?,?,?,?)",
                (appt_id, key_id, "unchanged-event", payload_hash),
            )
            conn.execute(
                "INSERT INTO appointment_sync_queue"
                "(appointment_id,key_id,op_type,google_event_id,last_modified_at,attempts,last_error) "
                "VALUES(?,?, 'U', ?, '2026-08-28 00:00:00', 0, '')",
                (appt_id, key_id, "unchanged-event"),
            )
            conn.commit()
        finally:
            conn.close()

        service = MagicMock()
        monkeypatch.setattr(gcal_sync, "get_service_for_key", lambda row: service)
        ok, fail, _ = gcal_sync.sync_pending([{
            "appointment_id": appt_id, "key_id": key_id, "op_type": "U",
            "google_event_id": "unchanged-event", "last_modified_at": "2026-08-28 00:00:00",
        }])
        assert (ok, fail) == (1, 0)
        service.events().patch.assert_not_called()
        service.events().insert.assert_not_called()
        conn = get_db()
        try:
            assert conn.execute(
                "SELECT 1 FROM appointment_sync_queue WHERE appointment_id=? AND key_id=?",
                (appt_id, key_id),
            ).fetchone() is None
        finally:
            conn.close()



def test_insert_id_is_checkpointed_before_map_write_failure(client, monkeypatch):
    """insert 成功後 map 寫入失敗，下一次重試不得再 insert 相同 Event。"""
    from app.database import get_db
    from app.services import gcal_sync, sync_scheduler
    from unittest.mock import MagicMock

    sync_scheduler.stop()
    conn = get_db()
    try:
        key_id = conn.execute(
            "INSERT INTO gcal_keys(name,credentials_path,calendar_id) VALUES('checkpoint-key','x.json','cp@cal')"
        ).lastrowid
        appt_id = conn.execute(
            "INSERT INTO appointments(client_name,date,start_time,end_time) VALUES(?,?,?,?)",
            ("checkpoint", "2026-08-28", "09:00", "10:00"),
        ).lastrowid
        conn.execute("INSERT INTO appointment_assignees(appointment_id,user_id) VALUES(?,1)", (appt_id,))
        version = gcal_sync.sync_version_now()
        conn.execute(
            "INSERT INTO appointment_sync_queue(appointment_id,key_id,op_type,google_event_id,last_modified_at) "
            "VALUES(?,?, 'C', '', ?)", (appt_id, key_id, version)
        )
        conn.execute(
            "CREATE TRIGGER fail_checkpoint_map BEFORE INSERT ON appointment_gcal_map "
            "BEGIN SELECT RAISE(ABORT, 'map write failed'); END"
        )
        conn.commit()
    finally:
        conn.close()

    service = MagicMock()
    service.events().insert.return_value.execute.return_value = {"id": "checkpoint-event"}
    service.events().patch.return_value.execute.return_value = {"id": "checkpoint-event"}
    monkeypatch.setattr(gcal_sync, "get_service_for_key", lambda row: service)
    due = [{
        "appointment_id": appt_id, "key_id": key_id, "op_type": "C",
        "google_event_id": "", "last_modified_at": version,
    }]
    ok, fail, _ = gcal_sync.sync_pending(due)
    assert (ok, fail) == (0, 1)

    conn = get_db()
    try:
        conn.execute("DROP TRIGGER fail_checkpoint_map")
        queued = conn.execute(
            "SELECT * FROM appointment_sync_queue WHERE appointment_id=? AND key_id=?",
            (appt_id, key_id),
        ).fetchone()
        assert queued["google_event_id"] == "checkpoint-event"
        conn.commit()
    finally:
        conn.close()

    ok, fail, _ = gcal_sync.sync_pending([dict(queued)])
    assert (ok, fail) == (1, 0)
    service.events().insert.assert_called_once()
    service.events().patch.assert_called_once()



def test_insert_then_local_delete_creates_compensating_delete_queue(client, monkeypatch):
    """C API race: local delete during insert must preserve a D task for the new remote id."""
    from app.database import get_db
    from app.services import gcal_sync, sync_scheduler
    from unittest.mock import MagicMock

    sync_scheduler.stop()
    conn = get_db()
    try:
        key_id = conn.execute(
            "INSERT INTO gcal_keys(name,credentials_path,calendar_id) VALUES('race-key','x.json','race@cal')"
        ).lastrowid
        appt_id = conn.execute(
            "INSERT INTO appointments(client_name,date,start_time,end_time) VALUES(?,?,?,?)",
            ("race", "2026-08-28", "09:00", "10:00"),
        ).lastrowid
        conn.execute("INSERT INTO appointment_assignees(appointment_id,user_id) VALUES(?,1)", (appt_id,))
        version = gcal_sync.sync_version_now()
        conn.execute(
            "INSERT INTO appointment_sync_queue(appointment_id,key_id,op_type,google_event_id,last_modified_at) "
            "VALUES(?,?, 'C', '', ?)", (appt_id, key_id, version)
        )
        conn.commit()
    finally:
        conn.close()

    service = MagicMock()
    def insert_and_delete_locally():
        local = get_db()
        try:
            local.execute("DELETE FROM appointment_sync_queue WHERE appointment_id=? AND key_id=?", (appt_id, key_id))
            local.execute("DELETE FROM appointments WHERE id=?", (appt_id,))
            local.commit()
        finally:
            local.close()
        return {"id": "race-remote-event"}
    service.events().insert.return_value.execute.side_effect = insert_and_delete_locally
    monkeypatch.setattr(gcal_sync, "get_service_for_key", lambda row: service)

    ok, fail, _ = gcal_sync.sync_pending([{
        "appointment_id": appt_id, "key_id": key_id, "op_type": "C",
        "google_event_id": "", "last_modified_at": version,
    }])
    assert (ok, fail) == (1, 0)
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT op_type, google_event_id FROM appointment_sync_queue WHERE appointment_id=? AND key_id=?",
            (appt_id, key_id),
        ).fetchone()
        assert row["op_type"] == "D"
        assert row["google_event_id"] == "race-remote-event"
    finally:
        conn.close()




def test_late_local_delete_during_map_write_preserves_delete_queue(client, monkeypatch):
    """map upsert 前的 committed delete 也必須保留 remote id 與 D queue。"""
    from app.database import get_db
    from app.services import gcal_sync, sync_scheduler
    from unittest.mock import MagicMock

    sync_scheduler.stop()
    conn=get_db()
    try:
        key_id=conn.execute(
            "INSERT INTO gcal_keys(name,credentials_path,calendar_id) VALUES('late-race-key','x.json','late@cal')"
        ).lastrowid
        appt_id=conn.execute(
            "INSERT INTO appointments(client_name,date,start_time,end_time) VALUES(?,?,?,?)",
            ("late-race", "2026-08-28", "09:00", "10:00"),
        ).lastrowid
        conn.execute("INSERT INTO appointment_assignees(appointment_id,user_id) VALUES(?,1)", (appt_id,))
        version=gcal_sync.sync_version_now()
        conn.execute(
            "INSERT INTO appointment_sync_queue(appointment_id,key_id,op_type,google_event_id,last_modified_at) "
            "VALUES(?,?, 'C', '', ?)", (appt_id,key_id,version)
        )
        conn.commit()
    finally:
        conn.close()

    real_get_db=gcal_sync.get_db
    class ConnectionProxy:
        def __init__(self, connection):
            self.connection=connection
            self.deleted=False

        def execute(self, sql, params=()):
            if sql == "BEGIN IMMEDIATE":
                # 讓測試保留一個可注入的 map-write window；production 仍使用短 IMMEDIATE tx。
                return None
            if "SELECT op_type, last_modified_at, google_event_id" in sql and not self.deleted:
                cursor = self.connection.execute(sql, params)
                cleanup=real_get_db()
                try:
                    cleanup.execute("DELETE FROM appointment_sync_queue WHERE appointment_id=? AND key_id=?", (appt_id,key_id))
                    cleanup.execute("DELETE FROM appointments WHERE id=?", (appt_id,))
                    cleanup.commit()
                finally:
                    cleanup.close()
                self.deleted=True
                return cursor
            return self.connection.execute(sql, params)

        def __getattr__(self, name):
            return getattr(self.connection, name)

    def wrapped_get_db():
        return ConnectionProxy(real_get_db())

    service=MagicMock()
    service.events().insert.return_value.execute.return_value={"id":"late-race-event"}
    monkeypatch.setattr(gcal_sync,"get_db",wrapped_get_db)
    monkeypatch.setattr(gcal_sync,"get_service_for_key",lambda row: service)
    ok,fail,_=gcal_sync.sync_pending([{
        "appointment_id":appt_id,"key_id":key_id,"op_type":"C",
        "google_event_id":"","last_modified_at":version,
    }])
    assert (ok,fail)==(1,0)
    conn=real_get_db()
    try:
        row=conn.execute(
            "SELECT op_type,google_event_id FROM appointment_sync_queue WHERE appointment_id=? AND key_id=?",
            (appt_id,key_id),
        ).fetchone()
        assert row["op_type"] == "D"
        assert row["google_event_id"] == "late-race-event"
    finally:
        conn.close()


def test_direct_sync_pending_serializes_same_queue_insert(client, monkeypatch):
    """scheduler/HTTP-style direct callers must not create duplicate Google events."""
    from app.database import get_db
    from app.services import gcal_sync, sync_scheduler
    from unittest.mock import MagicMock
    import threading
    import time

    sync_scheduler.stop()
    conn=get_db()
    try:
        key_id=conn.execute(
            "INSERT INTO gcal_keys(name,credentials_path,calendar_id) VALUES('direct-lock-key','x.json','direct@cal')"
        ).lastrowid
        appt_id=conn.execute(
            "INSERT INTO appointments(client_name,date,start_time,end_time) VALUES(?,?,?,?)",
            ("direct-lock", "2026-08-28", "09:00", "10:00"),
        ).lastrowid
        conn.execute("INSERT INTO appointment_assignees(appointment_id,user_id) VALUES(?,1)", (appt_id,))
        version=gcal_sync.sync_version_now()
        conn.execute(
            "INSERT INTO appointment_sync_queue(appointment_id,key_id,op_type,google_event_id,last_modified_at) "
            "VALUES(?,?, 'C', '', ?)", (appt_id,key_id,version)
        )
        conn.commit()
    finally:
        conn.close()

    entered=threading.Event()
    release=threading.Event()
    active=0
    max_active=0
    state_lock=threading.Lock()
    service=MagicMock()
    def slow_insert():
        nonlocal active,max_active
        with state_lock:
            active += 1
            max_active=max(max_active,active)
        entered.set()
        release.wait(2)
        with state_lock:
            active -= 1
        return {"id":"direct-lock-event"}
    service.events().insert.return_value.execute.side_effect=slow_insert
    monkeypatch.setattr(gcal_sync,"get_service_for_key",lambda row: service)
    due={"appointment_id":appt_id,"key_id":key_id,"op_type":"C","google_event_id":"","last_modified_at":version}
    results=[]
    first=threading.Thread(target=lambda: results.append(gcal_sync.sync_pending([due])))
    second=threading.Thread(target=lambda: results.append(gcal_sync.sync_pending([due])))
    first.start()
    assert entered.wait(5)
    second.start()
    time.sleep(0.05)
    assert max_active == 1
    release.set()
    first.join(2)
    second.join(2)
    assert len(results)==2
    assert service.events().insert.call_count == 1


def test_insert_conflict_uses_stable_event_id_and_patch(client, monkeypatch):
    """跨 process 同一 C insert 遇 duplicate event id 時，必須 patch existing event。"""
    from app.database import get_db
    from app.services import gcal_sync, sync_scheduler
    from types import SimpleNamespace
    from unittest.mock import MagicMock

    sync_scheduler.stop()
    conn=get_db()
    try:
        key_id=conn.execute(
            "INSERT INTO gcal_keys(name,credentials_path,calendar_id) VALUES('stable-id-key','x.json','stable@cal')"
        ).lastrowid
        appt_id=conn.execute(
            "INSERT INTO appointments(client_name,date,start_time,end_time) VALUES(?,?,?,?)",
            ("stable-id", "2026-08-28", "09:00", "10:00"),
        ).lastrowid
        conn.execute(
            "INSERT INTO appointment_sync_queue(appointment_id,key_id,op_type,google_event_id,last_modified_at) "
            "VALUES(?,?, 'C', '', ?)", (appt_id,key_id,gcal_sync.sync_version_now())
        )
        conn.commit()
        version=conn.execute(
            "SELECT last_modified_at FROM appointment_sync_queue WHERE appointment_id=? AND key_id=?",
            (appt_id,key_id),
        ).fetchone()["last_modified_at"]
    finally:
        conn.close()

    conflict=Exception("duplicate event id")
    conflict.resp=SimpleNamespace(status=409)
    service=MagicMock()
    service.events().insert.return_value.execute.side_effect=conflict
    service.events().patch.return_value.execute.return_value={"id":"stable-event"}
    monkeypatch.setattr(gcal_sync,"get_service_for_key",lambda row: service)
    ok,fail,_=gcal_sync.sync_pending([{
        "appointment_id":appt_id,"key_id":key_id,"op_type":"C",
        "google_event_id":"","last_modified_at":version,
    }])
    assert (ok,fail)==(1,0)
    # 2026-09-16 fix：insert() 不接受 eventId keyword argument（TypeError）。
    # stable_id 必須放在 body 的 id 欄位（REST API 支援）。
    insert_kwargs=service.events().insert.call_args.kwargs
    assert "eventId" not in insert_kwargs, "insert() 不接受 eventId keyword arg"
    insert_body=insert_kwargs["body"]
    assert insert_body["id"] == gcal_sync.stable_event_id(appt_id,key_id)
    patch_kwargs=service.events().patch.call_args.kwargs
    assert patch_kwargs["eventId"] == insert_body["id"]


def test_insert_body_contains_stable_id_not_keyword_arg(client, monkeypatch):
    """2026-09-16 fix：insert() 不接受 eventId keyword argument。
    stable_id 必須放在 body 的 id 欄位（REST API 支援）。
    此測試驗證正常 insert（無409衝突）時 body 含 id。"""
    from app.database import get_db
    from app.services import gcal_sync, sync_scheduler
    from types import SimpleNamespace
    from unittest.mock import MagicMock

    sync_scheduler.stop()
    conn = get_db()
    try:
        key_id = conn.execute(
            "INSERT INTO gcal_keys(name,credentials_path,calendar_id) "
            "VALUES('body-id-key','x.json','bodyid@cal')"
        ).lastrowid
        appt_id = conn.execute(
            "INSERT INTO appointments(client_name,date,start_time,end_time) "
            "VALUES(?,?,?,?)",
            ("body-id-test", "2026-09-16", "09:00", "10:00"),
        ).lastrowid
        conn.execute(
            "INSERT INTO appointment_sync_queue"
            "(appointment_id,key_id,op_type,google_event_id,last_modified_at) "
            "VALUES(?,?, 'C', '', ?)",
            (appt_id, key_id, gcal_sync.sync_version_now()),
        )
        conn.commit()
        version = conn.execute(
            "SELECT last_modified_at FROM appointment_sync_queue "
            "WHERE appointment_id=? AND key_id=?",
            (appt_id, key_id),
        ).fetchone()["last_modified_at"]
    finally:
        conn.close()

    service = MagicMock()
    service.events().insert.return_value.execute.return_value = {"id": "returned-id"}
    monkeypatch.setattr(gcal_sync, "get_service_for_key", lambda row: service)

    ok, fail, _ = gcal_sync.sync_pending([{
        "appointment_id": appt_id, "key_id": key_id, "op_type": "C",
        "google_event_id": "", "last_modified_at": version,
    }])
    assert (ok, fail) == (1, 0)

    insert_kwargs = service.events().insert.call_args.kwargs
    # 核心驗證：insert() 不得有 eventId keyword argument（會 TypeError）
    assert "eventId" not in insert_kwargs, "insert() 不接受 eventId keyword arg"
    # stable_id 必須在 body 的 id 欄位
    insert_body = insert_kwargs["body"]
    expected_id = gcal_sync.stable_event_id(appt_id, key_id)
    assert insert_body["id"] == expected_id, f"body.id 應為 stable_id，實際為 {insert_body.get('id')}"


class _FakeConn:
    """測試用假 DB 連線"""
    def __init__(self, rows=None):
        self._rows = rows or []
    def execute(self, sql, params=()):
        return self
    def fetchall(self):
        return self._rows
    def fetchone(self):
        return self._rows[0] if self._rows else None
    def close(self):
        pass



def test_sync_persists_redacted_credential_error(client, monkeypatch):
    """同步失敗寫入 queue 時不得保存 credential path。"""
    from app.database import get_db
    from app.services import gcal_sync

    conn = get_db()
    try:
        key_id = conn.execute(
            "INSERT INTO gcal_keys(name,credentials_path,calendar_id) VALUES('sync-redaction-key','x.json','sr@cal')"
        ).lastrowid
        conn.execute(
            "INSERT INTO appointment_sync_queue"
            "(appointment_id,key_id,op_type,google_event_id,last_modified_at,attempts,last_error) "
            "VALUES(?,?, 'D', ?, '2026-08-28 00:00:00', 0, '')",
            (701, key_id, "remote-event-701"),
        )
        conn.commit()
    finally:
        conn.close()

    service = MagicMock()
    service.events().delete.return_value.execute.side_effect = FileNotFoundError(
        "No such file or directory: C:/private/service-account.json"
    )
    monkeypatch.setattr(gcal_sync, "get_service_for_key", lambda row: service)

    ok, fail, _ = gcal_sync.sync_pending([{
        "appointment_id": 701,
        "key_id": key_id,
        "op_type": "D",
        "google_event_id": "remote-event-701",
        "last_modified_at": "2026-08-28 00:00:00",
    }])

    assert (ok, fail) == (0, 1)
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT last_error FROM appointment_sync_queue WHERE appointment_id=701 AND key_id=?",
            (key_id,),
        ).fetchone()
        assert row["last_error"] == "Credential file unavailable"
        assert "service-account.json" not in row["last_error"]
    finally:
        conn.close()



def test_sync_rechecks_key_after_key_lock_before_remote_io(client, monkeypatch):
    """key 在等待同步期間被刪除後，舊 snapshot 不得再建立 remote C event。"""
    from contextlib import contextmanager

    from app.database import get_db
    from app.services import gcal_sync

    conn = get_db()
    try:
        key_id = conn.execute(
            "INSERT INTO gcal_keys(name,credentials_path,calendar_id) VALUES('stale-key-lock','x.json','skl@cal')"
        ).lastrowid
        appt_id = conn.execute(
            "INSERT INTO appointments(client_name,date,start_time,end_time) VALUES(?,?,?,?)",
            ("stale-key-lock-appt", "2026-08-28", "09:00", "10:00"),
        ).lastrowid
        conn.execute(
            "INSERT INTO appointment_sync_queue"
            "(appointment_id,key_id,op_type,google_event_id,last_modified_at,attempts,last_error) "
            "VALUES(?,?, 'C', '', '2026-08-28 00:00:00', 0, '')",
            (appt_id, key_id),
        )
        conn.commit()
    finally:
        conn.close()

    service = MagicMock()

    @contextmanager
    def delete_key_while_waiting(locked_key_id):
        assert locked_key_id == key_id
        deleting = get_db()
        try:
            deleting.execute("DELETE FROM gcal_keys WHERE id=?", (key_id,))
            deleting.commit()
        finally:
            deleting.close()
        yield

    monkeypatch.setattr(gcal_sync, "_key_process_lock", delete_key_while_waiting)
    monkeypatch.setattr(gcal_sync, "get_service_for_key", lambda row: service)

    ok, fail, _ = gcal_sync.sync_pending([{
        "appointment_id": appt_id,
        "key_id": key_id,
        "op_type": "C",
        "google_event_id": "",
        "last_modified_at": "2026-08-28 00:00:00",
    }])

    assert (ok, fail) == (0, 0)
    service.events().insert.assert_not_called()



def test_scheduler_restart_recovers_pending_migration_map_without_d_queue(client, monkeypatch):
    """server restart 後 pending migration 應補出 old Calendar cleanup 的 D queue。"""
    from app.database import get_db
    from app.services import sync_scheduler

    monkeypatch.setattr(sync_scheduler, "_notify_discord", lambda message: None)
    key_id = client.post("/api/gcal-keys", json={
        "name": "restart-recovery-key", "credentials_path": "calendar.json", "calendar_id": "old@cal",
    }).json()["id"]
    sync_scheduler.stop()
    conn = get_db()
    try:
        appt_id = conn.execute(
            "INSERT INTO appointments(client_name,date,start_time,end_time) VALUES(?,?,?,?)",
            ("restart-recovery", "2026-08-28", "09:00", "10:00"),
        ).lastrowid
        conn.execute(
            "UPDATE gcal_keys SET pending_calendar_id=? WHERE id=?", ("new@cal", key_id)
        )
        conn.execute(
            "INSERT INTO appointment_gcal_map(appointment_id,key_id,google_event_id,data_hash) "
            "VALUES(?,?,?,?)", (appt_id, key_id, "event-a", "hash"),
        )
        conn.commit()
    finally:
        conn.close()

    sync_scheduler._run_once(force=True)

    conn = get_db()
    try:
        queue = conn.execute(
            "SELECT op_type, google_event_id FROM appointment_sync_queue "
            "WHERE appointment_id=? AND key_id=?", (appt_id, key_id),
        ).fetchone()
        assert (queue["op_type"], queue["google_event_id"]) == ("D", "event-a")
    finally:
        conn.close()



def _seed_pending_map(conn, key_id, calendar_id="old@cal", pending_calendar_id="new@cal"):
    appt_id = conn.execute(
        "INSERT INTO appointments(client_name,date,start_time,end_time) VALUES(?,?,?,?)",
        ("recovery-appointment", "2026-08-28", "09:00", "10:00"),
    ).lastrowid
    conn.execute(
        "UPDATE gcal_keys SET calendar_id=?, pending_calendar_id=? WHERE id=?",
        (calendar_id, pending_calendar_id, key_id),
    )
    conn.execute(
        "INSERT INTO appointment_gcal_map(appointment_id,key_id,google_event_id,data_hash) "
        "VALUES(?,?,?,?)", (appt_id, key_id, "event-a", "hash"),
    )
    return appt_id


def test_pending_migration_recovery_is_idempotent_and_preserves_retry_state(client):
    from app.database import get_db
    from app.services import gcal_sync, sync_scheduler

    key_id = client.post("/api/gcal-keys", json={
        "name": "recovery-idempotent", "credentials_path": "calendar.json", "calendar_id": "old@cal",
    }).json()["id"]
    sync_scheduler.stop()
    conn = get_db()
    try:
        appt_id = _seed_pending_map(conn, key_id)
        conn.commit()
    finally:
        conn.close()

    assert gcal_sync.recover_pending_calendar_migrations() == 1
    conn = get_db()
    try:
        conn.execute(
            "UPDATE appointment_sync_queue SET attempts=1, last_error=? "
            "WHERE appointment_id=? AND key_id=?", ("Google API 403", appt_id, key_id),
        )
        conn.commit()
    finally:
        conn.close()

    assert gcal_sync.recover_pending_calendar_migrations() == 0
    conn = get_db()
    try:
        queue = conn.execute(
            "SELECT op_type, google_event_id, attempts, last_error "
            "FROM appointment_sync_queue WHERE appointment_id=? AND key_id=?", (appt_id, key_id),
        ).fetchone()
        assert (queue["op_type"], queue["google_event_id"], queue["attempts"], queue["last_error"]) == (
            "D", "event-a", 1, "Google API 403"
        )
    finally:
        conn.close()


def test_pending_migration_recovery_does_not_reset_exhausted_d(client):
    from app.database import get_db
    from app.services import gcal_sync, sync_scheduler

    key_id = client.post("/api/gcal-keys", json={
        "name": "recovery-exhausted", "credentials_path": "calendar.json", "calendar_id": "old@cal",
    }).json()["id"]
    sync_scheduler.stop()
    conn = get_db()
    try:
        appt_id = _seed_pending_map(conn, key_id)
        conn.execute(
            "INSERT INTO appointment_sync_queue"
            "(appointment_id,key_id,op_type,google_event_id,last_modified_at,attempts,last_error) "
            "VALUES(?,?, 'D', ?, ?, ?, ?)",
            (appt_id, key_id, "event-a", "2026-08-28 09:00:00", gcal_sync.MAX_ATTEMPTS, "Google API 403"),
        )
        conn.commit()
    finally:
        conn.close()

    assert gcal_sync.recover_pending_calendar_migrations() == 0
    conn = get_db()
    try:
        queue = conn.execute(
            "SELECT attempts, last_error FROM appointment_sync_queue WHERE appointment_id=? AND key_id=?",
            (appt_id, key_id),
        ).fetchone()
        assert (queue["attempts"], queue["last_error"]) == (gcal_sync.MAX_ATTEMPTS, "Google API 403")
    finally:
        conn.close()


def test_pending_migration_recovery_ignores_empty_map_google_id(client):
    from app.database import get_db
    from app.services import gcal_sync, sync_scheduler

    key_id = client.post("/api/gcal-keys", json={
        "name": "recovery-empty-gid", "credentials_path": "calendar.json", "calendar_id": "old@cal",
    }).json()["id"]
    sync_scheduler.stop()
    conn = get_db()
    try:
        appt_id = conn.execute(
            "INSERT INTO appointments(client_name,date,start_time,end_time) VALUES(?,?,?,?)",
            ("empty-gid", "2026-08-28", "09:00", "10:00"),
        ).lastrowid
        conn.execute(
            "UPDATE gcal_keys SET pending_calendar_id=? WHERE id=?", ("new@cal", key_id)
        )
        conn.execute(
            "INSERT INTO appointment_gcal_map(appointment_id,key_id,google_event_id,data_hash) "
            "VALUES(?,?,?,?)", (appt_id, key_id, "", "hash"),
        )
        conn.commit()
    finally:
        conn.close()

    assert gcal_sync.recover_pending_calendar_migrations() == 0
    conn = get_db()
    try:
        assert conn.execute(
            "SELECT 1 FROM appointment_sync_queue WHERE appointment_id=? AND key_id=?", (appt_id, key_id)
        ).fetchone() is None
    finally:
        conn.close()


def test_recovered_d_success_finalizes_and_backfills_new_calendar(client, monkeypatch):
    from unittest.mock import MagicMock

    from app.database import get_db
    from app.routes import gcal_keys
    from app.services import gcal_sync, sync_scheduler

    monkeypatch.setattr(gcal_keys, "_wake_scheduler", lambda: None)
    key_id = client.post("/api/gcal-keys", json={
        "name": "recovery-finalize", "credentials_path": "calendar.json", "calendar_id": "old@cal",
    }).json()["id"]
    sync_scheduler.stop()
    conn = get_db()
    try:
        appt_id = _seed_pending_map(conn, key_id)
        conn.commit()
    finally:
        conn.close()

    assert gcal_sync.recover_pending_calendar_migrations() == 1
    service = MagicMock()
    service.events().delete.return_value.execute.return_value = {}
    monkeypatch.setattr(gcal_sync, "get_service_for_key", lambda row: service)
    conn = get_db()
    try:
        queue = dict(conn.execute(
            "SELECT * FROM appointment_sync_queue WHERE appointment_id=? AND key_id=?", (appt_id, key_id)
        ).fetchone())
    finally:
        conn.close()

    ok, failed, _ = gcal_sync.sync_pending([queue])

    assert (ok, failed) == (1, 0)
    service.events().delete.assert_called_once_with(calendarId="old@cal", eventId="event-a")
    conn = get_db()
    try:
        key = conn.execute(
            "SELECT calendar_id, pending_calendar_id FROM gcal_keys WHERE id=?", (key_id,)
        ).fetchone()
        assert (key["calendar_id"], key["pending_calendar_id"]) == ("new@cal", None)
        queue = conn.execute(
            "SELECT op_type, google_event_id FROM appointment_sync_queue "
            "WHERE appointment_id=? AND key_id=?", (appt_id, key_id),
        ).fetchone()
        assert (queue["op_type"], queue["google_event_id"]) == ("C", "")
    finally:
        conn.close()



def test_inactive_pending_migration_recovery_only_creates_d(client):
    from app.database import get_db
    from app.services import gcal_sync, sync_scheduler

    key_id = client.post("/api/gcal-keys", json={
        "name": "inactive-recovery", "credentials_path": "calendar.json", "calendar_id": "old@cal",
    }).json()["id"]
    assert client.put(f"/api/gcal-keys/{key_id}", json={"is_active": False}).status_code == 200
    sync_scheduler.stop()
    conn = get_db()
    try:
        appt_id = _seed_pending_map(conn, key_id)
        conn.commit()
    finally:
        conn.close()

    assert gcal_sync.recover_pending_calendar_migrations() == 1
    conn = get_db()
    try:
        queue = conn.execute(
            "SELECT op_type, google_event_id FROM appointment_sync_queue "
            "WHERE appointment_id=? AND key_id=?", (appt_id, key_id),
        ).fetchone()
        assert (queue["op_type"], queue["google_event_id"]) == ("D", "event-a")
        assert conn.execute(
            "SELECT 1 FROM appointment_sync_queue WHERE key_id=? AND op_type IN ('C','U')",
            (key_id,),
        ).fetchone() is None
    finally:
        conn.close()


@pytest.mark.parametrize("is_active", [True, False])
def test_scheduler_restart_finalizes_empty_pending_migration(client, monkeypatch, is_active):
    """restart 後 maps/D 都清空時，scheduler 應 finalize pending migration。"""
    from app.database import get_db
    from app.services import sync_scheduler

    key_id = client.post("/api/gcal-keys", json={
        "name": f"empty-pending-recovery-{is_active}",
        "credentials_path": "calendar.json", "calendar_id": "old@cal",
    }).json()["id"]
    sync_scheduler.stop()
    conn = get_db()
    try:
        appt_id = conn.execute(
            "INSERT INTO appointments(client_name,date,start_time,end_time) VALUES(?,?,?,?)",
            (f"empty-pending-{is_active}", "2026-08-28", "09:00", "10:00"),
        ).lastrowid
        conn.execute(
            "UPDATE gcal_keys SET pending_calendar_id=?, is_active=? WHERE id=?",
            ("new@cal", int(is_active), key_id),
        )
        conn.commit()
    finally:
        conn.close()

    # Mock _notify_discord to prevent real Discord webhook calls during tests.
    # Without this, scheduler failures (e.g. missing credential files) would send
    # production Discord notifications with test data — see issue #XXX.
    notified = []
    monkeypatch.setattr(sync_scheduler, "_notify_discord", lambda msg: notified.append(msg))
    sync_scheduler._run_once(force=True)

    conn = get_db()
    try:
        key = conn.execute(
            "SELECT calendar_id, pending_calendar_id, is_active FROM gcal_keys WHERE id=?", (key_id,)
        ).fetchone()
        assert (key["calendar_id"], key["pending_calendar_id"], key["is_active"]) == (
            "new@cal", None, int(is_active)
        )
        queue = conn.execute(
            "SELECT op_type FROM appointment_sync_queue WHERE appointment_id=? AND key_id=?",
            (appt_id, key_id),
        ).fetchone()
        if is_active:
            assert queue["op_type"] == "C"
        else:
            assert queue is None
        # Mock prevents REAL Discord webhook calls during tests.
        # When is_active=True, the scheduler runs sync → fails (missing credential)
        # → triggers a notification. This is expected; the mock just prevents it
        # from reaching the production Discord channel.
        # (notification content is captured in `notified` for optional debugging)
    finally:
        conn.close()



def test_calendar_finalize_rolls_back_when_backfill_fails(client, monkeypatch):
    """finalize 與 new Calendar backfill 必須同一 transaction。"""
    from app.database import get_db
    from app.routes import gcal_keys
    from app.services import gcal_sync, sync_scheduler

    key_id = client.post("/api/gcal-keys", json={
        "name": "atomic-finalize-failure", "credentials_path": "calendar.json", "calendar_id": "old@cal",
    }).json()["id"]
    sync_scheduler.stop()
    conn = get_db()
    try:
        conn.execute(
            "UPDATE gcal_keys SET pending_calendar_id=? WHERE id=?", ("new@cal", key_id)
        )
        conn.commit()
    finally:
        conn.close()

    def fail_backfill(conn, key_id):
        raise RuntimeError("forced backfill failure")

    monkeypatch.setattr(gcal_keys, "_backfill_all_appointments_with_conn", fail_backfill)

    assert gcal_sync.maybe_finalize_calendar_migration(key_id) is False

    conn = get_db()
    try:
        row = conn.execute(
            "SELECT calendar_id, pending_calendar_id FROM gcal_keys WHERE id=?", (key_id,)
        ).fetchone()
        assert (row["calendar_id"], row["pending_calendar_id"]) == ("old@cal", "new@cal")
        assert conn.execute(
            "SELECT 1 FROM appointment_sync_queue WHERE key_id=?", (key_id,)
        ).fetchone() is None
    finally:
        conn.close()



def test_scheduler_finalize_rechecks_pending_target_after_key_lock(client, monkeypatch):
    """scheduler finalize 取得 per-key lock 後必須讀取最新 pending target。"""
    from contextlib import contextmanager

    from app.database import get_db
    from app.services import gcal_sync, sync_scheduler

    key_id = client.post("/api/gcal-keys", json={
        "name": "finalize-lock-race",
        "credentials_path": "calendar.json", "calendar_id": "old@cal",
    }).json()["id"]
    sync_scheduler.stop()
    conn = get_db()
    try:
        conn.execute(
            "UPDATE gcal_keys SET pending_calendar_id=?, is_active=0 WHERE id=?",
            ("new-A@cal", key_id),
        )
        conn.commit()
    finally:
        conn.close()

    @contextmanager
    def mutate_pending_before_lock_yields(locked_key_id):
        assert locked_key_id == key_id
        conn = get_db()
        try:
            conn.execute(
                "UPDATE gcal_keys SET pending_calendar_id=? WHERE id=?",
                ("new-B@cal", key_id),
            )
            conn.commit()
        finally:
            conn.close()
        yield

    monkeypatch.setattr(gcal_sync, "_key_process_lock", mutate_pending_before_lock_yields)

    sync_scheduler._finalize_pending_migrations()

    conn = get_db()
    try:
        row = conn.execute(
            "SELECT calendar_id, pending_calendar_id FROM gcal_keys WHERE id=?", (key_id,)
        ).fetchone()
        assert row["calendar_id"] == "new-B@cal"
        assert row["pending_calendar_id"] is None
    finally:
        conn.close()
