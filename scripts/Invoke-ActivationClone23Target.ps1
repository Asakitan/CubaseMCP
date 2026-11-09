param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9a-f]{32}$')]
    [string]$BuildRunId
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dir = Join-Path $root 'artifacts\activation-clone-23-target'
$build = Join-Path $dir ('build-' + $BuildRunId)
$exe = [IO.Path]::GetFullPath((Join-Path $build 'ActivationClone23Target.exe'))
$receiptPath = Join-Path $build 'build-receipt.json'
[IO.Directory]::CreateDirectory($dir) | Out-Null
$admissionPath = Join-Path $dir 'fixed-24036-admission.json'
# A fixed exclusive reservation prevents a second launch, including after failure.
$admission = [IO.File]::Open($admissionPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
$worker = $null
$writer = $null
try {
    $logDir = Join-Path $dir 'fixed-24036-run'
    if (Test-Path -LiteralPath $logDir) { throw 'One-shot log directory exists.' }
    New-Item -ItemType Directory -Path $logDir -ErrorAction Stop | Out-Null
    $logPath = Join-Path $logDir 'wrapper.log'
    $log = [IO.File]::Open($logPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
    $writer = [IO.StreamWriter]::new($log, [Text.UTF8Encoding]::new($false)); $writer.AutoFlush = $true
    try {
        if (-not (Test-Path -LiteralPath $exe -PathType Leaf) -or -not (Test-Path -LiteralPath $receiptPath -PathType Leaf)) {
            throw 'Fixed build executable or receipt is missing.'
        }
        $receipt = Get-Content -LiteralPath $receiptPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $hash = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash
        if ($receipt.buildRunId -cne $BuildRunId -or $receipt.exe -ine $exe -or
            $receipt.sha256 -notmatch '^[0-9A-Fa-f]{64}$' -or $receipt.sha256 -ine $hash) {
            throw 'Build receipt or executable hash mismatch.'
        }
        Add-Type -Path (Join-Path $root 'native\ProjectOpenJobAudit20.cs')
        $audit = [CubaseAiMcp.ProjectOpenJobAudit20]::Verify()
        if (-not $audit.Verified -or $audit.TargetProcessId -ne 24036 -or $audit.HolderProcessId -ne 49588 -or
            $audit.MatchingJobs -ne 1 -or $audit.UiFlags -ne 64 -or $audit.LimitFlags -ne 8192) {
            throw 'Fixed restricted job admission failed.'
        }
        $record = [ordered]@{ timestampUtc = [DateTime]::UtcNow.ToString('o'); targetPid = 24036;
            targetCreationFiletime = '134387250823263004'; holderPid = 49588;
            holderCreationFiletime = '134387250815042125'; matchingJobs = $audit.MatchingJobs;
            uiFlags = $audit.UiFlags; limitFlags = $audit.LimitFlags; buildRunId = $BuildRunId;
            exe = $exe; sha256 = $hash; oneShot = $true }
        $bytes = [Text.UTF8Encoding]::new($false).GetBytes(($record | ConvertTo-Json -Compress))
        $admission.Write($bytes, 0, $bytes.Length); $admission.Flush($true)
        $writer.WriteLine('admission=passed job_check_is_nonatomic=true')
        $stdoutPath = Join-Path $logDir 'worker.stdout.log'
        $stderrPath = Join-Path $logDir 'worker.stderr.log'
        $worker = Start-Process -FilePath $exe -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
        # Cache the process handle before waiting so ExitCode remains bound to this process.
        $workerHandle = $worker.Handle
        if ($workerHandle -eq [IntPtr]::Zero) { throw 'Diagnostic process handle is unavailable; outcome is unknown.' }
        $pidValue = $worker.Id; $created = $worker.StartTime.ToUniversalTime().ToFileTimeUtc()
        $writer.WriteLine("worker pid=$pidValue creation_filetime=$created")
        if (-not $worker.WaitForExit(60000)) {
            $writer.WriteLine("status=timeout worker_pid=$pidValue worker_creation_filetime=$created no_kill=true no_retry=true")
            Write-Output "status=timeout worker_pid=$pidValue worker_creation_filetime=$created stdout=$stdoutPath stderr=$stderrPath"
            exit 1
        }
        if (-not $worker.HasExited) { throw 'Diagnostic completion was not observable; outcome is unknown.' }
        $exitValue = $worker.ExitCode
        if ($null -eq $exitValue -or [string]::IsNullOrWhiteSpace([string]$exitValue)) {
            throw 'Diagnostic exit code is missing; outcome is unknown.'
        }
        $exitCode = [int]$exitValue
        $writer.WriteLine("worker_exit=$exitCode")
        Write-Output "worker_exit=$exitCode stdout=$stdoutPath stderr=$stderrPath"
        exit $exitCode
    } catch {
        $writer.WriteLine('status=error ' + $_.Exception.Message)
        throw
    }
} finally {
    if ($worker) { $worker.Dispose() }
    if ($writer) { $writer.Dispose() }
    $admission.Dispose()
}
