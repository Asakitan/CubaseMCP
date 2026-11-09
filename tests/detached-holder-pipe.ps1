[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Directory = Join-Path $Root ('artifacts\detached-holder-' + [Guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($Directory)
$Marker = Join-Path $Directory 'started.txt'
$StdoutPath = Join-Path $Directory 'holder.stdout.log'
$StderrPath = Join-Path $Directory 'holder.stderr.log'
[IO.File]::WriteAllText($StdoutPath, '')
[IO.File]::WriteAllText($StderrPath, '')
$StarterScript = Join-Path $Root 'tests\DetachedHolderStarter.ps1'
$Info = [Diagnostics.ProcessStartInfo]::new()
$Info.FileName = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$Info.Arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $StarterScript +
    '" -Root "' + $Root + '" -Marker "' + $Marker + '" -StdoutPath "' + $StdoutPath +
    '" -StderrPath "' + $StderrPath + '" -Directory "' + $Directory + '"'
$Info.WorkingDirectory = $Root
$Info.UseShellExecute = $false
$Info.CreateNoWindow = $true
$Info.RedirectStandardOutput = $true
$Info.RedirectStandardError = $true
$Process = [Diagnostics.Process]::Start($Info)
$OutputTask = $Process.StandardOutput.ReadToEndAsync()
$ErrorTask = $Process.StandardError.ReadToEndAsync()
$HolderId = 0
try {
    if (-not $Process.WaitForExit(5000)) { throw 'Starter did not exit promptly.' }
    if (-not $OutputTask.Wait(5000) -or -not $ErrorTask.Wait(5000)) { throw 'A holder inherited a caller capture pipe.' }
    if ($Process.ExitCode -ne 0) { throw "Starter failed: $($ErrorTask.Result)" }
    $Receipt = $OutputTask.Result | ConvertFrom-Json
    $HolderId = [int]$Receipt.holderPid
    if ($HolderId -le 0) { throw 'Starter did not return a holder PID.' }
    $Clock = [Diagnostics.Stopwatch]::StartNew()
    while (-not (Test-Path -LiteralPath $Marker -PathType Leaf) -and $Clock.Elapsed.TotalSeconds -lt 4) {
        Start-Sleep -Milliseconds 50
    }
    if (-not (Test-Path -LiteralPath $Marker -PathType Leaf) -or
        [int](Get-Content -LiteralPath $Marker -Raw -Encoding UTF8) -ne $HolderId -or
        -not (Get-Process -Id $HolderId -ErrorAction SilentlyContinue)) { throw 'Synthetic holder was not alive after starter return.' }
    [PSCustomObject]@{ status = 'passed'; holderPid = $HolderId; marker = $Marker;
        limitation = 'Synthetic long-lived holder only; this is not a Cubase launch.' } | ConvertTo-Json
} finally {
    if (-not $Process.HasExited) { $Process.Kill() }
    $Process.Dispose()
    if ($HolderId -gt 0) {
        $Clock = [Diagnostics.Stopwatch]::StartNew()
        while ((Get-Process -Id $HolderId -ErrorAction SilentlyContinue) -and $Clock.Elapsed.TotalSeconds -lt 12) { Start-Sleep -Milliseconds 100 }
        if (Get-Process -Id $HolderId -ErrorAction SilentlyContinue) { throw 'Synthetic holder did not exit.' }
    }
}
