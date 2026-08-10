# -*- coding: utf-8 -*-
"""把 logo 裁成以圓心為中心的正方形，消除上下白邊"""
from PIL import Image

SRC = r"C:\Users\admin\workspace\hvac-inventory\static\img\logo-zhenjia.png"
im = Image.open(SRC).convert("RGB")
w, h = im.size

# 白色圓形 bbox（analyze_logo.py 量測結果）
box = (156, 80, 782, 706)  # left, top, right, bottom → 626x626
crop = im.crop(box)
crop.save(SRC, "PNG")

im2 = Image.open(SRC)
print("new size:", im2.size)
print("format:", im2.format)
