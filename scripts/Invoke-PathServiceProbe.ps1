[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][ValidateRange(1,2147483647)][int]$TargetProcessId,
    [Parameter(Mandatory=$true)][switch]$ConfirmIsolatedModuleLoad
)
$ErrorActionPreference = 'Stop'
if (-not $ConfirmIsolatedModuleLoad) { throw 'Explicit isolated module-load confirmation is required.' }
$root = Split-Path -Parent $PSScriptRoot
$launch = Get-Content -LiteralPath (Join-Path $root 'artifacts\runtime\cubase-launch.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($launch.ProcessId -ne $TargetProcessId -or $launch.Desktop -ne 'winsta0\CubaseAI_MCP') { throw 'Target differs from the owned private launch receipt.' }
$process = Get-Process -Id $TargetProcessId -ErrorAction Stop
$created = $process.StartTime.ToUniversalTime().ToFileTimeUtc()
foreach ($kind in @('path-start', 'path-result')) {
    $existing = Join-Path $root ('artifacts\native-probe\{0}-{1}.json' -f $kind, $TargetProcessId)
    if (Test-Path -LiteralPath $existing) { throw 'A path diagnostic record already exists for this process; no replay is allowed.' }
}
Add-Type -Path @((Join-Path $root 'native\CubaseDesktop.cs'), (Join-Path $root 'native\NativeProbeLoader.cs'))
$result = [CubaseAiMcp.NativeProbeLoader]::LoadAndStartPathProbe($TargetProcessId, $created, $root)
$result | ConvertTo-Json -Depth 5
if ($result.Error -or -not $result.EntryCompleted -or $result.EntryReturnCode -ne 0) { exit 1 }
