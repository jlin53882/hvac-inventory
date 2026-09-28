# Kit 資料契約

本文件記錄 Kit、多位置與照片生命週期的唯一資料來源，避免 fresh DB 與升級 DB 的 schema 差異變成 production dependency。

## 資料來源

- Kit 的 `brand`、`code`、`site`、`has_photo` 讀取 `items`／`file_assets`；`items.site` 是庫存區唯一來源。
- Kit 數量與實際位置一律讀寫 `item_stocks`，以 `item_id` 關聯 Kit 的 `items` 主檔。每筆 `item_stocks.location`、`qty`、`note` 是位置明細來源；各位置 `qty` 加總即 Kit 總量。
- `/api/kits` 的 `stock_positions` 回傳實際 `item_stocks` 明細，是 Kit 位置數量的唯一來源。
- `kit_locations`／API `locations` 是編輯整組時填寫的「建議存放位置」（櫃子／位置／備註），以單一庫存相同的 `櫃子 | 位置` 格式顯示於 Kit 卡片（接在實際 `item_stocks` 位置之後、去重），並輸出到 Kit XLSX；但**不帶數量、不得用於庫存數量加總**。`locations: []` 表示清空。
- Kit 照片是 `file_assets` 中 `category=item_photo, owner_type=item, owner_id=<kit item id>` 的資產；legacy `<item_id>.jpg` 僅為相容 preview。
- 照片 UI 的識別碼不可混用：Kit definition 使用 `kits.id`，照片 owner/display/lightbox 使用 `kits.item_id`；上傳與刪除透過 `/api/kits/{kit_id}/photo`，端點再解析 backing item owner。

## Schema 與升級

Fresh `kits` 表只保存 Kit 定義所需的 `item_id`、`name`、`note` 與時間欄位，不新建 `brand`、`code`、`site`、`has_photo` 或 `location` 欄位。升級路徑只加需要的 `updated_at`；不為 duplicate source 加 `kits.site`。舊 DB 若仍物理保留 `kits.location` 或其他歷史欄位，應視為未使用 legacy 欄位；production query 不得讀寫它們。

## 寫入與刪除

- 建立 Kit 時依 `items.site` 驗證材料，Kit 的 site 只寫入 `items.site`。
- 更新 `locations` 時完整替換 `kit_locations` metadata；空陣列會刪除舊 metadata。
- 刪 Kit 時，只刪除由該 Kit 擁有的照片 asset metadata；original、preview、thumbnail 或 legacy preview 若仍被其他 `file_assets` row 引用，就保留該檔案。未共享的檔案在 DB transaction commit 後交由 `file_storage.delete_asset_files` 清理，並清除 legacy preview 與 invalidation cache。保留庫存異動稽核紀錄的既有規則。
- Cabinet rename 只更新 `item_stocks.location` 中完全相符的櫃名或以 `" | "` 為界的 prefix，並保留後段位置文字；不得用 `LIKE` wildcard 或無界限字串替換。

## 匯出驗收

Kit 匯出（`/api/kit-export`，sections：overview／inventory／positions／components／alerts／movements）：

- 庫存總表：庫存區（`items.site`）、待領出（`items.prepared_qty`）、總庫存（`item_stocks` 加總）、可用庫存（總庫存－待領出，庫存狀態以此判定）、組成材料數、材料狀態（缺料／庫存不足／正常，規則同整組頁）、建議存放位置文字、Kit 備註（`kits.note`）。
- 位置明細：先列 `item_stocks` 實際位置（位置類型「庫存位置」，含數量），再列 `kit_locations`（位置類型「建議存放位置」，位置數量留空）。對每個 Kit：庫存總表的總量必須等於「庫存位置」列的數量加總；不要回退到 `kits.location`。
- 組成材料：每個 Kit 的每項材料一列（每組需求、目前庫存、可組數、材料狀態）。
- 庫存警示：可用庫存缺貨／低庫存，或材料缺料／不足的 Kit。
- 所有字串欄位（含建議存放位置的櫃子、位置、備註）一律經 `_safe()` 防公式注入。
