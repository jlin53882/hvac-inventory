# -*- coding: utf-8 -*-
"""本機開發用啟動腳本：uvicorn 伺服器（避免 lifecycle guard 誤判）"""
import uvicorn

if __name__ == "__main__":
    # --reload：開發模式改檔自動重載（2026-08-12 家豪定案），正式部署用 start.bat
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)