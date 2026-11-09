$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if ([IO.Path]::GetFullPath($root).TrimEnd('\') -ine 'E:\VC\CubaseMCP') { throw 'Unexpected workspace.' }
$dir = Join-Path $root 'artifacts\live-smoke'
foreach ($p in @($root, (Join-Path $root 'artifacts'), $dir)) {
    if (([IO.File]::GetAttributes($p) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Reparse point in fixture path.' }
}
$source = Join-Path $dir 'MCP Device Test 20261110.cpr'
$dest = Join-Path $dir 'Open SameDir Probe 20.cpr'
if (([IO.File]::GetAttributes($source) -band ([IO.FileAttributes]::ReparsePoint -bor [IO.FileAttributes]::Directory)) -ne 0) { throw 'Source is not a regular file.' }
$inputStream = [IO.File]::Open($source, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
try {
    if ($inputStream.Length -ne 93085) { throw 'Source length changed.' }
    $outputStream = [IO.File]::Open($dest, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $inputStream.CopyTo($outputStream); $outputStream.Flush($true) } finally { $outputStream.Dispose() }
} finally { $inputStream.Dispose() }
$expected = [IO.File]::ReadAllBytes($source)
$actual = [IO.File]::ReadAllBytes($dest)
if ($expected.Length -ne 93085 -or $actual.Length -ne $expected.Length) { throw 'Copied fixture length changed.' }
for ($i = 0; $i -lt $expected.Length; $i++) {
    if ($expected[$i] -ne $actual[$i]) { throw 'Copied fixture differs from the closed source.' }
}
[ordered]@{ source=$source; fixture=$dest; bytes=$actual.Length; bytewiseEqual=$true;
    limitation='Disk copy only; no host-open, content or persistence result is established.' } | ConvertTo-Json
