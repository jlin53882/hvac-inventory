# Restart the Windows Tailscale service for the HVAC monitor recovery task.
# This script is executed by Task Scheduler as SYSTEM with highest privileges.
$ErrorActionPreference = 'Stop'
$serviceName = 'Tailscale'
$resultPath = Join-Path $env:TEMP 'hvac_tailscale_recovery_result.json'
$before = (Get-CimInstance Win32_Service -Filter "Name='$serviceName'").ProcessId
Restart-Service -Name $serviceName -Force
$deadline = (Get-Date).AddSeconds(30)
do {
    Start-Sleep -Seconds 2
    $service = Get-CimInstance Win32_Service -Filter "Name='$serviceName'"
} while ($service.State -ne 'Running' -and (Get-Date) -lt $deadline)
if ($service.State -ne 'Running') {
    throw "Tailscale service did not return to Running state."
}
@{
    BeforePid = $before
    AfterPid = $service.ProcessId
    State = $service.State
    Timestamp = (Get-Date).ToString('o')
} | ConvertTo-Json | Set-Content -Path $resultPath -Encoding UTF8
