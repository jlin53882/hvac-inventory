@echo off
chcp 65001 >nul
title HVAC Server - signed-reports (8003)
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" ( echo 請先執行 uv sync & pause & exit /b 1 )
set PYTHONPATH=
".venv\Scripts\python.exe" -m uvicorn main:app --host 0.0.0.0 --port 8003
pause
