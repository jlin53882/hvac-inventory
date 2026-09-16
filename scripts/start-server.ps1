[CmdletBinding()]
param(
    [switch]$Restart,
    [int]$Port = 8000
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Python = Join-Path $ProjectRoot '.venv\Scripts\python.exe'
$MutexName = 'Local\hvac-inventory-server-launcher'
$ownsMutex = $false

if (-not (Test-Path $Python)) {
    throw "找不到專案 Python：$Python"
}

function Get-RepoServerProcesses {
    $root = $ProjectRoot.ToLowerInvariant()
    @(Get-CimInstance Win32_Process | Where-Object {
        $cmd = [string]$_.CommandLine
        (([string]$_.ExecutablePath).ToLowerInvariant().Contains($root) -or $cmd.ToLowerInvariant().Contains($root)) -and
        $cmd.ToLowerInvariant().Contains('uvicorn') -and
        $cmd.ToLowerInvariant().Contains("--port $Port")
    })
}

function Get-PortListeners {
    @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

function Stop-RepoServers {
    foreach ($process in @(Get-RepoServerProcesses)) {
        if ($process.ProcessId -eq $PID) { continue }
        Write-Host "停止既有 hvac-inventory worker PID=$($process.ProcessId)"
        Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

function Wait-PortReleased {
    param([int]$TimeoutSeconds = 10)
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        if (@(Get-PortListeners).Count -eq 0) { return }
        Start-Sleep -Milliseconds 250
    } while ((Get-Date) -lt $deadline)
    throw "port $Port 仍被佔用，拒絕啟動新的 hvac-inventory worker"
}

$mutex = [System.Threading.Mutex]::new($false, $MutexName)
try {
    if (-not $mutex.WaitOne([TimeSpan]::FromSeconds(15))) {
        throw '另一個 hvac-inventory launcher 正在處理啟動／重啟，拒絕並行操作'
    }
    $ownsMutex = $true

    $listeners = @(Get-PortListeners)
    $repoProcesses = @(Get-RepoServerProcesses)
    $foreignListeners = @($listeners | Where-Object {
        $listenerPid = $_.OwningProcess
        -not ($repoProcesses.ProcessId -contains $listenerPid)
    })

    if ($foreignListeners.Count -gt 0) {
        $pids = ($foreignListeners | Select-Object -ExpandProperty OwningProcess -Unique) -join ', '
        throw "port $Port 已被非 hvac-inventory process 佔用（PID=$pids），不會強制終止"
    }

    if ($Restart) {
        Stop-RepoServers
        Wait-PortReleased
    } elseif ($listeners.Count -gt 0 -or $repoProcesses.Count -gt 0) {
        $pids = ($repoProcesses | Select-Object -ExpandProperty ProcessId -Unique) -join ', '
        Write-Host "hvac-inventory 已在執行（PID=$pids），略過重複啟動"
        exit 0
    }

    Write-Host "啟動 hvac-inventory http://0.0.0.0:$Port"
    & $Python -m uvicorn main:app --app-dir $ProjectRoot --host 0.0.0.0 --port $Port
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
} finally {
    if ($ownsMutex) {
        try { $mutex.ReleaseMutex() } catch [System.Threading.AbandonedMutexException] {}
    }
    $mutex.Dispose()
}
