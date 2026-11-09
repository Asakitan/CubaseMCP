$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot '..\scripts\FirstOpen26Plan.psm1') -Force
$module=Get-Module FirstOpen26Plan
$text='2026-11-09T20:02:45.5745512Z'
$expected=[DateTime]::Parse($text,[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime().ToFileTimeUtc()
$fromText=& $module {param($v) (ConvertTo-FirstOpen26Utc $v).ToFileTimeUtc()} $text
$fromDate=& $module {param($v) (ConvertTo-FirstOpen26Utc $v).ToFileTimeUtc()} ([DateTime]::FromFileTimeUtc($expected))
if($fromText -ne $expected -or $fromDate -ne $expected) {throw 'UTC timestamp precision was lost.'}
foreach($test in @(@{RunId='invalid';Mode='default'},@{RunId='00000000000000000000000000000000';Mode='invalid'},@{RunId='00000000000000000000000000000000';Mode='default'})) {
 $rejected=$false; try {Test-FirstOpen26Plan @test | Out-Null} catch {$rejected=$true}; if(!$rejected){throw 'Invalid or absent fixed plan was accepted.'}
}
'FirstOpen26 plan rejection tests passed.'
