[CmdletBinding()]
param([switch]$Inspect, [switch]$Background)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$DesktopName = 'CubaseAI_MCP'
if ($Background) {
    $StartInfo = New-Object Diagnostics.ProcessStartInfo
    $StartInfo.FileName = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $StartInfo.Arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $PSCommandPath + '"'
    $StartInfo.UseShellExecute = $false
    $StartInfo.CreateNoWindow = $true
    $Process = [Diagnostics.Process]::Start($StartInfo)
    [PSCustomObject]@{ status = 'starting'; hostPid = $Process.Id } | ConvertTo-Json
    $Process.Dispose()
    return
}
Add-Type -Path (Join-Path $Root 'native\CubaseDesktop.cs')

if ($Inspect) {
    [CubaseAiMcp.CubaseDesktop]::Inspect($DesktopName) | ConvertTo-Json -Depth 3
    return
}

$Config = Get-Content -LiteralPath (Join-Path $Root 'cubase.config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$Executable = Join-Path $Config.target.installationDirectory 'Cubase 16.exe'
if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) { throw "Missing Cubase executable: $Executable" }
if (Get-Process -Name 'Cubase 16' -ErrorAction SilentlyContinue) { throw 'Cubase is already running; a second instance will not be launched.' }
$Template = Join-Path $Config.target.installationDirectory 'Project Templates\Cubase AI\Piano Page Layout.cpr'
if (-not (Test-Path -LiteralPath $Template -PathType Leaf)) { throw "Missing AI template: $Template" }
$ProjectDirectory = Join-Path $Root 'artifacts\live-smoke'
[IO.Directory]::CreateDirectory($ProjectDirectory) | Out-Null
$Project = Join-Path $ProjectDirectory 'MCP Smoke.cpr'
if (-not (Test-Path -LiteralPath $Project)) { Copy-Item -LiteralPath $Template -Destination $Project }
$Result = [CubaseAiMcp.CubaseDesktop]::Start($Executable, $Project, $ProjectDirectory, $DesktopName)
$Result | Add-Member -NotePropertyName HostPid -NotePropertyValue $PID
$Result | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $ProjectDirectory 'launch.json') -Encoding UTF8
$Result | ConvertTo-Json
$ExitCode = [CubaseAiMcp.CubaseDesktop]::WaitForExit()
[PSCustomObject]@{ status = 'exited'; processId = $Result.ProcessId; exitCode = $ExitCode } |
    ConvertTo-Json | Set-Content -LiteralPath (Join-Path $ProjectDirectory 'exit.json') -Encoding UTF8