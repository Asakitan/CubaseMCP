Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
function ConvertTo-FirstOpen26Utc([object]$Value) {
 if ($Value -is [DateTime]) { return $Value.ToUniversalTime() }
 return [DateTime]::Parse([string]$Value,[Globalization.CultureInfo]::InvariantCulture,
     [Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime()
}
function Test-FirstOpen26Plan {
 [CmdletBinding()]
 param([Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{32}$')][string]$RunId,
       [Parameter(Mandatory)][ValidateSet('default','jump')][string]$Mode)
 $Mode=$Mode.ToLowerInvariant()
 $root='E:\VC\CubaseMCP'; $ipc=Join-Path $root 'artifacts\ipc'; $runtime=Join-Path $root 'artifacts\runtime'; $smoke=Join-Path $root 'artifacts\live-smoke'
 $name=if($Mode -ceq 'default'){'Binding26Default.cpr'}else{'Binding26Jump.cpr'}
 $paths=@($root,(Join-Path $root 'artifacts'),$ipc,$runtime,$smoke)
 foreach($p in $paths){if(([IO.File]::GetAttributes($p) -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Reparse point in fixed path.'}}
 $planPath=Join-Path $ipc "binding26-plan-$RunId.json"; $armPath=Join-Path $ipc "midi-startup-empty-arm-$RunId.json"; $receiptPath=Join-Path $runtime "cubase-empty-launch-24-$RunId.json"
 $source=Join-Path $smoke 'MCP Device Test 20261110.cpr'; $fixture=Join-Path $smoke $name
 foreach($p in @($planPath,$armPath,$receiptPath,$source,$fixture)) {
  $a=[IO.File]::GetAttributes($p); if(($a -band ([IO.FileAttributes]::Directory -bor [IO.FileAttributes]::ReparsePoint)) -ne 0){throw 'A required file is not regular.'}
 }
 $plan=Get-Content -LiteralPath $planPath -Raw -Encoding UTF8 | ConvertFrom-Json
 $arm=Get-Content -LiteralPath $armPath -Raw -Encoding UTF8 | ConvertFrom-Json
 $receipt=Get-Content -LiteralPath $receiptPath -Raw -Encoding UTF8 | ConvertFrom-Json
 if($plan.version -ne 1 -or $plan.runId -cne $RunId -or $plan.mode -cne $Mode -or $plan.fixture -cne $name -or
    $arm.status -cne 'ready' -or $arm.runId -cne $RunId -or $arm.mode -cne 'empty' -or $null -eq $arm.PSObject.Properties['project'] -or $null -ne $arm.project -or
    $receipt.status -cne 'process_created' -or $receipt.RunId -cne $RunId -or $receipt.mode -cne 'empty' -or $null -eq $receipt.PSObject.Properties['Project'] -or $null -ne $receipt.Project -or
    $receipt.Desktop -cne 'winsta0\CubaseAI_MCP' -or $receipt.desktopSwitchRestricted -ne $true -or $receipt.jobKillsOnLastHandleClose -ne $true) {throw 'Plan, arm or launch receipt mismatch.'}
 foreach($field in @('previousPid','previousCreationFiletime','tracePid')){if([string]$plan.$field -cne [string]$arm.$field){throw "Plan and arm disagree: $field"}}
 $armTime=ConvertTo-FirstOpen26Utc $arm.armUtc
 if ((ConvertTo-FirstOpen26Utc $plan.armUtc).ToFileTimeUtc() -ne $armTime.ToFileTimeUtc()) {throw 'Plan and arm disagree: armUtc'}
 foreach($field in @('previousPid','previousHolderPid','tracePid','previousCreationFiletime','previousHolderCreationFiletime','traceCreationFiletime')){if([string]$plan.$field -notmatch '^[0-9]+$' -or [long]$plan.$field -le 0){throw "Invalid plan field: $field"}}
 $targetId=[int]$receipt.ProcessId; $holderId=[int]$receipt.HostPid
 if($targetId -le 0 -or $holderId -le 0 -or $targetId -eq $holderId -or $targetId -eq [int]$plan.previousPid -or $holderId -eq [int]$plan.previousHolderPid){throw 'Invalid new identities.'}
 $target=Get-Process -Id $targetId; $holder=Get-Process -Id $holderId; $trace=Get-Process -Id ([int]$plan.tracePid)
 try {
  # Accessing Handle opens and retains the corresponding process objects until finally.
  if($target.Handle -eq [IntPtr]::Zero -or $holder.Handle -eq [IntPtr]::Zero -or $trace.Handle -eq [IntPtr]::Zero){throw 'Process handle unavailable.'}
  $targetTime=$target.StartTime.ToUniversalTime().ToFileTimeUtc(); $holderTime=$holder.StartTime.ToUniversalTime().ToFileTimeUtc()
  if([string]$targetTime -cne [string]$receipt.processCreationFiletime -or [string]$holderTime -cne [string]$receipt.holderCreationFiletime -or
     [string]$trace.StartTime.ToUniversalTime().ToFileTimeUtc() -cne [string]$plan.traceCreationFiletime){throw 'Process lifetime mismatch.'}
  if($targetTime -le $armTime.ToFileTimeUtc() -or $holderTime -le $armTime.ToFileTimeUtc() -or
     $trace.StartTime.ToUniversalTime().ToFileTimeUtc() -gt $armTime.ToFileTimeUtc() -or
     (Get-Item -LiteralPath $planPath).LastWriteTimeUtc -ge $target.StartTime.ToUniversalTime()){throw 'Plan or arm is not earlier than the new process.'}
  $all=@(Get-Process -Name 'Cubase*' -ErrorAction SilentlyContinue); if($all.Count -ne 1 -or $all[0].Id -ne $targetId){throw 'Expected one matching Cubase process.'}
  $expected='C:\Program Files\Steinberg\Cubase 16\Cubase 16.exe'; if(-not ('CubaseAiMcp.FirstOpen26ProcessIdentity' -as [type])) { Add-Type -Path (Join-Path $root 'native\FirstOpen26ProcessIdentity.cs') }; $identity=[CubaseAiMcp.FirstOpen26ProcessIdentity]::Read($target.Handle,$targetId,$targetTime)
  if([int]$identity.ParentProcessId -ne $holderId -or
     $target.MainModule.FileName -ine $expected -or (Get-Item -LiteralPath $expected).VersionInfo.FileVersion -cne '16.0.5.174' -or $target.MainModule.BaseAddress.ToInt64() -ne 0x140000000){throw 'Parent or executable profile mismatch.'}
  # Empty launch command line must contain only the executable and no project argument.
  if(([string]$identity.CommandLine).Trim() -notin @($expected,('"'+$expected+'"'))){throw 'Unexpected Cubase command line.'}
  $left=[IO.File]::Open($source,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
  try {
   $right=[IO.File]::Open($fixture,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
   try {
    if($left.Length -ne 93085 -or $right.Length -ne $left.Length){throw 'Fixture size mismatch.'}
    $a=[byte[]]::new(65536);$b=[byte[]]::new(65536);[long]$compared=0
    do {
     $n=$left.Read($a,0,$a.Length);$got=0
     while($got -lt $n){$read=$right.Read($b,$got,$n-$got);if($read -le 0){throw 'Fixture ended during comparison.'};$got+=$read}
     for($i=0;$i -lt $n;$i++){if($a[$i] -ne $b[$i]){throw 'Fixture differs from fixed source.'}}
     $compared+=$n
    } while($n -gt 0)
    if($compared -ne 93085 -or $right.ReadByte() -ne -1){throw 'Fixture comparison length mismatch.'}
   } finally {$right.Dispose()}
  } finally {$left.Dispose()}
  if(-not ('CubaseAiMcp.FirstOpen26JobAudit' -as [type])) { Add-Type -Path (Join-Path $root 'native\FirstOpen26JobAudit.cs') }
  $job=[CubaseAiMcp.FirstOpen26JobAudit]::Verify($target.Handle,$targetId,$targetTime,$holder.Handle,$holderId,$holderTime)
  if(-not $job.Verified -or $job.MatchingJobs -ne 1 -or $job.UiFlags -ne 64 -or $job.LimitFlags -ne 8192){throw 'Live restricted Job check failed.'}
  if($target.HasExited -or $holder.HasExited -or $trace.HasExited){throw 'Process exited during checks.'}
  [pscustomobject]@{status='not_admitted';runId=$RunId;mode=$Mode;targetPid=$targetId;targetFiletime=[string]$targetTime;holderPid=$holderId;holderFiletime=[string]$holderTime;fixture=$name;jobVerified=$true;jobUiFlags=$job.UiFlags;jobLimitFlags=$job.LimitFlags;reason='Desktop ownership, build fingerprint, fresh preflight and independent observer are not verified.'}
 } finally {$target.Dispose();$holder.Dispose();$trace.Dispose()}
}
Export-ModuleMember -Function Test-FirstOpen26Plan
