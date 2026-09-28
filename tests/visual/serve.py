# -*- coding: utf-8 -*-
"""Visual 測試用伺服器（子行程啟動，與正式 inventory.db / uploads 完全隔離）。

用法（由 harness.start_server 呼叫，不需手動執行）：
    python tests/visual/serve.py --db <path> --uploads <dir> --port <port> --token-file <path>

流程：切 DB_PATH / UPLOAD_DIR → init_db → 建 admin → 直接建立 session（省 PBKDF2 登入）
→ cookie 名稱與 token 以 JSON 寫入 token-file → uvicorn 前景執行，直到父行程終止。
"""
import argparse
import json
import os
import sys

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, BASE_DIR)


def main() -> None:
    """解析參數、準備隔離 DB 與 session，然後啟動 uvicorn。"""
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", required=True)
    parser.add_argument("--uploads", required=True)
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--token-file", required=True)
    args = parser.parse_args()

    import app.config as app_config
    import app.database as app_db

    app_db.DB_PATH = args.db
    app_config.UPLOAD_DIR = args.uploads
    os.makedirs(args.uploads, exist_ok=True)
    app_db.init_db()

    from app.services.auth import SESSION_COOKIE, create_session, init_admin_if_missing

    conn = app_db.get_db()
    try:
        init_admin_if_missing(conn)
        admin_id = conn.execute("SELECT id FROM users WHERE username='admin'").fetchone()["id"]
        token = create_session(conn, admin_id)
    finally:
        conn.close()
    with open(args.token_file, "w", encoding="utf-8") as fh:
        json.dump({"cookie": SESSION_COOKIE, "token": token}, fh)

    import uvicorn

    import main as app_main

    uvicorn.run(app_main.app, host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
