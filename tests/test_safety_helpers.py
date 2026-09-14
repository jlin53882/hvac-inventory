# -*- coding: utf-8 -*-
"""共用安全 helper 單元測試（2026-09-12 收攏：export/report/quotations/
signed_reports/quotation_uploads/petty_cash 同語意私有函式的唯一真源）。

測的是 app/services/safety.py 本體；各舊呼叫端的行為回歸由既有
test_main / test_signed_reports / test_quotation_uploads / test_petty_cash 覆蓋。
"""
import pytest
from fastapi import HTTPException

import app.database as app_db
from app.services.auth import init_admin_if_missing
from app.services.safety import (
    XLSX_MIME,
    excel_safe,
    has_perm,
    parse_ymd,
    safe_download_name,
    xlsx_download,
)


@pytest.mark.parametrize(("given", "expected"), [
    ("=1+1", "'=1+1"),
    ("+cmd", "'+cmd"),
    ("-2", "'-2"),
    ("@mention", "'@mention"),
    ("正常文字", "正常文字"),
    ("  =開頭空白不算", "  =開頭空白不算"),
    ("", ""),
    (123, 123),
    (12.5, 12.5),
    (None, None),
])
def test_excel_safe_matrix(given, expected):
    assert excel_safe(given) == expected


@pytest.mark.parametrize(("given", "expected"), [
    ("daily.pdf", "daily.pdf"),
    ("零用金-資材0826-0925.xlsx", "零用金-資材0826-0925.xlsx"),
    ("../../etc/passwd", "passwd"),
    ("a/b\\c.pdf", "c.pdf"),
    ("=cmd.xlsx", "_cmd.xlsx"),
    (".hidden", "_hidden"),
    ("-dash.pdf", "_dash.pdf"),
    ("a b@c.pdf", "a_b_c.pdf"),
    ("", "file"),
    ("   ", "file"),
])
def test_safe_download_name_matrix(given, expected):
    assert safe_download_name(given) == expected


def test_safe_download_name_truncates_to_120():
    assert len(safe_download_name("a" * 200 + ".pdf")) == 120


def test_parse_ymd_valid():
    assert parse_ymd("2026-09-25") == "2026-09-25"


@pytest.mark.parametrize("bad", ["2026/09/25", "09-25", "", None, "2026-13-01"])
def test_parse_ymd_invalid_400(bad):
    with pytest.raises(HTTPException) as exc_info:
        parse_ymd(bad)
    assert exc_info.value.status_code == 400


def test_parse_ymd_label_in_message():
    with pytest.raises(HTTPException) as exc_info:
        parse_ymd("bad", "開始日期")
    assert exc_info.value.detail == "開始日期格式需 YYYY-MM-DD"


def test_xlsx_download_headers():
    resp = xlsx_download(b"fake-bytes", "零用金-資材0826-0925.xlsx")
    assert resp.media_type == XLSX_MIME
    assert resp.body == b"fake-bytes"
    disp = resp.headers["content-disposition"]
    assert "filename*=UTF-8''" in disp
    assert "%E9%9B%B6%E7%94%A8%E9%87%91" in disp  # 零用金 URL 編碼
    assert "/" not in disp.split("filename*=")[1]


@pytest.fixture()
def safety_db(tmp_path, monkeypatch):
    test_db = tmp_path / "test_safety.db"
    monkeypatch.setattr(app_db, "DB_PATH", str(test_db))
    app_db.init_db()
    conn = app_db.get_db()
    try:
        init_admin_if_missing(conn)
        conn.execute(
            "INSERT INTO users (username, password_hash, display_name, role)"
            " VALUES ('sarah', 'x', 'sarah', 'user')"
        )
        conn.commit()
        admin_id = conn.execute(
            "SELECT id FROM users WHERE username='admin'").fetchone()["id"]
        user_id = conn.execute(
            "SELECT id FROM users WHERE username='sarah'").fetchone()["id"]
    finally:
        conn.close()
    conn = app_db.get_db()
    try:
        yield conn, {"id": admin_id}, {"id": user_id}
    finally:
        conn.close()


def test_has_perm_matrix(safety_db):
    conn, admin, user = safety_db
    assert has_perm(conn, admin, "petty-cash-delete-all") is True
    assert has_perm(conn, admin, "signed-report-delete-all") is True
    assert has_perm(conn, user, "petty-cash-delete-all") is False
    assert has_perm(conn, user, "view") is True
