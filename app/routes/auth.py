# -*- coding: utf-8 -*-
"""
登入相關 API：/api/auth/*
========================
- POST /api/auth/login   帳密登入 → 設定 httpOnly session cookie
- POST /api/auth/logout  登出（刪 cookie + DB session）
- GET  /api/auth/me      前端進站檢查登入狀態

- 需要登入的 API 之外（login 以外）均由 main.py 掛 require_login 上鎖
"""
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel

from app.database import get_db
from app.services.auth import (
    SESSION_DAYS,
    SESSION_COOKIE,
    _check_pw,
    check_ip_rate_limit,
    cleanup_expired,
    clear_ip_fail,
    create_session,
    delete_session,
    dummy_verify,
    authenticate,
    hash_token,
    require_login,
    # session cookie 名稱
    get_session_user,
    get_user_by_username,
    is_locked,
    record_ip_fail,
    update_failed_attempts,
    verify_password,
)
from app.services.auth import hash_password  # noqa: F401 (init_admin 互用)

# auth API 路由（登入/登出/session）
router = APIRouter(prefix="/api/auth", tags=["auth"])


def _client_ip(request: Request) -> str:
    """client IP：X-Forwarded-For 第一段優先（Cloudflare tunnel 管理），無則 fallback 直連 IP"""
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


# ---------- 請求模型 ----------
class LoginRequest(BaseModel):
    username: str
    password: str


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str


class UserOut(BaseModel):
    id: int
    username: str
    display_name: str = ""
    role: str


# ---------- API ----------
@router.post("/login")
def login(body: LoginRequest, request: Request, response: Response):
    """帳密登入：成功 → Set-Cookie httponly session；失敗 401；鎖定 429"""
    # B4：per-IP 失敗 rate limit（在 per-account 鎖定之前擋下大量嘗試）
    ip = _client_ip(request)
    if check_ip_rate_limit(ip):
        raise HTTPException(status_code=429, detail="嘗試次數過多，請稍後再試")

    conn = get_db()
    try:
        cleanup_expired(conn)
        row = get_user_by_username(conn, body.username.strip())
        if row is None:
            dummy_verify(body.password)  # H3a：定時比較，防帳號列舉
            record_ip_fail(ip)           # H3a：不存在帳號也計 rate limit（防帳號探測）
            raise HTTPException(status_code=401, detail="帳號或密碼錯誤")

        if not row["is_active"]:
            raise HTTPException(status_code=403, detail="帳號已被停用，請聯絡管理員")

        if is_locked(row):
            raise HTTPException(status_code=429, detail="嘗試次數過多，請稍後再試")

        ok = verify_password(body.password, row["password_hash"])
        update_failed_attempts(conn, row["id"], success=ok)
        if not ok:
            record_ip_fail(ip)
            raise HTTPException(status_code=401, detail="帳號或密碼錯誤")

        clear_ip_fail(ip)
        token = create_session(conn, row["id"])
    finally:
        conn.close()

    # B5：HTTPS 連線（外網 tunnel）才設 secure flag；本機 HTTP 不設以免登入失效
    response.set_cookie(
        key=SESSION_COOKIE,
        value=token,
        max_age=SESSION_DAYS * 24 * 3600,
        httponly=True,
        samesite="lax",
        secure=(request.url.scheme == "https"),
    )
    return {
        "ok": True,
        "user": {
            "id": row["id"],
            "username": row["username"],
            "display_name": row["display_name"],
            "role": row["role"],
        },
    }


@router.post("/logout")
def logout(request: Request, response: Response):
    """登出：刪 session 記錄 + 清 cookie"""
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        conn = get_db()
        try:
            delete_session(conn, token)
        finally:
            conn.close()
    response.delete_cookie(SESSION_COOKIE)
    return {"ok": True}


@router.get("/me")
def me(request: Request):
    """目前登入者資訊（前端進站檢查用）；v11.2 加密碼過期旗標"""
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise HTTPException(status_code=401, detail="未登入")
    conn = get_db()
    try:
        user = get_session_user(conn, token)
        if user is None:
            raise HTTPException(status_code=401, detail="登入已過期")
        # v11.2：密碼過期旗標（password_updated_at 超過 180 天）
        pw = conn.execute("SELECT password_updated_at FROM users WHERE id = ?", (user["id"],)).fetchone()
        expired = False
        if pw and pw["password_updated_at"]:
            expired = str(pw["password_updated_at"]) < (datetime.now() - timedelta(days=180)).strftime("%Y-%m-%d %H:%M:%S")
        return {"user": {**user, "password_expired": expired}}
    finally:
        conn.close()


@router.put("/password")
def change_my_password(body: ChangePasswordRequest, request: Request, user: dict = Depends(authenticate)):
    """個人改密碼：驗證舊密碼 → 新密碼 policy → 更新 + 清其他 session（保留當前）；viewer 也可改自己的"""
    if body.new_password == body.old_password:
        raise HTTPException(status_code=400, detail="新密碼不能與原密碼相同")
    _check_pw(body.new_password)
    conn = get_db()
    try:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone()
        if row is None or not verify_password(body.old_password, row["password_hash"]):
            raise HTTPException(status_code=400, detail="原密碼錯誤")
        conn.execute(
            "UPDATE users SET password_hash = ?, password_updated_at = datetime('now'), failed_attempts = 0, locked_until = NULL, updated_at = datetime('now') WHERE id = ?",
            (hash_password(body.new_password), user["id"]),
        )
        # 清其他 session（保留當前 token）——改密碼後其他裝置立即登出（B3 模式）
        token = request.cookies.get(SESSION_COOKIE)
        if token:
            conn.execute("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?",
                         (user["id"], hash_token(token)))
        else:
            conn.execute("DELETE FROM sessions WHERE user_id = ?", (user["id"],))
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


@router.post("/password-ack")
def ack_password_expiry(request: Request, user: dict = Depends(authenticate)):
    """按「繼續使用原密碼」→ 重置 180 天計時（帳號層級，跨裝置一致）；viewer 也可按"""
    conn = get_db()
    try:
        conn.execute("UPDATE users SET password_updated_at = datetime('now') WHERE id = ?", (user["id"],))
        conn.commit()
    finally:
        conn.close()
    return {"ok": True, "password_expired": False}