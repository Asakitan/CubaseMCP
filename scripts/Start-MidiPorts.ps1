[CmdletBinding()]
param(
    [switch]$Background,
    [switch]$Stop,
    [switch]$InspectClients,
    [string]$HolderStdoutPath,
    [string]$HolderStderrPath
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$StateDirectory = Join-Path $Root 'artifacts\runtime'
$StatePath = Join-Path $StateDirectory 'midi-ports.json'
$EventName = 'Local\CubaseAI.MidiPorts.Stop'
$InspectEventName = 'Local\CubaseAI.MidiPorts.Inspect'
$InspectDoneName = 'Local\CubaseAI.MidiPorts.InspectDone'
$InspectMutexName = 'Local\CubaseAI.MidiPorts.InspectLock'
$InspectPath = Join-Path $StateDirectory 'midi-clients.json'
$InspectRequestPath = Join-Path $StateDirectory 'midi-clients-request.json'

if ((@([bool]$Background, [bool]$Stop, [bool]$InspectClients) | Where-Object { $_ }).Count -gt 1) {
    throw 'Background, Stop and InspectClients are mutually exclusive.'
}

if ($InspectClients) {
    $State = Get-Content -LiteralPath $StatePath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($State.status -ne 'ready' -or -not (Get-Process -Id $State.pid -ErrorAction SilentlyContinue)) {
        throw 'The MIDI port host is not running.'
    }
    $InspectMutex = New-Object Threading.Mutex($false, $InspectMutexName)
    $InspectOwned = $false
    $InspectEvent = $null
    $InspectDone = $null
    try {
        $InspectOwned = $InspectMutex.WaitOne(0)
        if (-not $InspectOwned) { throw 'A MIDI client inspection is already running.' }
        $InspectEvent = [Threading.EventWaitHandle]::OpenExisting($InspectEventName)
        $InspectDone = [Threading.EventWaitHandle]::OpenExisting($InspectDoneName)
        $RequestId = [Guid]::NewGuid().ToString('N')
        [PSCustomObject]@{ requestId = $RequestId } | ConvertTo-Json |
            Set-Content -LiteralPath $InspectRequestPath -Encoding UTF8
        [void]$InspectDone.Reset()
        [void]$InspectEvent.Set()
        if (-not $InspectDone.WaitOne(5000)) { throw 'MIDI client inspection did not complete within five seconds.' }
        $Result = Get-Content -LiteralPath $InspectPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($Result.pid -ne $State.pid -or $Result.requestId -ne $RequestId) {
            throw 'MIDI client inspection did not match the current host and request.'
        }
        $Result | ConvertTo-Json -Depth 5
        if ($Result.status -ne 'observed') { exit 1 }
    } finally {
        if ($null -ne $InspectEvent) { $InspectEvent.Dispose() }
        if ($null -ne $InspectDone) { $InspectDone.Dispose() }
        if ($InspectOwned) { $InspectMutex.ReleaseMutex() }
        $InspectMutex.Dispose()
    }
    return
}

if ($Stop) {
    $Event = [Threading.EventWaitHandle]::OpenExisting($EventName)
    try { $Event.Set() | Out-Null } finally { $Event.Dispose() }
    return
}

if ($Background) {
    [IO.Directory]::CreateDirectory($StateDirectory) | Out-Null
    $executable = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    Add-Type -Path (Join-Path $Root 'native\CubaseDesktop.cs')
    $id = [Guid]::NewGuid().ToString('N')
    $stdout = Join-Path $StateDirectory "midi-host-$id.stdout.log"
    $stderr = Join-Path $StateDirectory "midi-host-$id.stderr.log"
    $hostId = [CubaseAiMcp.CubaseDesktop]::StartDetachedHolder($executable,$PSCommandPath,$null,$stdout,$stderr,$Root)
    [PSCustomObject]@{ status = 'starting'; pid = $hostId; stateFile = $StatePath } | ConvertTo-Json
    return
}

[IO.Directory]::CreateDirectory($StateDirectory) | Out-Null
$Mutex = New-Object Threading.Mutex($false, 'Local\CubaseAI.MidiPorts.Owner')
$Owned = $false
$HostInstance = $null
$StopEvent = $null
$InspectEvent = $null
$InspectDone = $null
try {
    $Owned = $Mutex.WaitOne(0)
    if (-not $Owned) { throw 'The Cubase MIDI port host is already running.' }
    $Configuration = Get-Content -LiteralPath (Join-Path $Root 'cubase.config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($Configuration.backend -ne 'midi' -or $Configuration.policy.fallback -ne $false) { throw 'Invalid MIDI-only configuration.' }
    Add-Type -Path (Join-Path $Root 'native\MidiPortHost.cs')
    $Names = [string[]]@($Configuration.midi.output, $Configuration.midi.input)
    $HostInstance = New-Object CubaseAiMcp.MidiPortHost -ArgumentList (,$Names)
    $StopEvent = New-Object Threading.EventWaitHandle($false, [Threading.EventResetMode]::ManualReset, $EventName)
    $InspectEvent = New-Object Threading.EventWaitHandle($false, [Threading.EventResetMode]::AutoReset, $InspectEventName)
    $InspectDone = New-Object Threading.EventWaitHandle($false, [Threading.EventResetMode]::AutoReset, $InspectDoneName)
    [PSCustomObject]@{
        status = 'ready'; pid = $PID; ports = $Names; driverVersion = $HostInstance.DriverVersion
        backgroundOnly = $true; fallback = $false
    } | ConvertTo-Json | Set-Content -LiteralPath $StatePath -Encoding UTF8
    $InspectAction = [Action]{
        $RequestId = $null
        try {
            $Request = Get-Content -LiteralPath $InspectRequestPath -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($Request.requestId -notmatch '^[a-f0-9]{32}$') { throw 'Invalid MIDI inspection request ID.' }
            $RequestId = $Request.requestId
            $ClientLists = $HostInstance.GetClientProcessIds()
            $PortReports = for ($index = 0; $index -lt $Names.Length; $index++) {
                [PSCustomObject]@{ name = $Names[$index]; processIds = @($ClientLists[$index]) }
            }
            $Report = [PSCustomObject]@{
                status = 'observed'; pid = $PID; requestId = $RequestId
                observedUtc = [DateTime]::UtcNow.ToString('o'); ports = @($PortReports)
            }
        } catch {
            $Report = [PSCustomObject]@{ status = 'failed'; pid = $PID; requestId = $RequestId; error = $_.Exception.Message }
        }
        try {
            $Report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $InspectPath -Encoding UTF8
        } catch {
            [Console]::Error.WriteLine('MIDI client inspection report failed: ' + $_.Exception.Message)
        } finally {
            [void]$InspectDone.Set()
        }
    }
    $HostInstance.Wait($StopEvent, $InspectEvent, $InspectAction)
    [PSCustomObject]@{ status = 'stopped'; pid = $PID } | ConvertTo-Json | Set-Content -LiteralPath $StatePath -Encoding UTF8
} catch {
    if ($Owned) {
        [PSCustomObject]@{ status = 'failed'; pid = $PID; error = $_.Exception.Message } |
            ConvertTo-Json | Set-Content -LiteralPath $StatePath -Encoding UTF8
    }
    throw
} finally {
    if ($null -ne $InspectDone) { $InspectDone.Dispose() }
    if ($null -ne $InspectEvent) { $InspectEvent.Dispose() }
    if ($null -ne $StopEvent) { $StopEvent.Dispose() }
    if ($null -ne $HostInstance) { $HostInstance.Dispose() }
    if ($Owned) { $Mutex.ReleaseMutex() }
    $Mutex.Dispose()
}
