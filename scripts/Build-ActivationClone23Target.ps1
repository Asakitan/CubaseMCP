param([ValidatePattern('^[0-9a-f]{32}$')][string]$RunId = [guid]::NewGuid().ToString('N'))
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root 'native\ActivationClone23Target.cpp'
$output = Join-Path $root ('artifacts\activation-clone-23-target\build-' + $RunId)
$vcvars = 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat'
if (-not (Test-Path -LiteralPath $vcvars -PathType Leaf)) { throw 'MSVC vcvars64.bat is missing.' }
if (Test-Path -LiteralPath $output) { throw 'Build output exists; preserve it.' }
New-Item -ItemType Directory -Path $output | Out-Null
$exe = Join-Path $output 'ActivationClone23Target.exe'
$obj = Join-Path $output 'ActivationClone23Target.obj'
$cmd = 'call "{0}" >nul && cl /nologo /std:c++17 /EHsc /W4 /WX /Zs "{1}" && cl /nologo /std:c++17 /EHsc /W4 /WX "{1}" /Fo"{2}" /Fe"{3}" /link dbghelp.lib psapi.lib' -f $vcvars, $source, $obj, $exe
& cmd.exe /d /s /c $cmd
if ($LASTEXITCODE -ne 0) { throw "Target diagnostic build failed: $LASTEXITCODE" }
$fullExe = [IO.Path]::GetFullPath($exe)
$hash = (Get-FileHash -LiteralPath $fullExe -Algorithm SHA256).Hash
$receipt = [ordered]@{ buildRunId = $RunId; exe = $fullExe; sha256 = $hash }
$receiptPath = Join-Path $output 'build-receipt.json'
$file = [IO.File]::Open($receiptPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
try {
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes(($receipt | ConvertTo-Json -Compress))
    $file.Write($bytes, 0, $bytes.Length); $file.Flush($true)
} finally { $file.Dispose() }
Write-Output "Built: $fullExe receipt=$receiptPath"
