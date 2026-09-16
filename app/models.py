# -*- coding: utf-8 -*-
"""
Pydantic 請求模型
=================
所有 API 的請求 body 定義集中管理。
"""
from datetime import date
from decimal import Decimal
from typing import List, Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator


# ---------- 品項（v10 正規化：主檔 + 位置庫存） ----------
class SignedReportUpdate(BaseModel):
    """編輯每日簽名報表的日期、上傳人與備註。"""
    report_date: Optional[str] = Field(None, max_length=10)
    uploader_name: Optional[str] = Field(None, min_length=1, max_length=50)
    note: Optional[str] = Field(None, max_length=500)


class StockItem(BaseModel):
    id: Optional[int] = None          # F2/F3：existing stock identity（None = new location）
    location: str = ""
    qty: float = Field(0, ge=0)
    note: str = ""
    stock_updated_at: Optional[str] = None  # F2：stock-level optimistic lock revision


class ItemCreate(BaseModel):
    brand: str = ""
    code: str = ""
    name: str
    unit: str = "個"
    low_stock: float = 0
    site: str = "office"  # office=辦公室 / warehouse=倉庫
    category: str = Field("", max_length=50)  # 品項分類（遙控器/電子零件/管材/...）
    stocks: List[StockItem] = []  # 位置庫存清單（第一筆為預設位置）


class ItemUpdate(BaseModel):
    brand: Optional[str] = None
    code: Optional[str] = None
    name: Optional[str] = None
    unit: Optional[str] = None
    low_stock: Optional[float] = Field(None, ge=0)
    site: Optional[str] = None
    category: Optional[str] = Field(None, max_length=50)  # 品項分類
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
    qty: Optional[float] = Field(None, gt=0)
    created_at: Optional[str] = None


class StockoutReturnRequest(BaseModel):
    """退回已領出：數量 / 實際回補位置 / 去向 / 日期"""
    qty: Optional[float] = Field(None, gt=0)
    return_stock_id: Optional[int] = Field(None, ge=1)
    destination: Optional[str] = Field(None, max_length=200)
    created_at: Optional[str] = Field(None, max_length=32)


class StockoutReturnUpdate(BaseModel):
    """編輯退回紀錄：數量 / 回補位置 / 去向 / 日期"""
    qty: Optional[float] = Field(None, gt=0)
    return_stock_id: Optional[int] = Field(None, ge=1)
    destination: Optional[str] = Field(None, max_length=200)
    created_at: Optional[str] = Field(None, max_length=32)


class StockoutReturnRepair(BaseModel):
    """補齊舊退回流水的原始出庫與回補位置關聯。"""
    source_movement_id: int = Field(..., ge=1)
    return_stock_id: int = Field(..., ge=1)


class PrepareRequest(BaseModel):
    qty: float
    note: str = ""
    location: str = ""  # v10：可指定位置（空白=不限）


class PreparedItemUpdate(BaseModel):
    """待領出單一交易編輯 contract：數量、準備說明與必要 metadata。"""
    prepared_qty: Optional[float] = Field(None, ge=0)
    destination: Optional[str] = Field(None, max_length=200)
    name: Optional[str] = Field(None, max_length=200)
    brand: Optional[str] = Field(None, max_length=100)
    code: Optional[str] = Field(None, max_length=100)
    unit: Optional[str] = Field(None, max_length=20)
    updated_at: Optional[str] = Field(None, max_length=64)


# ---------- 整組（套件） ----------
class KitCreate(BaseModel):
    name: str
    brand: str = ""
    code: str = ""
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
# qty_type（2026-09-12 數量系統）：integer 整數 / decimal 小數 / fraction 分數小數
QTY_TYPES = ("integer", "decimal", "fraction")


class UnitIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=20)
    qty_type: str = Field("integer", min_length=1, max_length=10)


class UnitUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=20)
    sort_order: int | None = Field(None, ge=0, le=9999)
    is_active: bool | None = None
    qty_type: str | None = Field(None, min_length=1, max_length=10)


class UnitConsolidate(BaseModel):
    # from_unit 允許空字串（活庫有 11 筆 unit='' 需可收編，B3 審查修正）
    from_unit: str | None = Field(None, max_length=20)
    to_unit: str = Field(..., min_length=1, max_length=20)


class UnitConsolidateItem(BaseModel):
    """單筆收編：指定某一筆品項改為目標單位（2026-08-16 方案 B 逐筆收編）"""
    item_id: int
    to_unit: str = Field(..., min_length=1, max_length=20)
    # new_qty（2026-09-12 歷史分數轉換）：同時指定新總量；僅單位置品項可轉，多位置 → 400
    new_qty: float | None = Field(None, ge=0)


# ---------- 使用者（2026-08-16 從 users.py 收攏） ----------
class UserCreate(BaseModel):
    username: str
    password: str
    display_name: str = ""
    role: str = "user"


class UserUpdate(BaseModel):
    display_name: Optional[str] = Field(None, max_length=100)
    role: Optional[str] = Field(None, max_length=20)
    is_active: Optional[int] = None
    color: Optional[str] = None  # 行事曆人員顏色（選填 hex）
    gcal_key: Optional[str] = None  # Google 行事曆同步 key 綁定


class UserPassword(BaseModel):
    password: str


class UserBatch(BaseModel):
    users: list[UserCreate]


class UserPermissionsUpdate(BaseModel):
    permissions: Optional[dict] = None   # {key: 0|1}（部分更新）
    reset_all: bool = False              # True = 清空全部覆蓋回角色預設


# ---------- 認證（2026-08-16 從 auth.py 收攏） ----------
class LoginRequest(BaseModel):
    username: str
    password: str


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str


# ---------- 行事曆（2026-08-16 從 appointments.py 收攏） ----------
class AppointmentIn(BaseModel):
    client_name: str
    address: str = ""
    service_type_id: Optional[int] = None
    date: str
    start_time: Optional[str] = ""   # 2026-08-14 Sarah：派工時間選填（兩欄皆空=未指定時間）
    end_time: Optional[str] = ""
    note: str = ""
    user_ids: List[int] = []
    updated_at: Optional[str] = None  # 2026-08-14 樂觀鎖：前端編輯派工時的 updated_at 快照


class ServiceTypeIn(BaseModel):
    name: str
    sort_order: int = 0
    is_active: int = 1


# ---------- Google 行事曆同步 ----------
class GcalKeyIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=50)
    credentials_path: str = Field(..., min_length=1)
    calendar_id: str = Field(..., min_length=1)


class GcalKeyUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=50)
    credentials_path: Optional[str] = None
    calendar_id: Optional[str] = None
    is_active: Optional[bool] = None


class BatchLocationRequest(BaseModel):
    stock_ids: List[int] = Field(..., min_length=1)
    new_location: str = Field(..., min_length=1, max_length=100)
    new_site: Optional[Literal["office", "warehouse"]] = None


class QuotationItemIn(BaseModel):
    inventory_item_id: Optional[int] = Field(None, ge=1)
    item_name: str = Field(..., min_length=1, max_length=200)
    specification: str = Field("", max_length=500)
    qty: float = Field(..., gt=0)
    unit: str = Field("式", min_length=1, max_length=30)
    unit_price: float = Field(..., ge=0)

    @field_validator("item_name", "unit")
    @classmethod
    def non_blank_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("不可為空白")
        return value


class QuotationIn(BaseModel):
    quote_number: Optional[str] = Field(None, max_length=50)
    quote_date: str = Field(..., max_length=10)
    customer_name: str = Field(..., min_length=1, max_length=100)
    contact: str = Field("", max_length=100)
    address: str = Field("", max_length=300)
    valid_days: int = Field(30, ge=1, le=3650)
    tax_type: Literal["included", "excluded"] = "included"
    note: str = Field("", max_length=1000)
    items: List[QuotationItemIn] = Field(..., min_length=1, max_length=200)


# ---------- 零用金月報（2026-09-12：report / entry / entry_item 三層） ----------
class PettyCashEntryItemIn(BaseModel):
    """一筆支出底下的明細項目（不綁庫存，可獨立運作）。"""
    item_name: str = Field(..., min_length=1, max_length=200)
    qty: float = Field(..., gt=0)
    unit: str = Field("", max_length=20)
    amount: float = Field(..., gt=0)

    @field_validator("item_name")
    @classmethod
    def non_blank_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("品項名稱不可空白")
        return value


class PettyCashEntryIn(BaseModel):
    """收支紀錄：收入不可帶明細；支出可帶 0~N 個明細項目。"""
    entry_date: str = Field(..., max_length=10)
    entry_type: Literal["income", "expense"]
    description: str = Field("", max_length=500)
    amount: float = Field(..., gt=0)
    category: str = Field("", max_length=50)
    sort_order: int = Field(0, ge=0, le=9999)
    items: List[PettyCashEntryItemIn] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def check_description_or_items(self):
        """收入必填摘要；支出無明細時必填摘要。"""
        desc = (self.description or "").strip()
        has_items = len(self.items) > 0
        if self.entry_type == "income" and not desc:
            raise ValueError("收入紀錄摘要不可空白")
        if self.entry_type == "expense" and not has_items and not desc:
            raise ValueError("支出紀錄（無明細項目）摘要不可空白")
        self.description = desc
        return self


class PettyCashReportIn(BaseModel):
    """零用金月報本體（PUT 採全量替換，與 QuotationIn 同模式）。"""
    report_type: Literal["general"] = "general"
    start_date: str = Field(..., max_length=10)
    end_date: str = Field(..., max_length=10)
    filename_text: str = Field(..., min_length=1, max_length=50)
    upload_person: str = Field(..., min_length=1, max_length=50)
    prepared_by: str = Field(..., min_length=1, max_length=50)
    opening_balance: float = Field(0, ge=0)
    opening_balance_source: Literal["auto", "manual"] = "manual"
    status: Literal["draft", "completed"] = "draft"
    entries: List[PettyCashEntryIn] = Field(default_factory=list, max_length=500)

    @field_validator("filename_text", "upload_person", "prepared_by")
    @classmethod
    def non_blank_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("不可為空白")
        return value


class PettyCashOptionIn(BaseModel):
    report_type: Literal["general", "engineering"]
    option_type: Literal["category", "group"]
    name: str = Field(..., min_length=1, max_length=100)
    sort_order: int = Field(0, ge=0, le=9999)

    @field_validator("name")
    @classmethod
    def option_name(cls, value):
        value = value.strip()
        if not value:
            raise ValueError("選單名稱不可空白")
        return value


class PettyCashOptionUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    sort_order: Optional[int] = Field(None, ge=0, le=9999)
    is_active: Optional[bool] = None

    @field_validator("name")
    @classmethod
    def option_name(cls, value):
        value = value.strip()
        if not value:
            raise ValueError("選單名稱不可空白")
        return value

class EngineeringReceiptIn(BaseModel):
    tax_id_mark: str = Field("", max_length=50)
    receipt_number: str = Field("", max_length=100)
    amount: Decimal = Field(..., ge=Decimal("0"), max_digits=12, decimal_places=2)
    details: List[str] = Field(default_factory=list, max_length=100)
    sort_order: int = Field(0, ge=0, le=9999)

    @field_validator("details")
    @classmethod
    def validate_details(cls, values):
        cleaned = []
        for value in values:
            value = (value or "").strip()
            if not value:
                raise ValueError("細項不可空白")
            cleaned.append(value)
        return cleaned


class EngineeringGroupIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    sort_order: int = Field(0, ge=0, le=9999)
    receipts: List[EngineeringReceiptIn] = Field(default_factory=list, max_length=500)

    @field_validator("name")
    @classmethod
    def clean_name(cls, value):
        value = value.strip()
        if not value: raise ValueError("項目名稱不可空白")
        return value


class EngineeringCategoryIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    sort_order: int = Field(0, ge=0, le=9999)
    groups: List[EngineeringGroupIn] = Field(default_factory=list, max_length=100)

    @field_validator("name")
    @classmethod
    def clean_name(cls, value):
        value = value.strip()
        if not value: raise ValueError("分類名稱不可空白")
        return value


class EngineeringReportIn(BaseModel):
    report_type: Literal["engineering"]
    start_date: str = Field(..., max_length=10)
    end_date: str = Field(..., max_length=10)
    upload_person: str = Field(..., min_length=1, max_length=50)
    prepared_by: str = Field(..., min_length=1, max_length=50)
    filename_text: str = Field("", max_length=50)
    status: Literal["draft", "completed"] = "draft"
    categories: List[EngineeringCategoryIn] = Field(default_factory=list, max_length=100)

    @field_validator("upload_person", "prepared_by", "filename_text")
    @classmethod
    def clean_report_text(cls, value):
        return (value or "").strip()

    @model_validator(mode="after")
    def validate_report(self):
        try:
            start = date.fromisoformat(self.start_date)
            end = date.fromisoformat(self.end_date)
        except (TypeError, ValueError) as exc:
            raise ValueError("日期格式必須為 YYYY-MM-DD") from exc
        self.start_date = start.isoformat()
        self.end_date = end.isoformat()
        if start > end:
            raise ValueError("開始日期不可晚於結束日期")
        if not self.upload_person or not self.prepared_by:
            raise ValueError("報表歸屬人與製表人不可空白")
        return self


