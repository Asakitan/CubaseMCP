[CmdletBinding()]
param([Parameter(Mandatory)][string]$RequestPath)
$ErrorActionPreference='Stop'
$OutputEncoding=[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$root=Split-Path -Parent $PSScriptRoot
. (Join-Path $root 'scripts\Use-WorkspaceTemp.ps1')
$ps=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$execution='not_started';$stage='request';$mutex=$null;$locked=$false;$operation=$null;$directory=$null;$native=$null;$startupRecovery=@()
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
    $target=$all[0]
    # A launch that was interrupted before its receipt was published leaves a process this record does not describe.
    $holder=Get-Process -Id $receipt.HostPid -ErrorAction SilentlyContinue
    if(-not $holder){throw 'The running Cubase does not match the owned launch receipt: its holder process is gone. It is not adopted or ended.'}
    [void]$target.Handle;[void]$holder.Handle
    $tf=$target.StartTime.ToUniversalTime().ToFileTimeUtc();$hf=$holder.StartTime.ToUniversalTime().ToFileTimeUtc()
    if($target.Id -ne $receipt.ProcessId -or [string]$tf -cne [string]$receipt.processCreationFiletime -or [string]$hf -cne [string]$receipt.holderCreationFiletime){throw 'Owned lifetime mismatch.'}
    $identity=[CubaseAiMcp.FirstOpen26ProcessIdentity]::Read($target.Handle,$target.Id,$tf)
    if($identity.ParentProcessId -ne $holder.Id){throw 'Owned parent mismatch.'}
    $job=[CubaseAiMcp.FirstOpen26JobAudit]::Verify($target.Handle,$target.Id,$tf,$holder.Handle,$holder.Id,$hf)
    if(-not $job.Verified -or $job.MatchingJobs -ne 1 -or $job.UiFlags -ne 64 -or $job.LimitFlags -ne 8192){throw 'Owned restricted Job mismatch.'}
    return @{target=$target;holder=$holder;receipt=$receipt;creation=$tf;holderCreation=$hf}
}
function Stop-Owned($Owned,[switch]$StartupRecovery){
    if(-not $Owned){return}
    if(-not $StartupRecovery -and $operation.confirmDiscardChanges -ne $true){throw 'Explicit discard confirmation is required before ending the owned process.'}
    if($StartupRecovery -and ($Owned.receipt.mode -cne 'empty' -or $Owned.receipt.RunId -cne $script:startupRunId -or
        (Test-Path -LiteralPath (Join-Path $directory 'request.bin')))){throw 'Startup recovery cannot stop a submitted project operation.'}
    $stopPath=Join-Path $root ("artifacts\runtime\lifecycle-stop-$($Owned.target.Id)-$($Owned.creation).json")
    $f=[IO.File]::Open($stopPath,[IO.FileMode]::CreateNew);try{$bytes=[Text.Encoding]::UTF8.GetBytes((@{request=$operation.id;status='consumed'}|ConvertTo-Json -Compress));$f.Write($bytes,0,$bytes.Length);$f.Flush($true)}finally{$f.Dispose()}
    $prefix=if($StartupRecovery){'startup-'+$Owned.target.Id+'-'}else{''}
    [IO.File]::Copy((Join-Path $root 'artifacts\runtime\cubase-launch.json'),(Join-Path $directory ($prefix+'previous-cubase-launch.json')),$false)
    $start=$Owned.target.StartTime.ToUniversalTime();$script:execution='unknown';$script:stage='stop-owned'
    $Owned.holder.Kill()
    if(-not $Owned.holder.WaitForExit(15000) -or -not $Owned.target.WaitForExit(15000)){throw 'Owned shutdown is pending; no repetition.'}
    $marker=Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'Steinberg\Cubase 16_64\ApplicationStarted.txt'
    if(Test-Path -LiteralPath $marker){$m=Get-Item -LiteralPath $marker;if($m.PSIsContainer -or ($m.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $m.Length -ne 0 -or $m.LastWriteTimeUtc -lt $start){throw 'Unexpected startup marker was preserved.'};Move-Item -LiteralPath $marker -Destination (Join-Path $directory ($prefix+'ApplicationStarted.txt'))}
}
function Recover-LicenseStartup($Owned,$Windows){
    if((Test-Path -LiteralPath (Join-Path $directory 'request.bin')) -or $Windows.status -cne 'observed' -or
        $Windows.pid -ne $Owned.target.Id -or [string]$Windows.creation -cne [string]$Owned.creation){throw 'Startup recovery identity mismatch.'}
    $blocking=@($Windows.windows|Where-Object {$_.visible -and $_.className -notmatch '^UAC|^Touch Tooltip'})
    $license=@($blocking|Where-Object {$_.className -match '^SteinbergWindowClass' -and
        $_.title -match '^(Checking licen[sc]es|\u68c0\u67e5\u8bb8\u53ef\u8bc1|\u6b63\u5728\u68c0\u67e5\u8bb8\u53ef\u8bc1)(\.{3}|\u2026)?$'})
    if($blocking.Count -ne 1 -or $license.Count -ne 1){throw 'Startup is not blocked exclusively at license checking.'}
    $helpers=@(Get-Process -Name SteinbergLicenseEngine -ErrorAction SilentlyContinue|Where-Object {$_.SessionId -eq $Owned.target.SessionId})
    $helperPath=Join-Path ${env:CommonProgramFiles} 'Steinberg\Activation Manager\SteinbergLicenseEngine.exe'
    foreach($helper in $helpers){
        [void]$helper.Handle
        if($helper.Path -ine $helperPath){throw 'License helper executable mismatch.'}
    }
    $entry=@{reason='license_startup_wait';pid=$Owned.target.Id;creation=[string]$Owned.creation;helpers=@($helpers|ForEach-Object {@{pid=$_.Id;creation=[string]$_.StartTime.ToUniversalTime().ToFileTimeUtc()}});state='admitted';nativeSubmitted=$false}
    $script:startupRecovery+=@($entry)
    Write-AtomicJson (Join-Path $directory 'startup-recovery.json') $script:startupRecovery
    Stop-Owned $Owned -StartupRecovery
    if(Get-Process -Name 'Cubase*','Nuendo*','Dorico*','WaveLab*' -ErrorAction SilentlyContinue){throw 'Another Steinberg host prevents restarting the shared license helper.'}
    foreach($helper in $helpers){
        $helper.Refresh()
        if(-not $helper.HasExited){$helper.Kill();if(-not $helper.WaitForExit(15000)){throw 'License helper shutdown did not finish.'}}
        $helper.Dispose()
    }
    $entry.state='stopped_before_native_submission'
    Write-AtomicJson (Join-Path $directory 'startup-recovery.json') $script:startupRecovery
}
try {
    $operation=Get-Content -LiteralPath $RequestPath -Raw -Encoding UTF8|ConvertFrom-Json
    if($operation.id -notmatch '^[a-f0-9]{32}$' -or $operation.action -notin @('status','stop','create','open','save_as','import_midi','export_audio','import_audio','model_snapshot','edit_event','create_track','unload_plugin','routing','automation')){throw 'Invalid lifecycle request.'}
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
    $mode=switch($operation.action){'create'{1}'open'{2}'save_as'{3}'import_midi'{4}'export_audio'{5}'import_audio'{6}'model_snapshot'{7}'edit_event'{8}}
    if($operation.action -ceq 'create_track'){$mode=9}
    if($operation.action -ceq 'unload_plugin'){$mode=10}
    if($operation.action -ceq 'routing'){$mode=11}
    if($operation.action -ceq 'automation'){$mode=12}
    if($mode -eq 12 -and ($operation.root -notmatch '^0x[0-9a-fA-F]{1,16}$' -or $operation.trackEventId -notmatch '^0x[0-9a-fA-F]{1,16}$')){throw 'Invalid automation track identity.'}
    if($mode -eq 11){
        $routeWrite=$operation.PSObject.Properties['routeMode'] -and $operation.routeMode -ceq 'set'
        if($operation.root -notmatch '^0x[0-9a-fA-F]{1,16}$' -or $operation.objectId -lt 1 -or $operation.objectId -gt 2147483647 -or $operation.tag -notin @(4007,4008,4099,4101,4102)){throw 'Invalid routing request.'}
        if($routeWrite -and ($operation.confirmRouting -ne $true -or $operation.expectedValue -lt -1 -or [math]::Truncate($operation.expectedValue) -ne $operation.expectedValue -or $operation.targetId -lt 0 -or $operation.targetId -ge 10000 -or [math]::Truncate($operation.targetId) -ne $operation.targetId -or $operation.targetName -isnot [string] -or $operation.targetName.Length -lt 1 -or $operation.targetName.Length -gt 255 -or $operation.targetName -match '[\x00-\x1f]')){throw 'Invalid routing target.'}
    }
    if($mode -eq 10 -and ($operation.confirmUnload -ne $true -or $operation.root -notmatch '^0x[0-9a-fA-F]{1,16}$' -or $operation.objectId -lt 1 -or $operation.objectId -gt 2147483647 -or [math]::Truncate($operation.objectId) -ne $operation.objectId)){throw 'Invalid plugin unload request.'}
    if($mode -eq 9 -and ($operation.confirmCreate -ne $true -or $operation.root -notmatch '^0x[0-9a-fA-F]{1,16}$' -or $operation.kind -cnotin @('midi','group','fx','instrument','folder') -or $operation.name -isnot [string] -or $operation.name.Length -lt 1 -or $operation.name.Length -gt 255 -or $operation.name -match '[\x00-\x1f]')){throw 'Invalid track creation request.'}
    if($mode -eq 7 -and ($operation.offset -lt 0 -or $operation.offset -gt 8192 -or $operation.limit -lt 1 -or $operation.limit -gt 128)){throw 'Invalid model page bounds.'}
    if($mode -eq 8){
        if($operation.confirmEdit -ne $true -or $operation.root -notmatch '^0x[0-9a-fA-F]{1,16}$' -or $operation.field -cnotin @('position','duration','pitch','velocity') -or $operation.path.Count -lt 2 -or $operation.path.Count -gt 8 -or $operation.expected.type -cnotin @('MAudioEvent','MAudioPartEvent','MMidiPartEvent','MMidiNote') -or $operation.expected.name.Length -gt 255 -or ([string]$operation.expected.name).Contains([char]0)){throw 'Invalid guarded event edit.'}
        foreach($index in $operation.path){if($index -lt 0 -or $index -gt 8191 -or [math]::Truncate($index) -ne $index){throw 'Invalid event index.'}}
        foreach($value in @($operation.seconds,$operation.expected.durationSeconds)){if($null -eq $value -or [double]::IsNaN($value) -or [double]::IsInfinity($value) -or $value -lt 0 -or $value -gt 86400){throw 'Invalid event time.'}}
        $value=$operation.expected.startSeconds
        if($null -eq $value -or [double]::IsNaN($value) -or [double]::IsInfinity($value) -or $value -lt -86400 -or $value -gt 86400){throw 'Invalid expected event position.'}
        if($operation.field -ceq 'duration' -and $operation.seconds -le 0){throw 'Event duration must be positive.'}
        if($operation.expected.type -ceq 'MMidiNote'){
            if($operation.eventId -notmatch '^0x[0-9a-fA-F]{1,16}$' -or $operation.eventId -match '^0x0+$' -or $operation.path.Count -lt 3){throw 'A discovered MIDI note identity is required.'}
            foreach($field in @('pitch','velocity','channel')){$value=$operation.expected.$field;$maximum=if($field -ceq 'channel'){15}else{127};if($null -eq $value -or $value -lt 0 -or $value -gt $maximum -or [math]::Truncate($value) -ne $value){throw 'Invalid expected MIDI note value.'}}
            $value=$operation.expected.velocityNormalized
            if($null -eq $value -or [double]::IsNaN($value) -or [double]::IsInfinity($value) -or $value -lt 0 -or $value -gt 1){throw 'Invalid expected MIDI velocity.'}
        }elseif($operation.field -cin @('pitch','velocity')){throw 'Only MIDI notes support pitch or velocity.'}
        if($operation.field -cin @('pitch','velocity') -and ($operation.seconds -gt 127 -or [math]::Truncate($operation.seconds) -ne $operation.seconds -or ($operation.field -ceq 'velocity' -and $operation.seconds -le 0))){throw 'Invalid MIDI note value.'}
    }
    if($mode -eq 3 -and $operation.confirmSaveAs -ne $true){throw 'Explicit save-as confirmation is required.'}
    if($mode -in @(4,6) -and $operation.confirmImport -ne $true){throw 'Explicit import confirmation is required.'}
    if($mode -eq 5 -and ($operation.confirmExport -ne $true -or $operation.sampleRate -notin @(8000,11025,16000,22050,32000,44100,48000,88200,96000,176400,192000) -or $operation.bitDepth -notin @(16,24,32) -or $operation.floatingPoint -isnot [bool] -or ($operation.floatingPoint -and $operation.bitDepth -ne 32) -or $operation.timeoutMs -lt 5000 -or $operation.timeoutMs -gt 600000)){throw 'Invalid explicit audio export options.'}
    $expected=''
    $stage='project-path'
    $raw=[string]$(if($mode -eq 4){$operation.midiPath}elseif($mode -eq 5){$operation.outputPath}elseif($mode -eq 6){$operation.audioPath}else{$operation.projectPath})
    if($raw -notmatch '^[A-Za-z]:[\\/]' -or $raw.Substring(2).Contains(':')){throw 'An absolute local drive path without alternate streams is required.'}
    $project=[IO.Path]::GetFullPath($raw)
    if($mode -eq 4){
        # The source is an existing Standard MIDI File; the managed project is the import destination.
        if($project.Length -gt 500 -or $project -notmatch '^[A-Za-z]:\\' -or [IO.Path]::GetExtension($project) -inotin @('.mid','.midi') -or -not(Test-Path -LiteralPath $project -PathType Leaf)){throw 'The MIDI source path is not an existing local .mid file.'}
        $existing=Get-Item -LiteralPath $project
        if(($existing.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $existing.Length -lt 22 -or $existing.Length -gt 16MB){throw 'The MIDI source must be a regular file between 22 bytes and 16 MiB.'}
        $header=New-Object byte[] 4;$stream=[IO.File]::OpenRead($project);try{[void]$stream.Read($header,0,4)}finally{$stream.Dispose()}
        if([Text.Encoding]::ASCII.GetString($header) -cne 'MThd'){throw 'The MIDI source does not start with a Standard MIDI File header.'}
    } elseif($mode -eq 6){
        if($project.Length -gt 500 -or [IO.Path]::GetExtension($project) -inotin @('.wav','.aif','.aiff','.flac') -or -not(Test-Path -LiteralPath $project -PathType Leaf)){throw 'Audio import requires an existing local WAV, AIFF or FLAC file.'}
        $existing=Get-Item -LiteralPath $project
        if(($existing.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $existing.Length -le 44 -or $existing.Length -gt 512MB){throw 'Audio source must be a regular file up to 512 MiB.'}
        $header=New-Object byte[] 12;$stream=[IO.File]::OpenRead($project);try{[void]$stream.Read($header,0,12)}finally{$stream.Dispose()}
        $magic=[Text.Encoding]::ASCII.GetString($header,0,4);$kind=[Text.Encoding]::ASCII.GetString($header,8,4)
        if(-not (($magic -ceq 'RIFF' -and $kind -ceq 'WAVE') -or ($magic -ceq 'FORM' -and $kind -cin @('AIFF','AIFC')) -or $magic -ceq 'fLaC')){throw 'Audio container header is not supported.'}
    } elseif($mode -eq 5){
        if($project.Length -gt 500 -or [IO.Path]::GetExtension($project) -inotin @('.wav','.aif','.aiff','.flac') -or (Test-Path -LiteralPath $project)){throw 'Audio export requires a new local WAV, AIFF or FLAC path; existing files are preserved.'}
        if([IO.Path]::GetExtension($project) -ieq '.flac' -and ($operation.floatingPoint -or $operation.bitDepth -eq 32)){throw 'FLAC export requires 16- or 24-bit integer samples.'}
    } elseif($project.Length -gt 500 -or $project -notmatch '^[A-Za-z]:\\' -or [IO.Path]::GetExtension($project) -ine '.cpr' -or ($mode -in @(2,7,8,9,10,11,12) -and -not(Test-Path -LiteralPath $project)) -or ($mode -notin @(2,7,8,9,10,11,12) -and (Test-Path -LiteralPath $project))){throw 'The requested local CPR path does not match the operation.'}
    if($mode -in @(2,7,8,9,10,11,12)){$existing=Get-Item -LiteralPath $project;if($existing.PSIsContainer -or ($existing.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'A regular CPR file is required.'}}
    $projectDirectory=[IO.Path]::GetDirectoryName($project)
    if($projectDirectory.Length -le 3){throw 'A project folder below the drive root is required.'}
    if([IO.Path]::GetFileNameWithoutExtension($project) -match '^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$'){throw 'Reserved Windows device filename.'}
    for($p=$projectDirectory;$p;$p=[IO.Path]::GetDirectoryName($p)){if((Test-Path -LiteralPath $p) -and ([IO.File]::GetAttributes($p) -band [IO.FileAttributes]::ReparsePoint)){throw 'Project path contains a link.'}}
    if($mode -lt 3 -and $owned -and $operation.replaceCurrent -ne $true){throw 'An owned project is running; replacement was not requested.'}
    if($mode -notin @(4,6,7,8,9,10,11,12)){[void][IO.Directory]::CreateDirectory($projectDirectory)}
    if($mode -ge 3){
        if(-not $owned){throw 'This operation requires an active owned project.'}
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
    for($startupAttempt=0;$startupAttempt -lt 2;$startupAttempt++){
    $script:startupRunId=if($startupAttempt -eq 0){$operation.id}else{[guid]::NewGuid().ToString('N')}
    $stage='launch';$execution='unknown'
    $ps=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $launch=& $ps -NoProfile -NonInteractive -File (Join-Path $root 'scripts\Start-CubaseEmptyBackground.ps1') -Background -RunId $script:startupRunId
    if($LASTEXITCODE -ne 0){throw 'Owned empty launch failed.'}
    $starting=($launch -join [Environment]::NewLine)|ConvertFrom-Json
    $receiptPath=Join-Path $root ('artifacts\runtime\cubase-empty-launch-24-'+$script:startupRunId+'.json');$deadline=[DateTime]::UtcNow.AddSeconds(50)
    while(-not(Test-Path -LiteralPath $receiptPath)){
        if(-not(Get-Process -Id $starting.hostPid -ErrorAction SilentlyContinue)){
            $diagnostic=[IO.File]::ReadAllText($starting.stderrFile)
            throw ('Owned holder exited before launch receipt: '+$diagnostic)
        }
        if([DateTime]::UtcNow -ge $deadline){throw 'Owned launch receipt is pending.'}
        Start-Sleep -Milliseconds 200
    }
    $receipt=Get-Content -LiteralPath $receiptPath -Raw -Encoding UTF8|ConvertFrom-Json
    if($receipt.RunId -cne $script:startupRunId -or $receipt.mode -cne 'empty' -or $null -ne $receipt.Project -or $receipt.Desktop -cne 'winsta0\CubaseAI_MCP'){throw 'Owned launch receipt mismatch.'}
    Write-AtomicJson (Join-Path $root 'artifacts\runtime\cubase-launch.json') $receipt
    $owned=Owned-Process;$tf=$owned.creation;$hf=$owned.holderCreation;$target=$owned.target;$holder=$owned.holder
    $mapping=@{'134387281655745512'=[string]$tf;'134387281647304009'=[string]$hf;'72128'=[string]$target.Id;'55324'=[string]$holder.Id;'Split-Path -Parent $PSScriptRoot'="'"+$root+"'"}
    $pattern=($mapping.Keys|Sort-Object Length -Descending|ForEach-Object {[regex]::Escape($_)})-join '|'
    $preflight=[IO.File]::ReadAllText((Join-Path $root 'scripts\Read-FirstProjectState24.ps1'))
    $preflight=[regex]::Replace($preflight,$pattern,[Text.RegularExpressions.MatchEvaluator]{param($m)[string]$mapping[$m.Value]})
    $preflightPath=Join-Path $directory ('Read-EmptyState-'+$startupAttempt+'.ps1');[IO.File]::WriteAllText($preflightPath,$preflight,[Text.UTF8Encoding]::new($false))
    $stage='empty-readiness';$deadline=[DateTime]::UtcNow.AddSeconds(50);$ready=$false
    while([DateTime]::UtcNow -lt $deadline){
        $sample=& $ps -NoProfile -NonInteractive -File $preflightPath;$state=($sample -join [Environment]::NewLine)|ConvertFrom-Json
        if($LASTEXITCODE -eq 0 -and $state.readyForFirstOpen){$ready=$true;break}
        if($state.status -eq 'observed' -or [string]$state.error -notmatch 'informer vtable mismatch|project vtable mismatch|snapshot changed|ReadProcessMemory'){throw 'Empty preflight rejected the state.'}
        Start-Sleep -Milliseconds 500
    }
    if($ready){
        if($startupRecovery.Count){
            $startupRecovery[-1].state='ready_after_restart'
            $startupRecovery[-1].newPid=$target.Id
            $startupRecovery[-1].newCreation=[string]$tf
            Write-AtomicJson (Join-Path $directory 'startup-recovery.json') $startupRecovery
        }
        break
    }
    if($startupAttempt -eq 1){throw 'Empty readiness is pending after startup recovery; creation was not submitted.'}
    $sample=& $ps -NoProfile -NonInteractive -File (Join-Path $root 'scripts\Read-OwnedDesktopWindows.ps1') -VisibleOnly
    $windows=($sample -join [Environment]::NewLine)|ConvertFrom-Json
    Recover-LicenseStartup (Owned-Process) $windows
    }
    }
    [IO.File]::Copy((Join-Path $root 'artifacts\native-runtime\CubaseProjectCreate.dll'),(Join-Path $directory 'CubaseProjectCreate.dll'),$false)
    if($mode -eq 5){
        $f=[IO.File]::Open((Join-Path $directory 'audio-export.bin'),[IO.FileMode]::CreateNew);$writer=[IO.BinaryWriter]::new($f)
        try{$writer.Write([uint32]1);$writer.Write([uint32]$operation.sampleRate);$writer.Write([uint32]$operation.bitDepth);$writer.Write([uint32][int][bool]$operation.floatingPoint);$writer.Flush();$f.Flush($true)}finally{$writer.Dispose()}
    }
    if($mode -eq 7){
        $f=[IO.File]::Open((Join-Path $directory 'model-options.bin'),[IO.FileMode]::CreateNew);$writer=[IO.BinaryWriter]::new($f)
        try{$writer.Write([uint32]1);$writer.Write([uint32]$operation.offset);$writer.Write([uint32]$operation.limit);$writer.Write([uint32]0);$writer.Flush();$f.Flush($true)}finally{$writer.Dispose()}
    }
    if($mode -eq 8){
        $f=[IO.File]::Open((Join-Path $directory 'event-edit.bin'),[IO.FileMode]::CreateNew);$writer=[IO.BinaryWriter]::new($f)
        try{
            $writer.Write([uint32]2);$writer.Write([uint32]$(switch($operation.field){'position'{1}'duration'{2}'pitch'{3}'velocity'{4}}));$writer.Write([uint32]$operation.path.Count);$writer.Write([uint32]0)
            $writer.Write([uint64]::Parse($operation.root.Substring(2),[Globalization.NumberStyles]::HexNumber))
            for($i=0;$i -lt 8;$i++){$writer.Write([uint32]$(if($i -lt $operation.path.Count){$operation.path[$i]}else{0}))}
            $writer.Write([double]$operation.expected.startSeconds);$writer.Write([double]$operation.expected.durationSeconds);$writer.Write([double]$operation.seconds)
            $name=New-Object byte[] 512;$text=[Text.Encoding]::Unicode.GetBytes([string]$operation.expected.name);[Array]::Copy($text,$name,$text.Length);$writer.Write($name)
            $kind=New-Object byte[] 32;$text=[Text.Encoding]::ASCII.GetBytes([string]$operation.expected.type);[Array]::Copy($text,$kind,$text.Length);$writer.Write($kind)
            $isNote=$operation.expected.type -ceq 'MMidiNote'
            $writer.Write([uint64]$(if($isNote){[uint64]::Parse($operation.eventId.Substring(2),[Globalization.NumberStyles]::HexNumber)}else{0}))
            foreach($field in @('pitch','velocity','channel')){$writer.Write([uint32]$(if($isNote){$operation.expected.$field}else{0}))}
            $writer.Write([uint32]0);$writer.Write([double]$(if($isNote){$operation.expected.velocityNormalized}else{0}))
            $writer.Flush();$f.Flush($true)
        }finally{$writer.Dispose()}
    }
    if($mode -eq 9){
        $f=[IO.File]::Open((Join-Path $directory 'track-create.bin'),[IO.FileMode]::CreateNew);$writer=[IO.BinaryWriter]::new($f)
        try{
            $writer.Write([uint32]1);$writer.Write([uint32]$(switch($operation.kind){'midi'{1}'group'{2}'instrument'{3}'folder'{4}'fx'{6}}))
            $writer.Write([uint64]::Parse($operation.root.Substring(2),[Globalization.NumberStyles]::HexNumber))
            $name=New-Object byte[] 512;$text=[Text.Encoding]::Unicode.GetBytes($operation.name);[Array]::Copy($text,$name,$text.Length);$writer.Write($name)
            $writer.Flush();$f.Flush($true)
        }finally{$writer.Dispose()}
    }
    if($mode -eq 10){
        $f=[IO.File]::Open((Join-Path $directory 'plugin-unload.bin'),[IO.FileMode]::CreateNew);$writer=[IO.BinaryWriter]::new($f)
        try{
            $writer.Write([uint32]1);$writer.Write([uint32]0)
            $writer.Write([uint64]::Parse($operation.root.Substring(2),[Globalization.NumberStyles]::HexNumber));$writer.Write([int64]$operation.objectId)
            $writer.Flush();$f.Flush($true)
        }finally{$writer.Dispose()}
    }
    if($mode -eq 11){
        $f=[IO.File]::Open((Join-Path $directory 'routing.bin'),[IO.FileMode]::CreateNew);$writer=[IO.BinaryWriter]::new($f)
        try{
            $writer.Write([uint32]2);$writer.Write([uint32][int][bool]$routeWrite)
            $writer.Write([uint64]::Parse($operation.root.Substring(2),[Globalization.NumberStyles]::HexNumber));$writer.Write([int64]$operation.objectId)
            $writer.Write([uint32]$operation.tag);$writer.Write([uint32]0)
            $writer.Write([int32]$(if($routeWrite){$operation.expectedValue}else{0}));$writer.Write([int32]$(if($routeWrite){$operation.targetId}else{0}))
            $name=New-Object byte[] 512
            if($routeWrite){$text=[Text.Encoding]::Unicode.GetBytes($operation.targetName);[Array]::Copy($text,$name,$text.Length)}
            $writer.Write($name);$writer.Flush();$f.Flush($true)
        }finally{$writer.Dispose()}
    }
    if($mode -eq 12){
        $automationModes=@{read=0;setValue=1;move=2;insert=3;delete=4;createLane=5}
        $automationAction=if($operation.automationAction){[string]$operation.automationAction}else{'read'}
        if(-not $automationModes.ContainsKey($automationAction)){throw 'Invalid automation action.'}
        $automationMode=$automationModes[$automationAction]
        if($automationMode -in @(1,2,3,4) -and ($operation.laneEventId -notmatch '^0x[0-9a-fA-F]{1,16}$' -or
            [uint32]$operation.parameterTag -eq 0 -or $null -eq $operation.expectedPointCount)){throw 'Missing automation point identity or expected state.'}
        if($automationMode -eq 5 -and ([uint32]$operation.parameterTag -eq 0 -or [uint32]$operation.objectId -eq 0 -or $null -eq $operation.expectedPointCount)){throw 'Missing automation lane identity or expected count.'}
        if($automationMode -in @(1,2,4) -and ($operation.pointEventId -notmatch '^0x[0-9a-fA-F]{1,16}$' -or
            $null -eq $operation.expectedStartSeconds -or $null -eq $operation.expectedNormalizedValue)){throw 'Missing expected automation point.'}
        if($automationMode -in @(1,2,3) -and $null -eq $operation.value){throw 'Missing automation point value.'}
        if($automationMode -eq 3 -and $null -eq $operation.positionSeconds){throw 'Missing automation point position.'}
        $lane=if($operation.laneEventId){[uint64]::Parse($operation.laneEventId.Substring(2),[Globalization.NumberStyles]::HexNumber)}else{[uint64]0}
        $point=if($operation.pointEventId){[uint64]::Parse($operation.pointEventId.Substring(2),[Globalization.NumberStyles]::HexNumber)}else{[uint64]0}
        $offset=if($null -ne $operation.offset){[uint32]$operation.offset}else{[uint32]0}
        $limit=if($null -ne $operation.limit){[uint32]$operation.limit}else{[uint32]128}
        $f=[IO.File]::Open((Join-Path $directory 'automation.bin'),[IO.FileMode]::CreateNew);$writer=[IO.BinaryWriter]::new($f)
        try{
            $writer.Write([uint32]2);$writer.Write([uint32]$automationMode)
            $writer.Write([uint64]::Parse($operation.root.Substring(2),[Globalization.NumberStyles]::HexNumber))
            $writer.Write([uint64]::Parse($operation.trackEventId.Substring(2),[Globalization.NumberStyles]::HexNumber))
            $writer.Write($lane);$writer.Write($point)
            $writer.Write([uint32]$operation.parameterTag);$writer.Write([uint32]$operation.expectedPointCount)
            $writer.Write([double]$operation.expectedStartSeconds);$writer.Write([double]$operation.expectedNormalizedValue)
            $writer.Write([double]$operation.positionSeconds);$writer.Write([double]$operation.value)
            $writer.Write($offset);$writer.Write($limit);$writer.Write([uint32]$operation.objectId);$writer.Write([uint32]0)
            $writer.Flush();$f.Flush($true)
        }finally{$writer.Dispose()}
    }
    $nativeSeconds=if($mode -eq 5){[math]::Ceiling($operation.timeoutMs / 1000.0)+40}else{40}
    $f=[IO.File]::Open((Join-Path $directory 'request.bin'),[IO.FileMode]::CreateNew);$writer=[IO.BinaryWriter]::new($f)
    try{$writer.Write([uint32]3);$writer.Write([uint32]$target.Id);$writer.Write([uint64]$tf);$writer.Write([uint32]$holder.Id);$writer.Write([uint32]$mode);$writer.Write([uint64]$hf);$writer.Write([uint64][DateTime]::UtcNow.AddSeconds($nativeSeconds).ToFileTimeUtc());$writer.Write([uint64][DateTime]::UtcNow.Ticks);foreach($path in @($project,$expected)){$buffer=New-Object byte[] 1024;$text=[Text.Encoding]::Unicode.GetBytes($path);[Array]::Copy($text,$buffer,$text.Length);$writer.Write($buffer)};$writer.Flush();$f.Flush($true)}finally{$writer.Dispose()}
    $admission=Join-Path $root ("artifacts\runtime\project-operation-$mode-$($target.Id)-$tf-$($operation.id).json")
    $f=[IO.File]::Open($admission,[IO.FileMode]::CreateNew);try{$bytes=[Text.Encoding]::UTF8.GetBytes((@{request=$operation.id;status='consumed'}|ConvertTo-Json -Compress));$f.Write($bytes,0,$bytes.Length);$f.Flush($true)}finally{$f.Dispose()}
    $stage='native-project-operation';$execution='unknown';$loaded=[CubaseAiMcp.ProjectCreateLoader]::LoadAndStart($target.Id,$tf,$holder.Id,$hf,(Join-Path $directory 'CubaseProjectCreate.dll'))
    Write-AtomicJson (Join-Path $directory 'loader-result.json') $loaded
    if($loaded.Error -or -not $loaded.EntryCompleted -or $loaded.EntryReturnCode -ne 0){throw 'Native entry did not complete admission.'}
    $resultPath=Join-Path $directory 'create-result.json';$deadline=[DateTime]::UtcNow.AddSeconds($nativeSeconds-10)
    while(-not(Test-Path -LiteralPath $resultPath)){if($target.HasExited -or [DateTime]::UtcNow -ge $deadline){throw 'Native creation outcome is pending.'};Start-Sleep -Milliseconds 200}
    $native=Get-Content -LiteralPath $resultPath -Raw -Encoding UTF8|ConvertFrom-Json
    if($native.pid -ne $target.Id -or -not $native.succeeded -or -not $native.operationReturned -or ($mode -in @(1,3) -and (-not $native.saveReturned -or $native.saveValue -ne 1)) -or ($mode -in @(4,6) -and (-not $native.importReturned -or $native.importValue -ne 1)) -or $native.exception -ne 0){if($mode -ge 3 -and -not $native.operationStarted){$execution='not_started'};throw 'Native project operation did not establish its postcondition.'}
    if($mode -eq 5){
        if(-not $native.exportReturned){throw 'The native audio renderer did not return.'}
        $file=Get-Item -LiteralPath $project
        if($file.Length -le 44 -or $file.PSIsContainer -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'The requested export file was not observed.'}
        @{ok=$true;action=$operation.action;running=$true;owned=$true;outputPath=$project;projectPath=$expected;bytes=$file.Length;native=$native;artifacts=$directory}|ConvertTo-Json -Depth 6 -Compress
        return
    }
    if($mode -eq 6){
        @{ok=$true;action=$operation.action;running=$true;owned=$true;audioPath=$project;projectPath=$expected;native=$native;artifacts=$directory}|ConvertTo-Json -Depth 6 -Compress
        return
    }
    if($mode -in @(7,8,9,10,11,12)){
        $modelPath=Join-Path $directory 'model.json';$modelFile=Get-Item -LiteralPath $modelPath
        if($modelFile.Length -gt 1MB -or ($modelFile.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Invalid native model result.'}
        $model=Get-Content -LiteralPath $modelPath -Raw -Encoding UTF8|ConvertFrom-Json
        @{ok=$true;action=$operation.action;projectPath=$expected;model=$model;native=$native;artifacts=$directory}|ConvertTo-Json -Depth 12 -Compress
        return
    }
    if($mode -eq 4){
        # The project stays the managed document; only the in-memory project changed. No MIDI handshake is involved.
        @{ok=$true;action=$operation.action;running=$true;owned=$true;midiPath=$project;projectPath=$expected;native=$native;artifacts=$directory}|ConvertTo-Json -Depth 6 -Compress
        return
    }
    $file=Get-Item -LiteralPath $project
    if($file.Length -lt 12 -or $file.PSIsContainer){throw 'Created CPR is absent or incomplete.'}
    $managed=@{pid=$target.Id;creation=[string]$tf;projectPath=$project;bytes=$file.Length;native=$native;state=($operation.action+'_observed')}
    Write-AtomicJson (Join-Path $root 'artifacts\runtime\managed-project.json') $managed
    # Native construction can return before MIDI Remote has activated its page.
    # Observe readiness without sending or retrying any MIDI request.
    # The expected construction record follows the bridge revision declared by the repository controller.
    if([IO.File]::ReadAllText((Join-Path $root 'remote\controller.js')) -notmatch "var BRIDGE_REVISION = '([0-9a-z.\-]+)';"){throw 'The controller bridge revision is not declared.'}
    $constructedLine='[CubaseAI MCP] controller constructed '+$Matches[1]
    $stage='mapping-readiness';$deadline=[DateTime]::UtcNow.AddSeconds(35);$mappingReady=$false
    while([DateTime]::UtcNow -lt $deadline -and -not $target.HasExited){
        $console=& $ps -NoProfile -NonInteractive -File (Join-Path $root 'scripts\Read-MidiScriptErrors.ps1') -TargetProcessId $target.Id
        $view=($console -join [Environment]::NewLine)|ConvertFrom-Json
        if($view.status -eq 'observed' -and $view.matchFound){
            $constructed=$false;$active=-1;$deactivated=-1;$idle=-1
            foreach($entry in $view.messages){
                if($entry.text -ceq $constructedLine){$constructed=$true}
                if($entry.text -eq '[CubaseAI MCP] mapping activated'){$active=[int]$entry.index}
                if($entry.text -in @('[CubaseAI MCP] mapping deactivated','[CubaseAI MCP] device deactivated')){$deactivated=[int]$entry.index}
                if($entry.text -eq '[CubaseAI MCP] first idle: matching device=true, mapping=true'){$idle=[int]$entry.index}
            }
            if($constructed -and $active -gt $deactivated -and $idle -gt $active){$mappingReady=$true;Write-AtomicJson (Join-Path $directory 'mapping-ready.json') $view;break}
        }
        Start-Sleep -Milliseconds 250
    }
    if(-not $mappingReady){throw 'Created project is retained; MIDI mapping readiness was not observed. No handshake was sent.'}
    @{ok=$true;action=$operation.action;running=$true;owned=$true;managedProject=$managed;startupRecovery=@($startupRecovery);artifacts=$directory}|ConvertTo-Json -Depth 6 -Compress
} catch {
    $failure=@{ok=$false;code='LIFECYCLE_FAILED';message=$_.Exception.Message;stage=$stage;execution=$execution;artifacts=$directory;native=$native;startupRecovery=@($startupRecovery)}
    if($directory){try{Write-AtomicJson (Join-Path $directory 'operation-error.json') $failure}catch{}}
    $failure|ConvertTo-Json -Depth 8 -Compress
    exit 1
} finally {if($locked){$mutex.ReleaseMutex()};if($mutex){$mutex.Dispose()}}
