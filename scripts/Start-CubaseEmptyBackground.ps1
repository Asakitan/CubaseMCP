[CmdletBinding()]
param([switch]$Background, [string]$HolderStdoutPath, [string]$HolderStderrPath, [ValidatePattern('^[a-f0-9]{32}$')][string]$RunId)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Runtime = Join-Path $Root 'artifacts\runtime'
$DesktopName = 'CubaseAI_MCP'
if ($Background) {
    if ($HolderStdoutPath -or $HolderStderrPath -or -not $RunId) { throw 'Invalid background arguments.' }
    [IO.Directory]::CreateDirectory($Runtime) | Out-Null
    $LaunchId = $RunId
    $out = Join-Path $Runtime "cubase-empty-$LaunchId.stdout.log"
    $err = Join-Path $Runtime "cubase-empty-$LaunchId.stderr.log"
    foreach ($path in @($out,$err)) { $f = [IO.File]::Open($path,[IO.FileMode]::CreateNew); $f.Dispose() }
    Add-Type -Path (Join-Path $Root 'native\CubaseDesktop.cs')
    # The detached helper only passes the two log paths. The holder recovers its ID from their names.
    $holder = [CubaseAiMcp.CubaseDesktop]::StartDetachedHolder(
        (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'), $PSCommandPath,
        $null, $out, $err, $Root)
    [PSCustomObject]@{status='starting'; hostPid=$holder; RunId=$LaunchId; launchId=$LaunchId; project=$null; stdoutFile=$out; stderrFile=$err} | ConvertTo-Json
    return
}
$prefix = [IO.Path]::GetFullPath($Runtime).TrimEnd('\') + '\'
if (-not $HolderStdoutPath -or -not $HolderStderrPath) { throw 'Holder log paths are required.' }
$out = [IO.Path]::GetFullPath($HolderStdoutPath); $err = [IO.Path]::GetFullPath($HolderStderrPath)
if (-not $out.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase) -or
    -not $err.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase) -or
    [IO.Path]::GetFileName($out) -notmatch '^cubase-empty-([a-f0-9]{32})\.stdout\.log$') { throw 'Invalid holder stdout path.' }
if ($RunId) { throw 'RunId belongs to the coordinator only.' }
$id = $Matches[1]
if ([IO.Path]::GetFileName($err) -cne "cubase-empty-$id.stderr.log" -or
    -not (Test-Path -LiteralPath $out -PathType Leaf) -or -not (Test-Path -LiteralPath $err -PathType Leaf)) { throw 'Invalid holder stderr path.' }
trap { [IO.File]::AppendAllText($err, $_.Exception.ToString() + [Environment]::NewLine, [Text.UTF8Encoding]::new($false)); exit 1 }
Add-Type -Path (Join-Path $Root 'native\CubaseDesktop.cs')
$mutex = [Threading.Mutex]::new($false, 'Local\CubaseAI_MCP_EmptyLaunch')
$locked = $false
try {
    try { $locked = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $locked = $true }
    if (-not $locked) { throw 'Another empty launcher owns the launch lock.' }
    if (Get-Process -Name 'Cubase*' -ErrorAction SilentlyContinue) { throw 'Cubase is already running; no new instance was launched.' }
    $config = Get-Content -LiteralPath (Join-Path $Root 'cubase.config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $exe = Join-Path $config.target.installationDirectory 'Cubase 16.exe'
    if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw 'Cubase executable is missing.' }
    $result = [CubaseAiMcp.CubaseDesktop]::StartEmpty($exe, $config.target.installationDirectory, $DesktopName)
    $owned = Get-Process -Id $result.ProcessId -ErrorAction Stop
    $receipt = [ordered]@{ status='process_created'; readiness='unverified'; mode='empty'; Project=$null; RunId=$id;
        ProcessId=$result.ProcessId; processCreationFiletime=$owned.StartTime.ToUniversalTime().ToFileTimeUtc().ToString();
        HostPid=$PID; holderCreationFiletime=[Diagnostics.Process]::GetCurrentProcess().StartTime.ToUniversalTime().ToFileTimeUtc().ToString();
        sampledUtc=[DateTime]::UtcNow.ToString('o'); Desktop=$result.Desktop; foregroundBefore=$result.ForegroundBefore; foregroundAfter=$result.ForegroundAfter;
        inputDesktopBefore=$result.InputDesktopBefore; inputDesktopBeforeResume=$result.InputDesktopBeforeResume;
        inputDesktopAfter=$result.InputDesktopAfter; desktopSwitchRestricted=$result.DesktopSwitchRestricted;
        jobKillsOnLastHandleClose=$result.JobKillsOnLastHandleClose }
    $receiptPath = Join-Path $Runtime "cubase-empty-launch-24-$id.json"
    $temporaryReceipt = $receiptPath + '.tmp-' + $PID
    $file = [IO.File]::Open($temporaryReceipt,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try { $data=[Text.UTF8Encoding]::new($false).GetBytes(($receipt | ConvertTo-Json -Compress)); $file.Write($data,0,$data.Length); $file.Flush($true) } finally { $file.Dispose() }
    [IO.File]::Move($temporaryReceipt,$receiptPath)
    [IO.File]::AppendAllText($out,($receipt | ConvertTo-Json -Compress) + [Environment]::NewLine,[Text.UTF8Encoding]::new($false))
    $exitCode = [CubaseAiMcp.CubaseDesktop]::WaitForExit()
    [IO.File]::AppendAllText($out,"status=exited exitCode=$exitCode$([Environment]::NewLine)",[Text.UTF8Encoding]::new($false))
} finally { if ($locked) { $mutex.ReleaseMutex() }; $mutex.Dispose() }
