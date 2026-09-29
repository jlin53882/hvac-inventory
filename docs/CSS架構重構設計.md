# CSS 架構重構設計（頁面樣式互相衝突的根因與重整方案）

> 建立：2026-09-28
> 狀態：**已實作，進入長期維護**（P0–P8 完成於 PR #36；決策見 §9）
>
> 實際的可執行規範以 `tests/test_css_architecture.py`、`tests/visual/*`、`tests/button_contract.json` 與 `.github/workflows/ci.yml` 為準；本文件描述預期架構與維護原則。兩者不一致視為架構漂移（architecture drift），必須修正其中一方。
> 範圍：`static/css/*.css`（15 檔 / 5,560 行）、`static/*.html` 內嵌 `<style>` 與 `style=""`、JS 寫入的 inline style、對應的 pytest 斷言

---

## 1. 現況盤點（實測數據）

| 項目 | 數值 | 說明 |
|---|---|---|
| CSS 檔數 / 總行數 | 15 檔 / 5,560 行 | `style.core.css` 1,079 行、`style.inventory.css` 1,449 行最大 |
| `index.html` 載入方式 | 15 個 `<link>` **全部同時載入** | 所有頁籤共用同一份 DOM，任何一個檔的規則都會作用到所有頁籤 |
| 「在 2 個以上檔案被當作主體設定」的 class | **108 個** | 見 §2.1 |
| 完全相同的 selector 在 2 檔重複定義 | 6 組（`.col-headers*`，core ↔ kit） | 見 §2.2 |
| `!important` | 18 處（core 6、inventory 4、wpr 3、cal 2、quote 2、dsr 1） | 用來「打贏」別的檔 |
| CSS 變數（`var(--x)`） | 只有 6 處；**沒有任何 `:root` token** | 顏色硬寫 163 種 hex |
| 斷點寫法 | 14 種（`767px`/`768px`/`639px`/`960px`/`1200px`/`1440px`/`390px`… 且有無空白兩種寫法並存） | 同一斷點的規則散在各檔，順序難以預測 |
| z-index 值 | 30 種以上（1 ~ 10000） | 無分層規範，modal/toast/drawer 互蓋 |
| HTML 內嵌 `<style>` | settings 368 行、permissions 183 行、login 212 行 | 這些頁載入 core 後再自己覆蓋 |
| HTML `style=""` | index 51、settings 30、permissions 7 | 優先權最高，CSS 改了看不到效果 |
| JS 寫 inline style | settings.js 70、photo.js 46、signed-reports.js 32、quotation-upload.js 32、calendar.js 27… | 同上 |

---

## 2. 為什麼改 A 頁會壞 B 頁（根因）

### 2.1 根因一：所有頁籤共用同一個 cascade，但只有一半的檔案有做範圍限制

`app.js switchTab()` 會在 `#content` 上切換 `kit-content` / `stocktake-content` / `wpr-content`… 等 class，理論上可以當「頁面範圍」。但各檔採用的範圍策略**不一致**：

| 檔案 | 範圍策略 | 特異度 |
|---|---|---|
| `style.work-progress.css` | `#content.wpr-content .wpr-*` | 1-2-0（很高） |
| `style.signed-reports.css` / `style.quotation-upload.css` | `#content.dsr-content`、`#content.quotation-upload-content` 只用在外框 | 混合 |
| `style.kit.css` | 大部分 `.kit-content .kit-*`，**但 `.col-headers` 沒加範圍** | 0-1-0 ~ 0-2-0 |
| `style.inventory.css` | `.inventory-content .xxx` 覆蓋 core 的同名 class | 0-2-0 |
| `style.core.css` | 完全不加範圍；且混了大量「庫存頁專用」規則（`.item-card`、`.filter-*`、`.loc-*`、`.qty-*`、`.stk-tab`、`.kit-name`…） | 0-1-0 |

結果：**core 裡的庫存頁規則會漏到每一頁**，inventory.css 再用較高特異度蓋回來。任何人改 core 的 `.item-card` / `.data-table` / `.btn-sm`，都會同時影響盤點、已領出、整組、設定頁。

core ↔ inventory 重複定義的 class 就有 60 個以上（`.item-card`、`.filter-panel`、`.data-table`、`.btn-sm`、`.btn-ghost`、`.modal`、`.qty-control`、`.status-*`、`.view-toggle`…）。

### 2.2 根因二：Modal / Overlay 不在 `#content` 裡，頁面範圍罩不到

`index.html` 的 modal（`#add-modal`、`#edit-modal`、整組 modal…）是 `#content` 的兄弟節點，所以 `.kit-content …` 這種範圍**對 modal 無效**。各模組只好寫「不加範圍」的全域規則，互相踩：

**實例（目前就存在的 bug 型態）**：`.col-headers` 在三個地方被設定——

1. `style.core.css:350` → `.ch-cabinet { flex:1 }`、`.ch-qty { width:60px }`
2. `style.kit.css:376`（**未加範圍**）→ `.ch-cabinet { flex:0 0 25% }`、`.ch-qty { flex:0 0 15% }`，因為載入順序較後，**直接改掉新增品項 / 編輯品項 modal 的欄寬**
3. `style.inventory-locations.css:10` → 再用 `#edit-modal .edit-stock-headers .ch-*` 改成 grid 蓋回來

`index.html` 中 `col-headers` 同時用在新增品項（L243）、編輯品項（L341）、整組（L648）三個 modal。改任何一層都會牽動另外兩個。

同樣型態：`.pc-modal*`（零用金一般 ↔ 工程）、`.pc-table-wrap`/`.pc-status`（零用金 ↔ 月報）、`.dsr-btn`/`.dsr-page-actions`（簽名報表 ↔ 報價單直接借用）、`.drag`（報價上傳 ↔ 簽名報表）、`.product-thumbnail-*`（inventory ↔ kit）、`.cphoto`（core ↔ kit ↔ stocktake）。

### 2.3 根因三：勝負靠「載入順序 + 特異度 + !important」三者疊加，沒人算得清

`index.html` 的 link 順序是 core → calendar → signed-reports → work-progress → quotation → … → inventory → kit → stocktake → stockout → inventory-locations。

- 同特異度時**後載入者勝**：kit 蓋 core、inventory-locations 蓋 kit。
- 特異度不同時順序失效：wpr 用 `#content.` 前綴（1-2-0），其他頁很難蓋過它，反之 wpr 也常被迫加 `!important`。
- `!important` 18 處（例如 quotation 的列印規則 `.sidebar, .header { display:none !important }`）一旦加上，下一個人只能再加。

所以「在 A 檔改一行、結果被 B 檔蓋掉」或「改了 A、B 也跟著變」都是必然的。

### 2.4 根因四：同一個斷點的規則散落 14 個檔、14 種寫法

`@media (max-width: 767px)` 出現 33 次、`(max-width:767px)` 6 次、還有 `768px`/`639px`/`390px`… 手機版規則的最終結果取決於「哪個檔的 media block 在後面」，而不是在哪個頁面。

### 2.5 根因五：沒有設計 token，視覺調整只能到處改 hex

163 種 hex、無 `:root` 變數。主色 `#2d5a8e` / `#1e3a5f` 在數十處硬寫；要「整體調深一點」只能全域搜尋取代，漏一處就不一致。

### 2.6 根因六：inline style 與內嵌 `<style>` 優先權最高

- `settings.html`、`permissions.html` 各自內嵌 180~370 行 `<style>`，跟 core 的同名 class（`.btn-primary`、`.modal`、`.topbar`…）互相覆蓋。
- JS 直接寫 `el.style.xxx`（settings.js 70 處、photo.js 46 處）：CSS 怎麼改都沒用，看起來像「CSS 沒生效 / 衝突」。

### 2.7 根因七：測試鎖的是「字串」不是「結果」

`tests/test_frontend_assets.py` 有大量 `assert "padding: 20px 20px 0;" in css` 這種**原文字串比對**，`read_css_all()` 只讀 core + calendar。這讓：

- 重構時即使視覺完全不變也會紅燈；
- 真正的視覺回歸（被別檔蓋掉）反而測不到。

---

## 3. 設計原則

1. **一個 class 只在一個檔案被定義**（元件檔或頁面檔擇一），用測試強制。
2. **頁面樣式一律在頁面範圍內**，範圍掛在 `<body data-page="…">`，**modal / overlay 也吃得到**。
3. **用 CSS Cascade Layers（`@layer`）決定勝負**，不再依賴載入順序與 `!important`。
4. **設計 token 集中**於 `:root`：顏色、字級、間距、圓角、陰影、z-index、斷點。
5. **斷點統一 3 個**：`sm < 640`、`md < 768`（手機/桌機切點）、`lg ≥ 960`，同一種寫法。
6. **inline style 只留「動態計算值」**（寬度百分比、顏色來自資料），其餘搬成 class。
7. **測試改鎖「結構契約」與「計算結果」**，不鎖原文字串。

---

## 4. 目標專案結構

```
static/
├── css/
│   ├── app.css                       # （可選）只放 @layer 宣告順序，第一個載入
│   ├── 0-tokens/
│   │   └── tokens.css                # :root 變數：色票、字級、間距、圓角、陰影、z-index、斷點註解
│   ├── 1-base/
│   │   ├── reset.css                 # * box-sizing、margin reset
│   │   └── typography.css            # body 字型、h1~h3、連結、表單元素預設
│   ├── 2-layout/
│   │   ├── shell.css                 # .sidebar / .main / .header / .h-search / .h-site / avatar menu
│   │   ├── bottom-nav.css            # 手機底部導覽
│   │   └── content.css               # #content 共用寬度、頁面 padding、[data-page] 外框差異
│   ├── 3-components/                 # 跨頁共用、無頁面前綴的元件（每個 class 只在此定義一次）
│   │   ├── button.css                # .btn / .btn-primary / .btn-sm / .btn-ghost（含 on-dark 變體）
│   │   ├── form.css                  # .form-row / input / select / .unit-search / .unit-add-link
│   │   ├── modal.css                 # .modal-overlay / .modal / .modal-header / .modal-actions（統一 950/960 z-index）
│   │   ├── drawer.css                # .drawer
│   │   ├── bottomsheet.css           # 手機 ⋯ 動作選單
│   │   ├── toast.css
│   │   ├── notif-panel.css           # 通知中心 popover / bottom sheet
│   │   ├── table.css                 # .data-table / .tbl-wrap / 手機 table→card
│   │   ├── card.css                  # .m-card（手機卡片骨架）/ .ui-card
│   │   ├── kpi.css                   # .ui-kpi-*（2026-09-11 shared dashboard contract）
│   │   ├── chips.css                 # .filter-chip / .filter-panel / inline chip bar
│   │   ├── status.css                # .status-ok/warn/danger、.is-low/.is-out、.qty-pos/.qty-neg
│   │   ├── location-headers.css      # .col-headers / .ch-*（新增/編輯/整組三個 modal 共用，單一來源）
│   │   ├── product-thumbnail.css     # .product-thumbnail-* / .cphoto
│   │   ├── upload-dropzone.css       # .drag（簽名報表 + 報價上傳共用）
│   │   └── page-header.css           # 頁首（取代 quotation 借用 .dsr-page-actions / .dsr-btn）
│   ├── 4-pages/                      # 每檔只寫 [data-page="x"] 範圍內規則；class 用頁面前綴
│   │   ├── inventory.css             # [data-page="inventory"]  前綴 inv-（由 core+inventory 拆出）
│   │   ├── inventory-locations.css   # 位置調整（modal 內，範圍 [data-page="inventory"] 或 modal id）
│   │   ├── prepared.css              # [data-page="prepared"]   前綴 prep-
│   │   ├── stockout.css              # [data-page="stockout"]   前綴 so-
│   │   ├── stocktake.css             # [data-page="stocktake"]  前綴 stk-
│   │   ├── kit.css                   # [data-page="kit"]        前綴 kit-
│   │   ├── calendar.css              # [data-page="calendar"]   前綴 cal-
│   │   ├── signed-reports.css        # [data-page="signed-reports"] 前綴 dsr-
│   │   ├── work-progress.css         # [data-page="work-progress"]  前綴 wpr-（移除 #content 前綴）
│   │   ├── quotation.css             # [data-page="quotation"]  前綴 quote-
│   │   ├── quotation-upload.css      # [data-page="quotation-upload"] 前綴 qup-
│   │   ├── petty-cash.css            # [data-page="petty-cash"] 前綴 pc-（一般）
│   │   ├── petty-cash-engineering.css# 前綴 pce-（與一般零用金 modal 分離）
│   │   ├── petty-cash-reports.css    # 前綴 pcr-
│   │   ├── settings.css              # 由 settings.html 內嵌 <style> 搬出
│   │   ├── permissions.css           # 由 permissions.html 內嵌 <style> 搬出
│   │   └── login.css                 # 由 login.html 內嵌 <style> 搬出
│   └── 5-utilities/
│       ├── utilities.css             # .hidden / .sr-only / .text-muted …（取代 inline style="display:none"）
│       ├── performance.css           # 現 style.performance.css
│       └── print.css                 # 所有 @media print 集中（報價單列印）
└── js/
    └── app.js                        # switchTab() 改為設定 document.body.dataset.page = tab
```

### 4.1 載入方式

維持多個 `<link>`（沿用 `main._versioned_html` 的 `?v=mtime` 自動版本號，不引入 build 工具、不改 `@import`，避免 `@import` 的子檔拿不到版本號而被快取 1 小時）。每個檔**自己包在對應的 layer 內**：

```css
/* 0-tokens/tokens.css — 必須第一個載入，宣告全部 layer 的順序 */
@layer tokens, base, layout, components, pages, utilities;

@layer tokens {
  :root {
    --c-primary: #2d5a8e;  --c-primary-strong: #1e3a5f;
    --c-text: #1a1a1a;     --c-muted: #64748b;   --c-border: #e5e7eb;
    --c-danger: #dc2626;   --c-warn: #f59e0b;    --c-ok: #16a34a;
    --radius-sm: 6px; --radius-md: 10px; --radius-lg: 14px;
    --z-header: 90; --z-sidebar: 100; --z-popover: 200;
    --z-modal: 950; --z-toast: 960;
    /* 斷點（CSS 變數不能用在 @media，這裡作為唯一文件來源）：sm 640 / md 768 / lg 960 */
  }
}
```

```css
/* 4-pages/kit.css */
@layer pages {
  [data-page="kit"] .kit-page-header { … }
  @media (max-width: 767px) { [data-page="kit"] .kit-card { … } }
}
```

**Layer 帶來的好處**：`pages` 層永遠勝過 `components` 層，**與特異度和載入順序無關**；因此頁面檔不需要 `#content.` 前綴或 `!important` 才能覆蓋元件。

### 4.2 頁面範圍：`body[data-page]`

```js
// app.js switchTab()：取代目前 10 行 content.classList.toggle(...)
document.body.dataset.page = tab;          // 'inventory' | 'kit' | 'quotation' | ...
// quotation.js 子模式：
document.body.dataset.page = mode === 'upload' ? 'quotation-upload' : 'quotation';
```

- `body` 是 modal 的祖先 → `[data-page="kit"] .kit-modal …` 可以正確限制在整組頁。
- settings / permissions / login 在 `<body data-page="settings">` 靜態寫死。
- 過渡期保留舊的 `#content.xxx-content` class（JS 同時設定），等所有頁面搬完再移除。

### 4.3 命名規範

| 類型 | 規則 | 範例 |
|---|---|---|
| 共用元件 | 無前綴、BEM 可選 | `.modal`, `.modal__hd`, `.btn-sm` |
| 頁面專屬 | `頁面前綴-` | `.kit-card`, `.stk-diff`, `.pce-modal` |
| 狀態 | `is-` / `has-` | `.is-active`, `.is-open`（逐步取代 `.active`/`.open`/`.on`/`.show` 四種寫法） |
| JS 掛鉤 | `js-` 或 `data-*`，**不得用來上樣式** | `data-action="delete"` |

---

## 5. 各檔案搬移對照表（現況 → 目標）

| 現有檔案 / 區塊 | 目標位置 | 備註 |
|---|---|---|
| core L1–10（reset/body） | `1-base/reset.css`、`typography.css` | |
| core L11–103（Shell v2、avatar、通知中心） | `2-layout/shell.css`、`3-components/notif-panel.css` | |
| core L104–166（topbar、btn-ghost、btn-sm、btn-primary） | `3-components/button.css` | `.btn-ghost` 拆成預設（白底）與 `.btn-ghost--on-dark`（topbar），結束 L129 註解說的「白底 modal 隱形」問題 |
| core L169–196（盤點橫幅、底部導覽） | `2-layout/bottom-nav.css`、`4-pages/stocktake.css` | |
| core L197–378（篩選面板、匯出列、item-card、照片、相似警示、位置清單、col-headers、出庫按鈕） | `4-pages/inventory.css`（頁面）＋ `3-components/chips.css`、`location-headers.css`、`product-thumbnail.css` | 與 inventory.css 的重複定義合併成一份 |
| core L432–544（儲存列、批次改位置、data-table、盤點輸入） | `3-components/table.css`、`4-pages/stocktake.css` | |
| core L545–592（Shared KPI contract） | `3-components/kpi.css` | petty-cash 的 `.ui-kpi-*` 覆寫改為 `[data-page="petty-cash"]` 範圍 |
| core L593–618（stk-tabs） | `4-pages/stocktake.css` | |
| core L619–747（Modal、材料選擇） | `3-components/modal.css`、`4-pages/kit.css` | |
| core L773–1079（v1.1/v1.2 手機卡片、bottom sheet、drawer、table view、view toggle、chip bar） | `3-components/card.css`、`bottomsheet.css`、`drawer.css`、`4-pages/inventory.css` | |
| `style.inventory.css` | `4-pages/inventory.css` | 移除所有與 core 重複的 class，保留差異 |
| `style.kit.css` L376–396（未加範圍 `.col-headers`） | 刪除，統一到 `3-components/location-headers.css` 用修飾類 `.col-headers--kit` | **修掉 §2.2 的跨 modal 汙染** |
| `style.inventory-locations.css` | `4-pages/inventory-locations.css` | `#edit-modal …` 的 grid 覆寫改為 `.col-headers--grid` 修飾類 |
| `style.petty-cash*.css` 三檔 | `4-pages/petty-cash*.css` | 工程版 `.pc-modal*` → `.pce-modal*`、月報 `.pc-table-wrap` → `.pcr-table-wrap` |
| `style.signed-reports.css` / `style.quotation.css` | `4-pages/…` | quotation 借用的 `.dsr-btn` / `.dsr-page-actions` 抽成 `3-components/page-header.css` 的 `.page-actions` / `.btn` |
| `style.quotation-upload.css` / signed-reports 的 `.drag` | `3-components/upload-dropzone.css` | |
| 各檔 `@media print` | `5-utilities/print.css` | 移除 `!important`（layer 已足夠） |
| `settings.html` / `permissions.html` / `login.html` 內嵌 `<style>` | `4-pages/settings.css` / `permissions.css` / `login.css` | HTML 改為 `<link>` |
| HTML `style="display:none"` 等靜態 inline | `.hidden` 等 utility | 動態值（寬度/顏色）保留 |

---

## 6. 「完整重現設計調整」的建議作法

問題的另一半是：**過去一連串針對單頁的 CSS 修正（PR #24、#27、#34、#35…）要如何在重構後完整保留、而且之後的調整可以被重現**。

### 6.1 先建立視覺基準（重構前）

新增 `tests/visual/`（Playwright，環境已內建 Chromium）：

1. 以測試 DB 啟動 server，登入 admin。
2. 對每個頁籤 × 兩種 viewport（桌機 1440×900、手機 390×844）截圖；另外截關鍵 modal（新增品項、編輯品項、整組、零用金一般/工程、簽名報表編輯、報價上傳編輯）。
3. 輸出到 `tests/visual/_baseline/*.png`（已加入 `.gitignore`，不提交），**在動任何 CSS 前先建立基準**。

每個重構 commit 後重跑並做像素比對（容許 0.1% 誤差）；差異圖輸出到 `tests/visual/_diff/` 供人工確認。這是「重構後視覺不變」的唯一可靠證據。

> 截圖跨作業系統不可比（字型不同），因此 repo 只放腳本；需要時在同一台機器上重建基準。

### 6.2 再補「計算結果」測試（取代原文字串比對）

用 Playwright `getComputedStyle` 鎖關鍵契約，例如：

```python
# 新增品項 modal 的欄位標頭，不論在哪一頁打開，欄寬規則都一樣
assert computed("#add-modal .ch-qty", "grid-column-start") == "3"
# 切到整組頁再打開同一個 modal，結果不得改變（直接鎖住 §2.2 的 bug）
```

### 6.3 用靜態測試防止衝突再發生（`tests/test_css_architecture.py`）

1. **單一來源**：每個 class 作為 selector 主體只能出現在一個檔（`3-components` 內的元件 class 不得在 `4-pages` 以無範圍形式重定義）。
2. **頁面範圍**：`4-pages/*.css` 每條規則必須以 `[data-page="…"]` 開頭（或在該 `@layer pages` 區塊的巢狀範圍內）。
3. **layer 包覆**：每個 CSS 檔的頂層只能是對應的 `@layer xxx { … }`。
4. **禁止 `!important`**（白名單：`utilities.css` 的 `.hidden`）。
5. **斷點白名單**：只允許 `(max-width: 639px)`、`(max-width: 767px)`、`(min-width: 768px)`、`(min-width: 960px)`，統一空白寫法。
6. **z-index 只能用 `var(--z-*)`**。
7. **hex 顏色只能出現在 `tokens.css`**（第 4 階段起啟用，前期為 warning 計數且不得增加）。

### 6.4 既有字串斷言的處理

`test_frontend_assets.py` 等檔中鎖 CSS 原文的斷言，逐條改為：
- 結構契約（檔案存在、class 存在於正確檔案）→ 留在靜態測試；
- 視覺結果（padding、z-index、欄寬）→ 移到 6.2 的 computed-style 測試。

每改一條在 commit 訊息列出「原斷言 → 新斷言」，不得刪除而不替代。

---

## 7. 分階段執行計畫（全部在同一個 PR，每階段獨立 commit）

| 階段 | 內容 | 畫面 | 驗證 |
|---|---|---|---|
| **P0** | `uv add --group visual playwright`；CI 新增 `visual` 專用 job（其餘 job 不變）；Playwright 伺服器 fixture；截圖腳本與重構前基準；`.col-headers` 跨 modal 汙染的失敗測試 | 不變 | 基準可重跑且穩定 |
| **P1** | `tokens.css`（宣告 layer 順序 + `:root`）；`switchTab` 設定 `body[data-page]`（保留舊 class） | 不變 | 截圖 0 差異 |
| **P2** | 15 檔內容不改，搬入新目錄並各自包進 `@layer`；更新 link 與測試路徑 | 不變 | 截圖比對、全量 pytest |
| **P3** | 拆 core：版面 / 共用元件 / 庫存頁；合併 core ↔ inventory 60+ 重複 class | 不變 | 截圖比對、computed-style |
| **P4** | 修正跨模組借用：`.col-headers`、`.pc-modal`、`.dsr-btn`、`.drag`、`.cphoto`、`.product-thumbnail` | 不變（修掉 bug 處除外） | P0 失敗測試轉綠 |
| **P5** | 頁面檔全改 `[data-page]` 範圍；移除 `#content.xxx` 前綴與 `!important`；斷點統一 | 不變 | 架構測試規則 1–5 |
| **P6** | settings / permissions / login 內嵌 `<style>` 搬檔；靜態 inline style → utility | 不變 | 三頁截圖比對 |
| **P7** | 狀態 class 統一 `is-*`，一個元件一個 commit（見 §7.1） | 不變 | 互動測試先行（改前改後皆綠） |
| **P7.5** | 設計系統統一：token（色票 / 字級 / 圓角）；按鈕收斂為單一 `.btn`、選取型收斂為 `.chip`（見 §7.2） | **會變** | 提案經使用者確認；前後對照截圖、按鈕 computed-style 契約測試 |
| **P8** | 顏色 / z-index / 字級 / 字重 / 圓角全部改用 token（舊值依 §7.2 歸併）；斷點收斂；架構測試全開；更新文件 SOP | **會變**（歸併造成的細微色差 / 字級差） | 全部測試、前後截圖 |

每階段依 `CLAUDE.md`：Dead Code 4 步自查（被取代的舊檔同 commit 刪除）、前端行為改動補測試、GitNexus `detect_changes`（本雲端環境無法建立索引時於 commit 訊息註明）。

### 7.1 狀態 class 對照

| 舊 | 新 | 備註 |
|---|---|---|
| `.active` | `.is-active` | 頁籤、側欄、子頁籤 |
| `.open`、`.show` | `.is-open` | 兩者合併 |
| `.on` | `.is-active` | 分片切換，與頁籤一致 |
| `.off` | `.is-inactive` | 停用中的使用者 / 單位（與 `.is-active` 成對） |
| `.selected` / `.collapsed` / `.expanded` / `.changed` | `.is-selected` / `.is-collapsed` / `.is-expanded` / `.is-changed` | |
| `:disabled`、`:checked` | 不變 | 原生偽類 |
| `.hidden` | 不變 | utility，不是狀態 |

完成後靜態測試禁止 CSS 出現裸的 `.active` / `.open` / `.show` / `.on`。

### 7.2 設計系統標準（P7.5，2026-09-29 使用者確認第 3 版提案）

**Token**（`0-tokens/tokens.css` 的 `:root`）

| 類別 | 值 |
|---|---|
| 主色 | `--c-primary #2d5a8e`（品牌深藍）、hover `--c-primary-strong #1e3a5f`、淺底 `--c-primary-soft #eef4fa` |
| 文字 / 框線 | `--c-text #0f172a`、`--c-text-2 #334155`、`--c-muted #64748b`、`--c-border #e2e8f0`、`--c-border-strong #94a3b8` |
| 語意色 | success `#16a34a`、warning `#d97706`、danger `#dc2626`、待領出 `#7c3aed` 系、已領出 `#f59e0b` 系（各有淺底） |
| 字級 | 11 / 12 / 13 / 14 / 16 / 20 / 28（另有 `--fs-9` 僅供手機版 ≤767px 月曆事件格 `.cal-evt` / `.cal-evt-time` / `.cal-evt-body`，由 `test_fs9_is_calendar_mobile_only` 強制） |
| 字重 | 400 / 600 / 700 |
| 圓角 | 6 / 8 / 12 / 999（圓形 50% 保留） |
| 控制項高度 | sm 32、md 38、手機觸控 44 |

**按鈕**（`3-components/button.css`，唯一來源）

- `.btn` + 變體：`--primary`（每區最多一個）、`--secondary`（白底 `#94a3b8` 框）、`--ghost`（`#eef4fa` 淺藍底，不會只剩文字）、`--danger`（白底紅框，刪除一律有框不實心）、`--prepare` / `--out`（待領出 / 已領出流程色）、`--on-dark`（深藍 topbar 專用）、`--export`（匯出鈕，亮藍 `#2563eb`；2026-09-29 使用者看過實際畫面後指定改回藍色，比次要鈕清楚）。
- 尺寸：`--sm` 32px / 12px、`--md` 38px / 13px（手機 ≤767px 自動 44px）；`--icon` 方形圖示鈕；`--solid` 只用在 modal 的流程確認鈕（確認待領出 / 已領出）。
- 圓角 8、字重 700、圖示在文字前（gap 6）；hover 變深或加淺底、disabled 透明度 .5、鍵盤焦點 2px 深藍外框；切換型按鈕按下時加 `.is-active`。
- 使用者確認的 5 點：綠色「＋ 新增」改深藍主要鈕；匯出改次要鈕（套用後改為 `--export` 亮藍）；借用待領出紫色的「拍照 / 新增位置」改中性；桌機按鈕高 38px；刪除維持白底紅框。

**選取型元件**（`3-components/chip.css`）

- `.chip` 膠囊（篩選、快速區間）、`.chip--seg` 方角分段（頁籤、模式切換、公司 / 倉庫）；選取中 `.is-active` 深藍實心。
- 「選了什麼很重要」的二選一用語意色：`.chip--success`（收入）、`.chip--danger`（支出）。

**不納入**（各自維持專用元件）：數量 − / ＋、KPI 卡、側欄導覽、關閉 ✕、下拉選單項目、開關、照片圖卡 / 燈箱、登入鈕（只換主色）。

**舊 class 的去向**：`.dsr-btn*`、`.pc-btn*`、`.qup-btn*`、`.btn-save`、`.btn-confirm`、`.kit-action` 等的外觀宣告全部刪除；仍被 JS / 排版使用的名稱留在標記上當掛鉤，其餘同 commit 移除。

**P8 歸併規則**（`tokens.css` 以外全部改為變數，共替換約 1,600 個色碼）

| 項目 | 規則 |
|---|---|
| 色碼 | 與 token 完全相同者直接對應；灰階依亮度歸到 white / surface-2 / border / border-strong / border-control / muted / text-2 / text；彩色依色相歸到 primary（藍、含 #1890ff、#1a73e8）/ success（綠）/ warning（橙黃）/ danger（紅）/ prepare（紫），再依亮度分 soft / border / 本色 / strong；帶透明度的色碼改 `color-mix()` |
| 字級 | 8–11.5→11（手機月曆格例外保留 `--fs-9`，否則派工名稱會被截斷）· 12–12.5→12 · 13–13.5→13 · 14–15→14 · 16–18→16 · 19–22→20 · 24–39→28；40px 以上 emoji 保留 |
| 圓角 | 4–7→6 · 8–10→8 · 12–16→12 · 20 以上→999；3px 以下細線與 50% 圓形保留 |
| 字重 | 400 以下→400 · 500 / 600 / 650→600 · 700 / 800 / 900→700 |
| z-index | 20 以上改為具名疊層（`--z-header`、`--z-modal`、`--z-lightbox`…），數值不變 |
| 斷點 | max 768→767、min 560→640、min 720→768；保留 390（小手機）與 1200 / 1440（桌機微調） |

**防回歸**（`tests/test_css_architecture.py`、`tests/visual/test_button_contract.py`）

- `button.css` / `chip.css` 以外，任何以 `.btn` / `.chip` 或其掛鉤 class 為主體的規則，不得設定顏色、框線、圓角、字級、字重、內距、高度。
- 每個 `<button>` 都要套 `.btn` 或 `.chip`；專用控制項（數量 ±、KPI 卡、關閉 ✕…）登記在 `tests/button_contract.json`——靜態測試（標記）與瀏覽器測試（畫面上可見的按鈕）共用這一份清單，清單中已不存在的 class 也會被擋下。
- JS 產生的畫面同樣遵守：`static/js` 不得寫死色碼（行事曆人員調色盤這類使用者資料除外），`style=""` 只能放 `display:none` 切換或 `${...}` 資料值，`el.style.*` 只能設定顯示切換、進度條寬度與下拉定位，`style.setProperty` 只能設定白名單內的執行期 CSS 變數（目前僅 `--cal-week-count`），`style.cssText`、`el.style = ...`、`style[...]`、`setAttribute('style', ...)`、`Object.assign(el.style, ...)` 一律禁止；外觀一律寫成 CSS class。原因：inline style 優先權高於所有分層樣式，手機版規則會因此失效（master 曾靠 `!important` 硬蓋，P5 移除 `!important` 後 `settings.js` 的行事曆同步手機版因此跑版）。
- utility 名稱描述語意、不寫色碼：用到 token 的 utility 必須以 token 命名（`.u-text-muted` ↔ `--c-muted`、`.u-r-md` ↔ `--r-md`），沒人使用的 utility 必須刪除。
- 瀏覽器契約測試：所有截圖情境中可見的 `.btn` / `.chip`，computed style 必須等於其變體與尺寸的規格。
- `tokens.css` 以外禁止色碼；字級、字重、圓角、20 以上的 z-index 只能用變數；用到的變數必須已定義（P8 啟用）。

## 8. 改完之後的「改樣式 SOP」

1. 要改的東西是**跨頁元件**？→ 改 `3-components/xxx.css`，視覺測試會列出所有受影響頁面。
2. 只想改**某一頁**？→ 在 `4-pages/<page>.css` 用 `[data-page="<page>"]` 範圍覆寫，**不要改元件檔**、不需要 `!important`。
3. 改顏色 / 圓角 / 間距？→ 先看 `tokens.css` 有沒有對應 token。
4. 送 PR 前：`pytest tests/test_css_architecture.py tests/visual`，視覺差異圖附在 PR 說明。

---

## 9. 已定案事項（2026-09-28）

1. 全部階段在同一個 PR（分支 `ccr-db5387cf-dzuvb0`）完成。
2. Playwright 以 `uv add --group visual playwright` 安裝在獨立 `visual` 群組，不進 `dev`；CI 既有 job 不變，另加一個 `visual` job 安裝 Chromium 並只跑瀏覽器測試；本機缺 Playwright 或瀏覽器時自動略過。
3. 截圖基準只用於重構過程比對，不提交進 repo（跨作業系統字型差異）。長期留在 CI 的是 computed-style 與互動測試。
4. 狀態 class 統一 `is-*`（對照見 §7.1）。
5. 設計系統統一（P7.5）納入本 PR，標準值由使用者看過色票 / 樣張後確認。
