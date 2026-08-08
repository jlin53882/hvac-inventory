# -*- coding: utf-8 -*-
"""
Pydantic 請求模型
=================
所有 API 的請求 body 定義集中管理。
"""
from typing import Optional

from pydantic import BaseModel


# ---------- 品項 ----------
class ItemCreate(BaseModel):
    brand: str = ""
    code: str = ""
    name: str
    qty: float = 0
    unit: str = "個"
    location: str = ""
    note: str = ""
    low_stock: float = 0
    site: str = "office"  # office=辦公室 / warehouse=倉庫


class ItemUpdate(BaseModel):
    brand: Optional[str] = None
    code: Optional[str] = None
    name: Optional[str] = None
    unit: Optional[str] = None
    location: Optional[str] = None
    note: Optional[str] = None
    low_stock: Optional[float] = None
    site: Optional[str] = None


class AdjustRequest(BaseModel):
    delta: float
    reason: str = ""
    destination: str = ""  # 出庫去向（客戶/案場/工地）


# ---------- 出庫 ----------
class StockOutRequest(BaseModel):
    item_id: int
    qty: float
    destination: str = ""
    note: str = ""


class PrepareRequest(BaseModel):
    qty: float
    note: str = ""


# ---------- 整組（套件） ----------
class KitCreate(BaseModel):
    name: str
    items: list  # [{item_id, qty}]
    note: str = ""


class KitAssemble(BaseModel):
    qty: float = 1


# ---------- 盤點 ----------
class StocktakeSubmit(BaseModel):
    take_date: str = ""  # 預設今天
    items: list  # [{item_id, actual_qty, note}]
