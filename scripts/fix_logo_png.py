# -*- coding: utf-8 -*-
"""把登入頁 logo 圖檔轉成真 PNG（原始內容是 JPEG）"""
from PIL import Image

SRC = r"C:\Users\admin\workspace\hvac-inventory\static\img\logo-zhenjia.png"

im = Image.open(SRC)
print("mode:", im.mode, "size:", im.size)
im = im.convert("RGBA")
im.save(SRC, "PNG")
im2 = Image.open(SRC)
print("verify:", im2.format, im2.size)
