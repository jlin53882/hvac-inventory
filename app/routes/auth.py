# -*- coding: utf-8 -*-
"""
登入相關 API：/api/auth/*
========================
- POST /api/auth/login   帳密登入 → 設定 httpOnly session cookie
- POST /api/auth/logout  登出（刪 cookie + DB session）
- GET  /api/auth/me      前端進站檢查登入狀態

- 需要登入的 API 之外（login 以外）均由 main.py 掛 require_login 上鎖
"""
from datetime import datetime

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel

from app.database import get_db
from app.services.auth import (
    SESSION_DAYS,
    SESSION_COOKIE,
    cleanup_expired,
    create_session,
    delete_session,
    get_session_user,
    get_user_by_username,
    is_locked,
    update_failed_attempts,
    verify_password,
)
from app.services.auth import hash_password  # noqa: F401 (init_admin 互用)

router = APIRouter(prefix="/api/auth", tags=["auth"])


# ---------- 請求模型 ----------
class LoginRequest(BaseModel):
    username: str
    password: str


class UserOut(BaseModel):
    id: int
    username: str
    display_name: str = ""
    role: str


# ---------- API ----------
@router.post("/login")
def login(body: LoginRequest, response: Response):
    """帳密登入：成功 → Set-Cookie httponly session；失敗 401；鎖定 429"""
    conn = get_db()
    try:
        cleanup_expired(conn)
        row = get_user_by_username(conn, body.username.strip())
        if row is None:
            raise HTTPException(status_code=401, detail="帳號或密碼錯誤")

        if not row["is_active"]:
            raise HTTPException(status_code=403, detail="帳號已被停用，請聯絡管理員")

        if is_locked(row):
            raise HTTPException(status_code=429, detail="嘗試次數過多，請稍後再試")

        ok = verify_password(body.password, row["password_hash"])
        update_failed_attempts(conn, row["id"], success=ok)
        if not ok:
            raise HTTPException(status_code=401, detail="帳號或密碼錯誤")

        token = create_session(conn, row["id"])
    finally:
        conn.close()

    response.set_cookie(
        key=SESSION_COOKIE,
        value=token,
        max_age=SESSION_DAYS * 24 * 3600,
        httponly=True,
        samesite="lax",
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
    """目前登入者資訊（前端進站檢查用）"""
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise HTTPException(status_code=401, detail="未登入")
    conn = get_db()
    try:
        user = get_session_user(conn, token)
    finally:
        conn.close()
    if user is None:
        raise HTTPException(status_code=401, detail="登入已過期")
    return {"user": user}