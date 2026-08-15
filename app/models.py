# -*- coding: utf-8 -*-
"""
Pydantic 請求模型
=================
所有 API 的請求 body 定義集中管理。
"""
from typing import List, Optional

from pydantic import BaseModel, Field


# ---------- 品項（v10 正規化：主檔 + 位置庫存） ----------
class StockItem(BaseModel):
    location: str = ""
    qty: float = Field(0, ge=0)
    note: str = ""


class ItemCreate(BaseModel):
    brand: str = ""
    code: str = ""
    name: str
    unit: str = "個"
    low_stock: float = 0
    site: str = "office"  # office=辦公室 / warehouse=倉庫
    stocks: List[StockItem] = []  # 位置庫存清單（第一筆為預設位置）


class ItemUpdate(BaseModel):
    brand: Optional[str] = None
    code: Optional[str] = None
    name: Optional[str] = None
    unit: Optional[str] = None
    low_stock: Optional[float] = None
    site: Optional[str] = None
    stocks: Optional[List[StockItem]] = None  # v10：完整位置清單全量替換
    updated_at: Optional[str] = None  # 2026-08-14 樂觀鎖：前端編輯 modal 開啟時的快照值


class StockUpdate(BaseModel):
    location: Optional[str] = None
    qty: Optional[float] = Field(None, ge=0)
    note: Optional[str] = None


class AdjustRequest(BaseModel):
    delta: float
    reason: str = ""
    destination: str = ""  # 出庫去向（客戶/案場/工地）


# ---------- 出庫 ----------
class StockOutRequest(BaseModel):
    item_id: int
    qty: float = Field(..., ge=0)
    destination: str = ""
    note: str = ""
    location: str = ""  # v10：可指定從哪個位置出（空白=依庫存順序扣）


class NonStockOutRequest(BaseModel):
    """新增非庫存品項的已領出/待領出（不在單一庫存/整組庫存，只記流水不扣庫存；destination 端點內驗證）"""
    name: str
    code: str = ""
    unit: str = "個"
    qty: float = Field(..., gt=0)
    destination: str = ""
    note: str = ""


class StockoutUpdate(BaseModel):
    """編輯已領出記錄：去向 / 數量（差額補扣庫存）/ 日期"""
    destination: Optional[str] = None
    qty: Optional[float] = None
    created_at: Optional[str] = None


class PrepareRequest(BaseModel):
    qty: float
    note: str = ""
    location: str = ""  # v10：可指定位置（空白=不限）


# ---------- 整組（套件） ----------
class KitCreate(BaseModel):
    name: str
    items: list  # [{item_id, qty}]
    note: str = ""
    updated_at: Optional[str] = None  # 2026-08-14 樂觀鎖：前端編輯整組時的 updated_at 快照


class KitAssemble(BaseModel):
    qty: float = 1


# ---------- 盤點 ----------
class StocktakeSubmit(BaseModel):
    take_date: str = ""  # 預設今天
    items: list  # [{item_id, location, actual_qty, note}]

# ---------- 單位字典（2026-08-16 單位動態清單） ----------
class UnitIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=20)


class UnitUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=20)
    sort_order: int | None = Field(None, ge=0, le=9999)
    is_active: bool | None = None


class UnitConsolidate(BaseModel):
    # from_unit 允許空字串（活庫有 11 筆 unit='' 需可收編，B3 審查修正）
    from_unit: str | None = Field(None, max_length=20)
    to_unit: str = Field(..., min_length=1, max_length=20)
