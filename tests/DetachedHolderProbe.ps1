param([string]$ProjectPath, [string]$HolderStdoutPath, [string]$HolderStderrPath)
$ErrorActionPreference = 'Stop'
if (-not $ProjectPath -or -not $HolderStdoutPath -or -not $HolderStderrPath) { throw 'Missing probe paths.' }
[IO.File]::WriteAllText($ProjectPath, [string]$PID, [Text.UTF8Encoding]::new($false))
[IO.File]::AppendAllText($HolderStdoutPath, 'synthetic holder started', [Text.UTF8Encoding]::new($false))
Start-Sleep -Seconds 8
