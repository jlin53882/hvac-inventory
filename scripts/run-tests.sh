#!/usr/bin/env bash
# hvac-inventory 測試分組執行（2026-08-14，v4 pro 分析 + 家豪拍板）
# 用途：開發中只跑「改動範圍」的相關組；commit/push 前一律跑 all（全量）
#
# 用法: ./scripts/run-tests.sh [core|frontend|storage|auth|rbac|regression|petty_cash|work_progress|all]
#   組別    內容                                      觸發條件（改到就跑這組）
#   core      test_main (196) + test_safety_helpers       items/stockout/stocktake/kits/photos/stats/export + 共用安全 helper
#   frontend  frontend_assets+security+structure+performance  static/** 任何改動；新增任何後端端點（XSS/公式注入守衛）
#   storage   media_storage+quotation_uploads+signed_reports+asset_scripts  file_storage、媒體路由、導入/稽核腳本
#   auth      test_users + test_viewer                  app/routes/auth.py、users.py
#   rbac      test_rbac + test_rbac_perms              權限系統、app/database.py seed
#   regression v101+appointments+gcal                  appointments.py、v1.0.1 回歸、gcal 同步引擎（gcal_sync/gcal_keys/deadvar_verify）
#   petty_cash  test_petty_cash（零用金月報）             app/routes/petty_cash.py、services/petty_cash_report.py
#   work_progress test_work_progress                    每日工作進度 API/媒體/RBAC/競態
#
# ⚠️ 改到以下檔 = 跑 all（所有測試的 fixture 底層）：
set -e
cd "$(dirname "$0")/.." || exit 1
if [ -x ".venv/Scripts/python.exe" ]; then
  PY=".venv/Scripts/python.exe"
elif [ -x ".venv/bin/python" ]; then
  PY=".venv/bin/python"
else
  echo "找不到專案虛擬環境 Python（.venv/Scripts/python.exe 或 .venv/bin/python）"
  exit 1
fi

case "${1:-all}" in
  core)       FILES="tests/test_main.py tests/test_safety_helpers.py" ;;
  frontend)   FILES="tests/test_frontend_assets.py tests/test_security_regression.py tests/test_structure.py tests/test_performance_frontend.py" ;;
  storage)    FILES="tests/test_media_storage.py tests/test_quotation_uploads.py tests/test_quotations.py tests/test_signed_reports.py tests/test_file_asset_scripts.py" ;;
  auth)       FILES="tests/test_users.py tests/test_viewer.py" ;;
  rbac)       FILES="tests/test_rbac.py tests/test_rbac_perms.py" ;;
  regression) FILES="tests/test_v101.py tests/test_appointments.py tests/test_gcal_sync.py tests/test_gcal_keys.py tests/test_deadvar_verify.py" ;;
  petty_cash) FILES="tests/test_petty_cash.py tests/test_engineering_petty_cash.py tests/test_petty_cash_frontend_races.py" ;;
  work_progress) FILES="tests/test_work_progress.py" ;;
  all)        FILES="tests/" ;;
  *) echo "用法: $0 [core|frontend|storage|auth|rbac|regression|petty_cash|work_progress|all]"; exit 1 ;;
esac

echo "== 測試組: ${1:-all} =="
# 2026-08-14 補：all（全量）用 pytest-xdist 並行加速（~150s → ~60s）；分組組別小不並行避免 overhead
PARALLEL=""
[ "${1:-all}" = "all" ] && PARALLEL="-n auto"
JUNIT_ARG=""
[ -n "${JUNITXML:-}" ] && JUNIT_ARG="--junitxml=${JUNITXML}"
exec env -u PYTHONPATH "$PY" -m pytest $FILES -q $PARALLEL $JUNIT_ARG
