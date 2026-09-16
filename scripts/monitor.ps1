# 振佳空調庫存管理系統 - 外網健康監控（常駐）
# 由「install-monitor.bat」啟動。直接執行亦可。
# 行為：每 10 分鐘檢查本機 server(8000) 與 Tailscale Funnel 網址
#   - 本機 8000 無回應 → start 開新視窗跑 start.bat 重啟 + Discord 通知
#   - Funnel 網址無回應 → 自動 tailscale funnel --bg 8000 重建 + Discord 通知
#   - 同一問題連續 2 次偵測才通知（防抖 + 防洗版）
#   - 每輪寫入 heartbeat（供 Task Scheduler watchdog 檢查是否存活）
# 參數：
#   -Once    只跑一輪就結束（測試用）
#   -DryRun  只顯示動作不實際執行（測試用）
#   -LocalUrl 覆寫本機檢查網址（測試用）
#   -FunnelUrl 覆寫 Funnel 檢查網址（測試用）
param(
    [switch]$Once,
    [switch]$DryRun,
    [string]$LocalUrl = 'http://127.0.0.1:8000/health',
    [string]$FunnelUrl = 'https://node.tail13203e.ts.net/health'
)

$ErrorActionPreference = 'Continue'

# 同一台主機只允許一個 monitor；重複安裝／手動啟動時直接退出，避免多個
# monitor 同時判定 health failure 並輪流重啟同一個 server。
$monitorMutex = [System.Threading.Mutex]::new($false, 'Local\hvac-inventory-monitor')
if (-not $monitorMutex.WaitOne(0)) {
    Write-Host 'hvac-inventory monitor 已在執行，略過第二個 instance'
    exit 0
}

$TS        = 'C:\Program Files\Tailscale\tailscale.exe'
$PROJ      = Split-Path $PSScriptRoot -Parent
$STARTPS1   = Join-Path $PROJ 'scripts\start-server.ps1'
$HEARTBEAT = Join-Path $env:TEMP 'hvac_monitor_heartbeat.txt'
$STATE     = Join-Path $env:TEMP 'hvac_monitor_state.json'
$INTERVAL  = 600   # 檢查間隔秒數（10 分鐘）
$NOTIFY_AFTER = 2  # 同一問題連續 N 次才通知

# Discord webhook：從 .env 讀取
$WEBHOOK = $null
$envFile = Join-Path (Split-Path $PSScriptRoot -Parent) '.env'
if (Test-Path $envFile) {
    $m = Select-String -Path $envFile -Pattern '(?m)^DISCORD_WEBHOOK_URL=(.+)$'
    if ($m) { $WEBHOOK = $m.Matches[0].Groups[1].Value.Trim() }
}
if (-not $WEBHOOK) {
    Write-Host '⚠️ 未設定 Discord webhook（.env DISCORD_WEBHOOK_URL）— 通知功能停用，監控仍會重啟' -ForegroundColor Yellow
}
$CURL = "$env:SystemRoot\System32\curl.exe"
$JSON = Join-Path $env:TEMP 'hvac_monitor_webhook.json'

function Send-Discord([string]$Text) {
    if (-not $WEBHOOK) { return }
    $body = @{ content = $Text } | ConvertTo-Json -Compress
    [System.IO.File]::WriteAllText($JSON, $body, (New-Object System.Text.UTF8Encoding($false)))
    & $CURL -s -X POST -H 'Content-Type: application/json' --data-binary ("@$JSON") $WEBHOOK 2>$null
    Write-Host "   📢 已通知 Discord: $($Text.Split("`n")[0])" -ForegroundColor Green
}

function Test-Health([string]$Url) {
    # 回傳 $true = 正常回應（HTTP 2xx/3xx）
    $code = & $CURL -s -o NUL -w "%{http_code}" --max-time 15 $Url 2>$null
    return ($code -match '^[23]\d\d$')
}

function Get-State {
    if (Test-Path $STATE) {
        try { return (Get-Content $STATE -Raw | ConvertFrom-Json) } catch {}
    }
    return [PSCustomObject]@{ local_fails = 0; funnel_fails = 0; local_notified = $false; funnel_notified = $false }
}

function Save-State($s) {
    $s | ConvertTo-Json | Set-Content -Path $STATE -Encoding UTF8
}

function Reset-Counter([string]$Key, $s) {
    if ($Key -eq 'local') { $s.local_fails = 0; $s.local_notified = $false }
    else { $s.funnel_fails = 0; $s.funnel_notified = $false }
}

function Test-OneRound {
    $s = Get-State
    $now = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    Write-Host "── 監控檢查 $now ──" -ForegroundColor Cyan

    # ══ 1. 本機 server 8000 ══
    if (Test-Health $LocalUrl) {
        if ($s.local_fails -gt 0) { Write-Host "✅ 本機 server 已恢復（$LocalUrl）" -ForegroundColor Green }
        Reset-Counter 'local' $s
    } else {
        $s.local_fails++
        Write-Host "⚠️ 本機 server 無回應（第 $($s.local_fails) 次）：$LocalUrl" -ForegroundColor Yellow
        # 自動重啟（只透過 single-instance launcher）
        if (-not $DryRun) {
            Write-Host "   🔄 呼叫 single-instance launcher 重啟 server..." -ForegroundColor Cyan
            Start-Process powershell.exe -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$STARTPS1`"", "-Restart" -WindowStyle Hidden
            Start-Sleep -Seconds 8   # 等 server 起來
            $recovered = Test-Health $LocalUrl
            Write-Host "   ↳ 重啟後檢查: $($(if($recovered){'✅ 已恢復'}else{'❌ 仍未回應'}))" -ForegroundColor $(if($recovered){'Green'}else{'Red'})
        } else {
            Write-Host "   🔄 [DryRun] 會執行：start 開新視窗跑 start.bat" -ForegroundColor Cyan
        }
        # 連續 N 次才通知
        if ($s.local_fails -ge $NOTIFY_AFTER -and -not $s.local_notified) {
            $s.local_notified = $true
            $txt = "🚨 庫存系統警示（$now）`n本機 server 無回應（連續 $($s.local_fails) 次）：$LocalUrl`n已自動執行 start.bat 重啟。若持續異常請檢查主機。"
            if (-not $DryRun) { Send-Discord $txt } else { Write-Host "   📢 [DryRun] 會通知 Discord：本機 server 無回應" -ForegroundColor Cyan }
        }
    }

    # ══ 2. Funnel 網址 ══
    if (Test-Health $FunnelUrl) {
        if ($s.funnel_fails -gt 0) { Write-Host "✅ Funnel 網址已恢復（$FunnelUrl）" -ForegroundColor Green }
        Reset-Counter 'funnel' $s
    } else {
        $s.funnel_fails++
        Write-Host "⚠️ Funnel 網址無回應（第 $($s.funnel_fails) 次）：$FunnelUrl" -ForegroundColor Yellow
        # 自動重建 Funnel
        if (-not $DryRun) {
            Write-Host "   🔄 執行 tailscale funnel --bg 8000 重建..." -ForegroundColor Cyan
            & $TS funnel --bg 8000 2>$null | Out-Null
            Start-Sleep -Seconds 8
            $recovered = Test-Health $FunnelUrl
            Write-Host "   ↳ 重建後檢查: $($(if($recovered){'✅ 已恢復'}else{'❌ 仍未回應'}))" -ForegroundColor $(if($recovered){'Green'}else{'Red'})
        } else {
            Write-Host "   🔄 [DryRun] 會執行：tailscale funnel --bg 8000" -ForegroundColor Cyan
        }
        if ($s.funnel_fails -ge $NOTIFY_AFTER -and -not $s.funnel_notified) {
            $s.funnel_notified = $true
            $txt = "🚨 庫存系統警示（$now）`nFunnel 外網網址無回應（連續 $($s.funnel_fails) 次）：$FunnelUrl`n已自動重建 Funnel。若持續異常請檢查主機。"
            if (-not $DryRun) { Send-Discord $txt } else { Write-Host "   📢 [DryRun] 會通知 Discord：Funnel 網址無回應" -ForegroundColor Cyan }
        }
    }

    Save-State $s
    # 寫入 heartbeat
    Set-Content -Path $HEARTBEAT -Value (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') -Encoding UTF8
}

# ── 主流程 ──
Write-Host '🌐 振佳空調庫存 - 健康監控啟動' -ForegroundColor Green
Write-Host ("   檢查間隔：{0} 分鐘 | 通知條件：同一問題連續 {1} 次" -f ($INTERVAL/60), $NOTIFY_AFTER) -ForegroundColor Cyan
Write-Host ("   本機: {0}" -f $LocalUrl) -ForegroundColor DarkGray
Write-Host ("   Funnel: {0}" -f $FunnelUrl) -ForegroundColor DarkGray
if ($DryRun) { Write-Host '   ⚙️ DryRun 模式：只顯示動作，不實際執行' -ForegroundColor Yellow }
Write-Host ''

if ($Once) {
    Test-OneRound
    Write-Host '── 單輪檢查完成（-Once）──' -ForegroundColor Cyan
} else {
    while ($true) {
        Test-OneRound
        Write-Host "   💤 等待 $($INTERVAL/60) 分鐘後再檢查..." -ForegroundColor DarkGray
        Write-Host ''
        Start-Sleep -Seconds $INTERVAL
    }
}
