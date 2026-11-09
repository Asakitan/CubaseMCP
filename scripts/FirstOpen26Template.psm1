Set-StrictMode -Version Latest
function New-FirstOpen26Source {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][ValidateSet('default','jump')][string]$Mode,
        [Parameter(Mandatory)][ValidateRange(1,2147483647)][int]$TargetPid,
        [Parameter(Mandatory)][ValidateRange(1,2147483647)][int]$HolderPid,
        [Parameter(Mandatory)][ValidatePattern('^[0-9]{17,18}$')][string]$TargetFiletime,
        [Parameter(Mandatory)][ValidatePattern('^[0-9]{17,18}$')][string]$HolderFiletime
    )
    $Mode = $Mode.ToLowerInvariant()
    if ($TargetPid -eq 72128 -or $HolderPid -eq 55324 -or $TargetPid -eq $HolderPid -or
        $TargetFiletime -ceq '134387281655745512' -or $HolderFiletime -ceq '134387281647304009') { throw 'Prior or invalid identity.' }
    $root = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot)).TrimEnd('\')
    if ($root -ine 'E:\VC\CubaseMCP') { throw 'Unexpected workspace.' }
    $file = if ($Mode -ceq 'default') { 'Binding26Default.cpr' } else { 'Binding26Jump.cpr' }
    $template = [IO.File]::ReadAllText((Join-Path $root 'native\bridge\CubaseMcpFirstProjectOpen24.cpp'))
    $changes = @(
        @('134387281655745512', $TargetFiletime, 1),
        @('134387281647304009', $HolderFiletime, 2),
        @('72128', [string]$TargetPid, 2),
        @('55324', [string]$HolderPid, 3),
        @('First Empty Probe 24.cpr', $file, 3),
        @('StartFirstProjectOpen24', 'StartFirstProjectOpen26', 2)
    )
    foreach ($item in $changes) {
        $old=[string]$item[0]; $new=[string]$item[1]; $expected=[int]$item[2]
        $count=[regex]::Matches($template,[regex]::Escape($old)).Count
        if ($count -ne $expected) { throw "Template marker mismatch: $old ($count, expected $expected)." }
        $template=$template.Replace($old,$new)
    }
    foreach ($old in @('134387281655745512','134387281647304009','72128','55324','First Empty Probe 24.cpr','StartFirstProjectOpen24')) {
        if ($template.Contains($old)) { throw "Old marker remains: $old" }
    }
    # Deliberately non-buildable until independently reviewed and admitted.
    return "#error NOT_ADMITTED_FIRST_OPEN_26`r`n" + $template
}
function Write-FirstOpen26Draft {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{32}$')][string]$RunId,
        [Parameter(Mandatory)][ValidateSet('default','jump')][string]$Mode,
        [Parameter(Mandatory)][int]$TargetPid,
        [Parameter(Mandatory)][int]$HolderPid,
        [Parameter(Mandatory)][string]$TargetFiletime,
        [Parameter(Mandatory)][string]$HolderFiletime
    )
    $Mode = $Mode.ToLowerInvariant()
    $source=New-FirstOpen26Source -Mode $Mode -TargetPid $TargetPid -HolderPid $HolderPid -TargetFiletime $TargetFiletime -HolderFiletime $HolderFiletime
    $root='E:\VC\CubaseMCP'; $artifacts=Join-Path $root 'artifacts'; $dir=Join-Path $artifacts 'first-open-26-drafts'
    foreach ($path in @($root,$artifacts)) {
        if (([IO.File]::GetAttributes($path) -band [IO.FileAttributes]::ReparsePoint) -ne 0) {throw 'Reparse point in output path.'}
    }
    [void][IO.Directory]::CreateDirectory($dir)
    if (([IO.File]::GetAttributes($dir) -band [IO.FileAttributes]::ReparsePoint) -ne 0) {throw 'Reparse point in output directory.'}
    $path=Join-Path $dir ("first-open-26-{0}-{1}.cpp" -f $RunId,$Mode)
    $stream=[IO.File]::Open($path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try { $bytes=[Text.UTF8Encoding]::new($false).GetBytes($source); $stream.Write($bytes,0,$bytes.Length); $stream.Flush($true) } finally {$stream.Dispose()}
    [pscustomobject]@{status='not_admitted';path=$path;runId=$RunId;mode=$Mode;limitation='Draft only. No receipt, parent, Job, holder, fixture or observer validation was performed; compilation is deliberately blocked.'}
}
Export-ModuleMember -Function New-FirstOpen26Source,Write-FirstOpen26Draft
