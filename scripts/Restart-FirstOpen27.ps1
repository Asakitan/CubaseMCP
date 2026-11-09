[CmdletBinding()]
param([Parameter(Mandatory)][switch]$ConfirmOwnedRestart,[ValidateSet('default','jump')][string]$Fixture='default')
$ErrorActionPreference='Stop'
if(-not $ConfirmOwnedRestart){throw 'Explicit owned-restart confirmation is required.'}
$Fixture=$Fixture.ToLowerInvariant()
$fixtureName=if($Fixture -ceq 'default'){'Binding26Default.cpr'}else{'Binding26Jump.cpr'}
$root='E:\VC\CubaseMCP'
if((Split-Path -Parent $PSScriptRoot) -ine $root){throw 'Unexpected workspace.'}
$receipt=Get-Content -LiteralPath (Join-Path $root 'artifacts\runtime\cubase-launch.json') -Raw -Encoding UTF8|ConvertFrom-Json
if($receipt.status -cne 'process_created' -or $receipt.mode -cne 'empty' -or $null -ne $receipt.Project -or
    $receipt.Desktop -cne 'winsta0\CubaseAI_MCP' -or -not $receipt.desktopSwitchRestricted -or -not $receipt.jobKillsOnLastHandleClose){throw 'Owned empty-launch receipt mismatch.'}
$targetId=[int]$receipt.ProcessId; $targetFt=[long]$receipt.processCreationFiletime
$holderId=[int]$receipt.HostPid; $holderFt=[long]$receipt.holderCreationFiletime
$target=Get-Process -Id $targetId; $holder=Get-Process -Id $holderId
try {
    [void]$target.Handle; [void]$holder.Handle
    $all=@(Get-Process -Name 'Cubase*' -ErrorAction SilentlyContinue)
    if($all.Count -ne 1 -or $all[0].Id -ne $targetId -or
        $target.StartTime.ToUniversalTime().ToFileTimeUtc() -ne $targetFt -or
        $holder.StartTime.ToUniversalTime().ToFileTimeUtc() -ne $holderFt -or
        $target.MainModule.FileName -ine 'C:\Program Files\Steinberg\Cubase 16\Cubase 16.exe') {throw 'Owned process identity mismatch.'}
    $targetStart=$target.StartTime.ToUniversalTime()
    Add-Type -Path @((Join-Path $root 'native\FirstOpen26ProcessIdentity.cs'),(Join-Path $root 'native\FirstOpen26JobAudit.cs'),(Join-Path $root 'native\CubaseDesktop.cs'))
    Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class Restart27ProcessExit {
    [DllImport("kernel32.dll",SetLastError=true)] public static extern bool GetExitCodeProcess(IntPtr process, out uint code);
}
'@
    $identity=[CubaseAiMcp.FirstOpen26ProcessIdentity]::Read($target.Handle,$targetId,$targetFt)
    if($identity.ParentProcessId -ne $holderId){throw 'Owned process parent mismatch.'}
    $job=[CubaseAiMcp.FirstOpen26JobAudit]::Verify($target.Handle,$targetId,$targetFt,$holder.Handle,$holderId,$holderFt)
    if(-not $job.Verified -or $job.MatchingJobs -ne 1 -or $job.UiFlags -ne 64 -or $job.LimitFlags -ne 8192){throw 'Owned restricted Job mismatch.'}
    $ports=Get-Process -Id 62944
    if($ports.StartTime.ToUniversalTime().ToFileTimeUtc() -ne 134387162562359970L){throw 'Production port-host identity mismatch.'}
    $doctor=& node.exe (Join-Path $root 'dist\src\doctor.js')
    if($LASTEXITCODE -ne 0 -or -not (($doctor -join [Environment]::NewLine)|ConvertFrom-Json).readyForHandshake){throw 'Production ports are not ready.'}
    $vc='C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat'
    if(-not (Test-Path -LiteralPath $vc -PathType Leaf)){throw 'MSVC build environment is missing.'}
    $method=[CubaseAiMcp.CubaseDesktop].GetMethod('InputDesktopName',[Reflection.BindingFlags]'NonPublic,Static')
    if($method.Invoke($null,@()) -ieq 'CubaseAI_MCP' -or
        -not @([CubaseAiMcp.CubaseDesktop]::Inspect('CubaseAI_MCP')|Where-Object {$_.ProcessId -eq $targetId}).Count){throw 'Private desktop state mismatch.'}
    $source=Join-Path $root 'artifacts\live-smoke\MCP Device Test 20261110.cpr'
    $fixturePath=Join-Path $root ('artifacts\live-smoke\'+$fixtureName)
    foreach($path in @($source,$fixturePath)){
        if(([IO.File]::GetAttributes($path) -band ([IO.FileAttributes]::ReparsePoint -bor [IO.FileAttributes]::Directory)) -ne 0){throw 'Fixture path mismatch.'}
    }
    $a=[IO.File]::ReadAllBytes($source); $b=[IO.File]::ReadAllBytes($fixturePath)
    if($a.Length -ne 93085 -or $b.Length -ne $a.Length){throw 'Fixture size mismatch.'}
    for($i=0;$i -lt $a.Length;$i++){if($a[$i] -ne $b[$i]){throw 'Fixture contents differ.'}}
    $run=[Guid]::NewGuid().ToString('N');$backup=Join-Path $root "artifacts\runtime\before-restart-27-$run"
    if(Test-Path -LiteralPath $backup){throw 'Backup directory already exists.'};[void][IO.Directory]::CreateDirectory($backup)
    $driver=Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Steinberg\Cubase\MIDI Remote\Driver Scripts\Local\CubaseAI\MCP'
    foreach($name in @('CubaseAI_MCP.js','controller.js','commands.js','protocol.js')){
        [IO.File]::Copy((Join-Path $driver $name),(Join-Path $backup $name),$false)
    }
    foreach($name in @('First Empty Probe 24.cpr','Binding26Default.cpr','Binding26Jump.cpr')){
        [IO.File]::Copy((Join-Path $root ('artifacts\live-smoke\'+$name)),(Join-Path $backup $name),$false)
    }
    [IO.File]::Copy((Join-Path $root 'artifacts\runtime\cubase-launch.json'),(Join-Path $backup 'cubase-launch.json'),$false)
    $admission=Join-Path $root "artifacts\runtime\restart-27-$targetId-$targetFt.json"
    $record=[ordered]@{runId=$run;targetPid=$targetId;targetCreationFiletime=[string]$targetFt;holderPid=$holderId;holderCreationFiletime=[string]$holderFt;backup=$backup;status='consumed';createdUtc=[DateTime]::UtcNow.ToString('o')}|ConvertTo-Json
    $file=[IO.File]::Open($admission,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
    try{$bytes=[Text.UTF8Encoding]::new($false).GetBytes($record);$file.Write($bytes,0,$bytes.Length);$file.Flush($true)}finally{$file.Dispose()}
    if($target.HasExited -or $holder.HasExited){throw 'Process exited after admission; no restart was repeated.'}
    $holder.Kill()
    if(-not $holder.WaitForExit(15000) -or -not $target.WaitForExit(15000)){throw 'Owned process exit not observed; no restart was repeated.'}
    if(Get-Process -Name 'Cubase*' -ErrorAction SilentlyContinue){throw 'Another Cubase process is present after owned exit.'}
    $marker=Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'Steinberg\Cubase 16_64\ApplicationStarted.txt'
    if(Test-Path -LiteralPath $marker){
        $item=Get-Item -LiteralPath $marker
        if($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $item.Length -ne 0 -or
            $item.LastWriteTimeUtc -lt $targetStart){throw 'Unexpected startup marker; preserved in place.'}
        Move-Item -LiteralPath $marker -Destination (Join-Path $backup 'ApplicationStarted.txt')
    }
    & (Join-Path $root 'scripts\Install-Remote.ps1') -Force | Out-Null
    $ps=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $output=Join-Path $backup 'first-open.stdout.log';$errors=Join-Path $backup 'first-open.stderr.log'
    $worker=Start-Process -FilePath $ps -ArgumentList @('-NoProfile','-NonInteractive','-File',(Join-Path $root 'scripts\Invoke-FirstOpen27.ps1'),'-ConfirmFirstOpen27','-Fixture',$Fixture) -WindowStyle Hidden -PassThru -RedirectStandardOutput $output -RedirectStandardError $errors
    $workerFt=$worker.StartTime.ToUniversalTime().ToFileTimeUtc().ToString()
    $workerHandle=$worker.Handle
    $done=$worker.WaitForExit(180000)
    $code=$null
    if($done){[uint32]$nativeCode=0;if(-not [Restart27ProcessExit]::GetExitCodeProcess($workerHandle,[ref]$nativeCode)){throw 'Worker exit-code query failed.'};$code=$nativeCode}
    $result=[ordered]@{runId=$run;admission=$admission;backup=$backup;workerPid=$worker.Id;workerCreationFiletime=$workerFt;workerExited=$done;exitCode=$code;stdout=$output;stderr=$errors;status=if($done -and $code -eq 0){'first_open_queued_completion_unknown'}elseif($done){'worker_failed'}else{'worker_running_unknown'}}
    $result|ConvertTo-Json
    if($done -and $code -ne 0){exit 1}
} finally {$target.Dispose();$holder.Dispose()}
