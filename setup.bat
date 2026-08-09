@echo off
chcp 65001 >nul
title 庫存系統 - 環境安裝
cd /d "%~dp0"

echo ============================================
echo   🧊 振佳空調庫存管理系統 - 環境安裝
echo ============================================
echo.

echo [1/3] 建立虛擬環境...
if not exist ".venv\Scripts\python.exe" (
    uv venv .venv
    if errorlevel 1 (
        echo [錯誤] uv 不可用，請改用: python -m venv .venv
        pause
        exit /b 1
    )
) else (
    echo       已存在，跳過
)

echo [2/3] 安裝套件...
uv pip install --python .venv\Scripts\python.exe fastapi "uvicorn[standard]" openpyxl

echo [3/3] 資料庫初始化...
set PYTHONPATH=
".venv\Scripts\python.exe" -c "import sys; sys.path.insert(0,'.'); import main; print('✅ 資料庫已初始化（庫存從空白開始，請用系統介面新增品項）')"

echo.
echo ✅ 安裝完成！請執行 start.bat 啟動系統
pause
