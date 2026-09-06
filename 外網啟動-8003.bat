@echo off
chcp 65001 >nul
title HVAC DSR - External (8003)
cd /d "%~dp0"
echo ============================================
echo   HVAC signed-reports - External (port 8003)
echo ============================================
echo.
netstat -ano | findstr ":8003" | findstr "LISTENING" >nul
if errorlevel 1 (
    echo [ERROR] 8003 not running!
    echo        Run restart-server-8003.bat first.
    pause
    exit /b 1
)
echo Starting Cloudflare tunnel...
cloudflared tunnel --url http://localhost:8003 --no-autoupdate
pause
