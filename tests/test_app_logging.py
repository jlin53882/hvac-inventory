# -*- coding: utf-8 -*-
"""集中式 server logging 回歸測試。"""
import logging

import pytest
from fastapi.testclient import TestClient

import app.database as app_db
import app.services.app_log as app_log
import main as app_main


def _remove_hvac_handlers():
    root = logging.getLogger()
    for handler in list(root.handlers):
        if getattr(handler, "_hvac_handler", False):
            root.removeHandler(handler)
            handler.close()


@pytest.fixture()
def logging_env(tmp_path, monkeypatch):
    _remove_hvac_handlers()
    monkeypatch.setattr(app_log, "_LOG_BASE", str(tmp_path / "logs"))
    monkeypatch.setattr(app_db, "DB_PATH", str(tmp_path / "inventory.db"))
    yield tmp_path / "logs"
    _remove_hvac_handlers()


def test_setup_logging_writes_server_and_error_logs(logging_env):
    app_log.setup_logging()
    logger = logging.getLogger("hvac.test")
    logger.info("server-log-probe")
    logger.error("error-log-probe")
    for handler in logging.getLogger().handlers:
        if getattr(handler, "_hvac_handler", False):
            handler.flush()

    server_log = next(logging_env.glob("*/server.log"))
    error_log = next(logging_env.glob("*/error.log"))
    assert "server-log-probe" in server_log.read_text(encoding="utf-8")
    assert "error-log-probe" in error_log.read_text(encoding="utf-8")


def test_request_logging_records_access_and_request_id(logging_env):
    with TestClient(app_main.app) as client:
        response = client.get("/health")

    assert response.status_code == 200
    request_id = response.headers.get("x-request-id")
    assert request_id and len(request_id) == 16
    access_log = next(logging_env.glob("*/access.log"))
    text = access_log.read_text(encoding="utf-8")
    assert "GET /health status=200" in text
    assert f"request_id={request_id}" in text


def test_daily_dir_handler_switches_folder_when_day_changes(tmp_path):
    """server 連續執行跨日時，log 必須寫進新日期資料夾（原本固定寫在啟動日）。"""
    current = {"dir": tmp_path / "0930"}
    rolled = []
    handler = app_log.DailyDirFileHandler("server.log", lambda: current["dir"], on_rollover=rolled.append)
    handler.setFormatter(logging.Formatter("%(message)s"))
    logger = logging.getLogger("hvac.test.rollover")
    logger.addHandler(handler)
    logger.propagate = False
    try:
        logger.warning("day-one")
        current["dir"] = tmp_path / "1001"
        logger.warning("day-two")
    finally:
        logger.removeHandler(handler)
        handler.close()
    assert (tmp_path / "0930" / "server.log").read_text(encoding="utf-8").strip() == "day-one"
    assert (tmp_path / "1001" / "server.log").read_text(encoding="utf-8").strip() == "day-two"
    assert rolled == [tmp_path / "1001"]


def test_cleanup_old_logs_keeps_recent_and_unrelated_entries(tmp_path):
    import os
    import time

    now = time.time()
    old = now - (app_log.LOG_RETENTION_DAYS + 1) * 86400
    recent = now - 2 * 86400
    for name, mtime in (("0801", old), ("0920", recent)):
        folder = tmp_path / name
        folder.mkdir()
        log = folder / "server.log"
        log.write_text("x", encoding="utf-8")
        os.utime(log, (mtime, mtime))
    (tmp_path / "test").mkdir()                        # pytest 專用資料夾不動
    archive = tmp_path / "archive_202607.tar.gz"
    archive.write_bytes(b"x")
    os.utime(archive, (old, old))
    removed = app_log.cleanup_old_logs(tmp_path, now=now)
    assert sorted(removed) == ["0801", "archive_202607.tar.gz"]
    assert (tmp_path / "0920").exists() and (tmp_path / "test").exists()


def test_server_log_does_not_duplicate_access_lines(logging_env):
    with TestClient(app_main.app) as client:
        assert client.get("/health").status_code == 200
    for handler in logging.getLogger().handlers:
        if getattr(handler, "_hvac_handler", False):
            handler.flush()
    server_text = next(logging_env.glob("*/server.log")).read_text(encoding="utf-8")
    access_text = next(logging_env.glob("*/access.log")).read_text(encoding="utf-8")
    assert "GET /health status=200" in access_text
    assert "GET /health status=200" not in server_text
