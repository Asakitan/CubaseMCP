[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{32}$')][string]$RunId,
    [Parameter(Mandatory=$true)][ValidateSet('default','jump')][string]$Mode
)
$ErrorActionPreference='Stop'
$Mode=$Mode.ToLowerInvariant()
$Root=[IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot)).TrimEnd('\')
if($Root -ine 'E:\VC\CubaseMCP'){throw 'Unexpected fixed diagnostic workspace.'}
$Ipc=Join-Path $Root 'artifacts\ipc';$Runtime=Join-Path $Root 'artifacts\runtime';$Smoke=Join-Path $Root 'artifacts\live-smoke'
foreach($path in @($Root,(Join-Path $Root 'artifacts'),$Ipc,$Runtime,$Smoke)){
    $attr=[IO.File]::GetAttributes($path)
    if(($attr -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or ($attr -band [IO.FileAttributes]::Directory) -eq 0){throw 'Fixed diagnostic directory mismatch.'}
}
$armPath=Join-Path $Ipc "midi-startup-empty-arm-$RunId.json"
$receiptPath=Join-Path $Runtime 'cubase-launch.json'
$planPath=Join-Path $Ipc "binding26-plan-$RunId.json"
$source=Join-Path $Smoke 'MCP Device Test 20261110.cpr'
$name=if($Mode -ceq 'default'){'Binding26Default.cpr'}else{'Binding26Jump.cpr'}
$fixture=Join-Path $Smoke $name
foreach($path in @($armPath,$receiptPath,$source,$fixture)){
    $attr=[IO.File]::GetAttributes($path)
    if(($attr -band ([IO.FileAttributes]::ReparsePoint -bor [IO.FileAttributes]::Directory)) -ne 0){throw 'Fixed diagnostic input is not a regular file.'}
}
if(Test-Path -LiteralPath $planPath){throw 'A plan already exists for this run.'}
$arm=Get-Content -LiteralPath $armPath -Raw -Encoding UTF8|ConvertFrom-Json
$receipt=Get-Content -LiteralPath $receiptPath -Raw -Encoding UTF8|ConvertFrom-Json
if($arm.status -cne 'ready' -or $arm.runId -cne $RunId -or $arm.mode -cne 'empty' -or
   $null -eq $arm.PSObject.Properties['project'] -or $null -ne $arm.project -or
   $receipt.mode -cne 'empty' -or $null -eq $receipt.PSObject.Properties['Project'] -or $null -ne $receipt.Project -or
   $receipt.Desktop -cne 'winsta0\CubaseAI_MCP' -or -not $receipt.desktopSwitchRestricted -or -not $receipt.jobKillsOnLastHandleClose -or
   [int]$arm.previousPid -ne [int]$receipt.ProcessId -or [string]$arm.previousCreationFiletime -cne [string]$receipt.processCreationFiletime){throw 'Trace arm and previous launch receipt mismatch.'}
$target=Get-Process -Id ([int]$receipt.ProcessId);$holder=Get-Process -Id ([int]$receipt.HostPid);$trace=Get-Process -Id ([int]$arm.tracePid)
try {
    if($target.Handle -eq [IntPtr]::Zero -or $holder.Handle -eq [IntPtr]::Zero -or $trace.Handle -eq [IntPtr]::Zero){throw 'A process handle is unavailable.'}
    $targetFt=$target.StartTime.ToUniversalTime().ToFileTimeUtc().ToString()
    $holderFt=$holder.StartTime.ToUniversalTime().ToFileTimeUtc().ToString()
    $traceFt=$trace.StartTime.ToUniversalTime().ToFileTimeUtc().ToString()
    if($targetFt -cne [string]$receipt.processCreationFiletime -or $holderFt -cne [string]$receipt.holderCreationFiletime){throw 'Previous target or holder lifetime mismatch.'}
    $armTime=if($arm.armUtc -is [DateTime]){$arm.armUtc.ToUniversalTime()}else{[DateTime]::Parse([string]$arm.armUtc,[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime()}
    if($trace.StartTime.ToUniversalTime() -gt $armTime -or $target.StartTime.ToUniversalTime() -ge $armTime -or $holder.StartTime.ToUniversalTime() -ge $armTime){throw 'Trace or previous process time does not precede arming.'}
    $all=@(Get-Process -Name 'Cubase*' -ErrorAction SilentlyContinue)
    if($all.Count -ne 1 -or $all[0].Id -ne $target.Id -or $target.Path -ine 'C:\Program Files\Steinberg\Cubase 16\Cubase 16.exe'){throw 'Previous target ownership mismatch.'}
    $left=[IO.File]::Open($source,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
    try {
        $right=[IO.File]::Open($fixture,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
        try {
            if($left.Length -ne 93085 -or $right.Length -ne $left.Length){throw 'Fixed fixture size mismatch.'}
            $a=[byte[]]::new(65536);$b=[byte[]]::new(65536);[long]$compared=0
            do {
                $n=$left.Read($a,0,$a.Length);$got=0
                while($got -lt $n){$read=$right.Read($b,$got,$n-$got);if($read -le 0){throw 'Fixture ended during comparison.'};$got+=$read}
                for($i=0;$i -lt $n;$i++){if($a[$i] -ne $b[$i]){throw 'Fixture differs from the fixed source.'}}
                $compared+=$n
            } while($n -gt 0)
            if($compared -ne 93085 -or $right.ReadByte() -ne -1){throw 'Fixture comparison length mismatch.'}
            if($target.HasExited -or $holder.HasExited -or $trace.HasExited){throw 'A tracked process exited during preparation.'}
            $plan=[ordered]@{version=1;runId=$RunId;mode=$Mode;fixture=$name;
                previousPid=$target.Id;previousCreationFiletime=$targetFt;previousHolderPid=$holder.Id;previousHolderCreationFiletime=$holderFt;
                tracePid=$trace.Id;traceCreationFiletime=$traceFt;armUtc=$armTime.ToString('o');createdUtc=[DateTime]::UtcNow.ToString('o');
                limitation='Preparation only; no new launch, actual Job audit, observer or host call is admitted.'}
            $temp=$planPath+'.tmp-'+$PID
            $file=[IO.File]::Open($temp,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
            try {$bytes=[Text.UTF8Encoding]::new($false).GetBytes(($plan|ConvertTo-Json));$file.Write($bytes,0,$bytes.Length);$file.Flush($true)}finally{$file.Dispose()}
            [IO.File]::Move($temp,$planPath)
        } finally {$right.Dispose()}
    } finally {$left.Dispose()}
    [ordered]@{status='prepared_not_admitted';plan=$planPath;runId=$RunId;mode=$Mode;fixture=$fixture;
        previousPid=$target.Id;tracePid=$trace.Id;limitation='Plan preparation does not launch Cubase or admit a host operation.'}|ConvertTo-Json
} finally {$target.Dispose();$holder.Dispose();$trace.Dispose()}
