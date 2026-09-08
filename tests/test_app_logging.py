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
