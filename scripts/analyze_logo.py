# -*- coding: utf-8 -*-
"""分析 logo 圖片：找白色圓形區域的邊界，確認構圖中心"""
from PIL import Image

SRC = r"C:\Users\admin\workspace\hvac-inventory\static\img\logo-zhenjia.png"
im = Image.open(SRC).convert("RGB")
w, h = im.size
print("size:", w, h)

px = im.load()
# 掃描：接近白色 (>=240) 的像素 bbox
min_x, min_y, max_x, max_y = w, h, -1, -1
white_count = 0
step = 2  # 抽樣加速
for y in range(0, h, step):
    for x in range(0, w, step):
        r, g, b = px[x, y]
        if r >= 235 and g >= 235 and b >= 235:
            white_count += 1
            if x < min_x: min_x = x
            if x > max_x: max_x = x
            if y < min_y: min_y = y
            if y > max_y: max_y = y

print("white bbox:", (min_x, min_y, max_x, max_y))
print("white bbox size:", (max_x - min_x, max_y - min_y))
print("image center:", (w // 2, h // 2))
print("white center:", ((min_x + max_x) // 2, (min_y + max_y) // 2))
# 角落顏色
for corner in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]:
    print("corner", corner, "=", px[corner])
# 邊緣中點顏色
for pt in [(w // 2, 0), (w // 2, h - 1), (0, h // 2), (w - 1, h // 2)]:
    print("edge-mid", pt, "=", px[pt])
