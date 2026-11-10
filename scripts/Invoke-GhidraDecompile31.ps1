[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateNotNullOrEmpty()][string[]]$Rva,
    [string]$Program = 'Cubase 16.exe',
    [string]$Project = 'cubase16'
)

# Static analysis only. Reuse the existing imported image; never change the installed binary.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $root 'scripts\Use-WorkspaceTemp.ps1')
$launcher = 'E:\tools\ghidra-12.1.4\ghidra_12.1.4_PUBLIC\support\analyzeHeadless.bat'
$source = Join-Path $root 'artifacts\research\session-30\ghidra'
$output = Join-Path $root ('artifacts\research\session-31\ghidra\out-' + $Project)
if ($Project -notmatch '^[a-zA-Z0-9_-]+$') { throw 'Invalid analysis project name.' }
if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) { throw 'Ghidra launcher is missing.' }
foreach ($address in $Rva) {
    if ($address -notmatch '^0x[0-9a-fA-F]{1,8}$') { throw "Invalid image RVA: $address" }
    $leaf = '{0:x}.c' -f [Convert]::ToUInt32($address.Substring(2), 16)
    if (Test-Path -LiteralPath (Join-Path $output $leaf)) { throw "Evidence already exists: $leaf" }
}
$arguments = @((Join-Path $source 'project'), $Project, '-process', $Program, '-noanalysis', '-readOnly',
    '-scriptPath', (Join-Path $source 'scripts'), '-postScript', 'DecompileAt.java', $output) + $Rva
$lines = & $launcher @arguments 2>&1
$exitCode = $LASTEXITCODE
$lines | Where-Object { $_ -match 'DecompileAt.java>|ERROR|Exception' } | ForEach-Object { [string]$_ }
if ($exitCode -ne 0) { throw "Ghidra exited with $exitCode." }
foreach ($address in $Rva) {
    $leaf = '{0:x}.c' -f [Convert]::ToUInt32($address.Substring(2), 16)
    $path = Join-Path $output $leaf
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Missing listing: $leaf" }
    if ((Get-Content -LiteralPath $path -Raw -Encoding utf8) -match '^// (no function|decompile failed)') {
        throw "Decompilation did not complete: $path"
    }
}