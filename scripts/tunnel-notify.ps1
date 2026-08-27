# 振佳空調庫存管理系統 - 外網連線啟動（Cloudflare Tunnel + Discord webhook 通知）
# 由「外網啟動.bat」呼叫。直接執行亦可。
# 行為：啟動 cloudflared quick tunnel → 抓取公網網址 → 推播到 Discord 頻道 → 前景執行（關閉視窗 = 關閉外網）
$ErrorActionPreference = 'Continue'

$CF     = 'C:\Program Files (x86)\cloudflared\cloudflared.exe'
# Discord webhook：從 .env 讀取（未設定 → 跳過推播，外網功能不受影響）
$WEBHOOK = $null
$envFile = Join-Path (Split-Path $PSScriptRoot -Parent) '.env'
if (Test-Path $envFile) {
    $m = Select-String -Path $envFile -Pattern '(?m)^DISCORD_WEBHOOK_URL=(.+)$'
    if ($m) { $WEBHOOK = $m.Matches[0].Groups[1].Value.Trim() }
}
if (-not $WEBHOOK) {
    Write-Host '⚠️ 未設定 Discord webhook（.env DISCORD_WEBHOOK_URL）— 跳過推播，外網正常' -ForegroundColor Yellow
}
$CURL   = "$env:SystemRoot\System32\curl.exe"
$LOG    = Join-Path $env:TEMP 'cf_tunnel.log'
$JSON   = Join-Path $env:TEMP 'cf_webhook.json'

if (Test-Path $LOG) { Remove-Item $LOG -Force }

function Send-TunnelUrl([string]$Url) {
    if (-not $WEBHOOK) { return }  # 未設定 webhook → 跳過推播
    $text = "🌐 振佳空調庫存 外網已開啟！`n📱 手機網址：$Url`n`n(關閉啟動視窗 = 關閉外網，網址每次啟動會更新)"
    $body = @{ content = $text } | ConvertTo-Json -Compress
    [System.IO.File]::WriteAllText($JSON, $body, (New-Object System.Text.UTF8Encoding($false)))
    & $CURL -s -X POST -H 'Content-Type: application/json' --data-binary ("@$JSON") $WEBHOOK
    Write-Host ""
    Write-Host ("已推播到 Discord 頻道 ✅  網址：{0}" -f $Url) -ForegroundColor Green
}

# 背景監看 log，出現 trycloudflare 網址就推播（只推一次）
$watcher = Start-Job -ScriptBlock {
    param($watchLog, $watchWebhook, $watchCurl)
    $tmpJson = Join-Path $env:TEMP 'cf_webhook.json'
    for ($i = 0; $i -lt 240; $i++) {
        Start-Sleep -Milliseconds 500
        if (Test-Path $watchLog) {
            $m = Select-String -Path $watchLog -Pattern 'https://[\w-]+\.trycloudflare\.com' -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($m) {
                if (-not $watchWebhook) { break }  # 未設定 webhook → 不推播
                $url = $m.Matches[0].Value
                $text = "🌐 振佳空調庫存 外網已開啟！`n📱 手機網址：$url`n`n(關閉啟動視窗 = 關閉外網，網址每次啟動會更新)"
                $body = @{ content = $text } | ConvertTo-Json -Compress
                [System.IO.File]::WriteAllText($tmpJson, $body, (New-Object System.Text.UTF8Encoding($false)))
                & $watchCurl -s -X POST -H 'Content-Type: application/json' --data-binary ("@$tmpJson") $watchWebhook 2>$null
                break
            }
        }
    }
} -ArgumentList $LOG, $WEBHOOK, $CURL

Write-Host '🌐 建立 Cloudflare 隧道中...' -ForegroundColor Cyan

# 前景執行 cloudflared：Ctrl+C 或關閉此視窗 = 外網關閉
& $CF tunnel --url http://localhost:8000 --no-autoupdate 2>&1 | Tee-Object -FilePath $LOG

Stop-Job $watcher -ErrorAction SilentlyContinue
Remove-Job $watcher -ErrorAction SilentlyContinue