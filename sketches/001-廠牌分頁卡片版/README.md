# Variant: 廠牌分頁卡片版（手機優先）

## Design stance
手機為主的庫存操作介面——頂部廠牌分頁橫向滑動，品項用卡片呈現，大顆 +/− 按鈕適合手指點擊。

## Key choices
- Layout: 頂部 sticky 搜尋 + 廠牌 tab（橫向捲動）+ 卡片列表（依位置分組）
- Typography: 系統字型，名稱 14px 粗體，次要資訊 11-12px
- Color: 深藍主色（#2d5a8e），＋綠 − 紅 直覺配色
- Interaction: 廠牌 tab 切換、搜尋即時過濾、+/− 即時改數量、底部儲存列

## Trade-offs
- Strong at: 手機單手操作、直覺、快速加減
- Weak at: 資訊密度低（一頁看不到太多品項）、大量編輯效率低

## Best for
- 師傅在倉庫/現場用手機快速查料、領料、加減庫存
