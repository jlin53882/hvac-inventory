"""Google 行事曆同步 Key CRUD（admin 級操作）"""
from fastapi import APIRouter, Depends, HTTPException
from app.database import get_db
from app.models import GcalKeyIn, GcalKeyUpdate
from app.services.auth import require_perm


def _backfill_all_appointments(key_id: int):
    """新增 key 後，自動把所有旧行程加入 sync_queue（C = create）。

    回傳成功 backfill 的筆數；失敗回傳 None 並 log ERROR（不再靜默吞掉）。
    """
    try:
        conn = get_db()
        try:
            appt_ids = [r["id"] for r in conn.execute("SELECT id FROM appointments").fetchall()]
            for appt_id in appt_ids:
                conn.execute(
                    """INSERT INTO appointment_sync_queue
                       (appointment_id, key_id, op_type, google_event_id, last_modified_at, attempts, last_error)
                       VALUES(?, ?, 'C', '', datetime('now'), 0, '')
                       ON CONFLICT(appointment_id, key_id) DO UPDATE SET
                       op_type='C', last_modified_at=datetime('now'), attempts=0, last_error=''""",
                    (appt_id, key_id))
            conn.commit()
            return len(appt_ids)
        finally:
            conn.close()
    except Exception as e:
        import logging
        logging.getLogger(__name__).error(
            "backfill sync_queue 失敗 key_id=%s: %s （新增 key 已成功但舊行程未加入同步佇列，需重新啟用該 key 觸發回填）",
            key_id, e)
        return None

router = APIRouter()


def _row_to_dict(r):
    import json as _json
    reminders_raw = r["reminders"] if "reminders" in r.keys() else "[]"
    try:
        reminders = _json.loads(reminders_raw)
    except Exception:
        reminders = []
    return {
        "id": r["id"],
        "name": r["name"],
        "credentials_path": r["credentials_path"],
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
def create_gcal_key(k: GcalKeyIn):
    """＋ 新增 key。name 不可重複（含停用）。"""
    name = k.name.strip()
    if not name:
        raise HTTPException(400, "Key 名稱不可為空白")
    conn = get_db()
    try:
        if conn.execute("SELECT id FROM gcal_keys WHERE name=?", (name,)).fetchone():
            raise HTTPException(400, f"Key「{name}」已存在")
        cur = conn.execute(
            "INSERT INTO gcal_keys (name, credentials_path, calendar_id) VALUES (?, ?, ?)",
            (name, k.credentials_path.strip(), k.calendar_id.strip()),
        )
        new_key_id = cur.lastrowid
        conn.commit()
    finally:
        conn.close()
    # 新增 key 後，自動把所有旧行程加入 sync_queue（首次同步）
    _backfill_all_appointments(new_key_id)
    from app.database import get_db as _g
    _c = _g()
    try:
        row = _c.execute("SELECT * FROM gcal_keys WHERE id=?", (new_key_id,)).fetchone()
    finally:
        _c.close()
    return _row_to_dict(row)


@router.put("/api/gcal-keys/{key_id}", dependencies=[Depends(require_perm("gcal-keys-manage"))])
def update_gcal_key(key_id: int, k: GcalKeyUpdate):
    """✏️ 編輯 key（名稱/路徑/calendar_id/啟停）。"""
    conn = get_db()
    try:
        row = conn.execute("SELECT * FROM gcal_keys WHERE id=?", (key_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Key 不存在")
        updates, params = [], []
        if k.name is not None:
            name = k.name.strip()
            if not name:
                raise HTTPException(400, "Key 名稱不可為空白")
            dup = conn.execute("SELECT id FROM gcal_keys WHERE name=? AND id!=?", (name, key_id)).fetchone()
            if dup:
                raise HTTPException(400, f"Key「{name}」已被使用")
            updates.append("name=?")
            params.append(name)
        if k.credentials_path is not None:
            updates.append("credentials_path=?")
            params.append(k.credentials_path.strip())
        if k.calendar_id is not None:
            updates.append("calendar_id=?")
            params.append(k.calendar_id.strip())
        if k.is_active is not None:
            updates.append("is_active=?")
            params.append(1 if k.is_active else 0)
        if not updates:
            raise HTTPException(400, "無可更新欄位")
        params.append(key_id)
        was_inactive = not row["is_active"] if "is_active" in row.keys() else False
        conn.execute(f"UPDATE gcal_keys SET {','.join(updates)} WHERE id=?", params)
        conn.commit()
    finally:
        conn.close()
    # key 從停用→啟用時，自動把旧行程加入 sync_queue
    if was_inactive and k.is_active:
        _backfill_all_appointments(key_id)
    from app.database import get_db as _g
    _c = _g()
    try:
        final_row = _c.execute("SELECT * FROM gcal_keys WHERE id=?", (key_id,)).fetchone()
    finally:
        _c.close()
    return _row_to_dict(final_row)


@router.delete("/api/gcal-keys/{key_id}", dependencies=[Depends(require_perm("gcal-keys-manage"))])
def delete_gcal_key(key_id: int):
    """🗑️ 刪除 key。先清 Google 行事曆上的事件，再刪 key（DB CASCADE 清本地對映）。"""
    import logging
    from app.services import gcal_sync
    logger = logging.getLogger(__name__)

    conn = get_db()
    try:
        row = conn.execute("SELECT * FROM gcal_keys WHERE id=?", (key_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Key 不存在")

        # 查出該 key 已同步的 Google 事件
        maps = conn.execute(
            "SELECT appointment_id, google_event_id FROM appointment_gcal_map WHERE key_id=?",
            (key_id,)).fetchall()

        # 逐筆刪除 Google 端事件（失敗不阻斷 key 刪除）
        deleted_ok = deleted_fail = 0
        if maps:
            try:
                svc = gcal_sync.get_service_for_key(dict(row))
                cal_id = row["calendar_id"]
                for m in maps:
                    gid = m["google_event_id"]
                    if not gid:
                        continue
                    try:
                        svc.events().delete(calendarId=cal_id, eventId=gid).execute()
                        deleted_ok += 1
                    except Exception as e:
                        logger.warning("刪除 key 時 Google 事件刪除失敗 appt=%s gid=%s: %s",
                                        m["appointment_id"], gid, e)
                        deleted_fail += 1
            except Exception as e:
                logger.warning("刪除 key 時無法建立 Google service（憑證可能無效）: %s", e)
                deleted_fail += len(maps)

        # 刪 key（DB CASCADE 自動清 appointment_gcal_map + appointment_sync_queue）
        conn.execute("DELETE FROM gcal_keys WHERE id=?", (key_id,))
        conn.commit()
        msg = f"Key 已刪除（Google 事件：{deleted_ok} 成功 / {deleted_fail} 失敗）"
        logger.info(msg)
        return {"ok": True, "google_deleted": deleted_ok, "google_failed": deleted_fail}
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
    """更新全域同步設定（部分更新）。"""
    import re as _re
    allowed = {"gcal_default_duration_min", "gcal_use_location", "gcal_transparency", "gcal_sync_interval_min"}
    conn = get_db()
    try:
        for k, v in body.items():
            if k not in allowed:
                continue
            # 值驗證
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
            conn.execute(
                "INSERT INTO gcal_sync_settings(key, value) VALUES(?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (k, str(v)))
        conn.commit()
        return {"ok": True}
    finally:
        conn.close()


# ========== Per-Key 提醒設定 API ==========

@router.put("/api/gcal-keys/{key_id}/reminders", dependencies=[Depends(require_perm("gcal-keys-manage"))])
def update_key_reminders(key_id: int, body: dict):
    """更新 per-key 提醒設定（JSON array）。"""
    import json as _json
    reminders = body.get("reminders", [])
    # 驗證格式
    if not isinstance(reminders, list):
        raise HTTPException(400, "reminders 必須是陣列")
    for r in reminders:
        if not isinstance(r, dict) or "method" not in r or "minutes" not in r:
            raise HTTPException(400, "每筆提醒需含 method 和 minutes")
        if r["method"] not in ("popup", "email"):
            raise HTTPException(400, "method 只能是 popup 或 email")
        if not isinstance(r["minutes"], int) or r["minutes"] < 0 or r["minutes"] > 40320:
            raise HTTPException(400, "minutes 範圍 0~40320")
    conn = get_db()
    try:
        row = conn.execute("SELECT id FROM gcal_keys WHERE id=?", (key_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Key 不存在")
        conn.execute("UPDATE gcal_keys SET reminders=? WHERE id=?",
                     (_json.dumps(reminders, ensure_ascii=False), key_id))
        conn.commit()
        return {"ok": True, "reminders": reminders}
    finally:
        conn.close()


# ========== 強制立即同步 API ==========

@router.post("/api/gcal-sync-now", dependencies=[Depends(require_perm("gcal-sync-force"))])
def force_sync_now():
    """立即觸發同步（忽略排程間隔）"""
    from app.services import sync_scheduler
    sync_scheduler.reset_now()
    return {"ok": True, "message": "同步信號已發送，下次排程器執行時立即同步"}


# ========== 同步隊列管理 API（A6） ==========

@router.get("/api/gcal-sync-queue", dependencies=[Depends(require_perm("gcal-sync-manage"))])
def list_sync_queue():
    """列出同步隊列（含失敗項 + last_error），admin 全覽用。"""
    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT q.appointment_id, q.key_id, q.op_type, q.google_event_id,"
            " q.attempts, q.last_error, q.last_modified_at,"
            " k.name AS key_name, a.client_name, a.date"
            " FROM appointment_sync_queue q"
            " LEFT JOIN gcal_keys k ON k.id=q.key_id"
            " LEFT JOIN appointments a ON a.id=q.appointment_id"
            " ORDER BY q.last_modified_at DESC").fetchall()
        return {"items": [dict(r) for r in rows]}
    finally:
        conn.close()


@router.put("/api/gcal-sync-queue/reset", dependencies=[Depends(require_perm("gcal-sync-manage"))])
def reset_sync_queue(appt_id: int, key_id: int):
    """重置某列的 attempts（歸零後下次排程器會重新嘗試同步）。"""
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT appointment_id FROM appointment_sync_queue "
            "WHERE appointment_id=? AND key_id=?", (appt_id, key_id)).fetchone()
        if not row:
            raise HTTPException(404, "隊列列不存在")
        conn.execute(
            "UPDATE appointment_sync_queue SET attempts=0, last_error='' "
            "WHERE appointment_id=? AND key_id=?", (appt_id, key_id))
        conn.commit()
        return {"ok": True}
    finally:
        conn.close()
