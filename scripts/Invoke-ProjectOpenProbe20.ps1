[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][ValidateRange(1,2147483647)][int]$TargetProcessId,
    [Parameter(Mandatory=$true)][switch]$ConfirmIsolatedModuleLoad,
    [Parameter(Mandatory=$true)][string]$ObserverReadyPath
)
$ErrorActionPreference = 'Stop'
if (-not $ConfirmIsolatedModuleLoad) { throw 'Explicit isolated module-load confirmation is required.' }
$root = Split-Path -Parent $PSScriptRoot
$launch = Get-Content -LiteralPath (Join-Path $root 'artifacts\runtime\cubase-launch.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($TargetProcessId -ne 24036 -or $launch.ProcessId -ne $TargetProcessId -or $launch.HostPid -ne 49588 -or
    $launch.Desktop -ne 'winsta0\CubaseAI_MCP' -or $launch.Project -ine 'E:\VC\CubaseMCP\artifacts\live-smoke\Open SameDir 20.cpr' -or
    -not $launch.DesktopSwitchRestricted -or -not $launch.JobKillsOnLastHandleClose) {
    throw 'Target differs from the fixed restricted private launch receipt.'
}
$process = Get-Process -Id $TargetProcessId -ErrorAction Stop
if ($process.StartTime.ToUniversalTime().ToString('o') -ne '2026-11-09T19:11:22.3263004Z') { throw 'Fixed target start time changed.' }
$created = $process.StartTime.ToUniversalTime().ToFileTimeUtc()
$readyPath = [IO.Path]::GetFullPath($ObserverReadyPath)
$ipc = [IO.Path]::GetFullPath((Join-Path $root 'artifacts\ipc')).TrimEnd('\') + '\'
if (-not $readyPath.StartsWith($ipc,[StringComparison]::OrdinalIgnoreCase) -or
    [IO.Path]::GetFileName($readyPath) -notmatch '^project-open20-observer-24036-[a-f0-9]{32}\.ready\.json$') { throw 'Unexpected observer receipt path.' }
$ready = Get-Content -LiteralPath $readyPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($ready.pid -ne 24036 -or $ready.processStartUtc -cne '2026-11-09T19:11:22.3263004Z' -or
    $ready.inputDesktop -ieq 'CubaseAI_MCP' -or $ready.foregroundPid -eq 24036 -or
    $ready.durationSeconds -lt 5 -or $ready.durationSeconds -gt 120 -or
    $ready.intervalMs -lt 100 -or $ready.intervalMs -gt 1000 -or $ready.id -notmatch '^[a-f0-9]{32}$' -or
    [IO.Path]::GetFileName($readyPath) -cne ("project-open20-observer-24036-{0}.ready.json" -f $ready.id)) { throw 'Observer receipt mismatch.' }
$observer = Get-Process -Id ([int]$ready.observerPid) -ErrorAction Stop
if ($observer.StartTime.ToUniversalTime().ToString('o') -cne $ready.observerStartUtc) { throw 'Observer process identity changed.' }
$started = [DateTime]::Parse([string]$ready.startedUtc).ToUniversalTime()
$elapsed = ([DateTime]::UtcNow - $started).TotalSeconds
if ($elapsed -lt 0 -or $elapsed + 20 -ge [double]$ready.durationSeconds) { throw 'Insufficient observer time remains.' }
foreach ($kind in @('open-start', 'open-result', 'open-loader', 'open-admission')) {
    $existing = Join-Path $root ('artifacts\project-open-probe-20\{0}-{1}.json' -f $kind, $TargetProcessId)
    if ((Test-Path -LiteralPath $existing) -or (Test-Path -LiteralPath ([IO.Path]::ChangeExtension($existing, '.tmp')))) { throw 'A project-open diagnostic record or temporary record already exists; no replay is allowed.' }
}
Add-Type -Path @((Join-Path $root 'native\CubaseDesktop.cs'), (Join-Path $root 'native\ProjectOpenJobAudit20.cs'), (Join-Path $root 'native\ProjectOpenProbe20Loader.cs'))
$inputMethod = [CubaseAiMcp.CubaseDesktop].GetMethod('InputDesktopName',[Reflection.BindingFlags]'NonPublic,Static')
if ($inputMethod.Invoke($null,@()) -ieq 'CubaseAI_MCP') { throw 'The isolated target desktop is the input desktop.' }
$observer = Get-Process -Id ([int]$ready.observerPid) -ErrorAction Stop
if ($observer.StartTime.ToUniversalTime().ToString('o') -cne $ready.observerStartUtc) { throw 'Observer process identity changed after compilation.' }
$deadline = $started.AddSeconds([double]$ready.durationSeconds - 2)
if ([DateTime]::UtcNow.AddSeconds(20) -ge $deadline) { throw 'Insufficient observer time remains after compilation.' }
$contractPath = Join-Path $root 'artifacts\project-open-probe-20\observer-contract-24036.bin'
if (Test-Path -LiteralPath $contractPath) { throw 'An observer contract already exists; no replay is allowed.' }
$admissionPath = Join-Path $root 'artifacts\project-open-probe-20\open-admission-24036.json'
$admission = [ordered]@{pid=24036;processStartUtc=$process.StartTime.ToUniversalTime().ToString('o');
    timestampUtc=[DateTime]::UtcNow.ToString('o');observerReady=$readyPath;observerDeadlineUtc=$deadline.ToString('o');fixture='Open SameDir Probe 20.cpr';oneShot=$true} | ConvertTo-Json
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
$result = [CubaseAiMcp.ProjectOpenProbe20Loader]::LoadAndStartProjectOpen20($TargetProcessId, $created, $root)
$json = $result | ConvertTo-Json -Depth 6
$resultPath = Join-Path $root 'artifacts\project-open-probe-20\open-loader-24036.json'
$resultFile = [IO.File]::Open($resultPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
try { $writer=[IO.StreamWriter]::new($resultFile,[Text.UTF8Encoding]::new($false)); try {$writer.Write($json);$writer.Flush();$resultFile.Flush($true)} finally {$writer.Dispose()} } finally {$resultFile.Dispose()}
$json
if ($result.Error -or -not $result.EntryCompleted -or $result.EntryReturnCode -ne 0) { exit 1 }
