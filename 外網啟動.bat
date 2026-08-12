@echo off
chcp 65001 >nul
title 振佳空調庫存管理系統 - 外網連線（Tailscale Funnel 固定網址）
cd /d "%~dp0"

echo ============================================
echo   🌐 振佳空調庫存 - 外網連線啟動（固定網址）
echo ============================================
echo.

REM 1. 檢查本機伺服器(8000)是否在跑
netstat -ano | findstr ":8000" | findstr "LISTENING" >nul
if errorlevel 1 (
    echo [錯誤] 本機系統 8000 沒在跑！
    echo        請先雙擊「start.bat」啟動庫存系統，再開這個檔。
    echo.
    pause
    exit /b 1
)

REM 2. 啟動 Tailscale Funnel + Discord 通知（網址固定：node.tail13203e.ts.net）
echo [1/2] 本機伺服器確認在跑 ✓
echo [2/2] 確認 Tailscale Funnel（固定網址）中，網址會自動推播到 Discord...
echo.
echo   📱 固定網址：https://node.tail13203e.ts.net
echo   （網址固定不變，重啟外網不需重新登入）
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\tailscale-funnel-notify.ps1"
pause
