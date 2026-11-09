[CmdletBinding()]
param([switch]$Inspect, [switch]$Background, [string]$ProjectPath,
    [string]$HolderStdoutPath, [string]$HolderStderrPath)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$DesktopName = 'CubaseAI_MCP'
$StateDirectory = Join-Path $Root 'artifacts\runtime'
$LogStdout = $null
$LogStderr = $null
trap {
    if ($LogStderr) { [IO.File]::AppendAllText($LogStderr, $_.Exception.ToString() + [Environment]::NewLine, [Text.UTF8Encoding]::new($false)) }
    else { [Console]::Error.WriteLine($_.Exception.ToString()) }
    exit 1
}
if ($HolderStdoutPath -or $HolderStderrPath) {
    if ($Background -or $Inspect -or -not $HolderStdoutPath -or -not $HolderStderrPath) { throw 'Invalid holder log arguments.' }
    $RuntimePrefix = [IO.Path]::GetFullPath($StateDirectory).TrimEnd('\') + '\'
    $OutputFull = [IO.Path]::GetFullPath($HolderStdoutPath)
    $ErrorFull = [IO.Path]::GetFullPath($HolderStderrPath)
    if (-not $OutputFull.StartsWith($RuntimePrefix, [StringComparison]::OrdinalIgnoreCase) -or
        -not $ErrorFull.StartsWith($RuntimePrefix, [StringComparison]::OrdinalIgnoreCase) -or
        -not (Test-Path -LiteralPath $OutputFull -PathType Leaf) -or -not (Test-Path -LiteralPath $ErrorFull -PathType Leaf)) {
        throw 'Holder logs must be existing files inside the runtime directory.'
    }
    $LogStdout = $OutputFull
    $LogStderr = $ErrorFull
}
if ($ProjectPath) {
    if ($ProjectPath.Contains('"')) { throw 'Project path contains an invalid quote.' }
    $ProjectPath = [IO.Path]::GetFullPath($ProjectPath)
    if ([IO.Path]::GetExtension($ProjectPath) -ine '.cpr' -or -not (Test-Path -LiteralPath $ProjectPath -PathType Leaf)) {
        throw 'ProjectPath must name an existing CPR project.'
    }
}
Add-Type -Path (Join-Path $Root 'native\CubaseDesktop.cs')
if ($Background) {
    [IO.Directory]::CreateDirectory($StateDirectory) | Out-Null
    $LaunchId = [Guid]::NewGuid().ToString('N')
    $StdoutPath = Join-Path $StateDirectory "cubase-holder-$LaunchId.stdout.log"
    $StderrPath = Join-Path $StateDirectory "cubase-holder-$LaunchId.stderr.log"
    $OutputStream = [IO.File]::Open($StdoutPath, [IO.FileMode]::CreateNew); $OutputStream.Dispose()
    $ErrorStream = [IO.File]::Open($StderrPath, [IO.FileMode]::CreateNew); $ErrorStream.Dispose()
    $HostProcessId = [CubaseAiMcp.CubaseDesktop]::StartDetachedHolder(
        (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'), $PSCommandPath,
        $ProjectPath, $StdoutPath, $StderrPath, $Root)
    [PSCustomObject]@{ status = 'starting'; hostPid = $HostProcessId; stdoutFile = $StdoutPath; stderrFile = $StderrPath } | ConvertTo-Json
    return
}

if ($Inspect) {
    [CubaseAiMcp.CubaseDesktop]::Inspect($DesktopName) | ConvertTo-Json -Depth 3
    return
}

$Config = Get-Content -LiteralPath (Join-Path $Root 'cubase.config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$Executable = Join-Path $Config.target.installationDirectory 'Cubase 16.exe'
if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) { throw "Missing Cubase executable: $Executable" }
if (Get-Process -Name 'Cubase 16' -ErrorAction SilentlyContinue) { throw 'Cubase is already running; a second instance will not be launched.' }
if ($ProjectPath) {
    $Project = $ProjectPath
    $ProjectDirectory = Split-Path -Parent $Project
} else {
    $Template = Join-Path $Config.target.installationDirectory 'Project Templates\Cubase AI\Piano Page Layout.cpr'
    if (-not (Test-Path -LiteralPath $Template -PathType Leaf)) { throw "Missing AI template: $Template" }
    $ProjectDirectory = Join-Path $Root 'artifacts\live-smoke'
    [IO.Directory]::CreateDirectory($ProjectDirectory) | Out-Null
    $Project = Join-Path $ProjectDirectory 'MCP Smoke.cpr'
    if (-not (Test-Path -LiteralPath $Project)) { Copy-Item -LiteralPath $Template -Destination $Project }
}
$Result = [CubaseAiMcp.CubaseDesktop]::Start($Executable, $Project, $ProjectDirectory, $DesktopName)
$Result | Add-Member -NotePropertyName HostPid -NotePropertyValue $PID
$Result | Add-Member -NotePropertyName Project -NotePropertyValue $Project
[IO.Directory]::CreateDirectory($StateDirectory) | Out-Null
$Result | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $StateDirectory 'cubase-launch.json') -Encoding UTF8
$ResultJson = $Result | ConvertTo-Json
if ($LogStdout) { [IO.File]::AppendAllText($LogStdout, $ResultJson + [Environment]::NewLine, [Text.UTF8Encoding]::new($false)) }
else { $ResultJson }
$ExitCode = [CubaseAiMcp.CubaseDesktop]::WaitForExit()
[PSCustomObject]@{ status = 'exited'; processId = $Result.ProcessId; exitCode = $ExitCode } |
    ConvertTo-Json | Set-Content -LiteralPath (Join-Path $StateDirectory 'cubase-exit.json') -Encoding UTF8
