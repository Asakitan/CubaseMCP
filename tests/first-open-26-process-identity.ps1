$ErrorActionPreference='Stop'
Add-Type -Path (Join-Path $PSScriptRoot '..\native\FirstOpen26ProcessIdentity.cs')
$p=Get-Process -Id $PID
try {
 $t=$p.StartTime.ToUniversalTime().ToFileTimeUtc();$r=[CubaseAiMcp.FirstOpen26ProcessIdentity]::Read($p.Handle,$p.Id,$t)
 if($r.ProcessId -ne $PID -or $r.ParentProcessId -le 0 -or !$r.CommandLine){throw 'Current-process result invalid.'}
 $rejected=$false;try{[CubaseAiMcp.FirstOpen26ProcessIdentity]::Read($p.Handle,$p.Id,($t+1))|Out-Null}catch{$rejected=$true};if(!$rejected){throw 'Wrong lifetime accepted.'}
} finally {$p.Dispose()}
$start=[Diagnostics.ProcessStartInfo]::new()
$start.FileName=(Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe')
$start.Arguments='-NoProfile -NonInteractive -Command "Start-Sleep -Seconds 20"'
$start.UseShellExecute=$false
$start.CreateNoWindow=$true
$child=[Diagnostics.Process]::Start($start)
try {
 $childTime=$child.StartTime.ToUniversalTime().ToFileTimeUtc()
 $childResult=[CubaseAiMcp.FirstOpen26ProcessIdentity]::Read($child.Handle,$child.Id,$childTime)
 if ($childResult.ProcessId -ne $child.Id -or $childResult.ParentProcessId -ne $PID -or
     $childResult.CommandLine -notlike '*Start-Sleep -Seconds 20*') {throw 'Child-process parent or command line mismatch.'}
} finally {
 if (-not $child.HasExited) {$child.Kill();$child.WaitForExit()}
 $child.Dispose()
}
'FirstOpen26 process identity tests passed.'
