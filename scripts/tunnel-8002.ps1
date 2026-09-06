# hvac-ui-redesign 外網隧道（port 8002，Cloudflare quick tunnel，非 tailscale）
$ErrorActionPreference = "Stop"
$port = 8002
$listening = netstat -ano | Select-String ":$port" | Select-String "LISTENING"
if (-not $listening) {
  Write-Host "[錯誤] port $port 沒在跑，請先執行 launch-hvac-8002.sh / start-8002.bat" -ForegroundColor Red
  exit 1
}
Write-Host "[1/2] 本機 $port 已在跑，啟動 Cloudflare tunnel..." -ForegroundColor Cyan
$job = Start-Job -ScriptBlock {
  param($p)
  & cloudflared tunnel --url "http://localhost:$p" --no-autoupdate 2>&1
} -ArgumentList $port
Write-Host "[2/2] 等待隧道網址（30s）..." -ForegroundColor Cyan
$tryUrl = $null
for ($i=0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 1
  $out = Receive-Job $job 2>&1 | Out-String
  if ($out -match "https://[a-z0-9-]+\.trycloudflare\.com") {
    $tryUrl = $Matches[0]
    break
  }
  Write-Host "." -NoNewline
}
if ($tryUrl) {
  Write-Host ""
  Write-Host "外網網址: $tryUrl" -ForegroundColor Green
  Write-Host "本機: http://localhost:$port/" -ForegroundColor Gray
  $webhook = $env:DISCORD_WEBHOOK_URL
  if (-not $webhook) {
    $envFile = Join-Path $PSScriptRoot ".." ".env"
    if (Test-Path $envFile) {
      $line = Get-Content $envFile | Where-Object { $_ -match "^DISCORD_WEBHOOK_URL=" }
      if ($line) { $webhook = ($line -split "=",2)[1].Trim() }
    }
  }
  if ($webhook -and $webhook -ne "") {
    $payload = @{ content = "hvac-ui-redesign 外網已上線: $tryUrl (port $port) — branch feature/ui-shell-phase1" } | ConvertTo-Json
    try {
      Invoke-RestMethod -Uri $webhook -Method Post -Body $payload -ContentType "application/json" | Out-Null
      Write-Host "[webhook] 已推播到 Discord" -ForegroundColor Green
    } catch { Write-Host "[webhook] 推播失敗: $_" -ForegroundColor Yellow }
  } else {
    Write-Host "[webhook] 未設定 DISCORD_WEBHOOK_URL，手動分享上方網址" -ForegroundColor Yellow
  }
  Write-Host ""
  Write-Host "關閉此視窗 = 關閉外網" -ForegroundColor Yellow
  Receive-Job $job -Wait
} else {
  Write-Host ""
  Write-Host "[錯誤] 未取得隧道網址" -ForegroundColor Red
  Receive-Job $job | Out-String | Write-Host
  Stop-Job $job; Remove-Job $job
}
