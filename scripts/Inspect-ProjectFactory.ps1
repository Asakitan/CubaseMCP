[CmdletBinding()]
param([string]$OutputPath, [switch]$ProbeProjectService, [switch]$ProbeEmptyRequest)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
if ($OutputPath -and (Test-Path -LiteralPath $OutputPath)) { throw "Refusing to overwrite $OutputPath" }
if ($ProbeProjectService -and $ProbeEmptyRequest) { throw 'Select only one explicit service probe.' }
Add-Type -Path (Join-Path $Root 'native\FactoryProbe.cs')
$Directory = 'C:\Program Files\Steinberg\Cubase 16\Components'
$Reports = if ($ProbeEmptyRequest) {
    @([CubaseAiMcp.FactoryProbe]::InspectEmptyProjectRequest((Join-Path $Directory 'projectplugin.dll')))
} elseif ($ProbeProjectService) {
    @([CubaseAiMcp.FactoryProbe]::InspectProjectService((Join-Path $Directory 'projectplugin.dll')))
} else {
    @('projectplugin.dll', 'hostchannelaccess.dll') | ForEach-Object {
        [CubaseAiMcp.FactoryProbe]::Inspect((Join-Path $Directory $_))
    }
}
$Result = [pscustomobject]@{
    timestamp = [DateTime]::UtcNow.ToString('o')
    processId = $PID
    scope = if ($ProbeEmptyRequest) {
        'One empty-input service request in this independent probe process; no host context, output receiver, gate modification or Cubase attachment.'
    } elseif ($ProbeProjectService) {
        'Observed class/interface creation in this independent probe process only; no service request, host-context spoof, gate modification or Cubase attachment.'
    } else {
        'Standard factory metadata in this independent probe process; no Cubase attachment or business object creation.'
    }
    reports = @($Reports)
}
$Json = $Result | ConvertTo-Json -Depth 8
if ($OutputPath) {
    $FullPath = [IO.Path]::GetFullPath($OutputPath)
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($FullPath)) | Out-Null
    $Stream = [IO.File]::Open($FullPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
    try {
        $Bytes = [Text.UTF8Encoding]::new($false).GetBytes($Json + [Environment]::NewLine)
        $Stream.Write($Bytes, 0, $Bytes.Length)
    } finally { $Stream.Dispose() }
}
$Json
if (@($Reports | Where-Object { $_.Error }).Count) { exit 1 }
