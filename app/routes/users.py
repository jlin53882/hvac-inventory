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

import json
import re

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.database import get_db
from app.services.auth import _check_pw, get_user_permissions, hash_password, require_perm

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
    color: Optional[str] = None  # 行事曆人員顏色（選填 hex）


class UserPassword(BaseModel):
    password: str


class UserBatch(BaseModel):
    users: list[UserCreate]


class UserPermissionsUpdate(BaseModel):
    permissions: Optional[dict] = None   # {key: 0|1}（部分更新）
    reset_all: bool = False              # True = 清空全部覆蓋回角色預設


# 可建立的角色（admin/user/viewer/tech——tech：行事曆可寫、其他唯讀，2026-08-13 Sarah：藍政達）
ALLOWED_ROLES = ("admin", "user", "viewer", "tech")  # tech：行事曆可寫、其他唯讀（2026-08-13 Sarah：藍政達）


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


def _create_user_single(conn, body: UserCreate, operator_id: int = None) -> dict:
    """單筆建立帳號（共用邏輯：帳號唯一、密碼長度、角色白名單）。成功回傳 user dict，失敗 raise HTTPException。
    RBAC（2026-08-13）：成功路徑寫稽核（action='create'，稽核 B6）"""
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
    if operator_id is not None:
        conn.execute(
            "INSERT INTO user_audit_log (operator_id, target_id, action, detail) VALUES (?, ?, 'create', ?)",
            (operator_id, cur.lastrowid, json.dumps({"username": username, "role": body.role}, ensure_ascii=False)),
        )
    conn.commit()
    row = conn.execute("SELECT * FROM users WHERE id = ?", (cur.lastrowid,)).fetchone()
    return _user_out(row)


def _audit(conn, operator_id: int, target_id: int, action: str, detail: str = "") -> None:
    """寫入帳號操作稽核紀錄（RBAC §9）"""
    conn.execute(
        "INSERT INTO user_audit_log (operator_id, target_id, action, detail) VALUES (?, ?, ?, ?)",
        (operator_id, target_id, action, detail),
    )


# ---------- API ----------
@router.get("")
def list_users(admin: dict = Depends(require_perm("user-mgmt"))):
    """列出所有帳號（含狀態）"""
    conn = get_db()
    try:
        rows = conn.execute("SELECT * FROM users ORDER BY id").fetchall()
        return {"users": [_user_out(r) for r in rows]}
    finally:
        conn.close()


@router.post("", status_code=201)
def create_user(body: UserCreate, admin: dict = Depends(require_perm("user-mgmt"))):
    """新增帳號（帳號唯一；密碼 8 碼+大小寫+數字，_check_pw）"""
    conn = get_db()
    try:
        return _create_user_single(conn, body, operator_id=admin["id"])
    finally:
        conn.close()


@router.post("/batch", status_code=201)
def create_users_batch(body: UserBatch, admin: dict = Depends(require_perm("user-mgmt"))):
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
                user = _create_user_single(conn, u, operator_id=admin["id"])
                created += 1
                results.append({"username": u.username.strip(), "status": "ok", "detail": "已建立"})
            except HTTPException as e:
                results.append({"username": u.username.strip(), "status": "error", "detail": e.detail})
        return {"results": results, "created": created, "failed": len(results) - created}
    finally:
        conn.close()


@router.put("/{user_id}")
def update_user(user_id: int, body: UserUpdate, admin: dict = Depends(require_perm("user-mgmt"))):
    """改顯示名稱 / 角色 / 啟用停用（含保護規則）"""
    conn = get_db()
    try:
        row = _get_user_or_404(conn, user_id)

        display_name = row["display_name"] if body.display_name is None else body.display_name.strip()
        role = row["role"] if body.role is None else body.role
        is_active = row["is_active"] if body.is_active is None else body.is_active
        color = row["color"] if body.color is None else body.color.strip()

        if body.role is not None and body.role not in ALLOWED_ROLES:
            raise HTTPException(status_code=400, detail=f"角色只能是 {'、'.join(ALLOWED_ROLES)}")

        # 2026-08-12 補：color 只接受 #RRGGBB（防屬性逃逸 stored XSS——行事曆 render 直接內插 style）
        if color and not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
            raise HTTPException(status_code=400, detail="顏色格式需為 #RRGGBB")

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
            "UPDATE users SET display_name = ?, role = ?, is_active = ?, color = ?, updated_at = datetime('now') WHERE id = ?",
            (display_name, role, is_active, color, user_id),
        )
        # B3：帳號被停用 → 舊 session 立即失效（避免停用後仍可續用 7 天）
        if row["is_active"] == 1 and is_active == 0:
            conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
        # RBAC 稽核：角色變更 / 啟停（稽核 §9）
        if body.role is not None and role != row["role"]:
            _audit(conn, admin["id"], user_id, "role_change", json.dumps({"role": role}, ensure_ascii=False))
        if body.is_active is not None and is_active != row["is_active"]:
            _audit(conn, admin["id"], user_id, "deactivate" if is_active == 0 else "activate",
                   json.dumps({"is_active": is_active}, ensure_ascii=False))
        conn.commit()
        return _user_out(conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone())
    finally:
        conn.close()


@router.put("/{user_id}/password")
def reset_password(user_id: int, body: UserPassword, admin: dict = Depends(require_perm("user-mgmt"))):
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
        _audit(conn, admin["id"], user_id, "reset_password")
        conn.commit()
        return {"ok": True}
    finally:
        conn.close()


@router.delete("/{user_id}")
def delete_user(user_id: int, admin: dict = Depends(require_perm("user-mgmt"))):
    """刪除帳號（不能刪自己 / 不能刪最後一名啟用 admin / 不能被行事曆引用——A1 防 FK 500）"""
    if admin["id"] == user_id:
        raise HTTPException(status_code=400, detail="不能刪除自己")
    conn = get_db()
    try:
        row = _get_user_or_404(conn, user_id)
        if row["role"] == "admin" and row["is_active"] == 1 and _active_admin_count(conn, exclude_id=user_id) == 0:
            raise HTTPException(status_code=400, detail="系統必須保留一名啟用的管理員")
        # A1（2026-08-13）：刪除前檢查行事曆引用——created_by/updated_by/被指派，有引用回 400 不 500
        ref = conn.execute(
            """SELECT
                 (SELECT COUNT(*) FROM appointments WHERE created_by=?) +
                 (SELECT COUNT(*) FROM appointments WHERE updated_by=?) +
                 (SELECT COUNT(*) FROM appointment_assignees WHERE user_id=?) AS cnt""",
            (user_id, user_id, user_id)).fetchone()
        if ref and ref["cnt"] > 0:
            raise HTTPException(status_code=400,
                                detail="該帳號有派工紀錄（新增/編輯/被指派），無法刪除；可先停用帳號")
        # RBAC 稽核：先寫 audit（target 仍存在）再刪除 → FK SET NULL 保留軌跡（稽核 A1）
        _audit(conn, admin["id"], user_id, "delete")
        conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
        conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
        conn.commit()
        return {"ok": True}
    finally:
        conn.close()


# ---------- RBAC 權限管理端點（2026-08-13，設計 §6.2） ----------
@router.get("/permissions")
def list_permissions(admin: dict = Depends(require_perm("user-mgmt"))):
    """權限點清單 + 四角色預設（權限頁顯示來源）"""
    conn = get_db()
    try:
        perms = [dict(r) for r in conn.execute("SELECT key, label, module FROM permissions ORDER BY id").fetchall()]
        role_defaults = {}
        for r in conn.execute(
            """SELECT r.name AS role, p.key AS perm FROM role_permissions rp
               JOIN roles r ON r.id = rp.role_id
               JOIN permissions p ON p.id = rp.permission_id""").fetchall():
            role_defaults.setdefault(r["role"], []).append(r["perm"])
        return {"permissions": perms, "role_defaults": role_defaults}
    finally:
        conn.close()


@router.get("/{user_id}/permissions")
def get_user_permissions_detail(user_id: int, admin: dict = Depends(require_perm("user-mgmt"))):
    """該帳號合成權限詳細清單（權限頁 UI 用）：source = role（跟隨角色）/ override（個人覆蓋）/ locked（強制鎖定）"""
    conn = get_db()
    try:
        row = _get_user_or_404(conn, user_id)
        target_role = row["role"]
        perms = get_user_permissions(conn, user_id)
        overrides = {p["key"]: bool(p["value"]) for p in conn.execute(
            """SELECT p.key, up.value FROM user_permissions up
               JOIN permissions p ON p.id = up.permission_id WHERE up.user_id = ?""", (user_id,)).fetchall()}
        detail = []
        for p in conn.execute("SELECT key, label, module FROM permissions ORDER BY id").fetchall():
            key = p["key"]
            # 鎖定來源判定（與 get_user_permissions 強制規則一致，§7）
            if key == "view" or key == "user-mgmt":
                source = "locked"
            elif key == "change-own-password" and target_role == "admin":
                source = "locked"
            elif key == "svc-type-mgmt" and target_role != "admin":
                source = "locked"
            elif key in overrides:
                source = "override"
            else:
                source = "role"
            detail.append({
                "key": key, "label": p["label"], "module": p["module"],
                "allowed": perms[key], "source": source,
            })
        return {"user_id": user_id, "role": target_role, "permissions": detail}
    finally:
        conn.close()


@router.put("/{user_id}/permissions")
def update_user_permissions(user_id: int, body: UserPermissionsUpdate, admin: dict = Depends(require_perm("user-mgmt"))):
    """設定個人權限覆蓋（開關）——RBAC §6.2/§7 保護規則"""
    if admin["id"] == user_id:
        raise HTTPException(status_code=400, detail="不能修改自己的權限")
    conn = get_db()
    try:
        row = _get_user_or_404(conn, user_id)
        target_role = row["role"]
        # §7.2：目標是唯一啟用 admin → 拒絕任何覆蓋（固定最大權限）
        if target_role == "admin":
            admin_cnt = conn.execute(
                "SELECT COUNT(*) AS c FROM users WHERE role='admin' AND is_active=1"
            ).fetchone()["c"]
            if admin_cnt == 1:
                raise HTTPException(status_code=400, detail="系統唯一管理員，權限固定不可調整")
        perm_ids = {p["key"]: p["id"] for p in conn.execute("SELECT id, key FROM permissions").fetchall()}
        changes = {}
        if body.reset_all:
            conn.execute("DELETE FROM user_permissions WHERE user_id = ?", (user_id,))
            changes["reset_all"] = True
        if body.permissions:
            for key, value in body.permissions.items():
                if key not in perm_ids:
                    raise HTTPException(status_code=400, detail=f"未知權限點: {key}")
                if value not in (0, 1):
                    raise HTTPException(status_code=400, detail=f"權限值只能是 0/1: {key}")
                # 保護規則（§7）
                if key == "view":
                    raise HTTPException(status_code=400, detail="庫存瀏覽為基底權限，不可關閉")
                if key == "user-mgmt":
                    raise HTTPException(status_code=400, detail="使用者管理權限僅管理員角色可持有且不可關閉")
                if key == "change-own-password" and target_role == "admin" and value == 0:
                    raise HTTPException(status_code=400, detail="管理員的自行改密碼權限不可關閉")
                if key == "svc-type-mgmt" and target_role != "admin" and value == 1:
                    raise HTTPException(status_code=400, detail="服務項目管理權限僅管理員角色可持有")
                conn.execute(
                    "INSERT OR REPLACE INTO user_permissions (user_id, permission_id, value, updated_at) VALUES (?, ?, ?, datetime('now'))",
                    (user_id, perm_ids[key], value))
                changes[key] = value
        if not changes:
            return {"ok": True, "permissions": get_user_permissions(conn, user_id)}
        _audit(conn, admin["id"], user_id, "permission_update",
               json.dumps(changes, ensure_ascii=False))
        conn.commit()
        return {"ok": True, "permissions": get_user_permissions(conn, user_id)}
    finally:
        conn.close()


@router.get("/audit")
def list_audit(target_id: Optional[int] = None, limit: int = Query(100, ge=1, le=500),
               admin: dict = Depends(require_perm("user-mgmt"))):
    """帳號操作稽核紀錄（RBAC §9）"""
    conn = get_db()
    try:
        if target_id is not None:
            rows = conn.execute(
                "SELECT * FROM user_audit_log WHERE target_id = ? ORDER BY id DESC LIMIT ?",
                (target_id, limit)).fetchall()
        else:
            rows = conn.execute("SELECT * FROM user_audit_log ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
        return {"logs": [dict(r) for r in rows]}
    finally:
        conn.close()