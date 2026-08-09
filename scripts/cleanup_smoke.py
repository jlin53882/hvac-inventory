# -*- coding: utf-8 -*-
"""清理 smoke 測試殘留：品項 1 的照片 + 品項 255（遙控器測試品）"""
import json
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8000"


def req(method, path):
    r = urllib.request.Request(f"{BASE}{path}", method=method)
    try:
        with urllib.request.urlopen(r) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())


# 1. 刪品項 1 的測試照片
st1, b1 = req("DELETE", "/api/items/1/photo")
print("刪品項1照片:", st1, b1)

# 2. 找「遙控器測試」開頭的品項並刪除（含第一次 smoke 留下的 255）
st, items = req("GET", "/api/items?site=office")
for it in items:
    if it.get("name", "").startswith("遙控器測試"):
        st2, b2 = req("DELETE", f"/api/items/{it['id']}")
        print(f"刪品項 {it['id']} ({it['name']}):", st2, b2)