param([ValidateRange(5,120)][int]$DurationSeconds=30,[ValidateRange(100,1000)][int]$IntervalMs=200,
 [ValidatePattern('^[a-f0-9]{32}$')][string]$RunId=([guid]::NewGuid().ToString('N')))
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot; $dir=Join-Path $root 'artifacts\ipc'; [void][IO.Directory]::CreateDirectory($dir)
$id=$RunId; $ready=Join-Path $dir "first-project-open24-observer-72128-$id.ready.json"; $output=Join-Path $dir "first-project-open24-observer-72128-$id.json"
$result=[ordered]@{id=$id;pid=72128;observerPid=$PID;status='error';error=$null;readyPath=$ready;outputPath=$output;startedUtc=$null;finishedUtc=$null;backgroundViolation=$false;samples=@();limitations='Polling only; brief events may be missed. GetForegroundWindow is a calling-desktop API view, not guaranteed global cross-desktop history. Enumeration is non-atomic. No hooks or input.'}
function Save-New($path,$data) { $s=[IO.File]::Open($path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read); try {$w=[IO.StreamWriter]::new($s,[Text.UTF8Encoding]::new($false)); try {$w.Write(($data|ConvertTo-Json -Depth 8));$w.Flush();$s.Flush($true)} finally {$w.Dispose()}} finally {$s.Dispose()} }
try {
 $launch=Join-Path $root 'artifacts\runtime\cubase-empty-launch-24-e6ef5f706a6f436896265a73a0ba82a3.json'; $receipt=Get-Content -Raw -Encoding UTF8 $launch|ConvertFrom-Json
 if($receipt.mode -cne 'empty' -or $null -ne $receipt.Project -or $receipt.processCreationFiletime -cne '134387281655745512' -or $receipt.HostPid -ne 55324 -or $receipt.holderCreationFiletime -cne '134387281647304009' -or $receipt.ProcessId -ne 72128 -or $receipt.Desktop -ne 'winsta0\CubaseAI_MCP' -or !$receipt.DesktopSwitchRestricted -or !$receipt.JobKillsOnLastHandleClose){throw 'Receipt mismatch'}
 $holder=Get-Process -Id 55324; if($holder.StartTime.ToUniversalTime().ToFileTimeUtc().ToString() -cne '134387281647304009'){throw 'Holder identity mismatch'}
 $p=Get-Process -Id 72128; $start=$p.StartTime.ToUniversalTime(); if($start.ToString('o') -ne ([DateTime]::FromFileTimeUtc(134387281655745512).ToString('o')) -or $start -gt (Get-Item $launch).LastWriteTimeUtc.AddSeconds(2)){throw 'Process start mismatch'}
 $path=$p.MainModule.FileName; if($path -ne 'C:\Program Files\Steinberg\Cubase 16\Cubase 16.exe' -or (Get-Item $path).VersionInfo.FileVersion -ne '16.0.5.174' -or $p.MainModule.BaseAddress.ToInt64() -ne 0x140000000){throw 'Executable profile mismatch'}
 $s=[IO.File]::OpenRead($path); try {$r=[IO.BinaryReader]::new($s);$s.Position=0x3c;$off=$r.ReadUInt32();$s.Position=$off;if($r.ReadUInt32() -ne 0x4550 -or $r.ReadUInt16() -ne 0x8664){throw 'PE mismatch'};$s.Position=$off+8;if($r.ReadUInt32() -ne 0x6adf121b){throw 'PE timestamp mismatch'}} finally {$s.Dispose()}
 Add-Type -Path (Join-Path $root 'native\CubaseDesktop.cs')
 Add-Type 'using System; using System.Runtime.InteropServices; public static class ForegroundFirst24 { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid); }'
 $method=[CubaseAiMcp.CubaseDesktop].GetMethod('InputDesktopName',[Reflection.BindingFlags]'NonPublic,Static')
 $windows=@([CubaseAiMcp.CubaseDesktop]::Inspect('CubaseAI_MCP')|Where-Object {$_.ProcessId -eq 72128}); if(!$windows.Count){throw 'Private desktop ownership absent'}
 if((Get-Process -Id 72128).StartTime.ToUniversalTime() -ne $start){throw 'Target changed'}
 $samples=[Collections.Generic.List[object]]::new();$clock=[Diagnostics.Stopwatch]::StartNew();$result.startedUtc=[DateTime]::UtcNow.ToString('o')
 function Sample { $name=$method.Invoke($null,@());$hwnd=[ForegroundFirst24]::GetForegroundWindow();[uint32]$pidValue=0;if($hwnd -ne [IntPtr]::Zero){[void][ForegroundFirst24]::GetWindowThreadProcessId($hwnd,[ref]$pidValue)};$ws=@([CubaseAiMcp.CubaseDesktop]::Inspect('CubaseAI_MCP')|Where-Object {$_.ProcessId -eq 72128});if($name -ieq 'CubaseAI_MCP' -or $pidValue -eq 72128){$result.backgroundViolation=$true};$samples.Add([ordered]@{timestampUtc=[DateTime]::UtcNow.ToString('o');elapsedMs=$clock.ElapsedMilliseconds;inputDesktop=$name;foregroundHwnd=('0x'+$hwnd.ToInt64().ToString('x'));foregroundPid=$pidValue;windows=$ws}) }
 Sample
 if($result.backgroundViolation){throw 'The isolated target desktop is the input desktop.'}
 $first=$samples[0]; $temp="$ready.tmp"; Save-New $temp ([ordered]@{id=$id;pid=72128;observerPid=$PID;observerStartUtc=(Get-Process -Id $PID).StartTime.ToUniversalTime().ToString('o');processStartUtc=$start.ToString('o');startedUtc=$result.startedUtc;readyUtc=[DateTime]::UtcNow.ToString('o');durationSeconds=$DurationSeconds;intervalMs=$IntervalMs;inputDesktop=$first.inputDesktop;foregroundHwnd=$first.foregroundHwnd;foregroundPid=$first.foregroundPid;outputPath=$output});[IO.File]::Move($temp,$ready);Write-Output $ready
 while($clock.ElapsedMilliseconds -lt $DurationSeconds*1000){Start-Sleep -Milliseconds $IntervalMs;if($clock.ElapsedMilliseconds -ge $DurationSeconds*1000){break};if((Get-Process -Id 72128).StartTime.ToUniversalTime() -ne $start -or (Get-Process -Id 55324).StartTime.ToUniversalTime().ToFileTimeUtc().ToString() -cne '134387281647304009'){throw 'Target or holder changed'};Sample}
 $result.status='observed'
} catch {$result.error=$_.Exception.Message} finally {if($null -ne $samples){$result.samples=$samples.ToArray()};$result.finishedUtc=[DateTime]::UtcNow.ToString('o');Save-New $output $result}
if($result.status -ne 'observed'){exit 1}
