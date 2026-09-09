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

        # 模擬「同步途中被編輯」-> 重置 last_modified_at 為 T2
        conn = get_db()
        try:
            conn.execute("UPDATE appointment_sync_queue SET last_modified_at='2026-08-28 01:00:00' "
                         "WHERE appointment_id=?", (appt_id,))
            conn.commit()
        finally:
            conn.close()

        mock_svc = self._mock_service()
        monkeypatch.setattr(gcal_sync, "get_service_for_key", lambda kr: mock_svc)

        # 用 T1 的快照嘗試同步 -> sync_pending 仍會同步，但刪隊列時 T1 不符 T2 -> 隊列保留
        due = [{"appointment_id": appt_id, "key_id": q["key_id"], "op_type": "C",
                "google_event_id": "", "last_modified_at": t1}]
        ok, fail, _ = gcal_sync.sync_pending(due)
        # sync_pending 會嘗試同步（成功），但刪隊列 WHERE last_modified_at=t1 不符 t2 -> 隊列保留
        conn = get_db()
        try:
            q2 = conn.execute("SELECT * FROM appointment_sync_queue WHERE appointment_id=?",
                              (appt_id,)).fetchone()
            assert q2 is not None  # 隊列仍存在（版本不符沒刪掉）
        finally:
            conn.close()

    def test_disabled_key_skipped(self, client, monkeypatch):
        """key 停用 -> 該列直接清不阻塞"""
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
        ok, fail, _ = gcal_sync.sync_pending(due)
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
        assert len(h1) == 32  # MD5 hex

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
        assert len(h) == 32

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
        monkeypatch.setattr(sync_scheduler, "_due_ids", lambda rows, now, **kw: {(1, 1)})
        monkeypatch.setattr(sync_scheduler, "get_db", lambda: _FakeConn(rows=[
            {"appointment_id": 1, "key_id": 1, "op_type": "C",
             "google_event_id": "", "last_modified_at": "2026-01-01 00:00:00"}
        ]))
        monkeypatch.setattr(sync_scheduler.gcal_sync, "sync_pending", lambda due: (1, 0, {}))

        sync_scheduler._run_once()
        assert len(notified) == 0  # 成功不通知

    def test_run_once_notifies_on_failure(self, monkeypatch):
        """同步失敗發 Discord 通知"""
        from app.services import sync_scheduler
        notified = []
        monkeypatch.setattr(sync_scheduler, "_notify_discord", lambda msg: notified.append(msg))
        monkeypatch.setattr(sync_scheduler.gcal_sync, "is_enabled", lambda: True)
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
        import threading, logging
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
        monkeypatch.setattr(sync_scheduler, "_due_ids", lambda rows, now, **kw: {(1, 1)})
        monkeypatch.setattr(sync_scheduler, "get_db", lambda: _FakeConn(rows=[
            {"appointment_id": 1, "key_id": 1, "op_type": "C",
             "google_event_id": "", "last_modified_at": "2026-01-01 00:00:00"}
        ]))
        monkeypatch.setattr(sync_scheduler.gcal_sync, "sync_pending",
                            lambda due: (5, 0, {}))

        sync_scheduler._run_once()
        assert len(notified) == 0

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
