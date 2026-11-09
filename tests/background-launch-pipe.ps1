[CmdletBinding()]
param([Parameter(Mandatory=$true)][ValidateRange(1,2147483647)][int]$ExpectedProcessId)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$ReceiptPath = Join-Path $Root 'artifacts\runtime\cubase-launch.json'
$Receipt = Get-Content -LiteralPath $ReceiptPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ([int]$Receipt.ProcessId -ne $ExpectedProcessId -or $Receipt.Desktop -cne 'winsta0\CubaseAI_MCP') {
    throw 'Expected an owned isolated Cubase process in the current launch receipt.'
}
$Target = Get-Process -Id $ExpectedProcessId
$Started = $Target.StartTime.ToUniversalTime()
$Script = Join-Path $Root 'scripts\Start-CubaseBackground.ps1'
$Project = [string]$Receipt.Project
$Job = Start-Job -ArgumentList $Script, $Project -ScriptBlock {
    param($Launcher, $ProjectPath)
    $Output = & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $Launcher -Background -ProjectPath $ProjectPath | Out-String
    if ($LASTEXITCODE -ne 0) { throw 'The background launcher failed before returning its receipt.' }
    $Output
}
try {
    if (-not (Wait-Job -Job $Job -Timeout 15)) { throw 'Background launcher did not return within 15 seconds.' }
    if ($Job.State -ne 'Completed') { throw 'Background launcher job did not complete.' }
    $Result = (Receive-Job -Job $Job | Out-String) | ConvertFrom-Json
    if ($Result.status -cne 'starting' -or [int]$Result.hostPid -le 0 -or [int]$Result.hostPid -eq $ExpectedProcessId) {
        throw 'Unexpected background launcher response.'
    }
    $Runtime = [IO.Path]::GetFullPath((Join-Path $Root 'artifacts\runtime')).TrimEnd('\') + '\'
    foreach ($Path in @($Result.stdoutFile, $Result.stderrFile)) {
        if (-not $Path -or -not [IO.Path]::GetFullPath($Path).StartsWith($Runtime, [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Launcher log path is not inside the runtime directory.'
        }
    }
    $Timer = [Diagnostics.Stopwatch]::StartNew()
    while ((Get-Process -Id $Result.hostPid -ErrorAction SilentlyContinue) -and $Timer.Elapsed.TotalSeconds -lt 15) {
        Start-Sleep -Milliseconds 100
    }
    if (Get-Process -Id $Result.hostPid -ErrorAction SilentlyContinue) { throw 'Duplicate-instance guard did not exit.' }
    $ErrorText = Get-Content -LiteralPath $Result.stderrFile -Raw -Encoding UTF8
    if ($ErrorText -notmatch 'Cubase is already running') { throw 'Expected duplicate-instance guard was not logged.' }
    $Current = Get-Process -Id $ExpectedProcessId
    $After = Get-Content -LiteralPath $ReceiptPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($Current.StartTime.ToUniversalTime() -ne $Started -or [int]$After.ProcessId -ne $ExpectedProcessId) {
        throw 'Existing Cubase identity or receipt changed.'
    }
    [PSCustomObject]@{ status = 'passed'; targetPid = $ExpectedProcessId; hostPid = [int]$Result.hostPid;
        stdoutFile = $Result.stdoutFile; stderrFile = $Result.stderrFile; limitation = 'The live holder was rejected by the existing-instance guard; this is not a successful new Cubase launch.' } | ConvertTo-Json
} finally {
    if ($Job.State -eq 'Running') { Stop-Job -Job $Job }
    Remove-Job -Job $Job -Force
}
