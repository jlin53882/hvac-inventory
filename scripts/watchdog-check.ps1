# 振佳空調庫存管理系統 - 監控 watchdog（由 Windows 工作排程器每 10 分鐘呼叫）
# 用途：監控「監控腳本」本身是否存活 / 是否卡死（heartbeat 過舊）
#   - monitor.ps1 沒在跑 → 重新啟動 + Discord 通知
#   - monitor.ps1 在跑但 heartbeat 超過 15 分鐘沒更新 → 卡死 → 重啟 + Discord 通知
# 安裝：執行 install-monitor.bat（會註冊工作排程器）
$ErrorActionPreference = 'Continue'

$SCRIPT_DIR = $PSScriptRoot
$MONITOR    = Join-Path $SCRIPT_DIR 'monitor.ps1'
$HEARTBEAT  = Join-Path $env:TEMP 'hvac_monitor_heartbeat.txt'
$STALE_SEC  = 900   # heartbeat 超過 15 分鐘 = 卡死

# Discord webhook
$WEBHOOK = $null
$WEBHOOK_LOCAL = Join-Path $SCRIPT_DIR 'webhook.local.ps1'
if (Test-Path $WEBHOOK_LOCAL) { . $WEBHOOK_LOCAL }
$CURL = "$env:SystemRoot\System32\curl.exe"
$JSON = Join-Path $env:TEMP 'hvac_watchdog_webhook.json'

function Send-Discord([string]$Text) {
    if (-not $WEBHOOK) { return }
    $body = @{ content = $Text } | ConvertTo-Json -Compress
    [System.IO.File]::WriteAllText($JSON, $body, (New-Object System.Text.UTF8Encoding($false)))
    & $CURL -s -X POST -H 'Content-Type: application/json' --data-binary ("@$JSON") $WEBHOOK 2>$null
}

function Test-MonitorRunning {
    # 檢查 monitor.ps1 是否在執行（PowerShell 處理程序命令列含 monitor.ps1）
    $found = Get-CimInstance Win32_Process -Filter "Name='powershell.exe' OR Name='pwsh.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -match 'monitor\.ps1' }
    return ($null -ne $found)
}

$now = Get-Date
$issue = $null

# 檢查 1：monitor.ps1 是否在跑
if (-not (Test-MonitorRunning)) {
    $issue = "監控腳本 monitor.ps1 未在執行"
} else {
    # 檢查 2：heartbeat 是否過舊（卡死）
    if (Test-Path $HEARTBEAT) {
        try {
            $lastBeat = [datetime]::ParseExact((Get-Content $HEARTBEAT -Raw).Trim(), 'yyyy-MM-dd HH:mm:ss', $null)
            $age = ($now - $lastBeat).TotalSeconds
            if ($age -gt $STALE_SEC) {
                $issue = "監控腳本可能卡死（heartbeat $([math]::Round($age/60)) 分鐘前）"
            }
        } catch {
            $issue = "監控 heartbeat 無法解析（$($_.Exception.Message)）"
        }
    } else {
        $issue = "監控 heartbeat 檔案不存在（monitor.ps1 可能剛啟動或從未寫入）"
    }
}

if ($issue) {
    Write-Host "⚠️ watchdog: $issue — 重新啟動 monitor.ps1" -ForegroundColor Yellow
    # 清掉可能殘留的 monitor 進程，再啟動新的
    Get-CimInstance Win32_Process -Filter "Name='powershell.exe' OR Name='pwsh.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -match 'monitor\.ps1' } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Start-Process powershell -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$MONITOR`"" -WindowStyle Hidden
    Start-Sleep -Seconds 3
    $back = if (Test-MonitorRunning) { '✅ 已重啟' } else { '❌ 重啟失敗' }
    Write-Host "   ↳ $back" -ForegroundColor $(if($back -like '✅*'){'Green'}else{'Red'})
    Send-Discord "🚨 庫存系統監控警示（$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')）`n$issue → 已自動重新啟動 monitor.ps1（$back）"
} else {
    Write-Host "✅ watchdog: monitor.ps1 正常運作" -ForegroundColor Green
}
