param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9a-f]{32}$')]
    [string]$BuildRunId,
    [ValidateSet('synthetic-parent', 'synthetic-job-parent')]
    [string]$Mode = 'synthetic-parent'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root ('artifacts\activation-clone-22\run-' + $BuildRunId + '\ActivationClone22.exe')
if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw 'Synthetic worker executable is missing.' }
$start = [System.Diagnostics.ProcessStartInfo]::new()
$start.FileName = $exe
$start.Arguments = $Mode
Write-Output ('supervisor_mode=' + $Mode)
$start.UseShellExecute = $false
$start.CreateNoWindow = $true
$start.RedirectStandardOutput = $true
$start.RedirectStandardError = $true
$worker = [System.Diagnostics.Process]::new()
$worker.StartInfo = $start
try {
    if (-not $worker.Start()) { throw 'Synthetic worker did not start.' }
    $workerId = $worker.Id
    $workerStart = $worker.StartTime.ToUniversalTime().ToFileTimeUtc()
    $stdout = $worker.StandardOutput.ReadToEndAsync()
    $stderr = $worker.StandardError.ReadToEndAsync()
    if (-not $worker.WaitForExit(60000)) {
        Write-Output "observation status=unverified reason=worker_timeout worker_pid=$workerId worker_creation_filetime=$workerStart"
        exit 1
    }
    $worker.WaitForExit()
    $output = $stdout.GetAwaiter().GetResult()
    $errors = $stderr.GetAwaiter().GetResult()
    Write-Output $output.TrimEnd()
    if ($errors) { Write-Output ('worker_stderr=' + $errors.TrimEnd()) }
    Write-Output ('worker_exit=' + $worker.ExitCode)
    if ($Mode -eq 'synthetic-job-parent' -and $output -notmatch '(?m)^cleanup job_close=1\r?$') {
        Write-Output 'observation status=unverified reason=missing_job_close'
        exit 1
    }
    $matchesFound = [regex]::Matches($output, '(?m)^clone_identity pid=(\d+) creation_filetime=(\d+)\r?$')
    if ($matchesFound.Count -ne 1 -or $output -notmatch '(?m)^cleanup clone_monitor_close=1\r?$') {
        Write-Output 'observation status=unverified reason=missing_identity_or_close'
        exit 1
    }
    $pidValue = [int]::Parse($matchesFound[0].Groups[1].Value)
    $filetime = [long]::Parse($matchesFound[0].Groups[2].Value)
    try {
        $inventory = @(Get-Process -ErrorAction Stop)
        $candidate = @($inventory | Where-Object { $_.Id -eq $pidValue })
        if ($candidate.Count -eq 0) {
            Write-Output 'observation status=absent'
            exit $worker.ExitCode
        }
        if ($candidate.Count -ne 1) {
            Write-Output 'observation status=unverified reason=ambiguous_inventory'
            exit 1
        }
        $candidate = $candidate[0]
    } catch {
        Write-Output 'observation status=unverified reason=enumeration_error'
        exit 1
    }
    try {
        $observed = $candidate.StartTime.ToUniversalTime().ToFileTimeUtc()
        if ($observed -eq $filetime) { Write-Output 'observation status=matching_identity' }
        else { Write-Output 'observation status=reused' }
    } catch {
        $errorObject = $_.Exception
        $denied = $false
        while ($null -ne $errorObject) {
            if ($errorObject -is [System.ComponentModel.Win32Exception] -and $errorObject.NativeErrorCode -eq 5) {
                $denied = $true
                break
            }
            $errorObject = $errorObject.InnerException
        }
        if ($denied) { Write-Output 'observation status=access-denied' }
        else { Write-Output 'observation status=unverified reason=identity_query_failed' }
    } finally { $candidate.Dispose() }
    # Any still-visible identity or failed identity query remains inconclusive.
    exit 1
} finally { $worker.Dispose() }
