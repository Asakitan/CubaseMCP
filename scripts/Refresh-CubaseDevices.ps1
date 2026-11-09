[CmdletBinding()]
param([Parameter(Mandatory = $true)][ValidateRange(1, 2147483647)][int]$TargetProcessId)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Add-Type -Path (Join-Path $Root 'native\CubaseDeviceRefresh.cs')
try {
    [CubaseAiMcp.CubaseDeviceRefresh]::Notify($TargetProcessId) | ConvertTo-Json
} catch {
    $Failure = $_.Exception
    while ($Failure.InnerException) { $Failure = $Failure.InnerException }
    $NativeCode = if ($Failure -is [ComponentModel.Win32Exception]) { $Failure.NativeErrorCode } else { $null }
    [pscustomobject]@{ delivered = $false; driverReloadVerified = $false; nativeError = $NativeCode; error = $Failure.Message } | ConvertTo-Json
    exit 1
}
