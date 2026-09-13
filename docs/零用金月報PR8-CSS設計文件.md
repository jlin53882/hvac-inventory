# 零用金月報 PR8 CSS 設計文件

## 1. 文件定位

本文件是 PR8 零用金月報前端 CSS 的設計與維護規範。

適用範圍：

- 一般零用金
- 工程零用金
- 共用 Report Shell
- Desktop／Mobile responsive layout
- 列表、檢視頁、editor、modal、KPI、操作選單

本次 CSS 重構不改 API、Database、計算邏輯、權限或報表資料模型。

## 2. CSS 檔案責任

### Base

```text
static/css/style.petty-cash.css
```

只放零用金共用基礎樣式：

- page shell
- filter／toolbar
- card／table 基礎樣式
- modal 基礎樣式
- general／engineering editor 基礎元件
- 共用狀態、按鈕、欄位樣式

### PR8 override

```text
static/css/style.petty-cash-pr8.css
```

只放 PR8 變更與延伸樣式：

- 報表查詢列表欄位與 sticky header
- dynamic content layout
- general／engineering detail alignment
- KPI responsive layout
- mobile variable text wrapping
- engineering receipt accordion
- general editor clickable row
- PR8 more menu stacking layer
- PR8 step tab interaction styling

載入順序固定為：

```html
<link rel="stylesheet" href="/static/css/style.petty-cash.css">
<link rel="stylesheet" href="/static/css/style.petty-cash-pr8.css">
```

Base 必須先載入，PR8 override 後載入。

## 3. Cascade 規則

不要再把新的 PR8 修正直接 append 到 base 檔案底部。

新增樣式前先判斷：

1. 是所有零用金頁面都需要的 base 元件？放 `style.petty-cash.css`
2. 是 PR8 特有的列表、dynamic layout、detail 或 responsive 修正？放 `style.petty-cash-pr8.css`
3. 是 breakpoint 差異？集中放在 PR8 檔案對應的 media block
4. 是一般與工程共同的欄位？使用同一組 selector 與欄位軌道

同一個 selector 不應在多個非必要區塊重複定義同一個 property。

## 4. 欄位對齊規則

### 共用單據明細

檢視頁只有兩欄：

```text
項次 | 細項
```

不得保留不存在的金額第三欄。Desktop 與 Mobile 的 heading／row 必須使用相同欄位數。

「細項」heading 與明細文字都靠左，不能使用 `span:last-child { text-align: right; }` 造成 heading 與內容分離。

### General editor

`pc-items-header` 與 `pc-item-row` 必須使用相同 column tracks。調整資料列欄寬時，標題列必須同步調整。

## 5. Responsive 規則

Mobile media query 只能覆蓋真正需要改變的 property，不得重新宣告一套與 Desktop 不同的完整 grid，除非欄位結構確實改變。

檢視頁的 detail list：

```text
Desktop：48px minmax(0, 1fr)
Mobile：32px minmax(0, 1fr)
```

不要在後段 media query 把它恢復為三欄。

## 6. 測試與修改流程

1. 修改前先跑 GitNexus impact。
2. 確認 CSS 來源檔與 index 載入順序。
3. 修改後同步更新 `tests/test_frontend_assets.py` contract。
4. CSS 行尾依檔案既有格式保存，不可造成整檔假 diff。
5. 跑 frontend／security 測試。
6. commit 前跑 `gitnexus detect-changes --scope all`。
7. 純視覺修正收尾須標記「不需新增 business logic 測試」，但欄位結構或 responsive 行為改動仍需 contract assertion。

## 7. 禁止事項

- 不在 `style.petty-cash.css` 末尾持續追加 PR8 override
- 不為 general／engineering 建立兩份相同 CSS
- 不用新的 generic builder 取代既有 business renderer
- 不用 `!important` 掩蓋 selector cascade 問題
- 不為了 desktop 修正破壞 mobile layout
- 不把 API／DB／計算邏輯問題用 CSS 掩蓋
