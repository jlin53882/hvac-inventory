"""Google 行事曆同步 Key CRUD（admin 級操作）"""
from fastapi import APIRouter, Depends, HTTPException
from app.database import get_db
from pydantic import BaseModel
from app.models import GcalKeyIn, GcalKeyUpdate
from app.services.auth import require_perm

router = APIRouter()


def _row_to_dict(r):
    return {
        "id": r["id"],
        "name": r["name"],
        "credentials_path": r["credentials_path"],
        "calendar_id": r["calendar_id"],
        "is_active": bool(r["is_active"]),
        "created_at": r["created_at"],
    }


@router.get("/api/gcal-keys", dependencies=[Depends(require_perm("unit-mgmt"))])
def list_gcal_keys():
    """admin：回傳全部 gcal key（含停用）。"""
    conn = get_db()
    try:
        rows = conn.execute("SELECT * FROM gcal_keys ORDER BY id").fetchall()
        return [_row_to_dict(r) for r in rows]
    finally:
        conn.close()


@router.post("/api/gcal-keys", status_code=201, dependencies=[Depends(require_perm("unit-mgmt"))])
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
        conn.commit()
        return _row_to_dict(conn.execute("SELECT * FROM gcal_keys WHERE id=?", (cur.lastrowid,)).fetchone())
    finally:
        conn.close()


@router.put("/api/gcal-keys/{key_id}", dependencies=[Depends(require_perm("unit-mgmt"))])
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
        conn.execute(f"UPDATE gcal_keys SET {','.join(updates)} WHERE id=?", params)
        conn.commit()
        return _row_to_dict(conn.execute("SELECT * FROM gcal_keys WHERE id=?", (key_id,)).fetchone())
    finally:
        conn.close()


@router.delete("/api/gcal-keys/{key_id}", dependencies=[Depends(require_perm("unit-mgmt"))])
def delete_gcal_key(key_id: int):
    """🗑️ 刪除 key。"""
    conn = get_db()
    try:
        row = conn.execute("SELECT * FROM gcal_keys WHERE id=?", (key_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Key 不存在")
        conn.execute("DELETE FROM gcal_keys WHERE id=?", (key_id,))
        conn.commit()
        return {"ok": True}
    finally:
        conn.close()


@router.get("/api/gcal-sync-enabled", dependencies=[Depends(require_perm("unit-mgmt"))])
def get_sync_enabled():
    """回傳全域同步開關狀態。"""
    conn = get_db()
    try:
        row = conn.execute("SELECT value FROM settings WHERE key='gcal_sync_enabled'").fetchone()
        return {"enabled": row["value"] == "1"} if row else {"enabled": False}
    finally:
        conn.close()


class SyncEnabledIn(BaseModel):
    enabled: bool = False

@router.put("/api/gcal-sync-enabled", dependencies=[Depends(require_perm("unit-mgmt"))])
def set_sync_enabled(body: SyncEnabledIn):
    """切換全域同步開關。"""
    enabled = body.enabled
    conn = get_db()
    try:
        conn.execute("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)")
        conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('gcal_sync_enabled', ?)",
                     ("1" if enabled else "0",))
        conn.commit()
        return {"enabled": enabled}
    finally:
        conn.close()


@router.get("/api/gcal-keys/options", dependencies=[Depends(require_perm("unit-mgmt"))])
def gcal_key_options():
    """下拉選單用：回傳啟用中的 key（id + name）。"""
    conn = get_db()
    try:
        rows = conn.execute("SELECT id, name FROM gcal_keys WHERE is_active=1 ORDER BY name").fetchall()
        return [{"id": r["id"], "name": r["name"]} for r in rows]
    finally:
        conn.close()
