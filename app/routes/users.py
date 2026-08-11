# -*- coding: utf-8 -*-
"""
使用者管理 API（僅 admin 可用）
================================
- GET    /api/users                列出帳號
- POST   /api/users                新增帳號
- PUT    /api/users/{id}           改顯示名稱/角色/啟用停用
- PUT    /api/users/{id}/password  重設密碼
- DELETE /api/users/{id}           刪除帳號

保護規則（前端 + 後端雙層）：
- 不能刪除自己 / 不能變更自己的角色或停用自己
- 系統至少要保留一名啟用的 admin
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.database import get_db
from app.services.auth import _check_pw, hash_password, require_admin

# 使用者管理 API 路由
router = APIRouter(prefix="/api/users", tags=["users"])


# ---------- 請求模型 ----------
class UserCreate(BaseModel):
    username: str
    password: str
    display_name: str = ""
    role: str = "user"


class UserUpdate(BaseModel):
    display_name: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[int] = None


class UserPassword(BaseModel):
    password: str


class UserBatch(BaseModel):
    users: list[UserCreate]


# 可建立的角色（admin/user/viewer）
ALLOWED_ROLES = ("admin", "user", "viewer")


# ---------- 共用 helpers ----------
def _user_out(row) -> dict:
    """使用者 row 轉對外 payload（只挑安全欄位，不含密碼）"""
    return {
        "id": row["id"],
        "username": row["username"],
        "display_name": row["display_name"],
        "role": row["role"],
        "is_active": row["is_active"],
        "failed_attempts": row["failed_attempts"],
        "locked_until": row["locked_until"],
        "created_at": row["created_at"],
    }


def _get_user_or_404(conn, user_id: int):
    """依 id 查使用者，不存在則 404"""
    row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="找不到該使用者")
    return row


def _active_admin_count(conn, exclude_id: Optional[int] = None) -> int:
    """啟用中 admin 人數（可排除指定 user_id）"""
    if exclude_id is None:
        row = conn.execute(
            "SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND is_active = 1"
        ).fetchone()
    else:
        row = conn.execute(
            "SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND is_active = 1 AND id != ?",
            (exclude_id,),
        ).fetchone()
    return row["c"]


def _create_user_single(conn, body: UserCreate) -> dict:
    """單筆建立帳號（共用邏輯：帳號唯一、密碼長度、角色白名單）。成功回傳 user dict，失敗 raise HTTPException。"""
    username = body.username.strip()
    if not username:
        raise HTTPException(status_code=400, detail="帳號不能空白")
    _check_pw(body.password)
    if body.role not in ALLOWED_ROLES:
        raise HTTPException(status_code=400, detail=f"角色只能是 {'、'.join(ALLOWED_ROLES)}")
    dup = conn.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
    if dup:
        raise HTTPException(status_code=409, detail="帳號已存在")
    cur = conn.execute(
        "INSERT INTO users (username, password_hash, display_name, role, password_updated_at) VALUES (?, ?, ?, ?, datetime('now'))",
        (username, hash_password(body.password), body.display_name.strip(), body.role),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM users WHERE id = ?", (cur.lastrowid,)).fetchone()
    return _user_out(row)


# ---------- API ----------
@router.get("")
def list_users(admin: dict = Depends(require_admin)):
    """列出所有帳號（含狀態）"""
    conn = get_db()
    try:
        rows = conn.execute("SELECT * FROM users ORDER BY id").fetchall()
        return {"users": [_user_out(r) for r in rows]}
    finally:
        conn.close()


@router.post("", status_code=201)
def create_user(body: UserCreate, admin: dict = Depends(require_admin)):
    """新增帳號（帳號唯一；密碼 8 碼+大小寫+數字，_check_pw）"""
    conn = get_db()
    try:
        return _create_user_single(conn, body)
    finally:
        conn.close()


@router.post("/batch", status_code=201)
def create_users_batch(body: UserBatch, admin: dict = Depends(require_admin)):
    """批次新增帳號（表格/匯入用）：逐筆建立，每筆獨立回報成功或失敗。

    不回滾——建成功的留著，失敗的列出具體原因（例如第 3 行帳號重複），
    讓前端表格可以逐列顯示 ✔/✘，方便修正後重送。
    """
    conn = get_db()
    try:
        results = []
        created = 0
        for u in body.users:
            try:
                user = _create_user_single(conn, u)
                created += 1
                results.append({"username": u.username.strip(), "status": "ok", "detail": "已建立"})
            except HTTPException as e:
                results.append({"username": u.username.strip(), "status": "error", "detail": e.detail})
        return {"results": results, "created": created, "failed": len(results) - created}
    finally:
        conn.close()


@router.put("/{user_id}")
def update_user(user_id: int, body: UserUpdate, admin: dict = Depends(require_admin)):
    """改顯示名稱 / 角色 / 啟用停用（含保護規則）"""
    conn = get_db()
    try:
        row = _get_user_or_404(conn, user_id)

        display_name = row["display_name"] if body.display_name is None else body.display_name.strip()
        role = row["role"] if body.role is None else body.role
        is_active = row["is_active"] if body.is_active is None else body.is_active

        if body.role is not None and body.role not in ALLOWED_ROLES:
            raise HTTPException(status_code=400, detail=f"角色只能是 {'、'.join(ALLOWED_ROLES)}")

        # 保護 1：不能變更自己的角色或停用自己
        if admin["id"] == user_id:
            if (body.role is not None and body.role != row["role"]) or \
               (body.is_active is not None and body.is_active != row["is_active"]):
                raise HTTPException(status_code=400, detail="不能變更自己的角色或停用自己")

        # 保護 2：最後一名啟用 admin 不能停用/降級
        if row["role"] == "admin" and row["is_active"] == 1:
            if (body.role is not None and body.role != "admin") or \
               (body.is_active is not None and body.is_active == 0):
                if _active_admin_count(conn, exclude_id=user_id) == 0:
                    raise HTTPException(status_code=400, detail="系統至少需要一名啟用的管理員")

        conn.execute(
            "UPDATE users SET display_name = ?, role = ?, is_active = ?, updated_at = datetime('now') WHERE id = ?",
            (display_name, role, is_active, user_id),
        )
        # B3：帳號被停用 → 舊 session 立即失效（避免停用後仍可續用 7 天）
        if row["is_active"] == 1 and is_active == 0:
            conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
        conn.commit()
        return _user_out(conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone())
    finally:
        conn.close()


@router.put("/{user_id}/password")
def reset_password(user_id: int, body: UserPassword, admin: dict = Depends(require_admin)):
    """重設密碼（admin 免舊密碼）+ 解鎖 + 清舊 session（B3：改密碼後舊 session 立即失效）"""
    _check_pw(body.password)
    conn = get_db()
    try:
        _get_user_or_404(conn, user_id)
        conn.execute(
            "UPDATE users SET password_hash = ?, failed_attempts = 0, locked_until = NULL, updated_at = datetime('now') WHERE id = ?",
            (hash_password(body.password), user_id),
        )
        conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
        conn.commit()
        return {"ok": True}
    finally:
        conn.close()


@router.delete("/{user_id}")
def delete_user(user_id: int, admin: dict = Depends(require_admin)):
    """刪除帳號（不能刪自己 / 不能刪最後一名啟用 admin）"""
    if admin["id"] == user_id:
        raise HTTPException(status_code=400, detail="不能刪除自己")
    conn = get_db()
    try:
        row = _get_user_or_404(conn, user_id)
        if row["role"] == "admin" and row["is_active"] == 1 and _active_admin_count(conn, exclude_id=user_id) == 0:
            raise HTTPException(status_code=400, detail="系統必須保留一名啟用的管理員")
        conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
        conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
        conn.commit()
        return {"ok": True}
    finally:
        conn.close()