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
if ($TargetProcessId -ne 50568 -or $launch.ProcessId -ne $TargetProcessId -or $launch.HostPid -ne 45364 -or
    $launch.Desktop -ne 'winsta0\CubaseAI_MCP' -or -not $launch.DesktopSwitchRestricted -or -not $launch.JobKillsOnLastHandleClose) {
    throw 'Target differs from the fixed restricted private launch receipt.'
}
$process = Get-Process -Id $TargetProcessId -ErrorAction Stop
if ($process.StartTime.ToUniversalTime().ToString('o') -ne '2026-11-09T18:51:21.6771327Z') { throw 'Fixed target start time changed.' }
$created = $process.StartTime.ToUniversalTime().ToFileTimeUtc()
$readyPath = [IO.Path]::GetFullPath($ObserverReadyPath)
$ipc = [IO.Path]::GetFullPath((Join-Path $root 'artifacts\ipc')).TrimEnd('\') + '\'
if (-not $readyPath.StartsWith($ipc,[StringComparison]::OrdinalIgnoreCase) -or
    [IO.Path]::GetFileName($readyPath) -notmatch '^project-open-observer-50568-[a-f0-9]{32}\.ready\.json$') { throw 'Unexpected observer receipt path.' }
$ready = Get-Content -LiteralPath $readyPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($ready.pid -ne 50568 -or $ready.processStartUtc -cne '2026-11-09T18:51:21.6771327Z' -or
    $ready.inputDesktop -ieq 'CubaseAI_MCP' -or $ready.id -notmatch '^[a-f0-9]{32}$' -or
    [IO.Path]::GetFileName($readyPath) -cne ("project-open-observer-50568-{0}.ready.json" -f $ready.id)) { throw 'Observer receipt mismatch.' }
$observer = Get-Process -Id ([int]$ready.observerPid) -ErrorAction Stop
if ($observer.StartTime.ToUniversalTime().ToString('o') -cne $ready.observerStartUtc) { throw 'Observer process identity changed.' }
$started = [DateTime]::Parse([string]$ready.startedUtc).ToUniversalTime()
$elapsed = ([DateTime]::UtcNow - $started).TotalSeconds
if ($elapsed -lt 0 -or $elapsed + 20 -ge [double]$ready.durationSeconds) { throw 'Insufficient observer time remains.' }
foreach ($kind in @('open-start', 'open-result')) {
    $existing = Join-Path $root ('artifacts\project-open-probe\{0}-{1}.json' -f $kind, $TargetProcessId)
    if ((Test-Path -LiteralPath $existing) -or (Test-Path -LiteralPath ([IO.Path]::ChangeExtension($existing, '.tmp')))) { throw 'A project-open diagnostic record or temporary record already exists; no replay is allowed.' }
}
Add-Type -Path @((Join-Path $root 'native\CubaseDesktop.cs'), (Join-Path $root 'native\ProjectOpenJobAudit19.cs'), (Join-Path $root 'native\ProjectOpenProbe19Loader.cs'))
$inputMethod = [CubaseAiMcp.CubaseDesktop].GetMethod('InputDesktopName',[Reflection.BindingFlags]'NonPublic,Static')
if ($inputMethod.Invoke($null,@()) -ieq 'CubaseAI_MCP') { throw 'The isolated target desktop is the input desktop.' }
$admissionPath = Join-Path $root 'artifacts\project-open-probe\open-admission-50568.json'
$admission = [ordered]@{pid=50568;processStartUtc=$process.StartTime.ToUniversalTime().ToString('o');
    timestampUtc=[DateTime]::UtcNow.ToString('o');observerReady=$readyPath;fixture='Open Probe.cpr';oneShot=$true} | ConvertTo-Json
$admissionFile = [IO.File]::Open($admissionPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
try { $writer=[IO.StreamWriter]::new($admissionFile,[Text.UTF8Encoding]::new($false)); try {$writer.Write($admission);$writer.Flush();$admissionFile.Flush($true)} finally {$writer.Dispose()} } finally {$admissionFile.Dispose()}
$result = [CubaseAiMcp.ProjectOpenProbe19Loader]::LoadAndStartProjectOpen19($TargetProcessId, $created, $root)
$json = $result | ConvertTo-Json -Depth 6
$resultPath = Join-Path $root 'artifacts\project-open-probe\open-loader-50568.json'
$resultFile = [IO.File]::Open($resultPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
try { $writer=[IO.StreamWriter]::new($resultFile,[Text.UTF8Encoding]::new($false)); try {$writer.Write($json);$writer.Flush();$resultFile.Flush($true)} finally {$writer.Dispose()} } finally {$resultFile.Dispose()}
$json
if ($result.Error -or -not $result.EntryCompleted -or $result.EntryReturnCode -ne 0) { exit 1 }
