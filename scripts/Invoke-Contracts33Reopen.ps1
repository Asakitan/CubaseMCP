[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidatePattern('^[a-z0-9-]+$')][string]$Label,
    [ValidateSet('bootstrap', 'reopen')][string]$Phase = 'reopen'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node.exe -CommandType Application).Source
$script = Join-Path $PSScriptRoot 'verify-contracts33.cjs'
$resultPath = Join-Path $root "artifacts\ipc\contracts33-$Label-$Phase-result.json"
if (Test-Path -LiteralPath $resultPath) { throw 'The reopen result already exists.' }
$startup = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0; CreateFlags = [uint32]0x01000008 }
$launch = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine = "`"$node`" `"$script`" $Phase $Label"
    CurrentDirectory = $root
    ProcessStartupInformation = $startup
}
if ($launch.ReturnValue -ne 0) { throw "Local test process creation failed: $($launch.ReturnValue)" }
Write-Output "Test process: $($launch.ProcessId)"
Wait-Process -Id $launch.ProcessId
$result = Get-Content -LiteralPath $resultPath -Raw -Encoding utf8 | ConvertFrom-Json
$result | ConvertTo-Json -Depth 8
if (-not $result.passed) { throw 'Fresh-process contract verification failed; inspect its evidence ledger.' }