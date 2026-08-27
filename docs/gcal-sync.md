# Google 行事曆同步（gcal-sync）

> 版本：Phase 0（UI + API 基礎建設）｜日期：2026-08-27

## 概述

將 hvac-inventory 的行事曆派工（appointments）**單向同步**到 Google 行事曆。
採用 **Multi-Key 一對多**架構：同一行程可同時同步到多本行事曆（不同廠商帳號）。

## 方案 C：Service Account 管理方式

**家豪統建所有 Service Account，廠商只需做一件事——把 email 加入行事曆分享。**

```
振佳空調（家豪）
  Google Cloud 專案: hvac-calendar-sync
  ├── SA A: hvac-sync-a@xxx.iam.gserviceaccount.com → 廠商A 加入分享
  ├── SA B: hvac-sync-b@xxx.iam.gserviceaccount.com → 廠商B 加入分享
  └── SA C: hvac-sync-c@xxx.iam.gserviceaccount.com → 廠商C 加入分享

hvac gcal_keys 表:
  ├── { name: "廠商A", json: secrets/hvac-sync-a.json, calendar_id: "xxx@group..." }
  ├── { name: "廠商B", json: secrets/hvac-sync-b.json, calendar_id: "yyy@group..." }
  └── { name: "廠商C", json: secrets/hvac-sync-c.json, calendar_id: "zzz@group..." }
```

### 建置步驟

1. **建 Cloud 專案**（只做一次）：Google Cloud Console → 新增專案 `hvac-calendar-sync` → 啟用 Calendar API
2. **每個廠商建 Service Account**：憑證 → 服務帳號 → 下載 JSON → 放到 `secrets/`
3. **廠商操作**：把家豪給的 email 加入行事曆分享（權限：查看事件）
4. **設定 hvac**：設定頁 → 📅 行事曆同步 → ＋新增 Key

### 安全性

- Service Account JSON 只存路徑（DB `gcal_keys.credentials_path`），**內容不入 DB、不 commit**
- `.gitignore` 排除：`secrets/`、`*.service-account.json`、`/credentials*.json`
- 廠商可隨時在行事曆設定頁移除 email 撤銷權限

## 架構

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

## DB Schema

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

### settings（全域開關）

| key | 預設值 | 說明 |
|-----|--------|------|
| gcal_sync_enabled | "0" | 全域同步開關（0=暫停, 1=開啟） |

### Future Phase（尚未建立）

- `appointment_sync_queue`：複合主鍵 `(appointment_id, key_id)` 待同步隊列
- `appointment_gcal_map`：本地行程 ↔ Google event id 對映

## API 端點

| Method | Path | 說明 | 權限 |
|--------|------|------|------|
| GET | `/api/gcal-keys` | 列出所有 key（含停用） | 登入 |
| POST | `/api/gcal-keys` | 新增 key | unit-mgmt |
| PUT | `/api/gcal-keys/{id}` | 編輯 key（名稱/路徑/calendar_id/啟停） | unit-mgmt |
| DELETE | `/api/gcal-keys/{id}` | 刪除 key | unit-mgmt |
| GET | `/api/gcal-keys/options` | 下拉選單（只回傳啟用 key） | 登入 |
| GET | `/api/gcal-sync-enabled` | 讀取全域同步開關 | 登入 |
| PUT | `/api/gcal-sync-enabled` | 切換全域同步開關 | unit-mgmt |

## 前端檔案

| 檔案 | 說明 |
|------|------|
| `static/settings.html` | 設定頁：左清單第三項 + panel div + modal HTML + CSS |
| `static/js/settings.js` | `renderGcalPanel()` + `toggleGcalKey()` + `bindGcalUser()` + 全域開關 |
| `static/js/modals/gcal-key.js` | 新增/編輯 Key modal（`openGcalKeyModal` / `submitGcalKey`） |

## 使用者綁 key 流程

1. 管理者在設定頁建立 key（名稱 + JSON 路徑 + calendar_id）
2. 在「使用者綁定 Key」區塊，為每位使用者選擇綁定的 key
3. 行事曆新增/修改/刪除時，系統依指派人綁定的 key 自動同步

## 全域同步開關

- panel 頂部的開關控制整個同步功能
- 關閉後（🔴 同步已暫停），背景排程器不執行同步
- 預設為關閉（需手動開啟）

## 測試

```bash
# gcal_keys API 測試
.venv/Scripts/python.exe -m pytest tests/test_gcal_keys.py -v

# 前端資產斷言
.venv/Scripts/python.exe -m pytest tests/test_frontend_assets.py -v -k gcal

# 全量
./scripts/run-tests.sh all
```

## Future Phase 計畫

- **Phase 1**：`gcal_sync.py`（build_event / resolve_target_keys / sync_pending）
- **Phase 2**：`sync_scheduler.py`（background debounce threading）
- **Phase 3**：appointments 三處掛接（create/update/delete → mark_sync_pending）
- **Phase 4**：DB migration（sync_queue / gcal_map 複合主鍵）
- **Phase 5**：整合測試 + 手動驗證
