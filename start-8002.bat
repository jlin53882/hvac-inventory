@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo [hvac-ui-redesign] 啟動 port 8002...
env -u PYTHONPATH .venv\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8002
pause
