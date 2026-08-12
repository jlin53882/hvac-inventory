@echo off
chcp 65001 >nul
title 振佳空調庫存 - 監控安裝
cd /d "%~dp0"

echo ============================================
echo   🛡️ 振佳空調庫存 - 健康監控安裝
echo ============================================
echo.

REM 1. 註冊 Windows 工作排程器（每 10 分鐘檢查監控存活）
echo [1/3] 註冊工作排程器（每 10 分鐘 watchdog）...
schtasks /create /tn "HVAC-Monitor-Watchdog" /tr "powershell -NoProfile -ExecutionPolicy Bypass -File \"%~dp0watchdog-check.ps1\"" /sc minute /mo 10 /f
if errorlevel 1 (
    echo       [錯誤] 工作排程器註冊失敗（可能需要系統管理員權限）
    echo       請以系統管理員身分執行本檔
    echo.
    pause
    exit /b 1
)
echo       ✅ 工作排程器註冊完成（HVAC-Monitor-Watchdog）
echo.

REM 2. 啟動監控腳本（背景常駐）
echo [2/3] 啟動監控腳本 monitor.ps1（背景）...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','\"%~dp0monitor.ps1\"' -WindowStyle Hidden"
timeout /t 3 /nobreak >nul
echo       ✅ 監控腳本已啟動
echo.

REM 3. 驗證
echo [3/3] 驗證監控運作中...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0watchdog-check.ps1"
echo.
echo ============================================
echo   ✅ 安裝完成！監控會每 10 分鐘檢查：
echo      - 本機 server(8000) → 掛掉自動 start.bat 重啟 + Discord 通知
echo      - Funnel 網址 → 掛掉自動重建 + Discord 通知
echo      - 監控自己掛掉 → 工作排程器自動拉起 + Discord 通知
echo ============================================
echo.
pause
