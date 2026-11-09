Set-StrictMode -Version Latest
function New-FirstOpen27Admission {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][Diagnostics.Process]$Target,
        [Parameter(Mandatory)][Diagnostics.Process]$Holder,
        [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{32}$')][string]$RunId
    )
    # The caller must retain both process objects and validate ownership, Job,
    # fixture, observer and fresh preflight before reaching this function.
    $root='E:\VC\CubaseMCP'
    $dir=Join-Path $root 'artifacts\first-open-27'
    foreach($p in @($root,(Join-Path $root 'artifacts'))) {
        if(([IO.File]::GetAttributes($p) -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Unexpected reparse point.'}
    }
    [void][IO.Directory]::CreateDirectory($dir)
    if(([IO.File]::GetAttributes($dir) -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Unexpected admission directory.'}
    if($Target.Handle -eq [IntPtr]::Zero -or $Holder.Handle -eq [IntPtr]::Zero -or $Target.HasExited -or $Holder.HasExited){throw 'Process handle unavailable.'}
    $targetFt=$Target.StartTime.ToUniversalTime().ToFileTimeUtc()
    $holderFt=$Holder.StartTime.ToUniversalTime().ToFileTimeUtc()
    if($targetFt -le 0 -or $holderFt -le 0 -or $Target.Id -eq $Holder.Id){throw 'Invalid process identity.'}
    # Filename binds the process lifetime, not the run identifier: a second
    # run cannot re-admit the same target. Any partial file remains consumed.
    $path=Join-Path $dir ("admission-{0}-{1}.json" -f $Target.Id,$targetFt)
    $record=[ordered]@{version=1;runId=$RunId;targetPid=$Target.Id;targetCreationFiletime=[string]$targetFt;holderPid=$Holder.Id;holderCreationFiletime=[string]$holderFt;createdUtc=[DateTime]::UtcNow.ToString('o');status='consumed';limitation='Admission only, not host submission or project completion.'}
    $bytes=[Text.UTF8Encoding]::new($false).GetBytes(($record|ConvertTo-Json -Compress))
    $file=[IO.File]::Open($path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
    try {$file.Write($bytes,0,$bytes.Length);$file.Flush($true)} finally {$file.Dispose()}
    if($Target.HasExited -or $Holder.HasExited){throw 'Process exited after admission; admission remains consumed.'}
    return $path
}
Export-ModuleMember -Function New-FirstOpen27Admission
