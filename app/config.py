# -*- coding: utf-8 -*-
"""
路徑與環境設定
==============
集中管理所有路徑常數與環境變數讀取，避免各模組重複計算或直接碰 os.environ。
環境變數從專案根的 .env 讀取（零套件依賴）；已存在的環境變數優先，不被 .env 覆蓋。

可用環境變數：
- DISCORD_WEBHOOK_URL / GCAL_SYNC_WEBHOOK_URL / GCAL_SYNC_THREAD_ID：Discord 通知
- HVAC_LOG_DIR：log 根目錄（預設 <專案>/logs；測試由 tests/conftest.py 指向 logs/test）
- HVAC_FRONTEND_SOURCE=1：前端直接載入原始 ES modules（開發時不必每次重建 dist）

import 本模組不再建立任何目錄；需要時由 ensure_runtime_dirs()（lifespan 呼叫）建立。
"""
import os
import re

# 專案根目錄
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


# ---------- .env 讀取（零套件依賴）----------
_INLINE_COMMENT_RE = re.compile(r"\s#")


def parse_env_text(text: str) -> dict[str, str]:
    """解析 .env 內容 → {key: value}。

    支援：``KEY=value``、``export KEY=value``、單/雙引號包住的值（去引號，內含 # 保留）、
    行內註解（引號之外、空白 + ``#`` 之後；引號值後面接註解也可，例如 ``A="x y" # 備註``）。
    未加引號值裡的 ``#``（如 URL fragment）若前面沒有空白則保留。
    跳過空行、``#`` 註解行、無 ``=`` 或空 key 的行。
    """
    result: dict[str, str] = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export "):].lstrip()
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        if not key:
            continue
        result[key] = _parse_env_value(value.strip())
    return result


def _parse_env_value(value: str) -> str:
    """去掉引號之外的行內註解，再去掉外層成對引號。

    以引號開頭且有收尾引號時，只從收尾引號之後找註解（引號內的 # 一律保留）；
    否則從頭找。引號沒收尾（例如 ``"abc``）維持原樣。
    """
    search_from = 0
    if value[:1] in ("'", '"'):
        close = value.find(value[0], 1)
        if close != -1:
            search_from = close + 1
    match = _INLINE_COMMENT_RE.search(value, search_from)
    if match:
        value = value[:match.start()].rstrip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        value = value[1:-1]
    return value


def load_env_file(path: str, environ=None) -> list[str]:
    """讀取 .env 到 environ（預設 os.environ）；已存在的變數不覆蓋。回傳實際寫入的 key。檔案不存在 → 空清單。"""
    environ = os.environ if environ is None else environ
    try:
        with open(path, encoding="utf-8-sig") as handle:
            parsed = parse_env_text(handle.read())
    except OSError:
        return []
    applied = []
    for key, value in parsed.items():
        if key not in environ:
            environ[key] = value
            applied.append(key)
    return applied


load_env_file(os.path.join(BASE_DIR, ".env"))

# ---------- 路徑設定 ----------
# SQLite 資料庫檔路徑
DB_PATH = os.path.join(BASE_DIR, "inventory.db")
# 前端靜態資源目錄
STATIC_DIR = os.path.join(BASE_DIR, "static")
UPLOAD_DIR = os.path.join(STATIC_DIR, "uploads")  # 品項照片（檔名 = <item_id>.jpg）
# log 根目錄（app_log / gcal_log 共用）
LOG_BASE = os.environ.get("HVAC_LOG_DIR") or os.path.join(BASE_DIR, "logs")


def ensure_runtime_dirs() -> None:
    """建立執行期需要的目錄（由 lifespan 呼叫；import config 不再有目錄副作用）。"""
    os.makedirs(STATIC_DIR, exist_ok=True)
    os.makedirs(UPLOAD_DIR, exist_ok=True)


def use_frontend_source() -> bool:
    """是否直接載入前端原始 ES modules（HVAC_FRONTEND_SOURCE=1）。每次呼叫才讀環境變數，測試可 monkeypatch.setenv。"""
    return os.environ.get("HVAC_FRONTEND_SOURCE") == "1"


# ---------- Discord Webhook ----------
DISCORD_WEBHOOK_URL = os.environ.get("DISCORD_WEBHOOK_URL", "")
GCAL_SYNC_WEBHOOK_URL = os.environ.get("GCAL_SYNC_WEBHOOK_URL", "")
GCAL_SYNC_THREAD_ID = os.environ.get("GCAL_SYNC_THREAD_ID", "")
