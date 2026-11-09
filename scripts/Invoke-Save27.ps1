[CmdletBinding()]
param([Parameter(Mandatory)][switch]$ConfirmOwnedSave)
$ErrorActionPreference='Stop'
if(-not $ConfirmOwnedSave){throw 'Explicit owned-save confirmation is required.'}
$root='E:\VC\CubaseMCP';$targetId=69032;$targetFt=134387308608166004L;$holderId=54396;$holderFt=134387308599415959L
if((Split-Path -Parent $PSScriptRoot) -ine $root){throw 'Unexpected workspace.'}
$receipt=Get-Content -Raw -Encoding UTF8 (Join-Path $root 'artifacts\runtime\cubase-launch.json')|ConvertFrom-Json
if($receipt.ProcessId -ne $targetId -or [string]$receipt.processCreationFiletime -cne [string]$targetFt -or
   $receipt.HostPid -ne $holderId -or [string]$receipt.holderCreationFiletime -cne [string]$holderFt -or
   $receipt.mode -cne 'empty' -or $null -ne $receipt.Project -or $receipt.Desktop -cne 'winsta0\CubaseAI_MCP') {throw 'Owned launch mismatch.'}
$target=Get-Process -Id $targetId;$holder=Get-Process -Id $holderId
try {
    [void]$target.Handle;[void]$holder.Handle
    if($target.StartTime.ToUniversalTime().ToFileTimeUtc() -ne $targetFt -or $holder.StartTime.ToUniversalTime().ToFileTimeUtc() -ne $holderFt){throw 'Process lifetime mismatch.'}
    Add-Type -Path @((Join-Path $root 'native\FirstOpen26JobAudit.cs'),(Join-Path $root 'native\CubaseDesktop.cs'))
    $job=[CubaseAiMcp.FirstOpen26JobAudit]::Verify($target.Handle,$targetId,$targetFt,$holder.Handle,$holderId,$holderFt)
    if(-not $job.Verified -or $job.MatchingJobs -ne 1 -or $job.UiFlags -ne 64 -or $job.LimitFlags -ne 8192){throw 'Restricted Job mismatch.'}
    $desktopMethod=[CubaseAiMcp.CubaseDesktop].GetMethod('InputDesktopName',[Reflection.BindingFlags]'NonPublic,Static')
    if($desktopMethod.Invoke($null,@()) -ieq 'CubaseAI_MCP'){throw 'Private desktop is active.'}
    $ledger=Join-Path $root "artifacts\ipc\save27-experiment-$targetId-$targetFt.jsonl"
    if(Test-Path -LiteralPath $ledger){throw 'Save experiment already admitted for this lifetime.'}
    $dir=Join-Path $root 'artifacts\first-project-open-27-165f4b65f59f4aff855f17b6bedc447f'
    $pathReader=Join-Path $dir 'Read-CurrentProjectPath27.ps1'
    $ps=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $sample=& $ps -NoProfile -NonInteractive -File $pathReader
    if($LASTEXITCODE -ne 0){throw 'Project path observation failed.'}
    $pathState=($sample -join [Environment]::NewLine)|ConvertFrom-Json
    $current=@($pathState.data.items|Where-Object {$_.equalsGlobalRoot})
    if($pathState.status -cne 'observed' -or -not $pathState.data.stable -or $pathState.data.count -ne 1 -or $current.Count -ne 1 -or
       $current[0].canonicalLexicalCandidate -ine (Join-Path $root 'artifacts\live-smoke\Binding26Jump.cpr')){throw 'Current project path candidate mismatch.'}
    $observer=Join-Path $dir 'Observe-FirstProjectOpen24.ps1';$id=[Guid]::NewGuid().ToString('N')
    $out=Join-Path $dir "save-observer-$id.stdout.log";$err=Join-Path $dir "save-observer-$id.stderr.log"
    $process=Start-Process -FilePath $ps -ArgumentList @('-NoProfile','-NonInteractive','-File',('"'+$observer+'"'),'-DurationSeconds','120','-RunId',$id) -WindowStyle Hidden -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
    $ready=Join-Path $root "artifacts\ipc\first-project-open24-observer-$targetId-$id.ready.json"
    $until=[DateTime]::UtcNow.AddSeconds(30)
    while(-not (Test-Path -LiteralPath $ready)){if($process.HasExited -or [DateTime]::UtcNow -ge $until){throw 'Save observer not ready.'};Start-Sleep -Milliseconds 200}
    $observation=Get-Content -Raw -Encoding UTF8 $ready|ConvertFrom-Json
    if($observation.pid -ne $targetId -or $observation.observerPid -ne $process.Id -or $observation.inputDesktop -ieq 'CubaseAI_MCP' -or $observation.foregroundPid -eq $targetId){throw 'Save observer identity mismatch.'}
    [pscustomobject]@{stage='preflight_observed';projectPathCandidate=$current[0].canonicalLexicalCandidate;pathEvidence=$pathState.outputPath;observerReady=$ready;observerResult=$observation.outputPath;ledger=$ledger}|ConvertTo-Json
    & node.exe (Join-Path $root 'scripts\verify-save27.cjs')
    if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
} finally {$target.Dispose();$holder.Dispose()}
