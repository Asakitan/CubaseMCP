[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][ValidateRange(1,2147483647)][int]$TargetProcessId,
    [Parameter(Mandatory=$true)][switch]$ConfirmIsolatedModuleLoad
)
$ErrorActionPreference='Stop'
if(-not $ConfirmIsolatedModuleLoad){throw 'Explicit isolated module-load confirmation is required.'}
$Root=Split-Path -Parent $PSScriptRoot
$Launch=Get-Content -LiteralPath (Join-Path $Root 'artifacts\runtime\cubase-launch.json') -Raw -Encoding UTF8|ConvertFrom-Json
if($Launch.ProcessId -ne $TargetProcessId -or $Launch.Desktop -ne 'winsta0\CubaseAI_MCP'){throw 'Target differs from the owned private launch receipt.'}
$Process=Get-Process -Id $TargetProcessId -ErrorAction Stop
$Created=$Process.StartTime.ToUniversalTime().ToFileTimeUtc()
$Output=Join-Path $Root ('artifacts\native-probe\result-'+$TargetProcessId+'.json')
if(Test-Path -LiteralPath $Output){throw 'A result already exists for this process; no replay is allowed.'}
Add-Type -Path @((Join-Path $Root 'native\CubaseDesktop.cs'),(Join-Path $Root 'native\NativeProbeLoader.cs'))
$Result=[CubaseAiMcp.NativeProbeLoader]::LoadAndStart($TargetProcessId,$Created,$Root)
$Result|ConvertTo-Json -Depth 5
if($Result.Error -or -not $Result.EntryCompleted -or $Result.EntryReturnCode -ne 0){exit 1}
