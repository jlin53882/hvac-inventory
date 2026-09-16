[CmdletBinding()]
param(
    [switch]$Restart,
    [int]$Port = 8000
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Python = (Resolve-Path (Join-Path $ProjectRoot '.venv\Scripts\python.exe')).Path
$MutexName = 'Local\hvac-inventory-server-launcher'
$ownsMutex = $false
$serverProcess = $null

function Get-ProcessInfoByPid {
    param([int]$ProcessId)
    Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
}

function Get-PortListeners {
    @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

function Test-IsRepoServerProcess {
    param($Process)
    if (-not $Process) { return $false }
    $root = ([System.IO.Path]::GetFullPath($ProjectRoot)).ToLowerInvariant().TrimEnd('\\')
    $projectPython = ([System.IO.Path]::GetFullPath($Python)).ToLowerInvariant()
    $exe = ([string]$Process.ExecutablePath).ToLowerInvariant()
    $cmd = ([string]$Process.CommandLine).ToLowerInvariant()
    return $exe -eq $projectPython -or $cmd.Contains($root)
}

function Get-RepoServerProcesses {
    $result = @()
    foreach ($listener in @(Get-PortListeners)) {
        $process = Get-ProcessInfoByPid -ProcessId $listener.OwningProcess
        if (Test-IsRepoServerProcess $process) {
            $result += $process
        }
    }
    return @($result)
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

function Wait-ServerReady {
    param(
        [System.Diagnostics.Process]$Process,
        [int]$ReadyTimeoutSeconds = 15
    )
    $deadline = (Get-Date).AddSeconds($ReadyTimeoutSeconds)
    do {
        $Process.Refresh()
        if ($Process.HasExited) {
            throw "hvac-inventory 啟動失敗，process 已退出：$($Process.ExitCode)"
        }
        if (@(Get-PortListeners).Count -gt 0) { return }
        Start-Sleep -Milliseconds 250
    } while ((Get-Date) -lt $deadline)

    try {
        Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
    } catch {
        Write-Verbose "failed to stop timed-out server"
    }
    throw "hvac-inventory 啟動 timeout，port $Port 未進入 LISTEN"
}

if (-not (Test-Path $Python)) {
    throw "找不到專案 Python：$Python"
}

$mutex = [System.Threading.Mutex]::new($false, $MutexName)
trap {
    if ($ownsMutex) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
    throw
}
try {
    $ownsMutex = $mutex.WaitOne([TimeSpan]::FromSeconds(15))
} catch [System.Threading.AbandonedMutexException] {
    $ownsMutex = $true
}
if (-not $ownsMutex) {
    $mutex.Dispose()
    throw '另一個 hvac-inventory launcher 正在處理啟動／重啟，拒絕並行操作'
}

$listeners = @(Get-PortListeners)
$repoProcesses = @(Get-RepoServerProcesses)
$repoPids = @($repoProcesses | Select-Object -ExpandProperty ProcessId -Unique)
$foreignListeners = @($listeners | Where-Object { $repoPids -notcontains $_.OwningProcess })
if ($foreignListeners.Count -gt 0) {
    $pids = ($foreignListeners | Select-Object -ExpandProperty OwningProcess -Unique) -join ', '
    throw "port $Port 已被非 hvac-inventory process 佔用（PID=$pids），不會強制終止"
}

$skipExisting = $false
if ($Restart) {
    Stop-RepoServers
    Wait-PortReleased
} elseif ($repoProcesses.Count -gt 0) {
    $pids = ($repoProcesses | Select-Object -ExpandProperty ProcessId -Unique) -join ', '
    Write-Host "hvac-inventory 已在執行（PID=$pids），略過重複啟動"
    $skipExisting = $true
}

if (-not $skipExisting) {
    $args = @(
        '-m', 'uvicorn', 'main:app',
        '--app-dir', $ProjectRoot,
        '--host', '0.0.0.0',
        '--port', "$Port"
    )
    Write-Host "啟動 hvac-inventory http://0.0.0.0:$Port"
    $serverProcess = Start-Process -FilePath $Python -ArgumentList $args `
        -WorkingDirectory $ProjectRoot -PassThru -NoNewWindow
    Wait-ServerReady -Process $serverProcess
}

# 只保護 inspect → stop → spawn → ready；server lifetime 不在 mutex 內。
if ($ownsMutex) { $mutex.ReleaseMutex(); $ownsMutex = $false }
$mutex.Dispose()

# done

if ($serverProcess) {
    Wait-Process -Id ($serverProcess.Id)
    $serverProcess.Refresh()
    exit $serverProcess.ExitCode
}
