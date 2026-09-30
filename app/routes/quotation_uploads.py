# -*- coding: utf-8 -*-
"""
報價單上傳路由
================
- POST   /api/quotation-uploads              上傳（multipart，任意格式）
- GET    /api/quotation-uploads              列表（日期區間 + 關鍵字 + 分頁）
- GET    /api/quotation-uploads/{id}/preview 線上預覽（登入保護，inline）
- GET    /api/quotation-uploads/{id}/download 下載原檔
- PATCH  /api/quotation-uploads/{id}         編輯日期/檔案/上傳人/備註（能力 + owner/global scope）
- DELETE /api/quotation-uploads/{id}         刪除（能力 + owner/global scope）

儲存：static/uploads/quotation_uploads/YYYY-MM/{id}_{uuid8}_{safeName}
端點實作與簽名報表共用，見 app/services/upload_resource.py；這裡只放本資源專屬的設定與權限規則。
"""
from app.models import SignedReportUpdate
from app.services.auth import require_login
from app.services.safety import has_perm
from app.services.upload_resource import UploadResource, build_upload_router


def _upload_capabilities(conn, row, user):
    """Return final owner/global mutation capabilities for quotation uploads."""
    is_owner = row["uploader_user_id"] == user["id"]
    has_global_scope = has_perm(conn, user, "quotation-upload-manage-all")
    in_scope = has_global_scope or is_owner
    can_manage = has_perm(conn, user, "quotation-upload-manage") and in_scope
    return {
        "can_edit": bool(can_manage),
        "can_delete": bool(can_manage),
    }


RESOURCE = UploadResource(
    table="quotation_uploads",
    asset_key="quotation_upload",
    url_prefix="/api/quotation-uploads",
    storage_dir="quotation_uploads",
    label="報價單上傳",
    capabilities=_upload_capabilities,
    upload_dependency=require_login,  # 實際由 main.py require_login 注入，此處僅取 user
    update_model=SignedReportUpdate,
    edit_denied_msg="缺少報價單上傳管理權限或不在可編輯範圍",
    delete_denied_msg="缺少報價單上傳管理權限或不在可刪除範圍",
)

router = build_upload_router(RESOURCE)
