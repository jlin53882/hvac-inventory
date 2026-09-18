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
import re
import secrets
import sqlite3
import time
from datetime import datetime, timedelta

from fastapi import Depends, HTTPException, Request

from app.database import get_db
from app.services.app_log import get_logger

logger = get_logger(__name__)

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


_DUMMY_HASH = None


def dummy_verify(password: str) -> None:
    """帳號不存在時也跑相同成本 PBKDF2（防 timing 列舉）；結果恆 False"""
    global _DUMMY_HASH
    if _DUMMY_HASH is None:
        _DUMMY_HASH = hash_password("dummy-placeholder")
    verify_password(password, _DUMMY_HASH)


def hash_token(token: str) -> str:
    """session token → sha256 hex（DB 只存這個）"""
    return hashlib.sha256(token.encode()).hexdigest()


def _check_pw(pw: str):
    """密碼 policy（B2）：至少 8 碼，且含大寫 / 小寫 / 數字（users.py 與 auth.py 共用）"""
    if len(pw) < 8:
        raise HTTPException(status_code=400, detail="密碼至少 8 碼")
    if not re.search(r"[A-Z]", pw):
        raise HTTPException(status_code=400, detail="密碼需包含至少一個大寫字母")
    if not re.search(r"[a-z]", pw):
        raise HTTPException(status_code=400, detail="密碼需包含至少一個小寫字母")
    if not re.search(r"\d", pw):
        raise HTTPException(status_code=400, detail="密碼需包含至少一個數字")


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
        "INSERT INTO users (username, password_hash, display_name, role, password_updated_at) VALUES (?, ?, ?, ?, datetime('now'))",
        ("admin", hash_password("admin123"), "管理員", "admin"),
    )
    conn.commit()
    logger.info("[auth] 已建立初始帳號 admin（密碼 admin123，請登入後修改）")


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
    """依 token 查 session JOIN user；過期/停用/不存在回 None
    RBAC（2026-08-13）：回傳含 permissions（合成權限，每次請求即時重算）"""
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
    return {
        "id": row["id"],
        "username": row["username"],
        "display_name": row["display_name"],
        "role": row["role"],
        "permissions": get_user_permissions(conn, row["id"]),
    }


def get_user_permissions(conn: sqlite3.Connection, user_id: int) -> dict:
    """合成使用者權限：角色預設 + 個人覆蓋 + 強制規則 → {key: bool}
    與 docs/RBAC-帳號權限系統-設計文件 §6.3/§7 一致：
    - view：全角色恆 true（基底權限，不可關閉——§7.5）
    - user-mgmt：僅 admin 角色可持有（非 admin 強制 false——§7.4）；admin 恆 true（§7.7）
    - change-own-password：admin 恆 true（§7.6）
    - svc-type-mgmt：非 admin 不可開（維持角色語意——§7.8）
    """
    row = conn.execute("SELECT id, role FROM users WHERE id = ?", (user_id,)).fetchone()
    if row is None:
        return {}
    role = row["role"]
    # §7.2：唯一啟用 admin → 全權限強制 true（固定最大權限，防 admin 互覆蓋後鎖死唯一管理員）
    if role == "admin":
        admin_cnt = conn.execute(
            "SELECT COUNT(*) AS c FROM users WHERE role='admin' AND is_active=1"
        ).fetchone()["c"]
        if admin_cnt == 1:
            return {p["key"]: True for p in conn.execute("SELECT key FROM permissions").fetchall()}
    # 16 權限點全 false 起底（以 permissions 表為權威清單）
    perms = {p["key"]: False for p in conn.execute("SELECT key FROM permissions").fetchall()}
    # 角色預設（role_permissions）
    for p in conn.execute(
        """SELECT p.key FROM role_permissions rp
           JOIN permissions p ON p.id = rp.permission_id
           JOIN roles r ON r.id = rp.role_id
           WHERE r.name = ?""", (role,)).fetchall():
        perms[p["key"]] = True
    # 個人覆蓋（user_permissions，三態：無列 = 跟隨角色）
    for p in conn.execute(
        """SELECT p.key, up.value FROM user_permissions up
           JOIN permissions p ON p.id = up.permission_id
           WHERE up.user_id = ?""", (user_id,)).fetchall():
        perms[p["key"]] = bool(p["value"])
    # 強制規則（覆蓋無效）
    perms["view"] = True
    if role == "admin":
        perms["user-mgmt"] = True
        perms["change-own-password"] = True
    else:
        perms["user-mgmt"] = False
        perms["svc-type-mgmt"] = False
        perms["unit-mgmt"] = False
    return perms


# ---------- FastAPI dependency ----------


def authenticate(request: Request) -> dict:
    """純身份驗證（無角色方法封鎖）：token → user；自我身份操作（改密碼/過期 ack）用"""
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
    return user


def require_login(request: Request) -> dict:
    """FastAPI dependency：所有 /api/* 都要過這關；未登入 401。
    RBAC（2026-08-13）：viewer/tech 的 method 級封鎖已移除——
    改由各端點 Depends(require_perm(key)) 權限驅動（設計 §6.3）。
    user dict 含 permissions（合成權限，即時生效）。
    """
    return authenticate(request)


def require_perm(perm_key: str):
    """權限守衛（RBAC，設計 §6.3）：先過 require_login，再檢查合成權限含 perm_key。
    用法：Depends(require_perm("user-mgmt"))"""
    def dep(user: dict = Depends(require_login)):
        if not user.get("permissions", {}).get(perm_key):
            raise HTTPException(status_code=403, detail="無此權限")
        return user
    return dep


def require_db_perm(perm_key: str):
    """DB-backed 權限守衛：避免依賴可能已快取的 user permissions。

    用於需要撤權立即生效的敏感資源；權限在 dependency 執行時重新從
    users/roles/user_permissions 合成，不能由 session payload 或前端 flags 決定。
    """
    def dep(user: dict = Depends(require_login)):
        conn = get_db()
        try:
            allowed = bool(get_user_permissions(conn, user["id"]).get(perm_key))
        finally:
            conn.close()
        if not allowed:
            raise HTTPException(status_code=403, detail="無此權限")
        return user
    return dep
