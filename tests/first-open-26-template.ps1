$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot '..\scripts\FirstOpen26Template.psm1') -Force
$common=@{TargetPid=12345;HolderPid=23456;TargetFiletime='134400000000000001';HolderFiletime='134400000000000002'}
foreach ($mode in @('default','jump')) {
 $s=New-FirstOpen26Source -Mode $mode @common
 $fixture=if($mode -eq 'default'){'Binding26Default.cpr'}else{'Binding26Jump.cpr'}
 if(!$s.StartsWith('#error NOT_ADMITTED_FIRST_OPEN_26') -or !$s.Contains($fixture) -or $s.Contains('First Empty Probe 24.cpr') -or $s.Contains('72128')) {throw 'Generated source mismatch.'}
}
$s=New-FirstOpen26Source -Mode DEFAULT @common
if(!$s.Contains('Binding26Default.cpr') -or $s.Contains('Binding26Jump.cpr')) {throw 'Mode normalization mismatch.'}
try { New-FirstOpen26Source -Mode default -TargetPid 72128 -HolderPid 23456 -TargetFiletime '134400000000000001' -HolderFiletime '134400000000000002'; throw 'Old target accepted.' } catch { if($_.Exception.Message -eq 'Old target accepted.') {throw} }
try { New-FirstOpen26Source -Mode other @common; throw 'Invalid mode accepted.' } catch { if($_.Exception.Message -eq 'Invalid mode accepted.') {throw} }
$run=[Guid]::NewGuid().ToString('N')
$draft=Write-FirstOpen26Draft -RunId $run -Mode DEFAULT @common
if($draft.status -cne 'not_admitted' -or $draft.mode -cne 'default' -or -not (Test-Path -LiteralPath $draft.path -PathType Leaf)) {throw 'Draft write mismatch.'}
$first=[IO.File]::ReadAllText($draft.path)
if(-not $first.StartsWith('#error NOT_ADMITTED_FIRST_OPEN_26')) {throw 'Draft is missing its compile guard.'}
$collisionRejected=$false
try {Write-FirstOpen26Draft -RunId $run -Mode default @common | Out-Null} catch {$collisionRejected=$true}
if(-not $collisionRejected -or [IO.File]::ReadAllText($draft.path) -cne $first) {throw 'Draft collision was not rejected.'}
'FirstOpen26 offline template tests passed.'
