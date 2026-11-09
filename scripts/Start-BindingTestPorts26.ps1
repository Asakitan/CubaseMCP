[CmdletBinding(DefaultParameterSetName='Start')]
param(
    [Parameter(ParameterSetName='Start',Mandatory=$true)][Parameter(ParameterSetName='Stop',Mandatory=$true)]
    [ValidatePattern('^[a-f0-9]{32}$')][string]$RunId,
    [Parameter(ParameterSetName='Start',Mandatory=$true)][switch]$Background,
    [Parameter(ParameterSetName='Stop',Mandatory=$true)][switch]$Stop,
    [Parameter(ParameterSetName='Worker',Mandatory=$true)][string]$HolderStdoutPath,
    [Parameter(ParameterSetName='Worker',Mandatory=$true)][string]$HolderStderrPath
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Runtime = Join-Path $Root 'artifacts\runtime'
if ($PSCmdlet.ParameterSetName -eq 'Worker') {
    $prefix = [IO.Path]::GetFullPath($Runtime).TrimEnd('\') + '\'
    $out = [IO.Path]::GetFullPath($HolderStdoutPath)
    $err = [IO.Path]::GetFullPath($HolderStderrPath)
    if (-not $out.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase) -or
        -not $err.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase) -or
        [IO.Path]::GetFileName($out) -notmatch '^binding26-ports-([a-f0-9]{32})\.stdout\.log$') {
        throw 'Invalid diagnostic holder stdout path.'
    }
    $RunId = $Matches[1]
    if ([IO.Path]::GetFileName($err) -cne "binding26-ports-$RunId.stderr.log") { throw 'Invalid diagnostic holder stderr path.' }
    foreach ($path in @($out,$err)) {
        $item = Get-Item -LiteralPath $path -ErrorAction Stop
        if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Diagnostic holder log is not a regular file.' }
    }
}
$Receipt = Join-Path $Runtime "binding26-ports-$RunId.json"
$RequestEventName = "Local\CubaseAI.Binding26.Ports.RequestStop.$RunId"
$Names = [string[]]@('CubaseAI Binding26 To Cubase', 'CubaseAI Binding26 From Cubase')

if ($PSCmdlet.ParameterSetName -eq 'Stop') {
    if (Get-Process -Name 'Cubase*' -ErrorAction SilentlyContinue) { throw 'Diagnostic port stop requires no running Cubase process.' }
    $state = Get-Content -LiteralPath $Receipt -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($state.status -cne 'ready' -or $state.runId -cne $RunId -or
        @($state.ports).Count -ne 2 -or $state.ports[0] -cne $Names[0] -or $state.ports[1] -cne $Names[1]) {
        throw 'Diagnostic port receipt mismatch.'
    }
    $process = Get-Process -Id ([int]$state.pid) -ErrorAction Stop
    if ($process.StartTime.ToUniversalTime().ToFileTimeUtc().ToString() -cne [string]$state.processCreationFiletime -or
        $process.Path -ine (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe')) {
        throw 'Diagnostic port host identity changed.'
    }
    $event = [Threading.EventWaitHandle]::OpenExisting($RequestEventName)
    try {
        if ((Get-Process -Id ([int]$state.pid)).StartTime.ToUniversalTime().ToFileTimeUtc().ToString() -cne [string]$state.processCreationFiletime) {
            throw 'Diagnostic port host changed before signal.'
        }
        if (Get-Process -Name 'Cubase*' -ErrorAction SilentlyContinue) { throw 'Cubase started before diagnostic port stop.' }
        [void]$event.Set()
    } finally { $event.Dispose() }
    [ordered]@{status='stop_signaled';runId=$RunId;pid=[int]$state.pid} | ConvertTo-Json
    return
}

if ($PSCmdlet.ParameterSetName -eq 'Start') {
    if (Get-Process -Name 'Cubase*' -ErrorAction SilentlyContinue) { throw 'Diagnostic port start requires no running Cubase process.' }
    [IO.Directory]::CreateDirectory($Runtime) | Out-Null
    $stdout = Join-Path $Runtime "binding26-ports-$RunId.stdout.log"
    $stderr = Join-Path $Runtime "binding26-ports-$RunId.stderr.log"
    foreach ($path in @($Receipt,$stdout,$stderr)) {
        if (Test-Path -LiteralPath $path) { throw 'The diagnostic run already has a receipt or log.' }
    }
    foreach ($path in @($stdout,$stderr)) { $file=[IO.File]::Open($path,[IO.FileMode]::CreateNew);$file.Dispose() }
    $ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    Add-Type -Path (Join-Path $Root 'native\CubaseDesktop.cs')
    $child = [CubaseAiMcp.CubaseDesktop]::StartDetachedHolder($ps,$PSCommandPath,$null,$stdout,$stderr,$Root)
    [ordered]@{status='starting';runId=$RunId;pid=$child;receipt=$Receipt;stdout=$stdout;stderr=$stderr} | ConvertTo-Json
    return
}

[void][IO.Directory]::CreateDirectory($Runtime)
$mutex = [Threading.Mutex]::new($false,'Local\CubaseAI.Binding26.Ports.Owner')
$owned = $false; $portHost = $null; $stopEvent = $null; $inspectEvent = $null; $timer = $null
try {
    try { $owned = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $owned = $true }
    if (-not $owned) { throw 'A diagnostic port host already owns the fixed names.' }
    if (Get-Process -Name 'Cubase*' -ErrorAction SilentlyContinue) { throw 'Cubase started before diagnostic port creation.' }
    $node = (Get-Command node.exe -ErrorAction Stop).Source
    $inspect = Join-Path $Root 'scripts\inspect-binding-test-ports26.cjs'
    $before = & $node $inspect
    if ($LASTEXITCODE -ne 0) { throw 'Diagnostic port enumeration failed.' }
    $before = ($before -join [Environment]::NewLine) | ConvertFrom-Json
    if ($before.inputMatches -ne 0 -or $before.outputMatches -ne 0 -or
        $before.reverseInputMatches -ne 0 -or $before.reverseOutputMatches -ne 0) { throw 'A diagnostic port name already exists.' }
    Add-Type -Path (Join-Path $Root 'native\MidiPortHost.cs')
    Add-Type @'
using System;
using System.Threading;
public static class Binding26PortDeadline {
    public static Timer Start(EventWaitHandle signal, int milliseconds) {
        return new Timer(delegate(object state) {
            try { ((EventWaitHandle)state).Set(); } catch (ObjectDisposedException) { }
        }, signal, milliseconds, 5000);
    }
}
'@
    $createdEvent = $false
    $inspectEvent = [Threading.EventWaitHandle]::new($false,[Threading.EventResetMode]::AutoReset,$RequestEventName,[ref]$createdEvent)
    if (-not $createdEvent) { throw 'The diagnostic stop event already exists.' }
    $stopEvent = [Threading.EventWaitHandle]::new($false,[Threading.EventResetMode]::ManualReset)
    if (Get-Process -Name 'Cubase*' -ErrorAction SilentlyContinue) { throw 'Cubase started before diagnostic port creation.' }
    $portHost = New-Object CubaseAiMcp.MidiPortHost -ArgumentList (,$Names)
    $after = & $node $inspect
    if ($LASTEXITCODE -ne 0) { throw 'Diagnostic port enumeration after creation failed.' }
    $after = ($after -join [Environment]::NewLine) | ConvertFrom-Json
    if ($after.inputMatches -ne 1 -or $after.outputMatches -ne 1 -or
        $after.reverseInputMatches -ne 1 -or $after.reverseOutputMatches -ne 1) { throw 'Diagnostic port names are not unique.' }
    $durationMs = 360000
    $timer = [Binding26PortDeadline]::Start($inspectEvent,$durationMs)
    $state = [ordered]@{status='ready';runId=$RunId;pid=$PID;
        processCreationFiletime=[Diagnostics.Process]::GetCurrentProcess().StartTime.ToUniversalTime().ToFileTimeUtc().ToString();
        ports=$Names;driverVersion=$portHost.DriverVersion;readyUtc=[DateTime]::UtcNow.ToString('o');
        cleanupCheckAfterMs=$durationMs;limitation='Enumeration and receipt are point-in-time; cleanup is deferred while any Cubase process is observed.'}
    $temp = $Receipt + '.tmp-' + $PID
    $file=[IO.File]::Open($temp,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try {$bytes=[Text.UTF8Encoding]::new($false).GetBytes(($state|ConvertTo-Json));$file.Write($bytes,0,$bytes.Length);$file.Flush($true)} finally {$file.Dispose()}
    [IO.File]::Move($temp,$Receipt)
    [IO.File]::AppendAllText($out,($state|ConvertTo-Json -Compress)+[Environment]::NewLine,[Text.UTF8Encoding]::new($false))
    $script:deferredLogged = $false
    $inspectAction = [Action]{
        if (Get-Process -Name 'Cubase*' -ErrorAction SilentlyContinue) {
            if (-not $script:deferredLogged) {
                [IO.File]::AppendAllText($out,'status=stop_deferred reason=cubase_running'+[Environment]::NewLine,[Text.UTF8Encoding]::new($false))
                $script:deferredLogged = $true
            }
        } else { [void]$stopEvent.Set() }
    }
    $portHost.Wait($stopEvent,$inspectEvent,$inspectAction)
    [IO.File]::AppendAllText($out,'status=stopped reason=request_or_deadline_and_no_cubase'+[Environment]::NewLine,[Text.UTF8Encoding]::new($false))
} catch {
    [IO.File]::AppendAllText($err,$_.Exception.ToString()+[Environment]::NewLine,[Text.UTF8Encoding]::new($false))
    throw
} finally {
    if ($timer) { $timer.Dispose() }
    if ($inspectEvent) { $inspectEvent.Dispose() }
    if ($stopEvent) { $stopEvent.Dispose() }
    if ($portHost) { $portHost.Dispose() }
    if ($owned) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
