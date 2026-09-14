# -*- coding: utf-8 -*-
"""
共用安全小 helper（2026-09-12 收攏）
====================================
零用金月報實作時發現同語意私有函式散落多檔（_safe×5、檔名清理×3、
_can_delete_all×3、日期驗證×2、xlsx 下載×5），改一處漏一處。
本模組為唯一真源；各 route/service 只 import，勿再私自重寫一份。

- excel_safe：Excel 公式注入防護（沿用 export.py 語意）
- safe_download_name：下載/上傳檔名清理（沿用 signed_reports._safe_name 語意）
- parse_ymd：YYYY-MM-DD 驗證（沿用 quotations._validate_date 語意）
- xlsx_download：xlsx 記憶體下載回應（RFC 5987 中文檔名）
- has_perm：單一權限點判斷（各報表 _can_delete_all 的參數化版）
"""
import datetime
import os
import re
from urllib.parse import quote

from fastapi import HTTPException
from fastapi.responses import Response

from app.services.auth import get_user_permissions

XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def excel_safe(value):
    """公式注入防護：= + - @ 開頭的字串加撇號，避免被 Excel 當公式執行。"""
    if isinstance(value, str) and value.startswith(("=", "+", "-", "@")):
        return "'" + value
    return value


def safe_download_name(name: str) -> str:
    """檔名清理：去路徑、只留中英文數字._-、其餘轉 _、防前綴、限 120 字。"""
    name = os.path.basename((name or "file").strip()) or "file"
    # 保留中英文、數字、._-，其餘轉 _
    name = re.sub(r"[^0-9A-Za-z\u4e00-\u9fa5._-]", "_", name)
    # 防公式注入前綴與隱藏檔
    if name[:1] in (".", "-", "=", "+", "@"):
        name = "_" + name[1:]
    return name[:120] or "file"


def parse_ymd(value: str, label: str = "日期") -> str:
    """驗證 YYYY-MM-DD，回傳 isoformat；不合法 → 400（不 500）。"""
    try:
        return datetime.date.fromisoformat(value).isoformat()
    except (TypeError, ValueError):
        raise HTTPException(400, f"{label}格式需 YYYY-MM-DD")


def xlsx_download(data: bytes, filename: str) -> Response:
    """xlsx 記憶體下載回應（不寫磁碟；中文檔名走 RFC 5987 編碼）。"""
    return Response(
        data,
        media_type=XLSX_MIME,
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"},
    )


def has_perm(conn, user: dict, perm_key: str) -> bool:
    """單一權限點判斷（報表全域刪除等本人-or-全權模式的共用半邊）。"""
    return bool(get_user_permissions(conn, user["id"]).get(perm_key))
