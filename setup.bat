@echo off
chcp 65001 >nul
title 庫存系統 - 環境安裝
cd /d "%~dp0"

echo ============================================
echo   🧊 冷凍空調庫存系統 - 環境安裝
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

echo [3/3] 匯入庫存資料...
set PYTHONPATH=
".venv\Scripts\python.exe" -c "import json, sqlite3, sys; sys.path.insert(0,'.'); import main; conn=sqlite3.connect('inventory.db'); cur=conn.cursor(); cur.execute('DELETE FROM movements'); cur.execute('DELETE FROM items'); items=json.load(open('data/stock-items.json', encoding='utf-8')); [cur.execute('INSERT INTO items (brand,code,name,qty,unit,location,note) VALUES (?,?,?,?,?,?,?)', (i.get('brand',''),i.get('code',''),i.get('name',''),i.get('qty',0),i.get('unit','個'),i.get('location',''),i.get('note',''))) for i in items]; conn.commit(); print(f'OK 匯入 {len(items)} 筆'); conn.close()"

echo.
echo ✅ 安裝完成！請執行 start.bat 啟動系統
pause
