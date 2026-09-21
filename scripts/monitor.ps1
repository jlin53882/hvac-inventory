# 振佳空調庫存管理系統 - 外網健康監控（常駐）
# 由「install-monitor.bat」啟動。直接執行亦可。
# 行為：每 10 分鐘檢查本機 server(8000) 與 Tailscale Funnel 網址
#   - 本機 8000 無回應 → start 開新視窗跑 start.bat 重啟 + Discord 通知
#   - 公網 Funnel 無回應 → 觸發高權限工作排程重啟 Tailscale 服務 + Discord 通知
#   - 本機 Funnel 檢查只作輔助；公網探測繞過 MagicDNS，避免漏判控制平面不同步
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
$TS_RECOVERY_TASK = 'HVAC-Tailscale-Recovery'
$PUBLIC_HOST = 'node.tail13203e.ts.net'
$DNS_SERVER  = '1.1.1.1'
$HEARTBEAT = Join-Path $env:TEMP 'hvac_monitor_heartbeat.txt'
$STATE     = Join-Path $env:TEMP 'hvac_monitor_state.json'
$INTERVAL  = 600   # 檢查間隔秒數（10 分鐘）
$NOTIFY_AFTER = 2  # 同一問題連續 N 次才通知
$RECOVERY_MAX = 2 # 同一 Funnel 故障事件最多自動重啟兩次，避免官方故障時無限重啟

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

function Get-PublicIPv4 {
    try {
        return @(Resolve-DnsName -Name $PUBLIC_HOST -Type A -Server $DNS_SERVER -ErrorAction Stop |
            Where-Object { $_.Type -eq 'A' } |
            Select-Object -ExpandProperty IPAddress -Unique)
    } catch {
        Write-Host "   ⚠️ 無法透過 $DNS_SERVER 解析公網 DNS：$($_.Exception.Message)" -ForegroundColor Yellow
        return @()
    }
}

function Test-PublicFunnel {
    # 本機 MagicDNS 會把網域解析成 100.x 內部 IP；這裡強制連公網 A 記錄，
    # 才能抓到「本機 Funnel 顯示正常、控制平面卻沒同步」的 TLS 斷線問題。
    $ips = @(Get-PublicIPv4)
    if ($ips.Count -eq 0) { return $false }
    foreach ($ip in $ips) {
        $code = & $CURL -s -k -o NUL -w "%{http_code}" --connect-timeout 10 --max-time 20 `
            --resolve "$PUBLIC_HOST`:443`:$ip" "https://$PUBLIC_HOST/health" 2>$null
        if ($code -match '^[23]\d\d$') { return $true }
    }
    return $false
}

function Request-TailscaleRecovery {
    # recovery task 以 SYSTEM/HIGHEST 執行，避免 monitor 背景程序遇到 UAC 而卡住。
    $result = & schtasks.exe /run /tn $TS_RECOVERY_TASK 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) {
        Write-Host "   ⚠️ 無法觸發 $TS_RECOVERY_TASK：$($result.Trim())" -ForegroundColor Yellow
        return $false
    }
    return $true
}

function Get-State {
    if (Test-Path $STATE) {
        try {
            $s = Get-Content $STATE -Raw | ConvertFrom-Json
            if ($null -eq $s.PSObject.Properties['funnel_recovery_attempts']) {
                $s | Add-Member -NotePropertyName funnel_recovery_attempts -NotePropertyValue 0
            }
            return $s
        } catch {}
    }
    return [PSCustomObject]@{ local_fails = 0; funnel_fails = 0; local_notified = $false; funnel_notified = $false; funnel_recovery_attempts = 0 }
}

function Save-State($s) {
    $s | ConvertTo-Json | Set-Content -Path $STATE -Encoding UTF8
}

function Reset-Counter([string]$Key, $s) {
    if ($Key -eq 'local') { $s.local_fails = 0; $s.local_notified = $false }
    else { $s.funnel_fails = 0; $s.funnel_notified = $false; $s.funnel_recovery_attempts = 0 }
}

function Test-OneRound {
    $s = Get-State
    $now = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    Write-Host "── 監控檢查 $now ──" -ForegroundColor Cyan

    # ══ 1. 本機 server 8000 ══
    if (Test-Health $LocalUrl) {
        if ($s.local_fails -gt 0) {
            Write-Host "✅ 本機 server 已恢復（$LocalUrl）" -ForegroundColor Green
            $txt = "✅ 庫存系統已恢復（$now）`n本機 server 已恢復：$LocalUrl`n監控已確認自動重啟後服務正常。"
            if (-not $DryRun) { Send-Discord $txt } else { Write-Host "   📢 [DryRun] 會通知 Discord：本機 server 已恢復" -ForegroundColor Cyan }
        }
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

    # ══ 2. Funnel 公網端到端 ══
    # 不使用一般 FunnelUrl 解析，避免本機 MagicDNS 把檢查導回 100.x 內網。
    if (Test-PublicFunnel) {
        if ($s.funnel_fails -gt 0) {
            Write-Host "✅ Funnel 公網網址已恢復（$FunnelUrl）" -ForegroundColor Green
            $txt = "✅ 庫存系統外網已恢復（$now）`nFunnel 公網網址已恢復：$FunnelUrl`n監控已確認 Tailscale 自動復原後公網連線正常。"
            if (-not $DryRun) { Send-Discord $txt } else { Write-Host "   📢 [DryRun] 會通知 Discord：Funnel 公網網址已恢復" -ForegroundColor Cyan }
        }
        Reset-Counter 'funnel' $s
    } else {
        $s.funnel_fails++
        Write-Host "⚠️ Funnel 公網網址無回應（第 $($s.funnel_fails) 次）：$FunnelUrl" -ForegroundColor Yellow
        if (-not $DryRun) {
            if ($s.funnel_recovery_attempts -lt $RECOVERY_MAX) {
                $s.funnel_recovery_attempts++
                Write-Host "   🔄 觸發高權限工作排程重啟 Tailscale 服務（第 $($s.funnel_recovery_attempts)/$RECOVERY_MAX 次）..." -ForegroundColor Cyan
                $triggered = Request-TailscaleRecovery
                if ($triggered) {
                    Start-Sleep -Seconds 15
                    $recovered = Test-PublicFunnel
                    Write-Host "   ↳ Tailscale 重啟後檢查: $($(if($recovered){'✅ 已恢復'}else{'❌ 仍未回應'}))" -ForegroundColor $(if($recovered){'Green'}else{'Red'})
                } else {
                    $recovered = $false
                }
            } else {
                Write-Host "   ⏸️ 已達本次故障自動重啟上限（$RECOVERY_MAX 次），等待外部恢復並保留通知。" -ForegroundColor Yellow
            }
        } else {
            Write-Host "   🔄 [DryRun] 會執行：schtasks /run /tn $TS_RECOVERY_TASK" -ForegroundColor Cyan
        }
        if ($s.funnel_fails -ge $NOTIFY_AFTER -and -not $s.funnel_notified) {
            $s.funnel_notified = $true
            $txt = "🚨 庫存系統警示（$now）`nFunnel 公網網址無回應（連續 $($s.funnel_fails) 次）：$FunnelUrl`n已觸發高權限工作排程重啟 Tailscale 服務。若持續異常請檢查 Tailscale 官方狀態。"
            if (-not $DryRun) { Send-Discord $txt } else { Write-Host "   📢 [DryRun] 會通知 Discord：Funnel 公網網址無回應" -ForegroundColor Cyan }
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
