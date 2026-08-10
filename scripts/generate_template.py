"""
產生「庫存管理系統」優化版 Excel 模板
==============================================

包含 3 個工作表：
1. 品項主檔 (parts) - 所有零件/材料的單一主檔
2. 倉位表 (locations) - 倉庫的實體位置（含 QR Code 欄位、實體照片欄位）
3. 位置庫存 (location_stock) - 品項與位置的對應（支援多位置）

設計原則：
- 每個欄位獨立（不混在一起）
- 分類與單位用下拉選單（保證一致性）
- 倉位代碼統一格式（LOC-XXX-XXX-XXX）
- 照片欄位統一放在 locations 表（倉位照片，不是零件照片）
"""

from openpyxl import Workbook
from openpyxl.styles import (
    Font, PatternFill, Alignment, Border, Side, Protection
)
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.utils import get_column_letter
from openpyxl.drawing.image import Image as XLImage
from openpyxl.comments import Comment
import os

OUTPUT_PATH = r"C:\Users\admin\workspace\hvac-inventory\03-優化版庫存模板.xlsx"

# ============================================================
# 樣式定義
# ============================================================
HEADER_FONT = Font(name="微軟正黑體", size=12, bold=True, color="FFFFFF")
HEADER_FILL = PatternFill("solid", fgColor="2E5C8A")  # 深藍
SUBHEADER_FONT = Font(name="微軟正黑體", size=11, bold=True, color="000000")
SUBHEADER_FILL = PatternFill("solid", fgColor="E8F0F8")  # 淺藍
DATA_FONT = Font(name="微軟正黑體", size=10)
DATA_ALIGN_CENTER = Alignment(horizontal="center", vertical="center", wrap_text=True)
DATA_ALIGN_LEFT = Alignment(horizontal="left", vertical="center", wrap_text=True)
THIN_BORDER = Border(
    left=Side(style="thin", color="999999"),
    right=Side(style="thin", color="999999"),
    top=Side(style="thin", color="999999"),
    bottom=Side(style="thin", color="999999"),
)

# ============================================================
# 工作表 1：品項主檔 (parts)
# ============================================================
def build_parts_sheet(wb):
    """建立「品項主檔」工作表：寫入欄位標題、分類/單位下拉選單、範例資料與使用說明。"""
    ws = wb.active
    ws.title = "品項主檔"

    # 欄位定義
    headers = [
        ("編號", 12),           # P-0001
        ("品項名稱", 28),
        ("分類", 14),            # 下拉選單
        ("品牌", 12),
        ("規格/型號", 22),
        ("基本單位", 10),        # 下拉選單
        ("當前庫存", 10),
        ("低庫存警示值", 12),
        ("主要位置代碼", 16),    # 對應 locations 表
        ("備註", 30),
    ]

    # 寫入標題列
    for col_idx, (header, width) in enumerate(headers, start=1):
        cell = ws.cell(row=1, column=col_idx, value=header)
        cell.font = HEADER_FONT
        cell.fill = HEADER_FILL
        cell.alignment = DATA_ALIGN_CENTER
        cell.border = THIN_BORDER
        ws.column_dimensions[get_column_letter(col_idx)].width = width

    ws.row_dimensions[1].height = 32

    # 凍結首列
    ws.freeze_panes = "A2"

    # 分類下拉選單
    categories = [
        "控制基板", "遙控器", "銅管", "電線/電纜",
        "接頭/管帽", "冷媒/藥劑", "工具", "耗材/雜項"
    ]
    cat_dv = DataValidation(
        type="list",
        formula1=f'"{",".join(categories)}"',
        allow_blank=False,
        showDropDown=False,  # False = 顯示下拉箭頭（Excel 怪邏輯）
    )
    cat_dv.error = "請從下拉選單選擇分類"
    cat_dv.errorTitle = "分類錯誤"
    cat_dv.prompt = "選擇材料分類"
    cat_dv.promptTitle = "分類"
    ws.add_data_validation(cat_dv)
    cat_dv.add(f"C2:C1000")

    # 單位下拉選單
    units = ["個", "罐", "瓶", "包", "組", "米", "條", "捲", "盤", "套"]
    unit_dv = DataValidation(
        type="list",
        formula1=f'"{",".join(units)}"',
        allow_blank=False,
        showDropDown=False,
    )
    unit_dv.error = "請從下拉選單選擇單位"
    unit_dv.errorTitle = "單位錯誤"
    ws.add_data_validation(unit_dv)
    unit_dv.add(f"F2:F1000")

    # 範例資料（從你 Excel 整理出來的）
    examples = [
        # 編號, 品項名稱, 分類, 品牌, 規格, 單位, 庫存, 警示, 主要位置, 備註
        ("P-0001", "K031224 變頻控制基板", "控制基板", "大金", "220V 室內機", "個", 3, 1, "LOC-1F-A1-01", "無外觀瑕疵"),
        ("P-0002", "ARC433A69 遙控器", "遙控器", "大金", "通用型", "個", 1, 2, "LOC-1F-A1-02", ""),
        ("P-0003", "757F PWR 遙控器", "遙控器", "大金", "分離式", "個", 2, 1, "LOC-1F-A1-02", ""),
        ("P-0004", "MIDEA 控制基板", "控制基板", "美的", "VRF 系統", "個", 2, 1, "LOC-1F-A2-01", ""),
        ("P-0005", "格力變頻基板", "控制基板", "格力", "Q款", "個", 1, 1, "LOC-1F-A2-02", "RH CC"),
        ("P-0006", "銅管 95-114mm", "銅管", "上華工業", "1/4\"", "米", 120, 30, "LOC-1F-B1-01", ""),
        ("P-0007", "銅管 100-130mm", "銅管", "上華工業", "3/8\"", "米", 80, 20, "LOC-1F-B1-02", ""),
        ("P-0008", "銅管 19-14mm", "銅管", "上華工業", "1/2\"", "米", 50, 15, "LOC-1F-B1-03", ""),
        ("P-0009", "銅接帽 1\"", "接頭/管帽", "上華", "1 吋", "個", 30, 10, "LOC-1F-B2-01", ""),
        ("P-0010", "銅接帽 1-1/4\"", "接頭/管帽", "上華", "1.25 吋", "個", 20, 5, "LOC-1F-B2-02", ""),
        ("P-0011", "不鏽鋼接管", "接頭/管帽", "白博士", "通用", "個", 15, 5, "LOC-1F-B2-03", ""),
        ("P-0012", "600V 絕緣電纜 8mm²", "電線/電纜", "太平洋", "8 平方", "米", 200, 50, "LOC-2F-C1-01", ""),
        ("P-0013", "UL2464 訊號線", "電線/電纜", "3M", "24AWG", "米", 100, 30, "LOC-2F-C1-02", ""),
        ("P-0014", "PVC 預先車組", "電線/電纜", "上華", "通用", "米", 60, 20, "LOC-2F-C1-03", ""),
        ("P-0015", "鏈壓切管刀", "工具", "里奇", "1/8-1-3/8\"", "個", 2, 1, "LOC-WK-01", ""),
        ("P-0016", "瓦斯噴槍", "工具", "百得", "高溫型", "個", 1, 1, "LOC-WK-02", ""),
        ("P-0017", "氣壓鑽床", "工具", "麥克", "重型", "個", 1, 1, "LOC-WK-03", ""),
        ("P-0018", "PU FOAM 發泡劑", "耗材/雜項", "3M", "750ml", "罐", 5, 2, "LOC-OF-01", ""),
        ("P-0019", "PP 編織鏈帶", "冷媒/藥劑", "3M", "通用", "罐", 3, 1, "LOC-OF-02", "切黑鐵用"),
        ("P-0020", "滴漏袋", "耗材/雜項", "通用", "中", "包", 10, 3, "LOC-OF-03", ""),
    ]

    # 寫入範例資料
    for row_idx, example in enumerate(examples, start=2):
        for col_idx, value in enumerate(example, start=1):
            cell = ws.cell(row=row_idx, column=col_idx, value=value)
            cell.font = DATA_FONT
            cell.alignment = DATA_ALIGN_CENTER if col_idx != 2 and col_idx != 10 else DATA_ALIGN_LEFT
            cell.border = THIN_BORDER

    # 加上欄位說明（用註解）
    note_cells = {
        "A1": "系統自動產生 P-XXXX 格式編號\n新增品項時留空，匯入時自動編號",
        "I1": "對應「倉位表」的代碼欄位\n請填入主要位置的代碼",
    }
    for coord, note in note_cells.items():
        ws[coord].comment = Comment(note, "系統")

    # 加上使用說明區
    ws.cell(row=24, column=1, value="📌 使用說明：")
    ws.cell(row=24, column=1).font = Font(name="微軟正黑體", size=11, bold=True, color="C00000")
    notes_text = [
        "1. 編號欄可留空，匯入時系統會自動產生 P-XXXX 格式編號",
        "2. 分類與單位必須從下拉選單選擇，確保一致性",
        "3. 主要位置代碼要對應到「倉位表」的代碼欄",
        "4. 同品項可放在多個位置，請在「位置庫存」表加新列",
        "5. 進貨單價/供應商目前先不處理，欄位保留中",
    ]
    for i, note in enumerate(notes_text, start=25):
        ws.cell(row=i, column=1, value=note).font = Font(name="微軟正黑體", size=10)

    print(f"✅ 品項主檔：{len(examples)} 筆範例資料")


# ============================================================
# 工作表 2：倉位表 (locations)
# ============================================================
def build_locations_sheet(wb):
    """建立「倉位表」工作表：寫入倉位欄位、樓層下拉選單、範例倉位與使用說明。"""
    ws = wb.create_sheet("倉位表")

    # 欄位定義
    headers = [
        ("代碼", 18),            # LOC-XXX-XXX-XXX
        ("倉位描述", 24),        # 人眼可讀的位置說明
        ("樓層", 8),             # 1F / 2F / B1
        ("區域", 12),            # 長排 / 工作室 / 工部
        ("架子/層", 10),         # 第一層 / 第二層
        ("位置編號", 12),        # 第一個 / 第二個
        ("QR Code 內容", 40),    # 自動產生的網址
        ("實體照片", 18),        # 圖檔路徑或照片
        ("備註", 30),
    ]

    for col_idx, (header, width) in enumerate(headers, start=1):
        cell = ws.cell(row=1, column=col_idx, value=header)
        cell.font = HEADER_FONT
        cell.fill = HEADER_FILL
        cell.alignment = DATA_ALIGN_CENTER
        cell.border = THIN_BORDER
        ws.column_dimensions[get_column_letter(col_idx)].width = width

    ws.row_dimensions[1].height = 32
    ws.freeze_panes = "A2"

    # 樓層下拉選單
    floors = ["1F", "2F", "3F", "B1", "B2", "頂樓"]
    floor_dv = DataValidation(
        type="list",
        formula1=f'"{",".join(floors)}"',
        allow_blank=False,
        showDropDown=False,
    )
    floor_dv.error = "請從下拉選單選擇樓層"
    ws.add_data_validation(floor_dv)
    floor_dv.add("C2:C1000")

    # 範例倉位（從你 Excel 整理出來）
    examples = [
        # 代碼, 描述, 樓層, 區域, 架子, 位置, QR Code, 照片, 備註
        ("LOC-1F-A1-01", "左至右 長排 第一層 第一個", "1F", "長排", "第一層", "第一個",
         "http://你的網域/locations/LOC-1F-A1-01", "[照片路徑]", "控制基板專區"),
        ("LOC-1F-A1-02", "左至右 長排 第一層 第二個", "1F", "長排", "第一層", "第二個",
         "http://你的網域/locations/LOC-1F-A1-02", "[照片路徑]", "遙控器專區"),
        ("LOC-1F-A2-01", "左至右 長排 第二層 第一個", "1F", "長排", "第二層", "第一個",
         "http://你的網域/locations/LOC-1F-A2-01", "[照片路徑]", ""),
        ("LOC-1F-A2-02", "左至右 長排 第二層 第二個", "1F", "長排", "第二層", "第二個",
         "http://你的網域/locations/LOC-1F-A2-02", "[照片路徑]", ""),
        ("LOC-1F-B1-01", "銅管區 第一格", "1F", "銅管區", "第一層", "第一格",
         "http://你的網域/locations/LOC-1F-B1-01", "[照片路徑]", "銅管 95-114mm"),
        ("LOC-1F-B1-02", "銅管區 第二格", "1F", "銅管區", "第一層", "第二格",
         "http://你的網域/locations/LOC-1F-B1-02", "[照片路徑]", "銅管 100-130mm"),
        ("LOC-1F-B1-03", "銅管區 第三格", "1F", "銅管區", "第一層", "第三格",
         "http://你的網域/locations/LOC-1F-B1-03", "[照片路徑]", "銅管 19-14mm"),
        ("LOC-1F-B2-01", "接頭區 第一格", "1F", "接頭區", "第一層", "第一格",
         "http://你的網域/locations/LOC-1F-B2-01", "[照片路徑]", "銅接帽 1\""),
        ("LOC-1F-B2-02", "接頭區 第二格", "1F", "接頭區", "第一層", "第二格",
         "http://你的網域/locations/LOC-1F-B2-02", "[照片路徑]", "銅接帽 1-1/4\""),
        ("LOC-1F-B2-03", "接頭區 第三格", "1F", "接頭區", "第一層", "第三格",
         "http://你的網域/locations/LOC-1F-B2-03", "[照片路徑]", "不鏽鋼接管"),
        ("LOC-2F-C1-01", "電線區 第一格", "2F", "電線區", "第一層", "第一格",
         "http://你的網域/locations/LOC-2F-C1-01", "[照片路徑]", "600V 絕緣電纜"),
        ("LOC-2F-C1-02", "電線區 第二格", "2F", "電線區", "第一層", "第二格",
         "http://你的網域/locations/LOC-2F-C1-02", "[照片路徑]", "UL2464"),
        ("LOC-2F-C1-03", "電線區 第三格", "2F", "電線區", "第一層", "第三格",
         "http://你的網域/locations/LOC-2F-C1-03", "[照片路徑]", "PVC 預先車組"),
        ("LOC-WK-01", "工作室 第一格", "1F", "工作室", "第一層", "第一個",
         "http://你的網域/locations/LOC-WK-01", "[照片路徑]", "工具-鏈壓切管刀"),
        ("LOC-WK-02", "工作室 第二格", "1F", "工作室", "第一層", "第二個",
         "http://你的網域/locations/LOC-WK-02", "[照片路徑]", "工具-瓦斯噴槍"),
        ("LOC-WK-03", "工作室 第三格", "1F", "工作室", "第一層", "第三個",
         "http://你的網域/locations/LOC-WK-03", "[照片路徑]", "工具-氣壓鑽床"),
        ("LOC-OF-01", "辦公區 第一個", "1F", "辦公區", "第一層", "第一個",
         "http://你的網域/locations/LOC-OF-01", "[照片路徑]", "耗材-PU FOAM"),
        ("LOC-OF-02", "辦公區 第二個", "1F", "辦公區", "第一層", "第二個",
         "http://你的網域/locations/LOC-OF-02", "[照片路徑]", "耗材-PP 編織鏈帶"),
        ("LOC-OF-03", "辦公區 第三個", "1F", "辦公區", "第一層", "第三個",
         "http://你的網域/locations/LOC-OF-03", "[照片路徑]", "耗材-滴漏袋"),
    ]

    for row_idx, example in enumerate(examples, start=2):
        for col_idx, value in enumerate(example, start=1):
            cell = ws.cell(row=row_idx, column=col_idx, value=value)
            cell.font = DATA_FONT
            cell.alignment = DATA_ALIGN_CENTER if col_idx != 2 and col_idx != 9 else DATA_ALIGN_LEFT
            cell.border = THIN_BORDER

    # 加上使用說明
    ws.cell(row=23, column=1, value="📌 使用說明：")
    ws.cell(row=23, column=1).font = Font(name="微軟正黑體", size=11, bold=True, color="C00000")
    notes_text = [
        "1. 代碼格式：LOC-{樓層}-{區域}-{位置}，例如 LOC-1F-A1-01",
        "2. QR Code 內容會由系統自動產生，匯入時填入正確網域即可",
        "3. 實體照片欄位填入照片檔案路徑或相對路徑（例如 ./photos/001.jpg）",
        "4. 樓層必須從下拉選單選擇",
    ]
    for i, note in enumerate(notes_text, start=24):
        ws.cell(row=i, column=1, value=note).font = Font(name="微軟正黑體", size=10)

    print(f"✅ 倉位表：{len(examples)} 筆範例資料")


# ============================================================
# 工作表 3：位置庫存 (location_stock) - 品項與位置的對應
# ============================================================
def build_location_stock_sheet(wb):
    """建立「位置庫存」工作表：寫入品項↔位置對應的範例資料與使用說明（支援一品項多位置）。"""
    ws = wb.create_sheet("位置庫存")

    headers = [
        ("位置代碼", 18),        # 對應 locations 表
        ("品項編號", 12),         # 對應 parts 表
        ("數量", 8),
        ("備註", 30),
    ]

    for col_idx, (header, width) in enumerate(headers, start=1):
        cell = ws.cell(row=1, column=col_idx, value=header)
        cell.font = HEADER_FONT
        cell.fill = HEADER_FILL
        cell.alignment = DATA_ALIGN_CENTER
        cell.border = THIN_BORDER
        ws.column_dimensions[get_column_letter(col_idx)].width = width

    ws.row_dimensions[1].height = 32
    ws.freeze_panes = "A2"

    # 範例：對應剛剛建立的 parts 和 locations
    examples = [
        # 位置代碼, 品項編號, 數量, 備註
        ("LOC-1F-A1-01", "P-0001", 3, "主要存量"),
        ("LOC-1F-A1-02", "P-0002", 1, ""),
        ("LOC-1F-A1-02", "P-0003", 2, ""),
        ("LOC-1F-A2-01", "P-0004", 2, ""),
        ("LOC-1F-A2-02", "P-0005", 1, "RH CC"),
        ("LOC-1F-B1-01", "P-0006", 120, ""),
        ("LOC-1F-B1-02", "P-0007", 80, ""),
        ("LOC-1F-B1-03", "P-0008", 50, ""),
        ("LOC-1F-B2-01", "P-0009", 30, ""),
        ("LOC-1F-B2-02", "P-0010", 20, ""),
        ("LOC-1F-B2-03", "P-0011", 15, ""),
        ("LOC-2F-C1-01", "P-0012", 200, ""),
        ("LOC-2F-C1-02", "P-0013", 100, ""),
        ("LOC-2F-C1-03", "P-0014", 60, ""),
        ("LOC-WK-01", "P-0015", 2, ""),
        ("LOC-WK-02", "P-0016", 1, ""),
        ("LOC-WK-03", "P-0017", 1, ""),
        ("LOC-OF-01", "P-0018", 5, ""),
        ("LOC-OF-02", "P-0019", 3, "切黑鐵用"),
        ("LOC-OF-03", "P-0020", 10, ""),
        # 範例：同品項可放多個位置
        ("LOC-2F-C1-01", "P-0012", 50, "備用存量"),
    ]

    for row_idx, example in enumerate(examples, start=2):
        for col_idx, value in enumerate(example, start=1):
            cell = ws.cell(row=row_idx, column=col_idx, value=value)
            cell.font = DATA_FONT
            cell.alignment = DATA_ALIGN_CENTER if col_idx != 4 else DATA_ALIGN_LEFT
            cell.border = THIN_BORDER

    # 加上使用說明
    ws.cell(row=25, column=1, value="📌 使用說明：")
    ws.cell(row=25, column=1).font = Font(name="微軟正黑體", size=11, bold=True, color="C00000")
    notes_text = [
        "1. 這是「品項 ↔ 位置」的對應表，一個品項可對應多個位置",
        "2. 位置代碼要對應「倉位表」的代碼欄",
        "3. 品項編號要對應「品項主檔」的編號欄",
        "4. 系統會自動彙總所有位置的數量，算出該品項總庫存",
        "5. 如果一個品項只有一個位置，就只有一筆記錄",
    ]
    for i, note in enumerate(notes_text, start=26):
        ws.cell(row=i, column=1, value=note).font = Font(name="微軟正黑體", size=10)

    print(f"✅ 位置庫存：{len(examples)} 筆範例資料")


# ============================================================
# 主程式
# ============================================================
def main():
    """主程式：依序建立品項主檔、倉位表、位置庫存三個工作表，儲存到 OUTPUT_PATH 並顯示檔案資訊。"""
    wb = Workbook()

    # 1. 品項主檔
    build_parts_sheet(wb)

    # 2. 倉位表
    build_locations_sheet(wb)

    # 3. 位置庫存
    build_location_stock_sheet(wb)

    # 確保輸出目錄存在
    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)

    # 儲存
    wb.save(OUTPUT_PATH)

    # 顯示檔案資訊
    size = os.path.getsize(OUTPUT_PATH)
    print(f"\n🎉 模板產生完成！")
    print(f"📁 檔案位置：{OUTPUT_PATH}")
    print(f"📊 檔案大小：{size:,} bytes ({size/1024:.1f} KB)")


if __name__ == "__main__":
    main()
