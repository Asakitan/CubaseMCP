[CmdletBinding()]
param([Parameter(Mandatory=$true)][ValidateSet('default','jump')][string]$Mode)
$ErrorActionPreference = 'Stop'
$Mode = $Mode.ToLowerInvariant()
$Root = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot)).TrimEnd('\')
if ($Root -ine 'E:\VC\CubaseMCP') { throw 'Unexpected fixed diagnostic workspace.' }
$Directory = Join-Path $Root 'artifacts\live-smoke'
foreach ($path in @($Root,(Join-Path $Root 'artifacts'),$Directory)) {
    $attributes = [IO.File]::GetAttributes($path)
    if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
        ($attributes -band [IO.FileAttributes]::Directory) -eq 0) { throw 'Diagnostic directory is not a non-reparse directory.' }
}
$Source = Join-Path $Directory 'MCP Device Test 20261110.cpr'
$Destination = Join-Path $Directory $(if ($Mode -ceq 'default') {'Binding26Default.cpr'} else {'Binding26Jump.cpr'})
$attributes = [IO.File]::GetAttributes($Source)
if (($attributes -band ([IO.FileAttributes]::ReparsePoint -bor [IO.FileAttributes]::Directory)) -ne 0) {
    throw 'Diagnostic source is not a regular file.'
}
$inputStream = [IO.File]::Open($Source,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
try {
    if ($inputStream.Length -ne 93085) { throw 'Diagnostic source length changed.' }
    $outputStream = [IO.File]::Open($Destination,[IO.FileMode]::CreateNew,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
    try {
        $inputStream.CopyTo($outputStream)
        $outputStream.Flush($true)
        if ($outputStream.Length -ne $inputStream.Length) { throw 'Diagnostic fixture length mismatch.' }
        $inputStream.Position = 0; $outputStream.Position = 0
        $left = [byte[]]::new(65536); $right = [byte[]]::new(65536); [long]$compared = 0
        do {
            $a = $inputStream.Read($left,0,$left.Length)
            $b = 0
            while ($b -lt $a) {
                $n = $outputStream.Read($right,$b,$a-$b)
                if ($n -le 0) { throw 'Diagnostic fixture ended during comparison.' }
                $b += $n
            }
            for ($i = 0; $i -lt $a; $i++) { if ($left[$i] -ne $right[$i]) { throw 'Diagnostic fixture differs from source.' } }
            $compared += $a
        } while ($a -gt 0)
        if ($compared -ne 93085 -or $outputStream.ReadByte() -ne -1) { throw 'Diagnostic fixture comparison length mismatch.' }
    } finally { $outputStream.Dispose() }
} finally { $inputStream.Dispose() }
[ordered]@{status='copied';mode=$Mode;source=$Source;fixture=$Destination;bytes=$compared;bytewiseEqual=$true;
    limitation='Disk copy only; this is not Cubase project creation, opening or persistence evidence.'} | ConvertTo-Json
