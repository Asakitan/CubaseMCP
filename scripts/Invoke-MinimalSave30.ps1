[CmdletBinding()]
param([switch]$Reopen,[ValidateSet('minimal30','mcp31','mcp32')][string]$Profile='minimal30')
$ErrorActionPreference='Stop'
$root='E:\VC\CubaseMCP';. (Join-Path $root 'scripts\Use-WorkspaceTemp.ps1')
$launch=Get-Content -Raw -Encoding UTF8 (Join-Path $root 'artifacts\runtime\cubase-launch.json')|ConvertFrom-Json
if($launch.mode -cne 'empty' -or $null -ne $launch.Project -or $launch.Desktop -cne 'winsta0\CubaseAI_MCP' -or
   $launch.RunId -notmatch '^[a-f0-9]{32}$'){throw 'Owned launch receipt mismatch.'}
$target=Get-Process -Id ([int]$launch.ProcessId);$holder=Get-Process -Id ([int]$launch.HostPid)
try {
    [void]$target.Handle;[void]$holder.Handle
    $tf=$target.StartTime.ToUniversalTime().ToFileTimeUtc().ToString();$hf=$holder.StartTime.ToUniversalTime().ToFileTimeUtc().ToString()
    if($tf -cne [string]$launch.processCreationFiletime -or $hf -cne [string]$launch.holderCreationFiletime){throw 'Lifetime mismatch.'}
    $dir=Join-Path $root ('artifacts\first-project-open-27-'+$launch.RunId)
    if(-not (Test-Path -LiteralPath (Join-Path $dir ('open-result-'+$target.Id+'.json')))){throw 'First-open result absent.'}
    Add-Type -Path @((Join-Path $root 'native\FirstOpen26JobAudit.cs'),(Join-Path $root 'native\CubaseDesktop.cs'))
    $job=[CubaseAiMcp.FirstOpen26JobAudit]::Verify($target.Handle,$target.Id,[long]$tf,$holder.Handle,$holder.Id,[long]$hf)
    if(-not $job.Verified -or $job.MatchingJobs -ne 1 -or $job.UiFlags -ne 64 -or $job.LimitFlags -ne 8192){throw 'Job mismatch.'}
    $reader=Join-Path $dir ('Read-CurrentProjectPath30-'+[Guid]::NewGuid().ToString('N')+'.ps1')
    $text=[IO.File]::ReadAllText((Join-Path $root 'scripts\Read-CurrentProjectPath25.ps1'))
    $map=@{'134387281655745512'=$tf;'134387281647304009'=$hf;'72128'=[string]$target.Id;'55324'=[string]$holder.Id;'Split-Path -Parent $PSScriptRoot'="'E:\VC\CubaseMCP'"}
    $pattern=($map.Keys|Sort-Object Length -Descending|ForEach-Object {[regex]::Escape($_)})-join '|'
    $text=[regex]::Replace($text,$pattern,[Text.RegularExpressions.MatchEvaluator]{param($m)[string]$map[$m.Value]})
    $f=[IO.File]::Open($reader,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
    try{$b=[Text.UTF8Encoding]::new($false).GetBytes($text);$f.Write($b,0,$b.Length);$f.Flush($true)}finally{$f.Dispose()}
    $ps=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $result=& $ps -NoProfile -NonInteractive -File $reader
    if($LASTEXITCODE -ne 0){throw 'Path read failed.'}
    $state=($result -join [Environment]::NewLine)|ConvertFrom-Json;$match=@($state.data.items|Where-Object {$_.equalsGlobalRoot})
    $fixtureName=switch($Profile){'minimal30'{'Minimal Save 30.cpr'}'mcp31'{'MCP Save 31.cpr'}'mcp32'{'MCP Save 32.cpr'}}
    $fixture=Join-Path $root ('artifacts\live-smoke\'+$fixtureName)
    if($state.status -cne 'observed' -or -not $state.data.stable -or $state.data.count -ne 1 -or $match.Count -ne 1 -or
       $match[0].canonicalLexicalCandidate -ine $fixture){throw 'Fixed project path candidate mismatch.'}
    $id=[Guid]::NewGuid().ToString('N');$observer=Join-Path $dir 'Observe-FirstProjectOpen24.ps1'
    $obs=Start-Process -FilePath $ps -ArgumentList @('-NoProfile','-NonInteractive','-File',('"'+$observer+'"'),'-DurationSeconds','90','-RunId',$id) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $dir "minimal30-$id.stdout.log") -RedirectStandardError (Join-Path $dir "minimal30-$id.stderr.log")
    $ready=Join-Path $root "artifacts\ipc\first-project-open24-observer-$($target.Id)-$id.ready.json";$until=[DateTime]::UtcNow.AddSeconds(30)
    while(-not (Test-Path -LiteralPath $ready)){if($obs.HasExited -or [DateTime]::UtcNow -ge $until){throw 'Observer did not arm.'};Start-Sleep -Milliseconds 200}
    $r=Get-Content -Raw -Encoding UTF8 $ready|ConvertFrom-Json
    if($r.pid -ne $target.Id -or $r.observerPid -ne $obs.Id -or $r.inputDesktop -ieq 'CubaseAI_MCP' -or $r.foregroundPid -eq $target.Id){throw 'Observer mismatch.'}
    $preflightDirectory=Join-Path $root $(if($Profile -ceq 'minimal30'){'artifacts\minimal-save30'}else{'artifacts\mcp-save'+$Profile.Substring(3)})
    [void][IO.Directory]::CreateDirectory($preflightDirectory)
    $preflight=Join-Path $preflightDirectory "preflight-$($target.Id)-$tf.json"
    $data=[ordered]@{pid=$target.Id;creation=$tf;holder=$holder.Id;holderCreation=$hf;at=[DateTime]::UtcNow.ToString('o');mode=$(if($Reopen){'reopen'}else{'write'});fixture=$fixture;pathEvidence=$state.outputPath;observerReady=$ready;observerResult=$r.outputPath}
    $temporary=$preflight+'.tmp-'+[Guid]::NewGuid().ToString('N')
    $f=[IO.File]::Open($temporary,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
    try{$b=[Text.UTF8Encoding]::new($false).GetBytes(($data|ConvertTo-Json));$f.Write($b,0,$b.Length);$f.Flush($true)}finally{$f.Dispose()}
    if(Test-Path -LiteralPath $preflight){[IO.File]::Replace($temporary,$preflight,($preflight+'.previous-'+[Guid]::NewGuid().ToString('N')))}else{[IO.File]::Move($temporary,$preflight)}
    $data|ConvertTo-Json
    $clientScript=Join-Path $root $(if($Profile -ceq 'minimal30'){'scripts\verify-minimal-save30.cjs'}else{'scripts\verify-mcp-save31.cjs'})
    $clientArgs=@();if($Reopen){$clientArgs+='--reopen'};if($Profile -ceq 'mcp32'){$clientArgs+='--profile32'}
    & node.exe $clientScript @clientArgs
    if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
} finally {$target.Dispose();$holder.Dispose()}
