@echo off
chcp 65001 >nul
title 振佳空調庫存管理系統 - 外網連線（cloudflared 備援，網址每次變動）
cd /d "%~dp0"

echo ============================================
echo   🌐 振佳空調庫存 - 外網連線啟動（cloudflared 備援）
echo ============================================
echo   ⚠️ 備援方案：網址每次啟動會變動（重啟需重新登入）
echo   ✅ 主方案請用「外網啟動.bat」（Tailscale Funnel 固定網址）
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

REM 2. 啟動 Cloudflare 隧道 + Discord 通知
echo [1/2] 本機伺服器確認在跑 ✓
echo [2/2] 建立 Cloudflare 隧道中，網址會自動推播到 Discord...
echo.
echo   ❌ 關閉這個視窗 = 關閉外網連線
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\tunnel-notify.ps1"
pause
