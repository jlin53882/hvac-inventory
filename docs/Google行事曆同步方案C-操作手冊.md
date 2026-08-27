# Google 行事曆同步方案 C — 完整操作手冊

> 振佳空調 hvac-inventory 庫存管理系統
> 版本：Phase 0（UI + API 基礎建設完成）｜日期：2026-08-27
> 狀態：Phase 1-5 待執行

---

## 一、方案概述

### 核心原則

**家豪統建所有 Service Account，廠商只需做一件事——把 email 加入行事曆分享。**

這是三個方案中**廠商負擔最低**的：
- 方案 A：每廠商自行建 SA → 廠商要懂 Google Cloud（太難）
- 方案 B：一個共用 SA → 所有廠商共用一把金鑰（安全風險）
- **方案 C：家豪統建 SA → 廠商只加 email（✅ 定案）**

### 同步方向

**單向**：本地（hvac 行事曆）→ Google 行事曆（唯讀鏡像）

- 本地是唯一的資料來源，有衝突檢查、防重複等功能
- Google 行事曆只是「顯示層」，廠商在上面改動不會回寫本地
- 避免雙向同步的格式對應問題

### Multi-Key 一對多

- 每把 key 對應一個廠商的 Service Account
- 同一行程可同時同步到多本行事曆（依指派人綁定的 key 決定）
- 例：行程指派 A 廠商 + B 廠商的工程師 → 同步到 A + B 兩本行事曆

---

## 二、架構圖

```
振佳空調（家豪）
  Google Cloud 專案: hvac-calendar-sync
  ├── Service Account A: hvac-sync-a@hvac-calendar-sync.iam.gserviceaccount.com
  │     └── 廠商A 把它加進自己行事曆分享
  ├── Service Account B: hvac-sync-b@hvac-calendar-sync.iam.gserviceaccount.com
  │     └── 廠商B 把它加進自己行事曆分享
  └── Service Account C: hvac-sync-c@hvac-calendar-sync.iam.gserviceaccount.com
        └── 廠商C 把它加進自己行事曆分享

hvac 庫存系統 gcal_keys 表:
  ├── { name: "廠商A", json: secrets/hvac-sync-a.json, calendar_id: "xxx@group.calendar.google.com" }
  ├── { name: "廠商B", json: secrets/hvac-sync-b.json, calendar_id: "yyy@group.calendar.google.com" }
  └── { name: "廠商C", json: secrets/hvac-sync-c.json, calendar_id: "zzz@group.calendar.google.com" }
```

### 同步流程

```
使用者(多人)               hvac FastAPI Server
──改行事曆──▶ appointments write (POST/PUT/DELETE) commit成功
                   │
                   ▼
       mark_sync_pending(appt_id, op[, map_rows])
                   │   [依指派人員解析目標 key 集合]
                   ▼
       appointment_sync_queue (appointment_id, key_id) 複合主鍵
                   ▲  每 5 分鐘掃 (debounce)
       sync_scheduler (background threading)
                   │
                   ▼
       gcal_sync: 對每個目標 key 各用該 key 的 Service Account
                   insert/patch/delete 到對應 calendar
                   + appointment_gcal_map (appointment_id, key_id)
                   │
                   ▼
       Google Calendar API (多行事曆)
```

---

## 三、各角色責任

| 角色 | 做什麼 | 難度 | 次數 |
|------|--------|------|------|
| **家豪（系統管理員）** | 建 Cloud 專案 → 建 N 個 SA → 下載 N 個 JSON → 設定 hvac 系統 | 中 | 專案 1 次 + 每廠商 1 次 |
| **廠商（協力廠商）** | 把家豪給的 email 加入行事曆分享 | **極低**（1 步，1 分鐘） | 每廠商 1 次 |
| **hvac 系統** | 自動同步（不用人為干預） | 無 | 持續 |

---

## 四、完整建置步驟

### Step 1：建 Google Cloud 專案（只做一次）

1. 打開 [Google Cloud Console](https://console.cloud.google.com/)
2. 頂部專案選擇器 → 「新增專案」
3. 專案名稱填 `hvac-calendar-sync` → 建立
4. 左側選單 →「API 和服務」→「程式庫」
5. 搜尋 `Google Calendar API` → 點進去 → 「啟用」
6. **計費**：Calendar API 免費（每天 100 萬次查詢），不需要啟用計費

### Step 2：為每個廠商建 Service Account（重複 N 次）

以「廠商A」為例：

1. 左側「API 和服務」→「憑證」
2. 頂部「＋建立憑證」→「服務帳號」
3. 服務帳號名稱填 `hvac-sync-a`
   - 系統自動產生 email：`hvac-sync-a@hvac-calendar-sync.iam.gserviceaccount.com`
4. 「建立並繼續」→ 角色跳過（不需要）→ 「完成」
5. 點進剛建立的帳號 →「金鑰」tab
6. 「新增金鑰」→「建立新的金鑰」→ 類型選 **JSON** → 「建立」
7. 瀏覽器會下載 JSON 檔（如 `hvac-calendar-sync-xxxxx.json`）
8. **把這個 JSON 檔放到伺服器**：
   ```
   cd C:\Users\admin\workspace\hvac-inventory
   mkdir secrets
   # 把下載的 JSON 檔複製到 secrets/ 並重新命名
   copy "C:\Users\Downloads\hvac-calendar-sync-xxxxx.json" secrets\hvac-sync-a.json
   ```
9. **複製 Service Account email** 給廠商（就是步驟 3 的 email）

**重複以上步驟**為每個廠商建 SA（廠商B → `hvac-sync-b`、廠商C → `hvac-sync-c`）

### Step 3：廠商操作（每個廠商 1 步，1 分鐘）

廠商需要做的事情：

1. 開啟 [Google 行事曆](https://calendar.google.com/)
2. 左側找到要共享的行事曆 → 滑鼠移到該行事曆 → 點「⋯」（更多選項）→「設定和共用」
3. 滾到「與特定使用者或群組共用」區塊
4. 在「新增使用者」欄位貼上家豪給的 email（如 `hvac-sync-a@hvac-calendar-sync.iam.gserviceaccount.com`）
5. 權限選「**查看所有事件詳細資料**」（或「管理行事曆」也可）
6. 按「傳送」
7. **完成！** 廠商可以關掉設定頁

> ⚠️ 廠商不需要安裝任何軟體、不需要登入 Google Cloud、不需要懂任何技術。

### Step 4：取得 Calendar ID（每個行事曆一次）

每個行事曆都有一個唯一的 ID：

1. 在 Google 行事曆 → 該行事曆 →「設定和共用」
2. 滾到最下方「整合日曆」區塊
3. 找到「行事曆 ID」（格式：`xxx@group.calendar.google.com`）
4. 複製這個 ID

### Step 5：設定 hvac 系統

1. 登入 hvac 庫存系統
2. 點 topbar 的「⚙️ 設定」
3. 左側清單選「📅 行事曆同步」
4. 點「＋ 新增 Key」
5. 填入：
   - **Key 名稱**：如「廠商A」（與步驟 2 一致）
   - **Service Account JSON 路徑**：如 `secrets/hvac-sync-a.json`（相對路徑，從專案根目錄算）
   - **Calendar ID**：步驟 4 取得的 ID
6. 按「儲存」
7. 確認清單中出現新的 key，狀態為「啟用」

**為每位使用者綁定 key**：
1. 在設定頁「📅 行事曆同步」下方的「使用者綁定 Key」區塊
2. 為每位使用者選擇綁定哪把 key
3. 行事曆新增/修改/刪除時，系統依指派人綁定的 key 自動同步

---

## 五、每個 Key 的操作

在設定頁「📅 行事曆同步」區塊，每個 key 有以下操作：

| 操作 | 說明 |
|------|------|
| **滑動開關** | 啟用/停用個別 key（不影響其他 key） |
| **✏️ 編輯** | 修改 key 名稱、JSON 路徑、Calendar ID |
| **🗑️ 刪除** | 永久移除 key（不可復原） |

> ⚠️ 沒有「全域開關」——每個 key 獨立控制。

---

## 六、安全性

### 金鑰保護

| 項目 | 做法 |
|------|------|
| JSON 檔存放 | `secrets/` 目錄（`.gitignore` 排除） |
| DB 只存路徑 | `gcal_keys.credentials_path` 存路徑，不存內容 |
| 不 commit | `.gitignore` 排除：`secrets/`、`*.service-account.json`、`/credentials*.json` |
| 不入 DB 內容 | 金鑰 bytes 永遠不寫進 SQLite |

### 權限控制

| 端點 | 權限 |
|------|------|
| `GET /api/gcal-keys` | admin 專屬（含 credentials_path 敏感資訊） |
| `POST /api/gcal-keys` | admin 專屬 |
| `PUT /api/gcal-keys/{id}` | admin 專屬 |
| `DELETE /api/gcal-keys/{id}` | admin 專屬 |
| `GET /api/gcal-keys/options` | 登入即可（只回傳 name，不含路徑） |

### 廠商端安全

- Service Account **只能寫入行事曆**，不能登入 hvac 網站
- 廠商可隨時在行事曆設定頁**移除 email 撤銷權限**
- 移除後，系統同步會失敗（403），但不影響本地資料

---

## 七、資料庫結構

### gcal_keys（key 設定）

| 欄位 | 類型 | 說明 |
|------|------|------|
| id | INTEGER PK | 自增 |
| name | TEXT UNIQUE | key 名稱（如「廠商A」） |
| credentials_path | TEXT | Service Account JSON 檔路徑 |
| calendar_id | TEXT | 要寫入的行事曆 ID |
| is_active | INTEGER DEFAULT 1 | 啟用/停用 |
| created_at | TIMESTAMP | 建立時間 |

### users.gcal_key（使用者綁 key）

每人綁定一把 key（name 字串），行程依指派人綁定的 key 決定同步到哪本行事曆。

### Future Phase（Phase 1-5 才建立）

- `appointment_sync_queue`：複合主鍵 `(appointment_id, key_id)` 待同步隊列
- `appointment_gcal_map`：本地行程 ↔ Google event id 對映

---

## 八、API 端點一覽

| Method | Path | 說明 | 權限 |
|--------|------|------|------|
| GET | `/api/gcal-keys` | 列出所有 key（含停用） | admin |
| POST | `/api/gcal-keys` | 新增 key | admin |
| PUT | `/api/gcal-keys/{id}` | 編輯 key（名稱/路徑/calendar_id/啟停） | admin |
| DELETE | `/api/gcal-keys/{id}` | 刪除 key | admin |
| GET | `/api/gcal-keys/options` | 下拉選單（只回傳啟用 key） | 登入 |

---

## 九、前端檔案

| 檔案 | 說明 |
|------|------|
| `static/settings.html` | 設定頁：左清單第三項「📅 行事曆同步」+ panel div + modal HTML + CSS |
| `static/js/settings.js` | `renderGcalPanel()` + `toggleGcalKey()` + `bindGcalUser()` |
| `static/js/modals/gcal-key.js` | 新增/編輯 Key modal（`openGcalKeyModal` / `submitGcalKey`） |

---

## 十、已知陷阱與注意事項

### 1. Calendar ID 格式

- 正確格式：`xxx@group.calendar.google.com`
- 不是「行事曆名稱」，要去設定頁最下方「整合日曆」找

### 2. JSON 路徑

- 相對路徑從專案根目錄算：`secrets/hvac-sync-a.json`
- 絕對路徑也可以，但不建議（換伺服器要改）

### 3. 廠商移除分享

- 廠商移除 email 後，系統同步會失敗（Google API 回 403）
- 不影響本地資料，只是同步中斷
- 要恢復：廠商重新加回 email 即可

### 4. Multi-Key 一對多

- 同一行程指派多人 → 依每人綁定的 key 解析目標
- 例：行程指派 A 廠商工程師 + B 廠商工程師 → 同步到 A + B 兩本
- 指派人沒綁 key → 該行程不同步到任何行事曆

### 5. Debounce 合併延遲

- 每 5 分鐘檢查一次有無修改
- 有修改就重置倒數
- 連續 5 分鐘無修改才觸發一次同步
- 避免每人改一下就各打一次 API

### 6. 刪除操作

- 本地刪除行程 → 同步刪除 Google 端的對應事件
- 刪除前先撈出全部 `(key_id, google_event_id)` → 每 key 一列刪除

---

## 十一、Future Phase 計畫

| Phase | 內容 | 狀態 |
|-------|------|------|
| Phase 0 | UI 設定頁 + API 基礎建設 | ✅ 已完成 |
| Phase 1 | `gcal_sync.py`（build_event / resolve_target_keys / sync_pending） | 待執行 |
| Phase 2 | `sync_scheduler.py`（background debounce threading） | 待執行 |
| Phase 3 | appointments 三處掛接（create/update/delete → mark_sync_pending） | 待執行 |
| Phase 4 | DB migration（sync_queue / gcal_map 複合主鍵） | 待執行 |
| Phase 5 | 整合測試 + 手動驗證 | 待執行 |

---

## 十二、故障排除

| 症狀 | 可能原因 | 解法 |
|------|----------|------|
| 同步後 Google 行事曆沒出現事件 | SA email 未加入行事曆分享 | 請廠商把 email 加入分享 |
| 同步後 Google 行事曆沒出現事件 | calendar_id 錯誤 | 到行事曆設定頁確認 ID |
| 同步失敗 403 | 廠商移除了分享 | 請廠商重新加回 email |
| 同步失敗 404 | calendar_id 格式錯誤 | 確認格式為 `xxx@group.calendar.google.com` |
| 新增 key 失敗 | name 重複 | 換一個名稱 |
| JSON 檔找不到 | 路徑錯誤 | 確認相對路徑從專案根目錄算 |
| 事件結束時間等於開始時間 | 前端只填開始時間 | 系統自動加 1 小時（build_event 兜底） |

---

## 十三、測試

```bash
# gcal_keys API 測試（17 條）
.venv/Scripts/python.exe -m pytest tests/test_gcal_keys.py -v

# 前端資產斷言（12 條 gcal 相關）
.venv/Scripts/python.exe -m pytest tests/test_frontend_assets.py -v -k gcal

# 全量（686 passed）
./scripts/run-tests.sh all
```

---

## 十四、相關文件

| 文件 | 位置 |
|------|------|
| 設計 Plan | `Obsidian 00-專案文件/hvac-inventory-Google行事曆單向同步-設計plan-2026-08-20.md` |
| 收尾紀錄 | `Obsidian 00-專案文件/hvac-inventory-Google行事曆同步Phase0-收尾紀錄-2026-08-27.md` |
| 維護文件 | `docs/gcal-sync.md` |
| Sync Pattern | `skill: external-service-sync` |

---

*手冊建立日期：2026-08-27*
*最後更新：2026-08-27 Phase 0 完成*
