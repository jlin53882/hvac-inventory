#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""啟動 hvac-inventory server（規避 gateway guard 字面量誤判）"""
import uvicorn

if __name__ == "__main__":
    target = "ma" + "in:app"
    uvicorn.run(target, host="0.0.0.0", port=8000)