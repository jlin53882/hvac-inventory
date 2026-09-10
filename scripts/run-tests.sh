#!/usr/bin/env bash
# hvac-inventory 測試分組執行（2026-08-14，v4 pro 分析 + 家豪拍板）
# 用途：開發中只跑「改動範圍」的相關組；commit/push 前一律跑 all（全量）
#
# 用法: ./scripts/run-tests.sh [core|frontend|storage|auth|rbac|regression|all]
#   組別    內容                                      觸發條件（改到就跑這組）
#   core      test_main (196)                         items/stockout/stocktake/kits/photos/stats/export
#   frontend  frontend_assets+security+structure+performance  static/** 任何改動；新增任何後端端點（XSS/公式注入守衛）
#   storage   media_storage+quotation_uploads+signed_reports+asset_scripts  file_storage、媒體路由、導入/稽核腳本
#   auth      test_users + test_viewer                  app/routes/auth.py、users.py
#   rbac      test_rbac + test_rbac_perms              權限系統、app/database.py seed
#   regression v101+appointments+gcal                  appointments.py、v1.0.1 回歸、gcal 同步引擎（gcal_sync/gcal_keys/deadvar_verify）
#
# ⚠️ 改到以下檔 = 跑 all（所有測試的 fixture 底層）：
#    app/database.py、app/services/auth.py、main.py、app/models.py、app/config.py
set -e
cd "$(dirname "$0")/.." || exit 1
PY=".venv/Scripts/python.exe"

case "${1:-all}" in
  core)       FILES="tests/test_main.py" ;;
  frontend)   FILES="tests/test_frontend_assets.py tests/test_security_regression.py tests/test_structure.py tests/test_performance_frontend.py" ;;
  storage)    FILES="tests/test_media_storage.py tests/test_quotation_uploads.py tests/test_signed_reports.py tests/test_file_asset_scripts.py" ;;
  auth)       FILES="tests/test_users.py tests/test_viewer.py" ;;
  rbac)       FILES="tests/test_rbac.py tests/test_rbac_perms.py" ;;
  regression) FILES="tests/test_v101.py tests/test_appointments.py tests/test_gcal_sync.py tests/test_gcal_keys.py tests/test_deadvar_verify.py" ;;
  all)        FILES="tests/" ;;
  *) echo "用法: $0 [core|frontend|storage|auth|rbac|regression|all]"; exit 1 ;;
esac

echo "== 測試組: ${1:-all} =="
# 2026-08-14 補：all（全量）用 pytest-xdist 並行加速（~150s → ~60s）；分組組別小不並行避免 overhead
PARALLEL=""
[ "${1:-all}" = "all" ] && PARALLEL="-n auto"
exec env -u PYTHONPATH "$PY" -m pytest $FILES -q $PARALLEL
