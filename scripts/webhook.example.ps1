# ─────────────────────────────────────────────
# 外網啟動 Discord webhook 設定（範例檔 — 入版控）
# ─────────────────────────────────────────────
# 用法：
#   1. 複製本檔為 webhook.local.ps1（與本檔同目錄）
#   2. 在 webhook.local.ps1 內填入你的 Discord webhook 網址
#   3. webhook.local.ps1 已在 .gitignore，不會上傳 GitHub
# 沒設定時：tunnel-notify.ps1 會跳過 Discord 推播，外網功能不受影響
$WEBHOOK = ''
