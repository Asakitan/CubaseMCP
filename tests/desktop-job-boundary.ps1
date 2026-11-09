[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$RunId = [Guid]::NewGuid().ToString('N')
$Directory = Join-Path $Root ("artifacts\desktop-job-$RunId")
[void][IO.Directory]::CreateDirectory($Directory)
$Executable = Join-Path $Directory 'DesktopJobProbe.exe'
$Report = Join-Path $Directory 'probe.json'
Add-Type -TypeDefinition (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'DesktopJobProbe.cs') -Raw -Encoding UTF8) `
    -OutputAssembly $Executable -OutputType ConsoleApplication
Add-Type -Path (Join-Path $Root 'native\CubaseDesktop.cs')
$Launch = [CubaseAiMcp.CubaseDesktop]::Start($Executable, $Report, $Directory, "CubaseMcpJob_$RunId")
$Exit = [CubaseAiMcp.CubaseDesktop]::WaitForExit()
if ($Exit -ne 0) { throw "Synthetic probe exited $Exit." }
if (-not (Test-Path -LiteralPath $Report -PathType Leaf)) { throw 'Synthetic probe report is absent.' }
$Result = Get-Content -LiteralPath $Report -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not $Launch.DesktopSwitchRestricted -or -not $Launch.JobKillsOnLastHandleClose -or
    -not $Result.inJob -or (($Result.uiFlags -band 0x40) -eq 0) -or $Result.desktopCreated -or $Result.desktopError -eq 0) {
    throw "Desktop job restriction was not confirmed: $($Result | ConvertTo-Json -Compress)"
}
if ($Launch.InputDesktopBefore -eq "CubaseMcpJob_$RunId" -or
    $Launch.InputDesktopBeforeResume -eq "CubaseMcpJob_$RunId" -or $Launch.InputDesktopAfter -eq "CubaseMcpJob_$RunId") {
    throw 'The synthetic desktop became the input desktop.'
}
[ordered]@{ status = 'passed'; launch = $Launch; probe = $Result; report = $Report;
    limitation = 'Synthetic CreateDesktop denial and configured job are not proof of Cubase startup or the absence of all foreground changes.' } |
    ConvertTo-Json -Depth 5
