[CmdletBinding()]
param(
    [string]$TargetDirectory = (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Steinberg\Cubase\MIDI Remote\Driver Scripts\Local\CubaseAI\MCP'),
    [switch]$CheckOnly,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Names = @('CubaseAI_MCP.js', 'controller.js', 'commands.js', 'protocol.js')
$Actions = @()

foreach ($Name in $Names) {
    $Source = Join-Path (Join-Path $ProjectRoot 'remote') $Name
    $Target = Join-Path $TargetDirectory $Name
    if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) {
        throw "Missing source: $Source"
    }
    $Action = 'install'
    if (Test-Path -LiteralPath $Target) {
        if (-not (Test-Path -LiteralPath $Target -PathType Leaf)) { throw "Target is not a file: $Target" }
        if ([IO.File]::ReadAllText($Source) -ceq [IO.File]::ReadAllText($Target)) {
            $Action = 'unchanged'
        } elseif (-not $Force) {
            throw "Different driver exists: $Target. Review it first; -Force explicitly permits replacement."
        } else {
            $Action = 'replace'
        }
    }
    $Actions += [PSCustomObject]@{ source = $Source; target = $Target; action = $Action }
}

if (-not $CheckOnly) {
    [IO.Directory]::CreateDirectory($TargetDirectory) | Out-Null
    foreach ($Item in $Actions) {
        if ($Item.action -eq 'unchanged') { continue }
        Copy-Item -LiteralPath $Item.source -Destination $Item.target -Force
        if ([IO.File]::ReadAllText($Item.source) -cne [IO.File]::ReadAllText($Item.target)) {
            throw "Driver copy verification failed: $($Item.target)"
        }
    }
}

[PSCustomObject]@{
    checkOnly = [bool]$CheckOnly
    targetDirectory = $TargetDirectory
    files = $Actions
    inputPort = 'CubaseAI MCP To Cubase'
    outputPort = 'CubaseAI MCP From Cubase'
    applicationStarted = $false
    foregroundAutomation = $false
    driverInstalled = (-not $CheckOnly)
} | ConvertTo-Json -Depth 5