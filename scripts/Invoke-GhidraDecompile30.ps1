[CmdletBinding()]
param([Parameter(Mandatory)][string[]]$Rva, [string]$Program = 'Cubase 16.exe', [string]$Project = 'cubase16')
# Read-only research helper (session 30): decompile functions of an already imported image at the
# given RVAs with Ghidra headless. Output goes to artifacts/research/session-30/ghidra/out/<rva>.c.
# The installed Cubase files are never modified; no analysis results are written back to them.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $root 'scripts\Use-WorkspaceTemp.ps1')
$ghidra = 'E:\tools\ghidra-12.1.4\ghidra_12.1.4_PUBLIC\support\analyzeHeadless.bat'
if (-not (Test-Path -LiteralPath $ghidra -PathType Leaf)) { throw 'Ghidra headless launcher is not installed at the expected path.' }
$work = Join-Path $root 'artifacts\research\session-30\ghidra'
$out = Join-Path $work ('out' + $(if ($Project -ceq 'cubase16') { '' } else { '-' + $Project }))
$arguments = @((Join-Path $work 'project'), $Project, '-process', $Program, '-noanalysis', '-readOnly',
    '-scriptPath', (Join-Path $work 'scripts'), '-postScript', 'DecompileAt.java', $out) + $Rva
$lines = & $ghidra @arguments 2>&1
$lines | Where-Object { $_ -match 'DecompileAt.java>|ERROR|Exception' } | ForEach-Object { [string]$_ }
