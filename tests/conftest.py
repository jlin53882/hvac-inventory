# -*- coding: utf-8 -*-
"""全測試共用 fixture。

- _reset_process_globals（autouse）：process 內的可變全域狀態不得在測試之間外洩。
  目前重設：登入失敗 IP 計數、照片目錄快取。新增這類全域時請一併加在這裡，
  不要再讓各測試檔各自手動 reset。
- isolated_db：把 DB 指向 tmp_path，取代各檔案重複的 monkeypatch DB_PATH。
  （既有測試檔尚未遷移；新測試請直接用它。）
"""
import os
from pathlib import Path

import pytest

# 必須在任何 `import app.*` 之前設定：測試的 server/gcal log 一律寫進 logs/test，不污染正式 logs/。
# （conftest 在收集測試模組之前載入；已由外部指定 HVAC_LOG_DIR 時尊重外部設定。）
os.environ.setdefault("HVAC_LOG_DIR", str(Path(__file__).resolve().parent.parent / "logs" / "test"))


@pytest.fixture(autouse=True)
def _reset_process_globals():
    from app.services import auth, photo_store

    with auth._ip_fail_lock:
        auth._ip_fail_times.clear()
    photo_store.invalidate_photo_ids_cache()
    yield


@pytest.fixture()
def isolated_db(tmp_path, monkeypatch):
    """隔離的空 SQLite 檔（尚未建表）；回傳其路徑字串。"""
    import app.database as app_db

    path = str(tmp_path / "test.db")
    monkeypatch.setattr(app_db, "DB_PATH", path)
    return path
