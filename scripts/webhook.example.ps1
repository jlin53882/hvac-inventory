# ─────────────────────────────────────────────
# Discord Webhook 設定（已遷移至 .env）
# ─────────────────────────────────────────────
# 本檔已棄用。Webhook URL 統一在專案根目錄的 .env 檔案管理。
#
# 設定方式：
#   1. 複製 .env.example 為 .env
#   2. 填入 DISCORD_WEBHOOK_URL=你的webhook網址
#   3. .env 已在 .gitignore，不會上傳 GitHub
#
# Python 腳本：app/config.py 自動讀取 .env
# PS1 腳本：各腳本直接讀取 .env 的 DISCORD_WEBHOOK_URL
