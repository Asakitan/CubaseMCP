$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root 'native\bridge\CubaseMcpProjectOpenProbe19.cpp'
$output = Join-Path $root 'artifacts\project-open-probe'
$vcvars = 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat'
if (-not (Test-Path -LiteralPath $vcvars -PathType Leaf)) { throw 'MSVC vcvars64.bat is missing.' }
New-Item -ItemType Directory -Force -Path $output | Out-Null
$dll = Join-Path $output 'CubaseMcpProjectOpenProbe19.dll'
$obj = Join-Path $output 'CubaseMcpProjectOpenProbe19.obj'
if (Test-Path -LiteralPath $dll) { throw 'Project-open 19 diagnostic image already exists; preserve it rather than overwrite.' }
$cmd = 'call "{0}" >nul && cl /nologo /std:c++17 /EHsc /W4 /WX /Zs "{1}" && cl /nologo /std:c++17 /EHsc /W4 /WX /LD "{1}" /Fo"{2}" /Fe"{3}" /link version.lib user32.lib' -f $vcvars, $source, $obj, $dll
& cmd.exe /d /s /c $cmd
if ($LASTEXITCODE -ne 0) { throw "Project-open 19 probe syntax check or build failed: $LASTEXITCODE" }
Write-Output "Built: $dll"
