$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
. (Join-Path $root 'scripts\Use-WorkspaceTemp.ps1')
$output=Join-Path $root 'artifacts\native-runtime'
[void][IO.Directory]::CreateDirectory($output)
$vc='C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat'
$command='call "{0}" >nul && cl /nologo /std:c++17 /EHsc /W4 /WX /LD "{1}" /Fo"{2}" /Fe"{3}" /link version.lib user32.lib' -f $vc,(Join-Path $root 'native\bridge\CubaseProjectCreate.cpp'),(Join-Path $output 'create.obj'),(Join-Path $output 'CubaseProjectCreate.dll')
& cmd.exe /d /s /c $command
if($LASTEXITCODE -ne 0){throw 'Project runtime native build failed.'}
$csc=Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $csc /nologo /target:library ('/out:'+(Join-Path $output 'ProjectCreateLoader.dll')) (Join-Path $root 'native\ProjectCreateLoader.cs') (Join-Path $root 'native\FirstOpen26JobAudit.cs') (Join-Path $root 'native\FirstOpen26ProcessIdentity.cs') (Join-Path $root 'native\CubaseDesktop.cs')
if($LASTEXITCODE -ne 0){throw 'Project runtime loader build failed.'}
Write-Output $output
