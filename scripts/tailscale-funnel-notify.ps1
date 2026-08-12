# 振佳空調庫存管理系統 - 外網連線啟動（Tailscale Funnel 固定網址版）
# 由「外網啟動.bat」呼叫。直接執行亦可。
# 行為：確保 Tailscale Funnel 開通（固定網址）→ 推播固定網址到 Discord 頻道 → 顯示狀態
# 特性：網址固定 https://node.tail13203e.ts.net，重啟外網不需重新登入（cookie 同 domain）
# 注意：Funnel 以背景模式（--bg）依附 Tailscale 服務常駐；關閉此視窗不會關閉外網。
#       要關閉外網：執行「tailscale funnel --https=443 off」或停止 Tailscale 服務。
$ErrorActionPreference = 'Continue'

$TS     = 'C:\Program Files\Tailscale\tailscale.exe'
$FIXED  = 'https://node.tail13203e.ts.net'
# Discord webhook：從 gitignored 設定檔讀取（見 webhook.example.ps1 說明）
# 未設定 → 跳過推播，外網功能不受影響
$WEBHOOK = $null
$WEBHOOK_LOCAL = Join-Path $PSScriptRoot 'webhook.local.ps1'
if (Test-Path $WEBHOOK_LOCAL) { . $WEBHOOK_LOCAL }
if (-not $WEBHOOK) {
    Write-Host '⚠️ 未設定 Discord webhook（scripts/webhook.local.ps1）— 跳過推播，外網正常' -ForegroundColor Yellow
}
$CURL   = "$env:SystemRoot\System32\curl.exe"
$JSON   = Join-Path $env:TEMP 'ts_webhook.json'

function Send-TunnelUrl([string]$Url) {
    if (-not $WEBHOOK) { return }  # 未設定 webhook → 跳過推播
    $text = "🌐 振佳空調庫存 外網已開啟！`n📱 手機網址（固定）：$Url`n`n網址固定不變，重啟外網不需重新登入。`n(要關閉外網：停止 Tailscale 服務或執行 tailscale funnel --https=443 off)"
    $body = @{ content = $text } | ConvertTo-Json -Compress
    [System.IO.File]::WriteAllText($JSON, $body, (New-Object System.Text.UTF8Encoding($false)))
    & $CURL -s -X POST -H 'Content-Type: application/json' --data-binary ("@$JSON") $WEBHOOK
    Write-Host ""
    Write-Host ("已推播到 Discord 頻道 ✅  網址：{0}" -f $Url) -ForegroundColor Green
}

Write-Host '🌐 檢查 Tailscale Funnel 狀態...' -ForegroundColor Cyan

# 1. 檢查 Tailscale 連線（tailscale ip 有輸出 = 已連線；避免解析 JSON 的中文編碼坑）
$tsIp = & $TS ip 2>$null | Select-Object -First 1
if (-not $tsIp) {
    Write-Host '⚠️ Tailscale 未連線 — 請先登入 Tailscale（tailscale up）' -ForegroundColor Yellow
}

# 2. 檢查 Funnel 是否已開通
$funnelStatus = & $TS funnel status 2>&1 | Out-String
if ($funnelStatus -match 'Funnel on' -and $funnelStatus -match $FIXED.Replace('https://','')) {
    Write-Host "✅ Funnel 已在運行：$FIXED" -ForegroundColor Green
} else {
    Write-Host 'Funnel 尚未開通，啟用中...' -ForegroundColor Cyan
    $out = & $TS funnel --bg 8000 2>&1 | Out-String
    Write-Host $out
    if ($out -match 'Available on the internet') {
        Write-Host "✅ Funnel 開通成功：$FIXED" -ForegroundColor Green
    } else {
        Write-Host '⚠️ Funnel 開通失敗（可能是 Tailscale 服務端暫時問題）— 可改用「外網啟動-cloudflared.bat」備援' -ForegroundColor Yellow
    }
}

# 3. 檢查本機伺服器 8000
$port = netstat -ano | Select-String ':8000' | Select-String 'LISTENING' | Select-Object -First 1
if (-not $port) {
    Write-Host '⚠️ 本機系統 8000 沒在跑！請先雙擊「start.bat」啟動庫存系統。' -ForegroundColor Yellow
}

# 4. 推播固定網址（真實連通性檢查：HTTP 200 才推播，避免推播打不開的網址）
function Test-FunnelReachable {
    # Funnel 用本機 MagicDNS 解析到 tailscale IP；curl -k 驗證 443 是否真的能通到 8000
    $code = & $CURL -s -o NUL -w "%{http_code}" --max-time 15 -k "https://$($FIXED.Replace('https://',''))/" 2>$null
    return ($code -match '^[23]0\d$' -or $code -match '^[23]\d\d$')
}
$reachable = Test-FunnelReachable
if ($reachable) {
    Send-TunnelUrl $FIXED
} else {
    Write-Host '⚠️ Funnel 已設定但網址尚未就緒（可能是 Tailscale 服務端暫時問題，DNS/憑證未生效）— 跳過推播' -ForegroundColor Yellow
    Write-Host '   可用「外網啟動-cloudflared.bat」備援；或稍後重跑本腳本' -ForegroundColor Yellow
}

Write-Host ""
Write-Host "📱 固定網址：$FIXED" -ForegroundColor Green
Write-Host "（網址固定不變 → 重啟外網後手機不需重新登入）"
Write-Host "❌ 要關閉外網：執行「tailscale funnel --https=443 off」或停止 Tailscale 服務"
