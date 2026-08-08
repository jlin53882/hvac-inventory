@echo off
chcp 65001 >nul
title 冷凍空調庫存系統
cd /d "%~dp0"

echo ============================================
echo   🧊 冷凍空調庫存系統 - 啟動中...
echo ============================================
echo.

REM 檢查 .venv 是否存在
if not exist ".venv\Scripts\python.exe" (
    echo [錯誤] 找不到 .venv，請先執行 setup.bat
    pause
    exit /b 1
)

REM 清除可能污染的 PYTHONPATH
set PYTHONPATH=

REM 啟動伺服器
echo [1/1] 啟動伺服器 http://0.0.0.0:8000
echo.
echo   在瀏覽器打開: http://127.0.0.1:8000
echo   手機連線:      http://你的電腦IP:8000
echo   停止:          關閉這個視窗即可
echo.
".venv\Scripts\python.exe" -m uvicorn main:app --host 0.0.0.0 --port 8000
pause
