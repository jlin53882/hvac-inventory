# -*- coding: utf-8 -*-
"""
上傳政策（副檔名白名單 / 大小上限）
====================================
原本 photos / work_progress / signed_reports / quotation_uploads 各自定義一份，
改一處容易漏另一處；統一放這裡，全部用不可變型別避免被執行期意外修改。
"""

# 純圖片上傳（品項/整組照片、每日工作進度照片）
IMAGE_UPLOAD_EXTS = frozenset({".jpg", ".jpeg", ".png", ".webp"})

# 文件型上傳（每日簽名報表、報價單上傳）：PDF + 圖片；副檔名白名單防 XSS
DOCUMENT_UPLOAD_EXTS = frozenset({".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp"})

# 品項/整組照片單檔上限
ITEM_PHOTO_MAX_BYTES = 10 * 1024 * 1024
