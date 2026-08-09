# -*- coding: utf-8 -*-
"""Todo 5 端到端實測腳本（重啟後驗證 photos/lookup/has_photo）"""
import io
import json
import urllib.error
import urllib.parse
import urllib.request

from PIL import Image

BASE = "http://127.0.0.1:8000"


def req(method, path, body=None, files=None):
    url = f"{BASE}{path}"
    if files:
        boundary = "----testboundary"
        parts = b""
        for name, (fn, content, ctype) in files.items():
            parts += (f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; filename="{fn}"\r\n'
                      f"Content-Type: {ctype}\r\n\r\n").encode() + content + b"\r\n"
        parts += f"--{boundary}--\r\n".encode()
        r = urllib.request.Request(url, data=parts, method=method)
        r.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
    else:
        data = json.dumps(body).encode() if body is not None else None
        r = urllib.request.Request(url, data=data, method=method)
        if body is not None:
            r.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(r) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())


def q(**kw):
    """中文 query 參數安全編碼"""
    return urllib.parse.urlencode(kw)


# 1. 建立測試品項（唯一名稱，避免撞去重鍵）
import time
uniq = f"遙控器測試{int(time.time())}"
st, item = req("POST", "/api/items", body={
    "brand": "大金", "code": "ARC433A59", "name": uniq, "unit": "個",
    "site": "office", "stocks": [{"location": "編號A", "qty": 3, "note": "測試"}]})
print("1) 建立品項:", st, item.get("id") if isinstance(item, dict) else item)
if st != 201:
    raise SystemExit("品項建立失敗，停止")
iid = item["id"]

# 2. 上傳照片
img = Image.new("RGB", (800, 600), (30, 90, 200))
buf = io.BytesIO()
img.save(buf, "PNG")
st2, r2 = req("POST", f"/api/items/{iid}/photo",
              files={"file": ("rc.png", buf.getvalue(), "image/png")})
print("2) 上傳照片:", st2, r2)

# 3. has_photo + list
st3, items = req("GET", "/api/items?site=office")
mine = [i for i in items if i.get("id") == iid]
print("3) has_photo:", mine[0]["has_photo"] if mine else "NOT FOUND")

# 4. similar（code 相同 → 必中）
st4, hits = req("GET", f"/api/items/similar?{q(name='遙控器', code='ARC433A59', site='office')}")
print("4) similar(code 相撞):", st4, [(h["name"], h["code"], h["total_qty"]) for h in hits])

# 5. locations
st5, locs = req("GET", f"/api/locations?{q(site='office')}")
print("5) locations 共", len(locs), "個, 命中編號A:", "編號A" in locs)

# 6. 清測試資料：刪照片 + 刪品項
st6, r6 = req("DELETE", f"/api/items/{iid}/photo")
print("6) 刪除照片:", st6, r6)
st7, r7 = req("DELETE", f"/api/items/{iid}")
print("7) 刪除品項:", st7, r7)