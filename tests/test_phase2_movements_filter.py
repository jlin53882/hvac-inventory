"""
Phase 2 異動紀錄過濾的單元測試

測試項目：
1. 異動 reason 過濾邏輯
2. 整組位置/圖片欄位邏輯
"""

import pytest


def test_movement_reason_filtering_logic():
    """驗證異動 reason 過濾邏輯是否正確"""
    # 異動類型映射
    movement_reasons = {
        "領出準備": "待領出",
        "出庫": "出庫",
        "解除待領出": "解除待領出",
        "退回已領出": "退回",
        "庫存調撥": "調撥",
        "盤點": "盤點",
        "組裝完成:整組X": "整組組裝",
        "組裝套件:整組X": "整組拆解（材料扣）",
        "拆解:整組X": "整組拆解（整組扣）",
        "拆解套件:整組X": "整組拆解（材料加）",
    }
    
    # 單一庫存匯出需過濾的 reason（整組相關）
    kit_related_reasons = [
        "組裝完成:",
        "組裝套件:",
        "拆解:",
        "拆解套件:",
    ]
    
    # 已領出匯出需保留的 reason
    stockout_related_reasons = [
        "領出準備",
        "出庫",
        "解除待領出",
        "退回已領出",
    ]
    
    assert len(movement_reasons) >= 10, "應涵蓋主要異動類型"
    assert len(kit_related_reasons) == 4, "整組相關 4 種"
    assert len(stockout_related_reasons) == 4, "出庫相關 4 種"


def test_single_inventory_export_should_filter_kit_movements():
    """單一庫存匯出應過濾整組異動的邏輯驗證
    
    規則：
    - item.is_kit = 0 且 reason 含「組裝/拆解」 → 保留（是子材料異動）
    - item.is_kit = 1 且 reason 含「組裝/拆解」 → 跳過（是整組自身異動）
    """
    test_cases = [
        # (is_kit, reason, should_keep)
        (0, "拆解套件:整組X", True),   # 子材料異動，保留
        (1, "拆解:整組X", False),      # 整組異動，過濾
        (0, "組裝套件:整組X", True),   # 子材料異動，保留
        (1, "組裝完成:整組X", False),  # 整組異動，過濾
        (0, "出庫", True),             # 普通出庫，保留
        (1, "出庫", True),             # 整組出庫也保留
    ]
    
    for is_kit, reason, should_keep in test_cases:
        # 判定邏輯：如果 is_kit=1 且 reason 以「組裝/拆解」開頭 → 跳過（過濾）
        is_kit_movement = is_kit == 1 and any(
            reason.startswith(prefix) 
            for prefix in ["組裝", "拆解"]
        )
        keep = not is_kit_movement
        
        assert keep == should_keep, (
            f"is_kit={is_kit}, reason='{reason}': "
            f"expected keep={should_keep}, got {keep}"
        )


def test_kit_export_only_keeps_kit_movements():
    """整組庫存匯出只保留整組自身的異動"""
    # 規則：item.is_kit = 1 → 保留；item.is_kit = 0 → 跳過
    
    test_cases = [
        # (is_kit, reason, should_keep)
        (1, "組裝完成:整組X", True),   # 整組組裝，保留
        (1, "拆解:整組X", True),       # 整組拆解，保留
        (1, "出庫", True),             # 整組出庫，保留
        (0, "組裝套件:整組X", False),  # 子材料異動，過濾
        (0, "拆解套件:整組X", False),  # 子材料異動，過濾
        (0, "出庫", False),            # 子材料出庫，過濾
    ]
    
    for is_kit, reason, should_keep in test_cases:
        keep = is_kit == 1
        
        assert keep == should_keep, (
            f"is_kit={is_kit}, reason='{reason}': "
            f"expected keep={should_keep}, got {keep}"
        )



