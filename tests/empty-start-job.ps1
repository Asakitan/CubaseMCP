$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$id = [guid]::NewGuid().ToString('N')
$dir = Join-Path $Root "artifacts\empty-start-synthetic-$id"
[IO.Directory]::CreateDirectory($dir) | Out-Null
$exe = Join-Path $dir 'EmptyStartProbe.exe'; $report = Join-Path $dir 'probe.json'
Add-Type -TypeDefinition (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'EmptyStartProbe.cs') -Raw -Encoding UTF8) -OutputAssembly $exe -OutputType ConsoleApplication
Add-Type -Path (Join-Path $Root 'native\CubaseDesktop.cs')
$previous = $env:CUBASE_EMPTY_SYNTH_REPORT
try {
    $env:CUBASE_EMPTY_SYNTH_REPORT = $report
    $launch = [CubaseAiMcp.CubaseDesktop]::StartEmpty($exe, $dir, "CubaseEmptyTest_$id")
    $code = [CubaseAiMcp.CubaseDesktop]::WaitForExit()
    if ($code -ne 0) { throw "Synthetic child exit $code" }
    $probe = Get-Content -LiteralPath $report -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($probe.argCount -ne 0 -or -not $probe.inJob -or ($probe.uiFlags -band 0x40) -eq 0 -or
        -not $launch.DesktopSwitchRestricted -or -not $launch.JobKillsOnLastHandleClose) { throw 'Empty command or job validation failed.' }
    if ($launch.InputDesktopBefore -eq "CubaseEmptyTest_$id" -or $launch.InputDesktopBeforeResume -eq "CubaseEmptyTest_$id" -or
        $launch.InputDesktopAfter -eq "CubaseEmptyTest_$id") { throw 'Synthetic desktop appeared in an input sample.' }
    if ($launch.ForegroundBefore -cne $launch.ForegroundAfter) { throw 'Foreground handle changed during the synthetic launch samples.' }
    [ordered]@{status='passed'; launch=$launch; probe=$probe; limitation='Synthetic child and point samples only.'} | ConvertTo-Json -Depth 4
} finally { $env:CUBASE_EMPTY_SYNTH_REPORT = $previous }
