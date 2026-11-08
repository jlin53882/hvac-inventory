@echo off
chcp 65001 >nul
title 振佳空調庫存管理系統 - 外網連線（Tailscale Funnel 固定網址）
cd /d "%~dp0"
setlocal EnableExtensions EnableDelayedExpansion

set "TS_EXE=C:\Program Files\Tailscale\tailscale.exe"
set "FIXED_URL=https://node.tail13203e.ts.net"

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

REM 2. 確保 Tailscale Funnel 443 指向本機 8000，再推播固定網址
echo [1/3] 本機伺服器確認在跑 ✓
echo [2/3] 確認並修復 Tailscale Funnel（固定網址）...
echo.
echo   📱 固定網址：%FIXED_URL%
echo   （網址固定不變，重啟外網不需重新登入）
echo.

if not exist "%TS_EXE%" (
    echo [錯誤] 找不到 Tailscale：%TS_EXE%
    echo        請確認 Tailscale 已安裝後再重試。
    echo.
    pause
    exit /b 1
)

REM 強制把 443 Funnel 綁回本機 HVAC 服務 8000，修正殘留的舊代理埠
"%TS_EXE%" funnel --yes --bg --https=443 8000
if errorlevel 1 (
    echo [錯誤] Tailscale Funnel 綁定失敗。
    echo        請確認 Tailscale 已登入，或以系統管理員身分重試。
    echo.
    pause
    exit /b 1
)

REM 等待設定寫入後，確認實際 proxy 目標不是舊埠（例如 8099）
set "TARGET_OK="
for /L %%N in (1,1,5) do (
    "%TS_EXE%" funnel status 2>nul | findstr /I /C:"127.0.0.1:8000" >nul
    if not errorlevel 1 set "TARGET_OK=1"
    if not defined TARGET_OK timeout /t 1 /nobreak >nul
)
if not defined TARGET_OK (
    echo [錯誤] Funnel 目前沒有確認到 127.0.0.1:8000。
    echo        目前狀態如下：
    "%TS_EXE%" funnel status
    echo.
    pause
    exit /b 1
)

REM 透過固定網址的本機 Funnel 路徑確認 HTTP health
set "HTTP_CODE="
for /f "delims=" %%H in ('"%SystemRoot%\System32\curl.exe" -k -sS -o NUL -w "%%{http_code}" --max-time 15 "%FIXED_URL%/health" 2^>nul') do set "HTTP_CODE=%%H"
if not "!HTTP_CODE!"=="200" (
    echo [錯誤] Funnel health 檢查失敗，HTTP 狀態：!HTTP_CODE!
    echo        請稍後再確認 Tailscale 公開端同步狀態。
    echo.
    pause
    exit /b 1
)

echo [3/3] Funnel 已確認指向 8000，啟動 Discord 通知...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\tailscale-funnel-notify.ps1"
pause
endlocal
