#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""裁出 Sarah 指定 logo 圖中間的圓形，存成正式 logo PNG"""
from PIL import Image
import io

SRC = r'C:\Users\admin\AppData\Local\hermes\cache\images\img_dcb52eb5350d.jpeg'
DST = r'C:\Users\admin\workspace\hvac-inventory\static\img\logo-zhenjia.png'

img = Image.open(SRC).convert('RGB')
w, h = img.size
print(f'原圖: {w}x{h}')

# 找出「非背景色」像素的 bounding box
# 背景為深青綠(teal)，圓為薄荷綠；掃描四邊找到圓的邊界
def find_circle_bbox(img):
    w, h = img.size
    px = img.load()
    # 取四邊中點附近的背景色（角落）
    corner = px[5, 5]
    # 每個像素與角落背景色的距離
    def is_circle(x, y):
        r, g, b = px[x, y]
        cr, cg, cb = corner
        return abs(r-cr) + abs(g-cg) + abs(b-cb) > 40
    # 掃描找 left/right/top/bottom
    left = right = top = bottom = None
    for y in range(0, h, 2):
        for x in range(0, w, 2):
            if is_circle(x, y):
                if left is None or x < left: left = x
                if right is None or x > right: right = x
                if top is None or y < top: top = y
                if bottom is None or y > bottom: bottom = y
    return left, top, right, bottom

left, top, right, bottom = find_circle_bbox(img)
print(f'圓 bounding box: left={left} top={top} right={right} bottom={bottom}')
print(f'圓寬: {right-left} 圓高: {bottom-top}')

# 圓是正圓，取直徑 = 寬高較大者，以中心為準切正方形
cx = (left + right) // 2
cy = (top + bottom) // 2
diameter = max(right - left, bottom - top)
print(f'中心: ({cx},{cy}) 直徑: {diameter}')

# 稍微加 4px 邊距避免切到圓緣
pad = 4
half = diameter // 2 + pad
box = (max(0, cx-half), max(0, cy-half), min(w, cx+half), min(h, cy+half))
square = img.crop(box)
print(f'裁切 box: {box} → {square.size}')

# 轉 PNG 儲存
square.save(DST, 'PNG')
print(f'已存: {DST}')

# 驗證 PNG
chk = Image.open(DST)
print(f'驗證: {chk.format} {chk.size}x{chk.size} mode={chk.mode}')