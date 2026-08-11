# -*- coding: utf-8 -*-
"""本機開發用啟動腳本：uvicorn 伺服器（避免 lifecycle guard 誤判）"""
import uvicorn

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000)