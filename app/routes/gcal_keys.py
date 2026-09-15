"""Google 行事曆同步 Key CRUD（admin 級操作）"""
import json
from contextlib import ExitStack
import re
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from app.config import BASE_DIR
from app.database import get_db
from app.models import GcalKeyIn, GcalKeyUpdate
from app.services.auth import require_perm
from app.services import gcal_sync
from app.services.gcal_sync import parse_popup_reminders

MAX_CREDENTIALS_SIZE = 1024 * 1024
CLIENT_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
UPLOADED_CREDENTIALS_DIR = (Path(BASE_DIR) / "secrets" / "gcal").resolve()
_UPLOADED_CREDENTIAL_NAME_RE = re.compile(r"^[0-9a-f]{32}\.json$")

def _uploaded_credentials_path(credentials_path: str) -> Path | None:
    """只回傳本系統產生的上傳檔，避免誤刪手動指定的檔案。"""
    try:
        path = Path(credentials_path).resolve()
        path.relative_to(UPLOADED_CREDENTIALS_DIR)
    except (TypeError, ValueError, OSError):
        return None
    return path if _UPLOADED_CREDENTIAL_NAME_RE.fullmatch(path.name) else None

def _delete_uploaded_credentials(credentials_path: str) -> None:
    """只清理由本系統上傳且已提交成功的憑證，不碰手動指定路徑。"""
    path = _uploaded_credentials_path(credentials_path)
    if path is None:
        return
    try:
        path.unlink(missing_ok=True)
    except OSError as exc:
        import logging
        logging.getLogger(__name__).warning(
            "刪除上傳的 Service Account JSON 失敗 error_type=%s", type(exc).__name__
        )

def _credentials_data(data: bytes) -> dict:
    if not data:
        raise HTTPException(400, "Service Account JSON 不可為空")
    if len(data) > MAX_CREDENTIALS_SIZE:
        raise HTTPException(400, "Service Account JSON 不可超過 1MB")
    try:
        parsed = json.loads(data.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise HTTPException(400, "Service Account JSON 格式錯誤") from exc
    email = parsed.get("client_email") if isinstance(parsed, dict) else None
    private_key = parsed.get("private_key") if isinstance(parsed, dict) else None
    if not isinstance(email, str) or not CLIENT_EMAIL_RE.fullmatch(email.strip()):
        raise HTTPException(400, "JSON 缺少有效的 client_email")
    if not isinstance(private_key, str) or not private_key.strip():
        raise HTTPException(400, "JSON 缺少 private_key")
    return parsed

def _client_email_from_path(credentials_path: str) -> str:
    if not credentials_path:
        return ""
    candidates = [Path(credentials_path)]
    if not candidates[0].is_absolute():
        candidates.append(Path(BASE_DIR) / candidates[0])
    for path in candidates:
        try:
            with path.open("r", encoding="utf-8-sig") as handle:
                data = json.load(handle)
            email = data.get("client_email", "") if isinstance(data, dict) else ""
            if isinstance(email, str) and CLIENT_EMAIL_RE.fullmatch(email.strip()):
                return email.strip()
        except (OSError, UnicodeError, json.JSONDecodeError):
            continue
    return ""


def _backfill_all_appointments(key_id: int):
    """新增/重新啟用 key 時，依 final payload hash 回填需要追上的行程。"""
    try:
        conn = get_db()
        try:
            key_row = conn.execute("SELECT * FROM gcal_keys WHERE id=?", (key_id,)).fetchone()
            if key_row is None:
                return 0
            key_data = dict(key_row)
            appt_ids = [r["id"] for r in conn.execute("SELECT id FROM appointments").fetchall()]
            queued = 0
            version = gcal_sync.sync_version_now()
            for appt_id in appt_ids:
                queued_row = conn.execute(
                    "SELECT op_type FROM appointment_sync_queue WHERE appointment_id=? AND key_id=?",
                    (appt_id, key_id),
                ).fetchone()
                if queued_row and queued_row["op_type"] == "D":
                    # assignment loss already requested a remote DELETE; re-enable must not revive it.
                    continue
                existing = conn.execute(
                    "SELECT google_event_id, data_hash FROM appointment_gcal_map "
                    "WHERE appointment_id=? AND key_id=?", (appt_id, key_id)
                ).fetchone()
                target_ids = set(gcal_sync.resolve_target_keys(conn, appt_id))
                if key_id not in target_ids:
                    if existing and existing["google_event_id"]:
                        conn.execute(
                            "INSERT INTO appointment_sync_queue "
                            "(appointment_id, key_id, op_type, google_event_id, last_modified_at, attempts, last_error) "
                            "VALUES(?, ?, 'D', ?, ?, 0, '') "
                            "ON CONFLICT(appointment_id, key_id) DO UPDATE SET "
                            "op_type='D', google_event_id=excluded.google_event_id, "
                            "last_modified_at=excluded.last_modified_at, attempts=0, last_error=''",
                            (appt_id, key_id, existing["google_event_id"], version),
                        )
                        queued += 1
                    continue
                _, payload_hash = gcal_sync.load_event_payload(conn, appt_id, key_data)
                if existing and existing["google_event_id"] and existing["data_hash"] == payload_hash:
                    continue
                op_type = "U" if existing and existing["google_event_id"] else "C"
                google_event_id = existing["google_event_id"] if existing else ""
                conn.execute(
                    "INSERT INTO appointment_sync_queue "
                    "(appointment_id, key_id, op_type, google_event_id, last_modified_at, attempts, last_error) "
                    "VALUES(?, ?, ?, ?, ?, 0, '') "
                    "ON CONFLICT(appointment_id, key_id) DO UPDATE SET "
                    "op_type=excluded.op_type, google_event_id=excluded.google_event_id, "
                    "last_modified_at=excluded.last_modified_at, attempts=0, last_error=''",
                    (appt_id, key_id, op_type, google_event_id or "", version),
                )
                queued += 1
            conn.commit()
            return queued
        finally:
            conn.close()
    except Exception as e:
        import logging
        logging.getLogger(__name__).error(
            "backfill sync_queue 失敗 key_id=%s: %s （新增 key 已成功但舊行程未加入同步佇列）",
            key_id, gcal_sync.safe_sync_error(e))
        return None


def _wake_scheduler() -> None:
    """queue/settings 變更後啟動並喚醒 worker；normal wake 仍遵守 debounce。"""
    from app.services import sync_scheduler
    sync_scheduler.start()
    sync_scheduler.wake()

router = APIRouter()


def _row_to_dict(r):
    reminders_raw = r["reminders"] if "reminders" in r.keys() else "[]"
    # 只顯示已通過 parser 的 Popup；舊 migration default 可能仍含 email，
    # 這裡刻意不回寫 DB，避免在讀取設定時偷偷改動歷史資料。
    reminders = parse_popup_reminders(reminders_raw)
    return {
        "id": r["id"],
        "name": r["name"],
        "credentials_path": "",  # server-side path is never exposed to the client
        "client_email": _client_email_from_path(r["credentials_path"]),
        "calendar_id": r["calendar_id"],
        "is_active": bool(r["is_active"]),
        "reminders": reminders,
        "created_at": r["created_at"],
    }


@router.get("/api/gcal-keys", dependencies=[Depends(require_perm("gcal-keys-manage"))])
def list_gcal_keys():
    """admin：回傳全部 gcal key（含停用）。"""
    conn = get_db()
    try:
        rows = conn.execute("SELECT * FROM gcal_keys ORDER BY id").fetchall()
        return [_row_to_dict(r) for r in rows]
    finally:
        conn.close()


@router.post("/api/gcal-keys", status_code=201, dependencies=[Depends(require_perm("gcal-keys-manage"))])
async def create_gcal_key(request: Request):
    """新增 key，可上傳 JSON 或輸入伺服器上的 JSON 路徑。"""
    uploaded_path = None
    upload_committed = False
    try:
        content_type = request.headers.get("content-type", "").lower()
        if content_type.startswith("multipart/form-data"):
            form = await request.form()
            name = str(form.get("name") or "").strip()
            credentials_path = str(form.get("credentials_path") or "").strip()
            calendar_id = str(form.get("calendar_id") or "").strip()
            uploaded = form.get("credentials_file")
            if uploaded is not None and getattr(uploaded, "filename", None) is not None:
                filename = str(uploaded.filename or "")
                if Path(filename).suffix.lower() != ".json":
                    raise HTTPException(400, "Service Account 檔案必須是 .json")
                data = await uploaded.read(MAX_CREDENTIALS_SIZE + 1)
                credentials = _credentials_data(data)
                storage_dir = UPLOADED_CREDENTIALS_DIR
                storage_dir.mkdir(parents=True, exist_ok=True)
                uploaded_path = storage_dir / f"{uuid.uuid4().hex}.json"
                # 上傳檔案先寫入固定亂數檔名；後續任一失敗由 finally 清除。
                uploaded_path.write_text(
                    json.dumps(credentials, ensure_ascii=False, indent=2), encoding="utf-8"
                )
                credentials_path = str(uploaded_path)
        else:
            try:
                payload = GcalKeyIn.model_validate(await request.json())
            except Exception as exc:
                raise HTTPException(422, "Key 資料格式錯誤") from exc
            name = payload.name.strip()
            credentials_path = payload.credentials_path.strip()
            calendar_id = payload.calendar_id.strip()
        if not name:
            raise HTTPException(400, "Key 名稱不可為空白")
        if len(name) > 100:
            raise HTTPException(400, "Key 名稱過長")
        if not credentials_path:
            raise HTTPException(400, "請上傳 JSON 或輸入 JSON 檔路徑")
        if len(credentials_path) > 500 or not calendar_id or len(calendar_id) > 300:
            raise HTTPException(400, "JSON 路徑或 Calendar ID 長度不合法")
        if uploaded_path is None:
            _client_email_from_path(credentials_path)  # 觸發檔案格式/存在性檢查結果由 email 顯示
        conn = get_db()
        try:
            if conn.execute("SELECT id FROM gcal_keys WHERE name=?", (name,)).fetchone():
                raise HTTPException(400, f"Key「{name}」已存在")
            cur = conn.execute(
                "INSERT INTO gcal_keys (name, credentials_path, calendar_id) VALUES (?, ?, ?)",
                (name, credentials_path, calendar_id),
            )
            new_key_id = cur.lastrowid
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()
        upload_committed = True
        _backfill_all_appointments(new_key_id)
        _wake_scheduler()
        conn = get_db()
        try:
            row = conn.execute("SELECT * FROM gcal_keys WHERE id=?", (new_key_id,)).fetchone()
        finally:
            conn.close()
        return _row_to_dict(row)
    finally:
        if uploaded_path is not None and not upload_committed:
            uploaded_path.unlink(missing_ok=True)


@router.put("/api/gcal-keys/{key_id}", dependencies=[Depends(require_perm("gcal-keys-manage"))])
async def update_gcal_key(key_id: int, request: Request):
    """✏️ 編輯 key（名稱/路徑/calendar_id/啟停），支援重新上傳 JSON。"""
    with gcal_sync._key_process_lock(key_id):
        return await _update_gcal_key_locked(key_id, request)


async def _update_gcal_key_locked(key_id: int, request: Request):
    uploaded_path = None
    upload_committed = False
    try:
        conn = get_db()
        try:
            row = conn.execute("SELECT * FROM gcal_keys WHERE id=?", (key_id,)).fetchone()
        finally:
            conn.close()
        if not row:
            raise HTTPException(404, "Key 不存在")

        content_type = request.headers.get("content-type", "").lower()
        old_credentials_path = row["credentials_path"]
        if content_type.startswith("multipart/form-data"):
            form = await request.form()
            name = str(form.get("name") or "").strip()
            credentials_path = str(form.get("credentials_path") or "").strip()
            calendar_id = str(form.get("calendar_id") or "").strip()
            is_active_raw = form.get("is_active")
            is_active = None if is_active_raw is None else (
                str(is_active_raw).lower() in ("true", "1", "on")
            )
            uploaded = form.get("credentials_file")
            if uploaded is not None and getattr(uploaded, "filename", None) is not None:
                filename = str(uploaded.filename or "")
                if Path(filename).suffix.lower() != ".json":
                    raise HTTPException(400, "Service Account 檔案必須是 .json")
                data = await uploaded.read(MAX_CREDENTIALS_SIZE + 1)
                credentials = _credentials_data(data)
                storage_dir = UPLOADED_CREDENTIALS_DIR
                storage_dir.mkdir(parents=True, exist_ok=True)
                uploaded_path = storage_dir / f"{uuid.uuid4().hex}.json"
                try:
                    uploaded_path.write_text(
                        json.dumps(credentials, ensure_ascii=False, indent=2), encoding="utf-8"
                    )
                except OSError:
                    uploaded_path.unlink(missing_ok=True)
                    raise
                credentials_path = str(uploaded_path)
        else:
            try:
                k = GcalKeyUpdate.model_validate(await request.json())
            except Exception as exc:
                raise HTTPException(422, "Key 資料格式錯誤") from exc
            name = k.name.strip() if k.name else None
            credentials_path = k.credentials_path.strip() if k.credentials_path else None
            calendar_id = k.calendar_id.strip() if k.calendar_id else None
            is_active = k.is_active

        updates, params = [], []
        new_credentials_path = old_credentials_path
        if name is not None:
            if not name:
                raise HTTPException(400, "Key 名稱不可為空白")
            if len(name) > 100:
                raise HTTPException(400, "Key 名稱過長")
            conn = get_db()
            try:
                dup = conn.execute(
                    "SELECT id FROM gcal_keys WHERE name=? AND id!=?", (name, key_id)
                ).fetchone()
            finally:
                conn.close()
            if dup:
                raise HTTPException(400, f"Key「{name}」已被使用")
            updates.append("name=?")
            params.append(name)
        if credentials_path is not None:
            if not credentials_path or len(credentials_path) > 500:
                raise HTTPException(400, "JSON 路徑長度不合法")
            new_credentials_path = credentials_path
            updates.append("credentials_path=?")
            params.append(credentials_path)
        if calendar_id is not None:
            if not calendar_id or len(calendar_id) > 300:
                raise HTTPException(400, "Calendar ID 長度不合法")
            updates.append("calendar_id=?")
            params.append(calendar_id)
        if is_active is not None:
            updates.append("is_active=?")
            params.append(1 if is_active else 0)
        if not updates:
            raise HTTPException(400, "無可更新欄位")

        was_inactive = not bool(row["is_active"])
        new_is_active = bool(row["is_active"]) if is_active is None else bool(is_active)
        calendar_changed = calendar_id is not None and calendar_id != row["calendar_id"]
        params.append(key_id)
        conn = get_db()
        try:
            maps = []
            deleted_ok = 0
            failed_maps = {}
            if calendar_changed:
                maps = conn.execute(
                    "SELECT appointment_id, key_id, google_event_id "
                    "FROM appointment_gcal_map WHERE key_id=?",
                    (key_id,),
                ).fetchall()
                with ExitStack() as event_locks:
                    for mapped_appt_id, mapped_key_id in sorted(
                        {(m["appointment_id"], m["key_id"]) for m in maps}
                    ):
                        event_locks.enter_context(
                            gcal_sync._event_process_lock(mapped_appt_id, mapped_key_id)
                        )
                    remote_maps = [m for m in maps if m["google_event_id"]]
                    if remote_maps:
                        try:
                            service = gcal_sync.get_service_for_key(dict(row))
                        except Exception as exc:
                            safe_error = gcal_sync.safe_sync_error(exc)
                            failed_maps = {
                                (m["appointment_id"], m["key_id"]): safe_error
                                for m in remote_maps
                            }
                        else:
                            for map_row in remote_maps:
                                identity = (map_row["appointment_id"], map_row["key_id"])
                                try:
                                    service.events().delete(
                                        calendarId=row["calendar_id"],
                                        eventId=map_row["google_event_id"],
                                    ).execute()
                                    deleted_ok += 1
                                except Exception as exc:
                                    status = getattr(getattr(exc, "resp", None), "status", None)
                                    if status == 410:
                                        deleted_ok += 1
                                        continue
                                    failed_maps[identity] = gcal_sync.safe_sync_error(exc)

                    if failed_maps:
                        version = gcal_sync.sync_version_now()
                        failed_identities = set(failed_maps)
                        for map_row in maps:
                            identity = (map_row["appointment_id"], map_row["key_id"])
                            if identity not in failed_identities:
                                conn.execute(
                                    "DELETE FROM appointment_gcal_map WHERE appointment_id=? AND key_id=?",
                                    identity,
                                )
                                continue
                            existing = conn.execute(
                                "SELECT attempts FROM appointment_sync_queue "
                                "WHERE appointment_id=? AND key_id=?",
                                identity,
                            ).fetchone()
                            attempts = min(
                                gcal_sync.MAX_ATTEMPTS,
                                (int(existing["attempts"] or 0) if existing else 0) + 1,
                            )
                            conn.execute(
                                "INSERT INTO appointment_sync_queue "
                                "(appointment_id,key_id,op_type,google_event_id,last_modified_at,attempts,last_error) "
                                "VALUES(?,?, 'D', ?, ?, ?, ?) "
                                "ON CONFLICT(appointment_id,key_id) DO UPDATE SET "
                                "op_type='D', google_event_id=excluded.google_event_id, "
                                "last_modified_at=excluded.last_modified_at, attempts=excluded.attempts, "
                                "last_error=excluded.last_error",
                                (
                                    map_row["appointment_id"], key_id, map_row["google_event_id"],
                                    version, attempts, failed_maps[identity],
                                ),
                            )
                        conn.commit()
                        _backfill_all_appointments(key_id)
                        _wake_scheduler()
                        raise HTTPException(
                            409,
                            {
                                "ok": False,
                                "key_updated": False,
                                "google_deleted": deleted_ok,
                                "google_failed": len(failed_maps),
                            },
                        )
                    conn.execute("DELETE FROM appointment_gcal_map WHERE key_id=?", (key_id,))

            conn.execute(f"UPDATE gcal_keys SET {','.join(updates)} WHERE id=?", params)
            if name is not None and name != row["name"]:
                conn.execute(
                    "UPDATE users SET gcal_key=? WHERE gcal_key=?", (name, row["name"])
                )
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()
        upload_committed = True

        if new_credentials_path != old_credentials_path:
            _delete_uploaded_credentials(old_credentials_path)
            conn = get_db()
            try:
                conn.execute(
                    "UPDATE appointment_sync_queue SET attempts=0, last_error='', last_modified_at=? "
                    "WHERE key_id=?",
                    (gcal_sync.sync_version_now(), key_id),
                )
                conn.commit()
            finally:
                conn.close()
        if calendar_changed or (was_inactive and new_is_active):
            _backfill_all_appointments(key_id)
        _wake_scheduler()

        conn = get_db()
        try:
            final_row = conn.execute("SELECT * FROM gcal_keys WHERE id=?", (key_id,)).fetchone()
        finally:
            conn.close()
        return _row_to_dict(final_row)
    finally:
        if uploaded_path is not None and not upload_committed:
            uploaded_path.unlink(missing_ok=True)


@router.delete("/api/gcal-keys/{key_id}", dependencies=[Depends(require_perm("gcal-keys-manage"))])
def delete_gcal_key(key_id: int):
    """刪除 key；遠端清理不完整時保留 key/map 與可 retry 的 D queue。"""
    if key_id < 0:
        raise HTTPException(400, "key_id 不可為負數")
    import logging
    from app.services import gcal_sync
    logger = logging.getLogger(__name__)

    conn = get_db()
    try:
        with ExitStack() as process_locks:
            process_locks.enter_context(gcal_sync._key_process_lock(key_id))
            row = conn.execute("SELECT * FROM gcal_keys WHERE id=?", (key_id,)).fetchone()
            if not row:
                raise HTTPException(404, "Key 不存在")

            maps = conn.execute(
                "SELECT appointment_id, google_event_id FROM appointment_gcal_map WHERE key_id=?",
                (key_id,),
            ).fetchall()
            with ExitStack() as event_locks:
                for mapped_appt_id, mapped_key_id in sorted(
                    {(m["appointment_id"], key_id) for m in maps}
                ):
                    event_locks.enter_context(
                        gcal_sync._event_process_lock(mapped_appt_id, mapped_key_id)
                    )
                deleted_ok = 0
                failed_maps = []
                remote_maps = [m for m in maps if m["google_event_id"]]
                if remote_maps:
                    try:
                        svc = gcal_sync.get_service_for_key(dict(row))
                    except Exception as exc:
                        logger.warning("刪除 key 時無法建立 Google service（憑證可能無效）: %s", type(exc).__name__)
                        failed_maps = [
                            (m, f"{type(exc).__name__}: Google service unavailable") for m in remote_maps
                        ]
                    else:
                        cal_id = row["calendar_id"]
                        for map_row in remote_maps:
                            try:
                                svc.events().delete(
                                    calendarId=cal_id, eventId=map_row["google_event_id"]
                                ).execute()
                                deleted_ok += 1
                            except Exception as exc:
                                if getattr(getattr(exc, "resp", None), "status", None) == 410:
                                    # 遠端已不存在，與同步 D semantics 一樣視為完成。
                                    deleted_ok += 1
                                    continue
                                logger.warning(
                                    "刪除 key 時 Google 事件刪除失敗 appt=%s gid=%s: %s",
                                    map_row["appointment_id"], map_row["google_event_id"], gcal_sync.safe_sync_error(exc),
                                )
                                failed_maps.append((map_row, gcal_sync.safe_sync_error(exc)))

                if failed_maps:
                    version = gcal_sync.sync_version_now()
                    for map_row, error_text in failed_maps:
                        existing = conn.execute(
                            "SELECT attempts FROM appointment_sync_queue WHERE appointment_id=? AND key_id=?",
                            (map_row["appointment_id"], key_id),
                        ).fetchone()
                        attempts = min(
                            gcal_sync.MAX_ATTEMPTS,
                            (int(existing["attempts"] or 0) if existing else 0) + 1,
                        )
                        conn.execute(
                            "INSERT INTO appointment_sync_queue "
                            "(appointment_id,key_id,op_type,google_event_id,last_modified_at,attempts,last_error) "
                            "VALUES(?,?, 'D', ?, ?, ?, ?) "
                            "ON CONFLICT(appointment_id,key_id) DO UPDATE SET "
                            "op_type='D', google_event_id=excluded.google_event_id, "
                            "last_modified_at=excluded.last_modified_at, attempts=excluded.attempts, "
                            "last_error=excluded.last_error",
                            (
                                map_row["appointment_id"], key_id, map_row["google_event_id"],
                                version, attempts, error_text,
                            ),
                        )
                    # 保留 key/map；只把失敗的 remote deletes 交給既有 queue 管理流程。
                    conn.commit()
                    _wake_scheduler()
                    raise HTTPException(
                        409,
                        {
                            "ok": False,
                            "key_deleted": False,
                            "google_deleted": deleted_ok,
                            "google_failed": len(failed_maps),
                        },
                    )

                conn.execute("DELETE FROM gcal_keys WHERE id=?", (key_id,))
                conn.commit()
                _delete_uploaded_credentials(row["credentials_path"])
                msg = f"Key 已刪除（Google 事件：{deleted_ok} 成功 / 0 失敗）"
                logger.info(msg)
                return {"ok": True, "google_deleted": deleted_ok, "google_failed": 0}
    finally:
        conn.close()


@router.get("/api/gcal-keys/options", dependencies=[Depends(require_perm("gcal-keys-manage"))])
def gcal_key_options():
    """下拉選單用：回傳啟用中的 key（id + name）。"""
    conn = get_db()
    try:
        rows = conn.execute("SELECT id, name FROM gcal_keys WHERE is_active=1 ORDER BY name").fetchall()
        return [{"id": r["id"], "name": r["name"]} for r in rows]
    finally:
        conn.close()


@router.get(
    "/api/gcal-keys/{key_id}/events/{event_id}/reminders",
    dependencies=[Depends(require_perm("gcal-sync-manage"))],
)
def probe_remote_event_reminders(key_id: int, event_id: str):
    """診斷 Google remote reminders；可讀 inactive key，但不回傳憑證資料。"""
    if key_id < 0 or not event_id or len(event_id) > 1024:
        raise HTTPException(400, "key_id 或 event_id 格式不合法")
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT * FROM gcal_keys WHERE id=?", (key_id,)
        ).fetchone()
    finally:
        conn.close()
    if row is None:
        raise HTTPException(404, "Key 不存在")
    try:
        service = gcal_sync.get_service_for_key(dict(row))
        reminders = gcal_sync.verify_remote_event_reminders(
            service, row["calendar_id"], event_id
        )
    except Exception as exc:
        raise HTTPException(502, "無法讀取 Google remote event reminders") from exc
    return {"key_id": key_id, "event_id": event_id, "reminders": reminders}


# ========== 同步設定 API（2026-08-27）==========

@router.get("/api/gcal-sync-settings", dependencies=[Depends(require_perm("gcal-sync-manage"))])
def get_gcal_sync_settings():
    """讀取全域同步設定。"""
    conn = get_db()
    try:
        rows = conn.execute("SELECT key, value FROM gcal_sync_settings").fetchall()
        return {r["key"]: r["value"] for r in rows}
    finally:
        conn.close()


@router.put("/api/gcal-sync-settings", dependencies=[Depends(require_perm("gcal-sync-manage"))])
def update_gcal_sync_settings(body: dict):
    """更新全域同步設定（部分更新），並 invalidation 所有 active mappings。"""
    allowed = {"gcal_default_duration_min", "gcal_use_location", "gcal_transparency", "gcal_sync_interval_min"}
    unknown = set(body) - allowed
    if unknown:
        raise HTTPException(400, f"未知同步設定：{', '.join(sorted(unknown))}")
    if not body:
        raise HTTPException(400, "至少要提供一個同步設定")
    changed = False
    conn = get_db()
    try:
        for k, v in body.items():
            if k not in allowed:
                continue
            if k in ("gcal_default_duration_min", "gcal_sync_interval_min"):
                try:
                    iv = int(v)
                except (TypeError, ValueError):
                    raise HTTPException(400, f"{k} 必須是整數")
                if k == "gcal_default_duration_min" and not (1 <= iv <= 480):
                    raise HTTPException(400, "gcal_default_duration_min 範圍 1~480 分鐘")
                if k == "gcal_sync_interval_min" and not (1 <= iv <= 30):
                    raise HTTPException(400, "gcal_sync_interval_min 範圍 1~30 分鐘")
                v = str(iv)
            elif k == "gcal_use_location":
                if str(v) not in ("0", "1"):
                    raise HTTPException(400, "gcal_use_location 只能是 0 或 1")
            elif k == "gcal_transparency":
                if str(v) not in ("transparent", "opaque"):
                    raise HTTPException(400, "gcal_transparency 只能是 transparent 或 opaque")
            old = conn.execute("SELECT value FROM gcal_sync_settings WHERE key=?", (k,)).fetchone()
            value = str(v)
            changed = changed or old is None or old["value"] != value
            conn.execute(
                "INSERT INTO gcal_sync_settings(key, value) VALUES(?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (k, value))
        conn.commit()
    finally:
        conn.close()
    affected = gcal_sync.enqueue_existing_mappings() if changed else 0
    if changed:
        _wake_scheduler()
    return {"ok": True, "affected": affected}


# ========== Per-Key 提醒設定 API ==========

@router.put("/api/gcal-keys/{key_id}/reminders", dependencies=[Depends(require_perm("gcal-keys-manage"))])
def update_key_reminders(key_id: int, body: dict):
    """更新 per-key 提醒設定，並 invalidation 該 key 的既有 mappings。"""
    if key_id < 0:
        raise HTTPException(400, "key_id 不可為負數")
    import json as _json
    reminders = body.get("reminders", [])
    if not isinstance(reminders, list) or not (1 <= len(reminders) <= 5):
        raise HTTPException(400, "通知數量需為 1~5 個")
    for r in reminders:
        if not isinstance(r, dict) or r.get("method") != "popup" or "minutes" not in r:
            raise HTTPException(400, "每筆通知只能是 popup 且需含 minutes")
        if isinstance(r["minutes"], bool) or not isinstance(r["minutes"], int) or r["minutes"] < 0 or r["minutes"] > 40320:
            raise HTTPException(400, "minutes 範圍 0~40320")
    conn = get_db()
    try:
        row = conn.execute("SELECT id FROM gcal_keys WHERE id=?", (key_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Key 不存在")
        conn.execute("UPDATE gcal_keys SET reminders=? WHERE id=?",
                     (_json.dumps(reminders, ensure_ascii=False), key_id))
        conn.commit()
    finally:
        conn.close()
    affected = gcal_sync.enqueue_existing_mappings(key_id)
    _wake_scheduler()
    return {"ok": True, "reminders": reminders, "affected": affected}


# ========== 強制立即同步 API ==========

@router.post("/api/gcal-sync-now", dependencies=[Depends(require_perm("gcal-sync-force"))])
def force_sync_now():
    """立即觸發同步（忽略 debounce，但不自動重設 exhausted queue）。"""
    from app.services import sync_scheduler
    sync_scheduler.reset_now()
    return {"ok": True, "message": "立即同步已排入處理（已耗盡項目需先按重新嘗試）"}


# ========== 同步隊列管理 API（A6） ==========

@router.get("/api/gcal-sync-queue", dependencies=[Depends(require_perm("gcal-sync-manage"))])
def list_sync_queue():
    """列出同步隊列（含 retry/exhausted、Calendar 與已刪除行程資訊）。"""
    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT q.appointment_id, q.key_id, q.op_type, q.google_event_id,"
            " q.attempts, q.last_error, q.last_modified_at,"
            " k.name AS key_name, k.calendar_id, k.is_active AS key_active, a.client_name, a.date"
            " FROM appointment_sync_queue q"
            " LEFT JOIN gcal_keys k ON k.id=q.key_id"
            " LEFT JOIN appointments a ON a.id=q.appointment_id"
            " ORDER BY q.last_modified_at DESC").fetchall()
        items = []
        for row in rows:
            item = dict(row)
            item["last_error"] = gcal_sync.safe_sync_error(item.get("last_error"))
            item["status"] = gcal_sync.queue_item_status(item["attempts"], item["last_error"])
            item["max_attempts"] = gcal_sync.MAX_ATTEMPTS
            item["key_active"] = bool(item["key_active"])
            item["is_deleted"] = item["client_name"] is None
            items.append(item)
        return {"items": items}
    finally:
        conn.close()


@router.get("/api/gcal-sync-status", dependencies=[Depends(require_perm("gcal-sync-manage"))])
def gcal_sync_status():
    """回傳 scheduler/thread 與 queue health 摘要。"""
    from app.services import sync_scheduler
    return sync_scheduler.get_health()


@router.put("/api/gcal-sync-queue/reset", dependencies=[Depends(require_perm("gcal-sync-manage"))])
def reset_sync_queue(appt_id: int, key_id: int):
    """重置指定 queue 列；不會清除其他 exhausted/error 項目。"""
    if appt_id < 0 or key_id < 0:
        raise HTTPException(400, "appointment_id 與 key_id 不可為負數")
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT appointment_id FROM appointment_sync_queue "
            "WHERE appointment_id=? AND key_id=?", (appt_id, key_id)).fetchone()
        if not row:
            raise HTTPException(404, "隊列列不存在")
        conn.execute(
            "UPDATE appointment_sync_queue SET attempts=0, last_error='', last_modified_at=? "
            "WHERE appointment_id=? AND key_id=?",
            (gcal_sync.sync_version_now(), appt_id, key_id))
        conn.commit()
    finally:
        conn.close()
    _wake_scheduler()
    return {"ok": True}
