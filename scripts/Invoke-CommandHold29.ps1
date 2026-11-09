[CmdletBinding()]
param([Parameter(Mandatory)][switch]$ConfirmOwnedInput)
$ErrorActionPreference='Stop'
if(-not $ConfirmOwnedInput){throw 'Explicit owned-input confirmation is required.'}
$root='E:\VC\CubaseMCP';$targetId=21444;$targetFt=134387317774583852L;$holderId=46688;$holderFt=134387317765795669L
if((Split-Path -Parent $PSScriptRoot) -ine $root){throw 'Unexpected workspace.'}
. (Join-Path $root 'scripts\Use-WorkspaceTemp.ps1')
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
    $ledger=Join-Path $root "artifacts\ipc\command-hold29-$targetId-$targetFt.jsonl"
    if(Test-Path -LiteralPath $ledger){throw 'Command-input experiment already admitted for this lifetime.'}
    $dir=Join-Path $root 'artifacts\first-project-open-27-c6bddee5e59a422bbba2f4908664ad89'
    $pathReader=Join-Path $dir 'Read-CurrentProjectPath29.ps1'
    $ps=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    if(Test-Path -LiteralPath $pathReader){throw 'Lifetime path-reader adaptation already exists.'}
    $text=[IO.File]::ReadAllText((Join-Path $root 'scripts\Read-CurrentProjectPath25.ps1'))
    foreach($pair in @(@('134387281655745512','134387317774583852'),@('134387281647304009','134387317765795669'),@('72128','21444'),@('55324','46688'),@('Split-Path -Parent $PSScriptRoot',"'E:\VC\CubaseMCP'"))){
        if(-not $text.Contains($pair[0])){throw 'Path-reader marker mismatch.'};$text=$text.Replace($pair[0],$pair[1])
    }
    $file=[IO.File]::Open($pathReader,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
    try{$bytes=[Text.UTF8Encoding]::new($false).GetBytes($text);$file.Write($bytes,0,$bytes.Length);$file.Flush($true)}finally{$file.Dispose()}
    $sample=& $ps -NoProfile -NonInteractive -File $pathReader
    if($LASTEXITCODE -ne 0){throw 'Project path observation failed.'}
    $pathState=($sample -join [Environment]::NewLine)|ConvertFrom-Json
    $current=@($pathState.data.items|Where-Object {$_.equalsGlobalRoot})
    if($pathState.status -cne 'observed' -or -not $pathState.data.stable -or $pathState.data.count -ne 1 -or $current.Count -ne 1 -or
       $current[0].canonicalLexicalCandidate -ine (Join-Path $root 'artifacts\live-smoke\Command Hold 29.cpr')){throw 'Current project path candidate mismatch.'}
    $observer=Join-Path $dir 'Observe-FirstProjectOpen24.ps1';$id=[Guid]::NewGuid().ToString('N')
    $out=Join-Path $dir "input28-observer-$id.stdout.log";$err=Join-Path $dir "input28-observer-$id.stderr.log"
    $process=Start-Process -FilePath $ps -ArgumentList @('-NoProfile','-NonInteractive','-File',('"'+$observer+'"'),'-DurationSeconds','120','-RunId',$id) -WindowStyle Hidden -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
    $ready=Join-Path $root "artifacts\ipc\first-project-open24-observer-$targetId-$id.ready.json"
    $until=[DateTime]::UtcNow.AddSeconds(30)
    while(-not (Test-Path -LiteralPath $ready)){if($process.HasExited -or [DateTime]::UtcNow -ge $until){throw 'Input observer not ready.'};Start-Sleep -Milliseconds 200}
    $observation=Get-Content -Raw -Encoding UTF8 $ready|ConvertFrom-Json
    if($observation.pid -ne $targetId -or $observation.observerPid -ne $process.Id -or $observation.inputDesktop -ieq 'CubaseAI_MCP' -or $observation.foregroundPid -eq $targetId){throw 'Input observer identity mismatch.'}
    [pscustomobject]@{stage='preflight_observed';projectPathCandidate=$current[0].canonicalLexicalCandidate;pathEvidence=$pathState.outputPath;observerReady=$ready;observerResult=$observation.outputPath;ledger=$ledger}|ConvertTo-Json
    & node.exe (Join-Path $root 'scripts\verify-command-hold29.cjs')
    if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
} finally {$target.Dispose();$holder.Dispose()}
