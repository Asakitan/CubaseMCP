param([string]$Root, [string]$Marker, [string]$StdoutPath, [string]$StderrPath, [string]$Directory)
$ErrorActionPreference = 'Stop'
Add-Type -Path (Join-Path $Root 'native\CubaseDesktop.cs')
$HolderId = [CubaseAiMcp.CubaseDesktop]::StartDetachedHolder(
    (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'),
    (Join-Path $Root 'tests\DetachedHolderProbe.ps1'), $Marker, $StdoutPath, $StderrPath, $Directory)
[PSCustomObject]@{ holderPid = $HolderId } | ConvertTo-Json
