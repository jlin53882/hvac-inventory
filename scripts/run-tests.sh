#!/usr/bin/env bash
# hvac-inventory 測試分組執行（2026-08-14，v4 pro 分析 + 家豪拍板）
# 用途：開發中只跑「改動範圍」的相關組；commit/push 前一律跑 all（全量）
#
# 用法: ./scripts/run-tests.sh [core|frontend|auth|rbac|regression|all]
#   組別    內容                         觸發條件（改到就跑這組）
#   core      test_main (142)             app/routes/items|stockout|stocktake|kits|photos|stats|export.py
#   frontend  frontend_assets+security    static/** 任何改動；新增任何後端端點（XSS/公式注入守衛）
#   auth      test_users + test_viewer    app/routes/auth.py、users.py
#   rbac      test_rbac + test_rbac_perms 權限系統、app/database.py seed
#   regression v101 + appointments        appointments.py、v1.0.1 回歸
#
# ⚠️ 改到以下檔 = 跑 all（所有測試的 fixture 底層）：
#    app/database.py、app/services/auth.py、main.py、app/models.py、app/config.py
set -e
cd "$(dirname "$0")/.." || exit 1
PY=".venv/Scripts/python.exe"

case "${1:-all}" in
  core)       FILES="tests/test_main.py" ;;
  frontend)   FILES="tests/test_frontend_assets.py tests/test_security_regression.py" ;;
  auth)       FILES="tests/test_users.py tests/test_viewer.py" ;;
  rbac)       FILES="tests/test_rbac.py tests/test_rbac_perms.py" ;;
  regression) FILES="tests/test_v101.py tests/test_appointments.py" ;;
  all)        FILES="tests/" ;;
  *) echo "用法: $0 [core|frontend|auth|rbac|regression|all]"; exit 1 ;;
esac

echo "== 測試組: ${1:-all} =="
exec env -u PYTHONPATH "$PY" -m pytest $FILES -q
