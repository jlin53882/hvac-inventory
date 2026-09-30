# -*- coding: utf-8 -*-
"""
每日簽名報表路由
================
- POST   /api/signed-reports              上傳（multipart，PDF/PNG/JPG/GIF/WebP）
- GET    /api/signed-reports              列表（日期區間 + 關鍵字 + 分頁）
- GET    /api/signed-reports/{id}/preview 線上預覽（登入保護，inline）
- GET    /api/signed-reports/{id}/download 下載原檔
- PATCH  /api/signed-reports/{id}         編輯日期/檔案/上傳人/備註（能力 + owner/global scope）
- DELETE /api/signed-reports/{id}         刪除（能力 + owner/global scope）

儲存：static/uploads/signed_reports/YYYY-MM/{id}_{uuid8}_{safeName}
端點實作與報價單上傳共用，見 app/services/upload_resource.py；這裡只放本資源專屬的設定與權限規則。
"""
from app.models import SignedReportUpdate
from app.services.auth import require_perm
from app.services.safety import has_perm
from app.services.upload_resource import UploadResource, build_upload_router


def _report_capabilities(conn, row, user):
    """Return final action capabilities: action permission AND owner/global scope."""
    is_owner = row["uploader_user_id"] == user["id"]
    # Temporary compatibility: this legacy key remains the cross-owner global scope.
    has_global_scope = has_perm(conn, user, "signed-report-delete-all")
    in_scope = has_global_scope or is_owner
    return {
        "can_edit": bool(has_perm(conn, user, "signed-report-edit") and in_scope),
        "can_delete": bool(has_perm(conn, user, "signed-report-delete") and in_scope),
    }


RESOURCE = UploadResource(
    table="daily_signed_reports",
    asset_key="signed_report",
    url_prefix="/api/signed-reports",
    storage_dir="signed_reports",
    label="簽名報表",
    capabilities=_report_capabilities,
    upload_dependency=require_perm("signed-report-upload"),
    update_model=SignedReportUpdate,
    edit_denied_msg="缺少簽名報表編輯權限或不在可編輯範圍",
    delete_denied_msg="缺少簽名報表刪除權限或不在可刪除範圍",
)

router = build_upload_router(RESOURCE)
