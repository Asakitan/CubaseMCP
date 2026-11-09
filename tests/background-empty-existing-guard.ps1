[CmdletBinding()]
param([Parameter(Mandatory=$true)][ValidateRange(1,2147483647)][int]$ExpectedProcessId)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$launch = Get-Content -LiteralPath (Join-Path $root 'artifacts\runtime\cubase-launch.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ([int]$launch.ProcessId -ne $ExpectedProcessId -or $launch.Desktop -cne 'winsta0\CubaseAI_MCP') {
    throw 'Expected an owned isolated Cubase process in the launch receipt.'
}
$target = Get-Process -Id $ExpectedProcessId
$started = $target.StartTime.ToUniversalTime()
$before = @(Get-Process -Name 'Cubase*' -ErrorAction SilentlyContinue | ForEach-Object { "$($_.Id):$($_.StartTime.ToUniversalTime().ToFileTimeUtc())" } | Sort-Object)
$runId = [Guid]::NewGuid().ToString('N')
$output = & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $root 'scripts\Start-CubaseEmptyBackground.ps1') -Background -RunId $runId
if ($LASTEXITCODE -ne 0) { throw 'Empty launcher failed before its starter receipt.' }
$result = $output | ConvertFrom-Json
if ($result.status -cne 'starting' -or $result.RunId -cne $runId -or [int]$result.hostPid -le 0) { throw 'Unexpected empty starter receipt.' }
$timer = [Diagnostics.Stopwatch]::StartNew()
while ((Get-Process -Id $result.hostPid -ErrorAction SilentlyContinue) -and $timer.Elapsed.TotalSeconds -lt 15) { Start-Sleep -Milliseconds 100 }
if (Get-Process -Id $result.hostPid -ErrorAction SilentlyContinue) { throw 'Empty launch guard did not exit.' }
$errorText = Get-Content -LiteralPath $result.stderrFile -Raw -Encoding UTF8
if ($errorText -notmatch 'Cubase is already running') { throw 'Empty launch guard result was not logged.' }
if (Test-Path -LiteralPath (Join-Path $root "artifacts\runtime\cubase-empty-launch-24-$runId.json")) { throw 'A target launch receipt was unexpectedly created.' }
$after = @(Get-Process -Name 'Cubase*' -ErrorAction SilentlyContinue | ForEach-Object { "$($_.Id):$($_.StartTime.ToUniversalTime().ToFileTimeUtc())" } | Sort-Object)
if ((Get-Process -Id $ExpectedProcessId).StartTime.ToUniversalTime() -ne $started -or
    (Compare-Object $before $after)) { throw 'Cubase process identities changed during the guard test.' }
[PSCustomObject]@{status='passed';targetPid=$ExpectedProcessId;hostPid=[int]$result.hostPid;runId=$runId;
    stdoutFile=$result.stdoutFile;stderrFile=$result.stderrFile;
    limitation='The existing owned process caused a guard rejection; this is not a new Cubase launch.'} | ConvertTo-Json
