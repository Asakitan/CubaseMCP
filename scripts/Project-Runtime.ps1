[CmdletBinding()]
param([Parameter(Mandatory)][string]$RequestPath)
$ErrorActionPreference='Stop'
$OutputEncoding=[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$root=Split-Path -Parent $PSScriptRoot
. (Join-Path $root 'scripts\Use-WorkspaceTemp.ps1')
$ps=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$execution='not_started';$stage='request';$mutex=$null;$locked=$false;$operation=$null;$directory=$null;$native=$null
function Write-AtomicJson([string]$Path,$Value){
    $temporary=$Path+'.tmp-'+[guid]::NewGuid().ToString('N')
    $stream=[IO.File]::Open($temporary,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try{$bytes=[Text.UTF8Encoding]::new($false).GetBytes(($Value|ConvertTo-Json -Depth 8 -Compress));$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()}
    if(Test-Path -LiteralPath $Path){[IO.File]::Replace($temporary,$Path,($Path+'.before-'+[guid]::NewGuid().ToString('N')))}else{[IO.File]::Move($temporary,$Path)}
}
function Owned-Process {
    $all=@(Get-Process -Name 'Cubase*' -ErrorAction SilentlyContinue)
    if(-not $all.Count){return $null}
    if($all.Count -ne 1){throw 'Multiple Cubase processes are outside the owned lifecycle.'}
    $receipt=Get-Content -LiteralPath (Join-Path $root 'artifacts\runtime\cubase-launch.json') -Raw -Encoding UTF8|ConvertFrom-Json
    if($receipt.Desktop -cne 'winsta0\CubaseAI_MCP' -or -not $receipt.desktopSwitchRestricted -or -not $receipt.jobKillsOnLastHandleClose){throw 'The running Cubase is not an owned private instance.'}
    $target=$all[0];$holder=Get-Process -Id $receipt.HostPid
    [void]$target.Handle;[void]$holder.Handle
    $tf=$target.StartTime.ToUniversalTime().ToFileTimeUtc();$hf=$holder.StartTime.ToUniversalTime().ToFileTimeUtc()
    if($target.Id -ne $receipt.ProcessId -or [string]$tf -cne [string]$receipt.processCreationFiletime -or [string]$hf -cne [string]$receipt.holderCreationFiletime){throw 'Owned lifetime mismatch.'}
    $identity=[CubaseAiMcp.FirstOpen26ProcessIdentity]::Read($target.Handle,$target.Id,$tf)
    if($identity.ParentProcessId -ne $holder.Id){throw 'Owned parent mismatch.'}
    $job=[CubaseAiMcp.FirstOpen26JobAudit]::Verify($target.Handle,$target.Id,$tf,$holder.Handle,$holder.Id,$hf)
    if(-not $job.Verified -or $job.MatchingJobs -ne 1 -or $job.UiFlags -ne 64 -or $job.LimitFlags -ne 8192){throw 'Owned restricted Job mismatch.'}
    return @{target=$target;holder=$holder;receipt=$receipt;creation=$tf;holderCreation=$hf}
}
function Stop-Owned($Owned){
    if(-not $Owned){return}
    if($operation.confirmDiscardChanges -ne $true){throw 'Explicit discard confirmation is required before ending the owned process.'}
    $stopPath=Join-Path $root ("artifacts\runtime\lifecycle-stop-$($Owned.target.Id)-$($Owned.creation).json")
    $f=[IO.File]::Open($stopPath,[IO.FileMode]::CreateNew);try{$bytes=[Text.Encoding]::UTF8.GetBytes((@{request=$operation.id;status='consumed'}|ConvertTo-Json -Compress));$f.Write($bytes,0,$bytes.Length);$f.Flush($true)}finally{$f.Dispose()}
    [IO.File]::Copy((Join-Path $root 'artifacts\runtime\cubase-launch.json'),(Join-Path $directory 'previous-cubase-launch.json'),$false)
    $start=$Owned.target.StartTime.ToUniversalTime();$script:execution='unknown';$script:stage='stop-owned'
    $Owned.holder.Kill()
    if(-not $Owned.holder.WaitForExit(15000) -or -not $Owned.target.WaitForExit(15000)){throw 'Owned shutdown is pending; no repetition.'}
    $marker=Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'Steinberg\Cubase 16_64\ApplicationStarted.txt'
    if(Test-Path -LiteralPath $marker){$m=Get-Item -LiteralPath $marker;if($m.PSIsContainer -or ($m.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $m.Length -ne 0 -or $m.LastWriteTimeUtc -lt $start){throw 'Unexpected startup marker was preserved.'};Move-Item -LiteralPath $marker -Destination (Join-Path $directory 'ApplicationStarted.txt')}
}
try {
    $operation=Get-Content -LiteralPath $RequestPath -Raw -Encoding UTF8|ConvertFrom-Json
    if($operation.id -notmatch '^[a-f0-9]{32}$' -or $operation.action -notin @('status','stop','create','open','save_as')){throw 'Invalid lifecycle request.'}
    $directory=Join-Path $root ('artifacts\project-create-'+$operation.id)
    if([IO.Path]::GetFullPath($RequestPath) -cne (Join-Path $directory 'operation.json')){throw 'Lifecycle request path mismatch.'}
    foreach($p in @($root,(Join-Path $root 'artifacts'),$directory)){if(([IO.File]::GetAttributes($p) -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Lifecycle directory is a link.'}}
    $mutex=[Threading.Mutex]::new($false,'Local\CubaseAI_MCP_Lifecycle')
    try{$locked=$mutex.WaitOne(0)} catch [Threading.AbandonedMutexException] {$locked=$true}
    if(-not $locked){throw 'Another lifecycle operation is active.'}
    foreach($name in @('ProjectCreateLoader.dll','CubaseProjectCreate.dll')){
        $file=Get-Item -LiteralPath (Join-Path $root ('artifacts\native-runtime\'+$name))
        if($file.PSIsContainer -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Native runtime artifact is not a regular file.'}
    }
    Add-Type -Path (Join-Path $root 'artifacts\native-runtime\ProjectCreateLoader.dll')
    $owned=Owned-Process
    if($operation.action -eq 'status'){
        $managedPath=Join-Path $root 'artifacts\runtime\managed-project.json';$managed=$null
        if($owned -and (Test-Path -LiteralPath $managedPath)){$candidate=Get-Content -LiteralPath $managedPath -Raw -Encoding UTF8|ConvertFrom-Json;if($candidate.pid -eq $owned.target.Id -and $candidate.creation -eq [string]$owned.creation){$managed=$candidate}}
        @{ok=$true;action='status';running=[bool]$owned;owned=[bool]$owned;pid=if($owned){$owned.target.Id}else{$null};creation=if($owned){[string]$owned.creation}else{$null};managedProject=$managed}|ConvertTo-Json -Depth 6 -Compress
        return
    }
    if($operation.action -eq 'stop'){Stop-Owned $owned;@{ok=$true;action='stop';running=$false;discarded=[bool]$owned}|ConvertTo-Json -Compress;return}
    $mode=switch($operation.action){'create'{1}'open'{2}'save_as'{3}}
    if($mode -eq 3 -and $operation.confirmSaveAs -ne $true){throw 'Explicit save-as confirmation is required.'}
    $expected=''
    $stage='project-path'
    $raw=[string]$operation.projectPath
    if($raw -notmatch '^[A-Za-z]:[\\/]' -or $raw.Substring(2).Contains(':')){throw 'An absolute local drive path without alternate streams is required.'}
    $project=[IO.Path]::GetFullPath($raw)
    if($project.Length -gt 500 -or $project -notmatch '^[A-Za-z]:\\' -or [IO.Path]::GetExtension($project) -ine '.cpr' -or ($mode -eq 2 -and -not(Test-Path -LiteralPath $project)) -or ($mode -ne 2 -and (Test-Path -LiteralPath $project))){throw 'The requested local CPR path does not match the operation.'}
    if($mode -eq 2){$existing=Get-Item -LiteralPath $project;if($existing.PSIsContainer -or ($existing.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Open requires a regular CPR file.'}}
    $projectDirectory=[IO.Path]::GetDirectoryName($project)
    if($projectDirectory.Length -le 3){throw 'A project folder below the drive root is required.'}
    if([IO.Path]::GetFileNameWithoutExtension($project) -match '^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$'){throw 'Reserved Windows device filename.'}
    for($p=$projectDirectory;$p;$p=[IO.Path]::GetDirectoryName($p)){if((Test-Path -LiteralPath $p) -and ([IO.File]::GetAttributes($p) -band [IO.FileAttributes]::ReparsePoint)){throw 'Project path contains a link.'}}
    if($mode -ne 3 -and $owned -and $operation.replaceCurrent -ne $true){throw 'An owned project is running; replacement was not requested.'}
    [void][IO.Directory]::CreateDirectory($projectDirectory)
    if($mode -eq 3){
        if(-not $owned){throw 'Save-as requires an active owned project.'}
        $managedPath=Join-Path $root 'artifacts\runtime\managed-project.json'
        $current=Get-Content -LiteralPath $managedPath -Raw -Encoding UTF8|ConvertFrom-Json
        if($current.pid -ne $owned.target.Id -or $current.creation -cne [string]$owned.creation){throw 'Managed project identity mismatch.'}
        $expected=[string]$current.projectPath
        if($expected.Length -gt 500){throw 'Managed source path exceeds the native bound.'}
        $target=$owned.target;$holder=$owned.holder;$tf=$owned.creation;$hf=$owned.holderCreation
    } else {
    Stop-Owned $owned
    $stage='ports'
    $doctor=& node.exe (Join-Path $root 'dist\src\doctor.js')
    $ports=($doctor -join [Environment]::NewLine)|ConvertFrom-Json
    if(-not $ports.readyForHandshake){
        $execution='unknown';& (Join-Path $root 'scripts\Start-MidiPorts.ps1') -Background|Out-Null
        $doctor=& node.exe (Join-Path $root 'dist\src\doctor.js');$ports=($doctor -join [Environment]::NewLine)|ConvertFrom-Json
        if(-not $ports.readyForHandshake){throw 'Configured MIDI ports are not ready.'}
    }
    $stage='launch';$execution='unknown'
    $ps=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $launch=& $ps -NoProfile -NonInteractive -File (Join-Path $root 'scripts\Start-CubaseEmptyBackground.ps1') -Background -RunId $operation.id
    if($LASTEXITCODE -ne 0){throw 'Owned empty launch failed.'}
    $receiptPath=Join-Path $root ('artifacts\runtime\cubase-empty-launch-24-'+$operation.id+'.json');$deadline=[DateTime]::UtcNow.AddSeconds(50)
    while(-not(Test-Path -LiteralPath $receiptPath)){if([DateTime]::UtcNow -ge $deadline){throw 'Owned launch receipt is pending.'};Start-Sleep -Milliseconds 200}
    $receipt=Get-Content -LiteralPath $receiptPath -Raw -Encoding UTF8|ConvertFrom-Json
    if($receipt.RunId -cne $operation.id -or $receipt.mode -cne 'empty' -or $null -ne $receipt.Project -or $receipt.Desktop -cne 'winsta0\CubaseAI_MCP'){throw 'Owned launch receipt mismatch.'}
    Write-AtomicJson (Join-Path $root 'artifacts\runtime\cubase-launch.json') $receipt
    $owned=Owned-Process;$tf=$owned.creation;$hf=$owned.holderCreation;$target=$owned.target;$holder=$owned.holder
    $mapping=@{'134387281655745512'=[string]$tf;'134387281647304009'=[string]$hf;'72128'=[string]$target.Id;'55324'=[string]$holder.Id;'Split-Path -Parent $PSScriptRoot'="'"+$root+"'"}
    $pattern=($mapping.Keys|Sort-Object Length -Descending|ForEach-Object {[regex]::Escape($_)})-join '|'
    $preflight=[IO.File]::ReadAllText((Join-Path $root 'scripts\Read-FirstProjectState24.ps1'))
    $preflight=[regex]::Replace($preflight,$pattern,[Text.RegularExpressions.MatchEvaluator]{param($m)[string]$mapping[$m.Value]})
    $preflightPath=Join-Path $directory 'Read-EmptyState.ps1';[IO.File]::WriteAllText($preflightPath,$preflight,[Text.UTF8Encoding]::new($false))
    $stage='empty-readiness';$deadline=[DateTime]::UtcNow.AddSeconds(50);$ready=$false
    while([DateTime]::UtcNow -lt $deadline){
        $sample=& $ps -NoProfile -NonInteractive -File $preflightPath;$state=($sample -join [Environment]::NewLine)|ConvertFrom-Json
        if($LASTEXITCODE -eq 0 -and $state.readyForFirstOpen){$ready=$true;break}
        if($state.status -eq 'observed' -or [string]$state.error -notmatch 'informer vtable mismatch|project vtable mismatch|snapshot changed|ReadProcessMemory'){throw 'Empty preflight rejected the state.'}
        Start-Sleep -Milliseconds 500
    }
    if(-not $ready){throw 'Empty readiness is pending; creation was not submitted.'}
    }
    [IO.File]::Copy((Join-Path $root 'artifacts\native-runtime\CubaseProjectCreate.dll'),(Join-Path $directory 'CubaseProjectCreate.dll'),$false)
    $f=[IO.File]::Open((Join-Path $directory 'request.bin'),[IO.FileMode]::CreateNew);$writer=[IO.BinaryWriter]::new($f)
    try{$writer.Write([uint32]3);$writer.Write([uint32]$target.Id);$writer.Write([uint64]$tf);$writer.Write([uint32]$holder.Id);$writer.Write([uint32]$mode);$writer.Write([uint64]$hf);$writer.Write([uint64][DateTime]::UtcNow.AddSeconds(40).ToFileTimeUtc());$writer.Write([uint64][DateTime]::UtcNow.Ticks);foreach($path in @($project,$expected)){$buffer=New-Object byte[] 1024;$text=[Text.Encoding]::Unicode.GetBytes($path);[Array]::Copy($text,$buffer,$text.Length);$writer.Write($buffer)};$writer.Flush();$f.Flush($true)}finally{$writer.Dispose()}
    $admission=Join-Path $root ("artifacts\runtime\project-operation-$mode-$($target.Id)-$tf-$($operation.id).json")
    $f=[IO.File]::Open($admission,[IO.FileMode]::CreateNew);try{$bytes=[Text.Encoding]::UTF8.GetBytes((@{request=$operation.id;status='consumed'}|ConvertTo-Json -Compress));$f.Write($bytes,0,$bytes.Length);$f.Flush($true)}finally{$f.Dispose()}
    $stage='native-project-operation';$execution='unknown';$loaded=[CubaseAiMcp.ProjectCreateLoader]::LoadAndStart($target.Id,$tf,$holder.Id,$hf,(Join-Path $directory 'CubaseProjectCreate.dll'))
    Write-AtomicJson (Join-Path $directory 'loader-result.json') $loaded
    if($loaded.Error -or -not $loaded.EntryCompleted -or $loaded.EntryReturnCode -ne 0){throw 'Native entry did not complete admission.'}
    $resultPath=Join-Path $directory 'create-result.json';$deadline=[DateTime]::UtcNow.AddSeconds(30)
    while(-not(Test-Path -LiteralPath $resultPath)){if($target.HasExited -or [DateTime]::UtcNow -ge $deadline){throw 'Native creation outcome is pending.'};Start-Sleep -Milliseconds 200}
    $native=Get-Content -LiteralPath $resultPath -Raw -Encoding UTF8|ConvertFrom-Json
    if($native.pid -ne $target.Id -or -not $native.succeeded -or -not $native.operationReturned -or ($mode -ne 2 -and (-not $native.saveReturned -or $native.saveValue -ne 1)) -or $native.exception -ne 0){if($mode -eq 3 -and -not $native.operationStarted){$execution='not_started'};throw 'Native project operation did not establish its postcondition.'}
    $file=Get-Item -LiteralPath $project
    if($file.Length -lt 12 -or $file.PSIsContainer){throw 'Created CPR is absent or incomplete.'}
    $managed=@{pid=$target.Id;creation=[string]$tf;projectPath=$project;bytes=$file.Length;native=$native;state=($operation.action+'_observed')}
    Write-AtomicJson (Join-Path $root 'artifacts\runtime\managed-project.json') $managed
    # Native construction can return before MIDI Remote has activated its page.
    # Observe readiness without sending or retrying any MIDI request.
    $stage='mapping-readiness';$deadline=[DateTime]::UtcNow.AddSeconds(35);$mappingReady=$false
    while([DateTime]::UtcNow -lt $deadline -and -not $target.HasExited){
        $console=& $ps -NoProfile -NonInteractive -File (Join-Path $root 'scripts\Read-MidiScriptErrors.ps1') -TargetProcessId $target.Id
        $view=($console -join [Environment]::NewLine)|ConvertFrom-Json
        if($view.status -eq 'observed' -and $view.matchFound){
            $constructed=$false;$active=-1;$deactivated=-1;$idle=-1
            foreach($entry in $view.messages){
                if($entry.text -eq '[CubaseAI MCP] controller constructed 2026-11-10-coverage-3.13'){$constructed=$true}
                if($entry.text -eq '[CubaseAI MCP] mapping activated'){$active=[int]$entry.index}
                if($entry.text -in @('[CubaseAI MCP] mapping deactivated','[CubaseAI MCP] device deactivated')){$deactivated=[int]$entry.index}
                if($entry.text -eq '[CubaseAI MCP] first idle: matching device=true, mapping=true'){$idle=[int]$entry.index}
            }
            if($constructed -and $active -gt $deactivated -and $idle -gt $active){$mappingReady=$true;Write-AtomicJson (Join-Path $directory 'mapping-ready.json') $view;break}
        }
        Start-Sleep -Milliseconds 250
    }
    if(-not $mappingReady){throw 'Created project is retained; MIDI mapping readiness was not observed. No handshake was sent.'}
    @{ok=$true;action=$operation.action;running=$true;owned=$true;managedProject=$managed;artifacts=$directory}|ConvertTo-Json -Depth 6 -Compress
} catch {
    $failure=@{ok=$false;code='LIFECYCLE_FAILED';message=$_.Exception.Message;stage=$stage;execution=$execution;artifacts=$directory;native=$native}
    if($directory){try{Write-AtomicJson (Join-Path $directory 'operation-error.json') $failure}catch{}}
    $failure|ConvertTo-Json -Compress
    exit 1
} finally {if($locked){$mutex.ReleaseMutex()};if($mutex){$mutex.Dispose()}}
