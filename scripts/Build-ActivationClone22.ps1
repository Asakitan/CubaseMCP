$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root 'native\ActivationClone22.cpp'
$output = Join-Path $root 'artifacts\activation-clone-22'
$vcvars = 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat'
if (-not (Test-Path -LiteralPath $vcvars -PathType Leaf)) { throw 'MSVC vcvars64.bat is missing.' }
New-Item -ItemType Directory -Force -Path $output | Out-Null
$exe = Join-Path $output 'ActivationClone22.exe'
$obj = Join-Path $output 'ActivationClone22.obj'
$pdb = Join-Path $output 'ActivationClone22.pdb'
if (@(@($exe, $obj, $pdb) | Where-Object { Test-Path -LiteralPath $_ }).Count -ne 0) { throw 'Diagnostic output already exists; preserve it.' }
$cmd = 'call "{0}" >nul && cl /nologo /std:c++17 /EHsc /W4 /WX /Zs "{1}" && cl /nologo /std:c++17 /EHsc /W4 /WX /Z7 /Od "{1}" /Fo"{2}" /Fe"{3}" /link /DEBUG /PDB:"{4}" dbghelp.lib psapi.lib' -f $vcvars, $source, $obj, $exe, $pdb
& cmd.exe /d /s /c $cmd
if ($LASTEXITCODE -ne 0) { throw "Synthetic diagnostic build failed: $LASTEXITCODE" }
Write-Output "Built: $exe"
