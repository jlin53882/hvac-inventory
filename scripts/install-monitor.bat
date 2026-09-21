@echo off
chcp 65001 >nul
title 振佳空調庫存 - 監控安裝
cd /d "%~dp0"

echo ============================================
echo   🛡️ 振佳空調庫存 - 健康監控安裝
echo ============================================
echo.

REM 1. 註冊 Windows 工作排程器（每 10 分鐘檢查監控存活）
echo [1/5] 註冊工作排程器（每 10 分鐘 watchdog）...
schtasks /create /tn "HVAC-Monitor-Watchdog" /tr "powershell -NoProfile -ExecutionPolicy Bypass -File \"%~dp0watchdog-check.ps1\"" /sc minute /mo 10 /ru SYSTEM /rl HIGHEST /f
if errorlevel 1 (
    echo       [錯誤] 工作排程器註冊失敗（可能需要系統管理員權限）
    echo       請以系統管理員身分執行本檔
    echo.
    pause
    exit /b 1
)
echo       ✅ 工作排程器註冊完成（HVAC-Monitor-Watchdog）
echo.

REM 2. 註冊 monitor 常駐任務（開機後以 SYSTEM / HIGHEST 執行）
echo [2/5] 註冊 monitor 常駐任務...
schtasks /create /tn "HVAC-Monitor" /tr "powershell -NoProfile -ExecutionPolicy Bypass -File \"%~dp0monitor.ps1\"" /sc onstart /delay 0001:00 /ru SYSTEM /rl HIGHEST /f
if errorlevel 1 (
    echo       [錯誤] monitor 常駐任務註冊失敗
    echo       請以系統管理員身分執行本檔
    echo.
    pause
    exit /b 1
)
echo       ✅ monitor 常駐任務註冊完成
schtasks /run /tn "HVAC-Monitor" >nul 2>&1
echo.

REM 3. 註冊 Tailscale 高權限復原任務（由 monitor 在公網 Funnel 失效時觸發）
echo [3/5] 註冊 Tailscale 復原任務（SYSTEM / HIGHEST）...
schtasks /create /tn "HVAC-Tailscale-Recovery" /tr "powershell -NoProfile -ExecutionPolicy Bypass -File \"%~dp0restart-tailscale-service.ps1\"" /sc ONDEMAND /ru SYSTEM /rl HIGHEST /f
if errorlevel 1 (
    echo       [錯誤] Tailscale 復原任務註冊失敗
    echo       請以系統管理員身分執行本檔
    echo.
    pause
    exit /b 1
)
echo       ✅ Tailscale 復原任務註冊完成
echo.

REM 4. monitor 已由 HVAC-Monitor（SYSTEM / HIGHEST）啟動，不再建立一般使用者背景程序
echo [4/5] monitor 常駐任務已啟動...
echo       ✅ monitor 由工作排程器執行
echo.

REM 5. 驗證
echo [5/5] 驗證監控運作中...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0watchdog-check.ps1"
echo.
echo ============================================
echo   ✅ 安裝完成！監控會每 10 分鐘檢查：
echo      - 本機 server(8000) → 自動重啟 + Discord 通知
echo      - 公網 Funnel → SYSTEM 高權限重啟 Tailscale + Discord 通知
echo      - 監控自己掛掉 → 工作排程器自動拉起 + Discord 通知
echo ============================================
echo.
pause
