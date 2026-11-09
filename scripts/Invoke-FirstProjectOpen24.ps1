[CmdletBinding()]
param(

    [Parameter(Mandatory=$true)][switch]$ConfirmIsolatedModuleLoad,
    [Parameter(Mandatory=$true)][string]$ObserverReadyPath
)
$ErrorActionPreference = 'Stop'
$TargetProcessId = 72128
function ConvertTo-UtcDateTime([object]$Value) {
    if ($Value -is [DateTime]) { return $Value.ToUniversalTime() }
    return [DateTime]::Parse([string]$Value, [Globalization.CultureInfo]::InvariantCulture,
        [Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime()
}
if (-not $ConfirmIsolatedModuleLoad) { throw 'Explicit isolated module-load confirmation is required.' }
$root = Split-Path -Parent $PSScriptRoot
$launch = Get-Content -LiteralPath (Join-Path $root 'artifacts\runtime\cubase-empty-launch-24-e6ef5f706a6f436896265a73a0ba82a3.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($TargetProcessId -ne 72128 -or $launch.ProcessId -ne $TargetProcessId -or $launch.HostPid -ne 55324 -or
    $launch.Desktop -ne 'winsta0\CubaseAI_MCP' -or $launch.mode -cne 'empty' -or $null -ne $launch.Project -or $launch.processCreationFiletime -cne '134387281655745512' -or $launch.holderCreationFiletime -cne '134387281647304009' -or
    -not $launch.DesktopSwitchRestricted -or -not $launch.JobKillsOnLastHandleClose) {
    throw 'Target differs from the fixed restricted private launch receipt.'
}
$process = Get-Process -Id $TargetProcessId -ErrorAction Stop
if ($process.StartTime.ToUniversalTime().ToString('o') -ne '2026-11-09T20:02:45.5745512Z') { throw 'Fixed target start time changed.' }
$created = $process.StartTime.ToUniversalTime().ToFileTimeUtc()
$readyPath = [IO.Path]::GetFullPath($ObserverReadyPath)
$ipc = [IO.Path]::GetFullPath((Join-Path $root 'artifacts\ipc')).TrimEnd('\') + '\'
if (-not $readyPath.StartsWith($ipc,[StringComparison]::OrdinalIgnoreCase) -or
    [IO.Path]::GetFileName($readyPath) -notmatch '^first-project-open24-observer-72128-[a-f0-9]{32}\.ready\.json$') { throw 'Unexpected observer receipt path.' }
$ready = Get-Content -LiteralPath $readyPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($ready.pid -ne 72128 -or (ConvertTo-UtcDateTime $ready.processStartUtc).ToFileTimeUtc() -ne 134387281655745512L -or
    $ready.inputDesktop -ieq 'CubaseAI_MCP' -or $ready.foregroundPid -eq 72128 -or
    $ready.durationSeconds -lt 5 -or $ready.durationSeconds -gt 120 -or
    $ready.intervalMs -lt 100 -or $ready.intervalMs -gt 1000 -or $ready.id -notmatch '^[a-f0-9]{32}$' -or
    [IO.Path]::GetFileName($readyPath) -cne ("first-project-open24-observer-72128-{0}.ready.json" -f $ready.id)) { throw 'Observer receipt mismatch.' }
$observer = Get-Process -Id ([int]$ready.observerPid) -ErrorAction Stop
if ($observer.StartTime.ToUniversalTime() -ne (ConvertTo-UtcDateTime $ready.observerStartUtc)) { throw 'Observer process identity changed.' }
$started = ConvertTo-UtcDateTime $ready.startedUtc
$elapsed = ([DateTime]::UtcNow - $started).TotalSeconds
if ($elapsed -lt 0 -or $elapsed + 20 -ge [double]$ready.durationSeconds) { throw 'Insufficient observer time remains.' }
foreach ($kind in @('open-start', 'open-result', 'open-loader', 'open-admission')) {
    $existing = Join-Path $root ('artifacts\first-project-open-24\{0}-{1}.json' -f $kind, $TargetProcessId)
    if ((Test-Path -LiteralPath $existing) -or (Test-Path -LiteralPath ([IO.Path]::ChangeExtension($existing, '.tmp')))) { throw 'A project-open diagnostic record or temporary record already exists; no replay is allowed.' }
}
Add-Type -Path @((Join-Path $root 'native\CubaseDesktop.cs'), (Join-Path $root 'native\FirstProjectJobAudit24.cs'), (Join-Path $root 'native\FirstProjectOpen24Loader.cs'))
$inputMethod = [CubaseAiMcp.CubaseDesktop].GetMethod('InputDesktopName',[Reflection.BindingFlags]'NonPublic,Static')
if ($inputMethod.Invoke($null,@()) -ieq 'CubaseAI_MCP') { throw 'The isolated target desktop is the input desktop.' }
$observer = Get-Process -Id ([int]$ready.observerPid) -ErrorAction Stop
if ($observer.StartTime.ToUniversalTime() -ne (ConvertTo-UtcDateTime $ready.observerStartUtc)) { throw 'Observer process identity changed after compilation.' }
$deadline = $started.AddSeconds([double]$ready.durationSeconds - 2)
if ([DateTime]::UtcNow.AddSeconds(20) -ge $deadline) { throw 'Insufficient observer time remains after compilation.' }
$contractPath = Join-Path $root 'artifacts\first-project-open-24\observer-contract-72128.bin'
if (Test-Path -LiteralPath $contractPath) { throw 'An observer contract already exists; no replay is allowed.' }
$preflightJson = & (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') -NoProfile -NonInteractive -File (Join-Path $root 'scripts\Read-FirstProjectState24.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Fresh first-project state preflight failed.' }
$preflight = ($preflightJson -join [Environment]::NewLine) | ConvertFrom-Json
$age = ([DateTime]::UtcNow - (ConvertTo-UtcDateTime $preflight.sampledUtc)).TotalSeconds
if ($preflight.status -cne 'observed' -or $preflight.pid -ne 72128 -or
    [string]$preflight.processCreationFiletime -cne '134387281655745512' -or $preflight.holderPid -ne 55324 -or
    [string]$preflight.holderCreationFiletime -cne '134387281647304009' -or $age -lt 0 -or $age -gt 5 -or
    $preflight.data.globalRoot -cne '0x0' -or $preflight.data.projectListCount -ne 0 -or
    $preflight.data.projectListHead -cne '0x0' -or $preflight.data.informerTreeCount -ne 0 -or
    $preflight.data.listenerFound -ne $true -or $preflight.data.stable -ne $true -or $preflight.readyForFirstOpen -ne $true) {
    throw 'Fresh first-project state was not admitted.'
}
$job = [CubaseAiMcp.FirstProjectJobAudit24]::Verify()
if (-not $job.Verified -or $job.MatchingJobs -ne 1 -or $job.UiFlags -ne 64 -or $job.LimitFlags -ne 8192) { throw 'Job admission failed.' }
$age = ([DateTime]::UtcNow - (ConvertTo-UtcDateTime $preflight.sampledUtc)).TotalSeconds
if ($age -lt 0 -or $age -gt 5 -or [DateTime]::UtcNow.AddSeconds(20) -ge $deadline) { throw 'Preflight or observer deadline expired.' }
$admissionPath = Join-Path $root 'artifacts\first-project-open-24\open-admission-72128.json'
$admission = [ordered]@{pid=72128;processStartUtc=$process.StartTime.ToUniversalTime().ToString('o');
    timestampUtc=[DateTime]::UtcNow.ToString('o');observerReady=$readyPath;observerDeadlineUtc=$deadline.ToString('o');fixture='First Empty Probe 24.cpr';oneShot=$true} | ConvertTo-Json
$admissionFile = [IO.File]::Open($admissionPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
try { $writer=[IO.StreamWriter]::new($admissionFile,[Text.UTF8Encoding]::new($false)); try {$writer.Write($admission);$writer.Flush();$admissionFile.Flush($true)} finally {$writer.Dispose()} } finally {$admissionFile.Dispose()}
$contractFile = [IO.File]::Open($contractPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
try {
    $binary = [IO.BinaryWriter]::new($contractFile)
    try {
        $binary.Write([uint32]1); $binary.Write([uint32]$observer.Id)
        $binary.Write([int64]$observer.StartTime.ToUniversalTime().ToFileTimeUtc()); $binary.Write([int64]$deadline.ToFileTimeUtc())
        $binary.Flush(); $contractFile.Flush($true)
    } finally { $binary.Dispose() }
} finally { $contractFile.Dispose() }
$result = [CubaseAiMcp.FirstProjectOpen24Loader]::LoadAndStartFirstProjectOpen24($TargetProcessId, $created, $root)
$json = $result | ConvertTo-Json -Depth 6
$resultPath = Join-Path $root 'artifacts\first-project-open-24\open-loader-72128.json'
$resultFile = [IO.File]::Open($resultPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
try { $writer=[IO.StreamWriter]::new($resultFile,[Text.UTF8Encoding]::new($false)); try {$writer.Write($json);$writer.Flush();$resultFile.Flush($true)} finally {$writer.Dispose()} } finally {$resultFile.Dispose()}
$json
if ($result.Error -or -not $result.EntryCompleted -or $result.EntryReturnCode -ne 0) { exit 1 }
