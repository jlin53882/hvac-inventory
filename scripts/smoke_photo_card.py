# -*- coding: utf-8 -*-
"""上傳測試照片到 id=1 品項（驗證卡片縮圖），用完即刪"""
import io
import urllib.error
import urllib.request

from PIL import Image

BASE = "http://127.0.0.1:8000"
ITEM_ID = 1  # 用第一筆品項


def req(method, path, files=None):
    url = f"{BASE}{path}"
    boundary = "----smokeboundary"
    parts = b""
    for name, (fn, content, ctype) in files.items():
        parts += (f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; filename="{fn}"\r\n'
                  f"Content-Type: {ctype}\r\n\r\n").encode() + content + b"\r\n"
    parts += f"--{boundary}--\r\n".encode()
    r = urllib.request.Request(url, data=parts, method=method)
    r.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
    try:
        with urllib.request.urlopen(r) as resp:
            return resp.status, resp.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


# 上傳測試照片（500x400 暖色圖）
img = Image.new("RGB", (500, 400), (220, 160, 60))
buf = io.BytesIO()
img.save(buf, "PNG")
st, body = req("POST", f"/api/items/{ITEM_ID}/photo",
               files={"file": ("test.png", buf.getvalue(), "image/png")})
print("上傳:", st, body)