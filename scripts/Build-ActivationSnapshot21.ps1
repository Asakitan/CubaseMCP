$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root 'native\ActivationSnapshot21.cpp'
$output = Join-Path $root 'artifacts\activation-snapshot-21'
$vcvars = 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat'
if (-not (Test-Path -LiteralPath $vcvars -PathType Leaf)) { throw 'MSVC vcvars64.bat is missing.' }
New-Item -ItemType Directory -Force -Path $output | Out-Null
$exe = Join-Path $output 'ActivationSnapshot21.exe'
$obj = Join-Path $output 'ActivationSnapshot21.obj'
if ((Test-Path -LiteralPath $exe) -or (Test-Path -LiteralPath $obj)) { throw 'Diagnostic output already exists; preserve it.' }
$cmd = 'call "{0}" >nul && cl /nologo /std:c++17 /EHsc /W4 /WX /Zs "{1}" && cl /nologo /std:c++17 /EHsc /W4 /WX "{1}" /Fo"{2}" /Fe"{3}" /link user32.lib' -f $vcvars, $source, $obj, $exe
& cmd.exe /d /s /c $cmd
if ($LASTEXITCODE -ne 0) { throw "Activation snapshot syntax check or build failed: $LASTEXITCODE" }
Write-Output "Built: $exe"
