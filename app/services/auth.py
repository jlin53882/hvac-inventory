# -*- coding: utf-8 -*-
"""
登入認證服務層
==============
- hash_password / verify_password：PBKDF2-HMAC-SHA256（標準庫 hashlib，零套件）
- create_session / get_session_user / delete_session：session 生命週期
- get_current_user / get_current_admin：FastAPI dependency（全 API 上鎖用）
- 暴力破解防護：failed_attempts / locked_until

密碼格式：pbkdf2$<iterations>$<salt_hex>$<hash_hex>
Session cookie：前端持 raw token；DB 只存 sha256(token)（外洩不可重放）
"""
import hashlib
import secrets
import sqlite3
import time
from datetime import datetime, timedelta

from fastapi import HTTPException, Request

from app.database import get_db

# ---------- 常數 ----------
PBKDF2_ITERATIONS = 600_000
# session cookie 名稱
SESSION_COOKIE = "hvac_session"
SESSION_DAYS = 7          # session 有效天數
MAX_FAILED = 5            # 連續失敗幾次鎖定
LOCK_MINUTES = 15         # 鎖定幾分鐘

# B4：per-IP 登入失敗 rate limit（補 per-account 鎖定之外的 DoS / 分散嘗試防護）
IP_FAIL_WINDOW_SEC = 60   # 觀察窗（秒）
IP_FAIL_MAX = 10          # 視窗內失敗次數上限（超過 → 429）
# 純 in-memory：單機部署夠用；成功登入即清空該 IP；重啟自動歸零
_ip_fail_times: dict = {}


def check_ip_rate_limit(ip: str) -> bool:
    """該 IP 是否已超過失敗次數上限（True = 應拒絕）"""
    now = time.time()
    times = [t for t in _ip_fail_times.get(ip, []) if now - t < IP_FAIL_WINDOW_SEC]
    _ip_fail_times[ip] = times
    return len(times) >= IP_FAIL_MAX


def record_ip_fail(ip: str) -> None:
    """記錄一次該 IP 的登入失敗"""
    _ip_fail_times.setdefault(ip, []).append(time.time())


def clear_ip_fail(ip: str) -> None:
    """登入成功 → 清空該 IP 的失敗記錄"""
    _ip_fail_times.pop(ip, None)

# ---------- 密碼處理 ----------


def hash_password(password: str) -> str:
    """密碼 → pbkdf2$600000$salt$hash 字串（每次 salt 隨機）"""
    salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), PBKDF2_ITERATIONS)
    return f"pbkdf2${PBKDF2_ITERATIONS}${salt}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    """驗證密碼是否與 stored 相符（演算法/次數從 stored 前綴讀，未來可升級）"""
    try:
        algo, iters, salt, hash_hex = stored.split("$")
        if algo != "pbkdf2":
            return False
        dk = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), int(iters))
        return secrets.compare_digest(dk.hex(), hash_hex)
    except (ValueError, TypeError):
        return False


def hash_token(token: str) -> str:
    """session token → sha256 hex（DB 只存這個）"""
    return hashlib.sha256(token.encode()).hexdigest()


# ---------- users 表操作 ----------


def get_user_by_username(conn: sqlite3.Connection, username: str):
    """依帳號名找使用者（未找到回 None）"""
    return conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()


def init_admin_if_missing(conn: sqlite3.Connection) -> None:
    """首次啟動自動建立 admin/admin123（密碼需登入後修改），已存在則跳過"""
    row = conn.execute("SELECT COUNT(*) AS c FROM users").fetchone()
    if row["c"] > 0:
        return
    conn.execute(
        "INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)",
        ("admin", hash_password("admin123"), "管理員", "admin"),
    )
    conn.commit()
    print("[auth] 已建立初始帳號 admin（密碼 admin123，請登入後修改）")


def update_failed_attempts(conn: sqlite3.Connection, user_id: int, success: bool) -> None:
    """登入失敗 +1 並在達標時加鎖；成功則歸零"""
    if success:
        conn.execute(
            "UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?", (user_id,)
        )
    else:
        conn.execute(
            """UPDATE users
               SET failed_attempts = failed_attempts + 1,
                   locked_until = CASE WHEN failed_attempts + 1 >= ? THEN datetime('now', '+' || ? || ' minutes') ELSE locked_until END
               WHERE id = ?""",
            (MAX_FAILED, LOCK_MINUTES, user_id),
        )
    conn.commit()


def is_locked(row) -> bool:
    """檢查是否在鎖定期間（locked_until 未來時間 = 鎖中）"""
    if not row["locked_until"]:
        return False
    return str(row["locked_until"]) > datetime.now().strftime("%Y-%m-%d %H:%M:%S")


# ---------- session 生命週期 ----------


def create_session(conn: sqlite3.Connection, user_id: int) -> str:
    """建立 session：回傳給瀏覽器的 token（DB 只存 hash）"""
    token = secrets.token_hex(32)
    conn.execute(
        "INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)",
        (user_id, hash_token(token), datetime.now() + timedelta(days=SESSION_DAYS)),
    )
    conn.commit()
    return token


def delete_session(conn: sqlite3.Connection, token: str) -> None:
    """登出：刪除 session 記錄"""
    conn.execute("DELETE FROM sessions WHERE token_hash = ?", (hash_token(token),))
    conn.commit()


def cleanup_expired(conn: sqlite3.Connection) -> None:
    """清理過期 session（啟動時與登入時呼叫）"""
    conn.execute("DELETE FROM sessions WHERE expires_at < datetime('now')")
    conn.commit()


def get_session_user(conn: sqlite3.Connection, token: str):
    """依 token 查 session JOIN user；過期/停用/不存在回 None"""
    if not token:
        return None
    row = conn.execute(
        """SELECT u.id, u.username, u.display_name, u.role, u.is_active
           FROM sessions s JOIN users u ON u.id = s.user_id
           WHERE s.token_hash = ? AND s.expires_at >= datetime('now')""",
        (hash_token(token),),
    ).fetchone()
    if row is None or not row["is_active"]:
        return None
    return {"id": row["id"], "username": row["username"], "display_name": row["display_name"], "role": row["role"]}


# ---------- FastAPI dependency ----------


def require_login(request: Request) -> dict:
    """FastAPI dependency：所有 /api/* 都要過這關；未登入 401"""
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise HTTPException(status_code=401, detail="未登入")
    conn = get_db()
    try:
        user = get_session_user(conn, token)
    finally:
        conn.close()
    if user is None:
        raise HTTPException(status_code=401, detail="登入已過期，請重新登入")
    # viewer 角色單點封鎖：看得見一切 GET，所有寫入（POST/PUT/PATCH/DELETE）一律 403
    # 放在 require_login 內 → 全站現在與未來的寫入端點自動被擋，不會有「新端點忘了鎖」的漏洞
    if user["role"] == "viewer" and request.method in ("POST", "PUT", "PATCH", "DELETE"):
        raise HTTPException(status_code=403, detail="檢視者僅能檢視，無法修改資料")
    return user


def require_admin(request: Request) -> dict:
    """require_login + 強制 admin 角色（使用者管理 API 用）"""
    user = require_login(request)
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="需要管理員權限")
    return user