[CmdletBinding()]
param([Parameter(Mandatory)][switch]$ConfirmFirstOpen27,[ValidateSet('default','jump','command28','hold29','minimal30','minimal30reopen','mcp31','mcp31reopen','mcp32','mcp32reopen')][string]$Fixture='default')
$ErrorActionPreference='Stop'
if(-not $ConfirmFirstOpen27){throw 'Explicit confirmation required.'}
$Fixture=$Fixture.ToLowerInvariant()
$fixtureName=switch($Fixture){'default'{'Binding26Default.cpr'}'jump'{'Binding26Jump.cpr'}'command28'{'Command Input 28.cpr'}'hold29'{'Command Hold 29.cpr'}'minimal30'{'Minimal Save 30.cpr'}'minimal30reopen'{'Minimal Save 30.cpr'}'mcp31'{'MCP Save 31.cpr'}'mcp31reopen'{'MCP Save 31.cpr'}'mcp32'{'MCP Save 32.cpr'}'mcp32reopen'{'MCP Save 32.cpr'}}
$root='E:\VC\CubaseMCP'
if((Split-Path -Parent $PSScriptRoot) -ine $root){throw 'Unexpected workspace.'}
. (Join-Path $root 'scripts\Use-WorkspaceTemp.ps1')
if(Get-Process -Name 'Cubase*' -ErrorAction SilentlyContinue){throw 'Existing Cubase process; no launch.'}
$run=[guid]::NewGuid().ToString('N'); $dirname="first-project-open-27-$run"; $dir=Join-Path $root "artifacts\$dirname"
if(Test-Path -LiteralPath $dir){throw 'Run directory exists.'}; [void][IO.Directory]::CreateDirectory($dir)
$launcher=Join-Path $root 'scripts\Start-CubaseEmptyBackground.ps1'
$launchJson=& $launcher -Background -RunId $run
$launch=$launchJson|ConvertFrom-Json
$holder=Get-Process -Id ([int]$launch.hostPid);[void]$holder.Handle
$receiptPath=Join-Path $root "artifacts\runtime\cubase-empty-launch-24-$run.json"
$deadline=[DateTime]::UtcNow.AddSeconds(60)
while(-not (Test-Path -LiteralPath $receiptPath)){if($holder.HasExited -or [DateTime]::UtcNow -ge $deadline){throw 'Launch receipt unavailable.'};Start-Sleep -Milliseconds 200}
$receipt=Get-Content -LiteralPath $receiptPath -Raw -Encoding UTF8|ConvertFrom-Json
if($receipt.RunId -cne $run -or $receipt.HostPid -ne $holder.Id -or $receipt.mode -cne 'empty' -or $null -ne $receipt.Project -or $receipt.Desktop -cne 'winsta0\CubaseAI_MCP' -or !$receipt.desktopSwitchRestricted -or !$receipt.jobKillsOnLastHandleClose){throw 'Launch receipt mismatch.'}
$target=Get-Process -Id ([int]$receipt.ProcessId);[void]$target.Handle
$tf=$target.StartTime.ToUniversalTime().ToFileTimeUtc().ToString();$hf=$holder.StartTime.ToUniversalTime().ToFileTimeUtc().ToString()
if($tf -cne [string]$receipt.processCreationFiletime -or $hf -cne [string]$receipt.holderCreationFiletime -or $target.Id -eq 72128 -or $holder.Id -eq 55324){throw 'Lifetime mismatch.'}
Add-Type -Path (Join-Path $root 'native\FirstOpen26ProcessIdentity.cs')
$id=[CubaseAiMcp.FirstOpen26ProcessIdentity]::Read($target.Handle,$target.Id,[long]$tf)
$exe='C:\Program Files\Steinberg\Cubase 16\Cubase 16.exe'
if($id.ParentProcessId -ne $holder.Id -or $id.CommandLine.Trim() -notin @($exe,('"'+$exe+'"'))){throw 'Launch parent or command line mismatch.'}
# Adapt only the known historical source and fixed default fixture, never caller input.
# Publish the verified unique receipt and retain the previous canonical receipt.
$canonical=Join-Path $root 'artifacts\runtime\cubase-launch.json'
$temp=Join-Path $dir 'canonical-receipt.tmp';$backup=Join-Path $dir 'previous-cubase-launch.json'
$bytes=[IO.File]::ReadAllBytes($receiptPath)
$f=[IO.File]::Open($temp,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
try{$f.Write($bytes,0,$bytes.Length);$f.Flush($true)}finally{$f.Dispose()}
if(Test-Path -LiteralPath $canonical){[IO.File]::Replace($temp,$canonical,$backup)}else{[IO.File]::Move($temp,$canonical)}
$map=[ordered]@{'134387281655745512'=$tf;'134387281647304009'=$hf;'72128'=[string]$target.Id;'55324'=[string]$holder.Id;'First Empty Probe 24.cpr'=$fixtureName;'first-project-open-24'=$dirname;'2026-11-09T20:02:45.5745512Z'=$target.StartTime.ToUniversalTime().ToString('o');'cubase-empty-launch-24-e6ef5f706a6f436896265a73a0ba82a3.json'="cubase-empty-launch-24-$run.json";'cubase-launch.json'="cubase-empty-launch-24-$run.json"}
$markerKeys=@('134387281655745512','134387281647304009','72128','55324','First Empty Probe 24.cpr','first-project-open-24','2026-11-09T20:02:45.5745512Z','cubase-empty-launch-24-e6ef5f706a6f436896265a73a0ba82a3.json','cubase-launch.json','Split-Path -Parent $PSScriptRoot')
$expected=@{
 'native\bridge\CubaseMcpFirstProjectOpen24.cpp'=@(1,2,2,3,3,0,0,0,0,0)
 'native\FirstProjectJobAudit24.cs'=@(1,1,1,1,0,0,0,0,0,0)
 'native\FirstProjectOpen24Loader.cs'=@(1,0,1,0,1,1,0,0,0,0)
 'scripts\Read-FirstProjectState24.ps1'=@(1,1,7,4,0,0,0,0,1,1)
 'scripts\Observe-FirstProjectOpen24.ps1'=@(2,3,11,3,0,0,0,1,0,1)
 'scripts\Invoke-FirstProjectOpen24.ps1'=@(3,2,11,2,1,4,1,1,0,1)
}
$map['Split-Path -Parent $PSScriptRoot']="'E:\VC\CubaseMCP'"
function Adapt([string]$source,[string]$destination){
 $s=[IO.File]::ReadAllText((Join-Path $root $source));$counts=$expected[$source]
 if($null -eq $counts){throw 'Unknown fixed template.'}
 for($i=0;$i -lt $markerKeys.Count;$i++){
  $count=[regex]::Matches($s,[regex]::Escape($markerKeys[$i])).Count
  if($count -ne $counts[$i]){throw "Template marker mismatch: $source / $($markerKeys[$i]) ($count, expected $($counts[$i]))."}
 }
 $pattern=($markerKeys | Sort-Object Length -Descending | ForEach-Object {[regex]::Escape($_)}) -join '|'
 $s=[regex]::Replace($s,$pattern,[Text.RegularExpressions.MatchEvaluator]{param($m) [string]$map[$m.Value]})
 foreach($key in $markerKeys){if($s.Contains($key)){throw "Unreplaced marker in $source : $key"}}
 $out=Join-Path $dir $destination; $f=[IO.File]::Open($out,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
 try{$b=[Text.UTF8Encoding]::new($false).GetBytes($s);$f.Write($b,0,$b.Length);$f.Flush($true)}finally{$f.Dispose()};return $out
}
$cpp=Adapt 'native\bridge\CubaseMcpFirstProjectOpen24.cpp' 'CubaseMcpFirstProjectOpen24.cpp'
$job=Adapt 'native\FirstProjectJobAudit24.cs' 'FirstProjectJobAudit24.cs'
$loader=Adapt 'native\FirstProjectOpen24Loader.cs' 'FirstProjectOpen24Loader.cs'
if($Fixture -in @('minimal30reopen','mcp31reopen','mcp32reopen')){
    $savedName=switch($Fixture){'minimal30reopen'{'Minimal Saved 30.cpr'}'mcp31reopen'{'MCP Saved 31.cpr'}'mcp32reopen'{'MCP Saved 32.cpr'}}
    $savedLength=(Get-Item -LiteralPath (Join-Path $root ('artifacts\live-smoke\'+$savedName))).Length
    if($savedLength -lt 1000 -or $savedLength -gt 16777216){throw 'Saved fixture exceeds the bounded profile.'}
    $loaderText=[IO.File]::ReadAllText($loader)
    foreach($marker in @('MCP Device Test 20261110.cpr','expected.Length != 93085')){
        if([regex]::Matches($loaderText,[regex]::Escape($marker)).Count -ne 1){throw 'Saved-fixture loader marker mismatch.'}
    }
    $loaderText=$loaderText.Replace('MCP Device Test 20261110.cpr',$savedName).Replace('expected.Length != 93085',('expected.Length != '+$savedLength))
    [IO.File]::WriteAllText($loader,$loaderText,[Text.UTF8Encoding]::new($false))
}
$preflight=Adapt 'scripts\Read-FirstProjectState24.ps1' 'Read-FirstProjectState24.ps1'
$observer=Adapt 'scripts\Observe-FirstProjectOpen24.ps1' 'Observe-FirstProjectOpen24.ps1'
$invoke=Adapt 'scripts\Invoke-FirstProjectOpen24.ps1' 'Invoke-FirstProjectOpen24.ps1'
# Point generated wrapper exclusively at the generated job, loader and preflight.
$s=[IO.File]::ReadAllText($invoke)
foreach($marker in @("Join-Path `$root 'native\FirstProjectJobAudit24.cs'", "Join-Path `$root 'native\FirstProjectOpen24Loader.cs'", "Join-Path `$root 'scripts\Read-FirstProjectState24.ps1'")){
 if([regex]::Matches($s,[regex]::Escape($marker)).Count -ne 1){throw "Generated wrapper dependency mismatch: $marker"}
}
$s=$s.Replace("Join-Path `$root 'native\FirstProjectJobAudit24.cs'", "Join-Path `$root 'artifacts\$dirname\FirstProjectJobAudit24.cs'")
$s=$s.Replace("Join-Path `$root 'native\FirstProjectOpen24Loader.cs'", "Join-Path `$root 'artifacts\$dirname\FirstProjectOpen24Loader.cs'")
$s=$s.Replace("Join-Path `$root 'scripts\Read-FirstProjectState24.ps1'", "Join-Path `$root 'artifacts\$dirname\Read-FirstProjectState24.ps1'")
[IO.File]::WriteAllText($invoke,$s,[Text.UTF8Encoding]::new($false))
$vc='C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat';$dll=Join-Path $dir 'CubaseMcpFirstProjectOpen24.dll';$obj=Join-Path $dir 'probe.obj'
$cmd='call "{0}" >nul && cl /nologo /std:c++17 /EHsc /W4 /WX /LD "{1}" /Fo"{2}" /Fe"{3}" /link version.lib user32.lib' -f $vc,$cpp,$obj,$dll
& cmd.exe /d /s /c $cmd;if($LASTEXITCODE -ne 0){throw 'Fixed module build failed.'}
$ps=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
# Startup structures can appear after the launch receipt. Poll only the read-only
# preflight before consuming admission; the wrapper checks the state again at submission.
$readyDeadline=[DateTime]::UtcNow.AddSeconds(60);$readyState=$null
while([DateTime]::UtcNow -lt $readyDeadline -and -not $target.HasExited -and -not $holder.HasExited){
    $sample=& $ps -NoProfile -NonInteractive -File $preflight
    $sampleCode=$LASTEXITCODE
    try {$state=($sample -join [Environment]::NewLine)|ConvertFrom-Json} catch {throw 'Unreadable startup preflight result.'}
    if($sampleCode -eq 0 -and $state.status -ceq 'observed'){
        if(-not $state.readyForFirstOpen){throw 'The owned host is not in the required empty-project state.'}
        $readyState=$state;break
    }
    if([string]$state.error -notmatch 'informer vtable mismatch|project vtable mismatch|snapshot changed|ReadProcessMemory'){
        throw 'Startup preflight failed outside its initializing states.'
    }
    Start-Sleep -Milliseconds 500
}
if($null -eq $readyState){throw 'Empty-project startup readiness was not observed; no admission was consumed.'}
$obsId=[guid]::NewGuid().ToString('N')
$obs=Start-Process -FilePath $ps -ArgumentList @('-NoProfile','-NonInteractive','-File',('"'+$observer+'"'),'-DurationSeconds','120','-RunId',$obsId) -WindowStyle Hidden -PassThru
$ready=Join-Path $root "artifacts\ipc\first-project-open24-observer-$($target.Id)-$obsId.ready.json";$deadline=[DateTime]::UtcNow.AddSeconds(30)
while(-not (Test-Path -LiteralPath $ready)){if($obs.HasExited -or [DateTime]::UtcNow -ge $deadline){throw 'Observer failed to arm.'};Start-Sleep -Milliseconds 200}
Import-Module (Join-Path $root 'scripts\FirstOpen27Admission.psm1') -Force
$admission=New-FirstOpen27Admission -Target $target -Holder $holder -RunId $run
& $ps -NoProfile -NonInteractive -File $invoke -ConfirmIsolatedModuleLoad -ObserverReadyPath $ready
if($LASTEXITCODE -ne 0){throw "First-open outcome unknown; do not retry. Admission: $admission"}
# Wait for the one asynchronous result without resubmitting the host call.
$resultPath=Join-Path $dir ("open-result-{0}.json" -f $target.Id)
$observed=$null;$resultStatus='unknown'
$resultDeadline=[DateTime]::UtcNow.AddSeconds(30)
while(-not (Test-Path -LiteralPath $resultPath) -and -not $target.HasExited -and [DateTime]::UtcNow -lt $resultDeadline) { Start-Sleep -Milliseconds 200 }
if(Test-Path -LiteralPath $resultPath){
 try{$observed=Get-Content -LiteralPath $resultPath -Raw -Encoding UTF8|ConvertFrom-Json
  if([int]$observed.processId -ne $target.Id){throw 'Result identity mismatch.'}
  $resultStatus='observed'
 }catch{$observed=$null;$resultStatus='invalid_or_incomplete'}
}
[pscustomobject]@{status='queued_completion_unknown';runId=$run;fixture=$fixtureName;targetPid=$target.Id;targetCreationFiletime=$tf;admission=$admission;observerReady=$ready;observerResult=(Join-Path $root "artifacts\ipc\first-project-open24-observer-$($target.Id)-$obsId.json");resultPath=$resultPath;resultObservation=$resultStatus;openStarted=if($null -ne $observed){$observed.openStarted}else{$null};openReturned=if($null -ne $observed){$observed.openReturned}else{$null};openResult=if($null -ne $observed){$observed.openResult}else{$null};completion='unknown';resultDirectory=$dir}|ConvertTo-Json
