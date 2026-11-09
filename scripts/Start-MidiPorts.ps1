[CmdletBinding()]
param(
    [switch]$Background,
    [switch]$Stop
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$StateDirectory = Join-Path $Root 'artifacts\runtime'
$StatePath = Join-Path $StateDirectory 'midi-ports.json'
$EventName = 'Local\CubaseAI.MidiPorts.Stop'

if ($Stop) {
    $Event = [Threading.EventWaitHandle]::OpenExisting($EventName)
    try { $Event.Set() | Out-Null } finally { $Event.Dispose() }
    return
}

if ($Background) {
    $StartInfo = New-Object Diagnostics.ProcessStartInfo
    $StartInfo.FileName = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $StartInfo.Arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $PSCommandPath + '"'
    $StartInfo.UseShellExecute = $false
    $StartInfo.CreateNoWindow = $true
    $Process = [Diagnostics.Process]::Start($StartInfo)
    [PSCustomObject]@{ status = 'starting'; pid = $Process.Id; stateFile = $StatePath } | ConvertTo-Json
    $Process.Dispose()
    return
}

[IO.Directory]::CreateDirectory($StateDirectory) | Out-Null
$Mutex = New-Object Threading.Mutex($false, 'Local\CubaseAI.MidiPorts.Owner')
$Owned = $false
$HostInstance = $null
try {
    $Owned = $Mutex.WaitOne(0)
    if (-not $Owned) { throw 'The Cubase MIDI port host is already running.' }
    $Configuration = Get-Content -LiteralPath (Join-Path $Root 'cubase.config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($Configuration.backend -ne 'midi' -or $Configuration.policy.fallback -ne $false) { throw 'Invalid MIDI-only configuration.' }
    Add-Type -Path (Join-Path $Root 'native\MidiPortHost.cs')
    $Names = [string[]]@($Configuration.midi.output, $Configuration.midi.input)
    $HostInstance = New-Object CubaseAiMcp.MidiPortHost -ArgumentList (,$Names)
    [PSCustomObject]@{
        status = 'ready'; pid = $PID; ports = $Names; driverVersion = $HostInstance.DriverVersion
        backgroundOnly = $true; fallback = $false
    } | ConvertTo-Json | Set-Content -LiteralPath $StatePath -Encoding UTF8
    $HostInstance.Wait($EventName)
    [PSCustomObject]@{ status = 'stopped'; pid = $PID } | ConvertTo-Json | Set-Content -LiteralPath $StatePath -Encoding UTF8
} catch {
    if ($Owned) {
        [PSCustomObject]@{ status = 'failed'; pid = $PID; error = $_.Exception.Message } |
            ConvertTo-Json | Set-Content -LiteralPath $StatePath -Encoding UTF8
    }
    throw
} finally {
    if ($null -ne $HostInstance) { $HostInstance.Dispose() }
    if ($Owned) { $Mutex.ReleaseMutex() }
    $Mutex.Dispose()
}